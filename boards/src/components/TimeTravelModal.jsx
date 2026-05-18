// TimeTravelModal — the unified history modal.
//
// Three tabs:
//   • Time travel — every snapshot in board_snapshots (legacy migrated +
//                   new pre/post-restore + future auto/manual tiers),
//                   with preview pane + cherry-pick + op-density bar.
//   • Comments    — every comment on this board, including soft-deleted
//                   (Trash) ones, with filters for open/resolved/hidden.
//   • Trash       — workspace-wide soft-deleted boards waiting for the
//                   30-day purge. Each row has Restore + Delete-now.
//
// Replaces the previous HistoryModal (now retired); same underlying
// commentsApi + listDeletedBoards calls.

import { useEffect, useMemo, useState } from 'react';
import {
  listBoardSnapshots, restoreBoardToTarget, restoreBoard,
  fetchBoardOpDensity,
  listDeletedBoards, hardDeleteBoard,
} from '../lib/boardsApi.js';
import { listAllBoardComments, updateComment, deleteComment, restoreComment } from '../lib/commentsApi.js';
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

export function TimeTravelModal({
  open, boardId, ydoc = null,
  workspaceId = null, userId = null, wsPeers = [],
  onClose, onBoardRestored = null,
}) {
  const [tab, setTab] = useState('versions');
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
  // Comments tab state
  const [comments, setComments] = useState([]);
  const [loadingC, setLoadingC] = useState(false);
  const [commentFilter, setCommentFilter] = useState('all');
  // Trash tab state
  const [trash, setTrash] = useState([]);
  const [loadingT, setLoadingT] = useState(false);
  const [trashBusyId, setTrashBusyId] = useState(null);
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

  // ── Comments tab ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !boardId || tab !== 'comments') return;
    let cancelled = false;
    setLoadingC(true);
    listAllBoardComments(boardId, 300)
      .then((rows) => { if (!cancelled) setComments(rows); })
      .catch((e) => console.warn('comments fetch failed', e))
      .finally(() => { if (!cancelled) setLoadingC(false); });
    return () => { cancelled = true; };
  }, [open, boardId, tab]);

  const refreshComments = async () => {
    try { setComments(await listAllBoardComments(boardId, 300)); }
    catch (e) { console.warn(e); }
  };

  const commentTree = useMemo(() => {
    const byParent = new Map();
    const roots = [];
    for (const c of comments) {
      if (c.reply_to) {
        if (!byParent.has(c.reply_to)) byParent.set(c.reply_to, []);
        byParent.get(c.reply_to).push(c);
      } else roots.push(c);
    }
    return roots
      .filter((r) => {
        if (commentFilter === 'open')     return !r.deleted_at && !r.resolved && !r.hidden;
        if (commentFilter === 'resolved') return !r.deleted_at && !!r.resolved;
        if (commentFilter === 'hidden')   return !r.deleted_at && !!r.hidden;
        if (commentFilter === 'deleted')  return !!r.deleted_at;
        return !r.deleted_at;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((r) => ({
        root: r,
        replies: (byParent.get(r.id) || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      }));
  }, [comments, commentFilter]);

  const commentCounts = useMemo(() => {
    let open = 0, resolved = 0, hidden = 0, deleted = 0;
    for (const c of comments) {
      if (c.reply_to) continue;
      if (c.deleted_at) { deleted++; continue; }
      if (c.hidden) hidden++;
      else if (c.resolved) resolved++;
      else open++;
    }
    return { all: open + resolved + hidden, open, resolved, hidden, deleted };
  }, [comments]);

  const resolveName = (uid) => {
    if (!uid) return 'unknown';
    if (uid === userId) return 'you';
    const peer = (wsPeers || []).find((p) => p?.user?.id === uid);
    return peer?.user?.name || peer?.user?.email?.split('@')[0] || (uid || '').slice(0, 6);
  };
  const resolveColor = (uid) => {
    const peer = (wsPeers || []).find((p) => p?.user?.id === uid);
    return peer?.user?.color || '#4f8df8';
  };

  const onReopenComment = async (c) => {
    try { await updateComment(c.id, { resolved: false, hidden: false }); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Reopen failed: ' + (e?.message || e) }); }
  };
  const onDeleteCommentForever = async (c) => {
    const ok = await feedback.confirm({
      title: 'Delete comment?', confirmLabel: 'Delete', danger: true,
      message: 'You can restore this from the Deleted filter for 30 days.',
    });
    if (!ok) return;
    try { await deleteComment(c.id); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Delete failed: ' + (e?.message || e) }); }
  };
  const onRestoreCommentClicked = async (c) => {
    try { await restoreComment(c.id); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Restore failed: ' + (e?.message || e) }); }
  };

  // ── Trash tab ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !workspaceId || tab !== 'trash') return;
    let cancelled = false;
    setLoadingT(true);
    listDeletedBoards(workspaceId)
      .then((rows) => { if (!cancelled) setTrash(rows); })
      .catch((e) => console.warn('trash fetch failed', e))
      .finally(() => { if (!cancelled) setLoadingT(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId, tab]);

  const refreshTrash = async () => {
    try { setTrash(await listDeletedBoards(workspaceId)); }
    catch (e) { console.warn(e); }
  };
  const onRestoreTrashBoard = async (b) => {
    setTrashBusyId(b.id);
    try {
      await restoreBoard(b.id);
      refreshTrash();
      onBoardRestored?.();
      feedback.toast({ type: 'success', message: `Restored "${b.name || 'Untitled board'}"` });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e?.message || e) });
    } finally {
      setTrashBusyId(null);
    }
  };
  const onHardDeleteBoard = async (b) => {
    const ok = await feedback.confirm({
      title: 'Permanently delete board?', confirmLabel: 'Delete forever', danger: true,
      message: `"${b.name || 'Untitled board'}" and ALL its content will be permanently removed. This cannot be undone.`,
    });
    if (!ok) return;
    setTrashBusyId(b.id);
    try {
      await hardDeleteBoard(b.id);
      refreshTrash();
      feedback.toast({ type: 'success', message: 'Permanently deleted.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (e?.message || e) });
    } finally {
      setTrashBusyId(null);
    }
  };

  if (!open) return null;

  const selected = selectedId ? snapshots.find((s) => s.id === selectedId) : null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-timetravel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="modal-title">History</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="hist-tabs">
          <button className={`hist-tab ${tab === 'versions' ? 'is-active' : ''}`}
                  onClick={() => setTab('versions')}>
            Time travel <span className="hist-tab-count">{snapshots.length}</span>
          </button>
          <button className={`hist-tab ${tab === 'comments' ? 'is-active' : ''}`}
                  onClick={() => setTab('comments')}>
            Comments <span className="hist-tab-count">{commentCounts.all + commentCounts.deleted}</span>
          </button>
          <button className={`hist-tab ${tab === 'trash' ? 'is-active' : ''}`}
                  onClick={() => setTab('trash')}>
            Trash <span className="hist-tab-count">{trash.length}</span>
          </button>
        </div>

        {tab === 'versions' && (
        <>
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
        </>
        )}

        {tab === 'comments' && (
          <>
            <div className="modal-actions">
              <div className="hist-comment-filter">
                {['all', 'open', 'resolved', 'hidden', 'deleted'].map((f) => (
                  <button key={f}
                          className={`hist-pill ${commentFilter === f ? 'is-active' : ''}`}
                          onClick={() => setCommentFilter(f)}>
                    {f[0].toUpperCase() + f.slice(1)}{' '}
                    <span>{commentCounts[f] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-body">
              {loadingC && <div className="modal-empty">Loading…</div>}
              {!loadingC && commentTree.length === 0 && (
                <div className="modal-empty">
                  {commentFilter === 'all' ? 'No comments on this board yet.' :
                   commentFilter === 'resolved' ? 'No resolved comments.' :
                   commentFilter === 'hidden' ? 'No hidden comments.' :
                   commentFilter === 'deleted' ? 'Nothing in the trash. Deleted comments are recoverable for 30 days.' :
                   'No open comments.'}
                </div>
              )}
              {!loadingC && commentTree.length > 0 && (
                <div className="hist-comment-list">
                  {commentTree.map(({ root, replies }) => {
                    const status = root.deleted_at ? 'deleted'
                                 : root.resolved ? 'resolved'
                                 : root.hidden ? 'hidden'
                                 : 'open';
                    return (
                      <div key={root.id} className={`hist-comment-card is-${status}`}>
                        <div className="hist-comment-head">
                          <span className="hist-comment-avatar"
                                style={{ background: resolveColor(root.author) }}>
                            {(resolveName(root.author) || '?')[0].toUpperCase()}
                          </span>
                          <span className="hist-comment-author">{resolveName(root.author)}</span>
                          <span className="hist-comment-when">{fmtDate(root.created_at)}</span>
                          <span className={`hist-comment-status hist-comment-status-${status}`}>{status}</span>
                          {root.deleted_at && (
                            <span className="hist-comment-when" style={{ marginLeft: 'auto' }}>
                              deleted {relTime(root.deleted_at)}
                            </span>
                          )}
                        </div>
                        <div className="hist-comment-body">{root.body}</div>
                        {replies.length > 0 && (
                          <div className="hist-comment-replies">
                            {replies.map((r) => (
                              <div key={r.id} className="hist-comment-reply">
                                <span className="hist-comment-author">{resolveName(r.author)}</span>
                                <span className="hist-comment-when">{relTime(r.created_at)}</span>
                                <div className="hist-comment-body">{r.body}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="hist-comment-actions">
                          <span className="hist-comment-anchor-tag">
                            on {root.anchor_kind === 'card' ? 'a card'
                              : root.anchor_kind === 'group' ? 'a group'
                              : root.anchor_kind === 'point' ? 'the canvas'
                              : root.anchor_kind === 'doc_range' ? 'a doc'
                              : 'the board'}
                          </span>
                          {root.deleted_at ? (
                            <button className="tb-btn tb-btn-sm" onClick={() => onRestoreCommentClicked(root)}>
                              Restore
                            </button>
                          ) : (
                            <>
                              {(root.resolved || root.hidden) && (
                                <button className="tb-btn tb-btn-sm" onClick={() => onReopenComment(root)}>
                                  {root.hidden ? 'Unhide' : 'Reopen'}
                                </button>
                              )}
                              <button className="tb-btn tb-btn-sm tb-btn-danger"
                                      onClick={() => onDeleteCommentForever(root)}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'trash' && (
          <>
            <div className="modal-actions">
              <span className="modal-hint">Deleted boards stay here for 30 days before being permanently removed.</span>
            </div>
            <div className="modal-body">
              {loadingT && <div className="modal-empty">Loading…</div>}
              {!loadingT && trash.length === 0 && (
                <div className="modal-empty">
                  Nothing in the trash. Deleted boards land here automatically.
                </div>
              )}
              {!loadingT && trash.length > 0 && (
                <div className="hist-list">
                  {trash.map((b) => (
                    <div key={b.id} className="hist-row">
                      <div className="hist-meta">
                        <div className="hist-when" title={fmtDate(b.deleted_at)}>
                          {b.name || 'Untitled board'}
                        </div>
                        <div className="hist-sub">
                          <span>deleted {relTime(b.deleted_at)}</span>
                          <span className="hist-label">{b.view || 'canvas'}</span>
                        </div>
                      </div>
                      <button className="tb-btn" disabled={trashBusyId === b.id} onClick={() => onRestoreTrashBoard(b)}>
                        {trashBusyId === b.id ? 'Restoring…' : 'Restore'}
                      </button>
                      <button className="tb-btn tb-btn-sm tb-btn-danger"
                              disabled={trashBusyId === b.id}
                              onClick={() => onHardDeleteBoard(b)}>Delete now</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
