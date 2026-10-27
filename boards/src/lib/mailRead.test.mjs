import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMail, letterParagraphs } from './mailRead.js';
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
  const m = await readMail(new TextEncoder().encode(EML), 'eml');
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
  const m = await readMail(msg, 'msg');
  assert.equal(m.subject, 'Re: Day 4 call times');
  assert.deepEqual(m.to, [{ name: 'Mara Ellison', address: 'mara@example.com' }]);
  assert.equal(m.date, new Date(Number((133000000000000000n - 116444736000000000n) / 10000n)).toISOString());
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'call-sheet.pdf');
  assert.equal(m.attachments[0].size, 13);
  assert.equal(m.inline.size, 0);
  assert.deepEqual(letterParagraphs(m.text, 5), ['Crew call is 05:30.', 'See you at the dock.']);
});
