// Scout — turning an ingested burst into canvas cards.
//
// Everything here is DETERMINISTIC. The model upstream decided what the batch
// is *about*; this file decides what cards exist and where they sit, so the
// spatial result is reproducible and debuggable.
//
// Reuses the app's own primitives rather than reinventing them:
//   detectEmbed()        — YouTube/Vimeo/TikTok/Spotify/Instagram/Twitter rich
//                          cards, so a texted video link becomes a real embed
//                          instead of a blue hyperlink (oembed.js:158)
//   arrangeInFreeSpace() — masonry packing anchored strictly BELOW existing
//                          content, so a drop can never overlap what's already
//                          on the canvas (canvasGeom.js:36)

import { detectEmbed } from './oembed.js';
import { arrangeInFreeSpace } from './canvasGeom.js';

// Scout photos are laid out as a CONTACT SHEET, not as individually dropped
// images. A single drag-and-drop image gets up to 1200px (App.jsx:1552), but a
// texted burst of twelve is a different object: twelve 1200px slabs bury the
// board. It also has to be true that cards fit inside arrangeInFreeSpace's grid
// cells, which are clamped to 320×300 (canvasGeom.js:62) — anything larger
// overflows its cell and collides with its neighbours.
const IMG_BOX_W = 320;
const IMG_BOX_H = 300;
const MIN_IMG = 80;

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Notes carry `html` (Tiptap-shaped). Paragraph-per-line, escaped — inbound
// text is untrusted and lands verbatim on a canvas other people may view.
export function textToNoteHtml(text) {
  const lines = String(text || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return '<p></p>';
  return lines.map((l) => `<p>${escapeHtml(l).replace(/\n/g, '<br>')}</p>`).join('');
}

// Aspect-preserving fit into the contact-sheet box. Never upscales — a small
// image stays small rather than becoming a blurry 320px tile.
export function imageCardSize(width, height, box = {}) {
  const maxW = box.maxW ?? IMG_BOX_W;
  const maxH = box.maxH ?? IMG_BOX_H;
  const min = box.min ?? MIN_IMG;
  const w0 = Number(width) || 0;
  const h0 = Number(height) || 0;
  // Some inbound media reports no dimensions at all; a sane default beats NaN.
  if (!w0 || !h0) return { w: 280, h: 210 };

  const scale = Math.min(maxW / w0, maxH / h0, 1);
  let w = Math.max(1, Math.round(w0 * scale));
  let h = Math.max(1, Math.round(h0 * scale));

  // A panorama or a letterbox crop can fit the box while being an ungrabbable
  // 3px sliver. Bump the short edge, then re-clamp to the box — that sacrifices
  // exact aspect on extreme ratios, which is the right trade against a card the
  // user cannot select or a card that overflows its cell and collides.
  if (Math.min(w, h) < min) {
    const up = min / Math.min(w, h);
    w = Math.min(maxW, Math.round(w * up));
    h = Math.min(maxH, Math.round(h * up));
  }
  return { w, h };
}

const URL_RE = /https?:\/\/[^\s)\]>]+/gi;

export function extractUrls(text) {
  const out = [];
  const seen = new Set();
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

// Strip the URLs back out so the note card doesn't repeat what the link cards
// already show.
export function textWithoutUrls(text) {
  return String(text || '').replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
}

let seq = 0;
function uid(prefix) {
  seq = (seq + 1) % 1e6;
  return `${prefix}-${Date.now()}-${seq}-${Math.floor(Math.random() * 1e6)}`;
}

export function buildImageCard({ key, width, height, alt }) {
  const { w, h } = imageCardSize(width, height);
  return { id: uid('img'), kind: 'image', src: `r2:${key}`, alt: alt || null, w, h };
}

// A texted link becomes an embed when we recognise the provider, otherwise a
// preview card seeded with the hostname (og metadata fills in behind it).
export function buildLinkCard(url, preview = null) {
  const embed = detectEmbed(url);
  const card = { id: uid('link'), kind: 'link', source: url, link: url };
  if (embed) {
    card.embed = embed;
    // Provider defaults vary wildly (a Twitter embed is 480×520, oembed.js:149)
    // and anything over the contact-sheet box overflows its grid cell. Fit it,
    // preserving the provider's aspect so the iframe isn't letterboxed.
    const fitted = imageCardSize(embed.defaultW, embed.defaultH);
    card.w = fitted.w;
    card.h = fitted.h;
    card.title = preview?.title || '';
    return card;
  }
  let title = url;
  try { title = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { /* keep url */ }
  card.title = preview?.title || title;
  if (preview?.description) card.description = preview.description;
  if (preview?.favicon) card.favicon = preview.favicon;
  if (preview?.image) {
    card.image = preview.image;
    card.w = 280; card.h = 290;
  } else {
    card.w = 280; card.h = 110;
  }
  return card;
}

export function buildNoteCard(text) {
  return { id: uid('note'), kind: 'note', html: textToNoteHtml(text), w: 280, h: 160 };
}

// A full-width labelled band above the batch. Section headers are how generated
// boards already express structure (see cardEncode.mjs:222) — card_index mirrors
// meta.sectionHeader, which the public /c/<slug> page turns into an H2.
export function buildSectionHeader(topic, subtitle) {
  return {
    id: uid('sec'),
    kind: 'note',
    sectionHeader: true,
    span: 'full',
    html: `<p><strong>${escapeHtml(topic)}</strong></p>`,
    ...(subtitle ? { sub: String(subtitle).slice(0, 300) } : null),
    w: 640,
    h: 72,
  };
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Only cards with real, finite geometry can participate in collision math. A
// card carrying NaN or a missing width would poison boundsOfCards() and make
// every subsequent placement garbage — and such a card can't render anyway.
function withGeometry(cards) {
  return (cards || []).filter((c) => (
    Number.isFinite(c?.x) && Number.isFinite(c?.y)
    && Number.isFinite(c?.w) && Number.isFinite(c?.h)
    && c.w > 0 && c.h > 0
  ));
}

// HARD GUARANTEE that an ingest never lands on top of existing work.
//
// arrangeInFreeSpace already anchors below the bounding box of what it was
// given, which is correct — but only as correct as its inputs. A card the
// caller filtered out, a stale read, or a collaborator adding cards between our
// read and our write can all leave a new card sitting on someone's existing
// one, and a bot write has no undo story. So after laying out, we verify, and
// push the whole batch down until nothing intersects.
//
// Shifting the batch as ONE unit preserves the grid the layout just produced.
// Monotonic (shift only ever grows) and iteration-bounded, so it always
// terminates even against pathological input.
export function pushClearOf(existing, placed, gap = 24) {
  const solid = withGeometry(existing);
  if (!solid.length || !placed.length) return placed;

  let shift = 0;
  for (let pass = 0; pass < 64; pass++) {
    let push = 0;
    for (const card of placed) {
      const rect = { x: card.x, y: card.y + shift, w: card.w, h: card.h };
      for (const e of solid) {
        if (overlaps(rect, e)) push = Math.max(push, (e.y + e.h + gap) - rect.y);
      }
    }
    if (push <= 0) break;
    shift += push;
  }
  return shift > 0 ? placed.map((c) => ({ ...c, y: Math.round(c.y + shift) })) : placed;
}

// Compose a whole burst into positioned cards.
//
//   existingCards — what's already on the board (for non-overlap anchoring)
//   images        — [{ key, width, height, alt }] already uploaded to R2
//   urls          — [{ url, preview }]
//   noteText      — leftover prose worth keeping, or null
//   topic         — label for the batch, or null for no section header
//
// Order is deliberate: header, then photos, then links, then the note — so the
// note lands nearest the imagery it refers to, which is what the outline meant
// by placing a reminder "contextually near the diner scout photos".
export function composeBatch({ existingCards = [], images = [], urls = [], noteText = null, topic = null }) {
  const batch = [];
  if (topic && (images.length || urls.length || noteText)) {
    batch.push(buildSectionHeader(topic, null));
  }
  for (const img of images) batch.push(buildImageCard(img));
  for (const u of urls) batch.push(buildLinkCard(u.url, u.preview));
  if (noteText) batch.push(buildNoteCard(noteText));
  if (!batch.length) return [];

  // The header is a full-width band that sits ABOVE the grid rather than
  // participating in it. RESERVE its room up front by pushing the body down —
  // trying to squeeze it above afterwards collides on an empty board, where the
  // body already starts at the top margin.
  const header = batch[0]?.sectionHeader ? batch.shift() : null;
  const reserve = header ? header.h + 24 : 0;
  // Sanitize first: one card with NaN geometry would otherwise poison
  // boundsOfCards() and place the whole batch somewhere arbitrary.
  const solid = withGeometry(existingCards);
  const laid = arrangeInFreeSpace(solid, batch, {
    gap: 24,
    startBelowGap: 64 + reserve,
    margin: 80 + reserve,
  });
  if (!header) return pushClearOf(solid, laid);

  // Position the header over the laid-out batch, then clear the WHOLE group as
  // one unit. Clearing them separately would be wrong: pushClearOf only moves
  // down, so a colliding header would be shoved into its own batch.
  const minX = Math.min(...laid.map((c) => c.x));
  const minY = Math.min(...laid.map((c) => c.y));
  const maxRight = Math.max(...laid.map((c) => c.x + c.w));
  const headerCard = {
    ...header,
    x: minX,
    y: Math.max(8, minY - reserve),
    w: Math.max(320, maxRight - minX),
  };
  return pushClearOf(solid, [headerCard, ...laid]);
}
