// Scout — the ingest pipeline. Runs once per debounced burst.
//
// Order is load-bearing and worth reading before changing:
//
//   1. resolve identity      (mints the account on first contact)
//   2. capacity PRE-FLIGHT   (before any bytes are spent on R2)
//   3. upload media          (images row carries board refs from birth)
//   4. compose + lay out     (deterministic; the model only read intent)
//   5. triple write          (card_index gates the cap, then doc, then state)
//   6. one reply
//
// The pre-flight in (2) is why (3) can't waste storage on a card that will be
// rejected, and the card_index-first ordering inside (5) is why a capped user
// never sees a card appear and then vanish.

import {
  resolveOrCreateIdentity, ensureScoutBin, createBoard, normalizeHandle, resolveEmail,
  SCOUT_BIN_NAME,
} from '../../boards/src/lib/scoutIdentity.js';
import {
  parseConfirmation, wantsEverything, isBinQuery, parseStopIntent, parseFindIntent,
  isDeleteIntent, isCreateConfirmation,
  prepareMove, executeMove, undoMove, describeBin, PENDING_TTL_MS,
} from './filing.js';
import { extractIntent, parseCommand, parseFileIntent } from '../../boards/src/lib/scoutIntent.js';
import {
  extractUrls, textWithoutUrls, arrangeExisting,
} from '../../boards/src/lib/scoutCards.js';
import {
  addCardsToBoard, boardCapacity, moveCardsBetweenBoards, readBoardCards,
  deleteCardsFromBoard,
} from '../../boards/src/lib/scoutBoard.js';
import { groupIntoRuns, currentRun, countable } from '../../boards/src/lib/scoutRuns.js';
import { scoutRpc, scoutSelect, scoutSession } from '../../boards/src/lib/scoutDb.js';
import { mintScoutSessionToken } from '../../boards/src/worker-scout.js';
import { isImage } from './media.js';
import { ingestBurst, overDailyLimit } from './ingest.js';
import * as say from './replies.js';
import { STAGES } from './progress.js';
import {
  looksLikeQuestion, matchTopic, renderAnswer, fallbackAnswer,
  CLASSIFIER_SYSTEM, isValidTopic,
} from './answers.js';
import { runWorkersAiChat } from '../../boards/src/worker-llm.js';

// Fetch og metadata through the app's own /api/og route so link cards get the
// same title/image/favicon a browser paste would produce.
async function linkPreview(cfg, url) {
  try {
    const res = await fetch(`${cfg.APP_ORIGIN}/api/og?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j && !j.error ? j : null;
  } catch (_) {
    return null;   // a preview is a nicety; never fail an ingest over it
  }
}

// Deep link back to exactly what just landed.
//
// A shell account has never seen a login screen and has an email it wouldn't
// recognise, so a plain board URL would drop it on the auth gate — which is
// the exact friction Scout exists to remove. It gets a signed instant-session
// link instead. An account that has already attached a real email gets the
// plain URL, because it has a browser session of its own.
//
// The token is minted in-process rather than over HTTP: worker-scout.js uses
// only fetch + WebCrypto + btoa/atob, all of which Node 22 has, so the same
// signing code runs in both runtimes and there's one implementation to trust.
async function boardUrl(cfg, { boardId, cardIds, isShell, userId }) {
  const cards = cardIds.slice(0, 12).join(',');
  const query = `board=${boardId}${cards ? `&cards=${encodeURIComponent(cards)}` : ''}`;

  if (isShell) {
    try {
      const token = await mintScoutSessionToken(cfg, userId);
      return `${cfg.APP_ORIGIN}/s/${token}?${query}`;
    } catch (e) {
      // Better a link that asks them to sign in than no link at all.
      console.error('[scout] session mint failed', e?.message);
    }
  }
  return `${cfg.APP_ORIGIN}/?${query}`;
}

async function boardNameFor(cfg, boardId) {
  const rows = await scoutSelect(cfg, 'boards', `id=eq.${boardId}&select=name`).catch(() => []);
  return rows?.[0]?.name || SCOUT_BIN_NAME;
}

// The headless PartyKit peer needs a real user JWT (party/auth.ts validates via
// PostgREST as the user, so the service key is useless). Minting one costs a
// magiclink round trip, so it's lazy and memoized per burst — filing needs it
// early, ingest needs it late, and neither should pay for it twice.
function sessionFor(cfg, id) {
  let promise = null;
  return () => {
    if (!promise) {
      promise = scoutSession(cfg, id.userId, id.email).catch((e) => {
        console.warn('[scout] no user session, cards will appear on next load:', e?.message);
        return null;
      });
    }
    return promise;
  };
}

// Find a board by name across EVERYTHING this user can write to.
//
// This used to list one workspace's boards and match them here in JS, which
// meant a linked account's boards in a team workspace — or boards shared with
// them — could not be named at all. Those are exactly the boards someone with a
// pre-existing account wants to file into.
//
// The ranking (exact → prefix → substring) moved into scout_find_board unchanged
// along with the reason for it: "diner" should find "Diner Recce" without a
// fuzzy matcher that would also find "Dinner Party". What the RPC adds is that
// the write check is now scout_can_write_board — the same predicate
// scout_set_target_board uses — so the board we offer and the board we are
// allowed to set can never disagree.
async function findBoardByName(cfg, userId, name) {
  if (!String(name || '').trim()) return null;
  const rows = await scoutRpc(cfg, 'scout_find_board', {
    p_user_id: userId, p_query: name, p_limit: 1,
  }).catch(() => []);
  const hit = (Array.isArray(rows) ? rows : [rows])[0];
  return hit?.board_id ? { id: hit.board_id, name: hit.name } : null;
}

// ── Linking an account that already exists ───────────────────────────────────
//
// A code has just been claimed, so this handle now belongs to a real account.
// Two cases, and the difference is whether this number had been texting before:
//
//   * fresh number → say hello, nothing to carry over.
//   * this number already had a SHELL account → its Bin is holding photos the
//     user sent before they connected, and those are the photos they are most
//     worried about. Bring them across.
//
// The move is the ordinary triple write via moveCardsBetweenBoards, which puts
// the destination first: interrupted, the cards are visible on BOTH bins, which
// is recoverable, rather than on neither. scout_mark_adopted runs only AFTER the
// move lands, so a failure part-way leaves the flag unset and re-texting the
// code finishes the job.
async function linkTo(cfg, ctx, hit) {
  const email = await resolveEmail(cfg, hit.user_id) || 'your account';

  // The claiming account's own Bin — created here if this is its first contact
  // with Scout, which is the common case for a web user connecting a phone.
  const bin = await ensureScoutBin(cfg, hit.user_id);

  if (!hit.prior_user_id || !hit.prior_bin_board_id) {
    return say.linked({ email });
  }

  try {
    const accessToken = await scoutSession(cfg, hit.user_id, email).catch(() => null);
    const orphaned = await readBoardCards(cfg, hit.prior_bin_board_id, null);
    const carry = orphaned.filter((c) => !c.seed);
    if (!carry.length) {
      await scoutRpc(cfg, 'scout_mark_adopted', {
        p_shell_user_id: hit.prior_user_id, p_new_user_id: hit.user_id,
      }).catch(() => {});
      return say.linked({ email });
    }

    const moved = await moveCardsBetweenBoards(cfg, {
      fromBoardId: hit.prior_bin_board_id,
      toBoardId: bin.boardId,
      workspaceId: bin.workspaceId,
      userId: hit.user_id,
      accessToken,
      cardIds: carry.map((c) => c.id),
      layout: async (existing, moving) => arrangeExisting({ existingCards: existing, cards: moving }),
    });

    if (!moved.count) return say.linked({ email });

    await scoutRpc(cfg, 'scout_mark_adopted', {
      p_shell_user_id: hit.prior_user_id, p_new_user_id: hit.user_id,
    }).catch(() => {});

    return say.adopted({ email, count: moved.count });
  } catch (e) {
    // The link itself already succeeded — the handle is bound and everything
    // they send from now on lands in the right account. Only the carry-over
    // failed, and the cards are still sitting safely in the old Bin, so this
    // must not read as a failed connection.
    console.error('[scout] adopt failed', e?.message);
    return say.linked({ email });
  }
}

// ── Pending proposals ────────────────────────────────────────────────────────
//
// scout_set_pending_move (0209) stores an arbitrary jsonb payload, so the
// "propose, then act on the answer" mechanism built for moves carries the two
// other irreversible-ish things Scout can now do without any new state. Each
// payload names its own `kind`, and each answers to a DIFFERENT word — CREATE
// makes a board, YES deletes — so a stray confirmation can never trigger the
// wrong one.

function clearPending(cfg, ctx) {
  return scoutRpc(cfg, 'scout_set_pending_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform,
    p_thread_key: ctx.threadKey, p_payload: null,
  }).catch(() => {});
}

function setPending(cfg, ctx, payload) {
  return scoutRpc(cfg, 'scout_set_pending_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform,
    p_thread_key: ctx.threadKey, p_payload: payload,
  }).catch(() => {});
}

// ── Creating a board by text ─────────────────────────────────────────────────
//
// Scout could name a board and could not make one, so "put these in Diner
// Recce" for a board that did not exist yet was a dead end — and the very first
// thing anybody tries is the board they have in their head, not the one already
// on their canvas. say.boardSwitched({ created: true }) has existed since the
// beginning with nothing able to reach it.
async function offerBoardCreate(cfg, ctx, name) {
  const clean = String(name || '').trim().slice(0, 48);
  if (!clean) return say.boardNotFound('');
  await setPending(cfg, ctx, { kind: 'create_board', board_name: clean });
  return say.boardCreateOffer(clean);
}

async function createAndTarget(cfg, ctx, name) {
  await clearPending(cfg, ctx);
  try {
    // The Bin's workspace, resolved the same way every other Scout write does —
    // a board minted anywhere else would not be one this thread can write to.
    const bin = await ensureScoutBin(cfg, ctx.userId, { binBoardId: ctx.binBoardId });
    const boardId = await createBoard(cfg, {
      workspaceId: bin.workspaceId, name, userId: ctx.userId,
    });
    // Point the thread at it, through the same predicate-checked RPC /board
    // uses — so a board we just made and a board we are allowed to target
    // cannot disagree.
    await scoutRpc(cfg, 'scout_set_target_board', {
      p_user_id: ctx.userId, p_platform: ctx.platform,
      p_thread_key: ctx.threadKey, p_board_id: boardId,
    });
    return say.boardCreated({
      boardName: name,
      url: await boardUrl(cfg, {
        boardId, cardIds: [], isShell: ctx.isShell, userId: ctx.userId,
      }),
    });
  } catch (e) {
    console.error('[scout] board create failed', e?.message);
    return say.boardCreateFailed(name);
  }
}

// ── Deleting the batch just sent ─────────────────────────────────────────────
//
// Scoped to the CURRENT RUN and never to the whole Bin, for exactly the reason
// filing is (scoutRuns.js): "that" means what you just sent, and a delete that
// quietly takes Monday's fourteen photos as well is unrecoverable in a way a
// wrong move is not.
//
// Proposed, then confirmed, then answered with an UNDO — deleting shows an undo
// everywhere else in this product and a text thread is no reason to drop the
// convention. The undo is a real restore, not a promise: the cards are handed
// back by deleteCardsFromBoard and stored in the same last_move slot the move
// undo already uses.
async function proposeDelete(cfg, ctx) {
  const cards = countable(await readBoardCards(cfg, ctx.binBoardId, ctx.accessToken));
  const run = currentRun(groupIntoRuns(cards));
  if (!run?.cards?.length) return say.nothingToDelete();

  const boardName = await boardNameFor(cfg, ctx.binBoardId);
  await setPending(cfg, ctx, {
    kind: 'delete',
    board_id: ctx.binBoardId,
    board_name: boardName,
    card_ids: run.cards.map((c) => String(c.id)),
  });
  return say.deleteConfirm({ count: run.cards.length, boardName });
}

async function runDelete(cfg, ctx, pending) {
  await clearPending(cfg, ctx);
  const removed = await deleteCardsFromBoard(cfg, {
    boardId: pending.board_id,
    accessToken: ctx.accessToken,
    cardIds: pending.card_ids || [],
  });
  if (!removed.length) return { reply: say.nothingToDelete() };

  // The removed cards ARE the undo. They carry their own geometry and content,
  // so restoring them is an append of exactly what was there rather than a
  // reconstruction — which is why this is safe to offer at all.
  await scoutRpc(cfg, 'scout_record_move', {
    p_user_id: ctx.userId, p_platform: ctx.platform, p_thread_key: ctx.threadKey,
    p_payload: {
      kind: 'delete',
      board_id: pending.board_id,
      board_name: pending.board_name,
      cards: removed,
    },
  }).catch(() => {});

  return {
    reply: say.deleteDone({ count: removed.length, boardName: pending.board_name }),
    deleted: removed.length,
  };
}

async function undoDelete(cfg, ctx, lastMove) {
  const cards = lastMove?.cards || [];
  if (!cards.length) return { reply: say.undoNothing() };
  try {
    // appendCards, not buildCards: these cards already carry x/y from when they
    // were laid out, so they go back exactly where they were rather than being
    // re-packed somewhere else on the canvas.
    const result = await addCardsToBoard(cfg, {
      boardId: lastMove.board_id,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      accessToken: ctx.accessToken,
      appendCards: cards,
    });
    await scoutRpc(cfg, 'scout_record_move', {
      p_user_id: ctx.userId, p_platform: ctx.platform,
      p_thread_key: ctx.threadKey, p_payload: null,
    }).catch(() => {});
    return { reply: say.deleteUndone({ count: result.cards.length }) };
  } catch (e) {
    console.error('[scout] undo delete failed', e?.message);
    return { reply: say.undoNothing() };
  }
}

// ── Search ───────────────────────────────────────────────────────────────────
//
// Grouped by board, because the question behind "find the diner photos" is
// where they are, not which twenty card ids matched.
async function runSearch(cfg, ctx, query, { progress = null } = {}) {
  if (String(query || '').trim().length < 2) return say.searchTooShort();
  await progress?.step(STAGES.searching());

  const rows = await scoutRpc(cfg, 'scout_search', {
    p_user_id: ctx.userId, p_query: query, p_limit: 30,
  }).catch((e) => { console.error('[scout] search failed', e?.message); return []; });

  const hits = Array.isArray(rows) ? rows : [];
  if (!hits.length) return say.searchEmpty(query);

  const byBoard = new Map();
  for (const h of hits) {
    const cur = byBoard.get(h.board_id) || { board: h.board_name, count: 0, cardIds: [] };
    cur.count++;
    if (cur.cardIds.length < 12) cur.cardIds.push(h.card_id);
    byBoard.set(h.board_id, cur);
  }
  const groups = [...byBoard.values()].sort((a, b) => b.count - a.count);
  const top = [...byBoard.entries()].sort((a, b) => b[1].count - a[1].count)[0];

  return say.searchResults({
    query,
    groups,
    total: hits.length,
    // Deep-link into the board with the most hits, framing the cards that
    // matched — the same mechanism a fresh ingest confirmation uses.
    url: await boardUrl(cfg, {
      boardId: top[0], cardIds: top[1].cardIds, isShell: ctx.isShell, userId: ctx.userId,
    }),
  });
}

// ── Commands ─────────────────────────────────────────────────────────────────
// Handled before the model runs. They're unambiguous, and routing them through
// an LLM is both slower and a way to get them wrong.
async function runCommand(cfg, { command, arg }, ctx, opts = {}) {
  switch (command) {
    case 'help':
      return say.help({
        url: await boardUrl(cfg, {
          boardId: ctx.boardId, cardIds: [], isShell: ctx.isShell, userId: ctx.userId,
        }),
      });

    case 'bin':
      return await describeBin(cfg, ctx, {
        url: await boardUrl(cfg, {
          boardId: ctx.binBoardId, cardIds: [], isShell: ctx.isShell, userId: ctx.userId,
        }),
      });

    case 'board': {
      if (!arg) {
        // Back to the default: new cards collect in the Bin again.
        const { boardId } = await ensureScoutBin(cfg, ctx.userId, { binBoardId: ctx.binBoardId });
        await scoutRpc(cfg, 'scout_set_target_board', {
          p_user_id: ctx.userId, p_platform: ctx.platform,
          p_thread_key: ctx.threadKey, p_board_id: boardId,
        });
        return say.boardSwitched({ boardName: SCOUT_BIN_NAME, created: false });
      }
      const found = await findBoardByName(cfg, ctx.userId, arg);
      // Offer to make it rather than dead-ending. The offer is confirmed, so a
      // mistyped name costs one message and not a stray board.
      if (!found) return await offerBoardCreate(cfg, ctx, arg);
      const ok = await scoutRpc(cfg, 'scout_set_target_board', {
        p_user_id: ctx.userId, p_platform: ctx.platform,
        p_thread_key: ctx.threadKey, p_board_id: found.id,
      });
      return ok ? say.boardSwitched({ boardName: found.name, created: false })
                : say.boardNotFound(arg);
    }

    case 'find':
      return arg
        ? await runSearch(cfg, ctx, arg, { progress: opts?.progress })
        : say.searchTooShort();

    case 'delete':
      return await proposeDelete(cfg, ctx);

    case 'stop':
      await scoutRpc(cfg, 'scout_set_opt_out', {
        p_platform: ctx.platform, p_handle: ctx.handle, p_opt_out: true,
      }).catch(() => {});
      return say.stopped();

    // /start is BOTH the opt-in keyword and the conventional "what is this"
    // command, and someone who has never opted out and texts /start means the
    // second. Clearing a flag that is not set costs nothing and makes the one
    // word do the right thing in either state.
    case 'start':
      await scoutRpc(cfg, 'scout_set_opt_out', {
        p_platform: ctx.platform, p_handle: ctx.handle, p_opt_out: false,
      }).catch(() => {});
      return say.help({
        url: await boardUrl(cfg, {
          boardId: ctx.boardId, cardIds: [], isShell: ctx.isShell, userId: ctx.userId,
        }),
      });

    case 'code': {
      const rows = await scoutRpc(cfg, 'scout_claim_link_code', {
        p_code: arg, p_platform: ctx.platform, p_handle: ctx.handle, p_service: ctx.service,
      });
      const hit = (Array.isArray(rows) ? rows : [rows])[0];
      if (!hit?.user_id) return say.linkFailed();
      return await linkTo(cfg, ctx, hit);
    }

    case 'link':
      // An emailed OTP round-trip is a separate flow; the in-app code path is
      // the supported one and is one tap.
      return arg
        ? 'Open Settings → Scout in the app and tap Connect — it gives you a code to text me. That way I never have to email you.'
        : say.help({
        url: await boardUrl(cfg, {
          boardId: ctx.boardId, cardIds: [], isShell: ctx.isShell, userId: ctx.userId,
        }),
      });

    default:
      return null;
  }
}

// ── Questions ────────────────────────────────────────────────────────────────
//
// Answer from curated copy, never from the model's imagination. Keywords first
// (free and instant); a classifier call only when the wording is unusual, and
// even then it just picks an id — the words are ours.
async function answerQuestion(cfg, text, ctx) {
  let topic = matchTopic(text);

  if (!topic && (cfg.AI || (cfg.CF_ACCOUNT_ID && cfg.CF_AI_TOKEN))) {
    try {
      const out = await runWorkersAiChat(
        cfg, '@cf/meta/llama-3.1-8b-instruct', CLASSIFIER_SYSTEM,
        String(text).slice(0, 400), { max_tokens: 12, temperature: 0 },
      );
      const guess = String(out || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
      if (isValidTopic(guess)) topic = guess;
    } catch (_) { /* fall through to the menu */ }
  }

  return topic ? renderAnswer(topic, ctx) : fallbackAnswer(ctx);
}

// ── Main ─────────────────────────────────────────────────────────────────────
//
// `burst` is { platform, threadKey, handle, service, country, texts[],
// attachments[] }, attachments being { bytes, mimeType, name }.
//
// `progress` is optional; when present the caller gets narrated stages edited
// into a single message instead of silence followed by a wall of text.
export async function runBurst(cfg, r2, burst, progress = null) {
  // `trace` exists so the caller learns WHO this burst belonged to without every
  // one of the twenty-odd exits below having to remember to say so. The ingest
  // log is claimed before an identity is known — the message arrives long before
  // we resolve it — and scout_complete_ingest back-fills the user id so the
  // daily-ceiling count has something to count.
  const trace = {};
  const out = await runBurstBody(cfg, r2, burst, progress, trace);
  return { ...(out || {}), userId: out?.userId ?? trace.userId ?? null };
}

async function runBurstBody(cfg, r2, burst, progress, trace) {
  // Normalize ONCE, with the provider's country hint — a national-format number
  // from outside North America is indistinguishable from a US number without it.
  const handle = normalizeHandle(burst.handle, burst.country);
  const text0 = burst.texts.join('\n').trim();

  // 0. STOP, BEFORE ANY ACCOUNT EXISTS.
  //
  // Checked ahead of identity resolution on purpose: resolveOrCreateIdentity
  // MINTS an account on first contact, and minting one for somebody whose first
  // and only word is "unsubscribe" would be the opposite of what they asked for.
  // The opt-out is recorded against (platform, handle), which needs no account.
  //
  // A bare "stop" is left to the pending-move branch below — see
  // parseStopIntent's note on why context decides that one.
  if (!burst.attachments.length && parseStopIntent(text0) === 'stop') {
    await scoutRpc(cfg, 'scout_set_opt_out', {
      p_platform: burst.platform, p_handle: handle, p_opt_out: true,
    }).catch(() => {});
    return { reply: say.stopped(), optedOut: true };
  }

  const id = await resolveOrCreateIdentity(cfg, {
    platform: burst.platform,
    handle: burst.handle,
    threadKey: burst.threadKey,
    service: burst.service,
    country: burst.country,
  });

  trace.userId = id.userId;

  const ctx = {
    ...id,
    platform: burst.platform,
    threadKey: burst.threadKey,
    handle,
    service: burst.service,
    accessToken: null,
  };
  // Someone we texted from the /scout signup box has now texted back. Stamping
  // their user onto the signup row is what turns scout_signups from a list of
  // numbers into a funnel we can read: requested → sent → replied. Fire and
  // forget — this is bookkeeping, and it must never cost someone their photos.
  if (id.isNew && handle.startsWith('+')) {
    scoutRpc(cfg, 'scout_link_signup_user', { p_phone: handle, p_user_id: id.userId })
      .catch(() => {});
  }

  const getSession = sessionFor(cfg, id);
  const text = text0;

  // 0b. Already opted out.
  //
  // They told us to stop and have texted anyway. We answer — replying to
  // somebody's own message is never unsolicited, and silence here would look
  // like the bot is broken rather than respecting them — but we file nothing
  // until they say so explicitly. START is the only thing that resumes;
  // treating "here are twelve photos" as implied consent would make the opt-out
  // meaningless the first time somebody forgot they had used it.
  if (id.optedOutAt) {
    if (parseStopIntent(text) === 'start') {
      await scoutRpc(cfg, 'scout_set_opt_out', {
        p_platform: burst.platform, p_handle: handle, p_opt_out: false,
      }).catch(() => {});
      return {
        reply: say.resumed({
          url: await boardUrl(cfg, {
            boardId: id.boardId, cardIds: [], isShell: id.isShell, userId: id.userId,
          }),
        }),
      };
    }
    return { reply: say.stoppedAlready() };
  }

  // 1. Commands short-circuit everything.
  const cmd = parseCommand(text);
  if (cmd) {
    ctx.accessToken = await getSession();
    const reply = await runCommand(cfg, cmd, ctx, { r2, progress });
    if (reply) return { reply, isNew: id.isNew };
  }

  const urls = extractUrls(text);
  const leftover = textWithoutUrls(text);
  // `bare` means "a text-only message" — no attachment of any kind, no link.
  // Every conversational branch below requires it, for the reason the pending
  // branch spells out: content arriving with a word means the user has moved on
  // to sending things, and acting on the word instead would act on the wrong
  // cards. This used to be spelled `!images.length`, which stopped being the
  // same question the moment Scout accepted anything that is not a photo.
  const bare = !burst.attachments.length && !urls.length;

  // 2. A reply to a move we proposed. Checked before everything else: a bare
  //    "yes" means nothing on its own, and letting it fall through to intent
  //    extraction would have a model guess at it.
  //
  //    Only a text-only message can be a confirmation. Photos arriving with the
  //    "yes" mean the user has moved on to sending more, and acting on a stale
  //    proposal while new content lands is exactly how the wrong cards move.
  const pending = id.pendingMove;
  const pendingFresh = pending && id.pendingMoveAt
    && (Date.now() - Date.parse(id.pendingMoveAt)) < PENDING_TTL_MS;
  if (pending && bare) {
    // A pending proposal that is not a move — creating a board, or deleting a
    // batch — answers to its own word, so a stray "yes" cannot trigger it.
    if (pending.kind === 'create_board') {
      if (isCreateConfirmation(leftover)) {
        ctx.accessToken = await getSession();
        return { reply: await createAndTarget(cfg, ctx, pending.board_name), isNew: id.isNew };
      }
      if (parseConfirmation(leftover) === 'no') {
        await clearPending(cfg, ctx);
        return { reply: say.moveCancelled(), isNew: id.isNew };
      }
    }
    if (pending.kind === 'delete') {
      if (parseConfirmation(leftover) === 'yes') {
        ctx.accessToken = await getSession();
        return { ...(await runDelete(cfg, ctx, pending)), isNew: id.isNew };
      }
      if (parseConfirmation(leftover) === 'no') {
        await clearPending(cfg, ctx);
        return { reply: say.moveCancelled(), isNew: id.isNew };
      }
    }
    const answer = pending.kind ? null : parseConfirmation(leftover);
    if (answer === 'no') {
      await scoutRpc(cfg, 'scout_set_pending_move', {
        p_user_id: id.userId, p_platform: burst.platform,
        p_thread_key: burst.threadKey, p_payload: null,
      }).catch(() => {});
      return { reply: say.moveCancelled(), isNew: id.isNew };
    }
    if (answer === 'yes') {
      if (!pendingFresh) {
        await scoutRpc(cfg, 'scout_set_pending_move', {
          p_user_id: id.userId, p_platform: burst.platform,
          p_thread_key: burst.threadKey, p_payload: null,
        }).catch(() => {});
        return { reply: say.moveExpired(), isNew: id.isNew };
      }
      ctx.accessToken = await getSession();
      const done = await executeMove(cfg, r2, ctx, pending, { progress });
      if (done.reply) return { reply: done.reply, isNew: id.isNew };
      return {
        reply: say.moveDone({
          count: done.result.count,
          boardName: pending.board_name,
          url: await boardUrl(cfg, {
            boardId: pending.board_id,
            cardIds: done.result.moved.map((c) => c.id),
            isShell: id.isShell,
            userId: id.userId,
          }),
          leftover: pending.leftover || 0,
          leftoverLabel: pending.leftover_label,
        }),
        attachment: done.attachment,
        isNew: id.isNew,
        moved: done.result.count,
      };
    }
  }

  // 3. UNDO — valid for 24h after a move OR a delete, regardless of anything
  //    pending. Deleting shows an undo; that is the house convention everywhere
  //    else in this product and a text thread is no reason to drop it.
  if (bare && parseConfirmation(leftover) === 'undo') {
    const fresh = id.lastMove && id.lastMoveAt
      && (Date.now() - Date.parse(id.lastMoveAt)) < 24 * 60 * 60 * 1000;
    if (!fresh) return { reply: say.undoNothing(), isNew: id.isNew };
    ctx.accessToken = await getSession();
    if (id.lastMove.kind === 'delete') {
      return { ...(await undoDelete(cfg, ctx, id.lastMove)), isNew: id.isNew };
    }
    const back = await undoMove(cfg, ctx, id.lastMove);
    return { reply: back.reply, isNew: id.isNew };
  }

  // 3b. STOP, in its ambiguous bare form. Reached only once no move is pending,
  //     which is exactly the condition under which "stop" cannot mean "cancel
  //     that" — see parseStopIntent.
  if (bare && parseStopIntent(leftover, { movePending: !!pending }) === 'stop') {
    await scoutRpc(cfg, 'scout_set_opt_out', {
      p_platform: burst.platform, p_handle: handle, p_opt_out: true,
    }).catch(() => {});
    return { reply: say.stopped(), isNew: id.isNew, optedOut: true };
  }

  // 3c. FILING, ahead of the question gate.
  //
  // This ordering is the fix for a real defect: looksLikeQuestion fires on any
  // message opening with can/do/could/will, so "can you put these in Diner
  // Recce" — the ordinary polite form of the product's second most important
  // verb — was answered with the help menu and never filed anything.
  // parseFileIntent has always handled that phrasing (scoutIntent.js:96); it
  // was simply unreachable. An unmistakable instruction is an instruction, and
  // it is never a question, whatever word it opens with.
  const fileIntent = bare ? parseFileIntent(leftover) : null;

  // 3d. SEARCH. Also ahead of the question gate, and for the same reason —
  //     "where are the diner photos" opens with a question word and is a
  //     search, not a question about the product.
  const findIntent = !fileIntent && bare ? parseFindIntent(leftover) : null;
  if (findIntent) {
    ctx.accessToken = await getSession();
    return { reply: await runSearch(cfg, ctx, findIntent.query, { progress }), isNew: id.isNew };
  }

  // 3e. DELETE the batch just sent. Proposed, never immediate.
  if (!fileIntent && bare && isDeleteIntent(leftover)) {
    ctx.accessToken = await getSession();
    return { reply: await proposeDelete(cfg, ctx), isNew: id.isNew };
  }

  // 4. "What's in my Bin?" phrased in words rather than as /bin.
  if (bare && isBinQuery(leftover)) {
    ctx.accessToken = await getSession();
    return {
      reply: await describeBin(cfg, ctx, {
        url: await boardUrl(cfg, {
          boardId: id.binBoardId, cardIds: [], isShell: id.isShell, userId: id.userId,
        }),
      }),
      isNew: id.isNew,
    };
  }

  // 5. A question with nothing attached is a conversation, not an ingest.
  //    Checked BEFORE the capacity pre-flight so someone at their cap can still
  //    ask "how much is this?" and get an answer instead of the paywall — and
  //    AFTER the instruction gates above, so a politely-phrased instruction is
  //    obeyed rather than answered.
  if (!fileIntent && bare && leftover && looksLikeQuestion(leftover)) {
    const boardName = await boardNameFor(cfg, id.boardId);
    const url = await boardUrl(cfg, {
      boardId: id.boardId, cardIds: [], isShell: id.isShell, userId: id.userId,
    });
    // Their REAL cap, not the constant. Since 0229 the limit is per-account, so
    // an answer that states a flat number is wrong for most people — see the
    // pricing topic. One extra RPC, only on the question path, which is rare.
    const cap = await boardCapacity(cfg, id.boardId, id.userId)
      .catch(() => ({ cap: null, used: null }));
    const reply = await answerQuestion(cfg, leftover, {
      boardName, url, origin: cfg.APP_ORIGIN, cap: cap.cap, used: cap.used,
    });
    return { reply, isNew: id.isNew, answered: true };
  }

  // 6. Intent. Extracted BEFORE the capacity pre-flight because a bare "put
  //    these in Diner Recce" is an instruction, not content — running it through
  //    the ingest path would turn the user's own sentence into a sticky note on
  //    their canvas and consume a card doing it.
  //
  //    The deterministic parse from 3c wins outright when it fired: it is
  //    narrower than the model and free, and a model that disagrees with an
  //    unmistakable instruction is a model that is wrong.
  const intent = fileIntent
    ? { topic: null, action: 'file', board: fileIntent.board, note: null }
    : (burst.attachments.length || urls.length || leftover
      ? await extractIntent(cfg, { text, attachmentCount: burst.attachments.length })
      : { topic: null, action: 'ingest', board: null, note: null });

  const fileTo = intent.action === 'file' && intent.board
    ? await findBoardByName(cfg, id.userId, intent.board)
    : null;

  if (intent.action === 'file' && bare) {
    ctx.accessToken = await getSession();
    // An unrecognised name is now an OFFER rather than a dead end. Confirmed,
    // not created on sight: a typo silently minting "Dinner Recce" would put
    // half a scout's work in a board they find a week later.
    if (!fileTo) return { reply: await offerBoardCreate(cfg, ctx, intent.board || ''), isNew: id.isNew };
    const proposal = await prepareMove(cfg, r2, ctx, {
      boardId: fileTo.id, boardName: fileTo.name, everything: wantsEverything(text), progress,
    });
    return {
      reply: proposal.reply, attachment: proposal.attachment, isNew: id.isNew, proposed: true,
    };
  }

  // A brand-new user who said nothing yet gets oriented, not confirmed. This is
  // the /start experience, and it's the first link they'll ever tap — so it has
  // to sign them in, not show them a login screen.
  if (id.isNew && bare && !leftover) {
    const url = await boardUrl(cfg, {
      boardId: id.boardId, cardIds: [], isShell: id.isShell, userId: id.userId,
    });
    return { reply: say.welcome({ url }), isNew: true };
  }
  // NEVER SILENT. This used to `return { reply: null }`, and it was reachable —
  // any attachment that was not an image fell through every branch above and
  // arrived here, so texting a video or a voice memo produced no card, no error
  // and no reply at all. Silence is the one answer indistinguishable from being
  // ignored, and it is the answer this bot must never give.
  if (bare && !leftover) {
    return { reply: say.nothingUsable(), isNew: id.isNew };
  }

  await progress?.step(STAGES.received({
    images: burst.attachments.filter((a) => isImage(a.mimeType)).length,
    videos: burst.attachments.filter((a) => String(a.mimeType || '').startsWith('video/')).length,
    audio: burst.attachments.filter((a) => a.voice || String(a.mimeType || '').startsWith('audio/')).length,
    files: burst.attachments.filter((a) => !/^(image|video|audio)\//.test(String(a.mimeType || ''))).length,
    links: urls.length,
    notes: leftover ? 1 : 0,
  }));

  // 6b. The daily ceiling. Abuse protection, and the only bound a PAID account
  //     has at all — the card cap does not apply to one.
  if (await overDailyLimit(cfg, id.userId)) {
    return { reply: say.dailyLimit(), isNew: id.isNew, throttled: true };
  }

  // Ingest ALWAYS lands where the thread currently collects — the Bin, unless
  // /board pinned somewhere else. "put these in X" no longer redirects future
  // photos; it proposes MOVING what's collected, and that proposal is built
  // AFTER this write so photos arriving in the same message are part of it.
  const boardId = id.boardId;
  const boardName = await boardNameFor(cfg, boardId);

  // A user session is required for the live peer — PartyKit validates via
  // PostgREST as the user, so the service key won't do.
  ctx.accessToken = await getSession();
  ctx.boardId = boardId;
  ctx.boardName = boardName;

  const previews = [];
  for (const u of urls) previews.push({ url: u, preview: await linkPreview(cfg, u) });

  // "put these in Diner Recce" attached to a photo burst is an instruction, not
  // a caption — it must not become a sticky note next to the photos it filed.
  const noteText = intent.action === 'file' ? null : (leftover || intent.note || null);

  let out;
  try {
    out = await ingestBurst(cfg, r2, ctx, {
      attachments: burst.attachments,
      urls,
      previews,
      noteText,
      topic: intent.topic,
      progress,
    });
  } catch (e) {
    if (e?.isCapHit) {
      return {
        reply: say.capReached({ cap: '', billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: 0 }),
        isNew: id.isNew, capped: true,
      };
    }
    console.error('[scout] ingest failed', e?.stack || e?.message);
    return { reply: say.ingestFailed({ retained: false }), isNew: id.isNew };
  }

  const { cap } = out;
  if (out.capped) {
    return {
      reply: say.capReached({ cap: cap.cap, billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: 0 }),
      isNew: id.isNew,
      capped: true,
    };
  }

  // Nothing survived — every file refused, every upload failed. Say so rather
  // than confirming an empty batch.
  if (!out.cards.length) {
    const messages = [];
    if (out.blocked.length) {
      messages.push(say.needsPaidPlan({
        count: out.blocked.length, billingUrl: `${cfg.APP_ORIGIN}/pricing`,
      }));
    }
    if (out.oversize.length) messages.push(say.tooLarge({ count: out.oversize.length }));
    if (!messages.length) messages.push(say.ingestFailed({ retained: false }));
    return { reply: messages.join('\n\n'), isNew: id.isNew };
  }

  // 8. The message also said where things go — propose the move now that this
  //    burst's photos are in the Bin and therefore part of the offer.
  if (fileTo) {
    const proposal = await prepareMove(cfg, r2, ctx, {
      boardId: fileTo.id, boardName: fileTo.name, everything: wantsEverything(text), progress,
    });
    return {
      reply: proposal.reply, attachment: proposal.attachment, isNew: id.isNew, proposed: true,
    };
  }

  // 9. One reply.
  const used = cap.used + out.cards.length;
  const messages = [];

  if (intent.action === 'file' && intent.board && !fileTo) {
    messages.push(say.boardNotFound(intent.board));
  }

  messages.push(say.ingestConfirmation({
    counts: out.counts,
    boardName,
    url: await boardUrl(cfg, {
      boardId,
      cardIds: out.cards.filter((c) => !c.sectionHeader).map((c) => c.id),
      isShell: id.isShell,
      userId: id.userId,
    }),
    used,
    cap: cap.cap,
  }));

  // Name what we could NOT take, always. A count that quietly omits the three
  // files we refused is the reply that gets read as "it worked" and discovered
  // as a gap a week later.
  if (out.blocked.length) {
    messages.push(say.needsPaidPlan({
      count: out.blocked.length, billingUrl: `${cfg.APP_ORIGIN}/pricing`,
    }));
  }
  if (out.oversize.length) messages.push(say.tooLarge({ count: out.oversize.length }));

  if (out.truncated) {
    messages.push(say.capReached({
      cap: cap.cap, billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: out.cards.length,
    }));
  } else if (Number.isFinite(cap.cap) && !id.capWarnedAt && used / cap.cap >= 0.75) {
    messages.push(say.capWarning({ used, cap: cap.cap }));
    await scoutRpc(cfg, 'scout_mark_cap_warned', { p_user_id: id.userId }).catch(() => {});
  }

  return { reply: messages.join('\n\n'), isNew: id.isNew, live: out.live };
}
