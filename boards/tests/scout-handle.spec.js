// Unit tests for Scout handle normalization (lib/scoutIdentity.js).
//
// The (platform, handle) unique index IS the routing table. One person must
// always produce ONE handle — a handle that varies between messages silently
// creates a SECOND account for someone who already exists, and their board
// appears to vanish.
//
// The international case is the dangerous one. A UK mobile in national form
// (7911123456) is ten digits, exactly like a US number, so without a country
// hint it normalizes to +17911123456: valid-looking, completely wrong, and
// invisible until someone loses their board.

import { expect, test } from '@playwright/test';
import { normalizeHandle } from '../src/lib/scoutIdentity.js';

test('E.164 passes through untouched — the expected provider format', () => {
  expect(normalizeHandle('+15551234567')).toBe('+15551234567');
  expect(normalizeHandle('+447911123456')).toBe('+447911123456');
  expect(normalizeHandle('+61412345678')).toBe('+61412345678');
  // Formatting noise must not change the key.
  expect(normalizeHandle('+1 (555) 123-4567')).toBe('+15551234567');
  expect(normalizeHandle('  +44 7911 123456 ')).toBe('+447911123456');
});

test('the same number in different formats yields ONE key', () => {
  const forms = ['+15551234567', '+1 555 123 4567', '(555) 123-4567', '15551234567', '555-123-4567'];
  const keys = new Set(forms.map((f) => normalizeHandle(f, 'US')));
  expect([...keys]).toEqual(['+15551234567']);
});

test('a country hint prevents a foreign number becoming a US number', () => {
  // THE bug this file exists for. Ten digits, indistinguishable from NANP.
  expect(normalizeHandle('7911123456', 'GB')).toBe('+447911123456');
  expect(normalizeHandle('7911123456')).toBe('+17911123456');   // no hint → wrong, and known to be
  // With the hint, UK national form (leading trunk 0) also lands correctly.
  expect(normalizeHandle('07911123456', 'GB')).toBe('+447911123456');
});

test('the national trunk zero is stripped, except where it is part of the number', () => {
  expect(normalizeHandle('0412345678', 'AU')).toBe('+61412345678');
  expect(normalizeHandle('01722123456', 'DE')).toBe('+491722123456');
  expect(normalizeHandle('0612345678', 'FR')).toBe('+33612345678');
  // Italy keeps its leading zero — it's part of the subscriber number, not a
  // trunk prefix. Rome is a real production city; getting this wrong matters.
  expect(normalizeHandle('0612345678', 'IT')).toBe('+390612345678');
});

test('production-hub countries all resolve', () => {
  // Places films actually shoot; a missing dialing code here means silent
  // account duplication for a whole country.
  const cases = [
    ['CA', '+1'], ['GB', '+44'], ['IE', '+353'], ['HU', '+36'], ['CZ', '+420'],
    ['ZA', '+27'], ['NZ', '+64'], ['AU', '+61'], ['MA', '+212'], ['IN', '+91'],
    ['MX', '+52'], ['BR', '+55'], ['JP', '+81'], ['KR', '+82'], ['ES', '+34'],
  ];
  for (const [iso, prefix] of cases) {
    expect(normalizeHandle('5551234', iso), `${iso} should map to ${prefix}`).toContain(prefix);
  }
});

test('an unguessable number is marked, not invented', () => {
  // Better a stable, obviously-wrong key that shows up in logs than a
  // plausible E.164 nobody ever questions.
  expect(normalizeHandle('12345', 'ZZ')).toBe('unknown:12345');
  expect(normalizeHandle('123456789012345')).toBe('unknown:123456789012345');
  // Still STABLE — the same input always gives the same key, so the user stays
  // routed to one account even while the format is unresolved.
  expect(normalizeHandle('12345', 'ZZ')).toBe(normalizeHandle('1 2 3 4 5', 'ZZ'));
});

test('Apple ID / email handles lowercase and stay intact', () => {
  expect(normalizeHandle('Person@Example.com')).toBe('person@example.com');
  expect(normalizeHandle('  Crew@Studio.CO.UK ')).toBe('crew@studio.co.uk');
});

test('empty and junk input never throws', () => {
  for (const bad of ['', '   ', null, undefined, '-', '()']) {
    expect(() => normalizeHandle(bad)).not.toThrow();
  }
  expect(normalizeHandle('')).toBe('');
  expect(normalizeHandle(null)).toBe('');
});

test('country casing does not matter', () => {
  expect(normalizeHandle('7911123456', 'gb')).toBe(normalizeHandle('7911123456', 'GB'));
});
