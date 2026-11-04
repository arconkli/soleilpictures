// Working live together earns cards (owner, 2026-11-04: "working with friends
// ACTIVELY gets you something").
//
// Two or more people active in the same cluster at the same time each earn
// bonus cards, the invite reward's currency, so the free card limit rises with
// them: one card every TOGETHER_CARD_SECONDS together with one other person,
// two with two others, TOGETHER_MAX_BOOST with three or more, at most
// TOGETHER_MONTH_CAP in a calendar month. Creator and Team bank them; nothing
// here touches the editor or workspace limits.
//
// Who is active is the party worker's call (togetherClock.js, party/board.ts);
// what that pays is the database's (live_together_tick, 0862). The room tells
// each person how it is going with the message below, and the app shows it as
// the quiet Together chip by the faces in the top bar (TogetherChip.jsx).
//
// EVERY NUMBER HERE IS ENFORCED ELSEWHERE, and liveTogetherMigration.test.mjs /
// gen-docs.mjs fail the build when one drifts from the code that pays it.

// live_together_tick (0862): c_card_seconds, c_month_cap, c_max_boost.
export const TOGETHER_CARD_SECONDS = 120;
export const TOGETHER_MONTH_CAP = 25;
export const TOGETHER_MAX_BOOST = 3;
// togetherClock.js: someone is active for this long after real input.
export const TOGETHER_ACTIVE_SECONDS = 120;

// Cards every TOGETHER_CARD_SECONDS for each person, with this many people
// working together (you included).
export function togetherBoost(people) {
  const n = Math.floor(Number(people) || 0);
  return n >= 2 ? Math.min(n - 1, TOGETHER_MAX_BOOST) : 0;
}

// ── What the room says ──────────────────────────────────────────────────────
// A custom message on the board room's socket (y-partyserver adds its own
// prefix). `t` keeps it apart from the save line's acks (roomAck.js).

const isCount = (v) => Number.isInteger(v) && v >= 0;

export function togetherMessage({ peers, boost, earned, month, cap, capped, progress }) {
  return JSON.stringify({
    t: 'together', on: true, peers, boost, earned, month, cap, capped,
    progress: Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100) / 100,
  });
}

export const TOGETHER_ENDED = JSON.stringify({ t: 'together', on: false });

// The message as the app reads it, or null for anything else.
export function readTogether(text) {
  let m;
  try { m = JSON.parse(text); } catch (_) { return null; }
  if (!m || m.t !== 'together' || typeof m.on !== 'boolean') return null;
  if (!m.on) return { on: false };
  if (!Array.isArray(m.peers) || m.peers.length > 100 || !m.peers.every((p) => typeof p === 'string')) return null;
  if (!isCount(m.boost) || m.boost < 1 || m.boost > TOGETHER_MAX_BOOST) return null;
  if (!isCount(m.earned) || !isCount(m.month) || !isCount(m.cap) || m.cap < 1) return null;
  if (typeof m.capped !== 'boolean' || typeof m.progress !== 'number' || !(m.progress >= 0 && m.progress <= 1)) return null;
  return {
    on: true, peers: m.peers, boost: m.boost, earned: m.earned,
    month: m.month, cap: m.cap, capped: m.capped, progress: m.progress,
  };
}

// ── The words (mockups/1-chip.html, picked by the owner) ────────────────────
// Quiet on purpose: no "boost", no "x2", no countdowns.

const cards = (n) => `${n} card${n === 1 ? '' : 's'}`;
const minutes = () => {
  const m = TOGETHER_CARD_SECONDS / 60;
  return m === 1 ? 'minute' : `${m} minutes`;
};
const known = (names) => Array.isArray(names) && names.length > 0 && names.every((n) => typeof n === 'string' && n.trim());

// The chip. Nothing to count until the first card.
export function chipLabel(earned) {
  return earned > 0 ? `Together · +${cards(earned)}` : 'Together';
}

export function chipShortLabel(earned) {
  return earned > 0 ? `+${earned}` : '';
}

export function chipAria(earned) {
  return earned > 0 ? `Working together, ${cards(earned)} earned` : 'Working together';
}

// `names`: the other people's names, in the order they joined.
export function togetherTitle(names, others = Array.isArray(names) ? names.length : 0) {
  if (others >= 3 || !known(names) || names.length !== others) {
    return `You and ${others} other${others === 1 ? ' person' : 's'} are working together`;
  }
  if (others === 1) return `You and ${names[0]} are working together`;
  return `You, ${names[0]} and ${names[1]} are working together`;
}

export function rateLine(boost) {
  return boost <= 1
    ? `You both earn 1 free card every ${minutes()}`
    : `You each earn ${boost} free cards every ${minutes()}`;
}

export function monthLine(month, cap = TOGETHER_MONTH_CAP) {
  return `This month: ${month} of ${cap} cards`;
}

export function capLine(cap = TOGETHER_MONTH_CAP) {
  return `That's this month's ${cap}. More next month.`;
}

// Said only while a bigger group would earn more.
export function groupHint(boost) {
  if (boost >= TOGETHER_MAX_BOOST) return null;
  return `With ${boost + 2} of you: ${cards(boost + 1)} every ${minutes()}`;
}

// The note when someone arrives (at most once a day per device).
export function arrivalNote(names, others = Array.isArray(names) ? names.length : 0) {
  const both = others <= 1 ? "You're both" : "You're all";
  let who;
  if (!known(names)) who = others <= 1 ? "Someone's here." : `${others} people are here.`;
  else if (others <= 1) who = `${names[0]}'s here.`;
  else if (others === 2 && names.length === 2) who = `${names[0]} and ${names[1]} are here.`;
  else who = `${names[0]} and ${others - 1} others are here.`;
  return `${who} ${both} earning cards while you work together.`;
}

// Settings › Invite and earn.
export function settingsLine(month, cap = TOGETHER_MONTH_CAP) {
  return `${month} of ${cap} cards this month`;
}

// How many cards of a bonus-credit growth to announce as a reward: the part the
// together count doesn't explain. `was` and `now` are get_my_together_stats reads
// ({ bonus, lifetime }, each from one snapshot), or null when one couldn't be read.
// Neither read: the feature isn't there, so all of `delta`, as before. Only one:
// unknown, so none (a reward then shows in the next growth's sum).
export function rewardCardsBeyondTogether(was, now, delta) {
  if (!was && !now) return Math.max(0, delta);
  if (!was || !now) return 0;
  return Math.max(0, (now.bonus - was.bonus) - (now.lifetime - was.lifetime));
}
