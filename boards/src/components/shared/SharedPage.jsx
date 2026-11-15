// The Shared page: what happens to a file once it's shared (owner,
// 2026-10-18). Two tabs:
//   With me — files people added you to, and files you opened from a link
//             while signed in (0424 list_shared_with_me). Open one and it
//             plays over the app (lib/sharedFileBus.js); Save a copy; take it
//             off the list (with undo; it changes nothing for the sharer).
//   By me   — what you've shared that is still shared (list_my_file_shares):
//             Manage (the owner's dialog), Copy link, Stop sharing (with undo,
//             which brings back exactly who was removed and emails nobody).
// Rows are plain: a small picture or the file's type, the name, one line of
// who and when. Unread is a neutral dot; gold stays for focus and selection.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSharedFiles, loadSharedThumbs, refreshSharedFiles } from '../../hooks/useSharedFiles.js';
import { hideSharedFile, stopFileShare, undoStopFileShare, fileShareUrl } from '../../lib/fileShares.js';
import { accessSummary, typeTile } from '../../lib/sharedFiles.js';
import { openSharedFile, notifySharedFilesChanged } from '../../lib/sharedFileBus.js';
import { openFileShare, notifyFileShareChanged } from '../../lib/fileShareBus.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { composeMenuSections, SECTION } from '../../lib/contextMenuSections.js';
import { CardContextMenu } from '../CardContextMenu.jsx';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { matchesFind, findHitKind, findTokens } from '../../lib/sharedPeople.js';
import { trackFindUsed } from '../../lib/findUsed.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { formatNumber } from '../../lib/intlFormat.js';
import { Icon } from '../Icon.jsx';
import { X, MoreHorizontal } from '../../lib/icons.js';
import './sharedPage.css';
import { t as tr, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const SAVEABLE = new Set(['image', 'video', 'audio', 'pdf', 'file']);
const defaultApi = { hideSharedFile, stopFileShare, undoStopFileShare };

function Thumb({ item, url }) {
  return (
    <span className="shp-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="shp-thumb-type">{typeTile(item)}</span>}
    </span>
  );
}

function RowMenuButton({ label, onOpen }) {
  return (
    <button type="button" className="shp-more" aria-label={label} title={label}
            onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpen(r.right - 8, r.bottom + 4); }}>
      <Icon as={MoreHorizontal} size={18} weight="bold" />
    </button>
  );
}

export function SharedPage({ onClose = null, onSaveCopy = null, onAddShortcut = null, feedback = null, initialTab = 'with_me', api = defaultApi }) {
  const shared = useSharedFiles({ enabled: true });
  const [tab, setTab] = useState(initialTab === 'by_me' ? 'by_me' : 'with_me');
  const [hidden, setHidden] = useState(() => new Set());     // optimistic removes
  const [stopped, setStopped] = useState(() => new Set());   // optimistic stops
  const [menu, setMenu] = useState(null);                     // { x, y, items }
  const [q, setQ] = useState('');
  const loggedRef = useRef(false);
  const findRef = useRef(null);

  const withMe = useMemo(() => shared.withMe.filter((x) => !hidden.has(x.token)), [shared.withMe, hidden]);
  const byMe = useMemo(() => shared.byMe.filter((x) => !stopped.has(x.token)), [shared.byMe, stopped]);
  const tabList = tab === 'with_me' ? withMe : byMe;
  const showFind = tabList.length > 6;
  const searching = showFind && findTokens(q).length > 0;
  // With me: the file and who shared it. By me: the file and its cluster
  // (list_my_file_shares carries a count of people, not their names).
  const personOf = (item) => (item.source === 'link' ? null : item.shared_by?.name || null);
  const list = useMemo(() => {
    if (!searching) return tabList;
    return tab === 'with_me'
      ? tabList.filter((x) => matchesFind(q, [x.name, personOf(x)]))
      : tabList.filter((x) => matchesFind(q, [x.name, x.board_name]));
  }, [tabList, tab, q, searching]);  // eslint-disable-line react-hooks/exhaustive-deps
  const hitKind = (row) => (tab === 'with_me'
    ? findHitKind(q, [row.name], [personOf(row)])
    : findHitKind(q, [row.name, row.board_name], [])) || 'name';
  const picked = (row) => {
    if (searching) trackFindUsed({ surface: 'shared_page', nItems: list.length, by: hitKind(row) });
  };
  const switchTab = (id) => { setTab(id); setQ(''); };

  useEffect(() => {
    if (!shared.loaded || loggedRef.current) return;
    loggedRef.current = true;
    try { logEvent(EV.SHARED_PAGE_VIEW, { tab, n: withMe.length, unread: shared.unread }); } catch (_) {}
  }, [shared.loaded]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Pictures for the rows on this tab.
  useEffect(() => {
    const tokens = list.filter((x) => x.kind && x.kind !== 'file' && x.kind !== 'doc').map((x) => x.token).slice(0, 50);
    if (tokens.length) void loadSharedThumbs(tokens);
  }, [list]);

  const toast = (t) => { try { feedback?.toast?.(t); } catch (_) {} };

  const removeFromList = async (item) => {
    setHidden((s) => new Set(s).add(item.token));
    const { error } = await api.hideSharedFile(item.token, true);
    try { logEvent(EV.SHARED_FILE_HIDE, { hidden: true }); } catch (_) {}
    if (error) {
      setHidden((s) => { const n = new Set(s); n.delete(item.token); return n; });
      toast({ type: 'error', code: 'shared_file_hide_failed', message: tr`Couldn’t remove it. Try again.` });
      return;
    }
    toast({
      type: 'info',
      message: tr`Removed ${ph({ name: item.name || tr`the file` })} from Shared with me`,
      action: {
        label: tr`Undo`,
        onClick: async () => {
          const res = await api.hideSharedFile(item.token, false);
          try { logEvent(EV.SHARED_FILE_HIDE, { hidden: false }); } catch (_) {}
          if (!res.error) {
            setHidden((s) => { const n = new Set(s); n.delete(item.token); return n; });
            notifySharedFilesChanged();
          }
        },
      },
    });
    notifySharedFilesChanged();
  };

  const stopSharing = async (row) => {
    setStopped((s) => new Set(s).add(row.token));
    const { data, error } = await api.stopFileShare(row.board_id, row.card_id);
    if (error || !data) {
      setStopped((s) => { const n = new Set(s); n.delete(row.token); return n; });
      toast({ type: 'error', code: 'file_share_stop_failed', message: tr`Couldn’t stop sharing. Try again.` });
      return;
    }
    notifyFileShareChanged({ boardId: row.board_id, cardId: row.card_id });
    try { logEvent(EV.FILE_SHARE_STOP, { kind: row.kind || null, undone: false }); } catch (_) {}
    toast({
      type: 'info',
      message: tr`Stopped sharing ${ph({ name: row.name || tr`the file` })}`,
      action: {
        label: tr`Undo`,
        onClick: async () => {
          const res = await api.undoStopFileShare(row.board_id, row.card_id,
            { linkAccess: data.link_access, stoppedAt: data.stopped_at });
          if (!res.error) {
            try { logEvent(EV.FILE_SHARE_STOP, { kind: row.kind || null, undone: true }); } catch (_) {}
            setStopped((s) => { const n = new Set(s); n.delete(row.token); return n; });
            notifyFileShareChanged({ boardId: row.board_id, cardId: row.card_id });
          } else {
            toast({ type: 'error', code: 'file_share_undo_failed', message: tr`Couldn’t undo that. Share it again from the file.` });
          }
        },
      },
    });
  };

  const copyLink = async (row) => {
    try {
      await navigator.clipboard.writeText(fileShareUrl(row.token));
      toast({
        type: 'success',
        message: row.link_access === 'none' ? tr`Link copied. Only people added can open it.` : tr`Link copied`,
      });
    } catch (_) {
      toast({ type: 'error', code: 'link_copy_failed', message: tr`Couldn’t copy the link.` });
    }
  };

  const withMeMenu = (item) => composeMenuSections([
    { items: [
      { id: 'open', label: tr`Open`, run: () => openSharedFile({ token: item.token, via: 'shared_page' }) },
      ...(onSaveCopy && item.allow_download && SAVEABLE.has(item.kind)
        ? [{ id: 'copy', label: tr`Save a copy…`, run: () => onSaveCopy({ token: item.token, res: { file: item, allow_download: true } }) }]
        : []),
      // A live card on one of your clusters that opens this file (only the
      // share's token goes on it: components/cards/ShortcutCard.jsx).
      ...(onAddShortcut
        ? [{ id: 'shortcut', label: tr`Add shortcut…`, run: () => onAddShortcut({ token: item.token, res: { file: item } }) }]
        : []),
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'hide', label: tr`Remove from Shared with me`, run: () => removeFromList(item) },
    ] },
  ]);

  const byMeMenu = (row) => composeMenuSections([
    { items: [
      { id: 'manage', label: tr`Manage sharing…`, run: () => openFileShare({
        boardId: row.board_id, cardId: row.card_id,
        card: { id: row.card_id, kind: row.kind, fileName: row.name },
        boardName: row.board_name || null, surface: 'shared_page',
      }) },
      { id: 'link', label: tr`Copy link`, run: () => copyLink(row) },
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'stop', label: tr`Stop sharing`, danger: true, run: () => stopSharing(row) },
    ] },
  ]);

  const openMenu = (items) => (x, y) => setMenu({ x, y, items });

  return (
    <section className="shp" aria-label={tr`Shared`}>
      <header className="shp-head">
        <h1 className="shp-title"><Trans>Shared</Trans></h1>
        <div className="shp-tabs" role="tablist" aria-label={tr`Shared`}>
          {[['with_me', tr`With me`, withMe.length], ['by_me', tr`By me`, byMe.length]].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
                    className={`shp-tab${tab === id ? ' is-on' : ''}`} onClick={() => switchTab(id)}>
              {label}{n ? <span className="shp-tab-n">{n}</span> : null}
            </button>
          ))}
        </div>
        {showFind && (
          <div className="shp-find">
            <input ref={findRef} type="text" className="shp-find-input" value={q}
                   placeholder={tab === 'with_me' ? tr`Find a file or person…` : tr`Find a file or cluster…`}
                   aria-label={tab === 'with_me' ? tr`Find a file or person…` : tr`Find a file or cluster…`}
                   autoComplete="off" spellCheck={false}
                   onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); } }} />
            {q && (
              <button type="button" className="shp-find-x" aria-label={tr`Clear search`} title={tr`Clear search`}
                      onClick={() => { setQ(''); findRef.current?.focus(); }}>
                <Icon as={X} size={14} />
              </button>
            )}
          </div>
        )}
        {onClose && (
          <button type="button" className="shp-close" aria-label={tr`Close`} title={tr`Close`} onClick={onClose}>
            <Icon as={X} size={16} />
          </button>
        )}
      </header>
      <div className="shp-body" role="tabpanel">
        {!shared.loaded && shared.loading && <p className="shp-empty"><Trans>Loading…</Trans></p>}
        {searching && !!list.length && (
          <p className="shp-count">{tr`${ph({ shown: formatNumber(list.length) })} of ${ph({ total: formatNumber(tabList.length) })}`}</p>
        )}
        {searching && !list.length && (
          <div className="shp-empty"><p>{tr`Nothing here matches “${ph({ q: q.trim() })}”.`}</p></div>
        )}
        {shared.loaded && !tabList.length && (
          <div className="shp-empty">
            {tab === 'with_me' ? (
              <>
                <p className="shp-empty-title"><Trans>Nothing has been shared with you yet.</Trans></p>
                <p><Trans>When someone shares a file with you, it shows up here.</Trans></p>
              </>
            ) : (
              <>
                <p className="shp-empty-title"><Trans>You haven’t shared any files.</Trans></p>
                <p><Trans>Open any file and use Share to send just that file.</Trans></p>
              </>
            )}
          </div>
        )}
        {shared.error && !shared.loaded && (
          <div className="shp-empty">
            <p><Trans>Couldn’t load this.</Trans> </p>
            <button type="button" className="shp-retry" onClick={() => refreshSharedFiles({ force: true })}><Trans>Try again</Trans></button>
          </div>
        )}
        {!!list.length && (
          <ul className="shp-list">
            {tab === 'with_me' ? list.map((item) => (
              <li key={item.token} className={`shp-row${item.unread ? ' is-unread' : ''}`}>
                <button type="button" className="shp-open"
                        onClick={() => { picked(item); openSharedFile({ token: item.token, via: 'shared_page' }); }}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(withMeMenu(item))(e.clientX, e.clientY); }}>
                  <Thumb item={item} url={shared.thumbs[item.token]?.url || null} />
                  <span className="shp-main">
                    <span className="shp-name" dir="auto">{item.name || tr`File`}</span>
                    <span className="shp-sub">
                      {item.source === 'link' ? tr`Opened from a link` : tr`Shared by ${ph({ name: item.shared_by?.name || tr`someone` })}`}
                      {item.shared_at ? ` · ${relativeTimeShort(item.shared_at)}` : ''}
                    </span>
                  </span>
                  {item.unread && <span className="shp-dot" aria-label={tr({ message: 'New', context: 'badge' })} />}
                </button>
                <RowMenuButton label={tr`More for ${ph({ name: item.name || tr`this file` })}`} onOpen={openMenu(withMeMenu(item))} />
              </li>
            )) : list.map((row) => (
              <li key={row.token} className="shp-row">
                <button type="button" className="shp-open"
                        onClick={() => {
                          picked(row);
                          openFileShare({
                            boardId: row.board_id, cardId: row.card_id,
                            card: { id: row.card_id, kind: row.kind, fileName: row.name },
                            boardName: row.board_name || null, surface: 'shared_page',
                          });
                        }}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(byMeMenu(row))(e.clientX, e.clientY); }}>
                  <Thumb item={row} url={shared.thumbs[row.token]?.url || null} />
                  <span className="shp-main">
                    <span className="shp-name" dir="auto">{row.name || tr`File`}</span>
                    <span className="shp-sub">{[row.board_name, accessSummary(row)].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <RowMenuButton label={tr`More for ${ph({ name: row.name || tr`this file` })}`} onOpen={openMenu(byMeMenu(row))} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {menu && createPortal(
        <CardContextMenu open x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} card={null} />,
        document.body,
      )}
    </section>
  );
}

export default SharedPage;
