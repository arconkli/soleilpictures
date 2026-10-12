// Every key the player takes, over the picture (? or the keyboard button).
// From lib/playerKeys.js — the same list the docs and the app's shortcuts
// overlay are tested against. A layer of its own: Esc or ? closes it, not the
// player.
import { useEffect, useRef } from 'react';
import * as modalGuard from '../../lib/modalGuard.js';
import { PLAYER_KEYS } from '../../lib/playerKeys.js';
import { Icon } from '../Icon.jsx';
import { X } from '../../lib/icons.js';

const GROUPS = ['Transport', 'Marking', 'View', 'Review'];

export function ShortcutSheet({ onClose }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => modalGuard.registerModalOpen({ onEscape: () => { closeRef.current?.(); return true; } }), []);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e) => { if (e.key === '?') { e.preventDefault(); e.stopPropagation(); closeRef.current?.(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const rows = PLAYER_KEYS.filter((r) => !r.future);
  return (
    <div className="film-sheet-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={ref} className="film-sheet" role="dialog" aria-label="Player shortcuts" tabIndex={-1}>
        <div className="film-sheet-head">
          <span>Shortcuts</span>
          <button type="button" className="film-btn" onClick={onClose} aria-label="Close shortcuts">
            <Icon as={X} size={16} weight="regular" />
          </button>
        </div>
        <div className="film-sheet-cols">
          {GROUPS.map((g) => (
            <section key={g} className="film-sheet-group">
              <h3>{g}</h3>
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
