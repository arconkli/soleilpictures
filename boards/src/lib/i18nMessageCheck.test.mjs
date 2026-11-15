// scripts/linguiCompiledMessages.mjs fails the build on a message whose ICU
// compile loses or invents a placeholder or tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linguiTransform } from '../../scripts/linguiTransform.mjs';

const T = "import { t, plural, select } from '@lingui/core/macro';\n";
const R = "import { Trans } from '@lingui/react/macro';\n";
const run = (code) => linguiTransform(code, '/tmp/check.jsx');

const fails = [
  ['an apostrophe before a placeholder', T + "const a = t`Delete '${name}'?`;", /two apostrophes/],
  ['an apostrophe before a Trans placeholder', R + "const a = <Trans>it's '{name}' now</Trans>;", /two apostrophes/],
  ['a bare brace', T + 'const a = t`Use {braces} here`;', /'\{' or '\}'/],
];
for (const [name, code, msg] of fails) {
  test(`throws on ${name}`, async () => {
    await assert.rejects(run(code), msg);
  });
}

const passes = [
  ['doubled apostrophe', T + "const a = t`Delete ''${name}'?`;"],
  ['plural', T + "const a = plural(n, { one: '# card', other: '# cards' });"],
  ['select', T + "const a = select(g, { male: 'He', other: 'They' });"],
  ['Trans with components', R + '<Trans>Press <a href="#">here</a> or <Kbd>K</Kbd></Trans>;'],
  ['a lone apostrophe', T + "const a = t`It's done`;"],
  ['quotes around a placeholder', T + 'const a = t`Rename "${name}"`;'],
  ['an expression placeholder', T + 'const a = t`Hi ${user.name}`;'],
];
for (const [name, code] of passes) {
  test(`passes ${name}`, async () => {
    await run(code);
  });
}
