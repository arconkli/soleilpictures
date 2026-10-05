// Day types — what KIND of day a dated cluster is, and what colour it gets.
//
// A production calendar's job is to make the shape of a schedule legible: three
// weeks of prep, eight weeks of production with a hiatus in the middle, two
// weeks of wrap. That shape is carried by hue. Before this, hue meant
// published/draft/cancelled — a workflow state, so mid-shoot the entire calendar
// was one wall of green and told you nothing. Status is now a quiet mark on the
// row and colour is free to do the job it is good at.
//
// WHY THIS IS DATA AND NOT AN ENUM. The app is for creative production
// generally. Film says prep / shoot / travel / hiatus / wrap; a game studio says
// sprint / playtest / milestone / freeze / ship; a photo studio says scout /
// shoot / edit / deliver. Hardcoding any one of those vocabularies would make
// the feature belong to one industry. So the palette is a per-production list
// of {id, name, color} on boards.day_types (0247), a dated day references one by
// slug, and the names below are only a starting point that any team can rename.
//
// Deliberately NOT in the palette: amber/orange, because --soleil is reserved
// for active/selection/focus and a resting day tinted gold would read as
// selected; and red, which is reserved for a cancelled day.

// Hues are lifted from TAG_PALETTE (lib/tagColor.js) so the app has one colour
// vocabulary rather than two. Only 'off' is outside it — a day nobody works is
// the one day that should recede, and a saturated hue cannot recede.
export const DEFAULT_DAY_TYPES = Object.freeze([
  Object.freeze({ id: 'prep',      name: 'Prep',       color: '#a78bfa' }),
  Object.freeze({ id: 'main',      name: 'Production', color: '#4f8df8' }),
  Object.freeze({ id: 'travel',    name: 'Travel',     color: '#22d3ee' }),
  Object.freeze({ id: 'off',       name: 'Off',        color: '#6a6a70' }),
  Object.freeze({ id: 'wrap',      name: 'Wrap',       color: '#10b981' }),
  Object.freeze({ id: 'milestone', name: 'Milestone',  color: '#ec4899' }),
]);

// A production laid out by "Add days…" gets this one, because the overwhelming
// majority of dated clusters someone creates are the working days themselves.
export const DEFAULT_DAY_TYPE = 'main';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_TYPES = 12;

// Normalise one palette entry, or null if it can't be trusted. day_types is
// client-writable (0247 grants it, because names and colours gate nothing), so
// this is the boundary that keeps a hand-edited PATCH from reaching the DOM as
// a style attribute.
function cleanType(t) {
  if (!t || typeof t !== 'object') return null;
  const id = typeof t.id === 'string' ? t.id.trim().slice(0, 64) : '';
  if (!id) return null;
  const name = (typeof t.name === 'string' && t.name.trim())
    ? t.name.trim().slice(0, 64) : id;
  // An unrecognised colour falls back to neutral rather than being dropped: the
  // type still exists and days still group by it, they just aren't tinted.
  const color = (typeof t.color === 'string' && HEX_RE.test(t.color.trim()))
    ? t.color.trim().toLowerCase() : null;
  return { id, name, color };
}

// The palette for a production. `board` is the PARENT cluster — the one the
// dated days hang off. NULL day_types means "the defaults", so an existing
// production gets sensible colour with no backfill and no write.
export function dayTypesFor(board) {
  const raw = board?.day_types;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_DAY_TYPES;
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const c = cleanType(t);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= MAX_TYPES) break;
  }
  return out.length ? out : DEFAULT_DAY_TYPES;
}

// The type a day is, or null. A slug whose entry was renamed away resolves to
// null and the day renders neutral — a deleted palette entry must not orphan
// the days that referenced it.
export function resolveDayType(slug, types) {
  if (!slug) return null;
  return (types || DEFAULT_DAY_TYPES).find((t) => t.id === slug) || null;
}

// The colour to paint, or null for "no tint". Cancelled always wins: a day that
// isn't happening should not still be flying its phase colour.
export function dayTypeColor(board, types) {
  if (!board || board.sched_status === 'cancelled') return null;
  return resolveDayType(board.day_type, types)?.color || null;
}

// Human label for a day's type, for the row's second line and the type picker.
export function dayTypeName(board, types) {
  return resolveDayType(board?.day_type, types)?.name || '';
}

// What to persist. Returns null when the palette is unchanged from the
// defaults, so we write a row only once a production has actually customised
// something — see the NULL-means-defaults note above.
export function serializeDayTypes(types) {
  const clean = (Array.isArray(types) ? types : [])
    .map(cleanType).filter(Boolean).slice(0, MAX_TYPES);
  if (!clean.length) return null;
  const same = clean.length === DEFAULT_DAY_TYPES.length
    && clean.every((t, i) => t.id === DEFAULT_DAY_TYPES[i].id
      && t.name === DEFAULT_DAY_TYPES[i].name
      && t.color === DEFAULT_DAY_TYPES[i].color);
  return same ? null : clean;
}
