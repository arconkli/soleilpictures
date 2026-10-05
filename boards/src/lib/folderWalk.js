// folderWalk — what a dropped folder contains, as a tree.
//
// Until this existed, dragging a FOLDER onto the canvas handed the browser one
// empty File named after the folder, and nothing happened; every page that said
// "drop a whole folder" was wrong (publicClaims.test.mjs guarded that, keyed on
// this file's API, and lifts itself now that it exists).
//
// Two sources, one shape:
//   · a DROP — DataTransferItem.webkitGetAsEntry() gives FileSystemEntry objects.
//     They have to be taken DURING the drop event: Chrome empties
//     dataTransfer.items the moment the handler yields to an await, so
//     captureDropEntries is synchronous and a caller runs it first.
//   · a PICKER — <input type=file webkitdirectory> hands back flat Files whose
//     webkitRelativePath ("Shoot/Day 2/a.jpg") carries the structure.
//
// Shape: { name, files: File[], dirs: Node[] }, under a virtual root (name null)
// that holds whatever sat at the top level of the drop.
//
// Pure apart from the entry objects it is handed, so it tests under node with
// fakes that behave like Chrome's (readEntries in batches, then an empty one).

export const FOLDER_LIMITS = Object.freeze({
  maxFiles: 500,    // per drop — a folder bigger than this is imported in part, and says so
  maxDepth: 6,      // folders below this level are merged into the one above
  maxClusters: 60,  // folders past this many are merged into their parent too
});

// Not content: the OS's bookkeeping, and a placeholder iCloud leaves behind
// for a file it has not downloaded (".photo.jpg.icloud").
const JUNK_FILE = /^(\.ds_store|thumbs\.db|desktop\.ini|\.localized|icon\r)$/i;
const ICLOUD_PLACEHOLDER = /^\..+\.icloud$/i;
// Folders that are not folders to a person: macOS packages (a Logic project, a
// Photos library, an app) are directories underneath, and importing one would
// scatter its insides across a board as a hundred meaningless files.
const PACKAGE_DIR = /\.(app|bundle|framework|plugin|kext|logicx|band|photoslibrary|aplibrary|fcpbundle|imovielibrary|tvlibrary|musiclibrary|lrlibrary|lrdata|rtfd|key|pages|numbers|sparsebundle|xcodeproj|xcworkspace|scriv|pkg)$/i;
const SYSTEM_DIR = /^(__macosx|\$recycle\.bin|system volume information)$/i;

export function classifyEntryName(name, isDirectory) {
  const n = String(name || '');
  if (isDirectory) {
    if (PACKAGE_DIR.test(n)) return 'package';
    if (n.startsWith('.') || SYSTEM_DIR.test(n)) return 'junk';
    return 'keep';
  }
  if (ICLOUD_PLACEHOLDER.test(n)) return 'icloud';
  if (n.startsWith('.') || n.startsWith('._') || JUNK_FILE.test(n)) return 'junk';
  return 'keep';
}

// SYNCHRONOUS. Call before the first await in a drop handler.
export function captureDropEntries(dataTransfer) {
  const items = dataTransfer?.items;
  if (!items || typeof items.length !== 'number') return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || it.kind !== 'file' || typeof it.webkitGetAsEntry !== 'function') continue;
    let entry = null;
    try { entry = it.webkitGetAsEntry(); } catch (_) { entry = null; }
    if (entry) out.push(entry);
  }
  return out;
}

export function hasDirectory(entries) {
  return Array.isArray(entries) && entries.some((e) => e && e.isDirectory);
}

const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

function sortTree(node) {
  node.files.sort(byName);
  node.dirs.sort(byName);
  node.dirs.forEach(sortTree);
}

function newState() {
  return { files: 0, clusters: 0, truncated: false, flattened: false, skipped: { junk: 0, packages: 0, icloud: 0 } };
}

function readBatch(reader) {
  return new Promise((resolve) => {
    try { reader.readEntries((b) => resolve(Array.from(b || [])), () => resolve(null)); }
    catch (_) { resolve(null); }
  });
}

function fileOf(entry) {
  return new Promise((resolve) => {
    try { entry.file((f) => resolve(f), () => resolve(null)); } catch (_) { resolve(null); }
  });
}

async function visit(entry, node, depth, state, limits, signal) {
  if (!entry || signal?.aborted) return;
  const verdict = classifyEntryName(entry.name, !!entry.isDirectory);
  if (verdict === 'junk') { state.skipped.junk++; return; }
  if (verdict === 'package') { state.skipped.packages++; return; }
  if (verdict === 'icloud') { state.skipped.icloud++; return; }

  if (entry.isFile) {
    if (state.files >= limits.maxFiles) { state.truncated = true; return; }
    const file = await fileOf(entry);
    if (file) { node.files.push(file); state.files++; }
    return;
  }
  if (!entry.isDirectory) return;

  // Past the depth or cluster limit the folder still counts — its files are
  // kept — but it merges into the folder above instead of becoming a cluster.
  let into = node;
  if (depth + 1 > limits.maxDepth || state.clusters >= limits.maxClusters) {
    state.flattened = true;
  } else {
    into = { name: entry.name, files: [], dirs: [] };
    node.dirs.push(into);
    state.clusters++;
  }
  const reader = entry.createReader();
  // Chrome returns at most 100 entries per readEntries call, and the only end
  // of the list is an empty batch. One call reads the first hundred and stops.
  for (;;) {
    if (signal?.aborted) return;
    const batch = await readBatch(reader);
    if (!batch || !batch.length) break;
    for (const child of batch) {
      if (state.files >= limits.maxFiles && child.isFile) { state.truncated = true; continue; }
      await visit(child, into, into === node ? depth : depth + 1, state, limits, signal);
    }
  }
}

// A drop: FileSystemEntry objects from captureDropEntries.
export async function walkEntries(entries, { limits = FOLDER_LIMITS, signal = null } = {}) {
  const state = newState();
  const root = { name: null, files: [], dirs: [] };
  for (const e of entries || []) await visit(e, root, 0, state, limits, signal);
  sortTree(root);
  return { root, ...state };
}

// A picker: Files with webkitRelativePath. Same rules, same shape.
export function treeFromRelativePaths(files, { limits = FOLDER_LIMITS } = {}) {
  const state = newState();
  const root = { name: null, files: [], dirs: [] };
  for (const file of Array.from(files || [])) {
    const parts = String(file?.webkitRelativePath || file?.name || '').split('/').filter(Boolean);
    if (!parts.length) continue;
    const dirs = parts.slice(0, -1);
    const verdictFile = classifyEntryName(parts[parts.length - 1], false);
    // Anything inside a package or a hidden/system folder goes with it.
    const badDir = dirs.map((d) => classifyEntryName(d, true)).find((v) => v !== 'keep');
    if (badDir === 'package') { state.skipped.packages++; continue; }
    if (badDir === 'junk') { state.skipped.junk++; continue; }
    if (verdictFile !== 'keep') { state.skipped[verdictFile === 'icloud' ? 'icloud' : 'junk']++; continue; }
    if (state.files >= limits.maxFiles) { state.truncated = true; continue; }
    let node = root;
    for (let i = 0; i < dirs.length; i++) {
      let next = node.dirs.find((d) => d.name === dirs[i]);
      if (!next) {
        if (i + 1 > limits.maxDepth || state.clusters >= limits.maxClusters) { state.flattened = true; break; }
        next = { name: dirs[i], files: [], dirs: [] };
        node.dirs.push(next);
        state.clusters++;
      }
      node = next;
    }
    node.files.push(file);
    state.files++;
  }
  sortTree(root);
  return { root, ...state };
}
