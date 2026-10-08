// Files view layout — Grid ('gallery') or List ('table') — remembered per
// cluster on this device. A cluster nobody has chosen for opens in Grid, the
// visual default, unless it is mostly audio: a sample pack wants the loop
// browser's Time / BPM / Key columns, which only the List layout has.
//
// Device-local on purpose for now; the per-cluster column (boards.list_layout)
// is part of the files-model work and will take over when it lands.

const KEY_PREFIX = 'soleil.files.layout.';
const MODES = new Set(['gallery', 'table']);

// Pure: the layout a cluster opens in when nothing was chosen for it.
export function defaultFilesLayout(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return 'gallery';
  let audio = 0;
  for (const it of list) if (it && it.kind === 'audio') audio += 1;
  return audio / list.length >= 0.5 ? 'table' : 'gallery';
}

export function readFilesLayout(boardId) {
  if (!boardId) return null;
  try {
    const v = localStorage.getItem(KEY_PREFIX + boardId);
    return MODES.has(v) ? v : null;
  } catch (_) { return null; }
}

export function writeFilesLayout(boardId, mode) {
  if (!boardId || !MODES.has(mode)) return;
  try { localStorage.setItem(KEY_PREFIX + boardId, mode); } catch (_) {}
}
