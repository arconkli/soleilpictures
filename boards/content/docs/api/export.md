---
title: Exporting a Board — Soleil Clusters API
metaDescription: Get a whole board out, either as complete JSON or as MovieLabs OMC-JSON, the ontology film studios use to describe creative material.
h1: Export
navLabel: Export
section: developers
order: 9
updated: 2026-08-09
answer: GET /boards/:id/export returns a whole board in one call. The default format is complete JSON, including the internal form of every card, so nothing is lost for kinds the API does not otherwise describe. Pass format=omc for MovieLabs OMC-JSON, which models the board as an ordered assetGroup of assets using the film industry's own controlled vocabulary for creative reference material.
faq:
  - q: How do I take a full backup of a board?
    a: GET /boards/:id/export. The default JSON format carries every card exactly as stored, plus its identifiers and properties.
  - q: What is OMC-JSON?
    a: The MovieLabs Ontology for Media Creation, the film industry's own standard for describing production material. A board maps onto it as an ordered assetGroup, which is how MovieLabs' own examples model a storyboard.
  - q: Why does the default card read lose information?
    a: It is a deliberate twelve-field projection, so kinds with structured interiors — grids, palettes, schedules — do not round-trip through it. Export, and include=raw on card reads, both give you the untruncated form.
  - q: Can I say what kind of material a board represents?
    a: Set omc.functionalType in the board's properties. Values outside the OMC controlled vocabulary are refused rather than passed through.
related:
  - /docs/api/metadata
  - /docs/api/boards
  - /docs/api/cards
---

```sh
curl "$SOLEIL_API/boards/$BOARD/export" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

One call, one board, everything on it.

## `format=json` — complete

The default. Every card **exactly as stored**, alongside the normal
[card projection](/docs/api/cards), plus
[identifiers and properties](/docs/api/metadata):

```json
{
  "format": "soleil.board.v1",
  "exported_at": "2026-08-09T12:00:00Z",
  "board": { "id": "3b7e…", "name": "Costume — fall sequence",
             "props": {…}, "identifiers": […] },
  "cards": [
    { "id": "c1", "kind": "image", "title": "Blaster dodge", "image_key": "…",
      "raw": { … the card as the canvas stores it … },
      "props": {…}, "identifiers": […] }
  ],
  "count": 128
}
```

`raw` is there because the ordinary card read is a deliberately narrow
twelve-field projection, and the app has kinds it does not describe — a grid
carries its cells and template, a palette its swatches, a schedule its rows.
Those read back through the projection with their interiors missing, which for
anyone taking a backup is data loss that looks like success.

`raw` is the card's **internal** shape. Field names in it are not part of this
API's contract and can change with the app. Use it to preserve or reconstruct;
do not build logic on it.

The same thing is available per-request on card reads with
`?include=raw`.

## `format=omc` — MovieLabs OMC-JSON

```sh
curl "$SOLEIL_API/boards/$BOARD/export?format=omc" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

The **Ontology for Media Creation** is the film industry's own standard for
describing production material, published by MovieLabs. A board maps onto it
directly, because OMC already has the vocabulary:

```json
{
  "schemaVersion": "https://movielabs.com/omc/json/schema/v2.8",
  "entityType": "Asset",
  "identifier": [
    { "identifierScope": "soleil",   "identifierValue": "board/3b7e…" },
    { "identifierScope": "shotgrid", "identifierValue": "Sequence:88" }
  ],
  "name": "Costume — fall sequence",
  "AssetSC": {
    "structuralType": "assetGroup",
    "structuralProperties": { "assetGroup": { "isOrdered": true } }
  },
  "assetFC": { "functionalType": "creativeReferenceMaterial" },
  "Asset": [
    { "entityType": "Asset",
      "identifier": [{ "identifierScope": "soleil", "identifierValue": "card/c1" }],
      "name": "Blaster dodge",
      "AssetSC": { "structuralType": "digital.image",
                   "structuralProperties": {
                     "linkset": { "recordType": "item", "mediaType": "image/*",
                                  "url": "https://…/api/v1/images/…" } } },
      "assetFC": { "functionalType": "creativeReferenceMaterial" } }
  ]
}
```

Three things worth pointing out.

**It is an *ordered* assetGroup.** A board is a composition, and the arrangement
carries meaning — an unordered set would discard the one thing that separates a
board from a folder. Order is reading order: rows top to bottom, then left to
right within a row.

**Your identifiers are preserved, not replaced.** MovieLabs is explicit that a
system should keep the identifiers other participants assigned. Ours comes
first so the document is self-referential; everything you attached follows.

**Image references resolve.** Each asset carries a real URL, not a bare storage
key, because an archival document whose references only mean something to the
system that wrote it is precisely the problem this format exists to avoid.

### Saying what the board is

Set `omc.functionalType` in the board's [properties](/docs/api/metadata):

```json
{"props": {"omc.functionalType": "artwork.storyboard"}}
```

| Value | For |
|---|---|
| `creativeReferenceMaterial` | The default — mood, tone, reference |
| `technicalReferenceMaterial` | Specifications, plates, technical notes |
| `artwork` | Artwork not otherwise specified |
| `artwork.conceptArt` | Concept art |
| `artwork.storyboard` | A storyboard |
| `artwork.animatedStoryboard` | An animatic |

A value outside that list is **refused with `400`** rather than passed through.
Emitting something outside the controlled vocabulary produces a document that
claims to validate and does not, and the failure would surface much later, in
someone else's validator.

On a storyboard, cards become `artwork.storyboard.frame` — which is exactly how
MovieLabs' own reference example models one.

Properties other than `omc.functionalType` ride along as `customData`, the
ontology's own escape hatch for what it does not model.

## What export is not

It is a read, so it is charged against your [rate limit](/docs/api/authentication)
like anything else, and it loads the whole board. For walking a large library,
[`?source=index` with `since`](/docs/api/cards) is the cheaper instrument —
export is for taking one board somewhere else.
