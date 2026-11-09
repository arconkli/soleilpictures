// "Together" by the faces in the top bar: two or more people active in this
// cluster each earn cards (lib/liveTogether.js has every word; lib/togetherState
// has the numbers). Click opens who is here and the month's count. The chip just
// appears; only the ring's arc eases.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  chipLabel, chipShortLabel, chipAria, togetherTitle, rateLine, monthLine, capLine,
  groupHint, arrivalNote,
} from '../lib/liveTogether.js';
import './togetherChip.css';
import { isComposingKey } from '../lib/composerKeys.js';
import { initialOf } from '../lib/graphemes.js';

const RING = 40.84;   // 2 * PI * 6.5
const NOTE_KEY = 'soleil:together-note-day';
let notedThisLoad = false;   // when storage throws: once per page load

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// True the first time today on this device (and records it).
function firstNoteToday() {
  try {
    const day = today();
    if (localStorage.getItem(NOTE_KEY) === day) return false;
    localStorage.setItem(NOTE_KEY, day);
    return true;
  } catch (_) {
    if (notedThisLoad) return false;
    notedThisLoad = true;
    return true;
  }
}

export default function TogetherChip({ state, peers, selfId, compact = false, onArrive }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const popId = useId();
  const noteDismissRef = useRef(null);
  const seenSince = useRef(null);

  // Who the room named, in the order it listed them.
  const people = useMemo(() => {
    const byId = new Map();
    for (const p of peers || []) if (p?.user?.id && p.user.id !== selfId && !byId.has(p.user.id)) byId.set(p.user.id, p.user);
    return (state?.peers || []).map((id) => {
      const u = byId.get(id);
      const name = u ? (u.name || u.email?.split('@')[0] || '') : '';
      return { id, name, color: u?.color || null };
    });
  }, [state?.peers, peers, selfId]);
  const names = people.filter((p) => p.name).map((p) => p.name);
  const others = people.length;
  const namesOrNone = names.length === others ? names : [];

  // The popover lives under <body> (the top bar sits under the board), placed
  // from the chip's box when it opens and when the window resizes.
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(264, window.innerWidth - 16);
      setPos({
        top: r.bottom + 8,
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
        width,
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  // Open, the reader's place moves into the popover (it is a dialog). Tab
  // leaves it back on the chip, so the next Tab goes on from there.
  useEffect(() => {
    if (open && pos) popRef.current?.focus({ preventScroll: true });
  }, [open, !!pos]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Opening it answers the arrival note: close that note so it can't cover it.
  useEffect(() => {
    if (!open || !noteDismissRef.current) return;
    const dismiss = noteDismissRef.current;
    noteDismissRef.current = null;
    try { if (typeof dismiss === 'function') dismiss(); } catch (_) {}
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      const tabOut = e.key === 'Tab' && popRef.current?.contains(document.activeElement);
      if (e.key !== 'Escape' && !tabOut) return;
      if (tabOut) e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  // The arrival note: once per stretch this component sees, once a day at most.
  useEffect(() => {
    if (!state?.on || seenSince.current === state.since) return;
    seenSince.current = state.since;
    if (!firstNoteToday()) return;
    try { noteDismissRef.current = onArrive?.(arrivalNote(namesOrNone, others)); } catch (_) {}
  }, [state?.on, state?.since]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!state?.on) return null;
  const { earned, progress, boost, month, cap, capped } = state;
  const hint = capped ? null : groupHint(boost);
  const classes = ['tg-chip', open ? 'is-open' : '', compact ? 'is-compact' : '', compact && earned <= 0 ? 'is-ring' : ''].filter(Boolean).join(' ');

  return (
    <span className="tg-wrap" ref={wrapRef}>
      <button type="button" ref={btnRef} className={classes} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? popId : undefined}
              aria-label={chipAria(earned)} onClick={() => setOpen((o) => !o)}>
        <svg className="tg-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="var(--line-3)" strokeWidth="2" />
          <circle className="tg-ring-arc" cx="8" cy="8" r="6.5" fill="none" stroke="var(--soleil)" strokeWidth="2"
                  strokeLinecap="round" strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - Math.min(1, Math.max(0, progress || 0)))}
                  transform="rotate(-90 8 8)" />
        </svg>
        {compact ? (earned > 0 && <span className="tg-lbl"><b>{chipShortLabel(earned)}</b></span>) : (
          <span className="tg-lbl">
            {earned > 0 ? (<>Together<i>·</i><b>{chipLabel(earned).split('· ')[1]}</b></>) : chipLabel(earned)}
          </span>
        )}
      </button>
      {open && pos && createPortal(
        <div ref={popRef} id={popId} tabIndex={-1} className="presence-roster tg-pop" role="dialog" aria-label="Working together"
             style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <div className="tg-title">{togetherTitle(namesOrNone, others)}</div>
          <div className="tg-sub">{capped ? capLine(cap) : rateLine(boost)}</div>
          <div className="tg-people">
            {people.map((p) => (
              <span key={p.id} className="presence-dot" title={p.name || undefined}
                    style={{ background: p.color || 'var(--ink-3)' }}>
                {initialOf(p.name)}
              </span>
            ))}
          </div>
          <div className="tg-sep" />
          <div className="tg-month">{monthLine(month, cap)}</div>
          <div className="tg-meter"><i style={{ width: `${Math.min(100, Math.max(0, (month / cap) * 100))}%` }} /></div>
          {hint && (<><div className="tg-sep" /><div className="tg-more">{hint}</div></>)}
        </div>,
        document.body,
      )}
    </span>
  );
}
