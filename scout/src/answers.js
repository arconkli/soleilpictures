// Scout — answering questions people actually ask a bot.
//
// The model CLASSIFIES; it never composes. Every answer below is written by
// hand, because a free-form LLM reply will cheerfully invent capabilities
// ("yes, I can edit video") and the person asking has no way to know it's
// wrong. Getting "what can I send you?" wrong isn't a bad answer, it's a
// support ticket and a lost user.
//
// Matching is keyword-first (free, instant, no model call) and falls back to
// classification only when the wording is unusual.

export const TOPICS = {
  how_it_works: {
    keywords: ['how do you work', 'how does this work', 'how do you', 'what do you do',
               'what is this', 'who are you', 'what are you', 'how does it work'],
    answer: () => [
      'Text me photos, links or notes and they land on an infinite canvas —',
      'grouped and titled by whatever you tell me.',
      '',
      'Send 5 photos and "Scene 4 diner" and I make a group called Scene 4 — Diner.',
      'Say "put these in Diner Recce" and I file everything there from then on.',
      'Say nothing and it all waits in your Scout Inbox.',
      '',
      'Nothing to install. Your board already exists.',
    ].join('\n'),
  },

  what_can_i_send: {
    keywords: ['what can i upload', 'what can i send', 'what can you take',
               'what file', 'can i send video', 'can i send a pdf', 'what formats',
               'can you take video', 'do you take'],
    answer: () => [
      'Photos — as many as you like, at full resolution. iPhone HEIC is fine;',
      'I convert it so it opens everywhere.',
      '',
      'Links — YouTube, Vimeo, TikTok and the like become real embedded cards.',
      'Anything else becomes a preview card with its title and image.',
      '',
      'Text — anything you write becomes a sticky note next to the photos it',
      'refers to.',
      '',
      'Video and audio files need a Creator plan. Everything above is free.',
    ].join('\n'),
  },

  where_do_things_go: {
    keywords: ['where do', 'where does it go', 'where did', 'which board',
               'where are my', 'where is my board', 'how do i find'],
    answer: (ctx) => [
      `Everything goes to ${ctx.boardName || 'your Scout Inbox'} unless you tell me otherwise.`,
      '',
      'Say "put these in <board name>" to file into one of your own boards,',
      'and it sticks until you change it. Send /board to go back to the inbox.',
      ctx.url ? `\nYour board: ${ctx.url}` : '',
    ].filter(Boolean).join('\n'),
  },

  own_board: {
    keywords: ['my own board', 'existing account', 'i already have', 'connect my account',
               'link my account', 'use my account', 'i have an account'],
    answer: () => [
      'Yes — open Clusters on the web, go to Settings → Scout, and tap Connect.',
      'It gives you a short code; text it to me and this number is linked to',
      'your account. Everything you send then files into your own boards.',
    ].join('\n'),
  },

  pricing: {
    keywords: ['how much', 'is this free', 'is it free', 'cost', 'price', 'pricing',
               'do i have to pay', 'what happens when i run out', 'limit', 'card limit'],
    answer: (ctx) => [
      'Free to use. Your free plan covers 100 cards across as many boards as you',
      'like, with collaborators included. Every photo, link or note is one card.',
      '',
      'When you hit the wall I\'ll tell you. Creator lifts the cap and adds 100GB',
      `and any file type: ${ctx.origin}/pricing`,
    ].join('\n'),
  },

  privacy: {
    keywords: ['who can see', 'is it private', 'privacy', 'are my photos', 'safe',
               'secure', 'who sees', 'public', 'do you share'],
    answer: () => [
      'Your board is private. Nobody sees it unless you share it.',
      '',
      'Photos upload straight to your own board at full resolution. They are not',
      'used to train anything and they are not public unless you make them public.',
    ].join('\n'),
  },

  sharing: {
    keywords: ['share', 'send to my', 'show my director', 'send the board',
               'can i share', 'link to my team'],
    answer: (ctx) => [
      'Open the board and hit Share — you get one link that works for anyone,',
      'no account needed to view it.',
      ctx.url ? `\n${ctx.url}` : '',
    ].filter(Boolean).join('\n'),
  },

  android: {
    keywords: ['android', 'samsung', 'does this work on', 'my colleague', 'pixel',
               'not an iphone', 'whatsapp', 'telegram'],
    answer: (ctx) => [
      'Right now I work over iMessage, so I need an iPhone.',
      '',
      `On Android, use the web app instead — ${ctx.origin} — and drag photos`,
      'straight onto the board. Same canvas, same boards.',
    ].join('\n'),
  },

  stop: {
    keywords: ['stop', 'unsubscribe', 'delete my', 'remove me', 'opt out',
               'cancel', 'go away', 'leave me alone'],
    answer: (ctx) => [
      'Understood — I won\'t send anything unless you text me first.',
      '',
      `To delete your board and account, open ${ctx.origin} and go to`,
      'Settings → Profile. Everything goes with it.',
    ].join('\n'),
  },
};

const TOPIC_IDS = Object.keys(TOPICS);

// Question-shaped? Cheap gate so we don't burn a model call classifying
// "here's the diner" as a question.
export function looksLikeQuestion(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s) return false;
  if (s.endsWith('?')) return true;
  return /^(how|what|can|do|does|is|are|who|where|why|when|will|should|could)\b/.test(s);
}

// Keyword pass. Returns a topic id or null. Longest keyword wins so
// "what can i upload" beats a bare "what".
export function matchTopic(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  let best = null;
  let bestLen = 0;
  for (const id of TOPIC_IDS) {
    for (const kw of TOPICS[id].keywords) {
      if (s.includes(kw) && kw.length > bestLen) { best = id; bestLen = kw.length; }
    }
  }
  return best;
}

export function renderAnswer(topicId, ctx = {}) {
  const topic = TOPICS[topicId];
  if (!topic) return null;
  return topic.answer(ctx);
}

// What to say when someone clearly asked something but we can't tell what.
// Never guess — offer the real menu.
export function fallbackAnswer(ctx = {}) {
  return [
    'Not sure I follow — but here\'s what I can do:',
    '',
    'Send photos, links or notes and they land on your canvas.',
    '"put these in <board>"   file into one of your boards',
    '/board                   back to your Scout Inbox',
    '/help                    this menu',
    '',
    ctx.url || '',
  ].filter(Boolean).join('\n');
}

export const CLASSIFIER_SYSTEM = [
  'Classify a message sent to a film-crew ingest bot into exactly one topic id.',
  'Reply with ONLY the id, nothing else.',
  '',
  'Ids:',
  '  how_it_works      asking what the bot is or how it works',
  '  what_can_i_send   asking which files/formats/media are accepted',
  '  where_do_things_go asking where their content ended up',
  '  own_board         asking to use an existing account or their own boards',
  '  pricing           asking about cost, limits, or the card cap',
  '  privacy           asking who can see their content, or whether it is safe',
  '  sharing           asking how to share a board with someone',
  '  android           asking about Android, or non-iPhone devices',
  '  stop              asking to stop, unsubscribe, or delete',
  '  none              anything else',
].join('\n');

export function isValidTopic(id) {
  return TOPIC_IDS.includes(String(id || '').trim());
}
