-- 0888 — sign-ups that came from an email are filed under 'email', and
-- invited people with no other source under 'invite'.
--
-- derive_acquisition_channel reads profiles.first_source. Two things it got
-- wrong for people who arrive from an email:
--
--   1. A click inside a mail app carries the app as its referrer. The Gmail
--      app's (com.google.android.gm) matched the 'google[.]' search arm, so
--      those sign-ups were counted as Google search; mail.yahoo.com read as
--      Yahoo search and Outlook's app as Bing. Mail apps and webmail inboxes
--      now return 'email', the same token a utm_source=email link already
--      produces, and are tested ahead of the search arms.
--
--   2. Someone invited to a cluster or a workspace by email lands on / with
--      nothing in first_source but the landing path: the invitation emails
--      carry no utm, and the invite token in the link is not kept. They read
--      as 'direct'. first_source does not carry the invitation, and the app's
--      entry bundle has no room for the client to add it, so the server marks
--      it instead: 0889 sets first_source.invited when a referral of source
--      'collab' exists for the account. This function files a marked account
--      as 'invite' in exactly two cases: its referrer is a mail app (it came
--      from the invitation email), or it would otherwise be 'direct'.
--      Everything more specific still wins: a paid click, the connect and
--      keep pages, a personal referral code, a share link (most invited
--      people already read as 'share_link' and still do), a shared file, a
--      public cluster, any utm_source, a search engine, an assistant, another
--      site. Without 0889 the marker is never set and the arm does nothing.
--
-- Invitation links are NOT given utm_source=email: that would file invited
-- people under 'email' with the lifecycle mail.
--
-- v7: 0741's v6, restated with the declaration, the mail arm and the last
-- arm added (acquisitionInviteEmail.test.mjs holds it to that). Called on
-- read by the admin's roll-ups, never stored, so past sign-ups move as soon as
-- this is applied: mail-app arrivals from a search channel to 'email', and
-- once 0889 has marked them, invited direct arrivals to 'invite'.

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
  -- 0888: set by the server when a referral of source 'collab' exists for the
  -- account (0889): someone invited them to a cluster or a workspace.
  inv   boolean := coalesce(fs->>'invited', '') = 'true';
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
    -- 5·0) 0888: a mail app or webmail inbox is where a link in an email was
    --      clicked, not a search. Ahead of everything else here because the
    --      Gmail app's referrer (com.google.android.gm) matched 'google[.]' and
    --      was filed as Google search, mail.yahoo.com as Yahoo, and Outlook's
    --      app as Bing. An invited person who came this way came from the
    --      invitation email.
    if ref ~ '(^|//)(mail\.google\.com|com\.google\.android\.gm(\.lite)?|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|com\.microsoft\.office\.outlook|mail\.yahoo\.com|com\.yahoo\.mobile\.client\.android\.mail|mail\.proton\.me|mail\.aol\.com|mail\.zoho\.com|app\.fastmail\.com|mail\.yandex\.[a-z]+|e\.mail\.ru|mail\.qq\.com|mail\.naver\.com)($|[/:])' then
      return case when inv then 'invite' else 'email' end;
    end if;
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

  -- 6) 0888: nothing says where they came from, and someone invited them: the
  --    invitation is why they are here. Invitation emails carry no utm, and
  --    the link's own token is not kept in first_source, so these read as
  --    'direct'. Anything more specific above still wins (a share link, a
  --    search engine, an assistant, a paid click).
  if inv then return 'invite'; end if;

  return 'direct';
end;
$fn$;

-- ── 2. Proof ─────────────────────────────────────────────────────────────────
do $proof$
begin
  if (select p.provolatile from pg_proc p
       where p.oid = 'public.derive_acquisition_channel(jsonb)'::regprocedure) <> 'i' then
    raise exception '0888: derive_acquisition_channel must stay immutable';
  end if;
  -- 0311 habit: the admin roll-ups run it as their owner, and create or replace
  -- must have kept the ACL it had (0158 granted it to authenticated).
  if not has_function_privilege('authenticated', 'public.derive_acquisition_channel(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.derive_acquisition_channel(jsonb)', 'execute') then
    raise exception '0888: derive_acquisition_channel(jsonb) lost EXECUTE';
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

  -- Mail apps and webmail (0888): 'email', ahead of the search arms that used
  -- to claim them; a search or an assistant on the same company's domain is
  -- still what it was.
  assert public.derive_acquisition_channel('{"landing_path":"/","referrer_host":"com.google.android.gm"}'::jsonb) = 'email', 'the Gmail app';
  assert public.derive_acquisition_channel('{"referrer_host":"mail.google.com"}'::jsonb) = 'email', 'Gmail on the web';
  assert public.derive_acquisition_channel('{"referrer":"mail.google.com/mail/u/0/"}'::jsonb) = 'email', 'Gmail, host and path';
  assert public.derive_acquisition_channel('{"referrer_host":"outlook.live.com"}'::jsonb) = 'email', 'Outlook on the web';
  assert public.derive_acquisition_channel('{"referrer_host":"com.microsoft.office.outlook"}'::jsonb) = 'email', 'the Outlook app, not Bing';
  assert public.derive_acquisition_channel('{"referrer_host":"mail.yahoo.com"}'::jsonb) = 'email', 'Yahoo Mail, not Yahoo search';
  assert public.derive_acquisition_channel('{"referrer_host":"mail.proton.me"}'::jsonb) = 'email', 'Proton Mail';
  assert public.derive_acquisition_channel('{"utm_source":"email","utm_medium":"lifecycle"}'::jsonb) = 'email', 'a tagged email link, as before';
  assert public.derive_acquisition_channel('{"referrer_host":"www.google.com"}'::jsonb) = 'google', 'Google search is still Google';
  assert public.derive_acquisition_channel('{"referrer_host":"com.google.android.googlequicksearchbox"}'::jsonb) = 'google', 'the Google app is still Google';
  assert public.derive_acquisition_channel('{"referrer_host":"com.google.android.gms"}'::jsonb) = 'google', 'only the mail app itself';
  assert public.derive_acquisition_channel('{"referrer_host":"gemini.google.com"}'::jsonb) = 'gemini', 'Gemini is still Gemini';
  assert public.derive_acquisition_channel('{"referrer_host":"search.yahoo.com"}'::jsonb) = 'yahoo', 'Yahoo search is still Yahoo';
  assert public.derive_acquisition_channel('{"referrer_host":"www.bing.com"}'::jsonb) = 'bing', 'Bing is still Bing';
  assert public.derive_acquisition_channel('{"referrer_host":"com.reddit.frontpage"}'::jsonb) = 'reddit', 'another app is still itself';
  assert public.derive_acquisition_channel('{"utm_source":"chatgpt.com","referrer_host":"mail.google.com"}'::jsonb) = 'chatgpt', 'a utm_source still leads';

  -- Invited (0888): 'invite' from the invitation email or when nothing else
  -- is known; anything more specific still wins.
  assert public.derive_acquisition_channel('{"landing_path":"/","invited":true}'::jsonb) = 'invite', 'invited, landed on / with no source';
  assert public.derive_acquisition_channel('{"landing_path":"/vs/pureref","invited":true}'::jsonb) = 'invite', 'invited, no referrer';
  assert public.derive_acquisition_channel('{"landing_path":"/","referrer_kind":"internal","invited":true}'::jsonb) = 'invite', 'invited, internal referrer';
  assert public.derive_acquisition_channel('{"landing_path":"/","referrer_host":"com.google.android.gm","invited":true}'::jsonb) = 'invite', 'invited, from the Gmail app';
  assert public.derive_acquisition_channel('{"invited":true}'::jsonb) = 'invite', 'the marker alone';
  assert public.derive_acquisition_channel('{"landing_path":"/","invited":false}'::jsonb) = 'direct', 'not invited';
  assert public.derive_acquisition_channel('{"landing_path":"/"}'::jsonb) = 'direct', 'no marker';
  assert public.derive_acquisition_channel('{"share_token":"x","invited":true}'::jsonb) = 'share_link', 'a share link still wins';
  assert public.derive_acquisition_channel('{"ref":"ABCD","invited":true}'::jsonb) = 'referral', 'a referral code still wins';
  assert public.derive_acquisition_channel('{"referrer_host":"www.google.com","invited":true}'::jsonb) = 'google', 'a search still wins';
  assert public.derive_acquisition_channel('{"utm_source":"chatgpt.com","referrer_host":"chatgpt.com","invited":true}'::jsonb) = 'chatgpt', 'an assistant still wins';
  assert public.derive_acquisition_channel('{"utm_source":"public_board","invited":true}'::jsonb) = 'public_board', 'a public cluster still wins';
  assert public.derive_acquisition_channel('{"gclid":"x","invited":true}'::jsonb) = 'google_ads', 'a paid click still wins';
end $proof$;
