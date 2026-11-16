// The Shared page: everything shared with you or by you, clusters and files
// together (owner, 2026-11-15; reworked from the files-only page of 2026-10-18).
// Two tabs:
//   With you — clusters people shared with you and files they added you to or
//              you opened from a link, grouped by who shared them (lib/
//              sharedList.js). A cluster opens in the app; a file plays over it
//              (lib/sharedFileBus.js). Remove from my list changes nothing for
//              the sharer, and undoes.
//   By you   — what you've shared that is still shared, newest first, with who
//              has it. Clusters: Open, Manage sharing, Copy link. Files: Manage,
//              Copy link, Stop sharing (with undo, which brings back exactly who
//              was removed and emails nobody).
// A search box sits above both. New is a neutral dot; gold stays for focus and
// selection.
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
import { PersonFace } from '../PersonFace.jsx';
import { COVER_TINTS } from '../primitives.jsx';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { findTokens, isUnnamedWorkspace } from '../../lib/sharedPeople.js';
import {
  withYouItems, groupWithYou, byYouItems, filterGroups, countItems, itemHitKind,
} from '../../lib/sharedList.js';
import { trackFindUsed } from '../../lib/findUsed.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { namesList } from '../../lib/intlFormat.js';
import { Icon } from '../Icon.jsx';
import { X, MoreHorizontal, Link, Stack } from '../../lib/icons.js';
import './sharedPage.css';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const SAVEABLE = new Set(['image', 'video', 'audio', 'pdf', 'file']);
const defaultApi = { hideSharedFile, stopFileShare, undoStopFileShare };


// The words a row shows for what it is; also what a typed search can match,
// in the reader's language. Called at render.
function kindLabel(item) {
  if (item.type === 'cluster') return tr`Cluster`;
  const kind = item.row?.kind;
  return ({ video: tr`Video`, audio: tr`Audio`, image: tr`Image`, pdf: tr`PDF`, file: tr`File`, doc: tr`Doc` })[kind] || tr`File`;
}

// Who has it, as one sentence: "Maya, Leo and 3 others". Names the server
// didn't give leave a count. Two names are two placeholders, so each language
// sets its own comma: a list join reads "Maya Chen Leo Brandt" in Japanese and
// Russian and says "and" twice in Spanish.
function peopleLine(item) {
  const n = Math.max(0, Number(item.peopleCount) || 0);
  if (!n) return null;
  const names = (item.people || []).map((p) => p.name).filter(Boolean).slice(0, 2);
  if (!names.length) return plural(n, { one: 'Shared with # person', other: 'Shared with # people' });
  const others = n - names.length;
  if (others <= 0) return namesList(names);
  if (names.length === 1) {
    return plural(others, { one: `${ph({ names: names[0] })} and # other`, other: `${ph({ names: names[0] })} and # others` });
  }
  const rest = others;  // named as in lib/messagesCard.js, so both read the same translated words
  return tr`${ph({ first: names[0] })}, ${ph({ second: names[1] })} and ${plural(rest, { one: '# other', other: '# others' })}`;
}

function Thumb({ item, url }) {
  if (item.type === 'cluster') {
    const tint = COVER_TINTS[item.cover || item.row?.board_cover || 'neutral'] || COVER_TINTS.neutral;
    return (
      <span className="shp-thumb shp-thumb-cluster" style={{ '--shp-tint': tint }} aria-hidden="true">
        <Icon as={Stack} size={18} />
      </span>
    );
  }
  const tile = typeTile(item.row);
  return (
    <span className="shp-thumb" aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className={`shp-thumb-type${tile.length > 4 ? ' is-long' : ''}`}>{tile}</span>}
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

function GroupHead({ g }) {
  let face;
  let name;
  if (g.kind === 'person') {
    face = <PersonFace userId={g.personId || undefined} name={g.personName || ''} color={g.personColor || undefined}
                       url={g.avatarUrl || undefined} size={22} className="shp-face" ariaHidden />;
    name = g.personName;
  } else if (g.kind === 'workspace') {
    face = <span className="shp-gface" aria-hidden="true"><Icon as={Stack} size={13} /></span>;
    name = isUnnamedWorkspace(g.workspaceName) ? tr`Workspace` : g.workspaceName;
  } else if (g.kind === 'links') {
    face = <span className="shp-gface" aria-hidden="true"><Icon as={Link} size={13} /></span>;
    name = tr`From links`;
  } else {
    face = <span className="shp-gface" aria-hidden="true">?</span>;
    name = tr`Someone on Clusters`;
  }
  return (
    <div className="shp-gh">
      {face}
      <span className="shp-gh-name" dir="auto">{name}</span>
      <span className="shp-gh-n">{g.items.length}</span>
    </div>
  );
}

export function SharedPage({
  onClose = null, onSaveCopy = null, onAddShortcut = null, feedback = null,
  initialTab = 'with_me', api = defaultApi,
  focusSearch = false,
  clusters = [], meta = null, byYouClusters = [], byYouLoaded = true,
  onRefreshByYou = null, onOpenBoard = null, onOpenOwnBoard = null,
  onRemoveCluster = null, onCopyClusterLink = null, onManageClusterSharing = null,
}) {
  const shared = useSharedFiles({ enabled: true });
  const [tab, setTab] = useState(initialTab === 'by_me' ? 'by_me' : 'with_me');
  const [hidden, setHidden] = useState(() => new Set());     // optimistic file removes
  const [stopped, setStopped] = useState(() => new Set());   // optimistic file stops
  const [menu, setMenu] = useState(null);                     // { x, y, items }
  const [q, setQ] = useState('');
  const loggedRef = useRef(false);
  const findRef = useRef(null);

  useEffect(() => { try { onRefreshByYou?.(); } catch (_) {} }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusSearch) findRef.current?.focus(); }, [focusSearch]);

  const withMe = useMemo(() => shared.withMe.filter((x) => !hidden.has(x.token)), [shared.withMe, hidden]);
  const byMe = useMemo(() => shared.byMe.filter((x) => !stopped.has(x.token)), [shared.byMe, stopped]);

  const withYouGroups = useMemo(
    () => groupWithYou(withYouItems({ clusters, files: withMe, meta })),
    [clusters, withMe, meta],
  );
  const byYouList = useMemo(
    () => byYouItems({ clusters: byYouClusters, files: byMe }),
    [byYouClusters, byMe],
  );
  const byYouGroups = useMemo(
    () => (byYouList.length ? [{ key: 'by-you', kind: 'by-you', items: byYouList }] : []),
    [byYouList],
  );
  const groups = tab === 'with_me' ? withYouGroups : byYouGroups;
  const total = countItems(groups);
  const newCount = useMemo(
    () => withYouGroups.reduce((n, g) => n + g.items.filter((it) => it.isNew).length, 0),
    [withYouGroups],
  );

  const searching = findTokens(q).length > 0;
  const shownOf = (item) => [kindLabel(item)];
  const filtered = useMemo(
    () => (searching ? filterGroups(groups, q, (it) => [kindLabel(it)]) : groups),
    [searching, groups, q],
  );
  const shownN = countItems(filtered);

  const picked = (item) => {
    if (searching) trackFindUsed({ surface: 'shared_page', nItems: shownN, by: itemHitKind(q, item, shownOf(item)) });
  };
  const switchTab = (id) => { setTab(id); setQ(''); };

  useEffect(() => {
    if (!shared.loaded || loggedRef.current) return;
    loggedRef.current = true;
    try { logEvent(EV.SHARED_PAGE_VIEW, { tab, n: withMe.length, unread: shared.unread }); } catch (_) {}
  }, [shared.loaded]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Pictures for the file rows on this tab.
  useEffect(() => {
    const tokens = [];
    for (const g of filtered) {
      for (const it of g.items) {
        if (it.type === 'file' && it.row.kind && it.row.kind !== 'file' && it.row.kind !== 'doc') tokens.push(it.row.token);
      }
    }
    if (tokens.length) void loadSharedThumbs(tokens.slice(0, 50));
  }, [filtered]);

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
      message: item.name ? tr`“${ph({ name: item.name })}” removed from your list.` : tr`Removed from your list.`,
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

  const fileWithYouMenu = (item) => composeMenuSections([
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
      { id: 'hide', label: tr`Remove from my list`, run: () => removeFromList(item) },
    ] },
  ]);

  const clusterWithYouMenu = (it) => composeMenuSections([
    { items: [
      { id: 'open', label: tr`Open`, run: () => onOpenBoard?.(it.id) },
      { id: 'link', label: tr`Copy link`, run: () => onCopyClusterLink?.(it.id) },
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'hide', label: tr`Remove from my list`, run: () => onRemoveCluster?.(it.id) },
    ] },
  ]);

  const openFileByYou = (row) => openFileShare({
    boardId: row.board_id, cardId: row.card_id,
    card: { id: row.card_id, kind: row.kind, fileName: row.name },
    boardName: row.board_name || null, surface: 'shared_page',
  });

  const fileByYouMenu = (row) => composeMenuSections([
    { items: [
      { id: 'manage', label: tr`Manage sharing…`, run: () => openFileByYou(row) },
      { id: 'link', label: tr`Copy link`, run: () => copyLink(row) },
    ] },
    { header: SECTION.EDIT, items: [
      { id: 'stop', label: tr`Stop sharing`, danger: true, run: () => stopSharing(row) },
    ] },
  ]);

  const clusterByYouMenu = (it) => composeMenuSections([
    { items: [
      { id: 'open', label: tr`Open`, run: () => onOpenOwnBoard?.(it.id) },
      { id: 'manage', label: tr`Manage sharing…`, run: () => onManageClusterSharing?.(it.id) },
      { id: 'link', label: tr`Copy link`, run: () => onCopyClusterLink?.(it.id) },
    ] },
  ]);

  const menuOf = (it) => {
    if (tab === 'with_me') return it.type === 'cluster' ? clusterWithYouMenu(it) : fileWithYouMenu(it.row);
    return it.type === 'cluster' ? clusterByYouMenu(it) : fileByYouMenu(it.row);
  };
  const openItem = (it) => {
    picked(it);
    if (tab === 'with_me') {
      if (it.type === 'cluster') onOpenBoard?.(it.id);
      else openSharedFile({ token: it.row.token, via: 'shared_page' });
    } else if (it.type === 'cluster') onOpenOwnBoard?.(it.id);
    else openFileByYou(it.row);
  };

  const renderRow = (it) => {
    const label = it.name || (it.type === 'cluster' ? tr`Untitled cluster` : tr`File`);
    const withYou = tab === 'with_me';
    let sub;
    if (withYou) {
      sub = [kindLabel(it), it.at ? relativeTimeShort(it.at) : null].filter(Boolean).join(' · ');
    } else {
      sub = peopleLine(it) || (it.type === 'file' ? it.boardName || '' : '');
    }
    const faces = !withYou ? (it.people || []).slice(0, 3) : [];
    return (
      <li key={`${it.type}:${it.id}`} className={`shp-row${it.isNew ? ' is-new' : ''}`}>
        <button type="button" className="shp-open" onClick={() => openItem(it)}
                onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: menuOf(it) }); }}>
          <Thumb item={it} url={it.type === 'file' ? shared.thumbs[it.row.token]?.url || null : null} />
          <span className="shp-main">
            <span className="shp-name" dir="auto">{label}</span>
            <span className="shp-sub">
              {faces.length > 0 && (
                <span className="shp-faces" aria-hidden="true">
                  {faces.map((p, i) => (
                    <PersonFace key={p.userId || i} userId={p.userId || undefined} name={p.name || ''}
                                color={p.color || undefined} size={18} className="shp-face" ariaHidden />
                  ))}
                </span>
              )}
              <span className="shp-sub-t">{sub}</span>
            </span>
          </span>
          {withYou && it.type === 'cluster' && it.role === 'viewer' && (
            <span className="shp-chip shp-chip-ro" title={tr`View only`}><Trans context="permission">View</Trans></span>
          )}
          {!withYou && it.linkOn && <span className="shp-chip"><Trans context="link sharing">Link on</Trans></span>}
          {it.isNew && <span className="shp-dot" aria-label={tr({ message: 'New', context: 'badge' })} />}
        </button>
        <RowMenuButton label={tr`More for ${ph({ name: label })}`} onOpen={(x, y) => setMenu({ x, y, items: menuOf(it) })} />
      </li>
    );
  };

  const loadingFiles = !shared.loaded && shared.loading;
  const loadingClusters = tab === 'by_me' && !byYouLoaded;
  const nothing = shared.loaded && !total && !loadingClusters;
  const placeholder = tr`Search shared`;

  return (
    <section className="shp" aria-label={tr`Shared`}>
      <header className="shp-head">
        <h1 className="shp-title"><Trans>Shared</Trans></h1>
        <div className="shp-tabs" role="tablist" aria-label={tr`Shared`}>
          {[['with_me', tr`With you`, newCount], ['by_me', tr`By you`, 0]].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
                    className={`shp-tab${tab === id ? ' is-on' : ''}`} onClick={() => switchTab(id)}>
              {label}{n ? <span className="shp-tab-n">{n}</span> : null}
            </button>
          ))}
        </div>
        <div className="shp-find">
          <input ref={findRef} type="text" className="shp-find-input" value={q}
                 placeholder={placeholder} aria-label={placeholder}
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
        {onClose && (
          <button type="button" className="shp-close" aria-label={tr`Close`} title={tr`Close`} onClick={onClose}>
            <Icon as={X} size={16} />
          </button>
        )}
      </header>
      <div className="shp-body" role="tabpanel">
        {(loadingFiles || loadingClusters) && <p className="shp-empty shp-loading"><Trans>Loading…</Trans></p>}
        {searching && !shownN && total > 0 && (
          <div className="shp-empty">
            <p>{tr`Nothing shared matches “${ph({ q: q.trim() })}”`}</p>
            <button type="button" className="shp-retry" onClick={() => { setQ(''); findRef.current?.focus(); }}><Trans>Clear</Trans></button>
          </div>
        )}
        {nothing && (
          <div className="shp-empty">
            {tab === 'with_me' ? (
              <>
                <p className="shp-empty-title"><Trans>Nothing is shared with you yet.</Trans></p>
                <p><Trans>When someone shares a cluster or a file with you, it shows up here.</Trans></p>
              </>
            ) : (
              <>
                <p className="shp-empty-title"><Trans>You haven’t shared anything yet.</Trans></p>
                <p><Trans>Share a cluster, or open any file and use Share to send just that file.</Trans></p>
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
        <div className="shp-in">
          {filtered.map((g) => (
            <div key={g.key} className="shp-group">
              {tab === 'with_me' && <GroupHead g={g} />}
              <ul className="shp-list">{g.items.map(renderRow)}</ul>
            </div>
          ))}
        </div>
      </div>
      {menu && createPortal(
        <CardContextMenu open x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} card={null} />,
        document.body,
      )}
    </section>
  );
}

export default SharedPage;
