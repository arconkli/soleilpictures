# Team S5: launch

The last stage of the Team plan and the 10-editor limit (design record
`docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md`). S1–S4 are on main
behind holds; 0520–0540 are applied; team-billing is deployed and inert until its Stripe
secrets exist. This stage makes it public in one promote, then flips the switches.

## Global constraints

- Nothing public before launch. Pushing main is a preview, but any session's promote takes
  main whole, so public copy, docs and SEO text land only in the launch commit. Code that is
  safe to ship sits behind `teamsAllowed()` (preview host and dev until launch).
- Public docs change in the same commit as the surface (`npm test` runs the docs gate);
  numbers come from `{{fact:…}}`, never typed.
- `seo_health_expectations` rows that assert text this stage rewrites are reconciled with
  `seoProbeContract.js`, never deleted.
- Migrations are applied only on the owner's go; each proves its own grants (0311 habit).
- The repo is public: no business numbers in commits or files.

## Before launch (can land on main now)

- [x] 0542 "Talk to us": `team_contact_requests`, `request_team_contact` (anyone; one a day per
  address, 20 an hour in all, 10 emails a day through `ops_alert_raise`), the admin list and
  status. Written and checked in a local Postgres; NOT applied.
- [ ] The Talk to us form: mockups A (dialog) / B (under the cards) / C (its own page) on the
  Team canvas, waiting for the owner's pick. Then `lib/teamContact.js` (send, refusals) and the
  form, lazy, opened by the pricing page's "Talk to us" on both pricing pages; the admin list.
- [ ] Pricing shows the Team card to everyone `teamsAllowed()` lets in, not only the admin's
  sample: signed in, Start goes to `/team/new`; signed out, Start stashes the seats and billing
  (like `creatorIntent`) and goes to sign-in, and the app resumes at `/team/new` after it.
- [ ] 0543, the switch (written now, applied at launch): `editor_limit.enforced = true`,
  `teams_open.open = true`; the server event `editor_limit_viewer_fallback` joins
  `check_instrumentation`'s watch list. The dormant 0188 brake (`collab_free_editor_cap`) is
  dropped in a separate file the owner can run in the SQL editor if the MCP refuses DROP.

## The owner, before launch

- Stripe: the Team product with `team_seat_monthly` ($25) and `team_seat_annual` ($240),
  per unit, like Creator's; then the three `STRIPE_*_TEAM*` secrets. Needs /mcp re-auth.
- The invite email: the email session deploys send-transactional-email with `team_invite`;
  then 0541 is applied (kit ready, drift re-checked first).
- Pick the Talk to us look; say go for 0542.
- The walk-through on preview: their account in `teams_open.test_owner_ids`, a real checkout
  with their own card, invite, seats full, close.
- Later, not at launch unless the owner wants it first: Creator credit when a Creator buyer
  moves everything in, their +1TB blocks moving with them, and Team storage blocks (S3b).

## The launch commit (written at launch, on the owner's "ship it")

Copy that says editing is unlimited or that there are no per-seat charges, rewritten for "up
to 10 people who edit on Free and Creator; viewers unlimited; more than 10 → Team, $25 a
seat":

- `src/lib/billingCopy.js` (the plan rows, `workspaceNote`, the FAQ answers at ~248, ~515,
  ~560, ~567), `src/lib/pricingCrawlable.js` (~52, and a Team paragraph: the Worker's
  crawlable /pricing must say what the React page shows), `src/lib/planBlock.js`.
- `src/lib/seoLanding.js` passages that claim no seats at all (~585, ~780, ~789, ~1238,
  ~1679, ~1690): Creator stays flat up to 10 editors; Team is per seat. Title changes are
  pre-registered in the comment above them, one surface per commit.
- Docs: `content/docs/account/plans.md` (~9, ~14, ~66, ~92), `collaborate/index.md` (~9, ~12,
  ~24), `files/index.md` (~67), `index.md` (~12), `migrating.md` (~148); a new
  `account/team.md` (buying, seats, joining, admins, the seat perk, closing); FACTS for the
  seat prices, the seat range, storage per seat and the editor limit, sourced from
  `teamBillingCore.mjs`, `teamModel.js` and `editorLimit.js`.
- `/team` and `/team/new` are signed-in routes: `publicSurface.mjs` gains a `teamRoutes()`
  extractor so the docs gate sees them.
- `seoProbeContract.js` rows 78/79 ("no per-seat charges", the two-column table) and their
  `seo_health_expectations` rows, reconciled.
- `teamsAllowed()` and `editorLimitAllowed()` open on production; the changelog entry; bump
  `build_min`.

Then: promote (the release recipe), apply 0543, re-run probes A–G read-only where they can be,
watch `check_instrumentation` and the Issues view for a day.
