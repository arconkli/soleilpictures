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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeBoardSnapshot, buildCardIndexRows } from './cardEncode.mjs';
import { withSources, stripBuild } from '../engine/build.mjs';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', zip: 'application/zip' };
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
 * The board, its photos and its state. Undone as far as it got when a step fails.
 *   board: buildBoard()'s { name, cards, groups } (cards carry `photo` keys)
 *   found: photos.mjs's Map('si.ii' → photo)
 * → { boardId, cards (as stored), heroKey }
 */
export async function writeBoard({ supa, r2, workspaceId, userId, parentId, board, found, log = () => {} }) {
  const boardId = randomUUID();
  const uploaded = [];
  const put = async (file, ext) => {
    const key = `${workspaceId}/${randomUUID()}.${ext}`;
    await r2.put(key, readFileSync(file), typeOf(file));
    uploaded.push(key);
    return key;
  };
  try {
    must(await supa.from('boards').insert({ id: boardId, workspace_id: workspaceId, parent_board_id: parentId,
      name: board.name, view: 'canvas', created_by: userId }), 'boards insert');

    const keys = new Map(); // photo key → { src | video + poster }
    const rows = [];
    for (const c of board.cards) {
      if (!c.photo) continue;
      const ph = found.get(c.photo);
      const k = ph.video ? { video: await put(ph.video, 'mp4'), poster: await put(ph.file, 'jpg') } : { src: await put(ph.file, 'jpg') };
      keys.set(c.photo, k);
      for (const key of Object.values(k)) {
        rows.push({ workspace_id: workspaceId, board_id: boardId, card_id: c.id, storage_path: key, width: ph.w, height: ph.h,
          uploaded_by: userId, referenced_in_board_ids: [boardId] });
      }
    }
    if (rows.length) must(await supa.from('images').insert(rows), 'images insert');
    log(`write: ${uploaded.length} photo file(s) up`);

    const keyOf = new Map([...found].map(([k, ph]) => [ph, k]));
    const cards = stripBuild(withSources(board.cards, found, (ph, what) => `r2:${keys.get(keyOf.get(ph))[what]}`));
    const nowIso = new Date().toISOString();
    const b64 = encodeBoardSnapshot(cards, [], { groups: board.groups });
    must(await supa.from('board_state').upsert({ board_id: boardId, doc: b64, updated_at: nowIso }, { onConflict: 'board_id' }), 'board_state');
    must(await supa.from('card_index').upsert(buildCardIndexRows({ workspaceId, boardId, cards }), { onConflict: 'board_id,card_id' }), 'card_index');
    const hero = cards.filter((c) => c.kind === 'image').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    return { boardId, cards, heroKey: hero ? hero.src.replace(/^r2:/, '') : null };
  } catch (e) {
    log(`write: failed (${e.message}); undoing`);
    await supa.from('images').delete().eq('board_id', boardId);
    await supa.from('boards').delete().eq('id', boardId);
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

/** What the library already holds: slugs, photo ids and hashes (never reused), and the marketing boards made. */
export async function libraryState(supa) {
  const rows = must(await supa.from('showcase_boards').select('slug, subject, page_path, made_at, credits, phash, status, decided_by'), 'library');
  const pub = must(await supa.from('public_boards').select('slug'), 'public slugs');
  return {
    taken: [...rows.map((r) => r.slug), ...pub.map((r) => r.slug)],
    used: {
      ids: new Set(rows.flatMap((r) => (r.credits || []).map((c) => c.id).filter(Boolean))),
      hashes: rows.flatMap((r) => r.phash || []),
    },
    made: rows.filter((r) => !r.page_path).map((r) => ({ subject: r.subject, made_at: r.made_at })),
    pages: new Set(rows.filter((r) => r.page_path).map((r) => r.page_path)),
    okByPerson: rows.filter((r) => r.status === 'ok' && r.decided_by).length,
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
