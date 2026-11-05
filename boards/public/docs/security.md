# Security

> Clusters runs on Supabase (database and sign-in, in AWS us-west-2) and Cloudflare (website, API, files and live editing), and both encrypt stored data. Every connection is HTTPS. Sign-in is an emailed code or a passkey, with no password to leak. A cluster is seen only by its workspace and people you share it with, and the database enforces access on every table. API keys and connected-app tokens are stored only as hashes, and an AI app can delete only if you allow it. Report a vulnerability to security@soleilpictures.com.

_Source: https://clusters.soleilpictures.com/docs/security · Updated 2026-11-05_

Clusters keeps film and creative work: scripts, references, cuts in progress.
This page says how that work is protected, in plain words, and only what is
true today. Where a protection belongs to one of our providers, it says so and
links to theirs.

## Report a vulnerability

Email **security@soleilpictures.com**. Please include:

- what you found, and where (a page, an API route, an MCP tool)
- the steps to reproduce it
- what someone could do with it

A few ground rules while you look:

- Use your own account and your own test data. Don't open, change or delete
  anyone else's.
- Don't run tests that slow the service down for others, and don't send spam
  or invitations to people who didn't ask for them.
- Give us a fair chance to fix it before you tell anyone else.

We read every report and reply from the same address. There is no paid bug
bounty, but we're glad to credit you when the fix ships, if you'd like. Our
[security.txt](https://clusters.soleilpictures.com/.well-known/security.txt) has the same contact.

## Where your data lives

Clusters is run from the United States. Each part runs on one provider:

| What | Provider |
|---|---|
| Your account, clusters, cards, documents, comments and messages | Supabase (Postgres database and sign-in), in AWS us-west-2, Oregon |
| Uploaded files, and their backup copy | Cloudflare R2. Some message attachments and a few older card pictures are in Supabase storage |
| The website, the API and the MCP server | Cloudflare Workers |
| Live editing: who's here, and changes as they happen | Cloudflare Durable Objects |
| Picture descriptions for search and tags | Cloudflare Workers AI, which doesn't keep the picture or train on it |
| Payments | Stripe. Card details are typed on Stripe's page and never reach Clusters |
| Email | Resend |
| Making videos and audio play in every browser, previews of photos and documents browsers can't open, and Scout | Fly.io |

The full list, including the Meta measurement used on public pages, is in the
[Privacy Policy](/legal/privacy).

## Encryption

- **On the way.** Every connection uses HTTPS. A plain `http` address is sent
  to HTTPS, and browsers are told to use only HTTPS for this site and every
  address under it.
- **At rest.** Stored data is encrypted by the provider that holds it:
  Supabase encrypts the database with AES-256
  ([Supabase security](https://supabase.com/security)), Cloudflare R2 encrypts
  files with AES-256 ([R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)),
  and Durable Objects are encrypted at rest
  ([Durable Objects data security](https://developers.cloudflare.com/durable-objects/reference/data-security/)).
  Stripe encrypts card numbers with AES-256 and is certified PCI Service
  Provider Level 1 ([Stripe security](https://docs.stripe.com/security)).
- **Keys and tokens.** API keys and connected-app tokens are kept only as a
  one-way hash. A key is shown once, when you make it, and can't be read back,
  even by us.

## Signing in

- **An emailed code or a passkey.** Your account has no password to set,
  reuse or leak. (The one exception is an internal demo account that app
  directories use to review Clusters.)
- **Passkeys.** Only a public key reaches us; the passkey itself stays with
  your device or its password manager, and using it usually asks for your
  face, fingerprint or device PIN. You can see and remove your passkeys in
  **Settings › Profile**, and a removed one stops working at once.
- **Your inbox is the proof.** Joining a team, accepting an invitation by
  address or joining by company domain needs a session that started from that
  inbox (a code or link we emailed), or from a passkey saved while signed in
  that way.
- **New accounts wait.** For its first 72 hours an
  account can't make API keys or add webhooks, and can connect only the main
  AI assistants and apps that sign in through your own computer, as coding
  tools do. This slows down throwaway accounts.
- **Signing out** signs you out on every device. A page already open on
  another device can keep working for a short while, until its current
  sign-in expires. An account banned for abuse is signed out everywhere, and its links,
  invitations and keys stop working.

## Who can see what

- **Your workspace, your people.** A cluster is visible to the people in its
  workspace and to anyone you share it with. A workspace of your own is just
  you until you invite someone or make a link. On a Team, team workspaces are
  open to the team.
- **Roles.** A workspace has an owner, co-owners, editors and viewers. Viewers
  can open, comment and vote but never change anything. Only the owner can
  delete a workspace or hand it over.
- **Links.** A public link is always view-only, asks search engines not to list
  it unless you turn that on, can be set to expire, and can be turned off at
  any time. An edit link grants nothing by itself: the person has to sign in
  and press **Join**. See [Sharing](/docs/collaborate/sharing).
- **When someone leaves or is removed,** the links and invitations they made
  end, the files they shared stop reaching people, they leave the workspace's
  conversations, and the webhooks and service accounts they set up are turned
  off.
- **The database enforces it.** Every table has row-level security, so who can
  read or change a row is checked by the database itself, the same way for
  the app, the API and connected apps. An automatic check runs every day and
  alerts us if any table has that protection turned off, or a new rule lets
  anyone add rows.

### On a Team

- The owner and admins manage people, seats and how people join. Only the
  owner changes the card or closes the team.
- The owner and admins can open every team workspace, including private ones,
  and only they see members' email addresses.
- Joining by company email domain needs the domain proved with a DNS record,
  and free email providers can't be used for it.

See [Team](/docs/account/team).

## API, MCP and connected apps

- **A key acts as you.** It reaches exactly what your account reaches, under
  the same database rules as the app. A key made in **Settings › Connections**
  starts read-only unless you choose more, and revoking it works at once.
- **Separate permissions.** Access comes in parts (`delete` · `read` · `write`), and
  deleting is its own permission, never part of write.
- **Connected apps (OAuth),** such as Claude or ChatGPT through MCP. You
  approve each one in your browser, on a screen that lists what it may do. An
  app that asks to read and write can't delete unless you also tick **Allow
  deleting**, and one that asks to delete says so there first. Sign-in uses
  PKCE. An access
  token lasts 60 minutes. Each renewal token works once (a retry
  within 30 seconds is allowed), and one reused after that ends
  the connection. After 180 days an
  app has to be approved again. Disconnecting an app works at once.
- **The MCP server holds no keys of its own.** Every call it makes is yours,
  held to the permission that call needs. Text people wrote is marked as data
  for the assistant, so instructions hidden in a card aren't treated as
  commands.
- **Limits.** A personal key can make 1000 requests an hour.
- **A record of changes.** Writes made through the API or MCP are logged with
  the key or app that made them, and you can read that log through the
  [API](/docs/api/audit). Records are deleted after 30 days.
- **Webhooks** are signed with HMAC-SHA256 using a secret for that webhook, go
  only to public HTTPS addresses, never follow redirects, and can be set up
  only by the workspace owner.

See [Authentication](/docs/api/authentication) and [OAuth](/docs/api/oauth).

## Backups and deleting your data

- **The database** is backed up every night. The backup is encrypted before it
  leaves the backup job, stored apart from the live database, and then read
  back to check it arrived whole. The database provider keeps its own backups
  as well.
- **Files uploaded to clusters** are copied by an hourly job to a separate
  backup store. Message attachments kept in Supabase storage aren't part of
  that copy.
- **Deleted clusters** stay in [Trash](/docs/clusters/trash-and-recovery) for
  30 days, then are deleted for good.
- **Deleting your account** in **Settings › Profile** takes effect at once and
  can't be undone. A file's backup copy isn't removed when you delete it yet,
  and the database provider's backups can hold deleted information until they
  are replaced. The [Privacy Policy](/legal/privacy) has the details, and
  [Data and privacy](/docs/account/data-and-privacy) says how to get
  everything out first.

## How the code is looked after

- Automated tests run on every change, including one that fails when these
  public docs no longer match the code.
- GitHub scans the code for security problems (CodeQL), raises and opens fixes
  for vulnerable dependencies (Dependabot), and blocks secrets from being
  committed (secret scanning with push protection).
- Text people write is cleaned before it is shown, so it can't run script in
  someone else's browser. Uploaded files are served so they can't run script
  on our site.
- The site can't be framed by another site, and browsers are told not to guess
  file types.

## Certifications

Clusters has no SOC 2, ISO 27001 or similar certification of its own, and has
not had a third-party penetration test. The providers it runs on publish
theirs: [Supabase](https://supabase.com/security),
[Cloudflare](https://www.cloudflare.com/trust-hub/compliance-resources/) and
[Stripe](https://docs.stripe.com/security).
