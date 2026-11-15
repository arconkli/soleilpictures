// "Add days" — lay a block of dated clusters onto the calendar.
//
// Says "days", not "shoot days": this app is for creative production generally,
// and a game studio's sprint or a photo studio's shoot week is the same object
// as a film's Day 14. The internals keep the productionDay name.
//
// Small on purpose. A production is laid out once, and the decision is only
// ever three things: where it ends, whether it runs weekends, and what the
// first day is called. The start date is wherever you opened the menu.
//
// It shows the resulting COUNT before you commit, because the difference
// between 20 and 90 clusters is the difference between a schedule and a mess,
// and MAX_SHOOT_DAYS_PER_ADD silently clamping a fat-fingered year would be
// exactly the kind of quiet truncation that reads as "it worked".

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { X } from '../../lib/icons.js';
import { addDays } from '../../lib/schedDates.js';
import { shortDate } from '../../lib/schedDatesWords.js';
import { shootDayDates, MAX_SHOOT_DAYS_PER_ADD } from '../../lib/productionDayPlan.js';
import { placeBeside } from './GridCellMenu.jsx';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const stop = (e) => e.stopPropagation();

export function ShootDayRange({ anchorRect, startDate, startNumber = 1, onAdd, onClose }) {
  const ref = useRef(null);
  const [end, setEnd] = useState(() => addDays(startDate, 27));   // four weeks
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);

  // Same measure-then-place dance as GridCellMenu: the panel has to exist
  // before it can be sized, so the first paint is hidden and an rAF re-places
  // it once the browser has laid it out.
  const aKey = anchorRect
    ? `${anchorRect.left},${anchorRect.top},${anchorRect.width},${anchorRect.height}` : null;
  useLayoutEffect(() => {
    if (!anchorRect) return undefined;
    const place = () => {
      const el = ref.current;
      if (!el) return;
      setPos(placeBeside(anchorRect, el.offsetWidth || 240, el.offsetHeight || 0,
        window.innerWidth, window.innerHeight));
    };
    place();
    const id = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(id); window.removeEventListener('resize', place); };
  }, [aKey]);

  // escapeCapture: the canvas clears selection on a bubbled Escape, so this
  // panel has to close first rather than let the board lose its selection
  // underneath it — the same reason SchedulePeek captures.
  useDismissOnOutside(ref, true, onClose, { escapeCapture: true });

  const dates = shootDayDates(startDate, end, { skipWeekends });
  const clamped = dates.length >= MAX_SHOOT_DAYS_PER_ADD;
  const dayCount = dates.length;
  const lastNumber = startNumber + dayCount - 1;

  const submit = async () => {
    if (!dates.length || busy) return;
    setBusy(true);
    try { await onAdd?.({ from: startDate, to: end, skipWeekends, startNumber }); }
    finally { setBusy(false); onClose?.(); }
  };

  return createPortal(
    <div ref={ref} className="schedc-range" onPointerDown={stop}
      style={pos ? { position: 'fixed', left: pos.left, top: pos.top }
                 : { position: 'fixed', visibility: 'hidden' }}
      role="dialog" aria-label={t`Add days`}>
      <div className="schedc-range-head">
        <span className="schedc-range-title"><Trans>Add days</Trans></span>
        <button type="button" className="schedc-range-x" onClick={onClose}
          title={t`Close (Esc)`} aria-label={t`Close`}><Icon as={X} size={11} /></button>
      </div>

      <label className="schedc-range-row">
        <span><Trans>First day</Trans></span>
        <strong>{shortDate(startDate)}</strong>
      </label>

      <label className="schedc-range-row">
        <span><Trans>Through</Trans></span>
        <input type="date" value={end} min={startDate}
          onChange={(e) => setEnd(e.target.value)} />
      </label>

      <label className="schedc-range-row is-check">
        <input type="checkbox" checked={skipWeekends}
          onChange={(e) => setSkipWeekends(e.target.checked)} />
        <span><Trans>Skip weekends</Trans></span>
      </label>

      <div className="schedc-range-count">
        {dates.length === 0
          ? t`No days in that range.`
          : plural(dayCount, { one: `# day — Day ${startNumber} to Day ${lastNumber}`, other: `# days — Day ${startNumber} to Day ${lastNumber}` })}
        {clamped && (
          <span className="schedc-range-warn">
            {' '}<Trans>Capped at {MAX_SHOOT_DAYS_PER_ADD}; add the rest in a second pass.</Trans>
          </span>
        )}
      </div>

      <button type="button" className="schedc-range-go"
        disabled={!dates.length || busy} onClick={submit}>
        {busy ? t`Adding…` : plural(dayCount, { one: 'Add # day', other: 'Add # days' })}
      </button>
      <p className="schedc-range-hint">
        <Trans>Days are created empty. Open one and “Set up this day” adds its call
        sheet, shotlist, script pages and hour-by-hour.</Trans>
      </p>
    </div>,
    document.body,
  );
}
