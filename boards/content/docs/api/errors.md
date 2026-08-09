---
title: API Errors and Status Codes — Soleil Clusters
metaDescription: Every Soleil Clusters API error code and what to do about it — which are retryable, which are permanent, and how idempotency interacts with retries.
h1: Errors and status codes
navLabel: Errors
section: developers
order: 7
updated: 2026-08-08
answer: Every error is JSON carrying a machine-readable code and a human sentence. Branch on the code, not the prose. Only 429 and 5xx are worth retrying; everything in the 400 range is a permanent statement about the request. A retried POST must reuse the same Idempotency-Key or it becomes a second real write.
faq:
  - q: Should I branch on the code or the message?
    a: The code. The human sentence is written for a person reading a log and may be reworded; the code is the contract.
  - q: Why do I get 404 for a board I know exists?
    a: Because it is not yours. The API returns 404 rather than 403 for invisible resources so it cannot be used to confirm what exists.
  - q: What is the difference between 402 and 403?
    a: 402 means a quota — the card cap or storage. 403 means permission — an insufficient scope, or a board you cannot write to.
related:
  - /docs/api
  - /docs/api/authentication
  - /docs/api/quickstart
---

Every error looks like this:

```json
{ "error": "at most 100 cards per call", "code": "bad_request" }
```

**Branch on `code`.** The sentence is written for a person reading a log and may
be reworded; the code is the contract.

## Codes

| Status | `code` | Means | Retry? |
|---|---|---|---|
| `400` | `bad_request` | Malformed — bad UUID, missing field, unknown card kind, too many cards | No |
| `401` | — | Missing, malformed, unknown, revoked or expired token | No |
| `402` | `limit_reached` | A quota — [card cap](/docs/canvas/cards) or storage | No |
| `403` | `forbidden` / `insufficient_scope` | Not permitted, or the token lacks the scope | No |
| `404` | `not_found` | Not found, **or** not visible to you | No |
| `405` | `method_not_allowed` | Wrong method for that path | No |
| `409` | `conflict` | Idempotency key in flight, or a refused reparent | Sometimes |
| `413` | `payload_too_large` | An [image](/docs/api/images) over {{fact:maxUploadMb}} | No |
| `415` | `unsupported_media_type` | Upload with a missing or unrecognised `Content-Type` | No |
| `429` | — | [Rate limited](/docs/api/authentication) | Yes, after `retry-after` |
| `502` | `session_unavailable` | An upstream dependency is unreachable | Yes |
| `502` | `upstream_error` | A dependency answered, but not successfully | Yes |
| `503` | `storage_unavailable` | Image storage is temporarily unavailable | Yes |

## The ones worth explaining

**`401`** — unknown, revoked and expired tokens are indistinguishable on
purpose, so probing cannot reveal which tokens existed.

**`403 insufficient_scope`** — the response names the scope required in
`required_scope`. Deleting needs the `delete` scope, which is separate from
`write` precisely so "can add cards to my moodboard" and "can destroy my
moodboard" are different grants.

**`402` versus `403`** — `402` is a quota you could pay to lift; `403` is a
permission you cannot.

**`404`** — returned both for things that do not exist and for things you cannot
see. Do not retry it and do not treat it as transient.

**`409`** — two causes. An `Idempotency-Key` whose first attempt is still in
flight, in which case waiting briefly and retrying **with the same key** is
correct; or a reparent that would create a cycle, which is permanent.

**`429`** — respect the `retry-after` header, in seconds. Every response carries
`x-ratelimit-remaining` and `x-ratelimit-reset`, so a well-behaved client never
has to hit the wall to discover the wall.

## Retrying safely

```ts
async function withRetry<T>(fn: () => Promise<Response>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fn();
    if (res.ok) return res.json() as Promise<T>;

    const body = await res.json().catch(() => ({} as any));
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || i >= tries - 1) {
      throw new Error(`${res.status} ${body.code ?? ""} ${body.error ?? ""}`);
    }
    // Honour the server's own answer before guessing.
    const after = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(after) && after > 0
      ? after * 1000
      : 2 ** i * 1000));
  }
}
```

> **Warning:** A retried `POST` must carry the **same** `Idempotency-Key` as the
> original. A fresh key on every attempt turns one intended write into several
> real ones.

## Idempotency and errors

A key is stored with its response when the request finishes with any status
below `500`, so a retry replays that response — **including a `4xx`**. A request
that failed validation keeps reporting the same failure under that key, which is
correct: the request was bad and still is.

On a `5xx` the key is released, so the retry genuinely re-runs.

A replayed response carries `idempotent-replay: true`.

## Successes that are not quite successes

Two responses mean less than they look:

- **`"live": false`** on a card write — saved, but open canvases will not show it until reload. Not a failure.
- **`has_more: true`** on a list — you have one page, not the answer. Follow `next_offset`.
