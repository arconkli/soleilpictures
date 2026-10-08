-- 0383 — a profiles row is readable by its owner and admins only (audit DB-4).
--
-- The app reads collaborators' names, colours and pictures from
-- member_profiles (0382) since production d24bbf8f, so the policy that let
-- every workspace mate read whole profiles rows goes. No view or invoker
-- function depended on it; security-definer functions never did.

begin;

drop policy if exists "ws-mate read profile" on public.profiles;

do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'profiles' and policyname = 'ws-mate read profile') then
    raise exception '0383: the workspace-mate policy is still there';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
                and policyname not in ('self read profile', 'admin read all profiles')) then
    raise exception '0383: profiles has a SELECT policy beyond self and admin';
  end if;
end $$;

commit;
