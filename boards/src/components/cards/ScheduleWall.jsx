// The wall chart — one row per month, one thin column per day.
//
// This is the thing that actually gets pinned up in a production office, and it
// is the only surface here that answers "what is the shape of this shoot": ten
// weeks of prep, eight of production with a hiatus in the middle, two of wrap,
// all in about a hundred pixels. A month grid needs five hundred to say less.
//
// It does not try to be readable up close — a cell is fifteen pixels and holds
// no text. It navigates; the surface below it details. Clicking a day scrolls
// the contact sheet or the list to it.
//
// Days lay out by DATE, not by weekday, so the columns deliberately do not line
// up between months (Aug 1 is a Saturday, Sep 1 a Tuesday). That is how the
// paper version works; the faded weekend cells carry the rhythm instead.

import { t, plural } from '@lingui/core/macro';
import { parseISO } from '../../lib/schedDates.js';
import { weekdayShortNames, monthShortNames, monthTitle } from '../../lib/schedDatesWords.js';
import { wallMonths, CAL_TUNING } from '../../lib/schedCalendar.js';
import { dayTypeColor, dayTypeName } from '../../lib/dayTypes.js';

const stop = (e) => e.stopPropagation();

export function ScheduleWall({
  from, to, todayIso, shootDays = {}, dayCounts = {}, types,
  selectedDate = null, onPickDate = null,
}) {
  const months = wallMonths({ from, to, todayIso });
  if (!months.length) return null;

  return (
    <div className="schedw" onPointerDown={stop}>
      {months.map((m) => {
        const monthShort = monthShortNames()[parseISO(m.iso).m - 1];
        return (
        <div key={m.iso} className="schedw-row">
          <span className="schedw-m" title={monthTitle(m.iso)}>{monthShort}</span>
          <span className="schedw-days">
            {m.days.map((d) => {
              const days = shootDays[d.date] || [];
              const live = days.find((b) => b.sched_status !== 'cancelled') || days[0] || null;
              const cancelled = !!live && live.sched_status === 'cancelled';
              const hue = live ? dayTypeColor(live, types) : null;
              const loose = !live && dayCounts[d.date] > 0;
              const dayName = live ? (live.day_label || live.name || t`Day`) : '';
              const label = live
                ? `${dayName}${dayTypeName(live, types) ? ` · ${dayTypeName(live, types)}` : ''}`
                : loose ? t`${plural(dayCounts[d.date], { one: '# item', other: '# items' })}` : t`Nothing scheduled`;
              return (
                <button
                  key={d.date}
                  type="button"
                  className={[
                    'schedw-d',
                    d.weekend ? 'is-weekend' : '',
                    live ? 'is-day' : '', cancelled ? 'is-cancelled' : '',
                    loose ? 'is-loose' : '',
                    d.isToday ? 'is-today' : '',
                    selectedDate === d.date ? 'is-selected' : '',
                  ].filter(Boolean).join(' ')}
                  style={hue ? { '--w-hue': hue } : undefined}
                  title={`${weekdayShortNames()[d.dow]} ${monthShortNames()[parseISO(d.date).m - 1]} ${d.day} — ${label}`}
                  aria-label={`${weekdayShortNames()[d.dow]} ${d.day} ${monthShort}: ${label}`}
                  onPointerDown={stop}
                  onClick={(e) => { e.stopPropagation(); onPickDate?.(d.date); }}
                />
              );
            })}
          </span>
        </div>
        );
      })}
    </div>
  );
}

export { CAL_TUNING };
