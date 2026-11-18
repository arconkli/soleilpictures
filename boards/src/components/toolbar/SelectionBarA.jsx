import { memo, useLayoutEffect, useRef } from 'react';
import { Btn, Group, Toolbar } from './Toolbar.jsx';
import { MenuButton, MenuHead, MenuItem, MenuSep } from './Menu.jsx';
import { useIslandFit } from './useIslandFit.js';
import {
  AlignCardsBottom, AlignCardsCenter, AlignCardsLeft, AlignCardsMiddle, AlignCardsRight, AlignCardsTop, ArrowBendUpRight,
  BoundingBox, DistributeAcross, DistributeDown, FolderSimplePlus, LayoutGrid, MoreHorizontal, Trash2,
} from '../../lib/icons.js';
import { t, plural } from '@lingui/core/macro';

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
  'align-left': AlignCardsLeft, 'align-center': AlignCardsCenter, 'align-right': AlignCardsRight,
  'align-top': AlignCardsTop, 'align-middle': AlignCardsMiddle, 'align-bottom': AlignCardsBottom,
  'distribute-h': DistributeAcross, 'distribute-v': DistributeDown,
};

function Rows({ rows, icons = null, onPick }) {
  // A row with a submenu or a search field, and the recent block (the bar has
  // no captions), stays in the menu. A row's aside (a cluster's parent path)
  // leads its label, as main's move list had it, so same-named clusters differ.
  return rows.filter((r) => r.divider || (r.id && !r.submenu && !r.search && !r.id.startsWith('recent-'))).map((r, i) => (r.divider
    ? <MenuSep key={`sep${i}`} />
    : <MenuItem key={r.id} icon={icons?.[r.id]} label={r.aside ? `${r.aside} / ${r.label}` : r.label} disabled={!!r.disabled} onSelect={() => onPick(r.id)} />));
}

function SelectionBar({ count, items, api, canDelete }) {
  const barRef = useRef(null);
  useIslandFit(barRef, { on: true, max: 0 });
  useLiftOverTob(barRef);
  const run = (id, sub) => {
    const it = find(api.items(), id);
    (sub ? find(it?.submenu, sub) : it)?.run?.();
  };
  const tidy = find(items, 'tidy');
  // The card menu's Align › holds the edges, then (three or more) Distribute.
  const alignAll = find(items, 'align');
  const align = alignAll && { ...alignAll, submenu: alignAll.submenu.filter((r) => r.id?.startsWith('align-')) };
  const spread = alignAll && { submenu: alignAll.submenu.filter((r) => r.id?.startsWith('distribute-')) };
  const group = find(items, 'group-these');
  const cluster = find(items, 'new-cluster-from');
  const move = find(items, 'move');
  return (
    <Toolbar label={t`Selection`} barRef={barRef} className="sel-a" onPointerDown={(e) => e.stopPropagation()}>
      <Group><span className="sel-count">{plural(count, { one: '# selected', other: '# selected' })}</span></Group>
      {(tidy || align) && (
        <Group>
          {tidy && (
            <MenuButton icon={LayoutGrid} text={t`Tidy up`} caret side="above" menuLabel={t`Tidy up`} menuClassName="sel-a-menu">
              <Rows rows={tidy.submenu} onPick={(sub) => run('tidy', sub)} />
            </MenuButton>
          )}
          {align && align.submenu.length > 0 && (
            <MenuButton icon={AlignCardsLeft} label={t`Align`} caret side="above" menuClassName="sel-a-menu">
              <Rows rows={align.submenu} icons={EDGES} onPick={(sub) => run('align', sub)} />
              {spread && spread.submenu.length > 0 && (
                <>
                  <MenuSep />
                  <MenuHead>{t`Distribute`}</MenuHead>
                  <Rows rows={spread.submenu} icons={EDGES} onPick={(sub) => run('align', sub)} />
                </>
              )}
            </MenuButton>
          )}
        </Group>
      )}
      {(group || cluster || move) && (
        <Group>
          {group && <Btn icon={BoundingBox} text={t({ message: 'Group', context: 'verb' })} keys="Mod+G" onClick={() => run('group-these')} />}
          {cluster && <Btn icon={FolderSimplePlus} label={cluster.label} onClick={() => run('new-cluster-from')} />}
          {move && (
            <MenuButton icon={ArrowBendUpRight} label={move.label} caret side="above" menuClassName="sel-a-menu sel-a-move">
              <Rows rows={move.submenu} onPick={(sub) => run('move', sub)} />
            </MenuButton>
          )}
        </Group>
      )}
      <Group>
        {items.length > 0 && (
          <Btn icon={MoreHorizontal} label={t`More`} onClick={(e) => api.more(e.currentTarget.getBoundingClientRect())} />
        )}
        {canDelete && <Btn icon={Trash2} label={t`Delete`} keys="Backspace" onClick={() => api.del()} />}
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
