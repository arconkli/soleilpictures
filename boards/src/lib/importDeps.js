// importDeps — the real side of importJob's deps: the 0430 tables and RPCs,
// /api/clusters/*, the upload functions and the card index.
//
// Everything that reaches the network is passed in (the Supabase client, the
// clustersApi calls, the upload functions, the budgets), so this file imports
// nothing with a network side of its own and its tests hand it fakes.
//
// Errors come out the way importJob reads them: `status` (HTTP), `code` (the
// route's error string, or the upload's 402/403), and `retry` for what is
// worth trying again — a room that didn't answer, a dropped connection.

import * as Y from 'yjs';
import { cardToYMap, bytesToB64 } from './yhelpers.js';
import { buildCardIndexRow } from './cardIndexRow.js';
import { cardIdFor } from './cardFromUpload.js';
import { meaningfulFileName } from './fileIngest.js';

const INDEX_CHUNK = 500;

// A clustersApi result ({ ok, status, error, message, retry }) → it, or a throw.
function okOrThrow(r, what) {
  if (r?.ok) return r;
  throw Object.assign(new Error(r?.message || `${what} failed`), {
    status: r?.status, code: r?.error, retry: r?.retry === true || r?.status === 503,
  });
}

// A Supabase { error } → a throw. PostgREST can't be reached → retry; the
// database said no → not worth repeating.
function dbError(error, what) {
  const unreachable = !error.code && /fetch|network|load failed/i.test(String(error.message || ''));
  return Object.assign(new Error(error.message || `${what} failed`), { code: error.code, retry: unreachable });
}

// What the target cluster's owner has room for, read fresh each time the
// import fills: the two answers the drop preflight asks (App buildMutators).
// get_board_capacity is what the card cap trigger enforces (0333), and
// authorize_image_upload's dry run (storageRoom) is what each upload will be
// told. A budget that can't be read is unlimited, as the preflight fails open:
// the server still decides every card and every file.
export async function readBudgets({ supabase, boardId, storageRoom = null }) {
  const [cap, room] = await Promise.all([
    supabase.rpc('get_board_capacity', { p_board_id: boardId }),
    storageRoom ? storageRoom(boardId) : null,
  ]);
  if (cap?.error) throw dbError(cap.error, 'get_board_capacity');
  const row = Array.isArray(cap?.data) ? cap.data[0] : cap?.data;
  const capped = Boolean(row?.is_capped);
  return {
    capped,
    cardsLeft: capped ? Math.max(0, Number(row.cap) - Number(row.used)) : Infinity,
    bytesLeft: room ? room.remaining : Infinity,
    bytesUsed: room ? room.used : null,
    quota: room ? room.quota : null,
  };
}

// The first doc of a new cluster, as import_create_clusters stores it.
export function encodeClusterDoc(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  doc.transact(() => { for (const c of cards) map.set(c.id, cardToYMap(c)); });
  return bytesToB64(Y.encodeStateAsUpdate(doc));
}

// covers (optional): what an imported cluster's tile is drawn and stamped
// with — { draw(files) → Blob|null, upload({ workspaceId, boardId, blob,
// userId }) → { src }, stamp(boardId, { thumbKey, cardCount, thumbVersion }),
// count(boardId, n), isCustom(boardId) → boolean, version }.
export function makeImportDeps({
  supabase, clusters, uploads, workspaceId, targetBoardId, userId, source, sourceRef = {},
  budgets = null, storageRoom = null, placeTops = null, canAttemptFiles = false, covers = null,
  newId = () => crypto.randomUUID(),
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const rpc = async (fn, args) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw dbError(error, fn);
    return data;
  };

  return {
    // The id is made here, as createBoard does, so nothing reads back through RLS.
    async createJob({ totals }) {
      const id = newId();
      const { error } = await supabase.from('import_jobs').insert({
        id, workspace_id: workspaceId, target_board_id: targetBoardId, source, source_ref: sourceRef, totals,
      });
      if (error) throw dbError(error, 'import_jobs');
      return id;
    },
    budgets: budgets || (() => readBudgets({ supabase, boardId: targetBoardId, storageRoom })),
    createClusters: (jobId, rows) => rpc('import_create_clusters', { p_job: jobId, p_rows: rows }),
    putItems: (jobId, rows) => rpc('import_items_put', { p_job: jobId, p_items: rows }),
    async setJob(jobId, fields) {
      const { error } = await supabase.from('import_jobs').update(fields).eq('id', jobId);
      if (error) throw dbError(error, 'import_jobs');
    },

    appendCards: async (boardId, cards) => okOrThrow(await clusters.appendCards({ boardId, cards }), 'Adding the cards'),
    patchCards: async (boardId, patches) => okOrThrow(await clusters.patchCards({ boardId, patches }), 'Finishing the cards'),
    removeCards: async (boardId, ids) => okOrThrow(await clusters.removeCards({ boardId, cardIds: ids }), 'Removing the cards'),

    // The same routes and arguments as the folder drop (App.jsx importFolderOnce).
    upload(item, file, { boardId, cardId, signal, onProgress }) {
      const opts = { file, workspaceId, boardId, cardId, userId, onProgress, originalName: meaningfulFileName(file) };
      if (item.route === 'image') return uploads.uploadImage(opts);
      if (item.route === 'video') {
        return uploads.uploadVideo({ ...opts, ...(canAttemptFiles ? { maxDurationSec: Number.POSITIVE_INFINITY } : {}) });
      }
      if (item.route === 'audio') return uploads.uploadAudio(opts);
      if (item.route === 'pdf') return uploads.uploadPdf(opts);
      return uploads.uploadFile({ ...opts, signal });   // 'largeMedia' and 'file': multipart
    },

    placeTops,
    // What saveBoardSnapshot's syncCardIndex would write for the new clusters'
    // cluster cards, for all of them at once.
    async indexClusterCards(list) {
      const rows = [];
      for (const { boardId, cards } of list) {
        for (const c of cards) {
          rows.push(buildCardIndexRow({ workspaceId, boardId, cardId: c.id, get: (k) => c[k], groupNameById: new Map() }));
        }
      }
      for (let i = 0; i < rows.length; i += INDEX_CHUNK) {
        const { error } = await supabase.from('card_index').upsert(rows.slice(i, i + INDEX_CHUNK), { onConflict: 'board_id,card_id' });
        if (error) throw dbError(error, 'card_index');
      }
    },

    // An imported cluster's tile (importJob step 4): the count it shows and,
    // with pictures to draw, its cover — the yboard regen funnel's upload and
    // stamp (_renderUploadStampThumb), which never replaces a cover someone
    // chose. Without pictures, or when one can't be drawn, the count alone.
    cover: covers ? async (boardId, { files, cardCount }) => {
      if (files?.length && !(await covers.isCustom(boardId))) {
        const blob = await covers.draw(files);
        if (blob) {
          const { src } = await covers.upload({ workspaceId, boardId, blob, userId });
          return covers.stamp(boardId, { thumbKey: src, cardCount, thumbVersion: covers.version });
        }
      }
      return covers.count(boardId, cardCount);
    } : null,

    newId,
    // The stamp the app's own adds carry (App buildMutators stampCreate).
    stamp: () => {
      const at = new Date(now()).toISOString();
      return { createdBy: userId || null, createdAt: at, updatedBy: userId || null, updatedAt: at };
    },
    cardId: (item, n) => cardIdFor(item, n),
    encodeDoc: encodeClusterDoc,
    now,
    sleep,
  };
}
