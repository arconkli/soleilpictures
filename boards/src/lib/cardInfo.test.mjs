// What Info says (lib/cardInfo.js) — and how the drawer follows a selection
// (lib/infoBus.js targetForSelection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeCard, describeCluster, describeSelection, describeGroup, fileKeyOf, formatSize,
  formatLength, formatFps, codecName, kindBreakdown, sizeOf, clusterPath,
} from './cardInfo.js';
import { targetForSelection } from './infoBus.js';

const rows = (info) => Object.fromEntries(info.details.map((r) => [r.k, r.v]));
const meta = (m) => (key) => m[key] || null;

test('the key of the file a card holds, per kind', () => {
  assert.equal(fileKeyOf({ kind: 'image', src: 'r2:ws/a.webp' }), 'ws/a.webp');
  assert.equal(fileKeyOf({ kind: 'video', src: 'r2:ws/v.mp4', poster: 'r2:ws/p.webp' }), 'ws/v.mp4');
  assert.equal(fileKeyOf({ kind: 'pdf', src: 'r2:ws/cover.webp', pdfSrc: 'r2:ws/doc.pdf' }), 'ws/doc.pdf');
  assert.equal(fileKeyOf({ kind: 'file', fileSrc: 'r2:ws/f.zip' }), 'ws/f.zip');
  assert.equal(fileKeyOf({ kind: 'image', src: 'blob:local' }), '');
  assert.equal(fileKeyOf({ kind: 'note', html: 'x' }), '');
});

test('formatters', () => {
  assert.equal(formatSize(null), '');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(1536), '1.5 KB');
  assert.equal(formatSize(52 * 1024 * 1024), '52 MB');
  assert.equal(formatLength(7.4), '0:07');
  assert.equal(formatLength(245), '4:05');
  assert.equal(formatLength(3723), '1:02:03');
  assert.equal(formatFps([24000, 1001]), '23.976 fps');
  assert.equal(formatFps([25, 1]), '25 fps');
  assert.equal(formatFps([30000, 1001]), '29.97 fps');
  assert.equal(formatFps(null), '');
  assert.equal(codecName('avc1'), 'H.264');
  assert.equal(codecName('apch'), 'ProRes 422 HQ');
  assert.equal(codecName('zzzz'), 'ZZZZ');
});

test('an image: kind with format, its uploaded name, dimensions and size from the images row', () => {
  const card = { id: 'c1', kind: 'image', src: 'r2:ws/k.webp', title: 'Key art', createdBy: 'u1', createdAt: '2026-10-01T10:00:30Z' };
  const info = describeCard(card, { getMeta: meta({ 'ws/k.webp': { w: 4000, h: 3000, sizeBytes: 2 * 1024 * 1024, uploadedBy: 'u1', uploadedAt: '2026-10-01T10:00:00Z', originalName: 'KEY_ART_v2.jpg' } }) });
  const r = rows(info);
  assert.equal(r.Kind, 'Image · WEBP');
  assert.equal(r['File name'], 'KEY_ART_v2.jpg');
  assert.equal(r.Dimensions, '4000 × 3000');
  assert.equal(r.Size, '2.0 MB');
  // Uploaded and added by the same person a moment apart: said once.
  assert.deepEqual(info.people.map((p) => p.k), ['Uploaded']);
  assert.equal(info.people[0].by, 'u1');
});

test('a copy in another cluster: uploaded by one person, added here by another', () => {
  const card = { id: 'c2', kind: 'image', src: 'r2:ws/k.webp', fileName: 'k.jpg', createdBy: 'u2', createdAt: '2026-10-09T09:00:00Z' };
  const info = describeCard(card, { getMeta: meta({ 'ws/k.webp': { uploadedBy: 'u1', uploadedAt: '2026-10-01T10:00:00Z' } }) });
  assert.deepEqual(info.people.map((p) => [p.k, p.by]), [['Uploaded', 'u1'], ['Added here', 'u2']]);
});

test('a video: resolution, length, frame rate, codec, audio and start timecode once probed', () => {
  const card = {
    id: 'v', kind: 'video', src: 'r2:ws/v.mov', fileName: 'A001_C003.mov',
    media: { dur: 83.4, w: 3840, h: 2160, fps: [24000, 1001], codec: 'apch', tc: { start: '01:00:00:00' }, audio: { codec: 'lpcm', rate: 48000, ch: 2 }, probed: 1 },
  };
  const r = rows(describeCard(card));
  assert.equal(r.Kind, 'Video · MOV');
  assert.equal(r.Resolution, '3840 × 2160');
  assert.equal(r.Duration, '1:23');
  assert.equal(r['Frame rate'], '23.976 fps');
  assert.equal(r.Codec, 'ProRes 422 HQ');
  assert.equal(r['Start timecode'], '01:00:00:00');
  assert.equal(r.Audio, 'PCM · 48 kHz · Stereo');
});

test('a video before it is probed says only what it knows', () => {
  const r = rows(describeCard({ id: 'v', kind: 'video', src: 'r2:ws/v.mp4', fileName: 'clip.mp4' }, { getMeta: meta({ 'ws/v.mp4': { w: 1920, h: 1080 } }) }));
  assert.equal(r.Resolution, '1920 × 1080');
  assert.equal(r['Frame rate'], undefined);
  assert.equal(r.Audio, undefined);
});

test('audio, pdf, file, note, link, palette, grid', () => {
  const a = rows(describeCard({ id: 'a', kind: 'audio', src: 'r2:ws/l.wav', ext: 'wav', duration: 7.5, bpm: 128, musicalKey: 'Am', sampleRate: 44100, channels: 2, sizeBytes: 1300000 }));
  assert.equal(a.Kind, 'Audio · WAV');
  assert.equal(a.Tempo, '128 BPM');
  assert.equal(a['Sample rate'], '44.1 kHz');
  assert.equal(a.Channels, 'Stereo');
  assert.equal(a.Size, '1.2 MB');
  const p = rows(describeCard({ id: 'p', kind: 'pdf', pdfSrc: 'r2:ws/d.pdf', pageCount: 12 }));
  assert.equal(p.Kind, 'PDF');
  assert.equal(p.Pages, '12');
  const f = rows(describeCard({ id: 'f', kind: 'file', fileSrc: 'r2:ws/x.zip', fileName: 'x.zip', ext: 'zip', mime: 'application/zip', sizeBytes: 10 }));
  assert.equal(f.Kind, 'File · ZIP');
  assert.equal(f.Type, 'application/zip');
  const n = rows(describeCard({ id: 'n', kind: 'note', html: '<p>Shot list</p><p>wide, medium, close</p>' }));
  assert.equal(n.Kind, 'Note');
  assert.equal(n.Words, '5');
  const l = rows(describeCard({ id: 'l', kind: 'link', link: 'https://www.example.com/a' }));
  assert.equal(l.Site, 'example.com');
  const pal = rows(describeCard({ id: 'pa', kind: 'palette', swatches: [{ hex: '#000' }, { hex: '#fff' }] }));
  assert.equal(pal.Colors, '2 — #000 #fff');
  const g = rows(describeCard({ id: 'g', kind: 'grid', templateId: 't1', cells: { a: 1, b: 2 } }, { gridTemplates: { t1: { name: 'Storyboard' } } }));
  assert.equal(g['Filled cells'], '2');
  assert.equal(g.Layout, 'Linked to “Storyboard”');
});

test('a later change is Modified; a create-time stamp is not', () => {
  const same = describeCard({ id: 'n', kind: 'note', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00.400Z', createdBy: 'u1' });
  assert.deepEqual(same.people.map((p) => p.k), ['Added']);
  const later = describeCard({ id: 'n', kind: 'note', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-03T08:00:00Z', updatedBy: 'u2' });
  assert.deepEqual(later.people.map((p) => [p.k, p.by]), [['Added', null], ['Modified', 'u2']]);
});

test('several cards: counts by kind, total size, oldest and newest', () => {
  const cards = [
    { id: '1', kind: 'image', src: 'r2:k1', createdAt: '2026-10-01T00:00:00Z' },
    { id: '2', kind: 'image', src: 'r2:k2', createdAt: '2026-10-05T00:00:00Z' },
    { id: '3', kind: 'note', createdAt: '2026-10-03T00:00:00Z', unplaced: true },
  ];
  const info = describeSelection(cards, { getMeta: meta({ k1: { sizeBytes: 1024 }, k2: { sizeBytes: 1024 } }) });
  const r = rows(info);
  assert.equal(info.title, '3 items');
  assert.equal(r.Kinds, '2 images, 1 note');
  assert.equal(r.Size, '2.0 KB');
  assert.equal(r['Not on board'], '1');
  assert.deepEqual(info.people.map((p) => [p.k, p.at.slice(0, 10)]), [['Oldest', '2026-10-01'], ['Newest', '2026-10-05']]);
  // Size counts what's known, and says so.
  const partial = rows(describeSelection(cards, { getMeta: meta({ k1: { sizeBytes: 1024 } }) }));
  assert.equal(partial.Size, '1.0 KB (1 of 2 files)');
});

test('a cluster: where it sits, what it holds, who made it', () => {
  const boards = {
    root: { id: 'root', name: 'Studio', parent_board_id: null },
    p: { id: 'p', name: 'Feature', parent_board_id: 'root' },
    c: { id: 'c', name: 'Dailies', parent_board_id: 'p', created_by: 'u1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', view: 'list' },
    s1: { id: 's1', name: 'Day 1', parent_board_id: 'c' },
  };
  assert.equal(clusterPath(boards, 'c'), 'Studio / Feature');
  const cards = [{ id: 'a', kind: 'video', src: 'r2:v', sizeBytes: 2048 }, { id: 'b', kind: 'note' }, { id: 's1', kind: 'board' }];
  const info = describeCluster(boards.c, { boards, cards });
  const r = rows(info);
  assert.equal(info.title, 'Dailies');
  assert.equal(r.Inside, 'Studio / Feature');
  assert.equal(r['Clusters inside'], '1');
  assert.equal(r.Items, '2');
  assert.equal(r.Files, '1 · 2.0 KB');
  assert.equal(r['Opens as'], 'Files');
  assert.deepEqual(info.people.map((p) => [p.k, p.by]), [['Created', 'u1'], ['Modified', null]]);
  assert.equal(rows(describeCluster(boards.root, { boards })).Inside, 'Top level');
});

test('a group and the kind breakdown', () => {
  const info = describeGroup({ id: 'g', name: 'Refs', createdBy: 'u1', createdAt: '2026-10-01T00:00:00Z' }, [{ kind: 'image' }, { kind: 'image' }, { kind: 'link' }]);
  assert.equal(info.title, 'Refs');
  assert.equal(rows(info).Members, '3');
  assert.equal(kindBreakdown([{ kind: 'audio' }, { kind: 'pdf' }, { kind: 'pdf' }]), '2 PDFs, 1 audio file');
});

test('sizeOf prefers the card, then the images row', () => {
  assert.equal(sizeOf({ kind: 'file', fileSrc: 'r2:x', sizeBytes: 5 }, meta({ x: { sizeBytes: 9 } })), 5);
  assert.equal(sizeOf({ kind: 'image', src: 'r2:x' }, meta({ x: { sizeBytes: 9 } })), 9);
  assert.equal(sizeOf({ kind: 'image', src: 'r2:x' }, null), null);
});

test('a followed selection becomes the cards, a folder, or the cluster itself', () => {
  assert.equal(targetForSelection(null), null);
  const cards = [{ id: 'a' }];
  assert.deepEqual(targetForSelection({ boardId: 'b', ids: ['a'], clusterIds: [], cards }, { follow: 'x' }),
    { follow: 'x', boardId: 'b', cardIds: ['a'], clusterId: null, groupId: null, cards });
  const folder = targetForSelection({ boardId: 'b', ids: [], clusterIds: ['f'], cards });
  assert.equal(folder.clusterId, 'f');
  assert.equal(folder.cards, null);   // a folder's cards aren't the browsed cluster's
  const none = targetForSelection({ boardId: 'b', ids: [], clusterIds: [], cards });
  assert.equal(none.clusterId, 'b');
  assert.equal(none.cards, cards);
  // Several folders, or files and folders: all of them, as a summary.
  const two = targetForSelection({ boardId: 'b', ids: [], clusterIds: ['f', 'g'], cards });
  assert.deepEqual([two.cardIds, two.clusterIds, two.clusterId], [[], ['f', 'g'], null]);
  const mixed = targetForSelection({ boardId: 'b', ids: ['a'], clusterIds: ['f'], cards });
  assert.deepEqual([mixed.cardIds, mixed.clusterIds], [['a'], ['f']]);
});
