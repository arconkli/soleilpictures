// A chat host for the inline view (boards/mcp-app/): a page that frames the
// view's HTML the way ChatGPT and Claude do (a sandboxed iframe, no origin of
// its own), answers its ui/* messages and records them. And a board to show,
// made by the Worker's own lib/canvasView.js so the view is tested against
// the answer it will really get.

import { planCanvas, canvasAnswer } from '../../src/lib/canvasView.js';

// The pictures' origin: nothing listens there; the spec answers it (page.route).
export const PICTURES = 'http://127.0.0.1:5999';
export const BOARD = '7a1c3e55-0b1d-4c1e-9f2a-3b4c5d6e7f80';
const SUB = '9d2e4f66-1c2e-4d3f-8a3b-4c5d6e7f8091';

const B83 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
// A blurhash whose average colour is `hex` (the rest is never read).
function blurhashOf(hex) {
  let v = parseInt(hex.slice(1), 16);
  let dc = '';
  for (let i = 0; i < 4; i += 1) {
    dc = B83[v % 83] + dc;
    v = Math.floor(v / 83);
  }
  return `L5${dc}000000000000000000`;
}

const TONES = ['#1d2b44', '#3a1f2b', '#2f3d2a', '#4a3520', '#20323a', '#3b2a44', '#433024', '#1f3a3a'];

// "Tokyo noir, 1974": four groups of pictures, a palette, a treatment, notes,
// a video, a link and a cluster, as a moodboard made by the recipe lands.
export function boardCards() {
  const cards = [];
  const rows = [];
  const groups = [
    { id: 'g1', name: 'Streets' }, { id: 'g2', name: 'Interiors' },
    { id: 'g3', name: 'Faces' }, { id: 'g4', name: 'Light' },
  ];
  let n = 0;
  groups.forEach((g, gi) => {
    const gx = (gi % 3) * 820;
    const gy = gi < 3 ? 0 : 640;
    for (let i = 0; i < 6; i += 1) {
      n += 1;
      const id = `i${n}`;
      const tall = (i + gi) % 4 === 1;
      cards.push({
        id, kind: 'image', src: `r2:w1/${id}.jpg`, groupId: g.id, title: `${g.name} ${i + 1}`,
        x: gx + (i % 3) * 260, y: gy + Math.floor(i / 3) * 280, w: 240, h: tall ? 260 : 160, z: n,
      });
      rows.push({
        storage_path: `w1/${id}.jpg`, preview_sm_path: `w1/${id}_sm.webp`, preview_sm_w: 640, preview_sm_h: tall ? 693 : 427,
        width: 3000, height: tall ? 3250 : 2000, size_bytes: 3_000_000, blur_hash: blurhashOf(TONES[n % TONES.length]),
      });
    }
  });
  cards.push(
    { id: 'p1', kind: 'palette', x: 820, y: 640, w: 360, h: 120, z: 40,
      swatches: [{ hex: '#0b1a2e', name: 'Wet asphalt' }, { hex: '#e8a33d', name: 'Sodium' }, { hex: '#c2185b', name: 'Neon' },
        { hex: '#2e7d6b', name: 'Tile' }, { hex: '#f2e6d0', name: 'Paper lantern' }] },
    { id: 'd1', kind: 'doc', title: 'Treatment', x: 820, y: 800, w: 360, h: 300, z: 41,
      lines: [{ t: 'A night-shift detective walks Shinjuku from the last train to the first, looking for a singer who vanished between sets.' }] },
    { id: 'n1', kind: 'note', html: '<p>Sodium vapour, never daylight.</p>', x: 1240, y: 640, w: 260, h: 100, z: 42 },
    { id: 'n2', kind: 'note', html: '<p>Every sign repeats itself in a puddle.</p>', bgColor: '#fff3c4', textColor: '#3a2e00', x: 1520, y: 640, w: 260, h: 100, z: 43 },
    { id: 'n3', kind: 'note', html: '<p>Long lenses from across the street; we never stand where the actors are.</p>', x: 1240, y: 760, w: 260, h: 120, z: 44 },
    { id: 'n4', kind: 'note', html: '<p>Avoid: blue-teal grading, smoke machines.</p>', x: 1520, y: 760, w: 260, h: 120, z: 45 },
    { id: 'v1', kind: 'video', src: 'r2:w1/v1.mp4', poster: 'r2:w1/v1_poster.jpg', title: 'Drive-by test', x: 1240, y: 900, w: 260, h: 146, z: 46 },
    { id: 'l1', kind: 'link', url: 'https://www.criterion.com/films/branded-to-kill', title: 'Branded to Kill (1967)', x: 1520, y: 900, w: 260, h: 90, z: 47 },
    { id: SUB, kind: 'board', x: 1520, y: 1010, w: 260, h: 150, z: 48 },
  );
  rows.push({
    storage_path: 'w1/v1_poster.jpg', preview_sm_path: 'w1/v1_poster_sm.webp', preview_sm_w: 640, preview_sm_h: 360,
    width: 1920, height: 1080, size_bytes: 400_000, blur_hash: blurhashOf('#28242e'),
  });
  return { cards, rows, groups, boardRows: [{ id: SUB, name: 'Locations', thumb_key: 'w1/thumbs/locations.webp' }] };
}

// The canvas answer for that board, its pictures served from PICTURES.
// `expiresIn` (seconds) can be past to model a conversation reopened later.
export async function boardCanvas({ expiresIn = 3600, origin = 'https://clusters.soleilpictures.com', name = 'Tokyo noir, 1974' } = {}) {
  const { cards, rows, groups, boardRows } = boardCards();
  const plan = planCanvas(cards, groups);
  return canvasAnswer({
    board: { id: BOARD, name, bg_color: null },
    boardUrl: `${origin}/?to=b:${BOARD}`,
    plan,
    imageRows: rows,
    boardRows,
    sign: async (key) => `${PICTURES}/api/img/${encodeURIComponent(key)}`,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
  });
}

// A picture for any address on PICTURES: a gradient in a tone of its own.
export function pictureSvg(path) {
  let h = 0;
  for (const ch of path) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="427" viewBox="0 0 640 427">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,22%)"/>`
    + `<stop offset="1" stop-color="hsl(${(h + 40) % 360},70%,48%)"/></linearGradient></defs>`
    + `<rect width="640" height="427" fill="url(#g)"/><circle cx="${120 + (h % 400)}" cy="${90 + (h % 200)}" r="46" `
    + `fill="hsl(${(h + 180) % 360},80%,70%)" opacity=".55"/></svg>`;
}

// The host, run in the page by page.evaluate: frames the view, answers it,
// and keeps every message both ways in window.__host.log.
export function installHost({ html, caps, context, args, result, refresh = null, width = 720 }) {
  const frame = document.createElement('iframe');
  frame.id = 'view';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.style.cssText = `display:block;border:0;width:${width}px;height:120px;margin:24px auto;background:transparent`;
  document.body.style.margin = '0';
  document.body.appendChild(frame);
  const host = { log: [], mode: context.displayMode || 'inline', frame, refreshes: 0 };
  window.__host = host;
  const post = (msg) => {
    host.log.push({ to: 'view', ...msg });
    frame.contentWindow.postMessage(msg, '*');
  };
  const reply = (id, res) => post({ jsonrpc: '2.0', id, result: res });
  host.post = post;
  host.notify = (method, params) => post({ jsonrpc: '2.0', method, params });
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data;
    host.log.push({ from: 'view', ...m });
    switch (m.method) {
      case 'ui/initialize':
        reply(m.id, {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'Test host', version: '1.0.0' },
          hostCapabilities: caps,
          hostContext: context,
        });
        break;
      case 'ui/notifications/initialized':
        if (args) host.notify('ui/notifications/tool-input', { arguments: args });
        if (result) setTimeout(() => host.notify('ui/notifications/tool-result', result), 30);
        break;
      case 'ui/notifications/size-changed':
        if (host.mode === 'inline') frame.style.height = `${m.params.height}px`;
        break;
      case 'ui/request-display-mode': {
        const mode = (context.availableDisplayModes || []).includes(m.params.mode) ? m.params.mode : host.mode;
        host.mode = mode;
        if (mode === 'fullscreen') {
          frame.style.cssText = 'display:block;border:0;position:fixed;inset:0;width:100vw;height:100vh;margin:0';
        } else {
          frame.style.cssText = `display:block;border:0;width:${width}px;height:120px;margin:24px auto`;
        }
        reply(m.id, { mode });
        host.notify('ui/notifications/host-context-changed', { displayMode: mode });
        break;
      }
      case 'tools/call':
        host.refreshes += 1;
        if (refresh) reply(m.id, refresh);
        else post({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'no' } });
        break;
      default:
        if (m.id !== undefined && m.method) reply(m.id, {});
    }
  });
  frame.srcdoc = html;
}
