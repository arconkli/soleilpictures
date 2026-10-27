import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AI_MODELS, CHANGELOG_FEED, TASK_OF_KIND, WATCHED_TASKS, alertFor, canaryProblem, canaryRequest,
  catalogTimeMs, dateIn, modelProblems, newModels, priceText, retiringFromFeed, silentWav,
} from './aiModels.js';
import { runAiModelDigest, runAiModelWatch } from '../worker-aiwatch.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const repo = join(here, '../../..');
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 19, 4, 0, 0);   // a Monday, 04:00 UTC
const byId = (id) => AI_MODELS.find((m) => m.id === id);
const LLAVA = '@cf/llava-hf/llava-1.5-7b-hf';
const BGE = '@cf/baai/bge-m3';
const WHISPER = '@cf/openai/whisper';

// ── The list ────────────────────────────────────────────────────────────────

function* sourceFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(p);
    else if (/\.(m?js|jsx|ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.mjs')) yield p;
  }
}

test('every model id the code calls is listed, with the files that call it', () => {
  const LITERAL = /['"`](@(?:cf|hf)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)['"`]/g;
  // Generated from the docs; an id there is prose, not a call.
  const GENERATED = /\/docsite(?:Index|Content|Crawlable)\.js$/;
  const called = {};
  for (const root of ['boards/src', 'boards/party', 'scout/src', 'mcp/src']) {
    if (!existsSync(join(repo, root))) continue;
    for (const f of sourceFiles(join(repo, root))) {
      const rel = relative(repo, f).split(sep).join('/');
      if (rel === 'boards/src/lib/aiModels.js' || GENERATED.test(rel)) continue;
      for (const [, id] of readFileSync(f, 'utf8').matchAll(LITERAL)) {
        called[id] = [...new Set([...(called[id] || []), rel])].sort();
      }
    }
  }
  const listed = Object.fromEntries(AI_MODELS.map((m) => [m.id, [...m.files].sort()]));
  assert.deepEqual(listed, called, 'AI_MODELS in aiModels.js must name every model the code calls, and where');
});

test('the list says how to test each model, and the canaries read answers the way production does', () => {
  assert.deepEqual(WATCHED_TASKS, ['Text Embeddings', 'Text Generation', 'Image-to-Text', 'Automatic Speech Recognition']);
  for (const m of AI_MODELS) {
    assert.ok(TASK_OF_KIND[m.kind], `${m.id}: unknown kind ${m.kind}`);
    assert.ok(m.uses && m.files.length, `${m.id}: say what it runs and where`);
    if (m.kind === 'embedding') assert.ok(m.dims > 0, `${m.id}: dims`);
    if (m.kind === 'speech') assert.ok(['base64', 'bytes'].includes(m.audio), `${m.id}: audio form`);
    assert.doesNotThrow(() => canaryRequest(m));
  }
  const chat = byId('@cf/meta/llama-3.2-3b-instruct');
  // Workers AI parses an all-JSON answer itself (2026-10-19); either shape passes.
  assert.equal(canaryProblem(chat, { response: { ok: true } }), null);
  assert.equal(canaryProblem(chat, { response: '```json\n{"ok": true}\n```' }), null);
  assert.match(canaryProblem(chat, { response: 'Sure! Here you go.' }), /not \{"ok": true\}/);
  assert.match(canaryProblem(chat, {}), /answered ""/);
  const bge = byId(BGE);
  assert.equal(canaryProblem(bge, { data: [new Array(1024).fill(0)] }), null);
  assert.match(canaryProblem(bge, { data: [new Array(768).fill(0)] }), /768-dim vector, not 1024/);
  assert.equal(canaryProblem(byId(LLAVA), { description: '' }), null);
  assert.match(canaryProblem(byId(LLAVA), { response: 'x' }), /no description/);
  assert.equal(canaryProblem(byId(WHISPER), { text: '' }), null);
  assert.equal(canaryProblem(byId('@cf/openai/whisper-large-v3-turbo'), { transcription_info: { text: 'Thank you.' } }), null);
  assert.match(canaryProblem(byId(WHISPER), { vtt: '' }), /no text/);
  // The two Whisper models want their audio in different forms.
  assert.equal(typeof canaryRequest(byId('@cf/openai/whisper-large-v3-turbo')).audio, 'string');
  assert.ok(Array.isArray(canaryRequest(byId(WHISPER)).audio));
  const wav = silentWav();
  assert.equal(wav.length, 44 + 16000);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.ok(canaryRequest(byId(LLAVA)).image.length > 60, 'an image llava accepts');
});

// ── The changelog ───────────────────────────────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (id) => `<code>${id}</code>`;
const h4 = (id, text) => `<div tabindex="-1" class="heading-wrapper level-h4"><h4 id="${id}">${text}</h4><a class="anchor-link" href="#${id}"><span aria-hidden="true" class="anchor-icon"></span></a></div>`;
const item = (title, slug, date, html, { cdata = false } = {}) => `<item><title>${esc(title)}</title>`
  + `<link>https://developers.cloudflare.com/changelog/post/${slug}/</link>`
  + `<guid isPermaLink="true">https://developers.cloudflare.com/changelog/post/${slug}/</guid>`
  + `<description>${cdata ? `<![CDATA[${html}]]>` : esc(html)}</description><pubDate>${date}</pubDate><category>Workers AI</category></item>`;
const feedOf = (...items) => '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
  + '<title>Cloudflare changelogs | Workers AI</title><link>https://developers.cloudflare.com/changelog/</link>'
  + items.join('') + '</channel></rss>';

// The 2026-05-08 post, as the feed carried it: the retired 8b, and the 70b the
// SEO drafts use listed as staying.
const RETIRED_0530 = [
  '@cf/moonshotai/kimi-k2.5', '@hf/meta-llama/meta-llama-3-8b-instruct', '@cf/meta/llama-3-8b-instruct',
  '@cf/meta/llama-3-8b-instruct-awq', '@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-8b-instruct-awq',
  '@cf/meta/llama-3.1-70b-instruct', '@cf/meta/llama-2-7b-chat-int8', '@cf/meta/llama-2-7b-chat-fp16',
  '@cf/mistral/mistral-7b-instruct-v0.1', '@hf/mistral/mistral-7b-instruct-v0.2', '@hf/google/gemma-7b-it',
  '@cf/google/gemma-3-12b-it', '@hf/nousresearch/hermes-2-pro-mistral-7b', '@cf/microsoft/phi-2',
  '@cf/defog/sqlcoder-7b-2', '@cf/unum/uform-gen2-qwen-500m', '@cf/facebook/bart-large-cnn',
];
const POST_0508 = item('Workers AI - Planned model deprecations on Workers AI', '2026-05-08-planned-model-deprecations', 'Fri, 08 May 2026 00:00:00 GMT', [
  '<p>We are refreshing the Workers AI model catalog to make room for newer releases. Please update your apps to remove references to the models listed below before the deprecation date.</p>',
  h4('recommended-replacements', 'Recommended replacements'),
  '<ul>',
  `<li><a href="https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/">${code('@cf/zai-org/glm-4.7-flash')}</a> — fast multilingual model with multi-turn tool calling and coding capabilities.</li>`,
  `<li><a href="https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/">${code('@cf/google/gemma-4-26b-a4b-it')}</a> — efficient open model with vision and tool calling.</li>`,
  `<li><a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/">${code('@cf/moonshotai/kimi-k2.6')}</a> — capable tool-calling and vision model for agentic workloads and coding.</li>`,
  '</ul>',
  h4('kimi-k25', 'Kimi K2.5'),
  `<p>We originally stated Kimi K2.5 would be deprecated on May 10, 2026, however we have extended the deprecation date to May 30, 2026. Requests will be automatically aliased to Kimi K2.6 on May 30, 2026, which has a higher price. Please review the <a href="https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/">${code('@cf/moonshotai/kimi-k2.6')}</a> pricing and model capabilities prior to May 30, 2026 to ensure that the model suits your needs.</p>`,
  h4('models-deprecated-on-may-30-2026', 'Models deprecated on May 30, 2026'),
  '<ul>',
  `<li>${code(RETIRED_0530[0])} --&gt; ${code('@cf/moonshotai/kimi-k2.6')}</li>`,
  ...RETIRED_0530.slice(1).map((id) => `<li>${code(id)}</li>`),
  '</ul>',
  h4('variants-that-remain-active', 'Variants that remain active'),
  `<p>The ${code('-fast')} and ${code('-lora')} variants of models will remain active, including:</p>`,
  '<ul>',
  ...['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct-fast', '@cf/google/gemma-7b-it-lora'].map((id) => `<li>${code(id)}</li>`),
  '</ul>',
].join('\n'));
// A launch post naming models in lists that retire nothing.
const LAUNCH = item('Workers AI - Moonshot AI Kimi K2.7 Code now available on Workers AI', '2026-06-12-kimi-k2-7-code', 'Fri, 12 Jun 2026 00:00:00 GMT',
  `<p>${code('@cf/moonshotai/kimi-k2.7-code')} is now available.</p>${h4('differences', 'Differences from Kimi K2.6')}`
  + `<ul><li>Faster than ${code('@cf/moonshotai/kimi-k2.6')} and ${code('@cf/meta/llama-3.2-3b-instruct')}</li></ul>`);
const FEED = feedOf(LAUNCH, POST_0508);

test('the 2026-05-08 post names exactly the models it retired, and none in use', () => {
  const { posts, retiring } = retiringFromFeed(FEED);
  assert.equal(posts, 2);
  assert.deepEqual(retiring.map((r) => r.id), RETIRED_0530, 'not the replacements, not the variants that stay');
  const r8b = retiring.find((r) => r.id === '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(r8b.when, Date.UTC(2026, 4, 30));
  assert.equal(r8b.heading, 'Models deprecated on May 30, 2026');
  assert.equal(r8b.title, 'Workers AI - Planned model deprecations on Workers AI');
  assert.equal(r8b.link, 'https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/');
  assert.equal(r8b.published, 'Fri, 08 May 2026 00:00:00 GMT');
  assert.equal(retiring[0].replacement, '@cf/moonshotai/kimi-k2.6');
  assert.equal(r8b.replacement, null);
  const inUse = new Set(AI_MODELS.map((m) => m.id));
  assert.deepEqual(retiring.filter((r) => inUse.has(r.id)), [], 'a model in use is on a retirement list already published');
});

test('a retirement is found under other headings, in tables and in CDATA, and the newest post wins', () => {
  const xml = feedOf(
    item('Workers AI - Upcoming model deprecations', '2026-12-01-upcoming', 'Tue, 01 Dec 2026 00:00:00 GMT',
      h4('affected', 'Affected models') + `<ul><li>${code('@cf/meta/llama-3.2-3b-instruct')} on December 31, 2026</li></ul>`
      + h4('alts', 'Alternatives') + `<ul><li>${code('@cf/zai-org/glm-5.3-flash')}</li></ul>`
      + `<p><strong>Deprecated:</strong></p><ul><li>${code('@cf/acme/old-one')}, use ${code('@cf/acme/new-one')} instead</li></ul>`),
    item('Workers AI - Embedding models refresh', '2026-11-20-embeddings', 'Fri, 20 Nov 2026 00:00:00 GMT',
      h4('deprecated-and-replacements', 'Deprecated models and their replacements')
      + `<table><thead><tr><th>Model</th><th>Deprecation date</th><th>Replacement</th></tr></thead><tbody>`
      + `<tr><td>${code(BGE)}</td><td>2027-01-15</td><td>${code('@cf/baai/bge-m4')}</td></tr></tbody></table>`
      + h4('replacements-for-deprecated', 'Replacements for deprecated models') + `<ul><li>${code('@cf/baai/bge-m4')}</li></ul>`),
    item('Workers AI - Retiring Whisper', '2026-11-02-whisper', 'Mon, 02 Nov 2026 00:00:00 GMT',
      `<ul><li>${code(WHISPER)} (replaced by ${code('@cf/openai/whisper-large-v3-turbo')})</li>`
      + `<li>${code('@cf/meta/llama-3.2-3b-instruct')} on 30 June 2026</li></ul>`, { cdata: true }),
  );
  const got = Object.fromEntries(retiringFromFeed(xml).retiring.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(got).sort(), [BGE, '@cf/acme/old-one', '@cf/meta/llama-3.2-3b-instruct', WHISPER].sort());
  assert.equal(got['@cf/meta/llama-3.2-3b-instruct'].when, Date.UTC(2026, 11, 31), 'the newest post wins');
  assert.equal(got['@cf/meta/llama-3.2-3b-instruct'].heading, 'Affected models');
  assert.equal(got['@cf/acme/old-one'].replacement, '@cf/acme/new-one');
  assert.equal(got[BGE].when, Date.UTC(2027, 0, 15));
  assert.equal(got[BGE].replacement, '@cf/baai/bge-m4');
  assert.equal(got[WHISPER].replacement, '@cf/openai/whisper-large-v3-turbo');
  assert.equal(got[WHISPER].when, null);
  assert.equal(dateIn('on 30 June 2026'), Date.UTC(2026, 5, 30));
  assert.equal(dateIn('Sept. 3rd, 2026'), Date.UTC(2026, 8, 3));
  assert.equal(dateIn('no date here'), null);
  assert.deepEqual(retiringFromFeed('<html>moved</html>'), { posts: 0, retiring: [] });
});

// ── The catalog ─────────────────────────────────────────────────────────────

const PRICE = { property_id: 'price', value: [
  { unit: 'per M input tokens', price: 0.0509, currency: 'USD' },
  { unit: 'per M output tokens', price: 0.335, currency: 'USD' },
] };
const CATALOG = [
  { name: '@cf/acme/new-chat', task: { name: 'Text Generation' }, created_at: '2026-10-13 09:00:00.000', description: 'A new chat model.', properties: [PRICE] },
  { name: '@cf/acme/new-image', task: { name: 'Text-to-Image' }, created_at: '2026-10-14 09:00:00.000' },
  { name: '@cf/acme/old-chat', task: { name: 'Text Generation' }, created_at: '2026-10-01 09:00:00.000' },
  { name: '@cf/acme/new-embed', task: { name: 'Text Embeddings' }, created_at: '2026-10-18 23:59:59.999' },
  { name: '@cf/acme/undated', task: { name: 'Text Generation' } },
];

test("new models are the week's additions in the tasks the app uses, newest first", () => {
  assert.equal(catalogTimeMs('2025-08-04 10:08:04.219'), Date.UTC(2025, 7, 4, 10, 8, 4, 219), 'UTC, though it says no zone');
  assert.equal(catalogTimeMs('2026-10-13'), Date.UTC(2026, 9, 13));
  assert.ok(Number.isNaN(catalogTimeMs(undefined)));
  assert.deepEqual(newModels(CATALOG, NOW - 7 * DAY).map((m) => m.name), ['@cf/acme/new-embed', '@cf/acme/new-chat']);
  assert.equal(priceText(CATALOG[0]), '$0.0509 per M input tokens, $0.335 per M output tokens');
  assert.equal(priceText(CATALOG[1]), '');
});

// ── The alerts ──────────────────────────────────────────────────────────────

test('one alert per model, worst problem first, daily only when it is urgent', () => {
  const r3b = '@cf/meta/llama-3.2-3b-instruct';
  const r70b = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const notice = (id, when) => ({ id, when, replacement: null, heading: 'Models deprecated', title: 'Workers AI - Deprecations', link: 'https://x.test/post', published: 'Mon, 19 Oct 2026' });
  const problems = modelProblems({
    catalogNames: new Set(AI_MODELS.map((m) => m.id).filter((id) => id !== r3b)),
    canaries: { [r3b]: { error: '5028: retired', attempts: 3 }, [r70b]: { error: null, ms: 900, attempts: 1 } },
    retiring: [notice(r70b, NOW + 30 * DAY), notice(r3b, NOW - DAY)],
  });
  assert.deepEqual(problems.map((p) => [p.type, p.model.id]), [['gone', r3b], ['retiring', r70b]]);

  const gone = alertFor(problems[0], NOW);
  assert.equal(gone.key, `ai_model:gone:${r3b}`);
  assert.equal(gone.title, `Workers AI no longer lists ${r3b}`);
  assert.equal(gone.window, '20 hours', 'broken: every morning');
  assert.match(gone.body, /A test request failed 3 times: 5028: retired/);
  assert.match(gone.body, /change the id in boards\/src\/worker-ai\.js, then/);

  const soon = alertFor(problems[1], NOW);
  assert.equal(soon.title, `Workers AI retires ${r70b} on 2026-11-18`);
  assert.equal(soon.window, '6 days', 'a month out: weekly');
  assert.match(soon.body, /30 days from now/);
  assert.match(soon.body, /https:\/\/x\.test\/post/);
  assert.equal(alertFor({ ...problems[1], notice: notice(r70b, NOW + 5 * DAY) }, NOW).window, '20 hours', 'the last week: daily');

  // A source the watch couldn't read says nothing about the models.
  assert.deepEqual(modelProblems({ catalogNames: null, canaries: {}, retiring: null }), []);
  assert.deepEqual(modelProblems({ canaries: { [BGE]: { error: 'x', attempts: 3 } } }).map((p) => p.type), ['failing']);
});

// ── The watch, against a stand-in Workers AI, feed and Supabase ─────────────

function answers(overrides = {}) {
  return async (id, input) => {
    if (overrides[id]) return overrides[id](input);
    const m = byId(id);
    switch (m?.kind) {
      case 'chat': return { response: { ok: true } };
      case 'embedding': return { data: [new Array(m.dims).fill(0.03)], shape: [1, m.dims] };
      case 'vision': return { description: ' A small red square.' };
      case 'speech': return m.audio === 'base64' ? { text: 'Thank you.', transcription_info: { language: 'en' } } : { text: '', vtt: 'WEBVTT' };
      default: throw new Error(`5007: No such model ${id}`);
    }
  };
}
const catalogOf = (ids) => ids.map((name) => ({ name, task: { name: TASK_OF_KIND[byId(name)?.kind] }, created_at: '2025-01-01 00:00:00.000' }));

async function watch({ catalog = catalogOf(AI_MODELS.map((m) => m.id)), feed = FEED, feedStatus = 200, run = answers(), alertId = 1, digest = false } = {}) {
  const raised = [];
  const calls = [];
  const env = {
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'svc',
    AI: {
      models: async ({ page }) => { if (catalog instanceof Error) throw catalog; return page === 1 ? catalog : []; },
      run: async (id, input) => { calls.push(id); return run(id, input); },
    },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url === CHANGELOG_FEED) return new Response(feed, { status: feedStatus });
    if (url === 'https://sb.test/rest/v1/rpc/ops_alert_raise') {
      assert.equal(init.headers.authorization, 'Bearer svc');
      raised.push(JSON.parse(init.body));
      return new Response(JSON.stringify(alertId));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const out = digest ? await runAiModelDigest(env, { now: NOW })
      : await runAiModelWatch(env, { wait: async () => {}, now: NOW });
    return { out, raised, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a healthy morning tests every model and pages nobody', async () => {
  const { out, raised, calls } = await watch();
  assert.deepEqual(raised, []);
  assert.deepEqual(out.problems, []);
  assert.equal(out.catalog, AI_MODELS.length);
  assert.equal(out.posts, 2);
  assert.deepEqual([...new Set(calls)].sort(), AI_MODELS.map((m) => m.id).sort());
  assert.ok(Object.values(out.canaries).every((c) => c.error === null && c.attempts === 1));
});

test('a retired model is one page, and so is one the changelog names', async () => {
  const soon = item('Workers AI - Retiring Whisper', '2026-10-15-whisper', 'Thu, 15 Oct 2026 00:00:00 GMT',
    h4('models', 'Models deprecated on October 22, 2026') + `<ul><li>${code(WHISPER)}</li></ul>`);
  const { out, raised, calls } = await watch({
    catalog: catalogOf(AI_MODELS.map((m) => m.id).filter((id) => id !== LLAVA)),
    feed: feedOf(soon, LAUNCH, POST_0508),
    run: answers({ [LLAVA]: async () => { throw new Error('5028: This model has been deprecated'); } }),
  });
  assert.deepEqual(raised.map((r) => [r.p_dedupe_key, r.p_dedupe_window]), [
    [`ai_model:gone:${LLAVA}`, '20 hours'],
    [`ai_model:retiring:${WHISPER}`, '20 hours'],
  ]);
  assert.ok(raised.every((r) => r.p_kind === 'ai_models' && r.p_page === true));
  assert.match(raised[0].p_body, /admin alt text/);
  assert.match(raised[0].p_body, /failed 3 times: 5028/);
  assert.equal(raised[1].p_title, `Workers AI retires ${WHISPER} on 2026-10-22`);
  assert.equal(calls.filter((id) => id === LLAVA).length, 3, 'tried three times before paging');
  assert.equal(out.sent, 2);
  // Already sent inside its window: PostgREST answers null, and nothing counts as sent.
  assert.equal((await watch({ catalog: catalogOf(AI_MODELS.map((m) => m.id).filter((id) => id !== LLAVA)), alertId: null })).out.sent, 0);
});

test('a passing blip is retried, not paged', async () => {
  let tries = 0;
  const { raised, out } = await watch({
    run: answers({ [BGE]: async () => { if (++tries === 1) throw new Error('3040: Capacity temporarily exceeded'); return { data: [new Array(1024).fill(0)] }; } }),
  });
  assert.deepEqual(raised, []);
  assert.equal(out.canaries[BGE].attempts, 2);
});

test('the watch says so when it cannot see, instead of reporting all clear', async () => {
  const blind = await watch({ catalog: new Error('binding down') });
  assert.deepEqual(blind.raised.map((r) => r.p_dedupe_key), ['ai_model:watch:catalog'], 'no model reported gone on an unread catalog');
  assert.equal(blind.out.catalog, null);
  assert.deepEqual((await watch({ feedStatus: 503 })).raised.map((r) => r.p_dedupe_key), ['ai_model:watch:feed']);
  const moved = await watch({ feed: '<html>This page has moved</html>' });
  assert.deepEqual(moved.raised.map((r) => [r.p_dedupe_key, r.p_dedupe_window]), [['ai_model:watch:feed', '6 days']]);
  assert.match(moved.raised[0].p_body, /changed shape/);
});

test("the Sunday digest lists the week's new models in one email, and stays quiet without any", async () => {
  const { out, raised } = await watch({ catalog: CATALOG, digest: true });
  assert.deepEqual(out.fresh, ['@cf/acme/new-embed', '@cf/acme/new-chat']);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].p_dedupe_key, 'ai_model:new');
  assert.equal(raised[0].p_title, '2 new models on Workers AI this week');
  assert.match(raised[0].p_body, /- @cf\/acme\/new-chat: Text Generation, added 2026-10-13, \$0\.0509 per M input tokens/);
  assert.doesNotMatch(raised[0].p_body, /new-image|old-chat/);
  assert.match(raised[0].p_body, /In use now:\n- @cf\/baai\/bge-m3/);
  const quiet = await watch({ catalog: catalogOf(AI_MODELS.map((m) => m.id)), digest: true });
  assert.deepEqual(quiet.raised, []);
  assert.equal(quiet.out.alert, null);
  // A busy week still fits ops_alert_raise's 4000 characters, footer included.
  const flood = Array.from({ length: 30 }, (_, i) => ({
    name: `@cf/some-long-vendor-name/an-unusually-long-model-name-${i}-instruct-fp8-fast`, task: { name: 'Text Generation' },
    created_at: '2026-10-18 12:00:00.000', description: 'Words '.repeat(80), properties: [PRICE, { property_id: 'context_window', value: '131072' }],
  }));
  const busy = (await watch({ catalog: flood, digest: true })).raised[0];
  assert.ok(busy.p_body.length < 4000, `${busy.p_body.length} chars`);
  assert.match(busy.p_body, /- and 22 more\n/);
  assert.match(busy.p_body, /The catalog: https:\/\/developers\.cloudflare\.com\/workers-ai\/models\/$/);
});

test('the crons run the watch every morning and the digest on Sundays', () => {
  const worker = read('../worker.js');
  const branch = (cron) => {
    const at = worker.indexOf(`which === '${cron}'`);
    assert.ok(at > 0, cron);
    return worker.slice(at, worker.indexOf('} else', at + 1));
  };
  // Watched (serverErrors.js): a failure that escapes either is recorded.
  assert.match(branch('0 4 * * *'), /ctx\.waitUntil\(watch\('ai_watch', runAiModelWatch\(env\)\)\);/);
  assert.match(branch('0 6 * * 1'), /ctx\.waitUntil\(watch\('ai_digest', runAiModelDigest\(env\)\)\);/);
  const crons = JSON.parse(read('../../wrangler.toml').match(/^crons = (\[.*\])$/m)[1]);
  assert.ok(crons.includes('0 4 * * *') && crons.includes('0 6 * * 1'));
});
