// ProjectsHome — Home shows a person their projects, with their universe behind.
//
// Home and the logo used to open the 3D graph and nothing else. People landed
// there by accident, looked for a few seconds and left, and there was no screen
// anywhere that showed someone their projects: the sidebar tree was collapsed
// and oldest-first, recents lived inside cmd-K, and the one gallery of a
// person's own clusters was on the upgrade modal. So Home is now a glass panel —
// the boards they were last in, their projects, and a way to start the next
// one — floating over the same living graph, which stays visible and usable
// around it. "Explore universe" slides the panel aside; "Projects" brings it
// back. The owner asked to see and use both.
//
// Presentational. The board map, the opener and the creator come in as props;
// what goes on the panel is decided by lib/projectsHome.js (pure, tested). The
// graph is passed in as a node so this file never pulls three.js into its own
// chunk — the 3D bundle stays lazy, and phones (which get the panel only) never
// load it at all.

import { useEffect, useMemo, useRef, useState } from 'react';
import { R2Image } from './R2Image.jsx';
import { Icon } from './Icon.jsx';
import { Plus } from '../lib/icons.js';
import { COVER_TINTS } from './primitives.jsx';
import { relativeTimeShort } from '../lib/relativeTime.js';
import { boardRecency, jumpBackIn, projectList } from '../lib/projectsHome.js';

const UNTITLED_RE = /^Untitled (cluster|list)$/i;
const displayName = (b) => (b?.name && b.name.trim()) || 'Untitled cluster';

function Thumb({ board, label }) {
  if (board?.thumb_key) {
    return (
      <span className="ph-thumb">
        <R2Image src={board.thumb_key} bust={board.thumb_updated_at || board.thumb_version || undefined}
                 eager alt="" />
      </span>
    );
  }
  // No render yet (a new or empty cluster): the cover tint and an initial, so
  // the tile is still recognisably THIS project rather than a grey box.
  const tint = COVER_TINTS[board?.cover] || COVER_TINTS.neutral;
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  return (
    <span className="ph-thumb ph-thumb-empty" style={{ '--ph-tint': tint }} aria-hidden="true">
      <span className="ph-thumb-initial">{initial}</span>
    </span>
  );
}

function Tile({ board, label, sub, onOpen }) {
  const when = relativeTimeShort(boardRecency(board));
  const cards = Number(board?.card_count) || 0;
  return (
    <button type="button" className="ph-tile" onClick={onOpen} title={label}>
      <Thumb board={board} label={label} />
      <span className="ph-tile-meta">
        <span className="ph-tile-name">{label}</span>
        <span className="ph-tile-sub">
          {sub || [cards > 0 ? `${cards} card${cards === 1 ? '' : 's'}` : null, when || null].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
}

function NewProjectTile({ onCreate, disabled }) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (naming) inputRef.current?.focus(); }, [naming]);
  const submit = () => {
    const name = draft.trim();
    setNaming(false);
    setDraft('');
    onCreate?.(name || null);
  };
  if (disabled) return null;
  if (!naming) {
    return (
      <button type="button" className="ph-tile ph-tile-new" onClick={() => setNaming(true)}>
        <span className="ph-thumb ph-thumb-new" aria-hidden="true"><Icon as={Plus} size={22} /></span>
        <span className="ph-tile-meta">
          <span className="ph-tile-name">New project</span>
          <span className="ph-tile-sub">Its own cluster, at the top</span>
        </span>
      </button>
    );
  }
  // Naming happens HERE, where the person asked, and never as a focused field
  // on the canvas — the empty project's whole ask is "paste images in", and a
  // focused text input would swallow that paste.
  return (
    <form className="ph-tile ph-tile-new is-naming" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="ph-thumb ph-thumb-new" aria-hidden="true"><Icon as={Plus} size={22} /></span>
      <span className="ph-tile-meta">
        <input ref={inputRef} className="ph-new-input" value={draft} maxLength={120}
               placeholder="Name it (optional)" aria-label="New project name"
               onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setNaming(false); setDraft(''); } }} />
        <span className="ph-tile-sub">Enter to create</span>
      </span>
    </form>
  );
}

export function ProjectsHome({
  boards,
  rootId,
  workspaceId,
  recents = [],
  canCreate = false,
  exploring = false,
  graph = null,            // the universe, as a node — null on phones
  onOpenBoard,             // (boardId, via) => void
  onNewProject,            // (name|null) => void
  onExplore,               // (bool) => void
}) {
  const root = boards?.[rootId] || null;
  const projects = useMemo(() => projectList(boards, rootId, { workspaceId }), [boards, rootId, workspaceId]);
  const jump = useMemo(() => jumpBackIn(boards, recents, rootId, { workspaceId }), [boards, recents, rootId, workspaceId]);

  return (
    <div className={`ph-root${exploring ? ' is-exploring' : ''}${graph ? '' : ' no-graph'}`}>
      {graph && <div className="ph-graph">{graph}</div>}

      {exploring ? (
        <button type="button" className="ph-projects-pill" onClick={() => onExplore?.(false)}>
          Projects
        </button>
      ) : (
        <section className="ph-panel surface-frosted" aria-label="Your projects">
          {jump.length > 0 && (
            <div className="ph-section">
              <div className="ph-eyebrow">Jump back in</div>
              <div className="ph-jump">
                {jump.map((b) => (
                  <button key={b.id} type="button" className="ph-jump-item"
                          onClick={() => onOpenBoard?.(b.id, 'jump')} title={displayName(b)}>
                    <Thumb board={b} label={b.id === rootId ? 'Studio' : displayName(b)} />
                    <span className="ph-jump-name">{b.id === rootId ? (root?.name || 'Studio') : displayName(b)}</span>
                    <span className="ph-jump-when">{relativeTimeShort(boardRecency(b))}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ph-section">
            <div className="ph-eyebrow">Your projects</div>
            <div className="ph-grid">
              {root && (
                <Tile board={root} label={root.name || 'Studio'}
                      onOpen={() => onOpenBoard?.(root.id, 'studio')} />
              )}
              {projects.map((b) => (
                <Tile key={b.id} board={b}
                      label={UNTITLED_RE.test(b.name || '') ? 'Untitled project' : displayName(b)}
                      onOpen={() => onOpenBoard?.(b.id, 'tile')} />
              ))}
              <NewProjectTile disabled={!canCreate} onCreate={onNewProject} />
            </div>
          </div>

          {graph && (
            <button type="button" className="ph-explore" onClick={() => onExplore?.(true)}>
              Explore universe →
            </button>
          )}
        </section>
      )}
    </div>
  );
}
