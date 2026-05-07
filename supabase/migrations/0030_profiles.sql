-- User profiles: persistent display name + custom presence color +
-- avatar_url. Without this, every client derives a name from
-- email.split('@')[0] and a deterministic color from user.id — which
-- means users can't change either, and there's no surface for an
-- avatar.
--
-- Read access:
--  • Self can read/write their own row
--  • Anyone in a shared workspace can read display_name / color /
--    avatar_url so the presence stack and `users_by_ids` show real names
--
-- We do NOT expose this row through `users_by_ids` automatically — that
-- RPC stays as-is so existing callers don't change. New clients can
-- query `profiles` directly with RLS doing the membership filter.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  color        text,        -- hex like #4f8df8
  avatar_url   text,
  updated_at   timestamptz default now()
);

alter table public.profiles enable row level security;

-- Self can always read/write their own profile.
drop policy if exists "self read profile" on public.profiles;
create policy "self read profile"
  on public.profiles for select
  using (user_id = auth.uid());

drop policy if exists "self upsert profile" on public.profiles;
create policy "self upsert profile"
  on public.profiles for insert
  with check (user_id = auth.uid());

drop policy if exists "self update profile" on public.profiles;
create policy "self update profile"
  on public.profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Members of any shared workspace can read each other's display_name /
-- color / avatar_url so the presence stack renders real identities.
drop policy if exists "ws-mate read profile" on public.profiles;
create policy "ws-mate read profile"
  on public.profiles for select
  using (
    exists (
      select 1 from public.workspace_members m1
      join public.workspace_members m2 on m1.workspace_id = m2.workspace_id
      where m1.user_id = auth.uid()
        and m2.user_id = profiles.user_id
    )
  );

-- Touch updated_at on every update.
create or replace function public.profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();

-- Subscribe via realtime so peers see name/color changes live.
alter publication supabase_realtime add table public.profiles;
