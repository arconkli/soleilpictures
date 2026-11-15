// The wrap codemod: puts the app's English in Lingui macros without reprinting a
// file. It parses with @babel/parser, collects text edits by node offsets and
// applies them from the end of the file backwards, so every byte outside an edit
// stays as it was. Whatever it will not edit it reports.
//
//   node scripts/i18nWrap.mjs [--write] [--json <file>] [--md <file>] [--ratchet] [paths…]
//
// Dry run unless --write. Steps 11b–13 run it area by area; src/lib/i18nWrap.test.mjs
// pins every rule with a fixture and src/lib/i18nCoverage.test.mjs keeps wrapped
// files wrapped (scripts/i18nCoverage.mjs, an independent walker).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  BOARDS, appFiles, workerShared, rel, hasWords, looksUi,
  isTextProp, SINK_IDENTIFIERS, SINK_MEMBERS, SINK_KEYS, SINK_NESTED, NATIVE_NAMES, STRICT_KEYS, DENY_CALLS,
  KEEP_ENGLISH, INLINE_TAGS, NO_WRAP_PARENTS, STRING_CHILD_COMPONENTS, SAFE_MODULE_CALLS, LOAD_METHODS, workerSharedBreakdown,
  resolveSpecifier, SRC,
} from './i18nScope.mjs';

const traverse = traverseModule.default || traverseModule;

const CORE = '@lingui/core/macro';
const REACT = '@lingui/react/macro';
const COUNT_NAME = /count|length|total|size|\bn\b|num|selected/i;
const WS = /[ \t\r\n]/;
// Elements whose children React reads as a string: a Trans component there is not text.
const STRING_CHILDREN = new Set(['option', 'title', 'textarea']);

const isStringish = (n) => n && (n.type === 'StringLiteral' || (n.type === 'TemplateLiteral'));
const nameOf = (k) => (!k ? null : k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null);
const importedName = (s) => s.imported && (s.imported.name || s.imported.value);

function jsxName(n) {
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${jsxName(n.object)}.${n.property.name}`;
  if (n.type === 'JSXNamespacedName') return `${n.namespace.name}:${n.name.name}`;
  return '';
}

// The text a literal reads as: a string's value, or a template's text with the
// placeholders left out. null when a template has an invalid escape.
function literalText(n) {
  if (n.type === 'StringLiteral') return n.value;
  if (n.type !== 'TemplateLiteral') return null;
  let s = '';
  for (const q of n.quasis) {
    if (q.value.cooked == null) return null;
    s += q.value.cooked;
  }
  return s;
}

// A string literal's text as it goes between backticks.
function escapeForTemplate(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

// ---- module-scope tables read while the module loads (F2) ----

const CALL_TYPES = /^(Call|OptionalCall|New)Expression$/;
const MEMBER_TYPES = /^(Optional)?MemberExpression$/;

// "Object.freeze", "createContext", "new Map": how SAFE_MODULE_CALLS names a call.
function calleeLabel(node) {
  const c = node.callee;
  let name;
  if (c.type === 'Identifier') name = c.name;
  else if (MEMBER_TYPES.test(c.type) && !c.computed && c.property.type === 'Identifier') name = c.object.type === 'Identifier' ? `${c.object.name}.${c.property.name}` : c.property.name;
  else name = 'call';
  return node.type === 'NewExpression' ? `new ${name}` : name;
}

function memberName(node) {
  if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null;
  return node.property.type === 'StringLiteral' ? node.property.value : null;
}

const hasStringLeaf = (n) => !!n && (isStringish(n)
  || (n.type === 'ConditionalExpression' && (hasStringLeaf(n.consequent) || hasStringLeaf(n.alternate)))
  || (n.type === 'LogicalExpression' && (hasStringLeaf(n.left) || hasStringLeaf(n.right))));

// The would-be getter keys inside a node: STRICT_KEYS properties holding text.
function getterKeysIn(node, out = new Set()) {
  if (!node || typeof node.type !== 'string') return out;
  if (node.type === 'ObjectProperty' && !node.computed && STRICT_KEYS.has(nameOf(node.key)) && hasStringLeaf(node.value)) out.add(nameOf(node.key));
  for (const k of Object.keys(node)) {
    if (k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => getterKeysIn(c, out));
    else if (v && typeof v.type === 'string') getterKeysIn(v, out);
  }
  return out;
}

// What one load-time reference to a table does with it: { why } when it runs a
// getter, { alias } when the table is put by reference into another module-level
// binding (check that one's reads too), null when it is harmless.
function loadRead(ref, keys) {
  let p = ref;
  for (;;) {
    const parent = p.parentPath;
    if (!parent) return null;
    const t = parent.node.type;
    if (MEMBER_TYPES.test(t) && p.key === 'object') {
      const n = memberName(parent.node);
      if (n != null && (keys.has(n) || LOAD_METHODS.has(n))) return { why: `.${n} is read at load` };
    } else if (t === 'SpreadElement') {
      return { why: 'spread at load' };
    } else if (CALL_TYPES.test(t) && p.listKey === 'arguments') {
      const label = calleeLabel(parent.node);
      if (!SAFE_MODULE_CALLS.has(label)) return { why: `passed to ${label}() at load` };
    } else if (t === 'VariableDeclarator' && p.key === 'init') {
      if (parent.node.id.type === 'Identifier' && !parent.getFunctionParent()) return { alias: parent.node.id.name };
      return { why: 'destructured at load' };
    } else if (/^For(Of|In)Statement$/.test(t) && p.key === 'right') {
      return { why: 'iterated at load' };
    } else if (!/^(ObjectProperty|ObjectExpression|ArrayExpression|ParenthesizedExpression|TSAsExpression|TSNonNullExpression|ConditionalExpression|LogicalExpression|SequenceExpression)$/.test(t)) {
      return null;
    } else if ((t === 'ObjectProperty' && p.key !== 'value') || (t === 'ConditionalExpression' && p.key === 'test')) {
      return null;
    }
    p = parent;
  }
}

// Whether the module-level binding `name` is read, while the module loads, in a
// way that runs a getter in it (or in a table it was put into). Returns the
// reason or null. `seen` guards alias cycles.
function loadReadReason(programPath, name, keys, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);
  const binding = programPath.scope.getBinding(name);
  if (!binding) return null;
  for (const ref of binding.referencePaths) {
    if (ref.getFunctionParent()) continue;
    const r = loadRead(ref, keys);
    if (!r) continue;
    if (r.why) return r.why;
    const via = loadReadReason(programPath, r.alias, keys, seen);
    if (via) return `${via} (through ${r.alias})`;
  }
  return null;
}

// The names a module-level `const X` is exported under.
function exportedAs(programNode, name) {
  const out = new Set();
  for (const node of programNode.body) {
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration && node.declaration.type === 'VariableDeclaration' && node.declaration.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === name)) out.add(name);
      if (!node.source) for (const sp of node.specifiers) if (sp.type === 'ExportSpecifier' && sp.local.name === name) out.add(sp.exported.name || sp.exported.value);
    } else if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'Identifier' && node.declaration.name === name) out.add('default');
  }
  return out;
}

// Reads, in OTHER files, of a table this file exports: a module-scope read of
// the imported binding that would run a getter. Built once per CLI run from the
// import declarations of `files`. Namespace imports and re-exports are not
// followed (the DEV early-read warning catches those at runtime).
export function makeCrossReader(files) {
  let index = null;
  const parsed = new Map();
  const build = () => {
    index = new Map();
    for (const f of files) {
      const ast = parseAny(readFileSync(f, 'utf8'));
      if (!ast) continue;
      for (const node of ast.program.body) {
        if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
        const target = resolveSpecifier(f, node.source.value);
        if (!target) continue;
        for (const sp of node.specifiers) {
          if (sp.type === 'ImportNamespaceSpecifier') continue;
          const imported = sp.type === 'ImportDefaultSpecifier' ? 'default' : sp.imported.name || sp.imported.value;
          if (!index.has(target)) index.set(target, []);
          index.get(target).push({ file: f, imported, local: sp.local.name });
        }
      }
    }
  };
  const programOf = (f) => {
    if (!parsed.has(f)) {
      let found = null;
      const ast = parseAny(readFileSync(f, 'utf8'));
      if (ast) traverse(ast, { Program(path) { found = path; path.stop(); } });
      parsed.set(f, found);
    }
    return parsed.get(f);
  };
  return (file, names, keys) => {
    if (!index) build();
    for (const use of index.get(file) || []) {
      if (!names.has(use.imported)) continue;
      const program = programOf(use.file);
      if (!program) continue;
      const why = loadReadReason(program, use.local, keys);
      if (why) return `${why} in ${rel(use.file)}`;
    }
    return null;
  };
}

// ---- text also used as data (F3) ----

const COMPARE_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'has', 'get', 'set', 'delete']);

// The text of a string literal, or of a template with no expressions.
const plainText = (n) => (n && n.type === 'StringLiteral' ? n.value : n && n.type === 'TemplateLiteral' && !n.expressions.length ? n.quasis[0].value.cooked : null);

const parseAny = (code) => {
  try { return parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }); } catch (_) { return null; }
};

// text -> "file:line" for every literal the code compares or looks up: an
// operand of === !== == !=, a case test, the argument of includes / startsWith /
// endsWith / indexOf / lastIndexOf, the first argument of Map and Set methods,
// a computed key, the left side of `in`. The first sighting wins.
export function comparedTexts(ast, file, into = new Map()) {
  const add = (n) => {
    const text = plainText(n);
    if (text != null && hasWords(text) && !into.has(text)) into.set(text, `${file}:${n.loc.start.line}`);
  };
  const go = (n) => {
    if (!n || typeof n.type !== 'string') return;
    switch (n.type) {
      case 'BinaryExpression':
        if (['===', '!==', '==', '!='].includes(n.operator)) { add(n.left); add(n.right); } else if (n.operator === 'in') add(n.left);
        break;
      case 'SwitchCase': add(n.test); break;
      case 'CallExpression': case 'OptionalCallExpression': {
        const c = n.callee;
        if (MEMBER_TYPES.test(c.type) && !c.computed && c.property.type === 'Identifier' && COMPARE_METHODS.has(c.property.name)) add(n.arguments[0]);
        break;
      }
      case 'MemberExpression': case 'OptionalMemberExpression': if (n.computed) add(n.property); break;
      default:
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(go);
      else if (v && typeof v.type === 'string') go(v);
    }
  };
  go(ast.program);
  return into;
}

// The compared-text map over `files` (absolute paths).
export function buildComparedSet(files) {
  const into = new Map();
  for (const f of files) {
    const ast = parseAny(readFileSync(f, 'utf8'));
    if (ast) comparedTexts(ast, rel(f), into);
  }
  return into;
}

// text -> "file:line" for every quoted literal on the server: single-quoted
// strings in supabase/migrations/*.sql, and string literals in party/** and
// ../mcp/src/**.
export function buildServerTexts() {
  const into = new Map();
  const keep = (text) => text.length <= 200 && hasWords(text);
  const migrations = join(BOARDS, '..', 'supabase', 'migrations');
  if (existsSync(migrations)) {
    for (const name of readdirSync(migrations).filter((n) => n.endsWith('.sql')).sort()) {
      const raw = readFileSync(join(migrations, name), 'utf8');
      const sql = raw.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
      const re = /'((?:[^']|'')*)'/g;
      let m;
      let line = 1;
      let at = 0;
      while ((m = re.exec(sql))) {
        const text = m[1].replace(/''/g, "'");
        if (!keep(text) || into.has(text)) continue;
        for (let i = sql.indexOf('\n', at); i !== -1 && i < m.index; i = sql.indexOf('\n', i + 1)) line++;
        at = m.index;
        into.set(text, `supabase/migrations/${name}:${line}`);
      }
    }
  }
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') visit(p); continue; }
      if (!/\.(jsx?|mjs|tsx?)$/.test(ent.name)) continue;
      const ast = parseAny(readFileSync(p, 'utf8'));
      if (!ast) continue;
      const go = (n) => {
        if (!n || typeof n.type !== 'string') return;
        if (/^(Import|ExportNamed|ExportAll)Declaration$/.test(n.type)) return;
        const text = plainText(n);
        if (text != null && keep(text) && !into.has(text)) into.set(text, `${rel(p)}:${n.loc.start.line}`);
        for (const k of Object.keys(n)) {
          if (k === 'loc') continue;
          const v = n[k];
          if (Array.isArray(v)) v.forEach(go);
          else if (v && typeof v.type === 'string') go(v);
        }
      };
      go(ast.program);
    }
  };
  visit(join(BOARDS, 'party'));
  visit(join(BOARDS, '..', 'mcp', 'src'));
  return into;
}

// ---- named placeholders (F5) ----

const CALL_PREFIX = /^(format|fmt|get|to|render)(?=\p{Lu})/u;
const VALID_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// The name a non-identifier placeholder gets in `ph({ name: expr })`.
function placeholderName(expr) {
  let e = expr;
  while (e.type === 'TSNonNullExpression' || e.type === 'TSAsExpression' || e.type === 'ParenthesizedExpression') e = e.expression;
  let base = 'value';
  if (MEMBER_TYPES.test(e.type)) {
    const n = !e.computed && e.property.type === 'Identifier' ? e.property.name : null;
    if (n) base = n === 'length' ? 'count' : n;
  } else if (/^(Optional)?CallExpression$/.test(e.type)) {
    const c = e.callee;
    const n = c.type === 'Identifier' ? c.name : MEMBER_TYPES.test(c.type) && !c.computed && c.property.type === 'Identifier' ? c.property.name : null;
    if (n) {
      const stripped = n.replace(CALL_PREFIX, '');
      if (stripped) base = stripped[0].toLowerCase() + stripped.slice(1);
    }
  }
  return VALID_NAME.test(base) ? base : 'value';
}

// Names for the non-identifier placeholders of one message, unique within it
// and distinct from the identifier placeholders already in `taken`.
function nameAll(exprs, taken) {
  const names = [];
  for (const e of exprs) {
    const base = placeholderName(e);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}${i}`;
    taken.add(name);
    names.push(name);
  }
  return names;
}

// ---- JSX whitespace (what React makes of a JSXText) ----

function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) lastNonEmpty = i;
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^[ ]+/, '');
    if (i !== lines.length - 1) line = line.replace(/[ ]+$/, '');
    if (line) out += i === lastNonEmpty ? line : `${line} `;
  }
  return out;
}

export function applyEdits(code, edits) {
  const sorted = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.start - b.start || a.end - b.end || a.i - b.i);
  let lastEnd = -1;
  for (const e of sorted) {
    if (e.start < lastEnd) throw new Error(`overlapping edits at ${e.start} (${e.kind})`);
    if (e.end > e.start) lastEnd = e.end;
  }
  let out = code;
  for (let k = sorted.length - 1; k >= 0; k--) {
    const e = sorted[k];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

// `compared` and `server` are text -> "file:line" maps (comparedTexts,
// buildServerTexts): a candidate whose exact text is in one is also data, so it
// is reported, not wrapped. `compared` defaults to the file's own; `crossRead`
// (makeCrossReader) answers whether another file reads a table this file exports
// while loading.
export function wrapSource(code, { filename = 'file.jsx', compared = null, server = new Map(), crossRead = null } = {}) {
  const edits = [];
  const report = [];
  const lines = code.split('\n');
  const seenReport = new Set();
  const note = (kind, node, hint = '') => {
    const loc = node.loc.start;
    const key = `${loc.line}:${loc.column}:${kind}:${hint}`;
    if (seenReport.has(key)) return;
    seenReport.add(key);
    report.push({ file: filename, line: loc.line, column: loc.column, kind, text: (lines[loc.line - 1] || '').trim().slice(0, 120), hint });
  };

  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    report.push({ file: filename, line: 1, column: 0, kind: 'skipped', text: '', hint: `does not parse: ${e.message.split('\n')[0]}` });
    return { code, edits, report };
  }

  // ---- what the file already has ----
  let existingT = null;
  let existingPh = null;
  let existingTrans = null;
  const transLocals = new Set();
  const macroPlurals = new Set(); // local names of plural/select/selectOrdinal imported from the core macro
  let coreImport = null;
  let reactImport = null;
  let lastImport = null;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    lastImport = node;
    if (node.source.value === CORE) {
      if (node.specifiers.some((s) => s.type === 'ImportSpecifier')) coreImport ||= node;
      for (const s of node.specifiers) {
        if (s.type !== 'ImportSpecifier') continue;
        if (importedName(s) === 't') existingT ||= s.local.name;
        if (importedName(s) === 'ph') existingPh ||= s.local.name;
        if (/^(plural|select|selectOrdinal)$/.test(importedName(s))) macroPlurals.add(s.local.name);
      }
    }
    if (node.source.value === REACT) {
      if (node.specifiers.some((s) => s.type === 'ImportSpecifier')) reactImport ||= node;
      for (const s of node.specifiers) {
        if (s.type !== 'ImportSpecifier') continue;
        if (importedName(s) === 'useLingui') {
          report.push({ file: filename, line: node.loc.start.line, column: node.loc.start.column, kind: 'skipped', text: (lines[node.loc.start.line - 1] || '').trim().slice(0, 120), hint: 'imports useLingui from @lingui/react/macro: done by hand' });
          return { code, edits, report };
        }
        if (importedName(s) === 'Trans') { existingTrans ||= s.local.name; transLocals.add(s.local.name); }
      }
    }
  }

  const comparedMap = compared || comparedTexts(ast, filename);
  const bound = new Set();
  const scopes = new Set();
  const assigned = new Set();
  const verdicts = new Map(); // getterReadAtLoad's answers, per table
  let boundary = false; // an error boundary: its fallback must not need the provider
  traverse(ast, {
    'ClassMethod|ClassProperty|ObjectMethod'(path) {
      const k = path.node.computed ? null : nameOf(path.node.key);
      if (k === 'getDerivedStateFromError' || k === 'componentDidCatch') boundary = true;
    },
    enter(path) {
      const s = path.scope;
      if (s && !scopes.has(s)) { scopes.add(s); for (const n of Object.keys(s.bindings)) bound.add(n); }
    },
    AssignmentExpression(path) {
      const l = path.node.left;
      if (l.type !== 'MemberExpression') return;
      const k = !l.computed && l.property.type === 'Identifier' ? l.property.name : l.computed && l.property.type === 'StringLiteral' ? l.property.value : null;
      if (k) assigned.add(k);
    },
  });

  const tName = existingT || (!bound.has('t') ? 't' : !bound.has('tr') ? 'tr' : 'tt');
  const transName = existingTrans || (bound.has('Trans') ? 'LTrans' : 'Trans');
  const phName = existingPh || (!bound.has('ph') ? 'ph' : !bound.has('lph') ? 'lph' : 'lph2');
  let usedT = false;
  let usedTrans = false;
  let usedPh = false;

  const edit = (kind, start, end, text) => edits.push({ kind, start, end, text });
  const src = (n) => code.slice(n.start, n.end);

  // ---- calls and ancestors ----
  const isDenyCallee = (callee) => {
    if (!callee) return false;
    if (callee.type === 'Import') return true;
    if (callee.type === 'Identifier') return DENY_CALLS.names.has(callee.name) || DENY_CALLS.prefixes.some((p) => callee.name.startsWith(p));
    if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
      const prop = !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
      if (prop && (DENY_CALLS.properties.has(prop) || DENY_CALLS.prefixes.some((p) => prop.startsWith(p)))) return true;
      const o = callee.object;
      if (o.type === 'Identifier' && DENY_CALLS.objects.has(o.name)) return true;
      if (o.type === 'MemberExpression' && !o.computed && o.property.type === 'Identifier' && DENY_CALLS.objects.has(o.property.name)) return true;
      if (o.type === 'Identifier' && o.name === 'CSS' && prop === 'supports') return true;
    }
    return false;
  };
  // A string is "inside the arguments" of a deny call when it sits in them
  // without a function in between: a callback's body is code that runs.
  const denied = (path) => {
    let p = path;
    while (p.parentPath) {
      const parent = p.parentPath;
      if (parent.isFunction()) return false;
      if ((parent.isCallExpression() || parent.isOptionalCallExpression() || parent.isNewExpression()) && p.listKey === 'arguments' && isDenyCallee(parent.node.callee)) return true;
      p = parent;
    }
    return false;
  };
  const tBindingOk = (path) => {
    const b = path.scope.getBinding(tName);
    if (existingT) return !!b && b.kind === 'module' && b.path.parent && b.path.parent.source && b.path.parent.source.value === CORE;
    return !b;
  };

  // ---- LEAVES ----
  const handled = new WeakSet(); // literals that a rule edited or reported: no ui-literal
  const markDeep = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (isStringish(node)) handled.add(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(markDeep);
      else if (v && typeof v.type === 'string') markDeep(v);
    }
  };
  const concatParts = (n) => {
    if (n.type === 'BinaryExpression' && n.operator === '+') return [...concatParts(n.left), ...concatParts(n.right)];
    return isStringish(n) ? [n] : [];
  };
  const leavesOf = (path, out) => {
    const n = path.node;
    if (n.type === 'StringLiteral' || n.type === 'TemplateLiteral') {
      const text = literalText(n);
      if (text == null) return;
      if (hasWords(text) && !KEEP_ENGLISH.has(text.trim())) out.push(path);
    } else if (n.type === 'ConditionalExpression') {
      leavesOf(path.get('consequent'), out);
      leavesOf(path.get('alternate'), out);
    } else if (n.type === 'LogicalExpression') {
      leavesOf(path.get('left'), out);
      leavesOf(path.get('right'), out);
    } else if (n.type === 'BinaryExpression' && n.operator === '+') {
      const parts = concatParts(n);
      if (parts.some((p) => looksUi(literalText(p) || ''))) {
        note('concat', n, 'build the sentence as one template: t`Hello ${name}`');
        parts.forEach((p) => handled.add(p));
      }
    }
  };

  const countOfTemplate = (n) => {
    for (let i = 0; i < n.quasis.length - 1; i++) {
      const e = n.expressions[i];
      if (e.type === 'CallExpression' && e.callee.type === 'Identifier' && macroPlurals.has(e.callee.name)) continue; // already plural forms
      const next = n.quasis[i + 1].value.cooked || '';
      if (/^ \p{L}/u.test(next) && COUNT_NAME.test(src(n.expressions[i]))) note('count', n.expressions[i], 'a number before a noun: needs plural forms');
    }
  };

  // A singular and a plural written by hand: `n === 1 ? 'card' : 'cards'`.
  const isCountCond = (n) => {
    if (n.type !== 'ConditionalExpression' || n.test.type !== 'BinaryExpression') return false;
    const { test, consequent, alternate } = n;
    const num = (x, v) => x.type === 'NumericLiteral' && x.value === v;
    const op = test.operator;
    const is = (['===', '!==', '==', '!='].includes(op) && (num(test.right, 1) || num(test.left, 1)))
      || (op === '>' && num(test.right, 1)) || (op === '<' && num(test.right, 2));
    return is && (isStringish(consequent) || isStringish(alternate));
  };

  // English written inside a placeholder (not already wrapped): 'count' when it
  // sits in a singular/plural ternary, which is never translated as a sentence,
  // 'nested' for any other; null for none. A call of the macro's plural, select
  // or selectOrdinal is one message with its options: its option strings and the
  // text of their templates are part of it, its first argument and the
  // placeholders in those templates are still looked into.
  const isMacroPlural = (n, path) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier' || !macroPlurals.has(n.callee.name)) return false;
    const b = path.scope.getBinding(n.callee.name);
    return !!(b && b.path.isImportSpecifier() && b.path.parent.source.value === CORE);
  };
  const placeholderEnglish = (exprs, path) => {
    let count = false;
    let nested = false;
    const go = (n, inCount) => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'TaggedTemplateExpression') return;
      if (isMacroPlural(n, path)) {
        const [first, options, ...rest] = n.arguments;
        go(first, inCount);
        rest.forEach((x) => go(x, inCount));
        if (options && options.type === 'ObjectExpression') {
          for (const p of options.properties) {
            if (p.type !== 'ObjectProperty') { go(p, inCount); continue; }
            if (p.computed) go(p.key, inCount);
            if (p.value.type === 'StringLiteral') continue;
            if (p.value.type === 'TemplateLiteral') p.value.expressions.forEach((x) => go(x, inCount));
            else go(p.value, inCount);
          }
        } else go(options, inCount);
        return;
      }
      if (isStringish(n)) {
        const t = literalText(n);
        if (t != null && hasWords(t)) { if (inCount) count = true; else nested = true; }
      }
      const into = inCount || isCountCond(n);
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach((x) => go(x, into));
        else if (v && typeof v.type === 'string') go(v, into);
      }
    };
    exprs.forEach((e) => go(e, false));
    return count ? 'count' : nested ? 'nested' : null;
  };
  // Marks the literal as handled and notes why it stays English; true when it does.
  const placeholderBlocks = (n, path) => {
    const why = placeholderEnglish(n.expressions, path);
    if (!why) return false;
    markDeep(n);
    if (why === 'count') note('count', n, 'a singular and a plural inside a sentence: write the whole sentence with plural()');
    else note('nested-english', n, 'English inside a placeholder: wrap the inner text first or split the sentence');
    return true;
  };

  // Text that is also data (compared, looked up, or quoted on the server) is
  // reported, not wrapped: translating it would break the comparison.
  const blockedText = (n) => {
    const text = plainText(n);
    if (text == null) return false;
    const c = comparedMap.get(text);
    if (c) { note('compared', n, `the same text is compared at ${c}`); return true; }
    const sv = server.get(text);
    if (sv) { note('also-on-server', n, `the same text is quoted at ${sv}`); return true; }
    return false;
  };

  // `${ph({ name: expr })}` for each placeholder that is not a plain identifier
  // (the macro would number it {0}); identifiers keep their names. `items` are
  // { expr, open, close }: the offsets just inside the braces.
  const needsPh = (e) => e.type !== 'Identifier' && !(e.type === 'TaggedTemplateExpression'
    || (e.type === 'CallExpression' && e.callee.type === 'Identifier' && (/^(plural|select|selectOrdinal|ph|t)$/.test(e.callee.name) || e.callee.name === phName)));
  // expression node -> its name, for the placeholders of one message
  const namesFor = (exprs) => {
    const todo = exprs.filter(needsPh);
    const names = nameAll(todo, new Set(exprs.filter((e) => e.type === 'Identifier').map((e) => e.name)));
    return new Map(todo.map((e, i) => [e, names[i]]));
  };
  const phEdits = (kind, items) => {
    const names = namesFor(items.map((it) => it.expr));
    for (const it of items) {
      if (!names.has(it.expr)) continue;
      usedPh = true;
      edit('ph', it.open, it.open, `${phName}({ ${names.get(it.expr)}: `);
      edit('ph', it.close, it.close, ' })');
    }
  };

  // Wrap one string or template literal in t`…`.
  const wrapLeaf = (path, kind, { getter = false } = {}) => {
    const n = path.node;
    handled.add(n);
    if (blockedText(n)) return false;
    if (!getter && !path.getFunctionParent()) { note('module-scope', n, 'a t call at module scope would run before the language is chosen'); return false; }
    if (!tBindingOk(path)) { note('shadowed-t', n, `"${tName}" is something else here`); return false; }
    const text = literalText(n);
    if (/[{}]/.test(text)) { note('brace', n, 'a brace in the text: write it by hand'); return false; }
    if (n.type === 'TemplateLiteral' && placeholderBlocks(n, path)) return false;
    usedT = true;
    if (n.type === 'StringLiteral') {
      edit(kind, n.start, n.end, `${tName}\`${escapeForTemplate(n.value)}\``);
    } else {
      edit(kind, n.start, n.start, tName);
      for (let i = 0; i < n.quasis.length - 1; i++) {
        const q = n.quasis[i];
        if (q.value.cooked.endsWith("'")) edit(kind, q.end, q.end, "'");
      }
      phEdits(kind, n.expressions.map((expr, i) => ({ expr, open: n.quasis[i].end + 2, close: n.quasis[i + 1].start - 1 })));
      countOfTemplate(n);
    }
    return true;
  };
  const wrapLeaves = (path, kind, filter = () => true) => {
    const out = [];
    leavesOf(path, out);
    for (const leaf of out) if (filter(literalText(leaf.node))) wrapLeaf(leaf, kind);
  };

  // ---- A: JSX text runs ----
  const consumed = new WeakSet(); // inline elements inside a run (wrapped or left on purpose)
  const handledContainers = new WeakSet();
  const clsCache = new WeakMap();

  const exprInfo = (node) => {
    const info = { jsx: false, fn: false, english: false };
    const go = (n) => {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'JSXElement' || n.type === 'JSXFragment') info.jsx = true;
      else if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression') info.fn = true;
      else if (n.type === 'StringLiteral' || n.type === 'TemplateLiteral') {
        const t = literalText(n);
        if (t != null && hasWords(t)) info.english = true;
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(go);
        else if (v && typeof v.type === 'string') go(v);
      }
    };
    go(node);
    return info;
  };

  const classify = (child) => {
    if (clsCache.has(child)) return clsCache.get(child);
    let type;
    switch (child.type) {
      case 'JSXText': type = 'TEXT'; break;
      case 'JSXExpressionContainer': {
        const e = child.expression;
        if (e.type === 'JSXEmptyExpression') type = 'BREAK';
        else if (e.type === 'StringLiteral') type = 'STR';
        else {
          const info = exprInfo(e);
          type = info.jsx || info.fn ? 'BREAK' : info.english ? 'ENGLISH' : 'SIMPLE';
        }
        break;
      }
      case 'JSXElement': {
        const name = jsxName(child.openingElement.name);
        const kids = child.children.map(classify);
        if (INLINE_TAGS.has(name)) type = kids.every((k) => k !== 'BREAK' && k !== 'ENGLISH') ? 'INLINE' : 'BREAK';
        else if (/^[A-Z]/.test(name) || name.includes('.')) {
          type = child.openingElement.selfClosing || kids.every((k) => k === 'TEXT' || k === 'STR' || k === 'SIMPLE' || k === 'INLINE') ? 'INLINE' : 'BREAK';
        } else type = 'BREAK';
        break;
      }
      default: type = 'BREAK';
    }
    clsCache.set(child, type);
    return type;
  };

  // [{ text, code }] for every TEXT and STR in a child, inside its inline elements too.
  const textsOf = (child, inCode = false) => {
    if (child.type === 'JSXText') return [{ text: child.value, code: inCode }];
    if (child.type === 'JSXExpressionContainer') return child.expression.type === 'StringLiteral' ? [{ text: child.expression.value, code: inCode }] : [];
    if (child.type === 'JSXElement') {
      const nm = jsxName(child.openingElement.name);
      return child.children.flatMap((c) => textsOf(c, inCode || nm === 'code' || nm === 'pre'));
    }
    return [];
  };
  const markInline = (child) => {
    if (child.type !== 'JSXElement') return;
    consumed.add(child);
    child.children.forEach(markInline);
  };
  const markContainers = (child) => {
    if (child.type === 'JSXExpressionContainer') { handledContainers.add(child); markDeep(child); }
    else if (child.type === 'JSXElement') child.children.forEach(markContainers);
  };

  const inNoWrapOrTrans = (path) => !!path.findParent((p) => {
    if (!p.isJSXElement()) return false;
    const nm = jsxName(p.node.openingElement.name);
    return NO_WRAP_PARENTS.has(nm) || transLocals.has(nm);
  });

  const processChildren = (path) => {
    const node = path.node;
    const kids = node.children;
    if (!kids.length) return;
    const types = kids.map(classify);
    const parentName = node.type === 'JSXElement' ? jsxName(node.openingElement.name) : '';
    const wrappedRuns = [];
    let i = 0;
    while (i < kids.length) {
      if (types[i] === 'BREAK') { i++; continue; }
      let j = i;
      while (j + 1 < kids.length && types[j + 1] !== 'BREAK') j++;
      const rawEnd = j;
      let a = i;
      let b = j;
      const trimmable = (k) => {
        const c = kids[k];
        const ty = types[k];
        if (ty === 'TEXT') return !/[^ \t\r\n]/.test(code.slice(c.start, c.end));
        if (ty === 'STR') return !/[^ \t\r\n]/.test(c.expression.value);
        if (ty === 'INLINE') return !textsOf(c).some((x) => hasWords(x.text));
        return false;
      };
      while (a <= b && trimmable(a)) a++;
      while (b >= a && trimmable(b)) b--;
      i = j + 1;
      if (a > b) continue;
      const run = [];
      for (let k = a; k <= b; k++) run.push(k);
      const direct = run.filter((k) => types[k] === 'TEXT' || types[k] === 'STR').map((k) => (types[k] === 'TEXT' ? kids[k].value : kids[k].expression.value));
      const deep = run.flatMap((k) => textsOf(kids[k]));
      // A run needs words of its own. A run of nothing but elements is left to
      // the elements, so <div><Button>Save</Button><Button>Cancel</Button></div>
      // is not one message.
      if (!direct.some(hasWords)) continue;
      if (!deep.some((x) => hasWords(x.text) && !x.code)) continue;
      const runText = deep.map((x) => x.text).join('').replace(/\s+/g, ' ').trim();
      if (KEEP_ENGLISH.has(runText)) continue;
      const alsoData = comparedMap.get(runText) ? ['compared', `the same text is compared at ${comparedMap.get(runText)}`] : server.get(runText) ? ['also-on-server', `the same text is quoted at ${server.get(runText)}`] : null;
      if (alsoData) {
        note(alsoData[0], kids[a], alsoData[1]);
        run.forEach((k) => { markInline(kids[k]); markContainers(kids[k]); });
        continue;
      }
      if (STRING_CHILDREN.has(parentName)) {
        note('string-child', kids[a], `<${parentName}> takes a string: use {t\`…\`} by hand`);
        run.forEach((k) => { markInline(kids[k]); markContainers(kids[k]); });
        continue;
      }
      const english = run.find((k) => types[k] === 'ENGLISH');
      if (english !== undefined) {
        note('sentence-split', kids[english], 'text and an expression that holds English in one sentence: write it by hand');
        run.forEach((k) => { markInline(kids[k]); markContainers(kids[k]); });
        continue;
      }
      if (deep.some((x) => /[{}]/.test(x.text))) {
        note('brace', kids[a], 'a brace in the text: write it by hand');
        run.forEach((k) => { markInline(kids[k]); markContainers(kids[k]); });
        continue;
      }
      const first = kids[a];
      const last = kids[b];
      let start = first.start;
      let end = last.end;
      if (types[a] === 'TEXT') { const raw = code.slice(first.start, first.end); start = first.start + raw.search(/[^ \t\r\n]/); }
      if (types[b] === 'TEXT') {
        const raw = code.slice(last.start, last.end);
        let e = raw.length;
        while (e > 0 && WS.test(raw[e - 1])) e--;
        end = last.start + e;
      }
      const countNotes = () => {
        for (const k of run) {
          if (types[k] === 'SIMPLE' && k + 1 <= b && types[k + 1] === 'TEXT' && /^ \p{L}/u.test(kids[k + 1].value) && COUNT_NAME.test(src(kids[k].expression))) {
            note('count', kids[k], 'a number before a noun: needs plural forms');
          }
        }
      };
      const settle = () => { run.forEach((k) => { markInline(kids[k]); markContainers(kids[k]); }); };

      // Text that must be a string: a component that reads its children as text,
      // or an error boundary's fallback, which cannot need the provider. It
      // becomes {t`…`}; a run with elements in it is for a person.
      const asString = STRING_CHILD_COMPONENTS.has(parentName);
      if (asString || boundary) {
        const kind = asString ? 'string-child' : 'no-trans';
        const why = asString ? `<${parentName}> reads its children as text: write {t\`…\`} by hand` : 'an error boundary must not depend on the provider: write {t`…`} by hand';
        if (run.length === 1 && types[a] === 'STR') continue; // rule C wraps the literal in place
        const edgeSpace = (raw) => raw.length > 0 && !/[\r\n]/.test(raw);
        const loose = run.some((k) => types[k] === 'INLINE')
          || (asString && (kids.some((c, k) => (k < a || k > b) && !(types[k] === 'TEXT' && !/[^ \t\r\n]/.test(c.value) && !edgeSpace(c.value)))
            || (types[a] === 'TEXT' && edgeSpace(first.value.match(/^[ \t\r\n]*/)[0]))
            || (types[b] === 'TEXT' && edgeSpace(last.value.match(/[ \t\r\n]*$/)[0]))));
        if (loose) { note(kind, first, why); settle(); continue; }
        if (!path.getFunctionParent()) { note('module-scope', first, 'a t call at module scope would run before the language is chosen'); settle(); continue; }
        if (!tBindingOk(path)) { note('shadowed-t', first, `"${tName}" is something else here`); settle(); continue; }
        const simples = run.filter((k) => types[k] === 'SIMPLE').map((k) => kids[k].expression);
        const names = namesFor(simples);
        let body = '';
        for (const k of run) {
          const c = kids[k];
          if (types[k] === 'TEXT') {
            let v = c.value;
            if (k === a) v = v.replace(/^[ \t\r\n]+/, '');
            if (k === b) v = v.replace(/[ \t\r\n]+$/, '');
            let piece = escapeForTemplate(cleanJsxText(v));
            if (cleanJsxText(v).endsWith("'") && k + 1 <= b && types[k + 1] === 'SIMPLE') piece += "'";
            body += piece;
          } else if (types[k] === 'STR') {
            body += escapeForTemplate(c.expression.value);
          } else {
            const inner = code.slice(c.start + 1, c.end - 1).trim();
            if (names.has(c.expression)) { usedPh = true; body += `\${${phName}({ ${names.get(c.expression)}: ${inner} })}`; } else body += `\${${inner}}`;
          }
        }
        usedT = true;
        edit('jsx-t', start, end, `{${tName}\`${body}\`}`);
        countNotes();
        settle();
        wrappedRuns.push({ rawEnd });
        continue;
      }

      // wrap in <Trans>
      usedTrans = true;
      edit('jsx', start, start, `<${transName}>`);
      edit('jsx', end, end, `</${transName}>`);
      // placeholders that are not plain identifiers get names: {ph({ name: user.name })}
      const simples = [];
      const collect = (c) => {
        if (c.type === 'JSXExpressionContainer' && classify(c) === 'SIMPLE') simples.push(c);
        else if (c.type === 'JSXElement') c.children.forEach(collect);
      };
      run.forEach((k) => collect(kids[k]));
      phEdits('jsx', simples.map((c) => ({ expr: c.expression, open: c.start + 1, close: c.end - 1 })));
      for (const k of run) {
        if (types[k] === 'TEXT') {
          const raw = code.slice(kids[k].start, kids[k].end);
          if (raw.endsWith("'") && k + 1 <= b && types[k + 1] === 'SIMPLE') edit('jsx', kids[k].end, kids[k].end, "'");
        }
      }
      countNotes();
      settle();
      wrappedRuns.push({ rawEnd });
    }
    for (let r = 0; r + 1 < wrappedRuns.length; r++) {
      const at = kids[wrappedRuns[r].rawEnd + 1];
      if (at) note('split-around', at, 'two pieces of one sentence: check that each reads on its own');
    }
  };

  traverse(ast, {
    JSXElement(path) {
      if (consumed.has(path.node) || inNoWrapOrTrans(path)) return;
      const nm = jsxName(path.node.openingElement.name);
      if (NO_WRAP_PARENTS.has(nm) || transLocals.has(nm)) return;
      processChildren(path);
    },
    JSXFragment(path) {
      if (inNoWrapOrTrans(path)) return;
      processChildren(path);
    },

    // ---- B: JSX attributes ----
    JSXAttribute(path) {
      const nm = path.node.name.type === 'JSXIdentifier' ? path.node.name.name : null;
      if (!nm || !isTextProp(nm)) return;
      const v = path.node.value;
      if (!v) return;
      if (v.type === 'StringLiteral') {
        handled.add(v);
        if (!hasWords(v.value) || KEEP_ENGLISH.has(v.value.trim())) return;
        if (blockedText(v)) return;
        if (!path.getFunctionParent()) { note('module-scope', v, 'a t call at module scope would run before the language is chosen'); return; }
        if (!tBindingOk(path)) { note('shadowed-t', v, `"${tName}" is something else here`); return; }
        if (/[{}]/.test(v.value)) { note('brace', v, 'a brace in the text: write it by hand'); return; }
        usedT = true;
        edit('prop', v.start, v.end, `{${tName}\`${escapeForTemplate(v.value)}\`}`);
      } else if (v.type === 'JSXExpressionContainer') {
        wrapLeaves(path.get('value.expression'), 'prop');
      }
    },

    // ---- C: JSX child expressions outside runs ----
    JSXExpressionContainer(path) {
      const parent = path.parent;
      if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') return;
      if (handledContainers.has(path.node)) return;
      if (path.node.expression.type === 'JSXEmptyExpression') return;
      if (inNoWrapOrTrans(path)) return;
      if (parent.type === 'JSXElement' && consumed.has(parent)) return;
      const nm = parent.type === 'JSXElement' ? jsxName(parent.openingElement.name) : '';
      if (NO_WRAP_PARENTS.has(nm) || transLocals.has(nm)) return;
      wrapLeaves(path.get('expression'), 'expr');
    },

    // ---- D: sinks, plus count and locale-format reports ----
    'CallExpression|OptionalCallExpression'(path) {
      const { callee } = path.node;
      const arg0 = path.node.arguments[0];
      let sink = false;
      if (callee.type === 'Identifier' && SINK_IDENTIFIERS.has(callee.name)) sink = true;
      else if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier' && SINK_MEMBERS.has(callee.property.name)) sink = true;
      if (sink) path.get('arguments').forEach((a) => { if (a.isObjectExpression()) sinkObject(a); });

      let native = false;
      if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.object.name === 'window' && callee.property.type === 'Identifier' && NATIVE_NAMES.has(callee.property.name)) native = true;
      else if (callee.type === 'Identifier' && NATIVE_NAMES.has(callee.name) && !path.scope.getBinding(callee.name)) native = true;
      if (native && arg0) wrapLeaves(path.get('arguments.0'), 'sink');

      const calleeName = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' ? callee.property.name : null;
      if (calleeName && /^(plural|countLabel|pluralize)$/.test(calleeName)) {
        const b = callee.type === 'Identifier' ? path.scope.getBinding(callee.name) : null;
        const fromLingui = b && b.path.parent && b.path.parent.source && String(b.path.parent.source.value).startsWith('@lingui/');
        if (!fromLingui) note('count', callee, `${calleeName}(…) builds a plural by hand`);
      }
      if (calleeName && /^toLocale(Date|Time)?String$/.test(calleeName)) note('locale-format', callee, 'formats for a fixed locale: use the active language');
      else if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'Intl') note('locale-format', callee, 'Intl with a fixed locale: use the active language');
    },
    NewExpression(path) {
      const c = path.node.callee;
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Intl') note('locale-format', c, 'Intl with a fixed locale: use the active language');
    },
    ArrayExpression(path) {
      const names = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?)\.?$/i;
      if (path.node.elements.filter((e) => e && e.type === 'StringLiteral' && names.test(e.value)).length >= 3) note('locale-format', path.node, 'month or weekday names: use the active language');
    },

    // ---- E: object properties with STRICT_KEYS, label maps ----
    ObjectProperty(path) {
      const { node } = path;
      if (node.computed || path.parent.type !== 'ObjectExpression') return;
      const key = nameOf(node.key);
      if (!key || !STRICT_KEYS.has(key) || handledProps.has(node)) return;
      if (denied(path)) return;
      const out = [];
      leavesOf(path.get('value'), out);
      const wanted = out.filter((l) => looksUi(literalText(l.node)));
      if (!wanted.length) return;
      if (path.getFunctionParent()) { wanted.forEach((l) => wrapLeaf(l, 'key')); return; }
      if (assigned.has(key)) { note('getter-assign', node, `the file assigns to .${key}: a getter would break it`); wanted.forEach((l) => handled.add(l.node)); return; }
      if (!tBindingOk(path)) { note('shadowed-t', node, `"${tName}" is something else here`); return; }
      if (wanted.some((l) => /[{}]/.test(literalText(l.node)))) { note('brace', node, 'a brace in the text: write it by hand'); wanted.forEach((l) => handled.add(l.node)); return; }
      // Text that is also data, and English nested in a placeholder, stay as they are.
      wanted.forEach((l) => handled.add(l.node));
      const free = wanted.filter((l) => {
        if (blockedText(l.node)) return false;
        if (l.node.type === 'TemplateLiteral' && placeholderBlocks(l.node, l)) return false;
        return true;
      });
      if (!free.length) return;
      // A getter runs when the table is read: not while the module loads.
      const readAtLoad = getterReadAtLoad(path);
      if (readAtLoad) { note('getter-read-at-load', node, readAtLoad); return; }
      const valueStart = node.value.extra && node.value.extra.parenthesized ? node.value.extra.parenStart : node.value.start;
      const keyText = src(node.key);
      usedT = true;
      edit('getter', node.start, valueStart, `get ${keyText}() { return `);
      free.forEach((l) => wrapLeaf(l, 'getter', { getter: true }));
      edit('getter', node.end, node.end, '; }');
    },
    ClassProperty(path) {
      const key = !path.node.computed ? nameOf(path.node.key) : null;
      if (!key || !STRICT_KEYS.has(key) || !path.node.value) return;
      const out = [];
      leavesOf(path.get('value'), out);
      if (out.some((l) => looksUi(literalText(l.node)))) { note('class-field', path.node, `${key}: a class field cannot be a getter: make it one by hand`); out.forEach((l) => handled.add(l.node)); }
    },
    ObjectExpression(path) {
      if (path.getFunctionParent() || denied(path)) return;
      const attr = path.findParent((p) => p.isJSXAttribute());
      if (attr) return;
      const props = path.node.properties.filter((p) => p.type === 'ObjectProperty' && !p.computed && nameOf(p.key) && !STRICT_KEYS.has(nameOf(p.key)) && isStringish(p.value) && looksUi(literalText(p.value) || ''));
      if (props.length >= 2) {
        note('label-map', path.node, 'a table of labels at module scope: make each label a getter by hand');
        props.forEach((p) => handled.add(p.value));
      }
    },

    // ---- F: conditional counts and everything else that looks like text ----
    ConditionalExpression(path) {
      if (isCountCond(path.node)) note('count', path.node, 'a singular and a plural written by hand: needs plural forms');
    },
    'StringLiteral|TemplateLiteral'(path) {
      const n = path.node;
      if (handled.has(n)) return;
      const text = literalText(n);
      if (text == null || !looksUi(text) || KEEP_ENGLISH.has(text.trim())) return;
      const parent = path.parent;
      if (/^(Import|ExportNamed|ExportAll)Declaration$|^ImportAttribute$/.test(parent.type)) return;
      if (parent.type === 'TaggedTemplateExpression' || path.findParent((p) => p.isTaggedTemplateExpression() && !p.getFunctionParent())) return;
      if ((parent.type === 'ObjectProperty' || parent.type === 'ClassProperty' || parent.type === 'ObjectMethod') && parent.key === n && !parent.computed) return;
      if (parent.type === 'MemberExpression' && parent.property === n) return;
      if (denied(path)) return;
      // A literal that is the whole value of a JSX attribute, or an arm of one,
      // is that attribute's business (className, href, …) unless it is a text prop.
      let up = path;
      while (up.parentPath && /^(ConditionalExpression|LogicalExpression|JSXExpressionContainer|TemplateLiteral)$/.test(up.parentPath.type)) up = up.parentPath;
      if (up.parentPath && up.parentPath.isJSXAttribute()) return;
      if (path.findParent((p) => p.isJSXAttribute() && p.node.name.type === 'JSXIdentifier' && p.node.name.name === 'style')) return;
      if (path.findParent((p) => p.isJSXElement() && transLocals.has(jsxName(p.node.openingElement.name)))) return;
      if (parent.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) { note('compared', n, 'a string used as a key'); return; }
      if (parent.type === 'SwitchCase' && parent.test === n) { note('compared', n, 'a string used as a key'); return; }
      const inError = path.findParent((p) => p.isFunction() || (p.isNewExpression() && p.node.callee.type === 'Identifier' && /Error$/.test(p.node.callee.name)) || p.isThrowStatement());
      if (inError && !inError.isFunction()) { note('error-text', n, 'an error message: wrap it where it is shown, or leave it for logs'); return; }
      const hint = contextOf(path);
      if (/^(class|classes|cls|css|style|selector|regex|pattern|mime|accept|url|href|src|path|font|color|animation|transition|transform|grid|display)/i.test(hint.replace(/^[^a-zA-Z]*/, ''))) return;
      note('ui-literal', n, hint);
    },
  });

  // F2: why a would-be getter in this module-level table must stay English, or
  // null. A getter runs when its table is read, so a table read while the module
  // loads (passed to a call, spread, mapped, destructured, a key read from it,
  // here or in a file that imports it) would run it before the language is set.
  function getterReadAtLoad(path) {
    const program = path.findParent((p) => p.isProgram());
    const stmt = path.findParent((p) => p.parentPath && p.parentPath.isProgram());
    if (!stmt) return null;
    for (let p = path; p !== stmt; p = p.parentPath) {
      const parent = p.parentPath;
      if (CALL_TYPES.test(parent.node.type) && p.listKey === 'arguments') {
        const label = calleeLabel(parent.node);
        if (!SAFE_MODULE_CALLS.has(label)) return `passed to ${label}() at load`;
      }
    }
    const decl = path.findParent((p) => p.isVariableDeclarator());
    if (!decl || decl.scope !== program.scope) return null;
    if (decl.node.id.type !== 'Identifier') return 'destructured at load';
    if (!verdicts.has(decl.node)) {
      const name = decl.node.id.name;
      const keys = getterKeysIn(decl.node.init);
      let why = loadReadReason(program, name, keys);
      if (!why && crossRead) {
        const names = exportedAs(program.node, name);
        if (names.size) why = crossRead(names, keys);
      }
      verdicts.set(decl.node, why ? `${name} is read at load: ${why}` : null);
    }
    return verdicts.get(decl.node);
  }

  function sinkObject(objPath) {
    for (const prop of objPath.get('properties')) {
      if (!prop.isObjectProperty() || prop.node.computed) continue;
      const key = nameOf(prop.node.key);
      if (!key) continue;
      if (SINK_KEYS.has(key)) { handledProps.add(prop.node); wrapLeaves(prop.get('value'), 'sink'); }
      else if (SINK_NESTED.has(key)) {
        const v = prop.get('value');
        if (key === 'action' && v.isObjectExpression()) sinkObject(v);
        if (key === 'actions' && v.isArrayExpression()) v.get('elements').forEach((el) => { if (el.node && el.isObjectExpression()) sinkObject(el); });
      }
    }
  }

  // Imports for what the edits used.
  const needCore = [];
  if (usedT && !existingT) needCore.push(tName === 't' ? 't' : `t as ${tName}`);
  if (usedPh && !existingPh) needCore.push(phName === 'ph' ? 'ph' : `ph as ${phName}`);
  const needTrans = usedTrans && !existingTrans;
  if (needCore.length || needTrans) {
    const specTrans = transName === 'Trans' ? 'Trans' : `Trans as ${transName}`;
    const fresh = [];
    const addTo = (decl, specs) => {
      const named = decl.specifiers.filter((s) => s.type === 'ImportSpecifier');
      const lastSpec = named[named.length - 1];
      edit('import', lastSpec.end, lastSpec.end, specs.map((x) => `, ${x}`).join(''));
    };
    if (needCore.length) { if (coreImport) addTo(coreImport, needCore); else fresh.push(`import { ${needCore.join(', ')} } from '${CORE}';`); }
    if (needTrans) { if (reactImport) addTo(reactImport, [specTrans]); else fresh.push(`import { ${specTrans} } from '${REACT}';`); }
    if (fresh.length) {
      if (lastImport) edit('import', lastImport.end, lastImport.end, `\n${fresh.join('\n')}`);
      else if (ast.program.directives.length) {
        const d = ast.program.directives[ast.program.directives.length - 1];
        edit('import', d.end, d.end, `\n${fresh.join('\n')}`);
      } else if (ast.program.body.length) edit('import', ast.program.body[0].start, ast.program.body[0].start, `${fresh.join('\n')}\n`);
    }
  }

  return { code: edits.length ? applyEdits(code, edits) : code, edits, report };

  function contextOf(path) {
    let p = path;
    while (p.parentPath && /^(ConditionalExpression|LogicalExpression|TemplateLiteral)$/.test(p.parentPath.type) && !(p.parentPath.isConditionalExpression() && p.key === 'test')) p = p.parentPath;
    const parent = p.parentPath;
    if (!parent) return '';
    switch (parent.type) {
      case 'CallExpression': case 'OptionalCallExpression': case 'NewExpression': {
        const c = parent.node.callee;
        const nm = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' ? c.property.name : 'call';
        return `${parent.type === 'NewExpression' ? 'new ' : ''}${nm}(…)`;
      }
      case 'ReturnStatement': case 'ArrowFunctionExpression': return 'return';
      case 'VariableDeclarator': return nameOf(parent.node.id) || (parent.node.id.type === 'Identifier' ? parent.node.id.name : 'variable');
      case 'ObjectProperty': return nameOf(parent.node.key) || 'property';
      case 'AssignmentExpression': return 'assign';
      case 'ArrayExpression': return 'array';
      case 'JSXExpressionContainer': return 'jsx expression';
      default: return parent.type;
    }
  }
}
const handledProps = new WeakSet();

// ---- CLI ----

function stringsIn(code) {
  let ast;
  try { ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] }); } catch (_) { return 0; }
  let n = 0;
  const go = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (/^(Import|ExportNamed|ExportAll)Declaration$/.test(node.type)) return;
    if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
      const t = literalText(node);
      if (t != null && looksUi(t) && !(parent && parent.type === 'TaggedTemplateExpression')) n++;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => go(c, node));
      else if (v && typeof v.type === 'string') go(v, node);
    }
  };
  go(ast.program, null);
  return n;
}

function cli(argv) {
  const opts = { write: false, json: null, md: null, ratchet: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') opts.write = true;
    else if (a === '--ratchet') opts.ratchet = true;
    else if (a === '--json' || a === '--md') {
      // The report path, never a source file: a missing path would take the
      // next file name and write the report over that file.
      const out = argv[++i];
      if (!out || !(a === '--json' ? /\.json$/ : /\.md$/).test(out)) {
        throw new Error(`${a} needs a report path ending in ${a === '--json' ? '.json' : '.md'} (got ${out ?? 'nothing'})`);
      }
      opts[a.slice(2)] = out;
    }
    else opts.paths.push(a);
  }
  return opts;
}

async function main() {
  const opts = cli(process.argv.slice(2));
  let files = appFiles();
  if (opts.paths.length) {
    const wanted = opts.paths.map((p) => resolve(BOARDS, p));
    files = files.filter((f) => wanted.some((w) => f === w || f.startsWith(w + sep)));
  }

  if (opts.ratchet) {
    const { coverageViolations } = await import('./i18nCoverage.mjs');
    const bad = files.filter((f) => coverageViolations(readFileSync(f, 'utf8'), f).length > 0).map(rel).sort();
    process.stdout.write(`${JSON.stringify(bad, null, 2)}\n`);
    return;
  }

  // What the wrap needs to see beyond one file: text compared or quoted as data,
  // and who reads a getter table while loading. Built over the whole app plus
  // the src files the Worker side shares, whatever `paths` selects.
  const sharedSrc = workerShared().filter((f) => f.startsWith(SRC + sep));
  const universe = [...appFiles(), ...sharedSrc];
  const compared = buildComparedSet(universe);
  const server = buildServerTexts();
  const cross = makeCrossReader(universe);

  const result = [];
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const out = wrapSource(code, { filename: rel(file), compared, server, crossRead: (names, keys) => cross(file, names, keys) });
    const editCounts = {};
    for (const e of out.edits) if (e.kind !== 'import') editCounts[e.kind] = (editCounts[e.kind] || 0) + 1;
    if (opts.write && out.edits.length) writeFileSync(file, out.code);
    result.push({ file: rel(file), edits: editCounts, report: out.report });
  }

  const sum = (objs) => objs.reduce((acc, o) => { for (const [k, v] of Object.entries(o)) acc[k] = (acc[k] || 0) + v; return acc; }, {});
  const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const reportCounts = (r) => { const c = {}; for (const x of r.report) c[x.kind] = (c[x.kind] || 0) + 1; return c; };
  for (const r of result) {
    const rc = reportCounts(r);
    if (!Object.keys(r.edits).length && !Object.keys(rc).length) continue;
    console.log(`${r.file}  edits: ${fmt(r.edits) || 'none'}  report: ${fmt(rc) || 'none'}`);
  }
  const totalEdits = sum(result.map((r) => r.edits));
  const totalReports = sum(result.map(reportCounts));
  const editTotal = (r) => Object.values(r.edits).reduce((a, b) => a + b, 0);
  console.log(`\nfiles: ${result.length}, with edits: ${result.filter((r) => editTotal(r)).length}`);
  console.log(`edits: ${fmt(totalEdits) || 'none'} (total ${Object.values(totalEdits).reduce((a, b) => a + b, 0)})`);
  console.log(`reports: ${fmt(totalReports) || 'none'} (total ${Object.values(totalReports).reduce((a, b) => a + b, 0)})`);
  console.log('\nmost edits:');
  for (const r of [...result].sort((a, b) => editTotal(b) - editTotal(a)).slice(0, 15)) console.log(`  ${String(editTotal(r)).padStart(5)}  ${r.file}`);

  const shared = [];
  for (const f of sharedSrc) {
    const n = stringsIn(readFileSync(f, 'utf8'));
    if (n) shared.push({ file: rel(f), strings: n });
  }
  shared.sort((x, y) => y.strings - x.strings || x.file.localeCompare(y.file));
  console.log(`\nshared src files (run without the macro transform) holding UI-looking strings, never edited: ${shared.length} of ${sharedSrc.length}`);
  for (const x of shared.slice(0, 15)) console.log(`  ${String(x.strings).padStart(5)}  ${x.file}`);
  const breakdown = workerSharedBreakdown();
  console.log('\nsrc files each root group adds to the shared set (group: roots, src reached, added):');
  for (const [g, v] of Object.entries(breakdown)) console.log(`  ${g}: ${v.roots} roots, ${v.src} src, +${v.added}${v.jsx.length ? `, jsx: ${v.jsx.join(' ')}` : ''}`);

  if (opts.json) writeFileSync(opts.json, `${JSON.stringify({ files: result, workerShared: shared, breakdown }, null, 2)}\n`);
  if (opts.md) {
    const lines = ['# i18n wrap report', ''];
    for (const r of result) {
      if (!r.report.length) continue;
      lines.push(`## ${r.file}`, '');
      for (const x of r.report) lines.push(`L${x.line} ${x.kind}: ${x.text} — ${x.hint}`);
      lines.push('');
    }
    lines.push('## worker-shared (not edited)', '');
    for (const s of shared) lines.push(`${s.file}: ${s.strings} strings`);
    writeFileSync(opts.md, `${lines.join('\n')}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
