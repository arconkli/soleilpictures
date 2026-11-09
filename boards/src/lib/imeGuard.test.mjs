// Every key handler that acts on Enter or Escape and can see a text field asks
// the shared rule (lib/composerKeys.js, isComposingKey) first. People typing
// Japanese, Chinese or Korean build each word in an input method; the Enter or
// Escape that picks a word belongs to it, and a handler that acts on that key
// saves, renames, posts or cancels with the word cut short.
//
// This is a static scan of src that reads each file with @babel/parser (the
// parser Vite already uses; declared in devDependencies). It looks at
//   (a) JSX onKeyDown/onKeyUp/onKeyPress (and their Capture forms) in any file
//       that has a text field (<input, <textarea, contentEditable, a TipTap
//       editor) and in src/hooks/;
//   (b) every addEventListener('keydown' | 'keyup' | 'keypress') in src, also
//       the optional call el.addEventListener?.(...) and an assignment to
//       el.onkeydown / onkeyup / onkeypress, since a window or document
//       listener sees every field's keys;
//   (c) an object property or method named onKeyDown, onKeyUp or onKeyPress
//       whose value is a function, in the same files as (a) (it is what
//       <input {...handlers} /> receives).
// A handler is an inline function, a function bound in the same file
// (declaration, const arrow, useCallback, useMemo), or either arm of "a ? X : Y"
// and "a && X". Names are resolved by scope (@babel/traverse), so a prop or
// parameter that shares a name with a module-level function is the prop.
// Anything else (a parameter or destructured prop, an import, a member) is
// UNRESOLVED and pinned below, so a new one has to be looked at by a person.
// So is a handler that passes its event to code this file cannot see (an
// import not in HELPERS or PURE, props.x(e)) before its first guard, and an
// addEventListener whose event type is not a string literal. "Passes its event"
// means the event itself, a member chain rooted at it (e.nativeEvent, e.key; not
// .target, .currentTarget or .relatedTarget), an object or array literal holding
// either, or any spread argument.
//
// A handler ACTS when its body, or a same-file function it calls (followed
// recursively), compares with 'Enter', 'NumpadEnter', 'Escape' or 'Esc' (also
// through a same-file const string compared with .key or .code), or compares
// keyCode/which with 13 or 27. Also an object key named Enter or Escape, a regex
// literal naming either, a template literal without expressions, and
// .includes(e.key) / .has(e.key) on a same-file const array or new Set([...])
// holding one (or [13].includes(e.keyCode)). Acts inside nested closures count.
// A guard's own test is quiet (its comparisons lead to a return), unless a call
// or assignment sits before the guard disjunct: that runs mid-composition. It is
// GUARDED when an act sits after
//   - a top-level `if` of the handler body whose test is isComposingKey(e), or
//     an || chain with isComposingKey(e) as a direct disjunct, and whose
//     consequent is a return (or a block ending in one). It covers what comes
//     after the whole `if`, not the `if`'s own consequent; or
//   - a helper (HELPERS, imported from its own module): inside the consequent
//     of an `if` whose test calls it (not under ! or ||; compared only with
//     a literal that says yes, or !== null / undefined / false), or after a
//     top-level `if (!helper(...)) return`. A discarded call covers nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

// Helpers a handler may delegate to. Each must itself ask isComposingKey before
// it acts (asserted below), and covers only the keys listed.
const HELPERS = {
  messageKeyAction: { file: 'lib/composerKeys.js', keys: ['Enter'] },
  escapeClosesPanel: { file: 'lib/panelEscape.js', keys: ['Escape'] },
  handleEscapeKey: { file: 'lib/modalGuard.js', keys: ['Escape'] },
  shouldHandleKey: { file: 'lib/playerKeys.js', keys: ['Enter', 'Escape'] },
};

// Pure predicates of the event (they read it, never act on a key). Passing the
// event to one of these does not make a handler unresolved.
// isViewSwitchKey (lib/viewSwitch.js) only answers "is this the F key".
const PURE = new Set(['isEditableTarget', 'isEditablePointerTarget', 'isEditorTarget', 'isEditorPointerTarget', 'isViewSwitchKey']);

// Unguarded handlers that act on Enter/Escape and are not text fields. One
// entry per handler: the file (relative to src) and the first characters of
// the handler's source. An entry that matches nothing fails as stale.
const ALLOW = [
  { file: 'components/settings/fields.jsx', snippet: "(e) => { if (e.key === ' ' || e.key === 'Enter')", reason: 'not a text field: the toggle switch (role=switch span)' },
  { file: 'App.jsx', snippet: "(e) => { if (e.key === 'Enter' || e.key === ' ') { e.prevent", reason: 'not a text field: rowButtonProps, a role=button nav row with no field inside' },
  { file: 'components/ListSurface.jsx', snippet: '(e) => { if (e.target !== e.currentTarget || e.metaKey || e.', reason: 'not a text field: folderKeys acts only when the folder tile itself has focus' },
  { file: 'components/film/FilmDock.jsx', snippet: "(e) => { if (e.key === 'Enter' || e.key === ' ') { e.prevent", reason: 'not a text field: a film dock step button' },
  { file: 'lib/journey.js', snippet: 'function onKey(e) { if (!OPEN) return; lastInteractionAt = _', reason: 'records the key name only; never acts on Enter or Escape' },
];

// Handlers the scanner cannot resolve in their own file (a prop, an import, a
// member), pinned by file and the first 60 characters of the handler's source.
// Each was read before it was listed. A new one fails the test: look at it,
// guard it or add it here. A pinned one that is gone fails too.
// The roving-focus bars take hooks/useToolbarRoving.js (guarded with
// isComposingKey on its first line); EntityPicker takes hooks/useListboxNav.js
// (Enter asks isComposingKey; it has no Escape); onSearchKeyDown is a prop
// nothing passes yet.
const UNRESOLVED = [
  { file: 'components/CanvasSurface.jsx', snippet: 'railKeys' },
  { file: 'components/DocPageEditor.jsx', snippet: 'onBarKeys' },
  { file: 'components/EntityPicker.jsx', snippet: 'onKeyDown' },
  { file: 'components/ToolOptionsBar.jsx', snippet: 'tobKeys' },
  { file: 'components/ToolOptionsBar.jsx', snippet: 'tobKeys' },
  { file: 'components/ToolOptionsBar.jsx', snippet: 'tobKeys' },
  { file: 'components/ToolOptionsBar.jsx', snippet: 'tobKeys' },
  { file: 'components/ToolOptionsBar.jsx', snippet: 'barKeys' },
  { file: 'components/clusterBrowser/ClusterBrowserToolbar.jsx', snippet: 'onSearchKeyDown' },
  { file: 'components/home/ClustersHome.jsx', snippet: 'barKeys' },
  { file: 'components/sidebar/ClusterSidebar.jsx', snippet: 'bulkKeys' },
  { file: 'components/toolbar/CanvasBarsA.jsx', snippet: 'onKeyDown' },
  { file: 'components/toolbar/CanvasBarsA.jsx', snippet: 'onKeyDown' },
  { file: 'components/toolbar/CanvasBarsA.jsx', snippet: 'onKeyDown' },
  { file: 'components/toolbar/CanvasBarsA.jsx', snippet: 'onKeyDown' },
  { file: 'components/toolbar/CanvasBarsA.jsx', snippet: 'onKeyDown' },
  { file: 'components/toolbar/NoteBarA.jsx', snippet: 'onKeyDown' },
  // Handlers that hand their event to an import before any guard. None acts on
  // Enter or Escape: the WASD pan keys (wasdCodeOf, inInfoDrawer), the Tab trap
  // in Settings and in Modal, which keeps Tab inside even mid-composition and
  // asks isComposingKey before its Escape (trapTabKey), the film player's J/K/L
  // keys (playerAction, then shouldHandleKey asks isComposingKey before
  // runRef.current(a, e) acts).
  { file: 'components/CanvasSurface.jsx', snippet: "(e) => { if (e.key === 'Shift') { fast = true; return; } if " },
  { file: 'components/SettingsPanel.jsx', snippet: "(e) => { if (e.key !== 'Tab') return; const panel = modalRef" },
  { file: 'components/Modal.jsx', snippet: '(e) => { const panel = panelRef.current; if (!panel || !isTo' },
  { file: 'components/film/FilmPlayer.jsx', snippet: '(e) => { const handle = modalHandleRef.current?.current ?? n' },
  // Handlers on things that are not text fields (ALLOWed above), or that never
  // act on Enter or Escape, passing the event or a field of it on: the nav
  // row's onActivate(e), the dock button's fn(e.shiftKey), journey's record of
  // the key name, and the WASD keyup's held.delete(e.code).
  { file: 'App.jsx', snippet: "(e) => { if (e.key === 'Enter' || e.key === ' ') { e.prevent" },
  { file: 'components/CanvasSurface.jsx', snippet: "(e) => { if (e.key === 'Shift') { fast = false; return; } he" },
  { file: 'components/film/FilmDock.jsx', snippet: "(e) => { if (e.key === 'Enter' || e.key === ' ') { e.prevent" },
  { file: 'lib/journey.js', snippet: 'function onKey(e) { if (!OPEN) return; lastInteractionAt = _' },
  // addEventListener calls whose event type is a loop variable or a parameter
  // (pointer, touch and activity events, a perf wrapper); none passes a key event.
  { file: 'components/DocSurface.jsx', snippet: 'paper.addEventListener(t, stop, { passive: true })' },
  { file: 'components/ListSurface.jsx', snippet: 'el.addEventListener(t, settle, { passive: true })' },
  { file: 'components/OnboardingTour.jsx', snippet: 'window.addEventListener(ev, wake, opts)' },
  { file: 'hooks/useAiTagger.js', snippet: 'window.addEventListener(ev, _markInteraction, { passive: tru' },
  { file: 'lib/buildWatch.js', snippet: 'window.addEventListener(ev, onInput, { passive: true, captur' },
  { file: 'lib/doubleTap.js', snippet: 'window.addEventListener(t, onEvent, capture)' },
  { file: 'lib/errorReporting.js', snippet: "window.addEventListener(k, () => crumb('net', k))" },
  { file: 'lib/heartbeat.js', snippet: 'window.addEventListener(ev, markActivity, opts)' },
  { file: 'lib/journey.js', snippet: 'window.addEventListener(ev, markActivity, opts)' },
  { file: 'lib/partyPark.js', snippet: 'win.addEventListener(ev, onInput, opts)' },
  { file: 'lib/passkeys.js', snippet: 'window.addEventListener(e, seen, { capture: true, passive: t' },
  { file: 'lib/perf.js', snippet: 'super.addEventListener(type, _wrap(listener, this._perfTag),' },
  { file: 'lib/perf.js', snippet: 'super.addEventListener(type, listener, options)' },
  { file: 'lib/swallowClick.js', snippet: 'window.addEventListener(k, eat, CAPTURE)' },
  { file: 'lib/yPartyKit.js', snippet: 'window.addEventListener(ev, onHereInput, hereOpts)' },
];

// A little under the 213 handlers examined when this was written.
const EXAMINED_FLOOR = 200;

// A component named for a field (<MentionTextarea, <SearchInput) counts too.
const TEXT_FIELD = /<[\w.]*(?:input|textarea)|contentEditable|EditorContent|useEditor\(/i;
const JSX_KEY = /^onKey(?:Down|Up|Press)(?:Capture)?$/;
const DOM_KEY = /^onkey(?:down|up|press)$/i;
const KEY_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
const ALL = ['Enter', 'Escape'];

const parseSource = (source) => parse(source, { sourceType: 'module', plugins: ['jsx'] });

// Depth-first walk; fn(node, parent) returning false skips the node's children.
function visit(node, fn, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (fn(node, parent) === false) return;
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'extra' || k.endsWith('Comments')) continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) visit(c, fn, node);
    else if (v && typeof v.type === 'string') visit(v, fn, node);
  }
}

const isFn = (n) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression');

// The function a binding's value is: itself, useCallback(fn), or a useMemo that
// returns one.
function fnOf(init) {
  if (!init) return null;
  if (isFn(init)) return init;
  if (init.type === 'CallExpression' && init.callee.type === 'Identifier') {
    if (init.callee.name === 'useCallback') return fnOf(init.arguments[0]);
    if (init.callee.name === 'useMemo') {
      const m = init.arguments[0];
      if (!isFn(m)) return null;
      if (m.body.type !== 'BlockStatement') return fnOf(m.body);
      for (const s of m.body.body) if (s.type === 'ReturnStatement') return fnOf(s.argument);
    }
  }
  return null;
}

// Parse once and remember the scope of every node, so a name is resolved where
// it is written: { ast, scopes, file, cache }.
function prepare(source, file) {
  const ast = parseSource(source);
  const scopes = new WeakMap();
  traverse(ast, { enter(path) { scopes.set(path.node, path.scope); } });
  return { ast, scopes, file, cache: new Map() };
}
const scopeOf = (ctx, n) => ctx.scopes.get(n);

// The functions a name stands for at `scope`: a declaration, a const/let bound
// to a function (or to another such name), or an assignment of one. null when
// it comes from outside: a parameter or destructured prop, an import, a global,
// anything not a function.
function resolveBinding(ctx, name, scope, depth = 0) {
  const b = scope?.getBinding(name);
  if (!b || b.kind === 'param' || b.kind === 'module') return null;
  const node = b.path.node;
  const fns = [];
  if (node.type === 'FunctionDeclaration') fns.push(node);
  else if (node.type === 'VariableDeclarator') {
    if (node.id.type !== 'Identifier') return null;
    const f = fnOf(node.init);
    if (f) fns.push(f);
    else if (node.init?.type === 'Identifier' && depth < 5) {
      const r = resolveBinding(ctx, node.init.name, scopeOf(ctx, node.init), depth + 1);
      if (r) fns.push(...r);
    }
  } else return null;
  for (const v of b.constantViolations) {
    const a = v.node;
    if (a.type === 'AssignmentExpression' && a.left.type === 'Identifier' && a.left.name === name) {
      const f = fnOf(a.right);
      if (f) fns.push(f);
    }
  }
  return fns.length ? fns : null;
}

// What calling `name` means for a handler: { fns } a same-file function to
// follow, {} a global or a pure predicate, { unseen } code this file can't see.
function resolveCallee(ctx, name, scope, depth = 0) {
  const b = scope?.getBinding(name);
  if (!b) return {};
  const fns = resolveBinding(ctx, name, scope);
  if (fns) return { fns };
  if (b.kind === 'module') {
    const s = b.path.node;
    const imported = s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : name;
    return PURE.has(imported) ? {} : { unseen: true };
  }
  const init = b.path.node.type === 'VariableDeclarator' ? b.path.node.init : null;
  if (init?.type === 'Identifier' && depth < 5) return resolveCallee(ctx, init.name, scopeOf(ctx, init), depth + 1);
  return { unseen: true };
}

const HELPER_FILES = { isComposingKey: 'lib/composerKeys.js', ...Object.fromEntries(Object.entries(HELPERS).map(([k, v]) => [k, v.file])) };
const stem = (p) => p.split('/').pop().replace(/\.[jt]sx?$/, '');

// 'isComposingKey' or a HELPERS name when `call` calls it as imported from its
// own module (or, inside that module, its own function); else null.
function helperName(ctx, call) {
  if (call.callee.type !== 'Identifier') return null;
  const name = call.callee.name;
  const home = HELPER_FILES[name];
  if (!home) return null;
  const b = scopeOf(ctx, call)?.getBinding(name);
  if (!b) return null;
  if (b.kind === 'module') {
    const s = b.path.node;
    const from = b.path.parent?.source?.value;
    const ok = s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === name && from && stem(from) === stem(home);
    return ok ? name : null;
  }
  return ctx.file === home && b.path.node.type === 'FunctionDeclaration' ? name : null;
}

const collapse = (source, n) => source.slice(n.start, n.end).replace(/\s+/g, ' ').trim().slice(0, 60);

// A guard's test: isComposingKey(e) alone, or an || chain with it as a direct
// disjunct (not under !, not inside &&).
function disjuncts(t) {
  return t.type === 'LogicalExpression' && t.operator === '||' ? [...disjuncts(t.left), ...disjuncts(t.right)] : [t];
}

// A guard's consequent: a return, or a block whose top-level statements end in one.
function returns(stmt) {
  if (stmt.type === 'ReturnStatement') return true;
  const last = stmt.type === 'BlockStatement' ? stmt.body[stmt.body.length - 1] : null;
  return !!last && last.type === 'ReturnStatement';
}

function rootName(n) {
  while (n && n.type === 'MemberExpression') n = n.object;
  return n?.type === 'Identifier' ? n.name : null;
}

const isCall = (n) => n.type === 'CallExpression' || n.type === 'OptionalCallExpression';
const isMember = (n) => n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression';

// Does `a` hand the event on? The event itself, a member chain rooted at it
// (e.nativeEvent, e.key; not .target, .currentTarget or .relatedTarget, which
// are elements), or an object or array literal holding either at any depth.
function carriesEvent(a, ev) {
  if (!a || !ev) return false;
  if (a.type === 'Identifier') return a.name === ev;
  if (isMember(a)) {
    let m = a;
    while (isMember(m.object)) m = m.object;
    if (m.object.type !== 'Identifier' || m.object.name !== ev) return false;
    return m.computed || m.property.type !== 'Identifier' || !['target', 'currentTarget', 'relatedTarget'].includes(m.property.name);
  }
  if (a.type === 'SpreadElement') return carriesEvent(a.argument, ev);
  if (a.type === 'ObjectExpression') return a.properties.some((p) => (p.type === 'ObjectProperty' ? carriesEvent(p.value, ev) : carriesEvent(p, ev)));
  if (a.type === 'ArrayExpression') return a.elements.some((x) => carriesEvent(x, ev));
  return false;
}
// A spread argument can hold the event whatever the handler names it.
const passesEvent = (call, ev) => call.arguments.some((a) => a.type === 'SpreadElement' || carriesEvent(a, ev));

// What a helper's result is compared with: a literal that says yes ('send',
// true, 5), or one that says no (null, undefined, false).
const isYes = (n) => (n.type === 'StringLiteral' && n.value !== '') || (n.type === 'NumericLiteral' && n.value !== 0)
  || (n.type === 'BooleanLiteral' && n.value) || (n.type === 'TemplateLiteral' && n.expressions.length === 0 && !!n.quasis[0].value.cooked);
const isNo = (n) => n.type === 'NullLiteral' || (n.type === 'Identifier' && n.name === 'undefined') || (n.type === 'BooleanLiteral' && !n.value);

// The calls in an `if` test whose truth means the helper said yes: reached
// through && only, or compared ===/== with a literal that says yes, or !==/!=
// with null, undefined or false. Never under !, || or any other comparison.
function positiveCalls(t, out = []) {
  if (isCall(t)) out.push(t);
  else if (t.type === 'LogicalExpression' && t.operator === '&&') { positiveCalls(t.left, out); positiveCalls(t.right, out); }
  else if (t.type === 'BinaryExpression') {
    const eq = t.operator === '===' || t.operator === '==';
    const ne = t.operator === '!==' || t.operator === '!=';
    if (eq || ne) {
      for (const [c, o] of [[t.left, t.right], [t.right, t.left]]) if (isCall(c) && (eq ? isYes(o) : isNo(o))) out.push(c);
    }
  }
  return out;
}

// A call (other than the guards and the pure predicates) or an assignment in
// `node`: it runs mid-composition when it sits before the guard.
function hasEffect(ctx, node) {
  let found = false;
  visit(node, (n) => {
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') found = true;
    else if (isCall(n) && !helperName(ctx, n) && !(n.callee.type === 'Identifier' && PURE.has(n.callee.name))) found = true;
  });
  return found;
}

const keyOf = (v) => (v === 'Enter' || v === 'NumpadEnter' ? 'Enter' : v === 'Escape' || v === 'Esc' ? 'Escape' : null);
const isKeyMember = (n) => n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier'
  && (n.property.name === 'key' || n.property.name === 'code');

// The string an identifier stands for: a same-file const ("const ENTER =
// 'Enter'"), or an `export const NAME = '...'` of the relative module it is
// imported from. null when it can't be told.
function constString(ctx, id) {
  if (id?.type !== 'Identifier') return null;
  const b = scopeOf(ctx, id)?.getBinding(id.name);
  if (!b) return null;
  if (b.kind === 'module') {
    const s = b.path.node;
    const from = b.path.parent?.source?.value;
    if (s.type !== 'ImportSpecifier' || !from?.startsWith('.')) return null;
    const base = join(SRC, dirname(ctx.file), from);
    for (const ext of ['', '.js', '.jsx', '.mjs', '/index.js']) {
      try {
        const m = new RegExp(`export\\s+const\\s+${s.imported.name ?? s.imported.value}\\s*=\\s*(['"])([^'"]*)\\1`)
          .exec(readFileSync(base + ext, 'utf8'));
        if (m) return m[2];
      } catch (_) { /* not that file */ }
    }
    return null;
  }
  const d = b.path.node;
  return b.constant && d?.type === 'VariableDeclarator' && d.init?.type === 'StringLiteral' ? d.init.value : null;
}
const constKey = (ctx, id) => keyOf(constString(ctx, id));

const isCodeMember = (n) => n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier'
  && (n.property.name === 'keyCode' || n.property.name === 'which');

// The keys a `.includes(arg)` / `.has(arg)` call asks about: [13].includes(e.keyCode),
// or KEYS.includes(e.key) where KEYS is a const array (or new Set([...])) in this file.
function collectionKeys(ctx, obj, arg) {
  const out = [];
  if (!arg) return out;
  if (obj.type === 'ArrayExpression' && isCodeMember(arg)) {
    for (const el of obj.elements) if (el?.type === 'NumericLiteral' && (el.value === 13 || el.value === 27)) out.push(el.value === 13 ? 'Enter' : 'Escape');
  } else if (obj.type === 'Identifier' && isKeyMember(arg)) {
    const b = scopeOf(ctx, obj)?.getBinding(obj.name);
    const d = b?.path.node;
    if (b?.constant && d?.type === 'VariableDeclarator' && b.path.parent?.kind === 'const') {
      const init = d.init;
      const list = init?.type === 'ArrayExpression' ? init
        : init?.type === 'NewExpression' && init.callee.type === 'Identifier' && init.callee.name === 'Set' && init.arguments[0]?.type === 'ArrayExpression' ? init.arguments[0] : null;
      for (const el of list?.elements ?? []) if (el?.type === 'StringLiteral' && keyOf(el.value)) out.push(keyOf(el.value));
    }
  }
  return out;
}

// What `fn` does with Enter and Escape that nothing asked isComposingKey about:
// { acts: [{ pos, key }], unseen: [{ pos }] }. Acts are the key comparisons in
// its body (nested closures included) and in the same-file functions it calls,
// recursively, at the call site. Unseen is a call that hands the event to code
// this file can't see. Both are after removing what a guard covers.
function analyze(ctx, fn) {
  if (ctx.cache.has(fn)) return ctx.cache.get(fn);
  const out = { acts: [], unseen: [] };
  ctx.cache.set(fn, out); // while it is being worked out, a cycle back to it sees nothing
  const ev = fn.params[0]?.type === 'Identifier' ? fn.params[0].name : null;
  const guards = []; // { from, to, covers }: positions strictly between from and to
  const quiet = []; // a guard's own test: its comparisons lead to a return, they act on nothing
  const acts = [];
  const unseen = [];
  const quietActs = []; // acts found inside a guard's own test
  const effects = []; // the part of a guard's test before the guard, when it calls or assigns something
  const full = (g) => ALL.every((k) => g.covers.includes(k));
  const isComposing = (d) => isCall(d) && helperName(ctx, d) === 'isComposingKey' && rootName(d.arguments[0]) === ev && !!ev;
  const inQuiet = (n) => quiet.some(([s, e]) => n.start >= s && n.end <= e);
  const add = (n, key) => (inQuiet(n) ? quietActs : acts).push({ pos: n.start, key });

  if (fn.body.type === 'BlockStatement') {
    for (const s of fn.body.body) {
      if (s.type !== 'IfStatement' || !returns(s.consequent)) continue;
      const ds = disjuncts(s.test);
      const c = ds.find(isComposing);
      if (c) {
        guards.push({ from: c.end, to: s.test.end, covers: ALL }, { from: s.end, to: Infinity, covers: ALL });
        quiet.push([s.test.start, s.test.end]);
        if (ds.slice(0, ds.indexOf(c)).some((d) => hasEffect(ctx, d))) effects.push([s.test.start, c.start]);
        continue;
      }
      for (const [i, d] of ds.entries()) {
        const call = d.type === 'UnaryExpression' && d.operator === '!' && isCall(d.argument) ? d.argument : null;
        const h = call && helperName(ctx, call);
        if (!h || h === 'isComposingKey') continue;
        const covers = HELPERS[h].keys;
        guards.push({ from: call.end, to: s.test.end, covers }, { from: s.end, to: Infinity, covers });
        quiet.push([s.test.start, s.test.end]);
        if (ds.slice(0, i).some((x) => hasEffect(ctx, x))) effects.push([s.test.start, d.start]);
      }
    }
  }

  visit(fn.body, (n, parent) => {
    if (n.type === 'IfStatement') {
      for (const call of positiveCalls(n.test)) {
        const h = helperName(ctx, call);
        if (h && h !== 'isComposingKey') guards.push({ from: call.end, to: n.consequent.end, covers: HELPERS[h].keys });
      }
    }
    if (isCall(n)) {
      if (helperName(ctx, n)) return;
      if (isMember(n.callee) && !n.callee.computed && n.callee.property.type === 'Identifier'
        && (n.callee.property.name === 'includes' || n.callee.property.name === 'has')) {
        for (const k of collectionKeys(ctx, n.callee.object, n.arguments[0])) add(n, k);
      }
      if (n.callee.type === 'Identifier') {
        const r = resolveCallee(ctx, n.callee.name, scopeOf(ctx, n));
        if (r.fns) {
          for (const f of r.fns) {
            if (f === fn) continue;
            const sub = analyze(ctx, f);
            for (const a of sub.acts) acts.push({ pos: n.start, key: a.key });
            // What the callee hands on is unseen for us only if we handed it the event.
            if (passesEvent(n, ev)) for (let i = 0; i < sub.unseen.length; i++) unseen.push({ pos: n.start });
          }
        } else if (r.unseen && passesEvent(n, ev)) unseen.push({ pos: n.start });
      } else if (passesEvent(n, ev)) unseen.push({ pos: n.start });
      return;
    }
    // In a guard's own test the comparisons are quiet (they lead to a return);
    // they are kept aside in case a call or assignment before the guard runs.
    if (n.type === 'StringLiteral' && parent?.type !== 'JSXAttribute') {
      const k = keyOf(n.value);
      if (k) add(n, k);
    } else if (n.type === 'NumericLiteral' && (n.value === 13 || n.value === 27)
      && (parent?.type === 'SwitchCase' || (parent?.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)))) {
      add(n, n.value === 13 ? 'Enter' : 'Escape');
    } else if (n.type === 'BinaryExpression' && /^[!=]==?$/.test(n.operator)) {
      const [m, id] = isKeyMember(n.left) ? [n.left, n.right] : isKeyMember(n.right) ? [n.right, n.left] : [];
      const k = m && id.type === 'Identifier' ? constKey(ctx, id) : null;
      if (k) add(n, k);
    } else if (n.type === 'SwitchCase' && n.test?.type === 'Identifier' && parent?.type === 'SwitchStatement' && isKeyMember(parent.discriminant)) {
      const k = constKey(ctx, n.test);
      if (k) add(n, k);
    } else if (n.type === 'TemplateLiteral' && n.expressions.length === 0) {
      const k = keyOf(n.quasis[0].value.cooked);
      if (k) add(n, k);
    } else if (n.type === 'RegExpLiteral') {
      for (const name of ALL) if (n.pattern.includes(name)) add(n, name);
    } else if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod') && parent?.type === 'ObjectExpression'
      && !n.computed && n.key.type === 'Identifier') {
      const k = keyOf(n.key.name);
      if (k) add(n, k);
    }
  });
  for (const a of quietActs) if (effects.some(([s, e]) => s <= a.pos && a.pos < e)) acts.push(a);

  out.acts = acts.filter((a) => !guards.some((g) => g.from < a.pos && a.pos < g.to && g.covers.includes(a.key)));
  out.unseen = unseen.filter((u) => !guards.some((g) => g.from < u.pos && u.pos < g.to && full(g)));
  return out;
}

// The functions a handler expression stands for, or { unresolved } for a part
// it cannot see.
function arms(ctx, expr, out) {
  if (!expr) return;
  const f = fnOf(expr);
  if (f) { out.push({ fn: f }); return; }
  switch (expr.type) {
    case 'NullLiteral': return;
    case 'Identifier': {
      if (expr.name === 'undefined') return;
      const fns = resolveBinding(ctx, expr.name, scopeOf(ctx, expr));
      if (fns) for (const fn of fns) out.push({ fn });
      else out.push({ unresolved: expr });
      return;
    }
    case 'ConditionalExpression': arms(ctx, expr.consequent, out); arms(ctx, expr.alternate, out); return;
    case 'LogicalExpression':
      if (expr.operator === '&&') arms(ctx, expr.right, out);
      else { arms(ctx, expr.left, out); arms(ctx, expr.right, out); }
      return;
    default: out.push({ unresolved: expr });
  }
}

// { examined, unresolved: [{ line, snippet }], unguarded: [{ line, snippet }] }
export function scan(source, file) {
  const ctx = prepare(source, file);
  const inHooks = file.startsWith('hooks/');
  const hasField = TEXT_FIELD.test(source);
  const res = { examined: 0, unresolved: [], unguarded: [] };
  const lineOf = (node) => source.slice(0, node.start).split('\n').length;
  const handle = (expr) => {
    const list = [];
    arms(ctx, expr, list);
    run(list);
  };
  const run = (list) => {
    for (const a of list) {
      const node = a.fn || a.unresolved;
      const line = lineOf(node);
      const snippet = collapse(source, node);
      if (a.unresolved) { res.unresolved.push({ line, snippet }); continue; }
      res.examined++;
      const r = analyze(ctx, a.fn);
      if (r.unseen.length) res.unresolved.push({ line, snippet });
      if (r.acts.length) res.unguarded.push({ line, snippet });
    }
  };
  visit(ctx.ast, (n) => {
    if (n.type === 'JSXAttribute' && n.name.type === 'JSXIdentifier' && JSX_KEY.test(n.name.name)
      && (hasField || inHooks) && n.value?.type === 'JSXExpressionContainer') {
      handle(n.value.expression);
    } else if (isCall(n) && isMember(n.callee) && !n.callee.computed
      && n.callee.property.name === 'addEventListener' && n.arguments[1]) {
      // A type that is not a literal is read through a const string (this file's
      // or an imported one); if that can't be done it might be a key event: pinned.
      const type = n.arguments[0].type === 'StringLiteral' ? n.arguments[0].value : constString(ctx, n.arguments[0]);
      if (type == null) res.unresolved.push({ line: lineOf(n), snippet: collapse(source, n) });
      else if (KEY_EVENTS.has(type)) handle(n.arguments[1]);
    } else if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression'
      && !n.left.computed && DOM_KEY.test(n.left.property.name ?? '')) {
      // el.onkeydown = fn sees every field's keys, like a listener
      handle(n.right);
    } else if ((n.type === 'ObjectProperty' || n.type === 'ObjectMethod') && !n.computed && (hasField || inHooks)) {
      // { onKeyDown: fn, onKeyUp(e) {} }, as spread onto a field: <input {...handlers} />
      const name = n.key.type === 'Identifier' ? n.key.name : n.key.type === 'StringLiteral' ? n.key.value : '';
      if (JSX_KEY.test(name) || DOM_KEY.test(name)) {
        if (n.type === 'ObjectMethod') { if (n.kind === 'method') run([{ fn: n }]); }
        else { const f = fnOf(n.value); if (f) run([{ fn: f }]); }
      }
    }
  });
  return res;
}

const SRC = fileURLToPath(new URL('..', import.meta.url));
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(SRC, p).split(sep).join('/');
    if (statSync(p).isDirectory()) { if (rel !== 'locales') out.push(...files(p)); continue; }
    if (!/\.jsx?$/.test(name) || /\.test\./.test(name) || /^lib\/docsite/.test(rel)) continue;
    out.push(rel);
  }
  return out;
}

test('the scanner tells a guarded handler from an unguarded one, in every shape', () => {
  // A line marked BAD holds (or starts) a handler the scan must report.
  const fixture = `
import { useCallback, useEffect, useMemo } from 'react';
import { importedHelper } from './elsewhere.js';
import { isComposingKey, messageKeyAction } from './composerKeys.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
const ENTER = 'Enter';
export function A({ live }) {
  const onGuarded = useCallback((e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); }, []);
  const onBare = useCallback((e) => { if (e.key === 'Enter') save(); }, []); // BAD
  const onAfter = (e) => { if (e.key === 'Enter') save(); if (isComposingKey(e)) return; }; // BAD
  const onMemo = useMemo(() => (e) => { if (e.key === 'Enter') save(); }, []); // BAD
  function nameGuarded(e) { if (isComposingKey(e)) return; if (e.key === 'Escape') close(); }
  function nameBare(e) { if (e.key === "Escape") close(); } // BAD
  function onStopThenGuard(e) { e.stopPropagation(); if (isComposingKey(e)) return; if (e.key === 'Enter') save(); }
  function guardedHelper(e) { if (messageKeyAction(e) === 'send') save(); }
  function escapeAndEnter(e) { // BAD
    if (e.key === 'Escape') { close(); return; }
    if (messageKeyAction(e) === 'send') save();
  }
  function escapeAfterHelper(e) { // BAD
    const a = messageKeyAction(e);
    if (e.key === 'Escape') close();
  }
  function escapeGuardedByComposing(e) {
    if (isComposingKey(e)) return;
    if (e.key === 'Escape') close();
    if (messageKeyAction(e) === 'send') save();
  }
  function regexThenGuarded(e) { const re = /["'\\\\[{(]x/; if (isComposingKey(e)) return; if (e.key === 'Enter' && re.test(e.key)) save(); }
  function forwardsLocal(e) { onBare(e, "it's"); } // BAD
  function forwardsGuarded(e) { onGuarded(e); }
  function notGuard(e) { if (!isComposingKey(e)) return; if (e.key === 'Enter') save(); } // BAD
  function andGuard(e) { if (isComposingKey(e) && e.key === 'Tab') return; if (e.key === 'Enter') save(); } // BAD
  function shiftNested(e) { if (e.shiftKey) { if (isComposingKey(e)) return; } if (e.key === 'Enter') save(); } // BAD
  function closureGuard(e) { const f = () => { if (isComposingKey(e)) return; }; f(); if (e.key === 'Enter') save(); } // BAD
  function orGuard(e) { if (e.key === 'Tab' || isComposingKey(e)) return; if (e.key === 'Enter') save(); }
  function blockGuard(e) { if (isComposingKey(e)) { e.preventDefault(); return; } if (e.key === 'Enter') save(); }
  function actInGuard(e) { if (isComposingKey(e)) { if (e.key === 'Escape') close(); return; } } // BAD
  function discardedHelper(e) { escapeClosesPanel(e, '.p'); if (e.key === 'Escape') close(); } // BAD
  function branchHelper(e) { if (live) { if (!escapeClosesPanel(e, '.p')) return; } if (e.key === 'Escape') close(); } // BAD
  function topHelper(e) { if (!escapeClosesPanel(e, '.p')) return; if (e.key === 'Escape') close(); }
  function ifHelper(e) { if (escapeClosesPanel(e, '.p') && e.key === 'Escape') close(); }
  function numpad(e) { if (e.code === 'NumpadEnter') save(); } // BAD
  function viaConst(e) { if (e.key === ENTER) save(); } // BAD
  function viaSwitch(e) { switch (e.key) { case ENTER: save(); } } // BAD
  function chain(e) { forwardsLocal(e); } // BAD
  function ping(e) { pong(e); } // BAD
  function pong(e) { ping(e); if (e.key === 'Enter') save(); } // BAD
  useEffect(() => {
    const good = (e) => { if (isComposingKey(e)) return; if (e.key === 'Escape') close(); };
    const bad = (e) => { if (e.keyCode === 27) close(); }; // BAD
    window.addEventListener('keydown', good);
    window.addEventListener('keydown', bad);
  }, []);
  return (<div>
    <input onKeyDown={(e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); }} />
    <input onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />{/* BAD */}
    <input onKeyDown={nameGuarded} />
    <input onKeyDown={nameBare} />
    <input onKeyDown={onGuarded} />
    <input onKeyDown={onBare} />
    <input onKeyDown={onAfter} />
    <input onKeyDown={onMemo} />
    <input onKeyDown={onStopThenGuard} />
    <input onKeyDown={guardedHelper} />
    <input onKeyDown={escapeAndEnter} />
    <input onKeyDown={escapeAfterHelper} />
    <input onKeyDown={escapeGuardedByComposing} />
    <input onKeyDown={regexThenGuarded} />
    <input onKeyDown={forwardsLocal} />
    <input onKeyDown={forwardsGuarded} />
    <input onKeyDown={notGuard} />
    <input onKeyDown={andGuard} />
    <input onKeyDown={shiftNested} />
    <input onKeyDown={closureGuard} />
    <input onKeyDown={orGuard} />
    <input onKeyDown={blockGuard} />
    <input onKeyDown={actInGuard} />
    <input onKeyDown={discardedHelper} />
    <input onKeyDown={branchHelper} />
    <input onKeyDown={topHelper} />
    <input onKeyDown={ifHelper} />
    <input onKeyDown={numpad} />
    <input onKeyDown={viaConst} />
    <input onKeyDown={viaSwitch} />
    <input onKeyDown={chain} />
    <input onKeyDown={ping} />
    <input onKeyDown={pong} />
    <input onKeyDown={(e) => onBare(e, "it's")} />{/* BAD */}
    <input onKeyDown={(e) => e.key === 'x' && go()} />
    <input onKeyDown={live ? (e) => { if (e.key === 'Enter') e.currentTarget.blur(); } : undefined} />{/* BAD */}
    <input onKeyDown={live ? (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') e.currentTarget.blur(); } : undefined} />
    <input onKeyDown={live && onGuarded} />
    <input onKeyDown={(e) => importedHelper(e)} />
    <input onKeyDown={props.onKeyDown} />
  </div>);
}`;
  const r = scan(fixture, 'components/Fixture.jsx');
  const bad = fixture.split('\n')
    .map((l, i) => (l.includes('BAD */}') || /\/\/ BAD$/.test(l) ? i + 1 : 0)).filter(Boolean);
  const got = [...new Set(r.unguarded.map((u) => u.line))].sort((a, b) => a - b);
  assert.deepEqual(got, bad, 'exactly the unguarded handlers (by line)');
  assert.deepEqual(
    r.unresolved.map((u) => u.snippet).sort(),
    ['(e) => importedHelper(e)', 'props.onKeyDown'],
    'what it cannot see is listed',
  );
});

test('the scanner reads a regex literal with quotes and brackets before a sibling guarded handler', () => {
  const r = scan(`
import { isComposingKey } from '../lib/composerKeys.js';
function A() {
  const strip = (s) => s.replace(/["'\\[{(]/g, '');
  const ok = (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); };
  const bad = (e) => { if (e.key === 'Enter') save(); };
  return <input onKeyDown={ok} onKeyUp={bad} />;
}`, 'components/F.jsx');
  assert.equal(r.examined, 2);
  assert.equal(r.unguarded.length, 1);
  assert.match(r.unguarded[0].snippet, /^\(e\) => \{ if \(e\.key === 'Enter'\)/);
});

test('names are resolved by scope, and a handler that hands its event to unseen code is pinned', () => {
  const r = scan(`
import { isComposingKey } from '../lib/composerKeys.js';
import { escapeClosesPanel } from './elsewhere.js';
import { importedHelper } from './elsewhere.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
const onKeyDown = (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); };
export function Prop({ onKeyDown }) { return <input onKeyDown={onKeyDown} />; }
export function Same() { return <input onKeyDown={onKeyDown} />; }
export function Shadow() {
  const onKeyDown = (e) => { if (e.key === 'Enter') save(); }; // BAD
  return <input onKeyDown={onKeyDown} />;
}
export function Late() {
  const late = (e) => { importedHelper(e); if (isComposingKey(e)) return; };
  const member = (e) => { props.x(e); if (isComposingKey(e)) return; };
  const deep = (e) => viaB(e);
  const viaB = (e) => viaC(e);
  const viaC = (e) => importedHelper(e);
  const after = (e) => { if (isComposingKey(e)) return; importedHelper(e); props.x(e); };
  const pure = (e) => { if (isEditableTarget(e)) return; if (isComposingKey(e)) return; };
  const notOwnModule = (e) => { if (!escapeClosesPanel(e, '.p')) return; if (e.key === 'Escape') close(); }; // BAD
  window.addEventListener(kind, late);
  return (<div>
    <input onKeyDown={late} /><input onKeyDown={member} /><input onKeyDown={deep} />
    <input onKeyDown={after} /><input onKeyDown={pure} /><input onKeyDown={notOwnModule} />
  </div>);
}`, 'components/Fixture.jsx');
  assert.equal(r.unguarded.length, 2, 'the shadowing handler and the one asking a helper from another module');
  assert.deepEqual(
    r.unresolved.map((u) => u.snippet).sort(),
    [
      '(e) => { importedHelper(e); if (isComposingKey(e)) return; }',
      '(e) => { props.x(e); if (isComposingKey(e)) return; }',
      '(e) => { if (!escapeClosesPanel(e, \'.p\')) return; if (e.key === \'Escape\') close(); }',
      '(e) => viaB(e)',
      'onKeyDown',
      'window.addEventListener(kind, late)',
    ].sort().map((s) => s.slice(0, 60)),
    'a prop, a late guard, an unseen callee, and an event type it cannot read are listed',
  );
});

// Lines of a fixture marked BAD: a // BAD comment ending the line, or a {/* BAD */}.
const badLines = (fixture) => fixture.split('\n')
  .map((l, i) => (l.includes('BAD */}') || /\/\/ BAD$/.test(l) ? i + 1 : 0)).filter(Boolean);
const unguardedLines = (r) => [...new Set(r.unguarded.map((u) => u.line))].sort((a, b) => a - b);
// Hands every `const name = (e) =>` of a fixture to an <input> where __WIRE__ stands (same line, so lines hold).
const wire = (fixture) => fixture.replace('__WIRE__',
  [...fixture.matchAll(/^ {2}const (\w+) = \(e\)/gm)].map((m) => `<input onKeyDown={${m[1]}} />`).join(''));

test('a helper that answers "no" does not guard: only a literal that says yes, or !== a literal that says no', () => {
  const fixture = `
import { isComposingKey, messageKeyAction } from './composerKeys.js';
import { shouldHandleKey } from '../lib/playerKeys.js';
export function H() {
  const nullIs = (e) => { if (messageKeyAction(e) === null) { if (e.key === 'Enter') save(); } }; // BAD
  const falseIs = (e) => { if (shouldHandleKey(e) === false) { if (e.key === 'Escape') close(); } }; // BAD
  const undefinedIs = (e) => { if (messageKeyAction(e) == undefined) { if (e.key === 'Enter') save(); } }; // BAD
  const zeroIs = (e) => { if (shouldHandleKey(e) === 0) { if (e.key === 'Enter') save(); } }; // BAD
  const emptyIs = (e) => { if (messageKeyAction(e) === '') { if (e.key === 'Enter') save(); } }; // BAD
  const notSend = (e) => { if (messageKeyAction(e) !== 'send') { if (e.key === 'Enter') save(); } }; // BAD
  const notTrue = (e) => { if (shouldHandleKey(e) != true) { if (e.key === 'Escape') close(); } }; // BAD
  const isSend = (e) => { if (messageKeyAction(e) === 'send') { if (e.key === 'Enter') save(); } };
  const sendIs = (e) => { if ('send' === messageKeyAction(e)) { if (e.key === 'Enter') save(); } };
  const isTrue = (e) => { if (shouldHandleKey(e) === true) { if (e.key === 'Escape') close(); } };
  const notNull = (e) => { if (messageKeyAction(e) !== null) { if (e.key === 'Enter') save(); } };
  const notUndefined = (e) => { if (shouldHandleKey(e) != undefined) { if (e.key === 'Escape') close(); } };
  const notFalse = (e) => { if (shouldHandleKey(e) !== false && live) { if (e.key === 'Escape') close(); } };
  return <div>__WIRE__</div>;
}`;
  const r = scan(wire(fixture), 'components/Fixture.jsx');
  assert.deepEqual(unguardedLines(r), badLines(fixture));
});

test('handing the event on through a member chain, a literal or a spread is unseen code', () => {
  const fixture = `
import { isComposingKey } from '../lib/composerKeys.js';
import { importedHelper } from './elsewhere.js';
export function U() {
  const nativeEv = (e) => { importedHelper(e.nativeEvent); if (isComposingKey(e)) return; }; // UNRESOLVED
  const keyProp = (e) => { importedHelper(e.key); if (isComposingKey(e)) return; }; // UNRESOLVED
  const inObject = (e) => { importedHelper({ e }); if (isComposingKey(e)) return; }; // UNRESOLVED
  const inArray = (e) => { importedHelper([e]); if (isComposingKey(e)) return; }; // UNRESOLVED
  const deep = (e) => { importedHelper([{ k: [e.nativeEvent] }]); if (isComposingKey(e)) return; }; // UNRESOLVED
  const objSpread = (e) => { importedHelper({ ...e }); if (isComposingKey(e)) return; }; // UNRESOLVED
  const spreadRest = (...a) => { importedHelper(...a); if (isComposingKey(a[0])) return; }; // UNRESOLVED
  const spreadOther = (e) => { importedHelper(...args); if (isComposingKey(e)) return; }; // UNRESOLVED
  const targets = (e) => { importedHelper(e.target, e.currentTarget.value, { t: e.relatedTarget }); if (isComposingKey(e)) return; };
  const afterGuard = (e) => { if (isComposingKey(e)) return; importedHelper(e.nativeEvent, { e }, ...args); };
  return <div>
    <input onKeyDown={nativeEv} /><input onKeyDown={keyProp} /><input onKeyDown={inObject} />
    <input onKeyDown={inArray} /><input onKeyDown={deep} /><input onKeyDown={objSpread} />
    <input onKeyDown={spreadRest} /><input onKeyDown={spreadOther} />
    <input onKeyDown={targets} /><input onKeyDown={afterGuard} />
  </div>;
}`;
  const r = scan(fixture, 'components/Fixture.jsx');
  const want = fixture.split('\n').map((l, i) => (/\/\/ UNRESOLVED$/.test(l) ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual([...new Set(r.unresolved.map((u) => u.line))].sort((a, b) => a - b), want);
  assert.equal(r.unguarded.length, 0);
});

test('Enter and Escape written as an object key, a regex, a template or a list of keys are acts', () => {
  const fixture = `
import { isComposingKey } from '../lib/composerKeys.js';
const KEYS = ['Enter', 'x'];
const SET = new Set(['Escape']);
const OTHER = ['a', 'b'];
let LATER = ['Enter'];
export function S() {
  const objKey = (e) => { ({ Enter: save, Escape: close })[e.key]?.(); }; // BAD
  const objKeyOk = (e) => { if (isComposingKey(e)) return; ({ Enter: save, Escape: close })[e.key]?.(); };
  const regex = (e) => { if (/^(Enter|Escape)$/.test(e.key)) save(); }; // BAD
  const regexOk = (e) => { if (isComposingKey(e)) return; if (/^(Enter|Escape)$/.test(e.key)) save(); };
  const regexOther = (e) => { if (/^Tab$/.test(e.key)) save(); };
  const tmpl = (e) => { if (e.key === \`Enter\`) save(); }; // BAD
  const tmplOk = (e) => { if (isComposingKey(e)) return; if (e.key === \`Enter\`) save(); };
  const tmplExpr = (e) => { if (e.key === \`En\${'ter'}\`) save(); };
  const inList = (e) => { if (KEYS.includes(e.key)) save(); }; // BAD
  const inListOk = (e) => { if (isComposingKey(e)) return; if (KEYS.includes(e.key)) save(); };
  const inSet = (e) => { if (SET.has(e.key)) close(); }; // BAD
  const inSetOk = (e) => { if (isComposingKey(e)) return; if (SET.has(e.key)) close(); };
  const otherList = (e) => { if (OTHER.includes(e.key)) save(); };
  const letList = (e) => { if (LATER.includes(e.key)) save(); };
  const code13 = (e) => { if ([13].includes(e.keyCode)) save(); }; // BAD
  const code13Ok = (e) => { if (isComposingKey(e)) return; if ([13].includes(e.keyCode)) save(); };
  const which27 = (e) => { if ([27].includes(e.which)) close(); }; // BAD
  const which27Ok = (e) => { if (isComposingKey(e)) return; if ([27].includes(e.which)) close(); };
  const code9 = (e) => { if ([9, 38].includes(e.keyCode)) save(); };
  return <div>__WIRE__</div>;
}`;
  const r = scan(wire(fixture), 'components/Fixture.jsx');
  assert.deepEqual(unguardedLines(r), badLines(fixture));
});

test('a listener that is not a plain addEventListener call or a JSX prop is examined like one', () => {
  const fixture = `
import { useEffect } from 'react';
import { isComposingKey } from '../lib/composerKeys.js';
export function L({ el }) {
  useEffect(() => {
    const viaOptional = (e) => { if (e.key === 'Enter') save(); }; // BAD
    el.addEventListener?.('keydown', viaOptional);
    const viaAssign = (e) => { if (e.key === 'Enter') save(); }; // BAD
    el.onkeydown = viaAssign;
    el.onkeyup = (e) => { if (e.key === 'Escape') close(); }; // BAD
    el.onkeypress = (e) => { if (e.key === 'Escape') close(); }; // BAD
    const guardedOptional = (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); };
    el.addEventListener?.('keydown', guardedOptional);
    el.onkeydown = (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); };
    el.onclick = (e) => { if (e.key === 'Enter') save(); };
    el.addEventListener?.('click', (e) => { if (e.key === 'Enter') save(); });
  }, []);
  const handlers = {
    onKeyDown: (e) => { if (e.key === 'Enter') save(); }, // BAD
    onKeyUp(e) { if (e.key === 'Escape') close(); }, // BAD
    onKeyPress: (e) => { if (e.key === 'Enter') save(); }, // BAD
    onClick: (e) => { if (e.key === 'Enter') save(); },
  };
  const okHandlers = {
    onKeyDown: (e) => { if (isComposingKey(e)) return; if (e.key === 'Enter') save(); },
    onKeyUp(e) { if (isComposingKey(e)) return; if (e.key === 'Escape') close(); },
  };
  return <input {...handlers} {...okHandlers} />;
}`;
  const r = scan(fixture, 'components/Fixture.jsx');
  assert.deepEqual(unguardedLines(r), badLines(fixture));
  assert.equal(r.examined, 11);
});

test("in a guard's own test comparisons stay quiet, but a call or assignment before the guard runs mid-composition", () => {
  const fixture = `
import { isComposingKey } from '../lib/composerKeys.js';
import { escapeClosesPanel } from '../lib/panelEscape.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
export function Q() {
  const callBefore = (e) => { if ((e.key === 'Enter' && save()) || isComposingKey(e)) return; }; // BAD
  const callFirst = (e) => { if ((save() && e.key === 'Escape') || isComposingKey(e)) return; }; // BAD
  const assignBefore = (e) => { if ((e.key === 'Enter' && (draft = 1)) || isComposingKey(e)) return; }; // BAD
  const helperAfterCall = (e) => { if ((e.key === 'Escape' && close()) || !escapeClosesPanel(e, '.p')) return; }; // BAD
  const compareBefore = (e) => { if (e.key !== 'Enter' || isComposingKey(e)) return; save(); };
  const guardFirst = (e) => { if (isComposingKey(e) || e.key !== 'Enter') return; save(); };
  const pureBefore = (e) => { if ((e.key === 'Enter' && isEditableTarget(e)) || isComposingKey(e)) return; };
  const callAfter = (e) => { if (isComposingKey(e) || (e.key === 'Enter' && save())) return; };
  const callNoKey = (e) => { if ((e.key === 'Tab' && save()) || isComposingKey(e)) return; };
  return <div>
    <input onKeyDown={callBefore} /><input onKeyDown={callFirst} /><input onKeyDown={assignBefore} />
    <input onKeyDown={helperAfterCall} /><input onKeyDown={compareBefore} /><input onKeyDown={guardFirst} />
    <input onKeyDown={pureBefore} /><input onKeyDown={callAfter} /><input onKeyDown={callNoKey} />
  </div>;
}`;
  const r = scan(fixture, 'components/Fixture.jsx');
  assert.deepEqual(unguardedLines(r), badLines(fixture));
});

test('every key handler that acts on Enter or Escape and can see a text field asks isComposingKey first', () => {
  const unguarded = [];
  const unresolved = [];
  let examined = 0;
  for (const file of files(SRC)) {
    const r = scan(readFileSync(join(SRC, file), 'utf8'), file);
    examined += r.examined;
    for (const u of r.unguarded) unguarded.push({ file, ...u });
    for (const u of r.unresolved) unresolved.push({ file, ...u });
  }
  console.log(`imeGuard: examined ${examined}, unresolved ${unresolved.length}, unguarded ${unguarded.length}`);
  assert.ok(examined >= EXAMINED_FLOOR, `examined ${examined} handlers, expected at least ${EXAMINED_FLOOR}`);

  const problems = [];
  const allow = ALLOW.map((a) => ({ ...a, used: false }));
  for (const u of unguarded) {
    const hit = allow.find((a) => !a.used && a.file === u.file && u.snippet.startsWith(a.snippet));
    if (hit) { hit.used = true; continue; }
    problems.push(`src/${u.file}:${u.line}  ${u.snippet}`);
  }
  for (const a of allow) if (!a.used) problems.push(`stale ALLOW (matches no unguarded handler): src/${a.file}  "${a.snippet}"`);
  assert.equal(problems.length, 0,
    `Key handlers that act on Enter/Escape without isComposingKey(e) (lib/composerKeys.js). Add the guard as the first statement, or ALLOW a handler that is not a text field:\n${problems.join('\n')}`);

  const pinned = UNRESOLVED.map((p) => ({ ...p, used: false }));
  const unseen = [];
  for (const u of unresolved) {
    const hit = pinned.find((p) => !p.used && p.file === u.file && p.snippet === u.snippet);
    if (hit) hit.used = true;
    else unseen.push(`new unresolved handler, look at it and update UNRESOLVED: src/${u.file}:${u.line}  ${u.snippet}`);
  }
  for (const p of pinned) if (!p.used) unseen.push(`pinned unresolved handler is gone, update UNRESOLVED: src/${p.file}  ${p.snippet}`);
  assert.equal(unseen.length, 0, unseen.join('\n'));
});

test('the acting helpers ask isComposingKey before they act', () => {
  for (const [name, { file, keys }] of Object.entries(HELPERS)) {
    const source = readFileSync(join(SRC, file), 'utf8');
    const ctx = prepare(source, file);
    const fn = ctx.ast.program.body
      .map((s) => (s.type === 'ExportNamedDeclaration' ? s.declaration : s))
      .find((s) => s?.type === 'FunctionDeclaration' && s.id.name === name);
    assert.ok(fn, `${name} is not defined in src/${file}`);
    // A helper's own comparisons come after its guard, or sit inside it.
    const { acts } = analyze(ctx, fn);
    assert.deepEqual(acts.filter((a) => keys.includes(a.key)), [], `${name} (src/${file}) acts on ${keys.join('/')} before isComposingKey`);
    let calls = false;
    visit(fn.body, (n) => { if (n.type === 'CallExpression' && n.callee.name === 'isComposingKey') calls = true; });
    assert.ok(calls, `${name} (src/${file}) never calls isComposingKey`);
  }
});
