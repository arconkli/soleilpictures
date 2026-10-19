// ClustersHome — Home with the files sidebar (preview only, behind
// sidebarFilesAllowed(); production keeps ProjectsHome). The owner picked it,
// "the workspace at a glance", from four directions on a canvas on 2026-10-19
// (artifact Q2GPHJvk9Gk4tLhE5LP25Y):
//
//   - on the left, the cluster to pick up again (its newest photos and who's
//     in it now), the next few after it, and the clusters at the top of the
//     workspace as covers, with New cluster;
//   - on the right, a rail of the sidebar's glass cards: Messages, who's here
//     now and where, what's shared with you, and storage;
//   - the universe behind a button, so its 3D chunk loads only when asked for.
//
// No workspace header: the sidebar's switcher is right there. Presentational:
// App hands in what it already holds, shaped by lib/homeRail.js, and the order
// of things is lib/projectsHome.js's.

import { useEffect, useMemo, useRef, useState } from 'react';
import { R2Image } from '../R2Image.jsx';
import { Icon } from '../Icon.jsx';
import { SidebarMeter } from '../sidebar/SidebarMeter.jsx';
import { Plus, ArrowLeft, Planet, ChevronDown, Check } from '../../lib/icons.js';
import { boardRecency, projectList } from '../../lib/projectsHome.js';
import { pickUp } from '../../lib/homeRail.js';
import { hereText, firstName } from '../../lib/sidebarWho.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import './clustersHome.css';

const UNTITLED_RE = /^Untitled (cluster|list)$/i;
const nameOf = (b) => (b?.name && b.name.trim() && !UNTITLED_RE.test(b.name)) ? b.name.trim() : 'Untitled cluster';
const cardsOf = (b) => Number(b?.card_count) || 0;
const whenOf = (b) => {
  const w = relativeTimeShort(boardRecency(b));
  return w === 'Just now' ? 'just now' : w;
};

// A cluster's cover: its board as last rendered, or a small empty canvas.
function Cover({ board, className = '' }) {
  if (board?.thumb_key) {
    return (
      <span className={`ch-cover ${className}`}>
        <R2Image src={board.thumb_key} bust={board.thumb_updated_at || board.thumb_version || undefined} alt="" />
      </span>
    );
  }
  return <span className={`ch-cover is-empty ${className}`} aria-hidden="true" />;
}

// The cluster to pick up: its newest photos when it has some (one, two or
// three), else its cover.
function Collage({ board, photos }) {
  const shown = (photos || []).filter(p => p?.src).slice(0, 3);
  if (!shown.length) return <Cover board={board} className="ch-collage-cover" />;
  return (
    <span className={`ch-collage n${shown.length}`}>
      {shown.map((p, i) => <R2Image key={p.id || i} src={p.src} alt="" />)}
    </span>
  );
}

function NewClusterTile({ onCreate }) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const btnRef = useRef(null);
  // Focus goes into the name when the form opens, and back to the tile when
  // it closes from the keyboard, rather than falling to the page.
  const backToTile = useRef(false);
  useEffect(() => {
    if (naming) inputRef.current?.focus();
    else if (backToTile.current) { backToTile.current = false; btnRef.current?.focus(); }
  }, [naming]);
  const close = (refocus) => { backToTile.current = refocus; setNaming(false); setDraft(''); };
  if (!naming) {
    return (
      <button ref={btnRef} type="button" className="ch-tile ch-new" onClick={() => setNaming(true)}>
        <span className="ch-cover ch-new-cover" aria-hidden="true"><Icon as={Plus} size={20} weight="regular" /></span>
        <span className="ch-tile-name">New cluster</span>
        <span className="ch-tile-sub">At the top of your workspace</span>
      </button>
    );
  }
  // Named here, never as a focused field on the canvas: a new cluster's first
  // ask is "paste images in", and a focused input would swallow the paste.
  const submit = () => { const name = draft.trim(); close(true); onCreate?.(name || null); };
  return (
    <form className="ch-tile ch-new is-naming" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="ch-cover ch-new-cover" aria-hidden="true"><Icon as={Plus} size={20} weight="regular" /></span>
      <input ref={inputRef} className="ch-new-input" value={draft} maxLength={120}
             placeholder="Name it (optional)" aria-label="New cluster name"
             onChange={(e) => setDraft(e.target.value)}
             // Clicking away from an empty name puts the tile back; a typed
             // one stays until Enter or Escape, so it isn't lost.
             onBlur={() => { if (!draft.trim()) close(false); }}
             onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } }} />
      <span className="ch-tile-sub">Enter to create</span>
    </form>
  );
}

const SORTS = [['recent', 'Recent'], ['name', 'Name']];

function SortMenu({ sort, onSort }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); wrapRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const label = (SORTS.find(([k]) => k === sort) || SORTS[0])[1];
  return (
    <div className="ch-sort" ref={wrapRef}>
      <button type="button" className="ch-btn" aria-haspopup="menu" aria-expanded={open}
              title="Sort the clusters" onClick={() => setOpen(o => !o)}>
        {label}<Icon as={ChevronDown} size={10} weight="regular" />
      </button>
      {open && (
        <div className="ch-menu" role="menu" aria-label="Sort by">
          {SORTS.map(([k, l]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={sort === k}
                    className={`ch-menu-item${sort === k ? ' is-on' : ''}`}
                    onClick={() => { onSort(k); setOpen(false); }}>
              <span className="ch-menu-check" aria-hidden="true">{sort === k && <Icon as={Check} size={12} weight="regular" />}</span>
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

export function ClustersHome({
  boards, rootId, workspaceId, recents = [],
  canCreate = false,
  onOpenBoard,            // (boardId, via) — via: continue | recent | tile | shared
  onNewProject,           // (name | null)
  // The universe, behind a button. graph is a node (null on phones: no button).
  exploring = false, onExplore, graph = null,
  loadPhotos,             // (boardId) → Promise<[{ id, src }]>: the cluster's newest photos
  hereByBoard = null,     // Map boardId → [{ id, name, initial, color }] (others there now)
  conversations = [],     // lib/homeRail railConversations rows
  onOpenMessages,         // (conversationId | null)
  herePeople = [],        // lib/homeRail hereNow rows, each with a colour
  onJumpToPeer,           // (loc)
  shared = [],            // [{ id, name, from, viewOnly, board }]
  meter = null,           // SidebarMeter's props: { isPaid, cardsUsed, cardLimit, storage }
  onOpenPlan,
}) {
  const [sort, setSort] = useState('recent');
  const { last, rest } = useMemo(() => pickUp(boards, recents, rootId, { workspaceId }), [boards, recents, rootId, workspaceId]);
  const clusters = useMemo(() => {
    const list = projectList(boards, rootId, { workspaceId });
    if (sort !== 'name') return list;
    return [...list].sort((a, z) => nameOf(a).localeCompare(nameOf(z), undefined, { sensitivity: 'base' }));
  }, [boards, rootId, workspaceId, sort]);

  // The pick-up card's photos follow the cluster it shows.
  const [photos, setPhotos] = useState({ id: null, list: [] });
  const lastId = last?.id || null;
  useEffect(() => {
    if (!lastId || !loadPhotos) return undefined;
    let live = true;
    Promise.resolve(loadPhotos(lastId)).then((list) => {
      if (live) setPhotos({ id: lastId, list: Array.isArray(list) ? list : [] });
    }, () => {});
    return () => { live = false; };
  }, [lastId, loadPhotos]);

  if (exploring && graph) {
    return (
      <div className="ch-root is-exploring">
        <div className="ch-graph">{graph}</div>
        <button type="button" className="ch-back ch-glass" onClick={() => onExplore?.(false)}>
          <Icon as={ArrowLeft} size={14} weight="regular" /> Home
        </button>
      </div>
    );
  }

  const parentLabel = (b) => {
    if (!b || b.id === rootId) return 'The top of your workspace';
    const p = b.parent_board_id ? boards?.[b.parent_board_id] : null;
    return p ? (p.id === rootId ? (p.name || 'Studio') : `In ${nameOf(p)}`) : 'Studio';
  };
  const lastHere = (last && hereByBoard?.get?.(last.id)) || [];
  const empty = clusters.length === 0;

  return (
    <div className="ch-root">
      <div className="ch-layout">
        <div className="ch-main">
          {last && (
            <section aria-label="Pick up where you left off">
              <div className="ch-line">
                <h2 className="ch-h">Pick up where you left off</h2>
                {graph && (
                  <button type="button" className="ch-btn" onClick={() => onExplore?.(true)} title="The universe: everything you've linked, in 3D">
                    <Icon as={Planet} size={15} weight="regular" /> Universe
                  </button>
                )}
              </div>
              <button type="button" className="ch-cont ch-glass" onClick={() => onOpenBoard?.(last.id, 'continue')}
                      title={`Open ${last.id === rootId ? (last.name || 'Studio') : nameOf(last)}`}>
                <Collage board={last} photos={photos.id === last.id ? photos.list : []} />
                <span className="ch-cont-meta">
                  <span className="ch-cont-name">{last.id === rootId ? (last.name || 'Studio') : nameOf(last)}</span>
                  <span className="ch-cont-sub">{parentLabel(last)} · edited {whenOf(last)}</span>
                  {lastHere.length > 0 && (
                    <span className="ch-here">
                      <Faces people={lastHere} />
                      {hereText(lastHere.map(p => firstName(p.name)))}
                    </span>
                  )}
                </span>
              </button>
              {rest.length > 0 && (
                <div className="ch-recents" aria-label="Also recent">
                  {rest.map(b => (
                    <button key={b.id} type="button" className="ch-chip" onClick={() => onOpenBoard?.(b.id, 'recent')}
                            title={`Open ${b.id === rootId ? (b.name || 'Studio') : nameOf(b)}`}>
                      <Cover board={b} className="ch-chip-cover" />
                      <span className="ch-chip-name">{b.id === rootId ? (b.name || 'Studio') : nameOf(b)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section aria-label="Clusters">
            <div className="ch-line">
              <h2 className="ch-h">Clusters</h2>
              {!empty && <SortMenu sort={sort} onSort={setSort} />}
            </div>
            {empty && <p className="ch-first">No clusters yet. Start one for each project.</p>}
            <div className="ch-grid">
              {clusters.map(b => (
                <button key={b.id} type="button" className="ch-tile" onClick={() => onOpenBoard?.(b.id, 'tile')} title={`Open ${nameOf(b)}`}>
                  <Cover board={b} />
                  <span className="ch-tile-name">{nameOf(b)}</span>
                  <span className="ch-tile-sub">
                    {cardsOf(b) ? `${cardsOf(b)} card${cardsOf(b) === 1 ? '' : 's'}` : 'Empty'} · {whenOf(b)}
                  </span>
                </button>
              ))}
              {canCreate && <NewClusterTile onCreate={onNewProject} />}
            </div>
          </section>
        </div>

        <aside className="ch-rail" aria-label="Your workspace">
          <section className="ch-card ch-glass" aria-label="Messages">
            <div className="ch-card-head">
              <h2 className="ch-h">Messages</h2>
              <button type="button" className="ch-btn" onClick={() => onOpenMessages?.(null)}>Open</button>
            </div>
            {conversations.length === 0 && <p className="ch-none">No conversations yet.</p>}
            {conversations.map(c => (
              <button key={c.id} type="button" className={`ch-item${c.unread ? ' is-unread' : ''}`} onClick={() => onOpenMessages?.(c.id)}>
                {c.avatars.length > 1 ? (
                  <span className="ch-stack" aria-hidden="true">
                    {c.avatars.slice(0, 2).map(a => <span key={a.id} className="ch-av" style={{ background: a.color }}>{a.initial}</span>)}
                  </span>
                ) : (
                  <span className="ch-av" aria-hidden="true" style={{ background: c.avatars[0]?.color }}>{c.avatars[0]?.initial || '·'}</span>
                )}
                <span className="ch-item-text">
                  <span className="ch-item-name">{c.name}</span>
                  {c.preview && <span className="ch-item-sub">{c.preview}</span>}
                </span>
                {c.unread > 0 && <span className="ch-count" aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
              </button>
            ))}
          </section>

          <section className="ch-card ch-glass" aria-label="Here now">
            <div className="ch-card-head"><h2 className="ch-h">Here now</h2></div>
            {herePeople.length === 0 && <p className="ch-none">Just you right now.</p>}
            {herePeople.map(p => (
              <button key={p.id} type="button" className="ch-item" onClick={() => p.loc && onJumpToPeer?.(p.loc)}
                      disabled={!p.loc} title={p.loc ? `Go to ${firstName(p.name)}` : undefined}>
                <span className="ch-av" aria-hidden="true" style={{ background: p.color }}>{p.initial}</span>
                <span className="ch-item-text">
                  <span className="ch-item-name">{p.name}</span>
                  <span className="ch-item-sub">{p.where}</span>
                </span>
              </button>
            ))}
          </section>

          {shared.length > 0 && (
            <section className="ch-card ch-glass" aria-label="Shared with you">
              <div className="ch-card-head"><h2 className="ch-h">Shared with you</h2></div>
              {shared.slice(0, 4).map(s => (
                <button key={s.id} type="button" className="ch-item" onClick={() => onOpenBoard?.(s.id, 'shared')}>
                  <Cover board={s.board} className="ch-item-cover" />
                  <span className="ch-item-text">
                    <span className="ch-item-name">{s.name}</span>
                    {s.from && <span className="ch-item-sub">From {s.from}</span>}
                  </span>
                  {s.viewOnly && <span className="ch-tag" title="View only">View</span>}
                </button>
              ))}
            </section>
          )}

          {meter && (
            <section className="ch-card ch-glass" aria-label="Storage">
              <div className="ch-card-head">
                <h2 className="ch-h">Storage</h2>
                {onOpenPlan && <button type="button" className="ch-btn" onClick={onOpenPlan}>Plan</button>}
              </div>
              <SidebarMeter {...meter} onOpenPlan={onOpenPlan} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
