-- 0256 — treat AI-assistant citation as a measured acquisition channel.
--
-- WHY (2026-08-22, 90-day referral review): assistants are the best-converting
-- traffic on the site and nobody was watching.
--
--   class     signups  activated  rate
--   ai             11          8  72.7%   <- highest of any channel
--   social         38         26  68.4%
--   search        151         78  51.7%
--   direct        129         44  34.1%
--
-- ChatGPT cites /best/mood-board-apps (2 signups) — a page that is close to
-- dead in Google: 94 impressions, position 24.9, one click in 28 days.
-- Perplexity cites /best/pureref-alternatives (2 signups). The pattern is that
-- assistants quote the LISTICLES, and until this migration the only way to
-- learn that was to hand-write the join.
--
-- Three parts: widen the classifier, give the prober a per-expectation user
-- agent so a silent AI-crawler block becomes a failing check, and add the
-- readout.

-- 1. Classifier: same shape as before, more hosts. copilot/gemini/claude/
--    perplexity/you/phind were already covered.
create or replace function public.seo_referrer_class(p_host text)
returns text language sql immutable set search_path = public, extensions as $$
  select case
    when p_host is null or p_host = '' then 'direct'
    when p_host ~* '(chatgpt\.com|chat\.openai\.com|openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|claude\.com|you\.com|phind\.com|grok\.com|x\.ai|poe\.com|mistral\.ai|duckduckgo\.com/chat|kagi\.com/assistant|t3\.chat)' then 'ai'
    when p_host ~* '(^|\.)((google|bing|duckduckgo|ecosia|qwant|startpage|yandex)\.[a-z.]+|search\.brave\.com)$' then 'search'
    when p_host ~* '(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|reddit\.com|pinterest\.|tiktok\.com|youtube\.com|news\.ycombinator\.com)' then 'social'
    else 'referral'
  end
$$;

-- NOTE on ordering: the 'ai' arm runs BEFORE the 'search' arm on purpose.
-- duckduckgo.com/chat and kagi.com/assistant are assistant surfaces on search
-- hosts; matching them as 'search' would bury them in the largest bucket.
-- x.ai likewise has to beat the x.com social pattern.

-- 2. Per-expectation user agent for the seo-health prober. NULL keeps the
--    default UA, so every existing row behaves exactly as before.
alter table public.seo_health_expectations
  add column if not exists user_agent text;

comment on column public.seo_health_expectations.user_agent is
  'Override the prober UA for this check. Used to assert AI crawlers (GPTBot, '
  'PerplexityBot, ClaudeBot) still receive real content — Cloudflare ships '
  'default AI-crawler blocking that can be enabled at the zone level, and a '
  'silent block would otherwise cost the highest-activation channel with no signal.';

-- 3. Readout: AI referrals by source and landing page, with activation.
--    Raw numerators only (SmallN discipline, matching 0196/0250).
create or replace function public.admin_ai_referrals(p_days int default 90)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, coalesce(p_days, 90)));
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select coalesce(json_agg(to_jsonb(t) order by t.signups desc, t.ref_host), '[]'::json)
    from (
      select
        lower(pr.first_source->>'referrer_host')        as ref_host,
        coalesce(pr.first_source->>'landing_path', '/') as landing_path,
        count(*)                                        as signups,
        count(*) filter (where exists (
          select 1 from analytics_events e
          where e.user_id = pr.user_id and e.event like 'card_placed%'
        ))                                              as activated
      from profiles pr
      join auth.users au on au.id = pr.user_id
      where au.created_at >= v_since
        and seo_referrer_class(pr.first_source->>'referrer_host') = 'ai'
      group by 1, 2
    ) t
  );
end;
$$;

revoke all on function public.admin_ai_referrals(int) from public;
grant execute on function public.admin_ai_referrals(int) to authenticated;

-- ── NOT APPLIED HERE (post-promotion, per CLAUDE.md) ────────────────────────
-- The seo_health_expectations rows asserting that /best/*.md, /vs/*.md and the
-- widened llms.txt are actually being served must be inserted AFTER the build
-- carrying them reaches production, together with the build_min bump —
-- otherwise seo-health goes red for the gap between migrating and promoting.
-- See 0257_seo_health_ai_corpus.sql.
