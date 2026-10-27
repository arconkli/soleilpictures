import { memo, useLayoutEffect, useRef } from 'react';
import { Btn, Group, Toolbar } from './Toolbar.jsx';
import { MenuButton, MenuHead, MenuItem, MenuSep } from './Menu.jsx';
import { useIslandFit } from './useIslandFit.js';
import {
  AlignCardsBottom, AlignCardsCenter, AlignCardsLeft, AlignCardsMiddle, AlignCardsRight, AlignCardsTop, ArrowBendUpRight,
  BoundingBox, DistributeAcross, DistributeDown, FolderSimplePlus, LayoutGrid, MoreHorizontal, Tag, Trash2,
} from '../../lib/icons.js';

// The selection's bar in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21; the toolbar canvas's A-select frame). Two or more things picked
// on a desktop canvas get, on the bottom row, what right-clicking one of the
// cards offers:
//
//   3 selected | ⊞ Tidy up ⌄  ⊫ ⌄ | ⌗ Group  ▣  ↪ ⌄ | ⋯  🗑
//
// Each control is the card menu's own item (CanvasSurface's buildMenu, by its
// id), and runs the item as the menu builds it when it's used, so it does what
// the right-click does with the selection as it is then: Tidy up's layouts,
// Align's edges and Distribute, Group, New cluster from N cards, Move N cards
// to…. ⋯ opens that menu itself, over the bar, and Delete is ⌫'s. A control
// whose item the menu doesn't hold for this selection (a cluster you can only
// view, strokes with no card) isn't there. Under a finger the selection keeps
// its count at the top.
//
// `items` is the menu for the selection as it was drawn (CanvasSurface keeps
// it while the selection holds), for what shows; `api.items()` builds it
// afresh for a pick, `api.more(rect)` opens it over the bar, `api.del()`
// deletes the selection, or says why it can't.
const find = (items, id) => (items || []).find((it) => it && it.id === id) || null;
// Align's rows drawn as the edge they line the cards up on, and Distribute's
// as the way they spread (the card menu's ids).
const EDGES = {
  left: AlignCardsLeft, 'center-x': AlignCardsCenter, right: AlignCardsRight,
  top: AlignCardsTop, middle: AlignCardsMiddle, bottom: AlignCardsBottom,
  horizontal: DistributeAcross, vertical: DistributeDown,
};

function Rows({ rows, icons = null, onPick }) {
  return rows.map((r, i) => (r.divider
    ? <MenuSep key={`sep${i}`} />
    : <MenuItem key={r.id} icon={icons?.[r.id]} label={r.label} disabled={!!r.disabled} onSelect={() => onPick(r.id)} />));
}

function SelectionBar({ count, items, api, canDelete, tagOpen = false }) {
  const barRef = useRef(null);
  useIslandFit(barRef, { on: true, max: 0 });
  useLiftOverTob(barRef);
  const run = (id, sub) => {
    const it = find(api.items(), id);
    (sub ? find(it?.submenu, sub) : it)?.run?.();
  };
  const tidy = find(items, 'tidy');
  const align = find(items, 'align');
  const spread = find(items, 'distribute');
  const group = find(items, 'group');
  const cluster = find(items, 'new-cluster-from');
  const move = find(items, 'move-cards-to-board');
  const tagMany = find(items, 'tag-many');
  return (
    <Toolbar label="Selection" barRef={barRef} className="sel-a" onPointerDown={(e) => e.stopPropagation()}>
      <Group><span className="sel-count">{count} selected</span></Group>
      {(tidy || align) && (
        <Group>
          {tidy && (
            <MenuButton icon={LayoutGrid} text="Tidy up" caret side="above" menuLabel="Tidy up" menuClassName="sel-a-menu">
              <Rows rows={tidy.submenu} onPick={(sub) => run('tidy', sub)} />
            </MenuButton>
          )}
          {align && (
            <MenuButton icon={AlignCardsLeft} label="Align" caret side="above" menuClassName="sel-a-menu">
              <Rows rows={align.submenu} icons={EDGES} onPick={(sub) => run('align', sub)} />
              {spread && (
                <>
                  <MenuSep />
                  <MenuHead>Distribute</MenuHead>
                  <Rows rows={spread.submenu} icons={EDGES} onPick={(sub) => run('distribute', sub)} />
                </>
              )}
            </MenuButton>
          )}
        </Group>
      )}
      {(group || cluster || move || tagMany) && (
        <Group>
          {group && <Btn icon={BoundingBox} text="Group" keys="Mod+G" onClick={() => run('group')} />}
          {tagMany && (
            <Btn icon={Tag} text="Tag" aria-haspopup="dialog" aria-expanded={tagOpen} data-tag-many-trigger=""
                 onClick={(e) => find(api.items(), 'tag-many')?.run?.(e.currentTarget.getBoundingClientRect())} />
          )}
          {cluster && <Btn icon={FolderSimplePlus} label={cluster.label} onClick={() => run('new-cluster-from')} />}
          {move && (
            <MenuButton icon={ArrowBendUpRight} label={move.label} caret side="above" menuClassName="sel-a-menu sel-a-move">
              <Rows rows={move.submenu} onPick={(sub) => run('move-cards-to-board', sub)} />
            </MenuButton>
          )}
        </Group>
      )}
      <Group>
        {items.length > 0 && (
          <Btn icon={MoreHorizontal} label="More" onClick={(e) => api.more(e.currentTarget.getBoundingClientRect())} />
        )}
        {canDelete && <Btn icon={Trash2} label="Delete" keys="Backspace" onClick={() => api.del()} />}
      </Group>
    </Toolbar>
  );
}

// Over the tool's bar when one shows too (a note's box, picked with others),
// rather than on it: both are the bottom row's middle island.
function useLiftOverTob(barRef) {
  useLayoutEffect(() => {
    const bar = barRef.current;
    const room = bar?.offsetParent;
    if (!bar || !room || typeof MutationObserver === 'undefined') return undefined;
    const lift = () => {
      const tob = room.querySelector(':scope > .tob');
      if (tob && tob.offsetHeight) bar.style.setProperty('--sel-up', `${tob.offsetHeight + 8}px`);
      else bar.style.removeProperty('--sel-up');
    };
    lift();
    const mo = new MutationObserver(lift);
    mo.observe(room, { childList: true });
    return () => mo.disconnect();
  }, [barRef]);
}

export const SelectionBarA = memo(SelectionBar);
