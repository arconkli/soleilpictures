// Scout — turning a burst's attachments into cards on a board.
//
// Split out of pipeline.js, which had become a router and an uploader at once.
// pipeline.js decides WHAT a message means; this decides what happens to the
// bytes once it means "ingest". The two halves have genuinely different reasons
// to change — one follows the conversation, the other follows the media stack.
//
// The ordering here is load-bearing and is the same one pipeline.js has always
// documented:
//
//   1. classify        — the app's own router decides what each file becomes
//   2. capacity + gate  — BEFORE a byte reaches R2, so nothing is spent on a
//                         card that will be refused
//   3. upload           — every images row carries board refs from birth
//   4. compose + lay out — deterministic; the model only ever read intent
//   5. triple write     — card_index first, because that is where the cap lives

import { composeBatch } from '../../boards/src/lib/scoutCards.js';
import { addCardsToBoard, boardCapacity } from '../../boards/src/lib/scoutBoard.js';
import { scoutRpc } from '../../boards/src/lib/scoutDb.js';
import { classifyAttachment, uploadObject } from './media.js';
import { transcribeVoice, topicFromTranscript } from './transcribe.js';
import { STAGES } from './progress.js';

// A single attachment we will not even attempt. The provider hands us the whole
// file in memory and this process has 512 MB; a clip larger than this would
// take the machine down and, with it, everyone else's burst.
const MAX_ATTACHMENT_BYTES = Number(process.env.SCOUT_MAX_ATTACHMENT_BYTES || 300 * 1024 * 1024);

/**
 * Decide what each attachment becomes, and which ones we must refuse.
 *
 * `paid` comes from the capacity pre-flight — scout_board_capacity is
 * owner-keyed, so `!capped` is exactly the app's `canAttemptFiles` ("you own
 * this workspace and you are on a paid plan"). Passing it through means Scout
 * and the canvas apply the same paywall to the same file.
 *
 * Returns { accepted, blocked, oversize } — blocked being the ones that need a
 * Creator plan, which the caller turns into a pitch rather than a silent drop.
 */
export function planAttachments(attachments = [], { paid = false } = {}) {
  const accepted = [];
  const blocked = [];
  const oversize = [];

  for (const att of attachments) {
    const bytes = att?.bytes?.length ?? 0;
    if (bytes > MAX_ATTACHMENT_BYTES) { oversize.push(att); continue; }
    const route = classifyAttachment(att, { canAttemptFiles: paid });
    // 'blocked' is fileIngest.js's own answer for "this needs the paid plan".
    if (route.route === 'blocked') { blocked.push(att); continue; }
    accepted.push({ att, ...route });
  }

  return { accepted, blocked, oversize };
}

// Upload one planned attachment and return what composeBatch needs.
//
// A voice memo takes a detour through transcription first, because the
// transcript is what makes it findable — see transcribe.js. Everything else is
// a straight upload.
async function ingestOne(cfg, r2, plan, ctx, { index, total, progress }) {
  const { att, kind } = plan;
  const cardId = `${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  await progress?.step(STAGES.uploading(index + 1, total, kind));

  const up = await uploadObject(cfg, r2, {
    bytes: att.bytes,
    mimeType: att.mimeType,
    name: att.name,
    kind,
    workspaceId: ctx.workspaceId,
    boardId: ctx.boardId,
    cardId,
    userId: ctx.userId,
    onStage: (stage) => progress?.step(
      stage === 'transcoding' ? STAGES.converting(index + 1, total) : null,
    ),
  });
  up.cardId = cardId;

  // Duration from the provider beats duration from ffprobe: the provider read
  // it off the message, ffprobe read it off a container that may lie.
  if (att.duration && !up.duration) up.duration = att.duration;

  if (kind === 'audio' && att.voice) {
    await progress?.step(STAGES.transcribing());
    const transcript = await transcribeVoice(cfg, att);
    return { up, transcript, voice: true };
  }
  return { up };
}

/**
 * The whole ingest half of a burst.
 *
 * `ctx` carries { userId, workspaceId, boardId, accessToken }. Returns
 * { cards, counts, blocked, oversize, truncated, capped, topic, live } — the
 * caller owns every word said about it.
 */
export async function ingestBurst(cfg, r2, ctx, {
  attachments = [], urls = [], noteText = null, topic = null, previews = [], progress = null,
}) {
  // 2. Capacity PRE-FLIGHT. Also tells us whether the owner is paid, which is
  //    what decides the file-type gate below — so it has to come first.
  const cap = await boardCapacity(cfg, ctx.boardId, ctx.userId);
  const paid = !cap.capped;

  const { accepted, blocked, oversize } = planAttachments(attachments, { paid });

  if (cap.remaining <= 0) {
    return { cards: [], counts: {}, capped: true, cap, blocked, oversize };
  }

  // Partial acceptance: take what fits rather than refusing the whole burst.
  // Someone texting 40 photos with 12 slots left should keep 12.
  const wanted = accepted.length + urls.length + (noteText ? 1 : 0);
  const budget = Math.min(wanted, cap.remaining);
  const truncated = budget < wanted;

  const takeMedia = accepted.slice(0, budget);
  const takeUrls = urls.slice(0, Math.max(0, budget - takeMedia.length));
  const takeNote = (budget - takeMedia.length - takeUrls.length) > 0 ? noteText : null;

  // 3. Bytes → R2. Sequential rather than parallel on purpose: this machine has
  //    512 MB and sharp/ffmpeg each hold a decoded frame, so twelve concurrent
  //    photos is how it gets OOM-killed mid-burst.
  const images = [];
  const media = [];
  let transcript = null;
  for (const [i, plan] of takeMedia.entries()) {
    try {
      const out = await ingestOne(cfg, r2, plan, ctx, {
        index: i, total: takeMedia.length, progress,
      });
      if (out.up.kind === 'image') {
        images.push({ ...out.up, alt: topic || null });
      } else {
        media.push({ up: out.up, title: out.transcript ? null : (plan.att.name || null),
                     transcript: out.transcript || null });
        // The first voice memo names the batch when nothing else did. A spoken
        // note is usually ABOUT the photos it arrives with, which makes it the
        // best label available.
        if (out.transcript && !transcript) transcript = out.transcript;
      }
    } catch (e) {
      // One unreadable file must not cost the other eleven. The count in the
      // reply comes from what actually landed, so the user is never told we
      // kept something we did not.
      console.error('[scout] attachment failed', plan.kind, e?.message);
    }
  }

  const effectiveTopic = topic || (transcript ? topicFromTranscript(transcript) : null);

  // 4 + 5. Compose and triple-write.
  await progress?.step(STAGES.arranging(ctx.boardName));

  const result = await addCardsToBoard(cfg, {
    boardId: ctx.boardId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    accessToken: ctx.accessToken,
    buildCards: (existing) => composeBatch({
      existingCards: existing,
      images: images.map((u) => ({
        key: u.key, width: u.width, height: u.height, alt: u.alt,
        lab: u.lab, shotAt: u.shotAt, geo: u.geo,
      })),
      media,
      urls: previews,
      noteText: takeNote,
      topic: effectiveTopic,
    }),
  });

  return {
    cards: result.cards,
    live: result.live,
    cap,
    capped: false,
    truncated,
    blocked,
    oversize,
    topic: effectiveTopic,
    counts: {
      images: images.length,
      videos: media.filter((m) => m.up.kind === 'video').length,
      audio: media.filter((m) => m.up.kind === 'audio').length,
      files: media.filter((m) => m.up.kind === 'pdf' || m.up.kind === 'file').length,
      links: previews.length,
      notes: takeNote ? 1 : 0,
    },
  };
}

/**
 * The daily ceiling. Abuse protection, deliberately separate from the card cap:
 * the card cap bounds a FREE account and does not bound a paid one at all, so
 * without this a texting endpoint has no upper bound on what it will store.
 *
 * Fails OPEN. If the count cannot be read, we ingest — a database blip must
 * never look to the user like being throttled.
 */
export async function overDailyLimit(cfg, userId) {
  if (!Number.isFinite(cfg.DAILY_INGEST_MAX) || cfg.DAILY_INGEST_MAX <= 0) return false;
  const n = await scoutRpc(cfg, 'scout_daily_ingest_count', { p_user_id: userId })
    .catch(() => 0);
  return Number(n) > cfg.DAILY_INGEST_MAX;
}
