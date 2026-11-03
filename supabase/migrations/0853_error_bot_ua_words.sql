-- 0853: the server's crawler test knows every crawler the app drops.
--
-- The app no longer sends error rows from crawlers, headless browsers and
-- scripts: lib/errorNoise.js isBotUA now uses lib/device.js BOT_RE as well as
-- its old short list. Rows from builds before that, and from anything that
-- posts to the endpoint itself, still arrive, and _error_is_bot_ua is what
-- keeps them out of the breaking alerts and the error lens. It knew only the
-- old short list, so a Puppeteer, curl or AI-fetcher row still counted. It now
-- knows BOT_RE's words too (src/lib/breakingAlertsMigration.test.mjs checks
-- every one of them). Same signature, same flags, still out of clients' reach.

create or replace function public._error_is_bot_ua(p_ua text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(p_ua, '') ~* '(bot|crawl|spider|slurp|bingpreview|applebot|duckduckbot|yandex|baiduspider|facebookexternalhit|googlebot|headless|lighthouse|phantomjs|puppeteer|playwright|selenium|webdriver|scrapy|curl/|wget/|python-requests|node-fetch|axios/|go-http-client|okhttp|libwww|httrack|feedfetcher|whatsapp/|pagespeed|gtmetrix|pingdom|ahrefs|semrush|mj12|dataforseo|screaming frog|google-extended|chatgpt-user|claude-user|anthropic-ai|perplexity|mistralai-user|meta-externalfetcher|cohere-ai|meta-externalagent|sogou|ia_archiver)'
$$;
revoke all on function public._error_is_bot_ua(text) from public, anon, authenticated;

-- The 0311 habit: prove the grants, and that the new words took without
-- catching a person's browser.
do $$
begin
  if has_function_privilege('anon', 'public._error_is_bot_ua(text)', 'execute')
     or has_function_privilege('authenticated', 'public._error_is_bot_ua(text)', 'execute') then
    raise exception '0853: a client role can run _error_is_bot_ua';
  end if;
  if not public._error_is_bot_ua('Mozilla/5.0 (compatible; Googlebot/2.1)')
     or not public._error_is_bot_ua('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Puppeteer')
     or not public._error_is_bot_ua('curl/8.4.0')
     or not public._error_is_bot_ua('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0)')
     or public._error_is_bot_ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')
     or public._error_is_bot_ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1')
     or public._error_is_bot_ua(null) then
    raise exception '0853: the crawler test is wrong';
  end if;
end $$;
