-- Supabase Realtime authorization policies.
--
-- realtime.messages has RLS enabled but no policies, so every broadcast
-- send / receive was silently dropped. This adds three scoped policies
-- (one per channel topic prefix) so authenticated members can use
-- broadcast/presence on the channels we actually use.
--
-- Channel name conventions:
--   board:{boardId}            — Yjs sync + cursor + per-board chat
--   ws:{workspaceId}           — workspace presence
--   dm:{loUserId}:{hiUserId}   — direct messages (party uuids sorted)
--
-- realtime.topic() returns the channel name for the row being checked,
-- so we parse the suffix and ask "is the caller authorized for this topic?".

-- ── board:{boardId} ──────────────────────────────────────────────────────
create policy "realtime board: workspace members"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'board:%'
  and exists (
    select 1 from boards b
    where b.id::text = substring(realtime.topic() from 7)
      and is_workspace_member(b.workspace_id)
  )
);
create policy "realtime board: workspace members write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'board:%'
  and exists (
    select 1 from boards b
    where b.id::text = substring(realtime.topic() from 7)
      and is_workspace_member(b.workspace_id)
  )
);

-- ── ws:{workspaceId} ─────────────────────────────────────────────────────
create policy "realtime ws: workspace members"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'ws:%'
  and is_workspace_member((substring(realtime.topic() from 4))::uuid)
);
create policy "realtime ws: workspace members write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'ws:%'
  and is_workspace_member((substring(realtime.topic() from 4))::uuid)
);

-- ── dm:{loId}:{hiId} ─────────────────────────────────────────────────────
-- Allow either of the two parties named in the channel name.
create policy "realtime dm: party members"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'dm:%'
  and (
    auth.uid()::text = split_part(substring(realtime.topic() from 4), ':', 1)
    or auth.uid()::text = split_part(substring(realtime.topic() from 4), ':', 2)
  )
);
create policy "realtime dm: party members write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'dm:%'
  and (
    auth.uid()::text = split_part(substring(realtime.topic() from 4), ':', 1)
    or auth.uid()::text = split_part(substring(realtime.topic() from 4), ':', 2)
  )
);
