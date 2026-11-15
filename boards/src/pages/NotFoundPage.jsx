// Branded not-found page for public URLs that definitively don't exist
// (unknown /tools|/vs landing paths; the Worker has already served this
// document with a real HTTP 404 + noindex — this is just the friendly shell a
// JS user sees). Code-split with SeoLandingPage.
//
// It measures itself: human 404s had no row anywhere (the Worker counts bot
// fetches in crawler_hits, nothing counted a person). The page id is the
// constant '/404' — the real URL is already on every row's `path` column — so
// the scorecard gets one line, not one per typo. Parents that render this
// (SeoLandingPage, SeoListiclePage, DocsPage, the template pages) mounted the
// hook with page=undefined, which no-ops, so there is one live tracker; the
// admin Surface Gallery also renders it, stamped synthetic by analytics.js.

import { useEffect } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SoleilMark } from '../components/primitives.jsx';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

export function NotFoundPage() {
  const lp = useLandingEngagement({ page: '/404', pageKind: 'not_found', scroll: 'none' });
  useEffect(() => { document.title = t`Page not found — Soleil Clusters`; }, []);
  return (
    // public-dark like every page that links here: a light-OS visitor otherwise
    // fell out of the dark brand world onto a light grey 404, between a dark
    // boot splash and the dark page they came from.
    <div className="public-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title={t`Clusters home`}>
          <ClustersMark size={20} />
          <span className="public-brand-name"><Trans context="brand">Clusters</Trans></span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-cta" href="/" {...lp.ctaProps('topbar', '/')}><Trans>Try Clusters free</Trans></a>
        </div>
      </div>
      <div className="public-empty">
        <SoleilMark size={36} color="var(--soleil)" glow />
        <div className="public-empty-title"><Trans>Page not found</Trans></div>
        <div className="public-empty-sub">
          <Trans>This page doesn’t exist — it may have moved or been unpublished.</Trans>
        </div>
        <div className="public-empty-actions">
          <a className="auth-link" href="/use-cases"><Trans>Use cases</Trans></a>
          <a className="auth-link" href="/explore"><Trans>Explore boards</Trans></a>
          <a className="auth-link" href="/pricing"><Trans>Pricing</Trans></a>
        </div>
      </div>
    </div>
  );
}
