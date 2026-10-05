// apiFileNames.test.mjs — an uploaded file keeps its own name through the API
// and MCP, the way a drop in the app keeps it (fileIngest.meaningfulFileName).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contentDisposition } from '../worker-api.js';
import { TOOLS } from './mcpTools.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

test('Content-Disposition carries an ASCII fallback and the exact UTF-8 name', () => {
  assert.equal(contentDisposition('diner_ext_dusk_04.jpg'),
    'inline; filename="diner_ext_dusk_04.jpg"; filename*=UTF-8\'\'diner_ext_dusk_04.jpg');
  const accented = contentDisposition('caf\u00e9 (final).jpg');
  assert.match(accented, /filename="caf_ \(final\)\.jpg"/, 'non-ASCII falls back to _ in the quoted form');
  assert.match(accented, /filename\*=UTF-8''caf%C3%A9%20%28final%29\.jpg$/, 'and RFC 5987 escapes ( ) too');
  // Quotes, backslashes and line breaks cannot break the header.
  assert.doesNotMatch(contentDisposition('a"b\\c\r\nX-Evil: 1.jpg'), /["\\]b|\r|\n/);
  assert.match(contentDisposition("it's.jpg"), /UTF-8''it%27s\.jpg$/, "an apostrophe would end charset''value early");
});

test('the upload routes keep the name, and the listing returns it', () => {
  const api = read('worker-api.js');
  assert.match(api, /const fileName = meaningfulFileName\(\{ name: url\.searchParams\.get\('filename'\) \|\| '' \}\);/,
    'POST /uploads?filename= must go through the same rule as a drop');
  assert.match(api, /const fileName = meaningfulFileName\(\{ name: typeof body\.filename === 'string' \? body\.filename : '' \}\);/,
    'multipart complete must accept filename too');
  assert.equal((api.match(/original_name: fileName,/g) || []).length, 2, 'both upload routes write images.original_name');
  assert.match(api, /select=id,storage_path,size_bytes,width,height,board_id,workspace_id,created_at,original_name/);
  assert.match(api, /file_name: r\.original_name \?\? null,/);
  assert.match(api, /'content-disposition': contentDisposition\(row\.original_name\)/);
});

test('MCP upload_image takes file_name and passes it on', () => {
  const tool = TOOLS.find((t) => t.name === 'upload_image');
  assert.ok(tool.inputSchema.properties.file_name, 'upload_image needs a file_name input');
  const seen = [];
  tool.call({ board_id: 'b', data: 'AA==', content_type: 'image/png', file_name: 'diner 04.png' },
    { api: (path) => { seen.push(path); return Promise.resolve({}); } });
  assert.equal(seen[0], '/uploads?board=b&filename=diner%2004.png');
  tool.call({ board_id: 'b', data: 'AA==', content_type: 'image/png' },
    { api: (path) => { seen.push(path); return Promise.resolve({}); } });
  assert.equal(seen[1], '/uploads?board=b', 'no name, no parameter');
});
