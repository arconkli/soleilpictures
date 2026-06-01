// LegalPage — public, no-auth renderer for the Privacy Policy, Terms of
// Service, and Cookie Policy. Reached via /legal/<slug> (wired in main.jsx,
// before AuthGate, so it's reachable signed-out). Content lives as data in
// legalContent.js; this file is just the shell + a small block renderer.
//
// Cross-doc nav and "back to app" are plain <a href> — a full navigation
// re-runs main.jsx, which reads window.location.pathname and renders the
// right page. No router state needed.

import { useEffect } from 'react';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import {
  LEGAL_DOCS,
  DOC_ORDER,
  DOC_LABELS,
  CONTACT_EMAIL,
  LAST_UPDATED,
  COMPANY,
} from './legalContent.js';
import './legal.css';

// Linkify any occurrence of the contact email as a mailto: link. Returns an
// array of strings + <a> nodes suitable for rendering inside a <p>.
function linkifyEmail(text, keyBase) {
  const parts = text.split(CONTACT_EMAIL);
  if (parts.length === 1) return text;
  const out = [];
  parts.forEach((part, i) => {
    if (part) out.push(part);
    if (i < parts.length - 1) {
      out.push(
        <a key={`${keyBase}-mail-${i}`} className="legal-link" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
      );
    }
  });
  return out;
}

function Block({ block, k }) {
  if (typeof block === 'string') {
    return <p className="legal-p">{linkifyEmail(block, k)}</p>;
  }
  if (block && Array.isArray(block.list)) {
    return (
      <ul className="legal-list">
        {block.list.map((item, i) => (
          <li key={`${k}-li-${i}`}>{linkifyEmail(item, `${k}-${i}`)}</li>
        ))}
      </ul>
    );
  }
  return null;
}

export function LegalPage({ doc = 'privacy' }) {
  const slug = LEGAL_DOCS[doc] ? doc : 'privacy';
  const data = LEGAL_DOCS[slug];

  useEffect(() => {
    const prev = document.title;
    document.title = `${data.title} · Soleil Clusters`;
    return () => { document.title = prev; };
  }, [data.title]);

  return (
    <div className="legal-screen">
      <div className="auth-glow" aria-hidden="true" />

      <header className="legal-topbar">
        <a className="legal-brand" href="/" aria-label="Back to Soleil Clusters">
          <SoleilWordmark size="block" />
        </a>
        <a className="legal-back" href="/">Back to app</a>
      </header>

      <main className="legal-doc">
        <nav className="legal-tabs" aria-label="Legal documents">
          {DOC_ORDER.map((s) => (
            <a
              key={s}
              className={`legal-tab${s === slug ? ' is-active' : ''}`}
              href={`/legal/${s}`}
              aria-current={s === slug ? 'page' : undefined}
            >
              {DOC_LABELS[s]}
            </a>
          ))}
        </nav>

        <h1 className="legal-title">{data.title}</h1>
        <div className="legal-updated">Last updated {LAST_UPDATED}</div>

        {data.intro && <p className="legal-intro">{linkifyEmail(data.intro, 'intro')}</p>}

        {data.sections.map((sec, si) => (
          <section className="legal-section" key={`sec-${si}`}>
            <h2 className="legal-h">{sec.heading}</h2>
            {sec.blocks.map((block, bi) => (
              <Block key={`sec-${si}-b-${bi}`} block={block} k={`sec-${si}-b-${bi}`} />
            ))}
          </section>
        ))}

        <footer className="legal-foot">
          <span className="legal-foot-copy">© {COMPANY}</span>
          <a className="legal-link" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <a className="legal-link" href="/">Back to app</a>
        </footer>
      </main>
    </div>
  );
}
