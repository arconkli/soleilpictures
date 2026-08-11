-- 0225_mcp_connect_channel.sql
--
-- Teach the acquisition normalizer about the connect screen.
--
-- THE HOLE. `/oauth/authorize` is now a real front door: an assistant sends
-- someone there, they sign in — which for us IS signing up — and they approve.
-- But an MCP client opening a browser sends **no referrer and no campaign
-- tags**. A desktop client launches the URL through the OS; there is no
-- `document.referrer` at all. So every one of those signups falls through every
-- branch of derive_acquisition_channel and lands on `direct`, which is the one
-- bucket that cannot be acted on — it means "we do not know".
--
-- The consequence is precise and bad: the question "did shipping MCP bring us
-- anybody" is exactly the question the dashboard could not answer, because the
-- answer was being filed under the label reserved for not knowing.
--
-- WHY landing_path IS TRUSTWORTHY HERE. First-touch is captured ONCE per
-- session and cached in sessionStorage (lib/analytics.js), so `landing_path`
-- records the first page of the session, not the current one. If it says
-- `/oauth/authorize`, the consent screen genuinely was where this person
-- arrived — not somewhere they wandered later. Someone who came from an ad and
-- connected an assistant an hour later keeps the ad as first touch, correctly.
--
-- ORDERING. Placed with the other INTERNAL channels — after paid click-ids and
-- explicit paid utm tagging (a tagged campaign that happens to land here is
-- still that campaign), but BEFORE the organic-utm and referrer fallbacks. That
-- last part matters: a browser-based MCP client such as claude.ai DOES send a
-- referrer, and without this the row would be filed under the hostname
-- (`claude`) rather than under what actually happened.
--
-- derive_acquisition_channel is called on READ by every admin_* roll-up, never
-- stored, so this reclassifies history as well as new rows. No backfill.

create or replace function public.derive_acquisition_channel(fs jsonb)
returns text
language plpgsql
immutable
set search_path = public as $$
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

  -- 3) Internal channels.
  --
  -- The connect screen leads, because it is the most specific thing we can know
  -- about someone who arrived there: they did not come to look at the product,
  -- they came to attach it to an assistant they already use.
  if lp like '/oauth/authorize%' then return 'mcp_connect'; end if;
  if nullif(fs->>'ref','')         is not null                           then return 'referral';     end if;
  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;
  if nullif(fs->>'public_slug','') is not null or utm_s = 'public_board' then return 'public_board'; end if;

  -- 4) Organic / referral by explicit utm_source.
  if utm_s <> '' then
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
$$;
