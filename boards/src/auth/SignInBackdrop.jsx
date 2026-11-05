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
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import { HOME_FACT_NOTES } from '../lib/homeFactNotes.js';
import './signin-backdrop.css';

const RUNWAY_MULT = 8.2;        // runway height = this × viewport height (more scroll = gentler motion)
const RUNWAY_MULT_TOUCH = 7.7; // fewer swipes to the payoff on phones
const ENTER_RAMP  = 0.132; // scroll-progress span a card takes to ease IN
const EXIT_RAMP   = 0.117; // scroll-progress span a card takes to ease OUT
// The runway grew from 6.0 (4.8 on touch) to fit the three fact scenes, and
// the scenes before them keep their scroll distance, so their times are the
// old ones × 6.0/8.2. These two map the few p thresholds in render() that
// were written against the old runway: the first scale applies before the
// finale, the finale's own spacing keeps its length after it starts.
const TIME_MAP = {
  desk:  { oldFin: 0.72, fin: 6.7 / 8.2,  k: 6.0 / 8.2 },
  phone: { oldFin: 0.86, fin: 7.04 / 7.7, k: 4.8 / 7.7 },
};

// Each card has an entry window {in} and EITHER an exit window {out} (it streams
// in, holds, then streams out) OR {stay:true} (it arrives near the end and
// remains). Cards flow one at a time in small SCENES: each info note rides in
// with the one or two media cards it describes, and a line/arrow points AT the
// note to pull the eye to it. Scenes alternate left/right so only a couple of
// cards share the screen at once. The 8 cards marked stay (the finale, mid-array)
// settle into the resolved "live board"; the three fact scenes (HOME_FACT_NOTES)
// are appended at the very end so every index above is unchanged. mSlot drives the mobile-only top/bottom note layout (alternated
// in time so each note lands alone in its slot and is fully readable).
const CARDS = [
  // Streaming scenes each sit in a DIFFERENT quadrant, rotating TL→BR→BL→TR so
  // the active cluster drifts AROUND the box (no side fills-empties-refills). Each
  // is a note + one source-media pair (arrow points at the note); three "filler"
  // media drop into the opposite corner at the seams to keep it continuous + varied.
  // idx0 — filler: Yahweh keyart (balances scene A, bottom-centre)
  { kind:'image', img:'/signin-yahweh.webp', label:'yahweh_keyart.png', dot:'#3b82f6', x:120,y:235,r:-6,w:168,h:228, in:0.059,out:0.22 },
  // scene A → TOP-LEFT: Yahweh board → LIVE CANVAS note
  { kind:'board', name:'Yahweh · refs', count:15, mini:[ {t:'img',src:'/signin-yahweh.webp',l:6,tp:8,w:42,h:64,r:-5}, {t:'pal',cols:['#fefefe','#51a0e7','#042e72','#000000'],l:52,tp:12,w:42,h:22,r:4}, {t:'note',l:44,tp:48,w:50,h:40,r:-3} ], x:-445,y:-25,r:3,w:198,h:144, in:0.037,out:0.22 },
  { kind:'note', mSlot:'top', head:'LIVE CANVAS', text:'Your whole team on one infinite canvas — live cursors, comments, and presence, no refresh.', dot:'#f59e0b', x:-340,y:-195,r:-3,w:212,h:138, in:0.088,out:0.263 },
  // idx3 — filler: Lost Time palette (balances scene B, top-centre)
  { kind:'palette', cols:['#222a4e','#f8ebce','#ff7720'], label:'Lost Time', dot:'#34d399', x:-30,y:-250,r:4,w:196,h:100, in:0.227,out:0.373 },
  // scene B → BOTTOM-RIGHT: Lost Time still → TAGS note
  { kind:'image', img:'/signin-losttime-still1.webp', label:'losttime_int_07.jpg', dot:'#3b82f6', x:450,y:55,r:-5,w:240,h:152, in:0.161,out:0.344 },
  { kind:'note', mSlot:'bottom', head:'TAGS', text:'Tag a card, a group or a whole cluster — every tag gathers its references from across the workspace.', dot:'#f59e0b', x:375,y:235,r:4,w:224,h:142, in:0.205,out:0.38 },
  // scene C → BOTTOM-LEFT: MoodBoard → DOCS note
  { kind:'board', name:'MoodBoard', count:36, mini:[ {t:'img',src:'/signin-losttime-still1.webp',l:5,tp:8,w:46,h:50,r:-4}, {t:'img',src:'/signin-losttime-still2.webp',l:50,tp:30,w:46,h:52,r:4}, {t:'pal',cols:['#222a4e','#f8ebce','#ff7720'],l:8,tp:60,w:38,h:20,r:2} ], x:-455,y:25,r:-3,w:196,h:142, in:0.307,out:0.483 },
  { kind:'note', mSlot:'top', head:'DOCS, BUILT IN', text:'Write briefs right beside the canvas — rich docs with @mentions and screenplay mode.', dot:'#f59e0b', x:-360,y:215,r:3,w:214,h:134, in:0.351,out:0.512 },
  // idx8 — filler: Yahweh score (balances scene C, bottom-centre)
  { kind:'audio', cover:'/signin-yahweh.webp', title:'Yahweh — main theme', artist:'Soleil Pictures · score', dur:'3:48', x:120,y:265,r:-3,w:250,h:110, in:0.38,out:0.527 },
  // scene D → TOP-RIGHT: dailies reel → SHARE OR LOCK note
  { kind:'video', thumb:'/signin-losttime-still1.webp', title:'Lost Time — dailies', dur:'2:14', x:455,y:25,r:4,w:228,h:146, in:0.395,out:0.541 },
  { kind:'note', mSlot:'bottom', head:'SHARE OR LOCK', text:'Share a board with one link, or keep it private. You own your references.', dot:'#f59e0b', x:385,y:-160,r:-3,w:226,h:132, in:0.439,out:0.571 },
  // ── finale cards — arrive near the end and STAY (the resolved live board) ──
  { kind:'image', img:'/signin-losttime-still2.webp', label:'losttime_diner_11.jpg', dot:'#3b82f6', x:-455,y:-115,r:-5,w:236,h:150, in:0.817, stay:true },
  { kind:'image', img:'/signin-losttime.webp', label:'losttime_key.png', dot:'#3b82f6', x:455,y:-105,r:5,w:172,h:232, in:0.876, stay:true },
  { kind:'audio', cover:'/signin-losttime.webp', title:'Lost Time — end credits', artist:'Soleil Pictures', dur:'4:05', x:-180,y:-290,r:-3,w:250,h:110, in:0.876, stay:true },
  { kind:'palette', cols:['#FFA500','#FFFAF0','#272727','#EF7300'], label:'Clusters', dot:'#34d399', x:475,y:160,r:3,w:188,h:104, in:0.898, stay:true },
  { kind:'board', name:'Clusters Logo', count:32, mini:[ {t:'img',src:'/signin-logo-mark.webp',l:8,tp:12,w:42,h:54,r:-3,fit:'contain',bg:'#0a0a0c'}, {t:'pal',cols:['#FFA500','#FFFAF0','#272727','#EF7300'],l:54,tp:16,w:40,h:24,r:3}, {t:'note',l:48,tp:50,w:46,h:38,r:-2} ], x:230,y:295,r:-3,w:196,h:142, in:0.92, stay:true },
  { kind:'note', mSlot:'top', head:'RELATIONSHIP GRAPH', text:'Every card connects. Jump between boards through a living graph of how your ideas link up.', dot:'#f59e0b', x:-345,y:235,r:4,w:218,h:142, in:0.949, stay:true },
  { kind:'tag', text:'needs-review', dot:'#f59e0b', x:40,y:-315,r:0, in:0.963, stay:true },
  { kind:'tag', text:'approved', dot:'#34d399', x:160,y:-300,r:0, in:0.978, stay:true },
  // ── the fact scenes (idx19–25), appended so no index above moved. They fly in
  // between SHARE OR LOCK and the finale, one quadrant each (TL, BR, BL), and
  // are gone before the finale's cards reach their corner. Their words are
  // HOME_FACT_NOTES — the same lines as index.html's plain-text fallback.
  // scene E → TOP-LEFT: still + dailies teaser → ANY FILE, ANY SIZE note
  { kind:'image', img:'/signin-losttime-still1.webp', label:'losttime_ext_03.jpg', dot:'#3b82f6', x:-405,y:-25,r:-5,w:240,h:152, in:0.45,out:0.62 },
  { kind:'video', thumb:'/signin-yahweh.webp', title:'Yahweh — teaser', dur:'1:32', x:-320,y:165,r:3.5,w:204,h:132, in:0.47,out:0.64 },
  { kind:'note', mSlot:'top', ...HOME_FACT_NOTES[0], dot:'#f59e0b', x:-340,y:-205,r:-3,w:216,h:124, in:0.5,out:0.66 },
  // scene F → BOTTOM-RIGHT: keyart → FREE TO START note
  { kind:'image', img:'/signin-yahweh.webp', label:'yahweh_poster.png', dot:'#3b82f6', x:440,y:20,r:-6,w:168,h:228, in:0.53,out:0.70 },
  { kind:'note', mSlot:'bottom', ...HOME_FACT_NOTES[1], dot:'#f59e0b', x:372,y:225,r:-3,w:230,h:150, in:0.58,out:0.74 },
  // scene G → BOTTOM-LEFT: a pitch-refs board → IN CHATGPT AND CLAUDE note
  { kind:'board', name:'Pitch refs', count:18, mini:[ {t:'img',src:'/signin-yahweh.webp',l:6,tp:10,w:40,h:58,r:-4}, {t:'pal',cols:['#222a4e','#f8ebce','#ff7720'],l:52,tp:14,w:42,h:22,r:3}, {t:'note',l:48,tp:50,w:46,h:38,r:-2} ], x:-455,y:60,r:-3,w:196,h:142, in:0.62,out:0.78 },
  { kind:'note', mSlot:'top', ...HOME_FACT_NOTES[2], dot:'#f59e0b', x:-345,y:228,r:3,w:232,h:128, in:0.66,out:0.81 },
];

// LINKS — faint dashed connectors (indices into CARDS). Within each scene a media
// card links to the one beside it (a quiet relationship thread) and a line runs
// into the note; the finale keeps a small relationship graph between its resting
// cards. Opacity follows min(endpoint visibility), so a line is only present
// while both its cards are.
const LINKS = [
  [0,1],   // keyart filler → Yahweh board
  [3,4],   // Lost Time palette filler → still
  [8,6],   // Yahweh score filler → MoodBoard
  // settled-board relationship graph (the note→board arrow is separate)
  [16,15], [12,13],
  [20,19],   // fact scene E: teaser → still
];

// hand-annotation arrows that draw IN slowly, like a teammate circling a note to
// say "read this". Each points FROM a media card TO the note it explains, so the
// line makes sense and pulls the eye to the note. Hidden until BOTH endpoints are
// visible (render guards vis < 0.4). indices into CARDS; bow = curve; in/win =
// draw window (win is wide so the stroke draws gently).
const ARROWS = [
  { from:1,  to:2,  color:'#f59e0b', bow:26,  in:0.117, win:0.08 },  // Yahweh board → LIVE CANVAS note (TL)
  { from:4,  to:5,  color:'#10b981', bow:-26, in:0.234, win:0.08 },  // Lost Time still → TAGS note (BR)
  { from:6,  to:7,  color:'#f59e0b', bow:26,  in:0.38, win:0.08 },  // MoodBoard → DOCS note (BL)
  { from:9,  to:10, color:'#3b82f6', bow:-26, in:0.468, win:0.073 },  // dailies reel → SHARE OR LOCK note (TR)
  { from:11, to:16, color:'#10b981', bow:-34, in:0.963, win:0.073 },  // diner still → RELATIONSHIP GRAPH note
  { from:19, to:21, color:'#f59e0b', bow:26,  in:0.535, win:0.08 },   // still → ANY FILE note (TL)
  { from:22, to:23, color:'#10b981', bow:-26, in:0.62, win:0.08 },  // keyart → FREE TO START note (BR)
  { from:24, to:25, color:'#3b82f6', bow:26,  in:0.70, win:0.075 },  // board → IN CHATGPT AND CLAUDE note (BL)
];
const SVGNS = 'http://www.w3.org/2000/svg';

// PHONE — the phone's own choreography (a touch screen ≤640px wide). The box is
// a full-width column there, so the only free space is a band ABOVE the
// wordmark (under the faux top bar) and a band BELOW the explore pill (above
// the footer). Each band holds one group at a time: a note on one side of the
// box, the media it describes on the other, swapping sides scene by scene; a
// group's rows of cards share one scale, are centred in their band, and never
// overlap. Each band's next group arrives only after the last one has gone
// (out + PH_OUT ≤ next in). The last row of a group is dropped when the band
// is too short for it, and a group that still can't fit is hidden — a short
// screen shows less, never a crammed or clipped card. The finale (no `out`)
// is a small resolved board: the graph note + tags on top, two cards below.
// A screen whose bottom band can't hold a card (an iPhone SE) keeps the pitch:
// the bottom band's notes move up and take the top media's turn (every note
// window starts exactly as the previous top window has finished).
const PHONE_GROUPS = [
  { band:'bot', in:0.019, out:0.118, rows:[[1,0]] },     // Yahweh board + keyart
  { band:'top', in:0.031, out:0.131, rows:[[2]] },       // LIVE CANVAS
  { band:'bot', in:0.162, out:0.243, rows:[[5]] },       // TAGS
  { band:'top', in:0.168, out:0.256, rows:[[4,3]] },     // Lost Time still + palette
  { band:'bot', in:0.28,  out:0.368, rows:[[6,8]] },     // MoodBoard + score
  { band:'top', in:0.293, out:0.38,  rows:[[7]] },       // DOCS, BUILT IN
  { band:'top', in:0.411, out:0.505, rows:[[9]] },       // dailies reel
  { band:'bot', in:0.411, out:0.505, rows:[[10]] },      // SHARE OR LOCK
  { band:'bot', in:0.538, out:0.629, rows:[[20,19]] },   // teaser + still
  { band:'top', in:0.545, out:0.636, rows:[[21]] },      // ANY FILE, ANY SIZE
  { band:'top', in:0.669, out:0.76,  rows:[[23]] },      // FREE TO START (too tall for a short bottom band)
  { band:'bot', in:0.669, out:0.76,  rows:[[22]] },      // keyart (hidden where the bottom band can't hold it)
  { band:'bot', in:0.792, out:0.883, rows:[[24]] },      // Pitch refs board
  { band:'top', in:0.792, out:0.883, rows:[[25]] },      // IN CHATGPT AND CLAUDE
  { band:'top', in:0.915, rows:[[16],[17,18]] },         // finale: RELATIONSHIP GRAPH + tags
  { band:'bot', in:0.914, rows:[[15,14]] },              // finale: Clusters Logo board + palette
];
const PH_IN = 0.037, PH_OUT = 0.0315, PH_STAGGER = 0.0125;   // = the old 0.06 / 0.05 / 0.02 × 4.8/7.7
const PH_MEDIA_MAX = 0.66, PH_MEDIA_MIN = 0.42, PH_NOTE_MIN = 0.84;
const PH_EDGE = 16, PH_GAP = 10, PH_NOTE_W = 330;

// Each cursor wanders its OWN zone (left / right) with eased, pausing motion
// toward fresh targets, and sometimes grabs a nearby card and nudges it, like a
// teammate tidying the board. zone = [xMin,xMax,yMin,yMax] center-rel px.
const CURSORS = [
  { name:'Andrew', color:'#ffa500', zone:[-525,-270,-300,260] },
  { name:'Tobe',   color:'#6b9088', zone:[ 270, 525,-300,260] },
];
const ARROW = '<svg width="17" height="21" viewBox="0 0 16 20" fill="none"><path d="M2 2 L2 15 L5.5 12 L8 17.5 L10 16.5 L7.5 11 L13 11 Z" fill="COLOR" stroke="#0a0a0c" stroke-width="1" stroke-linejoin="round"/></svg>';

// Deterministic "waveform" peaks from a string seed. Synthesized on purpose
// and legitimately so: these two cards are DECORATION on the sign-in backdrop
// and there is no audio file behind them to draw. The real AudioCard used to
// share this trick on actual uploads, which made the product's promise of "a
// real waveform, drawn from the file" untrue — it now decodes the file
// (lib/audioAnalysis.js). Do not re-export this into the app.
// Returns count values in ~[0.3,1].
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

// Point where the ray from a card's centre toward (dx,dy) crosses its edge.
// Connectors + arrows attach HERE, never at the centre — matching how the app's
// annotation arrows always touch the perimeter of a card. hw/hh are half-extents.
function boxEdge(cx, cy, hw, hh, dx, dy) {
  const adx = Math.abs(dx) || 1e-3, ady = Math.abs(dy) || 1e-3;
  const t = Math.min(hw / adx, hh / ady);
  return [cx + dx * t, cy + dy * t];
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
  const chromeRef  = useRef(null);
  const hintRef    = useRef(null);
  const boxRef     = useRef(null);
  const exploreRef = useRef(null);
  const footRef    = useRef(null);

  // Uniform lp_* engagement package for '/'. Scroll is 'manual': the reveal's
  // rAF loop below feeds its progress p straight into the tracker. The legacy
  // map keeps landing_scroll/landing_dwell firing with their historical prop
  // shapes — the signup-funnel RPCs read those names.
  const lp = useLandingEngagement({
    page: '/', pageKind: 'home', scroll: 'manual',
    legacy: { scroll: EV.LANDING_SCROLL, dwell: EV.LANDING_DWELL },
  });
  const lpRef = useRef(lp);
  lpRef.current = lp;

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const runwayMult = coarse ? RUNWAY_MULT_TOUCH : RUNWAY_MULT;
    const sceneEl = sceneRef.current;
    const scrollEl = scrollRef.current;
    const cardsEl = cardsRef.current;
    const cursorsEl = cursorsRef.current;
    const linksSvg = linksRef.current;
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
      // On touch, notes are force-stacked above/below the box and share the top/
      // bottom strips with the finale's tags + media — lift notes above every
      // other card so they're the readable foreground, never covered by a card.
      el.style.zIndex = (coarse && c.kind === 'note') ? 8 : (c.kind === 'tag') ? 4 : (i % 3) + 1;
      cardsEl.appendChild(el);
      c.phase = i * 1.3;
      return el;
    });

    const connEls = LINKS.map(() => {
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
      // _d/_len cache the path string + its measured length so we only pay the
      // synchronous getTotalLength() reflow when the geometry actually changes.
      return { g, path, head, _d: null, _len: 1 };
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

    // Phone layout state. PHONE_OF[i] = the card's group and its stagger slot;
    // PS[i] = its unscaled size (notes are re-flowed to one wide, short banner
    // and measured; tags are measured), refreshed in measure(), never per frame.
    const PHONE_OF = CARDS.map(() => null);
    PHONE_GROUPS.forEach((g) => { let k = 0; g.rows.forEach(row => row.forEach(i => { PHONE_OF[i] = { g, k: k++ }; })); });
    const PS = CARDS.map(c => ({ w: c.w || 116, h: c.h || 34 }));
    const PL = CARDS.map(() => ({ x: 0, y: 0, s: 1, on: false, band: 'top' }));
    let phone = false, plKey = '';
    const bands = { top: [0, 0], bot: [0, 0] };
    function setupPhone(vw) {
      const was = phone;
      phone = coarse && vw <= 640;
      if (!phone && !was) return;
      cardsEl.classList.toggle('sb-phone', phone);   // the phone's tighter note banner (CSS)
      const noteW = Math.min(PH_NOTE_W, vw - 2 * PH_EDGE);
      CARDS.forEach((c, i) => {
        const el = cardEls[i];
        if (c.kind === 'note') {
          el.style.width = (phone ? noteW : c.w) + 'px';
          el.style.height = phone ? 'auto' : c.h + 'px';
          PS[i] = phone ? { w: noteW, h: el.offsetHeight || c.h } : { w: c.w, h: c.h };
        } else if (c.kind === 'tag') {
          PS[i] = { w: el.offsetWidth || 100, h: el.offsetHeight || 26 };
        }
      });
      plKey = '';
    }
    // Lay every phone group out in its band: one shared scale per group, rows
    // centred and stacked, the last row dropped (then the group hidden) when
    // the band is too short. Pure math, cached until a band or width moves.
    function layoutPhone(vw) {
      const key = `${vw}|${bands.top}|${bands.bot}`;
      if (key === plKey) return;
      plKey = key;
      const W = vw - 2 * PH_EDGE;
      const squeeze = bands.bot[1] - bands.bot[0] < 60;
      for (const g of PHONE_GROUPS) {
        g.rows.forEach(row => row.forEach(i => { PL[i].on = false; }));
        const isNote = g.rows.some(row => row.some(i => CARDS[i].kind === 'note'));
        if (squeeze && g.band === 'top' && !isNote && g.out != null) continue;
        const band = squeeze && isNote ? 'top' : g.band;
        const [y0, y1] = bands[band];
        const H = y1 - y0;
        let rows = g.rows, s = 0;
        for (;;) {
          let fixedH = 0, varH = 0, sW = Infinity;
          for (const row of rows) {
            const rh = Math.max(...row.map(i => PS[i].h));
            if (row.every(i => CARDS[i].kind === 'tag')) { fixedH += rh; continue; }
            varH += rh;
            sW = Math.min(sW, (W - PH_GAP * (row.length - 1)) / row.reduce((a, i) => a + PS[i].w, 0));
          }
          s = Math.min(isNote ? 1 : PH_MEDIA_MAX, sW, (H - fixedH - PH_GAP * (rows.length - 1)) / (varH || 1));
          if (s >= (isNote ? PH_NOTE_MIN : PH_MEDIA_MIN)) break;
          if (rows.length > 1) rows = rows.slice(0, -1); else { rows = null; break; }
        }
        if (!rows) continue;
        const rs = (row) => row.every(i => CARDS[i].kind === 'tag') ? 1 : s;
        const total = rows.reduce((a, row) => a + Math.max(...row.map(i => PS[i].h)) * rs(row), 0) + PH_GAP * (rows.length - 1);
        let y = y0 + (H - total) / 2;
        for (const row of rows) {
          const k = rs(row);
          const rh = Math.max(...row.map(i => PS[i].h)) * k;
          let x = (vw - (row.reduce((a, i) => a + PS[i].w * k, 0) + PH_GAP * (row.length - 1))) / 2;
          for (const i of row) { const w = PS[i].w * k; Object.assign(PL[i], { x: x + w / 2, y: y + rh / 2, s: k, on: true, band }); x += w + PH_GAP; }
          y += rh + PH_GAP;
        }
      }
    }

    let maxScroll = 1;
    function measure() {
      const vw = (sceneEl && sceneEl.clientWidth) || innerWidth;
      const vh = (sceneEl && sceneEl.clientHeight) || innerHeight;
      setupPhone(vw);
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
    // On a phone each cursor keeps to one band (the first above the box, the
    // second below it), only ever picks up a resting card in that band, and
    // carries it a few px, so the tidy phone board stays tidy.
    const phoneBand = (i) => (i === 0 ? 'top' : 'bot');
    function chooseNext(cu, i, sx, sy, cxv, cyv){
      if (phone){
        const b = bands[phoneBand(i)];
        const cands = CARDS.map((c, idx) => ({ c, s: S[idx], idx }))
          .filter(({ c, s, idx }) => c.stay && c.kind !== 'note' && c.kind !== 'tag' && s._v > 0.6 && !s._grab
            && PL[idx].on && PL[idx].band === phoneBand(i));
        if (cands.length && Math.random() < 0.5){
          cu.held = cands[(Math.random() * cands.length) | 0];
          cu.state = 'toCard'; setSeg(cu, cu.held.s._x, cu.held.s._y, 220);
        } else {
          const ex = PH_EDGE + Math.random() * (cw() - 2 * PH_EDGE - 48);   // room for the name flag on its right
          const ey = b[0] + Math.random() * Math.max(0, b[1] - b[0] - 24);
          cu.state = 'move'; setSeg(cu, ex, ey, 180);
        }
        return;
      }
      const z = CURSORS[i].zone;
      // visible, settled, ungrabbed final-board cards whose home is in my zone
      const cands = CARDS.map((c, idx) => ({ c, s: S[idx] }))
        // never the notes: they're the pitch, and a dragged note can't be read
        .filter(({ c, s }) => c.stay && c.kind !== 'note' && s._v > 0.6 && !s._grab
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
        const ddx = (Math.random()*2-1) * (phone ? 12 : 74), ddy = (Math.random()*2-1) * (phone ? 6 : 56);
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
        if (cu.x == null){
          const z = CURSORS[i].zone; cu.x = cxv + ((z[0]+z[1])/2)*sx; cu.y = cyv + ((z[2]+z[3])/2)*sy; cu.state = 'pause'; cu.timer = 0.2 + i*0.5;
          if (phone){ const b = bands[phoneBand(i)]; cu.x = cw() * (i ? 0.72 : 0.28); cu.y = (b[0] + b[1]) / 2; }
        }
        // a band too short to hold a card (a small phone's bottom) keeps no cursor
        el.style.opacity = (phone && (bands[phoneBand(i)][1] - bands[phoneBand(i)][0]) < 60) ? 0 : vis;
        if (vis > 0.01 && !reduce){
          if (cu.state === 'pause'){ cu.timer -= dt; if (cu.timer <= 0) chooseNext(cu, i, sx, sy, cxv, cyv); }
          else {
            cu.t += dt / cu.dur;
            const k = cu.t >= 1 ? 1 : (1 - Math.pow(1 - cu.t, 3));
            cu.x = cu.sx0 + (cu.ex - cu.sx0) * k;
            cu.y = cu.sy0 + (cu.ey - cu.sy0) * k;
            if (cu.state === 'drag' && cu.held){
              cu.held.s.dragX = clampN(cu.held.s._baseX + (cu.x - cu.grabX0), phone ? -12 : -115, phone ? 12 : 115);
              cu.held.s.dragY = clampN(cu.held.s._baseY + (cu.y - cu.grabY0), phone ? -6 : -90, phone ? 6 : 90);
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
        // on a phone the notes span their band: step the cursor (and its name
        // flag, which hangs below it) off a note's or a tag's words, above or below it
        let cuHide = false;
        if (phone){
          for (let k = 0; k < CARDS.length; k++){
            const s = S[k];
            if ((CARDS[k].kind !== 'note' && CARDS[k].kind !== 'tag') || s._v < 0.3) continue;
            const t0 = s._y - s._hh - 36, t1 = s._y + s._hh + 4;
            if (X > s._x - s._hw - 4 && X < s._x + s._hw + 4 && Y > t0 && Y < t1){
              // nearest side, unless that side would put it on the box
              const b = bands[phoneBand(i)];
              const fits = (y) => y >= b[0] - 4 && y <= b[1] - 30;
              const near = (Y - t0 < t1 - Y) ? t0 : t1, far = near === t0 ? t1 : t0;
              if (fits(near)) Y = near; else if (fits(far)) Y = far; else { Y = near; cuHide = true; }
            }
          }
        }
        if (cuHide) el.style.opacity = 0;   // no room beside the note: step out
        cu._x = X; cu._y = Y;
        el.style.transform = `translate(${X}px, ${Y}px)`;
      });
    }

    // The scene follows the scroll a beat behind instead of jumping with each
    // wheel notch: the drawn progress glides toward the real one (frame-rate
    // independent). Reduced motion and __sbForceP snap straight to it.
    let pShown = 0, lastFrame = 0;
    function render(now) {
      const t = (now || 0) * 0.001;
      const forced = window.__sbForceP;
      const pRaw = (forced != null) ? forced : clamp((scrollEl.scrollTop) / maxScroll, 0, 1);
      // Landing engagement (scroll depth thresholds + dwell max_depth) rides
      // the shared lp tracker — the legacy landing_scroll/landing_dwell names
      // keep firing from there with identical shapes. Always the REAL progress.
      if (forced == null) lpRef.current.tracker.reportProgress(pRaw);
      const dtF = now && lastFrame ? clamp((now - lastFrame) / 1000, 0, 0.1) : 0;
      if (now) lastFrame = now;
      pShown = (!dtF || forced != null || reduce) ? pRaw : pShown + (pRaw - pShown) * (1 - Math.exp(-dtF * 9));
      const p = pShown;
      const { sx, sy } = spread();
      const cxv = cx(), cyv = cy();
      const br = boxRef.current ? boxRef.current.getBoundingClientRect() : null;

      // The footer is pinned to the stage bottom while the box is centred in the
      // VISIBLE height, so a short viewport (a phone with its keyboard up, the
      // code step's longer copy) drew the tagline and the explore pill straight
      // over the footer links. Step the footer aside while the box reaches it;
      // it keeps its layout (visibility, not display), so footTop stays true.
      const footEl = footRef.current;
      const footTop = footEl ? footEl.getBoundingClientRect().top : ch();
      let footCrowded = false;
      if (footEl && br) {
        const exEl = exploreRef.current;
        const exBottom = exEl && Number(exEl.style.opacity) > 0.01 ? exEl.getBoundingClientRect().bottom : 0;
        footCrowded = Math.max(br.bottom, exBottom) > footTop - 6;
        footEl.classList.toggle('sb-foot-crowded', footCrowded);
      }

      // Mobile note safe-band: notes must stay clear of the faux topbar (top), the
      // footer + the always-on "explore" pill (bottom), and the on-screen keyboard.
      // Reserve the topbar height ALWAYS (its opacity ramps 0.74→0.90) so notes don't
      // lurch down as it fades in.
      let noteBandTop = 0, noteBandBot = 0, noteExploreBot = 0;
      if (coarse && br) {
        const chromeH = chrome ? chrome.getBoundingClientRect().height : 48;   // 48 + safe-top
        noteBandTop = chromeH + 10;
        const vvh = vv ? vv.height : ch();                                     // keep above keyboard
        noteBandBot = Math.min(footTop, vvh) - 10;
        const exEl = exploreRef.current;                                       // always-on pill on touch
        noteExploreBot = exEl ? exEl.getBoundingClientRect().bottom : (br.bottom + 44);
      }
      if (phone && br) {
        // the box's top padding is empty; its first words sit 28px in
        bands.top = [Math.round(noteBandTop), Math.round(br.top + 10)];
        // the bottom band stops 22px short of the footer (noteBandBot's 10 + 12)
        bands.bot = [Math.round(Math.max(noteExploreBot, br.bottom - 16) + 12), Math.round(noteBandBot - 12)];
        layoutPhone(cw());
      }

      // atmosphere: the ground is the app's own board ground from the first
      // frame (CSS). --sb-f (0→1 over the first 30% of the scroll) fades the
      // warm glow + orbit out as the board fills in, and on phones fades in a
      // soft veil behind the box's words so passing cards can't muddy them.
      const T = phone ? TIME_MAP.phone : TIME_MAP.desk;
      const tm = (q) => q < T.oldFin ? q * T.k : T.fin + (q - T.oldFin) * T.k;   // an old-runway p → today's
      sceneEl.style.setProperty('--sb-f', clamp(p / tm(0.3), 0, 1).toFixed(3));
      chrome.style.setProperty('--sb-c', clamp((p - tm(0.74)) / (0.16 * T.k), 0, 1).toFixed(3));
      // keep the scroll cue visible through the first nudge so it can't be missed
      hint.style.opacity = 1 - clamp(p / tm(0.10), 0, 1);
      // the "explore a live board" link is the payoff. On desktop it surfaces
      // only at the end of the scroll (the resolved live board). On touch the
      // bouncing-at-the-gate cohort never scrolls that far, so show it from the
      // first frame — it's the lowest-commitment alternative to signing up.
      if (exploreRef.current) {
        if (coarse) {
          exploreRef.current.style.opacity = 1;
          exploreRef.current.style.pointerEvents = 'auto';
        } else {
          const endVis = clamp((p - tm(0.9)) / (0.08 * T.k), 0, 1);
          exploreRef.current.style.opacity = endVis;
          exploreRef.current.style.pointerEvents = endVis > 0.5 ? 'auto' : 'none';
        }
      }

      CARDS.forEach((c, i) => {
        const s = S[i];
        const e = ramp(p, c.in, ENTER_RAMP);                        // entering 0→1
        const o = (c.out != null) ? ramp(p, c.out, EXIT_RAMP) : 0;  // exiting 0→1
        let v = e * (1 - o);
        const wob = reduce ? 0 : Math.sin(t * 0.6 + c.phase) * 5 * v;
        let ox, oy, rot = c.r;
        // Cards grow in from 86% (was 70%): a settle, not a pop.
        let sc = 0.86 + 0.14 * e - 0.16 * o + (s._grab ? 0.05 : 0);
        if (phone) {
          // the phone choreography (PHONE_GROUPS): own windows, own spot
          const ph = PHONE_OF[i], pl = PL[i];
          if (!ph || !pl.on || !br) {
            v = 0; ox = 0; oy = 0; sc = 1;
          } else {
            const start = ph.g.in + ph.k * PH_STAGGER;
            const pe = ramp(p, start, PH_IN);
            const po = (ph.g.out != null) ? ramp(p, ph.g.out, PH_OUT) : 0;
            v = pe * (1 - po);
            const away = pl.band === 'top' ? -1 : 1;           // arrive from (and leave toward) the screen edge
            const pwob = reduce ? 0 : Math.sin(t * 0.6 + c.phase) * 1.5 * v;
            ox = pl.x - cxv + (s.dragX || 0);
            oy = pl.y - cyv + away * (10 * (1 - pe) + 8 * po) + pwob + (s.dragY || 0);
            sc = pl.s * (0.94 + 0.06 * pe - 0.06 * po + (s._grab ? 0.03 : 0));
            rot = c.kind === 'note' || c.kind === 'tag' ? 0 : c.r * 0.4;
          }
        } else if (coarse && c.kind === 'note' && br) {
          // mobile: notes are the pitch — stack them tight to the box but ALWAYS
          // inside the safe band (below the topbar, above the footer, clear of the
          // explore pill). If a note can't fit its slot, shrink it; if there's truly
          // no room, hide it rather than paint a covered/clipped sliver.
          const gap = 20, chipGap = 10, MIN = 0.5;
          const top = c.mSlot === 'top';
          const nearY = top ? (br.top - gap) : (noteExploreBot + chipGap);   // edge that hugs the box/pill
          const slot  = top ? (nearY - noteBandTop) : (noteBandBot - nearY);
          const fitMax = slot / c.h;                  // largest scale that fits the slot
          if (fitMax < MIN) v = 0;                    // no room (e.g. landscape) → hide, never cover
          sc = Math.min(sc, Math.max(fitMax, MIN));   // cap scale to the slot; never below the readable floor
          const hh = (c.h * sc) / 2;                  // SCALED half-height
          let cY = top ? (nearY - hh) : (nearY + hh); // hug the near edge, grow into the band
          cY += 16 * (1 - e) - 16 * o + (s.dragY || 0); // entry/exit drift + cursor nudge
          cY = Math.max(noteBandTop + hh, Math.min(noteBandBot - hh, cY));  // hard safety clamp
          ox = (s.dragX || 0);
          oy = cY - cyv;
          rot = 0;
        } else {
          // Cards mostly scale + fade in place — only a small drift, so the eye
          // doesn't read a whole "side" sweeping off (which made it feel phased).
          const sgnX = Math.sign(c.x || 1);
          const inDX = sgnX * 22, inDY = 38;
          const outDX = sgnX * 46, outDY = 26;
          ox = c.x * sx + inDX * (1 - e) * sx + outDX * o * sx + (s.dragX || 0);
          oy = c.y * sy + inDY * (1 - e) + outDY * o + wob + (s.dragY || 0);
          // The finale's resting cards stay above the footer: on a phone the
          // board card's name row landed on the legal links and neither could be
          // read. Half-height of the rotated, scaled card, so a tilt can't dip
          // a corner in. Skipped while the footer is stepped aside.
          // Same at the top on desktop: on a 720-tall laptop the audio card
          // slid under the faux top bar and lost its title. (On a phone the
          // bar may cover them: pushing them down lands them on the box.)
          if (c.stay) {
            const rad = rot * Math.PI / 180;
            const w = (c.w || 116) * sc, h = (c.h || 34) * sc;
            const halfH = (Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad))) / 2;
            if (!footCrowded) oy = Math.min(oy, footTop - 8 - halfH - cyv);
            if (!coarse) oy = Math.max(oy, chrome.offsetHeight + 10 + halfH - cyv);
          }
        }
        const el = cardEls[i];
        el.style.opacity = v;
        el.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px)) rotate(${rot}deg) scale(${sc})`;
        el.classList.toggle('sb-grab', !!s._grab);
        s._x = cxv + ox; s._y = cyv + oy; s._v = v;
        s._hw = (PS[i].w * sc) / 2; s._hh = (PS[i].h * sc) / 2;  // for edge-attached links/arrows
      });

      connEls.forEach((l, k) => {
        const a = S[LINKS[k][0]], b = S[LINKS[k][1]];
        // on mobile the notes jump to the center slots, so any line into a note
        // would streak across the box — keep only the media↔media threads there.
        if (coarse && (CARDS[LINKS[k][0]].kind === 'note' || CARDS[LINKS[k][1]].kind === 'note')) {
          l.setAttribute('stroke-opacity', 0); return;
        }
        // attach to each card's edge, not its centre
        const [x1, y1] = boxEdge(a._x, a._y, a._hw, a._hh, b._x - a._x, b._y - a._y);
        const [x2, y2] = boxEdge(b._x, b._y, b._hw, b._hh, a._x - b._x, a._y - b._y);
        l.setAttribute('x1', x1.toFixed(1)); l.setAttribute('y1', y1.toFixed(1));
        l.setAttribute('x2', x2.toFixed(1)); l.setAttribute('y2', y2.toFixed(1));
        l.setAttribute('stroke-opacity', Math.min(a._v, b._v) * 0.5);
      });

      arrowEls.forEach((el, k) => {
        const ar = ARROWS[k];
        const a = S[ar.from], b = S[ar.to];
        const vis = Math.min(a._v, b._v);
        // arrows point at notes; on mobile the notes are centered (front-and-
        // centre already), so the arrow would just cross the box — hide them.
        if (coarse || vis < 0.4) { el.g.style.opacity = 0; return; }
        // control point: bow the centre-to-centre midpoint sideways for a curve
        const dx = b._x - a._x, dy = b._y - a._y, len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const cpx = (a._x + b._x) / 2 + nx * ar.bow, cpy = (a._y + b._y) / 2 + ny * ar.bow;
        // start on the SOURCE card's edge, land the head on the TARGET card's
        // edge — both along the tangent toward the control point, never centres.
        const gap = 5;
        const [ax, ay] = boxEdge(a._x, a._y, a._hw + gap, a._hh + gap, cpx - a._x, cpy - a._y);
        const [bx, by] = boxEdge(b._x, b._y, b._hw + gap, b._hh + gap, cpx - b._x, cpy - b._y);
        const d = `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cpx.toFixed(1)} ${cpy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
        // getTotalLength() forces a synchronous reflow; only re-measure when the
        // (.toFixed(1)-quantized) path string actually changed — ~0 reflows in
        // steady state instead of one per arrow per frame.
        if (d !== el._d) { el.path.setAttribute('d', d); el._d = d; el._len = el.path.getTotalLength() || 1; }
        el.path.setAttribute('stroke', ar.color);
        const total = el._len;
        const drawn = reduce ? 1 : ramp(p, ar.in, ar.win);
        el.path.setAttribute('stroke-dasharray', total.toFixed(1));
        el.path.setAttribute('stroke-dashoffset', (total * (1 - drawn)).toFixed(1));
        el.g.style.opacity = vis;
        let tanx = bx - cpx, tany = by - cpy; const tl = Math.hypot(tanx, tany) || 1; tanx /= tl; tany /= tl;
        const hx = -tany, hy = tanx, hl = 9, hwd = 5;                            // arrowhead
        el.head.setAttribute('points', `${bx.toFixed(1)},${by.toFixed(1)} ${(bx - tanx*hl + hx*hwd).toFixed(1)},${(by - tany*hl + hy*hwd).toFixed(1)} ${(bx - tanx*hl - hx*hwd).toFixed(1)},${(by - tany*hl - hy*hwd).toFixed(1)}`);
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
    // Don't burn CPU/battery animating a backgrounded tab; resume cleanly on
    // return (reset lastNow so the cursor dt doesn't jump after a long hide).
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; }
      else if (!rafId) { lastNow = null; rafId = requestAnimationFrame(loop); }
    };

    measure();
    // the phone's notes are measured at their wrapped height: again once the
    // web fonts land, since the fallback font wraps differently
    if (coarse && document.fonts) document.fonts.ready.then(() => { if (phone) setupPhone(cw()); }).catch(() => {});
    syncVisibleHeight();
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    if (vv) { vv.addEventListener('resize', syncVisibleHeight); vv.addEventListener('scroll', syncVisibleHeight); }
    rafId = requestAnimationFrame(loop);
    render(0);

    return () => {
      cancelAnimationFrame(rafId);
      scrollEl.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (vv) { vv.removeEventListener('resize', syncVisibleHeight); vv.removeEventListener('scroll', syncVisibleHeight); }
      cardEls.forEach(el => el.remove());
      cursorEls.forEach(el => el.remove());
      connEls.forEach(el => el.remove());
      arrowEls.forEach(el => el.g.remove());
    };
  }, []);

  // The living board is ornament — every layer below is aria-hidden — but
  // visitors read it as a running app and click it, and .sb-cards was the most
  // clicked dead target on the whole landing page. That click is interest, not
  // a mistake, so spend it on the one thing this page wants: the email field.
  // Real controls (the box, its form, the explore link) keep their own clicks.
  const onDecorClick = (e) => {
    if (e.target.closest('.sb-box-wrap, a, button, input, textarea, select, [role="button"]')) return;
    const field = boxRef.current?.querySelector('input:not([type="hidden"]):not([disabled])');
    if (!field) return;
    field.focus();
    try {
      const cls = (e.target.getAttribute?.('class') || e.target.tagName || '').toString();
      logEvent(EV.LANDING_BACKDROP_CLICK, { tgt: cls.slice(0, 60) });
    } catch (_) {}
  };

  // public-dark: the front door is committed to the dark brand world like every
  // other public page. The scene was only ever drawn dark (frost slab, gold CTA
  // with --bg-0 ink, a dark halo on the tagline, dark card feet), so on a light
  // theme the tokens flipped underneath it and left white-on-gold text and a
  // dark slab on a light page.
  return (
    <div className="sb-scene public-dark" ref={sceneRef}>
      <div className="sb-scroll" ref={scrollRef}>
        <div className="sb-runway" ref={runwayRef}>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
          <div className="sb-stage" ref={stageRef} onClick={onDecorClick}>
            <div className="sb-grid" aria-hidden="true" />
            <div className="sb-grain" aria-hidden="true" />
            {/* the search pages' warmth: a soft glow and one faint dotted orbit
                with two suns drawn the logo's way, behind the box */}
            <div className="sb-halo" aria-hidden="true">
              <div className="sb-glow" />
              <div className="sb-orbit" />
            </div>
            <svg className="sb-links" ref={linksRef} aria-hidden="true" />
            <div className="sb-cards" ref={cardsRef} aria-hidden="true" />
            <div className="sb-cursors" ref={cursorsRef} aria-hidden="true" />

            {/* the app's top (FloatingChrome.jsx; the phone bar on a phone),
                faded in for the finale: signin-backdrop.css */}
            <div className="sb-chrome" ref={chromeRef} aria-hidden="true">
              <div className="sb-isl">
                <i className="tb-icon sbi-side" />
                <i className="tb-brand"><img src="/clusters-logo-dark.webp" alt="" /></i>
                <i className="tb-icon sbi-back" /><i className="tb-icon sbi-fwd" />
                <span className="crumbs"><i className="crumb clk">Lost Time</i><i className="crumb-sep">›</i><i className="crumb here">Writers room</i></span>
                <i className="sb-sep" /><i className="tb-btn tb-newcluster sbi-plus"><i className="tb-btn-label">New cluster</i></i>
              </div>
              <div className="sb-isl">
                <i className="tb-icon sbi-undo" /><i className="tb-icon sbi-redo" /><i className="sb-sep" />
                <i className="tb-icon sbi-search" /><i className="tb-icon sbi-split" /><i className="tb-icon sbi-theme" /><i className="tb-icon sbi-bell" /><i className="sb-sep" />
                <span className="ws-presence"><i className="ws-presence-status on" /><b className="ws-presence-avatar" style={{ background:'#ffa500' }}>A</b><b className="ws-presence-avatar" style={{ background:'#6b9088' }}>T</b><b className="ws-presence-avatar ws-presence-overflow">+1</b></span>
                <i className="tb-btn tb-share sbi-share"><i className="tb-btn-label">Share</i></i><i className="sb-sep" />
                <i className="tb-icon sbi-more" />
              </div>
            </div>

            <div className="sb-box-wrap">
              <div className="sb-box" ref={boxRef}>
                {children}
                {exploreHref && (
                  <a className="sb-explore" ref={exploreRef} href={exploreHref} target="_blank" rel="noopener noreferrer"
                     data-lp-cta="explore"
                     onClick={() => { logEvent(EV.LANDING_EXPLORE_CLICK); lp.tracker.ctaClick('explore', exploreHref, { intent: 'nav' }); }}>
                    Explore a live board ↗
                  </a>
                )}
              </div>
            </div>

            <div className="sb-hint" ref={hintRef} aria-hidden="true">
              <span className="sb-hint-label">Scroll to explore</span>
              <span className="sb-chev" />
            </div>

            <div className="sb-foot" ref={footRef}>
              <div className="sb-foot-left">
                <span className="sb-foot-copy">© Soleil Pictures</span>
                <a className="sb-foot-link" href="/use-cases" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'use_cases' })}>Use cases</a>
                <a className="sb-foot-link" href="/explore" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'explore' })}>Explore</a>
                <a className="sb-foot-link" href="/legal/privacy" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'privacy' })}>Privacy</a>
                <a className="sb-foot-link" href="/legal/terms" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'terms' })}>Terms</a>
                <a className="sb-foot-link" href="/legal/cookies" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'cookies' })}>Cookies</a>
              </div>
              <a className="sb-foot-email" href="mailto:clusters@soleilpictures.com" onClick={() => logEvent(EV.LANDING_FOOTER_CLICK, { target: 'email' })}>clusters@soleilpictures.com</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
