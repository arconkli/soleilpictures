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
  resolveOrCreateIdentity, ensureScoutBin, normalizeHandle, resolveEmail, SCOUT_BIN_NAME,
} from '../../boards/src/lib/scoutIdentity.js';
import {
  parseConfirmation, wantsEverything, isBinQuery,
  prepareMove, executeMove, undoMove, describeBin, PENDING_TTL_MS,
} from './filing.js';
import { extractIntent, parseCommand } from '../../boards/src/lib/scoutIntent.js';
import {
  composeBatch, extractUrls, textWithoutUrls, arrangeExisting,
} from '../../boards/src/lib/scoutCards.js';
import {
  addCardsToBoard, boardCapacity, moveCardsBetweenBoards, readBoardCards,
} from '../../boards/src/lib/scoutBoard.js';
import { scoutRpc, scoutSelect, scoutSession } from '../../boards/src/lib/scoutDb.js';
import { mintScoutSessionToken } from '../../boards/src/worker-scout.js';
import { uploadImage, isImage } from './media.js';
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

// ── Commands ─────────────────────────────────────────────────────────────────
// Handled before the model runs. They're unambiguous, and routing them through
// an LLM is both slower and a way to get them wrong.
async function runCommand(cfg, { command, arg }, ctx) {
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
      if (!found) return say.boardNotFound(arg);
      const ok = await scoutRpc(cfg, 'scout_set_target_board', {
        p_user_id: ctx.userId, p_platform: ctx.platform,
        p_thread_key: ctx.threadKey, p_board_id: found.id,
      });
      return ok ? say.boardSwitched({ boardName: found.name, created: false })
                : say.boardNotFound(arg);
    }

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
  // Normalize ONCE, with the provider's country hint — a national-format number
  // from outside North America is indistinguishable from a US number without it.
  const handle = normalizeHandle(burst.handle, burst.country);
  const id = await resolveOrCreateIdentity(cfg, {
    platform: burst.platform,
    handle: burst.handle,
    threadKey: burst.threadKey,
    service: burst.service,
    country: burst.country,
  });

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
  const text = burst.texts.join('\n').trim();

  // 1. Commands short-circuit everything.
  const cmd = parseCommand(text);
  if (cmd) {
    ctx.accessToken = await getSession();
    const reply = await runCommand(cfg, cmd, ctx);
    if (reply) return { reply, isNew: id.isNew };
  }

  const images = burst.attachments.filter((a) => isImage(a.mimeType));
  const urls = extractUrls(text);
  const leftover = textWithoutUrls(text);

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
  if (pending && !images.length && !urls.length) {
    const answer = parseConfirmation(leftover);
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

  // 3. UNDO — valid for 24h after a move, regardless of anything pending.
  if (!images.length && !urls.length && parseConfirmation(leftover) === 'undo') {
    const fresh = id.lastMove && id.lastMoveAt
      && (Date.now() - Date.parse(id.lastMoveAt)) < 24 * 60 * 60 * 1000;
    if (!fresh) return { reply: say.undoNothing(), isNew: id.isNew };
    ctx.accessToken = await getSession();
    const back = await undoMove(cfg, ctx, id.lastMove);
    return { reply: back.reply, isNew: id.isNew };
  }

  // 4. "What's in my Bin?" phrased in words rather than as /bin.
  if (!images.length && !urls.length && isBinQuery(leftover)) {
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
  //    ask "how much is this?" and get an answer instead of the paywall.
  if (!images.length && !urls.length && leftover && looksLikeQuestion(leftover)) {
    const boardName = await boardNameFor(cfg, id.boardId);
    const url = await boardUrl(cfg, {
      boardId: id.boardId, cardIds: [], isShell: id.isShell, userId: id.userId,
    });
    const reply = await answerQuestion(cfg, leftover, {
      boardName, url, origin: cfg.APP_ORIGIN,
    });
    return { reply, isNew: id.isNew, answered: true };
  }

  await progress?.step(STAGES.received({
    images: images.length, links: urls.length, notes: leftover ? 1 : 0,
  }));

  // 6. Intent. Extracted BEFORE the capacity pre-flight because a bare "put
  //    these in Diner Recce" is an instruction, not content — running it through
  //    the ingest path would turn the user's own sentence into a sticky note on
  //    their canvas and consume a card doing it.
  const intent = images.length || urls.length || leftover
    ? await extractIntent(cfg, { text, attachmentCount: images.length })
    : { topic: null, action: 'ingest', board: null, note: null };

  const fileTo = intent.action === 'file' && intent.board
    ? await findBoardByName(cfg, id.userId, intent.board)
    : null;

  if (intent.action === 'file' && !images.length && !urls.length) {
    if (!fileTo) return { reply: say.boardNotFound(intent.board || ''), isNew: id.isNew };
    ctx.accessToken = await getSession();
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
  if (id.isNew && !images.length && !urls.length && !leftover) {
    const url = await boardUrl(cfg, {
      boardId: id.boardId, cardIds: [], isShell: id.isShell, userId: id.userId,
    });
    return { reply: say.welcome({ url }), isNew: true };
  }
  if (!images.length && !urls.length && !leftover) return { reply: null, isNew: id.isNew };

  // 2. Capacity PRE-FLIGHT — before a single byte reaches R2.
  const cap = await boardCapacity(cfg, id.boardId, id.userId);
  const wanted = images.length + urls.length
    + (leftover && intent.action !== 'file' ? 1 : 0);
  if (cap.remaining <= 0) {
    return {
      reply: say.capReached({ cap: cap.cap, billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: 0 }),
      isNew: id.isNew,
      capped: true,
    };
  }

  // Partial acceptance: take what fits rather than rejecting the whole burst.
  // Someone texting 40 photos with 12 slots left should keep 12.
  const budget = Math.min(wanted, cap.remaining);
  const truncated = budget < wanted;
  const takeImages = images.slice(0, budget);
  const takeUrls = urls.slice(0, Math.max(0, budget - takeImages.length));
  // "put these in Diner Recce" attached to a photo burst is an instruction, not
  // a caption — it must not become a sticky note next to the photos it filed.
  const noteText = intent.action === 'file' ? null : leftover;
  const takeNote = (budget - takeImages.length - takeUrls.length) > 0 ? noteText : null;

  // Ingest ALWAYS lands where the thread currently collects — the Bin, unless
  // /board pinned somewhere else. "put these in X" no longer redirects future
  // photos; it proposes MOVING what's collected, and that proposal is built
  // AFTER this write so photos arriving in the same message are part of it.
  const boardId = id.boardId;
  const boardName = await boardNameFor(cfg, boardId);

  // 4. Media → R2. Card ids are minted here so the images row can point at the
  //    exact card that will reference it.
  const uploaded = [];
  for (const [i, att] of takeImages.entries()) {
    // Narrate per photo — on a slow connection this is the difference between
    // "it's working" and "it's broken".
    await progress?.step(STAGES.uploading(i + 1, takeImages.length));
    const cardId = `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    try {
      const up = await uploadImage(cfg, r2, {
        bytes: att.bytes, mimeType: att.mimeType, name: att.name,
        workspaceId: id.workspaceId, boardId, cardId, userId: id.userId,
      });
      uploaded.push({ ...up, cardId, alt: intent.topic || null });
    } catch (e) {
      console.error('[scout] upload failed', e?.message);
    }
  }

  const previews = [];
  for (const u of takeUrls) previews.push({ url: u, preview: await linkPreview(cfg, u) });

  // 7. Triple write. A user session is required for the live peer — PartyKit
  //    validates via PostgREST as the user, so the service key won't do.
  const accessToken = await getSession();
  ctx.accessToken = accessToken;

  await progress?.step(STAGES.arranging(boardName));

  let result;
  try {
    result = await addCardsToBoard(cfg, {
      boardId,
      workspaceId: id.workspaceId,
      userId: id.userId,
      accessToken,
      buildCards: (existing) => composeBatch({
        existingCards: existing,
        images: uploaded.map((u) => ({
          key: u.key, width: u.width, height: u.height, alt: u.alt, lab: u.lab,
        })),
        urls: previews,
        noteText: takeNote || (intent.note ?? null),
        topic: intent.topic,
      }),
    });
  } catch (e) {
    if (e?.isCapHit) {
      return {
        reply: say.capReached({ cap: cap.cap, billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: 0 }),
        isNew: id.isNew, capped: true,
      };
    }
    console.error('[scout] board write failed', e?.message);
    return { reply: say.ingestFailed({ retained: uploaded.length > 0 }), isNew: id.isNew };
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
  const counts = {
    images: uploaded.length,
    links: previews.length,
    notes: (takeNote || intent.note) ? 1 : 0,
  };
  const used = cap.used + result.cards.length;
  const messages = [];

  if (intent.action === 'file' && intent.board) {
    messages.push(say.boardNotFound(intent.board));
  }

  messages.push(say.ingestConfirmation({
    counts,
    boardName,
    url: await boardUrl(cfg, {
      boardId,
      cardIds: result.cards.filter((c) => !c.sectionHeader).map((c) => c.id),
      isShell: id.isShell,
      userId: id.userId,
    }),
    used,
    cap: cap.cap,
  }));

  if (truncated) {
    messages.push(say.capReached({
      cap: cap.cap, billingUrl: `${cfg.APP_ORIGIN}/pricing`, kept: result.cards.length,
    }));
  } else if (Number.isFinite(cap.cap) && !id.capWarnedAt && used / cap.cap >= 0.75) {
    messages.push(say.capWarning({ used, cap: cap.cap }));
    await scoutRpc(cfg, 'scout_mark_cap_warned', { p_user_id: id.userId }).catch(() => {});
  }

  return { reply: messages.join('\n\n'), isNew: id.isNew, live: result.live };
}
