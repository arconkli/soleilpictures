# Enterprise support and seat-based pricing for Soleil Clusters

> Design record for the enterprise organizations + seats programme. The working plan lives
> outside the repo; this copy omits live account figures because the repository is public.

## Context

The owner wants Clusters to be sellable to organizations — film/TV productions, in-house
design teams at companies, and game studios — on a seat-based pay structure, and wants the
result to be genuinely great, not a checkbox tier.

Today Clusters sells exactly one thing: an individual **Creator** plan ($25/mo or $240/yr,
`billingCopy.js`) that removes a per-user card cap and unlocks file types and sizes. The
billing subject is always a **person** (`profiles.tier`, `subscriptions.user_id` PK,
`paid_grants`). Collaboration is free and "owner pays": every card or byte a collaborator adds
is charged to the **workspace owner** (`board_workspace_owner()` in 0187 → `workspaces.created_by`).
The free-editor decision (0188) explicitly accepted "an org piggybacking on one seat" and named
the multi-editor workspaces as *the future Team-plan prospect list*. This plan is that Team/
Enterprise tier.

Honest starting position (from a read-only look at the live project on 2026-09-08; figures withheld because the repo is public): seat billing is greenfield with no seat-shaped subscription to migrate; only a handful of workspaces have more than one member, so every predicate must be re-proven at team scale; the studio-integration surface (service accounts, tokens, webhooks) is built but unproven in anger; no company email domain has more than a single signed-up user, so enterprise is sales-led with design partners rather than pulled by self-serve demand; the Supabase org is on the Pro plan in us-west-2, so SAML SSO needs no plan change; and sign-in is email OTP only, so SSO is additive.

## What exists today (verified by reading; do not rebuild)

### Tenancy and authorization
- `workspaces(id, name, created_by)` — **ownership is derived from `created_by`**, not a role
  row; `workspace_members(workspace_id, user_id, role)` with role values in use:
  `owner`, `editor`, `viewer`. There is **no admin role below owner** and **no layer above
  workspaces**. A user auto-gets a personal workspace (`get_or_create_personal_workspace`, 0303
  guarded) with a live root board — the live-root invariant (0275) must hold for every workspace.
- Board-level grants: `board_shares(board_id, user_id, role viewer|editor)` cascade down the
  subtree via `can_read_board` / `can_write_board` (0013, 0188). `can_write_workspace` = member or
  creator, waitlist blocked. All three are SECURITY DEFINER and are the **single choke point** the
  PartyKit room (`party/auth.ts` admits on the `boards` SELECT policy, i.e. `my_readable_board_ids`, then calls the `can_write_board` RPC to mark viewer sockets `readOnly`),
  RLS, and the Worker API all share. An org layer must be expressed through these, not beside them.
- Invites: `pending_invites(email, workspace_id, board_id?, role viewer|editor|workspace, token,
  expires_at)` claimed at signup (0086/0087, fixed 0227/0228); collab invite links via
  `public_share_links(kind view|invite, role viewer|editor, expires_at, allow_indexing)` (0189). Public view links:
  expiry never/7d/30d, include-subclusters, noindex default. No password, no domain restriction,
  no download control.
- `transfer_workspace_ownership` (0015), `leave_workspace`, `delete_workspace` (owner-only),
  `prepare_account_deletion` re-homes shared workspaces to the longest-standing member (0264).
- Service accounts (0222) = real `auth.users` rows holding a `workspace_members` row, created
  only by the workspace owner, scoped to one workspace, cannot manage other service accounts.

### Billing and entitlements
- `profiles.tier in ('admin','paid','demo','waitlist')`; `profiles.card_cap_base` +
  `bonus_card_credits` → `effective_card_limit`; `profiles.storage_quota_bytes` per-owner override
  (0221, "set this for an enterprise account") over the global 100 GiB `app_config` row.
- `subscriptions(user_id PK, stripe_customer_id, stripe_subscription_id, plan monthly|annual,
  status, current_period_end, cancel_at_period_end)` — a one-row-per-user Stripe mirror.
- Edge functions: `create-checkout-session` (Checkout, subscription mode, `quantity: 1`,
  customer ownership proven via `metadata.supabase_user_id`, already-subscribed → portal),
  `stripe-webhook` (checkout.session.completed, customer.subscription.updated/deleted,
  invoice.payment_failed, charge.refunded/dispute), `verify-checkout-session`,
  `create-portal-session`, `billing-reconcile-cron` (daily, repairs mirror from live Stripe).
  `_shared/activateCore.mjs` is the pure, node-tested liveness gate: only `active|trialing`
  flips `tier='paid'`. Stripe live product `prod_UXMRuGS4n1NYk9`, prices via env
  `STRIPE_PRICE_MONTHLY/ANNUAL`.
- Client: `useMyTier` is ONE module-scope store over `get_my_tier()`; the cap trigger
  `enforce_demo_card_cap_trg` (0187/0252, weight-aware) is the server ceiling.
- `billingCopy.js` rule: **every pricing claim must name the code that enforces it**; docs
  numbers are `{{fact:…}}` placeholders resolved by `scripts/gen-docs.mjs` from real code.

### Identity
- Supabase Auth, email OTP only; no OAuth providers, no password, no MFA. JWT verified by
  PostgREST; PartyKit trusts the token by making an RLS'd REST call; the Worker API resolves a
  PAT/OAuth token into the user's **own** Supabase session (never service role for metadata).
- OAuth 2.1 authorization server (0224, `worker-oauth.js`) for third-party apps; PATs with
  `read|write|delete` scopes; per-token rate limits (0221).

### Audit and admin
- `admin_audit_log` (0312): **platform-admin actions only**, 400-day retention, admin-readable.
- `GET /api/v1/audit` (0222/0223): **API writes + image-byte reads only**, 30-day retention,
  visible to the caller and to owners for their service accounts. Canvas edits are NOT in it.
- `analytics_events` (400-day purge; synthetic quarantine 0230/0294) records product events
  with `actor` on `card_placed` — the raw material for a customer-facing activity log.
- `/admin` is a platform console gated by `profiles.tier='admin'` (`is_admin()`,
  `_require_admin()`); there is **no workspace-owner-facing admin surface** beyond the Share
  panel's people list.
- 29 pg_cron jobs, essentially all purges; first backup (`.github/workflows/backup.yml`,
  age-encrypted to R2) landed 2026-09-07 with setup still incomplete.

### Studio-facing integration surface (already built, promoted 2026-08-10)
- REST `/api/v1` (36 endpoints), hosted + stdio MCP (29 tools), webhooks with Frame.io's HMAC
  scheme and ShotGrid-style management, MovieLabs OMC v2.8 export, re-runnable URL importer,
  foreign identifiers, `/boards/tree`, bulk ops, `?since=` delta reads.

### Conventions that constrain the design
- Any public surface change (route, `/api/v1` endpoint/scope/error, MCP tool, card kind,
  Settings tab in `TABS`, enforced limit/price) must update `boards/content/docs/**` in the same
  commit; `docsite.test.mjs` diffs the extracted surface against `docsiteSurface.json`.
- Since 0311 a new function is born with ACL `{postgres, authenticated, service_role}` (default
  privileges revoke `public` and `anon`, 0311:104-108). So: `_`-prefixed internal helpers need an
  explicit `revoke execute … from authenticated`; anon-facing RPCs need an explicit
  `grant execute … to anon`; every migration asserts its post-condition with
  `has_function_privilege()`. CLAUDE.md carries no grant-hygiene rule today; add this one there
  in the Phase 0 commit rather than citing it as existing.
- `boards` has table-level grants — any new column is client-writable unless policies say
  otherwise. Never `.catch()` a `supabase.rpc()` builder. Gold is reserved for
  active/selection/focus. Deletion shows an undo toast. Repo is public: no business metrics
  in commits.
- Push to `main` = preview; production is the `production` branch, promoted by cherry-pick.
  Supabase project is **shared** between preview and prod: a migration is live the moment it
  applies. Migrations must therefore be backward-compatible with the production Worker/client.

## What the research established (16 areas, each skeptic-checked)

Full per-area reports live in the session scratchpad (`compact/*.md`); the findings that
decide the design are these.

### Corrections to the "what exists" picture that change decisions
- **Ownership is stored twice and enforced once.** Every server check reads
  `workspaces.created_by`; `workspace_members.role` is unconstrained free text read by only
  two policies and already holds a fifth value, `'service'` (0222). A workspace "viewer" has
  full write access; the ShareModal can only ever invite `'editor'`; there is no role-change
  RPC. Workspace roles must be made real before org roles can sit on them.
- **A privilege-escalation hole the org model would inherit:** the 0047 `workspaces` UPDATE
  policy is row-scoped with no column grants, so any member with role editor or owner (every member the UI can create) can rewrite `created_by` and
  take ownership. Same class as the holes 0091 (profiles) and 0238 (boards) already closed.
  `boards.workspace_id` is also directly PATCHable across workspaces (0238 re-granted it).
- **Deprovisioning does not cascade.** `remove_workspace_member` deletes one row; board
  shares, PATs (which inherit everything the person can reach), OAuth grants and pending
  invites survive. `can_read_board` has no suspend gate. PartyKit authorizes once per socket
  and never re-checks. R2 read URLs are 7-day and non-revocable. Together these are the four
  places an SSO/SCIM offboarding flow would silently miss.
- **Seat counting already exists, three times, with one definition:** distinct editor
  board-shares per workspace creator (share_board, claim_collab_link, admin_referral_stats),
  plus a dormant `collab_free_editor_cap` brake wired into every grant path (0188). Workspace
  members are invisible to it. The org seat model must consciously replace it.
- **Supabase already ships SSO/MFA tables** (`auth.sso_providers`, `auth.sso_domains`,
  `auth.saml_providers`, `auth.mfa_*`, `auth.users.is_sso_user`), all empty; SAML is on the
  Pro plan the org is on. SSO is registration + one branch in `AuthGate.jsx`, not a build.
  Two other emailed credentials must honour any "SSO required" policy: `/resume` tokens
  (lifecycle email, `verify_jwt=false`) and Scout's `/s/<token>` links.
- **No auth event is durably recorded anywhere** (`auth.audit_log_entries` holds zero rows);
  the two API-token/OAuth "audit" inserts go to `analytics_events` inside swallow-all
  exception blocks. `api_request_log` rows cascade-delete with the actor or token.
- **Billing has never carried a seat-shaped subscription** (the admin Revenue view is absent for
  that reason). `subscriptions.user_id` is the PK; `quantity: 1` is hard-coded; no
  proration, invoicing, tax, trials, dunning (payment_failed is a `console.warn`), or plan
  catalog. `billing-reconcile-cron` reads an unordered `LIMIT 50`. `activateCore.mjs` only
  activates on `active|trialing`, which would cut off a net-30 invoiced customer.
- **0221 was written as the enterprise down-payment**: per-account storage quota override,
  O(1) storage rollup, per-token rate limits. But `my_storage_usage()` and the admin detail
  still read the global quota, so an override is invisible to the customer.
- **Public promises that seat billing contradicts, in machine-linted copy:** plans.md "Do
  collaborators need to pay? No.", collaborate/index.md (rendered into the generated docsiteContent.js, which is never hand-edited) "charging per seat would make the product
  worse", seoLanding "flat $25 a month — not per seat". Free viewers and free guests preserve
  the spirit; the copy must change in the same commits. Full site list: `account/plans.md:3,9,13`,
  `collaborate/index.md:11,24`, `clusters/production-schedule.md:14`, `migrating.md:89`,
  `seoLanding.js:559,861,872`, and `billingCopy.js:206` `PRICING_META_DESCRIPTION`, which
  `billingCopy.test.mjs:95-105` asserts verbatim and `worker.js:103-108` injects as the live
  `/pricing` SERP description, so changing it is a title/description change to pre-register per
  the SEO rules in CLAUDE.md.
- **CI exists** (`.github/workflows/test.yml` runs `npm test` + `docs:check` on every push and
  PR); the "no CI" comments in the repo are stale. Playwright is excluded from CI.
- The `/admin` Audit tab has no entry point in its own chrome (reachable only via
  `?tab=audit`). The docs-gate tab-id regex accepts only `/^[a-z]+$/`, so a hyphenated org
  tab would ship undocumented with the test green.
- Board PNG/PDF export is broken in production (queries an `<svg>` BoardThumbnail no longer
  renders). The production schedule is client-gated off prod but its RPCs are reachable over
  the API and MCP.

### Market: what each segment buys, and how
| | Film / TV productions | Corporate design teams | Game studios |
|---|---|---|---|
| Buyer | Production designer champions; coordinator administers; UPM approves; production accountant pays on PO; studio content-security can veto | Design lead champions; IT/identity admin and security/GRC can veto; procurement above ~$5-10k/yr | Art director champions (bottom-up pilot); IT/InfoSec gate is "the slowest step"; procurement above ~25 seats |
| Contract | Per-production LLC, 3-9 months, **PO + net-30, fixed term, no auto-renew**, wrap/archive; entry under the $500 P-card threshold, full tier in the $1.5-5k UPM band (SetKeeper $1.5k/$3.5k/$5k; SyncOnSet $250/4 weeks/department) | Per-editor seat, annual, 17-20% annual discount, Customer Portal self-service; benchmarks Figma Full $16 Pro / $55 Org / $90 Ent, Miro Business $20, Mural $17.99 | Per-editor seat $12-25 with free viewers; contractors rotate per milestone (guest seats free); true-down clauses demanded (layoffs) |
| Identity gate | 2FA mandated (Netflix), SSO expected | **SAML SSO first, then SCIM, then audit logs, then granular roles**; "SSO and SCIM block deals most often" | SSO mandatory at mid-size; SCIM + audit export non-negotiable at AAA |
| Compliance gate | **TPN** (MPA): membership $250-1,000/yr; Blue Shield self-assessment; Silver/Gold third-party assessed (cost unpublished, ~2-yr cycle); SOC 2 substitutes for non-studio buyers | **SOC 2 Type II** + ISO 27001 evidence in a trust center; DPA + subprocessor list | SOC 2 Type II; DPA; data-flow diagram; deletion certification; no-AI-training commitment (64% of artists hostile to gen-AI) |
| Content controls | **Personally-identifiable watermarking**, passphrase/expiry/no-download links, need-to-know department scoping, share-link inventory, bulk revoke at wrap, full export at wrap | Public-link kill switch, domain-restricted sharing, retention controls | Project-scoped access for unannounced titles, watermarking, link expiry, certified destruction |
| Universal | Free viewers/commenters; guests free; annual invoice/PO above a threshold; explicit prorated seat charges (Miro), never silent auto-upgrade (Figma's "dark pattern" thread) | | |

Two findings reframe the packaging. First, **Whimsical ships SAML SSO + SCIM + domain
management inside a published $20/editor Business plan**, proving the "SSO tax" is a packaging
choice; a solo founder who cannot staff an enterprise sales cycle should put SSO in the
self-serve tier. Second, **Frame.io's model, not Figma's, fits film**: a small paid crew and
unlimited free reviewers via share links, with the security ladder (passphrase, expiry,
no-download, static then session watermarking) as the upsell. Slack's inactive-seat credit
("fair billing") is the one mechanic no canvas competitor offers and it maps exactly onto a
production ramping 40 → 6 at wrap.

### Identity and compliance options (costs as published 2026-09-08)
- **Supabase-native**: SAML on Pro ($25/mo already paid), $0.015/SSO-MAU over 50; TOTP MFA with
  an `aal` JWT claim usable in RLS; custom access token hook for org claims; custom OIDC
  providers (max 3/project). No SCIM, no SLO, IdP-initiated SAML incompatible with PKCE
  (bookmark-app workaround). Region cannot change after creation; an EU project must be
  created and migrated to. R2 and Durable Objects have immutable `eu`/`us` jurisdictions.
- **Brokers** if speed matters more than unit economics: WorkOS $125/connection/mo for SSO
  and again for SCIM plus $125/SIEM stream; Clerk $75/connection with SCIM included; Stytch
  5 free SSO-or-SCIM connections. All bolt on through Supabase third-party auth (RS256 JWT
  with `role: authenticated`). Decision rule from the research: build SCIM and audit on the
  Worker, rent nothing except possibly an IdP self-setup portal.
- **Compliance track** (parallel, money not code): SOC 2 Type I 3-6 months / Type II 8-12
  months, $25-50k all-in year one; pen test $5-15k; TPN membership + Blue Shield self-
  assessment first, Silver/Gold when a studio asks; publish a trust page, DPA, versioned
  subprocessor list (PartyKit is currently unnamed), and an at-rest encryption statement now.

### Stripe mechanics that constrain the seat design
- Licensed quantity on a Subscription item; `proration_behavior` = `always_invoice` on
  increase, `none` on decrease; preview with `invoices/create_preview` and a pinned
  `proration_date`. **Hard limit: 200 quantity updates per subscription per hour** — seat sync
  must be debounced and reconciled, not fired per invite.
- Checkout `adjustable_quantity` for self-serve; Customer Portal "Update quantities" is OFF by
  default and `subscription_update_confirm` supports only one item.
- Enterprise: `collection_method=send_invoice` + `days_until_due`, invoice `custom_fields`
  for the PO number, Quotes (needs Invoicing Plus), SubscriptionSchedule phases for
  multi-year locks. **`invoice.upcoming` never fires for send_invoice subscriptions** — renewal
  reminders must be self-scheduled. Access gating must accept `past_due`/open-invoice
  states for invoiced customers.
- Stripe Tax needs a validated address (`tax[validate_location]=immediately`) or
  finalization fails. Stripe now steers new usage-based builds to Metronome; stay per-seat.

## Seat model and pricing (recommended; dollar figures deliberately absent)
- **Seat classes:** Editor (billable), Viewer (free, unlimited, signed-in), external per-board
  guest (free, as today). Optional Reviewer/Collab seat later.
- **Charge point:** an explicit, previewed, prorated confirmation when an org admin grants an
  editor seat; invite links and pending invites for org workspaces mint viewer access by
  default and request a seat.
- **Tiers on one org machinery:** Free (card cap, as today) · Creator (individual, unchanged)
  · Team (self-serve, per editor, monthly and annual, **SSO + verified domains + member admin
  + public-link policy + basic audit included**) · Enterprise (quote/invoice: SCIM, audit
  export, retention/legal hold, residency, watermark/download controls, IP allowlist, minimum
  seats) · Production (film: flat fixed-term per-production licence on invoice/PO, unlimited
  viewers, wrap date, archive/export).
- **Differentiators worth building:** inactive-seat credit (Slack fair billing), true-down at
  renewal, share-link inventory with bulk revoke, wrap/archive mode.

## Owner decisions (2026-09-09)

| Question | Decision | Consequence for the plan |
|---|---|---|
| Beachhead | **Both in parallel, no priority** | Build the shared core first (org layer, roles, entitlement resolver, seat ledger, audit, policies), then ship the self-serve **Team** tier and the invoiced **Production** licence in the same release rather than sequencing one segment ahead of the other. |
| Tier shape | **Team includes SSO** | SAML SSO, verified domains, member admin, public-link policy and basic audit ship in the self-serve tier; SCIM, audit export, retention/legal hold, residency, watermarking and IP allowlist are Enterprise. |
| Creator plan | **Keep Creator and Free unchanged; orgs are additive** | `subscriptions`/`paid_grants`/`profiles.tier` stay as the personal path. A person may hold a personal sub and an org seat. Public copy moves from "no seats, ever" to "viewers and guests are always free". |
| Compliance | **Code only, no external assessments yet** | The customer-facing audit log, policies and controls are built as product features. SOC 2, TPN and pen-test spend are deferred; the plan includes only zero-cost trust artefacts (a security page stating what is already true, a versioned subprocessor list, at-rest encryption statement). Stated plainly: studio content-security review and corporate procurement will remain a loss until this changes. |

## Recommended architecture

Ten principles, then the parts. (Source: the architecture design from the panel, re-cut to
the owner's decisions; the adversarial code review is folded in under "Review findings".)

1. **One new tenant row, `organizations`, above workspaces. `workspaces.org_id` is nullable;
   null means personal, owned by `created_by`.** No existing workspace row is rewritten and no
   migration touches `boards`, so the 0275 live-root invariant cannot break.
2. **Authorization stays in the six existing choke points** (`is_workspace_member`,
   `can_write_workspace`, `can_write_board`, `can_read_board`, `my_workspace_ids`,
   `my_readable_board_ids`), signatures unchanged, each gaining one org branch through a new
   predicate pair `is_org_admin(org)` / `_workspace_owner_ok(ws)`. The ~15 copy-pasted
   `created_by <> auth.uid()` owner checks are replaced by that one predicate first.
3. **Entitlement is derived, not stored:** `billing_subject(ws) → ('org', id) | ('user', id)`
   and `subject_entitlement(kind, id)`. The five cap/quota gates re-key from
   `board_workspace_owner()` to the subject in one migration. No org event ever writes
   `profiles.tier`, which removes the three-writer race for org users. The cap trigger's
   `tier is distinct from 'demo'` exemption becomes `card_cap is null`, and `authorize_upload`'s
   `not in ('paid','admin')` becomes `not paid_uploads` (named honestly: that check gates the
   multipart upload path outright, not file types; the per-type caps are client-only in
   `fileIngest.js` until Phase 2B adds a server gate, and `billingCopy.js` must name the real
   gate), so a new plan string can neither
   silently uncap nor be treated as unpaid.
4. **Seats are state on `org_members` (`seat in none|editor|reviewer`)** plus a Stripe mirror
   in `org_subscriptions`. Assigning into a free purchased slot is immediate and free
   (pooled seats for rotating crew); assigning past the purchased count is an explicit,
   previewed, prorated purchase; releasing returns the slot; period end trues down to
   `max(in_use, seat_floor)` with `proration_behavior: none`.
5. **One Stripe Product per plan family** (Team, Enterprise, Production). Creator's Product
   and code path are untouched. Pure billing logic goes into `activateCore.mjs` with node
   tests; `stripe-webhook` branches on `metadata.soleil_org_id`.
6. **Identity is Supabase-native SAML** routed by verified domain from the single email box
   in `AuthGate.jsx`; JIT membership by a **new** trigger (the fragile
   `ensure_profile_for_new_user` is not touched); "SSO required" enforced in the custom
   access token hook, the only server-side point that covers OTP, magic links, `/resume`
   tokens, Scout links and OAuth-consent sessions at once.
7. **One audit spine, `org_audit_log`,** written by `_org_audit()` from inside the mutation
   RPCs; 1-year default retention; keyset reader in the 0223 shape; CSV first. The event
   names double as the vocabulary for org-level webhooks later.
8. **Org policies are one typed row (`org_policies`)** read by `_effective_policy(board)` and
   enforced inside `_resolve_share_target` and the link/invite/share RPCs, never only in UI.
9. **Org admins get content access by default** (`admin_content_access='always'`), because
   deprovisioning, transfer, export, legal hold and wrap all need it; a `break_glass` mode
   (time-boxed, audited elevation) is the regulated-buyer alternative and is one predicate.
10. **The inherited holes close first** (Phase 0), because the org model would inherit every
    one of them on day one.

### Data model (new tables; every table RLS-on, writes only via SECURITY DEFINER RPCs)
| Table | Purpose | Key columns |
|---|---|---|
| `organizations` | tenant | `name, slug, kind team\|enterprise\|production, stripe_customer_id, storage_quota_bytes, term_start_at, term_end_at (wrap), archived_at, deleted_at` |
| `org_members` | directory + seats | `role owner\|admin\|member\|guest, seat none\|editor\|reviewer, status active\|suspended, external_id, scim_managed, expires_at (guests), last_seen_at` |
| `org_policies` | one row per org, typed columns | `public_links_allowed, max_link_ttl_days, allow_indexing, require_signin_to_view, allowed_view_domains, invite_domains, external_share_mode, guest_editors_allowed, max_free_guest_editors, downloads_allowed, read_url_ttl_seconds, watermark_mode, ai_processing_allowed, members_can_create_workspaces, personal_workspaces_allowed, revoke_links_on_removal, mfa_required, session_max_hours, ip_allowlist, audit_retention_days, trash_days, legal_hold, admin_content_access` |
| `org_subscriptions` | org Stripe mirror (personal `subscriptions` untouched) | `plan team_monthly\|team_annual\|enterprise\|production, status, collection_method, stripe_subscription_id, stripe_item_editor, stripe_schedule_id, stripe_quote_id, stripe_invoice_id, seats_editor, seat_floor, overage_allowed, grace_until, po_number, pending_quantity_editor, sync_* debounce columns` |
| `org_invites` | org-level invites (new table; the 0086/0227/0228 partial-index arbiter history is why) | `email, role, seat, workspace_ids[], token, expires_at, claimed_at`; unique `(org_id, lower(email)) where claimed_at is null` |
| `org_domains` | verified domains | `domain pk (globally unique), verification_token, verified_at, capture_mode off\|jit\|claim, sso_provider_id` |
| `org_sso` | SAML config | `provider_id (auth.sso_providers), enforced, default_role, default_seat` |
| `org_audit_log` | customer-facing audit | see Audit below |
| later: `org_scim_tokens`, `auth_session_seen`, `org_admin_elevations`, `org_export_jobs`, `share_link_acceptances` | | |

Existing-table changes, all additive: `workspaces.org_id` (nullable, `on delete restrict`),
`workspaces.org_visibility private|org_read|org_edit`, `workspaces.archived_at`;
**column-scoped UPDATE grants on `workspaces`** (only `name`, `settings`) and re-issue of the
0247 `boards` grant list (18 columns including `day_types`; re-issuing 0238's older
17-column list would silently revoke `day_types` and break `setBoardDayTypes`) minus `id`,
`workspace_id` and `created_by`, granted to `authenticated, anon` exactly as 0247 does; `workspace_members.role` CHECK
`owner|admin|editor|viewer|service` with a pre-assert; `api_request_log` FKs → `set null` plus
`actor_label`; `api_sessions.session_id`; later `board_shares.expires_at`, `api_tokens.org_id`,
`webhooks.org_id`.

Orgs acquire workspaces three ways only: `_org_provision` creates one org-owned workspace with a
live root in the same transaction; `org_adopt_workspace` (creator who is also an org admin,
single-row update); `create_workspace_with_root(p_name, p_root_name, p_org_id default null)`. That last one
must be `drop function create_workspace_with_root(text, text)` then `create` in one
transaction, re-issuing its 0311 revoke and the `authenticated` grant: PostgREST resolves
overloads by argument name, so a second overload makes the production client's
`{p_name, p_root_name}` call ambiguous (PGRST203) the instant the migration applies. The repo
documents this exact trap at 0247:95-99; `orgInvariants` asserts a single overload. `get_or_create_personal_workspace`
gains `and w.org_id is null`. Rollback is DDL-only.

### Authorization
- New predicates: `my_org_ids()`, `my_admin_org_ids()`, `org_role`, `is_org_member`,
  `is_org_admin`, `_require_org_admin`, `workspace_org`, `_actor_active` (suspend gate),
  `_workspace_member_role`, `_workspace_owner_ok`, `_workspace_manager`,
  `_workspace_writable` (org state ∈ active|grace, not archived), `_seat_can_edit`,
  `my_admin_workspace_ids`, `can_read_workspace` (for PartyKit), `can_comment_board`.
- `can_write_workspace` becomes: `_actor_active() and tier <> 'waitlist' and
  _workspace_writable(ws) and _seat_can_edit(ws) and (member role in (owner,admin,editor,service)
  or _workspace_owner_ok(ws) or (org_visibility='org_edit' and is_org_member(org)))`. This is
  where **viewer becomes real** and where the seat is enforced, once.
- `can_read_board` gains `_actor_active()` and share expiry; `my_workspace_ids` /
  `my_readable_board_ids` gain the identical branches; a token test plus the 0294 live
  equivalence query keep read and write paths symmetric.
- The read and write paths are **already asymmetric today**: `can_write_workspace` and
  `can_write_board` carry an explicit `workspaces.created_by = auth.uid()` branch (0188:92-95,
  118-124, "an owner is not necessarily a `workspace_members` row") while `can_read_board`,
  `my_workspace_ids` and `my_readable_board_ids` test membership and shares only; 0295:25-28
  records that the sets coincide only because no live workspace has a non-member creator. So
  `_workspace_owner_ok` and the org branches land in **all six** bodies, and
  `ownerPredicate.test.mjs` asserts the same owner+org token set in all six, or
  `party/auth.ts` (which admits on the `boards` SELECT policy) refuses a socket to someone
  `can_write_board` says may write.
- The allowed member-role set is stated once, in `_workspace_member_role(ws) in
  ('owner','admin','editor','service')`, and used by both write predicates; omitting
  `'service'` from `can_write_board` would kill every service account's `/api/v1` writes.
  `roleCheck.test.mjs` asserts `'service'` is present in both.
- Four `realtime.messages` policies call the choke points directly and change with every
  predicate edit: `ws:` read/write via `is_workspace_member` (0010:41-56) and `board:`/`y:`
  readers and writers via `can_read_board`/`can_write_board` (0013:136-162). They are in the
  Phase 0 change list and in the RLS probe.
- `can_comment_board` is defined as `can_read_board(b) and _actor_active()`: the comments
  insert policy already gates on `can_read_board` (0031:50-55), so share viewers can comment
  today; narrowing it would be a live regression. The docs (`collaborate/comments.md`), which
  claim viewers cannot comment, are corrected instead, and a per-org "viewers may comment"
  policy is reserved for later.
- Org admins never gain cross-workspace board moves (`move_boards_under` keeps its skip and the
  `boards` grant loses `workspace_id`).
- Owner-predicate extraction: the 15 bodies are re-emitted from `pg_get_functiondef` with the
  inline check replaced by `_workspace_owner_ok`; a test forbids the old pattern in 0317+.
  `transfer_workspace_ownership` gains an org-admin path that does not need the owner;
  `prepare_account_deletion` re-homes org workspaces to the org owner.
- Realtime: `party/auth.ts` `authWorkspace` → `rpc/can_read_workspace`; `party/board.ts`
  stores `{token,userId}` per connection and a 5-minute DO alarm re-runs the auth check,
  closing with 4403 on denial; `party/workspace.ts` gets `POST /kick {user_id}` behind
  `PARTYKIT_ADMIN_SECRET`, fanned out to board rooms; presence identity is verified against the
  stamped user id. Read-URL TTL becomes a per-workspace policy value.
- Deprovisioning cascade `_org_revoke_user_everywhere`: delete workspace memberships in org
  workspaces → delete their board shares → re-home `created_by` to the org owner → revoke
  their links (policy) → revoke workspace-scoped tokens and disable their service accounts (the `service_accounts` table, 0222:120-150, via `service_account_disable`, not only the `workspace_members` row) →
  suspend/remove the `org_members` row → write `member.removed` with counts → enqueue the
  PartyKit kick. Personal workspaces also get share cascade on member removal (Phase 0).

### Entitlement resolver
`billing_subject(ws)`, `board_billing_subject(board)`, `_org_state(org)` ∈ active|grace|lapsed|
archived|pending (send_invoice orgs are active while an invoice is open within terms),
`subject_entitlement(kind,id) → (plan, state, card_cap, storage_quota_bytes, paid_uploads,
features[])`, `workspace_entitlement(ws)` for the client. A person with both a personal Creator
sub and an org seat: the two never compose; personal workspaces use the user subject, org
workspaces the org subject; Settings shows both; nothing auto-cancels. `get_my_tier()` is
recreated with every existing column in order plus `orgs jsonb` and `sso_required`;
`useMyTier` maps `orgs` into the store's placeholder as `[]` so no consumer changes.
Two things the re-keying must include that the architects missed: **`storage_usage` itself
is keyed per user** (`storage_usage(owner_id)`, `_storage_usage_apply`, `storage_usage_trg`,
`reconcile_storage_usage`, `_storage_used_bytes(p_owner)`, all 0221:86-252), so re-keying only
the quota would enforce an org's ceiling against two disjoint per-creator counters; `0324`
adds a subject key to `storage_usage`, re-emits the trigger and reconcile, and makes
`_storage_used_bytes` take the subject. And `authorize_upload` (0221:261-292) reads
`workspaces.created_by` inline rather than through `board_workspace_owner`, so the complete
caller set to re-key is: `enforce_demo_card_cap_trg` (0252:53), `get_board_capacity`
(0229:171), `scout_board_capacity` (0229:211), `authorize_image_upload` (0221:310), plus
`authorize_upload`'s inline read. `my_storage_usage()` (0154:87-105, never redefined) is
re-emitted to take the billing subject: today it reads the global no-arg quota, recomputes
`used` with a live sum instead of the rollup, and keys on `w.created_by = auth.uid()`, so an
org editor's meter would read zero while their uploads charge the org
(consumer: `useStorageUsage.js:19`).

### Seats and Stripe
- Products: `Soleil Clusters Team` (editor monthly/annual Prices, optional reviewer Prices),
  `Soleil Clusters Enterprise` (annual editor Price per quote; `send_invoice`, `days_until_due`,
  PO in `invoice_settings.custom_fields`; Quotes once Invoicing Plus is on; SubscriptionSchedule
  for multi-year), `Soleil Clusters Production` (a one-off invoice per band, not a subscription;
  `term_start_at/term_end_at` on the org; extension = another invoice). A committed
  `supabase/functions/.env.example` names every `STRIPE_*` var.
- `create-org-checkout-session`: server-generated `org_id`, Stripe Customer per org
  (`metadata.soleil_org_id`), Checkout with `adjustable_quantity`, `automatic_tax`,
  `tax_id_collection`, `billing_address_collection: required`, trial via `trial_period_days` +
  `missing_payment_method: pause`, 1h expiry. **The org row is created by the webhook, never
  before payment.** `verify-org-checkout-session` mirrors the existing polling fallback.
- `org-seat-purchase`: `preview` = `invoices.createPreview` with a pinned `proration_date`;
  the client shows "Add 1 editor seat: $X today, then $Y/period for N seats"; `confirm` reuses
  the same `proration_date` and an idempotency key `seat-purchase:<org>:<date>:<n>` with
  `proration_behavior: always_invoice`. Seat changes capped at 60/org/hour in app logic.
- `org-billing-sync` (pg_cron every 2 min via `pg_net`, plus the daily pass): debounced quantity
  pushes (≤100/hour/subscription), period-end true-down (also for `send_invoice`, which gets no
  `invoice.upcoming`), cursor-paged daily reconcile with `billing_flag` rows, T-30/T-7 renewal
  notices for invoiced orgs, production term notices and auto-archive at `term_end_at`.
- Webhook set: `checkout.session.completed`, `customer.subscription.created|updated|deleted|
  trial_will_end`, `invoice.paid|payment_failed|finalization_failed|upcoming|finalized`,
  `customer.deleted`; all upserts keyed on `stripe_subscription_id`/`org_id`; provisioning is
  `on conflict do nothing`.
- Two misroutes into the personal path that the code makes possible, both closed in the same
  change: (1) `onCheckoutCompleted` resolves a user via `resolveUserId` whose last fallback is
  `user_id_by_email` (`stripe-webhook/index.ts:112-114`, `activate.ts:40-47`), so an org
  checkout with no `supabase_user_id` would activate the purchaser's personal tier and mirror
  the org subscription into their `subscriptions` row forever; the org branch is therefore the
  **first** test in the `switch` and in every handler (`if (obj.metadata?.soleil_org_id) return
  onOrg…`), `resolveUserId` is never consulted for an org-tagged event, and
  `activateCore.test.mjs` asserts it. (2) `pickReusableCustomer` (`activateCore.mjs:198-205`)
  treats any customer without `supabase_user_id` as claimable, so the next personal Creator
  checkout by an org admin would adopt the org's Stripe customer; it now skips customers
  carrying `metadata.soleil_org_id`, org customers get a distinct billing email, and a node test
  covers it.
- Portal: three `billingPortal.configurations` created by a committed idempotent script
  (Creator as today; Team without `subscription_update` because seat quantity is owned by the
  explicit-purchase flow; Enterprise/Production without cancel).
- Numbers: `billingCopy.js` owns `TEAM_PRICING`, `TEAM_TRIAL_DAYS`, `ENTERPRISE_MIN_SEATS`,
  `PRODUCTION_BANDS` (labels) and the feature lists with the "name the enforcing code" rule;
  `gen-docs.mjs` FACTS gains the matching camelCase keys (its placeholder regex is
  `[a-zA-Z][a-zA-Z0-9]*`, so an underscored key ships as literal text into the public docs and
  `llms.txt` with no error); `billingCopy.test.mjs` bans `/no seat limit/i`,
  `/not per seat/i` (Team copy), `/unlimited editors/i` (its BANNED loop today scans only
  `CREATOR_FEATURES` and `PRICING_META_DESCRIPTION`, so the loop is extended to every plan's
  feature list and a separate corpus test greps `boards/content/docs/**/*.md` and
  `seoLanding.js`, which is where the promises actually live); the docs corpus rewrites listed in the
  research section land in the same commits.

### Identity
- SAML: founder-run `supabase sso add` runbook first; self-serve via the Management API later.
  Attribute mapping default `email|mail, givenName, sn`; IdP-initiated answered with a bookmark
  app (PKCE constraint).
- Verified domains: TXT `_soleil-verify.<domain>` checked by an edge function over
  DNS-over-HTTPS; freemail domains refused.
- `AuthGate.jsx`: before `signInWithOtp`, `rpc('auth_route_for_email')` returns
  `otp|sso|either`; `sso` → `signInWithSSO({domain})`; the existing `?code=` branch in
  `consumeAuthCallback` completes it.
- JIT: `org_jit_membership_trg` AFTER INSERT on `auth.users`; `org_claim_domain_accounts`
  for existing accounts (personal workspaces stay personal).
- `custom_access_token_hook` (a Postgres function in `public` with `grant execute … to
  supabase_auth_admin`, `usage` on the schema and `select` on `org_sso`/`org_domains`/
  `org_members`, revoked from `authenticated`, `anon` and `public`; no hook and no
  `supabase_auth_admin` reference exists in the repo yet, and it is enabled in the dashboard
  only, because the local CLI cannot push `config.toml`): denies non-SAML token issuance for enforced orgs (owner
  bypass for IdP outages; `api_sessions.session_id` exemption for API-minted sessions),
  implements `session_max_hours` and `mfa_required`, and writes `auth.sign_in` once per session.
- SCIM 2.0 (Enterprise phase): `worker-scim.js` at `/scim/v2/*`, per-org bearer in
  `org_scim_tokens`, Users + Groups (`Soleil Admins`, `Soleil Editors`, `ws:<slug>`),
  `active:false` → cascade + suspend, never destroys data; ServiceProviderConfig/ResourceTypes/
  Schemas static; a `publicSurface.mjs` `scimEndpoints()` extractor so the docs gate sees it.

### Admin console and app shell
- A signed-in route `/org` (TierRouter slot, lazy like `AdminPage`, reusing AdminPage's tab
  chrome, `useAdminData` async/skeleton pattern, `AdminUserList`/`AdminUserRowMenu` for the
  roster, `AdminAuditTab` for the reader) with tabs `overview, members, workspaces, seats,
  security, sharing, audit, integrations`; plus one Settings tab `organization` in a new
  `Organization` group for identity-shaped settings. Tab ids are lowercase to satisfy the
  docs-gate regex, and every TABS entry is written `{ id, label, group }` in that order, because
  the extractor's regex (`publicSurface.mjs:181`) requires `label` to follow `id` immediately
  and its count is a floor, so a reordered entry would drop out of the hash with the test
  still green; a new `organizations` docs section documents both.
- Member removal shows an undo toast (removal is a 30-second suspend, then the cascade).
- `WorkspaceMenu.jsx` gains sections Personal / one per org / Shared with you; an org switch
  is a workspace switch. Command palette gets org entries gated on `is_org_admin`.
- Mobile: read-only lists in the stacked pattern; no fifth bottom tab.
- `?orgqa=1` DEV harness (`local/OrgPreviewHarness.jsx`, behind the literal
  `import.meta.env.DEV` guard like every existing harness) renders every tab against invented
  fixtures.

### Audit log
`org_audit_log(id, org_id, at, actor, actor_email, actor_kind user|service|scim|system|stripe|
operator, action, target_kind, target_id, target_label, subject_user, workspace_id, board_id,
ip, user_agent, request_id, payload)`; no FKs on `org_id`/`actor` so trails outlive deletion;
`_org_audit(...)` reads `ip`/`user_agent` from `request.headers`; `org_audit_read(...)` keyset
with filters; `purge_org_audit_log` daily at a non-colliding minute, honouring `legal_hold`.
Event taxonomy (write point in the design): `org.*`, `member.*` (invited, joined, jit_joined,
captured, role_changed, suspended, reactivated, removed, expired), `seat.*` (assigned,
released, purchased, trued_down, unavailable), `workspace.*` (incl. `rewound`, today unaudited),
`board.*` (shared, share_role_changed, unshared, invite_sent, invite_claimed, deleted, restored),
`link.*` (created, settings_changed, revoked, claimed, blocked_by_policy), `export.*` (board,
image, document, audit, org_bundle), `policy.changed`, `domain.*`, `sso.*`, `scim.*`,
`billing.*`, `auth.*` (sign_in, denied_sso_required, sso_bypass_owner, mfa_enrolled),
`token.*`, `service_account.*`, `webhook.*`, `oauth.*`, `admin.elevated`. An
`auditCoverage.test.mjs` asserts every listed RPC's latest body contains `_org_audit(`.
Out of scope, stated in the docs: canvas edit attribution (board_ops `author_id` is always null),
board reads/presence, operator access (stays in `admin_audit_log`), tamper evidence, SIEM push.

### Policies and film controls
Each `org_policies` column has one enforcement point (table in the design): link RPCs and
`_resolve_share_target` for links/indexing/sign-in/domains/TTL; `share_board`/
`invite_workspace_member`/`claim_collab_link` for invite domains and the guest-editor brake;
share bundle + `GET /api/v1/images/:key` for downloads; upload party `signReadUrl` for TTL;
share and board viewers for the visible watermark overlay; Worker AI routes for `ai_processing`;
workspace-creation RPCs; the access-token hook for MFA/session; purges for retention/hold.
Film-specific: production term + wrap (S), `org-export` Worker job producing a manifest plus a
streamed ZIP of originals (L), revocable reads via policy TTL now and Worker-proxied media later
(M), visible watermark overlay (S) with server-side burn-in later (M), NDA click-through on
links (M), wrap-date bulk offboarding via `org_members.expires_at` (S). Forensic watermarking
is out of scope.

## Phased delivery (re-cut for "both segments in parallel")

Effort is solo-founder engineer-weeks including tests and docs. Migrations from 0317; reserve
the range because the repo has 22 duplicated prefixes already.

**Effort reality check (from the judge, accepted):** the architects' numbers are floors. Phase 1
bundles seven migrations including a ~15-body rewrite, audit instrumentation of ~30 RPCs,
~20 new RPCs, a multi-tab route, docs and probes; 6-8 weeks is credible, not 4. The film
controls sum to about 5 weeks on their own once the export fix, ZIP bundle, proxied reads and
wrap flow are counted. Realistic totals: Phase 0 1.5-2, Phase 1 6-8, Phase 2 8-10 (2A 4-5, 2B
4-5), Phase 3 6-8, so **22-28 solo weeks to the Enterprise tier and 16-20 to the first
sellable release.** Ship each phase's migrations behind org rows that do not yet exist, so
nothing in production changes behaviour until the matching client is promoted.

### Phase 0 — close the inherited holes (1.5-2 weeks; sellable: nothing, but the security answers stop being false)
- `0317` column-scoped UPDATE grants on `workspaces` and `boards` (assert via
  `information_schema.column_privileges`). Verified 2026-09-09 by direct reading: `workspaces`
  has exactly `id, name, created_by, created_at, settings`; no grant or revoke statement
  touches it in any migration; the 0047 policy tests only membership with role in
  (`editor`,`owner`); the only client write is `boardsApi.js:100` `.update({ name })` and
  settings go through `merge_workspace_settings`. So `grant update (name, settings)` after a
  table-level revoke breaks nothing and closes the `created_by` rewrite. Schema-drift note:
  the live table also carries `ai_tagger_enabled` (read by `useAiTagger.js:214`, no migration
  file exists); `0317` formalises it with `add column if not exists` and keeps it out of the
  client grant unless a writer is found;
- `0317` also closes `public_share_links`: its 0018 policy is `for all` for the owner, so an
  owner can insert, re-point, un-revoke or flip indexing on link rows via raw PostgREST,
  bypassing any policy enforced inside the link RPCs. Revoke client insert/update/delete and
  replace the policy with select-only; every write already goes through
  `create_public_link`/`revoke_public_link`/`set_public_link_*`/`create_collab_link`.
- `0318` also fixes `invite_workspace_member`'s pending path (0086:208-213), which stores
  role `'workspace'` regardless of `p_role`, so an invited viewer becomes an editor on claim.
- Server-authoritative bytes (small, from the storage digest): the multipart `complete` and
  the presign path HEAD the object and correct `images.size_bytes`, so the quota an org is
  sold against cannot be under-declared by a client. `0318` `workspace_members.role` CHECK with
  pre-assert, share cascade in `remove_workspace_member`/`leave_workspace`,
  `set_workspace_member_role` RPC, viewer excluded from `can_write_workspace`/`can_write_board`
  **and `authorize_upload` re-emitted without its `or public.is_workspace_member(...)` clause
  (0221:277), otherwise a viewer still opens multipart uploads**,
  comments insert policy → `can_comment_board`; `0319` `_actor_active` suspend gate in
  `can_read_board`; `0320` `api_request_log` durability: both `token_id` and `user_id` are
  `NOT NULL … on delete cascade` (0220:221-222), so `set null` needs `drop constraint`, `alter
  column … drop not null` on both, a backfill of `actor_label`, then `add constraint … not
  valid` and `validate constraint` (the `add` is the expensive step; the drop is metadata-only).
- Party: presence identity check; `authWorkspace` via RPC. Any workspace `viewer` row that
  exists today loses `board_state`/`card_index` writes when 0318 lands and their open socket
  flips to `readOnly` within the 10-second auth cache; 0318 counts such rows first and the
  owners are told before promotion.
- Client: ShareModal role picker for workspace invites; workspace **Members** tab in Settings
  (reuses `invite_workspace_member`/`remove_workspace_member`/`transfer_workspace_ownership`,
  all owner-gated today, so the tab is owner-facing until Phase 1's `_workspace_owner_ok`
  admits org admins). Correct CLAUDE.md in the same commit: its "there is no CI" line is
  stale, and the plan relies on CI running `npm test` and `docs:check`.
- Tests: `roleCheck.test.mjs`, `ownerPredicate.test.mjs` skeleton, Playwright `share-roles.spec.js`.

### Phase 1 — org core: one authz model, one resolver, one audit spine (6-8 weeks; sellable: sales-led Production licence and design-partner orgs, admin-provisioned)
- `0321` organizations/org_members/org_policies/org_subscriptions/org_invites +
  `workspaces.org_id/org_visibility/archived_at` + `org_plan_defaults` seed; `0322` org
  predicates and InitPlan branches; `0323` owner-predicate extraction (15 bodies); `0324`
  billing subject + entitlement + gate re-keying (five callers plus `authorize_upload`'s inline
  read) + `storage_usage` subject key with re-emitted trigger and reconcile + `my_storage_usage`
  re-emitted on the subject; `0325`
  `org_audit_log` + instrumentation of existing share/invite/link/member RPCs; `0326` org RPCs
  (`org_*`, `claim_org_invite`, `admin_create_org`, `admin_org_grant`,
  `_org_revoke_user_everywhere`, `org_adopt_workspace`, `org_archive`); `0327` `get_my_tier`
  with `orgs`. Gotcha: a `RETURNS TABLE` function cannot gain columns via `create or replace`
  (42P13), so `0327` must `drop function` then `create` in one transaction **and re-issue
  the grants**, because the DROP discards the ACL. Decision: re-issue `grant execute … to
  anon, authenticated`, preserving 0311's deliberate pre-signup anon allowance for
  `get_my_tier` (0311:21-23) so the `has_function_privilege` sweep sees no delta. Callers:
  `useMyTier.js:105` and two Worker REST callers, `worker.js:2823` and `worker-seo.js:103`. The production
  client reads named fields, so the extra columns are invisible to it until promotion.
- Edge: `admin-org-action` (provision enterprise/production org with grant or
  `send_invoice` subscription/one-off invoice + PO; extend term; archive); `stripe-webhook`
  org branch for `invoice.paid|payment_failed|finalized`.
- Worker/Party: `/internal/revoke` → PartyKit kick; board-room 5-minute re-auth alarm;
  workspace-room `/kick`.
- Client: `useOrgs`; `/org` with `overview, members, workspaces, audit`; Settings
  `organization` tab; `WorkspaceMenu` org sections. **Repoint `boardsApi.getMyWorkspaceRole`**
  (today a plain RLS-filtered select on `workspace_members`, `boardsApi.js:135`) at the new
  `workspace_role(ws)` RPC, otherwise an org admin with no membership row resolves to `null`
  in `ShareModal` and `useResolvedDefaults`.
- Three decisions folded in from review: (a) `admin_user_detail` and `admin_export_user_data`
  write a `soleil.support_access` row to the org's audit log through the service-role writer
  whenever a platform admin reads an org member's data ("who at your company can see our
  material" is the finding a security review leads with, and 0312 already writes `_audit`
  there); (b) policy refusals are **returned as a status** (`'policy_blocked'`,
  `'seat_unavailable'`, the `claim_collab_link` convention) rather than raised, so the refusal
  audit row survives the transaction, and only RLS-level denials stay unlogged; (c) org
  workspaces get a shorter read-URL TTL from day one through the policy default
  (`read_url_ttl_seconds` 3600 for `team`, 300 for `production`) instead of waiting for the
  policy tab, so no film deal ships with the 7-day URL objection.
- `0320`'s `api_request_log` FK change uses `add constraint … not valid` then `validate
  constraint` in the 03:xx window: the table is written on every API write and a drop/add
  takes an exclusive lock on the shared production project.
- Docs: `organizations/index.md`, `members-and-roles.md`, `audit-log.md`, `account/settings.md`,
  `_sections.json`; `docs:build` + `docs:accept`.
- Tests: `orgAuthzContract.test.mjs`, `capGateKeying.test.mjs`, `auditCoverage.test.mjs`,
  `orgRootInvariant.test.mjs`, `orgInviteUpsert.test.mjs`, `activateCore.test.mjs` org cases,
  the RLS probe script, Playwright `org-console.spec.js` on `?orgqa=1`.

### Phase 2 — the first sellable release: Team self-serve + SSO (2A) and org policies + film controls (2B), shipped together (8-10 weeks; sellable: TEAM self-serve, PRODUCTION with studio-review answers, Creator unchanged)
- **2A** Stripe Team Product/Prices, portal-config script, `.env.example`; `0331`
  `org_subscriptions` Stripe columns; `0332` `org_domains`/`org_sso`; `0333` access-token hook +
  `api_sessions.session_id` + `auth_session_seen`; `0334` `auth_route_for_email`; `0335` JIT
  trigger. Edge: `create-org-checkout-session`, `verify-org-checkout-session`,
  `org-seat-purchase`, `org-billing-sync` (+ pg_cron), `org-portal-session`,
  `org-domain-verify`; full org webhook set. Client: `/pricing` Team card with adjustable
  seats, `/org/setup`, `seats` tab with preview/confirm dialog, domains/SSO panel, AuthGate SSO
  routing, Creator→Team cancel helper, `checkoutErrors.js` additions; `apiAuth.js` records
  `session_id`. Docs: `organizations/billing.md`, `sso-and-domains.md`, `account/plans.md`
  rewrite, the promise-reconciliation edits, `docs/runbooks/sso-onboarding.md`.
- **2B** `0328` policy enforcement (`_effective_policy`; link/share/invite/claim RPCs and
  `_resolve_share_target` re-emitted verbatim plus checks; `org_set_policy`, `org_list_links`,
  `org_external_access`, `org_revoke_links_for_user`, plus `public_share_links.passphrase_hash`
  checked inside `_resolve_share_target`: passphrase, expiry, no-download and revoke are the
  four per-link controls the film research calls table-stakes); `0329` `_org_state` +
  `_workspace_writable` wiring + term notices; `0330` legal-hold-aware purges. The wrap
  export bundle is a streamed ZIP of originals (`fflate` in the Worker, `org_export_jobs`,
  drained on the existing `45 * * * *` cron) whose download is served through the
  policy-aware media route, never a 7-day presigned URL. Party:
  per-workspace read TTL, download flag and watermark data in the share bundle. Worker:
  `/images/:key` download policy, AI-route policy check, `org-export` job. Client: `security`
  and `sharing` tabs, ShareModal policy-aware options, watermark overlay, archived banner,
  wrap/extend UI. Docs: `organizations/policies.md`, `production-licence.md`,
  `collaborate/sharing.md`, `account/data-and-privacy.md`.
- Tests: `activateCore.test.mjs` (mirror, state, true-down, debounce, idempotency keys),
  `billingCopy.test.mjs` bans, docsite price facts, `policyEnforcement.test.mjs`, Playwright
  `org-checkout.spec.js` (Stripe test mode), `sso-route.spec.js`, `share-policy.spec.js`,
  `org-archive.spec.js`; the Stripe test-clock matrix run and recorded.

### Phase 3 — Enterprise (6-8 weeks; sellable: ENTERPRISE with SCIM, audit export, retention/legal hold, IP allowlist, MFA/session policy, invoice/PO, quotes, org keys and webhooks)
- `0336` SCIM tables; `0337` retention/hold purge wiring; `0338` `api_tokens.org_id`,
  `webhooks.org_id`, org-level inventory/revoke; `0339` `board_shares.expires_at`; `0340`
  IP/session/MFA; `0341` break-glass elevation; `0342` share requests + NDA acceptances.
- Worker: `worker-scim.js` + `scimEndpoints()` extractor; `GET /api/v1/orgs/:id/audit`
  export; org-scoped `/api/v1` keys; IP checks. Edge: `org-sso-admin` (Management API),
  Quotes in `admin-org-action`. Client: `integrations` tab, SCIM tokens, MFA enrollment,
  elevation dialog, share-approval inbox. Sign-out-everywhere for a member, if promised, is
  implemented by deleting that user's `auth.sessions`/`auth.refresh_tokens` rows under the
  service role plus the PartyKit kick; `auth.admin.signOut` takes a JWT, not a user id, and
  cannot do it. Org policies gained from review for this phase: `api_access`
  (`allowed|service_accounts_only|off`, enforced in `api_token_resolve`/`api_token_mint`),
  `oauth_clients` (`allowed|allowlist|off` + `oauth_allowlist[]`, enforced in
  `oauth_authorize_consent`), and `explore_publish`/`template_publish` gates on
  `submit_board_to_explore` and `submit_grid_layout_to_public` (template publishing is
  auto-publish today, an NDA leak for a code-named title). Docs: `api/scim.md`, `api/organizations.md`,
  `organizations/enterprise-controls.md`, `api/audit.md`.
- Tests: `scimContract.test.mjs`, Playwright `scim-users.spec.js`, `api-v1-errors.spec.js`
  parity, elevation RLS probes.

### Phase 4 — scale, residency, trust (open-ended)
EU Supabase project + `eu` R2 and Durable Object jurisdictions keyed on `organizations.region`;
Worker-proxied revocable media with server-side watermark burn-in; SIEM push over org webhooks;
operator-access feed; inactive-seat credits; Slack/Discord notifications; a `/security` docs
page and versioned subprocessor list stating only what is already true (zero spend).

## Verification
- **Migration-text tests** (`boards/src/lib/*.test.mjs`, run by `npm test` in CI): a shared
  `boards/src/lib/migrationText.mjs` lifts `latestDefinition()` out of `inviteUpsert.test.mjs`,
  orders by apply order rather than filename (22 prefixes are duplicated today, and filename
  order is wrong for them), tolerates `drop function` + `create function`, and guards that no
  two files share a prefix from 0317 on;
  `orgAuthzContract` (every 0317+ definer function is revoked from public/anon/authenticated or
  on the 0311 allowlist with a reason; the six choke points and both InitPlan helpers carry the
  same org-branch tokens), `ownerPredicate`, `capGateKeying`, `auditCoverage`,
  `policyEnforcement`, `orgInvariants` (no migration ≥0317 writes `parent_board_id` or
  `deleted_at` on `boards` outside `move_boards_under`/`_ensure_workspace_root`/
  `soft_delete_board`, and the `workspaces`/`boards` column-grant lists never contain
  `created_by`, `org_id` or `workspace_id`), `orgInviteUpsert`, `roleCheck`;
  `securityInvokerContract` covers the new view; `activateCore.test.mjs` includes an
  `orgAccessDecision(status, collection_method, grace_until, now)` table enumerating every
  status × collection-method × grace cell, with the invariant that **suspension never affects
  reads or export**; `billingCopy.test.mjs`, `docsite.test.mjs` for copy and facts; a new
  `orgRoutes()` extractor in `publicSurface.mjs` snapshots the `OrgPage` TABS literal the way
  `settingsTabs()` does, so `/org` tabs cannot ship undocumented (TierRouter is invisible to
  the gate).
- **RLS isolation probe** (`supabase/tests/org_rls_probe.sql`, run via MCP `execute_sql` inside
  `begin … rollback` before and after each phase): two orgs, four principals, personal
  workspace; per-user `set local role authenticated` + `request.jwt.claims`; row-count
  assertions on boards/images/shares/org tables; `can_write_board` false for seatless member and
  viewer; `_resolve_share_target` raises under each policy; anon gets zero rows;
  `has_function_privilege('anon', …)` false for every `_`-prefixed function; re-run the 0294
  read-equivalence query over live boards.
- **Stripe:** test-clock matrix from a new `scripts/stripe-test-clocks.mjs` (mid-cycle add =
  preview amount; release + re-assign inside period = no charge; period-end true-down; trial
  converting; trial expiring with no card → paused → read-only; payment failure → grace →
  recovery; cancel at period end; `send_invoice` annual crossing renewal with no
  `invoice.upcoming`; production invoice paid then term expiry; customer deleted) with results in
  the promotion PR. Each scenario asserts three targets: the `org_subscriptions` mirror, the
  seat audit events, and **the finalized invoice total equals the previewed amount** from
  `invoices.createPreview` with the pinned `proration_date` (the only test that proves the
  Miro pattern rather than mirror state). Webhook replay test (every event twice, mirror
  unchanged).
- **Playwright:** `org-console`, `share-roles`, `share-policy`, `org-archive`, `org-checkout`,
  `sso-route`, `scim-users`; `collab-invite-link-wiring` extended for policy refusals;
  `api-v1-errors` parity for new routes and codes (`policy_public_links`, `seat_unavailable`,
  `signin_required`, `sso_required`).
- **Docs gate:** `npm run docs:build && npm run docs:accept` in every commit that adds a tab,
  route, endpoint, MCP tool, limit or price; CI `docs:check` stays green.
- **Promotion checklist per phase:** migrations applied only after the production Worker/client
  of the previous phase is confirmed to ignore new columns (`get_my_tier`'s added columns, and
  the `workspaces` composite that `get_or_create_personal_workspace` returns and
  `boardsApi.js:73` reads with `select('*')`), **then `prod-health.spec.js` plus
  one manual share/invite against production before the client cherry-pick**; cherry-pick in
  an isolated worktree with `boards/.env.local` copied in first, gated on `AppShell-*.js`
  ≈500 KB and the dist marker; `npm run deploy:party` only after the Worker; `git log -p`
  grepped against a private deny-list for customer names and numbers; rolled-back probe passes
  on live;
  `has_function_privilege` sweep shows no new anon-executable definer functions; Supabase
  advisor delta reviewed; Stripe webhook endpoint subscribed to the new event types; portal
  configuration ids and `STRIPE_PRICE_*` present on deployed functions (a `billing-env-check`
  admin route reports missing ones); access-token hook enabled in dashboard and config;
  PartyKit deployed with `PARTYKIT_ADMIN_SECRET`; pg_cron jobs installed without new minute
  collisions; backups green the night before; docs regenerated; cherry-pick order recorded.

## Risks (ranked) and open questions
1. RLS performance from org branches → all branches through the InitPlan helpers; `explain
   (analyze, buffers)` against the 0272 baseline.
2. Read/write asymmetry between `can_read_board` and `my_readable_board_ids` → token test +
   live equivalence query.
3. Shared Supabase project: every migration is live for the production client → additive-only
   schema; `get_my_tier` recreated in one transaction; predicates change behaviour only when org
   rows exist, and none exist until the matching client is promoted.
4. Seat bypass through free external editor shares → `guest_editors_allowed` and
   `max_free_guest_editors`, domain-matched recipients become seat-requiring members.
5. The access-token hook is a sign-in single point of failure → fast path when no enforced
   domain matches; `exception when others then return event` except the explicit deny; owner
   bypass.
6. PartyKit re-auth load → 5-minute alarm with single-flight cache; kick path for immediacy.
7. Stripe quantity limits and drift → debounce, hourly counter, cursor-paged reconcile,
   `billing_flag` rows in `/admin`.
8. Owner-predicate rewrite touches 15 live functions → bodies from `pg_get_functiondef`, one
   behaviour change each, per-function rolled-back probe, the old-pattern test.
9. Docs promises in machine-checked copy → banned-claims and facts tests fail until rewritten.
10. Public repo → invented fixture names, and **no placeholder prices anywhere public**: the
    docs pages that carry Team, Enterprise or Production figures are written only once
    `billingCopy.js` holds real values, because the repo and the docs site are both public.
11. Card-cap aggregate at org scale: `enforce_demo_card_cap_trg` sums `card_index.weight`
    across every board of the subject on each insert; org plans have no card cap, so the
    trigger short-circuits for them, but a `card_usage` rollup in the `storage_usage` pattern
    is the fix if a capped plan ever needs it.
12. Schema drift: ~53 applied migrations have no file and `workspaces.ai_tagger_enabled` proves
    it. Every migration here uses `if not exists` and asserts its own post-conditions; the
    nightly schema-only dump remains the rebuild source, and the implementer should introspect
    live definitions (`pg_get_functiondef`) before every `create or replace`.
13. "Viewer becomes real" changes behaviour for any existing `workspace_members.role='viewer'`
    row → `0318` counts them first and raises a notice; owners are told before promotion.

Open questions the owner can settle later (defaults chosen): Team trial length and whether a
card is required (default: no card, `TEAM_TRIAL_DAYS` placeholder); Enterprise `seat_floor`
and whether admins may purchase seats (default: owners and admins); reviewer seats in Team v1
(default: no, seat class reserved in the schema); break-glass default for Production orgs
(default: `always`); whether Production orgs force `org_visibility='private'` (default: yes);
EU project before the first European production (default: no, residency written down).

## Review findings

**Process.** Three panel designs were requested; the session limit cut the panel twice, so
the plan is synthesized from the complete architecture-biased design (79k chars, all sections),
the buyer-first design's film and promotion sections, and one codebase-skeptic judge verdict.
A final adversarial check of this plan against the code runs as the last step.

**Judge verdict (codebase-skeptic).** Architecture 29/40 (correctness 7, enterprise fitness 9,
migration safety 8, effort realism 5); buyer-first 26/40. Winner: architecture. Eight named
functions in the drafts did not exist (`update_share_role`, `oauth_revoke_grant`,
`submit_public_board`, `publish_grid_layout`, `ensure_public_link`, `purge_deleted_boards`,
`priceLabel`, and a wrong claim about `getMyWorkspaceRole`); none of them appear in this plan,
and the real names (`share_board` upsert, `oauth_connection_revoke`, `submit_board_to_explore`,
`submit_grid_layout_to_public`, `create_public_link`, `purge_old_deleted_boards`) are used
where relevant.

**Grafted from the buyer-first design and the judge:** the `orgInvariants` live-root and
grant-list guard; the promotion checklist's pre-client production smoke, `.env.local` copy,
AppShell size gate and party-after-Worker order; the `orgAccessDecision` exhaustive matrix and
"reads never suspend" rule; link passphrases in the same migration as NDA acceptance; the
streamed-ZIP wrap bundle served through the policy-aware route; `soleil.support_access` audit
rows from platform-admin reads; `not valid` + `validate` for the `api_request_log` FK; test-clock
assertions on invoice totals; the `orgRoutes()` extractor; the explore/template/API/OAuth
governance policies; the sign-out-everywhere mechanism correction; and the effort re-estimate.

**Verified by direct reading during planning (not delegated):** the `workspaces` column-grant
hole and the safety of `grant update (name, settings)`; the `public_share_links` FOR ALL owner
policy; the `invite_workspace_member` pending-path role bug; the undocumented
`ai_tagger_enabled` column; `pg_net` availability (0069, 0074); the `get_my_tier` DROP/ACL
gotcha; the Supabase org plan (Pro) and region (us-west-2); the live project shape.

**Adversarial code check of this plan (final step; 26 findings, all with path:line evidence,
all applied).** Blockers fixed: the `create_workspace_with_root` overload trap (DROP+CREATE);
the webhook email fallback and `pickReusableCustomer` misroutes between org and personal
billing; `api_request_log`'s NOT NULL columns. Majors fixed: `storage_usage` and
`authorize_upload` were missing from the re-keying set; `authorize_upload` ORs
`is_workspace_member` back in; the `can_write_board` role set must name `'service'`;
`get_my_tier`'s anon allowance from 0311 is preserved and the wrong ACL anecdote removed; the
grant-hygiene convention restated for post-0311 reality; read/write asymmetry already exists on
the owner branch and the org branch must land in all six predicates; the four
`realtime.messages` policies join the blast radius; `my_storage_usage` needs the subject, not
just the quota; the upload entitlement flag renamed to what it gates; `docsiteContent.js` is
generated and five more copy sites carry the contradicted promises; `billingCopy.test.mjs`'s
banned-claims loop scans two constants; the `boards` grant list is 0247's, not 0238's, and
must drop `id`. Minors folded: extractor key order, camelCase fact keys and no public
placeholder prices, column names, the 0047 policy's exact scope, PartyKit's admission gate,
the new-script marker, the DEV guard, the shared migration-text helper and the duplicate-prefix
count (22), the owner-gated Members tab, the stale "no CI" line in CLAUDE.md, the
`service_accounts` table in the cascade, the hook's `supabase_auth_admin` grants, and the
composite-return shapes in the promotion checklist.

**Decisions taken on the judge's unresolved questions:** hard SSO enforcement ships with Team
(the access-token hook is in Phase 2A, so the Team tier is never sold on a client-side gate);
org workspaces get short read-URL TTLs by policy default from Phase 1; refusals are returned,
not raised, so they are audited; org admins get content access by default with break-glass as
the Enterprise alternative; reviewer seats are reserved in the schema but not sold in v1.
