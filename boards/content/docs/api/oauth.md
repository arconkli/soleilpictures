---
title: Connect an App with OAuth — Soleil Clusters API
metaDescription: Soleil Clusters is an OAuth 2.1 authorization server — open client registration, PKCE and RFC 9728 discovery, so an MCP client connects with no token to paste.
h1: Connecting an app (OAuth)
navLabel: OAuth
section: developers
order: 3
updated: 2026-08-10
answer: Soleil Clusters is its own OAuth 2.1 authorization server, so an MCP client or any other application can connect without anyone copying a token. Discovery is at /.well-known/oauth-protected-resource and /.well-known/oauth-authorization-server, client registration is dynamic and open, PKCE with S256 is required, and access tokens last 60 minutes with a rotating refresh token. The person approves the connection on one screen and can disconnect it at any time under Settings then API.
faq:
  - q: Do I need to register an application first?
    a: No. Registration is dynamic and open — POST your client metadata to /oauth/register and you get a client_id back immediately. There is no review queue and no key to request.
  - q: Is PKCE required?
    a: Yes, with S256. The plain method is not supported at all, because OAuth 2.1 removes it.
  - q: How long do tokens last?
    a: An access token lasts 60 minutes. The refresh token rotates on every use and is good for 90 days from its last use.
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

## Registering

Registration is **open and dynamic** — no review, no application form, no key to
request:

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
| **Refresh token** | Rotates on every use; valid {{fact:oauthRefreshDays}} days from last use |
| **Scopes** | {{fact:apiScopes}} — the same three [scopes](/docs/api/authentication) a token has |

```sh
curl -X POST {{fact:siteOrigin}}/oauth/token \
  -d grant_type=refresh_token -d refresh_token=rt_… -d client_id=soleil_a1b2…
```

Refresh tokens are **single-use**: the old one is replaced in the same statement
that claims it, so a replayed refresh finds nothing. Store the new one.

`delete` is never granted by default. Ask for it in `scope` only if the
application genuinely needs to destroy things — the product's rule is that an
assistant can be allowed to build without being allowed to destroy, and a
default that quietly included `delete` would undo that for every connection.

## What the person sees

One screen: who is asking, what each scope means in plain words, and two
buttons. Afterwards the connection appears under **Settings → API → Connected
apps** with its scopes, when it was connected, and how many calls it has made.

Disconnecting revokes the access token in the same statement, so it stops
working immediately rather than at its next expiry. Everything the app did is in
the [audit log](/docs/api/audit), with the tool it used.

At most {{fact:maxConnectedApps}} connected apps per account.

## What a token can reach

Exactly what the person can reach. An OAuth access token is resolved to their
own database session, under ordinary row-level security, by the same code path
a personal access token uses. There is no separate permission model to get
wrong: if they cannot see a cluster, neither can anything they connect.

## Errors

Failures use the OAuth shape, so a client can branch on them:

```json
{ "error": "invalid_grant", "error_description": "that authorization code is not valid" }
```

| | |
|---|---|
| `invalid_client` | Unknown `client_id`, or a confidential client failed to authenticate |
| `invalid_grant` | Code or refresh token expired, already used, or not yours |
| `invalid_request` | A required parameter is missing or malformed |
| `invalid_redirect_uri` | Registration was refused — see the shape rules above |
| `invalid_target` | The `resource` named is not served here |
| `unsupported_grant_type` | Only `authorization_code` and `refresh_token` exist |

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
live.
