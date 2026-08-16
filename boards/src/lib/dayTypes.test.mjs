// The day-type palette.
//
// Two properties carry the weight here.
//
// IT IS DATA, NOT AN ENUM. The app is for creative production generally, so the
// words a team uses for its phases cannot live in the schema or in this file's
// constants. What these tests guard is that a production CAN replace them and
// that an untouched production still gets sensible defaults with no write.
//
// IT IS CLIENT-WRITABLE. 0247 grants boards.day_types because a list of names
// and colours gates nothing — unlike sched_status, which decides whether a
// notification fires. That makes this module a trust boundary: whatever comes
// back from PostgREST is about to become a CSS custom property, so a colour
// that is not a hex triple must not reach the DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DAY_TYPES, DEFAULT_DAY_TYPE, dayTypesFor, resolveDayType,
  dayTypeColor, dayTypeName, serializeDayTypes,
} from './dayTypes.js';

test('the defaults are generic, not one industry’s vocabulary', () => {
  const ids = DEFAULT_DAY_TYPES.map((t) => t.id);
  assert.deepEqual(ids, ['prep', 'main', 'travel', 'off', 'wrap', 'milestone']);
  assert.ok(DEFAULT_DAY_TYPES.every((t) => t.name && t.color));
  assert.ok(ids.includes(DEFAULT_DAY_TYPE));
});

test('no default is gold, because --soleil is reserved for interaction', () => {
  // A resting day tinted amber would read as selected. Reject the whole
  // orange/amber wedge rather than only the exact token.
  for (const { id, color } of DEFAULT_DAY_TYPES) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    const amber = r > 200 && g > 120 && g < 210 && b < 100;
    assert.ok(!amber, `${id} (${color}) is in the reserved gold range`);
  }
});

test('a production with no palette gets the defaults, with nothing written', () => {
  assert.equal(dayTypesFor(null), DEFAULT_DAY_TYPES);
  assert.equal(dayTypesFor({}), DEFAULT_DAY_TYPES);
  assert.equal(dayTypesFor({ day_types: [] }), DEFAULT_DAY_TYPES);
  assert.equal(dayTypesFor({ day_types: 'not an array' }), DEFAULT_DAY_TYPES);
});

test('a production can replace the vocabulary entirely', () => {
  const studio = {
    day_types: [
      { id: 'sprint', name: 'Sprint', color: '#4f8df8' },
      { id: 'playtest', name: 'Playtest', color: '#10b981' },
      { id: 'ship', name: 'Ship', color: '#ec4899' },
    ],
  };
  const types = dayTypesFor(studio);
  assert.deepEqual(types.map((t) => t.name), ['Sprint', 'Playtest', 'Ship']);
  assert.equal(dayTypeName({ day_type: 'playtest' }, types), 'Playtest');
  assert.equal(dayTypeColor({ day_type: 'ship' }, types), '#ec4899');
});

test('a hand-edited palette cannot inject a style value', () => {
  const types = dayTypesFor({
    day_types: [
      { id: 'x', name: 'X', color: 'red; background: url(//evil)' },
      { id: 'y', name: 'Y', color: '#GGGGGG' },
      { id: 'z', name: 'Z', color: '#4f8df8' },
    ],
  });
  // Bad colours degrade to no tint; the TYPE survives, so days keep grouping.
  assert.equal(types[0].color, null);
  assert.equal(types[1].color, null);
  assert.equal(types[2].color, '#4f8df8');
  assert.equal(dayTypeColor({ day_type: 'x' }, types), null);
});

test('entries without an id are dropped, and duplicate ids collapse', () => {
  const types = dayTypesFor({
    day_types: [
      { name: 'No id', color: '#4f8df8' },
      { id: 'a', name: 'First', color: '#10b981' },
      { id: 'a', name: 'Second', color: '#ec4899' },
      null, 'nope', 42,
    ],
  });
  assert.deepEqual(types.map((t) => t.id), ['a']);
  assert.equal(types[0].name, 'First', 'first wins');
});

test('a day whose type was deleted renders neutral instead of orphaned', () => {
  const types = dayTypesFor({ day_types: [{ id: 'a', name: 'A', color: '#4f8df8' }] });
  assert.equal(resolveDayType('gone', types), null);
  assert.equal(dayTypeColor({ day_type: 'gone' }, types), null);
  assert.equal(dayTypeName({ day_type: 'gone' }, types), '');
});

test('a cancelled day stops flying its phase colour', () => {
  const types = DEFAULT_DAY_TYPES;
  assert.equal(dayTypeColor({ day_type: 'main' }, types), '#4f8df8');
  assert.equal(dayTypeColor({ day_type: 'main', sched_status: 'cancelled' }, types), null);
  assert.equal(dayTypeColor(null, types), null);
});

test('an untouched palette serializes to NULL, so no row is written', () => {
  assert.equal(serializeDayTypes(DEFAULT_DAY_TYPES.map((t) => ({ ...t }))), null);
  assert.equal(serializeDayTypes([]), null);
  assert.equal(serializeDayTypes(null), null);
});

test('one renamed type is enough to make the palette worth persisting', () => {
  const edited = DEFAULT_DAY_TYPES.map((t) => (t.id === 'main' ? { ...t, name: 'Shoot' } : { ...t }));
  const out = serializeDayTypes(edited);
  assert.ok(Array.isArray(out));
  assert.equal(out.find((t) => t.id === 'main').name, 'Shoot');
});
