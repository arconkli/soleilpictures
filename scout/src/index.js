// Soleil Scout — entry point.
//
// Consumes Photon's async-iterator message stream, batches each conversation's
// burst, and runs the ingest pipeline. This is a long-lived process because
// @spectrum-ts/imessage speaks gRPC and shells out — it cannot run in a Worker.
//
// Deliberately quiet in normal operation: one log line per burst, errors only
// otherwise. The interesting telemetry lands in analytics_events via the
// SECURITY DEFINER RPCs, which is where the rest of the product looks.

import { Spectrum } from 'spectrum-ts';
import { imessage } from 'spectrum-ts/providers/imessage';
import { loadConfig } from './config.js';
import { makeUploader } from './media.js';
import { makeBatcher } from './batcher.js';
import { runBurst } from './pipeline.js';
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

const batcher = makeBatcher({
  waitMs: cfg.BURST_MS,
  onFlush: async (burst) => {
    const t0 = Date.now();
    const { space } = burst;
    try {
      const out = await space.responding(async () => runBurst(cfg, r2, burst));
      if (out?.reply) await space.send(out.reply);
      console.log('[scout] burst', {
        platform: burst.platform,
        images: burst.attachments.length,
        texts: burst.texts.length,
        live: out?.live ?? null,
        capped: out?.capped ?? false,
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
  });

  const shutdown = async (sig) => {
    console.log(`[scout] ${sig} — draining ${batcher.size} pending burst(s)`);
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
      const content = message.content;
      const msg = {
        platform,
        threadKey: space.id,
        handle,
        service: message?.sender?.service || null,
        // ISO country for the sender. Without it a national-format number from
        // outside North America normalizes to a plausible-but-wrong US number.
        country: message?.sender?.country || null,
        space,
      };

      if (content?.type === 'text') {
        msg.text = content.text;
      } else if (content?.type === 'attachment') {
        const bytes = await content.read();
        msg.attachment = {
          bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
          mimeType: content.mimeType,
          name: content.name,
        };
      } else {
        continue;   // reactions, read receipts, membership events — not ingest
      }

      batcher.add(key, msg);
    } catch (e) {
      console.error('[scout] message handling failed', e?.stack || e?.message || e);
    }
  }
}

main().catch((e) => {
  console.error('[scout] fatal', e?.stack || e?.message || e);
  process.exit(1);
});
