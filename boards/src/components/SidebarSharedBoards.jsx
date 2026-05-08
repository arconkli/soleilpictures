// "Shared with me" sidebar section. Lists boards shared with the
// current user via per-board shares (where they're NOT a workspace
// member of the source workspace). Grouped by source workspace name,
// collapsed by default to avoid clutter.

import { useState } from 'react';
import { COVER_TINTS } from './primitives.jsx';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { Eye } from '../lib/icons.js';
import { Icon } from './Icon.jsx';

const EXPAND_KEY = 'soleil.boards.sb.shared.expanded';

function loadExpanded() {
  if (typeof localStorage === 'undefined') return { root: false, groups: {} };
  try {
    const raw = localStorage.getItem(EXPAND_KEY);
    return raw ? JSON.parse(raw) : { root: false, groups: {} };
  } catch (_) { return { root: false, groups: {} }; }
}
function saveExpanded(state) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(EXPAND_KEY, JSON.stringify(state)); } catch (_) {}
}

export function SidebarSharedBoards({
  shared = [],     // rows from list_shared_boards
  activeBoardId,
  onOpenBoard,
}) {
  const [exp, setExp] = useState(loadExpanded);

  if (!shared || shared.length === 0) return null;

  // Group rows by source workspace.
  const groups = new Map();
  for (const row of shared) {
    const key = row.source_workspace_id || '__none__';
    if (!groups.has(key)) {
      groups.set(key, { name: row.source_workspace_name || 'Unknown', rows: [] });
    }
    groups.get(key).rows.push(row);
  }

  const setRoot = (open) => {
    const next = { ...exp, root: open };
    setExp(next); saveExpanded(next);
  };
  const setGroupOpen = (gid, open) => {
    const next = { ...exp, groups: { ...exp.groups, [gid]: open } };
    setExp(next); saveExpanded(next);
  };

  return (
    <div className="sb-shared">
      <div className="sb-eyebrow sb-shared-head"
           onClick={() => setRoot(!exp.root)}
           role="button" tabIndex={0}>
        <span className={`sb-shared-chev ${exp.root ? 'is-open' : ''}`}>▸</span>
        SHARED WITH ME · {shared.length}
      </div>
      {exp.root && (
        <div className="sb-shared-body">
          {[...groups.entries()].map(([gid, group]) => {
            const open = exp.groups[gid] !== false; // groups default OPEN once parent is opened
            return (
              <div key={gid} className="sb-shared-group">
                <div className="sb-shared-group-head"
                     onClick={() => setGroupOpen(gid, !open)}
                     role="button" tabIndex={0}>
                  <span className={`sb-shared-chev ${open ? 'is-open' : ''}`}>▸</span>
                  <span className="sb-shared-group-name">From {group.name}</span>
                </div>
                {open && (
                  <div className="sb-shared-rows">
                    {group.rows.map(row => {
                      const isActive = row.board_id === activeBoardId;
                      const tint = COVER_TINTS[row.board_cover || 'neutral'] || COVER_TINTS.neutral;
                      return (
                        <div key={row.board_id}
                             className={`sb-row sb-shared-row ${isActive ? 'active' : ''}`}
                             onMouseEnter={() => prefetchBoard(row.board_id)}
                             onClick={() => onOpenBoard?.(row.board_id)}
                             title={`${row.board_name} · ${row.role === 'viewer' ? 'view only' : 'editor'}`}>
                          <span className="sb-dot"
                                style={{ background: isActive ? 'var(--soleil)' : tint }} />
                          <span className="sb-row-label">{row.board_name}</span>
                          {row.role === 'viewer' && (
                            <span className="sb-shared-eye" title="View only">
                              <Icon as={Eye} size={11} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
