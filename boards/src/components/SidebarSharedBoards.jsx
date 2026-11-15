// "Shared with me" sidebar section. Lists boards shared with the
// current user via per-board shares (where they're NOT a workspace
// member of the source workspace). Grouped by source workspace name,
// collapsed by default to avoid clutter.

import { useMemo, useRef, useState } from 'react';
import { COVER_TINTS } from './primitives.jsx';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { groupSharedByPerson, matchesFind, findHitKind, findTokens } from '../lib/sharedPeople.js';
import { sharedGroupHead } from '../lib/sharedPeopleWords.js';
import { trackFindUsed } from '../lib/findUsed.js';
import { initialOf } from '../lib/graphemes.js';
import { cssColor } from '../lib/presenceCss.js';
import { isComposingKey } from '../lib/composerKeys.js';
import './sidebar/sidebarSharedFind.css';

const GROUP_CAP = 5;      // rows a person's group shows before "Show # more"
const FIND_OVER = 6;      // the find field appears above this many shared clusters
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
  const [q, setQ] = useState('');
  const [more, setMore] = useState({});       // group key -> showing every row
  const inputRef = useRef(null);

  // One group per person (the workspace when the server didn't say who).
  const groups = useMemo(() => groupSharedByPerson(shared), [shared]);

  const hasBoards = !!shared && shared.length > 0;
  if (!hasBoards && !filesRow) return null;

  const showFind = shared.length > FIND_OVER;
  const searching = showFind && findTokens(q).length > 0;
  const rowMatches = (row, g) => matchesFind(q, [row.board_name, g.personName, row.source_workspace_name]);
  const shownGroups = searching
    ? groups.map((g) => ({ g, rows: g.rows.filter((r) => rowMatches(r, g)) })).filter((x) => x.rows.length)
    : groups.map((g) => ({ g, rows: g.rows }));
  const matchCount = shownGroups.reduce((n, x) => n + x.rows.length, 0);

  const openRow = (row, g) => {
    if (searching) {
      trackFindUsed({
        surface: 'shared_sidebar',
        nItems: matchCount,
        by: findHitKind(q, [row.board_name], [g.personName, row.source_workspace_name]) || 'name',
      });
    }
    onOpenBoard?.(row.board_id);
  };

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
             onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filesRow.onOpen?.(); } }}
             title={t`Files shared with you, and files you've shared`}>
          <span className="sb-row-label"><Trans>Shared files</Trans></span>
          {filesRow.unread > 0 && (
            <span className="sb-shared-unread" aria-label={t`${ph({ unread: filesRow.unread })} new`}>{filesRow.unread}</span>
          )}
        </div>
      )}
      {hasBoards && exp.root && (
        <div className="sb-shared-body">
          {showFind && (
            <div className="sb-shared-find">
              <input ref={inputRef} type="text" className="sb-shared-find-input" value={q}
                     placeholder={t`Find a cluster or person…`} aria-label={t`Find a cluster or person…`}
                     autoComplete="off" spellCheck={false}
                     onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => {
                       e.stopPropagation();
                       if (isComposingKey(e)) return;
                       if (e.key === 'Escape') {
                         e.preventDefault();
                         if (q) setQ(''); else inputRef.current?.blur();
                       } else if (e.key === 'Enter' && searching && shownGroups.length) {
                         e.preventDefault();
                         openRow(shownGroups[0].rows[0], shownGroups[0].g);
                       }
                     }} />
              {q && (
                <button type="button" className="sb-shared-find-x" aria-label={t`Clear search`} title={t`Clear search`}
                        onClick={() => { setQ(''); inputRef.current?.focus(); }}>✕</button>
              )}
            </div>
          )}
          {searching && !shownGroups.length && (
            <div className="sb-shared-empty">{t`Nothing shared with you matches “${ph({ q: q.trim() })}”.`}</div>
          )}
          {shownGroups.map(({ g, rows }) => {
            const gid = g.key;
            const open = searching || exp.groups[gid] !== false; // groups default OPEN once parent is opened
            const activeHidden = !searching && rows.slice(GROUP_CAP).some((r) => r.board_id === activeBoardId);
            const showAll = searching || more[gid] || activeHidden || rows.length <= GROUP_CAP;
            const visible = showAll ? rows : rows.slice(0, GROUP_CAP);
            const hiddenN = rows.length - visible.length;
            return (
              <div key={gid} className="sb-shared-group">
                <div className="sb-shared-group-head"
                     onClick={() => { if (!searching) setGroupOpen(gid, !open); }}
                     role="button" tabIndex={0}>
                  <span className={`sb-shared-chev ${open ? 'is-open' : ''}`}>▸</span>
                  {g.personName && (
                    <span className="sb-shared-pv" aria-hidden="true"
                          style={g.personColor ? { background: cssColor(g.personColor) } : undefined}>{initialOf(g.personName)}</span>
                  )}
                  <span className="sb-shared-group-name">{sharedGroupHead(g)}</span>
                </div>
                {open && (
                  <div className="sb-shared-rows">
                    {visible.map(row => {
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
                             onClick={() => openRow(row, g)}
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
                    {hiddenN > 0 && (
                      <button type="button" className="sb-shared-more"
                              onClick={() => setMore((m) => ({ ...m, [gid]: true }))}>
                        {plural(hiddenN, { one: 'Show # more', other: 'Show # more' })}
                      </button>
                    )}
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
