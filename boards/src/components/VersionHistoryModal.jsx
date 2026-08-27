// VersionHistoryModal — browse a board's snapshot history and roll back.
//
// A RESTORE BROWSER, not an undo fallback (the distinction that killed the
// old TimeTravelModal: it eagerly decoded snapshots over the network as a
// Cmd+Z fallback and reset the PartyKit room on every exhausted undo). Rules
// learned from that failure, kept here:
//   - decode ONLY the selected row, lazily, into a throwaway Y.Doc;
//   - restore goes through bulletproofRestore (validates non-empty, writes
//     board_state, resets the room, audits, emits the board-reset event) —
//     never a naive clear+applyUpdate on a live doc;
//   - a pre-restore safety snapshot is ALWAYS written first, so a restore is
//     itself restorable.
//
// board_versions has been write-only since the History tool was removed —
// 15 write sites (idle/periodic/close checkpoints + every pre-drop/-paste/
// -delete/-reparent safety net, and 'api' rows from agent ops) with no
// user-facing reader. The public docs promised this browser all along.
//
// Second tab: the board_meta_history audit log (written since 0053, never
// read) — rename/color/cover/view changes, each with a one-click revert.

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { Modal } from './Modal.jsx';
import {
  listBoardVersions, loadBoardVersionDoc, bulletproofRestore, saveBoardVersion,
  loadBoardSnapshot, listBoardMetaHistory, renameBoard, updateBoardMeta,
  setBoardSchedule,
} from '../lib/boardsApi.js';
import { b64ToBytes, readCards } from '../lib/yhelpers.js';
// boardDoc, not new Y.Doc(): perf.js's transact guard reads _soleilBoardId to
// attribute a CRDT corruption, and useYBoard's self-heal needs an exact board
// match. An untagged temp doc reports boardId:null, which heals nothing.
import { boardDoc } from '../lib/yboard.js';
import { supabase } from '../lib/supabase.js';
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

// Human labels for trigger_kind / label values. Anything unlisted renders
// as-is — better an ugly chip than a hidden provenance.
const KIND_LABEL = {
  idle: 'auto',
  periodic: 'auto',
  destroy: 'on close',
  manual: 'manual',
  api: 'API',
  'undo-move': 'move undo',
  'pre-bulk-delete': 'before bulk delete',
  'pre-paste': 'before paste',
  'pre-drop': 'before drag',
  'pre-drop-target': 'before receiving drop',
  'pre-drop-source': 'before drag out',
  'pre-board-delete': 'before cluster delete',
  'pre-reparent': 'before move',
  'pre-restore': 'before restore',
};

// Group consecutive rows that share a session_id so 200 checkpoints read as
// a handful of work sessions. Rows arrive newest-first.
function groupBySession(rows) {
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.sessionId && r.session_id && last.sessionId === r.session_id) {
      last.rows.push(r);
    } else {
      groups.push({ sessionId: r.session_id || null, rows: [r] });
    }
  }
  return groups;
}

export function VersionHistoryModal({
  open,
  boardId,
  boardName = '',
  // The board's LIVE Y.Doc when it's currently open — used for the
  // pre-restore safety snapshot. Null when browsing a closed board (the
  // snapshot is taken from board_state instead).
  ydoc = null,
  sessionId = null,
  userId = null,
  onClose,
  // Fired after a successful restore / meta revert so App can refresh.
  onRestored = null,
}) {
  const [tab, setTab] = useState('versions');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);   // { id, cards, arrows, strokes, titles[] }
  const [expanded, setExpanded] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const feedback = useFeedback();

  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setLoading(true);
    setSelectedId(null);
    setPreview(null);
    Promise.all([
      listBoardVersions(boardId).catch(() => []),
      listBoardMetaHistory(boardId).catch(() => []),
    ]).then(([v, m]) => {
      if (cancelled) return;
      setRows(v);
      setMeta(m);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, boardId]);

  const groups = useMemo(() => groupBySession(rows), [rows]);
  // card-count delta vs the next-older row — a cheap "what changed" signal.
  const deltaById = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < rows.length; i++) {
      const older = rows[i + 1];
      if (older && typeof rows[i].card_count === 'number' && typeof older.card_count === 'number') {
        m.set(rows[i].id, rows[i].card_count - older.card_count);
      }
    }
    return m;
  }, [rows]);

  // Lazy preview: decode ONLY the clicked row.
  const selectRow = async (row) => {
    setSelectedId(row.id);
    setPreview(null);
    try {
      const b64 = await loadBoardVersionDoc(row.id);
      if (!b64) { setPreview({ id: row.id, error: 'Snapshot unavailable' }); return; }
      const tmp = boardDoc(boardId);
      Y.applyUpdate(tmp, b64ToBytes(b64));
      const cards = readCards(tmp);
      const titles = cards
        .map((c) => (c.name || c.title || c.fileName || (c.kind === 'note' ? (c.html || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 60) : '')))
        .filter(Boolean)
        .slice(0, 8);
      setPreview({
        id: row.id,
        b64,
        cards: cards.length,
        arrows: tmp.getArray('arrows').length,
        strokes: tmp.getArray('strokes').length,
        titles,
      });
      tmp.destroy();
    } catch (e) {
      setPreview({ id: row.id, error: String(e?.message || e) });
    }
  };

  const restoreVersion = async (row) => {
    const ok = await feedback.confirm({
      title: 'Restore this version?',
      message: `“${boardName || 'This cluster'}” goes back to how it was ${relTime(row.snapshot_at)} (${fmtDate(row.snapshot_at)}). The current state is snapshotted first, so this restore is itself restorable. Collaborators see the change immediately.`,
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      // 1) Pre-restore safety snapshot — ALWAYS, before touching anything.
      try {
        if (ydoc) {
          await saveBoardVersion(boardId, ydoc, {
            triggerKind: 'manual', label: 'pre-restore', sessionId, userId,
            opSummary: { action: 'pre-restore', restoring_version: row.id },
          });
        } else {
          const cur = await loadBoardSnapshot(boardId);
          if (cur) {
            const t = boardDoc(boardId);
            Y.applyUpdate(t, b64ToBytes(cur));
            await saveBoardVersion(boardId, t, {
              triggerKind: 'manual', label: 'pre-restore', sessionId, userId,
              opSummary: { action: 'pre-restore', restoring_version: row.id },
            });
            t.destroy();
          }
        }
      } catch (snapErr) {
        console.warn('[version-history] pre-restore snapshot failed', snapErr);
      }
      // 2) The restore itself — reuse the bulletproof machinery, never a
      //    hand-rolled doc mutation.
      const b64 = (preview?.id === row.id && preview?.b64) ? preview.b64 : await loadBoardVersionDoc(row.id);
      if (!b64) throw new Error('snapshot unavailable');
      await bulletproofRestore(boardId, b64);
      feedback.toast({ type: 'success', message: `Restored “${boardName || 'cluster'}” to ${relTime(row.snapshot_at)}.` });
      onRestored?.();
      onClose?.();
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Restore failed: ' + (e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  // Meta revert — only fields with a sanctioned write path. Schedule fields
  // go through set_board_schedule (0243): it keeps the audit trail and pages
  // the crew if the day is published — a silent date revert on a published
  // shoot day would be worse than none. board_meta_history stores values as
  // jsonb, so date strings arrive quoted; unwrap before re-writing.
  const REVERTIBLE = new Set(['name', 'bg_color', 'cover', 'view', 'scheduled_date', 'scheduled_end', 'day_label']);
  const jsonbToPlain = (v) => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  };
  const revertMeta = async (row) => {
    setBusy(true);
    try {
      const before = jsonbToPlain(row.before_value);
      if (row.field === 'name') {
        await renameBoard(boardId, before || 'Untitled cluster');
      } else if (row.field === 'scheduled_date' || row.field === 'scheduled_end' || row.field === 'day_label') {
        // set_board_schedule writes date AND end unconditionally (only the
        // label coalesces), so a one-field revert must send the CURRENT
        // values for the fields it isn't changing — read them fresh, never
        // from the possibly-stale modal props.
        const { data: cur, error: curErr } = await supabase
          .from('boards')
          .select('scheduled_date, scheduled_end, day_label')
          .eq('id', boardId)
          .maybeSingle();
        if (curErr) throw curErr;
        const next = {
          date: row.field === 'scheduled_date' ? before : (cur?.scheduled_date ?? null),
          end: row.field === 'scheduled_end' ? before : (cur?.scheduled_end ?? null),
          label: row.field === 'day_label' ? (before ?? '') : null, // null → RPC keeps current
        };
        const res = await setBoardSchedule(boardId, next.date, next.end, next.label);
        if (res?.ok === false) throw new Error(res?.error || 'revert refused');
      } else {
        await updateBoardMeta(boardId, { [row.field]: before ?? null });
      }
      feedback.toast({ type: 'success', message: `Reverted ${row.field}.` });
      onRestored?.();
      setMeta(await listBoardMetaHistory(boardId).catch(() => meta));
    } catch (e) {
      feedback.toast({ type: 'error', message: 'Revert failed: ' + (e?.message || e) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const renderVersionRow = (row) => {
    const delta = deltaById.get(row.id);
    const kind = KIND_LABEL[row.label] || KIND_LABEL[row.trigger_kind] || row.label || row.trigger_kind || 'auto';
    const isSel = selectedId === row.id;
    return (
      <div key={row.id} className={`hist-row ${isSel ? 'is-selected' : ''}`}
           onClick={() => selectRow(row)} role="button" tabIndex={0}
           onKeyDown={(e) => { if (e.key === 'Enter') selectRow(row); }}>
        <div className="hist-meta">
          <div className="hist-when" title={fmtDate(row.snapshot_at)}>
            {relTime(row.snapshot_at)}
            {typeof row.card_count === 'number' && (
              <span className="hist-sub"> · {row.card_count} card{row.card_count === 1 ? '' : 's'}</span>
            )}
            {typeof delta === 'number' && delta !== 0 && (
              <span className="hist-sub"> ({delta > 0 ? `+${delta}` : delta})</span>
            )}
          </div>
          <div className="hist-sub">
            <span className="hist-label">{kind}</span>
            {isSel && preview?.id === row.id && !preview.error && (
              <span> · {preview.cards} cards, {preview.arrows} arrows, {preview.strokes} drawings
                {preview.titles.length > 0 && <> — {preview.titles.join(' · ')}</>}
              </span>
            )}
            {isSel && preview?.id === row.id && preview.error && <span> · {preview.error}</span>}
            {isSel && preview?.id !== row.id && <span> · loading preview…</span>}
          </div>
        </div>
        <button className="tb-btn" disabled={busy}
                onClick={(e) => { e.stopPropagation(); restoreVersion(row); }}>
          Restore
        </button>
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} className="modal" labelledBy="verhist-title">
      <div className="modal-hd">
        <div className="modal-title" id="verhist-title">
          Version history{boardName ? ` — ${boardName}` : ''}
        </div>
        <button className="modal-x" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="modal-actions">
        <button className={`tb-btn ${tab === 'versions' ? 'is-active' : ''}`} onClick={() => setTab('versions')}>Snapshots</button>
        <button className={`tb-btn ${tab === 'changes' ? 'is-active' : ''}`} onClick={() => setTab('changes')}>Name & appearance</button>
        <span className="modal-hint">
          {tab === 'versions'
            ? 'Snapshots are saved automatically while you work and before risky operations. Restoring always snapshots the current state first.'
            : 'Rename, color, cover, view and shoot-day date changes — each can be reverted. Reverting a published day notifies the crew like any other move.'}
        </span>
      </div>

      <div className="modal-body">
        {loading && <div className="modal-empty">Loading…</div>}

        {!loading && tab === 'versions' && rows.length === 0 && (
          <div className="modal-empty">No snapshots yet — they accumulate as you edit.</div>
        )}
        {!loading && tab === 'versions' && groups.length > 0 && (
          <div className="hist-list">
            {groups.map((g, gi) => {
              const key = g.sessionId || `g${gi}`;
              const isOpen = expanded.has(key);
              const [latest, ...rest] = g.rows;
              return (
                <div key={key}>
                  {renderVersionRow(latest)}
                  {rest.length > 0 && !isOpen && (
                    <button className="tb-btn tb-btn-sm" style={{ margin: '2px 0 8px 12px' }}
                            onClick={() => setExpanded(prev => new Set(prev).add(key))}>
                      {rest.length} earlier in this session…
                    </button>
                  )}
                  {rest.length > 0 && isOpen && rest.map(renderVersionRow)}
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === 'changes' && meta.length === 0 && (
          <div className="modal-empty">No name or appearance changes recorded.</div>
        )}
        {!loading && tab === 'changes' && meta.length > 0 && (
          <div className="hist-list">
            {meta.map((row) => (
              <div key={row.id} className="hist-row">
                <div className="hist-meta">
                  <div className="hist-when" title={fmtDate(row.changed_at)}>
                    {row.field}: {String(row.before_value ?? '—')} → {String(row.after_value ?? '—')}
                  </div>
                  <div className="hist-sub"><span>{relTime(row.changed_at)}</span></div>
                </div>
                {REVERTIBLE.has(row.field) && (
                  <button className="tb-btn tb-btn-sm" disabled={busy} onClick={() => revertMeta(row)}>
                    Revert
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
