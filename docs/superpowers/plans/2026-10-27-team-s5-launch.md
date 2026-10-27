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
- [x] Both pricing pages show the Team card where `teamPricingAllowed()` does (Team's hold off
  dev; opt-in on dev with `soleil.dev.teamPricing`): signed in, Start goes to `/team/new`;
  signed out, Start keeps the seats and billing (`lib/teamStart.js`) through sign-in, the
  sign-in screen says so, and AuthGate opens `/team/new` with them. `/team/new` routes on
  `teamsAllowed()`. `team-pricing-start.spec.js` pins it.
- [x] 0543, the switch (written, applied at launch): `editor_limit.enforced = true`,
  `teams_open.open = true`, testers kept; its STATUS names what must be live first. 0544
  drops 0188's dormant brake (`_collab_editor_cap`, `admin_set_collab_editor_cap`, the
  `collab_free_editor_cap` row), refusing if anything still calls it (nothing does on live,
  2026-10-27); the owner runs it in the SQL editor if the MCP refuses DROP. Both checked in a
  local Postgres; `teamLaunchMigration.test.mjs` pins them.
  The planned `editor_limit_viewer_fallback` pair for `check_instrumentation` is dropped:
  the notice and the event are written by the same statement, so the pair could only fail
  if the function were rewritten, which the migration tests already catch.

## The owner, before launch

- [x] Stripe: the Team product with `team_seat_monthly` ($25) and `team_seat_annual` ($240),
  per unit, like Creator's (made 2026-10-27; both pass `teamPriceMatches`).
- [x] The three `STRIPE_*_TEAM*` secrets (set by the owner, 2026-10-27). team-billing and
  team-billing-cron are already deployed and stay dark until then, and closed until 0543.
- [x] The invite email: send-transactional-email v46 renders `team_invite` (the email session,
  2026-10-27 09:27Z); 0541 applied the same day in three parts, drift re-checked first.
- [x] Talk to us: the owner picked C, a page of its own (2026-10-27), and said go for 0542,
  applied that day in two parts and probed (sent, already, invalid, busy, one paged alert).
  The admin list (/admin › More › Talk to us) is on main; the page is on this branch.
- [x] Creator credit (S3b): the team launches without it (the owner, 2026-10-27); TeamSetup's
  switch and lines are gone on main.
- [x] The walk-through on preview: the owner walked the sample team (Settings › Preview), not
  their own account (2026-10-27), and said "ship it".

## The launch branch (local `team-launch`, lands on main at "ship it")

Built 2026-10-27 on top of main, kept off main because lifting the holds there would put Team
on the next promote:

- [x] Copy that said editing is unlimited or that there are no seats at all, rewritten for
  "up to 10 people who edit on Free and Creator; viewers unlimited; more than 10 → Team, priced
  per seat" (billingCopy, seoLanding, the docs), and "two plans" / "either plan" made three.
- [x] `account/team.md`, and FACTS for the seat prices, the seat range, storage per seat, the
  trial, the grace days, the seat perk and the editor limit, read from the code that enforces
  them.
- [x] The crawlable /pricing says what the React page shows: the hero's Team line, the Team
  section (the card's own words, `teamCardCopy`), Talk to us, a Team column, Team's per-seat
  offers in the JSON-LD, and an answer paragraph with three plans. Creator's trial stays
  absent; Team's is the Team section's own.
- [x] `teamRoutes()` in `publicSurface.mjs`, with a coverage test on `/docs/account/team`.
- [x] `teamsAllowed()`, `editorLimitAllowed()` and `teamPricingAllowed()` are `return true;`;
  the pricing specs read three cards.
- [x] Events: `pricing_team_start` (must-land) and `pricing_team_talk` from the card,
  `team_setup_open`, `team_checkout_start` (must-land), `team_checkout_failed` and
  `team_ready`; `featureEvents.js` measures `teams` and `teamPricing`.
- [x] `seoProbeContract.js` row 80 reads 'Every plan, line by line' (rows 78 and 79 still
  hold: the phrase stays, and the Team column keeps the table's first columns).
- [x] The changelog entry, folded into 2026-10-27 (the ship day) as its lead.
- [x] Talk to us, direction C: `/pricing/talk-to-us` (auth/TalkToUsPage.jsx) before AuthGate for
  everyone, the card's Talk to us a link to it, its title and description in ROUTE_META (not
  in the sitemap), the crawlable /pricing links it, account/team.md says where it is; events
  `team_talk_view`, `team_talk_sent` and `team_talk_failed` (never a name, email or company);
  team-talk.spec and touch/team-talk-touch.spec.

## Ship

1. Rebase `team-launch` on main; re-date the changelog entry to the ship day (merge it into
   that day's entry if one exists); `npm run docs:build`, `npm test`, `docs:check`, build and
   budget; push to main; check the preview. The entry ceiling stays main's 166.0 KB (CI's build read 165.7 KB on the
   rebased branch, 2026-10-27).
2. Promote (the release recipe; production is behind main, so the promote merges main).
3. Right after: update `seo_health_expectations` row 80 to 'Every plan, line by line', and bump
   `build_min`.
4. Apply 0543 (the switch), then 0544 (the old brake).
5. Watch `check_instrumentation` and the Issues view for a day; re-run probes A–G read-only
   where they can be.
