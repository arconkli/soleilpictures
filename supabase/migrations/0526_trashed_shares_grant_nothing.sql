-- 0526_trashed_shares_grant_nothing.sql
--
-- A share on a cluster in the trash grants nothing. can_read_board has said
-- so since 0371; can_write_board's share branch and my_readable_board_ids'
-- share roots now agree. Workspace membership is untouched, so the owner and
-- members still see and restore what is in their trash.
--
-- Bodies re-emitted from the live definitions; can_write_board still asks
-- _workspace_member_can_write( for the membership branch.

CREATE OR REPLACE FUNCTION public.can_write_board(p_board_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id, deleted_at
    from public.boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id, b.deleted_at
    from public.boards b
    join chain c on b.id = c.parent_board_id
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when not public._actor_active() then false
    else exists (
      select 1 from chain
      where public._workspace_member_can_write(chain.workspace_id)
         or exists (
           select 1 from public.workspaces w
           where w.id = chain.workspace_id and w.created_by = auth.uid()
         )
         -- 0526: a share on a cluster in the trash grants nothing (as 0371
         -- made can_read_board).
         or (chain.deleted_at is null and exists (
           select 1 from public.board_shares s
           where s.board_id = chain.id
             and s.user_id  = auth.uid()
             and s.role     = 'editor'
         ))
    )
  end;
$function$;

CREATE OR REPLACE FUNCTION public.my_readable_board_ids()
 RETURNS uuid[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with recursive roots as (
    select b.id, b.parent_board_id
    from boards b
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
          )
       or exists (
            -- 0526: a share on a cluster in the trash grants nothing.
            select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid()
               and b.deleted_at is null
          )
    union
    select c.id, c.parent_board_id
    from boards c join roots r on c.parent_board_id = r.id
  )
  select case when public._actor_active()
              then coalesce(array_agg(id), '{}'::uuid[])
              else '{}'::uuid[] end
  from roots;
$function$;

-- The 0311 habit: prove the grants, don't trust them.
do $$
begin
  if not has_function_privilege('authenticated', 'public.can_write_board(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.my_readable_board_ids()', 'EXECUTE') then
    raise exception '0526: the access checks lost their grants';
  end if;
end $$;
