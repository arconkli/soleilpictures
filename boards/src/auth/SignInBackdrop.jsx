// SignInBackdrop — the cinematic "living board" that animates around the
// pinned sign-in box as the visitor scrolls. The box itself (passed as
// children) NEVER moves; everything else — moodboard cards swapping in waves,
// fake teammate cursors that wander and tidy cards, a relationship graph, a
// faux app topbar — animates in to preview what Clusters feels like.
//
// Scroll model: the app locks document scroll (html/body/#root are
// position:fixed; overflow:hidden for the iOS WebView), so we scroll an
// INTERNAL container (.sb-scroll). A tall .sb-runway gives the scroll length;
// the .sb-stage is sticky-pinned to the top for the whole runway. We set exact
// pixel heights in JS so the sticky math is immune to mobile viewport-unit
// quirks (100vh ≠ visible height when the address bar shows).
//
// Progress `p` (0→1) maps scroll position to three card waves that resolve into
// a final live board. All animation is driven from one rAF loop; honoring
// prefers-reduced-motion drops the time-based wobble + cursor wander.
import { useEffect, useRef } from 'react';
import './signin-backdrop.css';

const RUNWAY_MULT = 4.2; // runway height = this × viewport height

// Cards have an entry window {in} and optional exit window {out}, so they
// animate IN, then later move OUT — three waves that swap the board around the
// pinned box, resolving into a final "live board" that stays.
//   wave 1 — reference dump        (in ~.05, out ~.35)
//   wave 2 — clinical moodboard    (in ~.42, out ~.70)
//   wave 3 — Lost Time live board  (in ~.72, stays → the live board)
const CARDS = [
  // wave 1 — Yahweh
  { wave:1, kind:'image', img:'/signin-yahweh.webp', label:'yahweh_keyart.png', dot:'#3b82f6', x:-455,y:-110,r:-6,w:168,h:228, in:0.05,out:0.34 },
  { wave:1, kind:'palette', cols:['#fefefe','#51a0e7','#042e72','#000000'], label:'Yahweh 2030s', dot:'#34d399', x:-470,y:150,r:-3,w:196,h:104, in:0.11,out:0.36 },
  { wave:1, kind:'note', mSlot:'top', head:'LIVE CANVAS', text:'Your whole team on one infinite canvas — live cursors, comments, and presence, no refresh.', dot:'#f59e0b', x:-330,y:255,r:5,w:212,h:138, in:0.17,out:0.40 },
  { wave:1, kind:'board', name:'Yahweh · refs', count:15, mini:[ {t:'img',src:'/signin-yahweh.webp',l:6,tp:8,w:42,h:64,r:-5}, {t:'pal',cols:['#fefefe','#51a0e7','#042e72','#000000'],l:52,tp:12,w:42,h:22,r:4}, {t:'note',l:44,tp:48,w:50,h:40,r:-3} ], x:475,y:95,r:3,w:198,h:144, in:0.13,out:0.36 },
  { wave:1, kind:'audio', cover:'/signin-yahweh.webp', title:'Yahweh — main theme', artist:'Soleil Pictures · score', dur:'3:48', x:240,y:-285,r:-3,w:250,h:110, in:0.20,out:0.40 },
  { wave:1, kind:'image', img:'/signin-logo-mark.webp', label:'clusters_mark.png', dot:'#a78bfa', x:447,y:-128,r:6,w:182,h:166, in:0.09,out:0.34 },
  // wave 2 — Lost Time stills + MoodBoard
  { wave:2, kind:'image', img:'/signin-losttime-still1.webp', label:'losttime_int_07.jpg', dot:'#3b82f6', x:-440,y:-120,r:-5,w:240,h:152, in:0.42,out:0.68 },
  { wave:2, kind:'palette', cols:['#222a4e','#f8ebce','#ff7720'], label:'Lost Time', dot:'#34d399', x:470,y:-130,r:4,w:196,h:100, in:0.46,out:0.70 },
  { wave:2, kind:'note', mSlot:'top', head:'AUTO-TAG', text:'Drop any image, link, or file — Clusters reads it, auto-tags it, and files it to the right board.', dot:'#f59e0b', x:430,y:205,r:-4,w:224,h:142, in:0.50,out:0.72 },
  { wave:2, kind:'board', name:'MoodBoard', count:36, mini:[ {t:'img',src:'/signin-losttime-still1.webp',l:5,tp:8,w:46,h:50,r:-4}, {t:'img',src:'/signin-losttime-still2.webp',l:50,tp:30,w:46,h:52,r:4}, {t:'pal',cols:['#222a4e','#f8ebce','#ff7720'],l:8,tp:60,w:38,h:20,r:2} ], x:-470,y:160,r:-3,w:196,h:142, in:0.48,out:0.70 },
  { wave:2, kind:'video', thumb:'/signin-losttime-still1.webp', title:'Lost Time — dailies', dur:'2:14', x:-300,y:280,r:4,w:228,h:146, in:0.53,out:0.72 },
  // wave 3 — the live board (stays)
  { wave:3, kind:'image', img:'/signin-losttime.webp', label:'losttime_key.png', dot:'#3b82f6', x:455,y:-105,r:5,w:172,h:232, in:0.72 },
  { wave:3, kind:'image', img:'/signin-losttime-still2.webp', label:'losttime_diner_11.jpg', dot:'#3b82f6', x:-455,y:-115,r:-5,w:236,h:150, in:0.74 },
  { wave:3, kind:'note', mSlot:'bottom', head:'RELATIONSHIP GRAPH', text:'Every card connects. Jump between boards through a living graph of how your ideas link up.', dot:'#f59e0b', x:-340,y:248,r:4,w:218,h:142, in:0.80 },
  { wave:3, kind:'palette', cols:['#FFA500','#FFFAF0','#272727','#EF7300'], label:'Clusters', dot:'#34d399', x:475,y:160,r:3,w:188,h:104, in:0.84 },
  { wave:3, kind:'board', name:'Clusters Logo', count:32, mini:[ {t:'img',src:'/signin-logo-mark.webp',l:8,tp:12,w:42,h:54,r:-3,fit:'contain',bg:'#0a0a0c'}, {t:'pal',cols:['#FFA500','#FFFAF0','#272727','#EF7300'],l:54,tp:16,w:40,h:24,r:3}, {t:'note',l:48,tp:50,w:46,h:38,r:-2} ], x:230,y:295,r:-3,w:196,h:142, in:0.82 },
  { wave:3, kind:'audio', cover:'/signin-losttime.webp', title:'Lost Time — end credits', artist:'Soleil Pictures', dur:'4:05', x:-180,y:-290,r:-3,w:250,h:110, in:0.78 },
  { wave:3, kind:'tag', text:'needs-review', dot:'#f59e0b', x:40,y:-315,r:0, in:0.88 },
  { wave:3, kind:'tag', text:'approved', dot:'#34d399', x:160,y:-300,r:0, in:0.90 },
  // extra info notes (appended so connector indices above stay valid)
  { wave:2, kind:'note', mSlot:'bottom', head:'SHARE OR LOCK', text:'Share a board with one link, or keep it private. You own your references.', dot:'#f59e0b', x:175,y:-280,r:3,w:226,h:132, in:0.54,out:0.72 },
  { wave:1, kind:'note', mSlot:'bottom', head:'DOCS, BUILT IN', text:'Write briefs right beside the canvas — rich docs with slash commands and @mentions.', dot:'#f59e0b', x:310,y:225,r:4,w:214,h:134, in:0.22,out:0.40 },
];

// connectors only between final-board cards (indices into CARDS)
const CONN = [[12,13],[11,15],[13,16]];

// hand-annotation arrows that draw IN over the finale, like a teammate marking
// up the board. indices into CARDS; bow = perpendicular curve; in/win = the
// scroll window over which the stroke draws.
const ARROWS = [
  { from:13, to:15, color:'#f59e0b', bow:46, in:0.86, win:0.06 },   // graph note → Clusters board
  { from:18, to:12, color:'#10b981', bow:-38, in:0.90, win:0.06 },  // "approved" tag → diner still
];
const SVGNS = 'http://www.w3.org/2000/svg';

// Each cursor wanders its OWN zone (left / right) with eased, pausing motion
// toward fresh targets, and sometimes grabs a nearby card and nudges it, like a
// teammate tidying the board. zone = [xMin,xMax,yMin,yMax] center-rel px.
const CURSORS = [
  { name:'Andrew', color:'#ffa500', zone:[-525,-270,-300,260] },
  { name:'Tobe',   color:'#6b9088', zone:[ 270, 525,-300,260] },
];
const ARROW = '<svg width="17" height="21" viewBox="0 0 16 20" fill="none"><path d="M2 2 L2 15 L5.5 12 L8 17.5 L10 16.5 L7.5 11 L13 11 Z" fill="COLOR" stroke="#0a0a0c" stroke-width="1" stroke-linejoin="round"/></svg>';

// deterministic "waveform" peaks from a string seed (ported from the app's
// AudioCard.generatePeaks — R2 audio isn't CORS-decodable, so this is faked but
// reads as music). Returns count values in ~[0.3,1].
function peaks(seed, count){
  const s = String(seed || 'a'); let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  const out = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1664525 + 1013904223) | 0;
    const r = (h >>> 0) / 4294967296;
    const sine = Math.sin(i * 0.5 + (h >>> 24) * 0.01) * 0.5 + 0.5;
    const env = Math.sin((i / (count - 1)) * Math.PI) * 0.35 + 0.65;
    out.push((0.3 + 0.7 * (0.55 * r + 0.45 * sine)) * env);
  }
  return out;
}
function waveBars(seed, n = 34, fill = 0.4){
  const ps = peaks(seed, n), on = Math.round(n * fill);
  return `<svg class="sb-ac-wave" viewBox="0 0 ${n * 3} 24" preserveAspectRatio="none">` +
    ps.map((p, i) => { const ht = Math.max(2, p * 22); return `<rect x="${(i * 3 + 0.5).toFixed(1)}" y="${((24 - ht) / 2).toFixed(1)}" width="2" height="${ht.toFixed(1)}" rx="1" class="${i < on ? 'sb-bar-on' : 'sb-bar-off'}"/>`; }).join('') +
    `</svg>`;
}
const PLAY_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2 L12.5 8 L5 12.8 Z" fill="currentColor"/></svg>';
// a tiny scaled-down card inside a board preview (mimics the real .bc thumbnail)
function miniCard(m){
  const pos = `left:${m.l}%;top:${m.tp}%;width:${m.w}%;height:${m.h}%;transform:rotate(${m.r}deg)`;
  if (m.t === 'img') return `<div class="sb-mini sb-mini-img" style="${pos}${m.bg ? `;background:${m.bg}` : ''}"><img src="${m.src}" alt="" loading="lazy" style="object-fit:${m.fit || 'cover'}"></div>`;
  if (m.t === 'pal') return `<div class="sb-mini sb-mini-pal" style="${pos}">${m.cols.map(c => `<i style="background:${c}"></i>`).join('')}</div>`;
  return `<div class="sb-mini sb-mini-note" style="${pos}"><b></b><b></b><b style="width:62%"></b></div>`;
}

function cardInner(c) {
  if (c.kind === 'image') return `<img class="sb-media" src="${c.img}" alt="" draggable="false" loading="lazy"><div class="sb-cfoot"><span class="sb-dot" style="background:${c.dot}"></span><span class="sb-label">${c.label}</span></div>`;
  if (c.kind === 'note') return `<div class="sb-nb">${c.head ? `<div class="sb-nhead"><span class="sb-ninfo">i</span><span class="sb-nh">${c.head}</span></div>` : ''}${c.text}</div>`;
  if (c.kind === 'palette') return `<div class="sb-pal">${c.cols.map(x=>`<div style="background:${x}"></div>`).join('')}</div><div class="sb-cfoot"><span class="sb-dot" style="background:${c.dot}"></span><span class="sb-label">${c.label}</span></div>`;
  if (c.kind === 'audio') return `<div class="sb-ac-cover"><img class="sb-media" src="${c.cover}" alt="" loading="lazy"></div><div class="sb-ac-body"><div class="sb-ac-meta"><div class="sb-ac-title">${c.title}</div><div class="sb-ac-artist">${c.artist || ''}</div></div>${waveBars(c.title)}<div class="sb-ac-ctrl"><span class="sb-ac-play">${PLAY_SVG}</span><span class="sb-ac-time">0:00 <i>/</i> ${c.dur || '3:12'}</span></div></div>`;
  if (c.kind === 'video') return `<div class="sb-vc-thumb"><img class="sb-media" src="${c.thumb}" alt="" loading="lazy"><span class="sb-vc-play">${PLAY_SVG}</span><span class="sb-vc-dur">${c.dur || ''}</span></div><div class="sb-vc-title">${c.title}</div>`;
  if (c.kind === 'board') return `<div class="sb-bp-canvas">${(c.mini || []).map(miniCard).join('')}</div><span class="sb-bp-badge">Board</span><div class="sb-bp-meta"><span class="sb-bp-name">${c.name}</span><span class="sb-bp-count">${c.count} cards</span></div>`;
  if (c.kind === 'tag') return `<span class="sb-chip"><span class="sb-dot" style="background:${c.dot}"></span>${c.text}</span>`;
  return '';
}

export function SignInBackdrop({ children, exploreHref }) {
  const sceneRef   = useRef(null);
  const scrollRef  = useRef(null);
  const runwayRef  = useRef(null);
  const stageRef   = useRef(null);
  const cardsRef   = useRef(null);
  const cursorsRef = useRef(null);
  const linksRef   = useRef(null);
  const gridRef    = useRef(null);
  const sunRef     = useRef(null);
  const chromeRef  = useRef(null);
  const hintRef    = useRef(null);
  const boxRef     = useRef(null);
  const exploreRef = useRef(null);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const runwayMult = coarse ? 3.4 : RUNWAY_MULT;   // fewer swipes to the payoff on phones
    const sceneEl = sceneRef.current;
    const scrollEl = scrollRef.current;
    const cardsEl = cardsRef.current;
    const cursorsEl = cursorsRef.current;
    const linksSvg = linksRef.current;
    const grid = gridRef.current;
    const sun = sunRef.current;
    const hint = hintRef.current;
    const chrome = chromeRef.current;
    if (!scrollEl || !cardsEl) return;

    // Per-card live state lives on a parallel array so we never mutate the
    // module-level CARDS constant (would leak between mounts).
    const S = CARDS.map(() => ({ dragX:0, dragY:0, _grab:false, _v:0, _x:0, _y:0, _baseX:0, _baseY:0 }));

    const cardEls = CARDS.map((c, i) => {
      const el = document.createElement('div');
      el.className = 'sb-card sb-' + c.kind + (c.logo ? ' sb-logo sb-logo-' + c.logo : '');
      if (c.kind !== 'tag') { el.style.width = c.w + 'px'; el.style.height = c.h + 'px'; }
      el.innerHTML = cardInner(c);
      el.style.zIndex = (c.kind === 'tag') ? 4 : (i % 3) + 1;
      cardsEl.appendChild(el);
      c.phase = i * 1.3;
      return el;
    });

    const connEls = CONN.map(() => {
      const l = document.createElementNS(SVGNS,'line');
      l.setAttribute('stroke','var(--line-3)'); l.setAttribute('stroke-width','1'); l.setAttribute('stroke-dasharray','4 5');
      linksSvg.appendChild(l); return l;
    });

    // annotation arrows: a curved path that draws in + a triangular head
    const arrowEls = ARROWS.map(() => {
      const g = document.createElementNS(SVGNS,'g');
      const path = document.createElementNS(SVGNS,'path');
      path.setAttribute('fill','none'); path.setAttribute('stroke-width','1.6'); path.setAttribute('stroke-linecap','round');
      const head = document.createElementNS(SVGNS,'polygon');
      g.appendChild(path); g.appendChild(head); linksSvg.appendChild(g);
      return { g, path, head };
    });

    // cursor live state (kept off the module constant)
    const CU = CURSORS.map(() => ({ x:null, y:null, state:'pause', timer:0, held:null, _x:0, _y:0 }));
    const cursorEls = CURSORS.map(cu => {
      const el = document.createElement('div'); el.className = 'sb-cursor';
      el.innerHTML = ARROW.replace('COLOR', cu.color) + `<span class="sb-flag" style="background:${cu.color}">${cu.name}</span>`;
      cursorsEl.appendChild(el);
      return el;
    });

    const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const ramp = (p, start, win) => easeOut(clamp((p - start) / win, 0, 1));

    let maxScroll = 1;
    function measure() {
      const vw = (sceneEl && sceneEl.clientWidth) || innerWidth;
      const vh = (sceneEl && sceneEl.clientHeight) || innerHeight;
      // Pin runway/stage to the VISIBLE viewport width — the scroller itself is
      // wider so its scrollbar is cropped off-screen. Exact px heights keep the
      // sticky stage pinned cleanly on mobile.
      if (runwayRef.current) { runwayRef.current.style.width = vw + 'px'; runwayRef.current.style.height = Math.round(vh * runwayMult) + 'px'; }
      if (stageRef.current) { stageRef.current.style.width = vw + 'px'; stageRef.current.style.height = vh + 'px'; }
      maxScroll = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
    }

    // Keep the pinned box above the on-screen keyboard: publish the VISIBLE
    // viewport height so .sb-box-wrap can center the box in the area not covered
    // by the keyboard (the scene is position:fixed, so it otherwise centers in
    // the full layout viewport and the keyboard can hide the Continue button).
    const vv = window.visualViewport;
    function syncVisibleHeight() {
      if (sceneEl && vv) sceneEl.style.setProperty('--sb-vvh', Math.round(vv.height) + 'px');
    }

    const cw = () => (sceneEl && sceneEl.clientWidth) || innerWidth;
    const ch = () => (sceneEl && sceneEl.clientHeight) || innerHeight;
    const cx = () => cw() / 2, cy = () => ch() / 2;
    function spread(){ return { sx: clamp(cw() / 1180, 0.5, 1.12), sy: clamp(ch() / 760, 0.58, 1.12) }; }

    // ── Cursor wander + card-drag state machine ──────────────────────────
    let lastNow = null;
    const clampN = (v,a,b) => Math.max(a, Math.min(b, v));
    function setSeg(cu, ex, ey, speed){
      cu.sx0 = cu.x; cu.sy0 = cu.y; cu.ex = ex; cu.ey = ey;
      cu.dur = Math.max(0.45, Math.hypot(ex - cu.x, ey - cu.y) / speed); cu.t = 0;
    }
    function chooseNext(cu, i, sx, sy, cxv, cyv){
      const z = CURSORS[i].zone;
      // visible, settled, ungrabbed final-board cards whose home is in my zone
      const cands = CARDS.map((c, idx) => ({ c, s: S[idx] }))
        .filter(({ c, s }) => c.out == null && s._v > 0.6 && !s._grab
          && c.x >= z[0] && c.x <= z[1] && c.y >= z[2] && c.y <= z[3]);
      if (cands.length && Math.random() < 0.55){
        cu.held = cands[(Math.random() * cands.length) | 0];
        cu.state = 'toCard'; setSeg(cu, cu.held.s._x, cu.held.s._y, 340);
      } else {
        const ex = cxv + (z[0] + Math.random() * (z[1] - z[0])) * sx;
        const ey = cyv + (z[2] + Math.random() * (z[3] - z[2])) * sy;
        cu.state = 'move'; setSeg(cu, ex, ey, 300);
      }
    }
    function arrive(cu){
      if (cu.state === 'toCard' && cu.held){
        const s = cu.held.s; s._grab = true;
        cu.grabX0 = cu.x; cu.grabY0 = cu.y; s._baseX = s.dragX || 0; s._baseY = s.dragY || 0;
        const ddx = (Math.random()*2-1) * 74, ddy = (Math.random()*2-1) * 56;
        cu.state = 'drag'; setSeg(cu, cu.x + ddx, cu.y + ddy, 150);   // slow = "carrying"
      } else if (cu.state === 'drag'){
        if (cu.held) cu.held.s._grab = false; cu.held = null;
        cu.state = 'pause'; cu.timer = 0.7 + Math.random() * 1.6;
      } else {
        cu.state = 'pause'; cu.timer = 0.5 + Math.random() * 1.7;
      }
    }
    function updateCursors(now, p, sx, sy, cxv, cyv, br){
      const vis = clamp((p - 0.12) / 0.12, 0, 1);
      const dt = (lastNow == null) ? 0 : Math.min(0.06, (now - lastNow) / 1000);
      lastNow = now;
      CU.forEach((cu, i) => {
        const el = cursorEls[i];
        if (cu.x == null){ const z = CURSORS[i].zone; cu.x = cxv + ((z[0]+z[1])/2)*sx; cu.y = cyv + ((z[2]+z[3])/2)*sy; cu.state = 'pause'; cu.timer = 0.2 + i*0.5; }
        el.style.opacity = vis;
        if (vis > 0.01 && !reduce){
          if (cu.state === 'pause'){ cu.timer -= dt; if (cu.timer <= 0) chooseNext(cu, i, sx, sy, cxv, cyv); }
          else {
            cu.t += dt / cu.dur;
            const k = cu.t >= 1 ? 1 : (1 - Math.pow(1 - cu.t, 3));
            cu.x = cu.sx0 + (cu.ex - cu.sx0) * k;
            cu.y = cu.sy0 + (cu.ey - cu.sy0) * k;
            if (cu.state === 'drag' && cu.held){
              cu.held.s.dragX = clampN(cu.held.s._baseX + (cu.x - cu.grabX0), -115, 115);
              cu.held.s.dragY = clampN(cu.held.s._baseY + (cu.y - cu.grabY0), -90, 90);
            }
            if (cu.t >= 1) arrive(cu);
          }
        }
        // keep the cursor out from under the sign-in box (drag stays in margins)
        let X = cu.x, Y = cu.y;
        if (cu.state !== 'drag' && br){
          const pad = 22;
          if (X > br.left-pad && X < br.right+pad && Y > br.top-pad && Y < br.bottom+pad){
            const dl = X-(br.left-pad), dr = (br.right+pad)-X, dtp = Y-(br.top-pad), db = (br.bottom+pad)-Y;
            const m = Math.min(dl, dr, dtp, db);
            if (m===dl) X = br.left-pad; else if (m===dr) X = br.right+pad; else if (m===dtp) Y = br.top-pad; else Y = br.bottom+pad;
          }
        }
        cu._x = X; cu._y = Y;
        el.style.transform = `translate(${X}px, ${Y}px)`;
      });
    }

    function render(now) {
      const t = (now || 0) * 0.001;
      const forced = window.__sbForceP;
      const p = (forced != null) ? forced : clamp((scrollEl.scrollTop) / maxScroll, 0, 1);
      const { sx, sy } = spread();
      const cxv = cx(), cyv = cy();
      const br = boxRef.current ? boxRef.current.getBoundingClientRect() : null;

      // atmosphere: sun fades out by mid-scroll, grid + board chrome fade in
      grid.style.opacity = clamp((p - 0.1) / 0.42, 0, 1);
      sun.style.opacity = 1 - clamp(p / 0.55, 0, 1);
      chrome.style.opacity = clamp((p - 0.74) / 0.16, 0, 1);
      hint.style.opacity = 1 - clamp(p / 0.04, 0, 1);
      // the "explore a live board" link is the payoff — it only surfaces once
      // the visitor reaches the very end of the scroll (the resolved live board)
      if (exploreRef.current) {
        const endVis = clamp((p - 0.9) / 0.08, 0, 1);
        exploreRef.current.style.opacity = endVis;
        exploreRef.current.style.pointerEvents = endVis > 0.5 ? 'auto' : 'none';
      }

      CARDS.forEach((c, i) => {
        const s = S[i];
        const e = ramp(p, c.in, 0.16);                          // entering 0→1
        const o = (c.out != null) ? ramp(p, c.out, 0.14) : 0;   // exiting 0→1
        const v = e * (1 - o);
        const wob = reduce ? 0 : Math.sin(t * 0.6 + c.phase) * 5 * v;
        let ox, oy, rot = c.r;
        if (coarse && c.kind === 'note' && br) {
          // mobile: notes are the pitch — center them and stack above/below the
          // box so they're FULLY on-screen and readable (images may bleed off,
          // notes never do). At most two notes overlap in time → top + bottom.
          const half = c.h / 2 + 6, gap = 14;
          const ty = c.mSlot === 'top' ? (br.top - cyv - gap - half) : (br.bottom - cyv + gap + half);
          ox = (s.dragX || 0);
          oy = ty + 16 * (1 - e) - 16 * o + (s.dragY || 0);
          rot = 0;
        } else {
          const sgnX = Math.sign(c.x || 1);
          const inDX = sgnX * 36, inDY = 56;
          const outDX = sgnX * 150, outDY = -40;
          ox = c.x * sx + inDX * (1 - e) * sx + outDX * o * sx + (s.dragX || 0);
          oy = c.y * sy + inDY * (1 - e) + outDY * o + wob + (s.dragY || 0);
        }
        const sc = 0.7 + 0.3 * e - 0.16 * o + (s._grab ? 0.05 : 0);
        const el = cardEls[i];
        el.style.opacity = v;
        el.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) rotate(${rot}deg) scale(${sc})`;
        el.classList.toggle('sb-grab', !!s._grab);
        s._x = cxv + ox; s._y = cyv + oy; s._v = v;
      });

      connEls.forEach((l, k) => {
        const a = S[CONN[k][0]], b = S[CONN[k][1]];
        l.setAttribute('x1', a._x); l.setAttribute('y1', a._y);
        l.setAttribute('x2', b._x); l.setAttribute('y2', b._y);
        l.setAttribute('stroke-opacity', Math.min(a._v, b._v) * 0.7);
      });

      arrowEls.forEach((el, k) => {
        const ar = ARROWS[k];
        const a = S[ar.from], b = S[ar.to];
        const vis = Math.min(a._v, b._v);
        if (vis < 0.4) { el.g.style.opacity = 0; return; }
        const ax = a._x, ay = a._y;
        const dx = b._x - ax, dy = b._y - ay, len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const pull = 38, bx = b._x - ux * pull, by = b._y - uy * pull;          // stop short of the card
        const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = -uy, ny = ux;
        const cpx = mx + nx * ar.bow, cpy = my + ny * ar.bow;                    // curve control point
        el.path.setAttribute('d', `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`);
        el.path.setAttribute('stroke', ar.color);
        const total = el.path.getTotalLength() || 1;
        const drawn = reduce ? 1 : ramp(p, ar.in, ar.win);
        el.path.setAttribute('stroke-dasharray', total.toFixed(1));
        el.path.setAttribute('stroke-dashoffset', (total * (1 - drawn)).toFixed(1));
        el.g.style.opacity = vis;
        let tanx = bx - cpx, tany = by - cpy; const tl = Math.hypot(tanx, tany) || 1; tanx /= tl; tany /= tl;
        const hx = -tany, hy = tanx, hl = 8, hw = 4.5;                            // arrowhead
        el.head.setAttribute('points', `${bx.toFixed(1)},${by.toFixed(1)} ${(bx - tanx*hl + hx*hw).toFixed(1)},${(by - tany*hl + hy*hw).toFixed(1)} ${(bx - tanx*hl - hx*hw).toFixed(1)},${(by - tany*hl - hy*hw).toFixed(1)}`);
        el.head.setAttribute('fill', ar.color);
        el.head.style.opacity = clamp((drawn - 0.72) / 0.28, 0, 1);
      });

      updateCursors(now, p, sx, sy, cxv, cyv, br);
      // a cursor near a visible card selects it (soleil ring) — collab feel
      CARDS.forEach((c, i) => {
        const s = S[i];
        let near = false;
        if (s._v > 0.55) { for (const cu of CU) { const dx = cu._x - s._x, dy = cu._y - s._y; if (dx*dx + dy*dy < 96*96) { near = true; break; } } }
        if (!s._grab) cardEls[i].classList.toggle('sb-sel', near);
      });
    }

    let rafId = 0;
    function loop(now){ render(now); rafId = requestAnimationFrame(loop); }
    const onScroll = () => render(performance.now());
    const onResize = () => { measure(); render(performance.now()); };

    measure();
    syncVisibleHeight();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (vv) { vv.addEventListener('resize', syncVisibleHeight); vv.addEventListener('scroll', syncVisibleHeight); }
    rafId = requestAnimationFrame(loop);
    render(0);

    return () => {
      cancelAnimationFrame(rafId);
      scrollEl.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (vv) { vv.removeEventListener('resize', syncVisibleHeight); vv.removeEventListener('scroll', syncVisibleHeight); }
      cardEls.forEach(el => el.remove());
      cursorEls.forEach(el => el.remove());
      connEls.forEach(el => el.remove());
      arrowEls.forEach(el => el.g.remove());
    };
  }, []);

  return (
    <div className="sb-scene" ref={sceneRef}>
      <div className="sb-scroll" ref={scrollRef}>
        <div className="sb-runway" ref={runwayRef}>
          <div className="sb-stage" ref={stageRef}>
            <div className="sb-sun" ref={sunRef} aria-hidden="true" />
            <div className="sb-grid" ref={gridRef} aria-hidden="true" />
            <div className="sb-grain" aria-hidden="true" />
            <svg className="sb-links" ref={linksRef} aria-hidden="true" />
            <div className="sb-cards" ref={cardsRef} aria-hidden="true" />
            <div className="sb-cursors" ref={cursorsRef} aria-hidden="true" />

            <div className="sb-chrome" ref={chromeRef} aria-hidden="true">
              <div className="sb-chrome-left">
                <img src="/clusters-logo-dark.png" alt="" />
                <span className="sb-chrome-brand">Clusters</span>
                <span className="sb-chrome-sep" />
                <span className="sb-chrome-crumb">Soleil Pictures</span>
                <span className="sb-chrome-crumb">›</span>
                <span className="sb-chrome-crumb sb-here">Lost Time · writers room</span>
              </div>
              <div className="sb-chrome-pill"><span className="sb-on">Canvas</span><span>List</span></div>
              <div className="sb-chrome-presence">
                <span className="sb-av" style={{ background:'#ffa500' }}>A</span>
                <span className="sb-av" style={{ background:'#6b9088' }}>T</span>
              </div>
            </div>

            <div className="sb-box-wrap">
              <div className="sb-box" ref={boxRef}>
                {children}
                {exploreHref && (
                  <a className="sb-explore" ref={exploreRef} href={exploreHref} target="_blank" rel="noopener noreferrer">
                    Explore a live board ↗
                  </a>
                )}
              </div>
            </div>

            <div className="sb-hint" ref={hintRef} aria-hidden="true">
              <span className="sb-hint-label">Scroll to explore</span>
              <span className="sb-chev" />
            </div>

            <div className="sb-foot">© Soleil Pictures</div>
          </div>
        </div>
      </div>
    </div>
  );
}
