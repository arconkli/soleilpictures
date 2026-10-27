-- 0703 — the two webhook events that never fired: card.moved and image.created.
--
-- WEBHOOK_EVENTS (lib/webhooks.js) has offered both since 0222, and the docs
-- list them, but nothing ever wrote either into the outbox: subscribing to one
-- was the "subscribed and silent" failure the webhooks page warns about.
--
-- card.moved. Every move between boards goes through moveCardsBetweenBoards
-- (lib/scoutBoard.js): the sidebar, a drop on a cluster, and
-- POST /boards/:id/cards/move. It re-points each card's card_index row at its
-- new board in place: one statement for the cards that keep their ids, and one
-- per card renamed for a collision on arrival. 0222's update trigger pairs old
-- and new rows on (board_id, card_id), so a row that changed board matched
-- nothing and a move fired no event at all. Now it fires one per pair of boards,
-- written to the destination's workspace and, for a move between workspaces,
-- to the source's as well.
--
-- image.created. An upload's row in images, which holds every upload
-- (pictures, video, audio, documents), as GET /images lists them. Previews,
-- play copies and posters (0402, 0660) and board thumbnails get rows of their
-- own, locked forever under previews/ or thumbs/. Those are not uploads.
--
-- Payloads carry ids and counts, as 0222's card events do: the first 25, then
-- a receiver reads the board or GET /images. The guard is 0222's: with no
-- active webhook in the workspace, a statement writes nothing.

-- The triggers lock card_index and images for a moment: wait at most 3s for
-- that rather than queue the app's writes behind a long transaction.
set local lock_timeout = '3s';

-- 0222's card.updated, unchanged, then the moves it could not see.
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

  -- A row that changed board, paired with what it became: on its id, or, in a
  -- statement that changed one row (a card renamed as it arrived), with that
  -- row. Neither key may survive the statement, so rows re-homed in place (a
  -- workspace changing hands) are never a move, whatever ids repeat.
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select ws.id, m.to_board, 'card.moved',
         jsonb_build_object('count', count(*),
                            'from_board_id', m.from_board,
                            'card_ids', (array_agg(m.to_id order by m.to_id))[1:25],
                            'from_card_ids', (array_agg(m.from_id order by m.to_id))[1:25])
    from (select o.workspace_id as from_ws, o.board_id as from_board, o.card_id as from_id,
                 n.workspace_id as to_ws, n.board_id as to_board, n.card_id as to_id
            from oldtab o
            join newtab n
              on n.board_id <> o.board_id
             and (n.card_id = o.card_id
                  or ((select count(*) from oldtab) = 1 and (select count(*) from newtab) = 1))
           where not exists (select 1 from newtab k
                              where k.board_id = o.board_id and k.card_id = o.card_id)
             and not exists (select 1 from oldtab k
                              where k.board_id = n.board_id and k.card_id = n.card_id)) m
   cross join lateral (select distinct x as id from unnest(array[m.to_ws, m.from_ws]) x) ws
   where exists (select 1 from public.webhooks w
                  where w.workspace_id = ws.id and w.active)
   group by ws.id, m.to_board, m.from_board;
  return null;
end;
$$;

create or replace function public.webhook_emit_images_ins()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.webhook_events (workspace_id, board_id, event, resource)
  select n.workspace_id, n.board_id, 'image.created',
         jsonb_build_object('count', count(*),
                            'image_keys', (array_agg(n.storage_path order by n.storage_path))[1:25])
    from newtab n
   where n.retention_locked_until is distinct from timestamptz '2999-01-01'
     and n.storage_path !~ '/(previews|thumbs)/'
     and exists (select 1 from public.webhooks w
                  where w.workspace_id = n.workspace_id and w.active)
   group by n.workspace_id, n.board_id;
  return null;
end;
$$;

create or replace trigger images_webhook_ins after insert on public.images
  referencing new table as newtab
  for each statement execute function public.webhook_emit_images_ins();

revoke execute on function public.webhook_emit_cards_upd() from public, anon, authenticated;
revoke execute on function public.webhook_emit_images_ins() from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.webhook_emit_cards_upd()', 'public.webhook_emit_images_ins()'] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0703: % is still callable by a signed-in or anonymous caller', f;
    end if;
  end loop;
end;
$$;
