-- 0427 — An images row's keys must belong to its own workspace.
--
-- An images row is what makes an R2 object readable. The party presigns any key
-- the caller can see a row for (/sign-reads: "RLS does the filter"), and the
-- share resolvers take a row in the sharing workspace as proof that a card's
-- file is that workspace's (_file_share_file, which feeds /file-share and
-- /file-save). The INSERT policy checked who may write to the row's workspace
-- or board, but never what the row pointed at: storage_path, preview_path and
-- preview_sm_path were free text.
--
-- Every key the party mints is `<workspace_id>/…`: originals are
-- `<workspace_id>/<uuid>.<ext>` (isValidUploadKey, copyKey), and derived files
-- live under `<workspace_id>/thumbs/` and `<workspace_id>/previews/`. So the
-- keys of a row a client inserts must now sit under that row's own workspace,
-- with every segment after the prefix starting with a letter, digit, '_' or '-'
-- (so no '.' or '..' segment, which a URL parser would collapse) and holding
-- only letters, digits and '._-'.
--
-- Clients have no UPDATE policy on images, so INSERT is the only client write
-- that can set these columns. Server paths (service role) are unaffected.
-- Existing rows are untouched; every row written since April already fits.
-- Policy only: no new function, so no new grants.

begin;

-- images takes an insert on every upload; give up rather than queue behind a
-- long transaction.
set local lock_timeout = '5s';

alter policy "images insert" on public.images
  with check (
    (public.can_write_workspace(workspace_id)
       or (board_id is not null
           and public.can_write_board(board_id)
           and public._board_in_workspace(board_id, workspace_id)))
    and storage_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$')
    and (preview_path is null
         or preview_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'))
    and (preview_sm_path is null
         or preview_sm_path ~ ('^' || workspace_id::text || '/[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$'))
  );

do $$
declare v_check text;
begin
  select p.with_check into v_check
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'images' and p.policyname = 'images insert';
  if v_check is null
     or v_check not like '%storage_path ~%'
     or v_check not like '%preview_path ~%'
     or v_check not like '%preview_sm_path ~%' then
    raise exception '0427: the images insert policy does not constrain its keys: %', v_check;
  end if;
end $$;

commit;
