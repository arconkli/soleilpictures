// Branded not-found page for public URLs that definitively don't exist
// (unknown /tools|/vs landing paths; the Worker has already served this
// document with a real HTTP 404 + noindex — this is just the friendly shell a
// JS user sees). Dependency-light and code-split with SeoLandingPage.

import { useEffect } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SoleilMark } from '../components/primitives.jsx';

export function NotFoundPage() {
  useEffect(() => { document.title = 'Page not found — Soleil Clusters'; }, []);
  return (
    <div className="public-shell">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-cta" href="/">Try Clusters free</a>
        </div>
      </div>
      <div className="public-empty">
        <SoleilMark size={36} color="var(--soleil)" glow />
        <div className="public-empty-title">Page not found</div>
        <div className="public-empty-sub">
          This page doesn’t exist — it may have moved or been unpublished.
        </div>
        <div className="public-empty-actions">
          <a className="auth-link" href="/use-cases">Use cases</a>
          <a className="auth-link" href="/explore">Explore boards</a>
          <a className="auth-link" href="/pricing">Pricing</a>
        </div>
      </div>
    </div>
  );
}
