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

import { t, plural } from '@lingui/core/macro';
import { cutGraphemes, exceedsGraphemes } from './graphemes.js';

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
  return mac ? t`Option (⌥)` : t`Ctrl`;
}

const clip = (s, n = 28) => {
  const t = String(s || '').trim();
  return exceedsGraphemes(t, n) ? `${cutGraphemes(t, n - 1).trimEnd()}…` : t;
};

// "mara-callback-1.jpg", "3 photos", "2 files".
export function whatOf(files) {
  const list = files || [];
  if (list.length === 1 && list[0]?.name) return clip(list[0].name);
  const kinds = new Set(list.map((f) => f?.kind));
  const one = kinds.size === 1 ? [...kinds][0] : null;
  const n = list.length;
  // One whole message per kind, so a language can inflect the noun its own way.
  switch (one) {
    case 'image': return plural(n, { one: '# photo', other: '# photos' });
    case 'video': return plural(n, { one: '# video', other: '# videos' });
    case 'audio': return plural(n, { one: '# audio file', other: '# audio files' });
    case 'pdf': return plural(n, { one: '# PDF', other: '# PDFs' });
    case 'doc': return plural(n, { one: '# doc', other: '# docs' });
    case 'note': return plural(n, { one: '# note', other: '# notes' });
    case 'link': return plural(n, { one: '# link', other: '# links' });
    default: return plural(n, { one: '# file', other: '# files' });
  }
}

// files     what's being dragged: [{ id, kind, name?, boardId, uploading?,
//           canMove?, workspaceId? }] — canMove false: its cluster is view
//           only, so it can only be copied out; workspaceId: its cluster's,
//           when that might not be the files' (a cluster shared with you)
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
  const name = clip(target.name || t`Untitled`, 32);

  if (target.workspaceId && workspaceId && target.workspaceId !== workspaceId) {
    const owner = target.owner ? clip(target.owner, 24) : '';
    const there = owner ? t`${owner}’s workspace`
      : target.workspaceName ? clip(target.workspaceName, 28) : t`another workspace`;
    const within = workspaceName ? clip(workspaceName, 24) : '';
    return none('workspace',
      t`${name} is in ${there}`,
      workspaceName ? t`Files can only move within ${within}` : t`Files stay in their own workspace`);
  }
  if (!target.writable) return none('view-only', t`${name} is view only`, t`You can’t add files to it`);

  // A file in a cluster shared with you from another workspace stays in that
  // workspace: nothing here takes it. Beside files that can go, it stays put.
  const abroad = target.workspaceId
    ? files.filter((f) => f.workspaceId && f.workspaceId !== target.workspaceId) : [];
  if (abroad.length === files.length) {
    const named = whatOf(files);
    return none('workspace',
      files.length === 1 ? t`${named} is in another workspace` : t`${named} are in another workspace`,
      t`Files stay in their own workspace`);
  }
  const ours = abroad.length ? files.filter((f) => !abroad.includes(f)) : files;

  const here = ours.filter((f) => f.boardId === target.boardId);
  const away = ours.filter((f) => f.boardId !== target.boardId);
  const ready = away.filter((f) => !f.uploading);

  if (!ready.length) {
    if (target.where === 'board' && here.length) {
      const named = whatOf(here);
      return {
        action: 'place', reason: null, move: [], copy: [], place: here, moveIds: [], copyIds: [], placeIds: ids(here), effect: 'move',
        label: { top: t`Put ${named} here`, sub: t`Onto the board, where you let go`, hint: '', no: false },
      };
    }
    if (away.length) return none('uploading', t`Still uploading`, t`Try again when they’ve finished`);
    return none('same', t`Already in ${name}`, here.length === 1 ? t`Drop it on another cluster` : t`Drop them on another cluster`);
  }

  const copying = ready.filter((f) => copy || f.canMove === false);
  const moving = ready.filter((f) => !copy && f.canMove !== false);
  const placing = target.where === 'board' ? here : [];
  const action = moving.length && copying.length ? 'mixed' : moving.length ? 'move' : 'copy';
  const what = whatOf(ready);
  const one = ready.length === 1;
  const from = clip(sourceName, 24);

  let top;
  const movingCount = moving.length;
  const copyingCount = copying.length;
  if (action === 'mixed') top = t`Move ${movingCount} and copy ${copyingCount} to ${name}`;
  else if (action === 'move') top = t`Move ${what} to ${name}`;
  else top = t`Copy ${what} to ${name}`;

  let sub;
  if (target.where === 'files') sub = t`Into its files, not onto its board`;
  else if (action === 'copy') sub = t`Onto the board, where you let go`;
  else {
    const where = from || t`where they were`;
    sub = one ? t`Onto the board · it leaves ${where}` : t`Onto the board · they leave ${where}`;
  }

  let hint = '';
  if (action === 'move') { const key = copyKeyName(mac); hint = t`Hold ${key} to copy instead`; }
  else if (copy) hint = from ? (one ? t`The original stays in ${from}` : t`The originals stay in ${from}`) : '';
  else hint = from ? (one ? t`${from} is view only, so it’s copied` : t`${from} is view only, so they’re copied`) : t`Some are view only, so they’re copied`;

  return {
    action, reason: null, move: moving, copy: copying, place: placing,
    moveIds: ids(moving), copyIds: ids(copying), placeIds: ids(placing),
    effect: action === 'copy' ? 'copy' : 'move',
    label: { top, sub, hint, no: false },
  };
}
