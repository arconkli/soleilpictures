// GrowthBand — Analytics › Overview's long run, and what changed along the way.
//
// Small multiples on one calendar (the owner's pick, 2026-10-20): ten weekly
// measures in five groups, from the first account to this week, or the last
// thirteen weeks. The measures sit orders of magnitude apart, so they share the
// x axis and never a y axis. Each group leads with one sentence and closes with
// its own dates, so no group borrows another's axis.
//
// Pointing at any chart reads that week on every chart at once: each row's
// label column turns into that week's reading, and every plot marks the column.
// Pointing at a marker, on a chart or in the list beside them, lights it in
// both. The keyboard does the same: focus the band and the arrow keys walk the
// weeks, with the readings announced.
//
// Data in (lib/growthSeries.js): admin_growth_series and the week rows of
// admin_return_fixed_horizon. The Overview owns the fetch, so its refresh button
// and its poll re-read this too, and it owns the notes, so the What-changed list
// here and the one-line form under it write through the same calls as before.
//
// Live: the Overview puts this week's row from its live read over the series
// (useOverviewLive's mergeWeeks), so the week so far grows while you watch, and
// its marks light for a moment when it does.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GROWTH_GROUPS, GROWTH_MEASURES, RANGES, bandMarkers, buildGrowth, cutIndex, defaultIndex,
  emptyMessage, groupHeadline, marksFor, monthDay, offBandNote, rangeOf, readout,
} from '../../../../lib/growthSeries.js';
import { chartGeometry } from '../../../../lib/growthChart.js';
import { breaksFor } from '../../../../lib/weeklySeries.js';
import { AdminAsync } from '../../AdminStates.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { GrowthChart } from '../../viz/GrowthChart.jsx';
import { GLYPH } from '../../viz/markerGlyphs.js';
import { MarkersPanel } from './MarkersPanel.jsx';

const RANGE_KEY = 'soleil.admin.growthRange';
// Until the band has been measured: the width the mockup was drawn at.
const FALLBACK_WIDTH = 740;

function storedRange() {
  try {
    const v = window.localStorage.getItem(RANGE_KEY);
    return v === RANGES.thirteen || v === RANGES.all ? v : RANGES.all;
  } catch {
    return RANGES.all;
  }
}

function keepRange(v) {
  try { window.localStorage.setItem(RANGE_KEY, v); } catch { /* a private window keeps it for the visit */ }
}

/**
 * @param {object}   query      useAdminData result whose data is { growth, returns }
 * @param {object[]} markers    merged markers from the first week to today (mergeMarkers)
 * @param {object[]} breaks     DEFINITION_BREAKS: which breaks cut their series
 * @param {object[]} cutBreaks  the list the trend reads cut at (the harness passes its own)
 * @param {function} onAdd      MarkersPanel's onAdd
 * @param {function} onRemove   MarkersPanel's onRemove
 * @param {boolean}  busy       a note write is in flight
 * @param {string}   todayUtc   today, 'YYYY-MM-DD' UTC
 * @param {string}   liveGen    the population counted; a change is a new baseline, not growth
 */
export function GrowthBand({ query, markers, breaks, cutBreaks, onAdd, onRemove, busy, todayUtc, liveGen }) {
  const [range, setRangeState] = useState(storedRange);
  const setRange = (v) => { setRangeState(v); keepRange(v); };

  // This week so far, lit for a moment when a read moved it. Its row is
  // compared whole; the first row, and a change of population, are a baseline.
  const partRow = useMemo(() => {
    const all = query.data?.growth;
    if (!Array.isArray(all)) return null;
    const r = all.filter((x) => x && !x.complete).at(-1);
    return r ? JSON.stringify(r) : null;
  }, [query.data]);
  const lastPart = useRef({ gen: null, row: null });
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const p = lastPart.current;
    lastPart.current = { gen: liveGen, row: partRow };
    if (partRow == null || p.row == null || p.gen !== liveGen || p.row === partRow) return;
    setLit((n) => n + 1);
  }, [partRow, liveGen]);
  useEffect(() => {
    if (!lit) return undefined;
    const t = setTimeout(() => setLit(0), 2500);
    return () => clearTimeout(t);
  }, [lit]);

  const growth = useMemo(
    () => buildGrowth(query.data?.growth, query.data?.returns, { today: todayUtc }),
    [query.data, todayUtc],
  );
  const { i0, i1 } = rangeOf(growth, range);
  const { weeks, P, L } = growth;

  // The week pointed at, by a pointer or the keyboard, and the marker.
  const [hover, setHover] = useState(null);
  const [hoverBy, setHoverBy] = useState(null);
  const [active, setActive] = useState(null);
  const [activeBy, setActiveBy] = useState(null);
  const shown = hover != null && hover >= i0 && hover <= i1 ? hover : null;

  // Every chart is drawn at the width its column has, measured once for all of
  // them: they share the column, and so the calendar lines up from top to bottom.
  const [ruler, setRuler] = useState(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ruler) return undefined;
    const measure = () => setWidth(Math.round(ruler.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(ruler);
    return () => ro.disconnect();
  }, [ruler]);

  const { placed, offBand } = useMemo(
    () => bandMarkers(markers, growth, { i0, i1, breaks }),
    [markers, growth, i0, i1, breaks],
  );

  // A touch has no "leave", so a tapped week stays until a tap lands elsewhere.
  const bandRef = useRef(null);
  useEffect(() => {
    if (hoverBy !== 'touch') return undefined;
    const away = (e) => { if (!bandRef.current?.contains(e.target)) setHover(null); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [hoverBy]);

  const onWeek = useCallback((i, pointerType) => {
    setHoverBy(pointerType === 'touch' ? 'touch' : 'pointer');
    setHover(i);
  }, []);
  const onMarker = useCallback((id) => { setActiveBy('chart'); setActive(id); }, []);
  const onListMarker = useCallback((id) => { setActiveBy('list'); setActive(id); }, []);

  function onKeyDown(e) {
    if (L < 0) return;
    const from = shown ?? Math.min(i1, Math.max(i0, L));
    let next = null;
    if (e.key === 'ArrowLeft') next = Math.max(i0, from - (shown == null ? 0 : 1));
    else if (e.key === 'ArrowRight') next = Math.min(i1, from + (shown == null ? 0 : 1));
    else if (e.key === 'Home') next = i0;
    else if (e.key === 'End') next = i1;
    else if (e.key === 'Escape' && shown != null) {
      e.preventDefault();
      setHover(null);
      return;
    } else return;
    e.preventDefault();
    setHoverBy('key');
    setHover(next);
  }

  const rows = useMemo(() => {
    if (growth.n < 2) return [];
    const out = [];
    for (const group of GROWTH_GROUPS) {
      const perRow = group.rows.map((key) => marksFor(placed, key));
      // A marker's glyph goes on the first chart of its group that draws it.
      const glyphRow = new Map();
      perRow.forEach((ms, r) => ms.forEach((m) => { if (!glyphRow.has(m.id)) glyphRow.set(m.id, r); }));
      group.rows.forEach((key, r) => {
        const measure = GROWTH_MEASURES[key];
        const ids = new Set(perRow[r].filter((m) => glyphRow.get(m.id) === r).map((m) => m.id));
        out.push({
          key,
          measure,
          group: r === 0 ? group : null,
          first: r === 0,
          last: r === group.rows.length - 1,
          marks: perRow[r],
          glyphIds: ids,
          cutAt: cutIndex(growth, measure, breaksFor(measure.cut, cutBreaks)),
          message: emptyMessage(growth, key, { i0, i1 }),
        });
      });
    }
    return out;
  }, [growth, placed, cutBreaks, i0, i1]);

  const span = weeks.length ? `${monthDay(weeks[i0])} to ${monthDay(weeks[i1])}` : '';
  const complete = L >= i0 ? L - i0 + 1 : 0;
  const meta = `${complete} complete week${complete === 1 ? '' : 's'}${P >= 0 ? ' + this week so far' : ''} · UTC Monday`;

  // What the keyboard has walked to, in words, for a screen reader.
  const spoken = hoverBy === 'key' && shown != null
    ? `Week of ${monthDay(weeks[shown])}${shown === P ? ', so far' : ''}: ${rows.map((r) => {
      const read = readout(growth, r.key, shown, { pointed: true });
      return `${r.measure.name} ${read.value}${read.sub ? ` (${read.sub})` : ''}`;
    }).join('; ')}`
    : '';

  return (
    <>
      <div className="adm-gb-sec">
        <h2 className="admin-section-title">
          {range === RANGES.thirteen ? 'Thirteen weeks, and what changed' : 'Since launch, and what changed'}
        </h2>
        <div className="tob-segmented admin-range adm-gb-range" role="group" aria-label="Weeks shown">
          {[[RANGES.thirteen, '13 wk'], [RANGES.all, 'Since launch']].map(([v, text]) => (
            <button
              key={v}
              type="button"
              className={range === v ? 'is-active' : ''}
              aria-pressed={range === v}
              onClick={() => setRange(v)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      <p className="admin-section-sub adm-gb-sub">
        Complete UTC weeks, Monday to Sunday. This week so far is drawn hollow, past a thin divider.
        Weeks from before a thing was measured are hatched, and a dashed line is something that changed.
      </p>

      <Deck className="adm-gb-deck">
        <Well
          span={8}
          className="adm-gb-well"
          title="Weekly, by measure"
          meta={growth.n ? meta : null}
          // Both ways: _admin_people asks _admin_entered_code() as things are now,
          // so a code entered late joins a week already drawn.
          foot="History can shrink: deleted accounts and cards leave it. It can also grow: a code entered late counts in the week the account was made."
        >
          <AdminAsync
            loading={query.loading}
            error={query.error}
            hasData={query.hasData}
            onRetry={query.refresh}
            skeleton={<div className="adm-well-skeleton adm-gb-skeleton" />}
          >
            {rows.length === 0 ? (
              <div className="admin-empty">Nothing to plot yet</div>
            ) : (
              <div
                ref={bandRef}
                className={`adm-gb${lit ? ' is-lit' : ''}`}
                // Focusable so the arrow keys can walk the weeks; the readings are
                // announced from the live region below.
                tabIndex={0}
                role="group"
                aria-label={`Weekly charts by measure, ${span}. Arrow keys read one week at a time, Escape stops.`}
                onKeyDown={onKeyDown}
                onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && hoverBy === 'key') setHover(null); }}
                onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }}
              >
                {rows.map((r, idx) => {
                  const at = shown ?? defaultIndex(growth, r.key);
                  const read = readout(growth, r.key, at, { pointed: shown != null });
                  const geo = chartGeometry({
                    growth, measureKey: r.key, i0, i1, width: width || FALLBACK_WIDTH,
                    first: r.first, last: r.last, marks: r.marks, glyphIds: r.glyphIds,
                    hover: shown, active, cutAt: r.cutAt, message: r.message,
                  });
                  const head = r.group ? groupHeadline(growth, r.group.key, { i0, range }) : null;
                  return (
                    <div key={r.key} className="adm-gb-block">
                      {r.group && (
                        <div className={`adm-gb-grp${idx === 0 ? ' is-first' : ''}`}>
                          <span className="adm-gb-grp-name">{r.group.name}</span>
                          {head.length > 0 && (
                            <span className="adm-gb-head">
                              {head.map((p, k) => (p.strong ? <b key={k}>{p.text}</b> : <span key={k}>{p.text}</span>))}
                            </span>
                          )}
                        </div>
                      )}
                      <div className="adm-gb-row">
                        <div className="adm-gb-lab" title={`${r.measure.name}: ${r.measure.about}`}>
                          <span className="adm-gb-name">{r.measure.name}</span>
                          <span className="adm-gb-val">
                            {read.value}
                            {read.sub ? <small>{read.sub}</small> : null}
                          </span>
                          <span className="adm-gb-when">{read.when}</span>
                        </div>
                        <div className="adm-gb-plot" ref={idx === 0 ? setRuler : undefined}>
                          <GrowthChart
                            geo={geo}
                            measure={r.measure}
                            label={`${r.measure.name} by week, ${span}${r.message ? `. ${r.message}` : ''}`}
                            onWeek={onWeek}
                            onMarker={onMarker}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="adm-gb-key">
                  <span><i style={{ background: 'var(--adm-cat-1)' }} />arriving</span>
                  <span><i style={{ background: 'var(--adm-cat-2)' }} />coming back</span>
                  <span><i style={{ background: 'var(--adm-cat-other)' }} />new that week</span>
                  <span><i style={{ background: 'var(--adm-cat-3)' }} />making things</span>
                  <span><i className="is-hollow" />this week so far / cohort still filling</span>
                  <span><i className="is-dot" />small, unjoined dot: under 15 people</span>
                  <span><i className="is-hatch" />not measured yet</span>
                </div>
                <div className="sr-only" aria-live="polite">{spoken}</div>
              </div>
            )}
          </AdminAsync>
        </Well>

        <Plate
          span={4}
          className="adm-markers adm-gb-changes"
          title="What changed"
          meta={`${placed.length} marker${placed.length === 1 ? '' : 's'} ${range === RANGES.thirteen ? 'in 13 weeks' : 'since launch'}`}
          foot={offBandNote(offBand) || null}
        >
          <div className="adm-gb-glyphkey" aria-hidden="true">
            <span>{GLYPH.changelog} release notes</span>
            <span>{GLYPH.ship} shipped</span>
            <span>{GLYPH.note} note</span>
            <span>{GLYPH.alert} alert</span>
            <span>{GLYPH.break} definition</span>
          </div>
          <MarkersPanel
            markers={placed}
            onAdd={onAdd}
            onRemove={onRemove}
            busy={busy}
            todayUtc={todayUtc}
            windowFrom={weeks[i0]}
            activeId={active}
            activeFromChart={activeBy === 'chart'}
            onActive={onListMarker}
          />
        </Plate>
      </Deck>
    </>
  );
}
