-- 0594 — Pictures suggest the tags they show (photo vision, 2026-10-27).
--
-- After a picture is described (0593) and its card embedded, the describe job
-- (worker-vision.js) asks _suggest_tags_for_card about the card. Two matches,
-- both SQL, no model call:
--   * the workspace's live, spreadable tags whose name appears as a word in the
--     description or keywords: origin 'vision', reason = the tag's slug. The
--     text and the slug are both cut to hyphenated words first, so "golden
--     hour" finds a Golden Hour tag and "cars" a Car tag, but "carpet" doesn't;
--   * tags whose centroid lies within the suggest band of the card's embedding,
--     which now carries the description: origin 'vision-embed'.
-- They only ever SUGGEST (the owner's rule): rows go to tag_suggestions, never
-- entity_links. A pair already applied, removed (autotag_ignored) or already
-- suggested (a dismissed tombstone included) is skipped before the cap, so
-- three new ones a card at most.
--
-- tag_suggestions.distance orders a card's chips, closest first: a word match
-- takes its centroid distance when that is inside the band, else 0.26.
--
-- Turning the AI switch off (0593's trigger) now also clears the vision
-- suggestions still open; dismissed ones stay, as the person's choice.
--
-- Applied live 2026-10-27 in parts (records 0594_vision_suggestions_part1 to
-- part3 and part4_proof); the function bodies md5-match this file.

begin;
set local lock_timeout = '3s';

alter table public.tag_suggestions add column if not exists origin text not null default 'embed';
alter table public.tag_suggestions add column if not exists reason text;
do $origin$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tag_suggestions'::regclass and conname = 'tag_suggestions_origin_check') then
    alter table public.tag_suggestions
      add constraint tag_suggestions_origin_check check (origin in ('embed', 'vision', 'vision-embed'));
  end if;
end $origin$;

create or replace function public._suggest_tags_for_card(p_board uuid, p_card text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c_band constant double precision := 0.27;  -- clusterMath.js SUGGEST_DIST
  v_ws   uuid;
  v_text text;
  v_n    integer;
begin
  select ci.workspace_id,
         '-' || regexp_replace(lower(coalesce(d.description, '') || ' ' || array_to_string(d.keywords, ' ')), '[^a-z0-9]+', '-', 'g') || '-'
    into v_ws, v_text
    from public.card_index ci
    join public.workspaces w on w.id = ci.workspace_id and w.ai_tagger_enabled is not false
    join public.images i on i.storage_path = substr(ci.meta->>'src', 4) and i.deleted_at is null
    join public.image_descriptions d on d.image_id = i.id and d.status = 'done'
   where ci.board_id = p_board and ci.card_id = p_card
     and ci.kind = 'image' and (ci.meta->>'src') like 'r2:%';
  if v_ws is null then
    return 0;
  end if;

  with cand as (
    select t.id as tag_id, t.slug,
           v_text ~ ('-' || regexp_replace(lower(t.slug), '[^a-z0-9]+', '-', 'g') || '(s|es)?-') as word,
           (select ce.embedding <=> tc.centroid
              from public.card_embeddings ce
              join public.tag_centroids tc on tc.tag_id = t.id
             where ce.entity_kind = 'card' and ce.card_id = p_card) as dist
      from public.tags t
     where t.workspace_id = v_ws and t.deleted_at is null
       and public._tag_is_spreadable(t.slug, t.status)
       and length(regexp_replace(lower(t.slug), '[^a-z0-9]+', '', 'g')) >= 3
       and not exists (select 1 from public.entity_links el
                        where el.link_kind = 'applied' and el.target_kind = 'tag' and el.target_id = t.id
                          and el.source_kind = 'card' and el.source_id = p_card)
       and not exists (select 1 from public.autotag_ignored ig
                        where ig.workspace_id = v_ws and ig.target_kind = 'card'
                          and ig.target_id = p_card and ig.tag_id = t.id)
       and not exists (select 1 from public.tag_suggestions s
                        where s.tag_id = t.id and s.source_kind = 'card' and s.source_id = p_card)
  ), picked as (
    select cand.tag_id, cand.slug, cand.word,
           case when cand.word then least(coalesce(cand.dist, 0.26), 0.26) else cand.dist end as distance
      from cand
     where cand.word or cand.dist < c_band
     order by cand.word desc, cand.dist nulls last
     limit 3
  ), ins as (
    insert into public.tag_suggestions (tag_id, source_kind, source_id, workspace_id, board_id, distance, origin, reason)
    select picked.tag_id, 'card', p_card, v_ws, p_board, picked.distance,
           case when picked.word then 'vision' else 'vision-embed' end,
           case when picked.word then picked.slug end
      from picked
    on conflict (tag_id, source_kind, source_id) do nothing
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end;
$$;

-- 0593's switch-off cleanup, now with the open vision suggestions.
create or replace function public._tg_workspaces_ai_off_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ai_tagger_enabled is false and old.ai_tagger_enabled is distinct from false then
    delete from public.image_descriptions where workspace_id = new.id;
    delete from public.card_embeddings ce
     using public.card_index ci
     where ci.workspace_id = new.id and ci.kind = 'image'
       and ce.entity_kind = 'card' and ce.card_id = ci.card_id;
    delete from public.tag_suggestions
     where workspace_id = new.id and origin in ('vision', 'vision-embed') and dismissed_at is null;
  end if;
  return new;
end;
$$;

revoke execute on function public._suggest_tags_for_card(uuid, text) from public, anon, authenticated;
grant execute on function public._suggest_tags_for_card(uuid, text) to service_role;
revoke execute on function public._tg_workspaces_ai_off_cleanup() from public, anon, authenticated;

do $proof$
begin
  if has_function_privilege('anon', 'public._suggest_tags_for_card(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public._suggest_tags_for_card(uuid,text)', 'execute') then
    raise exception '0594: clients can call _suggest_tags_for_card';
  end if;
  if not has_function_privilege('service_role', 'public._suggest_tags_for_card(uuid,text)', 'execute') then
    raise exception '0594: the Worker cannot call _suggest_tags_for_card';
  end if;
  if has_function_privilege('authenticated', 'public._tg_workspaces_ai_off_cleanup()', 'execute') then
    raise exception '0594: clients can call the switch-off trigger function';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.tag_suggestions'::regclass and conname = 'tag_suggestions_origin_check') then
    raise exception '0594: tag_suggestions.origin is unchecked';
  end if;
  if (select p.prosrc from pg_proc p where p.oid = 'public._tg_workspaces_ai_off_cleanup()'::regprocedure)
       not like '%delete from public.tag_suggestions%' then
    raise exception '0594: the switch-off cleanup does not clear vision suggestions';
  end if;
end $proof$;

commit;
