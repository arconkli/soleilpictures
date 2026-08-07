// /scout — the Soleil Scout landing page.
//
// Same shape as the primary landing page (auth/SignInBackdrop): ONE box, pinned
// dead centre for the entire page, while short notes stream past it in scenes
// that rotate around the four quadrants. You never face a wall of text — at any
// moment two or three notes are on screen, and the thing we want you to do has
// never moved.
//
// Every string still comes from the spec in lib/seoLanding.js, which the Worker
// also renders as crawlable HTML + JSON-LD. That is what keeps this honest: the
// copy was SHORTENED AT THE SOURCE so both surfaces shrank together. Trimming
// only what the visitor sees, while the crawler kept the long version, is
// exactly the cloaking pattern this codebase warns about.
//
// Motion is opt-out, content is not. Without JavaScript, or with
// prefers-reduced-motion, the runway never engages and the notes lay out as an
// ordinary readable column — see the `.is-runway` switch below.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { ScoutSignupBox } from '../components/ScoutSignupBox.jsx';
import { getLandingSpec, SEO_LANDING_PAGES } from '../lib/seoLanding.js';
import { SEO_LISTICLE_INDEX } from '../lib/seoListicleIndex.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import './scoutPage.css';

const RUNWAY_MULT = 8.0;    // runway height = this × viewport height
const RUNWAY_MULT_TOUCH = 6.0;
const ENTER_RAMP = 0.055;   // scroll-progress span a note takes to ease IN
const EXIT_RAMP = 0.05;
const FIRST_IN = 0.035;     // the box gets the opening beat to itself
const STAGGER = 0.05;
const HOLD = 0.125;         // how long a note stays before it streams out

// Where a note sits, in centre-relative px. Rotating TL→BR→BL→TR means the
// active cluster drifts AROUND the box instead of one side filling, emptying
// and refilling. Notes never enter the box's own column.
//
// The bottom-left slot sits LOWER than its top-left counterpart because the
// mini board occupies the upper-left lane while the step scenes play; at the
// mirrored height the two overlapped and a note landed on top of the canvas.
const SLOTS = [
  { x: -395, y: -145 },
  { x: 395, y: 150 },
  { x: -400, y: 215 },
  { x: 390, y: -150 },
];

// Stand-in photos for the canvas. Flat gradients: no asset weight, no
// licensing, and the point being made is ARRANGEMENT.
const PHOTOS = [
  { id: 'p1', from: 'var(--sc-a)', to: 'var(--sc-b)', w: 2, h: 2 },
  { id: 'p2', from: 'var(--sc-b)', to: 'var(--sc-c)', w: 1, h: 1 },
  { id: 'p3', from: 'var(--sc-c)', to: 'var(--sc-a)', w: 1, h: 1 },
  { id: 'p4', from: 'var(--sc-d)', to: 'var(--sc-b)', w: 1, h: 2 },
  { id: 'p5', from: 'var(--sc-a)', to: 'var(--sc-d)', w: 2, h: 1 },
];

const TITLE_BY_PATH = new Map([
  ...SEO_LANDING_PAGES.map((p) => [p.path, p.h1]),
  ...SEO_LISTICLE_INDEX.map((p) => [p.path, p.h1]),
]);

// ── The notes ───────────────────────────────────────────────────────────────
//
// Built entirely from the spec, in the order they should be read. `head` is a
// real heading element so the document outline a crawler reads survives the
// fact that these are absolutely positioned and faded.
function buildNotes(spec) {
  const out = [];
  const add = (n) => out.push({ ...n, key: `n${out.length}` });

  // The extractable direct answer — what AI answer engines lift. First, wide,
  // and given the top of the stage on its own.
  add({ kind: 'answer', text: spec.answer, wide: true });

  // The five steps: the mechanic, one beat at a time.
  (spec.steps || []).forEach((s, i) => {
    add({ kind: 'step', head: s.t, text: s.d, level: 3, photos: i === 0 });
  });

  // The four sections. Bullets become their own note so neither is a wall.
  (spec.sections || []).forEach((s) => {
    add({ kind: 'section', head: s.heading, text: s.body, level: 2 });
    if (s.bullets?.length) add({ kind: 'bullets', bullets: s.bullets });
  });

  // The FAQ — a question and its answer, still real headings for the JSON-LD's
  // visible counterpart.
  (spec.faq || []).forEach((f) => {
    add({ kind: 'faq', head: f.q, text: f.a, level: 3 });
  });

  // Schedule + place. The last few STAY, so the runway settles instead of
  // ending on an empty stage.
  const n = out.length;
  const stayFrom = n - 3;
  return out.map((note, i) => {
    const slot = SLOTS[i % SLOTS.length];
    const inAt = FIRST_IN + i * STAGGER;
    return {
      ...note,
      x: slot.x,
      y: slot.y,
      // Alternate top/bottom on touch so each note lands ALONE in its slot,
      // above or below the box, and is fully readable.
      mSlot: i % 2 === 0 ? 'top' : 'bottom',
      in: inAt,
      out: i >= stayFrom ? null : inAt + HOLD,
    };
  });
}

function Note({ note }) {
  const H = note.level === 2 ? 'h2' : 'h3';
  return (
    <article className={`scout-note scout-note-${note.kind}${note.wide ? ' is-wide' : ''}`}
             data-note={note.key} data-mslot={note.mSlot}>
      {note.photos && (
        <div className="scout-note-chips" aria-hidden="true">
          {PHOTOS.map((p) => (
            <span key={p.id} className="scout-chip"
                  style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }} />
          ))}
        </div>
      )}
      {note.head && <H className="scout-note-head">{note.head}</H>}
      {note.bullets
        ? <ul className="scout-note-list">{note.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        : <p className="scout-note-text">{note.text}</p>}
    </article>
  );
}

// The mini board, floating opposite the notes while the steps play. It fills in
// as you scroll: photos land, the group gets its title, the note arrives, and
// finally it is filed into a real board rather than the Bin.
//
// The last beat renames the board instead of re-sorting the grid. Re-ordering
// mid-scroll is an instant jump with no way to tween it, and a jump reads as a
// glitch; the rename tells the same story and is legible at a glance.
function MiniBoard({ stage }) {
  const filed = stage >= 4;
  return (
    <div className="scout-mini" aria-hidden="true">
      <div className="scout-mini-bar">
        <span className="scout-mini-dots"><i /><i /><i /></span>
        <span className="scout-mini-url">clusters.soleilpictures.com</span>
      </div>
      <div className="scout-mini-body">
        <div className={`scout-board-name${filed ? ' is-filed' : ''}`}>
          {filed ? 'Diner Recce' : 'Scout Bin'}
        </div>
        <div className={`scout-section-label${stage >= 2 ? ' is-shown' : ''}`}>Scene 4 — Diner</div>
        <div className="scout-grid">
          {PHOTOS.map((p, i) => (
            <span key={p.id} className={`scout-card${stage >= 1 ? ' is-landed' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
                    gridColumn: `span ${p.w}`,
                    gridRow: `span ${p.h}`,
                    transitionDelay: stage >= 1 ? `${i * 70}ms` : '0ms',
                  }} />
          ))}
          <span className={`scout-note-card${stage >= 3 ? ' is-landed' : ''}`}>Check the power drops</span>
        </div>
      </div>
    </div>
  );
}

export function ScoutPage() {
  const spec = getLandingSpec('/scout');
  const notes = useMemo(() => (spec ? buildNotes(spec) : []), [spec]);

  const sceneRef = useRef(null);
  const scrollRef = useRef(null);
  const runwayRef = useRef(null);
  const stageRef = useRef(null);
  const notesRef = useRef(null);
  const [stage, setStage] = useState(0);

  const lp = useLandingEngagement({
    page: spec?.path, pageKind: spec?.kind,
    getScrollEl: () => scrollRef.current,
  });

  useEffect(() => {
    if (!spec) return;
    document.title = spec.title;
    logEventOnce(`seo_landing_${spec.path}`, EV.SEO_LANDING_VIEW, { path: spec.path, kind: spec.kind });
  }, [spec]);

  const drive = useCallback(() => {
    const sceneEl = sceneRef.current;
    const scrollEl = scrollRef.current;
    const notesEl = notesRef.current;
    if (!sceneEl || !scrollEl || !notesEl) return undefined;

    let reduce = false;
    let coarse = false;
    try {
      reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch (_) { /* drive it */ }

    // Motion is the only thing anyone opts out of. Without the runway the notes
    // fall back to an ordinary column and the whole page is still readable —
    // which is also what a crawler and any no-JS visitor gets.
    if (reduce) { setStage(4); return undefined; }

    // Applied imperatively, NOT through React state. Measuring depends on this
    // class (it switches the scene from document flow to a fixed viewport box),
    // and a state update would not land until after this function returns — so
    // measure() would size the runway against the full-height static page. That
    // produced a 191,552px runway instead of 7,200 and pinned scroll progress
    // at 1, which looks exactly like "the animation is broken".
    sceneEl.classList.add('is-runway');

    const els = notes.map((n) => notesEl.querySelector(`[data-note="${n.key}"]`));
    const mult = coarse ? RUNWAY_MULT_TOUCH : RUNWAY_MULT;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const easeOut = (t) => 1 - (1 - t) ** 3;
    const ramp = (p, start, win) => easeOut(clamp((p - start) / win, 0, 1));

    let maxScroll = 1;
    const measure = () => {
      const vw = sceneEl.clientWidth || window.innerWidth;
      const vh = sceneEl.clientHeight || window.innerHeight;
      if (runwayRef.current) {
        runwayRef.current.style.width = `${vw}px`;
        runwayRef.current.style.height = `${Math.round(vh * mult)}px`;
      }
      if (stageRef.current) {
        stageRef.current.style.width = `${vw}px`;
        stageRef.current.style.height = `${vh}px`;
      }
      maxScroll = Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
    };

    // Keep the pinned box above an on-screen keyboard: the stage is fixed, so
    // without this it centres in the full layout viewport and the keyboard can
    // hide the button someone is trying to press.
    const vv = window.visualViewport;
    const syncVisible = () => {
      if (vv) sceneEl.style.setProperty('--sc-vvh', `${Math.round(vv.height)}px`);
    };

    const spread = () => {
      const vw = sceneEl.clientWidth || window.innerWidth;
      const vh = sceneEl.clientHeight || window.innerHeight;
      return { sx: clamp(vw / 1240, 0.42, 1.1), sy: clamp(vh / 780, 0.5, 1.1) };
    };

    const boxEl = sceneEl.querySelector('.scout-box-inner');

    let raf = 0;
    let lastStage = -1;
    const frame = () => {
      const p = clamp(scrollEl.scrollTop / maxScroll, 0, 1);
      const { sx, sy } = spread();
      const vw = sceneEl.clientWidth || window.innerWidth;
      const vh = sceneEl.clientHeight || window.innerHeight;
      // Stack above/below the box whenever the viewport is NARROW, not merely
      // when the pointer is coarse. A narrow desktop window has the same
      // problem — there is no room beside the box — and keying this off touch
      // alone let notes slide off the left edge and over the input.
      const narrow = coarse || vw < 900;
      const boxH = boxEl ? boxEl.offsetHeight : 420;

      // Pass 1 — how visible is each note right now.
      const vises = notes.map((n) => {
        const vin = ramp(p, n.in, ENTER_RAMP);
        const vout = n.out === null ? 0 : ramp(p, n.out, EXIT_RAMP);
        return { vin, vout, vis: vin * (1 - vout) };
      });

      // On a narrow layout there are only TWO places a note can go — above the
      // box and below it — but three notes are often mid-transition at once, so
      // two would land in the same strip and overlap. Keep only the newest in
      // each strip; the one it displaces is already on its way out.
      if (narrow) {
        for (const slot of ['top', 'bottom']) {
          let best = -1;
          for (let i = 0; i < notes.length; i++) {
            if (notes[i].mSlot !== slot || vises[i].vis <= 0.001) continue;
            if (best < 0 || notes[i].in > notes[best].in) best = i;
          }
          for (let i = 0; i < notes.length; i++) {
            if (notes[i].mSlot === slot && i !== best) vises[i].vis = 0;
          }
        }
      }

      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const el = els[i];
        if (!el) continue;
        const { vin, vout, vis } = vises[i];

        if (vis <= 0.001) {
          if (el.style.opacity !== '0') {
            el.style.opacity = '0';
            el.removeAttribute('data-live');
          }
          // Deliberately no visibility/display toggle: it would drop the note
          // out of the accessibility tree, and these notes ARE the page.
          continue;
        }
        if (!el.hasAttribute('data-live')) el.setAttribute('data-live', '1');

        // Notes drift in from slightly further out and settle — the same
        // easing the primary landing page's cards use.
        const drift = (1 - vin) * 34 + vout * 26;
        let tx;
        let ty;
        if (narrow) {
          // The box owns the middle; notes take the strip above or below it,
          // one at a time. Derived from the BOX's measured height rather than a
          // fraction of the viewport, so a note can never land on the input no
          // matter how tall the box gets (the success state is shorter than the
          // form, and the consent copy wraps differently at every width).
          // Clearance wins over fitting on screen. On a very short viewport a
          // note may clip at the edge, which is recoverable by scrolling; a
          // note sitting on top of the phone input is not.
          const noteH = el.offsetHeight || 150;
          tx = 0;
          ty = (n.mSlot === 'top' ? -1 : 1) * (boxH / 2 + noteH / 2 + 16);
        } else {
          tx = n.x * sx;
          ty = n.y * sy;
        }
        const dx = narrow ? 0 : (n.x < 0 ? -drift : drift);
        const dy = narrow ? (n.mSlot === 'top' ? -drift : drift) : 0;
        el.style.opacity = String(vis);
        // translate(-50%,-50%) FIRST so a note centres on its slot whatever its
        // height — a fixed negative margin only centres one size of note, and
        // these range from three lines to eight.
        el.style.transform = `translate(-50%, -50%) translate3d(${tx + dx}px, ${ty + dy}px, 0)`;
      }

      // The mini board fills in across the step scenes.
      const s = p < 0.09 ? 0 : p < 0.17 ? 1 : p < 0.25 ? 2 : p < 0.33 ? 3 : 4;
      if (s !== lastStage) { lastStage = s; setStage(s); }

      raf = requestAnimationFrame(frame);
    };

    measure();
    syncVisible();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', measure);
    vv?.addEventListener('resize', syncVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', syncVisible);
      sceneEl.classList.remove('is-runway');
    };
  }, [notes]);

  useEffect(() => drive(), [drive]);

  if (!spec) return <NotFoundPage />;

  const related = (spec.related || []).filter((p) => TITLE_BY_PATH.has(p));

  return (
    // public-dark pins the brand's dark tokens inside this scope, so a
    // light-OS visitor never gets a washed-out first impression — same as every
    // other public marketing surface.
    <div className="scout-scene public-dark" ref={sceneRef}>
      <div className="scout-topbar">
        <a className="scout-brand" href="/" title="Clusters home">
          <ClustersMark size={18} />
          <span>Clusters</span>
        </a>
        <div className="scout-topbar-actions">
          <a href="/explore" {...lp.ctaProps('topbar_explore', '/explore', { intent: 'nav' })}>Explore</a>
          <a href="/pricing" {...lp.ctaProps('topbar_pricing', '/pricing', { intent: 'nav' })}>Pricing</a>
        </div>
      </div>

      <div className="scout-scroll" ref={scrollRef}>
        <div className="scout-runway" ref={runwayRef}>
          <div className="scout-stage" ref={stageRef}>
            <div className="scout-atmos" aria-hidden="true" />

            {/* The mini board sits opposite the notes while the steps play. */}
            <div className="scout-mini-wrap" data-stage={stage}>
              <MiniBoard stage={stage} />
            </div>

            {/* Everything the page has to say, streaming around the box. */}
            <div className="scout-notes" ref={notesRef}>
              {notes.map((n) => <Note key={n.key} note={n} />)}
            </div>

            {/* The one thing that never moves. */}
            <div className="scout-box-wrap">
              <div className="scout-box-inner">
                <p className="scout-eyebrow">Soleil Scout</p>
                <h1 className="scout-h1">{spec.h1}</h1>
                <p className="scout-sub">{spec.subhead}</p>
                <ScoutSignupBox pos="hero" />
                <p className="sb-trust">Made by a film studio, for creative professionals.</p>
              </div>
            </div>

            <div className="scout-cue" aria-hidden="true">
              <span>Scroll</span><span className="scout-chev" />
            </div>

            <footer className="scout-foot">
              <span>© Soleil Pictures</span>
              {related.slice(0, 3).map((p) => (
                <a key={p} href={p}>{TITLE_BY_PATH.get(p)}</a>
              ))}
              <a href="/explore">Explore</a>
              <a href="/pricing">Pricing</a>
              {spec.updated && (
                <span className="scout-updated">
                  Updated {new Date(`${spec.updated}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                </span>
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
