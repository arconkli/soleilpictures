// The inline view show_board opens in ChatGPT and Claude (an MCP App): the
// board as it is drawn on its canvas, the owner's direction B of 2026-10-26.
// It draws from the answer's _meta['clusters/canvas'] (lib/canvasView.js),
// which the model never reads, and talks to the host through bridge.js.
//
// Everything a person wrote goes in through textContent, colours through
// safeColour, addresses through safeUrl: the page fetches nothing but the
// pictures it was handed, and opens links only on Clusters' own origins.

import { createBridge, watchSize, applyHostLook } from './bridge.js';
import {
  drawAs, inlineStage, fitScale, centred, ZOOM, zoomAbout, metaLine, askText, selectionContext,
  safeUrl, safeColour, picturesExpired, VIEW_KEYS,
} from './layout.js';

const APP = { name: 'clusters-board-view', version: '1.0.0' };
const CANVAS_KEY = VIEW_KEYS.canvas;
const DRAFT_KEY = VIEW_KEYS.draft;
// Note text drawn below this many pixels on screen reads as lines instead.
const LEGIBLE_PX = 8;
const NOTE_PX = 14;
// Fresh picture addresses: a few per view, and not in a burst.
const REFRESH = { max: 4, gapMs: 15_000 };

// Phosphor, regular weight, as the app's icons.
const ICON = {
  open: 'M224,104a8,8,0,0,1-16,0V59.32l-66.33,66.34a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z',
  keep: 'M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Zm0,177.57-51.77-32.35a8,8,0,0,0-8.48,0L72,209.57V48H184Z',
  full: 'M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z',
  ask: 'M216,48H40A16,16,0,0,0,24,64V224a15.85,15.85,0,0,0,9.24,14.5A16.13,16.13,0,0,0,40,240a15.89,15.89,0,0,0,10.25-3.78l.09-.07L83,208H216a16,16,0,0,0,16-16V64A16,16,0,0,0,216,48ZM40,224h0ZM216,192H80a8,8,0,0,0-5.23,1.95L40,224V64H216ZM88,112a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H96A8,8,0,0,1,88,112Zm0,32a8,8,0,0,1,8-8h64a8,8,0,1,1,0,16H96A8,8,0,0,1,88,144Z',
  zoomOut: 'M152,112a8,8,0,0,1-8,8H80a8,8,0,0,1,0-16h64A8,8,0,0,1,152,112Zm77.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88.11,88.11,0,1,1,11.31-11.31l50.07,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z',
  zoomIn: 'M152,112a8,8,0,0,1-8,8H120v24a8,8,0,0,1-16,0V120H80a8,8,0,0,1,0-16h24V80a8,8,0,0,1,16,0v24h24A8,8,0,0,1,152,112Zm77.66,117.66a8,8,0,0,1-11.32,0l-50.06-50.07a88.11,88.11,0,1,1,11.31-11.31l50.07,50.06A8,8,0,0,1,229.66,229.66ZM112,184a72,72,0,1,0-72-72A72.08,72.08,0,0,0,112,184Z',
  retry: 'M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z',
  doc: 'M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Zm-32-80a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,136Zm0,32a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,168Z',
  file: 'M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216Z',
  link: 'M165.66,90.34a8,8,0,0,1,0,11.32l-64,64a8,8,0,0,1-11.32-11.32l64-64A8,8,0,0,1,165.66,90.34ZM215.6,40.4a56,56,0,0,0-79.2,0L106.34,70.45a8,8,0,0,0,11.32,11.32l30.06-30a40,40,0,0,1,56.57,56.56l-30.07,30.06a8,8,0,0,0,11.31,11.32L215.6,119.6a56,56,0,0,0,0-79.2ZM138.34,174.22l-30.06,30.06a40,40,0,1,1-56.56-56.57l30.05-30.05a8,8,0,0,0-11.32-11.32L40.4,136.4a56,56,0,0,0,79.2,79.2l30.06-30.07a8,8,0,0,0-11.32-11.31Z',
  board: 'M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48v48Z',
  audio: 'M210.3,56.34l-80-24A8,8,0,0,0,120,40V148.26A48,48,0,1,0,136,184V98.75l69.7,20.91A8,8,0,0,0,216,112V64A8,8,0,0,0,210.3,56.34ZM88,216a32,32,0,1,1,32-32A32,32,0,0,1,88,216ZM200,101.25l-64-19.2V50.75L200,70Z',
  play: 'M232.4,114.49,88.32,26.35a16,16,0,0,0-16.2-.3A15.86,15.86,0,0,0,64,39.87V216.13A15.94,15.94,0,0,0,80,232a16.07,16.07,0,0,0,8.36-2.35L232.4,141.51a15.81,15.81,0,0,0,0-27ZM80,215.94V40l143.83,88Z',
};

// What a card is called to a screen reader.
const KIND_NAME = {
  image: 'Picture', video: 'Video', note: 'Note', doc: 'Doc', palette: 'Palette', link: 'Link',
  board: 'Cluster', boardlink: 'Linked cluster', pdf: 'PDF', audio: 'Sound', file: 'File', shape: 'Shape',
};
const FILE_ICON = { audio: ICON.audio, pdf: ICON.doc };

// ── The page's pieces ────────────────────────────────────────────────────────

const doc = document;
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(d, size = 16) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(SVG, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

function button(label, onClick, { cls = 'btn', iconD = null, title = null } = {}) {
  const b = el('button', cls);
  b.type = 'button';
  if (iconD) b.appendChild(icon(iconD));
  if (label) b.appendChild(doc.createTextNode(label));
  if (title) b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
}

const root = doc.getElementById('root');
const shell = el('div', 'w');
const head = el('header', 'w-head');
const titles = el('div', 'w-titles');
const titleEl = el('div', 'w-title');
const metaEl = el('div', 'w-meta');
titles.append(titleEl, metaEl);
const headActs = el('div', 'w-acts');
head.append(titles, headActs);
const body = el('div', 'w-body');
const stage = el('div', 'b-stage');
stage.setAttribute('role', 'group');
const world = el('div', 'b-world');
stage.appendChild(world);
const zoomBar = el('div', 'b-zoom');
const zoomPct = el('span', 'b-pct');
const over = el('div', 'x-over');
over.hidden = true;
stage.appendChild(over);
const message = el('p', 'w-msg');
body.append(stage, message);
const foot = el('footer', 'w-foot');
foot.setAttribute('aria-live', 'polite');
shell.append(head, body, foot);
root.appendChild(shell);

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  phase: 'loading', // loading | ready | error | stopped
  args: {},
  canvas: null,
  summary: null, // what the model got, when a host passed no _meta
  draft: null,
  error: null,
  selected: new Set(),
  caps: {},
  context: {},
  mode: 'inline',
  view: null, // full screen: { scale, x, y }, null while fitted
  pictures: { total: 0, loaded: 0, failed: 0 },
  trouble: false,
  refreshing: false,
  refreshes: 0,
  refreshedAt: 0,
};

const byId = new Map(); // card id -> its node
const boardId = () => state.canvas?.board?.id || state.summary?.board?.id || state.args?.board_id || null;
const draftKey = () => state.draft?.key || (typeof state.args?.draft === 'string' ? state.args.draft : null);
const isFull = () => state.mode === 'fullscreen';
const canFull = () => (state.context.availableDisplayModes || []).includes('fullscreen');

// ── The board ────────────────────────────────────────────────────────────────

function cardLabel(c) {
  const kind = KIND_NAME[c.kind] || 'Card';
  const words = c.title || c.text || c.domain;
  return words ? `${kind}: ${words.length > 80 ? `${words.slice(0, 79)}…` : words}` : kind;
}

// A card's head line: an icon and its title, drawn at a size that reads at any
// zoom (view.css .b-head).
function headLine(d, text) {
  const h = el('span', 'b-head');
  h.appendChild(icon(d, 12));
  h.appendChild(el('span', 'b-name', text));
  return h;
}

function watchPicture(node, img) {
  state.pictures.total += 1;
  img.addEventListener('load', () => {
    state.pictures.loaded += 1;
    node.classList.add('is-in');
  }, { once: true });
  img.addEventListener('error', () => {
    state.pictures.failed += 1;
    img.remove();
    pictureTrouble();
  }, { once: true });
}

function drawCard(c, withPictures) {
  const as = drawAs(c);
  const n = el('button', `b-it b-${as}${as === 'pic' ? '' : ' b-card'}`);
  n.type = 'button';
  n.dataset.id = c.id;
  n.style.left = `${c.x}px`;
  n.style.top = `${c.y}px`;
  n.style.width = `${c.w}px`;
  n.style.height = `${c.h}px`;
  if (Number.isFinite(c.rotation)) n.style.transform = `rotate(${c.rotation}deg)`;
  n.setAttribute('aria-label', cardLabel(c));
  n.setAttribute('aria-pressed', state.selected.has(c.id) ? 'true' : 'false');
  if (state.selected.has(c.id)) n.classList.add('on');

  if (as === 'pic') {
    const tone = safeColour(c.picture?.tone);
    if (tone) n.style.background = tone;
    const src = withPictures ? safeUrl(c.picture?.url) : null;
    if (src) {
      const img = el('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      watchPicture(n, img);
      img.src = src;
      n.appendChild(img);
    }
    if (c.kind === 'video') {
      const mark = el('span', 'b-play');
      mark.appendChild(icon(ICON.play, 12));
      n.appendChild(mark);
    }
    // A cluster's picture is its thumbnail: its name goes on it, as on the canvas.
    if (c.kind === 'board' && c.title) n.appendChild(el('span', 'b-tag', c.title));
    return n;
  }

  if (as === 'note') {
    if (c.color === 'transparent') n.classList.add('is-bare');
    else if (safeColour(c.color)) n.style.background = c.color;
    if (safeColour(c.ink)) n.style.color = c.ink;
    n.appendChild(el('span', 'b-text', c.text || c.title || ''));
    return n;
  }
  if (as === 'doc') {
    n.appendChild(headLine(ICON.doc, c.title || 'Doc'));
    if (c.text) n.appendChild(el('span', 'b-text', c.text));
    return n;
  }
  if (as === 'pal') {
    for (const s of c.swatches || []) {
      const hex = safeColour(s.hex);
      if (!hex) continue;
      const sw = el('span', 'b-sw');
      sw.style.background = hex;
      n.appendChild(sw);
    }
    return n;
  }
  if (as === 'link') {
    n.appendChild(headLine(ICON.link, c.title || c.domain || 'Link'));
    if (c.title && c.domain) n.appendChild(el('span', 'b-sub', c.domain));
    return n;
  }
  if (as === 'board') {
    n.appendChild(headLine(ICON.board, c.title || 'Cluster'));
    return n;
  }
  if (as === 'file') {
    n.appendChild(headLine(FILE_ICON[c.kind] || ICON.file, c.title || KIND_NAME[c.kind] || 'File'));
    return n;
  }
  if (as === 'shape') return n;
  if (c.title || c.text) n.appendChild(el('span', 'b-text', c.title || c.text));
  return n;
}

// A group is drawn round its cards, its name above it.
const GROUP_PAD = 16;
function drawGroup(g) {
  const n = el('div', `b-group${g.outline === false ? ' is-bare' : ''}`);
  n.style.left = `${g.x - GROUP_PAD}px`;
  n.style.top = `${g.y - GROUP_PAD}px`;
  n.style.width = `${g.w + 2 * GROUP_PAD}px`;
  n.style.height = `${g.h + 2 * GROUP_PAD}px`;
  const tint = safeColour(g.color);
  if (tint) {
    n.classList.add('is-tinted');
    n.style.setProperty('--g', tint);
  }
  if (g.name) n.appendChild(el('div', 'b-label', g.name));
  return n;
}

// What the board takes up drawn: its cards, and the groups round them.
function drawnBounds(canvas) {
  const b = canvas.bounds;
  if (!b) return null;
  let minX = b.x; let minY = b.y; let maxX = b.x + b.w; let maxY = b.y + b.h;
  for (const g of canvas.groups || []) {
    minX = Math.min(minX, g.x - GROUP_PAD);
    minY = Math.min(minY, g.y - GROUP_PAD);
    maxX = Math.max(maxX, g.x + g.w + GROUP_PAD);
    maxY = Math.max(maxY, g.y + g.h + GROUP_PAD);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function drawBoard() {
  const { canvas } = state;
  world.replaceChildren();
  byId.clear();
  state.pictures = { total: 0, loaded: 0, failed: 0 };
  // Addresses past their time are not tried: fresh ones are asked for first.
  const expired = picturesExpired(canvas);
  state.trouble = false;
  for (const g of canvas.groups || []) world.appendChild(drawGroup(g));
  for (const c of canvas.cards || []) {
    const n = drawCard(c, !expired);
    byId.set(c.id, n);
    world.appendChild(n);
  }
  const bg = safeColour(canvas.board?.background);
  stage.style.background = bg || '';
  stage.setAttribute('aria-label', `${canvas.board?.name || 'Untitled'}, as it is laid out`);
  if (expired && canvas.picture_count) {
    if (canRefresh()) refresh();
    else showTrouble();
  }
}

// ── Fitting the board to the stage ───────────────────────────────────────────

let lastStageW = 0;

function applyView(view) {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  stage.style.setProperty('--s', String(view.scale));
  stage.classList.toggle('is-legible', view.scale * NOTE_PX >= LEGIBLE_PX);
  zoomPct.textContent = `${Math.round(view.scale * 100)}%`;
}

function fittedView(bounds, width, height, pad) {
  const scale = fitScale(bounds, width, height, pad);
  return { scale, ...centred(bounds, width, height, scale) };
}

function layoutStage() {
  if (state.phase !== 'ready' || !state.canvas) return;
  const bounds = drawnBounds(state.canvas);
  const width = stage.clientWidth;
  if (!bounds || !width) return;
  lastStageW = width;
  const labelled = (state.canvas.groups || []).some((g) => g.name);
  if (isFull()) {
    stage.style.height = '';
    const height = stage.clientHeight;
    if (!state.view) applyView(fittedView(bounds, width, height, 24));
    else applyView(state.view);
    return;
  }
  const max = state.context.containerDimensions?.maxHeight;
  // The head and foot take about 140px of a host's height.
  const maxHeight = Number.isFinite(max) && max > 0 ? Math.max(160, Math.min(520, max - 140)) : 520;
  const pad = labelled ? 20 : 14;
  const s = inlineStage(bounds, width, { pad, maxHeight });
  stage.style.height = `${s.height}px`;
  applyView(fittedView(bounds, width, s.height, pad));
}

// ── Pictures that don't arrive ───────────────────────────────────────────────

const canRefresh = (asked = false) => Boolean(state.caps.serverTools) && Boolean(boardId())
  && !state.refreshing && state.refreshes < REFRESH.max + (asked ? 2 : 0)
  && (asked || Date.now() - state.refreshedAt > REFRESH.gapMs);

function pictureTrouble() {
  const p = state.pictures;
  // A few failed and none arrived: the addresses ran out, or the host blocks them.
  if (p.loaded > 0 || p.failed < Math.min(3, p.total)) return;
  if (canRefresh()) refresh();
  else showTrouble();
}

function showTrouble() {
  state.trouble = true;
  renderOver();
}

// Fresh addresses: the same tool again, as the view (hosts don't show the model
// a call a view makes). A draft is found by its key.
async function refresh(asked = false) {
  if (!canRefresh(asked)) return;
  state.refreshing = true;
  state.refreshes += 1;
  state.refreshedAt = Date.now();
  renderOver();
  const key = draftKey();
  try {
    const res = await bridge.request('tools/call', {
      name: 'show_board',
      arguments: { board_id: boardId(), ...(key ? { draft: key } : {}) },
    });
    const canvas = res?._meta?.[CANVAS_KEY];
    if (res?.isError || !canvas || typeof canvas !== 'object') throw new Error('no board in the answer');
    state.refreshing = false;
    setCanvas(canvas, res._meta?.[DRAFT_KEY] || state.draft);
  } catch {
    state.refreshing = false;
    showTrouble();
  }
}

function renderOver() {
  const show = state.trouble || state.refreshing;
  over.hidden = !show;
  if (!show) return;
  over.replaceChildren();
  const card = el('div', 'x-card');
  if (state.refreshing) {
    card.appendChild(el('span', null, 'Loading the pictures…'));
  } else {
    card.appendChild(el('span', null, 'The pictures didn’t load.'));
    if (canRefresh(true)) card.appendChild(button('Try again', () => refresh(true), { iconD: ICON.retry }));
  }
  over.appendChild(card);
}

// ── Picking cards ────────────────────────────────────────────────────────────

const pickedCards = () => (state.canvas?.cards || []).filter((c) => state.selected.has(c.id));

function setPicked(id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
  const n = byId.get(id);
  if (n) {
    n.classList.toggle('on', on);
    n.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

function clearPicked() {
  for (const id of [...state.selected]) setPicked(id, false);
  pickedChanged();
}

let contextTimer = null;
function pickedChanged() {
  renderFoot();
  if (!state.caps.updateModelContext) return;
  clearTimeout(contextTimer);
  contextTimer = setTimeout(() => {
    const cards = pickedCards();
    const content = cards.length ? [{ type: 'text', text: selectionContext(state.canvas.board, cards) }] : [];
    bridge.request('ui/update-model-context', { content }).catch(() => {});
  }, 300);
}

world.addEventListener('click', (e) => {
  const n = e.target.closest('.b-it');
  if (!n || !world.contains(n)) return;
  setPicked(n.dataset.id, !state.selected.has(n.dataset.id));
  pickedChanged();
});

// ── Full screen: zoom and pan ────────────────────────────────────────────────

function currentView() {
  if (state.view) return state.view;
  const bounds = drawnBounds(state.canvas);
  return fittedView(bounds, stage.clientWidth, stage.clientHeight, 24);
}

function setView(view) {
  state.view = view;
  applyView(view);
}

function zoomBy(factor, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
  if (!isFull() || !state.canvas?.bounds) return;
  setView(zoomAbout(currentView(), factor, cx, cy));
}

function fit() {
  state.view = null;
  layoutStage();
}

zoomBar.append(
  button(null, () => zoomBy(1 / ZOOM.step), { iconD: ICON.zoomOut, title: 'Zoom out' }),
  zoomPct,
  button(null, () => zoomBy(ZOOM.step), { iconD: ICON.zoomIn, title: 'Zoom in' }),
  button('Fit', fit, { cls: 'fit', title: 'Fit the board' }),
);
stage.appendChild(zoomBar);

const pointers = new Map();
let gesture = null;
let swallowClick = false;

stage.addEventListener('pointerdown', (e) => {
  if (!isFull() || e.target.closest('.b-zoom, .x-over')) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { start: currentView(), points: new Map(pointers), moved: false };
});

stage.addEventListener('pointermove', (e) => {
  if (!gesture || !pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = stage.getBoundingClientRect();
  const now = [...pointers.values()];
  const then = [...gesture.points.values()];
  if (now.length >= 2 && then.length >= 2) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top });
    const m0 = mid(then[0], then[1]);
    const m1 = mid(now[0], now[1]);
    const z = zoomAbout(gesture.start, dist(now[0], now[1]) / dist(then[0], then[1]), m0.x, m0.y);
    gesture.moved = true;
    setView({ ...z, x: z.x + m1.x - m0.x, y: z.y + m1.y - m0.y });
    return;
  }
  const p0 = gesture.points.get(e.pointerId);
  if (!p0) return;
  const dx = e.clientX - p0.x;
  const dy = e.clientY - p0.y;
  if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
  if (!gesture.moved) {
    gesture.moved = true;
    stage.setPointerCapture?.(e.pointerId);
    stage.classList.add('is-panning');
  }
  setView({ ...gesture.start, x: gesture.start.x + dx, y: gesture.start.y + dy });
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (gesture?.moved) swallowClick = true;
  stage.classList.remove('is-panning');
  // A finger lifted mid-pinch carries on as a pan from where the board is.
  gesture = pointers.size ? { start: currentView(), points: new Map(pointers), moved: true } : null;
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
// A drag that ends on a card doesn't pick it.
stage.addEventListener('click', (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

stage.addEventListener('wheel', (e) => {
  if (!isFull() || !state.canvas?.bounds) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  const v = currentView();
  // A pinch on a trackpad arrives as a wheel with ctrlKey.
  if (e.ctrlKey || e.metaKey) setView(zoomAbout(v, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
  else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
}, { passive: false });

doc.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.selected.size) {
    clearPicked();
    return;
  }
  if (!isFull() || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLElement && e.target.matches('input, textarea')) return;
  if (e.key === '+' || e.key === '=') zoomBy(ZOOM.step);
  else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM.step);
  else if (e.key === '0') fit();
});

// ── Head, foot and words ─────────────────────────────────────────────────────

function openLink(url) {
  const safe = safeUrl(url);
  if (safe) bridge.request('ui/open-link', { url: safe }).catch(() => {});
}

// The board's own action: open it, or keep it when it is a draft (its link
// is then the keep page's, which draftAnswer wrote in).
function boardAction(cls = 'btn btn-p') {
  const url = state.canvas?.board?.url || state.summary?.board?.url || state.draft?.keep_url;
  if (!safeUrl(url)) return null;
  return state.draft
    ? button('Keep it free', () => openLink(url), { cls, iconD: ICON.keep })
    : button('Open in Clusters', () => openLink(url), { cls, iconD: ICON.open });
}

function renderHead() {
  headActs.replaceChildren();
  if (state.phase === 'loading') {
    titleEl.replaceChildren(el('span', 'skb skb-t'));
    metaEl.replaceChildren(el('span', 'skb skb-m'));
    return;
  }
  const board = state.canvas?.board || state.summary?.board;
  titleEl.textContent = board?.name || (state.phase === 'error' ? 'Clusters' : 'Untitled');
  if (state.canvas) metaEl.textContent = metaLine(state.canvas, state.draft, state.context.locale);
  else if (state.summary) metaEl.textContent = metaLine({ board: { card_count: state.summary.cards }, picture_count: state.summary.pictures }, state.draft, state.context.locale);
  else metaEl.textContent = '';
  if (isFull() && state.phase === 'ready') {
    const act = boardAction();
    if (act) headActs.appendChild(act);
  }
}

function renderFoot() {
  foot.replaceChildren();
  const picked = state.selected.size;
  if (picked) {
    const count = el('span', 'selc');
    count.append(el('i'), doc.createTextNode(`${picked} selected`));
    foot.appendChild(count);
    if (state.caps.message) {
      foot.appendChild(button('Ask about these', () => {
        const text = askText(state.canvas.board, pickedCards());
        bridge.request('ui/message', { role: 'user', content: [{ type: 'text', text }] }).catch(() => {});
      }, { cls: 'btn btn-p', iconD: ICON.ask }));
    }
    foot.appendChild(button('Clear', clearPicked, { cls: 'btn btn-t' }));
    foot.hidden = false;
    return;
  }
  // Full screen, the board's action is in the head.
  if (state.phase !== 'ready' || isFull()) {
    foot.hidden = true;
    return;
  }
  const act = boardAction();
  if (act) foot.appendChild(act);
  if (state.canvas?.cards?.length && canFull()) {
    foot.appendChild(button('View all', () => setMode('fullscreen', true), { iconD: ICON.full }));
  }
  foot.hidden = !foot.childElementCount;
}

function renderBody() {
  const { phase, canvas } = state;
  const drawing = phase === 'ready' && canvas && canvas.cards?.length > 0;
  stage.hidden = !(drawing || phase === 'loading');
  stage.classList.toggle('is-loading', phase === 'loading');
  zoomBar.hidden = !(drawing && isFull());
  message.hidden = true;
  if (phase === 'loading') {
    world.replaceChildren();
    stage.style.height = '';
    return;
  }
  let words = null;
  if (phase === 'error') words = state.error || 'The board couldn’t be shown.';
  else if (phase === 'stopped') words = 'Stopped before the board was shown.';
  else if (!canvas) words = 'Open it in Clusters to see it.';
  else if (!canvas.cards?.length) words = 'Nothing on this board yet.';
  if (words) {
    message.textContent = words;
    message.hidden = false;
  }
}

function render() {
  doc.documentElement.classList.toggle('is-full', isFull());
  renderHead();
  renderBody();
  renderFoot();
  renderOver();
  layoutStage();
}

// ── What the host says ───────────────────────────────────────────────────────

function setCanvas(canvas, draft) {
  state.canvas = canvas;
  state.draft = draft && typeof draft === 'object' ? draft : null;
  state.phase = 'ready';
  // Picks survive fresh addresses; cards no longer drawn drop out.
  const ids = new Set((canvas.cards || []).map((c) => c.id));
  for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
  drawBoard();
  render();
}

function onResult(result) {
  const meta = result?._meta || {};
  if (result?.isError) {
    const text = (result.content || []).find((b) => b?.type === 'text')?.text || '';
    state.phase = 'error';
    state.error = text.replace(/^Error:\s*/, '').split('\n')[0].slice(0, 300) || null;
    render();
    return;
  }
  const canvas = meta[CANVAS_KEY];
  if (canvas && typeof canvas === 'object') {
    setCanvas(canvas, meta[DRAFT_KEY]);
    return;
  }
  // A host that passes the view no _meta: what the model got, and a way in.
  state.summary = result?.structuredContent && typeof result.structuredContent === 'object' ? result.structuredContent : null;
  state.draft = meta[DRAFT_KEY] || null;
  state.phase = 'ready';
  render();
  if (canRefresh()) refresh();
}

let remeasure = () => {};

function setMode(mode, ask = false) {
  if (ask) {
    bridge.request('ui/request-display-mode', { mode })
      .then((r) => { if (r?.mode) setMode(r.mode); })
      .catch(() => {});
    return;
  }
  if (mode === state.mode) return;
  state.mode = mode;
  state.view = null;
  render();
  remeasure();
}

function onContext(patch) {
  if (!patch || typeof patch !== 'object') return;
  state.context = { ...state.context, ...patch };
  applyHostLook(doc, state.context);
  const insets = state.context.safeAreaInsets;
  if (insets) {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (Number.isFinite(insets[side])) doc.documentElement.style.setProperty(`--safe-${side}`, `${insets[side]}px`);
    }
  }
  if (patch.displayMode && patch.displayMode !== state.mode) setMode(patch.displayMode);
  else render();
}

const bridge = createBridge({
  host: window.parent,
  win: window,
  appInfo: APP,
  appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
});

bridge.on('ui/notifications/tool-input', (p) => {
  state.args = p.arguments && typeof p.arguments === 'object' ? p.arguments : {};
});
bridge.on('ui/notifications/tool-result', onResult);
bridge.on('ui/notifications/tool-cancelled', () => {
  if (state.phase !== 'loading') return;
  state.phase = 'stopped';
  render();
});
bridge.on('ui/notifications/host-context-changed', onContext);

// A narrower or wider column redraws the board to fit; a change of height
// alone (the host fitting the frame to the page) doesn't.
new ResizeObserver(() => {
  if (isFull() || stage.clientWidth !== lastStageW) layoutStage();
}).observe(stage);

render();
bridge.connect().then((init) => {
  state.caps = init.hostCapabilities || {};
  onContext(init.hostContext || {});
  // Full screen, the host sizes the frame; inline, the frame follows the page.
  remeasure = watchSize(window, doc, (size) => {
    if (!isFull()) bridge.notify('ui/notifications/size-changed', size);
  });
}).catch(() => {
  // No host answered: a page opened on its own shows what it can.
});
