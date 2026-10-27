// The names inside an archive, from `bsdtar -tvf`. Pure.
//
// A line looks like
//   -rw-r--r--  0 user group  12345 Oct 13 21:04 path/name.jpg
// (the year in place of the time when the file is old). A `d` mode is a folder,
// a symlink loses its ` -> target`, and a line that doesn't match is skipped.

const LINE = /^([-dlbcps])[-rwxsStT+@.]*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+[A-Z][a-z]{2}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4})\s(.+)$/;

export function parseBsdtarListing(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = LINE.exec(line.replace(/\r$/, ''));
    if (!m) continue;
    const [, mode, size, rest] = m;
    const dir = mode === 'd';
    const path = mode === 'l' ? rest.replace(/ -> .*$/, '') : rest;
    if (!path) continue;
    out.push({ path, dir, size: dir ? 0 : Number(size) });
  }
  return out;
}
