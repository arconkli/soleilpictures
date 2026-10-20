// ClustersHome — Home with the files sidebar (preview only, behind
// sidebarFilesAllowed(); production keeps ProjectsHome).
//
// The owner, on the Home before this one (a dashboard of cards over the
// universe): "it just honestly doesnt feel very useful at all, maybe we just
// dont need a home tbh and it can just stay as something that looks cool and
// thats it? but i DO like that it makes it easier to manage your workspace".
// Of four looks on a canvas (artifact V6Yud8nenG4dWY3ksPG3oW) they picked "the
// universe is the map", 2026-10-19: "i like B but with the workspace title at
// the top left. there next to the workspace title you should be able to change
// its name, invite new people, switch workspaces, and create a new one".
//
// So the universe is the page:
//   - top left, the workspace (HomeWorkspace): its name, a caret that
//     switches, and Rename, Invite and New workspace beside it;
//   - every cluster is a star with its name on it. Click one and the camera
//     glides to it and its card opens beside it: its newest photos, where it
//     is, what's inside it, who's in it now, Open, and Rename, Cover, Move,
//     Star, Delete for whoever may change it. Double-click opens it;
//   - at the bottom, Find a cluster (what it finds stays lit, the rest dims;
//     Enter goes to the first) and New cluster.
// Nothing here repeats the sidebar: Messages, who's here and storage live
// there. Phones have no universe: the same workspace line, then a find field
// and the clusters as rows.
//
// Presentational: App hands in what it already holds and the verbs it already
// has (the move with its Undo, the delete with its Undo, the cluster picker,
// the Share window); the rules are lib/homeMap.js's.

import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { R2Image } from '../R2Image.jsx';
import { Icon } from '../Icon.jsx';
import { Plus, X, Search } from '../../lib/icons.js';
import { boardRecency } from '../../lib/projectsHome.js';
import { clusterName, findClusters, starLabels, workspaceLine } from '../../lib/homeMap.js';
import { hereText, firstName } from '../../lib/sidebarWho.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { HomeWorkspace } from './HomeWorkspace.jsx';
import { ThumbnailCropModal } from '../ThumbnailCropModal.jsx';
import { anyModalOpen } from '../../lib/modalGuard.js';
import { useMatchMedia } from '../../hooks/useMatchMedia.js';
import { useKeyboardInset } from '../../hooks/useKeyboardInset.js';
import './clustersHome.css';

const cardsOf = (b) => Number(b?.card_count) || 0;
const whenOf = (b) => {
  const w = relativeTimeShort(boardRecency(b));
  return w === 'Just now' ? 'just now' : w;
};
const isOwn = (b, workspaceId) => !!b && !b.deleted_at && !b._shared && (!workspaceId || b.workspace_id === workspaceId);

// A cluster's picture: the cover someone chose, else its newest photos (one,
// two or three), else its board as last rendered, else an empty canvas.
function Cover({ board, photos }) {
  const custom = board?.thumb_custom && board?.thumb_key;
  const shown = custom ? [] : (photos || []).filter(p => p?.src).slice(0, 3);
  if (shown.length) {
    return (
      <span className={`ch-cover is-photos n${shown.length}`}>
        {shown.map((p, i) => <R2Image key={p.id || i} src={p.src} alt="" />)}
      </span>
    );
  }
  if (board?.thumb_key) {
    return (
      <span className="ch-cover">
        <R2Image src={board.thumb_key} bust={board.thumb_updated_at || board.thumb_version || undefined} alt="" />
      </span>
    );
  }
  return <span className="ch-cover is-empty" aria-hidden="true" />;
}

function Faces({ people, max = 3 }) {
  return (
    <span className="ch-faces" aria-hidden="true">
      {people.slice(0, max).map(p => (
        <span key={p.id} className="ch-face" style={{ background: p.color }}>{p.initial}</span>
      ))}
    </span>
  );
}

// The picked cluster's card, drawn by the universe beside its star.
function StarCard({
  board, boards, rootId, workspaceId, photos, here, editable, starred,
  onClose, onOpen, onRename, onCover, onMove, onStar, onDelete, onPick,
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  // Escape cancels for good (the field's blur as it goes must not save it),
  // and Enter saves once (not again on that blur).
  const settledRef = useRef(false);
  useEffect(() => { setRenaming(false); }, [board.id]);
  useEffect(() => { if (renaming) { settledRef.current = false; inputRef.current?.select(); } }, [renaming]);

  const name = board.id === rootId ? (board.name || 'Studio') : clusterName(board);
  const isRoot = board.id === rootId;
  const kids = useMemo(() => Object.values(boards || {})
    .filter(b => isOwn(b, workspaceId) && b.parent_board_id === board.id)
    .sort((a, z) => boardRecency(z) - boardRecency(a)), [boards, board.id, workspaceId]);
  const parent = !isRoot && board.parent_board_id && board.parent_board_id !== rootId ? boards?.[board.parent_board_id] : null;
  const n = cardsOf(board);
  const sub = [
    isRoot ? 'The top of your workspace' : parent ? `In ${clusterName(parent)}` : null,
    n ? `${n} card${n === 1 ? '' : 's'}` : 'Empty',
    kids.length ? `${kids.length} inside` : null,
    `edited ${whenOf(board)}`,
  ].filter(Boolean).join(' · ');
  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== name) onRename?.(next);
  };
  const cancel = () => { settledRef.current = true; setRenaming(false); };

  return (
    <section className="ch-card" aria-label={name}
             onKeyDown={(e) => { if (e.key === 'Escape' && !renaming) { e.stopPropagation(); onClose?.(); } }}>
      <button type="button" className="ch-x" aria-label="Close" title="Close (Esc)" onClick={onClose}>
        <Icon as={X} size={14} weight="regular" />
      </button>
      <Cover board={board} photos={photos} />
      {renaming ? (
        <form className="ch-card-rename" onSubmit={(e) => { e.preventDefault(); commit(); }}>
          <input ref={inputRef} value={draft} maxLength={120} aria-label="Cluster name"
                 onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                 onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } }} />
        </form>
      ) : (
        <h2 className="ch-card-name">{name}</h2>
      )}
      <p className="ch-card-sub">{sub}</p>
      {kids.length > 0 && (
        <p className="ch-card-in">
          <span className="ch-card-in-label">Inside</span>
          {kids.slice(0, 4).map((k, i) => (
            <Fragment key={k.id}>
              {i > 0 && <span className="ch-dot" aria-hidden="true">·</span>}
              <button type="button" className="ch-inword" onClick={() => onPick?.(k.id)}>{clusterName(k)}</button>
            </Fragment>
          ))}
          {kids.length > 4 && <span className="ch-card-more">and {kids.length - 4} more</span>}
        </p>
      )}
      {here?.length > 0 && (
        <span className="ch-here"><Faces people={here} />{hereText(here.map(p => firstName(p.name)))}</span>
      )}
      <div className="ch-card-acts">
        <button type="button" className="ch-primary" onClick={onOpen}>Open</button>
        {editable && <button type="button" className="ch-word" onClick={() => { setDraft(name); setRenaming(true); }}>Rename</button>}
        {editable && <button type="button" className="ch-word" onClick={onCover}>Cover</button>}
        {editable && !isRoot && <button type="button" className="ch-word" onClick={onMove}>Move</button>}
        {onStar && <button type="button" className="ch-word" aria-pressed={!!starred} onClick={onStar}>{starred ? 'Unstar' : 'Star'}</button>}
        {editable && !isRoot && <button type="button" className="ch-word is-danger ch-push" onClick={onDelete}>Delete</button>}
      </div>
      {!editable && <p className="ch-card-note">You can look around this cluster but not change it.</p>}
    </section>
  );
}

export function ClustersHome({
  boards, rootId, workspaceId, canCreate = false,
  // The universe: App's lazy HomeGraph and its props (null on phones, which
  // keep the board's ground and get rows instead).
  Graph = null, graphProps = null,
  // The workspace, top left.
  workspace = null, workspaces = [], personalWorkspaceId = null, selfUserId = null, wsPeers = [], memberCount = 0,
  canManageWorkspace = false,
  onSwitchWorkspace, onNewWorkspace, onRemoveWorkspace, onOpenWorkspaceSettings, onInviteWorkspace, onRenameWorkspace,
  // A cluster.
  onOpenBoard,            // (boardId, via) — via: star | card | row
  onNewProject,           // (name | null)
  canEditCluster,         // (boardId) → bool
  onRenameCluster,        // (boardId, name)
  onCoverCluster,         // (boardId, blob) — the cropped WebP the crop window gives
  onMoveCluster,          // (boardId)
  isStarred,              // (boardId) → bool
  onToggleStar,           // (boardId)
  onDeleteCluster,        // (boardId)
  loadPhotos,             // (boardId) → Promise<[{ id, src }]>: the cluster's newest photos
  hereByBoard = null,     // Map boardId → [{ id, name, initial, color }] (others there now)
}) {
  // Every cluster, newest first: the names on the stars, and what a search finds first.
  const labels = useMemo(() => starLabels(boards, rootId, { workspaceId })
    .sort((a, z) => boardRecency(boards[z.boardId]) - boardRecency(boards[a.boardId])), [boards, rootId, workspaceId]);
  // The universe is read again when a cluster is made, moved or deleted (or
  // an Undo brings one back), not when one is only renamed.
  const shape = useMemo(() => labels.map(l => `${l.boardId}>${l.parentId || ''}`).sort().join('|'), [labels]);
  const refreshKey = useMemo(() => {
    let h = 0;
    for (let i = 0; i < shape.length; i++) h = ((h << 5) - h + shape.charCodeAt(i)) | 0;
    return h;
  }, [shape]);

  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [naming, setNaming] = useState(false);
  // A finger taps where a mouse clicks: the hint says so.
  const touch = useMatchMedia('(hover: none) and (pointer: coarse)');
  // While a field is in use on a touch screen, how much of the window the
  // keyboard covers: the find bar and the naming card rise above it.
  const [findFocused, setFindFocused] = useState(false);
  const kbInset = useKeyboardInset(touch && (naming || findFocused));
  const kbStyle = kbInset ? { '--kb-inset': `${kbInset}px` } : undefined;
  const namingRef = useRef(null);
  const [draft, setDraft] = useState('');
  const findRef = useRef(null);
  const coverRef = useRef(null);
  const rootRef = useRef(null);
  const barRef = useRef(null);
  // A new cover: the picked file goes through the crop window the sidebar's
  // tree uses, which hands back the WebP the thumbnail upload expects.
  const [thumbCrop, setThumbCrop] = useState(null);   // { boardId, file }
  const [thumbSaving, setThumbSaving] = useState(false);

  const selected = selectedId && boards?.[selectedId] && isOwn(boards[selectedId], workspaceId) ? boards[selectedId] : null;
  // A cluster deleted (or moved out of sight) puts its card down.
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);
  // Another workspace starts with nothing picked or searched.
  useEffect(() => { setSelectedId(null); setQuery(''); setNaming(false); }, [workspaceId]);

  const found = useMemo(() => findClusters(labels, query), [labels, query]);
  const lit = useMemo(() => (query.trim() ? new Set(found) : null), [found, query]);

  // The card's photos follow the cluster it shows.
  const [photos, setPhotos] = useState({ id: null, list: [] });
  useEffect(() => {
    if (!selectedId || !loadPhotos) return undefined;
    let live = true;
    Promise.resolve(loadPhotos(selectedId)).then((list) => {
      if (live) setPhotos({ id: selectedId, list: Array.isArray(list) ? list : [] });
    }, () => {});
    return () => { live = false; };
  }, [selectedId, loadPhotos]);

  // What covers the window's edges: the sidebar (wherever Home's own area
  // starts), the top bar's islands, and the find bar. The universe is framed
  // into the rest.
  const [insets, setInsets] = useState({ left: 0, top: 56, right: 0, bottom: 88 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const left = Math.max(0, Math.round(el.getBoundingClientRect().left));
      let islands = 0;
      for (const isl of document.querySelectorAll('.chrome-layer .chrome-island')) islands = Math.max(islands, isl.getBoundingClientRect().bottom);
      const top = Math.round((islands || 44) + 12);
      const bar = barRef.current?.getBoundingClientRect();
      const bottom = bar && bar.height ? Math.round(window.innerHeight - bar.top + 12) : 24;
      setInsets((p) => (p.left === left && p.top === top && p.bottom === bottom ? p : { left, top, right: 0, bottom }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Escape puts things down, the latest first: naming, the card, the search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || anyModalOpen()) return;
      // Only Home's own Escape: one that closes a window opened from here (the
      // cluster picker for Move, the Share window) leaves the card where it is.
      const t = e.target;
      if (t && t !== document.body && !t.closest?.('.ch-root, .ch-sky')) return;
      if (naming) { setNaming(false); return; }
      if (selectedId) { setSelectedId(null); return; }
      if (query) { setQuery(''); findRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [naming, selectedId, query]);

  const open = (id, via) => onOpenBoard?.(id, via);
  const startNaming = () => { setSelectedId(null); setDraft(''); setNaming(true); };
  // From a tap: the field takes focus inside it, so iOS raises the keyboard
  // (autoFocus on mount comes too late for that).
  const startNamingNow = () => { flushSync(startNaming); namingRef.current?.focus(); };
  const makeCluster = () => { const name = draft.trim(); setNaming(false); onNewProject?.(name || null); };
  const wsName = (workspace?.name || '').trim() || 'your workspace';

  const newest = useMemo(() => Object.values(boards || {}).filter(b => isOwn(b, workspaceId))
    .reduce((m, b) => Math.max(m, boardRecency(b)), 0), [boards, workspaceId]);
  const line = workspaceLine({
    workspace, personalWorkspaceId, selfUserId, memberCount,
    when: newest ? relativeTimeShort(newest) : '',
  });

  const header = (
    <HomeWorkspace
      workspace={workspace} workspaces={workspaces} personalWorkspaceId={personalWorkspaceId}
      selfUserId={selfUserId} wsPeers={wsPeers} line={line} canManage={canManageWorkspace}
      onSwitch={onSwitchWorkspace} onNew={onNewWorkspace} onRemove={onRemoveWorkspace}
      onOpenSettings={onOpenWorkspaceSettings} onInvite={onInviteWorkspace} onRename={onRenameWorkspace}
    />
  );
  const coverInput = (
    <input ref={coverRef} type="file" accept="image/*" hidden
           onChange={(e) => {
             const file = e.target.files?.[0];
             e.target.value = '';
             if (file && selectedId) setThumbCrop({ boardId: selectedId, file });
           }} />
  );
  const cropWindow = thumbCrop ? (
    <ThumbnailCropModal
      file={thumbCrop.file}
      saving={thumbSaving}
      onCancel={() => { if (!thumbSaving) setThumbCrop(null); }}
      onSave={async (blob) => {
        setThumbSaving(true);
        try { await onCoverCluster?.(thumbCrop.boardId, blob); }
        finally { setThumbSaving(false); setThumbCrop(null); }
      }}
    />
  ) : null;

  // Naming a new cluster: over the map's bottom bar, or under a phone's search.
  const namingForm = (
    <form className="ch-naming" aria-label="New cluster" onSubmit={(e) => { e.preventDefault(); makeCluster(); }}>
      <label className="ch-naming-field">
        <span className="ch-sr">Name the new cluster</span>
        <input ref={namingRef} autoFocus value={draft} maxLength={120} placeholder="Name it" aria-label="Name the new cluster"
               onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(false); } }} />
      </label>
      <p className="ch-naming-sub">At the top of {wsName} · Enter to make it and go in</p>
      <div className="ch-card-acts">
        <button type="submit" className="ch-primary">Make cluster</button>
        <button type="button" className="ch-word" onClick={() => setNaming(false)}>Cancel</button>
      </div>
    </form>
  );

  // ── A phone: no universe; the workspace, a search, and the clusters as rows.
  if (!Graph) {
    const rows = (lit ? found.map(id => boards[id]) : labels.filter(l => l.kind !== 'nested').map(l => boards[l.boardId])).filter(Boolean);
    return (
      <div className="ch-root is-rows" ref={rootRef}>
        {header}
        <div className="ch-find-row">
          <label className="ch-find">
            <Icon as={Search} size={15} weight="regular" />
            <input ref={findRef} type="search" placeholder="Find a cluster" aria-label="Find a cluster"
                   value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {canCreate && (
            <button type="button" className={`ch-quiet${naming ? ' is-on' : ''}`} aria-pressed={naming}
                    onClick={naming ? () => setNaming(false) : startNamingNow}>
              <Icon as={Plus} size={14} weight="regular" />New cluster
            </button>
          )}
        </div>
        {naming && namingForm}
        <ul className="ch-rows" aria-label="Clusters">
          {rows.map(b => (
            <li key={b.id}>
              <button type="button" className="ch-row" onClick={() => open(b.id, 'row')}>
                <Cover board={b} />
                <span className="ch-row-text">
                  <span className="ch-row-name">{b.id === rootId ? (b.name || 'Studio') : clusterName(b)}</span>
                  <span className="ch-row-sub">{cardsOf(b) ? `${cardsOf(b)} card${cardsOf(b) === 1 ? '' : 's'}` : 'Empty'} · {whenOf(b)}</span>
                </span>
              </button>
            </li>
          ))}
          {lit && !found.length && <li className="ch-none">Nothing called that.</li>}
        </ul>
      </div>
    );
  }

  const onlyStudio = labels.length <= 1;
  const card = selected ? (
    <StarCard
      board={selected} boards={boards} rootId={rootId} workspaceId={workspaceId}
      photos={photos.id === selected.id ? photos.list : []}
      here={hereByBoard?.get?.(selected.id) || []}
      editable={!!canEditCluster?.(selected.id)}
      starred={!!isStarred?.(selected.id)}
      onClose={() => setSelectedId(null)}
      onOpen={() => open(selected.id, 'card')}
      onRename={(name) => onRenameCluster?.(selected.id, name)}
      onCover={() => coverRef.current?.click()}
      onMove={() => onMoveCluster?.(selected.id)}
      onStar={onToggleStar ? () => onToggleStar(selected.id) : null}
      onDelete={() => { const id = selected.id; setSelectedId(null); onDeleteCluster?.(id); }}
      onPick={(id) => setSelectedId(id)}
    />
  ) : null;

  return (
    <>
      <div className="ch-sky">
        <Suspense fallback={<div className="home-graph-wrap" />}>
          <Graph {...graphProps} backdrop labels={labels} selectedId={selected ? selected.id : null}
                 onSelect={(id) => { setNaming(false); setSelectedId(id); }}
                 onOpenStar={(id) => open(id, 'star')}
                 litIds={lit} insets={insets} refreshKey={refreshKey} card={card} />
        </Suspense>
      </div>
      <div className="ch-root" ref={rootRef} style={kbStyle}>
        {header}

        {onlyStudio && !naming && (
          <div className="ch-empty">
            <p className="ch-empty-line">Every cluster you make becomes a star here.</p>
            {canCreate && (
              <button type="button" className="ch-primary" onClick={startNaming}>
                <Icon as={Plus} size={14} weight="regular" />New cluster
              </button>
            )}
          </div>
        )}

        {naming && namingForm}

        {!onlyStudio && (
          <div className="ch-bar" ref={barRef} role="toolbar" aria-label="Your clusters">
            <label className="ch-find">
              <Icon as={Search} size={15} weight="regular" />
              <input ref={findRef} type="search" placeholder="Find a cluster" aria-label="Find a cluster"
                     value={query} onChange={(e) => setQuery(e.target.value)}
                     onFocus={() => setFindFocused(true)} onBlur={() => setFindFocused(false)}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && found.length) { e.preventDefault(); setSelectedId(found[0]); }
                       // The card a search opened goes first, then the search.
                       if (e.key === 'Escape') {
                         e.preventDefault();
                         if (selectedId) setSelectedId(null);
                         else { setQuery(''); e.currentTarget.blur(); }
                       }
                     }} />
              {query.trim() && <span className="ch-find-n" aria-live="polite">{found.length ? `${found.length} found` : 'Nothing found'}</span>}
            </label>
            {canCreate && (
              <>
                <span className="ch-bar-sep" aria-hidden="true" />
                <button type="button" className={`ch-quiet${naming ? ' is-on' : ''}`} aria-pressed={naming} onClick={naming ? () => setNaming(false) : startNamingNow}>
                  <Icon as={Plus} size={14} weight="regular" />New cluster
                </button>
              </>
            )}
          </div>
        )}
        {!onlyStudio && <p className="ch-hint">{touch ? 'Tap a star to see it · Double-tap to open it' : 'Click a star to see it · Double-click to open it'}</p>}
        {coverInput}
        {cropWindow}
      </div>
    </>
  );
}
