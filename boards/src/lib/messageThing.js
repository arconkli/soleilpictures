// messageThing — what a message that sends a card or a cluster says and how
// its attachments group into preview cards. Pure.
//
// The server builds the same small shape ({ kind, title, count }) in SQL
// (message_thing, 0904) for the chat list and the inbox ping; thingOf below
// mirrors it for a message already in the thread.

import { t as tr, plural, ph } from '@lingui/core/macro';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// The first card or cluster a message carries, and how many cards it carries.
// Mirrors message_thing(): title trimmed to 80, '' when it has none.
export function thingOf(attachments) {
  const list = Array.isArray(attachments) ? attachments.filter((a) => isObj(a) && (a.kind === 'card' || a.kind === 'board')) : [];
  if (!list.length) return null;
  const first = list[0];
  return {
    kind: first.kind,
    title: String(first.title == null ? '' : first.title).trim().slice(0, 80),
    count: list.filter((a) => a.kind === 'card').length,
  };
}

// The words for a message with no words of its own.
//   no mine, no who   "Sent a card: Alley, neon"   (a DM from them, a notification)
//   mine              "You sent a card: Alley, neon"
//   who               "Andrew sent a card: Alley, neon"   (a group, a toast)
export function thingLine(thing, { mine = false, who = null } = {}) {
  if (!isObj(thing)) return '';
  const title = String(thing.title || '').trim();
  const count = Number(thing.count) || 0;
  const cluster = thing.kind === 'board';
  const many = !cluster && count > 1;
  if (mine) {
    if (many) return tr`You sent ${plural(count, { one: '# card', other: '# cards' })}`;
    if (cluster) return title ? tr`You sent ${title}` : tr`You sent a cluster`;
    return title ? tr`You sent a card: ${title}` : tr`You sent a card`;
  }
  if (who) {
    if (many) return tr`${who} sent ${plural(count, { one: '# card', other: '# cards' })}`;
    if (cluster) return title ? tr`${who} sent ${title}` : tr`${who} sent a cluster`;
    return title ? tr`${who} sent a card: ${title}` : tr`${who} sent a card`;
  }
  if (many) return tr`Sent ${plural(count, { one: '# card', other: '# cards' })}`;
  if (cluster) return title ? tr`Sent ${title}` : tr`Sent a cluster`;
  return title ? tr`Sent a card: ${title}` : tr`Sent a card`;
}

// Render units for the preview card. A cluster with a snapshot is one unit;
// card attachments with a snapshot, and the snapshot-less ones that follow
// them from the same cluster, are one unit per consecutive run. Anything else
// (older messages, which carry no snapshot) is not a unit and keeps the plain
// row it always had.
export function sharedUnits(attachments) {
  const units = [];
  let run = null;
  for (const att of Array.isArray(attachments) ? attachments : []) {
    if (!isObj(att)) { run = null; continue; }
    if (att.kind === 'board' && isObj(att.snap)) {
      units.push({ type: 'cluster', boardId: att.boardId || att.id || null, att });
      run = null;
      continue;
    }
    if (att.kind === 'card') {
      const boardId = att.boardId || null;
      if (isObj(att.snap)) {
        if (run && run.boardId === boardId) run.cards.push(att);
        else {
          run = { type: 'cards', boardId, boardTitle: att.boardTitle || '', cards: [att] };
          units.push(run);
        }
        continue;
      }
      if (run && run.boardId === boardId) { run.cards.push(att); continue; }
    }
    run = null;
  }
  return units;
}

// Every attachment a unit draws, so the plain rows can skip them.
export function unitAttachments(unit) {
  return unit.type === 'cluster' ? [unit.att] : unit.cards;
}

const KEY_MAX = 300;

// A storage key, or null. Cards keep pictures as 'r2:<key>'; a web address, a
// data: or blob: value is never one.
export function storageKey(v) {
  if (typeof v !== 'string') return null;
  const s = v.startsWith('r2:') ? v.slice(3) : v;
  if (!s || s.length > KEY_MAX || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return null;
  return s;
}

// ── The words for a card's kind, shared by the Send sheet and the chat card ──

export const isNoteKind = (k) => k === 'note' || k === 'text';

// What a card with no title of its own is called.
export function kindWord(kind) {
  if (isNoteKind(kind)) return tr`Note`;
  if (kind === 'palette') return tr`Palette`;
  if (kind === 'link') return tr`Link`;
  if (kind === 'image') return tr`Picture`;
  return tr`Card`;
}

function metaLinkLine(host) {
  return tr`Link · ${host}`;
}

// The quiet line under a preview's name: "Note · Night shoot", "3 cards · Night
// shoot", "Cluster in Studio".
export function unitMeta({ cluster, several, count, kind, snap = {}, boardTitle }) {
  if (cluster) return snap.ws ? tr`Cluster in ${ph({ ws: snap.ws })}` : tr`Cluster`;
  const board = String(boardTitle || '').trim();
  if (several) {
    return board
      ? plural(count, { one: `# card · ${board}`, other: `# cards · ${board}` })
      : plural(count, { one: '# card', other: '# cards' });
  }
  if (kind === 'link') return snap.host ? metaLinkLine(snap.host) : tr`Link`;
  if (isNoteKind(kind)) return board ? tr`Note · ${board}` : tr`Note`;
  if (kind === 'palette') return board ? tr`Palette · ${board}` : tr`Palette`;
  return board ? tr`Card · ${board}` : tr`Card`;
}
