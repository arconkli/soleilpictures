-- 0879 — Search in any language: accents and width are ignored (2026-11-09).
--
-- public.search_fold(text) folds text the way lib/textFold.js foldForSearch
-- does, character for character: NFKD; keep the breve on и/у (й and ў are
-- their own letters); drop combining marks (Latin and the other diacritic
-- blocks, Hebrew points, Arabic harakat); NFC; map ł ø đ ħ ı ð and ß æ œ þ.
-- Case is left to ILIKE. Kana voicing marks, Hangul, Indic and Thai marks stay.
--
-- card_index.fold and doc_page_index.fold hold the folded text, stored, and
-- only where the fold changes something (NULL otherwise, so English cards cost
-- nothing). entity_search gains a trailing `fold` column. Search ORs
-- fold.ilike with the raw terms; the raw terms stay because fold is NULL for
-- unchanged rows.
--
-- search_fold is NOT a `_` helper and is NOT revoked from signed-in users: a
-- stored generated column's expression runs with the WRITER's privileges, so
-- every card_index write by a signed-in user calls it. Revoking it would
-- break every card save. It is a pure text function and reads no data.
--
-- entity_search is a view (security_invoker, 0595), so create or replace with
-- the new column last keeps its options and grants (authenticated only).
-- Every branch is restated exactly as 0595 wrote it.
--
-- Ship: this migration first, then the app. The app retries without `fold`
-- on error 42703, so the other order only costs accent-blind search.

begin;
set local lock_timeout = '3s';

create or replace function public.search_fold(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(
    translate(
      normalize(
        replace(
          regexp_replace(
            regexp_replace(
              normalize(t, NFKD),
              E'([иИуУ])\u0306', E'\\1\uE000', 'g'),
            E'[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u064B-\u065F\u0670]',
            '', 'g'),
          E'\uE000', E'\u0306'),
        NFC),
      'łŁøØđĐħĦıðÐ', 'lLoOdDhHidD'),
    'ß', 'ss'), 'ẞ', 'SS'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'þ', 'th'), 'Þ', 'TH')
$$;

comment on function public.search_fold(text) is
  '0879: the search fold (accents, Hebrew points, Arabic harakat dropped; ł ø đ ħ ı ð ß æ œ þ mapped). Mirrors boards/src/lib/textFold.js. Not a _ helper: card_index.fold is generated from it, so signed-in writers call it.';

revoke execute on function public.search_fold(text) from public;
grant execute on function public.search_fold(text) to anon, authenticated, service_role;

-- ── card_index.fold ─────────────────────────────────────────────────────────

alter table public.card_index
  add column if not exists fold text generated always as (
    nullif(
      public.search_fold(coalesce(title, '') || E'\n' || coalesce(body, '') || E'\n' || coalesce(meta->>'fileName', '')),
      coalesce(title, '') || E'\n' || coalesce(body, '') || E'\n' || coalesce(meta->>'fileName', '')
    )
  ) stored;

-- ── doc_page_index.fold ─────────────────────────────────────────────────────

alter table public.doc_page_index
  add column if not exists fold text generated always as (
    nullif(
      public.search_fold(coalesce(page_title, '') || E'\n' || coalesce(page_text, '')),
      coalesce(page_title, '') || E'\n' || coalesce(page_text, '')
    )
  ) stored;

-- ── entity_search: 0595 restated, `fold` appended ───────────────────────────

create or replace view public.entity_search with (security_invoker = on) as
 SELECT b.id::text AS id,
    'board'::text AS kind,
    b.workspace_id,
    b.id AS board_id,
    NULL::text AS card_id,
    b.name AS title,
    b.meta AS body,
    NULL::jsonb AS meta,
    b.updated_at,
    NULL::text AS seen,
    nullif(public.search_fold(b.name), b.name) AS fold
   FROM boards b
  WHERE b.deleted_at IS NULL
UNION ALL
 SELECT (ci.board_id::text || ':'::text) || ci.card_id AS id,
    ci.kind,
    ci.workspace_id,
    ci.board_id,
    ci.card_id,
    ci.title,
    ci.body,
    ci.meta,
    ci.updated_at,
    (SELECT CASE WHEN d.description IS NOT NULL THEN
              concat_ws(' ', d.description,
                NULLIF(array_to_string(d.keywords, ', '), ''),
                NULLIF(concat_ws(', ', d.attrs ->> 'medium', d.attrs ->> 'shot_type', d.attrs ->> 'lighting',
                  CASE WHEN jsonb_typeof(d.attrs -> 'palette') = 'array'
                       THEN NULLIF((SELECT string_agg(p.v, ', ') FROM jsonb_array_elements_text(d.attrs -> 'palette') p(v)), '') END,
                  d.attrs ->> 'era', d.attrs ->> 'location', d.attrs ->> 'text_in_image'), ''))
            END
       FROM images i JOIN image_descriptions d ON d.image_id = i.id
      WHERE ci.kind = 'image' AND (ci.meta ->> 'src') LIKE 'r2:%'
        AND i.storage_path = substr(ci.meta ->> 'src', 4) AND i.deleted_at IS NULL) AS seen,
    ci.fold
   FROM card_index ci
  WHERE NOT EXISTS (SELECT 1 FROM boards tb WHERE tb.id = ci.board_id AND tb.deleted_at IS NOT NULL)
UNION ALL
 SELECT (gi.board_id::text || ':g:'::text) || gi.group_id AS id,
    'group'::text AS kind,
    gi.workspace_id,
    gi.board_id,
    gi.group_id AS card_id,
    gi.name AS title,
    NULL::text AS body,
    jsonb_build_object('memberCount', gi.member_count, 'outline', gi.outline, 'color', gi.color) AS meta,
    gi.updated_at,
    NULL::text AS seen,
    nullif(public.search_fold(gi.name), gi.name) AS fold
   FROM group_index gi
  WHERE NOT EXISTS (SELECT 1 FROM boards tb WHERE tb.id = gi.board_id AND tb.deleted_at IS NOT NULL)
UNION ALL
 SELECT d.user_id::text AS id,
    'user'::text AS kind,
    d.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    d.title,
    d.email AS body,
    NULL::jsonb AS meta,
    GREATEST(d.created_at, now()) AS updated_at,
    NULL::text AS seen,
    nullif(public.search_fold(d.title), d.title) AS fold
   FROM workspace_user_directory() d(user_id, workspace_id, title, email, created_at)
UNION ALL
 SELECT t.id::text AS id,
    'tag'::text AS kind,
    t.workspace_id,
    NULL::uuid AS board_id,
    NULL::text AS card_id,
    t.name AS title,
    NULL::text AS body,
    jsonb_build_object('color', t.color, 'createdKind', t.kind) AS meta,
    t.created_at AS updated_at,
    NULL::text AS seen,
    nullif(public.search_fold(t.name), t.name) AS fold
   FROM tags t
  WHERE COALESCE(t.status, 'active'::text) <> 'deleted'::text;

-- ── Proof: grants, view options, and every fixture pair ─────────────────────
-- The pairs between the markers are read by boards/src/lib/textFold.test.mjs,
-- which runs the JS fold over the same list. One pair per line.

do $proof$
declare
  r record;
begin
  if not has_function_privilege('anon', 'public.search_fold(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.search_fold(text)', 'execute')
     or not has_function_privilege('service_role', 'public.search_fold(text)', 'execute') then
    raise exception '0879: search_fold is not open to anon, authenticated and service_role';
  end if;
  if not has_table_privilege('authenticated', 'public.entity_search', 'select') then
    raise exception '0879: signed-in search lost its grant';
  end if;
  if has_table_privilege('anon', 'public.entity_search', 'select') then
    raise exception '0879: anon can read entity_search';
  end if;
  if not coalesce((select 'security_invoker=on' = any(reloptions) or 'security_invoker=true' = any(reloptions)
                     from pg_class where oid = 'public.entity_search'::regclass), false) then
    raise exception '0879: entity_search lost security_invoker';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.entity_search'::regclass
                   and attname = 'fold' and attnum = (select max(attnum) from pg_attribute
                     where attrelid = 'public.entity_search'::regclass and not attisdropped)) then
    raise exception '0879: entity_search has no trailing fold column';
  end if;

  for r in
    select * from (values
      -- fold-fixtures:start
      ('Café', 'Cafe'),
      ('café', 'cafe'),
      ('Café', 'Cafe'),
      ('Łódź', 'Lodz'),
      ('Straße', 'Strasse'),
      ('İstanbul', 'Istanbul'),
      ('Ærø', 'AEro'),
      ('crème brûlée', 'creme brulee'),
      ('Ğ', 'G'),
      ('ñ', 'n'),
      ('ｶﾞ', 'ガ'),
      ('が', 'が'),
      ('한국', '한국'),
      ('й', 'й'),
      ('Й', 'Й'),
      ('й', 'й'),
      ('ў', 'ў'),
      ('ё', 'е'),
      ('עִבְרִית', 'עברית'),
      ('مَرْحَبًا', 'مرحبا'),
      ('Œuvre', 'OEuvre'),
      ('þorn', 'thorn'),
      ('東京', '東京'),
      ('नमस्ते', 'नमस्ते'),
      ('ไทย', 'ไทย'),
      ('ﬁ', 'fi'),
      ('①', '1'),
      ('ẞ', 'SS'),
      ('đạo Ħal ıi ð', 'dao Hal ii d')
      -- fold-fixtures:end
    ) as v(input, expected)
  loop
    if public.search_fold(r.input) is distinct from r.expected then
      raise exception '0879: search_fold(%) = %, expected %', r.input, public.search_fold(r.input), r.expected;
    end if;
  end loop;
end $proof$;

commit;
