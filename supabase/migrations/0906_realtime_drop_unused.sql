-- 0906 — profiles and pending_clusters leave the realtime publication.
--
-- Realtime decodes every change to every table in supabase_realtime from the
-- write-ahead log, whether or not anyone is listening, and nobody listens to
-- these two. The app reads people through member_profiles and listens to that
-- (userProfiles.js; securityAudit.test.mjs checks that no client listens to
-- profiles), and nothing in the app, the Worker, the party, Scout, the MCP
-- server or the functions subscribes to pending_clusters. Every write to them
-- was decoded for no one: found while reading the database's load after the
-- 17 Nov 2026 restart. Each drop is skipped when the table is already out.

begin;

do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime drop table public.profiles;
  end if;
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pending_clusters') then
    alter publication supabase_realtime drop table public.pending_clusters;
  end if;
end $$;

-- Proof: both are out, and member_profiles, which the app does listen to, is in.
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public'
                and tablename in ('profiles', 'pending_clusters')) then
    raise exception '0906: profiles or pending_clusters is still published';
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_profiles') then
    raise exception '0906: member_profiles is not published';
  end if;
end $$;

commit;
