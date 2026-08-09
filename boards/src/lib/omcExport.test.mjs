// omcExport — a board as MovieLabs OMC-JSON.
//
// Worth testing carefully because being wrong here is INVISIBLE: a document
// that carries a functionalType outside the controlled vocabulary, or drops the
// isOrdered flag, still looks like valid JSON and still parses. It fails much
// later, in somebody else's validator, in a procurement conversation.
//
// The vocabulary asserted below is quoted from the v2.8 schema
// (OMC-JSON-v2.8.schema.json), not invented here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boardToOmc, OMC_SCHEMA, BOARD_FUNCTIONAL_TYPES } from './omcExport.js';

const board = {
  id: 'b0000000-0000-0000-0000-000000000001',
  name: 'Costume — Sven, fall sequence',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-09T10:00:00Z',
};

const card = (over = {}) => ({
  id: 'c1', kind: 'image', title: 'Blaster dodge',
  x: 0, y: 0, w: 280, h: 180, image_key: 'ws/abc.jpg', alt: 'Sven dodges', ...over,
});

const omc = (over = {}) => boardToOmc({
  board, cards: [card()], boardMeta: {}, cardMeta: new Map(), origin: 'https://x.test', ...over,
});

test('a board is an ORDERED assetGroup — the thing that makes it not a folder', () => {
  const d = omc();
  assert.equal(d.entityType, 'Asset');
  assert.equal(d.schemaVersion, OMC_SCHEMA);
  assert.equal(d.AssetSC.structuralType, 'assetGroup');
  // Drop this and a board becomes an unordered pile, discarding the one thing
  // that distinguishes a composition from a directory listing.
  assert.equal(d.AssetSC.structuralProperties.assetGroup.isOrdered, true);
});

test('the default functional type is the honest one', () => {
  assert.equal(omc().assetFC.functionalType, 'creativeReferenceMaterial');
});

test('a caller can declare what the board is, from the real vocabulary', () => {
  for (const t of BOARD_FUNCTIONAL_TYPES) {
    const d = omc({ boardMeta: { props: { 'omc.functionalType': t } } });
    assert.equal(d.assetFC.functionalType, t);
  }
});

test('a functionalType outside the vocabulary is REFUSED, not passed through', () => {
  // Passing it through would produce a document that claims to validate and
  // does not — the failure would surface in someone else's validator.
  assert.throws(
    () => omc({ boardMeta: { props: { 'omc.functionalType': 'artwork.moodboard' } } }),
    (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, /must be one of/);
      return true;
    });
});

test('a storyboard board makes its children storyboard FRAMES', () => {
  // MovieLabs' own reference example: an ordered assetGroup of
  // artwork.storyboard.frame. The child type follows from the parent's.
  const d = omc({ boardMeta: { props: { 'omc.functionalType': 'artwork.storyboard' } } });
  assert.equal(d.Asset[0].assetFC.functionalType, 'artwork.storyboard.frame');
});

test('card kinds map onto real structuralType values', () => {
  const kinds = {
    image: 'digital.image', video: 'digital.movingImage', audio: 'digital.audio',
    doc: 'digital.structuredDocument', link: 'digital.document', file: 'digital.data',
  };
  for (const [kind, structural] of Object.entries(kinds)) {
    const d = omc({ cards: [card({ kind, image_key: null })] });
    assert.equal(d.Asset[0].AssetSC.structuralType, structural, kind);
  }
  assert.equal(omc({ cards: [card({ kind: 'palette', image_key: null })] })
    .Asset[0].AssetSC.structuralType, 'digital.data', 'an unmodelled kind falls back, it does not throw');
});

test('every entity carries an identifier array, ours first then everyone else’s', () => {
  // MovieLabs is explicit: preserve the identifiers other participants
  // assigned. An export that replaced them with our own would destroy the join
  // back to the system the material came from.
  const d = omc({
    boardMeta: { identifiers: [{ scope: 'shotgrid', value: 'Sequence:88' }] },
    cardMeta: new Map([['c1', { identifiers: [{ scope: 'ftrack', value: 'AssetVersion:9' }] }] ]),
  });
  assert.deepEqual(d.identifier, [
    { identifierScope: 'soleil', identifierValue: `board/${board.id}` },
    { identifierScope: 'shotgrid', identifierValue: 'Sequence:88' },
  ]);
  assert.deepEqual(d.Asset[0].identifier, [
    { identifierScope: 'soleil', identifierValue: 'card/c1' },
    { identifierScope: 'ftrack', identifierValue: 'AssetVersion:9' },
  ]);
});

test('an image reference resolves — a key alone would mean nothing outside here', () => {
  const d = omc();
  assert.equal(d.Asset[0].AssetSC.structuralProperties.linkset.url,
    'https://x.test/api/v1/images/ws/abc.jpg');
  assert.equal(d.Asset[0].AssetSC.structuralProperties.fileDetails.fileName, 'abc.jpg');
});

test('props ride along as customData, minus the one that was an instruction', () => {
  const d = omc({
    boardMeta: { props: { 'omc.functionalType': 'artwork.conceptArt', scene: '14A', dept: 'costume' } },
  });
  assert.deepEqual(d.customData, { scene: '14A', dept: 'costume' },
    'omc.functionalType selected the type; it is not itself content');
  assert.equal(d.assetFC.functionalType, 'artwork.conceptArt');
});

test('a board with no props emits no customData key at all', () => {
  assert.equal('customData' in omc(), false);
});

test('order is reading order, and a row survives being laid out by hand', () => {
  // Exact y equality is the wrong rule: a designer's row is never pixel-aligned,
  // and sorting strictly by y interleaves two rows into an order nobody made.
  // The band has to be wide enough to hold a hand-placed row together.
  const cards = [
    card({ id: 'r1c2', x: 400, y: 4 }),
    card({ id: 'r2c1', x: 0, y: 600 }),
    card({ id: 'r1c1', x: 0, y: 0 }),
    card({ id: 'r2c2', x: 400, y: 611 }),
  ];
  assert.deepEqual(
    omc({ cards }).Asset.map((a) => a.identifier[0].identifierValue),
    ['card/r1c1', 'card/r1c2', 'card/r2c1', 'card/r2c2']);
});

test('a card with no coordinates does not crash the ordering', () => {
  const cards = [card({ id: 'a', x: undefined, y: undefined }), card({ id: 'b', x: 10, y: 10 })];
  assert.equal(omc({ cards }).Asset.length, 2);
});

test('an empty board is a valid, empty assetGroup', () => {
  const d = omc({ cards: [] });
  assert.deepEqual(d.Asset, []);
  assert.equal(d.AssetSC.structuralType, 'assetGroup');
});

test('instanceInfo carries the timestamps the ontology asks for', () => {
  assert.deepEqual(omc().instanceInfo, {
    createdOn: '2026-08-01T10:00:00Z',
    lastUpdatedOn: '2026-08-09T10:00:00Z',
  });
});
