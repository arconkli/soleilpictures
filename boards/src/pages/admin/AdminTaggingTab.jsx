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
// All data fetched in parallel on mount. Distance math runs client-side
// (324 embeddings × 3 tags ≈ 1k cosine distances — trivial). RLS scopes
// what the admin sees to the workspaces they're a member of; the
// project owner is in every workspace, so in practice this shows the
// whole graph.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { cosineDist, SILENT_APPLY_DIST, NO_MATCH_DIST, SUGGEST_DIST } from '../../lib/clusterMath.js';
import { parsePgvector } from '../../lib/tagsClient.js';
import { runEval, buildHistogram, summarize } from '../../lib/tagEval.js';

export function AdminTaggingTab() {
  const [tags, setTags]               = useState([]);          // [{ id, name, slug, color, description, workspace_id }]
  const [workspaces, setWorkspaces]   = useState(new Map());   // id -> { id, name }
  const [centroids, setCentroids]     = useState(new Map());   // tag_id -> vector
  const [embeddings, setEmbeddings]   = useState([]);          // [{ card_id, workspace_id, board_id, vector }]
  const [appliedSet, setAppliedSet]   = useState(new Set());   // `${tag_id}::card::${card_id}`
  const [cardIndex, setCardIndex]     = useState(new Map());   // card_id -> { title, body, kind, board_id }
  const [labels, setLabels]           = useState([]);          // [{ tag_id, source_kind, source_id, label }]
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const [selectedTagId, setSelectedTagId] = useState(null);
  // What-if AUTO_DIST. Default to the production constant; user can
  // drag without affecting the live system.
  const [whatIfAuto, setWhatIfAuto]   = useState(SILENT_APPLY_DIST);
  const [whatIfSuggest, setWhatIfSuggest] = useState(SUGGEST_DIST);

  // ── Load everything in parallel. ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from('tags').select('id, name, slug, color, description, workspace_id'),
      supabase.from('workspaces').select('id, name'),
      supabase.from('tag_centroids').select('tag_id, centroid'),
      supabase.from('card_embeddings').select('card_id, workspace_id, board_id, embedding'),
      supabase.from('entity_links')
        .select('target_id, source_kind, source_id')
        .eq('target_kind', 'tag').eq('link_kind', 'applied'),
      supabase.from('card_index').select('card_id, board_id, kind, title, body'),
      supabase.from('tag_eval_labels').select('tag_id, source_kind, source_id, label, workspace_id, created_at'),
    ])
      .then(([t, w, c, e, l, ci, el]) => {
        if (cancelled) return;
        if (t.error)  throw t.error;
        if (w.error)  throw w.error;
        if (c.error)  throw c.error;
        if (e.error)  throw e.error;
        if (l.error)  throw l.error;
        if (ci.error) throw ci.error;
        if (el.error) throw el.error;
        setTags(t.data || []);
        const wsMap = new Map();
        for (const r of (w.data || [])) wsMap.set(r.id, r);
        setWorkspaces(wsMap);
        const cMap = new Map();
        for (const r of (c.data || [])) {
          const v = parsePgvector(r.centroid);
          if (v) cMap.set(r.tag_id, v);
        }
        setCentroids(cMap);
        const eRows = [];
        for (const r of (e.data || [])) {
          const v = parsePgvector(r.embedding);
          if (v) eRows.push({ card_id: r.card_id, workspace_id: r.workspace_id, board_id: r.board_id, vector: v });
        }
        setEmbeddings(eRows);
        const appSet = new Set();
        for (const r of (l.data || [])) {
          if (r.source_kind === 'card') appSet.add(`${r.target_id}::card::${r.source_id}`);
        }
        setAppliedSet(appSet);
        const idx = new Map();
        for (const r of (ci.data || [])) idx.set(r.card_id, r);
        setCardIndex(idx);
        setLabels(el.data || []);
      })
      .catch((err) => { if (!cancelled) setError(err?.message || String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
    // Optimistic local update.
    setLabels(prev => {
      const next = prev.filter(l => !(l.tag_id === tagId && l.source_kind === 'card' && l.source_id === cardId));
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
    setLabels(prev => prev.filter(l => !(l.tag_id === tagId && l.source_kind === 'card' && l.source_id === cardId)));
  };

  const labelByKey = useMemo(() => {
    const m = new Map();
    for (const l of labels) m.set(`${l.tag_id}::${l.source_kind}::${l.source_id}`, l.label);
    return m;
  }, [labels]);

  if (loading) return <div className="admin-tagging"><p>Loading…</p></div>;
  if (error)   return <div className="admin-tagging"><p style={{ color: '#ef4444' }}>{error}</p></div>;

  return (
    <div className="admin-tagging">
      <div className="admin-tagging-head">
        <h2>Tagging quality</h2>
        <span className="admin-tagging-thresholds">
          Live thresholds: AUTO &lt; {SILENT_APPLY_DIST.toFixed(2)} · SUGGEST &lt; {SUGGEST_DIST.toFixed(2)}
        </span>
      </div>

      <div className="admin-tagging-overview">
        <table className="admin-tagging-table">
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
                  <td className="num">{s.memberCount ?? 0}</td>
                  <td className="num">{fmt(s.summary?.mean)}</td>
                  <td className="num">{fmt(s.summary?.p95)}</td>
                  <td className="num">{s.withinAuto ?? 0}</td>
                  <td className="num">{s.withinSuggest ?? 0}</td>
                  <td className="num">{s.labelCount ?? 0}</td>
                </tr>
              );
            })}
            {tagStats.length === 0 && (
              <tr><td colSpan={8} className="dim">No tags yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedStats && !selectedStats.centroidMissing && (
        <div className="admin-tagging-drill">
          <div className="admin-tagging-drill-head">
            <h3>{selectedStats.tag.name}</h3>
            {selectedStats.tag.description && (
              <p className="admin-tagging-desc">{selectedStats.tag.description}</p>
            )}
          </div>

          <Histogram histogram={histogram} max={NO_MATCH_DIST}
                     autoMark={whatIfAuto} suggestMark={whatIfSuggest} />

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

          <div className="admin-tagging-eval">
            <h4>Eval against ground truth</h4>
            {labels.filter(l => l.tag_id === selectedTagId).length === 0 ? (
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
                  <button className="admin-tagging-eval-reset"
                          onClick={() => { setWhatIfAuto(SILENT_APPLY_DIST); setWhatIfSuggest(SUGGEST_DIST); }}>
                    Reset to live thresholds
                  </button>
                </div>
                {evalResult && <EvalReadout result={evalResult} />}
              </>
            )}
          </div>
        </div>
      )}

      {selectedStats?.centroidMissing && (
        <div className="admin-tagging-drill">
          <p className="dim">This tag has no stored centroid yet. It will be seeded on the next suggestTags call.</p>
        </div>
      )}
    </div>
  );
}

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
    <div className="admin-tagging-suspect-block">
      <h5>{title} <span className="dim">({rows.length})</span></h5>
      {hint && <p className="admin-tagging-suspect-hint">{hint}</p>}
      {rows.length === 0 ? (
        <p className="dim">None.</p>
      ) : (
        <ul className="admin-tagging-suspect-list">
          {rows.map(r => {
            const card = cardIndex.get(r.card_id);
            const title = (card?.title || '').trim()
              || (card?.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
              || `card ${r.card_id.slice(0, 8)}`;
            const labelKey = `${tag.id}::card::${r.card_id}`;
            const currentLabel = labelByKey.get(labelKey);
            return (
              <li key={r.card_id} className="admin-tagging-suspect-row">
                <span className="admin-tagging-suspect-dist">{r.distance.toFixed(3)}</span>
                <span className="admin-tagging-suspect-title">{title}</span>
                {currentLabel && (
                  <span className={`admin-tagging-label-chip is-${currentLabel}`}>
                    {currentLabel === 'should_apply' ? 'apply ✓' : 'no ✗'}
                  </span>
                )}
                <span className="admin-tagging-suspect-actions">
                  <button onClick={() => setLabel(tag.id, r.card_id, tag.workspace_id, 'should_apply')}
                          className={currentLabel === 'should_apply' ? 'is-on' : ''}>
                    Should apply
                  </button>
                  <button onClick={() => setLabel(tag.id, r.card_id, tag.workspace_id, 'should_not_apply')}
                          className={currentLabel === 'should_not_apply' ? 'is-on' : ''}>
                    Should NOT
                  </button>
                  {currentLabel && (
                    <button onClick={() => clearLabel(tag.id, r.card_id)} className="dim">clear</button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EvalReadout({ result }) {
  const { confusion, precision, recall, f1, disagreements, matchedCount, unmatchedCount } = result;
  return (
    <div className="admin-tagging-eval-readout">
      <div className="admin-tagging-eval-metrics">
        <div><span className="dim">Precision</span> <strong>{pct(precision)}</strong></div>
        <div><span className="dim">Recall</span>    <strong>{pct(recall)}</strong></div>
        <div><span className="dim">F1</span>        <strong>{pct(f1)}</strong></div>
        <div><span className="dim">N</span>         <strong>{matchedCount}{unmatchedCount > 0 ? ` (+${unmatchedCount} unmatched)` : ''}</strong></div>
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

function fmt(n) { return n == null ? '—' : n.toFixed(3); }
function pct(n) { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
