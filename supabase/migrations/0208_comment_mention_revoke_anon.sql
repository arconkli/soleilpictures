-- 0208_comment_mention_revoke_anon.sql — close the anon EXECUTE grant left open
-- by 0207.
--
-- `revoke all ... from public` is NOT sufficient in this project. Supabase sets
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated;
-- so every newly created function receives an EXPLICIT grant to anon, which
-- revoking from PUBLIC leaves untouched. Verified after applying 0207:
-- has_function_privilege('anon', 'notify_comment_mention(...)') was still true.
--
-- Both functions are SECURITY DEFINER, so an anon caller runs them with owner
-- rights: _user_can_read_board would become a board-membership oracle, and
-- notify_comment_mention's own auth.uid() guard would be the only thing between
-- an anonymous request and the notification table.
--
-- Any future SECURITY DEFINER function in this schema needs the same explicit
-- `revoke ... from anon` — see the 0165 authz hardening pass.

revoke all on function public.notify_comment_mention(uuid, uuid, text, text, uuid[], text) from anon;
revoke all on function public._user_can_read_board(uuid, uuid) from anon, authenticated;
