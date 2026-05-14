// Floating history modal for the current board. Three tabs:
//   • Versions — snapshot history (with metadata-change rows interleaved)
//   • Comments — every comment on this board, including trashed
//   • Trash    — workspace-wide soft-deleted boards waiting on the 30-day purge
//
// Restoring a version replaces the live Y.Doc state with the version's
// saved bytes. Restoring a metadata-change row writes its before_value
// back to the boards table. Restoring a board flips deleted_at back to NULL.

import { useEffect, useMemo, useState } from 'react';
import {
  listBoardVersions, loadBoardVersionDoc, saveBoardVersion, restoreBoard,
  listBoardMetaHistory, applyMetaChangeUndo, listDeletedBoards, hardDeleteBoard,
} from '../lib/boardsApi.js';
import { listAllBoardComments, updateComment, deleteComment, restoreComment } from '../lib/commentsApi.js';
import { restoreVersionInto } from '../lib/yboard.js';
import { useFeedback } from './AppFeedback.jsx';

function relTime(iso) {
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
  return `${d}d ago`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export function HistoryModal({ open, boardId, workspaceId = null, ydoc, userId, onClose, onBoardRestored = null, wsPeers = [] }) {
  const [tab, setTab] = useState('versions');
  const [versions, setVersions] = useState([]);
  const [metaHistory, setMetaHistory] = useState([]);
  const [loadingV, setLoadingV] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [comments, setComments] = useState([]);
  const [loadingC, setLoadingC] = useState(true);
  const [commentFilter, setCommentFilter] = useState('all');
  const [trash, setTrash] = useState([]);
  const [loadingT, setLoadingT] = useState(true);
  const feedback = useFeedback();

  // ── Versions + Meta history ─────────────────────────────────────────
  const refreshVersions = async () => {
    if (!boardId) return;
    setLoadingV(true);
    try {
      const [vs, mh] = await Promise.all([
        listBoardVersions(boardId, 200),
        listBoardMetaHistory(boardId, 200),
      ]);
      setVersions(vs);
      setMetaHistory(mh);
    } catch (e) { console.error(e); }
    finally { setLoadingV(false); }
  };
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setLoadingV(true);
    Promise.all([
      listBoardVersions(boardId, 200),
      listBoardMetaHistory(boardId, 200),
    ]).then(([vs, mh]) => {
      if (cancelled) return;
      setVersions(vs);
      setMetaHistory(mh);
      setLoadingV(false);
    }).catch(e => { console.error(e); setLoadingV(false); });
    return () => { cancelled = true; };
  }, [open, boardId]);

  // ── Trash (workspace-wide soft-deleted boards) ──────────────────────
  const refreshTrash = async () => {
    if (!workspaceId) return;
    setLoadingT(true);
    try {
      const rows = await listDeletedBoards(workspaceId);
      setTrash(rows);
    } catch (e) { console.warn('trash fetch failed', e); }
    finally { setLoadingT(false); }
  };
  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoadingT(true);
    listDeletedBoards(workspaceId)
      .then(rows => { if (!cancelled) setTrash(rows); })
      .catch(e => console.warn('trash fetch failed', e))
      .finally(() => { if (!cancelled) setLoadingT(false); });
    return () => { cancelled = true; };
  }, [open, workspaceId]);

  // Group versions into "sessions" — (session_id, made_by) pairs. Rows
  // without a session_id fall under "Legacy". Inside a session, snapshots
  // stay chronological newest-first. Sessions themselves are ordered by
  // their newest snapshot.
  const sessionGroups = useMemo(() => {
    const bySession = new Map(); // sessionId|null|legacy → { sessionId, userId, rows[], maxAt, minAt }
    const legacyRows = [];
    for (const v of versions) {
      if (!v.session_id) {
        legacyRows.push(v);
        continue;
      }
      const key = `${v.session_id}|${v.made_by || ''}`;
      let bucket = bySession.get(key);
      if (!bucket) {
        bucket = {
          key,
          sessionId: v.session_id,
          userId: v.made_by || null,
          rows: [],
          maxAt: v.snapshot_at,
          minAt: v.snapshot_at,
        };
        bySession.set(key, bucket);
      }
      bucket.rows.push(v);
      if (v.snapshot_at > bucket.maxAt) bucket.maxAt = v.snapshot_at;
      if (v.snapshot_at < bucket.minAt) bucket.minAt = v.snapshot_at;
    }
    const sessions = [...bySession.values()].sort((a, b) => (a.maxAt < b.maxAt ? 1 : -1));
    return { sessions, legacyRows };
  }, [versions]);

  // ── Comments ────────────────────────────────────────────────────────
  const refreshComments = async () => {
    setLoadingC(true);
    try {
      const rows = await listAllBoardComments(boardId, 300);
      setComments(rows);
    } catch (e) { console.warn('comment history fetch failed', e); }
    finally { setLoadingC(false); }
  };
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setLoadingC(true);
    listAllBoardComments(boardId, 300)
      .then(rows => { if (!cancelled) setComments(rows); })
      .catch(e => console.warn('comment history fetch failed', e))
      .finally(() => { if (!cancelled) setLoadingC(false); });
    return () => { cancelled = true; };
  }, [open, boardId]);

  // Group replies under their parents, then filter by tab.
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
      .filter(r => {
        if (commentFilter === 'open')     return !r.deleted_at && !r.resolved && !r.hidden;
        if (commentFilter === 'resolved') return !r.deleted_at && !!r.resolved;
        if (commentFilter === 'hidden')   return !r.deleted_at && !!r.hidden;
        if (commentFilter === 'deleted')  return !!r.deleted_at;
        // 'all' tab shows live comments (any state) but not deleted ones —
        // deleted have their own tab.
        return !r.deleted_at;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(r => ({ root: r, replies: (byParent.get(r.id) || [])
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }));
  }, [comments, commentFilter]);

  const counts = useMemo(() => {
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

  // Author name resolution — we have wsPeers available, fall back to
  // an id slice if the peer isn't currently online.
  const resolveName = (uid) => {
    if (!uid) return 'unknown';
    if (uid === userId) return 'you';
    const peer = (wsPeers || []).find(p => p?.user?.id === uid);
    return peer?.user?.name || peer?.user?.email?.split('@')[0]
        || (uid || '').slice(0, 6);
  };
  const resolveColor = (uid) => {
    const peer = (wsPeers || []).find(p => p?.user?.id === uid);
    return peer?.user?.color || '#4f8df8';
  };

  const onRestore = async (v) => {
    if (!ydoc) return;
    const ok = await feedback.confirm({
      title: 'Restore version',
      message: `Restore the version from ${fmtDate(v.snapshot_at)}? Your current state will be saved as a new version first.`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    setBusyId(v.id);
    try {
      await saveBoardVersion(boardId, ydoc, {
        label: 'before-restore',
        userId,
        triggerKind: 'pre-restore',
        opSummary: { restoring_to: v.id, restoring_to_at: v.snapshot_at },
      });
      const b64 = await loadBoardVersionDoc(v.id);
      restoreVersionInto(ydoc, b64);
      // Un-soft-delete any sub-boards referenced by board-kind cards in
      // the restored doc so an undone "delete board" fully comes back.
      try {
        const cardsMap = ydoc.getMap('cards');
        const boardIds = [];
        cardsMap.forEach((ym, id) => {
          if (ym?.get?.('kind') === 'board') boardIds.push(id);
        });
        for (const bid of boardIds) {
          try { await restoreBoard(bid); } catch (_) {}
        }
      } catch (_) {}
      const rows = await listBoardVersions(boardId, 200);
      setVersions(rows);
    } catch (e) {
      console.error(e);
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  const onSaveCurrent = async () => {
    if (!ydoc) return;
    const label = await feedback.prompt({
      title: 'Save version',
      label: 'Label',
      placeholder: 'manual',
      defaultValue: 'manual',
      confirmLabel: 'Save snapshot',
    });
    if (label == null) return;
    try {
      await saveBoardVersion(boardId, ydoc, {
        label: label || 'manual',
        userId,
        triggerKind: 'manual',
      });
      const rows = await listBoardVersions(boardId, 200);
      setVersions(rows);
      feedback.toast({ type: 'success', message: 'Snapshot saved.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (e.message || e) });
    }
  };

  // Human-readable label for a row's trigger reason. Prefers op_summary
  // (rich) → trigger_kind → label.
  const describeRow = (v) => {
    const op = v.op_summary || {};
    const action = op.action;
    const count = op.card_count;
    if (action === 'drag-in-multi' || action === 'drag-in-single') {
      return `Drag-in ${count || ''} card${count === 1 ? '' : 's'}`.trim();
    }
    if (action === 'drag-out') return `Drag-out ${count || ''} card${count === 1 ? '' : 's'}`.trim();
    if (action === 'drop-into-board') return `Move ${count || ''} card${count === 1 ? '' : 's'} into board`.trim();
    if (action === 'receive-cross-board-drop') return `Receive ${count || ''} card${count === 1 ? '' : 's'} from another board`.trim();
    if (action === 'bulk-delete') return `Bulk delete ${count || ''} card${count === 1 ? '' : 's'}`.trim();
    if (action === 'paste') return `Paste ${count || ''} card${count === 1 ? '' : 's'}`.trim();
    if (action === 'time-travel-undo-from-live') return 'Pre-undo checkpoint';
    if (v.trigger_kind === 'periodic') return 'Periodic checkpoint';
    if (v.trigger_kind === 'idle') return 'Session end (idle)';
    if (v.trigger_kind === 'destroy') return 'Tab closed';
    if (v.trigger_kind === 'manual') return v.label || 'Manual snapshot';
    if (v.trigger_kind === 'pre-restore') return 'Pre-restore checkpoint';
    return v.label || '—';
  };

  const onReopen = async (c) => {
    try { await updateComment(c.id, { resolved: false, hidden: false }); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Reopen failed: ' + (e.message || e) }); }
  };
  const onUnhide = async (c) => {
    try { await updateComment(c.id, { hidden: false }); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Unhide failed: ' + (e.message || e) }); }
  };
  const onDeleteForever = async (c) => {
    const ok = await feedback.confirm({
      title: 'Delete comment?', confirmLabel: 'Delete', danger: true,
      message: 'You can restore this from the Deleted tab for 30 days.',
    });
    if (!ok) return;
    try { await deleteComment(c.id); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Delete failed: ' + (e.message || e) }); }
  };

  const onRestoreComment = async (c) => {
    try { await restoreComment(c.id); refreshComments(); }
    catch (e) { feedback.toast({ type: 'error', message: 'Restore failed: ' + (e.message || e) }); }
  };

  // ── Trash actions ───────────────────────────────────────────────────
  const onRestoreTrash = async (b) => {
    setBusyId(b.id);
    try {
      await restoreBoard(b.id);
      refreshTrash();
      try { onBoardRestored?.(); } catch (_) {}
      feedback.toast({ type: 'success', message: `Restored "${b.name || 'Untitled board'}"` });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e.message || e) });
    } finally {
      setBusyId(null);
    }
  };
  const onHardDelete = async (b) => {
    const ok = await feedback.confirm({
      title: 'Permanently delete board?', confirmLabel: 'Delete forever', danger: true,
      message: `"${b.name || 'Untitled board'}" and ALL its content (cards, doc pages, version history, comments) will be permanently removed. This cannot be undone.`,
    });
    if (!ok) return;
    setBusyId(b.id);
    try {
      await hardDeleteBoard(b.id);
      refreshTrash();
      feedback.toast({ type: 'success', message: 'Permanently deleted.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (e.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  // ── Meta history actions ────────────────────────────────────────────
  const describeMetaRow = (m) => {
    const before = m.before_value?.v ?? null;
    const after = m.after_value?.v ?? null;
    const who = resolveName(m.changed_by);
    const fmt = (v) => v === null || v === undefined ? '∅' : String(v);
    if (m.field === 'name') return `${who} renamed "${fmt(before)}" → "${fmt(after)}"`;
    if (m.field === 'cover') return `${who} changed cover ${fmt(before)} → ${fmt(after)}`;
    if (m.field === 'view') return `${who} switched view ${fmt(before)} → ${fmt(after)}`;
    if (m.field === 'bg_color') return `${who} changed background ${fmt(before)} → ${fmt(after)}`;
    if (m.field === 'meta') return `${who} updated meta`;
    return `${who} changed ${m.field}`;
  };
  const onRestoreMeta = async (m) => {
    setBusyId(m.id);
    try {
      await applyMetaChangeUndo(m, { userId });
      refreshVersions();
      feedback.toast({ type: 'success', message: 'Reversed.' });
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Reverse failed: ' + (e.message || e) });
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal modal-history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-hd">
          <div className="modal-title">History</div>
          <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="hist-tabs">
          <button className={`hist-tab ${tab === 'versions' ? 'is-active' : ''}`}
                  onClick={() => setTab('versions')}>
            Versions
            <span className="hist-tab-count">{versions.length}</span>
          </button>
          <button className={`hist-tab ${tab === 'comments' ? 'is-active' : ''}`}
                  onClick={() => setTab('comments')}>
            Comments
            <span className="hist-tab-count">{counts.all}</span>
          </button>
          <button className={`hist-tab ${tab === 'trash' ? 'is-active' : ''}`}
                  onClick={() => setTab('trash')}>
            Trash
            <span className="hist-tab-count">{trash.length}</span>
          </button>
        </div>

        {tab === 'versions' && (
          <>
            <div className="modal-actions">
              <button className="tb-btn" onClick={onSaveCurrent}>Save snapshot now</button>
              <span className="modal-hint">Auto-snapshots before risky ops + every 2 min of editing</span>
            </div>
            <div className="modal-body">
              {loadingV && <div className="modal-empty">Loading…</div>}
              {!loadingV && versions.length === 0 && metaHistory.length === 0 && (
                <div className="modal-empty">No versions yet — keep editing and they'll start appearing here.</div>
              )}
              {!loadingV && metaHistory.length > 0 && (
                <MetaHistoryGroup
                  rows={metaHistory}
                  describe={describeMetaRow}
                  busyId={busyId}
                  onRestore={onRestoreMeta}
                />
              )}
              {!loadingV && versions.length > 0 && (
                <div className="hist-list hist-list-sessions">
                  {sessionGroups.sessions.map((s, idx) => (
                    <SessionGroup
                      key={s.key}
                      session={s}
                      defaultOpen={idx === 0}
                      describeRow={describeRow}
                      resolveName={resolveName}
                      busyId={busyId}
                      onRestore={onRestore}
                    />
                  ))}
                  {sessionGroups.legacyRows.length > 0 && (
                    <LegacyGroup
                      rows={sessionGroups.legacyRows}
                      describeRow={describeRow}
                      busyId={busyId}
                      onRestore={onRestore}
                    />
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'comments' && (
          <>
            <div className="modal-actions">
              <div className="hist-comment-filter">
                <button className={`hist-pill ${commentFilter === 'all' ? 'is-active' : ''}`}
                        onClick={() => setCommentFilter('all')}>All <span>{counts.all}</span></button>
                <button className={`hist-pill ${commentFilter === 'open' ? 'is-active' : ''}`}
                        onClick={() => setCommentFilter('open')}>Open <span>{counts.open}</span></button>
                <button className={`hist-pill ${commentFilter === 'resolved' ? 'is-active' : ''}`}
                        onClick={() => setCommentFilter('resolved')}>Resolved <span>{counts.resolved}</span></button>
                <button className={`hist-pill ${commentFilter === 'hidden' ? 'is-active' : ''}`}
                        onClick={() => setCommentFilter('hidden')}>Hidden <span>{counts.hidden}</span></button>
                <button className={`hist-pill ${commentFilter === 'deleted' ? 'is-active' : ''}`}
                        onClick={() => setCommentFilter('deleted')}>Deleted <span>{counts.deleted}</span></button>
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
                            {replies.map(r => (
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
                            <button className="tb-btn tb-btn-sm" onClick={() => onRestoreComment(root)}>
                              Restore
                            </button>
                          ) : (
                            <>
                              {(root.resolved || root.hidden) && (
                                <button className="tb-btn tb-btn-sm" onClick={() => onReopen(root)}>
                                  {root.hidden ? 'Unhide' : 'Reopen'}
                                </button>
                              )}
                              <button className="tb-btn tb-btn-sm tb-btn-danger"
                                      onClick={() => onDeleteForever(root)}>Delete</button>
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
                  {trash.map(b => (
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
                      <button className="tb-btn" disabled={busyId === b.id} onClick={() => onRestoreTrash(b)}>
                        {busyId === b.id ? 'Restoring…' : 'Restore'}
                      </button>
                      <button className="tb-btn tb-btn-sm tb-btn-danger"
                              disabled={busyId === b.id}
                              onClick={() => onHardDelete(b)}>Delete now</button>
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

function SessionGroup({ session, defaultOpen, describeRow, resolveName, busyId, onRestore }) {
  const [open, setOpen] = useState(defaultOpen);
  const userLabel = resolveName(session.userId);
  return (
    <div className={`hist-session ${open ? 'is-open' : ''}`}>
      <button className="hist-session-head" onClick={() => setOpen(o => !o)}>
        <span className="hist-session-caret">{open ? '▾' : '▸'}</span>
        <span className="hist-session-user">{userLabel}</span>
        <span className="hist-session-when">
          {fmtDate(session.minAt)} – {fmtDate(session.maxAt)}
        </span>
        <span className="hist-session-count">{session.rows.length} snapshot{session.rows.length === 1 ? '' : 's'}</span>
      </button>
      {open && (
        <div className="hist-session-body">
          {session.rows.map(v => (
            <div key={v.id} className="hist-row">
              <div className="hist-meta">
                <div className="hist-when" title={fmtDate(v.snapshot_at)}>{relTime(v.snapshot_at)}</div>
                <div className="hist-sub">
                  <span className="hist-trigger">{describeRow(v)}</span>
                  <span>{v.card_count ?? '?'} cards</span>
                </div>
              </div>
              <button className="tb-btn" disabled={busyId === v.id} onClick={() => onRestore(v)}>
                {busyId === v.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LegacyGroup({ rows, describeRow, busyId, onRestore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hist-session hist-session-legacy ${open ? 'is-open' : ''}`}>
      <button className="hist-session-head" onClick={() => setOpen(o => !o)}>
        <span className="hist-session-caret">{open ? '▾' : '▸'}</span>
        <span className="hist-session-user">Legacy history</span>
        <span className="hist-session-when">snapshots from before session tracking</span>
        <span className="hist-session-count">{rows.length}</span>
      </button>
      {open && (
        <div className="hist-session-body">
          {rows.map(v => (
            <div key={v.id} className="hist-row">
              <div className="hist-meta">
                <div className="hist-when" title={fmtDate(v.snapshot_at)}>{relTime(v.snapshot_at)}</div>
                <div className="hist-sub">
                  <span className="hist-trigger">{describeRow(v)}</span>
                  <span>{v.card_count ?? '?'} cards</span>
                </div>
              </div>
              <button className="tb-btn" disabled={busyId === v.id} onClick={() => onRestore(v)}>
                {busyId === v.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaHistoryGroup({ rows, describe, busyId, onRestore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hist-session hist-session-meta ${open ? 'is-open' : ''}`} style={{ marginBottom: 8 }}>
      <button className="hist-session-head" onClick={() => setOpen(o => !o)}>
        <span className="hist-session-caret">{open ? '▾' : '▸'}</span>
        <span className="hist-session-user">Metadata changes</span>
        <span className="hist-session-when">renames, cover, view, background</span>
        <span className="hist-session-count">{rows.length}</span>
      </button>
      {open && (
        <div className="hist-session-body">
          {rows.map(m => (
            <div key={m.id} className="hist-row">
              <div className="hist-meta">
                <div className="hist-when" title={fmtDate(m.changed_at)}>{relTime(m.changed_at)}</div>
                <div className="hist-sub">
                  <span className="hist-trigger">{describe(m)}</span>
                </div>
              </div>
              <button className="tb-btn" disabled={busyId === m.id} onClick={() => onRestore(m)}>
                {busyId === m.id ? '…' : 'Reverse'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
