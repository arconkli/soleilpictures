// scripts/i18nWrap.mjs puts the app's English in Lingui macros without reprinting
// a file. Each fixture is a small module; for each one the test checks that
//   - the codemod's output is exactly what the fixture says,
//   - running it again on the output edits nothing,
//   - the coverage checker (scripts/i18nCoverage.mjs, a separate walker) finds
//     nothing left in the output, unless the fixture says some English stays,
//   - the real Lingui macro compiles the output, and the message it writes is
//     the English the fixture names (the message a translator will see).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { wrapSource, applyEdits } from '../../scripts/i18nWrap.mjs';
import { coverageViolations } from '../../scripts/i18nCoverage.mjs';
import { linguiTransform } from '../../scripts/linguiTransform.mjs';
import { BOARDS } from '../../scripts/i18nScope.mjs';

const FILE = join(BOARDS, 'src/lib/fixture.jsx');
const T = "import { t } from '@lingui/core/macro';\n";
const TR = "import { Trans } from '@lingui/react/macro';\n";
const ICON = "import { Icon } from './Icon.jsx';\n";

const comp = (jsx, imports = '') => `${imports}export function C({ name, count, open, saving, onClick }) {\n  return (\n    ${jsx}\n  );\n}\n`;
const fn = (body, imports = '') => `${imports}export function C({ feedback, name, n, onClick }) {\n  ${body}\n}\n`;

// The messages the macro compiled: ["Hello <0>", ["name"], "</0>"] is read back
// as the text a person sees, with each placeholder filled from `values`.
function messagesOf(compiled, values = {}) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = compiled.indexOf('message: [', from);
    if (at < 0) break;
    let i = at + 'message: '.length;
    const start = i;
    let depth = 0;
    let inString = false;
    for (; i < compiled.length; i++) {
      const c = compiled[i];
      if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
      if (c === '"') inString = true;
      else if (c === '[') depth++;
      else if (c === ']' && --depth === 0) { i++; break; }
    }
    const parts = JSON.parse(compiled.slice(start, i));
    out.push(parts.map((p) => (typeof p === 'string' ? p : String(values[p[0]]))).join(''));
    from = i;
  }
  return out;
}

const kinds = (report) => report.map((r) => r.kind).sort();

async function check({ name, input, output, reports = [], violations = false, english, values }) {
  const first = wrapSource(input, { filename: FILE });
  assert.equal(first.code, output, `${name}: output`);
  assert.deepEqual(kinds(first.report), [...reports].sort(), `${name}: reports`);
  const again = wrapSource(output, { filename: FILE });
  assert.equal(again.edits.length, 0, `${name}: running it again edits nothing`);
  const left = coverageViolations(output, FILE);
  if (violations) assert.ok(left.length > 0, `${name}: English is meant to stay, and the checker sees it`);
  else assert.deepEqual(left, [], `${name}: nothing left in English`);
  const compiled = await linguiTransform(output, FILE);
  assert.ok(compiled.code.length > 0, `${name}: the macro compiles it`);
  if (english) assert.deepEqual(messagesOf(compiled.code, values), english, `${name}: messages`);
}

const fixtures = [
  {
    name: '1 a button',
    input: comp('<button>Save</button>', ICON),
    output: comp('<button><Trans>Save</Trans></button>', ICON + TR),
    english: ['Save'],
  },
  {
    name: '2 a sentence with an element and a placeholder, line breaks kept',
    input: comp('<p>\n      Hello <b>{name}</b>, welcome\n      to the app.\n    </p>'),
    output: comp('<p>\n      <Trans>Hello <b>{name}</b>, welcome\n      to the app.</Trans>\n    </p>', TR),
    english: ['Hello <0>Foo</0>, welcome to the app.'],
    values: { name: 'Foo' },
  },
  {
    name: '3 an icon before the words stays outside',
    input: comp('<button><Icon name="plus" /> New cluster</button>', ICON),
    output: comp('<button><Icon name="plus" /> <Trans>New cluster</Trans></button>', ICON + TR),
    english: ['New cluster'],
  },
  {
    name: '4 an icon inside a sentence goes in',
    input: comp('<p>Click <Icon name="plus" /> to add</p>', ICON),
    output: comp('<p><Trans>Click <Icon name="plus" /> to add</Trans></p>', ICON + TR),
    english: ['Click <0/> to add'],
  },
  {
    name: '5 a number before a noun',
    input: comp('<span>{count} selected</span>'),
    output: comp('<span><Trans>{count} selected</Trans></span>', TR),
    reports: ['count'],
    english: ['3 selected'],
    values: { count: 3 },
  },
  {
    name: '6 nested blocks',
    input: comp('<div>Title<div>Body text</div></div>'),
    output: comp('<div><Trans>Title</Trans><div><Trans>Body text</Trans></div></div>', TR),
    english: ['Title', 'Body text'],
  },
  {
    name: '7 a sentence split by an expression with JSX',
    input: comp('<div>Hello {open && <Menu />} world</div>', "import { Menu } from './Menu.jsx';\n"),
    output: comp('<div><Trans>Hello</Trans> {open && <Menu />} <Trans>world</Trans></div>', "import { Menu } from './Menu.jsx';\n" + TR),
    reports: ['split-around'],
    english: ['Hello', 'world'],
  },
  {
    name: '8 English in an expression inside a sentence stays',
    input: comp("<span>{open ? 'Hide' : 'Show'} details</span>"),
    output: comp("<span>{open ? 'Hide' : 'Show'} details</span>"),
    reports: ['sentence-split'],
    violations: true,
  },
  {
    name: '9 a conditional alone',
    input: comp("<span>{saving ? 'Saving…' : 'Saved'}</span>"),
    output: comp('<span>{saving ? t`Saving…` : t`Saved`}</span>', T),
  },
  {
    name: '10 text props',
    input: comp('<input placeholder="Search clusters" aria-label={\'Search\'} title={open ? \'Close\' : \'Open\'} className="a b" />'),
    output: comp('<input placeholder={t`Search clusters`} aria-label={t`Search`} title={open ? t`Close` : t`Open`} className="a b" />', T),
    english: ['Search clusters', 'Search', 'Close', 'Open'],
  },
  {
    name: '11 an apostrophe before a placeholder is doubled',
    input: comp('<a title={`Delete \'${name}\'?`} />'),
    output: comp('<a title={t`Delete \'\'${name}\'?`} />', T),
    english: ["Delete 'Foo'?"],
    values: { name: 'Foo' },
  },
  {
    name: '12 the same in JSX text',
    input: comp("<p>It's '{name}' now</p>"),
    output: comp("<p><Trans>It's ''{name}' now</Trans></p>", TR),
    english: ["It's 'Foo' now"],
    values: { name: 'Foo' },
  },
  {
    name: '13a an entity in an attribute',
    input: comp('<a title="Tom &amp; Jerry" />'),
    output: comp('<a title={t`Tom & Jerry`} />', T),
    english: ['Tom & Jerry'],
  },
  {
    name: '13b a backslash and a backtick',
    input: comp("<a title={'C:\\\\dir `x`'} />"),
    output: comp('<a title={t`C:\\\\dir \\`x\\``} />', T),
    english: ['C:\\dir `x`'],
  },
  {
    name: '14 a toast with an action',
    input: fn("feedback.toast({ type: 'info', message: 'Copied', action: { label: 'Undo', onClick } });"),
    output: fn("feedback.toast({ type: 'info', message: t`Copied`, action: { label: t`Undo`, onClick } });", T),
    english: ['Copied', 'Undo'],
  },
  {
    name: '15 a toast with a count',
    input: fn('toast({ message: `Moved ${n} cards` });', "import { toast } from './toast.js';\n"),
    output: fn('toast({ message: t`Moved ${n} cards` });', "import { toast } from './toast.js';\n" + T),
    reports: ['count'],
    english: ['Moved 3 cards'],
    values: { n: 3 },
  },
  {
    name: '16 a label inside a function',
    input: "export function Menu() { const items = [{ label: 'Rename', id: 'rename' }]; return items; }\n",
    output: `${T}export function Menu() { const items = [{ label: t\`Rename\`, id: 'rename' }]; return items; }\n`,
    english: ['Rename'],
  },
  {
    name: '17 a label in a module-scope table becomes a getter',
    input: "const OPTIONS = [{ value: 'light', label: 'Light' }];\nexport const get = () => OPTIONS;\n",
    output: `${T}const OPTIONS = [{ value: 'light', get label() { return t\`Light\`; } }];\nexport const get = () => OPTIONS;\n`,
    english: ['Light'],
  },
  {
    name: '18 a table whose label the file assigns to stays',
    input: "const OPTIONS = [{ value: 'light', label: 'Light' }];\nexport function rename(o) { o.label = 'x'; }\n",
    output: "const OPTIONS = [{ value: 'light', label: 'Light' }];\nexport function rename(o) { o.label = 'x'; }\n",
    reports: ['getter-assign'],
  },
  {
    name: '19 analytics calls are left alone',
    input: fn("logEvent('x', { label: 'Sidebar' });", "import { logEvent } from './analytics.js';\n"),
    output: fn("logEvent('x', { label: 'Sidebar' });", "import { logEvent } from './analytics.js';\n"),
  },
  {
    name: '20 a variable named t gets the other name',
    input: comp('items.map((t) => <span title="Tag">{t.name}</span>)'),
    output: comp('items.map((t) => <span title={tr`Tag`}>{t.name}</span>)', "import { t as tr } from '@lingui/core/macro';\n"),
    english: ['Tag'],
  },
  {
    name: '21 a file that already imports t adds only Trans',
    input: "import { t } from '@lingui/core/macro';\nexport function C() {\n  const label = t`Open`;\n  return <button title={label}>Save</button>;\n}\n",
    output: `import { t } from '@lingui/core/macro';\n${TR}export function C() {\n  const label = t\`Open\`;\n  return <button title={label}><Trans>Save</Trans></button>;\n}\n`,
    english: ['Open', 'Save'],
  },
  {
    name: '22 a brand name stays English',
    input: comp('<span>Soleil Clusters</span>'),
    output: comp('<span>Soleil Clusters</span>'),
  },
  {
    name: '23a code stays',
    input: comp('<code>npm install</code>'),
    output: comp('<code>npm install</code>'),
  },
  {
    name: '23b code inside a sentence goes in',
    input: comp('<p>Run <code>npm test</code> first</p>'),
    output: comp('<p><Trans>Run <code>npm test</code> first</Trans></p>', TR),
    english: ['Run <0>npm test</0> first'],
  },
  {
    name: '24a braces in text',
    input: comp("<p>Use {'{'}name{'}'} here</p>"),
    output: comp("<p>Use {'{'}name{'}'} here</p>"),
    reports: ['brace'],
    violations: true,
  },
  {
    name: '24b braces in an attribute',
    input: comp('<a title="Use {name}" />'),
    output: comp('<a title="Use {name}" />'),
    reports: ['brace'],
    violations: true,
  },
  {
    name: '25 already wrapped',
    input: "import { t } from '@lingui/core/macro';\nimport { Trans } from '@lingui/react/macro';\nconst OPTS = [{ value: 'light', get label() { return t`Light`; } }];\nexport function C() {\n  const s = t`Save`;\n  return <Trans>Save</Trans>;\n}\n",
    output: "import { t } from '@lingui/core/macro';\nimport { Trans } from '@lingui/react/macro';\nconst OPTS = [{ value: 'light', get label() { return t`Light`; } }];\nexport function C() {\n  const s = t`Save`;\n  return <Trans>Save</Trans>;\n}\n",
  },
  {
    name: '26 a singular and a plural by hand',
    input: fn("const s = n === 1 ? 'card' : 'cards';\n  return s;"),
    output: fn("const s = n === 1 ? 'card' : 'cards';\n  return s;"),
    reports: ['count'],
  },
  {
    name: '27 a fragment',
    input: comp('<>Hello <b>you</b></>'),
    output: comp('<><Trans>Hello <b>you</b></Trans></>', TR),
    english: ['Hello <0>you</0>'],
  },
  {
    name: '28 an entity in text',
    input: comp('<p>Loading&hellip;</p>'),
    output: comp('<p><Trans>Loading&hellip;</Trans></p>', TR),
    english: ['Loading…'],
  },
  {
    name: '30 a placeholder on its own line',
    input: comp('<p>\n      You have\n      {count}\n      items\n    </p>'),
    output: comp('<p>\n      <Trans>You have\n      {count}\n      items</Trans>\n    </p>', TR),
    english: ['You have{count}items'],
    values: { count: '{count}' },
  },
  {
    name: '31 a key hint after words',
    input: comp("<span>Save{' '}<Kbd>⌘S</Kbd></span>", "import { Kbd } from './Kbd.jsx';\n"),
    output: comp("<span><Trans>Save</Trans>{' '}<Kbd>⌘S</Kbd></span>", "import { Kbd } from './Kbd.jsx';\n" + TR),
    english: ['Save'],
  },
  {
    name: '32 a label before its input',
    input: comp('<label>Name <input /></label>'),
    output: comp('<label><Trans>Name</Trans> <input /></label>', TR),
    english: ['Name'],
  },
  {
    name: '33 a native confirm',
    input: fn("if (window.confirm('Delete this cluster?')) onClick();"),
    output: fn("if (window.confirm(t`Delete this cluster?`)) onClick();", T),
    english: ['Delete this cluster?'],
  },
  {
    name: '34 an error message',
    input: fn("throw new Error('Could not save');"),
    output: fn("throw new Error('Could not save');"),
    reports: ['error-text'],
  },
  {
    name: '35 a table of labels at module scope',
    input: "const KIND = { note: 'Note', image: 'Image' };\nexport const kind = (k) => KIND[k];\n",
    output: "const KIND = { note: 'Note', image: 'Image' };\nexport const kind = (k) => KIND[k];\n",
    reports: ['label-map'],
  },
  {
    name: '36 a date in a fixed locale',
    input: fn("return n.toLocaleDateString('en-US', { month: 'short' });"),
    output: fn("return n.toLocaleDateString('en-US', { month: 'short' });"),
    reports: ['locale-format'],
  },
];

const OPT = "const OPTIONS = [{ value: 'light', label: 'Light' }];\n";
const PH = "import { ph } from '@lingui/core/macro';\n";

fixtures.push(
  // F2: a table read while the module loads stays English, whatever its shape.
  { name: '37 a table passed to a call at load stays', input: `${OPT}register(OPTIONS);\n`, output: `${OPT}register(OPTIONS);\n`, reports: ['getter-read-at-load'] },
  { name: '38 a table mapped at load stays', input: `${OPT}export const values = OPTIONS.map((o) => o.value);\n`, output: `${OPT}export const values = OPTIONS.map((o) => o.value);\n`, reports: ['getter-read-at-load'] },
  { name: '39 a table member read at load stays', input: `${OPT}export const first = OPTIONS[0].label;\n`, output: `${OPT}export const first = OPTIONS[0].label;\n`, reports: ['getter-read-at-load'] },
  { name: '40 a table spread at load stays', input: `${OPT}export const second = [...OPTIONS, { value: 'x' }];\n`, output: `${OPT}export const second = [...OPTIONS, { value: 'x' }];\n`, reports: ['getter-read-at-load'] },
  {
    name: '41 the same table read inside functions still becomes getters',
    input: `${OPT}export const get = () => OPTIONS.map((o) => o.label);\nexport const find = (v) => OPTIONS.find((o) => o.value === v);\n`,
    output: `${T}const OPTIONS = [{ value: 'light', get label() { return t\`Light\`; } }];\nexport const get = () => OPTIONS.map((o) => o.label);\nexport const find = (v) => OPTIONS.find((o) => o.value === v);\n`,
    english: ['Light'],
  },
  {
    name: '42 Object.freeze around a table is safe at load',
    input: "const OPTIONS = Object.freeze([{ value: 'light', label: 'Light' }]);\nexport const get = () => OPTIONS;\n",
    output: `${T}const OPTIONS = Object.freeze([{ value: 'light', get label() { return t\`Light\`; } }]);\nexport const get = () => OPTIONS;\n`,
    english: ['Light'],
  },
  // F4: components that read children as text get {t`...`}, not <Trans>.
  {
    name: '43 MenuHead gets a string child',
    input: "import { MenuHead } from './Menu.jsx';\nexport function C() {\n  return (\n    <div><MenuHead>Recent</MenuHead></div>\n  );\n}\n",
    output: `import { MenuHead } from './Menu.jsx';\n${T}export function C() {\n  return (\n    <div><MenuHead>{t\`Recent\`}</MenuHead></div>\n  );\n}\n`,
    english: ['Recent'],
  },
  {
    name: '44 MenuHead with an element inside is reported',
    input: "import { MenuHead } from './Menu.jsx';\nexport function C({ n }) {\n  return (\n    <div><MenuHead>Recent <b>{n}</b></MenuHead></div>\n  );\n}\n",
    output: "import { MenuHead } from './Menu.jsx';\nexport function C({ n }) {\n  return (\n    <div><MenuHead>Recent <b>{n}</b></MenuHead></div>\n  );\n}\n",
    reports: ['string-child'],
    violations: true,
  },
  // F5: placeholders that are not identifiers are named, not numbered.
  {
    name: '45 a member expression in a sentence gets a name',
    input: 'export function C({ user }) {\n  return <p>Hello {user.name}, hi</p>;\n}\n',
    output: `${PH}${TR}export function C({ user }) {\n  return <p><Trans>Hello {ph({ name: user.name })}, hi</Trans></p>;\n}\n`,
    english: ['Hello Ann, hi'],
    values: { name: 'Ann' },
  },
  {
    name: '46 length is count, a call is named for its function, a member for its last key',
    input: 'export function C({ items, size }) {\n  return <p>{items.length} items, {formatBytes(size)}, {size.value} left</p>;\n}\n',
    output: `${PH}${TR}export function C({ items, size }) {\n  return <p><Trans>{ph({ count: items.length })} items, {ph({ bytes: formatBytes(size) })}, {ph({ value: size.value })} left</Trans></p>;\n}\n`,
    reports: ['count', 'count'],
    english: ['3 items, 1 KB, 2 left'],
    values: { count: 3, bytes: '1 KB', value: 2 },
  },
  {
    name: '47 two placeholders with one name are numbered',
    input: 'export function C({ user, other }) {\n  return <p>Hi {user.name} and {other.name}</p>;\n}\n',
    output: `${PH}${TR}export function C({ user, other }) {\n  return <p><Trans>Hi {ph({ name: user.name })} and {ph({ name2: other.name })}</Trans></p>;\n}\n`,
    english: ['Hi A and B'],
    values: { name: 'A', name2: 'B' },
  },
  {
    name: '48 a template placeholder that is not an identifier gets a name',
    input: 'export function f({ a }, toast) {\n  toast({ message: `Hello ${a.b}` });\n}\n',
    output: "import { t, ph } from '@lingui/core/macro';\nexport function f({ a }, toast) {\n  toast({ message: t`Hello ${ph({ b: a.b })}` });\n}\n",
    english: ['Hello Zed'],
    values: { b: 'Zed' },
  },
  {
    name: '49 English inside a placeholder is reported, not hidden in it',
    input: "export function f(all, allN, toast) {\n  toast({ message: `Imported${all ? ` - bring all ${allN}` : ''}` });\n}\n",
    output: "export function f(all, allN, toast) {\n  toast({ message: `Imported${all ? ` - bring all ${allN}` : ''}` });\n}\n",
    reports: ['nested-english'],
    violations: true,
  },
  // F6: an error boundary may not use <Trans> (no provider above it).
  {
    name: '50 an error boundary uses t, not Trans',
    input: "import React from 'react';\nexport class Boundary extends React.Component {\n  static getDerivedStateFromError() { return { bad: true }; }\n  render() { return <div><p>Something broke</p><button>Reload</button></div>; }\n}\n",
    output: `import React from 'react';\n${T}export class Boundary extends React.Component {\n  static getDerivedStateFromError() { return { bad: true }; }\n  render() { return <div><p>{t\`Something broke\`}</p><button>{t\`Reload\`}</button></div>; }\n}\n`,
    english: ['Something broke', 'Reload'],
  },
  {
    name: '51 an error boundary run with an element inside is reported',
    input: "import React from 'react';\nexport class Boundary extends React.Component {\n  static getDerivedStateFromError() { return { bad: true }; }\n  render() { return <p>Reload <b>now</b> please</p>; }\n}\n",
    output: "import React from 'react';\nexport class Boundary extends React.Component {\n  static getDerivedStateFromError() { return { bad: true }; }\n  render() { return <p>Reload <b>now</b> please</p>; }\n}\n",
    reports: ['no-trans'],
    violations: true,
  },
);

const PAGE = "import { Page } from './Page.jsx';\n";
const PL = "import { plural } from '@lingui/core/macro';\n";
const PLT = "import { plural, t } from '@lingui/core/macro';\n";

fixtures.push(
  // 11c F-a: a sink's object can be any argument.
  {
    name: '52 undoToast with the object second',
    input: fn("undoToast(feedback, { message: 'Card deleted', onUndo: onClick });"),
    output: fn("undoToast(feedback, { message: t`Card deleted`, onUndo: onClick });", T),
    english: ['Card deleted'],
  },
  {
    name: '53 a second object that holds no text is left alone',
    input: fn("feedback.toast({ message: 'Saved' }, { id: 'x' });"),
    output: fn("feedback.toast({ message: t`Saved` }, { id: 'x' });", T),
    english: ['Saved'],
  },
  // 11c F-b: camelCase text props.
  {
    name: '54 a camelCase text prop',
    input: comp('<Page backLabel="Back" />', PAGE),
    output: comp('<Page backLabel={t`Back`} />', PAGE + T),
    english: ['Back'],
  },
  {
    name: '55 both leaves of a camelCase text prop',
    input: comp("<Page emptyTitle={saving ? 'Loading' : 'Nothing here'} />", PAGE),
    output: comp('<Page emptyTitle={saving ? t`Loading` : t`Nothing here`} />', PAGE + T),
    english: ['Loading', 'Nothing here'],
  },
  {
    name: '56 props that name an id, or hold a keyboard hint, are not text',
    input: comp('<Page ariaLabelledBy="x" titleId="x" enterKeyHint="go" />', PAGE),
    output: comp('<Page ariaLabelledBy="x" titleId="x" enterKeyHint="go" />', PAGE),
  },
  // 11c F-c: a count ternary inside a sentence is not one message.
  {
    name: '57 a count ternary in a template placeholder is reported, not hidden in it',
    input: fn("return feedback.toast({ message: `${n} ${n === 1 ? 'file' : 'files'} moved` });"),
    output: fn("return feedback.toast({ message: `${n} ${n === 1 ? 'file' : 'files'} moved` });"),
    reports: ['count', 'count'],
    violations: true,
  },
  {
    name: '58 a count ternary whose leaves are messages already is fine',
    input: fn("return n === 1 ? t`1 file` : t`${n} files`;", T),
    output: fn("return n === 1 ? t`1 file` : t`${n} files`;", T),
  },
  // 11c G: plural, select and selectOrdinal from the macro are one message.
  {
    name: '59 a macro plural in a placeholder is part of the message',
    input: fn('return feedback.toast({ message: `${plural(n, { one: \'# file\', other: \'# files\' })} moved` });', PL),
    output: fn('return feedback.toast({ message: t`${plural(n, { one: \'# file\', other: \'# files\' })} moved` });', PLT),
  },
  {
    name: '60 English in a macro plural option placeholder is still nested',
    input: fn("return feedback.toast({ message: `${plural(n, { one: `# ${name ? 'apple' : 'pear'}`, other: '#' })} moved` });", PL),
    output: fn("return feedback.toast({ message: `${plural(n, { one: `# ${name ? 'apple' : 'pear'}`, other: '#' })} moved` });", PL),
    reports: ['nested-english'],
    violations: true,
  },
  {
    name: '61 a plural that is not the macro is still walked',
    input: fn("return feedback.toast({ message: `${plural(n, { one: '# file', other: '# files' })} moved` });", "import { plural } from './helpers.js';\n"),
    output: fn("return feedback.toast({ message: `${plural(n, { one: '# file', other: '# files' })} moved` });", "import { plural } from './helpers.js';\n"),
    reports: ['count', 'nested-english'],
    violations: true,
  },
);

for (const f of fixtures) {
  test(`wrap fixture ${f.name}`, async () => { await check(f); });
}

// F3: text that is also data is reported, not wrapped.
test('text compared elsewhere in the file is reported, not wrapped', () => {
  const input = "export function C({ k }) {\n  if (k === 'Archive') return { label: 'Archive' };\n  return { label: 'Open' };\n}\n";
  const out = wrapSource(input, { filename: FILE });
  assert.match(out.code, /label: 'Archive'/);
  assert.match(out.code, /label: t`Open`/);
  assert.ok(kinds(out.report).includes('compared'));
  assert.equal(wrapSource(out.code, { filename: FILE }).edits.length, 0);
});

test('text quoted on the server is reported, not wrapped', () => {
  const input = "export function C({ k }) {\n  return { label: 'Restore', k };\n}\n";
  const out = wrapSource(input, { filename: FILE, server: new Map([['Restore', 'party/x.ts:3']]) });
  assert.equal(out.code, input);
  assert.deepEqual(kinds(out.report), ['also-on-server']);
});

// F2 across files: a table another file reads at load is reported.
test('a table another file reads at load stays English', () => {
  const input = "const OPTIONS = [{ value: 'light', label: 'Light' }];\nexport { OPTIONS as HEADING_OPTIONS };\n";
  const seen = [];
  const out = wrapSource(input, { filename: FILE, crossRead: (names, keys) => { seen.push([[...names], [...keys]]); return 'Bar.jsx maps it at load'; } });
  assert.equal(out.code, input);
  assert.deepEqual(kinds(out.report), ['getter-read-at-load']);
  assert.ok(seen.length >= 1 && seen[0][0].includes('HEADING_OPTIONS'));
  const quiet = wrapSource(input, { filename: FILE, crossRead: () => null });
  assert.match(quiet.code, /get label\(\)/);
});

test('wrap fixture 29: a file that uses useLingui is skipped whole', async () => {
  const input = "import { useLingui } from '@lingui/react/macro';\nexport function C() {\n  const { t } = useLingui();\n  return <button title=\"Save\">Save</button>;\n}\n";
  const out = wrapSource(input, { filename: FILE });
  assert.equal(out.code, input);
  assert.equal(out.edits.length, 0);
  assert.deepEqual(kinds(out.report), ['skipped']);
});

test('a file that does not parse is skipped, not thrown', () => {
  const out = wrapSource('export const = ;', { filename: FILE });
  assert.deepEqual(kinds(out.report), ['skipped']);
});

test('two edits that overlap are refused', () => {
  assert.throws(() => applyEdits('abcdef', [{ kind: 'a', start: 1, end: 4, text: 'x' }, { kind: 'b', start: 2, end: 3, text: 'y' }]), /overlap/);
  assert.equal(applyEdits('abcdef', [{ kind: 'a', start: 2, end: 2, text: '1' }, { kind: 'b', start: 2, end: 2, text: '2' }, { kind: 'c', start: 2, end: 3, text: 'Z' }]), 'ab12Zdef');
});

test('a module-scope JSX prop is reported, not turned into a t call that runs at load', () => {
  const out = wrapSource("export const el = <input placeholder=\"Search clusters\" />;\n", { filename: FILE });
  assert.equal(out.edits.length, 0);
  assert.deepEqual(kinds(out.report), ['module-scope']);
});

test('a t that is shadowed where the edit goes is reported', () => {
  const input = "import { t } from '@lingui/core/macro';\nexport function C(items) {\n  return items.map((t) => <span title=\"Tag\">{t.name}</span>);\n}\n";
  const out = wrapSource(input, { filename: FILE });
  assert.equal(out.edits.length, 0);
  assert.deepEqual(kinds(out.report), ['shadowed-t']);
});

test('a callback inside a denied call is still code that shows text', () => {
  const out = wrapSource("export function C(ch, toast) {\n  ch.on('x', () => toast({ message: 'Saved to the cluster' }));\n}\n", { filename: FILE });
  assert.match(out.code, /message: t`Saved to the cluster`/);
});

test('a run of nothing but elements is not one message', () => {
  const input = comp('<div><Button>Save</Button><Button>Cancel</Button></div>', "import { Button } from './Button.jsx';\n");
  const out = wrapSource(input, { filename: FILE }).code;
  assert.match(out, /<Button><Trans>Save<\/Trans><\/Button><Button><Trans>Cancel<\/Trans><\/Button>/);
});
