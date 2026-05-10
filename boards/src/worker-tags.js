// Cloudflare Worker handlers for the AI tagging pipeline.
//
// Three routes (Phase 1 = embed + apply; cluster-name + revalidate land in
// later phases):
//
//   POST /api/tags/embed         — OpenAI text-embedding-3-small in batch
//   POST /api/tags/apply         — Anthropic Haiku tier verdicts, batched
//   POST /api/tags/cluster-name  — Anthropic Haiku names emergent clusters
//
// Auth: every request must carry a valid Supabase user JWT in the
// Authorization header. We verify by calling the project's /auth/v1/user
// endpoint — if Supabase accepts the token, we accept the request. The
// worker never sees the user's password, only the JWT.
//
// Stateless: no Supabase reads/writes here. The client persists results
// (card_embeddings, entity_links applications) under its own JWT through
// the normal Supabase client, respecting RLS.
//
// Required secrets / vars (set via `wrangler secret put` or CF dashboard):
//   ANTHROPIC_API_KEY  — anthropic.com Haiku 4.5
//   OPENAI_API_KEY     — OpenAI text-embedding-3-small
//   SUPABASE_URL       — used to validate user JWTs (already known publicly)
//   SUPABASE_ANON_KEY  — required by Supabase /auth/v1/user as the apikey hdr

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

// Hard caps so a misbehaving client can't run up the bill in one call.
const MAX_EMBED_CARDS_PER_CALL = 64;
const MAX_APPLY_CARDS_PER_CALL = 16;
const MAX_CLUSTER_MEMBERS = 8;

export async function handleTagsRoute(url, request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  const auth = await verifyUser(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status || 401);

  if (url.pathname === '/api/tags/embed')        return handleEmbed(request, env);
  if (url.pathname === '/api/tags/apply')        return handleApply(request, env);
  if (url.pathname === '/api/tags/cluster-name') return handleClusterName(request, env);

  return json({ error: 'not found' }, 404);
}

// ─────────────────────────────────────────────────────────────────────
// Auth — verify the user's JWT against Supabase. We don't trust the
// client to tell us *who* they are; we ask Supabase. Single network call,
// cheap (Supabase caches the verification path).
async function verifyUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: 'missing bearer token' };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'supabase env not configured' };
  }
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': env.SUPABASE_ANON_KEY,
      'authorization': `Bearer ${match[1]}`,
    },
  });
  if (!r.ok) return { ok: false, status: 401, error: 'invalid token' };
  const user = await r.json().catch(() => null);
  if (!user?.id) return { ok: false, status: 401, error: 'invalid token' };
  return { ok: true, userId: user.id };
}

// ─────────────────────────────────────────────────────────────────────
// /api/tags/embed
// Body: { cards: [{ id, text }] }
// Returns: { embeddings: [{ id, vector }] }
async function handleEmbed(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'openai key not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cards)) return json({ error: 'cards array required' }, 400);
  if (body.cards.length === 0) return json({ embeddings: [] }, 200);
  if (body.cards.length > MAX_EMBED_CARDS_PER_CALL) {
    return json({ error: `max ${MAX_EMBED_CARDS_PER_CALL} cards per call` }, 400);
  }
  // OpenAI's batch embedding endpoint takes an array of strings and returns
  // them in order. We map id ↔ index ourselves.
  const ids = [];
  const texts = [];
  for (const c of body.cards) {
    if (typeof c?.id !== 'string' || typeof c?.text !== 'string') {
      return json({ error: 'each card needs {id, text}' }, 400);
    }
    ids.push(c.id);
    // Cap input length to keep token costs predictable. ~2000 chars ≈ 500 tokens.
    texts.push(c.text.slice(0, 8000));
  }
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
  if (!r.ok) {
    const err = await r.text();
    return json({ error: `openai ${r.status}`, detail: err.slice(0, 500) }, 502);
  }
  const data = await r.json();
  const out = data?.data || [];
  if (out.length !== ids.length) {
    return json({ error: 'embedding count mismatch' }, 502);
  }
  const embeddings = out.map((row, i) => ({ id: ids[i], vector: row.embedding }));
  return json({ embeddings, dim: EMBEDDING_DIM }, 200);
}

// ─────────────────────────────────────────────────────────────────────
// /api/tags/apply
// Body: {
//   cards: [{
//     id,
//     text,
//     candidate_tags: [{ id, name, description? }]
//   }]
// }
// Returns: {
//   verdicts: [{
//     card_id,
//     tags: [{ tag_id, confidence: "high"|"medium"|"low" }]
//   }]
// }
//
// All cards in one call share the system prompt + tag list (cached). The
// client is responsible for embedding-prefiltering candidate_tags down to
// the middle band (cosine 0.20–0.55) before calling — we don't second-guess
// that here.
async function handleApply(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'anthropic key not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cards)) return json({ error: 'cards array required' }, 400);
  if (body.cards.length === 0) return json({ verdicts: [] }, 200);
  if (body.cards.length > MAX_APPLY_CARDS_PER_CALL) {
    return json({ error: `max ${MAX_APPLY_CARDS_PER_CALL} cards per call` }, 400);
  }

  const system = [
    {
      type: 'text',
      text: APPLY_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // The user message is the card payload. We don't put the tag list in the
  // system prompt because it varies per workspace — the cache key is the
  // system prompt, which stays constant across all workspaces and all
  // tagging requests, maximising hit rate.
  const userPayload = {
    cards: body.cards.map(c => ({
      id: String(c.id),
      text: String(c.text || '').slice(0, 4000),
      candidate_tags: (c.candidate_tags || []).map(t => ({
        id: String(t.id),
        name: String(t.name || ''),
        description: t.description ? String(t.description).slice(0, 200) : undefined,
      })),
    })),
  };

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      output_config: {
        format: { type: 'json_schema', schema: APPLY_RESPONSE_SCHEMA },
      },
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    return json({ error: `anthropic ${r.status}`, detail: err.slice(0, 500) }, 502);
  }
  const data = await r.json();
  const text = (data?.content || []).find(b => b.type === 'text')?.text;
  if (!text) return json({ error: 'no text in response' }, 502);
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) {
    return json({ error: 'malformed json from model', detail: text.slice(0, 500) }, 502);
  }
  return json(
    { verdicts: parsed.verdicts || [], usage: data.usage || null },
    200,
  );
}

// ─────────────────────────────────────────────────────────────────────
// /api/tags/cluster-name (Phase 2 — exposed now, used by client later)
// Body: { member_cards: [{ id, text }] }   // 3–8 representative cards
// Returns: { name: string|null, description: string|null }
//   name === null → cards don't share a coherent theme; mark cluster rejected.
async function handleClusterName(request, env) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'anthropic key not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.member_cards) || body.member_cards.length < 3) {
    return json({ error: 'need ≥3 member_cards' }, 400);
  }
  const members = body.member_cards.slice(0, MAX_CLUSTER_MEMBERS).map(c => ({
    id: String(c.id),
    text: String(c.text || '').slice(0, 1500),
  }));

  const system = [
    {
      type: 'text',
      text: CLUSTER_NAME_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 256,
      system,
      output_config: {
        format: { type: 'json_schema', schema: CLUSTER_NAME_RESPONSE_SCHEMA },
      },
      messages: [{ role: 'user', content: JSON.stringify({ cards: members }) }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    return json({ error: `anthropic ${r.status}`, detail: err.slice(0, 500) }, 502);
  }
  const data = await r.json();
  const text = (data?.content || []).find(b => b.type === 'text')?.text;
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  if (!parsed) return json({ error: 'malformed json from model' }, 502);
  return json(
    { name: parsed.name ?? null, description: parsed.description ?? null, usage: data.usage || null },
    200,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Prompts and JSON schemas. Kept here so the cache prefix stays byte-stable
// across deployments (any change here invalidates the prompt cache once).

const APPLY_SYSTEM_PROMPT = `You are a tagging assistant for a notes/board app. Each request gives you a batch of cards, each card with a list of candidate tags. For every (card, tag) pair, decide whether the tag actually applies to the card content.

Confidence levels:
- "high": the card is clearly and substantially about this topic. Apply silently.
- "medium": the card touches on this topic but isn't primarily about it. Surface as a suggestion the user can accept or dismiss.
- "low": the tag doesn't really apply, or the candidate is too weak. Drop.

Be strict. A common word appearing in a card does NOT mean a tag applies — the card must be ABOUT the topic. When in doubt, choose lower confidence. Most candidate tags should be "low".

Tag descriptions, if provided, take precedence over tag names alone.

Return JSON matching the schema. Do not add prose.`;

const APPLY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['card_id', 'tags'],
        properties: {
          card_id: { type: 'string' },
          tags: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['tag_id', 'confidence'],
              properties: {
                tag_id: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
            },
          },
        },
      },
    },
  },
};

const CLUSTER_NAME_SYSTEM_PROMPT = `You are naming a cluster of related cards from a notes app. You will be given 3-8 cards that an embedding-clustering algorithm grouped together as semantically similar.

Your job: decide whether they share a coherent theme worth tagging, and if so, name it.

Output a name (1-3 words, title case, the kind of label a person would actually use as a tag like "Project Phoenix" or "Onboarding flow") and a one-sentence description suitable for a tag tooltip.

If the cards do NOT share a meaningful theme — for example, they're a coincidental grouping of common words, or each card is about something different — return name: null. This is the validation gate against bad emergent clusters.

Return JSON matching the schema. Do not add prose.`;

const CLUSTER_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}
