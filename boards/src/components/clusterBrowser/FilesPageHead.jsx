// The full Files page's head in the files sidebar's look (direction A; the
// look is filesLook.js): the sidebar's Files card grown full screen. The
// cluster's name is the title, and pressing it opens the card's cluster
// switch (ClusterSwitch); the way back up ("‹ Studio", and Back after a
// spring) goes before it on the same line, as Finder's and Drive's do; a line
// says what's in it; Download all and Shrink are words at the right. Under it sit the card's own controls: the search
// line, "All files ⌄" (FilesShowMenu), who's here, Grid | List as the card's
// segmented tabs and Add files as its raised chip (on a phone, Grid | List
// goes into the menu and the bottom bar's + adds files). A selection turns that
// line into what to do with it, and files dragged over the page into what a
// drop does (ListSurface renders those in its place).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { Avatar } from '../primitives.jsx';
import { Search, X, ChevronDown, ArrowsInSimple, DownloadSimple, Plus } from '../../lib/icons.js';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside.js';
import { ClusterSwitch } from '../sidebar/ClusterSwitch.jsx';
import { FilesShowMenu } from '../sidebar/FilesShowMenu.jsx';
import { PathBar } from './PathBar.jsx';

// The top of the tree the switch lists: the cluster's oldest ancestor here.
function rootOf(boards, id) {
  let cur = boards?.[id];
  let guard = 0;
  while (cur?.parent_board_id && boards[cur.parent_board_id] && guard++ < 100) cur = boards[cur.parent_board_id];
  return cur?.id || id;
}

export function FilesPageHead({ board, boards, phone = false, meta = '', download = null, shrink = null, trail = null, onOpenBoard }) {
  // The cluster switch: opened by the title, fading as it closes (110ms, as
  // the card's), focus back on the title.
  const titleRef = useRef(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [switchClosing, setSwitchClosing] = useState(false);
  const timer = useRef(0);
  const openRef = useRef(false);
  openRef.current = switchOpen;
  useEffect(() => () => clearTimeout(timer.current), []);
  const dropSwitch = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = 0;
    setSwitchClosing(false);
    setSwitchOpen(false);
  }, []);
  const closeSwitch = useCallback(() => {
    if (!openRef.current || timer.current) return;
    const done = () => { timer.current = 0; setSwitchClosing(false); setSwitchOpen(false); titleRef.current?.focus({ preventScroll: true }); };
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    setSwitchClosing(true);
    timer.current = setTimeout(done, 110);
  }, []);
  const open = switchOpen && !switchClosing;
  useDismissOnOutside(titleRef, open, closeSwitch, { ignore: '.sbf-switch' });
  // Another cluster on the page: the switch goes at once.
  useEffect(() => { dropSwitch(); }, [board?.id, dropSwitch]);
  const list = useMemo(
    () => Object.values(boards || {}).filter((b) => b && b.workspace_id === board?.workspace_id && !b.deleted_at),
    [boards, board?.workspace_id]);
  const name = board?.name || 'Untitled cluster';
  return (
    <>
      <div className="fp-titlebar">
        {trail && <div className="fp-trail"><PathBar {...trail} /></div>}
        <h1 className="fp-title">
          <button type="button" ref={titleRef} className={`fp-title-btn${open ? ' is-open' : ''}`}
                  aria-haspopup="dialog" aria-expanded={open}
                  title={`${name} · press to see another cluster’s files`}
                  onClick={() => { if (open) closeSwitch(); else { dropSwitch(); setSwitchOpen(true); } }}>
            <span className="fp-title-name">{name}</span>
            <span className="fp-title-caret" aria-hidden="true"><Icon as={ChevronDown} size={14} weight="regular" /></span>
          </button>
        </h1>
        {meta && <span className="fp-meta">{meta}</span>}
        <span className="fp-spacer" />
        {download && (
          <button type="button" className="fp-word fp-dl" onClick={download.onClick} disabled={download.busy}>
            <Icon as={DownloadSimple} size={15} weight="regular" /><span className="fp-word-label">{download.label}</span>
          </button>
        )}
        {shrink && (
          <button type="button" className="fp-word fp-shrink" onClick={shrink.onClick}
                  aria-label={shrink.label} title={shrink.title || shrink.label}>
            <Icon as={ArrowsInSimple} size={15} weight="regular" /><span className="fp-word-label" aria-hidden="true">Shrink</span>
          </button>
        )}
      </div>
      {switchOpen && createPortal(
        <ClusterSwitch list={list} rootId={rootOf(boards, board?.id)} shownId={board?.id} boardId={null}
                       sheet={phone} focusList={phone} closing={switchClosing}
                       tabsRef={titleRef} cardRef={null} width={320}
                       onPick={(id) => { closeSwitch(); if (id && id !== board?.id) onOpenBoard?.(id); }}
                       onClose={closeSwitch} />,
        document.body,
      )}
    </>
  );
}

// Who's here, once each (the toolbar's facepile, in the card's sizes).
function people(faces) {
  const out = [];
  const seen = new Set();
  for (const p of faces || []) {
    const u = p?.user || p;
    if (!u?.id || seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export function FilesPageTools({
  query, onQuery, searchRef, placeholder, menu, found = '', faces = null,
  viewMode, onViewMode, upsell = null, onAddFiles = null,
}) {
  const here = people(faces);
  return (
    <div className="fp-tools">
      <div className="sbf-search fp-search">
        <Icon as={Search} size={14} weight="regular" />
        <input ref={searchRef} type="search" value={query} placeholder={placeholder} aria-label={placeholder}
               onChange={(e) => onQuery(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key !== 'Escape') return;
                 e.preventDefault();
                 e.stopPropagation();
                 if (query) onQuery(''); else e.currentTarget.blur();
               }} />
        {query && (
          <button type="button" className="sbf-search-clear" aria-label="Clear"
                  onClick={() => { onQuery(''); searchRef?.current?.focus(); }}>
            <Icon as={X} size={12} weight="regular" />
          </button>
        )}
      </div>
      <FilesShowMenu {...menu} align="left" />
      {found && <span className="fp-found" aria-live="polite">{found}</span>}
      <span className="fp-spacer" />
      {here.length > 0 && (
        <div className="fp-faces" title={`${here.length} here`}>
          {here.slice(0, 4).map((u) => <Avatar key={u.id} name={u.name} color={u.color} size={22} ring />)}
          {here.length > 4 && <span className="fp-face-more">+{here.length - 4}</span>}
        </div>
      )}
      {viewMode && (
        <div className="sbf-tabs fp-seg" role="radiogroup" aria-label="Layout">
          {[['gallery', 'Grid'], ['table', 'List']].map(([id, label]) => (
            <button type="button" key={id} role="radio" aria-checked={viewMode === id}
                    className={`sbf-tab${viewMode === id ? ' is-on' : ''}`} onClick={() => onViewMode(id)}>
              <span className="sbf-tab-label">{label}</span>
            </button>
          ))}
        </div>
      )}
      {upsell}
      {onAddFiles && (
        <button type="button" className="sbf-upload fp-add" onClick={onAddFiles}>
          <Icon as={Plus} size={14} weight="regular" /><span className="fp-add-label">Add files</span>
        </button>
      )}
    </div>
  );
}
