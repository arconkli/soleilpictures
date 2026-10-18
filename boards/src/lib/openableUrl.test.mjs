import test from 'node:test';
import assert from 'node:assert/strict';
import { openableUrl } from './openableUrl.js';

test('a bare host gets https://', () => {
  assert.equal(openableUrl('example.com'), 'https://example.com/');
  assert.equal(openableUrl('example.com/a/b?q=1'), 'https://example.com/a/b?q=1');
});

test('http and https are kept as written', () => {
  assert.equal(openableUrl('https://example.com/x'), 'https://example.com/x');
  assert.equal(openableUrl('http://example.com/x'), 'http://example.com/x');
  assert.equal(openableUrl('http:/example.com'), 'http://example.com/');
});

test('host:port is a bare host, not a scheme', () => {
  assert.equal(openableUrl('localhost:3000'), 'https://localhost:3000/');
  assert.equal(openableUrl('example.com:8080/x'), 'https://example.com:8080/x');
});

test('schemes that cannot open are refused, not prefixed', () => {
  assert.equal(openableUrl('blob:https://livettu.sharepoint.com/abc-123'), null);
  assert.equal(openableUrl('data:text/html,<b>x</b>'), null);
  assert.equal(openableUrl('javascript:alert(1)'), null);
  assert.equal(openableUrl('file:///etc/passwd'), null);
  assert.equal(openableUrl('foo:bar'), null);
});

test('mailto is kept', () => {
  assert.equal(openableUrl('mailto:a@b.co'), 'mailto:a@b.co');
});

test('whitespace is trimmed and empty input is null', () => {
  assert.equal(openableUrl('  https://example.com/  '), 'https://example.com/');
  assert.equal(openableUrl(''), null);
  assert.equal(openableUrl('   '), null);
  assert.equal(openableUrl(null), null);
  assert.equal(openableUrl(undefined), null);
});
