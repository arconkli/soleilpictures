// Collapsible "BOARDS" sidebar section. Wraps the board tree + "All boards"
// row under a chevron header, mirroring the already-collapsible
// "Shared with me" (SidebarSharedBoards) section so the two read as siblings. Expanded state persists per-workspace in
// localStorage, defaulting open.

import { useState } from 'react';
import { ChevronRight, Plus, MoreHorizontal } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { SidebarBoardTree } from './SidebarBoardTree.jsx';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const EXPAND_KEY = 'soleil.boards.sb.boards.expanded';
function loadOpen(workspaceId) {
  if (typeof localStorage === 'undefined') return true;
  try {
    const raw = localStorage.getItem(`${EXPAND_KEY}.${workspaceId}`);
    return raw === null ? true : raw === '1';
  } catch (_) { return true; }
}
function saveOpen(workspaceId, open) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`${EXPAND_KEY}.${workspaceId}`, open ? '1' : '0'); } catch (_) {}
}

export function SidebarBoardsSection({
  boards,
  workspaceId,
  rootId = null,            // the workspace's root — the tree opens it and sorts its children by recency
  renameRequest = null,     // { boardId, at } — a project just made from "+" asks for its name in its row
  activeBoardId,
  onOpenBoard,
  onShareBoard,             // (boardId) => void — context-menu "Share…"
  onRenameBoard,
  onCreateBoard = null,     // () => void — also used as the header "+" when present
  onCreateBoardInside,      // (parentBoardId) => void — context-menu "New board inside"
  onSetBoardCover,          // (boardId, coverKey|null) => void
  onResetBoardThumb,        // (boardId) => Promise — revert to auto thumbnail
  onCopyBoard,              // (board) => void
  onPasteBoardInto,         // (targetBoardId) => void
  onDeleteBoard,            // (boardId) => void
  canEditBoard,             // (boardId) => boolean
  onOpenPicker,             // () => void — the "All boards" row opens the picker
  peersHereByBoard,
  peersBelowByBoard,
  onJumpToPeer,
  starStore = null,         // the files sidebar's stars (SidebarBoardTree's `starStore`)
  filesView = null,         // the files sidebar's hook-in (SidebarBoardTree's `filesView`)
}) {
  const [open, setOpen] = useState(() => loadOpen(workspaceId));
  const toggle = () => setOpen(v => { const next = !v; saveOpen(workspaceId, next); return next; });
  const count = boards ? Object.keys(boards).length : 0;

  return (
    <div className="sb-boards">
      <div className="sb-eyebrow sb-boards-head"
           onClick={toggle}
           role="button" tabIndex={0}
           aria-expanded={open}>
        <span className={`sb-boards-chev ${open ? 'is-open' : ''}`} aria-hidden="true">
          <Icon as={ChevronRight} size={11} />
        </span>
        {/* Capitalised by .sb-eyebrow; the files sidebar shows it as written. */}
        <span className="sb-boards-head-label"><Trans>Clusters</Trans></span>
        {count > 0 && <span className="sb-boards-count">{count}</span>}
        {onCreateBoard && (
          <button className="sb-boards-add"
                  title={t`New project`}
                  onClick={(e) => { e.stopPropagation(); onCreateBoard(); }}>
            <Icon as={Plus} size={11} />
          </button>
        )}
      </div>

      {open && (
        <>
          <SidebarBoardTree
            boards={boards}
            workspaceId={workspaceId}
            rootId={rootId}
            renameRequest={renameRequest}
            activeBoardId={activeBoardId}
            onOpenBoard={onOpenBoard}
            onShareBoard={onShareBoard}
            onRenameBoard={onRenameBoard}
            onCreateBoard={onCreateBoard}
            onCreateBoardInside={onCreateBoardInside}
            onSetBoardCover={onSetBoardCover}
            onResetBoardThumb={onResetBoardThumb}
            onCopyBoard={onCopyBoard}
            onPasteBoardInto={onPasteBoardInto}
            onDeleteBoard={onDeleteBoard}
            canEditBoard={canEditBoard}
            peersHereByBoard={peersHereByBoard}
            peersBelowByBoard={peersBelowByBoard}
            onJumpToPeer={onJumpToPeer}
            filesView={filesView}
            starStore={starStore}
          />
          <div className="sb-row sb-row-all" onClick={onOpenPicker}>
            <Icon as={MoreHorizontal} size={14} />
            <span className="sb-row-label"><Trans>All clusters</Trans></span>
          </div>
        </>
      )}
    </div>
  );
}
