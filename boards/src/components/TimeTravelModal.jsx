// TimeTravelModal — the user-facing payoff of the backups rework.
//
// Lists every snapshot in board_snapshots (migrated legacy + new pre/post-
// restore + future auto/manual tiers), with a live preview pane showing
// the cards that existed at that moment. One click restores the whole
// board via the new edge function.
//
// Distinct from HistoryModal — that one still exists and handles the
// versions/comments/trash tabs against legacy tables. This modal is
// scoped to "go back in time on this board's state" via the new system.
//
// Phase 5 scope: whole-board restore, no cherry-pick yet, no op-level
// scrubbing (board_ops will be empty until Phase 4 capture has time to
// accumulate).

import { useEffect, useMemo, useState } from 'react';
import { listBoardSnapshots, restoreBoardToTarget, restoreBoard, fetchBoardOpDensity } from '../lib/boardsApi.js';
import { buildSnapshotPreview, fetchSnapshotBytes, kindLabel, kindBadgeClass, KIND_ICONS, cherryPickCardsFromSnapshot } from '../lib/snapshotPreview.js';
import { useFeedback } from './AppFeedback.jsx';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function TimeTravelModal({ open, boardId, ydoc = null, onClose, onBoardRestored = null }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null); // { cards, groups, cardCount } | null
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState('all');
  const [pickedCards, setPickedCards] = useState(() => new Set());
  const [density, setDensity] = useState([]);
  const [densityWindow, setDensityWindow] = useState('24h');
  const feedback = useFeedback();

  // Load snapshot list when modal opens.
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    setPreview(null);
    setPreviewError(null);
    listBoardSnapshots(boardId, 500)
      .then((rows) => { if (!cancelled) { setSnapshots(rows); setLoading(false); } })
      .catch((e) => { if (!cancelled) { console.error(e); setLoading(false); } });
    return () => { cancelled = true; };
  }, [open, boardId]);

  // Load op density when modal opens or window changes.
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    const now = new Date();
    const window_ms = densityWindow === '1h' ? 3600_000
                    : densityWindow === '24h' ? 86_400_000
                    : densityWindow === '7d' ? 7 * 86_400_000
                    : 30 * 86_400_000;
    const bucket_s = densityWindow === '1h' ? 60
                   : densityWindow === '24h' ? 300
                   : densityWindow === '7d' ? 3600
                   : 86400;
    const fromTs = new Date(now.getTime() - window_ms).toISOString();
    const toTs = now.toISOString();
    fetchBoardOpDensity(boardId, fromTs, toTs, bucket_s)
      .then((rows) => { if (!cancelled) setDensity(rows); })
      .catch((e) => { if (!cancelled) console.warn('density fetch failed', e); });
    return () => { cancelled = true; };
  }, [open, boardId, densityWindow]);

  // Apply kind filter (memoized).
  const filtered = useMemo(() => {
    if (kindFilter === 'all') return snapshots;
    if (kindFilter === 'auto') {
      return snapshots.filter((s) => /^auto-/.test(s.kind) || /^legacy-/.test(s.kind));
    }
    if (kindFilter === 'restore') {
      return snapshots.filter((s) => s.kind === 'pre-restore' || s.kind === 'post-restore');
    }
    if (kindFilter === 'manual') return snapshots.filter((s) => s.kind === 'manual');
    return snapshots;
  }, [snapshots, kindFilter]);

  // Group by date for visual chunks. "today / yesterday / older" — coarse,
  // but enough to scan quickly.
  const grouped = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
    const week = new Date(today.getTime() - 7 * 24 * 3600 * 1000);
    const sections = [
      { key: 'today', label: 'Today', rows: [] },
      { key: 'yesterday', label: 'Yesterday', rows: [] },
      { key: 'thisWeek', label: 'This week', rows: [] },
      { key: 'older', label: 'Older', rows: [] },
    ];
    for (const s of filtered) {
      const t = new Date(s.at_ts);
      if (t >= today) sections[0].rows.push(s);
      else if (t >= yesterday) sections[1].rows.push(s);
      else if (t >= week) sections[2].rows.push(s);
      else sections[3].rows.push(s);
    }
    return sections.filter((sec) => sec.rows.length > 0);
  }, [filtered]);

  // Track decoded bytes for the currently-selected snapshot so cherry-pick
  // doesn't need a second fetch.
  const [previewBytes, setPreviewBytes] = useState(null);

  // Load preview for the selected row.
  useEffect(() => {
    if (!selectedId) { setPreview(null); setPreviewBytes(null); setPickedCards(new Set()); return; }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPickedCards(new Set());
    fetchSnapshotBytes(selectedId)
      .then((b64) => {
        if (cancelled) return;
        setPreviewBytes(b64 || null);
        if (!b64) {
          setPreview({ cards: [], groups: [], cardCount: 0 });
        } else {
          setPreview(buildSnapshotPreview(b64));
        }
      })
      .catch((e) => { if (!cancelled) setPreviewError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const toggleCard = (cardId) => {
    setPickedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const onCherryPick = async () => {
    if (!ydoc) {
      feedback.toast({ type: 'error', message: 'Live board not connected — cherry-pick requires the canvas to be open.' });
      return;
    }
    if (pickedCards.size === 0 || !previewBytes) return;
    const sel = snapshots.find((s) => s.id === selectedId);
    const ok = await feedback.confirm({
      title: 'Cherry-pick cards',
      message: `Bring ${pickedCards.size} card${pickedCards.size === 1 ? '' : 's'} from ${fmtDate(sel?.at_ts)} into the current board? Same-id cards in the live board will be overwritten; other cards are untouched.`,
      confirmLabel: `Cherry-pick ${pickedCards.size}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = cherryPickCardsFromSnapshot(ydoc, previewBytes, Array.from(pickedCards));
      const total = result.addedCardIds.length + result.overwroteCardIds.length;
      feedback.toast({
        type: 'success',
        message: `Cherry-picked ${total} card${total === 1 ? '' : 's'}` +
          (result.skippedCardIds.length > 0 ? ` (${result.skippedCardIds.length} skipped)` : ''),
      });
      setPickedCards(new Set());
    } catch (e) {
      console.error(e);
      feedback.toast({ type: 'error', message: 'Cherry-pick failed: ' + (e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    if (!selectedId) return;
    const sel = snapshots.find((s) => s.id === selectedId);
    const labelHint = sel?.label || fmtDate(sel?.at_ts);
    const ok = await feedback.confirm({
      title: 'Restore board to this state',
      message: `Replace the current board with the state from ${labelHint}? The current state will be saved as a pre-restore snapshot first.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await restoreBoardToTarget(
        boardId,
        { snapshotId: selectedId },
        { reason: `restore via time-travel modal (${labelHint})` },
      );

      // Best-effort: un-soft-delete sub-boards referenced by board-kind
      // cards in the restored state. Preview already decoded the cards.
      if (preview?.cards) {
        const boardIds = preview.cards.filter((c) => c.kind === 'board').map((c) => c.id);
        for (const bid of boardIds) {
          try { await restoreBoard(bid); } catch (_) {}
        }
      }

      feedback.toast({
        type: 'success',
        message: `Restored to ${labelHint} (version ${result.new_version})`,
      });
      if (onBoardRestored) onBoardRestored();
      // Refresh the snapshot list to show the new pre/post-restore rows.
      const fresh = await listBoardSnapshots(boardId, 500);
      setSnapshots(fresh);
    } catch (e) {
      console.error(e);
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const selected = selectedId ? snapshots.find((s) => s.id === selectedId) : null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-timetravel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="modal-title">Time travel</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Op-density bar (Phase 4 op log visualization). Compact horizontal
            chart over the last 1h/24h/7d/30d, one bar per bucket. Empty
            until board_ops accumulates data. */}
        <div className="tt-density">
          <div className="tt-density-hd">
            <span className="tt-density-title">Edit activity</span>
            <select
              className="tt-filter-select"
              value={densityWindow}
              onChange={(e) => setDensityWindow(e.target.value)}
            >
              <option value="1h">Last hour</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
            <span className="tt-density-meta">
              {density.length === 0
                ? 'No op-level history yet — appears once Phase 4 capture starts.'
                : `${density.reduce((s, b) => s + Number(b.op_count || 0), 0)} ops · ${density.reduce((s, b) => s + Number(b.delete_count || 0), 0)} deletes`}
            </span>
          </div>
          <div className="tt-density-bar">
            {(() => {
              if (density.length === 0) return <div className="tt-density-empty" />;
              const max = Math.max(1, ...density.map((b) => Number(b.op_count || 0)));
              return density.map((b, i) => {
                const h = Math.round((Number(b.op_count || 0) / max) * 100);
                const isDelHeavy = Number(b.delete_count || 0) >= Math.max(1, Number(b.op_count || 0) * 0.5);
                return (
                  <div
                    key={i}
                    className={`tt-density-cell ${isDelHeavy ? 'is-delete-heavy' : ''}`}
                    style={{ height: `${Math.max(3, h)}%` }}
                    title={`${new Date(b.bucket_start).toLocaleString()}\n${b.op_count} ops, ${b.delete_count} deletes`}
                  />
                );
              });
            })()}
          </div>
        </div>

        <div className="tt-body">
          {/* Left: snapshot list */}
          <div className="tt-list">
            <div className="tt-filter-bar">
              <label className="tt-filter-label">Filter:</label>
              <select className="tt-filter-select" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                <option value="all">All snapshots</option>
                <option value="auto">Auto-saves only</option>
                <option value="restore">Restore points only</option>
                <option value="manual">Manual saves only</option>
              </select>
              <span className="tt-count">{filtered.length}</span>
            </div>
            <div className="tt-list-scroll">
              {loading && <div className="modal-empty">Loading…</div>}
              {!loading && filtered.length === 0 && (
                <div className="modal-empty">No snapshots for this board yet.</div>
              )}
              {!loading && grouped.map((section) => (
                <div key={section.key} className="tt-section">
                  <div className="tt-section-hd">{section.label}</div>
                  {section.rows.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`tt-row ${s.id === selectedId ? 'is-selected' : ''}`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <span className={kindBadgeClass(s.kind)}>{kindLabel(s.kind)}</span>
                      <span className="tt-row-when">{relTime(s.at_ts)}</span>
                      <span className="tt-row-time">{fmtDate(s.at_ts)}</span>
                      {s.label && <span className="tt-row-label" title={s.label}>{s.label}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Right: preview */}
          <div className="tt-preview">
            {!selectedId && (
              <div className="modal-empty">Select a snapshot on the left to see what was on the board at that moment.</div>
            )}
            {selectedId && previewLoading && <div className="modal-empty">Loading snapshot…</div>}
            {selectedId && previewError && (
              <div className="modal-empty">Couldn't load preview: {previewError}</div>
            )}
            {selectedId && preview && (
              <>
                <div className="tt-preview-hd">
                  <div>
                    <div className="tt-preview-title">{selected?.label || fmtDate(selected?.at_ts)}</div>
                    <div className="tt-preview-meta">
                      {fmtDate(selected?.at_ts)} · {preview.cardCount} card{preview.cardCount === 1 ? '' : 's'}
                      {preview.groups.length > 0 && ` · ${preview.groups.length} group${preview.groups.length === 1 ? '' : 's'}`}
                      {selected?.kind && (
                        <> · <span className={kindBadgeClass(selected.kind)}>{kindLabel(selected.kind)}</span></>
                      )}
                    </div>
                  </div>
                  <div className="tt-preview-actions">
                    {pickedCards.size > 0 && (
                      <button
                        type="button"
                        className="tb-btn"
                        onClick={onCherryPick}
                        disabled={busy || !ydoc}
                        title={!ydoc ? 'Cherry-pick requires the live board to be open' : ''}
                      >
                        {busy ? 'Working…' : `Cherry-pick ${pickedCards.size} into current`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="tb-btn tb-btn-primary"
                      onClick={onRestore}
                      disabled={busy}
                    >
                      {busy ? 'Restoring…' : 'Restore whole board to this state'}
                    </button>
                  </div>
                </div>
                <div className="tt-preview-grid">
                  {preview.cards.length === 0 && (
                    <div className="modal-empty">This snapshot has no cards.</div>
                  )}
                  {preview.cards.map((c) => (
                    <label
                      key={c.id}
                      className={`tt-card ${pickedCards.has(c.id) ? 'is-picked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="tt-card-pick"
                        checked={pickedCards.has(c.id)}
                        onChange={() => toggleCard(c.id)}
                      />
                      <div className="tt-card-icon">{KIND_ICONS[c.kind] || '•'}</div>
                      <div className="tt-card-body">
                        <div className="tt-card-kind">{c.kind}</div>
                        {c.title && <div className="tt-card-title">{c.title}</div>}
                        {c.body && c.body !== c.title && <div className="tt-card-text">{c.body}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
