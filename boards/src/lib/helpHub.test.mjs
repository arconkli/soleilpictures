// helpHub.test.mjs — the Help hub cannot carry a dead link or a duplicate door.
//
//   node --test src/lib/helpHub.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADD_KINDS, HUB_ACTIONS, guideLinks } from './helpHub.js';
import { DOCS_SECTIONS, DOCS_PAGES, DOCS_PATHS } from './docsiteIndex.js';

test('every kind links to a docs page that exists in the generated registry', () => {
  const paths = new Set(DOCS_PATHS);
  for (const k of ADD_KINDS) {
    assert.ok(paths.has(k.docs), `${k.id}: ${k.docs} is not a docs page`);
    assert.ok(k.title && k.line, `${k.id}: needs a title and a line`);
  }
  assert.equal(new Set(ADD_KINDS.map((k) => k.id)).size, ADD_KINDS.length, 'kind ids are unique');
});

test('the hub actions are unique and any href is a site path', () => {
  assert.equal(new Set(HUB_ACTIONS.map((a) => a.item)).size, HUB_ACTIONS.length);
  for (const a of HUB_ACTIONS) if (a.href) assert.match(a.href, /^\/[a-z]/, `${a.item}: href is a site path`);
});

test('guide links come from the registry: one per section, each a real page', () => {
  const links = guideLinks(DOCS_SECTIONS, DOCS_PAGES);
  assert.ok(links.length >= 5, `expected the handbook's sections, got ${links.length}`);
  const paths = new Set(DOCS_PATHS);
  const seen = new Set();
  for (const l of links) {
    assert.ok(paths.has(l.path), `${l.id} → ${l.path} is not a docs page`);
    assert.ok(!seen.has(l.id), `${l.id} listed twice`);
    seen.add(l.id);
  }
  // The getting-started section resolves to the docs root, not an orphan.
  assert.equal(links.find((l) => l.id === 'start')?.path, '/docs');
});

test('guideLinks tolerates garbage and prefers a section index page', () => {
  assert.deepEqual(guideLinks(null, null), []);
  const links = guideLinks(
    [{ id: 'x', label: 'X' }, { id: 'empty', label: 'Empty' }],
    [{ section: 'x', path: '/docs/x/deep', order: 0 }, { section: 'x', path: '/docs/x', order: 3 }],
  );
  assert.deepEqual(links.map((l) => [l.id, l.path]), [['x', '/docs/x']]);
});
