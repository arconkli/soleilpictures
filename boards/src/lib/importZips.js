// importZips — zips handed to a bulk import: which files are zips, which of
// them are parts of one export, and the tree each export makes.
//
// The question (importCopy.zipAskCopy) is asked from names and sizes alone, so
// adding the zips as they are reads nothing. Only "Unpack" reads, and then
// only each zip's central directory (lib/zipRead.js): a file inside is
// inflated when the job uploads it, one at a time.

import { readZipDirectory, groupArchives, mergeArchives, canInflate } from './zipRead.js';
import { treeFromZip, IMPORT_LIMITS } from './importTree.js';

const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip']);

export function isZipFile(f) {
  if (!f) return false;
  return /\.zip$/i.test(String(f.name || '')) || ZIP_TYPES.has(String(f.type || '').toLowerCase());
}

// Nearly every zip deflates its files, and inflating needs
// DecompressionStream: without it, zips are added as they are.
export function canUnpackZips() {
  return canInflate();
}

// Which of these zips are parts of one export (Takeout's -001, -002…).
export function zipGroups(zips) {
  return groupArchives(Array.from(zips || []).map((z) => z?.name || ''));
}

// Read each zip's directory and build one tree per export. A file that turns
// out not to be a zip it can read comes back in `notZips`, to be added as a
// file like any other. onProgress({ files, folders, bytes }) after each zip.
export async function readZips(zips, { onProgress = null, signal = null, read = readZipDirectory, limits = IMPORT_LIMITS } = {}) {
  const ok = [];
  const listings = [];
  const notZips = [];
  const skipped = { encrypted: 0, unsupported: 0 };
  let files = 0;
  let bytes = 0;
  const folders = new Set();
  for (const z of Array.from(zips || [])) {
    if (signal?.aborted) break;
    let listing;
    try {
      listing = await read(z, {});
    } catch (_) {
      notZips.push(z);
      continue;
    }
    ok.push(z);
    listings.push(listing.entries || []);
    skipped.encrypted += listing.skipped?.encrypted || 0;
    skipped.unsupported += listing.skipped?.unsupported || 0;
    for (const e of listing.entries || []) {
      if (e.dir) { folders.add(e.path); continue; }
      files++;
      bytes += Number(e.size) || 0;
      const cut = e.path.lastIndexOf('/');
      if (cut > 0) folders.add(e.path.slice(0, cut));
    }
    onProgress?.({ files, folders: folders.size, bytes });
  }
  const trees = groupArchives(ok.map((z) => z.name)).map((group) => {
    const merged = mergeArchives(group.map((i) => ({ name: ok[i].name, entries: listings[i] })));
    return treeFromZip(merged, group.map((i) => ok[i]), { limits });
  });
  return { trees, notZips, skipped, zips: ok.length };
}
