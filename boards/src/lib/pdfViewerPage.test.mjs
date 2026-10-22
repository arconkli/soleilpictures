// Source pins: PdfViewer reports its page and honours a page request, and
// stays unchanged for callers that pass neither prop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/PdfViewer.jsx', import.meta.url), 'utf8');

test('signature carries both props with null defaults', () => {
  assert.match(src, /export function PdfViewer\(\{[^}]*onPageChange = null[^}]*\}\)/);
  assert.match(src, /export function PdfViewer\(\{[^}]*pageRequest = null[^}]*\}\)/);
});

test('onPageChange is read through a ref', () => {
  assert.match(src, /const onPageChangeRef = useRef\(onPageChange\)/);
  assert.match(src, /onPageChangeRef\.current = onPageChange/);
  assert.match(src, /onPageChangeRef\.current\?\.\(current\)/);
});

test('pageRequest nonce drives an effect that reuses scrollToPage', () => {
  assert.match(src, /\[status, pageRequest\?\.nonce, pageRequest\?\.page, scrollToPage\]/);
  assert.match(src, /scrollToPage\(pageRequest\.page\)/);
});
