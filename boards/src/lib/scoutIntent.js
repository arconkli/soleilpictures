// Scout — turning a burst of texted content into an intent.
//
// The division of labour matters here: the model ONLY reads intent. It never
// decides coordinates, never names a card kind, never picks a board id. All
// placement is deterministic code downstream (arrangeInFreeSpace). That keeps
// the magic where users notice it — "it knew this was Scene 4" — and keeps the
// parts that would be maddening if they were wrong under our control.
//
// Runs on env.AI (Workers AI), the free in-worker tier. Per worker-llm.js,
// those models don't honour OpenAI-style strict json_schema, so we prompt for
// JSON and parse tolerantly. EVERY failure path falls back to deterministic
// behaviour — a model hiccup must never drop someone's photo.

import { runWorkersAiChat, parseJsonLoose } from '../worker-llm.js';

// Workers AI is reachable two ways, and Scout needs both: the `AI` binding when
// running inside the Worker, and the REST API from the Node ingest service
// (which exists because Photon's iMessage provider needs gRPC + child_process
// and therefore cannot run in a Worker). Same model, same free allocation.
async function runChat(env, model, system, user, opts) {
  if (env?.AI) return runWorkersAiChat(env, model, system, user, opts);

  if (!env?.CF_ACCOUNT_ID || !env?.CF_AI_TOKEN) throw new Error('no Workers AI transport configured');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CF_AI_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: opts?.max_tokens ?? 1024,
        temperature: opts?.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`workers-ai ${res.status}`);
  const body = await res.json();
  return body?.result?.response || '';
}

// 8b rather than the 3b used for candidate classification: the `topic` becomes
// a visible section header on the user's canvas, and 3b mangles film vocabulary
// ("tech scout", "gaffer", "recce", "Scene 4 int. diner"). Still free tier.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM = [
  'You read short messages sent by film crew to an ingest bot and extract intent.',
  'The user is on set or scouting. They text photos, links and notes with little context.',
  'Reply with ONLY a JSON object, no prose, no code fences.',
  '',
  'Fields:',
  '  topic  - a short Title Case label for what this batch is about, max 48 chars.',
  '           Prefer the production vocabulary they used ("Scene 4 - Diner",',
  '           "Ext. Warehouse Night"). null if the message says nothing about subject.',
  '  action - "file" if they are asking to MOVE or PUT things into a named board',
  '           ("put these in the diner board", "file that under locations").',
  '           "help" if they are asking what the bot can do.',
  '           otherwise "ingest".',
  '  board  - when action is "file", the board name they named, verbatim. else null.',
  '  note   - any part of the message worth keeping as a sticky note on the canvas',
  '           (a reminder, a measurement, a concern). null if the text is purely a',
  '           label for the photos.',
].join('\n');

// ── Deterministic filing ─────────────────────────────────────────────────────
//
// "Put these in Diner Recce" has to work WITHOUT the model. It used to not:
// fallbackIntent always answered `action: 'ingest'`, so with no Cloudflare AI
// credentials — which are optional, and were unset — the sentence was ingested
// as content and became a sticky note on the user's canvas, consuming a card to
// do it. That is the exact failure pipeline.js's own comment warns about, and
// filing is the product's second most important verb after "send a photo". It
// should not depend on a third-party model being reachable.
//
// The matcher is deliberately NARROW. The risk of guessing is the mirror image
// of the bug: reading "move the lighting rig into the truck" as a filing
// instruction would swallow a note the user wanted kept. So the thing being
// filed must be a PRONOUN or a quantifier — "these", "everything", "the photos"
// — never an arbitrary noun phrase. Anything else falls through to ingest,
// where the worst case is a note card the user can delete.
const FILE_VERB = '(?:put|file|move|drop|stick|throw|add|save|chuck)';
// What may sit between the verb and the preposition. Empty is fine ("file under
// X"); a real noun phrase is not.
const FILE_SUBJECT = '(?:the\\s+)?(?:these|this|those|them|it|all|both|everything|'
  + 'all\\s+of\\s+(?:them|these|it)|the\\s+(?:photos?|pics?|pictures?|images?|shots?|files?|lot))?';
const FILE_PREP = '(?:in|into|under|onto|on|to|inside)';

const FILE_RE = new RegExp(
  `^(?:(?:can|could|would)\\s+you\\s+|please\\s+|pls\\s+)*`
  + `${FILE_VERB}\\s+${FILE_SUBJECT}\\s*${FILE_PREP}\\s+(?:the\\s+)?(.+)$`, 'i',
);
// "these go in X" / "this belongs in X" — same instruction, no leading verb.
const FILE_RE_ALT = new RegExp(
  `^(?:these|this|those|they|it)\\s+(?:all\\s+)?(?:go(?:es)?|belong(?:s)?)\\s+`
  + `${FILE_PREP}\\s+(?:the\\s+)?(.+)$`, 'i',
);

// Strip the decoration people put around a board name: a trailing "board",
// surrounding quotes, and end punctuation. "the diner board." → "diner".
function cleanBoardName(s) {
  let v = String(s || '').trim()
    .replace(/^["'`“‘]+|["'`”’]+$/g, '')
    .replace(/[.!?,;:]+$/, '')
    .replace(/\s+board$/i, '')
    .trim();
  return v && v.length <= 60 ? v.slice(0, 48) : null;
}

// Returns { board } when the text is unmistakably a filing instruction, else null.
export function parseFileIntent(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 140) return null;      // a paragraph is content, not a command
  const m = FILE_RE.exec(t) || FILE_RE_ALT.exec(t);
  if (!m) return null;
  const board = cleanBoardName(m[1]);
  return board ? { board } : null;
}

// What we return when the model is unavailable, slow, or returns junk. Chosen so
// the user still gets a usable board: everything lands in their Bin under a
// label derived from their own words — unless the words are plainly a filing
// instruction, in which case they are honoured rather than pinned to the canvas.
export function fallbackIntent(text) {
  const t = String(text || '').trim();
  const filing = parseFileIntent(t);
  if (filing) {
    return {
      topic: null, action: 'file', board: filing.board, note: null, viaFallback: true,
    };
  }
  return {
    topic: t ? t.slice(0, 48) : null,
    action: 'ingest',
    board: null,
    note: null,
    viaFallback: true,
  };
}

const ACTIONS = new Set(['ingest', 'file', 'help']);

export async function extractIntent(env, { text, attachmentCount = 0 }) {
  const raw = String(text || '').trim();
  // Nothing to reason about — skip the call entirely rather than burn neurons
  // asking a model to label an empty string.
  if (!raw && attachmentCount === 0) return fallbackIntent('');
  if (!raw) return { topic: null, action: 'ingest', board: null, note: null };
  if (!env?.AI && !(env?.CF_ACCOUNT_ID && env?.CF_AI_TOKEN)) return fallbackIntent(raw);

  const user = [
    `Message: ${raw.slice(0, 800)}`,
    `Attachments: ${attachmentCount}`,
  ].join('\n');

  try {
    const out = await runChat(env, MODEL, SYSTEM, user, {
      max_tokens: 200, temperature: 0.1,
    });
    const parsed = parseJsonLoose(out);
    if (!parsed) return fallbackIntent(raw);

    const action = ACTIONS.has(parsed.action) ? parsed.action : 'ingest';
    return {
      topic: cleanLabel(parsed.topic),
      action,
      board: action === 'file' ? cleanLabel(parsed.board) : null,
      note: typeof parsed.note === 'string' && parsed.note.trim()
        ? parsed.note.trim().slice(0, 500)
        : null,
    };
  } catch (_) {
    // Binding missing, model overloaded, daily allocation exhausted — all the
    // same to the user, and all recoverable by falling back.
    return fallbackIntent(raw);
  }
}

function cleanLabel(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!s || s.toLowerCase() === 'null') return null;
  return s.slice(0, 48);
}

// Explicit slash commands are handled BEFORE the model runs — they're
// unambiguous, and routing them through an LLM would be both slower and a way
// to get them wrong. Returns null when the text isn't a command.
export function parseCommand(text) {
  const s = String(text || '').trim();
  if (!s.startsWith('/')) return null;
  const [, cmd, rest = ''] = s.match(/^\/(\w+)\s*([\s\S]*)$/) || [];
  if (!cmd) return null;
  const arg = rest.trim();
  switch (cmd.toLowerCase()) {
    case 'link':   return { command: 'link', arg };
    case 'board':  return { command: 'board', arg };
    // "what's waiting to be filed", not "switch to a board" — these were the
    // same thing when the Bin was a destination; now that it's a staging
    // collection they're different questions.
    case 'bin':
    case 'inbox':  return { command: 'bin', arg };
    case 'start':
    case 'help':   return { command: 'help', arg };
    case 'code':   return { command: 'code', arg };
    default:       return null;
  }
}
