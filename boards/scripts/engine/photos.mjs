// photos.mjs — real photos for a recipe's searches.
//
// Pexels first (its terms ban AI uploads, and its licence is free for ads),
// Unsplash when Pexels has nothing usable. Every photo is downloaded at 2400px
// and passes aicheck (~/soleil-social/lib/aicheck: the file, two detectors and
// Claude's look; fail closed) before it can go on a board; a rejected photo is
// replaced by the search's next one, for up to `rounds` rounds. No photo is
// used twice across boards: the engine passes the Pexels/Unsplash ids and the
// difference hashes of every photo already in the library.
//
// A video's still (Pexels' poster frame) is what aicheck looks at.

import sharp from 'sharp';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { downloadImage, downloadVideo, pingUnsplashDownload } from '../lib/imageSources.mjs';
import { PICK } from './pick.mjs';

export const PHOTO = Object.freeze({
  width: 2400, // the copy that goes on the board
  minEdge: 1800, // the original's long edge, at least
  perSearch: 15,
  dupBits: 6, // difference hashes this close are one photo
  videoMaxBytes: 16 * 1024 * 1024,
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 64-bit difference hash of a picture, as 16 hex digits. */
export async function dhash(file) {
  const px = await sharp(file, { limitInputPixels: 2e8 }).rotate().greyscale()
    .resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

export function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export const isDup = (hash, hashes, bits = PHOTO.dupBits) => hashes.some((h) => h && hamming(hash, h) <= bits);

export async function searchPexels(query, key, { perPage = PHOTO.perSearch } = {}) {
  const u = new URL('https://api.pexels.com/v1/search');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', String(perPage));
  const res = await fetch(u, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.photos || [])
    .filter((p) => Math.max(p.width || 0, p.height || 0) >= PHOTO.minEdge && p.src?.original)
    .map((p) => ({
      id: `pexels:${p.id}`, source: 'pexels', w: p.width, h: p.height,
      url: `${p.src.original}?auto=compress&cs=tinysrgb&w=${PHOTO.width}`,
      thumb: p.src.medium || `${p.src.original}?auto=compress&cs=tinysrgb&w=400`,
      alt: String(p.alt || query).slice(0, 200),
      credit: { source: 'Pexels', name: p.photographer || 'Pexels', link: p.photographer_url || 'https://www.pexels.com', page: p.url || null },
    }));
}

export async function searchUnsplash(query, key, { perPage = PHOTO.perSearch } = {}) {
  if (!key) return [];
  const u = new URL('https://api.unsplash.com/search/photos');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', String(perPage));
  u.searchParams.set('content_filter', 'high');
  const res = await fetch(u, { headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  if (!res.ok) throw new Error(`Unsplash ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.results || [])
    .filter((p) => Math.max(p.width || 0, p.height || 0) >= PHOTO.minEdge && p.urls?.raw && !p.premium)
    .map((p) => ({
      id: `unsplash:${p.id}`, source: 'unsplash', w: p.width, h: p.height,
      url: `${p.urls.raw}&w=${PHOTO.width}&fm=jpg&q=85`,
      thumb: p.urls.small || `${p.urls.raw}&w=400&fm=jpg&q=70`,
      alt: String(p.alt_description || p.description || query).slice(0, 200),
      downloadLocation: p.links?.download_location || null,
      credit: { source: 'Unsplash', name: p.user?.name || 'Unsplash', link: p.user?.links?.html || 'https://unsplash.com', page: p.links?.html || null },
    }));
}

export async function searchPexelsVideos(query, key) {
  const u = new URL('https://api.pexels.com/videos/search');
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', '12');
  const res = await fetch(u, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels videos ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  const out = [];
  for (const v of data.videos || []) {
    if (!v.duration || v.duration < 4 || v.duration > 30 || !v.image) continue;
    const file = (v.video_files || [])
      .filter((f) => (f.file_type || '').includes('mp4') && f.height >= 540 && f.height <= 1080)
      .sort((a, b) => a.height - b.height)[0];
    if (!file) continue;
    out.push({
      id: `pexels-video:${v.id}`, source: 'pexels', kind: 'video', w: file.width || v.width, h: file.height || v.height,
      url: file.link, poster: v.image, thumb: v.image, duration: v.duration, alt: query,
      credit: { source: 'Pexels', name: v.user?.name || 'Pexels', link: v.user?.url || 'https://www.pexels.com', page: v.url || null },
    });
  }
  return out;
}

const fileName = (cand, ext) => `${cand.id.replace(/[^a-z0-9]+/gi, '-')}.${ext}`;

async function fetchToDisk(cand, dir) {
  if (cand.kind === 'video') {
    const mp4 = join(dir, fileName(cand, 'mp4'));
    const still = join(dir, fileName(cand, 'jpg'));
    if (!existsSync(mp4)) {
      const v = await downloadVideo(cand.url, { maxBytes: PHOTO.videoMaxBytes });
      writeFileSync(mp4, v.bytes);
    }
    if (!existsSync(still)) writeFileSync(still, (await downloadImage(cand.poster)).bytes);
    return { file: still, video: mp4 };
  }
  const file = join(dir, fileName(cand, 'jpg'));
  if (!existsSync(file)) writeFileSync(file, (await downloadImage(cand.url)).bytes);
  return { file };
}

/**
 * A real photo (or video) for every picture and video item in the recipe.
 *   dir:    where the downloads go
 *   keys:   { pexels, unsplash }
 *   check:  aicheck's checkPhotos(items, opts) → [{ file, verdict, why, sha }]
 *   used:   { ids: Set of 'pexels:123'…, hashes: [hex…] } already in the library
 *   pick:   optional async (slots) → Map(key → [cand id…] best first) (pick.mjs): only
 *           picked candidates are tried, in that order; when it throws, search order
 * → { found: Map('si.ii' → photo), missing: ['si.ii'…], rejected: n }
 *   photo: { file, video?, w, h, sha, hash, id, source, alt, credit, why }
 */
export async function findPhotos(recipe, { dir, keys, check, used = { ids: new Set(), hashes: [] }, rounds = 3, pick = null, log = () => {} }) {
  mkdirSync(dir, { recursive: true });
  const wanted = [];
  (recipe.sections || []).forEach((s, si) => (s.items || []).forEach((it, ii) => {
    if (it.kind === 'picture' || it.kind === 'video') {
      wanted.push({ key: `${si}.${ii}`, kind: it.kind, search: it.search.trim(), section: s.name, caption: it.caption || '' });
    }
  }));

  const queue = new Map();
  for (const w of wanted) {
    let list = [];
    try {
      list = w.kind === 'video' ? await searchPexelsVideos(w.search, keys.pexels) : await searchPexels(w.search, keys.pexels);
      if (w.kind !== 'video' && list.length < 3) list = [...list, ...(await searchUnsplash(w.search, keys.unsplash))];
    } catch (e) { log(`photos: "${w.search}": ${e.message}`); }
    queue.set(w.key, list);
    await wait(250);
  }

  if (pick) {
    const slots = wanted.map((w) => ({ key: w.key, section: w.section, search: w.search, caption: w.caption,
      cands: (queue.get(w.key) || []).filter((c) => c.thumb && !used.ids.has(c.id)).slice(0, PICK.perSlot) }));
    try {
      const picked = await pick(slots);
      for (const w of wanted) {
        const ids = picked.get(w.key) || [];
        const list = queue.get(w.key) || [];
        queue.set(w.key, ids.map((id) => list.find((c) => c.id === id)).filter(Boolean));
      }
    } catch (e) { log(`photos: no picks (${e.message}); taking search order`); }
  }

  const found = new Map();
  const takenIds = new Set(used.ids);
  const boardHashes = [];
  let rejected = 0;
  for (let round = 0; round < rounds; round += 1) {
    const picks = [];
    for (const w of wanted) {
      if (found.has(w.key)) continue;
      const list = queue.get(w.key) || [];
      while (list.length) {
        const cand = list.shift();
        if (takenIds.has(cand.id)) continue;
        try {
          const disk = await fetchToDisk(cand, dir);
          const hash = await dhash(disk.file);
          if (isDup(hash, used.hashes) || isDup(hash, boardHashes)) continue;
          const meta = await sharp(disk.file).metadata();
          picks.push({ w, cand, ...disk, hash, dims: { w: meta.width, h: meta.height } });
          takenIds.add(cand.id);
          boardHashes.push(hash);
          break;
        } catch (e) { log(`photos: ${cand.id}: ${e.message}`); }
      }
    }
    if (!picks.length) break;
    log(`photos: round ${round + 1}: checking ${picks.length} photo(s)`);
    const results = await check(picks.map((p) => ({ file: p.file, source: p.cand.source, origW: p.cand.w, origH: p.cand.h, name: p.cand.id })), { log });
    const byFile = new Map(results.map((r) => [r.file, r]));
    for (const p of picks) {
      const r = byFile.get(p.file);
      if (r?.verdict === 'real') {
        const isVideo = p.cand.kind === 'video';
        found.set(p.w.key, {
          file: p.file, ...(isVideo ? { video: p.video } : {}),
          w: isVideo ? p.cand.w : p.dims.w, h: isVideo ? p.cand.h : p.dims.h,
          sha: r.sha, hash: p.hash, id: p.cand.id, source: p.cand.source, alt: p.cand.alt, credit: p.cand.credit,
          why: r.why || [], downloadLocation: p.cand.downloadLocation || null,
        });
      } else {
        rejected += 1;
        const i = boardHashes.indexOf(p.hash);
        if (i >= 0) boardHashes.splice(i, 1);
        log(`photos: ${p.cand.id} out (${r?.verdict || 'no verdict'}: ${(r?.why || []).slice(0, 2).join('; ')})`);
      }
    }
  }
  return { found, missing: wanted.filter((w) => !found.has(w.key)).map((w) => w.key), rejected };
}

// Unsplash asks for a ping when one of its photos is used.
export async function pingUsed(photos, keys) {
  for (const p of photos) if (p.source === 'unsplash' && p.downloadLocation) await pingUnsplashDownload(p.downloadLocation, keys.unsplash);
}
