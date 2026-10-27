import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMsg } from './msgRead.js';
import { writeCfb, utf16le, props } from './testCfb.mjs';

const MSG = (mini) => writeCfb({ name: 'Root Entry', children: [
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
] }, { miniCutoff: mini ? 4096 : 0 });

for (const mini of [false, true]) {
  test(`an Outlook message reads its subject, people, date, body and attachments (${mini ? 'mini stream' : 'big sectors'})`, () => {
    const m = readMsg(MSG(mini));
    assert.equal(m.subject, 'Re: Day 4 call times');
    assert.deepEqual(m.from, { name: 'Ines Carvalho', address: 'ines@example.com' });
    assert.deepEqual(m.to, [{ name: 'Mara Ellison', address: 'mara@example.com' }]);
    assert.equal(m.date, new Date(Number((133000000000000000n - 116444736000000000n) / 10000n)).toISOString());
    assert.match(m.text, /^Crew call is 05:30\./);
    assert.equal(m.attachments.length, 1);
    assert.equal(m.attachments[0].filename, 'call-sheet.pdf');
    assert.equal(new TextDecoder().decode(m.attachments[0].content), '%PDF-1.4 tiny');
  });
}

test('anything that isn\'t a compound file is refused; a looping chain ends', () => {
  assert.throws(() => readMsg(new Uint8Array(600)), /not_msg/);
  const bad = MSG(false); // point the directory chain at itself
  const dv = new DataView(bad.buffer); const dirSector = dv.getUint32(0x30, true);
  const fatSector = dv.getUint32(0x4c, true);
  dv.setUint32(((fatSector + 1) << 9) + dirSector * 4, dirSector, true);
  assert.doesNotThrow(() => readMsg(bad));
});
