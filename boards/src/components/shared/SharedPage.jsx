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
import { Icon } from '../Icon.jsx';
import { X, MoreHorizontal } from '../../lib/icons.js';
import './sharedPage.css';

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

export function SharedPage({ onClose = null, onSaveCopy = null, feedback = null, initialTab = 'with_me', api = defaultApi }) {
  const shared = useSharedFiles({ enabled: true });
  const [tab, setTab] = useState(initialTab === 'by_me' ? 'by_me' : 'with_me');
  const [hidden, setHidden] = useState(() => new Set());     // optimistic removes
  const [stopped, setStopped] = useState(() => new Set());   // optimistic stops
  const [menu, setMenu] = useState(null);                     // { x, y, items }
  const loggedRef = useRef(false);

  const withMe = useMemo(() => shared.withMe.filter((x) => !hidden.has(x.token)), [shared.withMe, hidden]);
  const byMe = useMemo(() => shared.byMe.filter((x) => !stopped.has(x.token)), [shared.byMe, stopped]);
  const list = tab === 'with_me' ? withMe : byMe;

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
      toast({ type: 'error', message: 'Couldn’t remove it. Try again.' });
      return;
    }
    toast({
      type: 'info',
      message: `Removed ${item.name || 'the file'} from Shared with me`,
      action: {
        label: 'Undo',
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
      toast({ type: 'error', message: 'Couldn’t stop sharing. Try again.' });
      return;
    }
    notifyFileShareChanged({ boardId: row.board_id, cardId: row.card_id });
    try { logEvent(EV.FILE_SHARE_STOP, { kind: row.kind || null, undone: false }); } catch (_) {}
    toast({
      type: 'info',
      message: `Stopped sharing ${row.name || 'the file'}`,
      action: {
        label: 'Undo',
        onClick: async () => {
          const res = await api.undoStopFileShare(row.board_id, row.card_id,
            { linkAccess: data.link_access, stoppedAt: data.stopped_at });
          if (!res.error) {
            try { logEvent(EV.FILE_SHARE_STOP, { kind: row.kind || null, undone: true }); } catch (_) {}
            setStopped((s) => { const n = new Set(s); n.delete(row.token); return n; });
            notifyFileShareChanged({ boardId: row.board_id, cardId: row.card_id });
          } else {
            toast({ type: 'error', message: 'Couldn’t undo that. Share it again from the file.' });
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
        message: row.link_access === 'none' ? 'Link copied. Only people added can open it.' : 'Link copied',
      });
    } catch (_) {
      toast({ type: 'error', message: 'Couldn’t copy the link.' });
    }
  };

  const withMeMenu = (item) => composeMenuSections([
    { items: [
      { id: 'open', label: 'Open', run: () => openSharedFile({ token: item.token, via: 'shared_page' }) },
      ...(onSaveCopy && item.allow_download && SAVEABLE.has(item.kind)
        ? [{ id: 'copy', label: 'Save a copy…', run: () => onSaveCopy({ token: item.token, res: { file: item, allow_download: true } }) }]
        : []),
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'hide', label: 'Remove from Shared with me', run: () => removeFromList(item) },
    ] },
  ]);

  const byMeMenu = (row) => composeMenuSections([
    { items: [
      { id: 'manage', label: 'Manage sharing…', run: () => openFileShare({
        boardId: row.board_id, cardId: row.card_id,
        card: { id: row.card_id, kind: row.kind, fileName: row.name },
        boardName: row.board_name || null, surface: 'shared_page',
      }) },
      { id: 'link', label: 'Copy link', run: () => copyLink(row) },
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'stop', label: 'Stop sharing', danger: true, run: () => stopSharing(row) },
    ] },
  ]);

  const openMenu = (items) => (x, y) => setMenu({ x, y, items });

  return (
    <section className="shp" aria-label="Shared">
      <header className="shp-head">
        <h1 className="shp-title">Shared</h1>
        <div className="shp-tabs" role="tablist" aria-label="Shared">
          {[['with_me', 'With me', withMe.length], ['by_me', 'By me', byMe.length]].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
                    className={`shp-tab${tab === id ? ' is-on' : ''}`} onClick={() => setTab(id)}>
              {label}{n ? <span className="shp-tab-n">{n}</span> : null}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="shp-close" aria-label="Close" title="Close" onClick={onClose}>
            <Icon as={X} size={16} />
          </button>
        )}
      </header>
      <div className="shp-body" role="tabpanel">
        {!shared.loaded && shared.loading && <p className="shp-empty">Loading…</p>}
        {shared.loaded && !list.length && (
          <div className="shp-empty">
            {tab === 'with_me' ? (
              <>
                <p className="shp-empty-title">Nothing has been shared with you yet.</p>
                <p>When someone shares a file with you, it shows up here.</p>
              </>
            ) : (
              <>
                <p className="shp-empty-title">You haven’t shared any files.</p>
                <p>Open any file and use Share to send just that file.</p>
              </>
            )}
          </div>
        )}
        {shared.error && !shared.loaded && (
          <div className="shp-empty">
            <p>Couldn’t load this. </p>
            <button type="button" className="shp-retry" onClick={() => refreshSharedFiles({ force: true })}>Try again</button>
          </div>
        )}
        {!!list.length && (
          <ul className="shp-list">
            {tab === 'with_me' ? withMe.map((item) => (
              <li key={item.token} className={`shp-row${item.unread ? ' is-unread' : ''}`}>
                <button type="button" className="shp-open"
                        onClick={() => openSharedFile({ token: item.token, via: 'shared_page' })}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(withMeMenu(item))(e.clientX, e.clientY); }}>
                  <Thumb item={item} url={shared.thumbs[item.token]?.url || null} />
                  <span className="shp-main">
                    <span className="shp-name">{item.name || 'File'}</span>
                    <span className="shp-sub">
                      {item.source === 'link' ? 'Opened from a link' : `Shared by ${item.shared_by?.name || 'someone'}`}
                      {item.shared_at ? ` · ${relativeTimeShort(item.shared_at)}` : ''}
                    </span>
                  </span>
                  {item.unread && <span className="shp-dot" aria-label="New" />}
                </button>
                <RowMenuButton label={`More for ${item.name || 'this file'}`} onOpen={openMenu(withMeMenu(item))} />
              </li>
            )) : byMe.map((row) => (
              <li key={row.token} className="shp-row">
                <button type="button" className="shp-open"
                        onClick={() => openFileShare({
                          boardId: row.board_id, cardId: row.card_id,
                          card: { id: row.card_id, kind: row.kind, fileName: row.name },
                          boardName: row.board_name || null, surface: 'shared_page',
                        })}
                        onContextMenu={(e) => { e.preventDefault(); openMenu(byMeMenu(row))(e.clientX, e.clientY); }}>
                  <Thumb item={row} url={shared.thumbs[row.token]?.url || null} />
                  <span className="shp-main">
                    <span className="shp-name">{row.name || 'File'}</span>
                    <span className="shp-sub">{[row.board_name, accessSummary(row)].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
                <RowMenuButton label={`More for ${row.name || 'this file'}`} onOpen={openMenu(byMeMenu(row))} />
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
