// The server's embedder: card_embeddings rows the Worker writes. Pictures are
// embedded here with their descriptions (worker-vision.js), since the browser
// no longer embeds image or video cards (embedText.js clientEmbedsKind), and
// the API embeds what it writes through the same function, cards and doc
// pages alike. One module and one budget path for every server-side embedding.
//
// The text and its hash come from embedText.js and aiWarmup.js's page rule,
// the same ones the browser's writers use, so content_hash agrees and no
// writer re-embeds over another. A row whose hash is unchanged only has its
// embedded_at touched. Every model call is paid for first from the owner's
// 'embed' budget (0593 _ai_budget_take), and a card in a workspace with AI off
// is never embedded. Texts never leave this module in a log: ids and counts.

import { embedTextForCard, embedHash } from './embedText.js';

export const EMBED_BATCH = 16;
const EMBED_DIM = 1024;  // pgvector columns are vector(1024) since 0418

// The text a doc page is embedded from (aiWarmup.js): its title, then its text.
export const docPageText = (title, text) => [title || '', text || ''].filter((s) => s && s.trim()).join('\n');

// An item as the row it becomes: { entity_kind, card_id, workspace_id,
// board_id, doc_card_id, owner_id, text, hash, stored }. A card is
// { workspace_id, board_id, card_id, title, body, description }; a doc page is
// { entity_kind: 'doc-page', page_id, doc_card_id, board_id, workspace_id,
// page_title, page_text }. `content_hash` is the stored hash when the caller
// has it, else null and embedCards reads it.
export function embedRow(item) {
  if (!item) return null;
  const page = item.entity_kind === 'doc-page';
  const text = page
    ? docPageText(item.page_title, item.page_text)
    : embedTextForCard({ title: item.title, body: item.body }, item.description || null);
  const id = page ? item.page_id : item.card_id;
  if (!id || !item.workspace_id || !text) return null;
  return {
    entity_kind: page ? 'doc-page' : 'card',
    card_id: String(id),
    workspace_id: item.workspace_id,
    board_id: item.board_id || null,
    doc_card_id: page ? item.doc_card_id || null : null,
    owner_id: item.owner_id || null,
    text,
    hash: embedHash(text),
    stored: item.content_hash ?? null,
  };
}

const unitLength = (v) => {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
};

// bge-m3 vectors for texts, unit length (as worker-tags.js stores them), or a
// thrown error. The caller has already paid for them.
export async function embedTexts(env, texts) {
  const result = await env.AI.run('@cf/baai/bge-m3', { text: texts });
  const rows = Array.isArray(result?.data) ? result.data : [];
  if (rows.length !== texts.length || rows.some((v) => !Array.isArray(v) || v.length !== EMBED_DIM)) {
    throw new Error(`bge-m3 answered ${rows.length} vectors for ${texts.length} texts`);
  }
  return rows.map(unitLength);
}

const quoteIn = (ids) => `(${ids.map((id) => `"${String(id).replace(/"/g, '""')}"`).join(',')})`;

function rest(env, path, init = {}, timeoutMs = 15_000) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function restJson(env, path, init, timeoutMs) {
  const res = await rest(env, path, init, timeoutMs);
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Embeds what changed among `items` and stores it. Returns counts, plus the
// rows now current ({ entity_kind, card_id, board_id, workspace_id }) so a
// caller can follow up (worker-vision.js asks for tag suggestions).
export async function embedCards(env, items, { timeoutMs = 15_000 } = {}) {
  const stats = { embedded: 0, unchanged: 0, refused: 0, failed: 0, skipped: 0, current: [] };
  if (!env?.AI || !env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    stats.skipped = items?.length || 0;
    return stats;
  }
  const seen = new Set();
  let rows = [];
  for (const item of items || []) {
    const row = embedRow(item);
    if (!row || seen.has(`${row.entity_kind}:${row.card_id}`)) { stats.skipped++; continue; }
    seen.add(`${row.entity_kind}:${row.card_id}`);
    rows.push(row);
  }
  if (!rows.length) return stats;

  // Each card's own workspace decides: AI off, nothing embedded. Its owner
  // pays when the caller didn't say who.
  const wsIds = [...new Set(rows.map((r) => r.workspace_id))];
  const spaces = await restJson(env, `workspaces?select=id,created_by,ai_tagger_enabled&id=in.${quoteIn(wsIds)}`, {}, timeoutMs);
  const byWs = new Map((spaces || []).map((w) => [w.id, w]));
  rows = rows.filter((r) => {
    const w = byWs.get(r.workspace_id);
    if (!w || w.ai_tagger_enabled === false) { stats.skipped++; return false; }
    if (!r.owner_id) r.owner_id = w.created_by || null;
    return true;
  });

  // The stored hashes the caller didn't have.
  for (const kind of ['card', 'doc-page']) {
    const unknown = rows.filter((r) => r.entity_kind === kind && r.stored == null).map((r) => r.card_id);
    for (let i = 0; i < unknown.length; i += 100) {
      const got = await restJson(env,
        `card_embeddings?select=card_id,content_hash&entity_kind=eq.${kind}&card_id=in.${quoteIn(unknown.slice(i, i + 100))}`,
        {}, timeoutMs);
      const hashOf = new Map((got || []).map((g) => [g.card_id, g.content_hash]));
      for (const r of rows) if (r.entity_kind === kind && r.stored == null && hashOf.has(r.card_id)) r.stored = hashOf.get(r.card_id);
    }
  }

  const now = () => new Date().toISOString();
  const same = rows.filter((r) => r.stored === r.hash);
  for (const kind of ['card', 'doc-page']) {
    const ids = same.filter((r) => r.entity_kind === kind).map((r) => r.card_id);
    if (!ids.length) continue;
    try {
      await restJson(env, `card_embeddings?entity_kind=eq.${kind}&card_id=in.${quoteIn(ids)}`,
        { method: 'PATCH', body: JSON.stringify({ embedded_at: now() }), headers: { prefer: 'return=minimal' } }, timeoutMs);
    } catch (e) {
      console.warn('[server-embed] touch failed', kind, ids.length, e?.message || e);
    }
  }
  stats.unchanged = same.length;
  stats.current.push(...same.map(pick));

  // The rest, a batch at a time, each batch one owner's and paid for first.
  const changed = rows.filter((r) => r.stored !== r.hash);
  const byOwner = new Map();
  for (const r of changed) {
    if (!r.owner_id) { stats.skipped++; continue; }
    if (!byOwner.has(r.owner_id)) byOwner.set(r.owner_id, []);
    byOwner.get(r.owner_id).push(r);
  }
  for (const [owner, list] of byOwner) {
    for (let i = 0; i < list.length; i += EMBED_BATCH) {
      const batch = list.slice(i, i + EMBED_BATCH);
      const chars = batch.reduce((n, r) => n + r.text.length, 0);
      let paid = false;
      try {
        paid = (await restJson(env, 'rpc/_ai_budget_take',
          { method: 'POST', body: JSON.stringify({ p_owner: owner, p_kind: 'embed', p_units: chars }) }, timeoutMs)) === true;
      } catch (e) {
        console.warn('[server-embed] budget failed', e?.message || e);
      }
      if (!paid) { stats.refused += batch.length; continue; }
      try {
        const vectors = await embedTexts(env, batch.map((r) => r.text));
        const at = now();
        await restJson(env, 'card_embeddings?on_conflict=entity_kind,card_id', {
          method: 'POST',
          headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(batch.map((r, k) => ({
            card_id: r.card_id, entity_kind: r.entity_kind, workspace_id: r.workspace_id, board_id: r.board_id,
            doc_card_id: r.doc_card_id, content_hash: r.hash, embedding: `[${vectors[k].join(',')}]`, embedded_at: at,
          }))),
        }, timeoutMs);
        stats.embedded += batch.length;
        stats.current.push(...batch.map(pick));
      } catch (e) {
        stats.failed += batch.length;
        console.warn('[server-embed] batch failed', batch.length, e?.message || e);
      }
    }
  }
  return stats;
}

const pick = (r) => ({ entity_kind: r.entity_kind, card_id: r.card_id, board_id: r.board_id, workspace_id: r.workspace_id });
