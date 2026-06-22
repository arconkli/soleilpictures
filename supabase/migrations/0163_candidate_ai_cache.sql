-- 0163 — Per-candidate AI classification cache for the FREE Workers AI
-- "type + confirm" layer that sits on top of get_candidate_names (0162).
--
-- WHY: 0162 qualifies candidate names precisely but its type guess is a
-- regex (single-cap-token -> character, else concept) and it can't tell a
-- leftover generic word from a real story entity. A tiny Cloudflare Workers
-- AI model (free in-worker tier) now classifies each candidate: best type +
-- a keep flag (drop residual junk) + a confidence. The Worker route
-- POST /api/ai/candidates owns the model call (see boards/src/worker-ai.js).
--
-- COST DESIGN (the whole point): classify each candidate ONCE and remember
-- it here, keyed by (workspace_id, name_lc, sample_hash). On every later
-- load the Worker returns cached verdicts and sends ONLY never-seen names to
-- the model -> roughly one tiny model call per brand-new name per workspace,
-- EVER. Re-classified only when a name's prose context (sample) materially
-- changes (new sample_hash). After warmup almost every load is a 100% cache
-- hit = zero model calls. Shared across all users/devices in the workspace.
--
-- The Worker writes via the service role (after a verifyUser JWT + workspace
-- membership gate). The client never touches this table directly. No FK to
-- workspaces on purpose: this is derived/ephemeral cache data, an orphan row
-- is harmless and gets overwritten, and it keeps the migration resilient to
-- prod schema drift.

create table if not exists public.candidate_ai_cache (
  workspace_id uuid        not null,
  name_lc      text        not null,
  sample_hash  text        not null,
  type         text,
  keep         boolean     not null default true,
  confidence   real,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, name_lc, sample_hash),
  constraint candidate_ai_cache_type_check
    check (type is null or type = any (array['character','setting','concept','thing','organization']))
);

-- Per-workspace/day and global/day quota guards both read updated_at.
create index if not exists candidate_ai_cache_ws_updated_idx
  on public.candidate_ai_cache (workspace_id, updated_at desc);
create index if not exists candidate_ai_cache_updated_idx
  on public.candidate_ai_cache (updated_at desc);

alter table public.candidate_ai_cache enable row level security;

-- Defense in depth: workspace members may read their own workspace's cache.
-- (The Worker itself uses the service role, which bypasses RLS; this policy
-- only matters if the table is ever read under a user JWT.) No client
-- insert/update/delete policy exists -> only the service-role Worker writes.
drop policy if exists candidate_ai_cache_member_read on public.candidate_ai_cache;
create policy candidate_ai_cache_member_read on public.candidate_ai_cache
  for select using (is_workspace_member(workspace_id));

-- Quota readout for the Worker's budget guard. Returns how many candidates
-- this workspace classified in the last day, and how many were classified
-- across ALL workspaces in the last day. The Worker skips the model (and
-- falls back to the deterministic verdict) when either exceeds its cap, so a
-- pathological client can never run up Neuron usage / a bill.
create or replace function public.candidate_ai_quota(p_workspace_id uuid)
returns table(ws_today bigint, global_today bigint)
language sql
security definer
set search_path to 'public'
stable
as $function$
  select
    (select count(*) from candidate_ai_cache
       where workspace_id = p_workspace_id and updated_at > now() - interval '1 day'),
    (select count(*) from candidate_ai_cache
       where updated_at > now() - interval '1 day');
$function$;

revoke all on function public.candidate_ai_quota(uuid) from public;
grant execute on function public.candidate_ai_quota(uuid) to service_role;
