// The words of working live together, read through Lingui. App-only mirror of
// the words in liveTogether.js: a Playwright spec (tests/together-chip.spec.js)
// imports that module and asserts them, so it stays English and macro-free.
// liveTogetherWords.test.mjs pins this file's English to that one's.
import { t, plural } from '@lingui/core/macro';
import { TOGETHER_CARD_SECONDS, TOGETHER_MONTH_CAP, TOGETHER_MAX_BOOST } from './liveTogether.js';

const every = () => plural(TOGETHER_CARD_SECONDS / 60, { 1: 'every minute', other: 'every # minutes' });
const known = (names) => Array.isArray(names) && names.length > 0 && names.every((n) => typeof n === 'string' && n.trim());

// "+3 cards": what the chip has earned, said alone.
export function chipEarned(earned) {
  return plural(earned, { one: '+# card', other: '+# cards' });
}

// The chip. Nothing to count until the first card.
export function chipLabel(earned) {
  if (!(earned > 0)) return t`Together`;
  const got = chipEarned(earned);
  return t`Together · ${got}`;
}

export function chipShortLabel(earned) {
  return earned > 0 ? `+${earned}` : '';
}

export function chipAria(earned) {
  return earned > 0
    ? plural(earned, { one: 'Working together, # card earned', other: 'Working together, # cards earned' })
    : t`Working together`;
}

// `names`: the other people's names, in the order they joined.
export function togetherTitle(names, others = Array.isArray(names) ? names.length : 0) {
  if (others >= 3 || !known(names) || names.length !== others) {
    return plural(others, { 1: 'You and # other person are working together', other: 'You and # others are working together' });
  }
  if (others === 1) {
    const first = names[0];
    return t`You and ${first} are working together`;
  }
  const [first, second] = names;
  return t`You, ${first} and ${second} are working together`;
}

export function rateLine(boost) {
  const when = every();
  return boost <= 1
    ? t`You both earn 1 free card ${when}`
    : t`You each earn ${boost} free cards ${when}`;
}

export function monthLine(month, cap = TOGETHER_MONTH_CAP) {
  return t`This month: ${month} of ${cap} cards`;
}

export function capLine(cap = TOGETHER_MONTH_CAP) {
  return t`That's this month's ${cap}. More next month.`;
}

// Said only while a bigger group would earn more.
export function groupHint(boost) {
  if (boost >= TOGETHER_MAX_BOOST) return null;
  const group = boost + 2;
  const cardsText = plural(boost + 1, { one: '# card', other: '# cards' });
  const when = every();
  return t`With ${group} of you: ${cardsText} ${when}`;
}

// The note when someone arrives (at most once a day per device).
export function arrivalNote(names, others = Array.isArray(names) ? names.length : 0) {
  if (!known(names)) {
    return others <= 1
      ? t`Someone's here. You're both earning cards while you work together.`
      : plural(others, { other: '# people are here. You\'re all earning cards while you work together.' });
  }
  const [first, second] = names;
  if (others <= 1) return t`${first}'s here. You're both earning cards while you work together.`;
  if (others === 2 && names.length === 2) return t`${first} and ${second} are here. You're all earning cards while you work together.`;
  const rest = others - 1;
  return t`${first} and ${rest} others are here. You're all earning cards while you work together.`;
}

// Settings › Invite and earn.
export function settingsLine(month, cap = TOGETHER_MONTH_CAP) {
  return t`${month} of ${cap} cards this month`;
}
