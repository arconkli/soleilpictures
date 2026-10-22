import { useEffect, useMemo, useRef, useState } from 'react';
import { yUndoPluginKey } from 'y-prosemirror';
import { Icon } from '../Icon.jsx';
import { Btn } from '../toolbar/Toolbar.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { paintFindHits } from '../DocFindReplace.jsx';
import { DocSeg } from './DocSeg.jsx';
import { docHits, matchesInPM, replaceInPages } from '../../lib/docFind.js';
import { docPageOrder } from '../../lib/docBlocks.js';
import {
  DOC_ORIGIN, getDocUndoManager, pageContentMap, sheetContentMap, pagesArray,
} from '../../lib/docState.js';
import { undoToast } from '../../lib/undoToast.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { Search, ArrowsLeftRight, ChevronUp, ChevronDown } from '../../lib/icons.js';

// The side panel's Find (the owner's pick of 2026-10-21, mockup dx AC-find):
// a search of every page of the doc, or the one open, in any case or as
// typed (Aa), anywhere or as whole words; its hits listed by page, each with
// the words around it, and lit in the open page; ↑ ↓ (⇧⏎ ⏎) step through
// them, opening the page each is on; Replace and Replace all for those who
// can edit, Replace all on every page at once with one Undo. The search
// itself is lib/docFind.js; it reads the doc's pages as they're stored, so
// pages that aren't open are searched too.
//
// The open page is changed through its editors, so ⌘Z in its text takes
// a Replace back as it does any edit; the other pages in place, as one step
// on the doc's own undo (docState getDocUndoManager), which ⌘Z outside the
// text takes back. The toast's Undo takes back both.

const SCOPES = [{ value: 'page', label: 'This page' }, { value: 'all', label: 'All pages' }];
// A list of thousands is no use to read: the first ones are shown, and ↑ ↓
// still go through every hit.
const LIST_MAX = 300;

// Editors are told apart by who they are, not where, for the highlights'
// effect (DocFindReplace.jsx does the same).
const edIds = new WeakMap();
let nextEdId = 1;
const edId = (ed) => {
  if (!edIds.has(ed)) edIds.set(ed, nextEdId++);
  return edIds.get(ed);
};

// The k-th hit across a page's editors (in sheet order), in an editor's
// positions: { ed, from, to }, or null while it isn't there.
function locate(eds, k, q, opts) {
  let n = 0;
  for (const ed of eds) {
    const ranges = matchesInPM(ed.state.doc, q, opts);
    if (k < n + ranges.length) {
      const [from, to] = ranges[k - n];
      return { ed, from, to };
    }
    n += ranges.length;
  }
  return null;
}

function scrollToHit(ed, pos, block) {
  try {
    const dom = ed.view.domAtPos(pos)?.node;
    const el = dom?.nodeType === 3 ? dom.parentElement : dom;
    el?.scrollIntoView?.({ behavior: 'smooth', block });
  } catch (_) {}
}

export function DocFindTab({
  ydoc, scope, canEdit = true, active = false, activePageId = null,
  editorsOf, reveal, seed = null, sheet = false, onLeave = null,
}) {
  const feedback = useFeedback();
  const [q, setQ] = useState('');
  const [r, setR] = useState('');
  const [where, setWhere] = useState('all');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const opts = useMemo(() => ({ matchCase, wholeWord }), [matchCase, wholeWord]);
  // The hits, and the search they're for (a list shown while the next is
  // still a beat away is that one's).
  const [found, setFound] = useState({ key: '', groups: [] });
  const groups = found.groups;
  // The hit that's on, as { pageId, k }; null is the first on the open page.
  const [pick, setPick] = useState(null);
  // What the last Replace all did, said in place of the count until the
  // search changes.
  const [done, setDone] = useState(null);
  const [paintTick, setPaintTick] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const search = () => (q && ydoc
    ? docHits(ydoc, scope, q, opts, { pageIds: where === 'page' ? (activePageId ? [activePageId] : []) : null })
    : []);
  const searchRef = useRef(search);
  searchRef.current = search;
  const key = [q, matchCase, wholeWord, where, where === 'page' ? activePageId : ''].join('\u0000');
  const keyRef = useRef(key);
  keyRef.current = key;
  const refresh = () => {
    const g = searchRef.current();
    setFound({ key: keyRef.current, groups: g });
    return g;
  };

  // Searched again as the search changes (a beat after the last key), and as
  // the doc does (a few times a second at most while someone types).
  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(refresh, q ? 90 : 0);
    return () => clearTimeout(t);
  }, [active, ydoc, q, matchCase, wholeWord, where, activePageId]);
  useEffect(() => {
    if (!active || !ydoc || !q) return undefined;
    const types = [pageContentMap(ydoc, scope), sheetContentMap(ydoc, scope), pagesArray(ydoc, scope)].filter(Boolean);
    let t = 0;
    const soon = () => { if (!t) t = setTimeout(() => { t = 0; refresh(); }, 250); };
    types.forEach((y) => y.observeDeep(soon));
    return () => {
      clearTimeout(t);
      types.forEach((y) => y.unobserveDeep(soon));
    };
  }, [active, ydoc, scope, !!q]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new search starts from the open page.
  useEffect(() => { setPick(null); setDone(null); }, [q, matchCase, wholeWord, where]);
  useEffect(() => { setDone(null); }, [r]);

  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);
  const order = useMemo(() => (ydoc ? docPageOrder(ydoc, scope).map((p) => p.id) : []), [ydoc, scope, groups]);
  const at = useMemo(() => {
    if (!flat.length) return -1;
    if (!pick) {
      const i = flat.findIndex((h) => h.pageId === activePageId);
      return i >= 0 ? i : 0;
    }
    const i = flat.findIndex((h) => h.pageId === pick.pageId && h.k === pick.k);
    if (i >= 0) return i;
    // Gone (replaced): the next one after where it was, from the top past the end.
    const p = order.indexOf(pick.pageId);
    const j = flat.findIndex((h) => {
      const hp = order.indexOf(h.pageId);
      return hp > p || (hp === p && h.k > pick.k);
    });
    return j >= 0 ? j : 0;
  }, [flat, pick, activePageId, order]);
  const hit = at >= 0 ? flat[at] : null;

  // The open page's hits lit in its text, the one that's on brighter; none
  // once the tab is put away.
  const eds = active && editorsOf ? editorsOf(activePageId) : [];
  const edsKey = eds.map(edId).join(',');
  useEffect(() => {
    if (!active) return undefined;
    const list = editorsOf ? editorsOf(activePageId) : [];
    let n = 0;
    for (const ed of list) {
      const ranges = q ? matchesInPM(ed.state.doc, q, opts) : [];
      const local = hit && hit.pageId === activePageId ? hit.k - n : -1;
      paintFindHits(ed, ranges, local >= 0 && local < ranges.length ? local : -1);
      n += ranges.length;
    }
    // A page just opened may not have its text in its editor yet.
    const owed = groups.find((g) => g.id === activePageId)?.hits.length || 0;
    const retry = n < owed && paintTick < 12 ? setTimeout(() => setPaintTick((x) => x + 1), 60) : null;
    return () => {
      clearTimeout(retry);
      list.forEach((ed) => paintFindHits(ed, [], -1));
    };
  }, [active, activePageId, edsKey, flat, hit, q, opts, paintTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Its row in sight.
  useEffect(() => {
    if (!active) return;
    listRef.current?.querySelector('.dl-fr.is-on')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, at]);

  // ⌘F with words selected, or Find again: the search, picked.
  useEffect(() => {
    if (!seed) return;
    if (seed.q) setQ(seed.q);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hit shown: its page opened, it lit, scrolled to and selected in the
  // text (where Escape leaves the caret).
  const go = (h, { leave = false } = {}) => {
    if (!h) return;
    setPick({ pageId: h.pageId, k: h.k });
    setPaintTick(0);
    if (leave) onLeave?.();
    reveal?.(h.pageId, (list) => locate(list, h.k, q, opts), ({ ed, from, to }) => {
      try { ed.commands.setTextSelection({ from, to }); } catch (_) {}
      scrollToHit(ed, from, sheet && !leave ? 'start' : 'center');
      setPaintTick((x) => x + 1);
    });
  };
  // From the hit that's on; a key pressed faster than the list came (a beat
  // after the last key) searches first, from where the list would start.
  const step = (by) => {
    let list = flat;
    let from = at;
    if (found.key !== key) {
      list = refresh().flatMap((g) => g.hits);
      const i = list.findIndex((h) => h.pageId === activePageId);
      from = i >= 0 ? i : 0;
    }
    if (!list.length) return;
    go(list[(((from < 0 ? 0 : from) + by) % list.length + list.length) % list.length]);
  };

  // Escape goes back to the text with the hit that's on selected.
  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || isComposingKey(e)) return;
    if (!hit || hit.pageId !== activePageId) return;
    const m = locate(editorsOf?.(activePageId) || [], hit.k, q, opts);
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    onLeave?.();
    try { m.ed.chain().setTextSelection({ from: m.from, to: m.to }).focus().run(); } catch (_) {}
  };

  // The one that's on, replaced, and on to the next. One on a page that isn't
  // open is shown first.
  const replaceOne = () => {
    if (!hit) return;
    if (hit.pageId !== activePageId) { go(hit); return; }
    const list = editorsOf?.(activePageId) || [];
    const m = locate(list, hit.k, q, opts);
    if (!m) return;
    const { ed, from, to } = m;
    // Each Replace its own step back (⌘Z), apart from typing just before it.
    const um = yUndoPluginKey.getState(ed.state)?.undoManager;
    um?.stopCapturing();
    // The words' own marks (from inside them, not their edge) go on with the
    // replacement.
    ed.chain().command(({ tr, state }) => {
      if (to > tr.doc.content.size || to <= from) return true;
      const marks = tr.doc.resolve(Math.max(0, Math.min(from + 1, to, tr.doc.content.size))).marks();
      if (r) tr.replaceWith(from, to, state.schema.text(r, marks)); else tr.delete(from, to);
      return true;
    }).run();
    um?.stopCapturing();
    // The next is the first after what went in, so a replacement holding the
    // words ("cat" → "cats") isn't hit again.
    const end = from + r.length;
    let k = 0;
    for (const e of list) {
      const ranges = matchesInPM(e.state.doc, q, opts);
      if (e === ed) { k += ranges.filter(([a]) => a < end).length; break; }
      k += ranges.length;
    }
    const fresh = refresh();
    const all = fresh.flatMap((g) => g.hits);
    const p = order.indexOf(hit.pageId);
    const next = all.find((h) => h.pageId === hit.pageId && h.k === k)
      || all.find((h) => order.indexOf(h.pageId) > p)
      || all[0];
    if (next) go(next); else setPick(null);
  };

  // Every hit, the open page's through its editors and every other page's in
  // place; one toast says how many, and its Undo takes them all back while
  // they're each still the newest step.
  const replaceAll = () => {
    let n = 0;
    let pages = 0;
    const steps = [];
    let here = 0;
    for (const ed of editorsOf?.(activePageId) || []) {
      const ranges = matchesInPM(ed.state.doc, q, opts);
      if (!ranges.length) continue;
      const um = yUndoPluginKey.getState(ed.state)?.undoManager;
      um?.stopCapturing();
      ed.chain().command(({ tr, state }) => {
        [...ranges].reverse().forEach(([from, to]) => {
          if (to > tr.doc.content.size || to <= from) return;
          const marks = tr.doc.resolve(Math.max(0, Math.min(from + 1, to, tr.doc.content.size))).marks();
          if (r) tr.replaceWith(from, to, state.schema.text(r, marks)); else tr.delete(from, to);
        });
        return true;
      }).run();
      um?.stopCapturing();
      here += ranges.length;
      if (um) steps.push({ um, item: um.undoStack[um.undoStack.length - 1] });
    }
    if (here) { n += here; pages += 1; }
    const others = where === 'all' ? order.filter((id) => id !== activePageId) : [];
    if (others.length) {
      const dum = getDocUndoManager(ydoc, scope);
      dum?.stopCapturing();
      const res = replaceInPages(ydoc, scope, others, q, opts, r, DOC_ORIGIN);
      dum?.stopCapturing();
      if (res.n) {
        n += res.n;
        pages += res.pages;
        if (dum) steps.push({ um: dum, item: dum.undoStack[dum.undoStack.length - 1] });
      }
    }
    refresh();
    setPick(null);
    if (!n) return;
    const deleted = !r;
    setDone({ n, deleted });
    undoToast(feedback, {
      message: `${deleted ? 'Deleted' : 'Replaced'} ${n} ${n === 1 ? 'match' : 'matches'}${pages > 1 ? ` on ${pages} pages` : ''}`,
      onUndo: () => {
        if (steps.some(({ um, item }) => um.undoStack[um.undoStack.length - 1] !== item)) {
          feedback.toast({ type: 'info', message: 'The document changed since — press ⌘Z to step back instead.' });
          return;
        }
        steps.forEach(({ um }) => um.undo());
        setDone(null);
        refresh();
      },
    });
  };

  const count = done ? `${done.n} ${done.deleted ? 'deleted' : 'replaced'}`
    : !q ? '' : flat.length ? `${at + 1} of ${flat.length}` : 'None';
  let shown = 0;
  return (
    <div className="dl-find" role="search" aria-label="Find in this doc" onKeyDown={onKeyDown}>
      <div className="dl-find-f">
        <label className="dl-field">
          <Icon as={Search} size={15} />
          <input ref={inputRef} type="text" value={q} placeholder="Find" aria-label="Find"
                 spellCheck={false} autoComplete="off" enterKeyHint="search"
                 onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => {
                   if (isComposingKey(e) || e.key !== 'Enter') return;
                   e.preventDefault();
                   step(e.shiftKey ? -1 : 1);
                 }} />
          <span className="dl-find-n" aria-live="polite">{count}</span>
        </label>
        <Btn icon={ChevronUp} label="Previous" keys="Shift+Enter" disabled={!flat.length} onClick={() => step(-1)} />
        <Btn icon={ChevronDown} label="Next" keys="Enter" disabled={!flat.length} onClick={() => step(1)} />
      </div>
      {canEdit && (
        <div className="dl-find-f">
          <label className="dl-field">
            <Icon as={ArrowsLeftRight} size={15} />
            <input type="text" value={r} placeholder="Replace with" aria-label="Replace with"
                   spellCheck={false} autoComplete="off"
                   onChange={(e) => setR(e.target.value)}
                   onKeyDown={(e) => {
                     if (isComposingKey(e) || e.key !== 'Enter') return;
                     e.preventDefault();
                     replaceOne();
                   }} />
          </label>
        </div>
      )}
      <div className="dl-find-o">
        <DocSeg label="Search" value={where} onChange={setWhere} options={SCOPES} />
        <button type="button" className="dl-mini" aria-pressed={matchCase} aria-label="Match case" title="Match case"
                onClick={() => setMatchCase((v) => !v)}>Aa</button>
        <button type="button" className="dl-mini" aria-pressed={wholeWord}
                onClick={() => setWholeWord((v) => !v)}>Whole word</button>
      </div>
      {canEdit && (
        <div className="dl-find-a">
          <button type="button" className="dl-mini" disabled={!hit} onClick={replaceOne}>Replace</button>
          <button type="button" className="dl-mini" disabled={!flat.length} onClick={replaceAll}>
            {flat.length ? `Replace all ${flat.length}` : 'Replace all'}
          </button>
        </div>
      )}
      {q && (
        <div ref={listRef} className="dl-find-res">
          {groups.map((g) => {
            if (shown >= LIST_MAX) return null;
            const rows = g.hits.slice(0, LIST_MAX - shown);
            shown += rows.length;
            const name = [...g.trail, g.name].join(' › ');
            return (
              <section key={g.id} aria-label={`${name}, ${g.hits.length} ${g.hits.length === 1 ? 'hit' : 'hits'}`}>
                <h3 className="dl-fg-h"><span>{name}</span><span className="dl-cnt">{g.hits.length}</span></h3>
                {rows.map((h) => {
                  const on = hit === h;
                  return (
                    <button key={`${h.pageId}:${h.k}`} type="button" className={`dl-fr${on ? ' is-on' : ''}`}
                            aria-current={on || undefined} onClick={() => go(h, { leave: sheet })}>
                      {h.snippet.before}<mark>{h.snippet.match}</mark>{h.snippet.after}
                    </button>
                  );
                })}
              </section>
            );
          })}
          {flat.length > shown && <p className="dl-find-more">And {flat.length - shown} more</p>}
          {!flat.length && !done && <p className="dl-find-none">Nothing found{where === 'page' ? ' on this page' : ''}</p>}
        </div>
      )}
    </div>
  );
}
