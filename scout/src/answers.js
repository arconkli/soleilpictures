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

import {
  FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP,
} from '../../boards/src/lib/fileIngest.js';
import { DEMO_CARD_LIMIT } from '../../boards/src/lib/demoCardCap.js';

const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)}MB`;

export const TOPICS = {
  how_it_works: {
    keywords: ['how do you work', 'how does this work', 'how do you', 'what do you do',
               'what is this', 'who are you', 'what are you', 'how does it work'],
    answer: () => [
      'Text me photos, links or notes and they land on an infinite canvas —',
      'grouped and titled by whatever you tell me.',
      '',
      'Everything you send collects in your Scout Bin, newest last.',
      'When you\'re ready, say "put these in Diner Recce" — I show you exactly',
      'which cards are about to move, you say yes, and I arrange them by colour',
      'on that board.',
      '',
      'Nothing to install. Your board already exists.',
    ].join('\n'),
  },

  what_can_i_send: {
    keywords: ['what can i upload', 'what can i send', 'what can you take',
               'what file', 'can i send video', 'can i send a pdf', 'what formats',
               'can you take video', 'do you take', 'voice note', 'voice memo'],
    // The caps are INTERPOLATED FROM fileIngest.js, never typed here. This
    // answer used to say "video and audio files need a Creator plan", which was
    // simply false — the free tier takes all three inline, and only oversize
    // media and arbitrary file types are paid. Wrong copy about the paywall is
    // worse than no copy: it talks people out of the product for a reason that
    // does not exist.
    answer: () => [
      'Photos — as many as you like, at full resolution. iPhone HEIC is fine;',
      'I convert it so it opens everywhere.',
      '',
      `Video up to ${mb(FREE_VIDEO_CAP)} and audio up to ${mb(FREE_AUDIO_CAP)}, free.`,
      'iPhone clips get converted so they play outside Safari too.',
      '',
      'Voice notes — I transcribe them, so you can search what you said later.',
      '',
      `PDFs up to ${mb(FREE_PDF_CAP)}. Bigger files, and any other file type,`,
      'need a Creator plan.',
      '',
      'Links — YouTube, Vimeo, TikTok and the like become real embedded cards.',
      'Anything else becomes a preview card with its title and image.',
      '',
      'Text — anything you write becomes a sticky note next to the photos it',
      'refers to.',
    ].join('\n'),
  },

  search: {
    keywords: ['can i search', 'how do i find', 'find a photo', 'search my',
               'look for something'],
    answer: () => [
      'Say "find diner" — or /find diner — and I\'ll tell you which boards it\'s on.',
      '',
      'I search titles, notes, whatever you said about a photo, and the text of',
      'any voice note you sent.',
    ].join('\n'),
  },

  where_do_things_go: {
    keywords: ['where do', 'where does it go', 'where did', 'which board',
               'where are my', 'where is my board', 'how do i find'],
    answer: (ctx) => [
      `Everything collects in ${ctx.boardName || 'your Scout Bin'} until you file it.`,
      '',
      'Say "put these in <board name>" and I move the batch you just sent —',
      'not the whole Bin, so photos from days ago don\'t come along by accident.',
      'Say "put everything in <board>" when you do want the lot.',
      'Send /bin to see what\'s waiting and how old it is.',
      ctx.url ? `\nYour Bin: ${ctx.url}` : '',
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
    // THE NUMBER IS THE USER'S OWN. Since migration 0229 the cap lives in
    // profiles.card_cap_base and differs per account — accounts predating it are
    // grandfathered higher — so demoCardCap.js says in as many words: never
    // render the constant as somebody's actual limit. This answer used to state
    // a flat "100 cards", which is now wrong for every new account and right
    // only by accident for old ones. ctx.cap is what scout_board_capacity says
    // about THIS person; the constant is the fallback when we could not ask.
    answer: (ctx) => {
      if (ctx.cap === Infinity) {
        return [
          'You\'re on Creator — no card limit, 100GB of storage, and any file type.',
          '',
          'Send as much as you like.',
        ].join('\n');
      }
      const cap = Number.isFinite(ctx.cap) ? ctx.cap : DEMO_CARD_LIMIT;
      const used = Number.isFinite(ctx.used) ? ctx.used : null;
      const lines = [
        `Free to use. Your plan covers ${cap} cards across as many boards as you`,
        'like, with collaborators included. Every photo, clip, link or note is one card.',
      ];
      // Built by pushing, not filtered: a `.filter(Boolean)` over this array
      // silently eats the '' that separates the paragraphs, because '' is falsy.
      if (used !== null) lines.push('', `You're at ${used} of ${cap}.`);
      lines.push('', 'When you hit the wall I\'ll tell you. Creator lifts the cap and adds 100GB',
        `and any file type: ${ctx.origin}/pricing`);
      return lines.join('\n');
    },
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

  // Reaching this topic means someone asked ABOUT stopping rather than saying
  // the word — a real "stop" is handled long before the classifier runs, sets
  // scout_identities.opted_out_at, and blocks the invite queue. This answer is
  // therefore about how, and about the difference between stopping and deleting.
  stop: {
    keywords: ['how do i stop', 'how do i unsubscribe', 'delete my account',
               'delete my data', 'stop messaging me', 'opt out'],
    answer: (ctx) => [
      'Text STOP and I won\'t message you again. START brings me back.',
      '',
      `Stopping leaves your boards and photos exactly as they are. To delete the`,
      `account itself, open ${ctx.origin} and go to Settings → Profile —`,
      'everything goes with it.',
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
    'Send photos, links or notes and they collect in your Scout Bin.',
    '"put these in <board>"   file the batch you just sent',
    '/bin                     what\'s waiting, and how old',
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
