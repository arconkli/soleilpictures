// What Info says about a thing — a card, a cluster, a selection, a group — as
// plain rows, so the Info panel, the Info drawer and the tests all read one
// source. Pure: no React, no Yjs, no Supabase. People come back as user ids;
// the panel turns them into names (lib/userProfiles.js).
//
//   details  [{ k, v, title? }]          — what it is: kind, format, size…
//   people   [{ k, by, at }]             — who uploaded / added / changed it, when
//
// Uploaded and Added are different facts. "Uploaded" is the file's own row in
// the images table (who put the bytes in storage, and when) — it survives a
// copy into another cluster. "Added" is the card's create stamp (stampCreate in
// App.jsx) — who put it in THIS cluster. When they're the same person a moment
// apart, Info says it once.

import { TYPE_LABELS, noteParts } from './listItem.js';
import { formatLabel, formatKey } from './loopMeta.js';

// The kinds whose card holds a stored file, and the field that holds its key.
export const FILE_FIELD = { image: 'src', video: 'src', audio: 'src', pdf: 'pdfSrc', file: 'fileSrc' };

export function isFileCard(card) {
  return !!card && Object.prototype.hasOwnProperty.call(FILE_FIELD, card.kind);
}

// The storage key (no r2: prefix) of the file a card holds, or ''.
export function fileKeyOf(card) {
  if (!isFileCard(card)) return '';
  const raw = card[FILE_FIELD[card.kind]] || (card.kind === 'pdf' ? card.src : '');
  const s = String(raw || '');
  return s.startsWith('r2:') ? s.slice(3) : '';
}

export function formatSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(bytes), i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

// 0:07 · 4:05 · 1:02:03 — a length, not a clock, so no leading zero hours.
export function formatLength(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// 23.976 fps from [24000, 1001]; 25 fps from [25, 1]. A plain number works too.
export function formatFps(fps) {
  let v = null;
  if (Array.isArray(fps) && fps.length === 2 && fps[1]) v = fps[0] / fps[1];
  else if (Number.isFinite(fps)) v = fps;
  if (!Number.isFinite(v) || v <= 0) return '';
  const r = Math.round(v * 1000) / 1000;
  return `${Number.isInteger(r) ? r : r.toFixed(3).replace(/0+$/, '')} fps`;
}

const CODEC_NAMES = {
  avc1: 'H.264', avc3: 'H.264', hvc1: 'HEVC (H.265)', hev1: 'HEVC (H.265)', av01: 'AV1',
  vp08: 'VP8', vp09: 'VP9', mp4v: 'MPEG-4', apch: 'ProRes 422 HQ', apcn: 'ProRes 422',
  apcs: 'ProRes 422 LT', apco: 'ProRes 422 Proxy', ap4h: 'ProRes 4444', ap4x: 'ProRes 4444 XQ',
  mp4a: 'AAC', opus: 'Opus', 'ac-3': 'Dolby Digital', 'ec-3': 'Dolby Digital Plus',
  lpcm: 'PCM', sowt: 'PCM', twos: 'PCM', in24: 'PCM', in32: 'PCM', fl32: 'PCM', alac: 'Apple Lossless',
};
export function codecName(fourcc) {
  if (!fourcc) return '';
  const k = String(fourcc).toLowerCase();
  return CODEC_NAMES[k] || String(fourcc).toUpperCase();
}

function channelsLabel(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return `${n} channels`;
}

function rateLabel(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return '';
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}

function dims(w, h) {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${Math.round(w)} × ${Math.round(h)}` : '';
}

function hostOf(url) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); }
  catch (_) { return ''; }
}

function wordCount(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

const PLURALS = {
  image: ['image', 'images'], video: ['video', 'videos'], audio: ['audio file', 'audio files'],
  pdf: ['PDF', 'PDFs'], file: ['file', 'files'], note: ['note', 'notes'], link: ['link', 'links'],
  doc: ['doc', 'docs'], palette: ['palette', 'palettes'], schedule: ['schedule', 'schedules'],
  shape: ['shape', 'shapes'], grid: ['grid', 'grids'], board: ['cluster', 'clusters'],
  boardlink: ['linked cluster', 'linked clusters'],
};
function countLabel(kind, n) {
  const [one, many] = PLURALS[kind] || [String(kind || 'item'), `${kind || 'item'}s`];
  return `${n} ${n === 1 ? one : many}`;
}

// "8 images, 3 videos, 1 note" — most common first, then by kind name.
export function kindBreakdown(cards) {
  const counts = new Map();
  for (const c of cards || []) {
    if (!c) continue;
    counts.set(c.kind, (counts.get(c.kind) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
    .map(([k, n]) => countLabel(k, n))
    .join(', ');
}

// The byte size of one card's file: the card's own sizeBytes, then its
// version entry, then the images row (getMeta). null when nobody knows yet.
export function sizeOf(card, getMeta = null) {
  if (!card) return null;
  if (Number.isFinite(card.sizeBytes)) return card.sizeBytes;
  const key = fileKeyOf(card);
  if (!key || !getMeta) return null;
  const m = getMeta(key);
  const v = m?.sizeBytes ?? m?.size_bytes;
  return Number.isFinite(v) ? v : null;
}

function kindLabelOf(card) {
  if (!card) return 'Item';
  if (card.kind === 'board') return 'Cluster';
  if (card.kind === 'boardlink') return 'Linked cluster';
  if (card.kind === 'doc') return 'Document';
  return TYPE_LABELS[card.kind] || (card.kind ? card.kind[0].toUpperCase() + card.kind.slice(1) : 'Item');
}

function formatOf(card) {
  if (!isFileCard(card)) return '';
  if (card.kind === 'pdf') return 'PDF';
  return formatLabel({ ext: card.ext || extOfName(card.fileName), mime: card.mime, src: card[FILE_FIELD[card.kind]] });
}
function extOfName(name) {
  const m = String(name || '').match(/\.([a-z0-9]{1,6})$/i);
  return m ? m[1] : '';
}

// Two stamps "the same moment" — an upload and the card it made.
function sameMoment(a, b, ms = 120000) {
  const ta = Date.parse(a || ''), tb = Date.parse(b || '');
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= ms;
}

function pushRow(rows, k, v, title) {
  if (v == null || v === '' || v === false) return;
  rows.push(title ? { k, v: String(v), title } : { k, v: String(v) });
}

// ── One card ───────────────────────────────────────────────────────────────
//   opts.getMeta(key)  → images-row metadata (imageMeta.getMeta)
//   opts.boards        → board map, for cluster names
//   opts.gridTemplates → for a linked grid's template name
export function describeCard(card, { getMeta = null, boards = {}, gridTemplates = {} } = {}) {
  if (!card) return { kindLabel: 'Item', format: '', details: [], people: [] };
  const kind = card.kind;
  const key = fileKeyOf(card);
  const meta = key && getMeta ? getMeta(key) : null;
  const media = card.media && typeof card.media === 'object' ? card.media : null;
  const kindLabel = kindLabelOf(card);
  const format = formatOf(card);
  const details = [];

  pushRow(details, 'Kind', format && format !== kindLabel ? `${kindLabel} · ${format}` : kindLabel);

  // The file's own name, when the card shows a different one (a title, a
  // rename) — the name it was uploaded with is what someone searches for.
  const fileName = card.fileName || meta?.originalName || '';
  if (isFileCard(card) && fileName) pushRow(details, 'File name', fileName);

  switch (kind) {
    case 'image':
      pushRow(details, 'Dimensions', dims(media?.w ?? meta?.w, media?.h ?? meta?.h));
      break;
    case 'video': {
      pushRow(details, 'Resolution', dims(media?.w ?? meta?.w, media?.h ?? meta?.h));
      const dur = media?.dur ?? (Number.isFinite(card.duration) ? card.duration : null);
      pushRow(details, 'Duration', formatLength(dur));
      pushRow(details, 'Frame rate', media?.fps ? `${formatFps(media.fps)}${media.vfr ? ' (variable)' : ''}` : '');
      pushRow(details, 'Codec', [codecName(media?.codec), media?.prof].filter(Boolean).join(' · '));
      if (media?.tc?.start) pushRow(details, 'Start timecode', media.tc.start);
      if (media?.audio) {
        pushRow(details, 'Audio', [codecName(media.audio.codec), rateLabel(media.audio.rate), channelsLabel(media.audio.ch)].filter(Boolean).join(' · '));
      } else if (media?.probed) {
        pushRow(details, 'Audio', 'None');
      }
      break;
    }
    case 'audio':
      pushRow(details, 'Length', formatLength(card.duration));
      pushRow(details, 'Tempo', Number.isFinite(card.bpm) ? `${card.bpm} BPM` : '');
      pushRow(details, 'Key', formatKey(card.musicalKey));
      pushRow(details, 'Sample rate', rateLabel(card.sampleRate));
      pushRow(details, 'Channels', channelsLabel(card.channels));
      break;
    case 'pdf':
      pushRow(details, 'Pages', Number.isFinite(card.pageCount) && card.pageCount > 0 ? String(card.pageCount) : '');
      break;
    case 'file':
      pushRow(details, 'Type', card.mime || '');
      break;
    case 'note': {
      const { title, body } = noteParts(card.html, card.body);
      const words = wordCount(`${title} ${body}`);
      pushRow(details, 'Words', words ? String(words) : '0');
      break;
    }
    case 'link': {
      const url = card.link || card.source || '';
      pushRow(details, 'Site', hostOf(url));
      pushRow(details, 'Address', url, url);
      break;
    }
    case 'doc':
      pushRow(details, 'Lines', Array.isArray(card.lines) ? String(card.lines.length) : '');
      break;
    case 'palette': {
      const hexes = (card.swatches || []).map((s) => s?.hex).filter(Boolean);
      pushRow(details, 'Colors', hexes.length ? `${hexes.length} — ${hexes.slice(0, 8).join(' ')}${hexes.length > 8 ? ' …' : ''}` : '0');
      break;
    }
    case 'shape':
      pushRow(details, 'Shape', card.shape || 'rect');
      break;
    case 'grid': {
      const cells = card.cells && typeof card.cells === 'object' ? Object.keys(card.cells).length : null;
      pushRow(details, 'Filled cells', Number.isFinite(cells) ? String(cells) : '');
      if (card.templateId) {
        const name = gridTemplates?.[card.templateId]?.name;
        pushRow(details, 'Layout', name ? `Linked to “${name}”` : 'Linked to a shared layout');
      }
      break;
    }
    case 'board':
      pushRow(details, 'Cluster', boards[card.id]?.name || card.name || '');
      break;
    case 'boardlink':
      pushRow(details, 'Links to', boards[card.target]?.name || card.name || '');
      break;
    default:
      break;
  }

  if (isFileCard(card)) pushRow(details, 'Size', formatSize(sizeOf(card, getMeta)));

  // Who, and when.
  const people = [];
  const up = meta && (meta.uploadedBy || meta.uploadedAt) ? { by: meta.uploadedBy || null, at: meta.uploadedAt || null } : null;
  const added = card.createdBy || card.createdAt ? { by: card.createdBy || null, at: card.createdAt || null } : null;
  if (up) people.push({ k: 'Uploaded', ...up });
  if (added && !(up && (up.by === added.by || !added.by) && sameMoment(up.at, added.at))) {
    people.push({ k: up ? 'Added here' : 'Added', ...added });
  }
  if (card.updatedAt && !sameMoment(card.updatedAt, card.createdAt, 1000)) {
    people.push({ k: 'Modified', by: card.updatedBy || null, at: card.updatedAt });
  }

  return { kindLabel, format, details, people };
}

// ── Several cards ──────────────────────────────────────────────────────────
export function describeSelection(cards, { getMeta = null } = {}) {
  const list = (cards || []).filter(Boolean);
  const details = [];
  pushRow(details, 'Items', String(list.length));
  pushRow(details, 'Kinds', kindBreakdown(list));
  const files = list.filter(isFileCard);
  if (files.length) {
    let total = 0, known = 0;
    for (const c of files) {
      const s = sizeOf(c, getMeta);
      if (Number.isFinite(s)) { total += s; known++; }
    }
    if (known) pushRow(details, 'Size', `${formatSize(total)}${known < files.length ? ` (${known} of ${files.length} files)` : ''}`);
  }
  const off = list.filter((c) => c.unplaced === true).length;
  if (off) pushRow(details, 'Not on board', String(off));
  const times = list.map((c) => Date.parse(c.createdAt || '')).filter(Number.isFinite).sort((a, b) => a - b);
  const people = [];
  if (times.length) {
    people.push({ k: 'Oldest', by: null, at: new Date(times[0]).toISOString() });
    if (times.length > 1 && times[times.length - 1] !== times[0]) {
      people.push({ k: 'Newest', by: null, at: new Date(times[times.length - 1]).toISOString() });
    }
  }
  return { title: `${list.length} item${list.length === 1 ? '' : 's'}`, subtitle: kindBreakdown(list), details, people };
}

// ── A cluster ──────────────────────────────────────────────────────────────
//   opts.cards → its cards, when the cluster is open (counts and size)
export function clusterPath(boards, id) {
  const names = [];
  const seen = new Set();
  let b = boards?.[id];
  while (b && b.parent_board_id && !seen.has(b.id)) {
    seen.add(b.id);
    b = boards[b.parent_board_id];
    if (b) names.unshift(b.name);
  }
  return names.join(' / ');
}

export function describeCluster(board, { boards = {}, cards = null, getMeta = null } = {}) {
  if (!board) return { title: 'Cluster', subtitle: '', details: [], people: [] };
  const details = [];
  pushRow(details, 'Kind', 'Cluster');
  pushRow(details, 'Inside', clusterPath(boards, board.id) || (board.parent_board_id ? '' : 'Top level'));
  const subs = Object.values(boards || {}).filter((b) => b && b.parent_board_id === board.id && !b.deleted_at).length;
  pushRow(details, 'Clusters inside', String(subs));
  if (Array.isArray(cards)) {
    const items = cards.filter((c) => c && c.kind !== 'board' && c.kind !== 'boardlink');
    const files = items.filter(isFileCard);
    pushRow(details, 'Items', String(items.length));
    if (items.length) pushRow(details, 'Kinds', kindBreakdown(items));
    if (files.length) {
      let total = 0, known = 0;
      for (const c of files) { const s = sizeOf(c, getMeta); if (Number.isFinite(s)) { total += s; known++; } }
      if (known) pushRow(details, 'Files', `${files.length} · ${formatSize(total)}${known < files.length ? ' so far' : ''}`);
      else pushRow(details, 'Files', String(files.length));
    }
    const off = items.filter((c) => c.unplaced === true).length;
    if (off) pushRow(details, 'Not on board', String(off));
  } else if (Number.isFinite(board.card_count)) {
    pushRow(details, 'Items', String(board.card_count));
  }
  pushRow(details, 'Opens as', board.view === 'list' ? 'Files' : 'Board');
  const people = [];
  if (board.created_by || board.created_at) people.push({ k: 'Created', by: board.created_by || null, at: board.created_at || null });
  if (board.updated_at && !sameMoment(board.updated_at, board.created_at, 1000)) people.push({ k: 'Modified', by: null, at: board.updated_at });
  return { title: board.name || 'Cluster', subtitle: 'Cluster', details, people };
}

// ── A canvas group ─────────────────────────────────────────────────────────
export function describeGroup(group, members) {
  const list = (members || []).filter(Boolean);
  const details = [];
  pushRow(details, 'Kind', 'Group');
  pushRow(details, 'Members', String(list.length));
  if (list.length) pushRow(details, 'Kinds', kindBreakdown(list));
  const people = [];
  if (group?.createdBy || group?.createdAt) people.push({ k: 'Created', by: group.createdBy || null, at: group.createdAt || null });
  return { title: group?.name || group?.label || 'Group', subtitle: 'Group', details, people };
}

// "Oct 8, 2026, 2:02 PM" — an absolute time beside the relative one, because
// "when was this uploaded" means a date, not "3w ago".
// A time before this is a placeholder (a zero timestamp), not a real date.
const EARLIEST_REAL = Date.UTC(2001, 0, 1);
export function formatWhen(iso, locale = undefined) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t) || t < EARLIEST_REAL) return '';
  try {
    return new Date(t).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return new Date(t).toISOString();
  }
}
