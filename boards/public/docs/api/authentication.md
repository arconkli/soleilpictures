# Authentication

> Create a personal access token under Settings then API and send it as a bearer token. Tokens start with sk_live_ and are stored only as a SHA-256 hash, so the value is shown exactly once. Three scopes exist — read, write and delete — and deleting is deliberately separate from writing. A token acts as you, reaches only what your account reaches, and revoking one takes effect immediately.

_Source: https://clusters.soleilpictures.com/docs/api/authentication · Updated 2026-08-08_

## Minting a token

**Settings → API → New token.** Give it a name that says where it will be used,
so you know which one to revoke later.

**Allow writes** is the only scope control. Leave it off for anything that only
needs to read.

The token is displayed **once**, at creation. It is the prefix
`sk_live_` followed by 40 hexadecimal characters — 160 bits of
randomness:

```
sk_live_<40 hex characters>
```

Only a SHA-256 hash is stored. There is no "show token" and no recovery — this
is deliberate, and it means a database compromise does not yield working
credentials.

> **Warning:** This format is identical in shape to a Stripe live secret key.
> Secret scanners — GitHub push protection among them — will flag a Soleil
> token as a Stripe key and block the commit. That is useful when a real token
> leaks, and a nuisance when you paste an example into a repo. Write examples
> as `sk_live_…` rather than spelling out 40 plausible characters.

## Using it

```sh
curl https://clusters.soleilpictures.com/api/v1/me \
  -H "Authorization: Bearer sk_live_…"
```

The scheme must be `Bearer`. A missing or malformed header gets `401` with a
`WWW-Authenticate` header.

## Scopes

Three: `delete` · `read` · `write`.

| Scope | Allows |
|---|---|
| `read` | Every `GET` |
| `write` | Creating and changing — `POST`, `PATCH` |
| `delete` | Removing — `DELETE` |

**Deleting is deliberately separate from writing.** "Can add cards to my
moodboard" and "can destroy my moodboard" are different levels of trust to hand
out, and the distinction matters most when the caller is a language model
driving [MCP tools](/docs/mcp).

A token missing the scope it needs gets `403` with
`code: "insufficient_scope"` and a `required_scope` field naming what was
missing, rather than a generic refusal.

`GET /me` reports the scopes a token actually has — check it before assuming.

## A token acts as you

The design point worth understanding:

The token resolves to your user, and then every request runs **as that user**,
under the same row-level security the app runs under.

- Boards you own — full access
- Boards you were invited to as an editor — writable
- Boards you can only view — reads succeed, writes get `403`
- Boards you cannot see — `404`, never a confirmation they exist

There is no per-resource permission list on a token, because there does not need
to be. This is also why a token cannot be used to escalate: it has no authority
of its own.

## Revoking

**Settings → API → Revoke**, effective immediately. The next request with that
token gets `401`.

Unknown, revoked and expired tokens all return the same `401 invalid token` —
the API does not distinguish, so a probe cannot learn which tokens once existed.

Up to **20 active tokens** per account. Revoked ones do not count against it.

## Expiry

Tokens do not expire by default. An optional lifetime can be set at creation.

## Keeping a token safe

> **Warning:** A `sk_live_` token is equivalent to your account for
> everything the API can reach. Treat it like a password.

- **Never put one in front-end code.** CORS is open so it will work, and anyone who opens dev tools will have it.
- **Never commit one.** Use an environment variable.
- **One token per integration**, so you can revoke one without breaking the others.
- **Read-only unless you need writes.**
- **Rotate** by creating the new token, deploying it, then revoking the old one — both work simultaneously, so there is no downtime.

## Rate limiting

**1000 requests per hour, per token.**

Every response carries the current state, not just refusals:

| Header | Meaning |
|---|---|
| `x-ratelimit-limit` | Your ceiling |
| `x-ratelimit-remaining` | What is left in this window |
| `x-ratelimit-reset` | Unix seconds when the window resets |
| `retry-after` | Seconds to wait — only on `429` |

A client that can only learn its budget by being rejected has to hit the wall to
find it, so the numbers ride along on every call. `GET /me` reports the same
figures in its body.

Separate tokens have separate budgets, which is another reason to give each
integration its own.

## Tokens and MCP

[The MCP server](/docs/mcp) uses the same token — it holds no credentials of its
own and simply forwards yours. Everything on this page applies to it.
