-- 0382 — a co-member sees a name, a colour and a picture, not the whole row
-- (audit DB-4).
--
-- profiles carries far more than presentation: acquisition source, settings,
-- ban and send-hold reasons, referral code, country, plan counters. The
-- "ws-mate read profile" policy let anyone sharing a workspace with you —
-- including someone who joined through an edit link a minute ago — read all
-- of it, and realtime pushed every change to them as it happened.
--
-- member_profiles holds the presentational columns, kept in step by a trigger,
-- readable by you, by the people you share a workspace with, and by admins,
-- and published to realtime. 0383 drops the ws-mate policy from profiles once
-- the app reads member_profiles instead — dropping it first would blank every
-- collaborator's colour and picture in the clients still deployed.

begin;

create table if not exists public.member_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  color        text,
  avatar_url   text,
  updated_at   timestamptz not null default now()
);
alter table public.member_profiles enable row level security;
revoke all on table public.member_profiles from public, anon, authenticated;
grant select on table public.member_profiles to authenticated;

create policy "member profile read by self or workspace mate" on public.member_profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1
                 from public.workspace_members m1
                 join public.workspace_members m2 on m1.workspace_id = m2.workspace_id
                where m1.user_id = auth.uid() and m2.user_id = member_profiles.user_id)
    or public.is_admin()
  );

create or replace function public._tg_member_profile_sync()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  insert into public.member_profiles (user_id, display_name, color, avatar_url, updated_at)
  values (new.user_id, new.display_name, new.color, new.avatar_url, now())
  on conflict (user_id) do update
     set display_name = excluded.display_name,
         color        = excluded.color,
         avatar_url   = excluded.avatar_url,
         updated_at   = excluded.updated_at
   where (member_profiles.display_name, member_profiles.color, member_profiles.avatar_url)
         is distinct from (excluded.display_name, excluded.color, excluded.avatar_url);
  return null;
end;
$$;
revoke execute on function public._tg_member_profile_sync() from public, anon, authenticated;

create trigger profiles_member_profile_sync
  after insert or update of display_name, color, avatar_url on public.profiles
  for each row execute function public._tg_member_profile_sync();

insert into public.member_profiles (user_id, display_name, color, avatar_url, updated_at)
select p.user_id, p.display_name, p.color, p.avatar_url, coalesce(p.updated_at, now())
  from public.profiles p
on conflict (user_id) do nothing;

alter publication supabase_realtime add table public.member_profiles;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.member_profiles'::regclass) then
    raise exception '0382: member_profiles has no RLS';
  end if;
  if has_table_privilege('anon', 'public.member_profiles', 'select')
     or has_table_privilege('authenticated', 'public.member_profiles', 'insert')
     or has_table_privilege('authenticated', 'public.member_profiles', 'update')
     or has_table_privilege('authenticated', 'public.member_profiles', 'delete')
     or not has_table_privilege('authenticated', 'public.member_profiles', 'select') then
    raise exception '0382: member_profiles grants are wrong';
  end if;
  if has_function_privilege('authenticated', 'public._tg_member_profile_sync()', 'execute') then
    raise exception '0382: the sync trigger function is client-callable';
  end if;
  if (select count(*) from public.member_profiles) <> (select count(*) from public.profiles) then
    raise exception '0382: the backfill missed rows';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_profiles') then
    raise exception '0382: member_profiles is not published to realtime';
  end if;
end $$;

commit;
