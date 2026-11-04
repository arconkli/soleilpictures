// The product_update edition "2026-10-31" was mid-send when every other email
// moved to the dark look, so it must render byte-for-byte as it did before:
// subject, HTML and text are frozen in productUpdateLegacyFixture.json, captured
// from the code as it stood before the restyle.
//
// When that edition's send is done, delete the version from
// LEGACY_LOOK_EDITIONS, this test, the fixture and legacyNote.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./productUpdateLegacyFixture.json', import.meta.url), 'utf8'));
const { renderTemplate } = await import('../../../supabase/functions/_shared/email/templates.ts');
const { MARK_URL } = await import('../../../supabase/functions/_shared/email/theme.ts');

test('the fixture is for edition 2026-10-31', () => {
  assert.equal(fixture.version, '2026-10-31');
  assert.ok(fixture.cases.length >= 3);
});

for (const c of fixture.cases) {
  test(`product_update 2026-10-31 renders as before: ${c.name}`, () => {
    const r = renderTemplate('product_update', c.data);
    assert.equal(r.subject, c.subject);
    assert.equal(r.html, c.html);
    assert.equal(r.text, c.text);
  });
}

test('any other edition renders the new look, with the same words', () => {
  const full = fixture.cases.find((c) => c.name === 'full');
  assert.ok(full, 'fixture has a "full" case');
  const r = renderTemplate('product_update', { ...full.data, version: '2026-11-30' });
  assert.ok(r.html.includes('dark only'));
  assert.ok(r.html.includes(MARK_URL));
  assert.ok(!r.html.includes('#faf9f7'));
  assert.equal(r.text, full.text.replaceAll('2026-10-31', '2026-11-30'));
});
