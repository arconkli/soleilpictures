---
title: API Quickstart — Soleil Clusters
metaDescription: Working Soleil Clusters API examples in curl, TypeScript and Python — authenticate, create a board, add cards, read them back and clean up.
h1: API quickstart
navLabel: Quickstart
section: developers
order: 1
updated: 2026-08-08
answer: Mint a token with write access under Settings then API, export it, and you can create a board and add cards in two requests. This page has the whole loop — authenticate, create, add, upload an image, read, update, move, delete — as copy-pasteable curl, TypeScript and Python, with the retry and error handling an agent needs.
faq:
  - q: What is the smallest useful request?
    a: GET /me with your bearer token. It confirms the token works and tells you which scopes it has and how much rate budget is left, before you try to write anything.
  - q: Do I need to create a workspace first?
    a: No. Creating a board without a workspace_id puts it in your personal workspace, creating one if it does not exist.
  - q: How do I add an image?
    a: Two requests. POST the bytes to /uploads to get an image_key, then create a card with kind image and that key.
related:
  - /docs/api
  - /docs/api/cards
  - /docs/mcp
---

## 1. Get a token

In the app: **Settings → API → New token**. Tick **Allow writes** if you intend
to change anything. Copy it immediately — it is shown once.

```sh
export SOLEIL_TOKEN="{{fact:tokenPrefix}}…"
export SOLEIL_API="{{fact:siteOrigin}}/api/v1"
```

## 2. Check it works

```sh
curl -s "$SOLEIL_API/me" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

```json
{
  "user_id": "…", "display_name": "Andrew", "tier": "paid",
  "scopes": ["read", "write"],
  "rate_limit": { "limit": 1000, "remaining": 993, "reset": 1786000000 }
}
```

Always do this first. It confirms the token is live, tells you which scopes you
have before you find out the hard way, and reports your remaining rate budget.

## 3. Create a board and add cards

```sh
BOARD=$(curl -s -X POST "$SOLEIL_API/boards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Scene 4 — Diner"}' | jq -r .board.id)

curl -s -X POST "$SOLEIL_API/boards/$BOARD/cards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"cards":[
        {"kind":"note","title":"Tone","body":"Warm, low-key, practicals only"},
        {"kind":"link","url":"https://example.com/reference"}
      ]}'
```

Cards without `x`/`y` are placed in free space, so they cannot land on top of
what is already there.

## 4. Add an image

Two requests: bytes up, then a card referencing what came back.

```sh
KEY=$(curl -s -X POST "$SOLEIL_API/uploads?board=$BOARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @frame.jpg | jq -r .image_key)

curl -s -X POST "$SOLEIL_API/boards/$BOARD/cards" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"kind\":\"image\",\"image_key\":\"$KEY\",\"alt\":\"Diner counter, night\"}"
```

See [Images API](/docs/api/images) for formats, the
{{fact:maxUploadMb}} ceiling and quota behaviour.

## TypeScript

```ts
const API = "{{fact:siteOrigin}}/api/v1";
const TOKEN = process.env.SOLEIL_TOKEN!;   // never ship this to a browser

async function soleil<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      // Idempotency-Key makes a retried POST replay rather than duplicate.
      ...(init.method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body.error ?? res.statusText}`);
  return body as T;
}

const { board } = await soleil<{ board: { id: string } }>("/boards", {
  method: "POST",
  body: JSON.stringify({ name: "Scene 4 — Diner" }),
});

await soleil(`/boards/${board.id}/cards`, {
  method: "POST",
  body: JSON.stringify({
    cards: [{ kind: "note", title: "Tone", body: "Warm, low-key" }],
  }),
});
```

## Python

```python
import os, uuid, requests

API   = "{{fact:siteOrigin}}/api/v1"
TOKEN = os.environ["SOLEIL_TOKEN"]

def soleil(method, path, json=None):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if method == "POST":
        headers["Idempotency-Key"] = str(uuid.uuid4())
    r = requests.request(method, f"{API}{path}", json=json, headers=headers)
    body = r.json() if r.content else {}
    if not r.ok:
        raise RuntimeError(f"{r.status_code} {body.get('error', r.reason)}")
    return body

board = soleil("POST", "/boards", {"name": "Scene 4 — Diner"})["board"]

soleil("POST", f"/boards/{board['id']}/cards", {
    "cards": [{"kind": "note", "title": "Tone", "body": "Warm, low-key"}]
})
```

## The rest of the loop

```sh
# Read everything on the board
curl -s "$SOLEIL_API/boards/$BOARD/cards" -H "Authorization: Bearer $SOLEIL_TOKEN"

# Change one card
curl -s -X PATCH "$SOLEIL_API/boards/$BOARD/cards/$CARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Tone — revised"}'

# Move cards to another board
curl -s -X POST "$SOLEIL_API/boards/$BOARD/cards/move" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d "{\"to_board_id\":\"$OTHER\",\"card_ids\":[\"$CARD\"]}"

# Delete — the response body IS the undo
curl -s -X DELETE "$SOLEIL_API/boards/$BOARD/cards/$CARD" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"
```

`DELETE` on a card returns the full card it removed. There is no undo toast on
an HTTP call, so the response body is the undo — `POST` it back to restore it.

## Notes for agents

- **Check `scopes` from `/me`** first. Writing needs `write`; deleting needs `delete`, which is a separate grant.
- **Always send `Idempotency-Key` on `POST`.** Network retries are otherwise duplicate writes.
- **Batch card creation.** Up to **{{fact:maxCardsPerCall}}** cards per call; one call with fifty cards beats fifty calls.
- **Watch `x-ratelimit-remaining`** on every response rather than waiting for the `429`. On a `429`, honour `retry-after`.
- **Paginate.** List endpoints return {{fact:defaultPage}} by default; follow `next_offset` until it is `null`.
- **Do not assume `live: true`.** A `false` means saved-but-not-pushed to open canvases.
- **`404` means "not found *or* not yours".** Do not retry it as if it were transient.
- **Branch on `code`, not the message.** Error prose may be reworded; codes are the contract.

Full error semantics: [Errors and status codes](/docs/api/errors).
