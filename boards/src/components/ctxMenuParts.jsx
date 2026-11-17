import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';
import HapticTap from './HapticTap.jsx';
import { menuIconNow, useMenuIcons } from '../lib/menuIconsLoad.js';
import { Check, ChevronLeft, ChevronRight, Search } from '../lib/icons.js';
import { shortcutAria } from '../lib/looks.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { shellOf } from '../lib/deviceShell.js';
import { isComposingKey } from '../lib/composerKeys.js';
import { placeFlyout } from '../lib/ctxMenuFit.js';
import { inSafeTriangle, tidyMenu, typeaheadIndex } from '../lib/menuKeys.js';
import { t as tr, ph } from '@lingui/core/macro';

// The parts the one right-click menu shares (CardContextMenu.jsx, which
// BackgroundContextMenu.jsx wraps): a row (icon, label, hint, aside, plain-text
// shortcut, check, caret), the quick row and its tooltip, a flyout, the keys
// that walk a menu, and the step-in a phone's sheet (or a window with no room
// beside the menu) uses instead of a flyout.
//
// A row says its shortcut to a screen reader in its aria-keyshortcuts
// (rowKeys), not in its name; the text drawn beside it is aria-hidden.
//
// A phone has no room beside a menu, so there a submenu steps in instead of
// flying out: the list swaps its rows for ‹ and the submenu's name, a
// hairline, and the submenu's rows (useCtxStep, CtxStepView), and ‹ (or ←, or
// Escape) brings the menu back. A submenu's row can have a submenu of its
// own (Group > Outline shape): in a flyout it opens a flyout beside that one;
// stepped in, it steps a level deeper, and ‹ comes back a level at a time.

// What the menu hands its parts (CardContextMenu): choose(row) runs a row
// (single-flight, focus back first, closes every menu), closeAll() closes
// with the focus back, stepIn(row, byKey) is useCtxStep's, root names what ‹
// goes back to. Flyouts render in a portal; React context goes through it.
export const CtxContext = createContext({ choose() {}, closeAll: null, stepIn: null, root: 'card' });

export function rowKeys(written) {
  return written ? { 'aria-keyshortcuts': shortcutAria(written) } : {};
}

const resolveIcon = (icon) => (typeof icon === 'string' ? menuIconNow(icon) : icon || null);

// Does any row carry an icon or a swatch? If none, the menu drops the column.
export function menuHasIcons(rows) {
  return (rows || []).some((r) => r && !r.divider && r.header === undefined && r.caption === undefined && (r.icon || r.swatch));
}

const isRow = (r) => !!r && !r.divider && r.header === undefined && r.caption === undefined && !r.backlinks;

// Plain text, 12px muted (styles.css); the row keeps the keys in rowKeys.
export function CtxShortcut({ keys }) {
  if (!keys) return null;
  return <span className="ctx-shortcut" aria-hidden="true">{keys}</span>;
}

export function CtxChevron() {
  return <Icon as={ChevronRight} size={12} weight="regular" className="ctx-chevron" aria-hidden="true" />;
}

function CtxIconSlot({ it }) {
  useMenuIcons();
  const Ic = resolveIcon(it.icon);
  return (
    <span className="ctx-icon" aria-hidden="true">
      {it.swatch
        ? <span className="ctx-swatch-dot" style={{
          background: it.swatch === 'transparent'
            ? 'repeating-conic-gradient(var(--ink-4) 0% 25%, var(--bg-3) 0% 50%) 0 0 / 6px 6px'
            : it.swatch,
        }} />
        : Ic ? <Icon as={Ic} size={16} weight="regular" /> : null}
    </span>
  );
}

// A row's insides. `trailing` is the caret of a row that opens a submenu.
function RowBody({ it, hasIcons, trailing = null }) {
  return (
    <>
      {hasIcons && <CtxIconSlot it={it} />}
      <span className="ctx-text">
        <span className="ctx-label">{it.label}</span>
        {it.hint && <span className="ctx-hint">{it.hint}</span>}
      </span>
      {it.aside && <span className="ctx-aside">{it.aside}</span>}
      <CtxShortcut keys={it.shortcut} />
      {it.checked === true && <Icon as={Check} size={14} weight="regular" className="ctx-check" aria-hidden="true" />}
      {trailing}
    </>
  );
}

function CtxItem({ it, hasIcons }) {
  const { choose } = useContext(CtxContext);
  const toggle = typeof it.checked === 'boolean';
  return (
    <button type="button"
            className={`ctx-item${it.swatch ? ' ctx-swatch-row' : ''}${it.danger ? ' danger' : ''}`}
            role={toggle ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem'}
            aria-checked={toggle ? it.checked : undefined}
            aria-disabled={it.disabled ? 'true' : undefined}
            {...rowKeys(it.shortcut)}
            onClick={() => { if (!it.disabled) choose(it); }}>
      <RowBody it={it} hasIcons={hasIcons} />
      {it.danger && <HapticTap />}
    </button>
  );
}

// A list of rows: tidied (headers are dividers, none first, last or doubled,
// no empty captions), submenu rows drawn by `nest`.
export function CtxList({ rows, hasIcons, nest }) {
  return tidyMenu(rows).map((r, i) => {
    if (r.divider) return <div key={`d-${i}`} className="ctx-divider" role="separator" />;
    if (r.caption !== undefined) return <div key={`c-${i}`} className="ctx-caption">{r.caption}</div>;
    if (r.backlinks) return null;
    if (r.submenu) return nest(r, r.id ?? i, hasIcons);
    return <CtxItem key={r.id ?? i} it={r} hasIcons={hasIcons} />;
  });
}

// ── Keys ────────────────────────────────────────────────────────────────────
const typed = new WeakMap(); // menu element -> { q, at }

// The WAI-ARIA menu's keys, for a menu element's onKeyDown (the root, a
// flyout, the phone sheet's wrapper). Quick buttons then rows are the stops:
// ↑ ↓ walk the rows round the ends (aria-disabled ones too), the quick row is
// the first stop (↓ from it → the first row, ↑ from the first row → it, ← →
// along it), Home/End, type-ahead. Tab closes (closeAll, which puts the focus
// back first). A flyout's keys reach the menu it opened from through the
// portal, so what is handled stops here.
export function handleMenuKeys(e, { closeAll = null, back = null } = {}) {
  if (isComposingKey(e)) return;
  if (e.key === 'Tab') {
    if (closeAll) { e.stopPropagation(); closeAll(); }
    return;
  }
  if (e.target?.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft' && back && back()) { e.preventDefault(); e.stopPropagation(); return; }
  const scope = e.currentTarget;
  const quick = [...scope.querySelectorAll('button.ctx-quick-btn')];
  const rows = [...scope.querySelectorAll('button.ctx-item')];
  const a = document.activeElement;
  const qi = quick.indexOf(a);
  const ri = rows.indexOf(a);
  const firstStop = quick[0] || rows[0];
  const lastRow = rows[rows.length - 1] || quick[quick.length - 1];
  let next = null;
  if (qi >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    next = quick[(qi + (e.key === 'ArrowRight' ? 1 : -1) + quick.length) % quick.length];
  } else if (e.key === 'ArrowDown') {
    if (qi >= 0) next = rows[0] || quick[0];
    else if (ri < 0 || ri === rows.length - 1) next = firstStop;
    else next = rows[ri + 1];
  } else if (e.key === 'ArrowUp') {
    if (qi >= 0 || ri < 0) next = lastRow;
    else if (ri === 0) next = scope.querySelector('.ctx-search input') || quick[0] || lastRow;
    else next = rows[ri - 1];
  } else if (e.key === 'Home') next = firstStop;
  else if (e.key === 'End') next = lastRow;
  if (next || ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
    return;
  }
  // Type-ahead: a query that resets after 500ms idle.
  const now = Date.now();
  const st = typed.get(scope) || { q: '', at: 0 };
  const live = now - st.at <= 500 && !!st.q;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key !== ' ' || live)) {
    e.preventDefault();
    e.stopPropagation();
    st.q = live ? st.q + e.key : e.key;
    st.at = now;
    typed.set(scope, st);
    const labels = rows.map((r) => r.querySelector('.ctx-label')?.textContent || '');
    const i = typeaheadIndex(labels, ri, st.q);
    if (i >= 0) rows[i].focus();
  }
}

// ── Search inside a submenu ──────────────────────────────────────────────────
const fold = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function filterRows(rows, q) {
  if (!q) return rows;
  const out = [];
  let cap = null;
  for (const r of rows) {
    if (!r) continue;
    if (r.caption !== undefined) { cap = r; continue; }
    if (!isRow(r)) continue;
    if (fold(`${r.label} ${r.aside || ''}`).includes(q)) {
      if (cap) { out.push(cap); cap = null; }
      out.push(r);
    }
  }
  return out;
}

// A submenu's rows, in its flyout or stepped in, with its search field when
// its row asks for one (`search: { placeholder }`).
function CtxSubList({ item, nest, onShape = null }) {
  const { choose } = useContext(CtxContext);
  const [q, setQ] = useState('');
  const hasIcons = menuHasIcons(item.submenu);
  // A flyout re-places itself when its query changes what it shows (not on mount:
  // its first placement is the flyout's own).
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    onShape && onShape();
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const needle = fold(q.trim());
  const shown = filterRows(item.submenu, needle);
  const none = !!needle && !shown.some(isRow);
  const onField = (e) => {
    if (isComposingKey(e)) return;
    if (e.key === 'Escape' && q) { e.preventDefault(); e.stopPropagation(); setQ(''); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      // The first result of this field's own list, not the Back row.
      e.currentTarget.closest('.ctx-step-body, .ctx-submenu')?.querySelector('button.ctx-item:not(.is-back)')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const first = shown.find((r) => isRow(r) && !r.submenu && !r.disabled);
      if (first) choose(first);
    }
  };
  return (
    <>
      {item.search && (
        <div className="ctx-search">
          <Icon as={Search} size={14} weight="regular" aria-hidden="true" />
          <input type="search" value={q} placeholder={item.search.placeholder}
                 aria-label={item.search.placeholder || item.label}
                 autoComplete="off" spellCheck={false}
                 onChange={(e) => setQ(e.target.value)} onKeyDown={onField} />
        </div>
      )}
      <CtxList rows={shown} hasIcons={hasIcons} nest={nest} />
      {none && <div className="ctx-empty">{tr`No matches`}</div>}
    </>
  );
}

// ── The step-in ─────────────────────────────────────────────────────────────
// The submenu a menu has stepped into, for the menu that holds it
// (CardContextMenu). The step is a path: the ids from the menu's own row down
// to the submenu showing, one per level. `item` is that submenu's row and
// `parent` the row a level up (null at the first level), both read from the
// menu's current items by the path's ids so their actions are never stale;
// stepIn is what the menu hands CtxStepView (and, through context, the flyouts
// that find no room); back() goes up one level, with the focus on the row
// that stepped in, and says whether there was a step to leave (Escape goes
// back a level first, then closes). `top`, `left` and `width` are the menu's
// when it stepped: the stepped view takes its place.
export function useCtxStep(open, items, menuRef) {
  const [at, setAt] = useState(null); // {path: [{id, scrollTop}], top, left, width, byKey, hadFocus, cap}
  const backTo = useRef(null);
  useEffect(() => { if (!open) { setAt(null); backTo.current = null; } }, [open]);
  // The path, as far as the current items still have it.
  const chain = [];
  if (open && at) {
    let rows = items;
    for (const { id } of at.path) {
      const it = rows.find((r) => r && r.submenu && r.id === id);
      if (!it) break;
      chain.push(it);
      rows = it.submenu;
    }
  }
  const item = chain[chain.length - 1] || null;
  const parent = chain[chain.length - 2] || null;
  const depth = chain.length;
  const depthRef = useRef(0);
  depthRef.current = depth;
  const stepIn = (it, byKey = false) => {
    const el = menuRef.current;
    const hadFocus = !!el && el.contains(document.activeElement);
    if (at && depthRef.current) {
      // A level deeper, from the stepped view: its rows are what scrolled.
      const scrollTop = el?.querySelector('.ctx-step-body')?.scrollTop ?? 0;
      setAt({ ...at, path: [...at.path.slice(0, depthRef.current), { id: it.id, scrollTop }], byKey, hadFocus });
      return;
    }
    const r = el?.getBoundingClientRect();
    // scrollTop and cap: where the menu was scrolled to, and the height it
    // was held to. The stepped view reuses its box, which resets both.
    setAt({ path: [{ id: it.id, scrollTop: el?.scrollTop ?? 0 }], top: r?.top ?? 0, left: r?.left ?? 0, width: r?.width, byKey, hadFocus,
            cap: el?.style.maxHeight ?? '' });
  };
  const back = () => {
    if (!depthRef.current || !at) return false;
    const { id, scrollTop } = at.path[depthRef.current - 1];
    backTo.current = { id, scrollTop, cap: at.cap };
    setAt(depthRef.current > 1 ? { ...at, path: at.path.slice(0, depthRef.current - 1) } : null);
    return true;
  };
  const steppedKey = chain.map((it) => it.id).join('/');
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const from = backTo.current;
    backTo.current = null;
    const stepRow = (within) => [...within.querySelectorAll('button.ctx-has-submenu')].find((b) => b.dataset.stepId === String(from.id));
    if (depth && from == null) {
      // The row that stepped in is gone, and the focus with it: on the first
      // row from the keys, on ‹ from a press that had it.
      if (at?.byKey) el.querySelector('.ctx-step-body button.ctx-item')?.focus({ preventScroll: true });
      else if (at?.hadFocus) el.querySelector('button.ctx-item.is-back')?.focus({ preventScroll: true });
      return;
    }
    if (from == null) return;
    if (depth) {
      // Back up a level, still stepped in: its rows where they were.
      const body = el.querySelector('.ctx-step-body');
      if (!body) return;
      body.scrollTop = from.scrollTop;
      stepRow(body)?.focus({ preventScroll: true });
      return;
    }
    // Scrolled to where it was (under the cap it had, or the scroll clamps
    // short), so a row reached by scrolling is on screen again.
    el.style.maxHeight = from.cap;
    el.scrollTop = from.scrollTop;
    stepRow(el)?.focus({ preventScroll: true });
  }, [steppedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { item, parent, top: at?.top, left: at?.left, width: at?.width, stepIn, back };
}

// A row that steps a level in (a phone's sheet, or a menu with no room beside
// it): → Enter or Space from the keys, with its first row focused.
export function CtxStepRow({ it, hasIcons }) {
  const { stepIn } = useContext(CtxContext);
  return (
    <button type="button" className={`ctx-item ctx-has-submenu${it.danger ? ' danger' : ''}`}
            role="menuitem" aria-haspopup="menu" aria-expanded={false}
            aria-disabled={it.disabled ? 'true' : undefined}
            data-step-id={it.id}
            onKeyDown={(e) => {
              if (isComposingKey(e)) return;
              if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              if (!it.disabled) stepIn && stepIn(it, true);
            }}
            onClick={() => { if (!it.disabled) stepIn && stepIn(it); }}>
      <RowBody it={it} hasIcons={hasIcons} trailing={<CtxChevron />} />
    </button>
  );
}

// A stepped-in submenu, in its menu's box: ‹ and its name, a hairline, its
// rows. ‹ says what it goes back to: the submenu a level up (`parent`), or at
// the first level the menu, which `root` names: 'card', 'canvas' or, for the
// others, just "the menu".
export function CtxStepView({ item, parent = null, root, onBack }) {
  const nest = (sub, key, hasIcons) => <CtxStepRow key={key} it={sub} hasIcons={hasIcons} />;
  // The submenu a level up is named in the doc menus' sentence (toolbar/Menu.jsx).
  const backLabel = parent
    ? tr`${ph({ label: item.label })}, back to ${ph({ label2: parent.label })}`
    : root === 'card' ? tr`${ph({ label: item.label })}, back to the card menu`
      : root === 'canvas' ? tr`${ph({ label: item.label })}, back to the canvas menu`
        : tr`${ph({ label: item.label })}, back to the menu`;
  return (
    <>
      <button type="button" className="ctx-item is-back" role="menuitem"
              aria-label={backLabel}
              onClick={onBack}>
        <Icon as={ChevronLeft} size={20} weight="regular" className="ctx-back-chevron" aria-hidden="true" />
        <span className="ctx-label">{item.label}</span>
      </button>
      <div className="ctx-divider" role="separator" />
      {/* Keyed by the level: a deeper one starts at its top, not where the last was scrolled. */}
      <div className="ctx-step-body" key={item.id}>
        <CtxSubList item={item} nest={nest} />
      </div>
    </>
  );
}

// ── The quick row ───────────────────────────────────────────────────────────
// One row of icon buttons at the top of the menu (`tiles`: labelled tiles in
// the phone's sheet). The tooltip is portaled: the menu scrolls and would clip
// it. It shows after ~350ms of hover, at once when the keys focus a button.
export function CtxQuick({ quick, tiles = false }) {
  useMenuIcons();
  const { choose } = useContext(CtxContext);
  const [tip, setTip] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);
  const hide = () => { clearTimeout(timerRef.current); setTip(null); };
  const showTip = (q, el, delay) => {
    clearTimeout(timerRef.current);
    const go = () => {
      const r = el.getBoundingClientRect();
      setTip({ label: q.label, keys: q.shortcut, cx: Math.max(70, Math.min(r.left + r.width / 2, window.innerWidth - 70)), top: r.top });
    };
    if (delay) timerRef.current = setTimeout(go, delay); else go();
  };
  return (
    <>
      <div className={`ctx-quick${tiles ? ' is-tiles' : ''}`} role="group" aria-label={tr`Quick actions`}>
        {quick.map((q) => {
          const Ic = resolveIcon(q.icon);
          return (
            <button key={q.id ?? q.label} type="button"
                    className={`ctx-quick-btn${q.danger ? ' danger' : ''}`}
                    role="menuitem" aria-label={q.label} {...rowKeys(q.shortcut)}
                    onClick={() => { hide(); choose(q); }}
                    onPointerEnter={tiles ? undefined : (e) => { if (e.pointerType === 'mouse') showTip(q, e.currentTarget, 350); }}
                    onPointerLeave={tiles ? undefined : hide}
                    onFocus={tiles ? undefined : (e) => { if (e.currentTarget.matches(':focus-visible')) showTip(q, e.currentTarget, 0); }}
                    onBlur={tiles ? undefined : hide}>
              {Ic && <Icon as={Ic} size={tiles ? 20 : 18} weight="regular" aria-hidden="true" />}
              {tiles && <span className="ctx-quick-label">{q.short ?? q.label}</span>}
              {q.danger && <HapticTap />}
            </button>
          );
        })}
      </div>
      {tip && !tiles && createPortal(
        <div className="ctx-quick-tip" aria-hidden="true"
             style={{ left: tip.cx, top: tip.top - 6, transform: 'translate(-50%, -100%)' }}>
          <span className="ctx-quick-tip-label">{tip.label}</span>
          {tip.keys && <span className="ctx-quick-tip-keys">{tip.keys}</span>}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── The phone sheet's header ────────────────────────────────────────────────
export function CtxSheetHeader({ preview, title }) {
  if (!preview && !title) return null;
  const p = preview || {};
  const lead = p.mosaic?.length
    ? <span className="ctx-sheet-mosaic" aria-hidden="true">{p.mosaic.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" loading="lazy" decoding="async" />)}</span>
    : p.thumbs?.length
      ? <span className="ctx-sheet-thumbs" aria-hidden="true">{p.thumbs.slice(0, 3).map((u, i) => <img key={i} src={u} alt="" loading="lazy" decoding="async" />)}</span>
      : p.thumb
        ? <span className="ctx-sheet-thumb" aria-hidden="true"><img src={p.thumb} alt="" loading="lazy" decoding="async" /></span>
        : p.tint
          ? <span className="ctx-sheet-tint" aria-hidden="true" style={{ background: p.tint }} />
          : null;
  return (
    <div className="ctx-sheet-head">
      {lead}
      <div className="ctx-sheet-titles">
        <div className="ctx-sheet-name">{p.name ?? title}</div>
        {p.kind && <div className="ctx-sheet-kind">{p.kind}</div>}
      </div>
    </div>
  );
}

// ── The flyout ──────────────────────────────────────────────────────────────
// Where a mouse is heading from a row to its flyout, per menu element: while
// it holds (the safe triangle, at most 400ms) other rows' flyouts don't open.
const intents = new WeakMap(); // menu element -> { owner, contains(x, y), end() }
// Sent to a menu's box when a tap, the keys or a hover open one of its flyouts.
const SUB_OPENED = 'soleil-ctx-sub-opened';

// A row that opens a submenu, and the submenu, portaled to <body> so its
// position: fixed escapes the menu's transform. It is rendered hidden,
// measured, and placed (placeFlyout); with no room on either side and a menu
// that can step in (`canStep`) it steps in instead. A mouse over the row opens
// it at once; leaving toward the flyout keeps it open inside the safe
// triangle (400ms at most), leaving anywhere else closes it after 120ms; a
// tap or a click toggles it (a finger's enter and leave come with its tap);
// → Enter or Space opens it with its first row focused, and ← or Escape
// closes it, back on the row.
//
// A row of it with a submenu of its own is another of these, inside the
// flyout, opening beside that one on the side it went (`prefer`). React
// counts the nested flyout as inside this one, so a mouse on its way into it
// never leaves this one.
export function CtxSubmenu({ item, hasIcons, canStep = false, prefer = 'right' }) {
  const ctl = useContext(CtxContext);
  const { coarse } = shellOf(useBreakpoint());
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(null);
  const [, force] = useReducer((n) => n + 1, 0);
  const wrapRef = useRef(null);
  const rowRef = useRef(null);
  const subRef = useRef(null);
  const closeTimerRef = useRef(null);
  const capRef = useRef(null);
  const moveRef = useRef(null);
  const intentMenuRef = useRef(null);
  const placedRef = useRef(false);
  const wantRef = useRef(null); // 'row' | 'field': where the focus goes once placed
  const keysRef = useRef(false);
  const sideRef = useRef(null);
  sideRef.current = side;

  const endIntent = () => {
    clearTimeout(capRef.current);
    if (moveRef.current) { document.removeEventListener('pointermove', moveRef.current, true); moveRef.current = null; }
    const menu = intentMenuRef.current;
    if (menu && intents.get(menu)?.owner === wrapRef.current) intents.delete(menu);
    intentMenuRef.current = null;
  };
  // A flyout that holds the focus (a search field takes it on hover) hands it
  // to its row as it closes: left alone it falls to <body> and the keys reach
  // the canvas. A flyout of this one counts as inside it.
  const holdsFocus = () => {
    let el = document.activeElement?.closest?.('.ctx-submenu');
    while (el) {
      if (el === subRef.current) return true;
      el = el.__ctxParent || null;
    }
    return false;
  };
  const closeFlyout = () => {
    if (holdsFocus()) rowRef.current?.focus({ preventScroll: true });
    setOpen(false);
  };
  const scheduleClose = () => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(closeFlyout, 120);
  };
  useEffect(() => () => { clearTimeout(closeTimerRef.current); endIntent(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One flyout per menu: a tap, the keys or a hover opening another row's
  // closes this one. Under a finger the menu scrolling closes it too: the
  // flyout is fixed, so it would stay where it was while its row scrolled away.
  useEffect(() => {
    const menu = wrapRef.current?.closest('.ctx-menu');
    if (!open || !menu) return undefined;
    const onOther = (e) => { if (e.detail !== wrapRef.current) closeFlyout(); };
    const close = () => closeFlyout();
    menu.addEventListener(SUB_OPENED, onOther);
    if (coarse) menu.addEventListener('scroll', close, { passive: true });
    return () => {
      menu.removeEventListener(SUB_OPENED, onOther);
      menu.removeEventListener('scroll', close);
    };
  }, [open, coarse]);

  // Measured, then placed: no row-count guess. Hidden until its first
  // placement; placed again after each render (a search narrows it).
  useLayoutEffect(() => {
    if (!open) { placedRef.current = false; return; }
    const sub = subRef.current;
    const wrap = wrapRef.current;
    const row = rowRef.current;
    const menuEl = wrap?.closest('.ctx-menu');
    if (!sub || !wrap || !row || !menuEl) return;
    sub.style.left = '0px';
    sub.style.top = '0px';
    sub.style.maxHeight = '';
    const w = sub.offsetWidth;
    const h = sub.scrollHeight + (sub.offsetHeight - sub.clientHeight);
    // The menu's own box, not the one its open animation (scale .98) draws.
    const mr = menuEl.getBoundingClientRect();
    const ml = menuEl.offsetParent ? mr.left : menuEl.offsetLeft;
    const mt = menuEl.offsetParent ? mr.top : menuEl.offsetTop;
    const m = { left: ml, right: ml + menuEl.offsetWidth, top: mt, bottom: mt + menuEl.offsetHeight };
    const r = row.getBoundingClientRect();
    const p = placeFlyout({
      menu: m,
      row: { top: r.top }, w, h, vw: window.innerWidth, vh: window.innerHeight, prefer,
    });
    if (p.side === null && canStep && ctl.stepIn) {
      setOpen(false);
      ctl.stepIn(item, keysRef.current);
      return;
    }
    sub.style.left = `${p.left}px`;
    sub.style.top = `${p.top}px`;
    sub.style.maxHeight = p.maxHeight != null ? `${p.maxHeight}px` : '';
    setSide((s) => (s === p.side ? s : p.side));
    if (!placedRef.current) {
      placedRef.current = true;
      sub.style.visibility = '';
    }
    const want = wantRef.current;
    if (want) {
      wantRef.current = null;
      const target = want === 'field' ? sub.querySelector('.ctx-search input') : sub.querySelector('button.ctx-item');
      target?.focus({ preventScroll: true });
    }
  });

  const show = (keys = false) => {
    clearTimeout(closeTimerRef.current);
    keysRef.current = keys;
    wantRef.current = item.search ? (keys || !coarse ? 'field' : null) : keys ? 'row' : null;
    setOpen(true);
    force();
  };
  // The menu's other flyouts close as this one opens.
  const showAlone = (keys = false) => {
    show(keys);
    wrapRef.current?.closest('.ctx-menu')?.dispatchEvent(new CustomEvent(SUB_OPENED, { detail: wrapRef.current }));
  };

  // A mouse only. Another row's flyout, while the pointer is on its way into
  // this row's (inside its safe triangle), does not open.
  const hover = (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimerRef.current);
    if (open) return;
    const menu = wrapRef.current?.closest('.ctx-menu');
    const intent = menu && intents.get(menu);
    if (intent && intent.owner !== wrapRef.current) {
      if (intent.contains(e.clientX, e.clientY)) return;
      intent.end();
    }
    showAlone(false);
  };
  const handleLeave = (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimerRef.current);
    const sub = subRef.current;
    const menu = wrapRef.current?.closest('.ctx-menu');
    if (!open || !sub || !menu) { scheduleClose(); return; }
    endIntent();
    const origin = { x: e.clientX, y: e.clientY };
    const t0 = performance.now();
    const contains = (x, y) => performance.now() - t0 < 400
      && !!subRef.current && inSafeTriangle({ x, y }, origin, subRef.current.getBoundingClientRect(), sideRef.current || 'right');
    const stop = () => { endIntent(); scheduleClose(); };
    moveRef.current = (ev) => {
      if (subRef.current?.contains(ev.target)) { endIntent(); return; }
      if (!contains(ev.clientX, ev.clientY)) stop();
    };
    document.addEventListener('pointermove', moveRef.current, true);
    capRef.current = setTimeout(stop, 400);
    intentMenuRef.current = menu;
    intents.set(menu, { owner: wrapRef.current, contains, end: stop });
  };

  const onRowKey = (e) => {
    if (isComposingKey(e)) return;
    if (e.key !== 'ArrowRight' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (item.disabled) return;
    showAlone(true);
  };
  const closeToRow = () => { setOpen(false); rowRef.current?.focus(); };
  const onSubKey = (e) => {
    if (isComposingKey(e)) return;
    const inField = e.target?.tagName === 'INPUT';
    // ← closes this flyout; Escape is the menu's (CardContextMenu closes the
    // whole menu, a search field with text clearing first).
    if (e.key === 'ArrowLeft' && !inField) {
      e.preventDefault();
      e.stopPropagation();
      closeToRow();
      return;
    }
    handleMenuKeys(e, { closeAll: ctl.closeAll });
  };
  const nest = (sub, key, icons) => <CtxSubmenu key={key} item={sub} hasIcons={icons} prefer={side || prefer} />;

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onPointerEnter={hover} onPointerMove={hover} onPointerLeave={handleLeave}>
      <button ref={rowRef} type="button" className={`ctx-item ctx-has-submenu${item.danger ? ' danger' : ''}`}
              role="menuitem" aria-haspopup="menu" aria-expanded={open}
              aria-disabled={item.disabled ? 'true' : undefined}
              data-step-id={item.id}
              onKeyDown={onRowKey}
              onClick={() => { if (item.disabled) return; if (open) closeFlyout(); else showAlone(); }}>
        <RowBody it={item} hasIcons={hasIcons} trailing={<CtxChevron />} />
      </button>
      {open && createPortal(
        <div ref={(el) => {
          subRef.current = el;
          if (el) el.__ctxParent = wrapRef.current?.closest('.ctx-submenu') || null;
        }}
             className={`ctx-menu ctx-submenu is-scrollable${menuHasIcons(item.submenu) ? '' : ' no-icons'}${item.search ? ' has-search' : ''}`}
             role="menu" aria-label={item.label}
             style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden', overflowY: 'auto' }}
             onKeyDown={onSubKey}
             onPointerEnter={hover}
             onPointerLeave={handleLeave}>
          <CtxSubList item={item} nest={nest} onShape={force} />
        </div>,
        document.body,
      )}
    </div>
  );
}
