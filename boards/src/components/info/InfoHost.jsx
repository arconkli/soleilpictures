// The Info drawer, mounted once per app shell (App.jsx, LocalBoardsApp.jsx).
// Anything can ask for Info with lib/infoBus.openInfo(); this resolves the
// request against the LIVE cards of an open cluster (resolveBoard) — so Info
// updates as the file does — falling back to cards the caller sent along (a
// cluster browsed in Files) or to the board row alone (a cluster that isn't
// open). Opened with `follow`, it keeps up with that surface's selection.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DetailPanel } from '../clusterBrowser/DetailPanel.jsx';
import { toListItem } from '../../lib/listItem.js';
import { getMeta } from '../../lib/imageMeta.js';
import { registerBackLayer } from '../../lib/modalGuard.js';
import { INFO_EVENT, INFO_CLOSE_EVENT, readSelection, subscribeSelection, targetForSelection } from '../../lib/infoBus.js';
import { swallowContextMenu } from '../../lib/contextMenuGuard.js';

function sameRequest(a, b) {
  if (!a || !b) return false;
  const ids = (r) => (r.cardIds || []).join(',');
  const cls = (r) => (r.clusterIds || []).join(',');
  return a.boardId === b.boardId && (a.clusterId || null) === (b.clusterId || null)
    && (a.groupId || null) === (b.groupId || null) && ids(a) === ids(b) && cls(a) === cls(b);
}

// A folder in a selection, as the card-like shape Info's summary counts.
const boardAsCard = (b) => ({ id: b.id, kind: 'board', name: b.name, createdAt: b.created_at || null });

export function resolveInfoTarget(req, { boards = {}, resolveBoard }) {
  if (!req) return null;
  const clusterTarget = (id) => {
    const board = boards[id];
    if (!board) return null;
    const live = resolveBoard?.(id);
    return { type: 'cluster', board, cards: live?.cards || (id === req.boardId ? req.cards : null) || null };
  };
  if (req.clusterId) return clusterTarget(req.clusterId);
  const live = req.boardId ? resolveBoard?.(req.boardId) : null;
  const pool = live?.cards || req.cards || [];
  if (req.groupId) {
    const group = (live?.groups || []).find((g) => g.id === req.groupId);
    // A group whose cluster isn't open: describe the cluster it's in.
    if (!group) return req.boardId ? clusterTarget(req.boardId) : null;
    return { type: 'canvasGroup', group, members: pool.filter((c) => c.groupId === group.id) };
  }
  // A set, not pool.find per id: ⌘A on a 3,000-file cluster is 3,000 ids.
  const want = new Set(req.cardIds || []);
  const cards = want.size ? pool.filter((c) => want.has(c.id)) : [];
  const folders = (req.clusterIds || []).map((id) => boards[id]).filter(Boolean).map(boardAsCard);
  if (cards.length + folders.length > 1) return { type: 'selection', cards: [...cards, ...folders] };
  if (folders.length === 1) return clusterTarget(folders[0].id);
  if (!cards.length) return null;
  const item = toListItem(cards[0], { boards, getMeta, boardId: req.boardId, gridTemplates: live?.gridTemplates || {} });
  return item ? { type: 'card', item, live } : null;
}

export function InfoHost({ boards = {}, resolveBoard, selfId = null, onOpenCluster = null, onReveal = null }) {
  const [req, setReq] = useState(null);
  const reqRef = useRef(null);
  reqRef.current = req;
  const hostRef = useRef(null);

  useEffect(() => {
    const onOpen = (e) => {
      const d = e.detail || {};
      // ⌘I is a toggle: whatever the drawer shows, it closes.
      if (d.toggle && reqRef.current) { setReq(null); return; }
      const next = {
        boardId: d.boardId || null, cardIds: d.cardIds || null, clusterIds: d.clusterIds || null,
        clusterId: d.clusterId || null, groupId: d.groupId || null, cards: d.cards || null, follow: d.follow || null,
      };
      // Following a selection: start from what's selected right now.
      const sel = next.follow ? readSelection(next.follow) : null;
      setReq(sel && !d.cardIds && !d.clusterId && !d.groupId ? targetForSelection(sel, { follow: next.follow }) : next);
    };
    // closeInfo(): always. closeInfo({ follow }): only a drawer following
    // that surface — it's going away (unmounted, or Files went full screen).
    const onClose = (e) => {
      const f = e.detail?.follow;
      if (!f || reqRef.current?.follow === f) setReq(null);
    };
    document.addEventListener(INFO_EVENT, onOpen);
    document.addEventListener(INFO_CLOSE_EVENT, onClose);
    return () => {
      document.removeEventListener(INFO_EVENT, onOpen);
      document.removeEventListener(INFO_CLOSE_EVENT, onClose);
    };
  }, []);

  // An inspector, not a snapshot: re-target as the followed selection moves
  // (and pick up a browsed cluster's cards once they've loaded).
  useEffect(() => subscribeSelection((source, sel) => {
    const cur = reqRef.current;
    if (!cur || cur.follow !== source) return;
    const next = targetForSelection(sel, { follow: source });
    if (next && (!sameRequest(cur, next) || next.cards !== cur.cards)) setReq(next);
  }), []);

  const close = useCallback(() => setReq(null), []);
  let target = resolveInfoTarget(req, { boards, resolveBoard });
  // Following a surface whose selection points at cards that have just gone
  // (a delete, or the board changed under it): show its cluster instead.
  if (!target && req?.follow && req.boardId) target = resolveInfoTarget({ boardId: req.boardId, clusterId: req.boardId, cards: req.cards }, { boards, resolveBoard });
  const open = !!target;

  // Nothing left to describe — the card or cluster is gone.
  useEffect(() => {
    if (req && !target) setReq(null);
  }, [req, target]);

  // Focus moves in when it opens, so Esc reaches it; back where it was after.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const prev = document.activeElement;
      hostRef.current?.querySelector('.cb-detail')?.focus?.({ preventScroll: true });
      wasOpen.current = true;
      return () => {
        wasOpen.current = false;
        if (prev && prev.isConnected && typeof prev.focus === 'function') { try { prev.focus({ preventScroll: true }); } catch (_) {} }
      };
    }
    return undefined;
  }, [open]);

  // Esc closes it while it has focus; everywhere else Esc belongs to the
  // surface (deselect, close a menu…).
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(); } };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [close, open]);

  // Toasts step aside for it, as they do for the docked Files panel; on a
  // phone it's a sheet, and Back closes it.
  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    const narrow = !!window.matchMedia?.('(max-width: 640px)').matches;
    if (!narrow) root.style.setProperty('--info-drawer-w', '348px');
    const offBack = narrow ? registerBackLayer(close) : null;
    return () => { root.style.removeProperty('--info-drawer-w'); offBack?.(); };
  }, [open, close]);

  if (!target) return null;
  const live = target.live || (req?.boardId ? resolveBoard?.(req.boardId) : null);
  // "Open cluster" for a cluster that isn't already open in a pane.
  const clusterOpenHere = target.type === 'cluster' && !!resolveBoard?.(target.board?.id);
  return (
    <div className="info-host" ref={hostRef} onContextMenu={swallowContextMenu}>
      <DetailPanel
        variant="drawer"
        target={target}
        boards={boards}
        canEdit={!!live?.canEdit}
        selfId={selfId}
        gridTemplates={live?.gridTemplates || {}}
        onClose={close}
        onOpenCluster={onOpenCluster && !clusterOpenHere ? (id) => { onOpenCluster(id); close(); } : null}
        onReveal={onReveal && target.type === 'card' && live ? (id) => onReveal(req.boardId, [id]) : null}
      />
    </div>
  );
}
