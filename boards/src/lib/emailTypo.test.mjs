// emailTypo.test.mjs — a mistyped consumer domain gets a one-tap fix.
//
//   node --test src/lib/emailTypo.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestEmail, emailProblem } from './emailTypo.js';

test('common gmail/hotmail/yahoo typos map to the real domain, local part preserved', () => {
  assert.deepEqual(suggestEmail('me@gmail.como'), { suggestion: 'me@gmail.com', fromDomain: 'gmail.como', toDomain: 'gmail.com' });
  for (const [from, to] of [
    ['gmasil.com', 'gmail.com'], ['gmal.com', 'gmail.com'], ['gmial.com', 'gmail.com'], ['gamil.com', 'gmail.com'],
    ['gmail.co', 'gmail.com'], ['gmail.con', 'gmail.com'], ['gmail.cm', 'gmail.com'], ['gmaill.com', 'gmail.com'],
    ['hotmal.com', 'hotmail.com'], ['hotmail.co', 'hotmail.com'], ['yaho.com', 'yahoo.com'], ['yahoo.co', 'yahoo.com'],
    ['outlok.com', 'outlook.com'], ['iclould.com', 'icloud.com'], ['icloud.co', 'icloud.com'],
  ]) {
    const r = suggestEmail(`Andrew.Conklin+x@${from}`);
    assert.ok(r, from);
    assert.equal(r.toDomain, to, from);
    assert.equal(r.suggestion, `Andrew.Conklin+x@${to}`, from);
  }
});

test('a bare domain with no TLD gets .com when the name is a known provider', () => {
  assert.equal(suggestEmail('me@gmail')?.suggestion, 'me@gmail.com');
  assert.equal(suggestEmail('me@hotmail')?.suggestion, 'me@hotmail.com');
  assert.equal(suggestEmail('me@design'), null, 'an unknown bare name is not guessed');
});

test('never second-guesses a correct or unknown domain', () => {
  assert.equal(suggestEmail('me@gmail.com'), null);
  assert.equal(suggestEmail('me@studio.com'), null);
  assert.equal(suggestEmail('me@rfdesignsdbn.co.za'), null);
  assert.equal(suggestEmail('me@soleilpictures.com'), null);
  assert.equal(suggestEmail('me@proton.me'), null);
  assert.equal(suggestEmail('me@yahoo.co.uk'), null);
});

test('tolerates junk, case and whitespace', () => {
  assert.equal(suggestEmail(''), null);
  assert.equal(suggestEmail(null), null);
  assert.equal(suggestEmail('nope'), null);
  assert.equal(suggestEmail('a@b@c'), null);
  assert.deepEqual(suggestEmail('  Me@GMAIL.COMO '), { suggestion: 'Me@gmail.com', fromDomain: 'gmail.como', toDomain: 'gmail.com' }, 'domain lower-cased, local part kept');
});

test('an address with no real ending is refused: no dot, one letter, digits, a trailing dot', () => {
  for (const addr of ['me@ddsb', 'me@maildrop', 'me@a.m', 'me@sd', 'me@gmail', 'me@ddsb.', 'me@10.0.0.1', ' me@DDSB ', 'me@']) {
    assert.equal(emailProblem(addr), 'no_tld', addr);
  }
});

test('real addresses pass, including long, country and punycode endings', () => {
  for (const addr of ['me@gmail.com', 'me@yahoo.co.uk', 'me@fh-salzburg.ac.at', 'me@studio.photography',
    'me@proton.me', 'me@xn--80ak6aa92e.xn--p1ai', ' Me@Gmail.Com ', 'me@gmail.como', 'me@maildrop.cc']) {
    assert.equal(emailProblem(addr), null, addr);
  }
});

test('leaves malformed input to the browser and GoTrue', () => {
  for (const v of ['', null, undefined, 42, 'nope', '@gmail']) {
    assert.equal(emailProblem(v), null, String(v));
  }
});
