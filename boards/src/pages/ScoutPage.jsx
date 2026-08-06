// /scout — the Soleil Scout landing page.
//
// The product is "you text a number and a board appears", so the page is a text
// thread. You arrive at one box that wants your phone number; as you scroll, a
// conversation plays out beside a canvas that fills in — and the marketing copy
// IS the conversation. Nothing here is a brochure paragraph dressed up as a
// bubble: every string below comes from the same spec the crawler is served.
//
// THAT LAST POINT IS THE WHOLE DESIGN. lib/seoLanding.js stays the single
// source of truth. worker.js keeps injecting this page's <title>, description,
// canonical, OG, JSON-LD and crawlable HTML from that spec via
// buildLandingCrawlableHtml(); this component renders the SAME strings in
// bubbles. So the page can look like anything at all and server/client parity —
// the thing that stops this being cloaking — holds by construction rather than
// by anyone remembering to keep two files in step.
//
// This is the only landing page with its own renderer. Everything else in the
// registry goes through SeoLandingPage.jsx.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { ScoutSignupBox } from '../components/ScoutSignupBox.jsx';
import { getLandingSpec, SEO_LANDING_PAGES } from '../lib/seoLanding.js';
import { SEO_LISTICLE_INDEX } from '../lib/seoListicleIndex.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
// The shared public-page chrome — .seo-scroll, .seo-footer, .seo-related,
// .seo-updated. Imported rather than re-declared so this page's footer and
// scroll container can't drift from every other landing page's.
import './seoLanding.css';
import './scoutPage.css';

// Stand-in photos. Flat gradients rather than real images: no asset weight, no
// licensing, no layout shift — and the point being demonstrated is ARRANGEMENT,
// which a photograph would only distract from.
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

// ── The thread ──────────────────────────────────────────────────────────────
//
// Every beat is derived from the spec. The only strings invented here are the
// four short connective questions, which exist because a conversation needs
// someone to ask — rendering MORE than the crawler sees is never cloaking;
// rendering less would be.
//
// Order differs from the crawlable HTML (steps before sections) because the
// demonstration should come before the argument. The CONTENT is identical,
// which is what parity actually requires.
function buildThread(spec) {
  const beats = [];
  const add = (b) => { beats.push({ ...b, key: `b${beats.length}` }); };

  add({ side: 'out', kind: 'ask', text: 'What is this?' });
  add({ side: 'in', kind: 'answer', text: spec.answer });

  // The steps are the spine: each one is a thing you do, and Scout's reply.
  // Step 0 carries the photos, so the canvas starts filling exactly where the
  // copy first mentions sending one.
  (spec.steps || []).forEach((s, i) => {
    add({ side: 'out', kind: 'do', text: s.t, photos: i === 0 ? PHOTOS : null, stage: i + 1 });
    add({ side: 'in', kind: 'said', text: s.d });
  });

  // Sections: heading becomes a quiet thread divider, body a long bubble.
  // People really do send paragraphs, so this stays plausible as a message.
  (spec.sections || []).forEach((s, i) => {
    add({ kind: 'divider', heading: s.heading, idx: i });
    add({ side: 'in', kind: 'body', text: s.body });
    if (s.bullets?.length) add({ side: 'in', kind: 'bullets', bullets: s.bullets });
  });

  // FAQ is the most natural fit of all: a question is a message, an answer is
  // a reply. No <details> to open — in a thread everything is already said.
  //
  // Zoned separately because it renders OUTSIDE the two-column layout. By the
  // time the questions start the canvas has told its whole story, and leaving
  // it pinned would strand half the width beside eight paragraphs of text. The
  // FAQ gets a single centred column instead, and the sticky canvas simply ends
  // with its container — no fade-out to orchestrate, no dead space.
  const faq = [];
  if (spec.faq?.length) {
    const at = (b) => { faq.push({ ...b, key: `f${faq.length}` }); };
    at({ kind: 'divider', heading: 'Frequently asked questions' });
    spec.faq.forEach((f) => {
      at({ side: 'out', kind: 'q', text: f.q });
      at({ side: 'in', kind: 'a', text: f.a });
    });
  }

  return { conv: beats, faq };
}

// One bubble. `data-*` drives the reveal observer and the canvas phases, so the
// observer needs no per-node bookkeeping and no React state per bubble.
function Beat({ beat }) {
  if (beat.kind === 'divider') {
    return (
      <div className="scout-divider" data-beat={beat.key}>
        <h2 className="scout-divider-h">{beat.heading}</h2>
      </div>
    );
  }

  const out = beat.side === 'out';
  const cls = `scout-bubble scout-bubble-${out ? 'out' : 'in'} scout-bubble-${beat.kind}`;

  return (
    <div className={cls} data-beat={beat.key}
         data-stage={beat.stage || undefined}>
      {beat.photos && (
        <div className="scout-bubble-photos" aria-hidden="true">
          {beat.photos.map((p) => (
            <span key={p.id} className="scout-chip"
                  style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }} />
          ))}
        </div>
      )}
      {beat.kind === 'q'
        ? <h3 className="scout-bubble-q">{beat.text}</h3>
        : beat.bullets
          ? <ul className="scout-bubble-list">{beat.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          : <p className="scout-bubble-text">{beat.text}</p>}
    </div>
  );
}

// ── The canvas ──────────────────────────────────────────────────────────────
//
// Sticky beside the thread, filling in as the conversation advances. `stage`
// counts up as step bubbles scroll past:
//   1 photos land · 2 the group gets its title · 3 the note lands
//   4 nothing new (the "keep shooting" beat) · 5 it's filed into a real board
//
// Stage 5 renames the board rather than re-sorting the cards. Re-ordering a
// grid mid-scroll is an instant jump with no way to tween it, and a jump reads
// as a glitch; the rename tells the same story — this left the Bin — and is
// legible at a glance.
function Canvas({ stage }) {
  const filed = stage >= 5;
  return (
    <div className="scout-canvas" aria-hidden="true">
      <div className="scout-canvas-bar">
        <span className="scout-canvas-dots"><i /><i /><i /></span>
        <span className="scout-canvas-url">clusters.soleilpictures.com</span>
      </div>
      <div className="scout-canvas-body">
        <div className={`scout-board-name${filed ? ' is-filed' : ''}`}>
          {filed ? 'Diner Recce' : 'Scout Bin'}
        </div>
        <div className={`scout-section-label${stage >= 2 ? ' is-shown' : ''}`}>
          Scene 4 — Diner
        </div>
        <div className="scout-grid">
          {PHOTOS.map((p, i) => (
            <span key={p.id}
                  className={`scout-card${stage >= 1 ? ' is-landed' : ''}`}
                  style={{
                    background: `linear-gradient(135deg, ${p.from}, ${p.to})`,
                    gridColumn: `span ${p.w}`,
                    gridRow: `span ${p.h}`,
                    transitionDelay: stage >= 1 ? `${i * 80}ms` : '0ms',
                  }} />
          ))}
          <span className={`scout-note${stage >= 3 ? ' is-landed' : ''}`}>
            Check the power drops
          </span>
        </div>
      </div>
    </div>
  );
}

export function ScoutPage() {
  const spec = getLandingSpec('/scout');
  const { conv, faq } = useMemo(
    () => (spec ? buildThread(spec) : { conv: [], faq: [] }), [spec]);

  const scrollRef = useRef(null);
  const threadRef = useRef(null);
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

  // One observer for every bubble on the page.
  //
  // Reveal is one-way on purpose: a bubble that faded back out when it left the
  // viewport would make scrolling up feel like the page was un-saying things.
  // The canvas stage is monotonic for the same reason — scrolling back must not
  // un-land photos.
  const observe = useCallback(() => {
    const root = threadRef.current;
    if (!root) return undefined;

    const nodes = root.querySelectorAll('[data-beat]');
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { /* animate */ }

    // Reduced motion (and any environment without IntersectionObserver) skips
    // straight to the end state. The page must be READABLE in full either way —
    // an animation is the only thing anyone is opting out of, never the copy.
    if (reduced || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('is-in'));
      setStage(5);
      return undefined;
    }

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        const s = Number(e.target.dataset.stage || 0);
        if (s) setStage((cur) => Math.max(cur, s));
        io.unobserve(e.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);

  useEffect(() => observe(), [observe, conv, faq]);

  if (!spec) return <NotFoundPage />;

  const related = (spec.related || []).filter((p) => TITLE_BY_PATH.has(p));

  return (
    <div className="public-shell scout-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href="/explore" {...lp.ctaProps('topbar_explore', '/explore', { intent: 'nav' })}>Explore</a>
          <a className="public-signin-quiet" href="/pricing" {...lp.ctaProps('topbar_pricing', '/pricing', { intent: 'nav' })}>Pricing</a>
          <a className="public-cta" href="/" {...lp.ctaProps('topbar', '/')}>Try Clusters free</a>
        </div>
      </div>

      <div className="seo-scroll" ref={scrollRef}>
        {/* ── Act 1: one box, nothing competing with it ─────────────────── */}
        <header className="scout-hero" ref={lp.sectionRef('hero', 0)}>
          <p className="scout-eyebrow">Soleil Scout</p>
          <h1 className="scout-h1">{spec.h1}</h1>
          <p className="scout-sub">{spec.subhead}</p>
          <ScoutSignupBox pos="hero" />
          <p className="sb-trust">Made by a film studio, for creative professionals.</p>
          <div className="scout-cue" aria-hidden="true">
            <span>See how it goes</span>
            <span className="scout-chev" />
          </div>
        </header>

        {/* ── Act 2: the conversation, and the canvas it builds ─────────── */}
        <div ref={threadRef}>
          <div className="scout-conv">
            <div className="scout-stage">
              <Canvas stage={stage} />
            </div>
            <div className="scout-msgs">
              {conv.map((b) => <Beat key={b.key} beat={b} />)}
            </div>
          </div>

          {/* The questions get the full column width — the canvas has finished
              saying what it has to say, and its container ends here, so the
              sticky panel scrolls away on its own. */}
          {faq.length > 0 && (
            <section className="scout-faq scout-msgs" ref={lp.sectionRef('faq', 1)}>
              {faq.map((b) => <Beat key={b.key} beat={b} />)}
            </section>
          )}
        </div>

        {/* ── Act 3: ask again, then get out of the way ─────────────────── */}
        <section className="scout-close" ref={lp.sectionRef('closing', 2)}>
          <h2 className="scout-close-h">Your next scout is a text away.</h2>
          <ScoutSignupBox pos="closing" ctaLabel="Text me Scout" />
        </section>

        <footer className="seo-footer">
          {related.length > 0 && (
            <nav className="seo-related" aria-label="Related pages">
              <div className="seo-related-label">Keep exploring</div>
              <ul>
                {related.map((p) => <li key={p}><a href={p}>{TITLE_BY_PATH.get(p)}</a></li>)}
                <li><a href="/explore">Explore example boards</a></li>
                <li><a href="/pricing">Pricing</a></li>
              </ul>
            </nav>
          )}
          <div className="seo-footer-brand">
            <ClustersMark size={16} />
            <span>Soleil Clusters — a creative workspace &amp; moodboard for production teams.</span>
          </div>
          {spec.updated && (
            <div className="seo-updated">
              Updated {new Date(spec.updated + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
