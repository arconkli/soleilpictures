# Runbook: restore and rollback

What to do when data is gone or a deploy is bad. Written to be followed under
pressure by someone who did not write it.

Before this existed there was no restore procedure, no rollback procedure for
any of the six deploy targets, and no backup this repo controlled. Read
`.github/workflows/backup.yml` for how the artifacts are produced.

---

## 0. First: decide what actually happened

Work down this table. The wrong recovery is often worse than the incident.

| Symptom | Go to |
|---|---|
| A user deleted a cluster and wants it back | [§1 Trash](#1-a-user-deleted-something-30-day-window) — no restore needed |
| A user wants an earlier version of one board | [§2 Version history](#2-a-board-needs-an-earlier-version) — no restore needed |
| A whole workspace was wrecked (bad import, mass delete) | [§3 Workspace rewind](#3-a-whole-workspace-needs-rewinding) |
| Rows are gone and none of the above covers it | [§4 Restore from our backup](#4-restore-from-the-nightly-backup) |
| The database is corrupt / project is unrecoverable | [§5 Whole-project restore](#5-whole-project-restore) |
| The site is broken since a deploy | [§6 Rollback](#6-rollback) |
| A migration did damage | [§6.5 Migration rollback](#65-a-migration-did-damage) |

**Do not start with a database restore.** The app has four layers of in-product
recovery that are faster, safer, and do not take the product down. They cover
most of what looks like data loss. Sections 1–3 are the first stop.

---

## 1. A user deleted something (30-day window)

Soft delete. `deleted_at` is set; the row is still there for 30 days, after
which `purge_old_deleted_boards()` hard-deletes it at 03:00 UTC.

- In the app: Trash, then Restore.
- Directly: `select public.restore_board('<board-uuid>');`

To find it:

```sql
select id, name, deleted_at
from boards
where workspace_id = '<ws>' and deleted_at is not null
order by deleted_at desc;
```

**If it is past 30 days**, the row is gone from the live database and you need
[§4](#4-restore-from-the-nightly-backup). This is exactly the case the nightly
dump exists for, and why it runs at 01:15 — well ahead of the 03:00 purge.

---

## 2. A board needs an earlier version

`board_versions` keeps up to 200 versions per board for 24h, then 20 for 30
days; anything labelled `manual` is kept indefinitely.

```sql
select id, snapshot_at, label, trigger_kind
from board_versions where board_id = '<board>' order by snapshot_at desc limit 50;
```

Restore through the app's history UI, or `perform_board_restore(...)`. The
restore is itself undoable — it snapshots current state as `kind='pre-restore'`
before writing, and is idempotent on `client_request_id`.

---

## 3. A whole workspace needs rewinding

`perform_workspace_rewind` (see `supabase/functions/workspace-rewind/`) moves
every board in a workspace back to a point in time, atomically, with an impact
preview first. Use the preview. It is the difference between fixing one bad
import and rewinding a week of everyone else's work.

---

## 4. Restore from the nightly backup

Use when the rows are past the 30-day purge, or the damage is not
board-shaped (profiles, tags, entity_links, api_tokens...).

### 4.1 Get the artifact

Backups live in the R2 backup bucket under `daily/` and `monthly/`, named
`soleil-<ISO-timestamp>.dump.age`. You need the **age private key** — the one
generated during setup and kept out of this repo and out of GitHub.

```sh
export AWS_ACCESS_KEY_ID=...        # R2 token with read on the backup bucket
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=auto
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
ENDPOINT=https://<account-id>.r2.cloudflarestorage.com

aws s3 ls s3://<backup-bucket>/daily/ --endpoint-url $ENDPOINT
aws s3 cp s3://<backup-bucket>/daily/soleil-<stamp>.dump.age . --endpoint-url $ENDPOINT

age -d -i /path/to/soleil-backup.key -o soleil.dump soleil-<stamp>.dump.age
pg_restore --list soleil.dump | head -40      # confirm it is what you think
```

### 4.2 Never restore straight into production

Load the dump into a scratch database, take only what you need, and move that
across. A full `pg_restore` into the live project will happily overwrite good
data with old data.

```sh
# Local scratch, matching production's major version (17).
docker run -d --name soleil-restore -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:17
createdb -h localhost -p 5433 -U postgres scratch
pg_restore -h localhost -p 5433 -U postgres -d scratch --no-owner --no-privileges soleil.dump
```

### 4.3 Take back one table, or one workspace

Single table, into the scratch DB only:

```sh
pg_restore -h localhost -p 5433 -U postgres -d scratch \
  --data-only --table=board_versions soleil.dump
```

To move a workspace's rows back into production, dump just those rows from
scratch and apply them. Insert **parents before children** — `workspaces`,
`boards`, `board_state`, then `card_index`, `images`, `comments` — or the
foreign keys will reject the load.

```sh
psql -h localhost -p 5433 -U postgres -d scratch -c "\copy ( \
  select * from boards where workspace_id = '<ws>' \
) to 'boards.csv' with csv"
```

Apply with `on conflict do nothing` so a partial re-run is safe.

### 4.4 Sanity-check before declaring victory

```sql
select count(*) from boards where workspace_id = '<ws>' and deleted_at is null;
select count(*) from card_index where workspace_id = '<ws>';
-- every workspace MUST have exactly one live root cluster, or the app renders a
-- spinner forever for that workspace (see CLAUDE.md and migration 0275):
select count(*) from boards
 where workspace_id = '<ws>' and parent_board_id is null and deleted_at is null;
```

That last check has to come out as 1. If it is 0, call
`_ensure_workspace_root(...)` or insert a root before handing the workspace back.

---

## 5. Whole-project restore

Two independent options. Prefer Supabase's own if the project is intact,
because it is faster and includes everything.

**A. Supabase daily backup (Pro, 7-day retention).** Dashboard → Database →
Backups → Restore. Whole project only; you cannot restore one workspace this
way, and anything older than 7 days is not there.

**B. Our dump.** Use when the Supabase account itself is the problem, when you
need something older than 7 days, or when you need it somewhere that is not
Supabase. Create a new project, then:

```sh
psql "<new-project-session-pooler-uri>" -f soleil-<stamp>.schema.sql   # schema
pg_restore -d "<new-project-session-pooler-uri>" --data-only --no-owner soleil.dump
```

Then repoint `SUPABASE_URL` and the keys in: `boards/wrangler.toml` + Worker
secrets, PartyKit env, `scout/fly.toml` secrets, and the edge functions.

### 5.1 What our dump does NOT contain — the rebuild checklist

The dump is `--schema=public,auth,storage` only. A fresh project restored from
it will have every table and row and still not be a working system until the
state below is re-created. This is the list to work down; each item says where
the source of truth lives.

- **R2 objects (the biggest one).** Every uploaded image, file, and compacted
  op batch lives only in R2 (`soleil-boards-images`) and, once the mirror is
  live, its copy in `soleil-boards-images-backup`. The DB restore brings back
  the *rows that point at* those objects; if R2 itself is lost, the pointers
  resolve to nothing. Restoring images = copy keys back from the mirror bucket
  (see `backup.yml` / the R2 mirror cron in `worker.js`). A bad
  `R2_SWEEP_MODE=delete` run is the most dangerous single command in this system.
- **pg_cron jobs.** All ~28 scheduled jobs (the nightly purges, compaction,
  heartbeat purge). Defined in migrations — replay `0052`, `0107`, `0108`,
  `0288` and later cron migrations, or re-`select cron.schedule(...)` from the
  bodies. `select jobname, schedule from cron.job;` on the old project is the
  reference if it is still reachable.
- **The `supabase_realtime` publication.** Which tables broadcast changes
  (migrations `0113`, `0289`, …). Without it, live collaboration and the admin
  pulses are silent. `select * from pg_publication_tables where pubname =
  'supabase_realtime';` is the reference.
- **Vault secrets.** `vault.secrets` is not in the dumped schemas. Anything read
  via `vault.decrypted_secrets` (service keys used inside SECURITY DEFINER cron
  RPCs) must be re-inserted.
- **GoTrue / Auth settings** (dashboard, not SQL): site URL, redirect
  allowlist, OTP expiry, HIBP leaked-password protection, email templates, SMTP,
  and any MFA enablement. `auth` schema *rows* (users) restore; these *settings*
  do not.
- **Edge-function secrets:** `STRIPE_*`, `RESEND_*`, `CRON_SECRET`,
  `GSC_SERVICE_ACCOUNT_JSON`, `SUPABASE_SERVICE_ROLE_KEY`, and the rest. Set per
  function in the dashboard / via MCP; none are in the dump. The functions
  themselves have no version history — recover source from git and redeploy.
- **Storage bucket definitions and policies.** The `storage.objects`/`buckets`
  *rows* restore, but bucket config (public/private, CORS, size limits) and the
  actual stored files do not. Buckets in play: `message-attachments` (public),
  `board-images` (legacy).
- **R2 CORS** — set manually per bucket, mirrored in `boards/r2-cors.json`.
- **Worker secrets** (`wrangler secret`): `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY`, and any `*_MODE` flags. **PartyKit env** (`npx partykit
  env`). **Fly secrets** for scout (`fly secrets list`).
- **The migration files themselves are incomplete** — ~53 applied migrations
  have no file on disk (see the parity warning in `backup.yml`). Rebuild the
  schema from `soleil-<stamp>.schema.sql`, never by replaying
  `supabase/migrations/`.

---

## 6. Rollback

Production is the `production` branch. `main` deploys a **preview**, not
production.

### 6.1 Worker + SPA

Fastest: Cloudflare dashboard → Workers → soleil-boards → Deployments →
Rollback to the previous deployment. Takes effect immediately, no build.

Durable fix: revert on `production` and let Workers Builds redeploy.

```sh
git checkout production && git revert <sha> && git push origin production
```

> **The gotcha that has burned this repo before:** promotion happens by
> cherry-picking into an isolated worktree, and you must copy
> `boards/.env.local` into that worktree **before** running `vite build`.
> Otherwise the signed-in app is dead-code-eliminated and you ship a build that
> only works logged out. Gate on `dist/assets/AppShell-*.js` being roughly its
> usual size (~500KB) before promoting.

### 6.2 Verify after any rollback

```sh
cd boards && npx playwright test tests/prod-health.spec.js --project=desktop-chrome
```

Checks the live root returns 200, the referenced bundles actually resolve, and
the auth screen renders without console errors.

### 6.3 PartyKit

`npm run deploy:party` from the previous commit. There is no versioned rollback.

### 6.4 Edge functions

Redeploy the prior version via the Supabase MCP `deploy_edge_function`. There is
no version history, so recover the old source from git.

### 6.5 A migration did damage

There are **no down-migrations in this repo**. Write a new forward migration
that reverses the change; do not edit the original, which has already been
applied and would leave the file and the database disagreeing.

If a migration destroyed data, the forward fix restores structure and §4
restores the rows.

---

## 7. The drill

**A backup nobody has restored is not known to work.** Run this quarterly, and
after any change to `backup.yml`:

1. Trigger the workflow manually (Actions → backup → Run workflow).
2. Download the newest artifact and decrypt it (§4.1).
3. Restore into a scratch database (§4.2).
4. Confirm row counts are plausible and one known board's `board_state.doc` is
   non-empty.
5. Record the date and outcome below.

| Date | Artifact | Outcome | By |
|---|---|---|---|
| _(not yet run — do this before relying on it)_ | | | |
