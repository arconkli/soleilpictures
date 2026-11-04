// showcaseWrite.mjs — puts an engine board into the Showcase workspace and the
// library (supabase/migrations/0820_showcase_library.sql).
//
// The board is a real board, written the way seedBoard.mjs writes one: a
// boards row (its parent set at insert, under the subject's cluster), its
// photos in R2 with an images row each, the Yjs state and the card index. Its
// shots go to R2 under showcase/<board id>/, which only the signed links the
// library hands out can read (worker-showcase.js).
//
// Service role only: these tables have no grants for anyone else.

import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBoardSnapshot, buildCardIndexRows } from './cardEncode.mjs';
import { withSources, stripBuild, photoKeysOf } from '../engine/build.mjs';
import { CREW } from '../engine/crew.mjs';
import { PDF } from '../engine/pdfs.mjs';
import { RESERVED } from '../engine/recipe.mjs';

// A PDF's page-1 picture: the page's width at the thumb's, its height in proportion.
const PDF_THUMB = { w: PDF.thumbW, h: Math.round(PDF.thumbW * PDF.pageH / PDF.pageW) };

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', m4a: 'audio/mp4',
  pdf: 'application/pdf', zip: 'application/zip' };
const typeOf = (file) => TYPES[file.split('.').pop().toLowerCase()] || 'application/octet-stream';

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** The workspace's root cluster: its first live top-level board. */
export async function rootCluster(supa, workspaceId) {
  const rows = must(await supa.from('boards').select('id, name').eq('workspace_id', workspaceId)
    .is('parent_board_id', null).is('deleted_at', null).order('created_at', { ascending: true }).limit(1), 'root cluster');
  if (!rows?.length) throw new Error('the Showcase workspace has no live root cluster');
  return rows[0];
}

/** The subject's cluster under the root, made when it's missing. → its id */
export async function ensureCluster(supa, { workspaceId, userId, rootId, name }) {
  const rows = must(await supa.from('boards').select('id').eq('workspace_id', workspaceId).eq('parent_board_id', rootId)
    .eq('name', name).is('deleted_at', null).limit(1), 'find cluster');
  if (rows?.length) return rows[0].id;
  const id = randomUUID();
  must(await supa.from('boards').insert({ id, workspace_id: workspaceId, parent_board_id: rootId, name, view: 'canvas', created_by: userId }), 'make cluster');
  return id;
}

/**
 * The board, its files and its state, its sub-clusters, and the people on it.
 * Undone as far as it got when a step fails.
 *   board: buildBoard()'s { name, bg, cards, groups, arrows, strokes, children,
 *     tags, comments, vote } (cards carry `photo` keys; a photo grid, `photos`;
 *     a sound, `coverPhoto`)
 *   found: Map('si.ii' → a picture, a sound (media 'sound') or a PDF (media 'pdf'))
 *   crew: crew.mjs's Map(crew key → user id), who signs the comments and votes
 * → { boardId, cards (as stored), heroKey }
 *
 * Every file is stored the way an upload is: in R2 with an images row on its
 * card. A sound's cover is its own copy, so deleting the picture it came from
 * never takes the sound's cover with it. A sub-cluster is a real board under
 * this one, its card's id that board's id. Comments, the vote and its ballots
 * are the crew's own rows; the tags are the workspace's, found by name or made.
 */
export async function writeBoard({ supa, r2, workspaceId, userId, parentId, board, found, crew = new Map(), log = () => {} }) {
  const boardId = randomUUID();
  const uploaded = [];
  const madeBoards = []; // in the order made: undone last-first, so no board is ever left under a gone one
  const madeTags = [];
  const put = async (file, ext) => {
    const key = `${workspaceId}/${randomUUID()}.${ext}`;
    await r2.put(key, readFileSync(file), typeOf(file));
    uploaded.push(key);
    return key;
  };
  const makeBoard = async (id, parent, name, bg) => {
    must(await supa.from('boards').insert({ id, workspace_id: workspaceId, parent_board_id: parent,
      name, view: 'canvas', created_by: userId, ...(bg ? { bg_color: bg } : {}) }), 'boards insert');
    madeBoards.push(id);
  };
  // One found item's files → [what, key, file, name, w, h]
  const upload = async (it) => {
    if (it.media === 'sound') return [['sound', await put(it.file, 'm4a'), it.file, null, null, null]];
    if (it.media === 'pdf') {
      return [['pdf', await put(it.file, 'pdf'), it.file, it.name, it.width, it.height],
        ['thumb', await put(it.thumb, 'webp'), it.thumb, null, PDF_THUMB.w, PDF_THUMB.h]];
    }
    if (it.video) return [['video', await put(it.video, 'mp4'), it.video, null, it.w, it.h], ['poster', await put(it.file, 'jpg'), it.file, null, it.w, it.h]];
    return [['src', await put(it.file, 'jpg'), it.file, null, it.w, it.h]];
  };
  // One board's cards: their files up, their images rows in, their srcs on. → the cards as stored
  const storeCards = async (bid, raw) => {
    const keys = new Map(); // 'si.ii' → { what → key }
    const covers = new Map(); // sound card id → its cover's key
    const rows = [];
    const row = (cardId, [, key, file, name, w, h]) => rows.push({ workspace_id: workspaceId, board_id: bid, card_id: cardId, storage_path: key,
      width: w ?? null, height: h ?? null, size_bytes: statSync(file).size, original_name: name || null,
      uploaded_by: userId, referenced_in_board_ids: [bid] });
    for (const c of raw) {
      for (const pk of photoKeysOf(c)) {
        if (keys.has(pk)) continue;
        const files = await upload(found.get(pk));
        keys.set(pk, Object.fromEntries(files.map(([what, key]) => [what, key])));
        for (const f of files) row(c.id, f);
      }
      if (c.kind === 'audio' && c.coverPhoto && found.get(c.coverPhoto)) {
        const ph = found.get(c.coverPhoto);
        const key = await put(ph.file, 'jpg');
        covers.set(c.id, key);
        row(c.id, ['cover', key, ph.file, null, ph.w, ph.h]);
      }
    }
    if (rows.length) must(await supa.from('images').insert(rows), 'images insert');
    const keyOf = new Map([...found].map(([k, it]) => [it, k]));
    const cards = stripBuild(withSources(raw, found, (it, what, c) => `r2:${what === 'cover' ? covers.get(c.id) : keys.get(keyOf.get(it))[what]}`));
    return { cards, files: rows.length };
  };
  const storeState = async (bid, cards, arrows, extras) => {
    const b64 = encodeBoardSnapshot(cards, arrows || [], extras);
    must(await supa.from('board_state').upsert({ board_id: bid, doc: b64, updated_at: new Date().toISOString() }, { onConflict: 'board_id' }), 'board_state');
    must(await supa.from('card_index').upsert(buildCardIndexRows({ workspaceId, boardId: bid, cards }), { onConflict: 'board_id,card_id' }), 'card_index');
  };
  try {
    await makeBoard(boardId, parentId, board.name, board.bg);
    const { cards, files } = await storeCards(boardId, board.cards);
    await storeState(boardId, cards, board.arrows, { groups: board.groups, strokes: board.strokes || [] });
    log(`write: ${files} file(s) up`);

    // The sub-clusters: boards under this one, each with its own pictures.
    for (const ch of board.children || []) {
      await makeBoard(ch.id, boardId, ch.name, ch.bg);
      const sub = await storeCards(ch.id, ch.cards);
      await storeState(ch.id, sub.cards, ch.arrows, { groups: ch.groups || [] });
      log(`write: sub-cluster "${ch.name}", ${sub.files} file(s)`);
    }

    // The tags: the workspace's own when one has the name, else a new one.
    const links = [];
    for (const t of board.tags || []) {
      const name = String(t.name || '').trim();
      if (!name || !t.cardIds?.length) continue;
      let tag = must(await supa.from('tags').select('id, status').eq('workspace_id', workspaceId).eq('slug', name.toLowerCase()).maybeSingle(), 'tag find');
      if (tag && tag.status && tag.status !== 'active') { log(`write: tag "${name}" is ${tag.status}; left off`); continue; }
      if (!tag) {
        tag = must(await supa.from('tags').insert({ workspace_id: workspaceId, name, kind: 'user', created_by: userId }).select('id').single(), 'tag insert');
        madeTags.push(tag.id);
      }
      for (const cardId of t.cardIds) {
        // Two tag names can land on one tag (one slug), or a card be listed twice: one link each.
        if (links.some((l) => l.source_id === cardId && l.target_id === tag.id)) continue;
        links.push({ source_kind: 'card', source_id: cardId, source_workspace: workspaceId, source_board_id: boardId,
          target_kind: 'tag', target_id: tag.id, link_kind: 'applied', source: 'user', created_by: userId });
      }
    }
    if (links.length) {
      // The app's own auto-tagger (the autotag_on_* triggers) has already linked any card whose words name
      // one of these tags, when card_index or the tag was written; those links stand, the rest go in.
      const have = must(await supa.from('entity_links').select('source_id, target_id')
        .eq('source_board_id', boardId).eq('target_kind', 'tag'), 'entity_links read') || [];
      const fresh = links.filter((l) => !have.some((h) => h.source_id === l.source_id && h.target_id === l.target_id));
      if (fresh.length) must(await supa.from('entity_links').insert(fresh), 'entity_links insert');
    }

    // The crew's comments, each reply under its comment.
    const who = (key) => {
      const id = crew.get(key);
      if (!id) throw new Error(`no crew id for "${key}"`);
      return id;
    };
    const commentRow = (anchorId, author, body, offset, replyTo) => ({ workspace_id: workspaceId, board_id: boardId, author, body,
      reply_to: replyTo, anchor_kind: 'card', anchor_id: anchorId, anchor_x: null, anchor_y: null, doc_page_id: null, doc_from: null, doc_to: null,
      offset_x: Math.round(offset?.x || 0), offset_y: Math.round(offset?.y || 0) });
    for (const c of board.comments || []) {
      const top = must(await supa.from('comments').insert(commentRow(c.cardId, who(c.by), c.text, c.offset, null)).select('id').single(), 'comment insert');
      if (c.reply) must(await supa.from('comments').insert(commentRow(c.cardId, who(c.reply.by), c.reply.text, null, top.id)), 'reply insert');
    }

    // The vote: one crew member asks, then each ballot is a different one of them.
    if (board.vote) {
      const v = board.vote;
      const asker = who(CREW[0].key);
      const card = must(await supa.from('vote_cards').insert({ workspace_id: workspaceId, board_id: boardId, author: asker, label: v.label,
        anchor_kind: 'card', anchor_id: v.cardId, anchor_x: null, anchor_y: null,
        offset_x: Math.round(v.offset?.x || 0), offset_y: Math.round(v.offset?.y || 0) }).select('id').single(), 'vote insert');
      const voters = CREW.map((m) => crew.get(m.key)).filter(Boolean);
      const want = (v.up || 0) + (v.down || 0);
      if (want > voters.length) throw new Error(`a vote of ${want} needs ${want} people; the crew is ${voters.length}`);
      const ballots = voters.slice(0, want).map((uid, i) => ({ vote_card_id: card.id, board_id: boardId, user_id: uid, value: i < (v.up || 0) ? 1 : -1 }));
      if (ballots.length) must(await supa.from('vote_card_ballots').insert(ballots), 'ballots insert');
    }
    if ((board.comments || []).length || board.vote || links.length) {
      log(`write: ${(board.comments || []).length} comment(s), ${board.vote ? 'a vote' : 'no vote'}, ${links.length} tag(s) on cards`);
    }

    // The hero: the biggest picture, or a photo grid's first cell when every picture is in a grid.
    const hero = cards.filter((c) => c.kind === 'image').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    const cell = Object.values(cards.find((c) => c.kind === 'grid')?.gridCells || {}).find((x) => x?.type === 'image' && x.src);
    const heroSrc = hero?.src || cell?.src || null;
    return { boardId, cards, heroKey: heroSrc ? heroSrc.replace(/^r2:/, '') : null };
  } catch (e) {
    log(`write: failed (${e.message}); undoing`);
    // A board's rows (state, index, comments, votes, tag links) go with it; its images rows don't.
    for (const id of [...madeBoards].reverse()) {
      await supa.from('images').delete().eq('board_id', id);
      await supa.from('boards').delete().eq('id', id);
    }
    for (const id of madeTags) await supa.from('tags').delete().eq('id', id);
    for (const key of uploaded) { try { await r2.del(key); } catch (_) { /* best effort */ } }
    throw e;
  }
}

/** The shots, their thumbs and the zip, to showcase/<board id>/. → the shots as the library lists them */
export async function uploadShots({ r2, boardId, outDir, shots, zip }) {
  const out = [];
  for (const s of shots) {
    const dir = s.dir ? join(outDir, s.dir) : outDir;
    await r2.put(`showcase/${boardId}/${s.file}`, readFileSync(join(dir, s.file)), typeOf(s.file));
    if (s.thumb) await r2.put(`showcase/${boardId}/${s.thumb}`, readFileSync(join(dir, s.thumb)), typeOf(s.thumb));
    out.push({ kind: s.kind, label: s.label, file: s.file, ...(s.thumb ? { thumb: s.thumb } : {}), w: s.w, h: s.h, bytes: s.bytes,
      ...(s.theme ? { theme: s.theme } : {}) });
  }
  if (zip) {
    const bytes = readFileSync(join(outDir, zip));
    await r2.put(`showcase/${boardId}/${zip}`, bytes, typeOf(zip));
    out.push({ kind: 'zip', label: 'Everything (zip)', file: zip, w: 0, h: 0, bytes: bytes.length });
  }
  return out;
}

/** The library's row for the board. */
export async function recordShowcase(supa, row) {
  must(await supa.from('showcase_boards').insert(row), 'showcase_boards insert');
}

/**
 * Gives a post's board a public address at /c/<word>, unlisted: the page answers but is noindex and
 * left out of every listing (public_boards.unlisted). Tries each word in order, skipping the paths
 * the site owns and moving on when a word is taken (23505).
 * `userId` (the showcase account) is written as created_by; without it nothing is written.
 * → { slug } or { why }
 */
export async function publishPostBoard({ supa, boardId, userId, words = [], title, description }) {
  // The sharing ledger credits an unlisted page to its maker (0860's check), so no maker, no page.
  if (!userId) return { why: 'no maker' };
  const tried = [];
  for (const raw of words) {
    const slug = String(raw || '').trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || RESERVED.has(slug)) { tried.push(`${slug || '(empty)'}: not usable`); continue; }
    const now = new Date().toISOString();
    const { error } = await supa.from('public_boards').upsert({
      board_id: boardId, slug, seo_title: String(title || '').trim() || null, seo_description: String(description || '').trim() || null,
      priority: 0, is_template: false, review_status: 'approved', published_at: now, updated_at: now,
      unlisted: true, published_by: 'post', created_by: userId,
    }, { onConflict: 'board_id' });
    if (!error) return { slug };
    if (error.code === '23505') { tried.push(`${slug}: taken`); continue; }
    return { why: `public_boards upsert: ${error.message}` };
  }
  return { why: tried.length ? `no word was free (${tried.join('; ')})` : 'no words given' };
}

// Which make of the engine a board came from, kept in its score. A page whose board an older make made
// (round 3's looks without every tool, say) gets a new one from --batch. Raise it when every page
// should be made again.
export const ENGINE_MAKE = 4;

/** What the library already holds: slugs, photo ids and hashes (never reused), and the marketing boards made. */
export async function libraryState(supa) {
  const rows = must(await supa.from('showcase_boards').select('slug, subject, page_path, made_at, credits, phash, status, decided_by, score').order('made_at'), 'library');
  const pub = must(await supa.from('public_boards').select('slug'), 'public slugs');
  return {
    taken: [...rows.map((r) => r.slug), ...pub.map((r) => r.slug)],
    used: {
      ids: new Set(rows.flatMap((r) => (r.credits || []).map((c) => c.id).filter(Boolean))),
      hashes: rows.flatMap((r) => r.phash || []),
    },
    // Boards made to a brief for a post (subject 'tiktok') are not the library's: they never hold up the
    // daily or turn the marketing rotation. Their slugs and photos still count above.
    made: rows.filter((r) => !r.page_path && r.subject !== 'tiktok').map((r) => ({ subject: r.subject, made_at: r.made_at })),
    // A page whose board was skipped still needs one, and so does one whose board an older make of the
    // engine made (ENGINE_MAKE): --batch makes it again.
    pages: new Set(rows.filter((r) => r.page_path && r.status !== 'skipped' && (r.score?.make || 0) >= ENGINE_MAKE).map((r) => r.page_path)),
    okByPerson: rows.filter((r) => r.status === 'ok' && r.decided_by).length,
    // The looks of the boards made, oldest first: the next board takes the one used longest ago.
    styles: rows.map((r) => r.score?.style).filter(Boolean),
  };
}

export async function startRun(supa, kind) {
  const rows = must(await supa.from('showcase_runs').insert({ kind }).select('id'), 'run start');
  return rows[0].id;
}

export async function finishRun(supa, id, { ok, made, dropped, note }) {
  must(await supa.from('showcase_runs').update({ finished_at: new Date().toISOString(), ok, made, dropped, note: note ? String(note).slice(0, 2000) : null })
    .eq('id', id), 'run finish');
}
