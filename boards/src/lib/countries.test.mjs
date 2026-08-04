// countries.test.mjs
//
// Unit test for the country display helpers. Run with:
//   cd boards && node src/lib/countries.test.mjs
//
// Plain Node ESM, no test framework — exit code 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs / op_classifier.test.mjs). Pure helpers, so no
// backend, no DOM.

import { normalizeCountry, countryName, countryFlag } from './countries.js';

let failed = 0;
let passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`);
    failed++;
  } else {
    passed++;
  }
}

// normalizeCountry — the gate every other helper runs through.
assertEq(normalizeCountry('US'), 'US', 'passes a well-formed code through');
assertEq(normalizeCountry('us'), 'US', 'uppercases');
assertEq(normalizeCountry('  gb  '), 'GB', 'trims surrounding whitespace');
assertEq(normalizeCountry('unknown'), null, "rejects the SQL 'unknown' sentinel");
assertEq(normalizeCountry('USA'), null, 'rejects 3-letter codes');
assertEq(normalizeCountry('U1'), null, 'rejects codes containing digits');
assertEq(normalizeCountry(''), null, 'rejects the empty string');
assertEq(normalizeCountry(null), null, 'rejects null');
assertEq(normalizeCountry(undefined), null, 'rejects undefined');
assertEq(normalizeCountry(42), null, 'rejects non-strings');

// countryName — total: always a renderable string, never a throw.
assertEq(countryName('US'), 'United States', 'names a country');
assertEq(countryName('gb'), 'United Kingdom', 'names a country case-insensitively');
assertEq(countryName('unknown'), 'Unknown', "renders the SQL sentinel as 'Unknown'");
assertEq(countryName(null), 'Unknown', "renders null as 'Unknown'");
assertEq(countryName(''), 'Unknown', "renders the empty string as 'Unknown'");

// countryFlag — regional-indicator math, with a globe for anything unusable.
assertEq(countryFlag('US'), '🇺🇸', 'builds a flag from a code');
assertEq(countryFlag('us'), '🇺🇸', 'builds a flag case-insensitively');
assertEq(countryFlag('unknown'), '🌐', 'falls back to a globe for the sentinel');
assertEq(countryFlag(null), '🌐', 'falls back to a globe for null');

console.log(`countries.test.mjs — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
