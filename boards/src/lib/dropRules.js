// What dropping files does: the one decision every place files can be dragged
// asks (the sidebar's tree and Files list, the board, the label at the
// pointer), so a drag means the same thing wherever it lands. The owner's
// rules (round 11, 2026-10-19):
//
//   1. Dragging moves. Inside a workspace a file goes where it's dropped and
//      leaves where it was, taking its name, tags, comments, star and share
//      link with it.
//   2. The copy key copies (Option on a Mac; Ctrl, or Alt, elsewhere). A copy
//      is a new card on the same stored file: no bytes, one card.
//   3. Files stay in their workspace: another workspace's cluster takes none.
//   4. A cluster you can only view: copy out of it (its files can't be moved
//      out), never drop into it.
//   5. Where it's dropped decides where it lands: a cluster's name or its
//      Files list keeps it in that cluster's files, off the board; a board
//      puts it where it's let go.
//   6. The drag says what will happen before it's let go: `label`.
//
// Pure, so the rules can be tested without a drag.

const NOUNS = {
  image: ['photo', 'photos'],
  video: ['video', 'videos'],
  audio: ['audio file', 'audio files'],
  pdf: ['PDF', 'PDFs'],
  doc: ['doc', 'docs'],
  note: ['note', 'notes'],
  link: ['link', 'links'],
};

export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  return /mac/i.test(nav?.platform || '');
}

// Whether the copy key is held: Option on a Mac; Ctrl elsewhere, where Alt
// copies too (Windows has no Option, and Alt is what design tools copy with).
export function copyKeyHeld(e, mac = isMacPlatform()) {
  if (!e) return false;
  return mac ? !!e.altKey : !!(e.ctrlKey || e.altKey);
}

export function copyKeyName(mac = isMacPlatform()) {
  return mac ? 'Option (⌥)' : 'Ctrl';
}

const clip = (s, n = 28) => {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

// "mara-callback-1.jpg", "3 photos", "2 files".
export function whatOf(files) {
  const list = files || [];
  if (list.length === 1 && list[0]?.name) return clip(list[0].name);
  const kinds = new Set(list.map((f) => f?.kind));
  const one = kinds.size === 1 ? [...kinds][0] : null;
  const [s, p] = (one && NOUNS[one]) || ['file', 'files'];
  return list.length === 1 ? `1 ${s}` : `${list.length} ${p}`;
}

// files     what's being dragged: [{ id, kind, name?, boardId, uploading?,
//           canMove? }] — canMove false: its cluster is view only, so it can
//           only be copied out
// target    where it would land: { boardId, name, where: 'files' | 'board',
//           workspaceId, writable, and for another workspace's cluster its
//           owner's name or the workspace's own: owner?, workspaceName? }
// workspaceId, workspaceName   the files' own workspace
// copy      the copy key is held
// sourceName  the cluster they come from, when they all come from one
//
// → { action: 'move' | 'copy' | 'mixed' | 'place' | 'none', reason,
//     move, copy, place (the files each happens to, so a caller can group
//     them by the cluster each came from: ids alone can repeat across
//     clusters), moveIds, copyIds, placeIds, effect: 'move' | 'copy' | 'none',
//     label: { top, sub, hint, no } }
export function decideDrop({
  files = [], target = null, workspaceId = null, workspaceName = '', copy = false,
  sourceName = '', mac = isMacPlatform(),
} = {}) {
  const none = (reason, top, sub = '', hint = '') => ({
    action: 'none', reason, move: [], copy: [], place: [], moveIds: [], copyIds: [], placeIds: [], effect: 'none',
    label: { top, sub, hint, no: true },
  });
  const ids = (list) => list.map((f) => f.id);
  if (!target?.boardId || !files.length) return none('nothing', '');
  const name = clip(target.name || 'Untitled', 32);

  if (target.workspaceId && workspaceId && target.workspaceId !== workspaceId) {
    const there = target.owner ? `${clip(target.owner, 24)}’s workspace`
      : target.workspaceName ? clip(target.workspaceName, 28) : 'another workspace';
    return none('workspace',
      `${name} is in ${there}`,
      workspaceName ? `Files can only move within ${clip(workspaceName, 24)}` : 'Files stay in their own workspace');
  }
  if (!target.writable) return none('view-only', `${name} is view only`, 'You can’t add files to it');

  const here = files.filter((f) => f.boardId === target.boardId);
  const away = files.filter((f) => f.boardId !== target.boardId);
  const ready = away.filter((f) => !f.uploading);

  if (!ready.length) {
    if (target.where === 'board' && here.length) {
      return {
        action: 'place', reason: null, move: [], copy: [], place: here, moveIds: [], copyIds: [], placeIds: ids(here), effect: 'move',
        label: { top: `Put ${whatOf(here)} here`, sub: 'Onto the board, where you let go', hint: '', no: false },
      };
    }
    if (away.length) return none('uploading', 'Still uploading', 'Try again when they’ve finished');
    return none('same', `Already in ${name}`, `Drop ${here.length === 1 ? 'it' : 'them'} on another cluster`);
  }

  const copying = ready.filter((f) => copy || f.canMove === false);
  const moving = ready.filter((f) => !copy && f.canMove !== false);
  const placing = target.where === 'board' ? here : [];
  const action = moving.length && copying.length ? 'mixed' : moving.length ? 'move' : 'copy';
  const what = whatOf(ready);
  const one = ready.length === 1;
  const from = clip(sourceName, 24);

  let top;
  if (action === 'mixed') top = `Move ${moving.length} and copy ${copying.length} to ${name}`;
  else top = `${action === 'move' ? 'Move' : 'Copy'} ${what} to ${name}`;

  let sub;
  if (target.where === 'files') sub = 'Into its files, not onto its board';
  else if (action === 'copy') sub = 'Onto the board, where you let go';
  else sub = `Onto the board · ${one ? 'it leaves' : 'they leave'} ${from || 'where they were'}`;

  let hint = '';
  if (action === 'move') hint = `Hold ${copyKeyName(mac)} to copy instead`;
  else if (copy) hint = from ? `The ${one ? 'original stays' : 'originals stay'} in ${from}` : '';
  else hint = from ? `${from} is view only, so ${one ? 'it’s' : 'they’re'} copied` : 'Some are view only, so they’re copied';

  return {
    action, reason: null, move: moving, copy: copying, place: placing,
    moveIds: ids(moving), copyIds: ids(copying), placeIds: ids(placing),
    effect: action === 'copy' ? 'copy' : 'move',
    label: { top, sub, hint, no: false },
  };
}
