// measure-import-doc — M1 for bulk import: what one imported cluster's Y.Doc
// costs at N files, built the way the import builds it. /append adds pending
// cards a batch at a time, /patch replaces each finished card whole
// (scoutBoard.updateCardsOnBoard), and every call opens the whole doc first.
// The numbers behind importPlan.CLUSTER_FILE_CEILING; re-run it when a card's
// shape or the routes change.
//
//   node scripts/measure-import-doc.mjs              500 1,000 2,000 5,000
//   node scripts/measure-import-doc.mjs 2000 20000   any sizes (20,000 takes minutes)
import * as Y from 'yjs';
import { cardToYMap, readCards, bytesToB64 } from '../src/lib/yhelpers.js';
import { pendingCard, finishFields, spotFor } from '../src/lib/importJob.js';

const WS = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';
const USER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const uuid = (n) => `${(n * 2654435761 >>> 0).toString(16).padStart(8, '0')}-1234-4abc-8def-${String(n).padStart(12, '0')}`;

// 85% photos, 10% videos, 5% other files: a camera folder.
function item(n) {
  const r = n % 20;
  if (r < 17) return { route: 'image', kind: 'image', w: 400, h: 300, file: { relPath: `Stills/DSC_${String(n).padStart(5, '0')}.JPG`, name: `DSC_${String(n).padStart(5, '0')}.JPG`, size: 6_400_000 + n, type: 'image/jpeg', lastModified: 1760000000000 + n * 1000 } };
  if (r < 19) return { route: 'video', kind: 'video', w: 480, h: 270, file: { relPath: `Stills/C${String(n).padStart(4, '0')}.MP4`, name: `C${String(n).padStart(4, '0')}.MP4`, size: 380_000_000 + n, type: 'video/mp4', lastModified: 1760000000000 + n * 1000 } };
  return { route: 'file', kind: 'file', w: 240, h: 120, file: { relPath: `Stills/notes-${n}.txt`, name: `notes-${n}.txt`, size: 2400 + n, type: 'text/plain', lastModified: 1760000000000 + n * 1000 } };
}
function upload(it, n) {
  const ext = it.file.name.split('.').pop().toLowerCase();
  const src = `r2:${WS}/${uuid(n)}.${ext}`;
  if (it.route === 'image') return { src, width: 6000, height: 4000 };
  if (it.route === 'video') return { src, poster: `r2:${WS}/${uuid(n)}-poster.jpg`, width: 1920, height: 1080 };
  return { src, fileName: it.file.name, mime: it.file.type, sizeBytes: it.file.size, ext };
}

const stampAt = (t) => ({ createdBy: USER, createdAt: new Date(t).toISOString(), updatedBy: USER, updatedAt: new Date(t).toISOString() });
const ms = (f) => { const t = performance.now(); const v = f(); return [v, performance.now() - t]; };

// Opening the doc the way a route does: the state comes over the wire, is
// applied to a fresh doc, and every card is read out.
function openCost(doc) {
  const update = Y.encodeStateAsUpdate(doc);
  const fresh = new Y.Doc();
  const [, applyMs] = ms(() => Y.applyUpdate(fresh, update));
  const [, readMs] = ms(() => readCards(fresh));
  fresh.destroy();
  return { bytes: update.length, applyMs, readMs };
}

function build(N, { appendBatch = 100, patchBatch = 60 } = {}) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  let wire = 0, opens = 0, openMs = 0;
  const open = () => { const c = openCost(doc); wire += c.bytes; opens++; openMs += c.applyMs + c.readMs; };
  let t = Date.parse('2026-10-20T10:00:00Z');
  const finished = [];
  for (let base = 0; base < N; base += appendBatch) {
    const batch = [];
    for (let n = base; n < Math.min(N, base + appendBatch); n++) batch.push([n, item(n)]);
    open();
    doc.transact(() => { for (const [n, it] of batch) cards.set(`img-${n}`, cardToYMap(pendingCard(it, `img-${n}`, spotFor([], n), stampAt(t)))); });
    // Their files land, and are written back patchBatch at a time, each card replaced whole.
    for (let i = 0; i < batch.length; i += patchBatch) {
      const part = batch.slice(i, i + patchBatch);
      open();
      const byId = new Map(readCards(doc).map((c) => [c.id, c]));
      t += 15000;
      doc.transact(() => {
        for (const [n, it] of part) {
          const before = byId.get(`img-${n}`);
          cards.set(`img-${n}`, cardToYMap({ ...before, ...finishFields(it, upload(it, n), before.id), id: before.id, updatedAt: new Date(t).toISOString(), updatedBy: USER }));
        }
      });
      finished.push(...part);
    }
  }
  return { doc, wire, opens, openMs };
}

// The same cards born finished in one go: what the history of replacing costs.
function bornFinished(N) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  doc.transact(() => {
    for (let n = 0; n < N; n++) {
      const it = item(n);
      const c = { ...pendingCard(it, `img-${n}`, spotFor([], n), stampAt(0)), ...finishFields(it, upload(it, n), `img-${n}`) };
      cards.set(`img-${n}`, cardToYMap(c));
    }
  });
  return doc;
}

const rows = [];
const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
for (const N of sizes.length ? sizes : [500, 1000, 2000, 5000]) {
  const { doc, wire, opens, openMs } = build(N);
  const [update, encMs] = ms(() => Y.encodeStateAsUpdate(doc));
  const b64 = bytesToB64(update).length;
  const cold = openCost(doc);
  const lean = Y.encodeStateAsUpdate(bornFinished(N)).length;
  rows.push({
    N,
    'doc KB': Math.round(update.length / 1024),
    'B/card': Math.round(update.length / N),
    'lean B/card': Math.round(lean / N),
    'b64 KB': Math.round(b64 / 1024),
    'encode ms': +encMs.toFixed(1),
    'open ms (apply+read)': +(cold.applyMs + cold.readMs).toFixed(1),
    'route opens': opens,
    'wire MB total': +(wire / 1024 / 1024).toFixed(1),
    'open ms total': Math.round(openMs),
  });
  doc.destroy();
}
console.table(rows);
