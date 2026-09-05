// crawlerUa.js — recognize the crawlers we serve, so their fetches can be
// counted (see migration 0295 and the crawler_hits table).
//
// This is deliberately a DIFFERENT question from lib/device.js's bot flag. That
// one asks "is this analytics row a human?" and wants a broad, cheap net — a
// false positive there costs one quarantined row. This one asks "which named
// crawler just fetched this page, and is it an AI crawler?", and the answer is
// reported as fact, so it matches specific published user-agent tokens and
// returns null for anything it does not recognize. Never widen this to a
// generic /bot/ catch-all: an unattributable hit counted as a crawl is worse
// than an uncounted one.
//
// Pure and dependency-free so it unit-tests with fixed strings and adds nothing
// to any bundle but the Worker's.
//
// Token sources: each vendor's own crawler documentation. Order matters —
// the first match wins, so more specific tokens precede their prefixes
// (OAI-SearchBot and ChatGPT-User before GPTBot; Applebot-Extended before
// Applebot; Google-Extended before Googlebot).

const CRAWLERS = [
  // ── AI: training corpora, retrieval indexes, and live user-triggered fetches
  ['oai-searchbot',      'OAI-SearchBot',      'ai'],      // ChatGPT search index
  ['chatgpt-user',       'ChatGPT-User',       'ai'],      // a person asked ChatGPT to open us
  ['gptbot',             'GPTBot',             'ai'],
  ['claude-searchbot',   'Claude-SearchBot',   'ai'],
  ['claude-user',        'Claude-User',        'ai'],      // a person asked Claude to open us
  ['claudebot',          'ClaudeBot',          'ai'],
  ['anthropic-ai',       'anthropic-ai',       'ai'],
  ['perplexity-user',    'Perplexity-User',    'ai'],
  ['perplexitybot',      'PerplexityBot',      'ai'],
  ['google-extended',    'Google-Extended',    'ai'],      // Gemini training opt-out token
  ['duckassistbot',      'DuckAssistBot',      'ai'],
  ['mistralai-user',     'MistralAI-User',     'ai'],
  ['cohere-ai',          'cohere-ai',          'ai'],
  ['ccbot',              'CCBot',              'ai'],      // Common Crawl — feeds most corpora
  ['bytespider',         'Bytespider',         'ai'],
  ['amazonbot',          'Amazonbot',          'ai'],
  ['meta-externalagent', 'Meta-ExternalAgent', 'ai'],
  ['applebot-extended',  'Applebot-Extended',  'ai'],
  ['youbot',             'YouBot',             'ai'],

  // ── Classic search
  ['googlebot',          'Googlebot',          'search'],
  ['bingbot',            'bingbot',            'search'],
  ['duckduckbot',        'DuckDuckBot',        'search'],
  ['applebot',           'Applebot',           'search'],
  ['yandexbot',          'YandexBot',          'search'],
  ['baiduspider',        'Baiduspider',        'search'],
  ['slurp',              'Slurp',              'search'],

  // ── Link-preview unfurlers. Not search and not AI, but they are the reason a
  //    shared link renders a card, so a sudden zero here is worth seeing.
  ['facebookexternalhit', 'facebookexternalhit', 'other'],
  ['twitterbot',          'Twitterbot',          'other'],
  ['linkedinbot',         'LinkedInBot',         'other'],
  ['slackbot',            'Slackbot',            'other'],
  ['discordbot',          'Discordbot',          'other'],
  ['telegrambot',         'TelegramBot',         'other'],
];

// → { bot, kind } for a recognized crawler, else null.
export function classifyCrawler(userAgent) {
  const low = String(userAgent || '').toLowerCase();
  if (!low) return null;
  for (const [token, bot, kind] of CRAWLERS) {
    if (low.includes(token)) return { bot, kind };
  }
  return null;
}

// Paths worth attributing a crawl to. Static assets and API routes say nothing
// about what a crawler is READING, and a bursty asset fetch would swamp the
// page-level signal the table exists to carry. Dotted paths are allowed through
// only for the .md/.xml/.txt mirrors, which are exactly the surfaces built for
// machine readers.
export function isCrawlablePath(pathname) {
  const p = String(pathname || '');
  if (!p.startsWith('/')) return false;
  if (p.startsWith('/api/') || p.startsWith('/assets/') || p.startsWith('/oauth/')
      || p.startsWith('/.well-known/')) return false;
  const dot = p.lastIndexOf('.');
  if (dot > -1 && dot > p.lastIndexOf('/')) {
    return /\.(md|xml|txt)$/i.test(p);
  }
  return true;
}
