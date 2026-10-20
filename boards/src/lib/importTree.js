// importTree — one tree shape for every bulk-import source.
//
// A dropped folder, a picked folder and a .zip export all end up as the same
// thing, so importPlan prices them with one rule and the importer builds
// clusters from one shape no matter where the files came from.
//
//   file descriptor  { name, relPath, size, lastModified, type, open }
//   node             { name, relPath, files: [descriptor], dirs: [node] }
//   root             { name: null, relPath: '', files, dirs }
//
// `open` is `() => Promise<File>`. For a folder it hands back the File the
// browser already gave us; for a zip it inflates the entry on demand, so a
// 50,000-file archive is never held in memory as Files. The root is virtual:
// its `dirs` are the top-level folders (they become top clusters) and its
// `files` are loose files beside them, which the caller sends down the
// ordinary drop path.
//
// SOURCES (the caller runs the walk; this file only converts):
//   · a drop or picker: walkEntries(entries, { limits: IMPORT_LIMITS }) or
//     treeFromRelativePaths(files, { limits: IMPORT_LIMITS }), then
//     treeFromWalk(thatResult). folderWalk's own FOLDER_LIMITS are the small
//     per-drop caps; a bulk import passes IMPORT_LIMITS instead.
//   · zips: groupArchives(names) from zipRead says which are parts of one
//     export; per group, mergeArchives(listings), then treeFromZip(merged, zips).
//   · then always combineTrees([...]), even for one source: it is what makes
//     every top folder name, and so every relPath, unique within the import.
//
// treeFromZip applies the same rules folderWalk does (packages and hidden
// folders skipped with everything inside, junk and iCloud placeholders
// skipped, depth/cluster/file limits), using folderWalk's classifyEntryName so
// the two sources can never disagree about what counts as content.
//
// Pure: no DOM beyond `File`, which is only touched inside `open()`.

import { classifyEntryName } from './folderWalk.js';
import { openEntry } from './zipRead.js';

// maxInflateBytes: a compressed file in a zip is inflated whole in the
// browser before it uploads (zipRead.openEntry), so one over this fails with
// a reason — unzip it on the computer — instead of taking the tab down. A
// stored file is a slice of the zip and has no such limit.
export const IMPORT_LIMITS = Object.freeze({ maxFiles: 50000, maxDepth: 12, maxClusters: 5000, maxInflateBytes: 4 * 1024 ** 3 });

// On a device with a hard memory ceiling (device.lowMemoryDevice: iOS, or 4 GB
// of RAM or less) that ceiling is far lower. M3 (2026-10-20): WebKit, which
// keeps a big Blob in memory where Chromium spills it to disk, held ~0.45 GB
// for a 256 MiB entry and ~1 GB for a 1 GiB one, and an iPhone tab is killed
// at 1–2 GB.
export const LOW_MEMORY_INFLATE_BYTES = 256 * 1024 ** 2;
export function importLimitsFor({ lowMemory = false } = {}) {
  return lowMemory ? Object.freeze({ ...IMPORT_LIMITS, maxInflateBytes: LOW_MEMORY_INFLATE_BYTES }) : IMPORT_LIMITS;
}

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', svg: 'image/svg+xml',
  tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  ogg: 'audio/ogg', aif: 'audio/aiff', aiff: 'audio/aiff',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

// Extension → mime, '' when unknown. A zip entry has no type of its own, and
// classifyDropFile routes on the type.
export function mimeFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  if (!m) return '';
  const ext = m[1].toLowerCase();
  return Object.prototype.hasOwnProperty.call(MIME, ext) ? MIME[ext] : '';
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

function sortTree(node) {
  node.files.sort(byName);
  node.dirs.sort(byName);
  node.dirs.forEach(sortTree);
}

// walk: what walkEntries / treeFromRelativePaths return.
export function treeFromWalk(walk) {
  const convert = (n, parentPath) => {
    const relPath = parentPath == null ? '' : (parentPath ? `${parentPath}/${n.name}` : String(n.name));
    return {
      name: n.name,
      relPath,
      files: (n.files || []).map((file) => ({
        name: file.name,
        // A file whose folder merged upward keeps its own path (folderWalk's
        // origins): the importer's ledger keys files by relPath.
        relPath: walk?.origins?.get?.(file) ?? (relPath ? `${relPath}/${file.name}` : String(file.name)),
        size: file.size,
        lastModified: file.lastModified,
        type: file.type || mimeFromName(file.name),
        open: async () => file,
      })),
      dirs: (n.dirs || []).map((d) => convert(d, relPath)),
    };
  };
  const root = convert(walk?.root || { name: null, files: [], dirs: [] }, null);
  root.name = null;
  const skipped = walk?.skipped || {};
  return {
    root,
    stats: {
      files: walk?.files || 0,
      clusters: walk?.clusters || 0,
      truncated: !!walk?.truncated,
      flattened: !!walk?.flattened,
      skipped: { junk: skipped.junk || 0, packages: skipped.packages || 0, icloud: skipped.icloud || 0 },
    },
  };
}

// merged: zipRead.mergeArchives output. Its paths are relative to the one top
// folder, which is named merged.rootName. zips: the Blobs, indexed by `f.zip`.
export function treeFromZip(merged, zips, { limits = IMPORT_LIMITS, open = openEntry } = {}) {
  const skipped = { junk: 0, packages: 0, icloud: 0 };
  let files = 0;
  let clusters = 0;
  let truncated = false;
  let flattened = false;

  const topName = String(merged?.rootName || 'Import');
  const top = { name: topName, relPath: topName, files: [], dirs: [] };
  const root = { name: null, relPath: '', files: [], dirs: [top] };
  clusters = 1;

  // Folder path ('' = the top folder) → its node, or SKIP. Each folder is
  // decided once, so a skipped folder is counted once, however much it holds.
  const SKIP = Symbol('skip');
  const cache = new Map([['', top]]);
  const nodeFor = (path) => {
    if (cache.has(path)) return cache.get(path);
    const segs = path.split('/');
    const parentPath = segs.slice(0, -1).join('/');
    const parent = nodeFor(parentPath);
    let out;
    if (parent === SKIP) {
      out = SKIP;
    } else {
      const verdict = classifyEntryName(segs[segs.length - 1], true);
      if (verdict === 'package') { skipped.packages++; out = SKIP; }
      else if (verdict === 'junk') { skipped.junk++; out = SKIP; }
      else if (segs.length + 1 > limits.maxDepth || clusters >= limits.maxClusters) {
        // Past a limit the folder's files are kept, but it merges upward.
        flattened = true;
        out = parent;
      } else {
        out = { name: segs[segs.length - 1], relPath: `${parent.relPath}/${segs[segs.length - 1]}`, files: [], dirs: [] };
        parent.dirs.push(out);
        clusters++;
      }
    }
    cache.set(path, out);
    return out;
  };

  for (const d of merged?.dirs || []) if (d) nodeFor(d);

  for (const f of merged?.files || []) {
    const segs = String(f.relPath).split('/');
    const name = segs[segs.length - 1];
    const node = nodeFor(segs.slice(0, -1).join('/'));
    if (node === SKIP) continue;
    const verdict = classifyEntryName(name, false);
    if (verdict === 'icloud') { skipped.icloud++; continue; }
    if (verdict !== 'keep') { skipped.junk++; continue; }
    if (files >= limits.maxFiles) { truncated = true; continue; }
    const type = mimeFromName(name);
    const { size, lastModified } = f;
    node.files.push({
      name,
      // Its path in the archive, not the folder it landed in: the same thing
      // unless its folder merged upward, where two a.jpgs would otherwise meet.
      relPath: `${topName}/${f.relPath}`,
      size,
      lastModified,
      type,
      // Inflated whole before it uploads, where a stored file is a slice of
      // the zip: the job lets one big one at a time hold that memory.
      inflates: !!f.entry && f.entry.method !== 0,
      open: async () => {
        if (f.entry?.method !== 0 && size > (limits.maxInflateBytes ?? Infinity)) throw new Error('Too large to unpack here.');
        return new File([await open(zips[f.zip], f.entry)], name, { type, lastModified });
      },
    });
    files++;
  }

  sortTree(top);
  return { root, stats: { files, clusters, truncated, flattened, skipped, dropped: merged?.dropped } };
}

const moveTop = (node, from, to) => {
  const swap = (p) => to + p.slice(from.length);
  return {
    ...node,
    name: node.relPath === from ? to : node.name,
    relPath: swap(node.relPath),
    files: node.files.map((f) => ({ ...f, relPath: swap(f.relPath) })),
    dirs: node.dirs.map((d) => moveTop(d, from, to)),
  };
};

// Every source of one drop → one root. importPlan keys clusters by relPath and
// the importer's ledger keys files by it, so both must be unique in the
// import: a top folder whose name is taken (a folder dropped with its own zip,
// two exports both called "Photos") becomes "Photos (2)", and everything in it
// moves with it. Loose files stay at the root.
export function combineTrees(trees) {
  const root = { name: null, relPath: '', files: [], dirs: [] };
  const stats = { files: 0, clusters: 0, truncated: false, flattened: false, skipped: { junk: 0, packages: 0, icloud: 0 } };
  const taken = new Set();
  for (const t of trees || []) {
    if (!t?.root) continue;
    root.files.push(...t.root.files);
    for (const dir of t.root.dirs) {
      const own = String(dir.name);
      let name = own;
      for (let n = 2; taken.has(name); n++) name = `${own} (${n})`;
      taken.add(name);
      root.dirs.push(name === own ? dir : moveTop(dir, dir.relPath, name));
    }
    const s = t.stats || {};
    stats.files += s.files || 0;
    stats.clusters += s.clusters || 0;
    stats.truncated = stats.truncated || !!s.truncated;
    stats.flattened = stats.flattened || !!s.flattened;
    for (const k of Object.keys(stats.skipped)) stats.skipped[k] += s.skipped?.[k] || 0;
    if (s.dropped) {
      stats.dropped = stats.dropped || {};
      for (const [k, v] of Object.entries(s.dropped)) stats.dropped[k] = (stats.dropped[k] || 0) + (v || 0);
    }
  }
  return { root, stats };
}
