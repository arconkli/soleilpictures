// The boards engine's sounds and PDFs (scripts/engine/sounds.mjs, pdfs.mjs):
// what a Commons search may give a board, and the PDF's page. The parts that
// touch the network, ffmpeg or a browser run in the engine itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { licenceOk, readCommons, soundPickPrompt, SOUND } from '../../scripts/engine/sounds.mjs';
import { pdfHtml, pageCountOf, fileName, PDF } from '../../scripts/engine/pdfs.mjs';
import { pdfCardHeight } from './pdfThumb.js';
import { CREW, CREW_FIRST, crewOf, crewEmail, fakeCrewIds } from '../../scripts/engine/crew.mjs';
import { RULES } from '../../scripts/engine/recipe.mjs';

test('the crew signs the comments and casts the votes: enough of them, each on our own mailbox', () => {
  assert.ok(CREW.length >= RULES.voteUp[1] + RULES.voteDown[1], 'one ballot a person');
  assert.equal(new Set(CREW_FIRST.map((f) => f.toLowerCase())).size, CREW.length, 'first names tell them apart');
  for (const c of CREW) {
    assert.match(crewEmail(c.key), /^showcase\+crew-[a-z]+@soleilpictures\.com$/);
    assert.ok(!/^#c9a577$/i.test(c.color), 'never the gold');
  }
  assert.equal(crewOf('Priya, DP')?.key, 'priya');
  assert.equal(crewOf('tomas')?.key, 'tomas');
  assert.equal(crewOf('Tomás Varga')?.key, 'tomas');
  assert.equal(crewOf('Gus, gaffer'), null);
  assert.equal(crewOf(''), null);
  const ids = fakeCrewIds();
  assert.equal(ids.size, CREW.length);
  for (const id of ids.values()) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(fakeCrewIds(), ids);
});

test('a sound is taken only under a licence anyone may reuse with a credit', () => {
  for (const ok of ['Public domain', 'PD-self', 'CC0', 'CC-zero', 'CC BY 4.0', 'CC BY 3.0', 'CC-BY-2.5', 'CC BY']) assert.ok(licenceOk(ok), ok);
  for (const no of ['CC BY-SA 4.0', 'CC BY-NC 3.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 2.0', 'GFDL', '', null, 'All rights reserved']) assert.ok(!licenceOk(no), String(no));
});

const page = (pageid, index, title, ii) => ({ pageid, index, title, imageinfo: [ii] });
const info = (over = {}) => ({
  url: 'https://upload.wikimedia.org/x.ogg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:X.ogg',
  mime: 'audio/ogg', size: 2_000_000, duration: 120,
  extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: '<a href="/wiki/User:Ezwa">Ezwa</a>' },
    ImageDescription: { value: 'Waves on the harbour wall &amp; gulls.' } },
  ...over,
});

test('a Commons search keeps free recordings of a fitting length, in its own order, and drops talk', () => {
  const json = { query: { pages: {
    9: page(9, 3, 'File:Harbour at dawn.ogg', info()),
    1: page(1, 1, 'File:Rain on a tin roof.wav', info({ mime: 'audio/wav', duration: 64 })),
    2: page(2, 2, 'File:Foghorn.ogg', info({ extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } } })),
    3: page(3, 4, 'File:Click.ogg', info({ duration: 2 })),
    4: page(4, 5, 'File:LibriVox chapter 3.ogg', info()),
    5: page(5, 6, 'File:En-us-harbour.ogg', info()),
    6: page(6, 7, 'File:Film still.jpg', info({ mime: 'image/jpeg' })),
    7: page(7, 8, 'File:Whole day of traffic.ogg', info({ duration: SOUND.maxSec + 1 })),
    8: page(8, 9, 'File:Huge.flac', info({ size: SOUND.maxBytes + 1 })),
    10: page(10, 10, 'File:LL-Q1860 (eng)-harbour.wav', info()),
    11: page(11, 11, 'File:Sea-waves at Penmon.ogg', info()),
  } } };
  const out = readCommons(json);
  assert.deepEqual(out.map((c) => c.title), ['Rain on a tin roof', 'Harbour at dawn', 'Sea-waves at Penmon']);
  const h = out[1];
  assert.equal(h.id, 'commons:9');
  assert.equal(h.artist, 'Ezwa');
  assert.equal(h.description, 'Waves on the harbour wall & gulls.');
  assert.equal(h.licence, 'CC BY 4.0');
  assert.deepEqual(readCommons({}), []);
});

test('Claude picks a sound from the titles, never spoken word', () => {
  const p = soundPickPrompt({ title: 'The Keeper', story: 'A lighthouse film.' }, { title: 'Foghorn and swell', caption: 'Room tone' },
    [{ title: 'Harbour at dawn', duration: 120.4, description: 'Gulls.' }]);
  assert.match(p, /1\. "Harbour at dawn" \(120s\) — Gulls\./);
  assert.match(p, /Never spoken word/);
  assert.match(p, /"Foghorn and swell": Room tone/);
});

test('a PDF is a Letter page with the production up top, set the same on screen as in print', () => {
  const args = { title: 'Call sheet — Day 3', markdown: '# Call sheet — Day 3\n\n| Time | Scene |\n|---|---|\n| 06:00 | Sc. 4 |\n\n<script>x</script>', production: 'The Keeper' };
  const print = pdfHtml(args);
  const screen = pdfHtml({ ...args, print: false });
  assert.match(print, /@page \{ size: Letter; margin: 64px; \}/);
  assert.match(print, /<b>The Keeper<\/b>/);
  // The Markdown's own heading repeats the title, so it is dropped: the title shows once.
  assert.equal(print.split('Call sheet — Day 3</h1>').length, 2);
  assert.match(print, /<table>/);
  assert.ok(!print.includes('<script>x'), 'raw HTML is never passed through');
  // On screen the margins are padding, so page 1 draws line for line as printed.
  assert.match(screen, new RegExp(`width: ${PDF.cssW}px; min-height: ${PDF.cssH}px; padding: ${PDF.margin}px`));
  assert.equal(PDF.cssW - 2 * PDF.margin, PDF.pageW / 72 * 96 - 2 * PDF.margin);
  // The card is the upload's own size for a Letter page.
  assert.equal(pdfCardHeight(PDF.cardW, PDF.pageW, PDF.pageH), 388);
});

test('a PDF\'s pages are counted from its bytes; its file name is safe', () => {
  const two = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] >>\n2 0 obj << /Type /Page >>\n3 0 obj <</Type/Page/Parent 1 0 R>>\n');
  assert.equal(pageCountOf(two), 2);
  assert.equal(pageCountOf(Buffer.from('nothing')), null);
  assert.equal(fileName('Call sheet — Day 3'), 'Call sheet - Day 3.pdf');
  assert.equal(fileName('../../etc/passwd'), '....etcpasswd.pdf');
  assert.equal(fileName(''), 'Document.pdf');
});
