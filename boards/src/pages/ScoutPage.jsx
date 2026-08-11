// /scout — the Soleil Scout landing page, rendered as the thing it sells: a
// text conversation.
//
// One signup box, pinned dead centre for the entire page, and a message thread
// that scrolls upward past it — Scout on the left, you on the right, a contact
// header at the top. The box never moves; the conversation does.
//
// WHY A THREAD AND NOT CARDS. The previous version showed the same copy as
// note cards fading through four quadrant slots, one 40-word section body per
// card. It read as a slideshow of brochure panels. A message is a sentence, so
// here a body becomes two or three bubbles and the page finally looks like
// someone using the product.
//
// Every string still comes from the spec in lib/seoLanding.js, which the Worker
// also renders as crawlable HTML + JSON-LD. Splitting a body across bubbles is
// safe for that parity ONLY because the parts stay adjacent in DOM order —
// innerText then still contains the original sentence-for-sentence. Sentences
// longer than ~22 words are shortened AT THE SOURCE rather than broken up here,
// because breaking mid-sentence would drop the punctuation that joins them and
// the crawler would be served a string the reader never gets.
//
// Motion is opt-out, content is not. Without JavaScript, or with
// prefers-reduced-motion, the runway never engages and the thread lays out as
// an ordinary readable column — see the `.is-runway` switch below.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { ScoutSignupBox } from '../components/ScoutSignupBox.jsx';
import { getLandingSpec, SEO_LANDING_PAGES } from '../lib/seoLanding.js';
import { SEO_LISTICLE_INDEX } from '../lib/seoListicleIndex.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import './scoutPage.css';

// How far the thread advances per pixel scrolled. Lower = more deliberate.
const SPEED = 0.62;
const SPEED_TOUCH = 1.0;   // fewer swipes on a phone, where the thread is taller

// The reading window, as a fraction of the band half-height: fully legible in
// the middle, gone by the outer number. Tight on purpose — a real thread would
// otherwise put a dozen bubbles on screen, which is the wall of text this page
// was rebuilt to stop.
const CORE = 0.26;
const EDGE = 0.78;

// Lane geometry. Derived from the box's MEASURED width at runtime; these are
// only the bounds.
const LANE_MAX = 300;
const LANE_MIN = 168;
const LANE_GUTTER = 26;    // clear space between the box and a lane

// Below this the lanes cannot both clear the box, so the thread goes full-width
// and the box drops to the bottom of the screen. Must match the media query in
// scoutPage.css — if they disagree, bubbles get positioned for one layout and
// styled for the other.
const NARROW = 900;

// Stand-in photos for the attachment bubbles. Flat gradients: no asset weight,
// no licensing, and the point being made is ARRANGEMENT.
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

// ── Sentence splitting ──────────────────────────────────────────────────────
//
// One sentence, one bubble. Written by hand rather than with a lookbehind
// regex: lookbehind is still missing on older Safari, and this page's whole
// point is that it works on a phone.
export function sentences(text) {
  const s = String(text || '').trim();
  const out = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    // "e.g." and initials — a lone letter before the dot is an abbreviation,
    // not the end of a thought.
    if (i >= 1 && /[A-Za-z]/.test(s[i - 1]) && (i < 2 || /[\s.]/.test(s[i - 2]))) continue;
    let j = i + 1;
    while (j < s.length && /["'”’)]/.test(s[j])) j++;   // keep the closing quote
    if (j >= s.length) break;
    if (!/\s/.test(s[j])) continue;
    out.push(s.slice(start, j).trim());
    start = j + 1;
    i = j;
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

// ── The thread ──────────────────────────────────────────────────────────────
//
// Assigns the spec to speakers the way a real exchange runs. FAQ questions are
// yours — they are literally the things a person texts — and everything
// explanatory is Scout's. The handful of connective lines ("what is this?") are
// not in the spec: rendering MORE than the crawlable HTML is never cloaking,
// rendering less is, and without them one side of the thread is empty.
function buildThread(spec) {
  const out = [];
  const push = (item) => { out.push({ ...item, key: `m${out.length}` }); };

  const divide = (label, level = 2) => push({ type: 'divider', label, level });
  const you = (text, extra) => push({ type: 'msg', from: 'you', text, ...extra });
  const them = (text, extra) => push({ type: 'msg', from: 'them', text, ...extra });

  // A run of bubbles from one speaker, one sentence each. `lead` (a step title)
  // and `q` (an FAQ question) ride on the first bubble only.
  const run = (from, text, extra) => {
    const parts = sentences(text);
    parts.forEach((t, i) => {
      push({ type: 'msg', from, text: t, ...(i === 0 ? extra : null) });
    });
    return parts.length;
  };

  you('what is this?');
  run('them', spec.answer);

  you('ok how does it work');
  if (spec.stepsHeading) divide(spec.stepsHeading);

  (spec.steps || []).forEach((s, i) => {
    run('them', s.d, { lead: s.t });
    // You demonstrating, between the first two steps: send the photos, then
    // say what they are. This is the product in two messages.
    if (i === 0) you(null, { attach: 'photos' });
    if (i === 1) you('scene 4 diner');
    // "Tap the link" is where a board actually arrives, so the board arrives.
    if (i === 3) them(null, { attach: 'board' });
  });

  const ASIDES = [
    'why not just use my camera roll',
    'i am not installing another app',
    null,
    null,
  ];
  (spec.sections || []).forEach((s, i) => {
    divide(s.heading);
    if (ASIDES[i]) you(ASIDES[i]);
    run('them', s.body);
    (s.bullets || []).forEach((b) => them(b, { bullet: true }));
  });

  // Matches the <h2> the Worker emits above the FAQ block.
  divide('Frequently asked questions');
  (spec.faq || []).forEach((f) => {
    you(null, { q: f.q });
    run('them', f.a);
  });

  // A "typing…" bubble ahead of Scout's longer replies. Only the long ones:
  // it should read as Scout composing an answer, not as a tic on every line.
  const withTyping = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.type === 'msg' && m.from === 'them' && out[i - 1]?.from === 'you') {
      let n = 0;
      while (out[i + n]?.type === 'msg' && out[i + n].from === 'them') n++;
      if (n >= 3) withTyping.push({ type: 'typing', from: 'them', key: `t${i}`, revealedBy: m.key });
    }
    withTyping.push(m);
  }
  return withTyping;
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function PhotoAttachment() {
  return (
    <span className="scout-att scout-att-photos" aria-hidden="true">
      {PHOTOS.slice(0, 4).map((p) => (
        <span key={p.id} className="scout-att-ph"
              style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }} />
      ))}
    </span>
  );
}

// A rich link preview, the way a board would actually land in a thread. This
// replaces the floating mini-board panel the previous design parked off to one
// side: the left lane now occupies that space, and a board arriving AS A
// MESSAGE is truer to the product than a diagram hovering beside it.
function BoardAttachment() {
  return (
    <span className="scout-att scout-att-board" aria-hidden="true">
      <span className="scout-mini">
        <span className="scout-mini-bar">
          <span className="scout-mini-dots"><i /><i /><i /></span>
          <span className="scout-mini-url">clusters.soleilpictures.com</span>
        </span>
        <span className="scout-mini-body">
          <span className="scout-section-label">Scene 4 — Diner</span>
          <span className="scout-grid">
            {PHOTOS.map((p) => (
              <span key={p.id} className="scout-card"
                    style={{
                      background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
                      gridColumn: `span ${p.w}`,
                      gridRow: `span ${p.h}`,
                    }} />
            ))}
            <span className="scout-note-card">Check the power drops</span>
          </span>
        </span>
      </span>
    </span>
  );
}

function Item({ item }) {
  if (item.type === 'divider') {
    const H = item.level === 3 ? 'h3' : 'h2';
    return (
      <H className="scout-div" data-msg={item.key}>
        <i aria-hidden="true" /><span>{item.label}</span><i aria-hidden="true" />
      </H>
    );
  }
  if (item.type === 'typing') {
    return (
      <div className="scout-msg scout-typing from-them" data-msg={item.key} aria-hidden="true">
        <i /><i /><i />
      </div>
    );
  }
  return (
    <div className={`scout-msg from-${item.from}${item.attach ? ' is-attach' : ''}${item.bullet ? ' is-bullet' : ''}`}
         data-msg={item.key}>
      {item.attach === 'photos' && <PhotoAttachment />}
      {item.attach === 'board' && <BoardAttachment />}
      {item.lead && <b className="scout-lead">{item.lead}</b>}
      {item.q && <h3 className="scout-q">{item.q}</h3>}
      {item.text && <p className="scout-t">{item.text}</p>}
    </div>
  );
}

export function ScoutPage() {
  const spec = getLandingSpec('/scout');
  const thread = useMemo(() => (spec ? buildThread(spec) : []), [spec]);

  const sceneRef = useRef(null);
  const scrollRef = useRef(null);
  const runwayRef = useRef(null);
  const stageRef = useRef(null);
  const threadRef = useRef(null);

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
    const threadEl = threadRef.current;
    if (!sceneEl || !scrollEl || !threadEl) return undefined;

    let reduce = false;
    let coarse = false;
    try {
      reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch (_) { /* drive it */ }

    // Motion is the only thing anyone opts out of. Without the runway the
    // thread falls back to an ordinary column and the whole page is still
    // readable — which is also what a crawler and any no-JS visitor gets.
    if (reduce) return undefined;

    // Applied imperatively, NOT through React state. Measuring depends on this
    // class (it switches the scene from document flow to a fixed viewport box),
    // and a state update would not land until after this function returns — so
    // measure() would size the runway against the full-height static page. That
    // produced a 191,552px runway once, which looks exactly like "the animation
    // is broken".
    sceneEl.classList.add('is-runway');

    const els = thread.map((m) => threadEl.querySelector(`[data-msg="${m.key}"]`));
    const speed = coarse ? SPEED_TOUCH : SPEED;
    const byKey = new Map(thread.map((m, i) => [m.key, i]));

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const easeOut = (t) => 1 - (1 - t) ** 3;

    const boxEl = sceneEl.querySelector('.scout-box-inner');
    const tops = new Array(thread.length).fill(0);
    const mids = new Array(thread.length).fill(0);
    let threadH = 1;
    let maxScroll = 1;
    let narrow = false;
    let laneOuter = 520;                                 // outer edge of a lane, from centre
    const widths = new Array(thread.length).fill(300);

    // Lay the thread out as one virtual column, then let scroll drag a read-head
    // down it. Heights are real measured heights: bubbles wrap differently at
    // every width and every font, and a guessed pitch desyncs the whole stack.
    const measure = () => {
      const vw = sceneEl.clientWidth || window.innerWidth;
      const vh = sceneEl.clientHeight || window.innerHeight;
      const boxW = boxEl ? boxEl.offsetWidth : 392;

      const laneW = clamp((vw - boxW) / 2 - 2 * LANE_GUTTER, LANE_MIN, LANE_MAX);
      narrow = vw < NARROW || laneW <= LANE_MIN;
      // Narrow keeps ONE centred column with left/right alignment inside it,
      // rather than spanning the viewport: at 880px a full-width thread strands
      // every bubble against the left edge with half the screen empty.
      const colW = Math.min(vw - 32, 560);
      laneOuter = narrow ? colW / 2 : boxW / 2 + LANE_GUTTER + laneW;

      // max-width, not width. A bubble that always fills its lane is a card;
      // one that shrinks to its text is a message, and half of these are four
      // words long.
      const msgW = narrow ? Math.min(Math.round(colW * 0.82), 360) : Math.round(laneW);
      const divW = narrow ? Math.round(colW) : Math.round(laneOuter * 2);
      for (let i = 0; i < thread.length; i++) {
        const el = els[i];
        if (!el) continue;
        if (thread[i].type === 'divider') {
          el.style.width = `${divW}px`;
        } else {
          // Attachments are pictures, not prose — at full lane width the photo
          // grid alone was taller than the signup box.
          const cap = thread[i].attach === 'photos' ? Math.min(msgW, 186)
            : thread[i].attach === 'board' ? Math.min(msgW, 250)
              : msgW;
          el.style.maxWidth = `${cap}px`;
        }
      }

      // Gaps are the only signal that the speaker changed, which is exactly how
      // a real messages app does it.
      let y = 0;
      for (let i = 0; i < thread.length; i++) {
        const el = els[i];
        const h = el ? el.offsetHeight : 40;
        widths[i] = el ? el.offsetWidth : 300;
        if (i > 0) {
          const a = thread[i - 1];
          const b = thread[i];
          y += (a.type === 'divider' || b.type === 'divider') ? 30
            : a.from === b.from ? 7
              : 18;
        }
        tops[i] = y;
        mids[i] = y + h / 2;
        y += h;
      }
      threadH = Math.max(1, y);

      if (runwayRef.current) {
        runwayRef.current.style.width = `${vw}px`;
        runwayRef.current.style.height = `${Math.round(vh + (threadH + vh) / speed)}px`;
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

    let raf = 0;
    const frame = () => {
      const stageEl = stageRef.current;
      if (!stageEl) { raf = requestAnimationFrame(frame); return; }

      // Read both rects BEFORE writing any transform this frame, so there is no
      // layout thrash. The box rect is read every frame rather than cached
      // because the box changes height when it flips to its success state.
      const sr = stageEl.getBoundingClientRect();
      const br = boxEl ? boxEl.getBoundingClientRect() : sr;
      const vh = sr.height || 1;
      const boxTop = br.top - sr.top - vh / 2;

      // The reading band: the strip the thread is legible in. On a wide screen
      // that is the whole stage minus the contact header, because the lanes
      // clear the box. On a narrow one the box sits at the bottom and the band
      // is everything above it.
      const top = -vh / 2 + 64;
      const bottom = narrow ? boxTop - 14 : vh / 2 - 34;
      const bandC = (top + bottom) / 2;
      const bandR = Math.max(80, (bottom - top) / 2);

      const p = clamp(scrollEl.scrollTop / maxScroll, 0, 1);
      const head = -bandR + p * (threadH + 2 * bandR);

      const vis = new Array(thread.length);
      for (let i = 0; i < thread.length; i++) {
        const d = Math.abs(mids[i] - head) / bandR;
        vis[i] = d <= CORE ? 1 : d >= EDGE ? 0 : easeOut(1 - (d - CORE) / (EDGE - CORE));
      }
      // A typing indicator is consumed by the message it precedes — it fades
      // out exactly as that reply fades in, which is the whole illusion.
      for (let i = 0; i < thread.length; i++) {
        if (thread[i].type !== 'typing') continue;
        const j = byKey.get(thread[i].revealedBy);
        if (j != null) vis[i] *= 1 - vis[j];
      }

      for (let i = 0; i < thread.length; i++) {
        const el = els[i];
        if (!el) continue;
        if (vis[i] <= 0.004) {
          if (el.style.opacity !== '0') {
            el.style.opacity = '0';
            el.removeAttribute('data-live');
          }
          // Deliberately no visibility/display toggle: it would drop the bubble
          // out of the accessibility tree, and these bubbles ARE the page.
          // Position is left stale on purpose — it is invisible, and skipping
          // the write keeps per-frame work to the handful on screen.
          continue;
        }
        if (!el.hasAttribute('data-live')) el.setAttribute('data-live', '1');

        const m = thread[i];
        const y = mids[i] - head + bandC;
        // Aligned by EDGE, not centre: received bubbles hug the outside of the
        // left lane and sent bubbles the outside of the right, which is what
        // makes variable-width bubbles read as one conversation rather than as
        // two ragged columns. No layout reads in here — widths come from
        // measure(); calling offsetWidth mid-loop, after transforms have
        // already been written, forces a reflow per bubble.
        const x = m.type === 'divider' ? 0
          : (m.from === 'you' ? 1 : -1) * (laneOuter - widths[i] / 2);

        el.style.opacity = String(vis[i]);
        // translate(-50%,-50%) FIRST so a bubble centres on its point whatever
        // its height — a fixed negative margin only centres one size, and these
        // range from one line to five.
        el.style.transform = `translate(-50%, -50%) translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      }

      raf = requestAnimationFrame(frame);
    };

    measure();
    syncVisible();
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', measure);
    vv?.addEventListener('resize', syncVisible);
    // A font swapping in after the first measure would desync every offset in
    // the stack, since the whole layout is cumulative.
    document.fonts?.ready?.then(measure).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', syncVisible);
      sceneEl.classList.remove('is-runway');
    };
  }, [thread]);

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

            {/* The contact header. No phone number (we don't have one, and a
                fake one would be a fabricated record) and no availability dot
                — just who you are talking to. */}
            <div className="scout-contact">
              <span className="scout-back" aria-hidden="true" />
              <span className="scout-avatar" aria-hidden="true"><ClustersMark size={17} /></span>
              <span className="scout-contact-name">Soleil Scout</span>
            </div>

            {/* Everything the page has to say, as the conversation it describes. */}
            <div className="scout-thread" ref={threadRef}>
              {thread.map((m) => <Item key={m.key} item={m} />)}
            </div>

            {/* The one thing that never moves. */}
            <div className="scout-box-wrap">
              <div className="scout-box-inner">
                <p className="scout-eyebrow">Soleil Scout</p>
                <h1 className="scout-h1">{spec.h1}</h1>
                <p className="scout-sub">{spec.subhead}</p>
                {/* The success state's "Create your account" button is the one
                    CTA on this page that leads to the product, so it is tracked
                    like every other public CTA and shows up in the landing
                    scorecard's CTR column. Whether warm Scout traffic actually
                    converts into web signups is the entire question this change
                    asks, and lp_cta_click is what answers it. */}
                <ScoutSignupBox
                  pos="hero"
                  cta={lp.ctaProps('waitlist_signup', '/', { intent: 'signup' })}
                />
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
