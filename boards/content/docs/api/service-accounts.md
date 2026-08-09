---
title: Service Accounts — Soleil Clusters API
metaDescription: Create a credential owned by a workspace rather than by a person, so an integration keeps working after the person who built it leaves.
h1: Service accounts
navLabel: Service accounts
section: developers
order: 11
updated: 2026-08-09
answer: A personal access token belongs to one person, so an integration built on it stops the day that person leaves the workspace. A service account is a credential owned by the workspace itself. It is a real member of exactly one workspace, subject to the same permissions as anyone else, and its tokens keep working regardless of who comes and goes. Only the workspace owner can create one, and a token can never grant more than the token that created it.
faq:
  - q: Why not just use a personal access token?
    a: It works, until the person who minted it leaves the workspace or their account changes. Then every integration built on it stops with a permission error far from the cause. A service account has no such dependency.
  - q: What can a service account see?
    a: Exactly one workspace, and only what a member of that workspace can see. It cannot reach boards shared to the person who created it from somewhere else.
  - q: Who is allowed to create one?
    a: The workspace owner. An editor cannot, because a credential that outlives its creator's own access would be a way around losing it.
  - q: How do I rotate a token without downtime?
    a: Mint the new one first, move the integration onto it, then revoke the old one. A service account can hold several tokens at once.
  - q: Does a service account count against my plan?
    a: No. Storage and card limits are charged to the workspace owner no matter who does the writing, which is the same rule the app applies to collaborators.
related:
  - /docs/api/authentication
  - /docs/api
  - /docs/mcp
---

A [personal access token](/docs/api/authentication) is **you**. Everything it
can do, it does as your account, under your permissions. That is the right
design for a script you wrote for yourself, and the wrong one for an integration
a team depends on — because the day you leave the workspace, or your account
changes, every pipeline built on that token stops, with a permission error a
long way from its cause.

A **service account** is a credential owned by the workspace instead.

It is a real member of one workspace. It is subject to exactly the same
permissions as a person — there is no bypass and no elevated mode — and its
access ends at the edge of that workspace. What it does not have is a dependency
on any particular human still being around.

## Create one

```sh
curl -X POST "$SOLEIL_API/service-accounts" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"workspace_id":"'$WS'","name":"Pipeline sync","scopes":["read","write"]}'
```

```json
{
  "service_account": {
    "id": "9f1c…", "name": "Pipeline sync", "workspace_id": "3b7e…",
    "created_at": "2026-08-09T12:00:00Z", "disabled": false
  },
  "token": {
    "id": "a2c4…", "token": "{{fact:tokenPrefix}}…", "prefix": "{{fact:tokenPrefix}}a1b2",
    "scopes": ["read", "write"], "rate_limit": {{fact:serviceRateLimitPerHour}}
  },
  "next": "Use this token as the Bearer credential. It is shown once."
}
```

The account and its first token are created together, because an account with no
credential cannot do anything and you would have to ask for one immediately
anyway.

**`token` is shown once.** It is not stored anywhere it can be read back. If it
is lost, mint another and revoke the old one.

Only the **workspace owner** can create a service account. An editor cannot —
a credential that keeps working after its creator loses access would be a way
around losing it.

## Scopes, and the ceiling on them

Same three [scopes](/docs/api/authentication) as a personal token: `read`,
`write`, `delete`. `delete` implies `write`, and every token can read.

**A service token can never grant more than the token that created it.** Asking
for `delete` from a `write` token is refused with `403 insufficient_scope`
rather than quietly granted — otherwise the weaker credential would be a way to
manufacture the stronger one.

## Rate limit

A service token's default is **{{fact:serviceRateLimitPerHour}} requests/hour**,
against {{fact:rateLimitPerHour}} for a personal one. The two numbers exist for
different reasons: a personal limit bounds one person's scripting mistake, and a
machine identity is the case a rate limit exists to *permit*. Pass `rate_limit`
to set your own.

Every response carries `X-RateLimit-Remaining` and `X-RateLimit-Reset`, so there
is no need to discover the ceiling by hitting it.

## Managing them

```sh
# What exists
curl "$SOLEIL_API/service-accounts?workspace=$WS" -H "Authorization: Bearer $SOLEIL_TOKEN"

# Another token for the same account — mint the new one BEFORE revoking the old,
# and the integration never has a moment without a working credential
curl -X POST "$SOLEIL_API/service-accounts/$SA/tokens" \
  -H "Authorization: Bearer $SOLEIL_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"rotated 2026-08","scopes":["read","write"],"ttl_days":90}'

# Its tokens, with when each was last used
curl "$SOLEIL_API/service-accounts/$SA/tokens" -H "Authorization: Bearer $SOLEIL_TOKEN"

# Retire one token
curl -X DELETE "$SOLEIL_API/service-accounts/$SA/tokens/$TOKEN_ID" \
  -H "Authorization: Bearer $SOLEIL_TOKEN"

# Retire the whole account — revokes every token and ends its membership
curl -X DELETE "$SOLEIL_API/service-accounts/$SA" -H "Authorization: Bearer $SOLEIL_TOKEN"
```

Deleting a service account is immediate: every token is revoked and the
membership is removed, so the credential is dead by the time the call returns.
The record itself is kept, so past entries in the
[audit log](/docs/api/authentication) still resolve to a name rather than to a
deleted id.

## Limits

| | |
|---|---|
| **Per workspace** | {{fact:maxServiceAccounts}} active service accounts |
| **Per account** | {{fact:maxTokensPerAccount}} active tokens |
| **Reach** | The one workspace it belongs to |
| **Requests** | {{fact:serviceRateLimitPerHour}}/hour by default, per token |

## What it deliberately cannot do

A service account **cannot create or manage service accounts**, including
itself. If it could, a single leaked credential could clone itself indefinitely
and revoking the original would achieve nothing. Account management always needs
the owner's own token.

It also cannot be made an owner, and it cannot reach a second workspace. If an
integration spans two workspaces it needs two service accounts — which is the
honest representation of what it is doing.

## Which credential to use

| | Personal token | Service account |
|---|---|---|
| Belongs to | You | The workspace |
| Survives you leaving | No | Yes |
| Reach | Everything you can see | One workspace |
| Created by | Anyone, in Settings → API | The workspace owner, over the API |
| Good for | Your own scripts, trying things out, [MCP](/docs/mcp) on your machine | Anything a team depends on |

A useful rule: if losing access to it would interrupt someone other than you,
it should be a service account.
