import * as Y from 'yjs';
import fs from 'fs';

const b64 = fs.readFileSync('/tmp/branding.b64', 'utf8').trim();
const bytes = Buffer.from(b64, 'base64');
const ydoc = new Y.Doc();
Y.applyUpdate(ydoc, new Uint8Array(bytes), 'snapshot');

const cards = ydoc.getMap('cards');
const groups = ydoc.getArray('groups');
const groupNameById = new Map();
groups.forEach(g => {
  const id = g?.get?.('id') ?? g?.id;
  const name = g?.get?.('name') ?? g?.name;
  if (id) groupNameById.set(String(id), name || '');
});

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const out = [];
cards.forEach((v, id) => {
  if (!v) return;
  const get = (k) => v?.get?.(k) ?? v?.[k];
  const kind = get('kind') || 'note';
  const title = get('title') || get('name') || get('label') || get('url') || '';
  const rawBody = get('body') || get('caption') || '';
  const body = rawBody || htmlToText(get('html') || '');
  const groupId = get('groupId') || null;
  const groupName = groupId ? (groupNameById.get(String(groupId)) || '') : '';
  out.push({ id, kind, title: String(title).slice(0, 200), body: body.slice(0, 500), groupId, groupName });
});
console.log(JSON.stringify(out, null, 2));
