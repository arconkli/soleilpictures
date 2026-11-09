import { useEffect, useState } from 'react';
import { SoleilMark } from './primitives.jsx';
import { useOnline } from '../hooks/useOnline.js';

// How long a cluster may take to open before it says it is still connecting.
export const BOARD_OPENING_STALL_MS = 10000;

// What a cluster shows while its Y.Doc hydrates: ghost cards and a breathing
// sun, as ever. After BOARD_OPENING_STALL_MS (its own clock from mount, so the
// caller keys it by the cluster) the ghosts fade out and give way to DocOpening's words
// under the sun, with a reload and, where there is somewhere to go back to, a
// way out (`onBack`, labelled `backLabel`). A screen reader hears "Opening …"
// from the start. The overlay ignores the pointer, but the words' buttons do not.
export function BoardOpening({ name = '', onBack = null, backLabel = 'Go back', force }) {
  const [stalled, setStalled] = useState(false);
  const online = useOnline();
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), BOARD_OPENING_STALL_MS);
    return () => clearTimeout(t);
  }, []);
  const isStalled = typeof force === 'number' ? force > 0 : stalled;
  const label = name || 'this cluster';
  return (
    <div className={`board-loading-overlay${isStalled ? ' is-stalled' : ''}`}>
      <div className="board-loading-ghosts" aria-hidden="true">
        <span className="board-loading-ghost" />
        <span className="board-loading-ghost" />
        <span className="board-loading-ghost" />
      </div>
      <span className="board-loading-mark" aria-hidden="true"><SoleilMark size={36} color="var(--soleil)" glow /></span>
      <div className="board-loading-words">
      <div role="status" className={isStalled ? 'doc-opening-say' : 'sr-only'}>
        {isStalled ? (
          <>
            <span className="t-eyebrow">Cluster</span>
            <div className="doc-state-title">Still connecting to {label}…</div>
            <div className="doc-state-sub">
              {online
                ? 'The cluster opens as soon as it arrives. If your connection dropped, reload the page.'
                : 'You’re offline. The cluster opens as soon as you’re back online.'}
            </div>
          </>
        ) : `Opening ${label}…`}
      </div>
      {isStalled && (
        <div className="doc-opening-actions">
          <button type="button" className="surface-error-btn" onClick={() => window.location.reload()}>Reload page</button>
          {onBack && <button type="button" className="surface-error-btn" onClick={onBack}>{backLabel}</button>}
        </div>
      )}
      </div>
    </div>
  );
}
