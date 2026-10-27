---
title: Connect an App with OAuth — Soleil Clusters API
metaDescription: Soleil Clusters is an OAuth 2.1 authorization server — open client registration, PKCE and RFC 9728 discovery, so an MCP client connects with no token to paste.
h1: Connecting an app (OAuth)
navLabel: OAuth
section: developers
order: 3
updated: 2026-10-25
answer: Soleil Clusters is its own OAuth 2.1 authorization server, so an MCP client or any other application can connect without anyone copying a token. Discovery is at /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server, a client names itself by the URL of its own metadata document or registers dynamically, PKCE with S256 is required, and access tokens last {{fact:oauthAccessTtl}} with a rotating refresh token. The person approves the connection on one screen and can disconnect it at any time under Settings then Connections.
faq:
  - q: Do I need to register an application first?
    a: No. Either use the https URL of a client metadata document you publish as your client_id, which is how Claude, ChatGPT and VS Code connect, or POST your client metadata to /oauth/register and get a client_id back immediately. There is no review queue and no key to request.
  - q: Is PKCE required?
    a: Yes, with S256. The plain method is not supported at all, because OAuth 2.1 removes it.
  - q: How long do tokens last?
    a: An access token lasts {{fact:oauthAccessTtl}}. The refresh token rotates on every use and is good for {{fact:oauthRefreshDays}} days from its last use, but never more than {{fact:oauthRefreshMaxDays}} days after the person connected; then they approve the app again.
  - q: What happens if someone disconnects the app?
    a: The access token is revoked in the same statement, so it stops working immediately rather than at its next expiry.
  - q: Can I still use a personal access token instead?
    a: Yes. Nothing about tokens has changed. OAuth is for applications that other people connect; a token is for your own scripts.
related:
  - /docs/mcp
  - /docs/api/authentication
  - /docs/api/audit
---

There are two ways into this API.

A [personal access token](/docs/api/authentication) is right for **your own**
scripts — you make it, you hold it, you paste it once. OAuth is right for an
**application other people connect**, because nobody should ever be asked to
paste a credential into somebody else's software.

If you are wiring up an MCP client, you almost certainly want this one, and you
probably do not have to implement any of it — see [MCP](/docs/mcp).

## Discovery

Everything below is discoverable. Start from a `401`:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="soleil", error="invalid_token", scope="read write",
                  resource_metadata="{{fact:siteOrigin}}/.well-known/oauth-protected-resource/api/v1/mcp"
```

That header is the entry point. Follow it:

| | |
|---|---|
| `/.well-known/oauth-protected-resource/api/v1/mcp` | What this resource is, and who authorizes it ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)) |
| `/.well-known/oauth-authorization-server` | The endpoints and what they support ([RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414)) |

Both are public and cacheable. A discovery document you need a credential to
read is not discovery.

## Client metadata documents

The simplest client registers nothing. Publish your metadata as JSON at an
`https` URL and use **that URL as your `client_id`**
([Client ID Metadata Documents](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)).
The authorization server metadata says `client_id_metadata_document_supported: true`,
and this is how Claude, Claude Code, ChatGPT and VS Code connect.

```json
{
  "client_id": "https://shotplanner.example/oauth/client.json",
  "client_name": "Shot Planner",
  "redirect_uris": ["https://shotplanner.example/callback"],
  "token_endpoint_auth_method": "none"
}
```

We fetch it when the person first lands on the consent screen, and it has to
pass these checks:

- `client_id` is **exactly** the URL it is served from. The URL is `https`, on
  the default port, with a path, no fragment and a public host.
- It answers `200` with JSON at that URL. Redirects are not followed, and the
  document can be at most {{fact:oauthMetadataMaxSize}}.
- `redirect_uris` follow the same rules as registration, below.
- `token_endpoint_auth_method` is `none` or `private_key_jwt`. A published
  document cannot keep a secret, so the `client_secret_*` methods are refused.
  Either way the client is public, and PKCE is what proves it at the token
  endpoint.
- `grant_types`, if present, includes `authorization_code`. Grants we do not
  issue are ignored.

A good document is trusted for its `Cache-Control` `max-age`, at least
{{fact:oauthMetadataCacheMin}} and at most {{fact:oauthMetadataCacheMax}}, and
read again after that. A document that failed is never cached, so fix it and
try again straight away. The consent screen names the host the document came
from.

## Registering

If you would rather not publish a document, registration is **open and
dynamic**: no review, no application form, no key to request.

```sh
curl -X POST {{fact:siteOrigin}}/oauth/register \
  -H 'content-type: application/json' \
  -d '{
    "client_name": "Shot Planner",
    "redirect_uris": ["https://shotplanner.example/callback"],
    "token_endpoint_auth_method": "none"
  }'
```

```json
{ "client_id": "soleil_a1b2…", "client_id_issued_at": 1786000000,
  "client_name": "Shot Planner", "redirect_uris": ["https://shotplanner.example/callback"] }
```

At most {{fact:oauthMaxRedirectUris}} redirect URIs. They must be `https`,
`http` on loopback (`127.0.0.1`, `::1`, `localhost` — for a command-line client
with no domain), or a private scheme like `shotplanner://`. A URI with a
fragment is refused: the response is appended to the query, and a URI that
already has a fragment cannot be extended safely.

A loopback redirect URI matches on **any port**
([RFC 8252 §7.3](https://datatracker.ietf.org/doc/html/rfc8252#section-7.3)).
Register or publish `http://127.0.0.1/callback` and come back on whichever port
the operating system gave you. Host, path and query still have to match
exactly, and `https` URIs never get this exception.

Leave `token_endpoint_auth_method` as `none` unless your client can genuinely
keep a secret. A desktop app, a CLI and a browser extension cannot — PKCE is
what proves identity there, and a "secret" shipped inside a download is not one.

## The flow

```
  client                    browser                     Soleil
    │                          │                           │
    ├─ 401 + resource_metadata ─────────────────────────────┤
    ├─ GET  /.well-known/… ─────────────────────────────────┤
    ├─ POST /oauth/register ────────────────────────────────┤
    ├─ open /oauth/authorize ─▶│                            │
    │                          ├─ sign in (or sign up) ────▶│
    │                          ├─ approve ─────────────────▶│
    │◀─ redirect_uri?code=…&state=…&iss=… ──────────────────┤
    ├─ POST /oauth/token ───────────────────────────────────┤
    │◀─ access_token + refresh_token ───────────────────────┤
```

**Authorization.** Send the person to:

```
{{fact:siteOrigin}}/oauth/authorize
  ?response_type=code
  &client_id=soleil_a1b2…
  &redirect_uri=https://shotplanner.example/callback
  &scope=read%20write
  &state=<opaque>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256
  &resource=https%3A%2F%2Fclusters.soleilpictures.com%2Fapi%2Fv1%2Fmcp
```

`code_challenge_method` must be `S256`. `resource` names what the token is for
([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html)) — it is how a token
minted here can never be valid anywhere else.

If the person has no account, they get one: our sign-in is a single email box
that creates the account if there isn't one. They never have to visit the site
first.

**The response** carries `code`, your `state`, and `iss`:

```
https://shotplanner.example/callback?code=ac_…&state=…&iss=https://clusters.soleilpictures.com
```

`iss` is [RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207) and we always
send it, including on errors. Compare it to the issuer you recorded from the
metadata **before** you send the code anywhere. That single comparison is what
defeats a mix-up between two authorization servers.

**The exchange:**

```sh
curl -X POST {{fact:siteOrigin}}/oauth/token \
  -d grant_type=authorization_code \
  -d code=ac_… \
  -d redirect_uri=https://shotplanner.example/callback \
  -d client_id=soleil_a1b2… \
  -d code_verifier=<the original verifier>
```

```json
{ "access_token": "sk_mcp_…", "token_type": "Bearer",
  "expires_in": 3600, "refresh_token": "rt_…", "scope": "read write" }
```

The code is good for {{fact:oauthCodeTtl}} and is **single-use**. It is bound to
the client, the redirect URI and the PKCE challenge it was issued against, and
all four are checked in the same statement that consumes it — so a code that
leaks is worth nothing without the verifier, and a replay finds nothing.

## Tokens

| | |
|---|---|
| **Access token** | {{fact:oauthAccessTtl}}, sent as `Authorization: Bearer …` |
| **Refresh token** | Rotates on every use. Valid {{fact:oauthRefreshDays}} days from last use, at most {{fact:oauthRefreshMaxDays}} days after the person connected |
| **Scopes** | {{fact:apiScopes}} — the same three [scopes](/docs/api/authentication) a token has |

```sh
curl -X POST {{fact:siteOrigin}}/oauth/token \
  -d grant_type=refresh_token -d refresh_token=rt_… -d client_id=soleil_a1b2…
```

Refresh tokens are **single-use**: the old one is replaced in the same statement
that claims it. Store the new one.

- **Retrying within {{fact:oauthRefreshRetry}}.** If a response never reached
  you, sending the same refresh token again within {{fact:oauthRefreshRetry}}
  gets you a fresh pair.
- **Presenting it any later.** A refresh token that was already exchanged is
  treated as stolen. The connection is revoked along with its access token, and
  the person has to approve the app again.
- **Concurrent processes.** Several processes sharing one connection should
  refresh through one place. Otherwise one of them will eventually present a
  spent token.

`delete` is never granted by default. Ask for it in `scope` only if the
application genuinely needs to destroy things — the product's rule is that an
assistant can be allowed to build without being allowed to destroy, and a
default that quietly included `delete` would undo that for every connection.

## What the person sees

One screen. Across its top, who vouches for the app:

- **Verified app**, naming the host it came from, for a metadata document
  served from one of {{fact:oauthVerifiedHosts}}.
- **Runs on this computer**, when the code goes back to `localhost` or an app's
  own scheme, whoever published the name: any program on the computer could
  have started the sign-in, so the person continues only if they just did.
- **Not verified**, for anything else: a registered client, whose name is what
  it sent to `/oauth/register`, or a document from another host.

Then the app's name, the account it will act as (with a way to switch), what it
may do in plain words, and two buttons. An app that asks for `read write` can
also be allowed to delete, if the person chooses to on that screen: read the
`scope` in the token response rather than assuming you got what you asked for.

Afterwards the connection appears under **Settings → Connections → Connected
apps** with its scopes, when it was connected, and how many calls it has made.

Disconnecting revokes the access token in the same statement, so it stops
working immediately rather than at its next expiry. Everything the app did is in
the [audit log](/docs/api/audit), with the tool it used.

At most {{fact:maxConnectedApps}} connected apps per account. In an account's
first {{fact:newAccountHours}} hours, only ChatGPT and Claude can connect, by
sending the person back to their own callback, and their tokens answer
{{fact:oauthNewAccountPerHour}} requests an hour instead of
{{fact:rateLimitPerHour}}. Every other app can connect once the account is
{{fact:newAccountHours}} hours old.

## What a token can reach

Exactly what the person can reach. An OAuth access token is resolved to their
own database session, under ordinary row-level security, by the same code path
a personal access token uses. There is no separate permission model to get
wrong: if they cannot see a cluster, neither can anything they connect.

## Limits

Each is counted per address:

| | |
|---|---|
| `POST /oauth/register` | {{fact:oauthRegisterPerMinute}} a minute, and {{fact:oauthRegistrationsPerHour}} new clients an hour (a metadata document read for the first time counts as one) |
| `POST /oauth/token` and `/oauth/revoke` | {{fact:oauthTokenPerMinute}} a minute between them |
| Reading a metadata document from its host | {{fact:oauthLookupPerMinute}} a minute |

Past one, the answer is `429` with `temporarily_unavailable`, and a
`retry-after` in seconds on the per-minute ones. Those are kept in each
Cloudflare location, so they are approximate: they are there to stop a loop,
and a client that refreshes when its token runs out never meets them.

## Errors

Failures use the OAuth shape, so a client can branch on them:

```json
{ "error": "invalid_grant", "error_description": "that authorization code is not valid" }
```

| | |
|---|---|
| `invalid_client` | Unknown `client_id`, a metadata document that could not be read or failed the checks above (the `error_description` says which), or a confidential client failed to authenticate |
| `invalid_grant` | Code or refresh token expired, already used, or not yours |
| `invalid_request` | A required parameter is missing or malformed |
| `invalid_redirect_uri` | Registration was refused — see the shape rules above |
| `invalid_target` | The `resource` named is not served here |
| `unsupported_grant_type` | Only `authorization_code` and `refresh_token` exist |
| `temporarily_unavailable` | `503` when we, or your metadata document's host, did not answer; `429` when an address goes past one of the [limits](#limits). Retry, after `retry-after` when there is one; it is never a reason to throw a connection away |

A bad `redirect_uri` is **never** redirected to. If the URI is not one the
client registered, the person sees an error page and nothing is sent anywhere —
bouncing an error to an unverified address is the open redirect the check
exists to prevent.

## Revoking

```sh
curl -X POST {{fact:siteOrigin}}/oauth/revoke -d token=rt_… -d client_id=soleil_a1b2…
```

Always answers `200`, even for a token that was never valid, per
[RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009). Saying "no such
token" would turn the endpoint into a way to test whether a stolen string is
live. (A `429` says only that the address went past its [limit](#limits).)
