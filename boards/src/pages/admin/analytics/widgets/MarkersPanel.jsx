// MarkersPanel — what changed, beside the weekly charts, and the one-line form
// the owner uses to pin a dated note of their own.
//
// A step in a line needs its explanation within reach. The charts draw a dated
// marker as a dashed rule with a hover tip; this is the same set as words, newest
// first, so "what happened last week" is a read rather than a hunt along four x
// axes. It is also the only place a definition break about a counter none of the
// four charts plot is shown at all (markersForColumn in lib/weeklySeries.js).
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

import { useRef, useState } from 'react';
import { MARKER_KINDS, glyphFor } from '../../viz/markerGlyphs.js';

// Past this many the list says how many it left out. Newest first, so what it
// leaves out is the oldest, and the charts still draw those.
const MAX_ROWS = 12;

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Newest first. Equal days then fall back to source and label, as mergeMarkers
// does, so a list handed over in any order lists the same way every render.
const newestFirst = (a, b) => cmp(b.day, a.day) || cmp(a.source, b.source) || cmp(a.label, b.label);

// One key per row, from what the row IS rather than where it sits. Index keys
// would let React keep the focused remove button when a note is deleted and hand
// it to whichever row slid into the slot, so the next Enter would delete THAT
// note. Two rows can still agree on all four parts (two alerts with the same
// label on the same day), so a repeat gets a counter and keys never collide.
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
 * @param {function} onAdd     (day, label, kind) => Promise<truthy on success>; a falsy result keeps what was typed
 * @param {function} onRemove  (row) => void, called with the marker row; offered on `source === 'note'` rows only
 * @param {boolean}  busy      a write is in flight: the Add and remove buttons are disabled
 * @param {string}   todayUtc  today as a UTC 'YYYY-MM-DD': the date field's default and its latest allowed day
 */
export function MarkersPanel({ markers, onAdd, onRemove, busy = false, todayUtc }) {
  const [day, setDay] = useState(todayUtc ?? '');
  const [kind, setKind] = useState('note');
  const [label, setLabel] = useState('');
  const labelRef = useRef(null);
  // Held in a ref because a double Enter can arrive before the parent has had a
  // render in which to say it is busy.
  const sending = useRef(false);

  const rows = (Array.isArray(markers) ? markers : [])
    .filter((m) => m !== null && typeof m === 'object')
    .sort(newestFirst);
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  const keys = rowKeys(shown);

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
      {shown.length === 0 ? (
        <div className="admin-empty">No markers in this window yet.</div>
      ) : (
        <ul className="adm-markers-list">
          {shown.map((m, i) => {
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
                    onClick={() => onRemove(m)}
                    disabled={busy}
                  >✕</button>
                )}
              </li>
            );
          })}
          {hidden > 0 && <li className="adm-markers-more">{hidden} more</li>}
        </ul>
      )}

      <form onSubmit={submit} className="adm-markers-form" aria-label="Add a dated note">
        <input
          type="date"
          className="auth-input adm-markers-date"
          value={day}
          max={todayUtc}
          required
          aria-label="Date"
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
        <span className="adm-markers-hint">UTC day</span>
      </form>
    </>
  );
}
