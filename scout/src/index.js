// Soleil Scout — entry point.
//
// Consumes Photon's async-iterator message stream, batches each conversation's
// burst, and runs the ingest pipeline. This is a long-lived process because
// @spectrum-ts/imessage speaks gRPC and shells out — it cannot run in a Worker.
//
// Deliberately quiet in normal operation: one log line per burst, errors only
// otherwise. The interesting telemetry lands in analytics_events via the
// SECURITY DEFINER RPCs, which is where the rest of the product looks.

import { Spectrum, attachment } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { loadConfig } from './config.js';
import { makeUploader } from './media.js';
import { makeBatcher } from './batcher.js';
import { makeProgress } from './progress.js';
import { runBurst } from './pipeline.js';
import { startInviteLoop } from './invites.js';
import { scoutRpc } from '../../boards/src/lib/scoutDb.js';

const cfg = loadConfig();
const r2 = makeUploader(cfg);

// Photon reports which transport a handle is actually on. We record it so the
// pipeline can set expectations about media fidelity — iMessage delivers
// originals, SMS/MMS delivers whatever the carrier left behind.
function senderHandle(message, space) {
  return message?.sender?.address
    || message?.sender?.phone
    || message?.sender?.id
    || space?.id
    || '';
}

// Turn one inbound message's content into something the burst can carry.
//
// THIS FUNCTION EXISTS BECAUSE OF A SILENT FAILURE. It used to be an inline
// if/else if/else chain whose final branch was a bare `continue` for "reactions,
// read receipts, membership events". That comment was true about what it MEANT
// to drop and wrong about what it ACTUALLY dropped: the provider ships a
// first-class `voice` content type, so a voice memo — the single most natural
// thing to send from a location with your hands full — matched neither `text`
// nor `attachment` and was discarded before anything downstream could see it.
// No card, no error, no reply. Total silence, which is the worst answer a bot
// can give, because the user cannot tell it from being ignored.
//
// So the drop list is now EXPLICIT and everything else is loud. A content type
// we have never seen returns 'unknown', which the caller logs with its type —
// the next provider feature shows up in the logs instead of vanishing.
//
// `voice` carries a duration the attachment type does not, and it is a stronger
// signal than a mime sniff: a .m4a sent as a file is a music track, a .m4a sent
// as a voice message is somebody talking. Only the latter is worth transcribing.
async function readContent(content) {
  const type = content?.type;

  if (type === 'text') return { kind: 'text', text: content.text };

  if (type === 'attachment' || type === 'voice') {
    const bytes = await content.read();
    return {
      kind: 'media',
      media: {
        bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        mimeType: content.mimeType,
        name: content.name,
        size: content.size ?? null,
        duration: content.duration ?? null,
        voice: type === 'voice',
      },
    };
  }

  // Deliberately silent. These are things that happen AROUND a conversation
  // rather than things somebody sent us, and replying to them is how a bot
  // becomes noise: a thumbs-up on our own confirmation is not an instruction.
  if (type === 'reaction' || type === 'read' || type === 'typing'
      || type === 'addMember' || type === 'removeMember' || type === 'leaveSpace'
      || type === 'rename' || type === 'avatar' || type === 'unsend') {
    return { kind: 'ignored' };
  }

  return { kind: 'unknown', type };
}

// Attaching an image is best-effort, exactly like editing a message is: the
// provider may refuse or the channel may not carry attachments. Neither is worth
// losing the reply over — the text that follows always states the count and the
// board, so a thread with no picture is degraded but never wrong.
//
// The helper is `attachment`, and its input type is `string | Buffer | URL` —
// NOT a Uint8Array. This was written as `image(bytes, …)`; there is no `image`
// export, so the module failed to load and the process died at startup before it
// ever read a message. Buffer.from() wraps the sheet's bytes without copying.
async function sendImage(space, bytes) {
  try {
    await space.send(attachment(Buffer.from(bytes), {
      mimeType: 'image/jpeg', name: 'scout.jpg',
    }));
    return true;
  } catch (e) {
    console.error('[scout] image send failed', e?.message);
    return false;
  }
}

const batcher = makeBatcher({
  waitMs: cfg.BURST_MS,
  onFlush: async (burst) => {
    const t0 = Date.now();
    const { space } = burst;
    // One message, edited in place through each stage, ending as the
    // confirmation — so the thread has a single bubble, not a running
    // commentary, and never silence while photos upload.
    const progress = makeProgress(space);
    try {
      const out = await space.responding(async () => runBurst(cfg, r2, burst, progress));
      // The picture goes FIRST. A move confirmation is answered by looking at
      // the photos, not by reading the count, so the image has to be above the
      // question in the thread rather than below it.
      if (out?.attachment) await sendImage(space, out.attachment);
      if (out?.reply) await progress.done(out.reply);

      // The burst landed — release the ingest claims. Until this runs those
      // message ids are stale-recoverable, so a crash anywhere above means the
      // provider's redelivery is honoured instead of dropped as a duplicate.
      // AFTER the reply, deliberately: an exception between here and there
      // should leave the burst re-deliverable, and the worst case of marking
      // late is doing the same safe work twice.
      if (burst.messageIds?.length) {
        await scoutRpc(cfg, 'scout_complete_ingest', {
          p_platform: burst.platform,
          p_message_ids: burst.messageIds,
          p_user_id: out?.userId || null,
        }).catch((e) => console.error('[scout] complete_ingest failed', e?.message));
      }
      console.log('[scout] burst', {
        platform: burst.platform,
        images: burst.attachments.length,
        texts: burst.texts.length,
        live: out?.live ?? null,
        capped: out?.capped ?? false,
        answered: out?.answered ?? false,
        proposed: out?.proposed ?? false,
        moved: out?.moved ?? 0,
        sheet: out?.attachment ? out.attachment.length : 0,
        edits: progress.usedEdits,
        ms: Date.now() - t0,
      });
    } catch (e) {
      console.error('[scout] burst failed', e?.stack || e?.message || e);
      try {
        await space.send('Something went wrong on my end and that batch didn\'t land. Worth sending again.');
      } catch (_) { /* the channel itself is down; nothing more to do */ }
    }
  },
});

async function main() {
  const app = await Spectrum({
    projectId: cfg.SPECTRUM_PROJECT_ID,
    projectSecret: cfg.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
  });

  console.log('[scout] listening', {
    partykit: cfg.PARTYKIT_HOST,
    burstMs: cfg.BURST_MS,
    ai: cfg.CF_AI_TOKEN ? 'workers-ai' : 'deterministic-only',
    invites: cfg.INVITES_ENABLED ? 'draining' : 'DISABLED',
  });

  // Website signups (/scout's phone box) queue in scout_signups; this drains
  // them slowly. It shares this process rather than getting its own service
  // because it needs the same authenticated Photon connection, and because
  // pacing sends against the SAME line the ingest stream uses is the only way
  // the daily new-conversation budget means anything.
  //
  // Gated, because the supported way to test Scout is to run this file against
  // the live line — and inbound handling is safe to exercise that way while
  // outbound cold-starts to strangers are not. See config.js:INVITES_ENABLED.
  const stopInvites = cfg.INVITES_ENABLED ? startInviteLoop(cfg, app) : () => {};

  // A row that says when this process was last definitely alive.
  //
  // The `for await` below turns the stream ENDING into a fatal error, which the
  // supervisor restarts. It can do nothing about the stream that stays OPEN and
  // stops delivering — the process looks healthy, the logs stay quiet, and every
  // photo anyone sends is silently ignored. That is the failure this file's own
  // closing comment calls the worst possible one, and it was the one still
  // uncovered. Nothing pages on this; the admin Scout tab reads it, and a human
  // can see in one glance whether the bot is there.
  const beat = () => scoutRpc(cfg, 'scout_heartbeat', {
    p_version: process.env.FLY_MACHINE_VERSION || 'local',
    p_detail: { invites: cfg.INVITES_ENABLED, ai: !!cfg.CF_AI_TOKEN, pending: batcher.size },
  }).catch(() => {});
  beat();
  const heartbeat = setInterval(beat, 60_000);
  heartbeat.unref?.();

  const shutdown = async (sig) => {
    console.log(`[scout] ${sig} — draining ${batcher.size} pending burst(s)`);
    stopInvites();
    clearInterval(heartbeat);
    await batcher.drain();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  for await (const [space, message] of app.messages) {
    try {
      const platform = String(message.platform || 'imessage').toLowerCase();
      const handle = senderHandle(message, space);
      if (!handle) continue;

      // Idempotency BEFORE any work — providers retry, and a retry that gets
      // past here double-posts someone's photos onto their canvas.
      const fresh = await scoutRpc(cfg, 'scout_log_ingest', {
        p_platform: platform, p_message_id: String(message.id),
      }).catch(() => true);   // log unavailable → prefer delivering over dropping
      if (fresh === false) continue;

      const key = `${platform}:${space.id}`;
      const parsed = await readContent(message.content);
      if (parsed.kind === 'ignored') continue;
      if (parsed.kind === 'unknown') {
        console.warn('[scout] unhandled content type', parsed.type, 'from', platform);
        continue;
      }

      batcher.add(key, {
        platform,
        threadKey: space.id,
        handle,
        service: message?.sender?.service || null,
        // ISO country for the sender. Without it a national-format number from
        // outside North America normalizes to a plausible-but-wrong US number.
        country: message?.sender?.country || null,
        space,
        // Carried so the burst can mark exactly these ids complete once its
        // work has actually landed — see scout_complete_ingest.
        messageId: String(message.id),
        ...(parsed.kind === 'text' ? { text: parsed.text } : { attachment: parsed.media }),
      });
    } catch (e) {
      console.error('[scout] message handling failed', e?.stack || e?.message || e);
    }
  }

  // REACHING HERE IS FATAL, and has to be made fatal explicitly.
  //
  // `for await` exits when Photon's stream ends — a dropped gRPC connection, a
  // provider restart, a revoked token. Falling out of it used to just... return.
  // main() resolved, the .catch() below never fired, and the process did NOT
  // exit, because startInviteLoop's setTimeout keeps the event loop alive. The
  // result was the worst possible failure: a machine that looks perfectly
  // healthy, still texting new signups from the invite queue, while every photo
  // anyone sends is silently ignored. Nothing would page, and the logs would be
  // quiet, because nothing went wrong — the loop simply had nothing left to
  // iterate.
  //
  // Exiting non-zero hands recovery to the supervisor, which reconnects
  // everything from a clean slate. That is deliberately preferred over
  // hand-rolled reconnection: this process holds a gRPC stream, an outbound
  // PartyKit socket and in-memory burst state, and re-establishing all three
  // correctly in-place is far more code — and far more ways to be subtly wrong —
  // than letting the container restart. Pair with `[[restart]] policy = "always"`
  // in fly.toml; the platform default only restarts on a NON-ZERO exit.
  throw new Error('Photon message stream ended — no further messages will arrive');
}

main().catch((e) => {
  console.error('[scout] fatal', e?.stack || e?.message || e);
  process.exit(1);
});
