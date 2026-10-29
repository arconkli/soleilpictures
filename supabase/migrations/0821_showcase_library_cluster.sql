-- 0821_showcase_library_cluster.sql — two things Admin › Boards needs that
-- 0820 didn't give it:
--
--   * each board's cluster (its parent's name: "Film", "Costume" …), so the
--     library filters by the clusters the boards sit in, as the sidebar shows;
--   * showcase_waiting(): how many boards wait for an OK, for the tab's badge,
--     without signing every shot link on every admin page load.
--
-- Both admin only (_require_admin), EXECUTE for authenticated and service_role
-- only (0311).

begin;

set local lock_timeout = '3s';

create or replace function public.showcase_library()
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_boards jsonb;
  v_run jsonb;
begin
  perform public._require_admin();

  select coalesce(jsonb_agg(t.item order by t.made_at desc), '[]'::jsonb)
    into v_boards
  from (
    select jsonb_build_object(
      'board_id', s.board_id,
      'workspace_id', b.workspace_id,
      'cluster', pb.name,
      'slug', s.slug,
      'title', s.title,
      'story', s.story,
      'subject', s.subject,
      'page_path', s.page_path,
      'status', s.status,
      'placed_on', to_jsonb(s.placed_on),
      'score', s.score,
      'credits', s.credits,
      'made_at', s.made_at,
      'decided_at', s.decided_at,
      'decided_by_person', s.decided_by is not null,
      'trashed', b.deleted_at is not null,
      'live', exists (
        select 1 from public.public_boards p
         where p.board_id = s.board_id and p.published_at is not null
      ),
      'shots', coalesce((
        select jsonb_agg(
          shot
          || jsonb_build_object(
               'url', '/api/showcase-shot/' || s.board_id || '/' || (shot->>'file')
                      || '?s=' || public._showcase_shot_sig(s.board_id || '/' || (shot->>'file')))
          || case when shot ? 'thumb' then jsonb_build_object(
               'thumb_url', '/api/showcase-shot/' || s.board_id || '/' || (shot->>'thumb')
                            || '?s=' || public._showcase_shot_sig(s.board_id || '/' || (shot->>'thumb')))
             else '{}'::jsonb end
          order by ord)
          from jsonb_array_elements(s.shots) with ordinality as e(shot, ord)
         where shot->>'file' ~ '^[a-z0-9][a-z0-9._-]{0,80}$'
           and (not shot ? 'thumb' or shot->>'thumb' ~ '^[a-z0-9][a-z0-9._-]{0,80}$')
      ), '[]'::jsonb)
    ) as item,
    s.made_at
    from public.showcase_boards s
    join public.boards b on b.id = s.board_id
    left join public.boards pb on pb.id = b.parent_board_id
  ) t;

  select to_jsonb(r) into v_run
  from (
    select id, started_at, finished_at, kind, ok, made, dropped, note
      from public.showcase_runs
     order by started_at desc
     limit 1
  ) r;

  return jsonb_build_object(
    'boards', v_boards,
    'ok_by_person', (select count(*) from public.showcase_boards
                      where status = 'ok' and decided_by is not null),
    'last_run', v_run
  );
end;
$fn$;

revoke execute on function public.showcase_library() from public, anon;
grant execute on function public.showcase_library() to authenticated, service_role;

create or replace function public.showcase_waiting()
returns integer
language plpgsql stable security definer
set search_path = 'public'
as $fn$
begin
  perform public._require_admin();
  return (
    select count(*)::int
      from public.showcase_boards s
      join public.boards b on b.id = s.board_id
     where s.status = 'new' and b.deleted_at is null
  );
end;
$fn$;

revoke execute on function public.showcase_waiting() from public, anon;
grant execute on function public.showcase_waiting() to authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.showcase_library()',
    'public.showcase_waiting()'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0821: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0821: authenticated cannot execute %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0821: service_role cannot execute %', f;
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
