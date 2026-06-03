// AdminTaggingTab — audit + tune the embeddings-only tagger.
//
// Single-screen workflow:
//   1. Overview table: every tag in every workspace the admin can see,
//      with member count, mean/p95 distance to members, count of
//      non-members in the AUTO and SUGGEST bands, count of ground-truth
//      labels.
//   2. Per-tag drill-down (click a row): distance histogram colored by
//      applied/not-applied, two "suspect" tables (members applied at
//      high distance; non-members at low distance), inline buttons to
//      mark each row as ground truth (should_apply / should_not_apply).
//   3. Eval panel: precision/recall/F1/confusion matrix against the
//      ground-truth labels, plus a what-if slider for AUTO_DIST so the
//      operator can see how metrics shift without persisting anything.
//
// All data fetched in parallel via useAdminData. Distance math runs
// client-side (324 embeddings × 3 tags ≈ 1k cosine distances — trivial).
// RLS scopes what the admin sees to the workspaces they're a member of;
// the project owner is in every workspace, so in practice this shows the
// whole graph.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { cosineDist, SILENT_APPLY_DIST, NO_MATCH_DIST, SUGGEST_DIST } from '../../lib/clusterMath.js';
import { parsePgvector } from '../../lib/tagsClient.js';
import { runEval, buildHistogram, summarize } from '../../lib/tagEval.js';
import { AdminAsync, AdminSkeleton, AdminToolbar } from './AdminStates.jsx';
import { useAdminData } from './useAdminData.js';
import { formatCount, formatPct, MIN_RATE_FLAG } from '../../lib/adminFormat.js';
import { AdminStatCard } from './AdminStatCard.jsx';
import { NFlag, ChartGate } from './SmallN.jsx';
import { Tag } from '../../lib/icons.js';

export function AdminTaggingTab() {
  const [selectedTagId, setSelectedTagId] = useState(null);
  // What-if AUTO_DIST. Default to the production constant; user can
  // drag without affecting the live system.
  const [whatIfAuto, setWhatIfAuto]       = useState(SILENT_APPLY_DIST);
  const [whatIfSuggest, setWhatIfSuggest] = useState(SUGGEST_DIST);
  // Optimistic local copy of the ground-truth labels, seeded from the fetch.
  const [labelEdits, setLabelEdits] = useState(null);

  // ── Load everything in parallel. ───────────────────────────────────
  const q = useAdminData(async () => {
    const [t, w, c, e, l, ci, el] = await Promise.all([
      supabase.from('tags').select('id, name, slug, color, description, workspace_id'),
      supabase.from('workspaces').select('id, name'),
      supabase.from('tag_centroids').select('tag_id, centroid'),
      supabase.from('card_embeddings').select('card_id, workspace_id, board_id, embedding'),
      supabase.from('entity_links')
        .select('target_id, source_kind, source_id')
        .eq('target_kind', 'tag').eq('link_kind', 'applied'),
      supabase.from('card_index').select('card_id, board_id, kind, title, body'),
      supabase.from('tag_eval_labels').select('tag_id, source_kind, source_id, label, workspace_id, created_at'),
    ]);
    if (t.error)  throw t.error;
    if (w.error)  throw w.error;
    if (c.error)  throw c.error;
    if (e.error)  throw e.error;
    if (l.error)  throw l.error;
    if (ci.error) throw ci.error;
    if (el.error) throw el.error;

    const tags = t.data || [];

    const workspaces = new Map();
    for (const r of (w.data || [])) workspaces.set(r.id, r);

    const centroids = new Map();
    for (const r of (c.data || [])) {
      const v = parsePgvector(r.centroid);
      if (v) centroids.set(r.tag_id, v);
    }

    const embeddings = [];
    for (const r of (e.data || [])) {
      const v = parsePgvector(r.embedding);
      if (v) embeddings.push({ card_id: r.card_id, workspace_id: r.workspace_id, board_id: r.board_id, vector: v });
    }

    const appliedSet = new Set();
    for (const r of (l.data || [])) {
      if (r.source_kind === 'card') appliedSet.add(`${r.target_id}::card::${r.source_id}`);
    }

    const cardIndex = new Map();
    for (const r of (ci.data || [])) cardIndex.set(r.card_id, r);

    const labels = el.data || [];

    return { tags, workspaces, centroids, embeddings, appliedSet, cardIndex, labels };
  }, []);

  // Labels: server-fetched baseline, overlaid by optimistic local edits so a
  // ground-truth mutation reflects instantly without a full refetch.
  const labels = labelEdits ?? (q.data?.labels || []);
  const tags        = q.data?.tags        || [];
  const workspaces  = q.data?.workspaces  || EMPTY_MAP;
  const centroids   = q.data?.centroids   || EMPTY_MAP;
  const embeddings  = q.data?.embeddings  || EMPTY_ARR;
  const appliedSet  = q.data?.appliedSet  || EMPTY_SET;
  const cardIndex   = q.data?.cardIndex   || EMPTY_MAP;

  // Re-baseline optimistic label edits whenever a fetch completes (initial load
  // or a manual refresh) so the server stays authoritative; edits made between
  // fetches still apply instantly via the overlay above.
  useEffect(() => { setLabelEdits(null); }, [q.data]);

  // ── Per-tag computed stats for the overview + drill-down. ──────────
  const tagStats = useMemo(() => {
    if (!tags.length) return [];
    return tags.map((tag) => {
      const centroid = centroids.get(tag.id);
      if (!centroid) {
        return { tag, centroidMissing: true, rows: [], summary: { count: 0 } };
      }
      // Score every card in the SAME workspace as the tag.
      const rows = [];
      for (const e of embeddings) {
        if (e.workspace_id !== tag.workspace_id) continue;
        const distance = cosineDist(e.vector, centroid);
        const isApplied = appliedSet.has(`${tag.id}::card::${e.card_id}`);
        rows.push({ card_id: e.card_id, board_id: e.board_id, distance, applied: isApplied });
      }
      const memberDistances = rows.filter(r => r.applied).map(r => r.distance);
      const summary = summarize(memberDistances);
      const withinAuto    = rows.filter(r => !r.applied && r.distance < SILENT_APPLY_DIST).length;
      const withinSuggest = rows.filter(r => !r.applied && r.distance < SUGGEST_DIST).length;
      const labelCount    = labels.filter(l => l.tag_id === tag.id).length;
      return {
        tag,
        centroidMissing: false,
        rows,
        summary,
        memberCount: memberDistances.length,
        withinAuto,
        withinSuggest,
        labelCount,
      };
    });
  }, [tags, centroids, embeddings, appliedSet, labels]);

  // ── Hero at-a-glance counts, derived from data already computed. ───
  const hero = useMemo(() => {
    const tagCount = tagStats.length;
    const missingCentroid = tagStats.filter(s => s.centroidMissing).length;
    const labeled = tagStats.reduce((acc, s) => acc + (s.labelCount || 0), 0);
    return { tagCount, missingCentroid, labeled };
  }, [tagStats]);

  const selectedStats = useMemo(() => {
    if (!selectedTagId) return null;
    return tagStats.find(s => s.tag.id === selectedTagId) || null;
  }, [tagStats, selectedTagId]);

  const histogram = useMemo(() => {
    if (!selectedStats) return [];
    return buildHistogram(selectedStats.rows, { bins: 10, max: NO_MATCH_DIST });
  }, [selectedStats]);

  // Eval result against ground truth at the *current* (what-if) thresholds.
  const evalResult = useMemo(() => {
    if (!selectedStats) return null;
    const tagLabels = labels.filter(l => l.tag_id === selectedTagId);
    if (!tagLabels.length) return null;
    const scoredPairs = selectedStats.rows.map(r => ({
      tag_id: selectedTagId,
      source_kind: 'card',
      source_id: r.card_id,
      distance: r.distance,
    }));
    return runEval({ labels: tagLabels, scoredPairs, autoDist: whatIfAuto, suggestDist: whatIfSuggest });
  }, [selectedStats, labels, selectedTagId, whatIfAuto, whatIfSuggest]);

  // ── Label mutator. Upserts a row to tag_eval_labels. ───────────────
  const setLabel = async (tagId, cardId, workspaceId, label) => {
    const { error: err } = await supabase
      .from('tag_eval_labels')
      .upsert({
        tag_id: tagId,
        source_kind: 'card',
        source_id: cardId,
        workspace_id: workspaceId,
        label,
      }, { onConflict: 'tag_id,source_kind,source_id' });
    if (err) {
      console.warn('[admin-tagging] label upsert failed', err.message);
      return;
    }
    // Optimistic local update — base off the latest edits (or the server
    // baseline on the first edit), never a stale closure copy of `labels`.
    setLabelEdits((prev) => {
      const base = prev ?? (q.data?.labels || []);
      const next = base.filter(l => !(l.tag_id === tagId && l.source_kind === 'card' && l.source_id === cardId));
      next.push({ tag_id: tagId, source_kind: 'card', source_id: cardId, workspace_id: workspaceId, label });
      return next;
    });
  };

  const clearLabel = async (tagId, cardId) => {
    const { error: err } = await supabase
      .from('tag_eval_labels')
      .delete()
      .eq('tag_id', tagId)
      .eq('source_kind', 'card')
      .eq('source_id', cardId);
    if (err) {
      console.warn('[admin-tagging] label delete failed', err.message);
      return;
    }
    setLabelEdits((prev) => (prev ?? (q.data?.labels || [])).filter(l => !(l.tag_id === tagId && l.source_kind === 'card' && l.source_id === cardId)));
  };

  const labelByKey = useMemo(() => {
    const m = new Map();
    for (const l of labels) m.set(`${l.tag_id}::${l.source_kind}::${l.source_id}`, l.label);
    return m;
  }, [labels]);

  const selectedLabelCount = selectedTagId
    ? labels.filter(l => l.tag_id === selectedTagId).length
    : 0;

  return (
    <div className="admin-tagging">
      <AdminToolbar onRefresh={q.refresh} refreshing={q.refreshing} lastUpdated={q.lastUpdated} />

      <AdminAsync
        loading={q.loading}
        error={q.error}
        onRetry={q.refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={3} /><div style={{ height: 16 }} /><AdminSkeleton variant="table" rows={6} cols={8} /></>}
        isEmpty={tagStats.length === 0}
        empty={{
          icon: Tag,
          title: 'No tags yet',
          body: 'Once tags exist in a workspace you can see, this panel audits how the embeddings tagger scores cards against each one.',
        }}
      >
        <div className={q.refreshing ? 'is-refreshing' : ''}>
          <h2 className="admin-section-title">Tagging quality</h2>
          <div className="admin-section-sub">
            Live thresholds: AUTO &lt; {SILENT_APPLY_DIST.toFixed(2)} · SUGGEST &lt; {SUGGEST_DIST.toFixed(2)}. Distances are cosine — lower is closer.
          </div>

          <div className="admin-stat-grid">
            <AdminStatCard label="Tags" value={formatCount(hero.tagCount)} sub="across visible workspaces" />
            <AdminStatCard label="Without centroid" value={formatCount(hero.missingCentroid)} sub="awaiting next score" />
            <AdminStatCard label="Ground-truth labels" value={formatCount(hero.labeled)} sub="across all tags" />
          </div>

          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Per-tag overview</h3>
              <span className="admin-chart-sub t-meta">Click a tag to drill down</span>
            </header>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Tag</th>
                  <th>Workspace</th>
                  <th className="num">Members</th>
                  <th className="num">Mean d</th>
                  <th className="num">p95 d</th>
                  <th className="num" title="Non-members within AUTO_DIST">&lt; AUTO</th>
                  <th className="num" title="Non-members within SUGGEST_DIST">&lt; SUGGEST</th>
                  <th className="num">Labels</th>
                </tr>
              </thead>
              <tbody>
                {tagStats.map(s => {
                  const ws = workspaces.get(s.tag.workspace_id);
                  const isSel = s.tag.id === selectedTagId;
                  return (
                    <tr key={s.tag.id}
                        className={`admin-tagging-row ${isSel ? 'is-selected' : ''} ${s.centroidMissing ? 'is-missing' : ''}`}
                        onClick={() => setSelectedTagId(s.tag.id)}>
                      <td>
                        <span className="admin-tagging-tag-dot" style={{ background: s.tag.color || '#888' }} />
                        {s.tag.name}
                      </td>
                      <td className="dim">{ws?.name || s.tag.workspace_id.slice(0, 8)}</td>
                      <td className="num">{formatCount(s.memberCount ?? 0)}</td>
                      <td className="num">{fmtDist(s.summary?.mean)}</td>
                      <td className="num">{fmtDist(s.summary?.p95)}</td>
                      <td className="num">{formatCount(s.withinAuto ?? 0)}</td>
                      <td className="num">{formatCount(s.withinSuggest ?? 0)}</td>
                      <td className="num">{formatCount(s.labelCount ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <h2 className="admin-section-title">Drill-down</h2>

          {!selectedStats && (
            <div className="admin-section-sub">Select a tag above to inspect its distance distribution, suspect cards, and eval metrics.</div>
          )}

          {selectedStats && selectedStats.centroidMissing && (
            <div className="admin-section-sub">
              This tag has no stored centroid yet. It will be seeded on the next suggestTags call.
            </div>
          )}

          {selectedStats && !selectedStats.centroidMissing && (
            <>
              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">{selectedStats.tag.name} — distance distribution</h3>
                  <span className="admin-chart-sub t-meta">{formatCount(selectedStats.memberCount ?? 0)} members</span>
                </header>
                {selectedStats.tag.description && (
                  <p className="admin-tagging-desc">{selectedStats.tag.description}</p>
                )}
                <div className="admin-chart-body">
                  <ChartGate
                    count={selectedStats.memberCount ?? 0}
                    min={5}
                    title="Not enough cards to chart"
                    sub="This tag needs at least 5 scored cards before a distance histogram is meaningful."
                  >
                    <Histogram histogram={histogram} max={NO_MATCH_DIST}
                               autoMark={whatIfAuto} suggestMark={whatIfSuggest} />
                  </ChartGate>
                </div>
              </section>

              <div className="admin-tagging-suspects">
                <SuspectList
                  title={`Members applied at high distance (> ${SILENT_APPLY_DIST.toFixed(2)})`}
                  hint="Old auto-applies that wouldn't auto-apply under tighter thresholds. Possible historical false positives — label them as ground truth to verify."
                  rows={selectedStats.rows
                    .filter(r => r.applied && r.distance > SILENT_APPLY_DIST)
                    .sort((a, b) => b.distance - a.distance)
                    .slice(0, 30)}
                  tag={selectedStats.tag}
                  cardIndex={cardIndex}
                  labelByKey={labelByKey}
                  setLabel={setLabel}
                  clearLabel={clearLabel}
                />
                <SuspectList
                  title={`Non-members at low distance (< ${SUGGEST_DIST.toFixed(2)})`}
                  hint="Cards the system would surface as suggestions on the next score. Closest-first."
                  rows={selectedStats.rows
                    .filter(r => !r.applied && r.distance < SUGGEST_DIST)
                    .sort((a, b) => a.distance - b.distance)
                    .slice(0, 30)}
                  tag={selectedStats.tag}
                  cardIndex={cardIndex}
                  labelByKey={labelByKey}
                  setLabel={setLabel}
                  clearLabel={clearLabel}
                />
              </div>

              <section className="admin-chart-panel admin-chart-panel-wide">
                <header className="admin-chart-head">
                  <h3 className="admin-chart-title">Eval against ground truth</h3>
                  <span className="admin-chart-sub t-meta">What-if thresholds — not persisted</span>
                </header>
                {selectedLabelCount === 0 ? (
                  <p className="dim">Label at least one row above to start measuring.</p>
                ) : (
                  <>
                    <div className="admin-tagging-eval-controls">
                      <label>
                        AUTO_DIST: <strong>{whatIfAuto.toFixed(3)}</strong>
                        <input type="range" min="0.05" max="0.40" step="0.005"
                               value={whatIfAuto}
                               onChange={(e) => setWhatIfAuto(parseFloat(e.target.value))} />
                      </label>
                      <label>
                        SUGGEST_DIST: <strong>{whatIfSuggest.toFixed(3)}</strong>
                        <input type="range" min="0.05" max="0.55" step="0.005"
                               value={whatIfSuggest}
                               onChange={(e) => setWhatIfSuggest(parseFloat(e.target.value))} />
                      </label>
                      <button className="admin-action"
                              onClick={() => { setWhatIfAuto(SILENT_APPLY_DIST); setWhatIfSuggest(SUGGEST_DIST); }}>
                        Reset to live thresholds
                      </button>
                    </div>
                    {evalResult && <EvalReadout result={evalResult} labelCount={selectedLabelCount} />}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </AdminAsync>
    </div>
  );
}

const EMPTY_MAP = new Map();
const EMPTY_SET = new Set();
const EMPTY_ARR = [];

function Histogram({ histogram, max, autoMark, suggestMark }) {
  const peak = Math.max(1, ...histogram.map(b => b.applied + b.notApplied));
  return (
    <div className="admin-tagging-histogram">
      <div className="admin-tagging-histogram-bars">
        {histogram.map((b, i) => {
          const total = b.applied + b.notApplied;
          const heightPct = (total / peak) * 100;
          const appliedPct = total === 0 ? 0 : (b.applied / total) * 100;
          return (
            <div key={i} className="admin-tagging-histogram-col"
                 title={`d ∈ [${b.from.toFixed(2)}, ${b.to.toFixed(2)}): ${b.applied} applied, ${b.notApplied} not`}>
              <div className="admin-tagging-histogram-bar" style={{ height: `${heightPct}%` }}>
                <div className="admin-tagging-histogram-applied" style={{ height: `${appliedPct}%` }} />
              </div>
              <div className="admin-tagging-histogram-label">{b.from.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
      <div className="admin-tagging-histogram-marks">
        <span style={{ left: `${(autoMark / max) * 100}%` }}    className="mark mark-auto">AUTO</span>
        <span style={{ left: `${(suggestMark / max) * 100}%` }} className="mark mark-suggest">SUGGEST</span>
      </div>
      <div className="admin-tagging-histogram-legend">
        <span className="lg lg-applied" /> applied
        <span className="lg lg-not" /> not applied
      </div>
    </div>
  );
}

function SuspectList({ title, hint, rows, tag, cardIndex, labelByKey, setLabel, clearLabel }) {
  return (
    <section className="admin-chart-panel admin-tagging-suspect-block">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">{title}</h3>
        <span className="admin-chart-sub t-meta">{formatCount(rows.length)} cards</span>
      </header>
      {hint && <p className="admin-tagging-suspect-hint">{hint}</p>}
      {rows.length === 0 ? (
        <p className="dim">None.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th className="num">d</th>
              <th>Card</th>
              <th>Ground truth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const card = cardIndex.get(r.card_id);
              const cardTitle = (card?.title || '').trim()
                || (card?.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
                || `card ${r.card_id.slice(0, 8)}`;
              const labelKey = `${tag.id}::card::${r.card_id}`;
              const currentLabel = labelByKey.get(labelKey);
              return (
                <tr key={r.card_id}>
                  <td className="num"><span className="admin-tagging-suspect-dist">{r.distance.toFixed(3)}</span></td>
                  <td>
                    <span className="admin-tagging-suspect-title">{cardTitle}</span>
                    {currentLabel && (
                      <span className={`admin-tagging-label-chip is-${currentLabel}`}>
                        {currentLabel === 'should_apply' ? 'apply ✓' : 'no ✗'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="admin-tagging-suspect-actions">
                      <button
                        className={`admin-action ${currentLabel === 'should_apply' ? 'is-on' : ''}`}
                        onClick={() => setLabel(tag.id, r.card_id, tag.workspace_id, 'should_apply')}>
                        Should apply
                      </button>
                      <button
                        className={`admin-action ${currentLabel === 'should_not_apply' ? 'is-on' : ''}`}
                        onClick={() => setLabel(tag.id, r.card_id, tag.workspace_id, 'should_not_apply')}>
                        Should NOT
                      </button>
                      {currentLabel && (
                        <button className="admin-action dim" onClick={() => clearLabel(tag.id, r.card_id)}>clear</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EvalReadout({ result, labelCount }) {
  const { confusion, precision, recall, f1, disagreements, matchedCount, unmatchedCount } = result;
  const smallSample = labelCount < MIN_RATE_FLAG;
  return (
    <div className="admin-tagging-eval-readout">
      <div className="admin-stat-grid">
        <AdminStatCard
          label="Precision"
          value={precision == null ? '—' : formatPct(precision)}
          sub={smallSample ? <NFlag n={labelCount} /> : 'predicted apply that were right'}
        />
        <AdminStatCard
          label="Recall"
          value={recall == null ? '—' : formatPct(recall)}
          sub={smallSample ? <NFlag n={labelCount} /> : 'true applies that were caught'}
        />
        <AdminStatCard
          label="F1"
          value={f1 == null ? '—' : formatPct(f1)}
          sub="harmonic mean"
        />
        <AdminStatCard
          label="Labeled (N)"
          value={formatCount(matchedCount)}
          sub={unmatchedCount > 0 ? `+${formatCount(unmatchedCount)} unmatched` : 'ground-truth rows'}
        />
      </div>
      <table className="admin-tagging-confusion">
        <thead>
          <tr><th></th><th>Predicted apply</th><th>Predicted NOT</th></tr>
        </thead>
        <tbody>
          <tr><th>Truth: apply</th><td className="tp">{confusion.tp}</td><td className="fn">{confusion.fn}</td></tr>
          <tr><th>Truth: NOT</th><td className="fp">{confusion.fp}</td><td className="tn">{confusion.tn}</td></tr>
        </tbody>
      </table>
      {disagreements.length > 0 && (
        <details className="admin-tagging-disagreements">
          <summary>{disagreements.length} disagreement{disagreements.length === 1 ? '' : 's'}</summary>
          <ul>
            {disagreements.map((d, i) => (
              <li key={i}>
                <span className="admin-tagging-suspect-dist">{d.distance.toFixed(3)}</span>
                <span>{d.source_id.slice(0, 12)}</span>
                <span className="dim">label: {d.label} → predicted: {d.predicted}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// Cosine distances have no adminFormat helper (they're a unit-less [0,1]
// math quantity, not a count/rate/money), so keep the 3-decimal fixed format.
function fmtDist(n) { return n == null ? '—' : n.toFixed(3); }
