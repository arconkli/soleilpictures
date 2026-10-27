// What an archive's card shows, from the names inside it. Pure, and shared with
// the converter (media/ copies it into the image), which draws the pictures.
//
// A zip drops as a contact sheet: folders first with their counts, then
// pictures, then files, inside the one folder a zip often holds. Any other
// archive shows its names as rows. Mac and Windows litter never shows.

export const SHEET_TILES = 12;
export const LIST_ROWS = 6;

// What the box can thumbnail, and what a browser can draw on its own.
export const PHOTO_EXTS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'heic', 'heif']);
export const BROWSER_PHOTO_EXTS = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'gif']);

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const baseOf = (path) => path.replace(/\/$/, '').split('/').pop();
const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

// __MACOSX/, .DS_Store, ._* (AppleDouble), Thumbs.db and desktop.ini, anywhere.
export function isJunk(path) {
  const parts = String(path).split('/').filter(Boolean);
  if (parts.includes('__MACOSX')) return true;
  const base = (parts[parts.length - 1] || '').toLowerCase();
  return base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini' || base.startsWith('._');
}

// An entry's path as the card names it: no leading ./ or /, forward slashes;
// null for junk or a path with a `..` in it. The converter finds an entry's
// bytes by it.
export function cleanPath(raw) {
  let path = String(raw ?? '').replace(/\\/g, '/');
  while (path.startsWith('./') || path.startsWith('/')) path = path.startsWith('./') ? path.slice(2) : path.slice(1);
  if (!path || path.split('/').includes('..') || isJunk(path)) return null;
  return path;
}

// Entries as { path, dir, size }: no leading ./ or /, no junk, no `..` paths,
// and the folders that only appear as prefixes of files added. Folders end in /.
export function cleanEntries(entries) {
  const out = new Map();
  for (const e of entries || []) {
    let path = cleanPath(e?.path);
    if (!path) continue;
    const dir = !!e.dir || path.endsWith('/');
    if (dir && !path.endsWith('/')) path += '/';
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/') + '/';
      if (!out.has(folder)) out.set(folder, { path: folder, dir: true, size: 0 });
    }
    if (!out.has(path) || !dir) out.set(path, { path, dir, size: dir ? 0 : Number(e.size) || 0 });
  }
  return [...out.values()];
}

// The prefix to show: '' or 'Folder/', descending while every entry sits under
// the one folder.
export function rootOf(entries) {
  const list = cleanEntries(entries);
  let prefix = '';
  for (;;) {
    const inside = list.filter((e) => e.path !== prefix && e.path.startsWith(prefix));
    if (!inside.length) return prefix;
    const first = inside[0].path.slice(prefix.length).split('/')[0];
    const next = `${prefix}${first}/`;
    if (!inside.every((e) => e.path.startsWith(next))) return prefix;
    if (!inside.some((e) => e.path !== next)) return prefix;
    prefix = next;
  }
}

// The folder an entry sits directly in ('' at the top).
const parentOf = (path) => {
  const bare = path.replace(/\/$/, '');
  return bare.includes('/') ? bare.slice(0, bare.lastIndexOf('/') + 1) : '';
};

// The direct children of a prefix. A folder's count is what is directly in it.
export function levelOf(entries, prefix = '') {
  const list = cleanEntries(entries);
  // In one pass: a zip can hold tens of thousands of folders.
  const counts = new Map();
  for (const e of list) counts.set(parentOf(e.path), (counts.get(parentOf(e.path)) || 0) + 1);
  const folders = [];
  const files = [];
  for (const e of list) {
    if (e.path === prefix || !e.path.startsWith(prefix)) continue;
    const rest = e.path.slice(prefix.length).replace(/\/$/, '');
    if (!rest || rest.includes('/')) continue;
    if (e.dir) {
      folders.push({ name: rest, path: e.path, count: counts.get(e.path) || 0 });
    } else {
      files.push({ name: rest, path: e.path, size: e.size, ext: extOf(rest) });
    }
  }
  return { folders: folders.sort(byName), files: files.sort(byName) };
}

export function summaryOf(entries) {
  const list = cleanEntries(entries);
  let files = 0;
  let folders = 0;
  let bytes = 0;
  for (const e of list) {
    if (e.dir) folders++;
    else {
      files++;
      bytes += e.size;
    }
  }
  return { files, folders, bytes };
}

// The contact sheet's tiles, at the root: folders, then pictures, then the
// other files, up to 12.
export function sheetTiles(entries) {
  const { folders, files } = levelOf(entries, rootOf(entries));
  const tile = (f) => ({ kind: PHOTO_EXTS.includes(f.ext) ? 'photo' : 'file', name: f.name, path: f.path, ext: f.ext, size: f.size });
  const tiles = [
    ...folders.map((f) => ({ kind: 'folder', name: f.name, path: f.path, count: f.count })),
    ...files.map(tile).filter((t) => t.kind === 'photo'),
    ...files.map(tile).filter((t) => t.kind === 'file'),
  ];
  return tiles.slice(0, SHEET_TILES);
}

// The names picture's rows (a folder's with its count), with how many more
// there are.
export function listRows(entries) {
  const { folders, files } = levelOf(entries, rootOf(entries));
  const all = [
    ...folders.map((f) => ({ kind: 'folder', name: f.name, count: f.count })),
    ...files.map((f) => ({ kind: 'file', name: f.name, size: f.size })),
  ];
  return { rows: all.slice(0, LIST_ROWS), more: Math.max(0, all.length - LIST_ROWS) };
}
