-- 0741 — A sign-up that starts from a shared file is filed under 'file_share'
-- (sharing insight, Phase 1 #2).
--
-- A file shared on its own (/f/<token>) is a way in, like a share link: the
-- page's Sign in and Try Clusters links carry utm_source=file_share, and its
-- sign-in links file_token too. But the channel had no arm for it, so such a
-- sign-up read as whatever brought them to the link, or 'direct', and the
-- person who shared the file got no credit for them.
--
--   1. derive_acquisition_channel v6: a first touch with a file_token, tagged
--      utm_source=file_share, or landing on /f/ itself is 'file_share', right
--      after a share link's arm (a share link still wins) and, like it, ahead
--      of whatever utm_source or referrer brought them (a paid click still
--      wins). 0708's v5, restated with that one arm added
--      (shareCaptureMigration.test.mjs holds it to that). Called on read by
--      the admin's roll-ups, never stored: no backfill, and no sign-up so far
--      changes channel.
--   2. Proof: 0708's asserts, word for word, and the new arm's.
--
-- The token itself stays where a share link's does: profiles.first_source,
-- which the sharer's credit reads. No event carries it (0474, 0707).

set local lock_timeout = '3s';

-- ── 1. The channel ───────────────────────────────────────────────────────────
create or replace function public.derive_acquisition_channel(fs jsonb)
returns text language plpgsql immutable set search_path = public as $fn$
declare
  utm_s text := lower(coalesce(nullif(fs->>'utm_source',''), ''));
  ref   text := lower(coalesce(nullif(fs->>'referrer_host',''), nullif(fs->>'referrer',''), ''));
  lp    text := lower(coalesce(nullif(fs->>'landing_path',''), ''));
  paid  boolean := lower(coalesce(fs->>'utm_medium','')) ~ '(cpc|ppc|paid|paidsocial|paid_social|paid-social|^ad$|^ads$|display|sem)';
  hw    text;
begin
  if fs is null or fs = '{}'::jsonb then return 'direct'; end if;

  -- 1) Paid click-ids win, network-specific.
  if nullif(fs->>'gclid','') is not null or nullif(fs->>'wbraid','') is not null or nullif(fs->>'gbraid','') is not null then return 'google_ads'; end if;
  if nullif(fs->>'msclkid','')   is not null then return 'bing_ads';      end if;
  if nullif(fs->>'ttclid','')    is not null then return 'tiktok_ads';    end if;
  if nullif(fs->>'twclid','')    is not null then return 'x_ads';         end if;
  if nullif(fs->>'rdt_cid','')   is not null or nullif(fs->>'rdt_uuid','') is not null then return 'reddit_ads'; end if;
  if nullif(fs->>'li_fat_id','') is not null then return 'linkedin_ads';  end if;
  if nullif(fs->>'epik','')      is not null then return 'pinterest_ads'; end if;
  if nullif(fs->>'sccid','')     is not null then return 'snapchat_ads';  end if;
  if nullif(fs->>'fbclid','')    is not null then return 'meta_paid';     end if;

  -- 2) Paid via explicit utm tagging on a known network (no click-id).
  if paid then
    if utm_s ~ '(google|adwords)'                            then return 'google_ads';    end if;
    if utm_s ~ '(bing|microsoft|msn)'                        then return 'bing_ads';      end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$|fb_|ig_)' then return 'meta_paid';     end if;
    if utm_s ~ 'tiktok'                                      then return 'tiktok_ads';    end if;
    if utm_s ~ '(twitter|^x$)'                               then return 'x_ads';         end if;
    if utm_s ~ 'reddit'                                      then return 'reddit_ads';    end if;
    if utm_s ~ 'linkedin'                                    then return 'linkedin_ads';  end if;
    if utm_s ~ 'pinterest'                                   then return 'pinterest_ads'; end if;
    if utm_s ~ 'snap'                                        then return 'snapchat_ads';  end if;
  end if;

  -- 3) Internal channels. The connect screen leads: it is the most specific
  --    thing we can know about someone who arrived there — they did not come to
  --    look at the product, they came to attach it to an assistant they use.
  if lp like '/oauth/authorize%' then return 'mcp_connect'; end if;
  -- A keep page (0708): signed up to keep what an assistant made for them.
  if lp like '/keep/%' then return 'mcp_draft'; end if;
  if nullif(fs->>'ref','')         is not null                           then return 'referral';     end if;
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  -- A shared file (0741): its page, or its sign-in links (file_token, utm_source=file_share).
  if nullif(fs->>'file_token','') is not null or utm_s = 'file_share' or lp like '/f/%' then return 'file_share'; end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source.
  if utm_s <> '' then
    -- 4a) AI assistants FIRST. ChatGPT strips its referrer on about half its
    --     clicks and appends utm_source=chatgpt.com; before this arm that fell
    --     to the verbatim fallback and never grouped with the referrer form.
    --     'meta.ai' must beat the meta_organic arm's bare 'meta' below.
    if utm_s ~ '(chatgpt|openai)'    then return 'chatgpt';    end if;
    if utm_s ~ 'perplexity'          then return 'perplexity'; end if;
    if utm_s ~ 'gemini'              then return 'gemini';     end if;
    if utm_s ~ '(claude|anthropic)'  then return 'claude';     end if;
    if utm_s ~ 'copilot'             then return 'copilot';    end if;
    if utm_s ~ '(grok|^x\.ai$)'      then return 'grok';       end if;
    if utm_s ~ '(mistral|deepseek|meta\.ai|duck\.ai|phind|you\.com|poe\.com|t3\.chat|kagi)' then return 'ai'; end if;
    if utm_s ~ '(facebook|instagram|meta|^fb$|^ig$)' then return 'meta_organic'; end if;
    if utm_s ~ 'tiktok'        then return 'tiktok';    end if;
    if utm_s ~ 'reddit'        then return 'reddit';    end if;
    if utm_s ~ '(twitter|^x$)' then return 'x';         end if;
    if utm_s ~ 'linkedin'      then return 'linkedin';  end if;
    if utm_s ~ 'pinterest'     then return 'pinterest'; end if;
    if utm_s ~ 'snap'          then return 'snapchat';  end if;
    if utm_s ~ 'youtube'       then return 'youtube';   end if;
    if utm_s ~ '(google|adwords)'     then return 'google'; end if;
    if utm_s ~ '(bing|microsoft|msn)' then return 'bing';   end if;
    return utm_s;
  end if;

  -- 5) Organic / referral by external referrer host.
  if ref <> '' then
    -- 5a) AI assistants ahead of the search engines that own their domains.
    if ref ~ '(chatgpt\.com|chat\.openai\.com|openai\.com)' then return 'chatgpt';    end if;
    if ref ~ 'perplexity'                                    then return 'perplexity'; end if;
    if ref ~ 'gemini\.google\.com'                           then return 'gemini';     end if;
    if ref ~ '(claude\.ai|claude\.com)'                      then return 'claude';     end if;
    if ref ~ 'copilot\.(microsoft\.com|cloud\.microsoft)'    then return 'copilot';    end if;
    if ref ~ '(grok\.com|(^|[.])x[.]ai($|[:/]))'             then return 'grok';       end if;
    if ref ~ '(mistral\.ai|deepseek\.com|meta\.ai|duck\.ai|kagi\.com/assistant|phind\.com|you\.com|poe\.com|t3\.chat|notebooklm\.google\.com|aistudio\.google\.com|m365\.cloud\.microsoft)' then return 'ai'; end if;
    if ref ~ '(facebook|instagram|fb[.]com|fb[.]me|l[.]facebook|lm[.]facebook)' then return 'meta_organic'; end if;
    if ref ~ 'tiktok'                                                then return 'tiktok';     end if;
    if ref ~ 'reddit'                                                then return 'reddit';     end if;
    if ref ~ '(twitter|(^|[.])t[.]co($|[:/])|(^|[.])x[.]com($|[:/]))' then return 'x';         end if;
    if ref ~ 'linkedin'                                             then return 'linkedin';   end if;
    if ref ~ 'pinterest'                                            then return 'pinterest';  end if;
    if ref ~ 'snapchat'                                             then return 'snapchat';   end if;
    if ref ~ 'youtube'                                              then return 'youtube';    end if;
    if ref ~ 'google[.]'                                            then return 'google';     end if;
    if ref ~ '(bing[.]|microsoft)'                                  then return 'bing';       end if;
    if ref ~ 'duckduckgo'                                           then return 'duckduckgo'; end if;
    if ref ~ 'yahoo'                                                then return 'yahoo';      end if;
    if ref ~ '(ecosia|baidu|yandex|brave|qwant|startpage)'          then return 'search';     end if;
    hw := split_part(regexp_replace(regexp_replace(ref, '^https?://', '', 'i'), '^www[.]', '', 'i'), '/', 1);
    hw := split_part(hw, ':', 1);
    if position('.' in hw) > 0 then
      hw := split_part(hw, '.', greatest(1, array_length(string_to_array(hw, '.'), 1) - 1));
    end if;
    return coalesce(nullif(hw, ''), 'referral');
  end if;

  return 'direct';
end;
$fn$;

-- ── 2. Proof ─────────────────────────────────────────────────────────────────
do $proof$
begin
  if (select p.provolatile from pg_proc p
       where p.oid = 'public.derive_acquisition_channel(jsonb)'::regprocedure) <> 'i' then
    raise exception '0741: derive_acquisition_channel must stay immutable';
  end if;

  -- The channel: a keep page is its own whatever brought them to it, a paid
  -- click still wins, and 0335's arms are as they were.
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token"}'::jsonb) = 'mcp_draft', 'keep page';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","utm_source":"chatgpt.com"}'::jsonb) = 'mcp_draft', 'keep page from ChatGPT';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","referrer_host":"claude.ai"}'::jsonb) = 'mcp_draft', 'keep page from Claude';
  assert public.derive_acquisition_channel('{"landing_path":"/keepsake","utm_source":"chatgpt.com"}'::jsonb) = 'chatgpt', 'only /keep/ itself';
  assert public.derive_acquisition_channel('{"landing_path":"/keep/:token","gclid":"x"}'::jsonb) = 'google_ads', 'a paid click still wins';
  assert public.derive_acquisition_channel('{"landing_path":"/oauth/authorize","utm_source":"chatgpt.com"}'::jsonb) = 'mcp_connect', 'connect screen still leads';
  assert public.derive_acquisition_channel('{"utm_source":"chatgpt.com"}'::jsonb) = 'chatgpt', 'utm chatgpt.com';
  assert public.derive_acquisition_channel('{"referrer_host":"gemini.google.com"}'::jsonb) = 'gemini', 'ref gemini beats google';
  assert public.derive_acquisition_channel('{"utm_source":"meta.ai"}'::jsonb) = 'ai', 'utm meta.ai beats meta_organic';
  assert public.derive_acquisition_channel('{}'::jsonb) = 'direct', 'empty bag';

  -- A shared file (0741): its token, its page, its own links; a share link and
  -- a paid click still win, and nothing but /f/ itself is a file.
  assert public.derive_acquisition_channel('{"file_token":"x"}'::jsonb) = 'file_share', 'a file link''s token';
  assert public.derive_acquisition_channel('{"landing_path":"/f/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}'::jsonb) = 'file_share', 'landed on a shared file';
  assert public.derive_acquisition_channel('{"utm_source":"file_share","utm_medium":"cta"}'::jsonb) = 'file_share', 'the page''s own links';
  assert public.derive_acquisition_channel('{"landing_path":"/f/x","utm_source":"chatgpt.com"}'::jsonb) = 'file_share', 'a file link from ChatGPT';
  assert public.derive_acquisition_channel('{"share_token":"x","file_token":"y"}'::jsonb) = 'share_link', 'a share link still wins';
  assert public.derive_acquisition_channel('{"landing_path":"/f/x","gclid":"x"}'::jsonb) = 'google_ads', 'a paid click still wins';
  assert public.derive_acquisition_channel('{"landing_path":"/features"}'::jsonb) = 'direct', 'only /f/ itself';
end $proof$;
