# Share-signup provenance in the admin Users tab

_Design — 2026-07-19_

## Context

When someone opens a public board share link (`/share/<token>`) or a public board
(`/c/<slug>`) and later signs up, the share token / slug is captured first-touch into
`profiles.first_source`, and `derive_acquisition_channel` labels them `share_link` /
`public_board`. Today the admin Users tab surfaces only the channel pill plus the raw
token/slug value — an admin cannot see **which board** the person came from, **who
shared it**, or **how many people that one share brought in**.

Everything needed to answer those questions is one join away:
`first_source.share_token → public_share_links.token → board_id → boards.name`, with
`public_share_links.created_by` = the sharer; and
`first_source.public_slug → public_boards.slug → board_id → boards.name`.

**Goal:** surface share provenance in two places — per-user (in the detail pane) and as
a small roll-up of the shares actually driving signups.

## Non-goals (YAGNI)

- Collab invite-link joins (`board_shares.via_link_token`) and referral (`?ref`) linkage —
  invite joins never land in `first_source`, and referral resolution is a separate concern.
  Deferred; the design leaves room to add them later.
- Any new full-page analytics view. The roll-up is a compact panel, not a dashboard.
- Making board titles / sharer identity visible to anyone but admins (all RPCs are
  `_require_admin`-gated).

## Design

### Part 1 — Per-user "came from a share" (enrich `admin_user_detail`)

`admin_user_detail` gains a resolved `acquisition.share` object, populated only when the
user's `first_source` carries a `share_token` **or** `public_slug`. Resolution is a
`left join lateral` (mirroring the existing `last_touch` lateral in the same function), so
a missing/deleted link degrades to nulls rather than erroring.

Shape of `acquisition.share` (null when neither key present):

| field | source | notes |
|---|---|---|
| `kind` | `'share_link'` \| `'public_board'` | which capture path |
| `token` | `first_source.share_token` | raw, for reference/copy |
| `slug` | `first_source.public_slug` | for public_board |
| `board_id` | `public_share_links.board_id` / `public_boards.board_id` | |
| `board_title` | `boards.name` | null if board deleted |
| `shared_by_email` | `auth.users.email` via `public_share_links.created_by` (or `public_boards.created_by`) | null if link deleted |
| `link_kind` | `public_share_links.kind` (`view`/`invite`) | share_link only |
| `link_role` | `public_share_links.role` (`viewer`/`editor`) | share_link only |
| `link_created_at` | `public_share_links.created_at` | |
| `link_revoked_at` | `public_share_links.revoked_at` | shows "revoked" state |
| `cohort_signups` | count of profiles whose `first_source->>'share_token'` (or `public_slug`) equals this one | "N total signed up from this link". Counts **all** signups (not verification-filtered) — a share's reach includes everyone it brought in. |

`admin_user_detail`'s signature is unchanged (`p_user_id uuid`), so a plain
`create or replace` is safe — no overload drop needed.

**Frontend** (`AdminUserDetail.jsx`, `AcquisitionSection`, ~L41-87): when `acq.share` is
present, render a labeled block above/within the Acquisition section:

- `Board` — `board_title` (or "board deleted" muted if null)
- `Shared by` — `shared_by_email` (or "link deleted" muted)
- `Link` — humanized: "view link" / "invite · editor" (share_link) — omitted for public_board
- `Created` — `relativeTime(link_created_at)`, with a "revoked" flag if `link_revoked_at`
- `Others from this link` — `cohort_signups - 1` when > 0 (e.g. "+2 others signed up from this link")

The raw `share_token`/`public_slug` rows in the existing `fields` list are removed from the
generic dump and represented by this block instead (token kept as a muted copyable line).

### Part 2 — Shares roll-up (new RPC + empty-state panel)

New admin-only RPC **`admin_share_signups(p_limit int default 20)`** returning the shares
that produced the most signups:

| column | meaning |
|---|---|
| `kind` | `'share_link'` \| `'public_board'` |
| `token` / `slug` | the share identifier |
| `board_id`, `board_title` | resolved board (null if deleted) |
| `shared_by_email` | the sharer (null if link deleted) |
| `link_kind`, `link_role` | share_link meta |
| `signups` | count of profiles whose first_source points at this share (all signups, not verification-filtered) |
| `activated` | of those, how many created ≥1 owned card or board (reuses the 0192 activity signal) |

Implementation: aggregate `profiles` grouped by `first_source->>'share_token'` (and a second
arm for `public_slug`), then `left join` `public_share_links`/`public_boards` → `boards` →
sharer. `security definer`, `set search_path=public`, `perform _require_admin()`, grants to
`anon, authenticated, service_role` (matching the other admin RPCs). Ordered by `signups desc`.

**Frontend** (`AdminUserDetail.jsx`, empty state ~L199-211): `AdminUsersTab` fetches
`admin_share_signups` once via a dedicated lightweight `useAdminData` instance (independent
of the list/detail queries) and passes the result to `AdminUserDetail` as a prop. When no
user is selected, replace the bare "Select a user"
prompt with a compact **"Shares driving signups"** list — each row: board title · shared by ·
`N signups (M active)` — followed by the existing "pick a user on the left" hint. Empty/na
state when there are no share signups yet.

### Migration `0193`

- `create or replace function public.admin_user_detail(uuid)` — same body as live, with the
  `acquisition` builder gaining the `share` object (via a new `left join lateral`). Reproduce
  the **live** body (drift-aware), change only the acquisition section.
- `create function public.admin_share_signups(integer)` — new; grants as above.
- No signature change on `admin_user_detail` → no drop/overload concern. Dry-run in a
  `begin; … rollback;` before applying (repo convention), then `apply_migration`.

## Testing / verification

1. Migration dry-run (`begin/rollback`) compiles clean; then apply. Confirm
   `admin_user_detail` still returns its existing shape plus `acquisition.share`, and
   `admin_share_signups` exists with the expected grants.
2. Backend: for a known share-origin user, `admin_user_detail` returns a populated
   `acquisition.share` (board, sharer, counts); for a non-share user it's null.
   `admin_share_signups` rows sum/agree with the per-user `cohort_signups`.
3. Frontend (`cd boards && npm run dev`, admin): open a share-origin user → the "came from a
   share" block shows board + sharer + "+N others"; open the tab with nothing selected → the
   roll-up lists shares by signup count; `npm run build` passes.

## Files

- `supabase/migrations/0193_share_signup_provenance.sql` — enrich `admin_user_detail`, add `admin_share_signups`.
- `boards/src/pages/admin/AdminUserDetail.jsx` — Acquisition share block + empty-state roll-up.
- `boards/src/pages/admin/AdminUsersTab.jsx` — fetch `admin_share_signups`, pass to detail (if not folded into detail fetch).
- `boards/src/styles.css` — minor styles for the share block + roll-up list.
