// AdminOutlinesTab — how clusters are laid out, one week at a time.
//
// Boxes only: the weekly run keeps each cluster's cards as rectangles (kind,
// place, size, section) and nothing that says what is on them or whose they are.
// This tab reads the weeks (admin_layout_weeks), the week's figures for all
// clusters (admin_layout_stats) and the outlines themselves
// (admin_cluster_outlines), and draws them.
//
// Every rule about what shows (the tiles, the heat cells and their colours, the
// pills and the RPC arguments they become, the wireframe's rects) lives in
// lib/outlinesView.js. This file draws it.

import { useEffect, useMemo, useRef, useState } from 'react';
import './adminBoards.css';
import './adminOutlines.css';
import { supabase } from '../../lib/supabase.js';
import { Icon } from '../../components/Icon.jsx';
import { BoundingBox, ChevronLeft, ChevronRight, X } from '../../lib/icons.js';
import {
  weeksView, weekLabel, stepWeek, weekStepState, tilesView, heatTable, HEAT_RAMP, BANDS,
  FILTER_GROUPS, SORTS, KINDS, HAS_KINDS, NO_FILTERS, hasActiveFilters, setFilter, outlineParams, PAGE_SIZE,
  titleLine, ageText, legendView, holdsText, outlineRects, storedRowLines, jsonRuns,
  footText, countText, neighbour,
} from '../../lib/outlinesView.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton, AdminError } from './AdminStates.jsx';

const EMPTY = {
  icon: BoundingBox,
  title: 'No outlines yet',
  body: 'The first weekly run is on Monday. Outlines appear once people say yes and their clusters change.',
};

const errText = (e) => (e && e.message) || (typeof e === 'string' ? e : 'Something went wrong.');

// ── The wireframe ────────────────────────────────────────────────────────

const NS = { vectorEffect: 'non-scaling-stroke' };

function Card({ c }) {
  let body;
  if (c.type === 'grid') {
    body = (
      <>
        <rect className="gr" x={c.x} y={c.y} width={c.w} height={c.h} rx="1.5" {...NS} />
        {c.lines.map((l, i) => <line key={i} className="gl" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} {...NS} />)}
      </>
    );
  } else if (c.type === 'cluster') {
    body = (
      <>
        <rect className="cl" x={c.x} y={c.y} width={c.w} height={c.h} rx="2" {...NS} />
        <rect className="cl2" x={c.inner.x} y={c.inner.y} width={c.inner.w} height={c.inner.h} rx="1" {...NS} />
        {c.squares.map((s, i) => <rect key={i} className="cg" x={s.x} y={s.y} width={s.w} height={s.h} rx="0.8" {...NS} />)}
      </>
    );
  } else {
    body = (
      <>
        <rect className={`c lo-k-${c.kind}`} x={c.x} y={c.y} width={c.w} height={c.h} rx="1.5" {...NS} />
        {c.header && <line className={`hd lo-k-${c.kind}`} x1={c.x} y1={c.y} x2={c.x + c.w} y2={c.y} {...NS} />}
      </>
    );
  }
  return c.rotate ? <g transform={`rotate(${c.rotate.deg} ${c.rotate.cx} ${c.rotate.cy})`}>{body}</g> : <g>{body}</g>;
}

function Wireframe({ outline, label }) {
  const r = useMemo(() => outlineRects(outline), [outline]);
  return (
    <svg
      className="lo-svg"
      viewBox={r.viewBox}
      preserveAspectRatio="xMidYMid meet"
      style={{ aspectRatio: `${r.w}/${r.h}`, ...(r.wide ? { width: '100%' } : { height: '100%' }) }}
      role="img"
      aria-label={label}
    >
      <rect className="fr" x="0" y="0" width={r.w} height={r.h} {...NS} />
      {r.sections.map((s) => (
        <g key={s.i}>
          <rect className="sec" x={s.x} y={s.y} width={s.w} height={s.h} rx="3" {...NS} />
          <text className="tag" x={s.tx} y={s.ty}>{s.i}</text>
        </g>
      ))}
      {r.cards.map((c) => <Card key={c.key} c={c} />)}
    </svg>
  );
}

function Swatch({ id }) {
  const cls = id === 'grid' ? 'lo-sw-grid' : id === 'cluster' ? 'lo-sw-cluster' : id === 'section' ? 'lo-sw-sec' : `lo-k-${id}`;
  return <i className={`lo-sw ${cls}`} aria-hidden="true" />;
}

// ── The tab ──────────────────────────────────────────────────────────────

export function AdminOutlinesTab() {
  const weeksQ = useAdminData(async () => {
    const { data, error } = await supabase.rpc('admin_layout_weeks');
    if (error) throw error;
    return weeksView(data);
  }, []);
  const weeks = weeksQ.data || [];

  const [pickedWeek, setPickedWeek] = useState(null);
  const week = weeks.some((w) => w.week === pickedWeek) ? pickedWeek : (weeks[0] ? weeks[0].week : null);
  const weekRow = weeks.find((w) => w.week === week) || null;
  const hasStats = !!(weekRow && weekRow.stats);

  const statsQ = useAdminData(async () => {
    if (!week || !hasStats) return null;
    const { data, error } = await supabase.rpc('admin_layout_stats', { p_week: week });
    if (error) throw error;
    return data || null;
  }, [week, hasStats]);

  // Only data that came from the current week; the previous week's numbers never sit under a new heading.
  const statsData = statsQ.hasData ? statsQ.data : null;
  const tiles = useMemo(() => tilesView(statsData), [statsData]);
  const heat = useMemo(() => heatTable(statsData), [statsData]);

  // The outlines: one page at a time, "Load more" adds the next.
  const [filters, setFilters] = useState(NO_FILTERS);
  const [list, setList] = useState({ rows: [], total: null, loading: false, loadingMore: false, error: null });
  const epoch = useRef(0);
  const [reload, setReload] = useState(0);
  const filterKey = JSON.stringify(filters);

  const fetchPage = async (offset) => {
    // Never .catch() on the rpc builder: await it and read { error }.
    const { data, error } = await supabase.rpc('admin_cluster_outlines', outlineParams(week, filters, offset, PAGE_SIZE));
    if (error) throw error;
    return { total: Number(data && data.total) || 0, rows: (data && Array.isArray(data.rows)) ? data.rows : [] };
  };

  useEffect(() => {
    if (!week) { setList({ rows: [], total: null, loading: false, loadingMore: false, error: null }); return; }
    const mine = ++epoch.current;
    setList({ rows: [], total: null, loading: true, loadingMore: false, error: null });
    (async () => {
      try {
        const page = await fetchPage(0);
        if (mine !== epoch.current) return;
        setList({ rows: page.rows, total: page.total, loading: false, loadingMore: false, error: null });
      } catch (e) {
        if (mine !== epoch.current) return;
        setList({ rows: [], total: null, loading: false, loadingMore: false, error: errText(e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, filterKey, reload]);

  const loadMore = async () => {
    const mine = epoch.current;
    setList((l) => ({ ...l, loadingMore: true, error: null }));
    try {
      const page = await fetchPage(list.rows.length);
      if (mine !== epoch.current) return;
      setList((l) => {
        const seen = new Set(l.rows.map((r) => r.outline_id));
        return { ...l, rows: [...l.rows, ...page.rows.filter((r) => !seen.has(r.outline_id))], total: page.total, loadingMore: false };
      });
    } catch (e) {
      if (mine !== epoch.current) return;
      setList((l) => ({ ...l, loadingMore: false, error: errText(e) }));
    }
  };

  // The drawer: the selected outline, or the first one when nothing is picked.
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(true);
  const rows = list.rows;
  const current = rows.find((r) => r.outline_id === sel) || rows[0] || null;
  const showDrawer = open && !!current;
  const pick = (id) => { setSel(id); setOpen(true); };

  const filtered = hasActiveFilters(filters);
  const step = weekStepState(weeks, week);
  const prevId = current ? neighbour(rows, current.outline_id, -1) : null;
  const nextId = current ? neighbour(rows, current.outline_id, 1) : null;
  const position = current ? rows.findIndex((r) => r.outline_id === current.outline_id) + 1 : 0;

  return (
    <div className="ab lo-root">
      <div className="ab-top">
        <div>
          <h1 className="ab-h1">Outlines</h1>
          <div className="ab-sub">How clusters are laid out, one week at a time. Boxes only: no card contents, and nothing that says whose cluster it is.</div>
        </div>
      </div>

      <AdminAsync
        loading={weeksQ.loading}
        error={weeksQ.error}
        onRetry={weeksQ.refresh}
        hasData={weeksQ.hasData}
        skeleton={<AdminSkeleton variant="cards" rows={5} />}
        isEmpty={weeks.length === 0}
        empty={EMPTY}
      >
        <div className="admin-toolbar lo-tb">
          <div className="admin-toolbar-left">
            <div className="lo-week" role="group" aria-label="Week">
              <button type="button" className="ab-btn" aria-label="Previous week" disabled={!step.canPrev} onClick={() => setPickedWeek(stepWeek(weeks, week, -1))}>
                <Icon as={ChevronLeft} size={14} />
              </button>
              <span className="lo-week-label">{weekLabel(week)}</span>
              <button type="button" className="ab-btn" aria-label="Next week" disabled={!step.canNext} onClick={() => setPickedWeek(stepWeek(weeks, week, 1))}>
                <Icon as={ChevronRight} size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="admin-detail-section-label lo-grp-label">All clusters this week</div>
        {statsQ.error && !statsQ.hasData ? (
          <AdminError error={errText(statsQ.error)} onRetry={statsQ.refresh} />
        ) : (
          <>
            <div className="admin-stat-grid" aria-busy={statsQ.loading || undefined}>
              {tiles.map((t) => (
                <div key={t.id} className="admin-stat-card" title={t.title}>
                  <div className="admin-stat-label">{t.label}</div>
                  <div className="admin-stat-value">{statsQ.hasData ? t.value : '—'}</div>
                  <div className="admin-stat-sub">{t.sub}</div>
                </div>
              ))}
            </div>

            <section className="lo-sec">
              <h2 className="admin-section-title">Tools, by when</h2>
              <div className="admin-section-sub">Share of people who used each tool, by how old the cluster was at the time. Groups under 20 people are hidden.</div>
              <div className="admin-chart-panel lo-heat-panel">
                <table className="admin-table lo-heat">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      {BANDS.map((b) => <th key={b.id} className="num">{b.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {heat.map((row) => (
                      <tr key={row.id}>
                        <td>{row.label}</td>
                        {row.cells.map((c) => (
                          <td key={c.band}>
                            {c.na
                              ? <span className="lo-hc lo-hc-na" title={c.title}>{c.text}</span>
                              : <span className="lo-hc" style={{ '--a': `${c.alpha}%` }}>{c.text}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="lo-heat-foot">
                  <span className="lo-ramp" aria-hidden="true">
                    {HEAT_RAMP.map((a) => <i key={a} style={{ background: `color-mix(in srgb,var(--ink-0) ${a}%,transparent)` }} />)}
                  </span>
                  <span>0% to 100% of people</span>
                </div>
              </div>
            </section>
          </>
        )}

        <section className="lo-sec lo-grp-b" aria-labelledby="lo-grp-b-title">
          <div className="lo-gal-head">
            <div>
              <h2 className="admin-section-title" id="lo-grp-b-title">Outlines</h2>
              <div className="admin-section-sub">Clusters of people who said yes, that changed this week. Each tile is one cluster; pick one to see exactly what is stored for it.</div>
            </div>
            <span className="lo-count"><span>{list.loading ? '—' : <b>{countText(list.total)}</b>}</span></span>
          </div>

          <div className="lo-filters">
            <div className="lo-frow">
              {FILTER_GROUPS.slice(0, 3).map((g) => (
                <div key={g.id} className="lo-fg">
                  <span className="lo-fl">{g.label}</span>
                  <div className="ab-chips" role="group" aria-label={g.label}>
                    {g.pills.map((p) => {
                      const on = filters[g.id] === p.v;
                      return (
                        <button key={String(p.v)} type="button" className={`ab-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setFilters((f) => setFilter(f, g.id, p.v))}>{p.label}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="lo-sortbox">
                <span className="lo-fl">Sort</span>
                <div className="ab-seg" role="group" aria-label="Sort">
                  {SORTS.map((s) => (
                    <button key={s.v} type="button" className={filters.sort === s.v ? 'is-on' : ''} aria-pressed={filters.sort === s.v} onClick={() => setFilters((f) => ({ ...f, sort: s.v }))}>{s.label}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="lo-frow">
              {FILTER_GROUPS.slice(3).map((g) => (
                <div key={g.id} className="lo-fg">
                  <span className="lo-fl">{g.label}</span>
                  <div className="ab-chips" role="group" aria-label={g.label}>
                    {g.pills.map((p) => {
                      const on = filters[g.id] === p.v;
                      return (
                        <button key={String(p.v)} type="button" className={`ab-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setFilters((f) => setFilter(f, g.id, p.v))}>{p.label}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="lo-has" role="group" aria-label="Has">
                <span className="lo-fl">Has</span>
                {HAS_KINDS.map((k) => {
                  const on = filters.has.includes(k.id);
                  return (
                    <button key={k.id} type="button" className={`ab-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setFilters((f) => setFilter(f, 'has', k.id))}>
                      <Swatch id={k.id} />{k.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={`lo-split${showDrawer ? '' : ' is-closed'}`}>
            <div className="lo-gal">
              {list.error && rows.length === 0 ? (
                <AdminError error={list.error} onRetry={() => setReload((n) => n + 1)} />
              ) : (
                <div className="ab-grid lo-grid" aria-busy={list.loading || undefined}>
                  {list.loading && rows.length === 0 && <div className="ab-empty lo-empty"><span>Loading outlines…</span></div>}
                  {!list.loading && rows.length === 0 && (
                    <div className="ab-empty lo-empty">
                      <b>{filtered ? 'No outlines match' : 'No outlines this week'}</b>
                      <span>{filtered ? 'None of this week’s outlines fit those filters.' : 'Nobody who said yes changed a cluster this week.'}</span>
                      {filtered && <button type="button" className="ab-btn" onClick={() => setFilters((f) => ({ ...NO_FILTERS, sort: f.sort }))}>Clear filters</button>}
                    </div>
                  )}
                  {rows.map((o) => {
                    const t = titleLine(o);
                    return (
                      <article key={o.outline_id} className={`ab-tile${current && o.outline_id === current.outline_id && showDrawer ? ' is-sel' : ''}`}>
                        <button type="button" className="ab-tile-main" aria-label={t} onClick={() => pick(o.outline_id)}>
                          <span className="ab-thumb lo-thumb"><Wireframe outline={o} label={`Outline: ${t}`} /></span>
                          <span className="ab-tmeta"><span className="ab-t lo-t">{t}</span><span className="ab-m">{ageText(o.stats && o.stats.age)}</span></span>
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="lo-foot">
                {footText(rows.length, list.total, filtered)}
                {list.error && rows.length > 0 && <span> · Couldn’t load more. </span>}
              </div>
              {rows.length > 0 && list.total != null && rows.length < list.total && (
                <button type="button" className="ab-btn" style={{ marginTop: 12 }} disabled={list.loadingMore} onClick={loadMore}>
                  {list.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>

            <aside className="lo-drawer-wrap" aria-label="Outline detail" hidden={!showDrawer}>
              {showDrawer && (
                <div className="lo-drawer">
                  <div className="admin-detail-header">
                    <div className="lo-d-top">
                      <div className="admin-detail-idtext">
                        <h3 className="admin-detail-name">{`Outline ${position} of ${rows.length}`}</h3>
                        <div className="lo-d-meta">{`${titleLine(current)} · ${weekLabel(current.week || week).toLowerCase()}`}</div>
                      </div>
                      <button type="button" className="admin-detail-close" aria-label="Close" onClick={() => setOpen(false)}><Icon as={X} size={16} /></button>
                    </div>
                    <div className="lo-d-nav">
                      <button type="button" className="ab-btn ab-sm" disabled={!prevId} onClick={() => prevId && pick(prevId)}><Icon as={ChevronLeft} size={13} /><span>Previous</span></button>
                      <button type="button" id="lo-d-next" className="ab-btn ab-sm" disabled={!nextId} onClick={() => nextId && pick(nextId)}><span>Next</span><Icon as={ChevronRight} size={13} /></button>
                    </div>
                  </div>
                  <div className="admin-detail-body">
                    <div className="admin-detail-section">
                      <div className="lo-big"><Wireframe outline={current} label={`Outline: ${titleLine(current)}`} /></div>
                      <ul className="lo-legend">
                        {legendView(current).map((l) => (
                          <li key={l.id}><Swatch id={l.id} /><span>{l.label}</span><em>{l.n}</em></li>
                        ))}
                      </ul>
                    </div>
                    <div className="admin-detail-section">
                      <div className="admin-detail-section-label">What this outline holds</div>
                      <p className="lo-p">{holdsText({ ...current, week: current.week || week })}</p>
                    </div>
                    <div className="admin-detail-section">
                      <div className="admin-detail-section-label">Not kept</div>
                      <p className="lo-p">What’s in any card, names, colours, file sizes, who made it, which workspace, exact times.</p>
                    </div>
                    <div className="admin-detail-section">
                      <details className="lo-disc" open>
                        <summary>Stored row</summary>
                        <pre className="lo-json" tabIndex={0}>
                          {storedRowLines({ ...current, week: current.week || week }).map((line, i) => (
                            <span key={i}>
                              {jsonRuns(line).map((r, j) => (r.t === 'p' ? r.s : <span key={j} className={r.t === 'k' ? 'jk' : 'jv'}>{r.s}</span>))}
                              {'\n'}
                            </span>
                          ))}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>
      </AdminAsync>
    </div>
  );
}
