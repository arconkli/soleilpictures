---
title: Identifiers and Properties — Soleil Clusters API
metaDescription: Attach foreign IDs and structured fields to boards and cards, look objects up by them, and run the same import twice without duplicating anything.
h1: Identifiers and properties
navLabel: Identifiers and properties
section: developers
order: 7
updated: 2026-08-09
answer: An identifier is a scope and value pair assigned by another system, like shotgrid and Shot:12345. Attach as many as you like to a board or a card, look objects up by them with GET /resolve, and pass on_conflict identifier when creating so an object that already carries one is updated instead of duplicated. That is what makes an import re-runnable. Properties are a free-form JSON object on the same objects, for whatever fields your pipeline needs.
faq:
  - q: How do I stop a re-run of my import from duplicating everything?
    a: Give each board and card an identifier from your own system, and pass "on_conflict":"identifier" when you create. Anything already carrying that identifier is updated in place, and the response tells you which were created and which were updated.
  - q: How do I find the board for a shot I have the ID of?
    a: GET /resolve?scope=shotgrid&value=Shot:12345. You do not have to keep your own map of which board you made for which shot.
  - q: Can two boards claim the same identifier?
    a: No. An identifier is unique per workspace, per object type. That is what makes create-or-update deterministic rather than hopeful.
  - q: Are properties typed or validated?
    a: No. They are free-form JSON, because the fields a production needs are not fields this product can guess. Up to 100 keys and 16KB per object.
  - q: Do properties show up in the app?
    a: Not yet. They are stored, queryable and exportable today; surfacing them on the canvas is separate work.
related:
  - /docs/api/boards
  - /docs/api/cards
  - /docs/api/export
---

Everything in your pipeline already has a name. The shot is `ABC_0100_0010`, the
asset is `Shot:12345` in production tracking, the file has a checksum. An API
that cannot record any of that leaves you maintaining a mapping table on the
side, forever, and re-running an import creates a second copy of everything.

Two things fix that, and they apply to boards, cards and images alike.

## Identifiers

An identifier is a `scope` and a `value` — the system that assigned it, and what
it assigned. An object can carry several, from several systems.

```sh
curl -X POST "$SOLEIL_API/boards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "name": "Costume — Sven, fall sequence",
    "workspace_id": "'$WS'",
    "identifiers": [
      {"scope": "shotgrid", "value": "Sequence:88"},
      {"scope": "ftrack",   "value": "a3f1-…"}
    ]
  }'
```

`scope` is case-folded, because "ShotGrid" and "shotgrid" are the same system
and letting both exist would quietly defeat the uniqueness below. `value` is
kept exactly as you gave it.

**An identifier is unique per workspace, per object type.** Two boards cannot
both claim `shotgrid / Sequence:88`. That constraint is the whole feature — it
is what turns "create the board for this sequence" from a hopeful operation into
a deterministic one.

Up to {{fact:maxIdentifiersPerObject}} per object.

### Re-runnable imports

Pass `"on_conflict": "identifier"` when creating, and anything already carrying
one of the identifiers you supplied is **updated in place** instead of created
again.

```sh
curl -X POST "$SOLEIL_API/boards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"on_conflict":"identifier","boards":[
        {"name":"SEQ 0100","identifiers":[{"scope":"shotgrid","value":"Sequence:88"}]},
        {"name":"SEQ 0200","identifiers":[{"scope":"shotgrid","value":"Sequence:89"}]}
      ]}'
```

```json
{ "boards": [ { "id": "3b7e…", "name": "SEQ 0100", "created": false }, … ],
  "created": 1, "updated": 1 }
```

Each item reports whether it was `created`. **The id of an updated object does
not change**, so your own record of what you made last time stays valid.

The same flag works on `POST /boards/:id/cards`. Run your importer twice over
three million assets and you get three million objects, not six.

### Two refusals rather than a guess

`409 identifier_conflict` in two cases, both of which have no correct answer:

- one item whose identifiers match **two different existing objects** — picking
  one would silently merge two records
- a card whose identifier already lives **on a different board** — the response
  names the board, so you can move it or use a different identifier. Quietly
  doing nothing would leave you believing the card is on your board when it is
  not.

### Looking things up

```sh
curl "$SOLEIL_API/resolve?scope=shotgrid&value=Sequence:88" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{ "scope": "shotgrid", "value": "Sequence:88",
  "matches": [
    { "object_type": "board", "object_id": "3b7e…", "board_id": "3b7e…",
      "workspace_id": "9f1c…", "url": "/api/v1/boards/3b7e…",
      "created_at": "2026-08-09T12:00:00Z" }
  ] }
```

`matches` is a list because an identifier is unique per **workspace**, not
globally — if you belong to two workspaces that both track the same upstream
record, you get both and choose. Filter with `type` (`board`, `card`, `image`)
and `workspace`.

You only ever see what you could already see: this reads the same table under
the same permissions as everything else, so an identifier on someone else's
board simply is not there.

## Properties

A free-form JSON object on the same objects, for the fields your pipeline
actually has.

```sh
curl -X PATCH "$SOLEIL_API/boards/$BOARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"props":{"scene":"14A","department":"costume","status":"approved","version":3}}'
```

Deliberately untyped. The shape a production needs — scene, department, camera
roll, clearance status — is not a shape this product can guess, and getting it
wrong would be worse than not having one.

**Props are patched, not replaced.** Send only the keys you own; the rest are
left alone. A `null` value removes a key, which is the only way to say "remove"
when leaving it out already means "don't touch":

```json
{"props": {"status": "final", "draft_note": null}}
```

That matters because several systems usually write to the same object, and an
integration that owns one field should not have to read-modify-write the whole
bag and race everything else.

| | |
|---|---|
| **Keys** | {{fact:maxPropKeys}} per object |
| **Size** | {{fact:maxPropsBytes}} bytes per object, serialized |
| **Reserved** | Keys beginning `soleil.` |
| **Types** | Any JSON — strings, numbers, booleans, arrays, objects |

## Reading them back

Neither is returned by default, because most callers do not use them and every
field on a list response is paid for a thousand times over. Ask:

```sh
curl "$SOLEIL_API/boards/$BOARD?include=props,identifiers" -H "Authorization: Bearer $SOLEIL_TOKEN"
curl "$SOLEIL_API/boards/$BOARD/cards?include=identifiers" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

A misspelled `include` is a `400`, not a silent omission — otherwise the
difference between "my props are missing" and "I typed `propz`" is undebuggable.

## Where this data lives

Not in the board document. Three reasons, each sufficient on its own: the
document's edit history never shrinks, so a field bag per card would grow it
permanently; the card search index is rebuilt from the card on every write, so
anything written there is destroyed by the next edit; and looking things up by
identifier needs a real index, which a collaborative document cannot provide.

The practical consequence is a good one — **identifiers and properties survive
edits to the card**, including edits made by someone dragging it around in the
app.
