-- 0222_integration_surface.sql
--
-- The database half of making /api/v1 something a studio pipeline can be wired
-- into. 0221 made the API survive scale; this makes it survive INTEGRATION.
--
-- The three things an outside system needs that we have never had:
--
--   1. A credential that is not a person. Today a PAT resolves to one human's
--      Supabase session — correct security, and it means the integration dies
--      when that human leaves the workspace or their tier moves. A service
--      account is a real auth.users row holding a workspace_members row, so
--      every existing RLS predicate (can_read_board, can_write_board,
--      can_write_workspace) works UNCHANGED and there is no service-role
--      shortcut anywhere. Caps stay owner-pays because enforce_demo_card_cap_trg
--      and get_board_capacity both key on board_workspace_owner(), never the
--      caller.
--
--   2. Somewhere to put a foreign identifier and a structured field.
--      normalizeIncomingCard is a 12-field allowlist by design; card_index.meta
--      is a derived projection rebuilt on every card write; boards.meta is a
--      text column no endpoint reads. So an external system has no key to
--      reconcile on and must keep its own id map out of band, forever. Two
--      sidecar tables fix that — deliberately NOT the Y.Doc, because Yjs
--      history never shrinks (a props blob per card grows board_state forever)
--      and because querying by identifier needs a real unique index, which JSON
--      inside a CRDT cannot give.
--
--   3. A way to learn that something changed without re-reading everything.
--      An outbox written by STATEMENT-level triggers on boards and card_index.
--      card_index is written by BOTH boardsApi.js:syncCardIndex (the browser)
--      and cardEncode.mjs:buildCardIndexRows (the API and Scout), so a change
--      made in the app fires a webhook too. That is the difference between a
--      demo and something a pipeline TD will trust.
--
-- Plus the delta indexes those reads need, a one-call board tree, and a read
-- path for the audit log that has existed and been unreachable since 0220.
--
-- Nothing here prices or gates anything. Every default is unchanged and every
-- table is empty on arrival, so no account that exists today moves.

-----------------------------------------------------------------------
-- 1. Service accounts
--
-- The auth.users row itself is created by the Worker through the Supabase Admin
-- API, not here — Postgres cannot mint a usable auth identity (the row needs an
-- identities record and a confirmed email before generate_link will work for
-- it). This migration owns everything AFTER that: the membership that grants
-- access, the profile tier that keeps can_write_board from refusing, and the
-- registry row that ties it to a workspace.
--
-- Registration asserts the CALLER owns the workspace. It runs as the human,
-- through userRpc, so auth.uid() is that human.
-----------------------------------------------------------------------
create table if not exists public.service_accounts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  disabled_at  timestamptz
);

create index if not exists service_accounts_workspace_idx
  on public.service_accounts (workspace_id) where disabled_at is null;

-- RLS on, no policies: same posture as api_tokens/api_sessions/api_idempotency.
-- Everything goes through the SECURITY DEFINER functions below, so there is no
-- PostgREST surface to get the authorization wrong on.
alter table public.service_accounts enable row level security;
revoke all on table public.service_accounts from anon, authenticated;

comment on table public.service_accounts is
  'A machine identity owned by a workspace rather than by a person. Backed by a '
  'real auth.users row holding a workspace_members row, so ordinary RLS applies '
  'to it with no special-casing anywhere.';

-- Marks the profile so user counts and lifecycle email can exclude machines.
alter table public.profiles
  add column if not exists is_service boolean not null default false;

comment on column public.profiles.is_service is
  'True for a service account. Excluded from user counts, lifecycle email and '
  'onboarding — it is not a person and will never open an inbox.';

-- Tokens record which workspace they were minted for. For a service account
-- this is redundant with its membership and is kept for display and for
-- scoping the audit read; for a human token it is NULL.
alter table public.api_tokens
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

create or replace function public.service_account_register(
  p_user_id      uuid,
  p_workspace_id uuid,
  p_name         text
)
returns table(user_id uuid, workspace_id uuid, name text, created_at timestamptz)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_name text := coalesce(nullif(btrim(p_name), ''), 'Service account');
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  -- Ownership, not membership. An editor who can write to a workspace should
  -- not be able to mint a credential that outlives their own access to it.
  if not exists (
    select 1 from public.workspaces w
     where w.id = p_workspace_id and w.created_by = auth.uid()
  ) then
    raise exception 'only the workspace owner can create a service account'
      using errcode = '42501';
  end if;

  if (select count(*) from public.service_accounts s
       where s.workspace_id = p_workspace_id and s.disabled_at is null) >= 10 then
    raise exception 'a workspace may have at most 10 service accounts'
      using errcode = '54000';
  end if;

  -- ensure_profile_for_new_user already made the row; this pins the two fields
  -- that matter. The tier is set explicitly rather than inherited because the
  -- waitlist master switch would otherwise make a service account that cannot
  -- write, months after it was created and with no obvious cause.
  update public.profiles p
     set tier = case when p.tier = 'waitlist' then 'demo' else p.tier end,
         is_service = true
   where p.user_id = p_user_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, p_user_id, 'service')
  on conflict (workspace_id, user_id) do nothing;

  insert into public.service_accounts (user_id, workspace_id, name, created_by)
  values (p_user_id, p_workspace_id, left(v_name, 80), auth.uid())
  on conflict (user_id) do update set name = excluded.name, disabled_at = null;

  return query
    select s.user_id, s.workspace_id, s.name, s.created_at
      from public.service_accounts s where s.user_id = p_user_id;
end;
$$;
revoke all on function public.service_account_register(uuid, uuid, text) from public, anon;
grant execute on function public.service_account_register(uuid, uuid, text) to authenticated;

create or replace function public.service_account_list(p_workspace_id uuid)
returns table(user_id uuid, workspace_id uuid, name text, created_at timestamptz,
              disabled_at timestamptz, token_count integer, last_used_at timestamptz)
language sql stable security definer
set search_path = public, auth as $$
  select s.user_id, s.workspace_id, s.name, s.created_at, s.disabled_at,
         (select count(*)::int from public.api_tokens t
           where t.user_id = s.user_id and t.revoked_at is null),
         (select max(t.last_used_at) from public.api_tokens t where t.user_id = s.user_id)
    from public.service_accounts s
   where s.workspace_id = p_workspace_id
     and public.is_workspace_member(p_workspace_id)
   order by s.created_at asc;
$$;
revoke all on function public.service_account_list(uuid) from public, anon;
grant execute on function public.service_account_list(uuid) to authenticated;

-- Disabling is deliberately not a delete. The auth.users row stays so
-- api_request_log rows keep resolving to a name, and the membership goes so the
-- credential stops working the instant this returns.
create or replace function public.service_account_disable(p_user_id uuid)
returns table(user_id uuid, disabled_at timestamptz, tokens_revoked integer)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_ws      uuid;
  v_revoked integer := 0;
begin
  select s.workspace_id into v_ws
    from public.service_accounts s where s.user_id = p_user_id;
  if v_ws is null then
    raise exception 'no such service account' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspaces w where w.id = v_ws and w.created_by = auth.uid()
  ) then
    raise exception 'only the workspace owner can disable a service account'
      using errcode = '42501';
  end if;

  update public.api_tokens t set revoked_at = now()
   where t.user_id = p_user_id and t.revoked_at is null;
  get diagnostics v_revoked = row_count;

  delete from public.workspace_members m
   where m.workspace_id = v_ws and m.user_id = p_user_id;

  update public.service_accounts s set disabled_at = now() where s.user_id = p_user_id;

  return query
    select s.user_id, s.disabled_at, v_revoked
      from public.service_accounts s where s.user_id = p_user_id;
end;
$$;
revoke all on function public.service_account_disable(uuid) from public, anon;
grant execute on function public.service_account_disable(uuid) to authenticated;

-- Mint a token owned by a service account. api_token_mint hard-codes auth.uid()
-- as the owner, which is right for a human and impossible for a machine.
--
-- The default request limit differs on purpose: a machine identity is what a
-- rate limit exists to PERMIT, and 1000/hour is a number chosen to bound one
-- person's scripting mistake, not to bound a migration.
create or replace function public.api_token_mint_for(
  p_user_id   uuid,
  p_name      text,
  p_scopes    text[] default array['read'],
  p_ttl_days  int default null,
  p_req_limit int default null
)
returns table(id uuid, token text, prefix text, req_limit integer)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_token  text;
  v_prefix text;
  v_id     uuid;
  v_ws     uuid;
  v_limit  integer := coalesce(p_req_limit, 10000);
  v_name   text := coalesce(nullif(btrim(p_name), ''), 'Service token');
  v_scopes text[] := coalesce(p_scopes, array['read']);
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not (v_scopes <@ array['read','write','delete']) then
    raise exception 'scopes must be a subset of read, write, delete' using errcode = '22023';
  end if;

  select s.workspace_id into v_ws
    from public.service_accounts s
   where s.user_id = p_user_id and s.disabled_at is null;
  if v_ws is null then
    raise exception 'no such active service account' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.workspaces w where w.id = v_ws and w.created_by = auth.uid()
  ) then
    raise exception 'only the workspace owner can mint a service token'
      using errcode = '42501';
  end if;

  -- Same normalization as api_token_mint: delete implies write, read is always
  -- present, deduped and ordered. Kept in step with 0220 by hand because the
  -- stored row is the truth and api_token_resolve returns it verbatim.
  if 'delete' = any(v_scopes) and not ('write' = any(v_scopes)) then
    v_scopes := v_scopes || 'write'::text;
  end if;
  if not ('read' = any(v_scopes)) then
    v_scopes := array['read'] || v_scopes;
  end if;
  select array_agg(s order by array_position(array['read','write','delete'], s))
    into v_scopes
    from (select distinct unnest(v_scopes) as s) d;

  if (select count(*) from public.api_tokens
       where user_id = p_user_id and revoked_at is null) >= 20 then
    raise exception 'too many active tokens — revoke one first' using errcode = '54000';
  end if;

  v_limit  := greatest(1, least(v_limit, 1000000));
  v_token  := 'sk_live_' || encode(extensions.gen_random_bytes(20), 'hex');
  v_prefix := substr(v_token, 1, 14);

  insert into public.api_tokens
    (user_id, name, token_hash, prefix, scopes, expires_at, req_limit, workspace_id)
  values (
    p_user_id, left(v_name, 80),
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_prefix, v_scopes,
    case when p_ttl_days is null then null
         else now() + make_interval(days => greatest(1, least(p_ttl_days, 3650))) end,
    v_limit, v_ws
  )
  returning api_tokens.id into v_id;

  return query select v_id, v_token, v_prefix, v_limit;
end;
$$;
revoke all on function public.api_token_mint_for(uuid, text, text[], int, int) from public, anon;
grant execute on function public.api_token_mint_for(uuid, text, text[], int, int) to authenticated;

-- A workspace owner has to be able to see and revoke what their own service
-- accounts hold. api_token_list only ever shows auth.uid()'s own tokens.
create or replace function public.api_token_list_for(p_user_id uuid)
returns table(id uuid, name text, prefix text, scopes text[], req_limit integer,
              created_at timestamptz, last_used_at timestamptz,
              expires_at timestamptz, revoked_at timestamptz)
language sql stable security definer
set search_path = public, auth as $$
  select t.id, t.name, t.prefix, t.scopes, t.req_limit,
         t.created_at, t.last_used_at, t.expires_at, t.revoked_at
    from public.api_tokens t
   where t.user_id = p_user_id
     and exists (
       select 1 from public.service_accounts s
         join public.workspaces w on w.id = s.workspace_id
        where s.user_id = p_user_id and w.created_by = auth.uid()
     )
   order by t.created_at desc;
$$;
revoke all on function public.api_token_list_for(uuid) from public, anon;
grant execute on function public.api_token_list_for(uuid) to authenticated;

create or replace function public.api_token_revoke_for(p_token_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare v_owner uuid;
begin
  select t.user_id into v_owner from public.api_tokens t where t.id = p_token_id;
  if v_owner is null then return false; end if;
  if not exists (
    select 1 from public.service_accounts s
      join public.workspaces w on w.id = s.workspace_id
     where s.user_id = v_owner and w.created_by = auth.uid()
  ) then
    raise exception 'not your service account' using errcode = '42501';
  end if;
  update public.api_tokens t set revoked_at = now()
   where t.id = p_token_id and t.revoked_at is null;
  return found;
end;
$$;
revoke all on function public.api_token_revoke_for(uuid) from public, anon;
grant execute on function public.api_token_revoke_for(uuid) to authenticated;

-- api_token_resolve gains two things.
--
-- One clause: a token belonging to a DISABLED service account is dead even if
-- the row survived. service_account_disable revokes the tokens it knows about,
-- but a token minted between the read and the write of a concurrent disable
-- would otherwise slip through.
--
-- And one column: workspace_id, so a single round trip tells the Worker both
-- who the token is and whether it is a machine confined to one workspace.
-- Adding an OUT column is a return-type change, so this is a drop and recreate
-- rather than a replace.
drop function if exists public.api_token_resolve(text);

create function public.api_token_resolve(p_token_hash text)
returns table(user_id uuid, token_id uuid, scopes text[], reason text,
              req_count integer, req_limit integer, req_reset timestamptz,
              workspace_id uuid)
language plpgsql security definer
set search_path = public, auth as $$
declare
  t        public.api_tokens%rowtype;
  v_limit  integer;
  v_valid  boolean;
  v_count  integer;
  v_reset  timestamptz;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;

  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text,
                        null::integer, 1000, null::timestamptz, null::uuid;
    return;
  end if;

  v_limit := coalesce(t.req_limit, 1000);

  v_valid := t.revoked_at is null
             and (t.expires_at is null or t.expires_at > now());

  update public.api_tokens a
     set req_window   = case when now() - a.req_window > interval '1 hour' then now() else a.req_window end,
         req_count    = case when now() - a.req_window > interval '1 hour' then 1 else a.req_count + 1 end,
         last_used_at = case when v_valid then now() else a.last_used_at end
   where a.id = t.id
  returning a.req_count, a.req_window + interval '1 hour'
       into v_count, v_reset;

  if v_count > v_limit then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;

  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;
  if exists (select 1 from public.service_accounts s
              where s.user_id = t.user_id and s.disabled_at is not null) then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset, null::uuid;
    return;
  end if;

  return query select t.user_id, t.id, t.scopes, null::text,
                      v_count, v_limit, v_reset, t.workspace_id;
end;
$$;
revoke all on function public.api_token_resolve(text) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 2. object_identifiers — foreign keys from other people's systems
--
-- MovieLabs' identifier guidance, which is what every studio asset-management
-- integration is measured against: an entity may carry MANY identifiers, from
-- many scopes; preserve the ones other participants assigned; never mint a
-- duplicate for something that already has one; and support retrieval BY
-- identifier. The unique index is the whole feature — it is what makes
-- "create-or-update the board for Shot:12345" deterministic and what stops two
-- boards claiming the same upstream record.
--
-- board_id is carried on every row, including for cards and images, purely so
-- RLS can be can_read_board/can_write_board with no recursion of its own.
-----------------------------------------------------------------------
create table if not exists public.object_identifiers (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  board_id     uuid not null references public.boards(id) on delete cascade,
  object_type  text not null check (object_type in ('board','card','image')),
  object_id    text not null check (length(object_id) between 1 and 200),
  scope        text not null check (length(scope) between 1 and 200),
  value        text not null check (length(value) between 1 and 200),
  created_at   timestamptz not null default now(),
  created_by   uuid
);

-- The uniqueness that makes upsert-by-identifier a real operation.
create unique index if not exists object_identifiers_scope_uniq
  on public.object_identifiers (workspace_id, object_type, scope, value);
create index if not exists object_identifiers_object_idx
  on public.object_identifiers (board_id, object_type, object_id);
create index if not exists object_identifiers_lookup_idx
  on public.object_identifiers (scope, value);

alter table public.object_identifiers enable row level security;

create policy object_identifiers_read on public.object_identifiers
  for select using (public.can_read_board(board_id));
create policy object_identifiers_write on public.object_identifiers
  for all using (public.can_write_board(board_id))
  with check (public.can_write_board(board_id));

comment on table public.object_identifiers is
  'Foreign identifiers assigned by other systems (shotgrid, ftrack, frameio, '
  'c4, omc, …). Many per object. Unique per (workspace, type, scope, value) so '
  'an import can be re-run without duplicating anything.';

-- At most 20 identifiers per object. A CHECK cannot count siblings, and the
-- Worker also enforces this — the trigger is the backstop for anything that
-- reaches the table another way.
create or replace function public.object_identifiers_cap_trg()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if (select count(*) from public.object_identifiers o
       where o.board_id = new.board_id
         and o.object_type = new.object_type
         and o.object_id = new.object_id) >= 20 then
    raise exception 'an object may carry at most 20 identifiers' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists object_identifiers_cap on public.object_identifiers;
create trigger object_identifiers_cap
  before insert on public.object_identifiers
  for each row execute function public.object_identifiers_cap_trg();

-----------------------------------------------------------------------
-- 3. object_props — a structured field bag, in a sidecar
--
-- NOT on the card's Y.Map, for three reasons that are all load-bearing:
--   · Yjs history never shrinks, so a props blob per card grows board_state
--     forever — the same property that made a 596KB doc hold two cards.
--   · card_index.meta is REBUILT from the card on every write
--     (scoutBoard.js: "card_index is a projection of the card"), so anything
--     written there is destroyed by the next edit.
--   · Querying by a field needs an index. A CRDT cannot provide one.
-- The app-wide pass reads this table directly; it is a Postgres table with RLS,
-- no harder to render from than the doc.
-----------------------------------------------------------------------
create or replace function public._props_ok(p jsonb)
returns boolean language sql immutable
set search_path = public as $$
  select p is null
      or (jsonb_typeof(p) = 'object'
          and length(p::text) <= 16384
          and (select count(*) from jsonb_object_keys(p)) <= 100);
$$;

create table if not exists public.object_props (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  board_id     uuid not null references public.boards(id) on delete cascade,
  object_type  text not null check (object_type in ('board','card','image')),
  object_id    text not null check (length(object_id) between 1 and 200),
  props        jsonb not null default '{}' check (public._props_ok(props)),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (object_type, object_id, board_id)
);

create index if not exists object_props_board_idx
  on public.object_props (board_id, object_type);
create index if not exists object_props_gin
  on public.object_props using gin (props jsonb_path_ops);
create index if not exists object_props_workspace_idx
  on public.object_props (workspace_id);

alter table public.object_props enable row level security;

create policy object_props_read on public.object_props
  for select using (public.can_read_board(board_id));
create policy object_props_write on public.object_props
  for all using (public.can_write_board(board_id))
  with check (public.can_write_board(board_id));

comment on table public.object_props is
  'Free-form structured fields on a board, card or image. At most 16KB and 100 '
  'keys per object. Keys beginning "soleil." are reserved. Typed field '
  'definitions, if they are ever wanted, layer on top of this rather than '
  'replacing it.';

-----------------------------------------------------------------------
-- 4. Webhooks — an outbox, so an edit made in the APP fires one too
--
-- The triggers are STATEMENT level with transition tables, not row level. A
-- 1000-card batch must emit one event carrying a count, not 1000 events; row
-- level would make the outbox the most-written table in the database during a
-- migration.
--
-- Every emit is guarded by an EXISTS against an active webhook for that
-- workspace. With zero webhooks — the state today, and for every account that
-- exists — this costs one index probe per statement and writes nothing.
-----------------------------------------------------------------------
create table if not exists public.webhooks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text,
  url             text not null check (url like 'https://%' and length(url) <= 2000),
  events          text[] not null check (cardinality(events) between 1 and 32),
  secret          text not null,
  active          boolean not null default true,
  failure_count   int not null default 0,
  disabled_reason text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The probe every trigger makes. Partial so it stays tiny.
create index if not exists webhooks_active_idx
  on public.webhooks (workspace_id) where active;

alter table public.webhooks enable row level security;
revoke all on table public.webhooks from anon, authenticated;

comment on column public.webhooks.secret is
  'HMAC key. Returned only in the create response — there is no read path for '
  'it, here or over the API.';

create table if not exists public.webhook_events (
  id           bigserial primary key,
  workspace_id uuid not null,
  board_id     uuid,
  event        text not null,
  resource     jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  fanned_at    timestamptz
);

create index if not exists webhook_events_pending_idx
  on public.webhook_events (id) where fanned_at is null;
create index if not exists webhook_events_created_idx
  on public.webhook_events (created_at);

alter table public.webhook_events enable row level security;
revoke all on table public.webhook_events from anon, authenticated;

create table if not exists public.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  webhook_id      uuid not null references public.webhooks(id) on delete cascade,
  event_id        bigint,
  event           text not null,
  payload         jsonb not null,
  status          int,
  attempt         int not null default 0,
  response_ms     int,
  error           text,
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,
  next_attempt_at timestamptz not null default now()
);

create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at) where delivered_at is null;
create index if not exists webhook_deliveries_hook_idx
  on public.webhook_deliveries (webhook_id, created_at desc);

alter table public.webhook_deliveries enable row level security;
revoke all on table public.webhook_deliveries from anon, authenticated;

-- ── the emitters ────────────────────────────────────────────────────────────

create or replace function public.webhook_emit_boards_ins()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.id, 'board.created',
         jsonb_build_object('id', n.id, 'name', n.name,
                            'parent_board_id', n.parent_board_id)
    from newtab n
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active);
  return null;
end;
$$;

-- One statement can contain creates, soft-deletes and restores at once, so the
-- transition tables are joined on id and the event is chosen per row.
create or replace function public.webhook_emit_boards_upd()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.id,
         case
           when o.deleted_at is null and n.deleted_at is not null then 'board.deleted'
           when o.deleted_at is not null and n.deleted_at is null then 'board.restored'
           else 'board.updated'
         end,
         jsonb_build_object('id', n.id, 'name', n.name,
                            'parent_board_id', n.parent_board_id)
    from newtab n join oldtab o on o.id = n.id
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active)
     and (o.name is distinct from n.name
       or o.parent_board_id is distinct from n.parent_board_id
       or o.view is distinct from n.view
       or o.deleted_at is distinct from n.deleted_at);
  return null;
end;
$$;

create or replace function public.webhook_emit_boards_del()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select o.workspace_id, o.id, 'board.deleted',
         jsonb_build_object('id', o.id, 'name', o.name, 'hard', true)
    from oldtab o
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = o.workspace_id and w.active);
  return null;
end;
$$;

-- Cards are grouped by board and counted. 25 ids are carried as a courtesy;
-- past that the consumer re-reads the board, which is what a thin payload is
-- for.
create or replace function public.webhook_emit_cards_ins()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.board_id, 'card.created',
         jsonb_build_object('count', count(*),
                            'card_ids', (array_agg(n.card_id order by n.card_id))[1:25])
    from newtab n
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active)
   group by n.workspace_id, n.board_id;
  return null;
end;
$$;

create or replace function public.webhook_emit_cards_upd()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.board_id, 'card.updated',
         jsonb_build_object('count', count(*),
                            'card_ids', (array_agg(n.card_id order by n.card_id))[1:25])
    from newtab n join oldtab o
      on o.board_id = n.board_id and o.card_id = n.card_id
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active)
     and (o.title is distinct from n.title
       or o.body  is distinct from n.body
       or o.kind  is distinct from n.kind
       or o.meta  is distinct from n.meta)
   group by n.workspace_id, n.board_id;
  return null;
end;
$$;

create or replace function public.webhook_emit_cards_del()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select o.workspace_id, o.board_id, 'card.deleted',
         jsonb_build_object('count', count(*),
                            'card_ids', (array_agg(o.card_id order by o.card_id))[1:25])
    from oldtab o
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = o.workspace_id and w.active)
   group by o.workspace_id, o.board_id;
  return null;
end;
$$;

drop trigger if exists boards_webhook_ins on public.boards;
create trigger boards_webhook_ins after insert on public.boards
  referencing new table as newtab
  for each statement execute function public.webhook_emit_boards_ins();

drop trigger if exists boards_webhook_upd on public.boards;
create trigger boards_webhook_upd after update on public.boards
  referencing old table as oldtab new table as newtab
  for each statement execute function public.webhook_emit_boards_upd();

drop trigger if exists boards_webhook_del on public.boards;
create trigger boards_webhook_del after delete on public.boards
  referencing old table as oldtab
  for each statement execute function public.webhook_emit_boards_del();

drop trigger if exists card_index_webhook_ins on public.card_index;
create trigger card_index_webhook_ins after insert on public.card_index
  referencing new table as newtab
  for each statement execute function public.webhook_emit_cards_ins();

drop trigger if exists card_index_webhook_upd on public.card_index;
create trigger card_index_webhook_upd after update on public.card_index
  referencing old table as oldtab new table as newtab
  for each statement execute function public.webhook_emit_cards_upd();

drop trigger if exists card_index_webhook_del on public.card_index;
create trigger card_index_webhook_del after delete on public.card_index
  referencing old table as oldtab
  for each statement execute function public.webhook_emit_cards_del();

-- ── the management surface (service-role only; the Worker fronts it) ─────────

create or replace function public.webhook_create(
  p_workspace_id uuid, p_url text, p_events text[], p_name text default null)
returns table(id uuid, secret text, created_at timestamptz)
language plpgsql security definer
set search_path = public, auth as $$
declare v_secret text; v_id uuid;
begin
  if not public.can_write_workspace(p_workspace_id) then
    raise exception 'you cannot add a webhook to this workspace' using errcode = '42501';
  end if;
  if (select count(*) from public.webhooks w
       where w.workspace_id = p_workspace_id and w.active) >= 20 then
    raise exception 'a workspace may have at most 20 active webhooks' using errcode = '54000';
  end if;
  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.webhooks (workspace_id, url, events, secret, name, created_by)
  values (p_workspace_id, p_url, p_events, v_secret, left(nullif(btrim(p_name),''), 80), auth.uid())
  returning webhooks.id into v_id;
  return query select v_id, v_secret, now();
end;
$$;
revoke all on function public.webhook_create(uuid, text, text[], text) from public, anon;
grant execute on function public.webhook_create(uuid, text, text[], text) to authenticated;

-- Never returns `secret`. There is no read path for it anywhere.
create or replace function public.webhook_list(p_workspace_id uuid default null)
returns table(id uuid, workspace_id uuid, name text, url text, events text[],
              active boolean, failure_count int, disabled_reason text,
              created_at timestamptz, updated_at timestamptz)
language sql stable security definer
set search_path = public, auth as $$
  select w.id, w.workspace_id, w.name, w.url, w.events, w.active,
         w.failure_count, w.disabled_reason, w.created_at, w.updated_at
    from public.webhooks w
   where public.is_workspace_member(w.workspace_id)
     and (p_workspace_id is null or w.workspace_id = p_workspace_id)
   order by w.created_at desc;
$$;
revoke all on function public.webhook_list(uuid) from public, anon;
grant execute on function public.webhook_list(uuid) to authenticated;

create or replace function public.webhook_update(
  p_id uuid, p_url text default null, p_events text[] default null,
  p_name text default null, p_active boolean default null)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws from public.webhooks w where w.id = p_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  update public.webhooks w
     set url    = coalesce(p_url, w.url),
         events = coalesce(p_events, w.events),
         name   = coalesce(nullif(btrim(p_name), ''), w.name),
         active = coalesce(p_active, w.active),
         -- Re-enabling clears the failure state; otherwise one more failure
         -- would trip the auto-disable immediately.
         failure_count   = case when p_active then 0 else w.failure_count end,
         disabled_reason = case when p_active then null else w.disabled_reason end,
         updated_at = now()
   where w.id = p_id;
  return true;
end;
$$;
revoke all on function public.webhook_update(uuid, text, text[], text, boolean) from public, anon;
grant execute on function public.webhook_update(uuid, text, text[], text, boolean) to authenticated;

create or replace function public.webhook_delete(p_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws from public.webhooks w where w.id = p_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  delete from public.webhooks w where w.id = p_id;
  return true;
end;
$$;
revoke all on function public.webhook_delete(uuid) from public, anon;
grant execute on function public.webhook_delete(uuid) to authenticated;

create or replace function public.webhook_deliveries_list(
  p_webhook_id uuid, p_limit int default 50, p_cursor timestamptz default null)
returns table(id uuid, event text, status int, attempt int, response_ms int,
              error text, created_at timestamptz, delivered_at timestamptz,
              next_attempt_at timestamptz, payload jsonb)
language sql stable security definer
set search_path = public, auth as $$
  select d.id, d.event, d.status, d.attempt, d.response_ms, d.error,
         d.created_at, d.delivered_at, d.next_attempt_at, d.payload
    from public.webhook_deliveries d
    join public.webhooks w on w.id = d.webhook_id
   where d.webhook_id = p_webhook_id
     and public.is_workspace_member(w.workspace_id)
     and (p_cursor is null or d.created_at < p_cursor)
   order by d.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
revoke all on function public.webhook_deliveries_list(uuid, int, timestamptz) from public, anon;
grant execute on function public.webhook_deliveries_list(uuid, int, timestamptz) to authenticated;

-- Requeue rather than re-POST inline: the drain owns delivery, so a redeliver
-- is one row becoming due again and every retry is recorded the same way.
create or replace function public.webhook_redeliver(p_delivery_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare v_ws uuid;
begin
  select w.workspace_id into v_ws
    from public.webhook_deliveries d join public.webhooks w on w.id = d.webhook_id
   where d.id = p_delivery_id;
  if v_ws is null then return false; end if;
  if not public.can_write_workspace(v_ws) then
    raise exception 'not your webhook' using errcode = '42501';
  end if;
  update public.webhook_deliveries d
     set delivered_at = null, next_attempt_at = now(), attempt = 0, error = null
   where d.id = p_delivery_id;
  return true;
end;
$$;
revoke all on function public.webhook_redeliver(uuid) from public, anon;
grant execute on function public.webhook_redeliver(uuid) to authenticated;

-- Retention. Deliveries are an operational log, not a record.
create or replace function public.purge_webhook_log(p_retention_days int default 30)
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  delete from public.webhook_deliveries
   where created_at < now() - make_interval(days => greatest(1, p_retention_days));
  get diagnostics v_n = row_count;
  delete from public.webhook_events
   where fanned_at is not null
     and created_at < now() - make_interval(days => greatest(1, p_retention_days));
  return v_n;
end;
$$;
revoke all on function public.purge_webhook_log(int) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 5. board_tree — the hierarchy in one call
--
-- GET /boards?parent= returns one level, so walking a show's structure costs
-- one request per node. Authorization is checked ONCE, at the root: can_read_board
-- walks UP and grants if any ancestor is readable, so everything beneath a
-- readable board is readable by that definition. Calling it per row would make
-- this quadratic for no added safety.
-----------------------------------------------------------------------
create or replace function public.board_tree(
  p_root uuid default null, p_workspace uuid default null, p_depth int default 10)
returns table(id uuid, parent_board_id uuid, name text, view text,
              workspace_id uuid, depth int, card_count int,
              created_at timestamptz, updated_at timestamptz, deleted boolean)
language plpgsql stable security definer
set search_path = public, auth as $$
declare v_depth int := greatest(1, least(coalesce(p_depth, 10), 20));
begin
  if p_root is not null then
    if not public.can_read_board(p_root) then
      raise exception 'you do not have access to this board' using errcode = '42501';
    end if;
    return query
      with recursive t as (
        select b.id, b.parent_board_id, b.name, b.view, b.workspace_id, 0 as depth,
               b.card_count, b.created_at, b.updated_at, b.deleted_at
          from public.boards b where b.id = p_root
        union all
        select c.id, c.parent_board_id, c.name, c.view, c.workspace_id, t.depth + 1,
               c.card_count, c.created_at, c.updated_at, c.deleted_at
          from public.boards c join t on c.parent_board_id = t.id
         where t.depth < v_depth and c.deleted_at is null
      )
      select t.id, t.parent_board_id, t.name, t.view, t.workspace_id, t.depth,
             coalesce(t.card_count, 0), t.created_at, t.updated_at,
             t.deleted_at is not null
        from t order by t.depth, t.name limit 5000;
    return;
  end if;

  if p_workspace is null then
    raise exception 'pass a root board or a workspace' using errcode = '22023';
  end if;
  if not public.is_workspace_member(p_workspace) then
    raise exception 'you are not a member of this workspace' using errcode = '42501';
  end if;
  return query
    with recursive t as (
      select b.id, b.parent_board_id, b.name, b.view, b.workspace_id, 0 as depth,
             b.card_count, b.created_at, b.updated_at, b.deleted_at
        from public.boards b
       where b.workspace_id = p_workspace and b.parent_board_id is null
         and b.deleted_at is null
      union all
      select c.id, c.parent_board_id, c.name, c.view, c.workspace_id, t.depth + 1,
             c.card_count, c.created_at, c.updated_at, c.deleted_at
        from public.boards c join t on c.parent_board_id = t.id
       where t.depth < v_depth and c.deleted_at is null
    )
    select t.id, t.parent_board_id, t.name, t.view, t.workspace_id, t.depth,
           coalesce(t.card_count, 0), t.created_at, t.updated_at,
           t.deleted_at is not null
      from t order by t.depth, t.name limit 5000;
end;
$$;
revoke all on function public.board_tree(uuid, uuid, int) from public, anon;
grant execute on function public.board_tree(uuid, uuid, int) to authenticated;

-----------------------------------------------------------------------
-- 6. api_audit_read — the log stops being write-only
--
-- api_request_log has been written since 0220 and its only read path,
-- api_token_usage, has never had a single caller. A workspace owner also needs
-- to see what their SERVICE ACCOUNTS did, which api_token_usage's
-- `user_id = auth.uid()` cannot express.
--
-- Keyset on the bigserial id, descending: created_at is not unique under a
-- migration doing thousands of writes a second.
-----------------------------------------------------------------------
create or replace function public.api_audit_read(
  p_since  timestamptz default null,
  p_cursor bigint default null,
  p_limit  int default 100
)
returns table(id bigint, created_at timestamptz, actor text, actor_id uuid,
              token_id uuid, token_name text, method text, route text,
              target_id uuid, status int, ms int)
language sql stable security definer
set search_path = public, auth as $$
  select l.id, l.created_at,
         coalesce(s.name, p.display_name, 'you') as actor,
         l.user_id, l.token_id, t.name,
         l.method, l.route, l.target_id, l.status, l.ms
    from public.api_request_log l
    left join public.api_tokens      t on t.id = l.token_id
    left join public.service_accounts s on s.user_id = l.user_id
    left join public.profiles         p on p.user_id = l.user_id
   where (
           l.user_id = auth.uid()
           or l.user_id in (
             select sa.user_id from public.service_accounts sa
               join public.workspaces w on w.id = sa.workspace_id
              where w.created_by = auth.uid()
           )
         )
     and (p_since  is null or l.created_at >= p_since)
     and (p_cursor is null or l.id < p_cursor)
   order by l.id desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.api_audit_read(timestamptz, bigint, int) from public, anon;
grant execute on function public.api_audit_read(timestamptz, bigint, int) to authenticated;

-----------------------------------------------------------------------
-- 7. The indexes a delta read needs
--
-- `GET /boards?since=` and `GET /boards/:id/cards?since=` are the difference
-- between a sync that re-scans everything each cycle and one that asks what
-- moved. Neither ordering was indexed.
-----------------------------------------------------------------------
create index if not exists card_index_board_updated_idx
  on public.card_index (board_id, updated_at desc);
create index if not exists card_index_ws_updated_idx
  on public.card_index (workspace_id, updated_at desc);
create index if not exists boards_ws_updated_idx
  on public.boards (workspace_id, updated_at desc) where deleted_at is null;

-----------------------------------------------------------------------
-- 8. Retention
-----------------------------------------------------------------------
select cron.schedule(
  'purge-webhook-log',
  '35 3 * * *',
  $cron$ select public.purge_webhook_log(30); $cron$
);
