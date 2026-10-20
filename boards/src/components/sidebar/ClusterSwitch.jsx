// The cluster tab's list: the workspace's clusters, to show another one's
// files without leaving the board. The owner picked "A · Clean" from four
// mockups (2026-10-20: "i just want the drop down to look and feel a little
// better"): the same list, calmer and quicker to use.
//
// - It hangs from the tabs, as wide as the Files card's contents, grows from
//   the tab and stops above the storage meter. More clusters than fit, it
//   scrolls, its edges fading where there's more; with little room under the
//   tabs and more over them, it opens over them instead.
// - The names keep the tree's order (lib/clusterSwitchList.js) and its faint
//   guide lines. The cluster shown is checked; the one on the board says
//   "Open now" only while it isn't the one checked.
// - The find box keeps the keys: ↑/↓ move one highlight and the pointer moves
//   the same one, typing carries on after the arrows, Enter shows the
//   highlighted cluster (or the first found), Escape clears what was typed,
//   then closes. Found clusters are flat, each saying the cluster it's in.
// - In the phone drawer it's a sheet from the bottom with Done; on a touch
//   screen nothing calls the keyboard up until the find box is tapped.
//
// ClusterSidebar opens and closes it (the closing fade is `closing`).

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Search, Check, XCircle } from '../../lib/icons.js';
import { useScrollEdges } from '../../hooks/useScrollEdges.js';
import { clustersInTreeOrder, findClusters } from '../../lib/clusterSwitchList.js';

const STEP = 16;          // a level of nesting, as in the tree
const SHEET_STEP = 18;

// Where the list opens: under the tabs, as wide as the Files card's contents,
// down to the meter. When it doesn't all fit there and the room under the
// tabs is short (a tall tree above leaves the Files card low), it opens over
// the tabs instead if there's more room above, as menus do.
const ROOM = 260;
function placeSwitch(tabs, card, want) {
  if (!tabs) return null;
  const t = tabs.getBoundingClientRect();
  const c = card?.getBoundingClientRect() || null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const inset = c ? Math.max(0, t.left - c.left) : 0;
  const width = Math.min(vw - 16, Math.max(240, c ? c.width - inset * 2 : t.width));
  const left = Math.max(8, Math.min(t.left, vw - width - 8));
  const meter = card?.querySelector('.sbf-meter');
  const floor = Math.min(vh - 8, meter ? meter.getBoundingClientRect().top - 8 : (c ? c.bottom - 8 : vh - 8));
  const top = t.bottom + 6;
  const below = floor - top;
  const above = t.top - 14;
  if (want <= below || below >= ROOM || below >= above) return { left, width, top, maxHeight: Math.max(120, below) };
  return { left, width, bottom: vh - t.top + 6, maxHeight: above };
}

export function ClusterSwitch({
  list,                   // the workspace's clusters
  rootId,
  shownId,                // the cluster whose files show (checked)
  boardId,                // the cluster on the board (none off the board: nothing says "Open now")
  sheet = false,          // the phone drawer's: a sheet from the bottom
  focusList = false,      // a touch screen: the list takes the focus, not the find box
  closing = false,
  tabsRef,
  cardRef,
  onPick,                 // (boardId) => void
  onClose,
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (id) => `${uid}-o-${id}`;
  const [find, setFind] = useState('');
  const [active, setActive] = useState(shownId);
  const [byKeys, setByKeys] = useState(false);
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const pointer = useRef(null);
  useScrollEdges(listRef);

  const all = useMemo(() => clustersInTreeOrder(list, rootId), [list, rootId]);
  const finding = !!find.trim();
  const rows = useMemo(() => (finding ? findClusters(all, find) : all), [all, find, finding]);
  const ids = useMemo(() => rows.map((r) => r.board.id), [rows]);
  const activeId = ids.includes(active) ? active : (finding ? ids[0] ?? null : null);
  const away = !!boardId && shownId !== boardId;

  // Placed before it paints, and again as the window moves under it (not as
  // its own list scrolls).
  useLayoutEffect(() => {
    if (sheet) return undefined;
    const place = (e) => {
      const t = e?.target;
      if (t instanceof Node && popRef.current?.contains(t)) return;
      // All of it: the find line and every row, however much shows now.
      const want = (popRef.current?.querySelector('.sbf-switch-find')?.offsetHeight || 40) + (listRef.current?.scrollHeight || 0);
      setPos(placeSwitch(tabsRef?.current, cardRef?.current, want));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [sheet, tabsRef, cardRef]);

  // Open: the find box takes the keys (on a touch screen the list does, so no
  // keyboard comes up over it), and the cluster checked is in view.
  const placed = sheet || !!pos;
  useEffect(() => {
    if (!placed) return;
    (focusList ? popRef.current : inputRef.current)?.focus({ preventScroll: true });
    const el = listRef.current;
    const on = el?.querySelector('[aria-selected="true"]');
    if (el && on && (on.offsetTop < el.scrollTop || on.offsetTop + on.offsetHeight > el.scrollTop + el.clientHeight)) {
      el.scrollTop = Math.max(0, on.offsetTop - (el.clientHeight - on.offsetHeight) / 2);
    }
  }, [placed]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The keys' highlight stays in view.
  useEffect(() => {
    if (!byKeys || !activeId) return;
    const el = listRef.current;
    const row = document.getElementById(optId(activeId));
    if (!el || !row) return;
    if (row.offsetTop < el.scrollTop) el.scrollTop = row.offsetTop - 5;
    else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight + 5;
  }, [activeId, byKeys]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault();
      if (!ids.length) return;
      const i = ids.indexOf(activeId);
      const j = i < 0 ? (k === 'ArrowDown' ? 0 : ids.length - 1)
        : (i + (k === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
      setActive(ids[j]);
      setByKeys(true);
      return;
    }
    if (k === 'Enter') {
      e.preventDefault();
      const id = activeId || ids[0];
      if (id) onPick(id);
      return;
    }
    if (k === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (find) { setFind(''); setActive(null); } else onClose();
      return;
    }
    if (k === 'Tab') { e.preventDefault(); onClose(); }
  };
  // The pointer moves the highlight only when it moves: a list scrolling
  // under a still pointer (the keys at work) leaves the keys' highlight be.
  const hover = (id) => (e) => {
    const p = pointer.current;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (p && p.x === e.clientX && p.y === e.clientY) return;
    if (active !== id || byKeys) { setActive(id); setByKeys(false); }
  };

  const step = sheet ? SHEET_STEP : STEP;
  const findRow = (
    <label className="sbf-switch-find">
      <Icon as={Search} size={sheet ? 16 : 14} weight="regular" />
      <input ref={inputRef} type="text" role="combobox" aria-expanded="true" aria-controls={listId}
             aria-autocomplete="list" aria-activedescendant={activeId ? optId(activeId) : undefined}
             value={find} placeholder="Find a cluster" aria-label="Find a cluster" autoComplete="off" spellCheck={false}
             onChange={(e) => { setFind(e.target.value); setActive(null); setByKeys(false); }} />
      {find && (
        <button type="button" className="sbf-switch-clear" aria-label="Clear" title="Clear (esc)"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setFind(''); setActive(null); inputRef.current?.focus(); }}>
          <Icon as={XCircle} size={16} weight="fill" />
        </button>
      )}
    </label>
  );
  const listEl = (
    <div ref={listRef} id={listId} role="listbox" aria-label="Clusters" className="sbf-switch-list">
      {rows.map(({ board: b, depth, hit, parentName }) => {
        const name = b.name || 'Untitled';
        const shown = b.id === shownId;
        return (
          <div key={b.id} id={optId(b.id)} role="option" aria-selected={shown}
               className={`sbf-switch-row${b.id === activeId ? ' is-active' : ''}${shown ? ' is-shown' : ''}${hit ? ' is-found' : ''}`}
               style={{ paddingLeft: (sheet ? 14 : 12) + depth * step }}
               onMouseMove={sheet ? undefined : hover(b.id)}
               onMouseDown={(e) => e.preventDefault()}
               onClick={() => onPick(b.id)}>
            {!sheet && depth > 0 && <span className="sbf-switch-guides" style={{ width: depth * STEP }} aria-hidden="true" />}
            <span className="sbf-switch-name">
              {hit ? (
                <>
                  {name.slice(0, hit.at)}
                  <span className="sbf-switch-hit">{name.slice(hit.at, hit.at + hit.length)}</span>
                  {name.slice(hit.at + hit.length)}
                </>
              ) : name}
            </span>
            {finding && parentName && <span className="sbf-switch-where">in {parentName}</span>}
            {away && b.id === boardId && <span className="sbf-switch-note">Open now</span>}
            <span className="sbf-switch-check" aria-hidden="true">
              {shown && <Icon as={Check} size={sheet ? 18 : 14} weight="bold" />}
            </span>
          </div>
        );
      })}
      {!rows.length && <div className="sbf-switch-empty">No cluster is called “{find.trim()}”</div>}
    </div>
  );

  if (sheet) {
    return (
      <>
        <div className={`sbf-switch-scrim${closing ? ' is-closing' : ''}`} aria-hidden="true" onClick={onClose} />
        <div ref={popRef} className={`sbf-switch is-sheet${closing ? ' is-closing' : ''}${byKeys ? ' by-keys' : ''}`} role="dialog"
             aria-label="Show the files of" tabIndex={-1} onKeyDown={onKeyDown}>
          <div className="sbf-switch-grabber" aria-hidden="true" />
          <div className="sbf-switch-head">
            <span className="sbf-switch-title">Show files from</span>
            <button type="button" className="sbf-switch-done" onClick={onClose}>Done</button>
          </div>
          {findRow}
          {listEl}
        </div>
      </>
    );
  }
  return (
    <div ref={popRef} className={`sbf-switch${closing ? ' is-closing' : ''}${pos?.bottom != null ? ' is-above' : ''}`}
         role="dialog" aria-label="Show the files of" tabIndex={-1} onKeyDown={onKeyDown}
         style={pos
           ? { left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }
           : { left: 0, top: 0, visibility: 'hidden' }}>
      {findRow}
      {listEl}
    </div>
  );
}
