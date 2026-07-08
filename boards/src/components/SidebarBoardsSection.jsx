// Collapsible "BOARDS" sidebar section. Wraps the board tree + "All boards"
// row under a chevron header, mirroring the already-collapsible TAGS
// (SidebarTags) and "Shared with me" (SidebarSharedBoards) sections so the
// three read as siblings. Expanded state persists per-workspace in
// localStorage, defaulting open.

import { useState } from 'react';
import { ChevronRight, Plus, MoreHorizontal } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { SidebarBoardTree } from './SidebarBoardTree.jsx';

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
  activeBoardId,
  onOpenBoard,
  onRenameBoard,
  onCreateBoard = null,     // () => void — also used as the header "+" when present
  onCreateBoardInside,      // (parentBoardId) => void — context-menu "New board inside"
  onSetBoardCover,          // (boardId, coverKey|null) => void
  onSetBoardBgColor,        // (boardId, hex|null) => void
  onSetBoardThumb,          // (boardId, blob) => Promise — custom thumbnail
  onResetBoardThumb,        // (boardId) => Promise — revert to auto thumbnail
  onCopyBoard,              // (board) => void
  onPasteBoardInto,         // (targetBoardId) => void
  onDeleteBoard,            // (boardId) => void
  canEditBoard,             // (boardId) => boolean
  onOpenPicker,             // () => void — the "All boards" row opens the picker
  peersHereByBoard,
  peersBelowByBoard,
  onJumpToPeer,
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
        <span className="sb-boards-head-label">CLUSTERS</span>
        {count > 0 && <span className="sb-boards-count">{count}</span>}
        {onCreateBoard && (
          <button className="sb-boards-add"
                  title="New cluster"
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
            activeBoardId={activeBoardId}
            onOpenBoard={onOpenBoard}
            onRenameBoard={onRenameBoard}
            onCreateBoard={onCreateBoard}
            onCreateBoardInside={onCreateBoardInside}
            onSetBoardCover={onSetBoardCover}
            onSetBoardBgColor={onSetBoardBgColor}
            onSetBoardThumb={onSetBoardThumb}
            onResetBoardThumb={onResetBoardThumb}
            onCopyBoard={onCopyBoard}
            onPasteBoardInto={onPasteBoardInto}
            onDeleteBoard={onDeleteBoard}
            canEditBoard={canEditBoard}
            peersHereByBoard={peersHereByBoard}
            peersBelowByBoard={peersBelowByBoard}
            onJumpToPeer={onJumpToPeer}
          />
          <div className="sb-row sb-row-all" onClick={onOpenPicker}>
            <Icon as={MoreHorizontal} size={14} />
            <span className="sb-row-label">All clusters</span>
          </div>
        </>
      )}
    </div>
  );
}
