// MarkersPanel — what changed, beside the weekly charts, and the one-line form
// the owner uses to pin a dated note of their own.
//
// A step in a line needs its explanation within reach. The charts draw a dated
// marker as a dashed rule with a hover tip; this is the same set as words, newest
// first, so "what happened last week" is a read rather than a hunt along the
// shared x axis. It is also the only place a definition break about a counter
// none of the four charts plot is shown at all (markersForColumn in
// lib/weeklySeries.js). Every marker is listed, in a list that scrolls rather
// than stops: a note's remove button lives on its row, so an old note has to
// stay reachable.
//
// It renders the CONTENT of a plate and nothing else: the caller wraps it in a
// Plate (and gives that plate the `adm-markers` class, which the layout rule in
// admin.css hangs off), and the form is the last thing in it.
//
// Presentational on purpose. The Today view owns the RPC calls and the undo
// toast, so this module has no Supabase or toast import: onAdd and onRemove are
// the whole interface to the outside, and a test or a harness can drive it with
// two plain functions.
//
// Only the owner's own notes can be removed. A changelog entry, a definition
// break and a pipeline alert are facts about the product that this panel did
// not write, so their rows carry no button; the owner edits the source of each.
//
// The kind is told by SHAPE, in the same glyph map the charts use
// (viz/markerGlyphs.js), so the list and the lines can never draw one kind in
// two shapes. The glyph is aria-hidden, as that module requires of its callers,
// which is why each row also says its kind in words for a screen reader.

import { useId, useRef, useState } from 'react';
import { MARKER_KINDS, glyphFor } from '../../viz/markerGlyphs.js';

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Newest first. Equal days then fall back to source and label, as mergeMarkers
// does, so a list handed over in any order lists the same way every render.
const newestFirst = (a, b) => cmp(b.day, a.day) || cmp(a.source, b.source) || cmp(a.label, b.label);

// One key per row, from what the row IS rather than where it sits. Index keys
// would let React keep a focused remove button when its note leaves the list by
// any route but that button (a re-fetch, an undo from elsewhere) and hand it to
// whichever row slid into the slot, so the next Enter would delete THAT note.
// Two rows can still agree on all four parts (two alerts with the same label on
// the same day), so a repeat gets a counter and keys never collide.
function rowKeys(rows) {
  const seen = new Map();
  return rows.map((m) => {
    const id = [m.source, m.ref_id ?? m.anchor ?? m.migration ?? '', m.day, m.label].join('\u0000');
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}\u0000${n}`;
  });
}

/**
 * @param {object[]} markers   merged markers, any order: [{ day, kind, label, source, ref_id?, anchor?, migration? }] (lib/weeklySeries.js mergeMarkers)
 * @param {function} onAdd     (day, label, kind) => Promise<truthy on success>; a falsy result keeps what was typed.
 *                             A rejection is deliberately NOT caught: it surfaces as an unhandled rejection, the
 *                             typed label stays, and the caller owns turning a failure into a message.
 * @param {function} onRemove  (row) => void, called with the marker row; offered on `source === 'note'` rows only.
 *                             On a keyboard press focus moves to the label field first, so it never falls to the
 *                             page when the row goes.
 * @param {boolean}  busy      a write is in flight: the Add and remove buttons are disabled
 * @param {string}   todayUtc  today as a UTC 'YYYY-MM-DD'. The date field's initial value is read ONCE, at mount;
 *                             its `max` and the `today` button follow the prop after that.
 * @param {string}   windowFrom the first day the list and the charts show ('YYYY-MM-DD'): the date field's `min`,
 *                             so a note cannot be dated where nothing would draw it.
 */
export function MarkersPanel({ markers, onAdd, onRemove, busy = false, todayUtc, windowFrom }) {
  const [day, setDay] = useState(todayUtc ?? '');
  const [kind, setKind] = useState('note');
  const [label, setLabel] = useState('');
  const labelRef = useRef(null);
  // The hint describes the date field; an id of its own, so two panels on a page
  // never point at each other's.
  const hintId = useId();
  // Held in a ref because a double Enter can arrive before the parent has had a
  // render in which to say it is busy.
  const sending = useRef(false);

  const rows = (Array.isArray(markers) ? markers : [])
    .filter((m) => m !== null && typeof m === 'object')
    .sort(newestFirst);
  const keys = rowKeys(rows);

  async function submit(e) {
    e.preventDefault();
    const text = label.trim();
    if (sending.current || busy || !text || !day) return;
    sending.current = true;
    try {
      const ok = await onAdd(day, text, kind);
      // Clear only on success: a refused note keeps its words, so a typo in the
      // date costs one edit and not the whole sentence. The day and the kind
      // stay either way, since a second note for the same day is the usual next.
      if (ok) {
        setLabel('');
        labelRef.current?.focus();
      }
    } finally {
      sending.current = false;
    }
  }

  return (
    <>
      {rows.length === 0 ? (
        <div className="admin-empty">No markers in this window yet.</div>
      ) : (
        <ul className="adm-markers-list">
          {rows.map((m, i) => {
            const text = typeof m.label === 'string' ? m.label : '';
            return (
              // A kind this module has never heard of gets `is-other`, never its raw
              // string in a class name (AreaChart does the same for the lines).
              <li
                key={keys[i]}
                className={`adm-marker-row is-${MARKER_KINDS.includes(m.kind) ? m.kind : 'other'}`}
                data-source={m.source}
              >
                <span className="sr-only">{m.kind}</span>
                <span className="adm-marker-g" aria-hidden="true">{glyphFor(m.kind)}</span>
                <span className="adm-marker-d" title={m.day}>{typeof m.day === 'string' ? m.day.slice(5) : ''}</span>
                <span className="adm-marker-l">
                  {m.source === 'changelog'
                    ? <a href={m.anchor ? `/changelog#${m.anchor}` : '/changelog'} target="_blank" rel="noopener">{text}</a>
                    : text}
                  {m.source === 'definition' && m.migration
                    ? <>{' '}<span className="adm-marker-m">{m.migration}</span></>
                    : null}
                </span>
                {m.source === 'note' && (
                  <button
                    type="button"
                    className="admin-action adm-marker-x"
                    aria-label={`Remove note: ${text}`}
                    onClick={(e) => {
                      // This row is about to unmount, and focus on an element that
                      // unmounts falls to the page. For a keyboard press (detail 0)
                      // park it on the label field, where the next note is typed,
                      // before the row goes. Not for a pointer: there it scrolled the
                      // page to the field and opened the soft keyboard on a tablet,
                      // and a pointer user is not lost when focus falls.
                      if (e.detail === 0) labelRef.current?.focus({ preventScroll: true });
                      onRemove(m);
                    }}
                    disabled={busy}
                  >✕</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="adm-markers-form" aria-label="Add a dated note">
        <input
          type="date"
          className="auth-input adm-markers-date"
          value={day}
          min={windowFrom}
          max={todayUtc}
          required
          aria-label="Date"
          aria-describedby={hintId}
          onChange={(e) => setDay(e.target.value)}
        />
        <button type="button" className="admin-action is-quiet" onClick={() => setDay(todayUtc ?? '')}>today</button>
        <select
          className="auth-input adm-markers-kind"
          value={kind}
          aria-label="Kind"
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="note">note</option>
          <option value="ship">ship</option>
          <option value="event">event</option>
        </select>
        <input
          className="auth-input adm-markers-label"
          value={label}
          maxLength={120}
          placeholder="what changed…"
          required
          aria-label="Label"
          ref={labelRef}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" className="admin-action" disabled={busy || !label.trim()}>Add</button>
        {/* The date field shows the viewer's calendar; the note lands on a UTC
            day, the same one the weekly columns are cut on. */}
        <span className="adm-markers-hint" id={hintId}>UTC day</span>
      </form>
    </>
  );
}
