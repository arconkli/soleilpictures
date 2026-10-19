// Cloudflare Worker handlers for the AI tagging pipeline.
//
// Three routes (Phase 1 = embed + apply; cluster-name + revalidate land in
// later phases):
//
//   POST /api/tags/embed         — Workers AI (bge-m3) embeddings in batch
//   POST /api/tags/apply         — Workers AI (llama) word verdicts, batched
//   POST /api/tags/cluster-name  — Workers AI (llama) names emergent clusters
//
// All three run on Cloudflare Workers AI via env.AI, inside the account's
// daily free allowance. (The old gpt-4o apply path blew the budget when it
// fired per-card on every keystroke.) Embeddings were the last OpenAI call:
// text-embedding-3-small, until the credits ran out in 2026 and nothing had
// been embedded since May. Since 0418 they are @cf/baai/bge-m3 (1024-dim,
// multilingual); the old vectors were cleared and re-embed on demand, and the
// thresholds in lib/clusterMath.js were recalibrated for the new model.
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
//   AI (binding)       — Workers AI, for all three routes
//   SUPABASE_URL       — used to validate user JWTs (already known publicly)
//   SUPABASE_ANON_KEY  — required by Supabase /auth/v1/user as the apikey hdr

import { parseJsonLoose, runWorkersAiChat } from './worker-llm.js';
import { verifyUser } from './lib/workerAuth.js';

// Models. Doc-page word verdicts + cluster naming run on Workers AI (env.AI)
// with the SAME prompts the OpenAI models had. The cascade already distrusts
// the model's char offsets (it regex-relocates each claimed word) and drops
// "low" verdicts, so a smaller model's looser precision is a non-issue; only
// verdict quality matters. Embeddings: bge-m3, chosen over qwen3-embedding-0.6b
// on 2026-10-18 by re-embedding the stored cards — equal rank agreement with
// the OpenAI vectors (Spearman ~0.60), better-spread scores near the top, and a
// fifth of the cold-call latency. Cloudflare retired the plain
// llama-3.1-8b-instruct id on 2026-05-30 (error 5028, so /apply had failed every
// call since); the fp8 build is the same model, quantized.
const APPLY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';    // /api/tags/apply
const CLUSTER_NAME_MODEL = '@cf/meta/llama-3.2-3b-instruct'; // /api/tags/cluster-name
const EMBEDDING_MODEL = '@cf/baai/bge-m3';
const EMBEDDING_DIM = 1024;   // pgvector columns are vector(1024) since 0418

// Hard caps so a misbehaving client can't run up the bill in one call.
const MAX_EMBED_CARDS_PER_CALL = 64;
const MAX_APPLY_CARDS_PER_CALL = 16;
const MAX_APPLY_TAGS_PER_CARD = 30;
const MAX_CLUSTER_MEMBERS = 8;

export async function handleTagsRoute(url, request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  try {
    const auth = await verifyUser(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status || 401);

    if (url.pathname === '/api/tags/embed')        return await handleEmbed(request, env);
    if (url.pathname === '/api/tags/apply')        return await handleApply(request, env);
    if (url.pathname === '/api/tags/cluster-name') return await handleClusterName(request, env);

    return json({ error: 'not found' }, 404);
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return json({ error: timedOut ? 'upstream timeout' : 'internal error' }, timedOut ? 504 : 500);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Auth — verify the user's JWT against Supabase. We don't trust the
// client to tell us *who* they are; we ask Supabase. Single network call,
// cheap (Supabase caches the verification path).
// Verified-token cache. A tagging burst sends the same JWT on every call
// (embed → apply → apply …); without this each request pays a serial GoTrue
// round-trip before route dispatch. 60s TTL bounds revocation lag well under
// verifyUser + its token cache now live in lib/workerAuth.js, shared with
// worker-ai.js and worker-scout.js — see the header there.

// ─────────────────────────────────────────────────────────────────────
// /api/tags/embed
// Body: { cards: [{ id, text }] }
// Returns: { embeddings: [{ id, vector }] }

// Asks tags_embed_budget_take, as the caller, whether these characters fit
// today's budget. Anything but an explicit yes is a no. /apply and
// /cluster-name spend from the same budget, charged with everything sent to
// the model: the instructions cost the same on every call, whatever the
// user's own text adds.
async function embedBudgetOk(env, request, chars) {
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/tags_embed_budget_take`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: request.headers.get('authorization') || '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_chars: chars }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    return (await r.json().catch(() => false)) === true;
  } catch (_) {
    return false;
  }
}

async function handleEmbed(request, env) {
  if (!env.AI) return json({ error: 'env.AI (Workers AI) binding not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cards)) return json({ error: 'cards array required' }, 400);
  if (body.cards.length === 0) return json({ embeddings: [] }, 200);
  if (body.cards.length > MAX_EMBED_CARDS_PER_CALL) {
    return json({ error: `max ${MAX_EMBED_CARDS_PER_CALL} cards per call` }, 400);
  }
  // The model takes an array of strings and returns them in order. We map
  // id ↔ index ourselves.
  const ids = [];
  const texts = [];
  for (const c of body.cards) {
    if (typeof c?.id !== 'string' || typeof c?.text !== 'string') {
      return json({ error: 'each card needs {id, text}' }, 400);
    }
    ids.push(c.id);
    // Cap input length (bge-m3 reads up to 8,192 tokens; this keeps calls
    // well inside it and the neuron cost predictable). Never send an empty
    // string: the model has nothing to pool.
    texts.push(c.text.slice(0, 8000) || ' ');
  }
  // A daily budget, per account and for everyone (0381, audit SE-3): beyond the
  // free allowance this route is spend, so spend only on a yes.
  const chars = texts.reduce((n, t) => n + t.length, 0);
  if (!await embedBudgetOk(env, request, chars)) {
    return json({ error: 'daily embedding budget reached' }, 429);
  }
  let result;
  try {
    result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  } catch (e) {
    return json({ error: 'embedding failed', detail: String(e?.message || e).slice(0, 300) }, 502);
  }
  const rows = Array.isArray(result?.data) ? result.data : [];
  if (rows.length !== ids.length) {
    return json({ error: 'embedding count mismatch' }, 502);
  }
  if (rows.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIM)) {
    return json({ error: 'unexpected embedding size' }, 502);
  }
  // Unit length, as OpenAI's were. clusterMath compares by true cosine, so this
  // changes no answer; it keeps every stored vector the same shape.
  const embeddings = rows.map((v, i) => ({ id: ids[i], vector: unitLength(v) }));
  return json({ embeddings, dim: EMBEDDING_DIM, model: EMBEDDING_MODEL }, 200);
}

function unitLength(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return n > 0 ? v.map((x) => x / n) : v;
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
// (cosine distance SILENT_APPLY_DIST–NO_MATCH_DIST in lib/clusterMath.js)
// before calling — we don't second-guess that here.
async function handleApply(request, env) {
  if (!env.AI) return json({ error: 'env.AI (Workers AI) binding not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cards)) return json({ error: 'cards array required' }, 400);
  if (body.cards.length === 0) return json({ verdicts: [] }, 200);
  if (body.cards.length > MAX_APPLY_CARDS_PER_CALL) {
    return json({ error: `max ${MAX_APPLY_CARDS_PER_CALL} cards per call` }, 400);
  }

  // Every field is capped, so one call's prompt is bounded by these numbers
  // rather than by the model's context window.
  const userPayload = {
    cards: body.cards.map(c => ({
      id: String(c?.id ?? '').slice(0, 200),
      text: String(c?.text || '').slice(0, 4000),
      candidate_tags: (Array.isArray(c?.candidate_tags) ? c.candidate_tags : [])
        .slice(0, MAX_APPLY_TAGS_PER_CARD).map(t => ({
          id: String(t?.id ?? '').slice(0, 200),
          name: String(t?.name || '').slice(0, 80),
          description: t?.description ? String(t.description).slice(0, 200) : null,
        })),
    })),
  };

  // Workers AI doesn't support OpenAI strict json_schema, so we ask for the
  // shape in the prompt and parse it tolerantly. APPLY_RESPONSE_SCHEMA below
  // still documents the contract the client (aiParagraphCascade.js) expects.
  const userMsg = JSON.stringify(userPayload)
    + '\n\nReturn ONLY a JSON object of this shape (no markdown, no prose):\n'
    + '{"verdicts":[{"card_id": string, "tags":[{"tag_id": string, "confidence":"high"|"medium"|"low", "words":[{"text": string, "start_offset": number, "length": number}], "evidence_sentence": string|null}]}]}';
  if (!await embedBudgetOk(env, request, APPLY_SYSTEM_PROMPT.length + userMsg.length)) {
    return json({ error: 'daily tagging budget reached' }, 429);
  }
  let resp;
  try {
    resp = await runWorkersAiChat(env, APPLY_MODEL, APPLY_SYSTEM_PROMPT, userMsg,
      { max_tokens: 2000, temperature: 0.1 });
  } catch (e) {
    return json({ error: 'workers-ai: ' + String(e?.message || e).slice(0, 200) }, 502);
  }
  const parsed = parseJsonLoose(resp);
  if (!parsed) return json({ error: 'malformed json from model', detail: String(resp).slice(0, 500) }, 502);
  // Trust the model + the client-side embedding pre-filter. An earlier
  // version of this code also stripped any verdict whose evidence
  // sentence didn't contain a tag-name token, but that killed
  // legitimate context-based applications (e.g. tag "Acme Pitch Deck"
  // applied to a paragraph about "the opening slide" inside a doc
  // that's clearly about Acme — no "Acme" in the sentence, but the
  // context supports the tag). The embedding pre-filter keeps unrelated
  // tags from reaching the model in the first place; the prompt rules
  // above tell the model when context-continuity is enough.
  const verdicts = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  return json({ verdicts, usage: null }, 200);
}

// ─────────────────────────────────────────────────────────────────────
// /api/tags/cluster-name (Phase 2 — exposed now, used by client later)
// Body: {
//   member_cards: [{ id, text }],   // 3–8 representative cards
//   existing_names?: string[],      // names the model must NOT collide with
// }
// Returns: { name: string|null, description: string|null }
//   name === null → cards don't share a coherent theme OR the only honest
//   name would duplicate an existing one. Either way: cluster gets rejected.
async function handleClusterName(request, env) {
  if (!env.AI) return json({ error: 'env.AI (Workers AI) binding not configured' }, 500);
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.member_cards) || body.member_cards.length < 3) {
    return json({ error: 'need ≥3 member_cards' }, 400);
  }
  const members = body.member_cards.slice(0, MAX_CLUSTER_MEMBERS).map(c => ({
    id: String(c?.id ?? '').slice(0, 200),
    text: String(c?.text || '').slice(0, 1500),
  }));
  const existingNames = Array.isArray(body?.existing_names)
    ? body.existing_names.slice(0, 100).map(n => String(n || '').slice(0, 80)).filter(Boolean)
    : [];

  const userMsg = JSON.stringify({ cards: members, existing_names: existingNames })
    + '\n\nReturn ONLY a JSON object: {"name": string|null, "description": string|null}. No markdown, no prose.';
  if (!await embedBudgetOk(env, request, CLUSTER_NAME_SYSTEM_PROMPT.length + userMsg.length)) {
    return json({ error: 'daily tagging budget reached' }, 429);
  }
  let resp;
  try {
    resp = await runWorkersAiChat(env, CLUSTER_NAME_MODEL, CLUSTER_NAME_SYSTEM_PROMPT, userMsg,
      { max_tokens: 300, temperature: 0.3 });
  } catch (e) {
    return json({ error: 'workers-ai: ' + String(e?.message || e).slice(0, 200) }, 502);
  }
  const parsed = parseJsonLoose(resp);
  if (!parsed) return json({ error: 'malformed json from model' }, 502);
  return json(
    { name: parsed.name ?? null, description: parsed.description ?? null, usage: null },
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

NAMED ENTITY GUARDRAIL
If the tag name reads like a specific named entity — a brand, product, person, place, project, logo, or proper-noun compound (Title Case; contains "logo", "brand", "campaign", "pitch deck", "reel"; or is a non-generic compound like "Project Phoenix") — the bar for applying is HIGHER than for a generic concept tag. Generic word overlap is not enough; the paragraph must actually be ABOUT the specific named entity.

You can apply a named-entity tag at "medium" or "high" if EITHER of these is true:

  (a) The named entity itself is mentioned (e.g. "Acme", "Clusters logo", "Tom's reel").

  (b) The paragraph is clearly continuing or referring back to the same named entity being discussed elsewhere — the surrounding doc establishes the subject and this paragraph keeps talking about it. For example: a doc about Acme's pitch deck where one paragraph says "we need to nail the opening slide" — "Acme" isn't in that sentence, but in context the paragraph is obviously about Acme's deck, so the tag applies at medium.

Failure patterns that you MUST return "low" for (NEITHER (a) nor (b) is met):

  - Tag "Clusters logo" applied to a paragraph using "ad", "collab", "exclusive", or "campaign" with NO context tying those words to Clusters' specific logo. These are generic marketing words; without an Acme-style anchor or contextual continuity, the tag doesn't apply.
  - Tag "Acme Pitch Deck" applied to a generic productivity tip about pitches that has nothing to do with Acme.
  - Tag "Tom's Reel" applied to a sentence about someone else's reel.

The rule of thumb: would a reader, having read the surrounding doc and the tag's description, naturally say "yes this paragraph is talking about THAT specific thing"? If yes (even via context, not just the name appearing) — apply at medium or high. If you have to invent the connection — return low.

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

DO NOT DUPLICATE EXISTING NAMES
The user message may include an "existing_names" array — names already in use as workspace tags or as proposed names for other clusters. Your "name" MUST NOT collide with any entry in that list. A collision is any of:
  - exact case-insensitive match ("Social Media" ↔ "social media")
  - one name is a substring of the other when both are ≥ 4 chars ("Social Media" ↔ "Social Media Platforms")
  - trivial variants (plural/singular, hyphen vs space, minor typo)

If your honest name for this cluster would collide with an existing_names entry, return name: null and description: null. The cluster will be rejected rather than create a duplicate tag — that's the right outcome, since the existing name already covers this concept.

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
