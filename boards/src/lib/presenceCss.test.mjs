import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssColor, cssString } from './presenceCss.js';

test('a peer colour is a hex colour or the default', () => {
  assert.equal(cssColor('#3b82f6'), '#3b82f6');
  assert.equal(cssColor('#abc'), '#abc');
  assert.equal(cssColor('#3b82f6cc'), '#3b82f6cc');
  assert.equal(cssColor('red'), '#ffa500');
  assert.equal(cssColor('#3b82f6; outline: none'), '#ffa500');
  assert.equal(cssColor('#3b82f6 } .x {'), '#ffa500');
  assert.equal(cssColor(undefined), '#ffa500');
  assert.equal(cssColor(42), '#ffa500');
});

test('a card id is used as it is, or not at all', () => {
  assert.equal(cssString('c_8f3a-2b'), 'c_8f3a-2b');
  assert.equal(cssString('link-1729561234567-12-345678'), 'link-1729561234567-12-345678');
  assert.equal(cssString('0f8fad5b-d9cb-469f-a165-70867728950e'), '0f8fad5b-d9cb-469f-a165-70867728950e');
  assert.equal(cssString('a"b'), '');
  assert.equal(cssString('a\\b'), '');
  assert.equal(cssString('a b'), '');
  assert.equal(cssString(''), '');
  assert.equal(cssString('x'.repeat(129)), '');
});
