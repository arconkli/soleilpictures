// signedImage.js — a picture's address that works without a session, for an
// hour.
//
// A page that shows pictures to someone with no session (a draft's keep page;
// later the inline view in an AI chat) can't hand out R2's own addresses, so
// the Worker serves the bytes itself at /api/img/<payload>.<sig>. The payload
// names one R2 key and the second the address stops working; the signature is
// an HMAC of it, cut to 128 bits, under a secret derived from the service key
// (so nothing new is configured, and rotating that key retires every address).
// Only code that has already decided the viewer may see a key signs it: the
// signature is the whole check at the door.
//
// Pure: Web Crypto only, so it runs in the Worker and under node.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SIGNED_IMAGE_PATH = '/api/img/';
// Long enough to look around a board; a page that stays open asks again (the
// keep page refetches its bundle when a picture fails).
export const SIGNED_IMAGE_TTL_S = 60 * 60;
// A real payload is a key of a few dozen characters; this only bounds the work
// a forged one can cost.
const MAX_SIGNED = 2048;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const hmacKey = (bytes) =>
  crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

export async function imageSecret(serviceKey) {
  if (!serviceKey) throw new Error('signed images need SUPABASE_SERVICE_ROLE_KEY');
  const root = await hmacKey(enc.encode(serviceKey));
  return hmacKey(new Uint8Array(await crypto.subtle.sign('HMAC', root, enc.encode('soleil/img/v1'))));
}

async function mac(secret, payload) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', secret, enc.encode(payload))).slice(0, 16);
}

// expiresAt is in seconds since the epoch.
export async function signImageKey(secret, key, expiresAt) {
  if (typeof key !== 'string' || !key) throw new Error('signImageKey: no key');
  const payload = b64url(enc.encode(JSON.stringify({ k: key, e: expiresAt })));
  return `${payload}.${b64url(await mac(secret, payload))}`;
}

// → { key, expiresAt }, or null: malformed, signed with another secret, or past
// its time. The comparison takes as long whichever byte differs.
export async function verifySignedImage(secret, signed, nowS = Math.floor(Date.now() / 1000)) {
  if (typeof signed !== 'string' || signed.length > MAX_SIGNED) return null;
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = signed.slice(0, dot);
  let given;
  try { given = fromB64url(signed.slice(dot + 1)); } catch { return null; }
  const want = await mac(secret, payload);
  if (given.length !== want.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want[i] ^ given[i];
  if (diff !== 0) return null;
  let p;
  try { p = JSON.parse(dec.decode(fromB64url(payload))); } catch { return null; }
  if (!p || typeof p.k !== 'string' || !p.k || !Number.isInteger(p.e) || p.e <= nowS) return null;
  return { key: p.k, expiresAt: p.e };
}

// What a stored file goes out as. A board's files are not all pictures (a video
// card plays its file), so pictures, video and sound go out as R2 recorded them,
// or by their extension; anything else (a PDF, a page, a script) as bytes to
// save, which no browser runs on this origin.
const MEDIA_TYPE = /^(?:image|video|audio)\/[a-z0-9.+-]+$/i;
const BY_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
};
export function servedTypeFor(key, recorded) {
  if (typeof recorded === 'string' && MEDIA_TYPE.test(recorded)) return { type: recorded, inline: true };
  const ext = String(key).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const type = BY_EXTENSION[ext];
  return type ? { type, inline: true } : { type: 'application/octet-stream', inline: false };
}
