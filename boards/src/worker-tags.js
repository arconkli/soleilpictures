// Cloudflare Worker handlers for the AI tagging pipeline.
//
// Three routes (Phase 1 = embed + apply; cluster-name + revalidate land in
// later phases):
//
//   POST /api/tags/embed         — OpenAI text-embedding-3-small in batch
//   POST /api/tags/apply         — gpt-4o-mini tier verdicts, batched
//   POST /api/tags/cluster-name  — gpt-4o-mini names emergent clusters
//
// Single provider (OpenAI) for both embeddings and completions — gpt-4o-mini
// with structured outputs is ~5× cheaper than Anthropic Haiku 4.5 for this
// task and OpenAI has a first-party embeddings API. Anthropic doesn't, so
// going single-provider also collapses two API keys into one.
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
//   OPENAI_API_KEY     — both embeddings and completions
//   SUPABASE_URL       — used to validate user JWTs (already known publicly)
//   SUPABASE_ANON_KEY  — required by Supabase /auth/v1/user as the apikey hdr

// Tagger quality. gpt-4o-mini is fast and cheap but misses subtler
// associations ("startup launch" → "marketing"). gpt-4o gets these
// right at ~5× cost. Cluster naming can stay on mini since the cards
// pre-filter via embedding similarity.
const APPLY_MODEL = 'gpt-4o';
const CLUSTER_NAME_MODEL = 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';
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
    // Cap input length to keep token costs predictable.
    texts.push(c.text.slice(0, 8000));
  }
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
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
  return json({ embeddings, dim: EMBEDDING_DIM, usage: data.usage || null }, 200);
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
// All cards in one call share the system prompt. The client is responsible
// for embedding-prefiltering candidate_tags down to the middle band
// (cosine 0.20–0.55) before calling — we don't second-guess that here.
async function handleApply(request, env) {
  if (!env.OPENAI_API_KEY) return json({ error: 'openai key not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cards)) return json({ error: 'cards array required' }, 400);
  if (body.cards.length === 0) return json({ verdicts: [] }, 200);
  if (body.cards.length > MAX_APPLY_CARDS_PER_CALL) {
    return json({ error: `max ${MAX_APPLY_CARDS_PER_CALL} cards per call` }, 400);
  }

  const userPayload = {
    cards: body.cards.map(c => ({
      id: String(c.id),
      text: String(c.text || '').slice(0, 4000),
      candidate_tags: (c.candidate_tags || []).map(t => ({
        id: String(t.id),
        name: String(t.name || ''),
        description: t.description ? String(t.description).slice(0, 200) : null,
      })),
    })),
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: APPLY_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: APPLY_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'tag_verdicts',
          strict: true,
          schema: APPLY_RESPONSE_SCHEMA,
        },
      },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    return json({ error: `openai ${r.status}`, detail: err.slice(0, 500) }, 502);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return json({ error: 'no content in response' }, 502);
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
  if (!env.OPENAI_API_KEY) return json({ error: 'openai key not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.member_cards) || body.member_cards.length < 3) {
    return json({ error: 'need ≥3 member_cards' }, 400);
  }
  const members = body.member_cards.slice(0, MAX_CLUSTER_MEMBERS).map(c => ({
    id: String(c.id),
    text: String(c.text || '').slice(0, 1500),
  }));

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLUSTER_NAME_MODEL,
      messages: [
        { role: 'system', content: CLUSTER_NAME_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ cards: members }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'cluster_name',
          strict: true,
          schema: CLUSTER_NAME_RESPONSE_SCHEMA,
        },
      },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    return json({ error: `openai ${r.status}`, detail: err.slice(0, 500) }, 502);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content;
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  if (!parsed) return json({ error: 'malformed json from model' }, 502);
  return json(
    { name: parsed.name ?? null, description: parsed.description ?? null, usage: data.usage || null },
    200,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Prompts and JSON schemas. OpenAI structured outputs in strict mode
// require: (a) every property in `properties` must also be listed in
// `required`, (b) `additionalProperties: false` on every object,
// (c) `["string","null"]` union for optional fields. The schemas below
// follow those rules.

const APPLY_SYSTEM_PROMPT = `You are a tagging assistant for a Soleil Pictures notes/board app (creative production work — film, photography, design, marketing, brand). Each request gives you a batch of cards, each card with a list of candidate tags. For every (card, tag) pair, decide whether the tag applies, then return the anchor word(s) AND the sentence those anchors live in.

CRITICAL — CORRELATION CHECK
The single most important rule. A word matching the tag's name is NOT enough. You must verify that the SURROUNDING SENTENCE is genuinely about the tag's concept in the same sense.

Examples of word-match-without-correlation that you MUST return as "low":
  - Tag "Lighting" applied to "The lighting in their argument was that we needed to hurry" — wrong sense, "lighting" here means a person's stance.
  - Tag "Cast" applied to "We cast doubt on the budget" — wrong sense, "cast" here is the verb meaning "throw".
  - Tag "Edit" applied to a sentence about editing a single typo in a document — too incidental; not really about editing as a discipline.
  - Tag "Marketing" applied to "We're not marketing this" — denial of the topic, not engagement with it.
  - Tag "Director" applied to "The school's director called yesterday" — wrong domain (not a film director).
  - Tag X applied to a sentence in a list of synonyms, definitions, or examples where the word appears only as a label.

Before assigning ANY verdict above "low", ask yourself: "Does the SENTENCE around this anchor word make a substantive claim/observation about the tag's topic in the same domain sense?" If no, the verdict is "low" even if the word matches the tag perfectly.

USE THE TAG DESCRIPTION
When a candidate_tag has a "description" field, that description is the workspace owner's definition of what the tag means. Treat it as authoritative. If the card's sentence aligns with the description, lean toward applying. If it diverges from the description even when the name matches, return low.

CONFIDENCE LEVELS
- "high": the card is clearly and substantially about this topic AND the correlation check passes for a strong anchor.
- "medium": the card touches on this topic — a clear mention, related concept, or strong thematic implication — and the correlation check passes.
- "low": the tag does not apply, OR the word matches but the sentence is not about the tag's concept.

DOMAIN HINTS (Soleil Pictures = creative/film production)
Recognize creative-domain vocabulary as evidence for relevant tags:
  - Cinematography / DP work: "lensing", "stop", "f/2.8", "ARRI", "Alexa", "RED", "FX3", "DP", "cinematographer", "camera op", "spherical", "anamorphic", "focal length", "depth of field"
  - Lighting: "key light", "fill", "rim", "ratio", "kelvin", "diffusion", "bounce", "flag", "gel", "HMI", "tungsten", "practical"
  - Edit: "cut", "transition", "color grade", "DaVinci", "Premiere", "FCP", "edit bay", "rough cut", "fine cut", "picture lock"
  - Sound: "ADR", "foley", "mix", "boom", "lav", "lavalier", "sound design", "score"
  - Direction: "blocking", "coverage", "shot list", "storyboard", "rehearsal", "performance"
  - Production: "call sheet", "callback", "production design", "art department", "props", "wardrobe", "MUA", "HMU", "location scout", "permit"
  - Marketing/brand: "campaign", "GTM", "go-to-market", "positioning", "messaging", "launch", "creative brief", "deliverable", "spec ad", "social cut"
  - Business: "MRR", "ARR", "runway", "burn", "raise", "term sheet", "SAFE"
None of these are absolute — they're tilts toward "this card uses domain language that suggests the tag." The correlation check still wins.

ANCHOR RULES
For EVERY "high" and "medium" verdict you MUST return at least one anchor:
- "text": the EXACT substring as it appears (preserve case + punctuation, including any leading "$" or trailing punctuation).
- "start_offset": 0-based character index in the card text.
- "length": substring length in characters.
Pick the SMALLEST meaningful anchor (one word or two-word phrase). Skip filler. Multiple anchors per tag are fine when the topic is reinforced.

For EVERY verdict above "low" you MUST also return:
- "evidence_sentence": the FULL sentence (or a ~120-char span if the sentence is very long) that contains the anchor and proves the correlation. The model is forced to articulate what it's relying on.

For "low" verdicts, "words" must be an empty array and "evidence_sentence" must be null.

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
              required: ['tag_id', 'confidence', 'words', 'evidence_sentence'],
              properties: {
                tag_id: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                evidence_sentence: {
                  type: ['string', 'null'],
                  description: 'The full sentence (or ~120-char span) containing the anchor that proves the correlation. null for "low" verdicts.',
                },
                words: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'start_offset', 'length'],
                    properties: {
                      text: { type: 'string' },
                      start_offset: { type: 'integer' },
                      length: { type: 'integer' },
                    },
                  },
                },
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

If the cards do NOT share a meaningful theme — for example, they're a coincidental grouping of common words, or each card is about something different — return name: null and description: null. This is the validation gate against bad emergent clusters.

Return JSON matching the schema. Do not add prose.`;

const CLUSTER_NAME_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description'],
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
