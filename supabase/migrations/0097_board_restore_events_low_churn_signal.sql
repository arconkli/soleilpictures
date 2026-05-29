-- Low-churn realtime signal for board restores.
--
-- restoreSignal (boards/src/lib/restoreSignal.js) subscribed to board_state_version
-- UPDATEs but only acts on `version` increases — actual restores (~9 in 33 days).
-- The same row is UPDATEd on EVERY op by advance_board_latest_seq (latest_seq
-- bump, version unchanged, ~15.6k/33d), and each one fanned out a postgres_changes
-- message that subscribers discarded — ~99.9% wasted Realtime traffic.
--
-- Fix: emit restores on a dedicated append-only table that only changes on a real
-- restore (version change), subscribe restoreSignal to THAT, and drop
-- board_state_version from the realtime publication. The hot per-op path
-- (advance_board_latest_seq) and the restore RPC (perform_board_restore) are
-- untouched. The 10s poll on board_state_version.version stays as the durable
-- offline fallback (REST read, unaffected by the publication change).
--
-- Applied to prod via MCP apply_migration on 2026-05-29.

create table if not exists public.board_restore_events (
  id          bigint generated always as identity primary key,
  board_id    uuid not null references public.boards(id) on delete cascade,
  version     bigint not null,
  created_at  timestamptz not null default now()
);
create index if not exists board_restore_events_board_idx
  on public.board_restore_events (board_id, id desc);

alter table public.board_restore_events enable row level security;
drop policy if exists "board_restore_events read by members" on public.board_restore_events;
create policy "board_restore_events read by members"
  on public.board_restore_events for select
  using (exists (
    select 1 from public.boards b
    where b.id = board_restore_events.board_id
      and is_workspace_member(b.workspace_id)
  ));

-- Emit an event only when board_state_version.version actually advances (a
-- restore). AFTER UPDATE fires on every op, but the version guard means we only
-- insert on real restores. SECURITY DEFINER so the insert isn't blocked by RLS;
-- the exception guard ensures a signal-insert failure can NEVER abort a board op.
create or replace function public.emit_board_restore_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.version is distinct from OLD.version then
    begin
      insert into public.board_restore_events (board_id, version)
      values (NEW.board_id, NEW.version);
    exception when others then null;
    end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists board_state_version_emit_restore on public.board_state_version;
create trigger board_state_version_emit_restore
  after update on public.board_state_version
  for each row execute function public.emit_board_restore_event();

-- Publish the low-churn signal; stop publishing the high-churn version row.
alter publication supabase_realtime add table public.board_restore_events;
alter publication supabase_realtime drop table public.board_state_version;
