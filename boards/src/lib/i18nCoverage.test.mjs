// The guard that keeps the translated app translated. Every file the app reaches
// from src/main.jsx (scripts/i18nScope.mjs: not the admin console, the dev
// harnesses or the English-only public pages) must have its English in Lingui
// macros: no JSX text outside <Trans>, no text prop, JSX child expression, toast
// or native dialog that is a plain string. The files not yet covered are listed
// in src/lib/i18nRatchet.json; the list only shrinks. Wrapping a file is
// `npm run i18n:wrap -- <file> --write`, then reading its report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { coverageViolations, childrenTextReads } from '../../scripts/i18nCoverage.mjs';
import { appFiles, LOADER_SCRIPTS, workerShared, workerRoots, viteServedTests, rel, BOARDS, SRC, isStop, STRING_CHILD_COMPONENTS } from '../../scripts/i18nScope.mjs';

const RATCHET = JSON.parse(readFileSync(fileURLToPath(new URL('./i18nRatchet.json', import.meta.url)), 'utf8'));

const kinds = (code) => coverageViolations(code, 'x.jsx').map((v) => v.kind);
const MACROS = "import { t } from '@lingui/core/macro';\nimport { Trans } from '@lingui/react/macro';\n";

test('the checker flags each kind of English, and not its wrapped form', () => {
  const cases = [
    ['jsx-text', 'export const C = () => <p>Hello there</p>;', `${MACROS}export const C = () => <p><Trans>Hello there</Trans></p>;`],
    ['prop', 'export const C = () => <input placeholder="Search" />;', `${MACROS}export const C = () => <input placeholder={t\`Search\`} />;`],
    ['prop', "export const C = ({ a }) => <input title={a ? 'On' : 'Off'} />;", `${MACROS}export const C = ({ a }) => <input title={a ? t\`On\` : t\`Off\`} />;`],
    ['jsx-expr', "export const C = ({ a }) => <p>{a ? 'On' : 'Off'}</p>;", `${MACROS}export const C = ({ a }) => <p>{a ? t\`On\` : t\`Off\`}</p>;`],
    ['sink', "export const f = (feedback) => feedback.toast({ message: 'Copied', action: { label: 'Undo' } });", `${MACROS}export const f = (feedback) => feedback.toast({ message: t\`Copied\`, action: { label: t\`Undo\` } });`],
    ['sink', "export const f = () => window.confirm('Delete it?');", `${MACROS}export const f = () => window.confirm(t\`Delete it?\`);`],
    ['nested', `${MACROS}export const C = ({ a }) => <p><Trans>Hi <b>{a ? 'new' : 'old'}</b></Trans></p>;`, `${MACROS}export const C = ({ a }) => <p><Trans>Hi <b>{a}</b></Trans></p>;`],
    ['nested', `${MACROS}export const f = (a) => t\`Hi \${a ? 'new' : 'old'}\`;`, `${MACROS}export const f = (a) => t\`Hi \${a}\`;`],
    ['shadowed-t', "import { t } from '@lingui/core/macro';\nexport const C = (items) => items.map((t) => t`x`);", "import { t } from '@lingui/core/macro';\nexport const C = (items) => items.map((i) => t`Fine`);"],
  ];
  for (const [kind, bad, good] of cases) {
    assert.ok(kinds(bad).includes(kind), `${kind} is flagged in: ${bad}`);
    assert.deepEqual(kinds(good), [], `the wrapped form is clean: ${good}`);
  }
});

test('11c: the checker reads every object argument of a sink, camelCase text props, count ternaries and macro plurals', () => {
  const PL = "import { t, plural } from '@lingui/core/macro';\n";
  const cases = [
    // F-a: the sink's object is not always the first argument
    ['sink', "export const f = (feedback) => undoToast(feedback, { message: 'Card deleted' });", `${MACROS}export const f = (feedback) => undoToast(feedback, { message: t\`Card deleted\` });`],
    // F-b: camelCase text props, and ids and keyboard hints that are not text
    ['prop', 'export const C = () => <Page backLabel="Back" />;', `${MACROS}export const C = () => <Page backLabel={t\`Back\`} />;`],
    ['prop', "export const C = ({ a }) => <Page emptyTitle={a ? 'Loading' : 'Nothing here'} />;", `${MACROS}export const C = ({ a }) => <Page emptyTitle={a ? t\`Loading\` : t\`Nothing here\`} />;`],
    // F-c: a hand-made singular and plural inside a message is never translated
    ['nested', `${MACROS}export const f = (n) => t\`\${n} \${n === 1 ? 'file' : 'files'} moved\`;`, `${MACROS}export const f = (n) => n === 1 ? t\`1 file moved\` : t\`\${n} files moved\`;`],
    ['nested', `${MACROS}export const C = ({ n }) => <p><Trans>{n} {n === 1 ? 'file' : 'files'} moved</Trans></p>;`, `${MACROS}export const C = ({ n }) => <p><Trans>{n} files moved</Trans></p>;`],
    // G: a macro plural is one message; English in its placeholders is not
    ['nested', `${PL}export const f = (n, a) => t\`\${plural(n, { one: \`# \${a ? 'apple' : 'pear'}\`, other: '#' })}\`;`, `${PL}export const f = (n, a) => t\`\${plural(n, { one: '# apple', other: '# apples' })} in \${a}\`;`],
    ['nested', `${MACROS}const plural = (n, a, b) => (n === 1 ? a : b);\nexport const f = (n) => t\`\${plural(n, { one: '# file', other: '# files' })}\`;`, `${PL}export const f = (n) => t\`\${plural(n, { one: '# file', other: '# files' })}\`;`],
  ];
  for (const [kind, bad, good] of cases) {
    assert.ok(kinds(bad).includes(kind), `${kind} is flagged in: ${bad}`);
    assert.deepEqual(kinds(good), [], `the right form is clean: ${good}`);
  }
  for (const ok of [
    'export const C = () => <Page ariaLabelledBy="x" titleId="x" enterKeyHint="go" />;',
    `${MACROS}export const f = (feedback) => feedback.toast({ message: t\`Saved\` }, { id: 'x' });`,
    `${PL}export const f = (placed, nClusters) => t\`\${plural(placed, { one: '# file', other: '# files' })} in \${plural(nClusters, { one: '# cluster', other: '# clusters' })}\`;`,
  ]) assert.deepEqual(kinds(ok), [], ok);
});

test('the checker lets brand names, code, punctuation and non-text through', () => {
  const ok = [
    'export const C = () => <span>Soleil Clusters</span>;',
    'export const C = () => <pre>npm install</pre>;',
    'export const C = () => <span>{1}-{2}</span>;',
    "export const C = ({ x }) => <a className=\"a b\" href=\"/x\" title={x}>{x}</a>;",
    "export const f = (n) => logEvent('x', { label: 'Sidebar' });",
  ];
  for (const code of ok) assert.deepEqual(kinds(code), [], code);
});

test('the scope is the signed-in app: no admin console, no dev harness, no English-only public page', () => {
  const files = appFiles().map(rel);
  assert.ok(files.length > 200, `found the app (${files.length} files)`);
  assert.ok(files.includes('src/main.jsx'));
  assert.ok(files.includes('src/App.jsx'));
  for (const f of files) {
    assert.ok(!f.startsWith('src/local/') && !f.startsWith('src/pages/admin/') && !f.startsWith('src/locales/') && !/\.test\.mjs$/.test(f), f);
    assert.ok(!isStop(join(BOARDS, f)), f);
  }
  for (const stopped of ['src/pages/AdminPage.jsx', 'src/pages/DocsPage.jsx', 'src/components/PublicBoardView.jsx']) assert.ok(!files.includes(stopped), stopped);
});

test('what a consumer without the macro transform runs is shared, never wrapped, and not in the app', () => {
  const shared = new Set(workerShared());
  const roots = workerRoots();
  assert.ok(shared.size > 500, `found the shared side (${shared.size} files)`);
  for (const group of ['worker', 'scripts', 'party', 'mcp', 'scout', 'tests']) assert.ok(roots[group].length > 0, `${group} has roots`);
  for (const f of appFiles()) assert.ok(!shared.has(f), `${rel(f)} is in the app and also run without the macro transform`);
  assert.ok(shared.has(join(SRC, 'worker.js')));
  assert.ok(!appFiles().includes(join(SRC, 'data.js')), 'src/data.js only gives names, it is out of scope');
  // A test helper that imports JSX is served by Vite, where the macro runs.
  for (const f of viteServedTests()) assert.ok(!roots.tests.includes(f), rel(f));
});

test('no src file run without the macro transform imports a Lingui macro', () => {
  // Running a macro untransformed throws: the Worker, the Party worker, the
  // docs generator, the Scout bot and Playwright's own node all run source as it is.
  const bad = [];
  for (const f of workerShared().filter((x) => x.startsWith(SRC))) {
    let ast;
    try { ast = parse(readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] }); } catch (_) { continue; }
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration' && /^@lingui\/(core|react)\/macro$/.test(node.source.value)) bad.push(`${rel(f)} imports ${node.source.value}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every root of the React tree is inside the provider', () => {
  // A root of its own (a toast, a corner note) has no I18nProvider above it, and
  // <Trans> throws without one.
  const bad = [];
  for (const f of appFiles()) {
    const code = readFileSync(f, 'utf8');
    if (!/\b(createRoot|hydrateRoot)\(/.test(code)) continue;
    if (rel(f) === 'src/main.jsx' || /\bI18nProvider\b/.test(code)) continue;
    bad.push(rel(f));
  }
  assert.deepEqual(bad, [], 'wrap its render in <I18nProvider i18n={i18n}> (see src/components/team/TeamDomainNote.jsx)');
});

// `children` that are not React children.
const CHILDREN_ALLOWED = {
  'src/components/CanvasSurface.jsx#latticeOf': "a layout tree node's children array",
  'src/components/cards.jsx#BoardCard': 'the boards under a board, not React children',
  'src/lib/editorSelection.js#wrapInList': 'DOM children of a list item',
  'src/lib/editorSelection.js#unwrapList': 'DOM children of a list item',
  'src/lib/folderPlan.js#planNode': "a folder plan's child nodes",
  'src/lib/folderPlan.js#slicePlan': "a folder plan's child nodes",
};

test('a component that reads its children as text is one the wrap knows', () => {
  // <Trans> makes children an element, so a component that reads children as
  // text needs {t`...`} (STRING_CHILD_COMPONENTS in scripts/i18nScope.mjs). A new
  // reader goes in that list or, with a reason, in CHILDREN_ALLOWED above.
  const bad = [];
  for (const f of appFiles()) {
    for (const h of childrenTextReads(readFileSync(f, 'utf8'))) {
      if (STRING_CHILD_COMPONENTS.has(h.name) || CHILDREN_ALLOWED[`${rel(f)}#${h.name}`]) continue;
      bad.push(`${rel(f)}:${h.line} ${h.name} ${h.how}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(childrenTextReads('export const MenuHead = ({ children }) => (typeof children === "string" ? children.toLowerCase() : "");').length >= 1, 'the scan finds the real pattern');
  assert.equal(childrenTextReads('export const X = ({ children }) => <div>{children}</div>;').length, 0);
});

test('every translated app file stays covered', () => {
  const ratchet = new Set(RATCHET);
  const bad = [];
  for (const file of appFiles()) {
    if (ratchet.has(rel(file))) continue;
    for (const v of coverageViolations(readFileSync(file, 'utf8'), file)) bad.push(`${rel(file)}:${v.line} ${v.kind} ${v.text}`);
  }
  assert.deepEqual(bad, [], `English outside the macros. Wrap it: npm run i18n:wrap -- <file> --write, then check the report.`);
});

test('the ratchet only shrinks', () => {
  const app = new Set(appFiles().map(rel));
  const stale = [];
  for (const entry of RATCHET) {
    const abs = join(BOARDS, entry);
    if (!existsSync(abs)) { stale.push(`${entry} is gone: remove ${entry} from src/lib/i18nRatchet.json`); continue; }
    if (!app.has(entry)) { stale.push(`${entry} is not in the translated app: remove ${entry} from src/lib/i18nRatchet.json`); continue; }
    if (coverageViolations(readFileSync(abs, 'utf8'), abs).length === 0) stale.push(`${entry} is covered now: remove ${entry} from src/lib/i18nRatchet.json`);
  }
  assert.deepEqual(stale, []);
  assert.deepEqual([...RATCHET], [...RATCHET].sort(), 'keep the list sorted');
});

test('every hand-run script that reaches wrapped app modules is run under the Lingui loader', () => {
  for (const f of LOADER_SCRIPTS) {
    const head = readFileSync(join(BOARDS, f), 'utf8').split('\n').slice(0, 20).join('\n');
    assert.ok(head.includes('--import ./scripts/linguiNode.mjs'), `${f}: say in its first 20 lines to run it with --import ./scripts/linguiNode.mjs`);
  }
});
