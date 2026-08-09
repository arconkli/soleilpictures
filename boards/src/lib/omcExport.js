// A board as MovieLabs OMC-JSON.
//
// WHY THIS EXISTS. Every system in a film studio's pipeline models the
// artifact — ShotGrid and ftrack model production tasks and versions, iconik
// and CatDV model files, Frame.io models review decisions. None of them models
// the intent: you can reconstruct that a comp reached v27, and not what the
// director was looking at when they asked for the change. Five years later a
// sequel team reconstructs the creative context by screenshotting the finished
// film, because the mood boards were never assets in any system with a
// retention policy.
//
// MovieLabs' Ontology for Media Creation — the studios' own standard, owned by
// the major studios — already has the vocabulary for exactly this. From the
// v2.8 schema:
//
//   structuralType : "assetGroup", with structuralProperties.assetGroup.isOrdered
//   functionalType : "creativeReferenceMaterial", "artwork.conceptArt",
//                    "artwork.storyboard", "artwork.storyboard.frame", …
//
// and MovieLabs' own reference example models a storyboard as an ORDERED
// assetGroup of image assets — which is structurally a cluster. So a board maps
// onto this without inventing anything.
//
// WHAT THIS IS NOT. It is an export, not a data model. Nothing about the
// product's schema changes to accommodate OMC; this reads what is already
// there. A caller says which functional type its board represents by setting
// `omc.functionalType` in the board's props, and the default is the honest one:
// creativeReferenceMaterial.

export const OMC_SCHEMA = 'https://movielabs.com/omc/json/schema/v2.8';

// The subset of the v2.8 functionalType vocabulary that a board of reference
// images can honestly claim. Anything else is refused rather than passed
// through, because emitting a value outside the controlled vocabulary produces
// a document that says it validates and does not.
export const BOARD_FUNCTIONAL_TYPES = [
  'creativeReferenceMaterial',
  'technicalReferenceMaterial',
  'artwork',
  'artwork.conceptArt',
  'artwork.storyboard',
  'artwork.animatedStoryboard',
];

const CARD_FUNCTIONAL_TYPE = {
  'artwork.storyboard': 'artwork.storyboard.frame',
  'artwork.animatedStoryboard': 'artwork.storyboard.frame',
  'artwork.conceptArt': 'artwork.conceptArt',
};

// structuralType for the essence behind a card.
const STRUCTURAL_TYPE = {
  image: 'digital.image',
  video: 'digital.movingImage',
  audio: 'digital.audio',
  doc: 'digital.structuredDocument',
  note: 'digital.structuredDocument',
  link: 'digital.document',
  pdf: 'digital.document',
  file: 'digital.data',
};

// Every entity carries an identifier array of {identifierScope, identifierValue}.
// Ours comes first so the document is self-referential, then every foreign
// identifier the object carries — which is MovieLabs' explicit instruction:
// preserve the identifiers other participants assigned rather than replacing
// them with your own.
function identifiersFor(scope, ourValue, foreign) {
  return [
    { identifierScope: 'soleil', identifierValue: `${scope}/${ourValue}` },
    ...(foreign || []).map((i) => ({
      identifierScope: i.scope,
      identifierValue: i.value,
    })),
  ];
}

function assetForCard(card, meta, { parentType, origin }) {
  const kind = card.kind || 'note';
  const functionalType = CARD_FUNCTIONAL_TYPE[parentType]
    || (kind === 'image' ? 'creativeReferenceMaterial' : 'technicalReferenceMaterial');

  const structuralProperties = {};
  if (card.image_key) {
    structuralProperties.linkset = {
      recordType: 'item',
      mediaType: 'image/*',
      // A resolvable URL rather than a bare key. An archival document whose
      // references only mean something to the system that wrote it is the
      // problem this format exists to avoid.
      ...(origin ? { url: `${origin}/api/v1/images/${card.image_key}` } : {}),
    };
    structuralProperties.fileDetails = { fileName: card.image_key.split('/').pop() };
  }

  const asset = {
    entityType: 'Asset',
    schemaVersion: OMC_SCHEMA,
    identifier: identifiersFor('card', card.id, meta?.identifiers),
    name: card.title || card.body?.slice(0, 80) || card.id,
    AssetSC: {
      identifier: identifiersFor('cardEssence', card.id, []),
      structuralType: STRUCTURAL_TYPE[kind] || 'digital.data',
      ...(Object.keys(structuralProperties).length ? { structuralProperties } : {}),
    },
    assetFC: { functionalType },
  };

  if (card.alt || card.body) asset.description = String(card.alt || card.body).slice(0, 500);
  // customData is the ontology's own escape hatch for information it does not
  // model, which is exactly what a caller's props are.
  if (meta?.props && Object.keys(meta.props).length) asset.customData = meta.props;
  return asset;
}

/**
 * Render a board and its cards as an OMC-JSON Asset.
 *
 * The board becomes an ORDERED assetGroup — ordered because a board is a
 * composition and the arrangement carries meaning; an unordered pile would
 * discard the one thing that distinguishes a board from a folder. Order is
 * reading order: top to bottom, then left to right.
 */
export function boardToOmc({ board, cards, boardMeta, cardMeta, origin }) {
  const props = boardMeta?.props || {};
  const requested = props['omc.functionalType'];
  if (requested && !BOARD_FUNCTIONAL_TYPES.includes(requested)) {
    const e = new Error(
      `omc.functionalType must be one of ${BOARD_FUNCTIONAL_TYPES.join(', ')} — got ${JSON.stringify(requested)}`);
    e.status = 400;
    e.code = 'bad_request';
    throw e;
  }
  const functionalType = requested || 'creativeReferenceMaterial';

  const ordered = [...(cards || [])].sort((a, b) => {
    const ay = Number.isFinite(a.y) ? a.y : 0;
    const by = Number.isFinite(b.y) ? b.y : 0;
    // A row band, not exact equality: cards a designer laid out in a row are
    // never at identical y, and sorting strictly by y would interleave two rows
    // into an order nobody arranged.
    if (Math.abs(ay - by) > 80) return ay - by;
    return (Number.isFinite(a.x) ? a.x : 0) - (Number.isFinite(b.x) ? b.x : 0);
  });

  const doc = {
    schemaVersion: OMC_SCHEMA,
    entityType: 'Asset',
    identifier: identifiersFor('board', board.id, boardMeta?.identifiers),
    name: board.name,
    AssetSC: {
      identifier: identifiersFor('boardEssence', board.id, []),
      structuralType: 'assetGroup',
      structuralProperties: { assetGroup: { isOrdered: true } },
    },
    assetFC: { functionalType },
    Asset: ordered.map((c) => assetForCard(c, cardMeta?.get(String(c.id)), {
      parentType: functionalType, origin,
    })),
  };

  if (board.created_at || board.updated_at) {
    doc.instanceInfo = {
      ...(board.created_at ? { createdOn: board.created_at } : {}),
      ...(board.updated_at ? { lastUpdatedOn: board.updated_at } : {}),
    };
  }
  const custom = { ...props };
  delete custom['omc.functionalType'];
  if (Object.keys(custom).length) doc.customData = custom;

  return doc;
}
