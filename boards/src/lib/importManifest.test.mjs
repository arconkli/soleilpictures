// The import manifest.
//
// The thing worth protecting here is that an import is RE-RUNNABLE: every item
// carries a source_url identifier, and the endpoint resolves on it, so running
// the same manifest twice updates instead of duplicating. A migration you
// cannot repeat is one you have to get right while it is half-finished.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImportItems, kindForContentType, cardSpecFor, titleFromUrl, fitDims,
  summarize, mapWithConcurrency, noteFor, provenanceProps,
  MAX_IMPORT_ITEMS, SOURCE_SCOPE, SOURCE_PROP, IMPORTED_AT_PROP,
} from './importManifest.js';

const AT = '2026-08-09T00:00:00.000Z';
const url = (n) => `https://cdn.example.com/ref/${n}.jpg`;

// ── the manifest ─────────────────────────────────────────────────────────────

test('a manifest of plain urls normalizes', () => {
  const items = normalizeImportItems([{ url: url('a') }, { url: url('b'), title: 'Diner' }]);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, url('a'));
  assert.equal(items[1].title, 'Diner');
});

test('an internal address is refused before ANYTHING is fetched', () => {
  // The whole manifest fails, not just the item: an import that quietly skips
  // the one entry pointing at a metadata endpoint has still told the caller
  // their manifest was fine.
  for (const bad of [
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/x.jpg',
    'https://10.0.0.5/x.jpg',
    'https://192.168.1.1/x.jpg',
    'https://metadata.google.internal/x',
    'https://build.internal/x.jpg',
    'http://cdn.example.com/x.jpg',
    'https://cdn.example.com:8080/x.jpg',
  ]) {
    assert.throws(() => normalizeImportItems([{ url: bad }]), /url must/, bad);
  }
});

test('a manifest is refused for the shapes a caller gets wrong', () => {
  assert.throws(() => normalizeImportItems([]), /non-empty/);
  assert.throws(() => normalizeImportItems(null), /non-empty/);
  assert.throws(() => normalizeImportItems(['nope']), /must be an object/);
  assert.throws(() => normalizeImportItems([{}]), /url is required/);
  assert.throws(() => normalizeImportItems(
    Array.from({ length: MAX_IMPORT_ITEMS + 1 }, (_, i) => ({ url: url(i) }))),
  new RegExp(`at most ${MAX_IMPORT_ITEMS}`));
});

test('the same url twice in one manifest is a caller mistake, not a merge', () => {
  // Both entries would race for the same identifier and one would silently
  // win, so the caller would get an import that is short by one with no reason.
  assert.throws(() => normalizeImportItems([{ url: url('a') }, { url: url('a') }]),
    /appears twice/);
});

test('the error names the item, so a hundred-line manifest is debuggable', () => {
  assert.throws(() => normalizeImportItems([{ url: url('a') }, { url: 'https://localhost/x' }]),
    /items\[1\]/);
});

// ── what a source becomes ────────────────────────────────────────────────────

test('an image is ingested and everything else is linked', () => {
  assert.equal(kindForContentType('image/jpeg', { storable: true }), 'image');
  assert.equal(kindForContentType('image/png; charset=binary', { storable: true }), 'image');
  // A format we cannot store: linked, not dropped, and not pretended into R2.
  assert.equal(kindForContentType('image/x-fits', { storable: false }), 'link');
  assert.equal(kindForContentType('application/pdf', { storable: false }), 'link');
  assert.equal(kindForContentType('video/quicktime', { storable: false }), 'link');
  assert.equal(kindForContentType('', { storable: false }), 'link');
});

test('a linked item says WHY it was not imported', () => {
  // Silence here is how somebody ends up believing their PDF is in the archive.
  assert.equal(noteFor('image', 'image/jpeg'), null);
  assert.match(noteFor('link', 'video/quicktime'), /multipart/);
  assert.match(noteFor('link', 'application/pdf'), /not an image/);
  assert.match(noteFor('link', 'image/x-fits'), /not a format this API stores/);
});

// ── the card ─────────────────────────────────────────────────────────────────

test('an imported image carries its key, its caption and real dimensions', () => {
  const [item] = normalizeImportItems([{ url: url('a'), title: 'Diner counter' }]);
  const spec = cardSpecFor(item, {
    kind: 'image', importedAt: AT,
    stored: { imageKey: 'ws/abc.jpg', width: 1920, height: 1080 },
  });
  assert.equal(spec.kind, 'image');
  assert.equal(spec.image_key, 'ws/abc.jpg');
  assert.equal(spec.caption, 'Diner counter');
  // Scaled to fit, aspect preserved — not laid out square and then jumping.
  assert.equal(spec.w, 480);
  assert.equal(spec.h, 270);
});

test('a non-image becomes a link card with a readable title', () => {
  const [item] = normalizeImportItems([{ url: 'https://example.com/docs/the-treatment-v4.pdf' }]);
  const spec = cardSpecFor(item, { kind: 'link', importedAt: AT });
  assert.equal(spec.kind, 'link');
  assert.equal(spec.url, 'https://example.com/docs/the-treatment-v4.pdf');
  assert.equal(spec.title, 'the treatment v4');
});

test('EVERY imported card can be found again by its source url', () => {
  // This is the re-runnability contract. Without it a second run of the same
  // manifest duplicates the entire import.
  const [item] = normalizeImportItems([{ url: url('a') }]);
  const spec = cardSpecFor(item, {
    kind: 'image', importedAt: AT, stored: { imageKey: 'k', width: 10, height: 10 },
  });
  assert.deepEqual(spec.identifiers.at(-1), { scope: SOURCE_SCOPE, value: url('a') });
  assert.equal(provenanceProps(item, AT)[SOURCE_PROP], url('a'));
  assert.equal(provenanceProps(item, AT)[IMPORTED_AT_PROP], AT);
});

test('provenance is written by the SERVER, never carried on the card spec', () => {
  // It lives under the reserved prefix, which the ordinary card route refuses
  // from callers — so putting it on the spec made the import fail its own
  // validation. It is merged in afterwards, on the one path allowed to set it.
  const [item] = normalizeImportItems([{ url: url('a'), props: { department: 'art' } }]);
  const spec = cardSpecFor(item, { kind: 'link', importedAt: AT });
  assert.equal(SOURCE_PROP in (spec.props || {}), false,
    'a reserved key on the card spec is rejected by POST /cards');
  assert.equal(spec.props.department, 'art');
  assert.deepEqual(provenanceProps(item, AT), { [SOURCE_PROP]: url('a'), [IMPORTED_AT_PROP]: AT });
});

test('a caller cannot make an import lie about where a card came from', () => {
  const [item] = normalizeImportItems([{
    url: url('a'),
    props: { [SOURCE_PROP]: 'https://not-where-it-came-from.example', department: 'art' },
    identifiers: [{ scope: SOURCE_SCOPE, value: 'https://also-not.example' },
      { scope: 'shotgrid', value: 'Shot:1' }],
  }]);
  const spec = cardSpecFor(item, { kind: 'link', importedAt: AT });
  assert.equal(provenanceProps(item, AT)[SOURCE_PROP], url('a'), 'ours must win');
  assert.equal(spec.props.department, 'art', 'and theirs must survive');
  assert.equal(spec.props[SOURCE_PROP], undefined, 'a forged reserved key never reaches the card');
  const sources = spec.identifiers.filter((x) => x.scope === SOURCE_SCOPE);
  assert.equal(sources.length, 1, 'exactly one source_url, or the upsert is ambiguous');
  assert.equal(sources[0].value, url('a'));
  assert.ok(spec.identifiers.some((x) => x.scope === 'shotgrid'), 'other scopes are kept');
});

test('explicit coordinates survive; absent ones are left for layout', () => {
  const [placed] = normalizeImportItems([{ url: url('a'), x: 10, y: 20 }]);
  const spec = cardSpecFor(placed, { kind: 'link', importedAt: AT });
  assert.equal(spec.x, 10);
  assert.equal(spec.y, 20);
  const [loose] = normalizeImportItems([{ url: url('b') }]);
  const spec2 = cardSpecFor(loose, { kind: 'link', importedAt: AT });
  assert.equal('x' in spec2, false, 'undefined x would reach the Y.Doc as NaN geometry');
  assert.equal('y' in spec2, false);
});

// ── helpers ──────────────────────────────────────────────────────────────────

test('a title can be read out of almost any url', () => {
  assert.equal(titleFromUrl('https://a.com/x/Kodak_2383-print.jpg'), 'Kodak 2383 print');
  assert.equal(titleFromUrl('https://a.com/photo%20one.png'), 'photo one');
  assert.equal(titleFromUrl('https://a.com/'), 'a.com', 'a bare host still names itself');
  assert.equal(titleFromUrl('not a url'), 'not a url', 'and it never throws');
});

test('dimensions fit without distorting, and degenerate input still gets a size', () => {
  assert.deepEqual(fitDims(1000, 500), { w: 480, h: 240 });
  assert.deepEqual(fitDims(600, 1200), { w: 240, h: 480 }, 'portrait fits by its long edge');
  // Never upscaled: a 100x200 thumbnail blown up to 240x480 would be shown at
  // more than twice its real resolution.
  assert.deepEqual(fitDims(100, 200), { w: 100, h: 200 });
  assert.deepEqual(fitDims(50, 50), { w: 50, h: 50 }, 'a small image is not blown up');
  assert.deepEqual(fitDims(0, 0), { w: 320, h: 240 });
  assert.deepEqual(fitDims(null, undefined), { w: 320, h: 240 });
});

test('the summary distinguishes created from updated — that is the re-run signal', () => {
  const s = summarize([
    { ok: true, created: true }, { ok: true, created: true },
    { ok: true, created: false }, { ok: false },
  ]);
  assert.deepEqual(s, { imported: 2, updated: 1, failed: 1 });
});

test('concurrency is bounded and order is preserved', async () => {
  // The caller matches results to the manifest they sent BY INDEX, so a faster
  // item finishing first must not move it.
  let inFlight = 0; let peak = 0;
  const out = await mapWithConcurrency([...Array(20).keys()], 6, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, (20 - n) % 7));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [...Array(20).keys()].map((n) => n * 2));
  assert.ok(peak <= 6, `ran ${peak} at once`);
  assert.ok(peak > 1, 'and it is actually concurrent');
});

test('one item failing does not abandon the rest', async () => {
  const out = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) return { ok: false, error: 'gone' };
    return { ok: true, n };
  });
  assert.equal(out.length, 3);
  assert.equal(out[1].ok, false);
  assert.equal(out[2].ok, true);
});
