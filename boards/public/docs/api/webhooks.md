# Webhooks

> Register an HTTPS endpoint and Soleil Clusters posts to it when boards and cards change — including changes made by people working in the app, not only changes made through the API. Every delivery is signed with HMAC-SHA256 over the timestamp and body, retried with exponential backoff for over twelve hours, and recorded in a delivery log you can inspect and replay.

_Source: https://clusters.soleilpictures.com/docs/api/webhooks · Updated 2026-08-09_

Register an HTTPS endpoint and we post to it when something changes.

**Including changes made in the app.** That is the part worth stating plainly:
events come from the database, not from the API request handler, so a card
someone drags on the canvas fires the same event as one added by your importer.
A webhook that only saw API traffic would miss almost everything that actually
happens to a board.

## Register one

```sh
curl -X POST "$SOLEIL_API/webhooks" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"workspace_id":"'$WS'","url":"https://hooks.example.com/soleil",
       "events":["card.created","card.updated","board.created"],
       "name":"pipeline sync"}'
```

```json
{ "webhook": { "id": "a2c4…", "url": "https://hooks.example.com/soleil",
               "events": ["card.created","card.updated","board.created"], "active": true },
  "secret": "whsec_…",
  "next": "Verify each delivery: HMAC-SHA256 of \"v0:{timestamp}:{body}\", compared with the X-Soleil-Signature header." }
```

**`secret` is returned once and never again.** There is no read path for it,
over the API or in the database.

The URL must be **public HTTPS on the default port**. We fetch it from our own
address on a schedule, which is the shape of a server-side request forgery, so
private ranges, loopback, metadata hosts and non-default ports are refused.

Pass `"events": ["*"]` to subscribe to everything, including event types added
later. An unknown event name is a `400` rather than a subscription that never
fires — "subscribed and silent" is the hardest webhook failure to diagnose.

## Events

| Event | When |
|---|---|
| `board.created` | A board is created |
| `board.updated` | Its name, view or parent changes |
| `board.deleted` | Soft-deleted, or removed outright |
| `board.restored` | Brought back from the trash |
| `card.created` | Cards are added to a board |
| `card.updated` | Their text or contents change |
| `card.deleted` | Cards are removed |
| `card.moved` | Cards move to another board |
| `image.created` | An upload completes |

**Card events are grouped.** A single operation on a board produces one event
carrying a count, not one per card — so importing a thousand cards is one
delivery, not a thousand. `data.card_ids` carries the first 25 as a courtesy;
past that, read the board.

## The payload

```json
{
  "type": "card.created",
  "resource": { "type": "card", "id": "…" },
  "workspace": { "id": "3b7e…" },
  "board": { "id": "9f1c…" },
  "data": { "count": 412, "card_ids": ["…", "…"] },
  "occurred_at": "2026-08-09T12:00:00.412Z"
}
```

Deliberately thin. A payload is a copy of the truth, and a copy goes stale
between being sent and being read — worse, it goes stale *silently*. You get
enough to know what to look at; call back for current state, with
[`?since=`](/docs/api/boards) if you want everything that moved.

## Verifying a delivery

| Header | |
|---|---|
| `X-Soleil-Signature` | `v0=<hex>` |
| `X-Soleil-Request-Timestamp` | Unix seconds |
| `X-Soleil-Event` | The event type |
| `X-Soleil-Delivery` | This delivery's id — useful in your own logs |

Compute `HMAC-SHA256(secret, "v0:" + timestamp + ":" + rawBody)` and compare it
with the signature. **Use the raw body**, before any JSON parsing — re-serializing
changes the bytes and the signature will not match.

```python
import hmac, hashlib, time

def verify(secret, headers, raw_body):
    ts = headers["X-Soleil-Request-Timestamp"]
    if abs(time.time() - int(ts)) > 300:        # five-minute replay window
        return False
    expected = "v0=" + hmac.new(
        secret.encode(), f"v0:{ts}:".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, headers["X-Soleil-Signature"])
```

This is the same scheme Frame.io uses, on purpose — if you have integrated with
them, the verifier you already wrote works here.

Reject anything outside the five-minute window, and compare in constant time.

## Retries

Six attempts: after **1 minute, 5 minutes, 25 minutes, ~2 hours and ~10 hours**.
That is over twelve hours in total, so an endpoint that is down overnight still
receives its events.

Any non-2xx, or a connection failure, counts as a failure. Respond `2xx` as soon
as you have durably accepted the delivery and do your work afterwards — a slow
receiver is a retried receiver. We give up on a single delivery after ten
seconds.

After **20 consecutive failures** across all deliveries a webhook is switched
off, with `disabled_reason` saying why. A single success resets the counter, so
this only ever fires for a genuinely dead endpoint. Re-enable with
`PATCH /webhooks/:id {"active": true}`, which also clears the failure state.

## The delivery log

```sh
curl "$SOLEIL_API/webhooks/$HOOK/deliveries?limit=50" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

Every attempt, with its status, duration, error and the exact payload sent.
"We sent it" without a record is not an answer, so there is a record.

```sh
# Send a real delivery through the real path, to check signing end to end
curl -X POST "$SOLEIL_API/webhooks/$HOOK/test" -H "Authorization: Bearer $SOLEIL_TOKEN"

# Replay one you missed
curl -X POST "$SOLEIL_API/webhooks/$HOOK/deliveries/$DELIVERY/redeliver" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"
```

`POST /webhooks/:id/test` sends through the delivery path everything else uses,
so what it proves is what will actually happen.
`POST /webhooks/:id/deliveries/:deliveryId/redeliver` requeues rather than
sending inline, so a replay is retried and recorded exactly like any other
delivery.

Deliveries are kept for 30 days.

## Managing them

```sh
curl "$SOLEIL_API/webhooks?workspace=$WS" -H "Authorization: Bearer $SOLEIL_TOKEN"
curl -X PATCH "$SOLEIL_API/webhooks/$HOOK" -H "Authorization: Bearer $SOLEIL_TOKEN" \
  -H "Content-Type: application/json" -d '{"events":["*"],"active":true}'
curl -X DELETE "$SOLEIL_API/webhooks/$HOOK" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

Up to 20 active webhooks per workspace. Listing never returns
the secret.

## Timing

An event caused by an API call is delivered **immediately**. An event caused by
someone working in the app is picked up within a minute. Both go through the
same queue and the same retry policy; only the pickup differs.
