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
import { layoutMoodboard, pushClearOf, withGeometry } from './moodboard.js';

// Collision safety lives in moodboard.js now (both layout paths need it and it
// must behave identically for each). Re-exported because it's part of this
// module's contract for callers that only compose ingest batches.
export { pushClearOf, withGeometry };

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

// `lab` is the photo's average colour in OKLab, computed once at ingest and
// carried ON THE CARD rather than in a database column. Cards are schema-free
// flat objects (see onboardingStarter.js), so this costs ~30 bytes, needs no
// migration, and — the reason that matters — travels with the card when it moves
// between boards, so filing can sort a moodboard without re-downloading and
// re-decoding every photo from R2.
export function buildImageCard({ key, width, height, alt, lab = null }) {
  const { w, h } = imageCardSize(width, height);
  const card = { id: uid('img'), kind: 'image', src: `r2:${key}`, alt: alt || null, w, h };
  if (lab && Number.isFinite(lab.L)) {
    card.lab = [round4(lab.L), round4(lab.a), round4(lab.b)];
  }
  return card;
}

const round4 = (n) => Math.round(Number(n) * 1e4) / 1e4;

// Read the OKLab triple back off a card. Returns null for anything that never
// had one — a note, a link, a photo whose decode failed, or a card the user
// added by hand in the app. orderByColor() puts those at the end of the block
// rather than dropping them.
export function cardColor(card) {
  const lab = card?.lab;
  if (!Array.isArray(lab) || lab.length < 3) return null;
  const [L, a, b] = lab.map(Number);
  return Number.isFinite(L) && Number.isFinite(a) && Number.isFinite(b) ? { L, a, b } : null;
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

// Re-position an existing set of cards as a colour-ordered moodboard on a
// DESTINATION board. This is the filing path: the cards already exist (they were
// sitting in the Bin), so nothing here mints ids or touches content — only x/y
// change, plus an optional titled band above the block.
//
// Ingest uses composeBatch (chronological, cheap, appended). Filing uses this.
// The split is deliberate: re-sorting on every arrival would make cards shuffle
// under the user while they watch the Bin, and the arrangement only becomes
// worth computing at the moment it lands somewhere permanent.
export function composeMoodboard({ existingCards = [], cards = [], topic = null }) {
  const list = (cards || []).filter(Boolean);
  if (!list.length) return [];

  // Carry the OKLab triple into the shape layoutMoodboard wants, without
  // mutating the card. Cards with no colour sort to the end, never dropped.
  const items = list.map((c) => {
    const color = cardColor(c);
    return color ? { ...c, color } : { ...c };
  });

  const header = topic ? buildSectionHeader(topic, null) : null;
  const reserve = header ? header.h + 24 : 0;
  const solid = withGeometry(existingCards);

  const laid = layoutMoodboard(solid, items, { gap: 24, reserveTop: reserve })
    // `color` was a layout input, not card state — don't persist it into the doc
    // alongside `lab`, which is the durable form.
    .map(({ color, ...card }) => card);

  if (!header) return laid;

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
