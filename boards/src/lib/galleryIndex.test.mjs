// galleryIndex.test.mjs — the Surface Gallery registry is well-formed, its
// search ranks the way the owner will expect, and the renderer map next door
// has not drifted away from it.
//
// The parity check reads components/gallery/entries.jsx as TEXT. node --test
// cannot import JSX, and the whole reason the registry is split into a pure
// half and a render half is so this file can exist. A text scan is the same
// idiom the repo's source-guard specs use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GALLERY_ENTRIES, GALLERY_GROUPS, GALLERY_KINDS,
  searchGallery, groupGallery, findEntry, routeUrl,
} from './galleryIndex.js';

const entriesSrc = () =>
  readFileSync(new URL('../components/gallery/entries.jsx', import.meta.url), 'utf8');

test('every entry is well-formed', () => {
  const groupIds = new Set(GALLERY_GROUPS.map((g) => g.id));
  for (const e of GALLERY_ENTRIES) {
    assert.match(e.id, /^[a-z0-9-]+$/, `id ${e.id}`);
    assert.ok(e.label && e.label.length > 2, `label for ${e.id}`);
    assert.ok(groupIds.has(e.group), `${e.id} has a real group (${e.group})`);
    assert.ok(GALLERY_KINDS.includes(e.kind), `${e.id} has a real kind (${e.kind})`);
    // Keywords are what makes this searchable rather than a component list.
    assert.ok(String(e.keywords || '').split(/\s+/).length >= 3, `${e.id} has keywords`);
  }
});

test('ids are unique', () => {
  const seen = new Set();
  for (const e of GALLERY_ENTRIES) {
    assert.ok(!seen.has(e.id), `duplicate id ${e.id}`);
    seen.add(e.id);
  }
  assert.equal(seen.size, GALLERY_ENTRIES.length);
});

test('labels are unique — two rows reading the same is a search dead end', () => {
  const seen = new Set();
  for (const e of GALLERY_ENTRIES) {
    assert.ok(!seen.has(e.label), `duplicate label "${e.label}"`);
    seen.add(e.label);
  }
});

test("every 'route' carries a url and every 'insitu' carries its recipe", () => {
  for (const e of GALLERY_ENTRIES) {
    if (e.kind === 'route') {
      assert.ok(e.url && e.url.startsWith('/'), `${e.id} needs a url`);
      // A ':param' in the url and the param label must agree, or routeUrl
      // silently opens a page with a literal ':token' in the path.
      assert.equal(/:[a-z]+/i.test(e.url), !!e.param, `${e.id} url/param agree`);
    }
    if (e.kind === 'insitu') {
      assert.ok(e.note && e.note.length > 40,
        `${e.id} must say WHY it cannot be faked and how to see it for real`);
    }
    if (e.kind === 'overlay' || e.kind === 'toast') {
      assert.ok(!e.url, `${e.id} is rendered, not navigated`);
    }
  }
});

test('the trial offer is what you get for "trial"', () => {
  // The question that started this feature. If this ever stops being first,
  // the owner searches the obvious word and does not find the obvious thing.
  const hits = searchGallery(GALLERY_ENTRIES, 'trial');
  assert.equal(hits[0].id, 'pricing-modal-trial');
  assert.ok(hits.some((e) => e.id === 'pricing-modal-trialed'));
  assert.ok(hits.some((e) => e.id === 'billing-trialing'));
});

test('search ranks exact over prefix over contains over keyword-only', () => {
  const ranked = searchGallery(GALLERY_ENTRIES, 'cap');
  // 'Cap wall' starts with it; 'Toast — near the cap' only contains it;
  // 'Settings — Capture (admin)' matches on the word "capture".
  const at = (id) => ranked.findIndex((e) => e.id === id);
  assert.ok(at('pricing-modal-cap-hit') >= 0);
  assert.ok(at('pricing-modal-cap-hit') < at('toast-near-cap'),
    'a label prefix beats a label substring');
  assert.ok(at('toast-near-cap') < at('settings-capture'),
    'a label match beats a keywords-only match');
});

test('search finds a surface by a word that is not in its label', () => {
  // The whole point of the keywords column: "paywall" appears in no label.
  const hits = searchGallery(GALLERY_ENTRIES, 'paywall').map((e) => e.id);
  assert.ok(hits.includes('pricing-modal-cap-hit'));
  assert.ok(searchGallery(GALLERY_ENTRIES, '404').some((e) => e.id === 'not-found'));
  // Substring, not a token AND: "command palette" hits, the words reversed
  // do not. Worth pinning — a token-AND search would quietly reorder results.
  assert.ok(searchGallery(GALLERY_ENTRIES, 'command palette').length > 0);
  // "toast" and "palette" both appear in the power-reveal entry's keywords,
  // but not adjacently, so a substring search finds nothing and a token-AND
  // search would have found it.
  assert.equal(searchGallery(GALLERY_ENTRIES, 'toast palette').length, 0);
});

test('an empty query returns the whole inventory, in registry order', () => {
  const all = searchGallery(GALLERY_ENTRIES, '');
  assert.equal(all.length, GALLERY_ENTRIES.length);
  assert.equal(all[0].id, GALLERY_ENTRIES[0].id);
  assert.deepEqual(searchGallery(GALLERY_ENTRIES, '   ').map((e) => e.id),
    GALLERY_ENTRIES.map((e) => e.id));
});

test('a query that matches nothing returns nothing rather than everything', () => {
  assert.deepEqual(searchGallery(GALLERY_ENTRIES, 'zzzznotasurface'), []);
});

test('grouping drops empty headings and keeps every entry exactly once', () => {
  const groups = groupGallery(GALLERY_ENTRIES);
  assert.ok(groups.every((g) => g.entries.length > 0));
  const flat = groups.flatMap((g) => g.entries.map((e) => e.id));
  assert.equal(flat.length, GALLERY_ENTRIES.length);
  assert.equal(new Set(flat).size, GALLERY_ENTRIES.length);
  // A filtered list must not resurrect a heading with nothing under it.
  assert.deepEqual(groupGallery(searchGallery(GALLERY_ENTRIES, 'zzz')), []);
});

test('routeUrl substitutes a param and refuses to open a bare placeholder', () => {
  assert.equal(routeUrl(findEntry('screen-pricing')), '/pricing');
  assert.equal(routeUrl(findEntry('screen-share'), 'abc'), '/share/abc');
  assert.equal(routeUrl(findEntry('screen-share'), ''), null,
    'no param means ask, never navigate to /share/:token');
  assert.equal(routeUrl(findEntry('screen-share'), '  '), null);
  assert.equal(routeUrl(findEntry('screen-share'), 'a/b'), '/share/a%2Fb',
    'a pasted value cannot escape its path segment');
  assert.equal(routeUrl(findEntry('pricing-modal')), null, 'overlays are not navigable');
});

test('findEntry is exact and total', () => {
  assert.equal(findEntry('pricing-modal-trial').label, 'Creator pricing — trial offer');
  assert.equal(findEntry('nope'), null);
  assert.equal(findEntry(''), null);
  assert.equal(findEntry(null), null);
});

test('every rendered entry has a renderer, and every renderer has an entry', () => {
  const src = entriesSrc();
  // Renderers are declared as  'entry-id': ...  at the top level of RENDERERS.
  const declared = new Set(
    [...src.matchAll(/^\s{2}'([a-z0-9-]+)':/gm)].map((m) => m[1]),
  );
  assert.ok(declared.size > 50, `found only ${declared.size} renderers — did the map shape change?`);

  const needsRenderer = GALLERY_ENTRIES
    .filter((e) => e.kind === 'overlay' || e.kind === 'toast')
    .map((e) => e.id);
  const missing = needsRenderer.filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `entries with no renderer: ${missing.join(', ')}`);

  const ids = new Set(GALLERY_ENTRIES.map((e) => e.id));
  const orphans = [...declared].filter((id) => !ids.has(id));
  assert.deepEqual(orphans, [], `renderers with no entry: ${orphans.join(', ')}`);

  // 'route' and 'insitu' are handled by the host, never by a renderer.
  const shouldNotRender = GALLERY_ENTRIES
    .filter((e) => e.kind === 'route' || e.kind === 'insitu')
    .filter((e) => declared.has(e.id))
    .map((e) => e.id);
  assert.deepEqual(shouldNotRender, []);
});

test('the gallery never imports one of the four heavy trees', () => {
  // Pulling CanvasSurface, PublicBoardView, LocalBoardsApp or AdminPage into
  // the gallery chunk would drag them into a shared chunk and inflate the
  // build for every signed-out visitor. This is why the canvas surfaces are
  // 'insitu' rather than mounted.
  // Parse real import statements only. A substring scan would trip on this
  // module's own header, which names all four in the comment explaining why
  // they are excluded — and a test that fails on its own documentation is a
  // test people learn to delete.
  const specs = [...entriesSrc().matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)]
    .map((m) => m[1]);
  assert.ok(specs.length > 20, `found only ${specs.length} imports — did the file shape change?`);
  for (const banned of ['CanvasSurface', 'PublicBoardView', 'LocalBoardsApp', 'AdminPage']) {
    const hit = specs.find((sp) => sp.includes(banned));
    assert.equal(hit, undefined, `entries.jsx must not import ${banned} (via ${hit})`);
  }
});
