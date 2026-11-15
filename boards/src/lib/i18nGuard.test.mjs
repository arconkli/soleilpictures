// Four ways the translation setup breaks without a build noticing, each a
// static scan of the source with @babel/parser (as imeGuard.test.mjs does):
//   (a) t, plural, select or selectOrdinal run at module scope. They read the
//       active language when they run, and a module runs before the language is
//       chosen (lib/i18nBoot.js), so the text would be English for good.
//       msg and defineMessage are made for module scope and are allowed there.
//   (b) a Lingui macro in a .ts or .tsx file. The transform only parses JS and
//       JSX (scripts/linguiTransform.mjs).
//   (c) Lingui reachable from the Worker, the docs generator, the Party worker
//       or the MCP server, none of which run the transform, and the Worker's
//       size is held down.
//   (d) a Lingui `context` that is not a string literal. The macro accepts any
//       expression and builds the message id from the message alone, so the
//       context is lost and both meanings of the word get one translation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const BOARDS = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(BOARDS, 'src');
const RUNS_NOW = new Set(['t', 'plural', 'select', 'selectOrdinal']);
const MACRO = /^@lingui\/(core|react)\/macro$/;

const parseSource = (source, ts = false) => parse(source, { sourceType: 'module', plugins: ts ? ['jsx', 'typescript'] : ['jsx'] });

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

// Where `source` calls a run-now macro outside every function.
export function moduleScopeMacroCalls(source) {
  const ast = parseSource(source);
  const local = new Map();
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value === '@lingui/core/macro') {
      for (const s of node.specifiers) {
        if (s.type === 'ImportSpecifier' && RUNS_NOW.has(s.imported.name)) local.set(s.local.name, s.imported.name);
      }
    }
  }
  const found = [];
  if (!local.size) return found;
  const check = (path, callee) => {
    if (callee.type !== 'Identifier' || !local.has(callee.name)) return;
    const binding = path.scope.getBinding(callee.name);
    if (!binding || binding.kind !== 'module') return;
    if (path.getFunctionParent()) return;
    found.push(`${local.get(callee.name)} at line ${path.node.loc.start.line}`);
  };
  traverse(ast, {
    CallExpression(path) { check(path, path.node.callee); },
    TaggedTemplateExpression(path) { check(path, path.node.tag); },
  });
  return found;
}

test('the module-scope check flags t, plural and a tagged template, and lets msg and functions be', () => {
  const bad = `
import { t, plural as p, msg } from '@lingui/core/macro';
export const A = t\`Save\`;
export const B = p(2, { one: '#', other: '#s' });
export const C = msg\`Fine here\`;
export const f = () => t\`Fine in a function\`;
class K { static label = t\`Static\`; }
`;
  assert.deepEqual(moduleScopeMacroCalls(bad).map((s) => s.split(' ')[0]), ['t', 'plural', 't']);
  const good = `import { t } from '@lingui/core/macro';\nexport function f() { const t = (x) => x; return t('a'); }\nexport const g = () => t\`x\`;`;
  assert.deepEqual(moduleScopeMacroCalls(good), []);
});

test('no source file runs t, plural, select or selectOrdinal at module scope', () => {
  const files = walk(SRC, (p) => /\.(jsx?|mjs)$/.test(p) && !/\.test\.mjs$/.test(p) && !p.startsWith(join(SRC, 'locales') + sep));
  const bad = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('@lingui/core/macro')) continue;
    for (const hit of moduleScopeMacroCalls(source)) bad.push(`${relative(BOARDS, file)}: ${hit}`);
  }
  assert.deepEqual(bad, [], 'Use msg`…` at module scope and translate it where it is shown (i18n._(descriptor)), or move the call into a function.');
});

// Every `context` a Lingui macro call or element is given in `source`, as
// { line, literal }. Counts calls of an import from a Lingui macro package (any
// imported name or alias) or of a name destructured from its useLingui(), whose
// first argument is an object with a `context` property, and JSX elements bound
// to such an import with a `context` attribute.
function contextSites(source) {
  const ast = parseSource(source);
  const macroBindings = new Set();
  const useLinguiNames = [];
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration' || !MACRO.test(node.source.value)) continue;
    for (const s of node.specifiers) {
      macroBindings.add(s.local.name);
      if (s.type === 'ImportSpecifier' && s.imported.name === 'useLingui') useLinguiNames.push(s.local.name);
    }
  }
  const sites = [];
  if (!macroBindings.size) return sites;
  const isLiteral = (n) => n && (n.type === 'StringLiteral' || (n.type === 'TemplateLiteral' && n.expressions.length === 0));
  const bound = new Set();
  const isLingui = (path, name) => {
    const b = path.scope.getBinding(name);
    return !!b && (b.kind === 'module' ? macroBindings.has(name) : bound.has(b.identifier));
  };
  traverse(ast, {
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (id.type !== 'ObjectPattern' || init?.type !== 'CallExpression' || init.callee.type !== 'Identifier') return;
      if (!useLinguiNames.includes(init.callee.name) || !isLingui(path, init.callee.name)) return;
      for (const prop of id.properties) {
        const v = prop.type === 'ObjectProperty' && prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
        if (v?.type === 'Identifier') bound.add(v);
      }
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (callee.type !== 'Identifier' || !isLingui(path, callee.name) || args[0]?.type !== 'ObjectExpression') return;
      for (const prop of args[0].properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
        if (key === 'context') sites.push({ line: prop.loc.start.line, literal: !!isLiteral(prop.value) });
      }
    },
    JSXOpeningElement(path) {
      const { name, attributes } = path.node;
      if (name.type !== 'JSXIdentifier' || !isLingui(path, name.name)) return;
      for (const attr of attributes) {
        if (attr.type !== 'JSXAttribute' || attr.name.name !== 'context') continue;
        const v = attr.value;
        sites.push({ line: attr.loc.start.line, literal: isLiteral(v) || (v?.type === 'JSXExpressionContainer' && !!isLiteral(v.expression)) });
      }
    },
  });
  return sites;
}

// Lines where `source` gives a Lingui message a context that is not a string literal.
export function nonLiteralContexts(source) {
  return contextSites(source).filter((s) => !s.literal).map((s) => s.line);
}

test('the context check flags a variable context and lets literals be', () => {
  const bad = `
import { t, t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
export const a = () => t({ message: 'View', context: ctx });
export const b = () => tr({ message: 'View', context: someVar });
export const c = () => <Trans context={ctx}>View</Trans>;
`;
  assert.deepEqual(nonLiteralContexts(bad), [4, 5, 6]);
  const viaHook = `import { useLingui } from '@lingui/react/macro';\\nexport function F() { const { t } = useLingui(); return t({ message: 'View', context: ctx }); }`.replace(/\\n/g, '\n');
  assert.deepEqual(nonLiteralContexts(viaHook), [2]);
  const good = `
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
export const a = () => t({ message: 'View', context: 'noun' });
export const b = () => t({ message: 'View', context: \`noun\` });
export const c = () => <Trans context="noun">View</Trans>;
export const d = () => <Trans context={'noun'}>View</Trans>;
`;
  assert.deepEqual(nonLiteralContexts(good), []);
  assert.equal(contextSites(good).length, 4);
  assert.deepEqual(nonLiteralContexts(`log({ message: 'x', context: ctx });`), []);
});

test('every Lingui context is a string literal', () => {
  const files = walk(SRC, (p) => /\.(jsx?|mjs)$/.test(p) && !/\.test\.mjs$/.test(p) && !p.startsWith(join(SRC, 'locales') + sep));
  const bad = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!/@lingui\/(core|react)\/macro/.test(source)) continue;
    for (const line of nonLiteralContexts(source)) bad.push(`${relative(BOARDS, file)}:${line}`);
  }
  assert.deepEqual(bad, [], 'The macro builds the message id from the message alone and drops a context that is not a string literal. Write the context as a literal.');
});

test('no .ts or .tsx file uses a Lingui macro', () => {
  const bad = [];
  for (const file of walk(SRC, (p) => /\.tsx?$/.test(p))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('@lingui/')) continue;
    for (const node of parseSource(source, true).program.body) {
      if (node.type === 'ImportDeclaration' && MACRO.test(node.source.value)) bad.push(relative(BOARDS, file));
    }
  }
  assert.deepEqual(bad, []);
});

// Files a relative static import (or export … from) reaches, from `entry`, and
// the Lingui imports found on the way, as "file → specifier".
function lingui(entry) {
  const seen = new Set();
  const hits = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let ast;
    try { ast = parseSource(readFileSync(file, 'utf8'), /\.tsx?$/.test(file)); } catch (_) { continue; }
    for (const node of ast.program.body) {
      const from = node.source?.value;
      if (!from || !/^(Import|ExportNamed|ExportAll)Declaration$/.test(node.type)) continue;
      if (from.startsWith('@lingui/')) { hits.push(`${relative(BOARDS, file)} → ${from}`); continue; }
      if (!from.startsWith('.')) continue;
      const base = resolve(dirname(file), from);
      const next = [base, ...['.js', '.mjs', '.jsx', '.ts', '.tsx'].map((e) => base + e), ...['.js', '.ts'].map((e) => join(base, 'index' + e))]
        .find((f) => existsSync(f) && statSync(f).isFile());
      if (next) stack.push(next);
    }
  }
  return hits;
}

test('Lingui is not reachable from the Worker, the docs generator, the Party worker or the MCP server', () => {
  const roots = [
    join(SRC, 'worker.js'),
    join(BOARDS, 'scripts/gen-docs.mjs'),
    ...walk(join(BOARDS, 'party'), (p) => /\.(jsx?|mjs|tsx?)$/.test(p)),
    ...walk(join(BOARDS, '../mcp/src'), (p) => /\.(jsx?|mjs|tsx?)$/.test(p)),
  ];
  assert.ok(roots.length > 3, 'found the roots');
  const bad = [...new Set(roots.flatMap(lingui))];
  assert.deepEqual(bad, []);
});

// <Trans> throws outside an I18nProvider, so a file that starts a React root has
// to mount one. A text check is enough: today main.jsx and TeamDomainNote.jsx.
test('every app file that starts a React root mounts an I18nProvider', async () => {
  const { appFiles } = await import('../../scripts/i18nScope.mjs');
  const bad = appFiles()
    .filter((f) => { const s = readFileSync(f, 'utf8'); return /\b(createRoot|hydrateRoot)\(/.test(s) && !s.includes('I18nProvider'); })
    .map((f) => relative(BOARDS, f));
  assert.deepEqual(bad, [], 'Wrap the root in <I18nProvider i18n={i18n}> (see src/main.jsx).');
});
