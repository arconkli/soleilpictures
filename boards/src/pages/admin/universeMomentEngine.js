// universeMomentEngine — the admin Universe while you watch it.
//
// UniverseGraph draws what exists; this is what happens. It takes the pushed
// analytics events (useActivityPulse's `recent`) and the nodes the delta stream
// adds, decides what each one is (lib/universeMoments.js), and turns it into
// light in the scene (universeMomentFx.js). With the director on it also takes
// the camera to the moment, holds a caption on it, and brings it back.
//
// Only the Universe view runs this (UniverseGraph's `moments` prop). The Command
// Center draws the same universe without it, exactly as before.
//
// Two sources, kept apart on purpose:
//   events    say what someone did and where, the moment they did it, but not
//             what it became: a card_placed names its cluster, never its card.
//   arrivals  are the things themselves, seconds later (card_index is written
//             when a cluster's snapshot saves), with a real position.
// A made card is lit by its event, at its cluster; when the card's own node
// lands a few seconds later it only blinks, so one card is one flare. Things no
// event announces (a cluster, a new account, a workspace) are lit by arriving.
//
// The director's camera is applied by UniverseGraph's idle drift, which keeps
// turning the view while the director chooses where it looks and how close: it
// only ever sets the orbit's target and distance.

import * as THREE from 'three';
import {
  momentOf, momentKind, captionFor,
  DIRECTOR, newDirector, directorCanSpot, directorNext,
  makeBursts, burstShape, BURST, makePresence,
  WS_HUE, inout,
} from '../../lib/universeMoments.js';
import { makeMomentLayer, makePainter, paintMoments, hueOf, rgb } from './universeMomentFx.js';

const BULK_NODES = 40;          // more than this in one flush is a resync, not a moment
const BOARD_WAIT_MS = 6000;     // an event may name a cluster the stream has not sent yet
const FIRST_CARD_PAIR_MS = 60_000;
const ARRIVAL_FRESH_MS = 30_000;
const EFFECT_CAP = 900;
const TOUR_POOL = 40;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function makeMomentEngine(refs, hooks) {
  const layer = makeMomentLayer();
  const painter = makePainter(layer);
  const presence = makePresence();
  const bursts = makeBursts();

  let effects = [];
  let queue = [];                      // [{ m, at }] waiting for their cluster
  let arrivals = [];                   // [{ idx, kind, at }]
  const arrivedAt = new Map();         // idx → when the stream delivered it
  const memberOf = new Map();          // user idx → Set(ws idx)
  const claimedWs = new Set();         // a new account's own workspace
  const lastFlareAt = new Map();       // board idx → last event flare
  const importBatches = new Map();     // board idx → { n, at }
  const recentMake = new Map();        // user id → { at, boardIdx, kind }
  const firstCardWanted = new Map();   // user id → when onboarding_first_card came
  const firstCardDone = new Set();
  const until = new Map();             // rate limits: key → time it opens again

  const dir = newDirector(false);
  let on = false;
  let fly = null;                      // { t0, dur, fromT, fromD, toIdx, toPoint, toD }
  let flying = false;
  let pending = null;                  // the caption for the shot in flight
  let next = null;                     // { idx, cap, at }: the moment that waits for this one
  let caption = null;
  let capNext = null, capAt = 0, capKey = 0;
  let reportSig = '';
  let tourPool = null, tourPoolAt = -Infinity;

  const shotTarget = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const drawBuf = new THREE.Vector2();
  const right = [1, 0, 0], up = [0, 1, 0], core = [0, 0, 0];

  // ── Positions ──────────────────────────────────────────────────────────
  const placed = (idx) => idx != null && idx >= 0 && idx < refs.tickCount && idx < refs.nodes.length;
  function at(a, out) {
    if (a.idx != null) {
      const p = refs.positions, i = a.idx * 3, o = a.off;
      out[0] = p[i] + (o ? o[0] : 0);
      out[1] = p[i + 1] + (o ? o[1] : 0);
      out[2] = p[i + 2] + (o ? o[2] : 0);
    } else {
      out[0] = a.point[0]; out[1] = a.point[1]; out[2] = a.point[2];
    }
    return out;
  }
  function unit() {
    const dpr = refs.renderer?.getPixelRatio?.() || 1;
    return refs.wideDist > 0 && refs.pxPerUnit > 0 ? (refs.wideDist * dpr) / refs.pxPerUnit : 0;
  }
  function readCamera() {
    const e = refs.camera?.matrixWorld?.elements;
    if (e) {
      right[0] = e[0]; right[1] = e[1]; right[2] = e[2];
      up[0] = e[4]; up[1] = e[5]; up[2] = e[6];
    }
    const c = refs.wideCenter;
    if (c) { core[0] = c.x; core[1] = c.y; core[2] = c.z; }
  }
  // A small offset in the picture plane, `px` pixels at most at the wide view:
  // where around its cluster a card's flare goes.
  function jitter(px) {
    const u = unit(), rx = rnd(-px, px) * u, ry = rnd(-px, px) * u;
    return [right[0] * rx + up[0] * ry, right[1] * rx + up[1] * ry, right[2] * rx + up[2] * ry];
  }
  // A point out past the rim, in the disk's plane.
  function rimPoint(k, angle = rnd(0, Math.PI * 2)) {
    const r = (refs.wideRadius || 1000) * k;
    return [core[0] + Math.cos(angle) * r, core[1] + rnd(-0.04, 0.04) * r, core[2] + Math.sin(angle) * r];
  }
  const visible = (idx) => refs.visMul[idx] !== 0;
  function boardIdxOf(id) {
    if (!id) return null;
    const idx = refs.nodeIndex.get(`board:${id}`);
    return idx == null ? null : idx;
  }
  // card:<board>:<card> names its cluster; a doc (card:<doc>) has none.
  function boardOfCard(node) {
    const parts = node.id.split(':');
    return parts.length >= 3 ? boardIdxOf(parts[1]) : null;
  }
  function gate(key, ms, now) {
    if ((until.get(key) || 0) > now) return false;
    until.set(key, now + ms);
    if (until.size > 2000) for (const [k, t] of until) if (t < now) until.delete(k);
    return true;
  }

  // ── Effects ────────────────────────────────────────────────────────────
  function spawn(f, delay, now) {
    f.t0 = now + (delay || 0);
    if (effects.length >= EFFECT_CAP) {
      const i = effects.findIndex((x) => x.type === 'ember');
      effects.splice(i >= 0 ? i : 0, 1);
    }
    effects.push(f);
  }
  function making(idx, kind, s, delay, now, jitterPx = 8) {
    const off = jitterPx ? jitter(jitterPx) : null;
    const col = hueOf(kind);
    const sparks = [];
    for (let i = 0; i < 8; i++) sparks.push({ a: rnd(0, Math.PI * 2), v: rnd(16, 34) });
    spawn({ type: 'make', at: { idx, off }, col, s, sparks, life: 1700 }, delay, now);
    spawn({ type: 'ember', at: { idx, off }, col, life: 16000 }, delay, now);
  }
  function birth(idx, delay, now) {
    spawn({ type: 'birth', at: { idx }, life: 3400 }, delay, now);
  }
  function arc(from, toAnchor, delay, now) {
    spawn({ type: 'arc', at: from, b: toAnchor, life: 2600 }, delay, now);
  }

  // ── The director ───────────────────────────────────────────────────────
  const reduced = () => !!refs.reduceMotion;
  // `on` is the switch; under reduced motion the director stands down whatever
  // it says, and comes back with it when motion is allowed again.
  const active = () => on && !reduced();
  function camDist() {
    return refs.camera && refs.controls ? refs.camera.position.distanceTo(refs.controls.target) : 1;
  }
  function flyTo(now, dur, toIdx, toPoint, toD) {
    if (!refs.controls) return;
    fly = { t0: now, dur, fromT: refs.controls.target.clone(), fromD: Math.max(1, camDist()), toIdx, toPoint, toD: Math.max(1, toD) };
  }
  function report() {
    const status = {
      on, available: !reduced(), mode: dir.mode, label: dir.label,
      pausedUntil: dir.pausedUntil, caption,
    };
    const sig = `${on}|${status.available}|${dir.mode}|${dir.label}|${dir.pausedUntil}|${caption ? caption.key : 0}`;
    if (sig === reportSig) return;
    reportSig = sig;
    hooks.report?.(status);
  }
  function showCaption(c) {
    caption = c ? { e: c.e, l: c.l, m: c.m, key: ++capKey } : null;
    capNext = null; capAt = 0;
  }
  function go(idx, cap, now) {
    flyTo(now, DIRECTOR.flyMs, idx, null, refs.wideDist / DIRECTOR.shotZoom);
    dir.mode = 'go'; dir.since = now; dir.label = cap.follow;
    pending = cap;
    showCaption(null);
    report();
  }
  // A moment that wants the camera. Returns how long its light should wait for
  // the camera to get there: 0 when the director is off or yours, or when the
  // moment would wait too long behind another one.
  function spot(idx, cap, now) {
    if (!active() || !placed(idx) || !(refs.wideDist > 0)) return 0;
    const onIt = (dir.mode === 'go' || dir.mode === 'hold') && fly && fly.toIdx === idx;
    if (onIt) {
      // Already there, or on the way: more of the same keeps the camera on it a
      // little longer, and a bigger import says so.
      if (dir.mode === 'hold') dir.since = Math.max(dir.since, now - DIRECTOR.holdMs + DIRECTOR.minHoldMs);
      if (cap.import && pending?.import && pending.import.idx === idx) {
        const n = pending.import.n + cap.import.n;
        pending = { ...captionFor('import', { n, what: cap.import.what }), import: { idx, n, what: cap.import.what } };
        if (dir.mode === 'hold') { showCaption(pending); report(); }
      }
      return dir.mode === 'go' ? Math.max(0, dir.since + DIRECTOR.flyMs - now) + 100 : 0;
    }
    if (directorCanSpot(dir, now)) { go(idx, cap, now); return DIRECTOR.effectDelayMs; }
    // On another moment: this one is next, when that one has had its time.
    if ((dir.mode === 'go' || dir.mode === 'hold') && !next && now >= dir.pausedUntil) {
      const cutAt = Math.max(now, dir.since + DIRECTOR.minHoldMs + (dir.mode === 'go' ? DIRECTOR.flyMs : 0));
      const wait = cutAt - now + DIRECTOR.effectDelayMs;
      if (wait <= DIRECTOR.nextWaitMs) { next = { idx, cap, at: cutAt }; return wait; }
    }
    return 0;
  }
  function back(now, dur) {
    const w = hooks.wide?.();
    showCaption(null);
    pending = null;
    dir.label = '';
    if (!w) { fly = null; dir.mode = 'wide'; dir.since = now; report(); return; }
    flyTo(now, dur, null, [w.cx, w.cy, w.cz], w.dist);
    dir.mode = 'back'; dir.since = now; dir.dur = dur;
    report();
  }
  function tourCandidates(now) {
    if (tourPool && now - tourPoolAt < 5 * 60_000) return tourPool;
    const cards = new Map();
    for (const n of refs.nodes) {
      if (!n || n.kind === 'board' || n.kind === 'ws' || n.kind === 'user') continue;
      const parts = n.id.split(':');
      if (parts.length >= 3) cards.set(parts[1], (cards.get(parts[1]) || 0) + 1);
    }
    tourPool = [...cards.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOUR_POOL)
      .map(([id]) => boardIdxOf(id)).filter((i) => i != null);
    tourPoolAt = now;
    return tourPool;
  }
  function tour(now) {
    const here = presence.here(now).filter((e) => placed(e.key) && visible(e.key));
    let idx = null, cap = null;
    if (here.length) {
      const e = pick(here);
      idx = e.key;
      cap = captionFor('here', { act: e.act, agoMs: now - e.lastAt });
    } else {
      const pool = tourCandidates(now).filter((i) => placed(i) && visible(i));
      if (pool.length) idx = pick(pool);
    }
    if (idx == null) { dir.mode = 'wide'; dir.since = now; report(); return; }
    flyTo(now, DIRECTOR.tourFlyMs, idx, null, refs.wideDist / DIRECTOR.tourZoom);
    dir.mode = 'tour'; dir.since = now; dir.label = 'touring while it is quiet';
    showCaption(null);
    // Said once the camera is nearly there: someone is in this cluster now.
    if (cap) { capNext = cap; capAt = now + DIRECTOR.tourCaptionMs; }
    report();
  }
  function pause(now, until) {
    if (!active()) return;
    dir.pausedUntil = Math.max(dir.pausedUntil, until);
    if (dir.mode !== 'paused') {
      dir.mode = 'paused'; dir.since = now; dir.label = '';
      fly = null; pending = null; next = null;
      showCaption(null);
    }
    report();
  }
  function goOff(now) {
    dir.mode = 'off'; dir.label = ''; dir.pausedUntil = 0;
    pending = null; next = null;
    showCaption(null);
    // Back to the wide view, as A is, unless someone is steering.
    const w = hooks.wide?.();
    if (w && !reduced() && !refs.interacting && !refs.lookActive) flyTo(now, DIRECTOR.offMs, null, [w.cx, w.cy, w.cz], w.dist);
    else fly = null;
    report();
  }

  // ── Events ─────────────────────────────────────────────────────────────
  function homeOf(userId, boardIdx) {
    const u = refs.nodeIndex.get(`user:${userId}`);
    if (u == null) return null;
    const boardWs = boardIdx != null ? refs.nodes[boardIdx]?.workspace_id : null;
    for (const w of memberOf.get(u) || []) {
      const n = refs.nodes[w];
      if (n && n.id !== `ws:${boardWs}` && placed(w)) return { idx: w };
    }
    return placed(u) ? { idx: u } : null;
  }
  function firstCardMoment(user, boardIdx, kind, now) {
    firstCardDone.add(user);
    firstCardWanted.delete(user);
    const u = refs.nodeIndex.get(`user:${user}`);
    const created = u != null ? Date.parse(refs.nodes[u]?.created_at) : NaN;
    const d = spot(boardIdx, captionFor('first_card', { kind, sinceMs: Number.isFinite(created) ? Date.now() - created : null }), now);
    making(boardIdx, kind, 1.25, d, now);
  }
  function resolveBurst(g, now) {
    const idx = g.board;
    if (!placed(idx)) return;
    lastFlareAt.set(idx, now);
    const shape = burstShape(g);
    if (g.user) recentMake.set(g.user, { at: now, boardIdx: idx, kind: shape.kind });
    if (g.user && !firstCardDone.has(g.user) && firstCardWanted.has(g.user)
        && now - firstCardWanted.get(g.user) < FIRST_CARD_PAIR_MS) {
      firstCardMoment(g.user, idx, shape.kind, now);
      return;
    }
    if (g.n >= BURST.importAt) {
      const batch = importBatches.get(idx);
      const n = Math.max(g.n, batch && now - batch.at < 15_000 ? batch.n : 0);
      const cap = captionFor('import', { n, what: shape.what });
      const d = spot(idx, { ...cap, import: { idx, n: g.n, what: shape.what } }, now);
      if (g.user) presence.touch(idx, g.user, shape.what === 'images' ? 'importing images' : 'importing files', now);
      let delay = d;
      const shown = Math.min(14, g.n);
      for (let i = 0; i < shown; i++) {
        const item = g.items[Math.min(g.items.length - 1, Math.floor((i / shown) * g.items.length))];
        making(idx, item.kind, 0.75, delay, now);
        delay += rnd(70, 170);
      }
      return;
    }
    for (const item of g.items) {
      for (let k = 0; k < Math.min(item.n, 6); k++) making(idx, item.kind, 1, item.at - g.first + k * 120, now);
    }
  }
  function handle(m, now) {
    const idx = m.board ? boardIdxOf(m.board) : null;
    if (m.board && (idx == null || !placed(idx))) return false;   // not drawn yet: wait
    if (idx != null && m.user && m.act) presence.touch(idx, m.user, m.act, now);
    if (idx != null && !visible(idx)) return true;                // filtered out: no light
    switch (m.type) {
      case 'make':
        if (idx != null) bursts.add({ board: idx, user: m.user, n: m.n, kind: m.kind }, now);
        return true;
      case 'delete':
        if (idx != null && gate(`del:${idx}`, 700, now)) {
          for (let k = 0; k < Math.min(m.n, 3); k++) {
            spawn({ type: 'implode', at: { idx, off: jitter(6) }, col: rgb('#7c8a98'), life: 1000 }, k * 160, now);
          }
        }
        return true;
      case 'import':
        if (idx != null) importBatches.set(idx, { n: m.n, at: now });
        return true;
      case 'together':
      case 'joined': {
        if (idx == null || !m.user) return true;
        const from = homeOf(m.user, idx);
        if (!from || !gate(`arc:${m.user}:${idx}`, 20_000, now)) return true;
        const d = gate(`shot:${idx}`, 60_000, now)
          ? spot(idx, captionFor(m.type, { people: m.people, role: m.role }), now) : 0;
        arc(from, { idx }, d, now);
        return true;
      }
      case 'invite': {
        if (!m.user || !gate(`out:${m.user}`, 10_000, now)) return true;
        const from = idx != null ? { idx } : homeOf(m.user, null);
        if (from) arc(from, { point: rimPoint(1.9) }, 0, now);
        return true;
      }
      case 'share':
        if (idx != null && gate(`share:${idx}`, 3000, now)) {
          spawn({ type: 'comet', share: true, at: { point: rimPoint(1.6) }, b: { idx }, life: 3300 }, 0, now);
        }
        return true;
      case 'landing':
        if (gate('landing', 1200, now)) {
          const a = rnd(0, Math.PI * 2), off = rnd(-0.22, 0.22);
          spawn({
            type: 'comet', share: false, at: { point: rimPoint(1.6, a) },
            b: { point: rimPoint(rnd(0.45, 0.75), a + off) }, life: 3000,
          }, 0, now);
        }
        return true;
      case 'first_card': {
        if (firstCardDone.has(m.user)) return true;
        const r = recentMake.get(m.user);
        if (r && now - r.at < FIRST_CARD_PAIR_MS && placed(r.boardIdx)) firstCardMoment(m.user, r.boardIdx, r.kind, now);
        else firstCardWanted.set(m.user, now);
        return true;
      }
      default:
        return true;   // presence, already touched
    }
  }

  // ── Arrivals ───────────────────────────────────────────────────────────
  function hot(idx) { hooks.hot?.(idx); }
  function cardArrived(a, now) {
    const node = refs.nodes[a.idx];
    if (!node || !visible(a.idx)) return;
    hot(a.idx);
    const b = boardOfCard(node);
    const kind = momentKind(node.cardKind || 'doc');
    if (b != null && now - (lastFlareAt.get(b) ?? -Infinity) < 20_000) {
      spawn({ type: 'flash', at: { idx: a.idx }, col: hueOf(kind), life: 900 }, 0, now);
    } else {
      making(a.idx, kind, 1, 0, now, 0);
      if (b != null) lastFlareAt.set(b, now);
    }
  }
  function boardArrived(a, now) {
    const node = refs.nodes[a.idx];
    if (!node || node.studio || !visible(a.idx)) return;   // a Studio is part of a new account's birth
    hot(a.idx);
    const d = spot(a.idx, captionFor('cluster'), now);
    spawn({ type: 'ring', at: { idx: a.idx }, col: hueOf('board'), life: 1900 }, d, now);
  }
  // Returns false to be asked again (its workspace may not have landed yet).
  function userArrived(a, now) {
    const ws = [...(memberOf.get(a.idx) || [])];
    if (!ws.length) return now - a.at >= 5000;
    if (ws.some((w) => !placed(w))) return now - a.at >= 10_000;
    const fresh = ws.filter((w) => now - (arrivedAt.get(w) ?? -Infinity) < ARRIVAL_FRESH_MS);
    const old = ws.filter((w) => !fresh.includes(w));
    if (fresh.length) {
      const own = fresh[0];
      claimedWs.add(own);
      hot(own);
      if (old.length) {
        const d = spot(own, captionFor('invited'), now);
        arc({ idx: old[0] }, { idx: own }, d, now);
        birth(own, d + 1300, now);
      } else {
        birth(own, spot(own, captionFor('signup'), now), now);
      }
    } else {
      const w = old[0];
      hot(w);
      birth(w, spot(w, captionFor('invited'), now), now);
    }
    return true;
  }
  function wsArrived(a, now) {
    if (claimedWs.has(a.idx) || !visible(a.idx)) return;
    hot(a.idx);
    spawn({ type: 'ring', soft: true, at: { idx: a.idx }, col: rgb(WS_HUE), life: 1900 }, 0, now);
  }
  function resolveArrivals(now) {
    if (!arrivals.length) return;
    const keep = [];
    for (const a of arrivals) {
      const age = now - a.at;
      if (!placed(a.idx)) { if (age < 15_000) keep.push(a); continue; }
      if (a.kind === 'card' || a.kind === 'doc') {
        if (age < 600) keep.push(a); else cardArrived(a, now);
      } else if (a.kind === 'board') {
        if (age < 1200) keep.push(a); else boardArrived(a, now);
      } else if (a.kind === 'user') {
        if (age < 1200 || !userArrived(a, now)) keep.push(a);
      } else if (a.kind === 'ws') {
        if (age < 3000) keep.push(a); else wsArrived(a, now);
      }
    }
    arrivals = keep;
  }

  // ── The engine ─────────────────────────────────────────────────────────
  const engine = {
    get flying() { return flying; },

    /** Pushed events, newest first, none of them seen before. */
    ingest(rows, now) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const m = momentOf(rows[i]);
        if (m) queue.push({ m, at: now });
      }
      engine.tick(now);
    },

    /** A node the delta stream just added. `bulk`: one of a resync's many. */
    arrive(node, idx, now, bulk) {
      arrivedAt.set(idx, now);
      if (bulk) { hot(idx); return; }
      if (node.kind === 'user' || node.kind === 'ws' || node.kind === 'board' || node.kind === 'card' || node.kind === 'doc') {
        arrivals.push({ idx, kind: node.kind, at: now });
      }
    },

    /** An edge the snapshot or the stream added: memberships say who is where. */
    edge(e) {
      if (e.rawKind !== 'membership') return;
      let s = memberOf.get(e.sourceIdx);
      if (!s) { s = new Set(); memberOf.set(e.sourceIdx, s); }
      s.add(e.targetIdx);
    },

    /** The snapshot was rebuilt: every index is new. */
    reset(edges) {
      effects = []; queue = []; arrivals = [];
      arrivedAt.clear(); memberOf.clear(); claimedWs.clear(); lastFlareAt.clear();
      importBatches.clear(); recentMake.clear(); firstCardWanted.clear(); until.clear();
      tourPool = null;
      fly = null; pending = null; next = null;
      showCaption(null);
      for (const e of edges || []) engine.edge(e);
      report();
    },

    /** Events waiting on their cluster, bursts that have settled, arrivals due. */
    tick(now) {
      if (queue.length) {
        const keep = [];
        for (const q of queue) if (!handle(q.m, now) && now - q.at < BOARD_WAIT_MS) keep.push(q);
        queue = keep;
      }
      for (const g of bursts.due(now)) resolveBurst(g, now);
      resolveArrivals(now);
    },

    setOn(next, now) {
      const want = !!next;
      if (want === on) { report(); return; }
      on = want;
      if (active()) { dir.mode = 'wide'; dir.since = now; dir.pausedUntil = 0; fly = null; report(); }
      else goOff(now);
    },
    resume(now) {
      if (!active() || dir.mode !== 'paused') return;
      dir.pausedUntil = 0;
      engine.frame(now);
    },
    /** Someone took the camera (a drag, a wheel, fly mode): theirs until they let go. */
    hold(now) { pause(now, Infinity); },
    /** They let go: a minute, then the director takes it back. */
    release(now) {
      if (!active() || dir.mode !== 'paused' || refs.interacting || refs.lookActive) return;
      dir.pausedUntil = now + DIRECTOR.pauseMs;
      report();
    },
    /** A key press: a minute from now. */
    nudge(now) { pause(now, now + DIRECTOR.pauseMs); },
    /** Reset view took the camera to the wide view itself. */
    onReset(now) {
      fly = null; pending = null; next = null;
      showCaption(null);
      if (active()) { dir.mode = 'wide'; dir.since = now; dir.pausedUntil = 0; dir.label = ''; }
      report();
    },
    onFit(now) { if (active() && dir.mode === 'wide') dir.since = now; },

    /** The director's clock, every frame. */
    frame(now) {
      if (!active()) {
        if (dir.mode !== 'off') goOff(now);
        return;
      }
      if (dir.mode === 'off') { dir.mode = 'wide'; dir.since = now; report(); }
      if (capAt && now >= capAt) { showCaption(capNext); report(); }
      if (next && now >= next.at) {
        const n = next;
        next = null;
        if ((dir.mode === 'go' || dir.mode === 'hold') && placed(n.idx) && visible(n.idx)) { go(n.idx, n.cap, now); return; }
      }
      const step = directorNext(dir, now);
      if (!step) return;
      if (step === 'hold') {
        dir.mode = 'hold'; dir.since = now;
        let cap = pending;
        // A burst's batch row lands up to five seconds after its cards: by now
        // it may say the import was bigger than what was pushed.
        if (cap?.import) {
          const batch = importBatches.get(cap.import.idx);
          if (batch && batch.n > cap.import.n) cap = captionFor('import', { n: batch.n, what: cap.import.what });
        }
        showCaption(cap);
        report();
      } else if (step === 'back') {
        back(now, dir.mode === 'tour' ? DIRECTOR.tourBackMs : DIRECTOR.backMs);
      } else if (step === 'wide') {
        fly = null; dir.mode = 'wide'; dir.since = now;
        report();
      } else if (step === 'tour') {
        tour(now);
      }
    },

    /**
     * Where the director wants the camera this frame: { target, dist }, or null
     * to leave it to the drift. The drift keeps the view turning either way.
     */
    shot(now) {
      if (!fly) { flying = false; return null; }
      const t = (now - fly.t0) / fly.dur;
      const u = inout(t);
      let to;
      if (fly.toIdx != null) {
        if (!placed(fly.toIdx)) { fly = null; flying = false; return null; }
        const p = refs.positions, i = fly.toIdx * 3;
        to = tmpV.set(p[i], p[i + 1], p[i + 2]);
      } else {
        to = tmpV.set(fly.toPoint[0], fly.toPoint[1], fly.toPoint[2]);
      }
      shotTarget.lerpVectors(fly.fromT, to, u);
      const dist = Math.exp(Math.log(fly.fromD) + (Math.log(fly.toD) - Math.log(fly.fromD)) * u);
      flying = t < 1;
      // Off, once it is back at the wide view, the camera is the drift's again.
      if (!flying && dir.mode === 'off') fly = null;
      return { target: shotTarget, dist };
    },

    /** Paint the frame's moments over the finished picture. */
    render(now) {
      const renderer = refs.renderer, camera = refs.camera;
      const u = unit();
      if (!renderer || !camera || !u) return;
      readCamera();
      const halos = [];
      for (const e of presence.list(now)) {
        if (!placed(e.key) || !visible(e.key)) continue;
        halos.push({ at: { idx: e.key }, n: e.n, alpha: e.alpha, phase: (e.key % 97) * 0.37 });
      }
      if (!effects.length && !halos.length) return;
      painter.begin(u);
      effects = paintMoments(painter, effects, halos, {
        now, at, right, up, core, reduced: reduced(),
        alive: (f) => (f.at.idx == null || (placed(f.at.idx) && visible(f.at.idx)))
          && (!f.b || f.b.idx == null || placed(f.b.idx)),
      });
      painter.end();
      if (layer.mesh.geometry.instanceCount === 0) return;
      const m = layer.mesh.material.uniforms;
      m.uPxPerUnit.value = refs.pxPerUnit;
      m.uDpr.value = renderer.getPixelRatio();
      m.uWide.value = refs.wideDist;
      renderer.getDrawingBufferSize(drawBuf);
      m.uViewport.value.copy(drawBuf);
      if (refs.scene) layer.scene.rotation.copy(refs.scene.rotation);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.render(layer.scene, camera);
      renderer.autoClear = auto;
    },

    dispose() { layer.dispose(); },
  };

  // ── Dev only: a moment on demand ───────────────────────────────────────
  // The real ones come a few an hour, somewhere you were not looking. This
  // feeds synthetic rows through the same ingest, and synthetic nodes through
  // the same delta buffers the stream writes, so what it shows is the code that
  // runs. The bundler drops it from production on the literal guard.
  if (import.meta.env.DEV) {
    let seq = 0;
    engine.qa = (type, opts = {}) => {
      const now = performance.now();
      const nodes = refs.nodes;
      const boards = [], users = [], wss = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!n || !placed(i)) continue;
        if (n.kind === 'board' && visible(i)) boards.push(i);
        else if (n.kind === 'user') users.push(i);
        else if (n.kind === 'ws') wss.push(i);
      }
      if (!boards.length) return null;
      const pool = tourCandidates(now).filter(placed);
      const boardIdx = pool.length ? pool[Math.floor((opts.at ?? Math.random()) * (pool.length - 1))] : pick(boards);
      const boardId = nodes[boardIdx].id.slice('board:'.length);
      const userId = (opts.user != null ? nodes[opts.user] : nodes[pick(users)])?.id.slice('user:'.length) || 'qa-user';
      const row = (event, props, user = userId) => ({
        id: `qa-${++seq}-${Date.now()}`, event, occurred_at: new Date().toISOString(), user_id: user, props,
      });
      const bump = (detail) => { try { window.dispatchEvent(new CustomEvent('universe-qa-stats', { detail })); } catch (_) { /* ignore */ } };
      const ts = new Date().toISOString();
      switch (type) {
        case 'card': {
          const kind = opts.kind || pick(['image', 'note', 'grid', 'link', 'doc', 'palette']);
          engine.ingest([row('card_placed', { n: 1, kind, board_id: boardId })], now);
          bump({ total_cards: 1 });
          return { boardId, kind };
        }
        case 'import': {
          const n = opts.n || 8;
          const rows = [];
          for (let i = 0; i < n; i++) rows.unshift(row('card_placed', { n: 1, kind: 'image', board_id: boardId }));
          engine.ingest(rows, now);
          bump({ total_cards: n });
          return { boardId, n };
        }
        case 'delete':
          engine.ingest([row('card_deleted', { n: 2, kinds: { image: 2 }, board_id: boardId })], now);
          bump({ total_cards: -2 });
          return { boardId };
        case 'here':
          engine.ingest([row('board_open', { board_id: boardId })], now);
          return { boardId };
        case 'together':
          engine.ingest([row('collab_session', { board_id: boardId, peak_peers: 1, ms: 240000 })], now);
          return { boardId };
        case 'joined':
          engine.ingest([row('invite_link_claimed', { board_id: boardId, role: 'editor', status: 'joined' })], now);
          return { boardId };
        case 'invite':
          engine.ingest([row('access_granted', { how: 'email', role: 'editor', board_id: boardId })], now);
          return { boardId };
        case 'share':
          engine.ingest([row('share_view', { board_id: boardId, valid: true }, null)], now);
          return { boardId };
        case 'landing':
          engine.ingest([row('lp_view', {}, null)], now);
          return {};
        case 'first_card': {
          const u = `qa-new-${seq}`;
          hooks.addNodes?.([{ node_id: `user:${u}`, kind: 'user', workspace_id: null, created_at: new Date(Date.now() - 4 * 60_000).toISOString() }], []);
          setTimeout(() => {
            const t = performance.now();
            engine.ingest([row('card_placed', { n: 1, kind: opts.kind || 'image', board_id: boardId }, u)], t);
            setTimeout(() => engine.ingest([row('onboarding_first_card', {}, u)], performance.now()), 1500);
          }, 400);
          bump({ total_cards: 1 });
          return { boardId };
        }
        case 'cluster': {
          const id = `qa-c-${++seq}`;
          hooks.addNodes?.(
            [{ node_id: `board:${id}`, kind: 'board', workspace_id: nodes[boardIdx].workspace_id, created_at: ts }],
            [{ source_id: nodes[boardIdx].id, target_id: `board:${id}`, edge_kind: 'hierarchy', created_at: ts }],
          );
          bump({ total_clusters_made: 1 });
          return { parent: boardId };
        }
        case 'signup':
        case 'invited': {
          const k = ++seq;
          const u = `qa-u-${k}`, w = `qa-w-${k}`, b = `qa-b-${k}`;
          const edges = [
            { source_id: `user:${u}`, target_id: `ws:${w}`, edge_kind: 'membership', created_at: ts },
            { source_id: `ws:${w}`, target_id: `board:${b}`, edge_kind: 'wsroot', created_at: ts },
          ];
          if (type === 'invited' && wss.length) edges.push({ source_id: `user:${u}`, target_id: nodes[pick(wss)].id, edge_kind: 'membership', created_at: ts });
          hooks.addNodes?.([
            { node_id: `user:${u}`, kind: 'user', workspace_id: null, created_at: ts },
            { node_id: `ws:${w}`, kind: 'ws', workspace_id: w, created_at: ts },
            { node_id: `board:${b}`, kind: 'board', workspace_id: w, created_at: ts },
          ], edges);
          bump({ total_users: 1, total_workspaces: 1, total_studios: 1 });
          return { user: u };
        }
        default:
          return null;
      }
    };
  }

  return engine;
}

