-- 0418 — Tag embeddings come from Cloudflare Workers AI, not OpenAI.
--
-- /api/tags/embed embedded cards with OpenAI's text-embedding-3-small (1536
-- dimensions). The OpenAI credits ran out, so the tagger had not embedded
-- anything since 2026-05-24. It now uses Workers AI's @cf/baai/bge-m3 through
-- the Worker's AI binding (free within the daily allowance; 1024 dimensions;
-- multilingual), the same binding the tagger's other two steps already use.
--
-- Vectors from two models cannot be compared, so the old ones go:
--   * card_embeddings: deleted. The client's warmup re-embeds any card whose
--     content hash has no row, so they come back as each workspace is opened.
--   * tag_centroids: deleted. It is a cache of the mean of a tag's member
--     embeddings; the tagger rebuilds it from members, or seeds it from the
--     tag's name, when it is missing.
--   * pending_clusters: KEPT, centroid set to null. The centroid is written
--     but never read back (discovery dedups by member set), and the rows carry
--     which emergent clusters people already named, dismissed or rejected.
-- The HNSW indexes are dropped and rebuilt around the new size.
--
-- The thresholds the client applies to these vectors were recalibrated for
-- bge-m3 in boards/src/lib/clusterMath.js (same share of pairs at each line).

begin;

-- card_embeddings is written by the tagger as people work; give up rather than
-- queue behind a long transaction.
set local lock_timeout = '5s';

drop index if exists public.card_embeddings_hnsw;
drop index if exists public.tag_centroids_hnsw;

delete from public.card_embeddings;
delete from public.tag_centroids;
alter table public.pending_clusters alter column centroid drop not null;
update public.pending_clusters set centroid = null where centroid is not null;

alter table public.card_embeddings alter column embedding type vector(1024);
alter table public.tag_centroids
  alter column centroid type vector(1024),
  alter column last_named_centroid type vector(1024);
alter table public.pending_clusters alter column centroid type vector(1024);

create index card_embeddings_hnsw on public.card_embeddings using hnsw (embedding vector_cosine_ops);
create index tag_centroids_hnsw on public.tag_centroids using hnsw (centroid vector_cosine_ops);

do $$
declare bad text;
begin
  select string_agg(format('%s.%s is %s', c.relname, a.attname, format_type(a.atttypid, a.atttypmod)), '; ')
    into bad
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and (c.relname, a.attname) in (('card_embeddings','embedding'), ('tag_centroids','centroid'),
                                    ('tag_centroids','last_named_centroid'), ('pending_clusters','centroid'))
     and format_type(a.atttypid, a.atttypmod) <> 'vector(1024)';
  if bad is not null then raise exception '0418: %', bad; end if;
  if (select count(*) from pg_indexes where schemaname = 'public'
        and indexname in ('card_embeddings_hnsw', 'tag_centroids_hnsw')) <> 2 then
    raise exception '0418: an HNSW index is missing';
  end if;
end $$;

commit;
