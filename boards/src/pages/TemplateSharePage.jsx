import { useEffect, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { sanitizeLayout } from '../lib/gridLayout.js';
import { getGridLayoutByToken } from '../lib/gridLayoutsApi.js';
import { encodeRemixParam } from '../lib/remix.js';
import './templateSharePage.css';

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

export function TemplateSharePage({ token }) {
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
        setTpl({ name: row.name || 'Untitled template', tree });
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
        <a className="public-brand" href={ctaHref(token, 'badge')} title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href={ctaHref(token, 'signin')}>Sign in</a>
          {status === 'ok'
            ? <a className="public-cta" href={href}>Use this template</a>
            : <a className="public-cta" href={ctaHref(token, 'topbar')}>Try Clusters free</a>}
        </div>
      </div>

      <main className="tshare-main">
        {status === 'loading' && <div className="tshare-msg">Loading…</div>}

        {status === 'invalid' && (
          <div className="tshare-msg">
            <h1 className="tshare-h1">This link is no longer live</h1>
            <p>The template may have been deleted, or the link revoked.</p>
            <a className="public-cta" href={ctaHref(token, 'invalid')}>Try Clusters free</a>
          </div>
        )}

        {status === 'ok' && tpl && (
          <>
            <h1 className="tshare-h1">{tpl.name}</h1>
            <p className="tshare-sub">
              A grid template — {cells} {cells === 1 ? 'cell' : 'cells'} ready to fill with images,
              text, links or video.
            </p>
            <div className="tshare-preview" aria-hidden="true">
              <GridLayoutThumb tree={tpl.tree} title={tpl.name} />
            </div>
            <a className="public-cta tshare-cta" href={href}>Use this template</a>
            <p className="tshare-fine">
              Adds it to your own templates. You can rename it, change it, or delete it —
              the person who shared it keeps theirs.
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
