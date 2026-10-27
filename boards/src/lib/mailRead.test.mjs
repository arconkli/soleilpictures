import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMail, letterParagraphs, letterCard, letterBlocks, inlinePart, isCfb, attachmentName, pictureType } from './mailRead.js';
import { writeCfb, utf16le, props } from './testCfb.mjs';

const EML = [
  'From: Ines Carvalho <ines@example.com>', 'To: Mara Ellison <mara@example.com>', 'Cc: Theo Park <theo@example.com>',
  'Subject: =?UTF-8?Q?Re:_Day_4_call_times_=E2=80=94_dock?=', 'Date: Mon, 13 Oct 2026 21:04:00 +0000',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
  '--b1', 'Content-Type: multipart/alternative; boundary="b2"', '',
  '--b2', 'Content-Type: text/plain; charset=utf-8', '', 'Crew call is 05:30.', '', '> Can we push crew call?', '',
  '--b2', 'Content-Type: text/html; charset=utf-8', '', '<p>Crew call is <b>05:30</b>.</p><img src="cid:logo1"><img src="https://tracker.example/p.gif">', '',
  '--b2--',
  '--b1', 'Content-Type: image/png', 'Content-ID: <logo1>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '',
  '--b1', 'Content-Type: application/pdf; name="call-sheet.pdf"', 'Content-Disposition: attachment; filename="call-sheet.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQ=', '',
  '--b1--', '',
].join('\r\n');

test('an .eml reads as a letter: decoded subject, people, date, both bodies, its one real attachment', async () => {
  const m = await readMail(new TextEncoder().encode(EML));
  assert.equal(m.subject, 'Re: Day 4 call times — dock');
  assert.deepEqual(m.from, { name: 'Ines Carvalho', address: 'ines@example.com' });
  assert.deepEqual(m.cc, [{ name: 'Theo Park', address: 'theo@example.com' }]);
  assert.equal(m.date, '2026-10-13T21:04:00.000Z');
  assert.match(m.html, /cid:logo1/);
  assert.deepEqual(m.attachments.map((a) => a.filename), ['call-sheet.pdf']);
  assert.equal(m.attachments[0].size, 8);
  assert.equal(m.inline.get('logo1').mimeType, 'image/png');
  assert.deepEqual(letterParagraphs(m.text, 5), ['Crew call is 05:30.']);
});

test('a .msg reads through msgRead into the same shape', async () => {
  const msg = writeCfb({ name: 'Root Entry', children: [
    { name: '__substg1.0_0037001F', data: utf16le('Re: Day 4 call times') },
    { name: '__substg1.0_0C1A001F', data: utf16le('Ines Carvalho') },
    { name: '__substg1.0_5D01001F', data: utf16le('ines@example.com') },
    { name: '__substg1.0_1000001F', data: utf16le('Crew call is 05:30.\r\n\r\nSee you at the dock.') },
    { name: '__properties_version1.0', data: props(32, [[0x00390040, 133000000000000000n]]) },
    { name: '__recip_version1.0_#00000000', children: [
      { name: '__substg1.0_3001001F', data: utf16le('Mara Ellison') },
      { name: '__substg1.0_39FE001F', data: utf16le('mara@example.com') },
      { name: '__properties_version1.0', data: props(8, [[0x0C150003, 1n]]) },
    ] },
    { name: '__attach_version1.0_#00000000', children: [
      { name: '__substg1.0_3707001F', data: utf16le('call-sheet.pdf') },
      { name: '__substg1.0_370E001F', data: utf16le('application/pdf') },
      { name: '__substg1.0_37010102', data: new TextEncoder().encode('%PDF-1.4 tiny') },
    ] },
  ] }, { miniCutoff: 4096 });
  assert.ok(isCfb(msg));
  const m = await readMail(msg);
  assert.equal(m.subject, 'Re: Day 4 call times');
  assert.deepEqual(m.to, [{ name: 'Mara Ellison', address: 'mara@example.com' }]);
  assert.equal(m.date, new Date(Number((133000000000000000n - 116444736000000000n) / 10000n)).toISOString());
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'call-sheet.pdf');
  assert.equal(m.attachments[0].size, 13);
  assert.equal(m.inline.size, 0);
  assert.deepEqual(letterParagraphs(m.text, 5), ['Crew call is 05:30.', 'See you at the dock.']);
});

test('a message is read by what it is, not what it is called: MIME saved as .msg reads as MIME', async () => {
  const bytes = new TextEncoder().encode(EML);
  assert.equal(isCfb(bytes), false);
  assert.equal((await readMail(bytes)).subject, 'Re: Day 4 call times — dock');
});

test('the HTML\'s cid: pictures are found however the URL spells the id', async () => {
  const m = await readMail(new TextEncoder().encode(EML));
  assert.equal(inlinePart(m, 'cid:logo1').mimeType, 'image/png');
  assert.equal(inlinePart(m, ' CID:%3CLogo1%3E').mimeType, 'image/png');
  assert.equal(inlinePart(m, 'cid:nope'), null);
  assert.equal(inlinePart(m, 'https://tracker.example/p.gif'), null);
});

test("a card's paragraphs stop where the letter does: quotes and what brings them in, a signature, an Outlook rule", () => {
  assert.deepEqual(letterParagraphs('Hi all.\n\nOn Mon 13 Oct 2026, Mara Ellison wrote:\n> Can we push?\n> Please', 5), ['Hi all.']);
  assert.deepEqual(letterParagraphs('Hi all.\n\nOn Mon, Mara wrote:\n\n> Can we push?\n\nYes we can.', 5), ['Hi all.', 'Yes we can.']);
  assert.deepEqual(letterParagraphs('Thanks,\nIris\n-- \nIris Chen\n1st AD', 5), ['Thanks, Iris']);
  assert.deepEqual(letterParagraphs('Thanks\n\n-----Original Message-----\nFrom: Mara', 5), ['Thanks']);
  assert.deepEqual(letterParagraphs('Thanks\n\n________________________________\nFrom: Mara', 5), ['Thanks']);
  assert.deepEqual(letterParagraphs('a\n\nb\n\nc', 2), ['a', 'b']);
});

test("a card keeps no attachment's bytes, and none at all from a message read in part; something that isn't a letter is null", async () => {
  const m = await readMail(new TextEncoder().encode(EML));
  const c = letterCard(m);
  assert.equal(c.subject, 'Re: Day 4 call times — dock');
  assert.deepEqual(c.attachments, [{ filename: 'call-sheet.pdf', mimeType: 'application/pdf', size: 8 }]);
  assert.deepEqual(c.paragraphs, ['Crew call is 05:30.']);
  assert.equal(letterCard(m, { complete: false }).attachments, null);
  assert.equal(letterCard(await readMail(new TextEncoder().encode('just some words\n'))), null);
});

test("plain text reads as the letter's paragraphs and its quotes, the line that brings a quote in going with it", () => {
  const text = 'Hi all,\nupdated times.\n\nIris\n\nOn Mon 13 Oct 2026, Mara Ellison wrote:\n> Can we push crew call?\n>\n> I would rather lose the first setup.\n\nAnd one more thing.';
  assert.deepEqual(letterBlocks(text), [
    { quote: false, text: 'Hi all,\nupdated times.' },
    { quote: false, text: 'Iris' },
    { quote: true, paras: ['On Mon 13 Oct 2026, Mara Ellison wrote:', 'Can we push crew call?', 'I would rather lose the first setup.'] },
    { quote: false, text: 'And one more thing.' },
  ]);
  assert.deepEqual(letterBlocks('Yes.\nOn Mon, Mara wrote:\n> Push it?'), [
    { quote: false, text: 'Yes.' },
    { quote: true, paras: ['On Mon, Mara wrote:', 'Push it?'] },
  ]);
  assert.deepEqual(letterBlocks(''), []);
});

test("an attachment is saved under a name with its extension; a picture's type is found by its bytes when it isn't said", () => {
  assert.equal(attachmentName({ filename: 'call-sheet.pdf', mimeType: 'application/pdf' }, 0), 'call-sheet.pdf');
  assert.equal(attachmentName({ filename: '', mimeType: 'text/calendar' }, 1), 'Attachment 2.ics');
  assert.equal(attachmentName({ filename: '', mimeType: 'application/x-what' }, 0), 'Attachment 1');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(pictureType({ mimeType: 'image/PNG', content: png }), 'image/png');
  assert.equal(pictureType({ mimeType: '', content: png }), 'image/png');
  assert.equal(pictureType({ mimeType: 'application/octet-stream', content: new Uint8Array([1, 2, 3, 4, 5]) }), null);
  assert.equal(pictureType({ mimeType: '', content: new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ') }), 'image/webp');
});

test("an HTML-only letter's card text leaves out what it quotes, as a plain one's does", async () => {
  const eml = [
    'From: Iris Chen <iris@example.com>', 'Subject: Re: dock', 'Content-Type: text/html; charset=utf-8', '',
    '<div>Thanks &amp; see you</div><div>On Mon, Mara wrote:</div><blockquote><p>Can we push?</p><blockquote><p>Older</p></blockquote><p>Please</p></blockquote><p>PS: wear boots</p>', '',
  ].join('\r\n');
  const m = await readMail(new TextEncoder().encode(eml));
  assert.deepEqual(letterParagraphs(m.text, 5), ['Thanks & see you', 'PS: wear boots']);
});
