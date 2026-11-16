// The slate beside a cluster's name in the title bar: for a few seconds after you
// come back, "· last worked Tuesday evening". When the words fold away nothing is
// left beside the name.
//
// It says "last worked", not "last here", on purpose: a visit on another device would
// make "last here" untrue, while your own edit stamps on the cards are true on every
// device (lib/placeHeld.js).
//
// Presentational. App decides when it is long (a held open, or a return to the tab)
// and when it quiets, and hands over `label`, the last-worked label from
// lastWorkedLabel, or null once it is quiet. The last-worked words stay mounted once
// they have been said, so they fold away with a transition instead of snapping out
// (styles.css .cluster-slate). Where the long form would not fit the bar it folds
// away at once, never shown clipped.
//
// slateWords gives the same words as one line, for the phone, which has no room
// beside the name and shows them under the bar (App.jsx).

import { useLayoutEffect, useRef, useState } from 'react';
import { t } from '@lingui/core/macro';
import { formatDate } from '../lib/intlFormat.js';

// "last worked yesterday evening", "last worked Tuesday evening". Whole messages,
// because the order of the day and its part is the language's to choose.
function lastWords(label) {
  if (!label) return '';
  if (label.when === 'yesterday') {
    switch (label.part) {
      case 'morning': return t({
        message: 'last worked yesterday morning',
        comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am.',
      });
      case 'afternoon': return t({
        message: 'last worked yesterday afternoon',
        comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am.',
      });
      case 'evening': return t({
        message: 'last worked yesterday evening',
        comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am.',
      });
      case 'late': return t({
        message: 'last worked late yesterday',
        comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am.',
      });
      default: return '';
    }
  }
  if (label.when !== 'weekday') return '';
  const weekday = formatDate(new Date(label.dayMs), { weekday: 'long' });
  switch (label.part) {
    case 'morning': return t({
      message: `last worked ${weekday} morning`,
      comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am. {weekday} is the day’s name in the nominative (Tuesday, вторник, mardi, 火曜日). Phrase it so a nominative day name reads correctly, as a label would (Russian: «последняя работа: вторник, вечер»).',
    });
    case 'afternoon': return t({
      message: `last worked ${weekday} afternoon`,
      comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am. {weekday} is the day’s name in the nominative (Tuesday, вторник, mardi, 火曜日). Phrase it so a nominative day name reads correctly, as a label would (Russian: «последняя работа: вторник, вечер»).',
    });
    case 'evening': return t({
      message: `last worked ${weekday} evening`,
      comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am. {weekday} is the day’s name in the nominative (Tuesday, вторник, mardi, 火曜日). Phrase it so a nominative day name reads correctly, as a label would (Russian: «последняя работа: вторник, вечер»).',
    });
    case 'late': return t({
      message: `last worked late ${weekday}`,
      comment: 'Beside a cluster’s name in the title bar, after a dot, for a few seconds when you come back: when YOU last worked on this cluster, on any of your devices. Lower case: it continues the line. Late means 10pm to 5am. {weekday} is the day’s name in the nominative (Tuesday, вторник, mardi, 火曜日). Phrase it so a nominative day name reads correctly, as a label would (Russian: «последняя работа: вторник, вечер»).',
    });
    default: return '';
  }
}

// "last worked Tuesday evening", as one line.
export function slateWords(label) {
  return lastWords(label);
}

// The fold: .cs-last fades for .45s, then folds for .35s (styles.css).
const FOLD_MS = 800;

export default function ClusterSlate({ label = null }) {
  const ref = useRef(null);
  const said = useRef('');
  const text = lastWords(label);
  if (text) said.current = text;
  // Too wide for the bar, or the cluster's name giving way to it (a long language
  // on a narrow bar cut "Studio" to "S…"): the short form, at once (.is-clipped
  // turns the fold's transition off, so the long form is never seen going). It
  // stays short until the long form is asked for again.
  const [clipped, setClipped] = useState(false);
  const key = text ? `${label.when}|${label.part}|${label.dayMs}` : '';
  useLayoutEffect(() => {
    if (!key) { setClipped(false); return; }
    const host = ref.current?.parentElement;
    if (!host) return;
    const over = (el) => el.scrollWidth > el.clientWidth + 1;
    if (over(host) || [...host.querySelectorAll('.crumb')].some(over)) setClipped(true);
  }, [key]);
  const long = !!text && !clipped;
  // Folded, the slate leaves the row (.is-gone): the row's gap would still count an
  // empty slate and push New cluster along. Only once the words have folded (FOLD_MS,
  // the .cs-last transition), or the fading words would jump out of place; at once
  // when nothing is fading. Never while long, so the fit check above measures it in
  // the row.
  const [gone, setGone] = useState(!text);
  useLayoutEffect(() => {
    if (long) { setGone(false); return undefined; }
    const still = clipped || !said.current
      || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (still) { setGone(true); return undefined; }
    const id = setTimeout(() => setGone(true), FOLD_MS);
    return () => clearTimeout(id);
  }, [long, clipped]);
  return (
    <span className={`cluster-slate${long ? ' is-long' : ''}${clipped ? ' is-clipped' : ''}${!long && gone ? ' is-gone' : ''}`} ref={ref}>
      <span className="cs-last" aria-hidden={long ? undefined : 'true'}><b className="cs-dot" aria-hidden="true">·</b>{said.current}</span>
    </span>
  );
}
