// The first bytes of a stored file, for a page that draws what the file
// says. One GET with a Range (R2's CORS allows it), and the stream is
// cancelled at `max` even when a server answers with the whole file, so a
// 2 GB log costs a card 64 KB.

export async function readHead(url, max, { signal, fetchImpl = fetch, size } = {}) {
  if (size === 0) return { bytes: new Uint8Array(0), complete: true };
  const known = Number.isFinite(size) && size >= 0;
  const headers = known && size <= max ? undefined : { Range: `bytes=0-${max - 1}` };
  const res = await fetchImpl(url, { headers, signal });
  if (res.status === 416) return { bytes: new Uint8Array(0), complete: true };
  if (!res.ok) throw new Error(`head ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  let ended = false;
  while (got < max) {
    const { done, value } = await reader.read();
    if (done) { ended = true; break; }
    parts.push(value);
    got += value.byteLength;
  }
  if (!ended) reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(got, max));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.byteLength, bytes.length - at);
    bytes.set(take === p.byteLength ? p : p.subarray(0, take), at);
    at += take;
    if (at >= bytes.length) break;
  }
  return { bytes, complete: known ? bytes.length >= size : ended };
}

// Binary, not text: a NUL anywhere in the first 4 KB, or more than one byte
// in ten a control character other than tab, LF, VT, FF or CR.
export function looksBinary(bytes) {
  const n = Math.min(bytes.length, 4096);
  let ctrl = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bytes[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) ctrl += 1;
  }
  return n > 0 && ctrl / n > 0.1;
}

// Text from a head: its BOM decides UTF-8 or UTF-16; a file that isn't
// valid UTF-8 is read as Windows-1252, as an old export usually is. A head
// cut mid-character drops that character instead of drawing a ?.
export function decodeText(bytes, { complete = true } = {}) {
  if (!bytes) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2), { stream: !complete });
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2), { stream: !complete });
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (looksBinary(body)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body, { stream: !complete });
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}
