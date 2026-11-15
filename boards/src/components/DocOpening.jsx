import { useEffect, useState } from 'react';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// How long a doc may take to open before it says it is still connecting.
export const DOC_OPENING_STALL_MS = 10000;

// What a doc shows while it opens: its editor's code loading (the Suspense
// fallback around the lazy DocSurface) or, docked, the cluster it sits on still
// loading. It says it is opening to a screen reader as well as showing the
// shimmer, and once it has waited DOC_OPENING_STALL_MS it says plainly that it
// is still connecting and offers a reload, and a close where nothing else on
// screen closes it (`onClose`: a docked pane has no header until its doc
// arrives). The doc takes its place the moment it arrives, as it always did.
export function DocOpening({ onClose = null }) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), DOC_OPENING_STALL_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`doc-opening${stalled ? ' is-stalled' : ''}`}>
      {/* One live region, kept across the change, so the change is read out. */}
      <div role="status" className={stalled ? 'doc-opening-say' : 'sr-only'}>
        {stalled ? (
          <>
            <span className="t-eyebrow"><Trans>Document</Trans></span>
            <div className="doc-state-title"><Trans>Still connecting…</Trans></div>
            <div className="doc-state-sub"><Trans>The document opens as soon as it arrives. If your connection dropped, reload the page.</Trans></div>
          </>
        ) : tr`Opening document…`}
      </div>
      {stalled ? (
        <div className="doc-opening-actions">
          <button type="button" className="surface-error-btn" onClick={() => window.location.reload()}><Trans>Reload page</Trans></button>
          {onClose && <button type="button" className="surface-error-btn" onClick={onClose}><Trans>Close</Trans></button>}
        </div>
      ) : (
        <div className="doc-surface-skeleton" aria-hidden="true" />
      )}
    </div>
  );
}
