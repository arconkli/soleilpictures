// The Workers AI model watch, daily at 04:00 UTC, and its new-models digest,
// Sundays at 06:00 UTC (worker.js scheduled()). It reads the catalog through
// the AI binding, the Workers AI changelog feed, and the models' answers to a
// tiny request, then pages the owner through ops_alert_raise (0369), which
// emails a paged alert within a minute. What counts as a problem, and what
// the email says, is decided in lib/aiModels.js; this file only does the I/O.

import {
  AI_MODELS, CHANGELOG_FEED, WATCHED_TASKS, alertFor, canaryProblem, canaryRequest,
  digestAlert, modelProblems, newModels, retiringFromFeed, watchAlert,
} from './lib/aiModels.js';
import { jobFailed } from './lib/workerErrors.js';

const DAY = 86_400_000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Every page until an empty one. A short read would make models look
// retired, so the loop never trusts a page size to mean the end.
async function readCatalog(env) {
  const byName = new Map();
  for (let page = 1; page <= 10; page++) {
    const list = await env.AI.models({ per_page: 1000, page });
    if (!Array.isArray(list)) throw new Error(`the catalog answered ${typeof list}`);
    if (!list.length) break;
    for (const m of list) if (m?.name) byName.set(m.name, m);
  }
  if (!byName.size) throw new Error('the catalog was empty');
  return [...byName.values()];
}

async function readFeed() {
  const res = await fetch(CHANGELOG_FEED, {
    headers: { accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`the feed answered ${res.status}`);
  const feed = retiringFromFeed(await res.text());
  if (!feed.posts) throw new Error('the feed had no posts; it may have moved or changed shape');
  return feed;
}

// Three tries, 2 s and then 8 s apart, so a passing capacity blip is not a page.
async function runCanary(env, model, wait) {
  let error = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    try {
      error = canaryProblem(model, await env.AI.run(model.id, canaryRequest(model)));
    } catch (e) {
      error = String(e?.message || e).slice(0, 300);
    }
    if (!error) return { error: null, ms: Date.now() - t0, attempts: attempt };
    if (attempt < 3) await wait(attempt === 1 ? 2_000 : 8_000);
  }
  return { error, attempts: 3 };
}

// True when the alert went out; false when the same alert already went out
// inside its window, or it couldn't be raised (logged, so the tail shows it).
async function raise(env, alert) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[ai-watch] no service role, so not raised:', alert.title);
    return false;
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ops_alert_raise`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        p_kind: 'ai_models', p_title: alert.title, p_body: alert.body, p_page: true,
        p_dedupe_key: alert.key, p_dedupe_window: alert.window,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.json()) != null;
  } catch (e) {
    console.error('[ai-watch] could not raise', alert.key, '-', alert.title, '-', e?.message || e);
    await jobFailed(env, 'ai_watch', e, 'raise');
    return false;
  }
}

export async function runAiModelWatch(env, { models = AI_MODELS, wait = pause, now = Date.now() } = {}) {
  if (!env?.AI) {
    console.log('[ai-watch] skipped: no AI binding');
    return null;
  }
  try {
    const alerts = [];
    let catalog = null;
    let feed = null;
    try { catalog = await readCatalog(env); } catch (e) { alerts.push(watchAlert('catalog', e)); }
    try { feed = await readFeed(); } catch (e) { alerts.push(watchAlert('feed', e)); }
    // One at a time: nothing waits on this, and it keeps the burst small.
    const canaries = {};
    for (const m of models) canaries[m.id] = await runCanary(env, m, wait);
    const problems = modelProblems({
      models, canaries,
      catalogNames: catalog && new Set(catalog.map((m) => m.name)),
      retiring: feed?.retiring ?? null,
    });
    alerts.push(...problems.map((p) => alertFor(p, now)));
    let sent = 0;
    for (const a of alerts) if (await raise(env, a)) sent++;
    const answered = models.filter((m) => !canaries[m.id].error).length;
    console.log(`[ai-watch] ${answered}/${models.length} models answered; catalog ${catalog ? catalog.length + ' models' : 'unread'}; changelog ${feed ? feed.posts + ' posts' : 'unread'}; `
      + `${problems.length ? problems.map((p) => `${p.type} ${p.model.id}`).join(', ') : 'no problems'}; ${sent} of ${alerts.length} alerts sent`);
    return { catalog: catalog?.length ?? null, posts: feed?.posts ?? null, canaries, problems, alerts, sent };
  } catch (e) {
    console.error('[ai-watch] failed:', e?.message || e);
    await jobFailed(env, 'ai_watch', e);
    await raise(env, watchAlert('run', e));
    return null;
  }
}

export async function runAiModelDigest(env, { now = Date.now() } = {}) {
  if (!env?.AI) {
    console.log('[ai-watch] digest skipped: no AI binding');
    return null;
  }
  try {
    const fresh = newModels(await readCatalog(env), now - 7 * DAY);
    const alert = digestAlert(fresh);
    const sent = alert ? await raise(env, alert) : false;
    console.log(`[ai-watch] digest: ${fresh.length} new in ${WATCHED_TASKS.join(', ')}${fresh.length ? ' (' + fresh.map((m) => m.name).join(', ') + ')' : ''}; ${sent ? 'sent' : 'nothing sent'}`);
    return { fresh: fresh.map((m) => m.name), alert, sent };
  } catch (e) {
    // The daily watch already pages when the catalog can't be read.
    console.error('[ai-watch] digest failed:', e?.message || e);
    await jobFailed(env, 'ai_digest', e);
    return null;
  }
}
