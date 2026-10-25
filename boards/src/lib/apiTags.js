// apiTags — tags through the API (P2 S6): the limits, reading a request, and
// the shapes the routes answer with. Pure, so the routes in worker-api.js stay
// thin and the tests need no network.
//
// The tags are the app's own (lib/tagsApi.js), and every write is the one the
// app makes, as the signed-in person, under the same row-level security. A tag
// is a row of `tags`, one per workspace and name (its slug is lower(name),
// 0032). A tag on a card is an `entity_links` row (source_kind 'card',
// link_kind 'applied', source 'user'). Taking one off a card also files the
// pair in `autotag_ignored`, which keeps automatic tagging from putting it back
// (the 0590 guard), and putting it on again lifts that.

import { boardUrl, cardUrl } from './gallery.js';

export const TAGS = Object.freeze({
  // Cards one POST /boards/:id/tags names.
  maxCards: 200,
  // Tags it puts on, and tags it takes off: with maxCards, at most 2,000
  // tags placed in one call.
  maxNames: 10,
  // Characters in a new tag's name. The app sets no limit; a tag is a label.
  maxName: 80,
  // What GET /tags/:id lists, the most recently tagged first.
  defaultItems: 100,
  maxItems: 500,
});

// What a tag row is read with, everywhere.
export const TAG_FIELDS = 'id,name,color,description,entity_type,created_at';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

// A tag's name as given: each run of spaces one space, trimmed, and a leading
// '#' taken off (⌘K writes a tag as #name, and people copy it that way). Null
// when nothing is left.
export function cleanTagName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
  return name || null;
}

// How a workspace tells two names apart: the tag's slug.
export const tagSlug = (name) => name.toLowerCase();

// POST /boards/:id/tags {"card_ids":[…],"add":[…],"remove":[…]}:
//   { cardIds, add: [tag], remove: [tag] }, each tag { name, slug } or { name, id },
//   or { problem } saying what to fix.
export function readTagRequest(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return { problem: 'send {"card_ids":[…],"add":[…],"remove":[…]}' };
  }
  const extra = Object.keys(b).find((k) => !['card_ids', 'add', 'remove'].includes(k));
  if (extra) return { problem: `${extra} isn't a field here: send card_ids, with add, remove or both` };
  if (!Array.isArray(b.card_ids) || !b.card_ids.length) return { problem: 'card_ids must list the cards' };
  if (b.card_ids.some((x) => typeof x !== 'string' || !x || x.length > 200)) {
    return { problem: 'card_ids must be the ids of cards' };
  }
  const cardIds = [...new Set(b.card_ids)];
  if (cardIds.length > TAGS.maxCards) {
    return { problem: `card_ids names ${cardIds.length} cards; one call tags at most ${TAGS.maxCards}` };
  }
  const add = readTags(b.add, 'add');
  if (add.problem) return add;
  const remove = readTags(b.remove, 'remove');
  if (remove.problem) return remove;
  if (!add.tags.length && !remove.tags.length) return { problem: 'name the tags to add, or to remove' };
  const both = add.tags.find((t) => remove.tags.some((r) => sameTag(r, t)));
  if (both) return { problem: `${both.name} is both added and removed: leave it out of one` };
  return { cardIds, add: add.tags, remove: remove.tags };
}

const sameTag = (a, b) => (a.id ? a.id === b.id : a.slug === b.slug);

// A list of tags, each a name or a tag's id. The same tag twice counts once.
function readTags(list, field) {
  if (list == null) return { tags: [] };
  if (!Array.isArray(list)) return { problem: `${field} must be a list of tag names` };
  if (list.length > TAGS.maxNames) {
    return { problem: `${field} names ${list.length} tags; one call takes at most ${TAGS.maxNames}` };
  }
  const tags = [];
  for (const raw of list) {
    const name = cleanTagName(raw);
    if (!name || CONTROL.test(name)) return { problem: `${field} must list tag names, and ${JSON.stringify(raw)} isn't one` };
    const tag = UUID.test(name) ? { name, id: name.toLowerCase() } : { name, slug: tagSlug(name) };
    // Only a name the workspace may not have yet is held to the limit: an
    // existing tag is found by its name whatever its length.
    if (field === 'add' && tag.slug && name.length > TAGS.maxName) {
      return { problem: `a new tag's name is at most ${TAGS.maxName} characters, and "${name.slice(0, 24)}…" is ${name.length}` };
    }
    if (!tags.some((t) => sameTag(t, tag))) tags.push(tag);
  }
  return { tags };
}

// Which tag each one asked for is, among the workspace's `rows` (found by id
// or slug, live or deleted).
export function matchTags(asked, rows) {
  return asked.map((t) => ({
    ...t,
    row: rows.find((r) => (t.id ? r.id === t.id : (r.slug ?? tagSlug(r.name)) === t.slug)) || null,
  }));
}

// A tag that is gone: deleted (0240), and so recoverable for 30 days by
// restore_tag. The app's line exactly (listWorkspaceTags, ensureTag): every
// other status is a tag it lists and applies.
export const isDeadTag = (row) => Boolean(row?.deleted_at) || row?.status === 'deleted';

// A tag as the API shows it. `items`, when given, is how many things carry it
// (null when the count couldn't be read).
export function publicTag(t, items) {
  return {
    id: t.id,
    name: t.name,
    color: t.color ?? null,
    entity_type: t.entity_type ?? null,
    description: t.description ?? null,
    ...(items === undefined ? {} : { items }),
    created_at: t.created_at ?? null,
  };
}

// A board's tags (GET /boards/:id/tags): every tag something on it carries,
// with the cards, groups and doc pages it is on, and whether the board itself
// carries it. `links` are the board's entity_links rows; `tags` the rows the
// person may read (a deleted tag, or one in a workspace they are not in, isn't
// listed). `live`, when the board could be read, holds what is still on it: a
// card deleted since keeps its links, so that undoing the delete brings them
// back, and isn't listed.
export function boardTags(links, tags, boardId, live = null) {
  const out = new Map(tags.map((t) => [t.id, { ...publicTag(t), on_board: false, cards: [], groups: [], pages: [] }]));
  const seen = new Set();
  for (const l of links) {
    const tag = out.get(l.target_id);
    if (!tag) continue;
    const key = `${l.target_id}|${l.source_kind}|${l.source_id}|${l.source_page_id || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = String(l.source_id);
    if (l.source_kind === 'board') {
      if (id === boardId) tag.on_board = true;
    } else if (l.source_kind === 'card') {
      if (!live || live.cards.has(id)) tag.cards.push(id);
    } else if (l.source_kind === 'group') {
      if (!live || live.groups.has(id)) tag.groups.push(id);
    } else if (l.source_kind === 'doc' && l.source_page_id) {
      if (!live || live.cards.has(id)) tag.pages.push({ card_id: id, page_id: l.source_page_id });
    }
  }
  return [...out.values()]
    .filter((t) => t.on_board || t.cards.length || t.groups.length || t.pages.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const excerpt = (s, n = 200) => {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
};

// One thing a tag is on (GET /tags/:id), from a get_things_tagged row (0590):
// a card, a group, a board, or a page of a doc, where it is, whether it was
// tagged automatically, and a link to it.
export function taggedItem(r, origin) {
  const common = {
    board_id: r.board_id ?? null,
    auto: Boolean(r.applied_source) && r.applied_source !== 'user',
    tagged_at: r.applied_at ?? null,
  };
  if (r.page_id) {
    return {
      kind: 'doc_page', ...common, board_name: r.board_name || null, card_id: r.card_id,
      page_id: r.page_id, title: r.title || null, excerpt: excerpt(r.body) || null,
      url: cardUrl(origin, r.board_id, r.card_id),
    };
  }
  if (r.kind === 'board') {
    const boardId = r.board_id || r.id;
    return { kind: 'board', ...common, board_id: boardId, title: r.title || null, url: boardUrl(origin, boardId) };
  }
  if (r.kind === 'group') {
    return {
      kind: 'group', ...common, board_name: r.board_name || null, group_id: r.group_id || null,
      title: r.title || null, cards: r.member_count ?? null, url: boardUrl(origin, r.board_id),
    };
  }
  return {
    kind: 'card', card_kind: r.kind ?? null, ...common, board_name: r.board_name || null,
    card_id: r.card_id, title: r.title || null, excerpt: excerpt(r.body || r.card_body) || null,
    url: cardUrl(origin, r.board_id, r.card_id),
  };
}
