-- 0059_conversations_security_invoker.sql — tighten up 0058.
--
-- Two fixes flagged by Supabase's security advisor:
--
-- 1. conversation_summary was created without `security_invoker`, so
--    by default it runs as SECURITY DEFINER and bypasses RLS on the
--    underlying messages + conversation_participants tables. With
--    security_invoker = true, the view enforces the caller's RLS.
--
-- 2. The trigger functions (messages_record_entity_links,
--    messages_fire_mention_notifications, messages_touch_conversation)
--    are SECURITY DEFINER so the trigger body can write tables the
--    user can't write directly. PostgREST exposes any SECURITY DEFINER
--    function as an RPC, which is noisy + would never work for a
--    trigger function (no TG_ context). Revoke execute from public so
--    they stop showing up in the auto-generated API.

alter view conversation_summary set (security_invoker = true);

revoke all on function messages_record_entity_links() from public;
revoke all on function messages_fire_mention_notifications() from public;
revoke all on function messages_touch_conversation() from public;
