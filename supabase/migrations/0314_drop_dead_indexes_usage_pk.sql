-- 0314_drop_dead_indexes_usage_pk.sql
--
-- Two speed/hygiene items from the round-2 audit.
--
-- 1. SIX INDEXES WITH ZERO SCANS SINCE 2026-08-16, all maintained on every
--    write to their (busy) tables. Verified against pg_stat_user_indexes right
--    before this migration: idx_scan = 0 for all six, none unique, none a PK,
--    none backing a constraint.
--
--    The two trigram GINs on card_index are the ones that matter — 2.2MB + 1.4MB
--    of GIN that Postgres must update on all ~26k card_index writes/period, plus
--    doc_page_index's 2.1MB text GIN. They exist to serve ilike/similarity
--    search, which today only the /api/v1 card search reaches
--    (worker-api.js pgLikeValue, ~L1420) — an endpoint api_request_log shows has
--    never been called. At 3.9k card rows an ilike seq scan is single-digit ms;
--    the GINs are pure write tax. If the API gets real search traffic, recreate
--    them (concurrently) — they are an optimisation, not a correctness feature.
--
--    images_ref_count_idx: a partial btree WHERE ref_count = 0, maintained on
--    419k image writes, used by nothing. The R2 orphan sweep filters ref_count=0
--    but orders by created_at and runs once daily over 12k rows — a seq scan it
--    already prefers (0 scans on this index prove it). board_ops_tx_idx (8KB) and
--    board_state_version_updated_idx (64KB) are tiny but equally unused.
--
--    DROP not CONCURRENTLY: a migration runs in a txn, and these tables are not
--    under the kind of continuous read load where the brief ACCESS EXCLUSIVE on
--    an unused index is a problem. If that changes, split into out-of-txn
--    concurrent drops.
--
-- 2. usage_session HAS NO PRIMARY KEY (performance advisor no_primary_key). It
--    is written by the app (769 rows) and a PK is both correctness hygiene and
--    what replication/tooling expects. The existing unique expression index on
--    coalesce(...) stays as the upsert arbiter; this adds a surrogate identity.

drop index if exists public.card_index_body_trgm;
drop index if exists public.card_index_title_trgm;
drop index if exists public.doc_page_index_text_trgm;
drop index if exists public.images_ref_count_idx;
drop index if exists public.board_ops_tx_idx;
drop index if exists public.board_state_version_updated_idx;

alter table public.usage_session
  add column if not exists id bigint generated always as identity;

do $$
begin
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
    where t.relname = 'usage_session' and c.contype = 'p'
  ) then
    alter table public.usage_session add primary key (id);
  end if;
end $$;
