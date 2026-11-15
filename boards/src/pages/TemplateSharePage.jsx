import { useEffect, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { sanitizeLayout } from '../lib/gridLayout.js';
import { getGridLayoutByToken } from '../lib/gridLayoutsApi.js';
import { encodeRemixParam } from '../lib/remix.js';
import { templateStoreAllowed } from '../lib/appHost.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import './templateSharePage.css';
import { t, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// /t/<token> — someone sent you a grid template.
//
// DELIBERATELY LIGHT. A template is layout geometry and nothing else, so this
// page is an SVG diagram and a name. It must never import yjs, CanvasSurface or
// PublicBoardView: those exist because a shared BOARD has to render live
// content, and pulling them in here would drag the whole editor chunk into a
// signed-out route for a picture of some rectangles. That is the same
// landing-CRO guardrail publicBoardsApi.js documents. gridLayoutsApi imports
// only the supabase client, which is what keeps this honest.
//
// One CTA, one path, for signed-in and signed-out alike: the link carries
// ?remix=g_<token>, AuthGate stashes it (surviving an OTP hop to another tab or
// device), and App claims it on the next authenticated load. A visitor who
// already has a session simply passes straight through.
//
// The failure state is deliberately incurious. get_grid_layout_by_token returns
// null for unknown, revoked AND deleted tokens alike, so this page cannot tell
// them apart — and shouldn't, since distinguishing them would confirm to a
// stranger that a given token once existed.

function ctaHref(token, surface) {
  const campaign = encodeURIComponent(token || '');
  return `/?utm_source=template_link&utm_medium=${encodeURIComponent(surface)}&utm_campaign=${campaign}`;
}

function useHref(token) {
  const param = encodeRemixParam({ kind: 'template', value: token });
  return param ? `${ctaHref(token, 'use')}&remix=${encodeURIComponent(param)}` : ctaHref(token, 'use');
}

// Held with the rest of the template store (lib/templatePaths.js). Where it is
// held the Worker has already answered this URL with a 404, and the app has no
// Templates panel to place a template from, so the page says not found rather
// than offering something that cannot be used. Before any hook, so a held page
// never asks the server about the token.
export function TemplateSharePage({ token }) {
  if (!templateStoreAllowed()) return <NotFoundPage />;
  return <TemplateShare token={token} />;
}

function TemplateShare({ token }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'invalid'
  const [tpl, setTpl] = useState(null);

  useEffect(() => {
    let on = true;
    getGridLayoutByToken(token)
      .then((row) => {
        if (!on) return;
        const tree = row?.body?.layout ? sanitizeLayout(row.body.layout) : null;
        // A row whose geometry won't survive sanitizing is as unusable as no row
        // at all — better one honest dead-end than a page rendering nothing.
        if (!tree) { setStatus('invalid'); return; }
        setTpl({ name: row.name || t`Untitled template`, tree });
        setStatus('ok');
      })
      .catch(() => { if (on) setStatus('invalid'); });
    return () => { on = false; };
  }, [token]);

  const href = useHref(token);
  const cells = tpl ? (tpl.tree ? countCells(tpl.tree) : 0) : 0;

  return (
    <div className="tshare-root">
      <div className="public-topbar">
        <a className="public-brand" href={ctaHref(token, 'badge')} title={t`Clusters home`}>
          <ClustersMark size={20} />
          <span className="public-brand-name"><Trans context="brand">Clusters</Trans></span>
        </a>
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href={ctaHref(token, 'signin')}><Trans>Sign in</Trans></a>
          {status === 'ok'
            ? <a className="public-cta" href={href}><Trans>Use this template</Trans></a>
            : <a className="public-cta" href={ctaHref(token, 'topbar')}><Trans>Try Clusters free</Trans></a>}
        </div>
      </div>

      <main className="tshare-main">
        {status === 'loading' && <div className="tshare-msg"><Trans>Loading…</Trans></div>}

        {/* No second call to action here on purpose. The topbar already carries
            one, and repeating it verbatim is the three-CTA mistake
            PublicBoardView's header describes: the same offer worded twice
            reads as two choices for one question. */}
        {status === 'invalid' && (
          <div className="tshare-msg">
            <h1 className="tshare-h1"><Trans>This link is no longer live</Trans></h1>
            <p><Trans>The template may have been deleted, or the link revoked.</Trans></p>
          </div>
        )}

        {status === 'ok' && tpl && (
          <>
            <h1 className="tshare-h1">{tpl.name}</h1>
            <p className="tshare-sub">
              {t`A grid template — ${plural(cells, { one: '# cell', other: '# cells' })} ready to fill with images, text, links or video.`}
            </p>
            <div className="tshare-preview" aria-hidden="true">
              <GridLayoutThumb tree={tpl.tree} title={tpl.name} />
            </div>
            <a className="public-cta tshare-cta" href={href}><Trans>Use this template</Trans></a>
            <p className="tshare-fine">
              <Trans>Adds it to your own templates. You can rename it, change it, or delete it —
              the person who shared it keeps theirs.</Trans>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function countCells(node) {
  if (!node) return 0;
  if (node.type === 'leaf') return 1;
  return (node.children || []).reduce((n, c) => n + countCells(c), 0);
}
