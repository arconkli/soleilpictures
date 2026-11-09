import { useEffect, useRef } from 'react';
import { Icon } from './Icon.jsx';
import { X } from '../lib/icons.js';
import { Spinner } from './Spinner.jsx';
import { isComposingKey } from '../lib/composerKeys.js';
import './panelWait.css';

// What a panel shows while its code loads (the Suspense fallback of lazyPanel
// and of the panels App opens on demand). The frame and its title appear at
// once; a spinner and "Opening <title>…" fade in after 0.3 s (CSS delay, no
// timer), so a fast open never flashes. `variant`: 'modal' (centred card),
// 'dock' (right-hand panel) or 'page' (full screen). The modal closes on
// Escape when `onClose` is given.
export function PanelWait({ title, onClose = null, variant = 'modal' }) {
  useEffect(() => {
    if (variant !== 'modal' || !onClose) return undefined;
    const onKey = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, onClose]);

  const modalRef = useRef(null);
  // The modal takes focus once, on mount; the real panel takes it when it mounts.
  useEffect(() => {
    if (variant === 'modal') modalRef.current?.focus({ preventScroll: true });
  }, [variant]);

  const head = (
    <div className="panel-wait-head">
      <span className="panel-wait-title" dir="auto">{title}</span>
      {onClose && variant !== 'page' && (
        <button type="button" className="panel-wait-close" aria-label="Close" onClick={onClose}>
          <Icon as={X} size={16} />
        </button>
      )}
    </div>
  );
  const body = (
    <div className="panel-wait-body">
      <Spinner size={18} />
      <span className="panel-wait-say" role="status">Opening <bdi>{title}</bdi>…</span>
    </div>
  );
  if (variant === 'modal') {
    return (
      <div className="panel-wait-scrim">
        <div ref={modalRef} className="panel-wait panel-wait-modal" role="dialog" aria-modal="true" tabIndex={-1} aria-label={title}>{head}{body}</div>
      </div>
    );
  }
  return <div className={`panel-wait panel-wait-${variant}`}>{head}{body}</div>;
}
