-- Vote cards: a lightweight up/down poll that anchors to a canvas card,
-- group, point in empty space, or the board — the SAME anchoring model as
-- comments (0031/0035) so the client reuses the bubbleLayout geometry.
-- Each card carries an optional question `label`. Per-user ballots live in
-- a separate table (one row per card+user); counts are derived. RLS,
-- soft-delete (0051), touch-updated_at, realtime + replica identity full
-- (0034) all mirror comments. Helpers can_read_board / can_write_board
-- already exist (security definer).

----------------------------------------------------------------------
-- VOTE CARDS
----------------------------------------------------------------------
create table if not exists public.vote_cards (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces on delete cascade,
  board_id      uuid not null references public.boards on delete cascade,

  -- Anchor: card / group anchor_id; point uses anchor_x/y; board = no anchor.
  anchor_kind   text not null check (anchor_kind in ('card','group','point','board')),
  anchor_id     text,
  anchor_x      integer,
  anchor_y      integer,
  offset_x      integer not null default 0,
  offset_y      integer not null default 0,

  label         text,                      -- optional question; null = unlabeled
  author        uuid references auth.users,

  hidden        boolean not null default false,
  resolved      boolean not null default false,
  deleted_at    timestamptz,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists vote_cards_board_id_idx on public.vote_cards (board_id);
create index if not exists vote_cards_author_idx   on public.vote_cards (author);
create index if not exists vote_cards_alive_board_idx
  on public.vote_cards (board_id, created_at desc) where deleted_at is null;

alter table public.vote_cards enable row level security;

drop policy if exists "vote_cards select" on public.vote_cards;
create policy "vote_cards select" on public.vote_cards for select
  using (public.can_read_board(board_id));

drop policy if exists "vote_cards insert" on public.vote_cards;
create policy "vote_cards insert" on public.vote_cards for insert
  with check (author = auth.uid() and public.can_read_board(board_id));

drop policy if exists "vote_cards update self or editor" on public.vote_cards;
create policy "vote_cards update self or editor" on public.vote_cards for update
  using (author = auth.uid() or public.can_write_board(board_id))
  with check (author = auth.uid() or public.can_write_board(board_id));

drop policy if exists "vote_cards delete self or editor" on public.vote_cards;
create policy "vote_cards delete self or editor" on public.vote_cards for delete
  using (author = auth.uid() or public.can_write_board(board_id));

create or replace function public.vote_cards_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists vote_cards_touch_updated_at on public.vote_cards;
create trigger vote_cards_touch_updated_at
  before update on public.vote_cards
  for each row execute function public.vote_cards_touch_updated_at();

----------------------------------------------------------------------
-- BALLOTS — one row per (vote_card, user).
-- board_id is DENORMALIZED from the parent vote_card so the client's
-- realtime channel can filter by board_id (supabase-js postgres_changes
-- filters are single-column equality on the changed table; on DELETE only
-- the PK is in the OLD record, so without board_id here a ballot delete
-- could never be scoped to the board). replica identity full + this column
-- let the cheap-refetch pattern work for ballots exactly as for comments.
----------------------------------------------------------------------
create table if not exists public.vote_card_ballots (
  vote_card_id  uuid not null references public.vote_cards on delete cascade,
  board_id      uuid not null references public.boards on delete cascade,
  user_id       uuid not null references auth.users on delete cascade,
  value         smallint not null check (value in (-1, 1)),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (vote_card_id, user_id)
);

create index if not exists vote_card_ballots_board_idx on public.vote_card_ballots (board_id);
create index if not exists vote_card_ballots_card_idx  on public.vote_card_ballots (vote_card_id);

alter table public.vote_card_ballots enable row level security;

drop policy if exists "ballots select" on public.vote_card_ballots;
create policy "ballots select" on public.vote_card_ballots for select
  using (public.can_read_board(board_id));

-- Writes are own-row only AND the caller must be able to read the board.
-- cast_vote() is the intended path, but direct writes stay safe under these.
drop policy if exists "ballots insert own" on public.vote_card_ballots;
create policy "ballots insert own" on public.vote_card_ballots for insert
  with check (user_id = auth.uid() and public.can_read_board(board_id));

drop policy if exists "ballots update own" on public.vote_card_ballots;
create policy "ballots update own" on public.vote_card_ballots for update
  using (user_id = auth.uid() and public.can_read_board(board_id))
  with check (user_id = auth.uid() and public.can_read_board(board_id));

drop policy if exists "ballots delete own" on public.vote_card_ballots;
create policy "ballots delete own" on public.vote_card_ballots for delete
  using (user_id = auth.uid() and public.can_read_board(board_id));

create or replace function public.vote_card_ballots_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists vote_card_ballots_touch_updated_at on public.vote_card_ballots;
create trigger vote_card_ballots_touch_updated_at
  before update on public.vote_card_ballots
  for each row execute function public.vote_card_ballots_touch_updated_at();

----------------------------------------------------------------------
-- RPC: cast_vote — atomic toggle of the caller's ballot.
--   same value re-cast  -> delete (un-vote)
--   new / opposite value -> upsert to the new value
-- board_id is derived from the vote card (security boundary; the client
-- never supplies it). security definer bypasses RLS so we re-check
-- can_read_board explicitly.
----------------------------------------------------------------------
create or replace function public.cast_vote(p_vote_card_id uuid, p_value smallint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_board_id uuid;
  v_existing smallint;
begin
  if p_value not in (-1, 1) then
    raise exception 'value must be -1 or 1' using errcode = '22023';
  end if;

  select board_id into v_board_id
  from public.vote_cards
  where id = p_vote_card_id and deleted_at is null;
  if v_board_id is null then
    raise exception 'vote card % not found', p_vote_card_id using errcode = '42704';
  end if;

  if not public.can_read_board(v_board_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select value into v_existing
  from public.vote_card_ballots
  where vote_card_id = p_vote_card_id and user_id = auth.uid();

  if v_existing is not null and v_existing = p_value then
    delete from public.vote_card_ballots
    where vote_card_id = p_vote_card_id and user_id = auth.uid();
  else
    insert into public.vote_card_ballots (vote_card_id, board_id, user_id, value)
    values (p_vote_card_id, v_board_id, auth.uid(), p_value)
    on conflict (vote_card_id, user_id)
    do update set value = excluded.value, updated_at = now();
  end if;
end;
$$;
revoke all on function public.cast_vote(uuid, smallint) from public;
grant execute on function public.cast_vote(uuid, smallint) to authenticated;

----------------------------------------------------------------------
-- RPC: list_vote_cards — one round-trip list with derived counts +
-- the caller's own vote. LEFT JOIN so zero-ballot cards return 0/0/null.
----------------------------------------------------------------------
create or replace function public.list_vote_cards(p_board_id uuid)
returns table (
  id uuid, workspace_id uuid, board_id uuid,
  anchor_kind text, anchor_id text, anchor_x integer, anchor_y integer,
  offset_x integer, offset_y integer,
  label text, author uuid, hidden boolean, resolved boolean,
  created_at timestamptz, updated_at timestamptz,
  up_count integer, down_count integer, my_value smallint
)
language sql stable security definer set search_path = public as $$
  select v.id, v.workspace_id, v.board_id,
         v.anchor_kind, v.anchor_id, v.anchor_x, v.anchor_y,
         v.offset_x, v.offset_y,
         v.label, v.author, v.hidden, v.resolved,
         v.created_at, v.updated_at,
         coalesce(sum((b.value =  1)::int), 0)::int as up_count,
         coalesce(sum((b.value = -1)::int), 0)::int as down_count,
         max(case when b.user_id = auth.uid() then b.value end) as my_value
  from public.vote_cards v
  left join public.vote_card_ballots b on b.vote_card_id = v.id
  where v.board_id = p_board_id
    and v.deleted_at is null
    and public.can_read_board(p_board_id)
  group by v.id
  order by v.created_at asc;
$$;
revoke all on function public.list_vote_cards(uuid) from public;
grant execute on function public.list_vote_cards(uuid) to authenticated;

----------------------------------------------------------------------
-- RPC: soft_delete_vote_card — recoverable delete (mirrors 0051).
----------------------------------------------------------------------
create or replace function public.soft_delete_vote_card(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.vote_cards set deleted_at = now(), updated_at = now()
  where id = p_id and deleted_at is null
    and (author = auth.uid() or public.can_write_board(board_id));
end;
$$;
revoke all on function public.soft_delete_vote_card(uuid) from public;
grant execute on function public.soft_delete_vote_card(uuid) to authenticated;

----------------------------------------------------------------------
-- REALTIME (mirrors 0031 line 83 + 0034). Idempotent publication adds.
----------------------------------------------------------------------
alter table public.vote_cards        replica identity full;
alter table public.vote_card_ballots replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.vote_cards;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.vote_card_ballots;
exception when duplicate_object then null;
end $$;
