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
  resolveOrCreateIdentity, ensureScoutInbox, normalizeHandle,
} from '../../boards/src/lib/scoutIdentity.js';
import { extractIntent, parseCommand } from '../../boards/src/lib/scoutIntent.js';
import { composeBatch, extractUrls, textWithoutUrls } from '../../boards/src/lib/scoutCards.js';
import { addCardsToBoard, boardCapacity } from '../../boards/src/lib/scoutBoard.js';
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
  return rows?.[0]?.name || 'Scout Inbox';
}

async function findBoardByName(cfg, workspaceId, name) {
  const rows = await scoutSelect(
    cfg, 'boards',
    `workspace_id=eq.${workspaceId}&deleted_at=is.null&select=id,name&limit=200`,
  ).catch(() => []);
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  // Exact, then prefix, then substring — "diner" should find "Diner Recce"
  // without a fuzzy matcher that would also find "Dinner Party".
  return rows.find((b) => b.name.toLowerCase() === want)
    || rows.find((b) => b.name.toLowerCase().startsWith(want))
    || rows.find((b) => b.name.toLowerCase().includes(want))
    || null;
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

    case 'board': {
      if (!arg) {
        const { boardId } = await ensureScoutInbox(cfg, ctx.userId);
        await scoutRpc(cfg, 'scout_set_target_board', {
          p_user_id: ctx.userId, p_platform: ctx.platform,
          p_thread_key: ctx.threadKey, p_board_id: boardId,
        });
        return say.boardSwitched({ boardName: 'Scout Inbox', created: false });
      }
      const found = await findBoardByName(cfg, ctx.workspaceId, arg);
      if (!found) return say.boardNotFound(arg);
      const ok = await scoutRpc(cfg, 'scout_set_target_board', {
        p_user_id: ctx.userId, p_platform: ctx.platform,
        p_thread_key: ctx.threadKey, p_board_id: found.id,
      });
      return ok ? say.boardSwitched({ boardName: found.name, created: false })
                : say.boardNotFound(arg);
    }

    case 'code': {
      const userId = await scoutRpc(cfg, 'scout_claim_link_code', {
        p_code: arg, p_platform: ctx.platform, p_handle: ctx.handle, p_service: ctx.service,
      });
      if (!userId) return say.linkFailed();
      return say.linked({ email: 'your account' });
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
  };
  const text = burst.texts.join('\n').trim();

  // 1. Commands short-circuit everything.
  const cmd = parseCommand(text);
  if (cmd) {
    const reply = await runCommand(cfg, cmd, ctx);
    if (reply) return { reply, isNew: id.isNew };
  }

  const images = burst.attachments.filter((a) => isImage(a.mimeType));
  const urls = extractUrls(text);
  const leftover = textWithoutUrls(text);

  // 2. A question with nothing attached is a conversation, not an ingest.
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
  const cap = await boardCapacity(cfg, id.boardId);
  const wanted = images.length + urls.length + (leftover ? 1 : 0);
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
  const takeNote = (budget - takeImages.length - takeUrls.length) > 0 ? leftover : null;

  // 3. Intent — deterministic fallback on any failure.
  const intent = await extractIntent(cfg, { text, attachmentCount: takeImages.length });

  // "put these in X" retargets the thread before we write.
  let boardId = id.boardId;
  let boardName = 'Scout Inbox';
  if (intent.action === 'file' && intent.board) {
    const found = await findBoardByName(cfg, id.workspaceId, intent.board);
    if (found) {
      await scoutRpc(cfg, 'scout_set_target_board', {
        p_user_id: id.userId, p_platform: burst.platform,
        p_thread_key: burst.threadKey, p_board_id: found.id,
      });
      boardId = found.id;
      boardName = found.name;
    }
  } else {
    boardName = await boardNameFor(cfg, boardId);
  }

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

  // 5. Triple write. A user session is required for the live peer — PartyKit
  //    validates via PostgREST as the user, so the service key won't do.
  let accessToken = null;
  try {
    accessToken = await scoutSession(cfg, id.userId, id.email);
  } catch (e) {
    console.warn('[scout] no user session, cards will appear on next load:', e?.message);
  }

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
        images: uploaded.map((u) => ({ key: u.key, width: u.width, height: u.height, alt: u.alt })),
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

  // 6. One reply.
  const counts = {
    images: uploaded.length,
    links: previews.length,
    notes: (takeNote || intent.note) ? 1 : 0,
  };
  const used = cap.used + result.cards.length;
  const messages = [];

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
