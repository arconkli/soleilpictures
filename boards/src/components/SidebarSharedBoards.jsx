// "Shared with me" sidebar section. Lists boards shared with the
// current user via per-board shares (where they're NOT a workspace
// member of the source workspace). Grouped by source workspace name,
// collapsed by default to avoid clutter.

import { useState } from 'react';
import { COVER_TINTS } from './primitives.jsx';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

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
  // The Shared page's entry, when there is anything on it (files shared with
  // you or by you): { unread, active, onOpen }. It sits under the heading and
  // shows whether or not the clusters are folded.
  filesRow = null,
}) {
  const [exp, setExp] = useState(loadExpanded);

  const hasBoards = !!shared && shared.length > 0;
  if (!hasBoards && !filesRow) return null;

  // Group rows by source workspace.
  const groups = new Map();
  for (const row of shared) {
    const key = row.source_workspace_id || '__none__';
    if (!groups.has(key)) {
      groups.set(key, { name: row.source_workspace_name || t`Unknown`, rows: [] });
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
      {hasBoards ? (
        <div className="sb-eyebrow sb-shared-head"
             onClick={() => setRoot(!exp.root)}
             role="button" tabIndex={0}>
          <span className={`sb-shared-chev ${exp.root ? 'is-open' : ''}`}>▸</span>
          <Trans>Shared with me</Trans><span className="sb-shared-count"> · {shared.length}</span>
        </div>
      ) : (
        <div className="sb-eyebrow sb-shared-head"><Trans>Shared with me</Trans></div>
      )}
      {filesRow && (
        <div className={`sb-row sb-shared-row sb-shared-files ${filesRow.active ? 'active' : ''}`}
             role="button" tabIndex={0}
             onClick={() => filesRow.onOpen?.()}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filesRow.onOpen?.(); } }}
             title={t`Files shared with you, and files you've shared`}>
          <span className="sb-row-label"><Trans>Shared files</Trans></span>
          {filesRow.unread > 0 && (
            <span className="sb-shared-unread" aria-label={t`${ph({ unread: filesRow.unread })} new`}>{filesRow.unread}</span>
          )}
        </div>
      )}
      {hasBoards && exp.root && (
        <div className="sb-shared-body">
          {[...groups.entries()].map(([gid, group]) => {
            const open = exp.groups[gid] !== false; // groups default OPEN once parent is opened
            return (
              <div key={gid} className="sb-shared-group">
                <div className="sb-shared-group-head"
                     onClick={() => setGroupOpen(gid, !open)}
                     role="button" tabIndex={0}>
                  <span className={`sb-shared-chev ${open ? 'is-open' : ''}`}>▸</span>
                  <span className="sb-shared-group-name"><Trans>From {ph({ name: group.name })}</Trans></span>
                </div>
                {open && (
                  <div className="sb-shared-rows">
                    {group.rows.map(row => {
                      const isActive = row.board_id === activeBoardId;
                      const tint = COVER_TINTS[row.board_cover || 'neutral'] || COVER_TINTS.neutral;
                      return (
                        <div key={row.board_id}
                             className={`sb-row sb-shared-row ${isActive ? 'active' : ''}`}
                             // Another workspace's cluster: the drag label says files
                             // can't go there (lib/dropRules.js); nothing here takes them.
                             data-drop-board={row.board_id}
                             data-drop-ws={row.source_workspace_id || 'elsewhere'}
                             data-drop-ws-name={row.source_workspace_name || ''}
                             data-drop-name={row.board_name || ''}
                             onMouseEnter={() => prefetchBoard(row.board_id)}
                             onClick={() => onOpenBoard?.(row.board_id)}
                             title={row.role === 'viewer' ? t`${ph({ name: row.board_name })} · view only` : t`${ph({ name: row.board_name })} · editor`}>
                          <span className="sb-dot"
                                style={{ background: isActive ? 'var(--soleil)' : tint }} />
                          <span className="sb-row-label" dir="auto">{row.board_name}</span>
                          {row.role === 'viewer' && (
                            <span className="sb-shared-ro" title={t`View only`}><Trans context="permission">View</Trans></span>
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
