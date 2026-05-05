-- Yjs sync + cursor awareness moved off the shared board:{id} topic onto
-- its own y:{id} topic so it doesn't collide with the chat broadcast (which
-- still uses board:{id}). Supabase realtime de-dupes channels by topic and
-- the second subscribe() on a dedup'd channel is a silent no-op, so sharing
-- the topic was preventing Yjs from ever reaching SUBSCRIBED.
--
-- Policy mirrors the board: rules: workspace members of the underlying
-- board can read + write y:{id}.

create policy "realtime y: workspace members"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'y:%'
  and is_board_member((substring(realtime.topic() from 3))::uuid)
);
create policy "realtime y: workspace members write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'y:%'
  and is_board_member((substring(realtime.topic() from 3))::uuid)
);

-- Drop the temporary diagnostic policy from the previous step.
drop policy if exists "TEMP allow all auth" on realtime.messages;
