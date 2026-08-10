---
title: Audit Log — Soleil Clusters API
metaDescription: Read who changed what through the API, and who fetched image bytes, with cursor paging. Covers your own calls and your service accounts'.
h1: Audit log
navLabel: Audit log
section: developers
order: 14
updated: 2026-08-09
answer: GET /audit returns a record of every write made through the API and every fetch of image bytes, newest first, cursor-paged. You see your own activity, and if you own a workspace you also see everything its service accounts did. Entries carry the actor, the token used, the method and templated route, the object touched, the status and the duration.
faq:
  - q: Does this cover changes made in the app?
    a: No. It records writes through /api/v1 and reads of image bytes. Edits someone makes on the canvas are not in it.
  - q: Whose activity can I see?
    a: Your own, plus every service account belonging to a workspace you own.
  - q: Why are ordinary reads not recorded?
    a: They are the bulk of API traffic and mostly noise. Fetching image bytes is the exception, because that is content leaving.
  - q: How long is it kept?
    a: 30 days.
related:
  - /docs/api/service-accounts
  - /docs/api/authentication
  - /docs/api/errors
---

```sh
curl "$SOLEIL_API/audit?limit=100" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{
  "entries": [
    { "id": "80421", "at": "2026-08-09T12:00:04.120Z",
      "actor": "Pipeline sync", "actor_id": "9f1c…",
      "token_id": "a2c4…", "token_name": "Pipeline sync token",
      "method": "POST", "route": "/boards/:id/cards",
      "target_id": "3b7e…", "status": 201, "ms": 214 }
  ],
  "limit": 100,
  "has_more": true,
  "next_cursor": "80421",
  "covers": "writes made through /api/v1 and reads of image bytes"
}
```

Newest first. Pass `next_cursor` back as `cursor`, and `since` to bound it by
time.

## What is in it

| | |
|---|---|
| **Writes** | Every `POST`, `PATCH` and `DELETE` through `/api/v1` |
| **Image reads** | Every fetch of `GET /images/:key` |
| **Not included** | Ordinary reads, and anything done in the app |
| **Retention** | 30 days |

Ordinary reads are left out because they are the bulk of API traffic and are
mostly noise. Image bytes are the exception, and deliberately so: that request
is content **leaving**, which is the thing a security review actually asks
about.

`route` is the **templated** path — `/boards/:id/cards`, not the specific board
— with the object in `target_id`. That way the log groups by operation and you
can still see what each one touched.

## Whose activity

Your own, plus every [service account](/docs/api/service-accounts) belonging to
a workspace you own. `actor` is the service account's name, or the person's
display name.

That pairing is the point. A service account is a credential a team depends on,
and being unable to see what it did would make it exactly the kind of anonymous
shared secret it exists to replace.

Disabling a service account does not remove it from the log: the record is kept
so past entries still resolve to a name rather than a deleted id.

## What this is not

It is not a complete history of a board. Changes made on the canvas do not
appear here, because this records API traffic, not edits. If you need to know
that a board changed — whoever changed it — use
[`GET /boards?since=`](/docs/api/boards), or subscribe to a
[webhook](/docs/api/webhooks), both of which see app activity too.
