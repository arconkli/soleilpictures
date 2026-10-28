// Pictures described by a vision model, from the Worker's cron (the owner's
// photo vision, 2026-10-27; 0593). Every other minute the job claims a few
// pictures (newest first, a few per owner), pays for each call from the
// owner's budget, sends a small copy of the picture and writes back what the
// model saw; then it embeds the image cards that show those pictures
// (lib/serverEmbed.js). lib/vision.js holds the prompt and reads the answer.
//
// What the model says is a picture's private metadata: logs, errors and
// alerts carry ids and counts only, never a description.

import { AI_MODELS } from './lib/aiModels.js';
import { visionRequest, dataUriOf, pictureTypeOf, visionRendition, parseDescription, describedText } from './lib/vision.js';
import { embedCards } from './lib/serverEmbed.js';
import { jobFailed } from './lib/workerErrors.js';

// First choice, then the one tried when it fails outright (an error, not a
// poor answer). aiModels.js says how each takes a picture. Gemma 4 first (the
// owner's pick, 2026-10-27, after 50 of their own pictures: richer and more
// accurate descriptions, about a third of Llama's cost per picture).
const MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/meta/llama-3.2-11b-vision-instruct'];
const MODEL_TIMEOUT_MS = 25_000;
const MAX_BYTES = 6_000_000;  // a rendition this big is a stored original past vision.js's ceiling

const modelOf = (id) => AI_MODELS.find((m) => m.id === id) || { id, image: 'top' };

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('model timed out')), ms); })])
    .finally(() => clearTimeout(t));
}

// What the model sees in a picture: { ok: true, description, keywords, attrs,
// model, tokensIn, tokensOut }, or { ok: false, reason }. `beforeCall(model)`
// pays for each call and returns false to stop ('budget'); without it only the
// first model is tried, so a fallback is never an unpaid call.
export async function describeImage(env, { bytes, mime }, { beforeCall = null, models = MODELS } = {}) {
  if (!env?.AI) return { ok: false, reason: 'no_ai' };
  if (!bytes?.length || !mime) return { ok: false, reason: 'no_picture' };
  const dataUri = dataUriOf(bytes, mime);
  const tries = beforeCall ? models : models.slice(0, 1);
  let last = { ok: false, reason: 'no_model' };
  for (const id of tries) {
    if (beforeCall && !(await beforeCall(id))) return { ok: false, reason: 'budget' };
    const model = modelOf(id);
    let out;
    try {
      out = await withTimeout(env.AI.run(id, visionRequest(model.image, dataUri, { noThinking: !!model.noThinking })), MODEL_TIMEOUT_MS);
    } catch (e) {
      last = { ok: false, reason: /timed out/.test(String(e?.message)) ? 'timeout' : 'model_error', model: id };
      continue;
    }
    const parsed = parseDescription(out);
    if (!parsed.ok) return { ok: false, reason: parsed.reason, model: id };
    const usage = out?.usage || {};
    return {
      ok: true, ...parsed.value, model: id,
      tokensIn: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
      tokensOut: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
    };
  }
  return last;
}

async function rpc(env, fn, params, timeoutMs = 20_000) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`rpc ${fn} ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function pool(items, size, fn) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(lanes);
}

const ready = (env) => !!(env?.AI && env?.IMAGES && env?.SUPABASE_URL && env?.SUPABASE_SERVICE_ROLE_KEY);

// One run of the job. Returns counts (logged by the caller's watch).
export async function runImageDescribe(env, { limit = 12, concurrency = 4, perOwner = 4 } = {}) {
  if (!ready(env)) return { skipped: 'unconfigured' };
  const rows = (await rpc(env, '_image_describe_claim', { p_limit: limit, p_per_owner: perOwner })) || [];
  const stats = { claimed: rows.length, done: 0, failed: 0, skipped: 0, refused: 0, cards: 0, embedded: 0 };
  const toEmbed = [];
  const finish = (row, status, r = {}) => rpc(env, '_image_describe_finish', {
    p_image: row.image_id, p_token: row.lease_token, p_status: status,
    p_description: r.description ?? null, p_keywords: r.keywords ?? null, p_attrs: r.attrs ?? null,
    p_model: r.model ?? null, p_tokens_in: r.tokensIn ?? null, p_tokens_out: r.tokensOut ?? null,
    p_error: r.reason ?? null,
  });

  await pool(rows, concurrency, async (row) => {
    try {
      const pick = visionRendition(row);
      if (pick.skip) { await finish(row, 'skipped', { reason: pick.skip }); stats.skipped++; return; }
      const obj = await env.IMAGES.get(pick.key);
      if (!obj) { await finish(row, 'skipped', { reason: 'missing' }); stats.skipped++; return; }
      const mime = pictureTypeOf(pick.key, obj.httpMetadata?.contentType);
      if (!mime) { await obj.body?.cancel?.(); await finish(row, 'skipped', { reason: 'not_picture' }); stats.skipped++; return; }
      const bytes = new Uint8Array(await obj.arrayBuffer());
      if (bytes.length > MAX_BYTES) { await finish(row, 'skipped', { reason: 'too_big' }); stats.skipped++; return; }
      const r = await describeImage(env, { bytes, mime }, {
        beforeCall: async () => (await rpc(env, '_ai_budget_take', { p_owner: row.owner_id, p_kind: 'vision', p_units: 1 })) === true,
      });
      if (!r.ok && r.reason === 'budget') {
        await rpc(env, '_image_describe_release', { p_image: row.image_id, p_token: row.lease_token });
        stats.refused++;
        return;
      }
      if (!r.ok) { await finish(row, 'failed', r); stats.failed++; return; }
      const cards = (await finish(row, 'done', r)) || [];
      stats.done++;
      const description = describedText(r);
      for (const c of cards) toEmbed.push({ ...c, description });
    } catch (e) {
      stats.failed++;
      await jobFailed(env, 'image_describe', e, 'picture');
    }
  });

  if (toEmbed.length) {
    stats.cards = toEmbed.length;
    try {
      stats.embedded = (await embedCards(env, toEmbed)).embedded;
    } catch (e) {
      await jobFailed(env, 'image_describe', e, 'embed');
    }
  }
  if (stats.claimed) console.log('[vision]', JSON.stringify(stats));
  return stats;
}

// Image cards whose picture is described but whose embedding is missing or
// stale: a copy placed later, a card renamed after it was described.
export async function runImageEmbedLane(env, { limit = 40 } = {}) {
  if (!ready(env)) return { skipped: 'unconfigured' };
  const rows = (await rpc(env, '_image_card_embed_due', { p_limit: limit })) || [];
  if (!rows.length) return { due: 0 };
  const res = await embedCards(env, rows.map((r) => ({
    workspace_id: r.workspace_id, board_id: r.board_id, card_id: r.card_id, title: r.title, body: r.body,
    description: describedText(r), content_hash: r.content_hash, owner_id: r.owner_id,
  })));
  const { current, ...counts } = res;
  console.log('[vision] embed lane', JSON.stringify({ due: rows.length, ...counts }));
  return { due: rows.length, ...counts };
}
