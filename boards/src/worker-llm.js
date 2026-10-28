// Shared helpers for Cloudflare Workers AI (env.AI) text-model calls.
// Used by worker-ai.js (candidate "type + confirm") and worker-tags.js
// (doc-page word-level tagging, migrated off OpenAI gpt-4o).
//
// Workers AI is the FREE in-worker tier — no API key, no credits. Text
// models return { response }: a string, or the value already parsed when the
// whole answer is JSON. They don't support OpenAI-style strict json_schema,
// so callers prompt for JSON and parse it tolerantly with the helpers below.

// Tolerant JSON-OBJECT extraction — strips ``` fences and any surrounding
// prose, then grabs the outermost {...}. Returns null on failure.
export function parseJsonLoose(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// Tolerant JSON-ARRAY extraction — same idea, for responses that are a
// top-level array (the candidate classifier). Returns null on failure.
export function parseJsonArrayLoose(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; }
}

// A text model's answer as text, from env.AI.run's result or the REST API's
// `result`. An answer that is all JSON arrives as an object (llama-3.2-3b and
// llama-3.3-70b, 2026-10-19). String() of it is "[object Object]", so every
// cluster name came back "malformed json from model" until this. Newer models
// (gemma-4, 2026-10-27) answer in the OpenAI shape instead: choices[0].message.
export function responseText(out) {
  const r = out?.response;
  if (r == null) {
    const c = out?.choices?.[0]?.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    return '';
  }
  return typeof r === 'string' ? r : JSON.stringify(r);
}

// Run a text model on env.AI with a system + user message pair. Returns the
// raw response string (''. on empty). Throws on binding/model error — the
// caller decides the fallback (we never want an AI hiccup to break a flow).
export async function runWorkersAiChat(env, model, system, user, opts = {}) {
  const out = await env.AI.run(model, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
  });
  return responseText(out);
}
