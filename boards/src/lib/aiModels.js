// Every Workers AI model the app calls, and the decisions of the watch that
// notices when one needs replacing. worker-aiwatch.js does the fetching, from
// the 04:00 UTC cron; everything it decides is here, so node --test covers it.
//
// Why it exists: on 2026-05-08 Cloudflare's Workers AI changelog said
// @cf/meta/llama-3.1-8b-instruct would be retired on 05-30. Nothing here read
// the changelog, so doc word-tagging failed every call for the next five
// months (error 5028) and nobody noticed. The watch pages the owner when a
// model below
//   - is listed under a deprecation heading in that changelog,
//   - has left the catalog: retired ids vanish from it, and Cloudflare retires
//     some by aliasing them to a different, pricier model, so calls go on
//     working and only the catalog shows it,
//   - or fails a tiny known request, read the way production reads it.
// On Sundays it also lists the models Cloudflare added in the tasks used here.
//
// The ids stay as literals where they are called. aiModels.test.mjs fails when
// a literal in the code is missing here, when an entry's `files` disagree with
// where it is called, or when an entry is called nowhere.

import { parseJsonLoose, responseText } from '../worker-llm.js';
import { visionRequest } from './vision.js';

export const AI_MODELS = [
  {
    id: '@cf/baai/bge-m3', kind: 'embedding', dims: 1024,
    uses: 'tag embeddings (/api/tags/embed) and the server\'s card embeddings; the pgvector columns are vector(1024) since 0418',
    files: ['boards/src/lib/serverEmbed.js', 'boards/src/worker-tags.js'],
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct-fp8', kind: 'chat',
    uses: 'doc word-tagging (/api/tags/apply) and Scout\'s message intent and questions',
    files: ['boards/src/lib/scoutIntent.js', 'boards/src/worker-tags.js', 'scout/src/pipeline.js'],
  },
  {
    id: '@cf/meta/llama-3.2-3b-instruct', kind: 'chat',
    uses: 'tag-candidate typing (/api/ai/candidates)',
    files: ['boards/src/worker-ai.js'],
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', kind: 'chat',
    uses: 'admin SEO drafts (/api/seo/draft)',
    files: ['boards/src/worker-seo.js'],
  },
  {
    // A picture beside the messages (`image: 'top'`), with a system message:
    // a lone user message is refused (3030).
    id: '@cf/meta/llama-3.2-11b-vision-instruct', kind: 'vision-chat', image: 'top',
    uses: 'picture descriptions, when Gemma 4 fails',
    files: ['boards/src/worker-vision.js'],
  },
  {
    // The picture inside the message, OpenAI-style; it ignores one beside the
    // messages, reasons away its whole answer unless told not to, and answers
    // in the OpenAI shape (responseText reads choices[0]).
    id: '@cf/google/gemma-4-26b-a4b-it', kind: 'vision-chat', image: 'part', noThinking: true,
    uses: 'picture descriptions (worker-vision.js, 0593)',
    files: ['boards/src/worker-vision.js'],
  },
  {
    id: '@cf/llava-hf/llava-1.5-7b-hf', kind: 'vision',
    uses: 'admin alt text (/api/seo/alt)',
    files: ['boards/src/worker-seo.js'],
  },
  {
    // The two Whisper models take audio differently (transcribe.js).
    id: '@cf/openai/whisper-large-v3-turbo', kind: 'speech', audio: 'base64',
    uses: 'Scout\'s voice-memo transcripts',
    files: ['scout/src/transcribe.js'],
  },
  {
    id: '@cf/openai/whisper', kind: 'speech', audio: 'bytes',
    uses: 'Scout\'s voice-memo transcripts, when the turbo model fails',
    files: ['scout/src/transcribe.js'],
  },
];

// The catalog's name for each kind's task.
export const TASK_OF_KIND = {
  chat: 'Text Generation',
  embedding: 'Text Embeddings',
  vision: 'Image-to-Text',
  'vision-chat': 'Text Generation',
  speech: 'Automatic Speech Recognition',
};
export const WATCHED_TASKS = [...new Set(AI_MODELS.map((m) => TASK_OF_KIND[m.kind]))];

export const CHANGELOG_FEED = 'https://developers.cloudflare.com/changelog/rss/workers-ai.xml';
export const CATALOG_PAGE = 'https://developers.cloudflare.com/workers-ai/models/';

const DAY = 86_400_000;

// ── The changelog ───────────────────────────────────────────────────────────

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', rarr: '→', mdash: '—', ndash: '–' };

// One pass, so "&amp;lt;" becomes the text "&lt;" and never a tag.
export function unescapeXml(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

const textOf = (html) => unescapeXml(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const MODEL_ID = /@(?:cf|hf)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g;
const idsIn = (text) => [...new Set((String(text).match(MODEL_ID) || []).map((id) => id.replace(/\.+$/, '')))];

// A heading that says models are going away...
const RETIRING = /deprecat|retir|sunset|end[- ]of[- ]life|discontinu|shut(?:ting)?[- ]down|no longer (?:available|supported|served)/i;
// ...or that lists what stays or what to move to. The 2026-05-08 post listed
// llama-3.3-70b-instruct-fp8-fast, which the SEO drafts use, under "Variants
// that remain active".
const STAYING = /\bremain|\bactive\b|replacement|recommend|alternative|instead|migrat(?:e|ion) to|cancel|revers|withdr/i;
// In a list item, what follows the arrow is the replacement:
// "<code>@cf/moonshotai/kimi-k2.5</code> --&gt; <code>@cf/moonshotai/kimi-k2.6</code>".
const REPLACED_BY = /-->|→|⟶|\breplaced (?:by|with)\b|\b(?:use|try|switch to|migrate to)\b|\binstead\b/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DATE = new RegExp(`\\b${MONTH} (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b|\\b(\\d{1,2}) ${MONTH},? (\\d{4})\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'i');

// The first date written in `text`, as UTC midnight ms, or null.
export function dateIn(text) {
  const m = String(text ?? '').match(DATE);
  if (!m) return null;
  const month = (name) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  const ms = m[1] ? Date.UTC(+m[3], month(m[1]), +m[2])
    : m[5] ? Date.UTC(+m[6], month(m[5]), +m[4])
    : Date.UTC(+m[7], +m[8] - 1, +m[9]);
  return Number.isFinite(ms) ? ms : null;
}

// A post's HTML cut at its headings: [{ heading, html }], with whatever comes
// before the first heading under ''. A paragraph that is only bold text
// counts as a heading too.
function sections(html) {
  const marks = /<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>|<p>\s*<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>\s*:?\s*<\/p>/gi;
  const out = [];
  let heading = '';
  let from = 0;
  for (const m of html.matchAll(marks)) {
    out.push({ heading, html: html.slice(from, m.index) });
    heading = textOf(m[1] ?? m[2]);
    from = m.index + m[0].length;
  }
  out.push({ heading, html: html.slice(from) });
  return out;
}

// Whether a section lists models that are going away. When a heading says
// both ("Deprecated models and their replacements"), whichever comes first
// wins. A neutral heading follows the post's title.
function sectionRetires(heading, titleRetires) {
  const r = heading.search(RETIRING);
  const s = heading.search(STAYING);
  if (r >= 0 && (s < 0 || r < s)) return true;
  if (s >= 0) return false;
  return titleRetires;
}

// The models a section names: from each list item, the ids before any arrow
// or "replaced by", and the first id after it as the replacement; from each
// table row, the ids in its first cell that has one. Paragraphs don't count:
// the 2026-05-08 post's paragraph about Kimi K2.5 names only its replacement.
function rowsOf(html) {
  const rows = [];
  for (const [, li] of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const t = textOf(li);
    const cut = t.search(REPLACED_BY);
    const ids = idsIn(cut < 0 ? t : t.slice(0, cut));
    if (ids.length) rows.push({ ids, replacement: cut < 0 ? null : idsIn(t.slice(cut))[0] ?? null, when: dateIn(t) });
  }
  for (const [, tr] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => textOf(m[1]));
    const i = cells.findIndex((c) => idsIn(c).length);
    if (i < 0) continue;
    const head = cells[i];
    const cut = head.search(REPLACED_BY);
    const ids = idsIn(cut < 0 ? head : head.slice(0, cut));
    const rest = (cut < 0 ? '' : head.slice(cut)) + ' ' + cells.slice(i + 1).join(' ');
    if (ids.length) rows.push({ ids, replacement: idsIn(rest)[0] ?? null, when: dateIn(cells.join(' ')) });
  }
  return rows;
}

function field(item, name) {
  const m = item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return '';
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : unescapeXml(v);
}

// Every model the Workers AI changelog feed says is going away:
// { posts, retiring: [{ id, replacement, when, heading, title, link, published }] }.
// `when` is the retirement date as UTC ms, or null when the post gives none.
// The feed lists the newest post first, and the newest word on a model wins.
export function retiringFromFeed(xml) {
  const posts = String(xml ?? '').split(/<item\b[^>]*>/i).slice(1).map((s) => s.split(/<\/item>/i)[0]);
  const retiring = [];
  const seen = new Set();
  for (const item of posts) {
    const title = textOf(field(item, 'title'));
    const link = field(item, 'link');
    const published = field(item, 'pubDate');
    const titleRetires = RETIRING.test(title);
    for (const s of sections(field(item, 'description'))) {
      if (!sectionRetires(s.heading, titleRetires)) continue;
      for (const row of rowsOf(s.html)) {
        for (const id of row.ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          retiring.push({
            id, replacement: row.replacement, when: row.when ?? dateIn(s.heading) ?? dateIn(title),
            heading: s.heading, title, link, published,
          });
        }
      }
    }
  }
  return { posts: posts.length, retiring };
}

// ── The catalog ─────────────────────────────────────────────────────────────

// created_at reads "2025-08-04 10:08:04.219": UTC, with no zone mark.
export function catalogTimeMs(s) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), +((m[7] ?? '0').padEnd(3, '0')));
}

// The catalog's models added at or after `sinceMs` in `tasks`, newest first.
export function newModels(catalog, sinceMs, tasks = WATCHED_TASKS) {
  return (catalog || [])
    .filter((m) => tasks.includes(m?.task?.name) && catalogTimeMs(m?.created_at) >= sinceMs)
    .sort((a, b) => catalogTimeMs(b.created_at) - catalogTimeMs(a.created_at));
}

// "$0.0509 per M input tokens, $0.335 per M output tokens", or '' unpriced.
export function priceText(model) {
  const p = (model?.properties || []).find((x) => x?.property_id === 'price');
  return (Array.isArray(p?.value) ? p.value : [])
    .filter((r) => r?.unit && Number.isFinite(Number(r.price)))
    .map((r) => `${!r.currency || r.currency === 'USD' ? '$' + Number(r.price) : Number(r.price) + ' ' + r.currency} ${r.unit}`)
    .join(', ');
}

// ── The canaries ────────────────────────────────────────────────────────────

// An 8×8 PNG: llava refuses an image under 2×2.
const CANARY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mM4scAGK2IYWhIAKi9pAQY0dnkAAAAASUVORK5CYII=';
// A 16×16 one for the chat models that see: gemma-4 refuses under 10px.
const CANARY_PNG_16 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4ucSRJMQwqmFUw/DVAACzFb4QPVOfAwAAAABJRU5ErkJggg==';

// Half a second of 16 kHz mono silence as a WAV. Whisper tends to hear
// "Thank you." in it, so only the shape of the answer is checked.
export function silentWav(ms = 500, rate = 16000) {
  const n = Math.round((rate * ms) / 1000);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const tag = (at, s) => { for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, n * 2, true);
  return new Uint8Array(v.buffer);
}

const base64Of = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

// What a model of each kind is sent: the smallest request that proves it works.
export function canaryRequest(model) {
  switch (model.kind) {
    case 'chat':
      return {
        messages: [
          { role: 'system', content: 'You answer with JSON only.' },
          { role: 'user', content: 'Return exactly this JSON object and nothing else: {"ok": true}' },
        ],
        max_tokens: 20,
        temperature: 0,
      };
    case 'embedding':
      return { text: ['canary'] };
    case 'vision':
      return { image: [...atob(CANARY_PNG)].map((c) => c.charCodeAt(0)), prompt: 'Describe this image in a few words.', max_tokens: 16 };
    case 'vision-chat':
      // Production's own request (lib/vision.js), asked for a few words.
      return visionRequest(model.image, `data:image/png;base64,${CANARY_PNG_16}`,
        { prompt: 'Describe this picture in a few words.', noThinking: !!model.noThinking, maxTokens: 16 });
    case 'speech': {
      const wav = silentWav();
      return { audio: model.audio === 'base64' ? base64Of(wav) : [...wav] };
    }
    default:
      throw new Error(`no canary for a ${model.kind} model`);
  }
}

// What is wrong with a model's answer, or null. A text answer is read with
// the same responseText and parseJsonLoose production uses, so a change in how
// Workers AI shapes answers fails here before it fails a user.
export function canaryProblem(model, out) {
  switch (model.kind) {
    case 'chat': {
      const text = responseText(out);
      return parseJsonLoose(text)?.ok === true ? null : `answered ${JSON.stringify(text.slice(0, 120))}, not {"ok": true}`;
    }
    case 'embedding': {
      const v = out?.data?.[0];
      if (Array.isArray(v) && v.length === model.dims) return null;
      return `answered ${Array.isArray(v) ? `a ${v.length}-dim vector` : 'no vector'}, not ${model.dims} dims`;
    }
    case 'vision':
      return typeof out?.description === 'string' ? null : 'answered with no description';
    case 'vision-chat':
      return responseText(out).trim() ? null : 'answered with no text';
    case 'speech':
      return typeof (out?.text ?? out?.transcription_info?.text) === 'string' ? null : 'answered with no text';
    default:
      return `no canary for a ${model.kind} model`;
  }
}

// ── The alerts ──────────────────────────────────────────────────────────────

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

// One problem per model, worst first: gone from the catalog, failing its
// canary, announced for retirement. A retired model is one email, not three.
// A source the watch couldn't read is null and says nothing either way;
// watchAlert reports it instead.
export function modelProblems({ models = AI_MODELS, catalogNames = null, canaries = {}, retiring = null }) {
  const problems = [];
  for (const model of models) {
    const canary = canaries[model.id] ?? null;
    const notice = retiring?.find((r) => r.id === model.id) ?? null;
    const type = catalogNames && !catalogNames.has(model.id) ? 'gone'
      : canary?.error ? 'failing'
      : notice ? 'retiring'
      : null;
    if (type) problems.push({ type, model, canary, notice });
  }
  return problems;
}

// The ops alert for one problem: { key, title, body, window }. It repeats
// daily while the model fails or its date is under a week away, and weekly
// before that, until the code moves off it.
export function alertFor({ type, model, canary, notice }, now = Date.now()) {
  const when = notice?.when ?? null;
  const days = when == null ? null : Math.ceil((when - now) / DAY);
  const title = type === 'gone' ? `Workers AI no longer lists ${model.id}`
    : type === 'failing' ? `Workers AI model failing: ${model.id}`
    : `Workers AI retires ${model.id} ${when == null ? 'soon' : 'on ' + ymd(when)}`;
  const lines = [`${model.id} runs ${model.uses}.`, ''];
  if (type === 'gone') {
    lines.push('Cloudflare\'s model catalog no longer lists it. Retired models leave the catalog, and some are aliased to a different, pricier model first, so calls can keep working for a while.');
  }
  if (canary?.error) lines.push(`A test request failed ${canary.attempts} times: ${canary.error}`);
  else if (canary) lines.push(`A test request worked (${canary.ms} ms).`);
  if (notice) {
    const left = days == null ? '' : days > 0 ? `, ${days} days from now` : days === 0 ? ', today' : `, ${-days} days ago`;
    lines.push(`The Workers AI changelog lists it under "${notice.heading || notice.title}"${left}:`);
    lines.push(`  ${notice.title}${notice.published ? ` (${notice.published})` : ''}`);
    if (notice.link) lines.push(`  ${notice.link}`);
    if (notice.replacement) lines.push(`Cloudflare's suggested replacement: ${notice.replacement}`);
  }
  lines.push('', `To fix: change the id in ${model.files.join(', ')}, then in boards/src/lib/aiModels.js (aiModels.test.mjs fails until the two agree). The catalog: ${CATALOG_PAGE}`);
  if (type === 'failing') lines.push('One bad morning can be a passing outage. If tomorrow\'s check passes, there is nothing to do.');
  const urgent = Boolean(canary?.error) || (days != null && days <= 7);
  return { key: `ai_model:${type}:${model.id}`, title, body: lines.join('\n'), window: urgent ? '20 hours' : '6 days' };
}

// When the watch itself can't see: a catalog or feed it couldn't read, or a
// run that threw. Without these it would go quiet, and quiet reads as good news.
export function watchAlert(source, err) {
  const [what, then] = {
    catalog: ['could not read the Workers AI catalog', 'A retired model goes unnoticed until this works again.'],
    feed: ['could not read the Workers AI changelog', `Retirement notices go unnoticed until this works again. If the feed moved or changed shape, update CHANGELOG_FEED or retiringFromFeed in boards/src/lib/aiModels.js. The feed: ${CHANGELOG_FEED}`],
    run: ['failed', 'Nothing was checked this morning.'],
  }[source];
  return {
    key: `ai_model:watch:${source}`,
    title: `The AI model watch ${what}`,
    body: `${then}\n\nError: ${String(err?.message || err).slice(0, 300)}\n\nThe watch is runAiModelWatch in boards/src/worker-aiwatch.js, run by the 04:00 UTC cron.`,
    window: source === 'feed' ? '6 days' : '3 days',
  };
}

// Eight short entries keep the email under ops_alert_raise's 4000-character
// cut, which would otherwise drop the list of models in use off the end.
const LISTED = 8;

// The Sunday email listing the catalog's new models, or null when there are none.
export function digestAlert(fresh) {
  if (!fresh?.length) return null;
  const lines = fresh.slice(0, LISTED).map((m) => {
    const price = priceText(m);
    const d = String(m.description ?? '').replace(/\s+/g, ' ').trim();
    const about = d.length > 160 ? d.slice(0, 160).replace(/\s+\S*$/, '') + '…' : d;
    return `- ${m.name}: ${m.task?.name}, added ${String(m.created_at).slice(0, 10)}${price ? `, ${price}` : ''}${about ? `\n  ${about}` : ''}`;
  });
  if (fresh.length > LISTED) lines.push(`- and ${fresh.length - LISTED} more`);
  return {
    key: 'ai_model:new',
    title: fresh.length === 1 ? `New on Workers AI: ${fresh[0].name}` : `${fresh.length} new models on Workers AI this week`,
    body: [
      `Cloudflare added these to the Workers AI catalog in the last 7 days, in the tasks the app uses (${WATCHED_TASKS.join(', ')}):`,
      '', ...lines, '',
      'In use now:', ...AI_MODELS.map((m) => `- ${m.id}: ${m.uses}`), '',
      `Nothing to do unless one is worth trying. The catalog: ${CATALOG_PAGE}`,
    ].join('\n'),
    window: '6 days',
  };
}
