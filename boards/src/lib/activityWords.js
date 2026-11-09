// activityWords — the words for what activity.js is moving. Pure.
//
// The time-left rounding comes from importCopy.js (the bulk import says it the
// same way); nothing here rounds time itself. The tray's batch words are in
// activityTray.js.

import { etaLabel } from './importCopy.js';

const ACTIVE = new Set(['waiting', 'running', 'finishing']);
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// "about 3 min left", "less than a minute left", "about 1 hr 20 min left"
export function etaWords(ms) {
  const s = etaLabel(ms);
  return s ? lower(s) : null;
}

// The card form, without " left": "about 3 min"
export function etaShort(ms) {
  const s = etaWords(ms);
  return s ? s.replace(/ left$/, '') : null;
}

// What a card says about its own upload. null once it is done. The time left
// is read off the item (etaText, kept fresh by activity.js), so this never
// reads the clock; `now` is accepted and ignored.
export function cardTransferWords(item) {
  if (!item) return null;
  switch (item.state) {
    case 'waiting': return { tone: 'wait', text: item.paused ? 'Paused' : 'Waiting', sub: null, pct: null };
    case 'running': {
      const pct = Math.min(99, Math.floor((item.fraction || 0) * 100));
      // A new version of a file reads as that: "Uploading version 3" and its percent.
      if (item.version?.n) return { tone: 'up', text: `Uploading version ${item.version.n}`, sub: `${pct}%`, pct };
      return { tone: 'up', text: `${pct}%`, sub: item.etaText || null, pct };
    }
    case 'finishing': return { tone: 'busy', text: 'Making a preview…', sub: null, pct: null };
    case 'failed': return { tone: 'fail', text: 'Didn’t upload', sub: null, pct: null };
    default: return null;
  }
}

// Downloads, exports and copies (lib/activityOps.js). `label` is the subject
// for a download (a file or zip name) and the whole running sentence for an
// export and a copy: build it with exportWords / copyWords.
const FORMATS = { pdf: 'PDF', png: 'PNG', html: 'HTML', md: 'Markdown', markdown: 'Markdown' };
const countOf = (n) => Number(n).toLocaleString('en-US');

export const exportWords = ({ name, format }) => `Exporting ${name} as ${FORMATS[String(format).toLowerCase()] || format}…`;
export const copyWords = ({ count = null, name = null } = {}) => (count != null ? `Copying ${countOf(count)} ${count === 1 ? 'card' : 'cards'}…`
  : name ? `Copying ${name}…` : 'Copying…');
export const copyDoneWords = ({ personal = false } = {}) => (personal ? 'Copied to your personal workspace' : 'Copied');

// The running title of an op item, and its done title.
export function opWords(item) {
  if (!item) return null;
  const done = item.state === 'done';
  const name = item.label || null;
  switch (item.kind) {
    case 'download': {
      const total = item.count?.total || 0;
      if (done) return item.doneLabel || (name ? `Downloaded ${name}` : 'Download started');
      if (total >= 2) return `Preparing download · ${countOf(item.count.done || 0)} of ${countOf(total)} files`;
      return name ? `Preparing ${name}…` : 'Preparing download…';
    }
    case 'export': return done ? (item.doneLabel || 'Exported') : (name || 'Exporting…');
    case 'copy': return done ? (item.doneLabel || 'Copied') : (name || 'Copying…');
    default: return null;
  }
}

// What another tab of mine, or a teammate, is uploading from elsewhere.
export function awayWords({ name, mine }) {
  return { tone: 'up', text: mine ? 'Uploading in another tab' : `${name} is uploading`, sub: null, pct: null };
}

export function hasActiveTransfers(snapshot) {
  return (snapshot?.items || []).some((i) => ACTIVE.has(i.state) && !i.parked);
}

// "(6/12) " over every upload batch with something still going.
export function titlePrefix(snapshot) {
  const live = new Set();
  for (const i of snapshot?.items || []) if (ACTIVE.has(i.state) && !i.parked) live.add(i.batch);
  let total = 0;
  let done = 0;
  for (const b of snapshot?.batches || []) {
    if (b.kind !== 'upload' || b.hidden || !live.has(b.id)) continue;
    for (const i of snapshot.items) {
      if (i.batch !== b.id || i.parked) continue;
      total++;
      if (i.state === 'done') done++;
    }
  }
  return total > 0 ? `(${done}/${total}) ` : '';
}
