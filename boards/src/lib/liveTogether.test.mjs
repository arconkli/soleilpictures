// The words and the wire format of working live together (liveTogether.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  togetherBoost, togetherMessage, readTogether, TOGETHER_ENDED,
  chipLabel, chipShortLabel, chipAria, togetherTitle, rateLine, monthLine,
  capLine, groupHint, arrivalNote, settingsLine, rewardCardsBeyondTogether,
} from './liveTogether.js';
import { ROOM_ANSWERS } from './roomAck.js';

test('togetherBoost', () => {
  for (const [n, b] of [[0, 0], [1, 0], [2, 1], [3, 2], [4, 3], [10, 3], ['x', 0], [2.9, 1]]) {
    assert.equal(togetherBoost(n), b, String(n));
  }
});

const good = { peers: ['a', 'b'], boost: 2, earned: 3, month: 9, cap: 25, capped: false, progress: 0.25 };

test('togetherMessage round-trips through readTogether', () => {
  assert.deepEqual(readTogether(togetherMessage(good)), { on: true, ...good });
  assert.equal(readTogether(togetherMessage({ ...good, progress: 0.456 })).progress, 0.46);
  assert.equal(readTogether(togetherMessage({ ...good, progress: -1 })).progress, 0);
  assert.equal(readTogether(togetherMessage({ ...good, progress: 2 })).progress, 1);
});

test('the ended message', () => {
  assert.deepEqual(readTogether(TOGETHER_ENDED), { on: false });
});

test('readTogether refuses anything else', () => {
  const wire = (o) => JSON.stringify({ t: 'together', on: true, ...good, ...o });
  const bad = [
    'not json', ROOM_ANSWERS,
    JSON.stringify({ t: 'other', on: true, ...good }),
    JSON.stringify({ t: 'together', ...good }),
    wire({ peers: 'a' }), wire({ peers: [1] }),
    wire({ peers: Array.from({ length: 101 }, (_, i) => `p${i}`) }),
    wire({ boost: 0 }), wire({ boost: 4 }),
    wire({ earned: -1 }), wire({ earned: 1.5 }),
    wire({ cap: 0 }), wire({ capped: 'yes' }),
    wire({ progress: NaN }), wire({ progress: -0.1 }), wire({ progress: 1.1 }),
  ];
  for (const b of bad) assert.equal(readTogether(b), null, b.slice(0, 60));
});

test('copy, exact', () => {
  assert.equal(chipLabel(0), 'Together');
  assert.equal(chipLabel(1), 'Together · +1 card');
  assert.equal(chipLabel(3), 'Together · +3 cards');
  assert.equal(chipShortLabel(0), '');
  assert.equal(chipShortLabel(3), '+3');
  assert.equal(chipAria(0), 'Working together');
  assert.equal(chipAria(2), 'Working together, 2 cards earned');
  assert.equal(togetherTitle(['Lena']), 'You and Lena are working together');
  assert.equal(togetherTitle(['Lena', 'Sam']), 'You, Lena and Sam are working together');
  assert.equal(togetherTitle(['A', 'B', 'C']), 'You and 3 others are working together');
  assert.equal(togetherTitle([], 1), 'You and 1 other person are working together');
  assert.equal(togetherTitle([''], 1), 'You and 1 other person are working together');
  assert.equal(rateLine(1), 'You both earn 1 free card every 2 minutes');
  assert.equal(rateLine(2), 'You each earn 2 free cards every 2 minutes');
  assert.equal(monthLine(9, 25), 'This month: 9 of 25 cards');
  assert.equal(capLine(25), "That's this month's 25. More next month.");
  assert.equal(groupHint(1), 'With 3 of you: 2 cards every 2 minutes');
  assert.equal(groupHint(2), 'With 4 of you: 3 cards every 2 minutes');
  assert.equal(groupHint(3), null);
  assert.equal(arrivalNote(['Lena']), "Lena's here. You're both earning cards while you work together.");
  assert.equal(arrivalNote(['Lena', 'Sam']), "Lena and Sam are here. You're all earning cards while you work together.");
  assert.equal(arrivalNote(['Lena', 'Sam', 'Ana']), "Lena and 2 others are here. You're all earning cards while you work together.");
  assert.equal(arrivalNote([], 1), "Someone's here. You're both earning cards while you work together.");
  assert.equal(arrivalNote([], 3), "3 people are here. You're all earning cards while you work together.");
  assert.equal(settingsLine(9), '9 of 25 cards this month');
});

test('the quiet rule: no boost, multipliers, hurry or countdowns', () => {
  const all = [
    chipLabel(0), chipLabel(1), chipLabel(3), chipShortLabel(3), chipAria(0), chipAria(2),
    togetherTitle(['Lena']), togetherTitle(['Lena', 'Sam']), togetherTitle(['A', 'B', 'C']), togetherTitle([], 1),
    rateLine(1), rateLine(2), monthLine(9, 25), capLine(25), groupHint(1), groupHint(2),
    arrivalNote(['Lena']), arrivalNote(['Lena', 'Sam']), arrivalNote(['Lena', 'Sam', 'Ana']),
    arrivalNote([], 1), arrivalNote([], 3), settingsLine(9),
  ];
  for (const s of all) assert.doesNotMatch(s, /boost|\bx\d|×|hurry|left/i, s);
});

test('rewardCardsBeyondTogether announces only what the together count does not explain', () => {
  const a = { bonus: 100, lifetime: 3 };
  assert.equal(rewardCardsBeyondTogether(null, null, 25), 25);
  assert.equal(rewardCardsBeyondTogether(a, null, 2), 0);
  assert.equal(rewardCardsBeyondTogether(null, a, 2), 0);
  assert.equal(rewardCardsBeyondTogether(a, { bonus: 103, lifetime: 6 }, 3), 0);
  assert.equal(rewardCardsBeyondTogether(a, { bonus: 127, lifetime: 5 }, 27), 25);
  assert.equal(rewardCardsBeyondTogether(a, { bonus: 100, lifetime: 5 }, 1), 0);
});
