// Scout — turning a voice memo into text.
//
// A voice memo is the most natural thing there is to send from a location:
// hands full, one bar of signal, talking about the thing you are standing in
// front of. Scout used to discard them outright (index.js dropped the `voice`
// content type before anything saw it), which meant the easiest message to send
// was the one message that did nothing.
//
// WHAT THE TRANSCRIPT IS FOR, and why it is not decoration: `cardIndexBody`
// (cardIndexRow.js:139) indexes a card's `body`, so a transcript written there
// makes the memo findable by its words — in ⌘K, in /api/v1 /search, on the
// public page, and in Scout's own search. An audio card with no transcript is a
// waveform you have to play to know what is in it, which on a board of forty is
// the same as lost.
//
// EVERY FAILURE IS SURVIVABLE. No credentials, model overloaded, unsupported
// container, silence — all return null, and the caller still writes the audio
// card. Losing a transcript is a degraded card. Throwing would lose the memo.

import { toTranscriptionAudio } from './ffmpeg.js';

// Two models, tried in order, because their request shapes differ and the
// documentation does not pin the encoding down. Rather than guess one and find
// out in production, we try the turbo model's JSON form first and fall back to
// the original's raw-binary form — between them they cover both conventions.
// Overridable so a model rename does not need a deploy of this file.
const PRIMARY = process.env.SCOUT_ASR_MODEL || '@cf/openai/whisper-large-v3-turbo';
const FALLBACK = process.env.SCOUT_ASR_FALLBACK_MODEL || '@cf/openai/whisper';

const TIMEOUT_MS = Number(process.env.SCOUT_ASR_TIMEOUT_MS || 60_000);
// Above this we do not even try. Workers AI caps the payload, and a memo this
// long is a recording session rather than a note.
const MAX_BYTES = Number(process.env.SCOUT_ASR_MAX_BYTES || 20 * 1024 * 1024);

// The two models disagree about where the text lives: one answers `text`, the
// other `transcription_info.text` plus a `segments` array. Read all three
// rather than pinning to one and getting an empty string when it changes.
function extractText(result) {
  if (!result || typeof result !== 'object') return null;
  const direct = result.text ?? result.transcription_info?.text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (Array.isArray(result.segments)) {
    const joined = result.segments.map((s) => s?.text || '').join(' ').trim();
    if (joined) return joined;
  }
  return null;
}

async function runModel(cfg, model, { body, contentType }) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.CF_ACCOUNT_ID}/ai/run/${model}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.CF_AI_TOKEN}`, 'content-type': contentType },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`${model} ${res.status}`);
  const j = await res.json();
  return extractText(j?.result);
}

/**
 * Transcribe voice bytes. Returns a string, or null for every failure mode
 * including "there were no words in it".
 */
export async function transcribeVoice(cfg, { bytes, mimeType, name }) {
  if (!cfg?.CF_ACCOUNT_ID || !cfg?.CF_AI_TOKEN) return null;
  if (!bytes?.length || bytes.length > MAX_BYTES) return null;

  // Normalize the container first — see toTranscriptionAudio for why an
  // untranscoded .caf comes back as an empty transcript rather than an error.
  const ext = String(name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1]
    || String(mimeType || '').split('/')[1]
    || 'm4a';
  const audio = await toTranscriptionAudio(bytes, ext) || Buffer.from(bytes);

  try {
    return await runModel(cfg, PRIMARY, {
      body: JSON.stringify({ audio: Buffer.from(audio).toString('base64'), task: 'transcribe' }),
      contentType: 'application/json',
    });
  } catch (primaryErr) {
    try {
      return await runModel(cfg, FALLBACK, {
        body: Buffer.from(audio),
        contentType: 'application/octet-stream',
      });
    } catch (fallbackErr) {
      console.error('[scout] transcription failed',
        `${PRIMARY}: ${primaryErr?.message}`, `${FALLBACK}: ${fallbackErr?.message}`);
      return null;
    }
  }
}

// A memo's opening clause, used as the batch label when nothing else named it —
// so a voice note titles its own section on the canvas instead of landing under
// a generic header.
//
// Cut at a sentence boundary where there is one within reach, because a header
// reading "the diner on third has a really good" is worse than a short one.
export function topicFromTranscript(text, max = 48) {
  const s = String(text || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s.length <= max) return s;
  const window = s.slice(0, max + 1);
  const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf(', '), window.lastIndexOf(' '));
  return (stop > 12 ? window.slice(0, stop) : window.slice(0, max)).replace(/[.,;:]$/, '').trim();
}
