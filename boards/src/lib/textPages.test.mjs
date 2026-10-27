import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headLines, sniffSep, parseDelimited, parseCues, stageTable } from './textPages.js';

test('lines: CRLF and CR read as LF, no phantom last line, a cut last line dropped', () => {
  assert.deepEqual(headLines('a\r\nb\rc\n'), ['a', 'b', 'c']);
  assert.deepEqual(headLines('a\nb\nhal', { complete: false }), ['a', 'b']);
  assert.deepEqual(headLines('one long cut line', { complete: false }), ['one long cut line']);
  assert.deepEqual(headLines('1\n2\n3\n4', { max: 2 }), ['1', '2']);
});

test('the separator: a tab for .tsv, else whichever of , ; or tab the first line has most of', () => {
  assert.equal(sniffSep('a\tb', 'tsv'), '\t');
  assert.equal(sniffSep('Name;Role;Call\nA;B;C', 'csv'), ';');
  assert.equal(sniffSep('Name,Role\nA,B', 'csv'), ',');
  assert.equal(sniffSep('"x;y",z', 'csv'), ',');
});

test('CSV: quotes, doubled quotes, newlines inside quotes, a cut last row dropped', () => {
  const { rows, more } = parseDelimited('Name,Note\n"Ellison, Mara","said ""go""\nthen left"\nPark,ok\nVo', { sep: ',', complete: false });
  assert.deepEqual(rows, [['Name', 'Note'], ['Ellison, Mara', 'said "go"\nthen left'], ['Park', 'ok']]);
  assert.equal(more, true);
  assert.deepEqual(parseDelimited('a,b\r\n1,2\r\n', { sep: ',' }), { rows: [['a', 'b'], ['1', '2']], more: false });
  assert.deepEqual(parseDelimited('a\n1\n2\n3', { sep: ',', maxRows: 2 }), { rows: [['a'], ['1']], more: true });
  assert.deepEqual(parseDelimited('a,b\n1,', { sep: ',' }).rows, [['a', 'b'], ['1', '']]);
});

test('cues from SRT and WebVTT: numbers, times, text without tags; headers and notes skipped', () => {
  const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n{\\an8}Up top\r\nsecond line\r\n';
  assert.deepEqual(parseCues(srt), [
    { n: '1', start: '00:00:01,000', end: '00:00:03,500', text: 'Hello there' },
    { n: '2', start: '00:00:04,000', end: '00:00:05,000', text: 'Up top\nsecond line' },
  ]);
  const vtt = 'WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 align:start\nTom &amp; Jerry\n\n00:03.000 --> 00:04.000\n<v Mara>Go</v>\n';
  assert.deepEqual(parseCues(vtt), [
    { n: 'intro', start: '00:01.000', end: '00:02.000', text: 'Tom & Jerry' },
    { n: '2', start: '00:03.000', end: '00:04.000', text: 'Go' },
  ]);
  assert.equal(parseCues(srt, { max: 1 }).length, 1);
});

test("Quick look's table: its header, then rows up to the ceiling, fewer for a wide one, never fewer than 100", () => {
  assert.deepEqual(stageTable('Name,Role\nMara,Director\nPark,DP\n', { ext: 'csv' }),
    { head: ['Name', 'Role'], body: [['Mara', 'Director'], ['Park', 'DP']], cols: 2, more: false });
  assert.equal(stageTable('a;b\n1;2', { ext: 'csv' }).cols, 2);
  assert.equal(stageTable('a\tb\n1\t2\t3', { ext: 'tsv' }).cols, 3);
  const tall = ['n', ...Array.from({ length: 30 }, (_, i) => String(i))].join('\n');
  const capped = stageTable(tall, { maxRows: 20 });
  assert.equal(capped.body.length, 20);
  assert.equal(capped.more, true);
  assert.equal(stageTable(tall, { maxRows: 30 }).more, false);
  // A head that was cut has more rows past it, however few it shows.
  assert.equal(stageTable('a\n1\n2', { complete: false }).more, true);
  const wideRow = Array.from({ length: 1000 }, (_, i) => `c${i}`).join(',');
  const wide = stageTable(Array.from({ length: 300 }, () => wideRow).join('\n'), { maxRows: 5000, maxCells: 100_000 });
  assert.equal(wide.cols, 1000);
  assert.equal(wide.body.length, 100);
  assert.equal(wide.more, true);
  const mid = stageTable(Array.from({ length: 3000 }, () => 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y').join('\n'), { maxRows: 5000, maxCells: 50_000 });
  assert.equal(mid.body.length, 2000);
});
