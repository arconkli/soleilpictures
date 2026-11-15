// Every key the player takes, over the picture (? or the keyboard button).
// From lib/playerKeys.js — the same list the docs and the app's shortcuts
// overlay are tested against. A layer of its own: Esc or ? closes it, not the
// player.
import { useEffect, useRef } from 'react';
import * as modalGuard from '../../lib/modalGuard.js';
import { pushFilmLayer } from '../../lib/filmLayers.js';
import { PLAYER_KEYS, playerKeyGroupLabel } from '../../lib/playerKeys.js';
import { Icon } from '../Icon.jsx';
import { X } from '../../lib/icons.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// The group ids match playerKeys.js; what a person reads is the name below.
const GROUPS = ['Transport', 'Marking', 'View', 'Review'];

export function ShortcutSheet({ onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => modalGuard.registerModalOpen({ onEscape: () => { closeRef.current?.(); return true; } }), []);
  useEffect(() => pushFilmLayer(), []);
  // Focus comes in, and goes back on close — to where it was, or else to the
  // dialog the player is in, so its keys keep working.
  useEffect(() => {
    const prev = document.activeElement;
    const room = ref.current?.parentElement?.closest('[role="dialog"]');
    ref.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      if (e.key !== '?' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation(); closeRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const back = prev && prev !== document.body && prev.isConnected ? prev : room;
      if (back?.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} }
    };
  }, []);
  const rows = PLAYER_KEYS.filter((r) => !r.future);
  return (
    <div className="film-sheet-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className="film-sheet" role="dialog" aria-label={t`Player shortcuts`} tabIndex={-1}>
        <div className="film-sheet-head">
          <span><Trans>Shortcuts</Trans></span>
          <button type="button" className="film-btn" onClick={onClose} aria-label={t`Close shortcuts`}>
            <Icon as={X} size={16} weight="regular" />
          </button>
        </div>
        <div className="film-sheet-cols">
          {GROUPS.map((g) => (
            <section key={g} className="film-sheet-group">
              <h3>{playerKeyGroupLabel(g)}</h3>
              {rows.filter((r) => r.group === g).map((r) => (
                <div key={r.label} className="film-sheet-row">
                  <span className="film-sheet-keys">{r.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                  <span className="film-sheet-label">{r.label}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
