// worker-aeo.js — the AEO retrieval probe.
//
// Asks an assistant the questions a buyer would ask and records whether our
// domain comes back. This is the check the rest of the AEO stack cannot make:
// seo-health proves a crawler CAN read a page, crawler_hits proves one DID, and
// neither can fail in the way that actually costs us — perfectly crawlable,
// dutifully crawled, never mentioned.
//
// Schema and the honest caveats live in migration 0296. The one that matters
// here: the Responses API's web_search tool is a PROXY for consumer ChatGPT,
// not the same retrieval stack. Runs are comparable to other runs of the same
// provider and model, and to nothing else. The model is recorded per run for
// exactly this reason — when it changes, the series restarts.
//
// Weekly, because retrieval moves on the timescale of index refreshes. Daily
// would mostly sample the run-to-run variance in assistant answers and read it
// as movement.

// Everything under this host counts as us. The apex is included because a
// citation of the marketing site is still retrieval of the brand.
const OUR_HOSTS = ['clusters.soleilpictures.com', 'soleilpictures.com'];

const OPENAI_URL = 'https://api.openai.com/v1/responses';

// The cost-efficient tier on purpose, not the flagship. What we are measuring
// is whether the web_search stack surfaces our domain, and the source list
// comes from that stack rather than from the model's reasoning — paying 50x for
// a better writer would not make the citation list more accurate. Weekly over
// eight questions costs cents.
//
// Overridable via `wrangler secret put AEO_PROBE_MODEL` without a deploy. Doing
// so RESTARTS THE SERIES: the model is recorded per run precisely because runs
// are only comparable within one. If a model name goes stale the run records
// the API's own error per question rather than silently reporting zero
// citations — a probe that failed closed would look exactly like being dropped
// from every answer.
const DEFAULT_MODEL = 'gpt-5.6-luna';

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase(); } catch (_) { return ''; }
}

function isOurs(u) {
  const h = hostOf(u);
  return OUR_HOSTS.some((ours) => h === ours || h.endsWith('.' + ours));
}

// Pull the answer text and the ordered, de-duplicated citation list out of a
// Responses payload. Exported for unit tests — this parse is the whole
// measurement, so it is tested against real response shapes rather than trusted.
export function readRetrieval(payload) {
  const out = { text: '', sources: [] };
  const seen = new Set();
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string') out.text += part.text;
      for (const a of part?.annotations || []) {
        if (a?.type !== 'url_citation' || !a?.url || seen.has(a.url)) continue;
        seen.add(a.url);
        out.sources.push({ url: a.url, title: String(a.title || '').slice(0, 200) });
      }
    }
  }
  return out;
}

// → { cited, position, sources, excerpt }
// position is the 1-based rank of our first citation among the sources the
// assistant actually returned, so "cited at 1" and "cited at 9" stay distinct.
export function scoreRetrieval(payload) {
  const { text, sources } = readRetrieval(payload);
  const idx = sources.findIndex((s) => isOurs(s.url));
  return {
    cited: idx > -1,
    position: idx > -1 ? idx + 1 : null,
    sources: sources.slice(0, 25),
    excerpt: text.slice(0, 2000),
  };
}

async function askOnce(env, question, model, signal) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, input: question, tools: [{ type: 'web_search' }] }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`openai ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

export async function runAeoRetrievalProbe(env) {
  if (!env?.OPENAI_API_KEY) {
    console.log('[aeo-probe] skipped: OPENAI_API_KEY not set');
    return;
  }
  if (!env?.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('[aeo-probe] skipped: SUPABASE_SERVICE_ROLE_KEY not set');
    return;
  }
  const model = env.AEO_PROBE_MODEL || DEFAULT_MODEL;

  const sbHeaders = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
  };

  let questions = [];
  try {
    const qRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/aeo_probe_questions?enabled=eq.true&select=id,question&order=id`,
      { headers: sbHeaders, signal: AbortSignal.timeout(15_000) },
    );
    if (!qRes.ok) throw new Error(`questions ${qRes.status}`);
    questions = await qRes.json();
  } catch (err) {
    console.error('[aeo-probe] could not load questions:', err?.message || err);
    return;
  }
  if (!questions.length) {
    console.log('[aeo-probe] no enabled questions');
    return;
  }

  // Sequential on purpose. Eight web-grounded calls in parallel is a burst
  // against a rate limit for no benefit — nothing is waiting on this.
  const results = [];
  for (const q of questions) {
    const startedAt = Date.now();
    try {
      const payload = await askOnce(env, q.question, model, AbortSignal.timeout(90_000));
      results.push({
        question_id: q.id,
        question: q.question,
        ms: Date.now() - startedAt,
        ...scoreRetrieval(payload),
      });
    } catch (err) {
      // One bad question must not lose the other seven: a partial sweep is
      // still a data point, and `failed` is recorded alongside `cited` so a
      // run that mostly errored can never be read as a citation collapse.
      results.push({
        question_id: q.id,
        question: q.question,
        cited: false,
        ms: Date.now() - startedAt,
        error: String(err?.message || err).slice(0, 500),
      });
    }
  }

  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_aeo_retrieval`, {
      method: 'POST',
      headers: sbHeaders,
      body: JSON.stringify({ p_provider: 'openai', p_model: model, p_results: results }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`record ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  } catch (err) {
    console.error('[aeo-probe] could not record run:', err?.message || err);
    return;
  }

  const cited = results.filter((r) => r.cited).length;
  const failed = results.filter((r) => r.error).length;
  console.log(`[aeo-probe] ${model}: ${cited}/${results.length} cited, ${failed} failed`);
}
