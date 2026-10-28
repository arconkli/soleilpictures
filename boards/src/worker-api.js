// /api/v1 — the public API.
//
// One person, one token, everything they can already do in the app. Built so a
// script, an integration or an AI assistant can read and write boards without
// pretending to be a browser.
//
// AUTHORIZATION IS NOT DONE HERE. A token resolves to a user (apiAuth.js), and
// every metadata read and write goes to PostgREST as THAT USER under ordinary
// RLS. There is no allowlist of what a token may touch, because there does not
// need to be: the policies that protect the app protect this. See the header of
// lib/apiAuth.js.
//
// The ONE exception is card mutation. Cards live in a Yjs document, not in a
// table, so writing them means the triple write in lib/scoutBoard.js — which
// runs with the service role and therefore bypasses RLS. Every route that
// touches cards calls requireBoardWrite() first, which asks can_write_board AS
// THE USER. That is the product's own predicate, so it cannot drift from what
// the app enforces, and it is one function rather than a check per endpoint.
//
// THE TRIPLE WRITE IS NOT OPTIONAL. Cards go to the live Y.Doc, board_state and
// card_index. Skipping card_index loses search and the cap; skipping
// board_state means the R2 orphan sweep eventually deletes the user's images.
// An endpoint that writes fewer than three places is data loss, not a degraded
// response.
//
// SCOPES (0220). read · write · delete. The split exists because the primary
// consumer is an MCP server handing tools to a language model, and "may add
// cards" and "may destroy a board" are not the same trust decision. The rule is
// mechanical — GET needs read, DELETE needs delete, everything else needs write
// — so a new route cannot accidentally land in a weaker bucket.

import * as Y from 'yjs';
import {
  resolveApiToken, hasScope, apiUserSession, rateHeaders, normalizeApiError,
  userSelect, userRpc, userInsert, userPatch, userDelete,
  createServiceAuthUser, createDraftAuthUser, deleteAuthUser,
} from './lib/apiAuth.js';
import {
  normalizeProps, normalizeIdentifiers, matchIdentifiers, loadMeta, loadBoardsMeta,
  saveMeta, saveMetaBulk, withMeta, parseInclude, purgeCardMeta, repointCardMeta,
  resolveUpsert, OBJECT_TYPES, pgInList,
} from './lib/objectMeta.js';
import { scoutRpc, scoutDelete, scoutInsert, scoutSelect } from './lib/scoutDb.js';
import {
  addCardsToBoard, moveCardsBetweenBoards, readBoardCards, readBoardCardsChecked,
  updateCardOnBoard, updateCardsOnBoard, deleteCardsFromBoard,
  readBoardGroups, readBoardCardsAndGroups, writeBoardGroups, withBoardCards, editCardLive, editBoardLive,
  groupsOf,
} from './lib/scoutBoard.js';
import { DOC_READ, readDocPages } from './lib/docMarkdown.js';
import {
  COMMENTS, COMMENT_FIELDS, STATUSES, isBoardCommentId, boardThreads, cardThreads, namesFrom,
  authorIds, pageThreads, publicThread, readNewComment, anchorOf, commentRow, placeComment,
  readResolveMany, findCardThread, docAuthor,
} from './lib/apiComments.js';
import { addCommentThread, addCommentReply, resolveComment, deleteCommentThread } from './lib/docState.js';
import { commentReplyKey } from './lib/commentKeys.js';
import { findQuote, markQuote, unmarkThread } from './lib/docCommentAnchor.js';
import {
  TAGS, TAG_FIELDS, readTagRequest, matchTags, isDeadTag, publicTag, boardTags, taggedItem,
  cleanTagName, tagSlug,
} from './lib/apiTags.js';
import { arrangeExisting } from './lib/scoutCards.js';
import { PARTY_HOST } from './lib/partyHost.js';
import { partyFetch } from './lib/partyFetch.js';
import { bytesToB64, readCards, upsertGroup } from './lib/yhelpers.js';
import { composeNoteHtml } from './lib/noteCompose.js';
import { fitNoteSize, NOTE_FIT } from './lib/noteFit.js';
import { noteSourceHtml, htmlHasText } from './lib/noteBody.js';
import {
  readNoteColor, readSwatches, paletteSize, publicSwatches, readSections, resolveSections,
  sectionName, sectionKey, noteHtmlFor, noteRepair, pictureSize,
} from './lib/apiCards.js';
import {
  AUTO_LAYOUT, API_LAYOUTS, arrangeAuto, rearrangeAuto, inOrder as cardsInOrder,
} from './lib/layoutAuto.js';
import { blockBounds } from './lib/moodboard.js';
import { nextSectionColours, sectionColour, tintNewNotes } from './lib/boardStyle.js';
import { imageDimensions, extensionFor } from './lib/imageDims.js';
import { meaningfulFileName } from './lib/fileIngest.js';
import { reserveUploadSpace } from './lib/uploadReserve.js';
import { fetchFollowingSafely, publicHttpsUrlProblem, UnsafeFetchError } from './lib/safeUrl.js';
import { openapiDocument } from './lib/apiOpenapi.js';
import { embedCards } from './lib/serverEmbed.js';
import { clientEmbedsKind } from './lib/embedText.js';
import { buildCardIndexRow } from './lib/cardIndexRow.js';
import { boardToOmc } from './lib/omcExport.js';
import {
  GALLERY, boardPictures, pickRendition, encodeCursor, decodeCursor, boardUrl, cardUrl,
  makeInlineBudget, bytesToBase64,
} from './lib/gallery.js';
import { planCanvas, canvasAnswer } from './lib/canvasView.js';
import { imageSecret, signImageKey, SIGNED_IMAGE_PATH, SIGNED_IMAGE_TTL_S } from './lib/signedImage.js';
import {
  webhookUrlProblem, runWebhooks, deliverOne, hasPendingWork, WEBHOOK_EVENTS,
  AFTER_WRITE_DRAIN,
} from './lib/webhooks.js';
import { handleMcpRequest, mcpTraceName } from './lib/mcpServer.js';
import { answeredWith, reportWorkerError } from './lib/workerErrors.js';
import { ApiError, apiErrorFrom, HOSTED_TOOLS } from './lib/mcpTools.js';
import {
  draftsOpen, draftSecret, draftTokens, draftEmail, subjectHash, sha256Hex, isDraftKey, isDraftTool,
  draftRouteAllowed, mixedManifest, withoutDraft, DRAFT_INSTRUCTIONS, draftHost, signInAnswer,
  draftRefusal, draftAnswer, DRAFT_SAYS,
} from './lib/mcpDrafts.js';
import { makeEdgeLimiter } from './lib/edgeLimits.js';
import {
  arrange, rearrange, placeGrouped, DEFAULT_LAYOUT,
} from './lib/layoutEngine.js';
import {
  normalizeImportItems, cardSpecFor, kindForContentType, noteFor, mapWithConcurrency,
  IMPORT_CONCURRENCY, IMPORT_TIMEOUT_MS, SOURCE_SCOPE, provenanceProps,
} from './lib/importManifest.js';

// Raised from 100 once a positioned batch stopped costing O(the whole board):
// the write is now one card_index insert and one small Yjs update, so the batch
// size bounds the request body rather than the work.
const MAX_CARDS_PER_CALL = 1000;
// The ceiling on the SINGLE-SHOT upload, which buffers the whole body in the
// isolate to read its header. Anything larger goes through /uploads/multipart,
// where the bytes never touch this Worker at all.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 500;
// R2/S3 allows 10,000 parts; the party targets 9,000 and sizes parts to suit,
// so this is only a sanity bound on what one sign-parts call may ask for.
const MAX_PARTS_PER_CALL = 1000;
// Bulk board creation is two INSERTs whatever the count, so this bounds the
// request body rather than the work.
const MAX_BOARDS_PER_CALL = 500;

// Extensions for the kinds of file a studio actually migrates. The multipart
// path accepts anything (that is the product's "upload any file type" feature),
// so an unknown type becomes .bin rather than a refusal — but a KNOWN type
// keeps its real extension, because the extension is what the app uses to
// decide how to render a card.
const EXTRA_TYPES = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
  'video/webm': 'webm', 'video/mpeg': 'mpg',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav', 'audio/wave': 'wav',
  'audio/aiff': 'aiff', 'audio/x-aiff': 'aiff', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/x-aac': 'aac',
  // Sample and loop libraries are full of these, and without a mapping they
  // land in R2 as `.bin` — the file downloads with no extension and no DAW
  // will open it.
  'audio/flac': 'flac', 'audio/x-flac': 'flac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/webm': 'weba',
  'application/pdf': 'pdf', 'application/zip': 'zip',
  'image/tiff': 'tif', 'image/x-adobe-dng': 'dng', 'image/x-exr': 'exr',
  'application/mxf': 'mxf', 'application/x-dpx': 'dpx',
};

// The kinds the API models.
//
// `video` and `file` were added because their absence was a hole with no
// workaround: multipart accepts ProRes, MXF, DPX and DNG (see EXTRA_TYPES
// above), so you could upload a 2TB camera master through this API and then
// have no way to put a card for it on a board. An upload you cannot place is
// not an upload.
//
// The app has more kinds still (schedule, grid, board) and each of those
// carries structured interior state the wire format does not describe — they
// stay readable but not creatable, rather than creatable and broken.
// `?include=raw` is how you get at their interiors.
//
// `audio` and `pdf` joined them for the same reason, found while giving Soleil
// Scout the ability to accept anything you can text it: the CANVAS creates both
// (CanvasSurface.jsx:2230 and :2353) and this list rejected both, so the API
// refused two card kinds the product itself produces. A kind you can make by
// dropping a file and cannot make through the API is a hole with no workaround,
// which is the same test `video` and `file` were admitted under.
//
// `palette` joined last (2026-10-27): its interior is only its swatches, which
// the wire now describes ([{hex, name}], lib/apiCards.js), and without it an
// assistant making a moodboard wrote its colours into a note as hex codes.
const CARD_KINDS = ['note', 'image', 'link', 'doc', 'video', 'audio', 'pdf', 'file', 'palette'];

// Which Y.Doc field holds the bytes, per kind. Images, video and audio all use
// `src`; files use `fileSrc`; a PDF uses `pdfSrc` and keeps `src` for its
// page-1 raster. Getting this wrong produces a card that renders nothing, which
// is exactly what happened when this file wrote `key` instead of `src`.
//
// `pdf` was already listed here — mapped to `fileSrc`, which is not the field a
// PDF card reads and never has been. It was unreachable while `pdf` was absent
// from CARD_KINDS above; admitting the kind is what would have made a
// long-standing typo start producing blank cards.
const BYTES_FIELD = {
  image: 'src', video: 'src', audio: 'src', file: 'fileSrc', pdf: 'pdfSrc',
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,idempotency-key,if-match,'
    + 'mcp-protocol-version,mcp-method,mcp-name',
  'access-control-expose-headers':
    'x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset,retry-after,'
    + 'idempotent-replay,x-image-variant,etag',
  'access-control-max-age': '86400',
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra },
});

// Every refusal carries a stable `code` alongside its human `error`, so a client
// can branch without string-matching prose that may be reworded.
function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

function withHeaders(res, extra) {
  if (!extra || !Object.keys(extra).length) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── The wire format ──────────────────────────────────────────────────────────
//
// publicCard and normalizeIncomingCard together are the entire boundary between
// a stranger's JSON and everyone's Y.Doc. They are exported and tested directly
// rather than through a route, because a route test would exercise them
// incidentally and prove less.

// An image card's bytes are referenced by `src: "r2:<key>"` — NOT by `key`.
// That is what lib/scoutCards.js writes, what buildCardMeta projects and what
// cards.jsx resolves to a signed URL. The first version of this file read and
// wrote `card.key`, a field nothing in the app looks at, so an image card
// created through the API rendered blank and an existing one read back with a
// null image_key. Both directions go through these two helpers now.
const keyFromSrc = (src) =>
  (typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : null);

// One text field per kind. Image cards keep their text in `caption`
// (cards.jsx's ImageCard, onUpdate({ caption })); everything else uses `body`.
// Reading mapped caption→body already, but writing always went to `body`, so a
// read-modify-write on an image card returned 200 and changed nothing the app
// would ever display. The wire has ONE name for the text of a card; this is
// where it is translated, in both directions.
const textFieldFor = (kind) => (kind === 'image' ? 'caption' : 'body');
const textOf = (c) => (c.kind === 'image'
  ? (c.caption ?? c.body ?? null)
  : (c.body ?? c.caption ?? null));

// Content-Disposition for a file served under its own name (RFC 6266 / 5987):
// a quoted ASCII fallback for old clients, and filename* with the exact UTF-8.
export function contentDisposition(name) {
  const clean = String(name).replace(/[\r\n"\\]/g, '').slice(0, 200);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  // encodeURIComponent leaves ' ( ) * ! alone; RFC 5987 does not allow them,
  // and an apostrophe would end the charset''value prefix early.
  const ext = encodeURIComponent(clean).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${ascii}"; filename*=UTF-8''${ext}`;
}

export function publicCard(c) {
  const kind = c.kind || 'note';
  const out = {
    id: c.id,
    kind,
    x: c.x, y: c.y, w: c.w, h: c.h, z: c.z,
    title: c.title ?? null,
    body: textOf(c),
    html: c.html ?? null,
    url: c.url ?? c.link ?? null,
    image_key: keyFromSrc(c.src),
    alt: c.alt ?? null,
    // A note's colour is its fill, `bgColor`, the field the canvas paints; the
    // API wrote `color` until 2026-10-27, which a note never showed.
    color: (kind === 'note' ? (c.bgColor ?? c.color) : c.color) ?? null,
    created_at: c.createdAt ?? null,
    updated_at: c.updatedAt ?? null,
  };
  // Only on the kinds that have them. Adding six always-null fields to every
  // note card is paid for on every list response, forever.
  //
  // An image keeps `image_key` and does NOT also get `file_key`: they would
  // carry the same value, and duplicating a field on the most common card kind
  // is noise in every list response for the rest of time.
  if (kind !== 'image') {
    const bytes = keyFromSrc(c[BYTES_FIELD[kind]]);
    if (bytes) out.file_key = bytes;
  }
  if (c.poster) out.poster_key = keyFromSrc(c.poster);
  if (c.fileName) out.file_name = c.fileName;
  if (c.mime) out.mime = c.mime;
  if (c.ext) out.ext = c.ext;
  if (Number.isFinite(c.sizeBytes)) out.size_bytes = c.sizeBytes;
  // Conditional for the same reason the media fields are: an always-null field
  // on the commonest card kind is paid for in every list response forever. Most
  // cards are not rotated and belong to no group.
  if (Number.isFinite(c.rotation) && c.rotation !== 0) out.rotation = c.rotation;
  if (c.groupId) out.group_id = c.groupId;
  // In the cluster but not on its board (a file added in Files, or removed
  // from the board): listed, but not drawn on the canvas. Only when true.
  if (c.unplaced === true) out.unplaced = true;
  if (c.sectionHeader) {
    out.section_header = true;
    if (c.sub) out.sub = c.sub;
  }
  if (kind === 'palette') out.swatches = publicSwatches(c.swatches);
  return out;
}

// Whether POSTing a deleted card's wire form back re-creates it.
//
// The delete responses promise "the response body is the undo", and for most
// cards it is. Not for a grid or schedule — those kinds are readable but not
// creatable here, so the POST is a 400 — not for a multi-page doc, whose pages
// live in docPages, which the wire form does not carry, and not for a palette
// set to hide its labels, a choice the wire form doesn't carry either. Those
// are named in the response instead of being returned as if they could come
// back (2026-10-11 audit, API-09). They can: the delete checkpoints the board
// into Version history first (deleteCardsFromBoard).
const restorableByPost = (c) => CARD_KINDS.includes(c.kind || 'note')
  && !(c.kind === 'doc' && c.docPages != null)
  && !(c.kind === 'palette' && (c.hideHex || c.hideLabels || c.chipsOnly));

function notRestorable(removed) {
  const stuck = removed.filter((c) => !restorableByPost(c)).map((c) => String(c.id));
  return stuck.length ? {
    not_restorable: stuck,
    recover: 'These cards cannot be re-created through the API. The board was saved to its '
      + 'Version history just before this delete; restore them from there in the app.',
  } : {};
}

// A group on the wire. The app stores a few render-only fields (a cached
// width, per-group options) that mean nothing to an integrator.
function publicGroup(g) {
  if (!g) return null;
  return {
    id: g.id,
    name: g.name ?? null,
    color: g.color ?? null,
    shape: g.shape === 'hug' ? 'hug' : 'box',
    outline: g.outline !== false,
    created_at: g.createdAt ?? null,
  };
}

function publicBoard(b) {
  return {
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    parent_board_id: b.parent_board_id,
    view: b.view,
    deleted: !!b.deleted_at,
    created_at: b.created_at,
    updated_at: b.updated_at ?? null,
  };
}

// A board took a date once: scheduled_date, scheduled_end and day_label, set
// through set_board_schedule. Schedules are retired (owner, 2026-10-20), so a
// date is refused rather than dropped: a script or an agent that sent one and
// got a 200 back would report a change that never happened. Null is what every
// board read carried, so writing back an object read before the retirement
// still goes through.
function refuseScheduleFields(body) {
  if (!body || typeof body !== 'object') return;
  const sent = ['scheduled_date', 'scheduled_end', 'day_label']
    .filter((k) => body[k] != null && body[k] !== '');
  if (sent.length) {
    throw fail(400, 'bad_request', `${sent.join(', ')}: boards no longer take a date (schedules were retired)`);
  }
}

// Map the wire shape onto a card. Deliberately narrow: an API caller should not
// be able to set arbitrary interior fields on a card and have them persisted
// into everyone's Y.Doc.
//
// `existingKind` matters on a patch: the text field a value lands in depends on
// what kind of card it is, and a patch that does not mention `kind` is still a
// patch to a card that has one. `before` is the card as it stands, on a patch:
// a note's text and height follow its title and body only where the API wrote
// them (apiOwnsNoteHtml). `warn(message)` hears what landed but won't look as
// asked.
export function normalizeIncomingCard(input, {
  partial = false, existingKind = null, before = null, warn = null,
} = {}) {
  const c = input || {};

  // An unrecognised kind is REFUSED, not coerced. Coercion is right for an
  // absent value (a default) and wrong for a present one: silently turning
  // {"kind":"schedule"} into a note tells the caller they made a schedule card
  // when they did not, and on a PATCH it turns an image card into a note and
  // drops the picture.
  let kind;
  if (c.kind != null) {
    if (!CARD_KINDS.includes(c.kind)) {
      throw fail(400, 'bad_request',
        `kind must be one of ${CARD_KINDS.join(', ')} — got ${JSON.stringify(String(c.kind).slice(0, 40))}`);
    }
    kind = c.kind;
  } else {
    kind = partial ? (existingKind || 'note') : 'note';
  }

  const out = partial ? {} : {
    id: `api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    w: Number.isFinite(c.w) ? clampSize(c.w) : 280,
    h: Number.isFinite(c.h) ? clampSize(c.h) : 180,
  };
  if (!partial || c.kind != null) out.kind = kind;

  if ('title' in c) out.title = str(c.title, 300);
  if ('body' in c) out[textFieldFor(kind)] = str(c.body, 20000);
  if ('html' in c) out.html = str(c.html, 40000);
  if ('url' in c) out.url = str(c.url, 2000);
  if ('alt' in c) out.alt = str(c.alt, 300);
  // Stored as the app stores it. A bare key here would be a card that renders
  // nothing at all.
  if ('image_key' in c) {
    const k = str(c.image_key, 500);
    out.src = k ? `r2:${k}` : null;
  }
  // The same key, under the field the app reads for that kind. `image_key` is
  // kept as the name for images because it is what callers already send.
  if ('file_key' in c) {
    const k = str(c.file_key, 500);
    out[BYTES_FIELD[kind] || 'src'] = k ? `r2:${k}` : null;
  }
  if ('poster_key' in c) {
    const k = str(c.poster_key, 500);
    out.poster = k ? `r2:${k}` : null;
  }
  // A PDF card keeps its filename in `name` (PdfCard.jsx:27 renders `name ||
  // 'PDF'`); everything else uses `fileName`. Writing the wrong one produces a
  // card labelled "PDF" whatever the caller said it was.
  if ('file_name' in c) out[kind === 'pdf' ? 'name' : 'fileName'] = str(c.file_name, 300);
  if ('mime' in c) out.mime = str(c.mime, 200);
  if ('ext' in c) out.ext = str(c.ext, 20);
  if (Number.isFinite(c.size_bytes)) out.sizeBytes = Math.max(0, Math.round(c.size_bytes));
  // A note's colour is its fill (bgColor), which the canvas paints and picks
  // the note's ink for from the hex, so it must be one. `color` is cleared with
  // it: the field this wrote until 2026-10-27, which a note never showed.
  if ('color' in c) {
    if (kind === 'note') {
      const read = readNoteColor(c.color);
      if (read.problem) throw fail(400, 'bad_request', read.problem);
      out.bgColor = read.color;
      out.color = null;
    } else {
      out.color = str(c.color, 40);
    }
  }
  // A palette is its swatches: one made, or a card turned into one, needs them.
  if (kind === 'palette' && ('swatches' in c || !partial || existingKind !== 'palette')) {
    const read = readSwatches(c.swatches);
    if (read.problem) throw fail(400, 'bad_request', read.problem);
    out.swatches = read.swatches;
    if (!partial) {
      const size = paletteSize(read.swatches.length);
      if (!Number.isFinite(c.w)) out.w = size.w;
      if (!Number.isFinite(c.h)) out.h = size.h;
      if (!('title' in c)) out.title = 'Palette';
    }
  }
  if (Number.isFinite(c.x)) out.x = Math.round(c.x);
  if (Number.isFinite(c.y)) out.y = Math.round(c.y);
  if (Number.isFinite(c.w)) out.w = clampSize(c.w);
  if (Number.isFinite(c.h)) out.h = clampSize(c.h);

  // Stacking. publicCard has always RETURNED z while this refused to set it,
  // so layering was readable and unwritable — a caller could see two cards
  // overlap, see which was on top, and have no way to swap them. Fractional
  // values are deliberate: bringForward picks the midpoint between neighbours,
  // so the app itself produces them.
  if (Number.isFinite(c.z)) out.z = c.z;

  // Degrees, as the app stores them — applied as a CSS rotate() on the card.
  // Wrapped rather than clamped, so 370 means 10 rather than 180.
  if (Number.isFinite(c.rotation)) {
    const r = ((Math.round(c.rotation) % 360) + 540) % 360 - 180;
    out.rotation = r;
  }

  // Membership of a group — the app's way of saying "these belong together",
  // with a labelled outline drawn round them. Validated against the board's
  // real groups by the caller, which is where the board is already open.
  if ('group_id' in c) out.groupId = c.group_id ? str(c.group_id, 100) : null;

  // A section header is a full-width note that renders as an <h2> on the
  // public /c/<slug> page (card_index.meta.sectionHeader). `span` is set with
  // it rather than separately: the app has never produced one without the
  // other, and a half-set header is a card that reads as a header everywhere
  // except where it matters.
  if ('section_header' in c) {
    out.sectionHeader = c.section_header === true;
    out.span = c.section_header === true ? 'full' : null;
  }
  if ('sub' in c) out.sub = str(c.sub, 300);
  if (kind === 'note') noteShowsItsText(c, out, { partial, before, warn });
  return out;
}

// What the canvas shows of a note is its html, never its title, and a note is
// as tall as its card: a note the API made from a title and a body showed the
// body alone, under a fade, at 280×180. So a note given a title or a body
// (and no html of its own) is written as the app writes one, the title as its
// heading and the body's lists and emphasis as lists and emphasis
// (lib/noteCompose.js), and a note given no height is made as tall as its
// text (lib/noteFit.js; no taller than a note grows in the app). `title` and
// `body` are kept as given: search and every read use them.
function noteShowsItsText(c, out, { partial, before, warn }) {
  const titleGiven = 'title' in c;
  const bodyGiven = 'body' in c;
  if (!partial) {
    // The caller's own html, under the title it named when it doesn't open
    // with a heading of its own; else its title and body, composed.
    const html = noteHtmlFor({ title: out.title, body: out.body, html: out.html });
    if (typeof html === 'string') out.html = html;
  } else if ((titleGiven || bodyGiven) && !('html' in c) && before && apiOwnsNoteHtml(before)) {
    out.html = composeNoteHtml({
      title: titleGiven ? out.title : before.title,
      body: bodyGiven ? out.body : (before.body ?? null),
    });
  }

  // Height follows the text unless the caller set one, or someone sized the
  // note by hand in the app.
  if (Number.isFinite(c.h)) return;
  if (partial && (!before || before.manuallyResized)) return;
  if (partial && !('html' in out) && !bodyGiven && !Number.isFinite(c.w)) return;
  const html = 'html' in out ? out.html : before?.html;
  const body = bodyGiven ? out.body : before?.body;
  const text = noteSourceHtml(html, body);
  if (!htmlHasText(text)) return;
  const width = Number.isFinite(c.w) ? out.w : (partial ? before?.w : undefined);
  const fit = fitNoteSize({ html: text, w: Number.isFinite(width) ? width : undefined });
  if (!partial || Number.isFinite(c.w)) out.w = fit.w;
  out.h = fit.h;
  if (fit.overflow) {
    warn?.(`its text runs past the tallest a note grows (${NOTE_FIT.maxH}px) and the end fades out; `
      + 'long writing reads better as a doc (POST /boards/:id/docs, or write_doc)');
  }
}

// Whether a note's html is still the one the API composed from its title and
// body: then a new title or body may be written into it. Not once the note has
// been opened in the app's editor (its text then lives in the note's own
// fragment, and html only mirrors it), and not when someone else wrote it.
function apiOwnsNoteHtml(before) {
  if (before.noteFragmentSeeded) return false;
  if (!htmlHasText(before.html)) return true;
  return before.html === composeNoteHtml({ title: before.title, body: before.body ?? null });
}

// Place whatever is missing coordinates, around what is already on the board.
//
// Every card must leave here with real coordinates. stampCard sets z and
// timestamps but NOT x/y, so an unpositioned card would reach the Y.Doc with
// undefined geometry — and one NaN card poisons boundsOfCards() for the whole
// board, scattering everything the user already had. Dropping it is the only
// safe answer; the response reports what actually landed.
//
// `order` is the group ids of the sections an add named, in the order named:
// they are laid out in that order (each section's cards in their own order),
// and the cards come back in the order given whatever the layout saw.
function layoutCards(built, existing, layoutOpts = null, { order = null } = {}) {
  const rank = order?.length ? new Map(order.map((gid, i) => [String(gid), i])) : null;
  const inOrder = (list) => (!rank ? list : [...list].sort((a, b) => sectionRank(a, rank) - sectionRank(b, rank)));
  // A NAMED layout arranges the whole batch, including cards that arrived with
  // coordinates: "lay these out as justified rows" and "put this one at x=40"
  // are contradictory instructions, and the one the caller typed on purpose
  // should win. Without a name, behaviour is exactly what it has always been —
  // place only what is missing coordinates.
  if (layoutOpts) {
    const lay = layoutOpts.layout === AUTO_LAYOUT ? arrangeAuto : arrange;
    const laid = new Map(lay(existing, inOrder(built), layoutOpts).map((c) => [c.id, c]));
    return built.map((c) => laid.get(c.id))
      .filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y));
  }
  const needsLayout = inOrder(built.filter((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y)));
  // A card for a section already on the board goes by that section's cards
  // when there is room (placeGrouped), so no outline takes in another
  // section's cards. A new section, and the cards on an empty board, are laid
  // out as `auto` lays them out, under what is there. A few loose cards for a
  // board that has cards go in the free space beside them.
  const sectionsHere = new Set(existing.filter((c) => c.groupId).map((c) => String(c.groupId)));
  const joining = needsLayout.filter((c) => c.groupId && sectionsHere.has(String(c.groupId)));
  const rest = needsLayout.filter((c) => !joining.includes(c));
  const placed = joining.length ? placeGrouped(existing, joining) : [];
  if (rest.length) {
    const around = [...existing, ...placed];
    placed.push(...(!existing.length || rest.some((c) => c.groupId)
      ? arrangeAuto(around, rest)
      : arrangeExisting({ existingCards: around, cards: rest })));
  }
  const byId = new Map(placed.map((c) => [c.id, c]));
  return built
    .map((c) => byId.get(c.id) || c)
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
}

// Where a card's section comes in `order`: a section named in the call by its
// place there, any other group after those, no group last.
function sectionRank(c, rank) {
  if (!c.groupId) return rank.size + 1;
  return rank.get(String(c.groupId)) ?? rank.size;
}

// The sections one card write names, by name on a card (`group`) or in the
// body's `groups` list, and the group ids it gives (`group_id`), checked on the
// board they land on. Returns null when the write names no group at all, which
// keeps a positioned batch on the fast path. Otherwise:
//   prepare(doc) — for addCardsToBoard / updateCardsOnBoard: resolves each name
//     to the board's group of that name or a new one (made in the same
//     transaction as the cards), and refuses a group_id the board doesn't have.
//   assign(card, i, prepared) — the group the i-th card goes in, set on it.
//   created — the groups made, once a prepare has run (an upsert opens the
//     board twice: the second open finds what the first made).
function sectionsFor(incoming, built, body, { userId, partial = false }) {
  const read = readSections(body?.groups, incoming);
  if (read.problem) throw fail(400, 'bad_request', read.problem);
  incoming.forEach((c, i) => {
    if (sectionName(c?.group) && c?.group_id) {
      throw fail(400, 'bad_request', `cards[${i}]: send group (a section's name) or group_id, not both`);
    }
  });
  const named = read.wanted.length > 0;
  const refs = built.some((c) => c?.groupId);
  if (!named && !refs) return null;
  const created = [];
  const sections = [];
  const prepare = (doc) => {
    const existing = groupsOf(doc);
    const plan = resolveSections(existing, read.wanted, { userId });
    const known = new Set([...existing.map((g) => String(g.id)), ...plan.created.map((g) => g.id)]);
    built.forEach((c, i) => {
      if (!c?.groupId || known.has(String(c.groupId))) return;
      throw fail(400, 'bad_request', `cards[${i}]: group_id ${JSON.stringify(String(c.groupId).slice(0, 100))} `
        + 'is not a group on this board: name the section with group instead (it is made if the board has none '
        + 'by that name), or read the board\'s groups');
    });
    for (const g of plan.created) if (!created.some((x) => x.id === g.id)) created.push(g);
    sections.length = 0;
    for (const gid of plan.order) {
      const g = existing.find((x) => String(x.id) === gid) || plan.created.find((x) => x.id === gid);
      if (g) sections.push({ ...g, created: plan.created.some((x) => x.id === gid) || created.some((x) => x.id === gid) });
    }
    return {
      idByKey: plan.idByKey,
      order: plan.order,
      // Every group's colour, those made here included: a new note takes its
      // section's tint (tintNewNotes).
      colours: new Map([...existing, ...plan.created].map((g) => [String(g.id), g.color ?? null])),
      write: plan.created.length ? (d) => {
        const groups = d.getMap('groups');
        for (const g of plan.created) upsertGroup(groups, g.id, g);
      } : null,
    };
  };
  const assign = (card, i, prepared) => {
    const name = sectionName(incoming[i]?.group);
    if (name && prepared) card.groupId = prepared.idByKey.get(sectionKey(name)) ?? null;
    else if (partial && incoming[i] && 'group' in incoming[i] && !name && !('group_id' in incoming[i])) {
      card.groupId = null;
    }
    return card;
  };
  return { prepare, assign, created, sections, named };
}

// The sections a write named, on the wire: each with whether this call made it.
const publicSections = (plan) => plan.sections.map((g) => ({ ...publicGroup(g), created: g.created === true }));

// A layout the API takes by name: auto, or one the canvas shares.
const isApiLayout = (name) => API_LAYOUTS.includes(name);
const layoutRefusal = (v) => `layout must be one of ${API_LAYOUTS.join(', ')} — got ${JSON.stringify(String(v).slice(0, 40))}`;

// What comes first, by card id: arrange's `order`. null when not given.
function orderFrom(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.some((id) => typeof id !== 'string' || !id)) {
    throw fail(400, 'bad_request', 'order lists card ids, first to last: ["api-…", "api-…"]');
  }
  if (v.length > MAX_CARDS_PER_CALL) throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} ids in order`);
  return v.map((id) => id.slice(0, 200));
}

// Pixel sizes of pictures by their storage key, read as the user: a picture
// they can't read stays unknown. A hundred keys a read, so the address stays
// short. Map(key → { width, height }).
async function imageDims(env, token, keys) {
  const unique = [...new Set(keys.filter(Boolean))];
  const chunks = [];
  for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
  const reads = await Promise.all(chunks.map((part) => userSelect(env, token, 'images',
    `storage_path=in.${encodeURIComponent(pgInList(part))}&deleted_at=is.null&select=storage_path,width,height`)));
  const dims = new Map();
  for (const r of reads.flat()) {
    if (r?.width > 0 && r?.height > 0) dims.set(r.storage_path, { width: r.width, height: r.height });
  }
  return dims;
}

// An image card added by its image_key with no w or h: sized to the picture's
// own shape (pictureSize) rather than a 280×180 that crops it.
async function sizePictures(env, token, incoming, built) {
  const keys = built.map((c, i) => (c?.kind === 'image' && !Number.isFinite(incoming[i]?.w)
    && !Number.isFinite(incoming[i]?.h) ? keyFromSrc(c.src) : null));
  if (!keys.some(Boolean)) return;
  const dims = await imageDims(env, token, keys);
  keys.forEach((key, i) => {
    const d = key ? dims.get(key) : null;
    const size = d ? pictureSize(d.width, d.height) : null;
    if (size) Object.assign(built[i], size);
  });
}

// The layout knobs, read off a request body. Returns null when no layout was
// named, which is what keeps the previous implicit behaviour intact.
function layoutOptionsFrom(body) {
  if (!body || body.layout == null) return null;
  if (!isApiLayout(body.layout)) throw fail(400, 'bad_request', layoutRefusal(body.layout));
  return {
    layout: body.layout,
    ...(Number.isFinite(body.gap) ? { gap: body.gap } : {}),
    ...(Number.isFinite(body.width) ? { width: body.width } : {}),
    ...(Number.isFinite(body.row_height) ? { rowHeight: body.row_height } : {}),
    ...(Number.isFinite(body.columns) ? { columns: body.columns } : {}),
  };
}

// ── Identifiers and props on the wire ────────────────────────────────────────

// One extra pair of queries for a whole page, not a pair per board.
async function decorateBoards(env, token, rows, include) {
  const out = rows.map(publicBoard);
  if (!include.size || !rows.length) return out;
  const meta = await loadBoardsMeta(env, token, rows.map((b) => b.id));
  return out.map((b) => filterMeta(withMeta(b, meta.get(b.id) || {}), include));
}

// `?include=props` should not also hand back identifiers. Asking for one thing
// and receiving two is how a response grows without anyone deciding to.
function filterMeta(obj, include) {
  const out = { ...obj };
  if (!include.has('props')) delete out.props;
  if (!include.has('identifiers')) delete out.identifiers;
  return out;
}

// The same for cards, plus `raw`.
//
// WHY `raw` EXISTS. publicCard is a 12-field projection, and the app has kinds
// it does not describe — a grid card carries cells, a template and a sequence;
// a palette carries swatches; a schedule carries rows. Those kinds are readable
// but not creatable, and they were reading back with their interior silently
// missing, which for anyone taking a backup or migrating out is data loss that
// looks like success. `raw` hands over the card exactly as it is stored.
//
// It is opt-in because it is the card's INTERNAL shape: field names there are
// not part of the API's contract and may change with the app.
async function decorateCards(env, token, boardId, cards, include) {
  let out = cards.map((c) => (include.has('raw')
    ? { ...publicCard(c), raw: c }
    : publicCard(c)));
  if (include.has('props') || include.has('identifiers')) {
    const meta = await loadMeta(env, token, {
      boardId, objectType: 'card', objectIds: cards.map((c) => c.id),
    });
    out = out.map((c) => filterMeta(withMeta(c, meta.get(String(c.id)) || {}), include));
  }
  // include=seen: what a vision model saw in each described picture (0593),
  // as `in_picture`, read as the caller (image_seen_for_board, 0596, security
  // invoker). Never shown to people in the app; data for the program reading
  // it, never instructions. A picture not described yet has none, and a
  // failed read costs the lines, never the answer.
  if (include.has('seen') && out.some((c) => c.kind === 'image')) {
    const rows = await userRpc(env, token, 'image_seen_for_board', { p_board: boardId }).catch(() => []);
    const seen = new Map((Array.isArray(rows) ? rows : [])
      .filter((r) => r?.card_id && r?.description)
      .map((r) => [String(r.card_id), seenText(r)]));
    out = out.map((c) => (c.kind === 'image' && seen.has(String(c.id))
      ? { ...c, in_picture: seen.get(String(c.id)) } : c));
  }
  return out;
}

// What the API writes can be found by meaning before anyone opens the board:
// the cards it made or changed are embedded through the server's one embedder
// (lib/serverEmbed.js), off the response path, from the same card_index
// projection the browser embeds from (embedText.js), so the hashes agree and
// neither writer re-embeds over the other. embedCards reads each card's
// workspace switch itself: with AI off, nothing is embedded, and every model
// call is paid from the owner's budget first. Pictures and videos are left to
// the describe job, which embeds them with what they show.
function embedAfterWrite(env, ctx, workspaceId, boardId, cards) {
  if (!ctx?.waitUntil || !workspaceId) return;
  const items = [];
  for (const c of cards || []) {
    if (!c?.id || !clientEmbedsKind(c.kind || 'note')) continue;
    const row = buildCardIndexRow({ workspaceId, boardId, cardId: c.id, get: (k) => c[k] });
    if (row) {
      items.push({ workspace_id: workspaceId, board_id: boardId, card_id: String(c.id),
        title: row.title, body: row.body, description: null, content_hash: null });
    }
  }
  if (!items.length) return;
  ctx.waitUntil(embedCards(env, items)
    .catch((e) => console.warn('[api-embed] failed', items.length, e?.message || e)));
}

// A described picture in one line, as search reads it (entity_search's
// `seen`, 0595): the description, its keywords, then what it is made of.
const SEEN_MAX = 600;
function seenText(r) {
  const a = r.attrs && typeof r.attrs === 'object' ? r.attrs : {};
  const words = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).join(', ') : '');
  const about = [a.medium, a.shot_type, a.lighting, words(a.palette), a.era, a.location, a.text_in_image]
    .filter((v) => typeof v === 'string' && v.trim()).join(', ');
  const kw = words(r.keywords);
  return [String(r.description).trim(), kw && `Keywords: ${kw}.`, about && `Looks: ${about}.`]
    .filter(Boolean).join(' ').slice(0, SEEN_MAX);
}

// Pull `props` and `identifiers` off an incoming body and validate them, so a
// route never has to remember to. Returns nulls for "not mentioned", which is
// distinct from an empty object or an empty array.
function metaFromBody(body) {
  return {
    props: normalizeProps(body?.props),
    identifiers: normalizeIdentifiers(body?.identifiers),
  };
}

// An unknown event name is refused rather than accepted and never fired —
// "subscribed and silent" is the hardest webhook failure to diagnose.
function normalizeEvents(input) {
  const asked = Array.isArray(input) ? input : [];
  if (!asked.length) throw fail(400, 'bad_request', 'events is required');
  const clean = [...new Set(asked.map((e) => String(e).trim()))];
  const bad = clean.filter((e) => e !== '*' && !WEBHOOK_EVENTS.includes(e));
  if (bad.length) {
    throw fail(400, 'bad_request',
      `unknown event ${JSON.stringify(bad[0])} — valid: ${WEBHOOK_EVENTS.join(', ')}, or "*"`);
  }
  return clean;
}

// ── Service accounts ─────────────────────────────────────────────────────────

function publicServiceAccount(s) {
  return {
    id: s.user_id,
    name: s.name,
    workspace_id: s.workspace_id,
    created_at: s.created_at,
    disabled: !!s.disabled_at,
    token_count: s.token_count ?? null,
    last_used_at: s.last_used_at ?? null,
  };
}

// A minted credential may never exceed the credential that minted it.
//
// Without this, a `write` token could mint a service token carrying `delete`
// and then destroy everything — an escalation, done entirely through documented
// endpoints. Downscoping is the standard answer and it costs one comparison.
function requestedScopes(input, auth) {
  const asked = Array.isArray(input) && input.length ? input : ['read', 'write'];
  const clean = [...new Set(asked.map((s) => String(s).toLowerCase()))];
  const bad = clean.filter((s) => !['read', 'write', 'delete'].includes(s));
  if (bad.length) {
    throw fail(400, 'bad_request',
      `scopes must be a subset of read, write, delete — got ${JSON.stringify(bad.join(', '))}`);
  }
  const over = clean.filter((s) => !auth.scopes.includes(s));
  if (over.length) {
    throw fail(403, 'insufficient_scope',
      `this token cannot grant ${over.join(', ')} — a service token may not exceed the token that minted it`);
  }
  return clean;
}

async function mintServiceToken(env, token, { userId, name, scopes, ttlDays, rateLimit }) {
  const rows = await userRpc(env, token, 'api_token_mint_for', {
    p_user_id: userId,
    p_name: name,
    p_scopes: scopes,
    p_ttl_days: Number.isFinite(ttlDays) ? Math.round(ttlDays) : null,
    p_req_limit: Number.isFinite(rateLimit) ? Math.round(rateLimit) : null,
  });
  const t = (rows || [])[0];
  if (!t?.token) throw fail(502, 'upstream_error', 'the token was not minted');
  return {
    id: t.id,
    token: t.token,          // the only time this value ever exists outside the caller
    prefix: t.prefix,
    scopes,
    rate_limit: t.req_limit,
  };
}

const str = (v, max) => (v == null ? null : String(v).slice(0, max));
// A card 200,000px wide is not a card, it is a way to make someone's board
// unusable from the outside.
const clampSize = (n) => Math.max(40, Math.min(Math.round(n), 4000));

// ── PostgREST filter escaping ────────────────────────────────────────────────
//
// `or=(title.ilike.…,body.ilike.…)` is parsed from the DECODED query string, so
// percent-encoding a comma does NOT protect it — the transport decodes %2C back
// to a comma before PostgREST ever sees it, and the filter silently means
// something else. (Same class as the `+`-decodes-to-a-space trap found while
// testing handles.) Double-quoting is the mechanism that does work: inside
// quotes, commas and parens are literal and only \" and \\ are special.
//
// Two escaping layers, in this order, and the order is the whole trick:
//   1. LIKE metacharacters (% _ \) so a search for "100%" is not a wildcard;
//   2. PostgREST's own quoting, which doubles the backslashes layer 1 added.
// Unquoting then hands Postgres exactly one backslash, which is its LIKE escape.
export function pgLikeValue(q) {
  const escaped = String(q).replace(/[\\%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped}%`;
  return `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ── Authorization for card writes ────────────────────────────────────────────
//
// can_write_board is the app's own predicate, evaluated as the user. It walks
// the parent chain and honours workspace membership, editor shares and the
// waitlist gate — none of which this file should be re-deriving.
async function requireBoardWrite(env, token, boardId, refusal = 'you cannot write to that board') {
  const ok = await userRpc(env, token, 'can_write_board', { p_board_id: boardId })
    .catch(() => false);
  if (ok !== true) throw fail(403, 'forbidden', refusal);
}

// ── Multipart uploads ────────────────────────────────────────────────────────
//
// Proxied to the upload party's /mpu/* routes rather than reimplemented here,
// and that is a deliberate reuse rather than laziness:
//
//   · It is the SAME code path the browser has used in production for the
//     "upload any file type" feature, including the quota gate and the
//     workspace-prefixed key shape that scopes storage (0218).
//   · It authenticates on a plain Supabase user JWT (upload.ts checks the
//     Authorization header and re-runs can_write_board per call) — and
//     apiUserSession already mints exactly that. So this needs NO new secret
//     and, in particular, no R2 credentials inside this Worker.
//   · The bytes go from the caller STRAIGHT TO R2 via presigned part URLs.
//     A studio moving 25TB never sends a byte through here, which is the only
//     way the number works: buffering it would be both slow and, at 128MB of
//     isolate memory, impossible.
//
// A single-shot POST /uploads stays for small files, because one call is what
// makes it usable from a tool call.
async function partyMpu(env, token, workspaceId, action, body) {
  const host = env.PARTY_HOST || PARTY_HOST;
  let res;
  try {
    // By the PARTY binding: a workers.dev URL is refused from the preview.
    res = await partyFetch(env, `https://${host}/parties/upload/${encodeURIComponent(workspaceId)}/mpu/${action}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw fail(503, 'storage_unavailable', 'the upload service is unreachable right now');
  }

  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { /* plain-text refusal */ }

  if (!res.ok) {
    // The party answers over-quota with 402 and a machine-readable reason; keep
    // both, because "you are out of space" and "you may not write here" need
    // different things from the caller.
    const reason = parsed?.reason || '';
    if (res.status === 402 || reason === 'over_quota') {
      throw fail(402, 'limit_reached',
        'that would go past the storage included with this account');
    }
    if (res.status === 403) {
      throw fail(403, 'forbidden', reason === 'owner_not_paid'
        ? 'files over the free size limit need a paid account on the workspace that owns this board'
        : 'you cannot upload to that board');
    }
    if (res.status === 400) throw fail(400, 'bad_request', 'the upload service rejected that request');
    throw fail(502, 'upstream_error', 'the upload service could not complete that step');
  }
  return parsed || {};
}

// The workspace a board belongs to, read AS THE USER — so a board they cannot
// see comes back as "not found" rather than leaking its existence.
async function boardForUser(env, token, boardId, { includeDeleted = false } = {}) {
  const q = `id=eq.${boardId}${includeDeleted ? '' : '&deleted_at=is.null'}`
    + '&select=id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at';
  const rows = await userSelect(env, token, 'boards', q);
  return rows?.[0] || null;
}

// ── Docs written through the API ─────────────────────────────────────────────
//
// lib/docWrite.js turns Markdown into a doc's pages, written through the
// board's live room or not at all (scoutBoard.editCardLive, and
// addCardsToBoard's requireLive): a reader with the doc open, and a doc shared
// on its own (DocParty's mirror), only ever hear a page through the room. It
// loads on demand, so the Markdown parser costs only the calls that write one.
const loadDocWrite = () => import('./lib/docWrite.js');

// The room couldn't be reached, or never confirmed the change: nothing was
// written, and trying again is the right thing to do.
async function throughRoom(run) {
  try {
    return await run();
  } catch (e) {
    if (e?.code === 'room_unavailable') throw fail(503, 'room_unavailable', e.message);
    throw e;
  }
}

// A written page as the API answers with it: what GET …/doc lists for it.
const publicDocPage = ({ text: _text, ...page }) => page;

// A picture a doc written here may place: a file already on the board (or in
// the doc), named as a read gives it back (r2:<key>) or by its bare image_key.
const pictureFrom = (images) => (src) => {
  if (images.has(src)) return src;
  return images.has(`r2:${src}`) ? `r2:${src}` : false;
};

// Search inside documents reads doc_page_index, which the app writes when it
// saves a board, and a doc written here may wait a long time for that. Written
// as the user, row for row as the app writes it (lib/boardsApi.js
// syncDocPageIndex): a page with no words has no row. Best-effort: the doc is
// already written, and the app's next save writes the same rows.
async function indexDocPages(env, token, workspaceId, cardId, pages) {
  const rows = [];
  const empty = [];
  for (const p of pages) {
    const text = String(p.text || '').slice(0, 20000);
    if (!text.trim()) { empty.push(p.id); continue; }
    rows.push({
      doc_card_id: cardId,
      page_id: p.id,
      workspace_id: workspaceId,
      page_title: String(p.title || '').slice(0, 200),
      page_text: text,
      updated_at: new Date().toISOString(),
    });
  }
  try {
    if (rows.length) {
      await userInsert(env, token, 'doc_page_index', rows, { returning: 'minimal', onConflict: 'doc_card_id,page_id' });
    }
    if (empty.length) {
      await userDelete(env, token, 'doc_page_index',
        `doc_card_id=eq.${encodeURIComponent(cardId)}&page_id=in.${encodeURIComponent(pgInList(empty))}`);
    }
  } catch (e) {
    console.warn('[api] doc_page_index', e?.message);
  }
}

// The names a comment list shows (lib/apiComments.js namesFrom), read as the
// user, so whoever they can't see stays "Member" as in the app. Best effort: a
// thread still reads without its author's name.
async function commentNames(env, token, ids) {
  if (!ids.length) return new Map();
  const [profiles, users] = await Promise.all([
    userSelect(env, token, 'member_profiles', `user_id=in.(${ids.join(',')})&select=user_id,display_name`)
      .catch(() => []),
    userRpc(env, token, 'users_by_ids', { p_user_ids: ids }).catch(() => []),
  ]);
  return namesFrom(profiles, users);
}

// Who the caller is filed as on a comment written inside a doc or a note: the
// name and colour the app files them under (apiComments.docAuthor).
async function commentAuthor(env, token, userId) {
  const [profiles, users] = await Promise.all([
    userSelect(env, token, 'member_profiles', `user_id=eq.${userId}&select=user_id,display_name,color`)
      .catch(() => []),
    userRpc(env, token, 'users_by_ids', { p_user_ids: [userId] }).catch(() => []),
  ]);
  return docAuthor({ profile: profiles?.[0] || null, email: users?.[0]?.email || null, userId });
}

// ── Tags ─────────────────────────────────────────────────────────────────────

// What is on a board now, by id: its cards and its groups, from its document,
// which is the truth (a card past its owner's cap has no card_index row, and a
// deleted card keeps its tag links so that undoing the delete brings them
// back). `loaded: false` when the document couldn't be read.
async function boardContents(env, token, boardId) {
  return withBoardCards(env, boardId, token, ({ cards, doc, loaded }) => ({
    loaded,
    cards: new Set(cards.map((c) => String(c.id))),
    groups: new Set(doc.getMap('groups').keys()),
  }));
}

// Every row a select matches, a page at a time: the database answers one
// request with at most a thousand rows, and says nothing when it stops there.
// `query` names an order, so the pages don't overlap.
async function selectAll(env, token, table, query, { page = 1000, max = 20_000 } = {}) {
  const out = [];
  for (let offset = 0; offset < max; offset += page) {
    const rows = await userSelect(env, token, table, `${query}&limit=${page}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

// A write refused because the row is already there (unique_violation). The
// curated error keeps the database's own answer in its detail.
const isDuplicate = (e) => /"code":"23505"/.test(String(e?.detail || ''));

const TAG_ROW = `${TAG_FIELDS},slug,status,deleted_at`;

// The workspace's tags that `asked` names, by id or by name, deleted ones
// included: a deleted tag's name brings it back rather than making another
// (lib/tagsApi.js ensureTag).
async function findWorkspaceTags(env, token, workspaceId, asked) {
  const ids = asked.filter((t) => t.id).map((t) => t.id);
  const slugs = asked.filter((t) => t.slug).map((t) => t.slug);
  const [byId, bySlug] = await Promise.all([
    ids.length ? userSelect(env, token, 'tags',
      `workspace_id=eq.${workspaceId}&id=in.(${ids.join(',')})&select=${TAG_ROW}`) : [],
    slugs.length ? userSelect(env, token, 'tags',
      `workspace_id=eq.${workspaceId}&slug=in.${encodeURIComponent(pgInList(slugs))}&select=${TAG_ROW}`) : [],
  ]);
  return [...byId, ...bySlug];
}

// A new tag, as the app's Tag… picker makes one (ensureTag): the name as
// given, kind 'user', no colour (the app gives it one from its name). One made
// meanwhile by someone else is found instead.
async function makeTag(env, token, workspaceId, userId, tag) {
  try {
    const [row] = await userInsert(env, token, 'tags', [{
      workspace_id: workspaceId, name: tag.name, color: null, kind: 'user', created_by: userId,
    }]);
    return { row, created: true };
  } catch (e) {
    if (!isDuplicate(e)) throw e;
    const [row] = await findWorkspaceTags(env, token, workspaceId, [tag]);
    if (!row) {
      throw fail(409, 'conflict', `a tag named "${tag.name}" was being made at the same moment: try again`);
    }
    return { row, created: false };
  }
}

function pageParams(url) {
  const rawLimit = Number(url.searchParams.get('limit'));
  const rawOffset = Number(url.searchParams.get('offset'));
  return {
    limit: Math.max(1, Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PAGE, MAX_PAGE)),
    offset: Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0),
  };
}

// Fetch one more row than asked for and drop it. One round trip tells us both
// the page and whether there is another — a count query would cost a second
// scan to answer a question the first one already knows.
function paginate(rows, limit, offset) {
  const has_more = rows.length > limit;
  return { items: has_more ? rows.slice(0, limit) : rows, limit, offset, has_more };
}

// Remove, from `matches`, card identifiers on OTHER boards whose card is no
// longer on that board, and purge those rows so the (scope, value) is free.
//
// The document is the truth, not card_index: a card past its owner's cap can be
// on the canvas with no index row, and treating that as gone would strip a live
// card of its identifiers. One document read per distinct foreign board, and
// only when an item matched something elsewhere — the rare case, which until
// now always ended in a 409.
async function dropStaleForeignMatches(env, token, matches, boardId) {
  const byBoard = new Map();
  for (const [key, row] of matches) {
    if (String(row.board_id) === String(boardId)) continue;
    if (!byBoard.has(row.board_id)) byBoard.set(row.board_id, []);
    byBoard.get(row.board_id).push([key, row]);
  }
  for (const [bid, entries] of byBoard) {
    // A board whose document did not load reads as empty, and "empty" would
    // strip every live card on it of its identifiers. Leave its matches in
    // place; they refuse with the usual 409, and a retry can tell properly.
    const { cards, loaded } = await readBoardCardsChecked(env, bid, token);
    if (!loaded) continue;
    const live = new Set(cards.map((c) => String(c.id)));
    const dead = entries.filter(([, row]) => !live.has(String(row.object_id)));
    if (!dead.length) continue;
    const cardIds = [...new Set(dead.map(([, row]) => String(row.object_id)))];
    await purgeCardMeta(env, token, { boardId: bid, cardIds });
    // purgeCardMeta is best-effort and RLS turns a refused delete into zero
    // rows, so only a match whose row is really gone is dropped. One still
    // there would collide on insert after this item's card had been written.
    let still;
    try {
      still = new Set((await userSelect(env, token, 'object_identifiers',
        `board_id=eq.${bid}&object_type=eq.card`
        + `&object_id=in.${encodeURIComponent(pgInList(cardIds))}&select=object_id`) || [])
        .map((r) => String(r.object_id)));
    } catch (_) { continue; }
    for (const [key, row] of dead) if (!still.has(String(row.object_id))) matches.delete(key);
  }
}

// Keyset cursors carry a timestamp, and they get pasted into URLs — often by
// hand, often unencoded. PostgREST writes timestamps as `…:00.123456+00:00`,
// and an unencoded `+` in a query string decodes to a space, so a cursor this
// API had just issued came back as a 400 (2026-10-11 audit, API-13). Issued as
// `Z` instead (same instant, every microsecond kept, nothing to encode), and a
// space where an offset's `+` was is put back, so cursors already handed out
// still work.
const cursorTs = (ts) => String(ts).replace(/\+00:00$/, 'Z');
const readCursorTs = (ts) => (ts == null ? ts : String(ts).replace(/ (\d\d:?\d\d)$/, '+$1'));

// What a test or a redelivery did, for the caller. Null outcome means the row
// could not be claimed just now (another drain holds it); it is still due and
// goes out with the next one.
function deliveryOutcome(id, o) {
  if (!o) return { id: id || null, delivered: false, status: null, error: null, queued: true };
  return {
    id: o.id, delivered: !!o.delivered, status: o.status ?? null, attempt: o.attempt ?? null,
    response_ms: o.response_ms ?? null, error: o.error ?? null,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

// The scope a request needs, from its method — except the MCP transport.
//
// POST /mcp is an envelope, not a write: every MCP message, the handshake and
// tools/list included, arrives as a POST. Gating it on `write` meant a token
// with only `read` — what docs/mcp.md recommends for a research agent — got 403
// on `initialize` and could not connect at all, while the stdio package worked
// with the same token because it speaks REST with GET. Any token may open the
// transport; each tool's real call comes back through dispatch() via
// internalCall with its own method and meets the ordinary gate there, so a
// read-only token still cannot run add_cards or delete_board.
export function scopeFor(method, pathname) {
  if (/^\/api\/v1\/mcp\/?$/.test(pathname)) return 'read';
  // Taking a public link back undoes a write and destroys nothing anyone made:
  // whoever may publish a board may unpublish it.
  if (method === 'DELETE' && /^\/api\/v1\/boards\/[^/]+\/share-link\/?$/.test(pathname)) return 'write';
  return method === 'GET' ? 'read' : method === 'DELETE' ? 'delete' : 'write';
}

// `opts` is /mcp's (handleMcpEndpoint), which serves a signed-in caller through
// here: `resourcePath` names its own metadata in a challenge, and `mcp` is how
// its MCP server lists and runs tools.
export async function handleApiRoute(url, request, env, ctx, opts = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // The spec answers before authentication on purpose: a machine-readable
  // description of a public API that you need a credential to read is not
  // discoverable, and it describes only the shape, never anyone's data.
  if (url.pathname === '/api/v1/openapi.json') {
    return json(openapiDocument(url.origin), 200, { 'cache-control': 'public, max-age=3600' });
  }

  // Where a client with no credential is told to go.
  //
  // This one header is the entire entry point to the OAuth flow: an MCP client
  // that gets a bare 401 can only give up, whereas one that reads
  // `resource_metadata` fetches that document, finds the authorization server,
  // registers itself and sends the person to a consent screen — without anyone
  // having configured anything. RFC 9728 §5.1, and required of MCP servers.
  //
  // The path is the resource's own path, so /api/v1/mcp and /api/v1 each
  // describe themselves rather than sharing one document that is wrong for one
  // of them.
  const resourcePath = opts.resourcePath
    || (url.pathname.startsWith('/api/v1/mcp') ? '/api/v1/mcp' : '/api/v1');
  const challenge = (params) => ({
    'www-authenticate': `Bearer realm="soleil", ${params}, `
      + `resource_metadata="${url.origin}/.well-known/oauth-protected-resource${resourcePath}"`,
  });

  const t0 = Date.now();
  const auth = await resolveApiToken(request, env);
  if (!auth.ok) {
    return json({ error: auth.error, code: auth.code }, auth.status, {
      ...rateHeaders(auth.rate, { retryAfter: auth.status === 429 }),
      ...(auth.status === 401
        ? challenge('error="invalid_token", scope="read write"')
        : {}),
    });
  }

  // Sent on every response, not only refusals. A client that can only learn its
  // budget by being rejected has to hit the wall to find it.
  const rl = rateHeaders(auth.rate);

  const need = scopeFor(request.method, url.pathname);
  if (!hasScope(auth, need)) {
    return json({
      error: need === 'delete'
        ? 'this token cannot delete — mint one with the delete scope if that was the intent'
        : `this token cannot ${need}`,
      code: 'insufficient_scope',
      required_scope: need,
      scopes: auth.scopes,
      // A client holding an OAuth token can act on this: the challenge names
      // the scope it is missing, so it can re-authorize for that one rather
      // than guessing or asking for everything.
    }, 403, { ...rl, ...challenge(`error="insufficient_scope", scope="${need}"`) });
  }

  // Replay protection. Claimed BEFORE the work so two deliveries of the same
  // retry cannot both proceed; the response is stored after, and replayed
  // verbatim thereafter. Only for POST — PATCH and DELETE here are already
  // idempotent by construction, and GET has nothing to replay.
  const idemKey = request.method === 'POST'
    ? (request.headers.get('idempotency-key') || '').slice(0, 200)
    : '';
  if (idemKey) {
    const rows = await scoutRpc(env, 'api_idempotency_claim', {
      p_token_id: auth.tokenId, p_key: idemKey,
    }).catch(() => null);
    const claim = (Array.isArray(rows) ? rows : [rows])?.[0];
    if (claim && claim.claimed === false) {
      if (claim.response) {
        return json(claim.response, claim.status || 200, { ...rl, 'idempotent-replay': 'true' });
      }
      // Claimed but never completed: the first attempt is still running or died
      // mid-flight. Saying "in progress" is honest; replaying an empty success
      // would tell the caller work happened that may not have.
      return json({
        error: 'a request with this Idempotency-Key is still in progress',
        code: 'idempotency_in_progress',
      }, 409, rl);
    }
  }

  // Everything from here on must fall through to the idempotency bookkeeping
  // below, so failures set `res` rather than returning. An early return past a
  // CLAIMED key leaves it pinned as "in progress" forever, and every retry of
  // that key then gets a 409 — which is exactly backwards, since a failure here
  // is the case a retry exists for. Found by a session failure doing precisely
  // that during end-to-end testing.
  const trace = { route: url.pathname.replace(/^\/api\/v1/, '') || '/', target: null, tool: null };

  // Which MCP tool a REST call is standing in for, when one is.
  //
  // FOUND BY USING IT. The npm package is not an MCP client talking to /mcp —
  // it IS an MCP server, implementing the protocol locally and translating each
  // tool into ordinary /api/v1 calls. So every one of its requests looked like
  // hand-written REST, `tool` stayed null, and the admin tools table showed
  // nothing at all for anybody using the package. Only the HOSTED transport was
  // ever attributed.
  //
  // `Mcp-Name` is the header 2026-07-28 already defines for exactly this — the
  // name of the thing being invoked, mirrored beside the body so an
  // intermediary can route on it without parsing. The stdio server now sends it
  // on the calls it makes on a tool's behalf, and the /mcp branch below
  // overwrites this from the body it can actually see.
  //
  // It is a log annotation and nothing more. A client can put anything here and
  // gain nothing by it; the RPC truncates, and no decision is taken on it.
  const declaredTool = request.headers.get('mcp-name');
  if (declaredTool && /^[a-z0-9_/.-]{1,80}$/i.test(declaredTool)) trace.tool = declaredTool;
  let res;
  try {
    const token = await apiUserSession(env, auth.userId).catch((e) => {
      // Distinguished from a route failure so the caller is told the account
      // could not be opened, rather than a generic 500 they cannot act on.
      const err = fail(502, 'session_unavailable', 'could not open a session for that account');
      err.cause = e;
      throw err;
    });
    res = await dispatch(url, request, env, {
      auth, token, trace, waitUntil: ctx?.waitUntil ? (p) => ctx.waitUntil(p) : null, mcp: opts.mcp,
    });
  } catch (e) {
    // EVERY error leaves through normalizeApiError. Returning `e.message`
    // directly is what put the raw PostgREST envelope — table name, SQLSTATE
    // and all — into the response for the most common failure in the product
    // (the card cap), because card mutations throw from lib/scoutDb.js and
    // never touched the curation in restError.
    const { status, code, message } = normalizeApiError(e);
    if (status >= 500) {
      console.error('[api]', request.method, url.pathname, e?.message, e?.detail || e?.cause?.message || '');
      // worker.fetch records the 5xx at the door, with this.
      answeredWith(request, e, { kind: 'api', code });
    }
    res = json({ error: message, code }, status);
  }

  if (idemKey) {
    if (res.status < 500) {
      // 2xx and 4xx are both settled answers: the same request would produce
      // the same result, so replaying is right and saves the caller from
      // creating something twice.
      const body = await res.clone().json().catch(() => null);
      await scoutRpc(env, 'api_idempotency_store', {
        p_token_id: auth.tokenId, p_key: idemKey, p_response: body, p_status: res.status,
      }).catch(() => {});
    } else {
      // A 5xx is exactly the case a retry is FOR. Leaving the key claimed would
      // pin it as "in progress" forever and make that key permanently unusable,
      // so release it and let the client try again.
      await scoutDelete(env, 'api_idempotency',
        `token_id=eq.${auth.tokenId}&key=eq.${encodeURIComponent(idemKey)}`).catch(() => {});
    }
  }

  // Writes, plus any read a route asked to have recorded.
  //
  // 0220 logged writes only, on the grounds that reads are the bulk of traffic
  // and mostly noise. That is still true of listing boards — and false of
  // fetching image BYTES, which for a studio is the event that matters: who
  // took a copy of unreleased material, and when. Routes opt in with
  // `trace.log`, so the volume stays bounded by an explicit decision rather
  // than by a method check.
  //
  // Off the response path via waitUntil — an audit write must never be what
  // makes someone's request slow, or what fails it.
  if ((request.method !== 'GET' || trace.log) && auth.tokenId) {
    const write = scoutRpc(env, 'api_log_request', {
      p_token_id: auth.tokenId,
      p_user_id: auth.userId,
      p_method: request.method,
      p_route: trace.route,
      p_status: res.status,
      p_ms: Date.now() - t0,
      p_target: trace.target,
      p_tool: trace.tool || null,
      // 0320: where from. cf-connecting-ip is set by Cloudflare on every
      // request and cannot be forged by the client; the UA is bounded here so
      // the column stays small.
      p_ip: request.headers.get('cf-connecting-ip') || null,
      p_ua: (request.headers.get('user-agent') || '').slice(0, 200) || null,
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(write);
  }

  // A write may have queued webhook events. Draining here means an API-driven
  // event leaves in milliseconds instead of waiting up to a minute for the
  // cron; the cron still exists, and is what covers changes made in the app.
  // Guarded by a single indexed probe so the overwhelming majority of
  // workspaces — which have no webhooks — pay almost nothing.
  if (request.method !== 'GET' && ctx?.waitUntil) {
    ctx.waitUntil(hasPendingWork(env)
      .then((pending) => (pending ? runWebhooks(env, AFTER_WRITE_DRAIN) : null))
      .catch(() => {}));
  }

  return withHeaders(res, rl);
}

// ── /mcp: the MCP server for AI chats, with an account or without ───────────
//
// /api/v1/mcp asks for a sign-in before anything, which is right for Claude
// Code, Cursor and VS Code: a developer connecting a tool means their account.
// Someone in ChatGPT or Claude asking for a moodboard may have no account, so
// /mcp answers them without one (P3b): the handshake and the tool list are
// open, the draft tools run as a draft (an account nobody has claimed yet,
// 0705, lib/mcpDrafts.js), and the rest ask the person to sign in the way their
// host shows it. With a token it is /api/v1/mcp, listing the tools the same way.
//
// Held on production until a release opens it with its docs (draftsOpen).

// New drafts per address a minute. ChatGPT and Claude call from a few shared
// addresses for all of their users, so this only stops a burst; the day's
// ceiling on new drafts (mcp_draft_admit) is the real limit.
const draftCreateAllow = makeEdgeLimiter('MCP_DRAFT_CREATE');

const SIGNED_IN_MCP = {
  manifest: mixedManifest,
  instructions: DRAFT_INSTRUCTIONS,
  // A draft key from earlier in the conversation means nothing once signed in.
  beforeCall: (name, params) => ({ args: withoutDraft(params?.arguments) }),
};

export async function handleMcpEndpoint(url, request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Someone who opens the address in a browser reads how to connect it. (An MCP
  // client's GET asks for an event stream, never a page.)
  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
    return Response.redirect(new URL('/docs/mcp', url.origin).toString(), 302);
  }
  if (!draftsOpen(url.hostname)) return json({ error: 'unknown endpoint', code: 'not_found' }, 404);

  if (request.headers.get('authorization')) {
    return handleApiRoute(new URL('/api/v1/mcp', url.origin), request, env, ctx,
      { resourcePath: '/mcp', mcp: SIGNED_IN_MCP });
  }

  let body = null;
  try { body = await request.json(); } catch { /* answered as a parse error */ }
  const out = await handleMcpRequest(request, {
    tools: HOSTED_TOOLS,
    manifest: mixedManifest,
    instructions: DRAFT_INSTRUCTIONS,
    origin: url.origin,
    // Signed out, a tool only ever runs as a draft, which beforeCall sets up.
    api: async () => { throw new ApiError('sign in to Clusters first', { status: 401, code: 'invalid_token' }); },
    beforeCall: async (name, params) => {
      try {
        return await draftCall(url, request, env, ctx, name, params);
      } catch (e) {
        reportWorkerError(env, ctx, { kind: 'api', error: e, request, status: 500, code: 'draft_failed', op: 'mcp_draft' });
        throw e;
      }
    },
  }, body);
  if (out.body === null) return new Response(null, { status: out.status, headers: CORS });
  return json(out.body, out.status, out.headers);
}

// Who a signed-out call runs as: the draft its key finds (or, in ChatGPT, the
// draft of the same anonymous user), a new draft when the call is
// create_boards, or nobody, and then the person is asked to sign in.
async function draftCall(url, request, env, ctx, name, params) {
  const meta = params?._meta && typeof params._meta === 'object' ? params._meta : {};
  const host = draftHost(meta, request.headers.get('user-agent'));
  const signIn = (message) => signInAnswer({ origin: url.origin, host, message });
  if (!isDraftTool(name)) return signIn(DRAFT_SAYS.signInFor(name));

  const raw = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  const key = raw.draft;
  if (key !== undefined && !isDraftKey(key)) return draftRefusal(DRAFT_SAYS.notAKey);

  const secret = await draftSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const subject = await subjectHash(secret, meta['openai/subject']);
  const write = !HOSTED_TOOLS.find((t) => t.name === name)?.annotations?.readOnlyHint;

  let found = null;
  if (key || subject) {
    const rows = await scoutRpc(env, 'mcp_draft_resolve', {
      p_key_hash: key ? await sha256Hex(key) : null, p_subject_hash: subject, p_write: write,
    });
    found = (Array.isArray(rows) ? rows[0] : rows) || null;
  }
  const state = found?.state || 'unknown';
  if (state === 'kept') return signIn(DRAFT_SAYS.kept);
  if (state === 'rate_limited') return draftRefusal(DRAFT_SAYS.tooMany(found.req_limit, found.req_reset));
  if (key && state === 'expired') return draftRefusal(DRAFT_SAYS.expired);
  if (key && state === 'unknown') return draftRefusal(DRAFT_SAYS.unknown);

  let draft = state === 'live' ? found : null;
  let created = false;
  if (!draft) {
    if (name !== 'create_boards') return signIn(DRAFT_SAYS.nothingYet);
    const made = await makeDraft(env, request, { secret, subject, host, signIn });
    if (made.answer) return made.answer;
    ({ draft, created } = made);
  }

  // Files cost storage, and a day's bytes across all drafts have a ceiling.
  if (name === 'import_urls' && await scoutRpc(env, 'mcp_draft_admit', { p_kind: 'bytes' }) === 'paused') {
    return draftRefusal(DRAFT_SAYS.noMoreFiles);
  }

  const tokens = await draftTokens(secret, draft.draft_id);
  const auth = {
    ok: true, userId: draft.user_id, scopes: ['read', 'write', 'delete'], tokenId: null,
    draft: { id: draft.draft_id },
  };
  const token = await apiUserSession(env, draft.user_id);
  return {
    args: withoutDraft(raw),
    ctx: {
      api: (path, opts = {}) => internalCall(url, env, ctx, { auth, token }, path, opts),
      afterCall: (out) => draftAnswer(out, { origin: url.origin, tokens, expiresAt: draft.expires_at, created }),
      // A tool asks the person nothing a draft can't answer (create_boards' placement).
      draft: true,
    },
  };
}

// A new draft: an auth user at the draft's address, its personal workspace and
// root cluster (made as Scout makes a shell's), then its row (0705). Undone if
// a step fails, so no half-made draft is left behind.
async function makeDraft(env, request, { secret, subject, host, signIn }) {
  const gate = await draftCreateAllow(env, request.headers.get('cf-connecting-ip') || 'unknown');
  if (!gate.ok) return { answer: draftRefusal(DRAFT_SAYS.tooManyNew(gate.retryAfter)) };
  if (await scoutRpc(env, 'mcp_draft_admit', { p_kind: 'create' }) === 'paused') {
    return { answer: signIn(DRAFT_SAYS.paused) };
  }

  const id = crypto.randomUUID();
  const { userId } = await createDraftAuthUser(env, draftEmail(id), { host });
  let workspaceId = null;
  try {
    const ws = await scoutRpc(env, 'get_or_create_personal_workspace', { p_user_id: userId, p_name: 'Personal' });
    workspaceId = (Array.isArray(ws) ? ws[0] : ws)?.id || null;
    if (!workspaceId) throw new Error('no personal workspace for the draft');
    const t = await draftTokens(secret, id);
    const expiresAt = await scoutRpc(env, 'mcp_draft_register', {
      p_id: id, p_user_id: userId, p_workspace_id: workspaceId,
      p_key_hash: t.keyHash, p_keep_hash: t.keepHash, p_subject_hash: subject, p_host: host,
    });
    return { draft: { draft_id: id, user_id: userId, workspace_id: workspaceId, expires_at: expiresAt }, created: true };
  } catch (e) {
    if (workspaceId) await scoutDelete(env, 'workspaces', `id=eq.${workspaceId}`).catch(() => {});
    await deleteAuthUser(env, userId);
    // One ChatGPT user's first two calls at once: the other one made the draft.
    if (subject && (e?.status === 409 || /23505/.test(e?.body || ''))) {
      const rows = await scoutRpc(env, 'mcp_draft_resolve', { p_key_hash: null, p_subject_hash: subject, p_write: true });
      const other = (Array.isArray(rows) ? rows[0] : rows) || null;
      if (other?.state === 'live') return { draft: other, created: false };
    }
    throw e;
  }
}

// Call this API's own routes, from inside it.
//
// The MCP tools are defined once and used by two transports, so they are
// written against an HTTP client. On the hosted side that client is THIS — a
// direct call into dispatch with the caller's own auth, rather than a fetch
// back out to ourselves. Two reasons: a Worker calling its own public hostname
// is a second TLS round trip and a second rate-limit charge for one logical
// operation, and going out through the front door would re-run authentication
// against a token we have already resolved.
//
// Because it goes through the same dispatcher, an MCP tool cannot do anything a
// REST caller could not. That is the property worth having, and it is
// structural rather than remembered.
async function internalCall(baseUrl, env, ctx, { auth, token }, path, opts = {}) {
  const target = new URL(`/api/v1${path}`, baseUrl.origin);
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.rawBody !== undefined) {
    // A base64 payload from upload_image: the upload route reads raw bytes.
    const bin = atob(opts.rawBody);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = bytes;
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }

  const req = new Request(target, { method, headers, body });
  const trace = { route: target.pathname.replace(/^\/api\/v1/, '') || '/', target: null };
  let res;
  try {
    // Bound, as handleApiRoute binds it: a Worker's ExecutionContext refuses
    // waitUntil called off its own object ("Illegal invocation").
    res = await dispatch(target, req, env, {
      auth, token, trace, waitUntil: ctx?.waitUntil ? (p) => ctx.waitUntil(p) : null,
    });
  } catch (e) {
    // dispatch THROWS its refusals and lets a database failure through raw;
    // handleApiRoute curates both on the way out of a REST call, and this is
    // the same door for a tool. Without it a tool relayed scoutDb's envelope —
    // table name, SQLSTATE and all — straight into a model's context.
    const { status, code, message } = normalizeApiError(e);
    if (status >= 500) {
      console.error('[mcp→api]', method, target.pathname, e?.message, e?.detail || e?.cause?.message || '');
      // A tool's failure leaves /mcp as the tool's answer, not as a 5xx, so
      // the door never sees it: recorded here.
      reportWorkerError(env, ctx, { kind: 'api', error: e, request: req, status, code, op: 'mcp' });
    }
    throw new ApiError(message, {
      status,
      code,
      ...(code === 'insufficient_scope'
        ? { requiredScope: scopeFor(method, target.pathname), scopes: auth.scopes }
        : {}),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    throw apiErrorFrom(res.status, data, res.headers);
  }
  if (opts.raw) {
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      variant: res.headers.get('x-image-variant') || 'original',
    };
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// One import item fetched and, when it is a picture, stored: by hand through
// every redirect, under the owner's byte ceiling, its space reserved before
// it is written, and its images row made. POST /boards/:id/import runs it on
// every item; keeping a /make link (worker-make.js) on every picture.
async function importItem(env, token, userId, board, item) {
  try {
    // Redirects are followed BY HAND, every hop re-checked against the same
    // rule normalizeImportItems ran on the submitted URL. With
    // redirect:'follow' (until 2026-10-02) that check guarded only the first
    // hop, so any allowed public URL could 302 the importer to an address
    // the manifest itself would have refused.
    const { res } = await fetchFollowingSafely(item.url, {
      signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
      // No credentials of ours ever ride along, and a generic agent because
      // some CDNs refuse an empty one outright.
      headers: { accept: 'image/*,*/*;q=0.8', 'user-agent': 'SoleilClusters-Import/1.0' },
    }, { check: (u) => publicHttpsUrlProblem(u.href) });
    if (!res.ok) {
      return { item, ok: false, error: `the source answered ${res.status}`, code: 'source_unavailable' };
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = extensionFor(contentType);
    const kind = kindForContentType(contentType, { storable: Boolean(ext) });

    if (kind !== 'image') {
      // Not stored, and the response says why. A silent link card is how
      // somebody ends up believing their PDF is in the archive.
      return { item, ok: true, kind, note: noteFor(kind, contentType) };
    }

    // Declared length first, so an oversized source is abandoned before it
    // is pulled into a 128MB isolate rather than after.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return {
        item, ok: false, code: 'payload_too_large',
        error: `that source is ${Math.round(declared / 1048576)}MB — the limit is `
          + `${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB through the API`,
      };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return { item, ok: false, error: 'the source was empty', code: 'source_unavailable' };
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return {
        item, ok: false, code: 'payload_too_large',
        error: `that source is ${Math.round(bytes.length / 1048576)}MB — the limit is `
          + `${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB through the API`,
      };
    }

    // The same owner-pays byte ceiling the browser upload path runs. Asked
    // per item so a big import stops at the cap instead of blowing past it.
    const verdictRows = await userRpc(env, token, 'authorize_image_upload',
      { p_board_id: board.id, p_bytes: bytes.length }).catch(() => null);
    const verdict = Array.isArray(verdictRows) ? verdictRows[0] : verdictRows;
    if (verdict && verdict.allow !== true && verdict.reason === 'over_quota') {
      return {
        item, ok: false, code: 'limit_reached',
        error: 'that would go past the storage included with this account',
      };
    }

    // Workspace-prefixed key, derived from the board and never from input —
    // the prefix is what scopes storage to a workspace (0218).
    const key = `${board.workspace_id}/${crypto.randomUUID()}.${ext}`;
    // Reserved before it is written (0610): a big import stops at the cap
    // even when its items race each other for the last of the space.
    const held = await reserveUploadSpace((fn, params) => userRpc(env, token, fn, params),
      { key, bytes: bytes.length, boardId: board.id });
    if (held === 'full') {
      return { item, ok: false, code: 'limit_reached', error: 'that would go past the storage included with this account' };
    }
    if (held !== 'reserved') {
      return { item, ok: false, code: 'storage_unavailable', error: 'image storage is not available right now' };
    }
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
    const dims = imageDimensions(bytes);

    // The images row is LOAD-BEARING: it authorizes reads and keeps the R2
    // orphan sweep from reclaiming the object. An import that skipped it
    // would quietly evaporate in 30 days, which is the exact failure this
    // whole feature exists to stop.
    await userInsert(env, token, 'images', [{
      workspace_id: board.workspace_id,
      board_id: board.id,
      storage_path: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      size_bytes: bytes.length,
      uploaded_by: userId,
    }], { returning: 'minimal' });

    return {
      item, ok: true, kind, imageKey: key,
      stored: { imageKey: key, width: dims?.width, height: dims?.height },
    };
  } catch (e) {
    if (e instanceof UnsafeFetchError) {
      return { item, ok: false, code: 'source_refused', error: `that source ${e.message}` };
    }
    const timedOut = e?.name === 'TimeoutError' || /timed? ?out/i.test(e?.message || '');
    return {
      item, ok: false, code: timedOut ? 'source_timeout' : 'source_unavailable',
      error: timedOut ? `the source did not answer within ${IMPORT_TIMEOUT_MS / 1000}s`
        : `could not fetch that source: ${e?.message || 'unknown error'}`,
    };
  }
}

// The API as a person signed in to the app, from inside the Worker: keeping a
// /make link (worker-make.js) makes its board through these same routes, so
// the card cap, sections, webhooks and RLS are what any caller meets. The
// person's own session is the token; there is no API token, so nothing is
// logged against one.
export function callApiAs(origin, env, ctx, { userId, token }, path, opts = {}) {
  const auth = { ok: true, userId, scopes: ['read', 'write', 'delete'], tokenId: null };
  return internalCall(new URL(origin), env, ctx, { auth, token }, path, opts);
}

// One picture by its address, stored on `board` ({ id, workspace_id }) as an
// import stores it (importItem), as the person whose session `token` is.
//   { ok: true, imageKey, width, height } | { ok: false, code, error }
export async function storePictureFrom(env, { userId, token }, board, url) {
  const r = await importItem(env, token, userId, board, { url });
  if (!r.ok) return { ok: false, code: r.code || 'source_unavailable', error: r.error || null };
  if (r.kind !== 'image') return { ok: false, code: 'not_a_picture', error: 'that address is not a picture' };
  return { ok: true, imageKey: r.imageKey, width: r.stored?.width ?? null, height: r.stored?.height ?? null };
}

async function dispatch(url, request, env, ctx) {
  const { auth, token, trace } = ctx;
  const parts = url.pathname.replace(/^\/api\/v1\/?/, '').replace(/\/$/, '').split('/').filter(Boolean);
  const [head, id, sub, subId] = parts;
  const method = request.method;

  // The scope gate in handleApiRoute reads the OUTER request's method, and the
  // MCP transport is a POST: its tools call back in here through internalCall,
  // so a token without the delete scope could run delete_board and
  // delete_cards (2026-10-06 audit). Checked again here, every path into the
  // dispatcher — REST and MCP alike — meets the same scope for the same method.
  const need = scopeFor(method, url.pathname);
  if (!hasScope(auth, need)) {
    throw fail(403, 'insufficient_scope', need === 'delete'
      ? 'this token cannot delete — mint one with the delete scope if that was the intent'
      : `this token cannot ${need}`);
  }

  // A draft (made through /mcp by someone with no account) reaches the routes
  // its tools use and nothing else: never sharing or publishing, tokens,
  // webhooks, the audit log, uploads, or deleting a cluster (lib/mcpDrafts.js).
  if (auth.draft && !draftRouteAllowed(method, parts)) {
    throw fail(403, 'forbidden', 'a draft can make and change its own clusters, and no more until it is kept in Clusters');
  }

  // The single-shot upload carries RAW BYTES, so its body must not be parsed as
  // JSON. Its multipart siblings underneath /uploads/* are ordinary JSON, and
  // treating them as raw too is what made every field arrive undefined.
  const isRawUpload = head === 'uploads' && !id;
  // DELETE carries a body here, which is unusual but deliberate: a bulk delete
  // of a thousand card ids does not fit in a query string, and the alternative
  // — POST /cards/delete — makes a destructive call look like a create to every
  // proxy, log and scope check between the caller and this line. A body is only
  // read when one was actually sent with a JSON content type, so an ordinary
  // single DELETE is unaffected.
  const hasJsonBody = (request.headers.get('content-type') || '').includes('json');
  const body = (method === 'GET' || isRawUpload || (method === 'DELETE' && !hasJsonBody))
    ? {}
    : await request.json().catch(() => ({}));

  // GET /  — the first thing anyone curls. Answering with the route list beats
  // answering with "unknown endpoint" for the one URL a person types by hand.
  if (!head && method === 'GET') {
    return json({
      version: 'v1',
      // The published docs, not a GitHub blob: an agent that curls this should
      // get somewhere it can keep reading, including the .md twin of every page.
      docs: `${url.origin}/docs/api`,
      llms: `${url.origin}/llms.txt`,
      openapi: `${url.origin}/api/v1/openapi.json`,
      scopes: auth.scopes,
      endpoints: [
        'GET    /me',
        'GET    /workspaces',
        'GET    /workspaces/:id/tags?name=&limit=&offset=  — its tags, each with how many things carry it',
        'GET    /tags/:id?limit=            — everything carrying a tag, across the workspace',
        'GET    /service-accounts?workspace=',
        'POST   /service-accounts',
        'DELETE /service-accounts/:id',
        'GET    /service-accounts/:id/tokens',
        'POST   /service-accounts/:id/tokens',
        'DELETE /service-accounts/:id/tokens/:tokenId',
        'GET    /search?q=&kind=&workspace=&limit=&offset=',
        'GET    /resolve?scope=&value=&type=&workspace=',
        'GET    /boards?workspace=&parent=&deleted=&since=&cursor=&include=&limit=&offset=',
        'GET    /boards/tree?root=&workspace=&depth=',
        'POST   /boards/move',
        'DELETE /boards            {"board_ids":[…]}  — bulk soft-delete',
        'GET    /audit?since=&cursor=&limit=',
        'POST   /mcp                        — Model Context Protocol, for AI agents',
        'GET    /webhooks?workspace=',
        'POST   /webhooks',
        'PATCH  /webhooks/:id',
        'DELETE /webhooks/:id',
        'POST   /webhooks/:id/test',
        'GET    /webhooks/:id/deliveries?limit=&cursor=',
        'POST   /webhooks/:id/deliveries/:deliveryId/redeliver',
        'POST   /boards',
        'POST   /boards            {"boards":[…]}  — bulk, up to 500',
        'GET    /boards/:id',
        'GET    /boards/:id/export?format=json|omc',
        'GET    /boards/:id/gallery?inline=&size=sm|preview&card_ids=&limit=&cursor=',
        'GET    /boards/:id/canvas      — the board as drawn, its pictures at addresses good for an hour',
        'GET    /boards/:id/share-link',
        'POST   /boards/:id/share-link      {"include_subboards":false}  — the view-only link, made once',
        'DELETE /boards/:id/share-link      — revokes the view links you may revoke',
        'POST   /boards/:id/import          {"items":[{"url":…}]}  — re-runnable',
        'POST   /boards/:id/arrange         {"layout":"justified|masonry|grid|row|column"}',
        'GET    /boards/:id/groups',
        'POST   /boards/:id/groups',
        'PATCH  /boards/:id/groups/:groupId',
        'DELETE /boards/:id/groups/:groupId  — ungroups, never deletes cards',
        'GET    /boards/:id/comments?status=open|resolved|all&limit=&cursor=  — threads, on the canvas and inside docs and notes',
        'POST   /boards/:id/comments        {"body":…,"card_id"|"group_id"|"x","y"|"reply_to":…}; "quote" (and "page_id") with a doc card puts it on those words',
        'PATCH  /boards/:id/comments        {"comment_ids":[…],"resolved":true|false}',
        'PATCH  /boards/:id/comments/:commentId  {"resolved":true|false}',
        'DELETE /boards/:id/comments/:commentId  — your own; restorable, except a thread inside a doc',
        'POST   /boards/:id/comments/:commentId/restore',
        'GET    /boards/:id/tags            — the tags on this board, and what carries each',
        'POST   /boards/:id/tags            {"card_ids":[…],"add":[…],"remove":[…]}  — tags on cards, by name or id',
        'PATCH  /boards/:id',
        'DELETE /boards/:id',
        'POST   /boards/:id/restore',
        'GET    /boards/:id/cards?source=live|index&since=&cursor=&include=&limit=&offset=',
        'POST   /boards/:id/cards',
        'PATCH  /boards/:id/cards            {"cards":[…]}  — bulk',
        'DELETE /boards/:id/cards            {"card_ids":[…]}  — bulk',
        'GET    /boards/:id/cards/:cardId',
        'GET    /boards/:id/cards/:cardId/doc?page=&max_chars=  — a doc card, page by page, as Markdown',
        'POST   /boards/:id/docs            {"title":…,"pages":[{"title":…,"markdown":…}]}  — a new doc card',
        'POST   /boards/:id/cards/:cardId/doc/pages  {"pages":[…],"parent_page_id":…}  — pages added',
        'PATCH  /boards/:id/cards/:cardId/doc/pages/:pageId  {"markdown":…,"page_hash":…} | {"edits":[…]} | {"title":…}',
        'PATCH  /boards/:id/cards/:cardId',
        'DELETE /boards/:id/cards/:cardId',
        'POST   /boards/:id/cards/move',
        'POST   /uploads?board=:id',
        'POST   /uploads/multipart?board=:id',
        'POST   /uploads/multipart/parts',
        'POST   /uploads/multipart/complete',
        'POST   /uploads/multipart/abort',
        'GET    /images?workspace=&board=&since=&cursor=&limit=',
        'GET    /images/:key?variant=preview',
      ],
    });
  }

  // GET /me
  if (head === 'me' && method === 'GET') {
    const rows = await userSelect(env, token, 'profiles',
      `user_id=eq.${auth.userId}&select=user_id,display_name,tier`);
    const p = rows?.[0] || {};
    return json({
      user_id: auth.userId,
      display_name: p.display_name ?? null,
      tier: p.tier ?? 'demo',
      scopes: auth.scopes,
      // A machine identity should be able to say so. An integration that has
      // been handed the wrong credential otherwise finds out by being refused
      // somewhere far from the cause.
      service_account: auth.serviceAccount,
      workspace_id: auth.workspaceId,
      rate_limit: {
        limit: auth.rate?.limit ?? null,
        remaining: auth.rate ? Math.max(0, auth.rate.limit - auth.rate.used) : null,
        reset: auth.rate?.reset ?? null,
      },
    });
  }

  // ── Tags ───────────────────────────────────────────────────────────────────
  //
  // The app's tags (lib/apiTags.js): a workspace's tags, everything one tag is
  // on, and, under /boards/:id/tags, a board's tags and tagging its cards. All
  // as the person, so the tables' own policies decide; as in the app, a
  // workspace's tags are its members'.

  // GET /workspaces/:id/tags?name=&limit=&offset= — the workspace's tags, each
  // with how many things carry it (tag_item_counts, 0592); name finds one.
  if (head === 'workspaces' && id && sub === 'tags' && !subId) {
    trace.route = '/workspaces/:id/tags';
    if (method !== 'GET') throw fail(405, 'method_not_allowed', `${method} is not supported here`);
    if (!isUuid(id)) throw fail(400, 'bad_request', 'workspace id must be a uuid');
    trace.target = id;
    const named = url.searchParams.has('name') ? cleanTagName(url.searchParams.get('name')) : undefined;
    if (named === null) throw fail(400, 'bad_request', 'name must be a tag\'s name');
    const member = await userRpc(env, token, 'is_workspace_member', { ws: id }).catch(() => false);
    if (member !== true) throw fail(404, 'not_found', 'no workspace of yours has that id');
    const { limit, offset } = pageParams(url);
    const [rows, counts] = await Promise.all([
      userSelect(env, token, 'tags', `workspace_id=eq.${id}&status=neq.deleted&deleted_at=is.null`
        + (named ? `&slug=in.${encodeURIComponent(pgInList([tagSlug(named)]))}` : '')
        + `&select=${TAG_FIELDS}&order=name.asc,id.asc&limit=${limit + 1}&offset=${offset}`),
      userRpc(env, token, 'tag_item_counts', { p_workspace_id: id }).catch(() => null),
    ]);
    const items = new Map((counts || []).map((c) => [c.tag_id, c.items]));
    const page = paginate(rows || [], limit, offset);
    return json({
      workspace_id: id,
      tags: page.items.map((t) => publicTag(t, counts ? items.get(t.id) ?? 0 : null)),
      limit, offset, has_more: page.has_more,
    });
  }

  // GET /workspaces
  if (head === 'workspaces' && method === 'GET') {
    const rows = await userSelect(env, token, 'workspaces', 'select=id,name,created_at&order=created_at.asc');
    return json({ workspaces: rows.map((w) => ({ id: w.id, name: w.name, created_at: w.created_at })) });
  }

  // ── Service accounts ──────────────────────────────────────────────────────
  //
  // A credential that belongs to the WORKSPACE rather than to a person. The
  // integration a studio builds cannot be Bob's token: Bob leaves, or his tier
  // moves, and every pipeline that depended on it stops with a 403 nobody can
  // explain. A service account is a real auth.users row holding a
  // workspace_members row, so it is subject to exactly the same RLS as a human
  // and confined to the one workspace it was made for.
  //
  // Only the workspace OWNER may create one — enforced in the RPC, not here,
  // because an editor who can write to a workspace should not be able to mint a
  // credential that outlives their own access to it.
  if (head === 'service-accounts') {
    // A service account creating another service account would let one leaked
    // credential clone itself indefinitely. The RPC already refuses (it demands
    // workspaces.created_by = auth.uid(), and a service account never is), but
    // saying so plainly beats a permission error about workspace ownership.
    if (auth.serviceAccount) {
      throw fail(403, 'forbidden',
        'a service account cannot manage service accounts — use the owner’s token');
    }

    // GET /service-accounts?workspace=<uuid>
    if (!id && method === 'GET') {
      const ws = url.searchParams.get('workspace');
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
      const rows = await userRpc(env, token, 'service_account_list', { p_workspace_id: ws });
      return json({ service_accounts: (rows || []).map(publicServiceAccount) });
    }

    // POST /service-accounts  {workspace_id, name, scopes?, ttl_days?, rate_limit?}
    // Creates the identity AND its first token, because a service account with
    // no credential is not usable and a second round trip to get one is a step
    // every caller would have to take anyway.
    if (!id && method === 'POST') {
      const ws = body.workspace_id;
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      const name = str(body.name, 80);
      if (!name) throw fail(400, 'bad_request', 'name is required');
      const scopes = requestedScopes(body.scopes, auth);

      const { userId: saId } = await createServiceAuthUser(env, { label: name });
      let account;
      try {
        const rows = await userRpc(env, token, 'service_account_register', {
          p_user_id: saId, p_workspace_id: ws, p_name: name,
        });
        account = (rows || [])[0];
        if (!account) throw fail(502, 'upstream_error', 'the service account was not registered');
      } catch (e) {
        // The identity exists and belongs to nothing. Take it back rather than
        // leave an orphan that counts as a signup and can never be reached.
        await deleteAuthUser(env, saId);
        throw e;
      }

      const minted = await mintServiceToken(env, token, {
        userId: saId, name: `${name} token`, scopes,
        ttlDays: body.ttl_days, rateLimit: body.rate_limit,
      });
      trace.target = null;
      return json({
        service_account: publicServiceAccount(account),
        token: minted,
        next: 'Use this token as the Bearer credential. It is shown once.',
      }, 201);
    }

    if (id && !isUuid(id)) throw fail(400, 'bad_request', 'service account id must be a uuid');

    // DELETE /service-accounts/:id — revokes every token and drops the
    // membership, so the credential is dead when this returns. The auth row
    // stays, so the audit log keeps resolving to a name.
    if (id && !sub && method === 'DELETE') {
      const rows = await userRpc(env, token, 'service_account_disable', { p_user_id: id });
      const r = (rows || [])[0];
      if (!r) throw fail(404, 'not_found', 'no such service account');
      return json({ disabled: true, user_id: r.user_id, tokens_revoked: r.tokens_revoked ?? 0 });
    }

    if (id && sub === 'tokens') {
      // GET /service-accounts/:id/tokens
      if (!subId && method === 'GET') {
        const rows = await userRpc(env, token, 'api_token_list_for', { p_user_id: id });
        return json({ tokens: rows || [] });
      }
      // POST /service-accounts/:id/tokens — rotation is mint-then-revoke, so
      // an integration can be moved onto a new credential with no downtime.
      if (!subId && method === 'POST') {
        const minted = await mintServiceToken(env, token, {
          userId: id, name: str(body.name, 80) || 'Service token',
          scopes: requestedScopes(body.scopes, auth),
          ttlDays: body.ttl_days, rateLimit: body.rate_limit,
        });
        return json({ token: minted }, 201);
      }
      // DELETE /service-accounts/:id/tokens/:tokenId
      if (subId && method === 'DELETE') {
        if (!isUuid(subId)) throw fail(400, 'bad_request', 'token id must be a uuid');
        const ok = await userRpc(env, token, 'api_token_revoke_for', { p_token_id: subId });
        if (!ok) throw fail(404, 'not_found', 'no such token');
        return json({ revoked: true, token_id: subId });
      }
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // ── /webhooks ─────────────────────────────────────────────────────────────
  //
  // Management copies ShotGrid's surface — create, list, update, delete, test,
  // list deliveries, redeliver — because that is the one facilities already
  // rely on, and a delivery log you can inspect and replay is what makes
  // "it didn't arrive" a question with an answer.
  if (head === 'webhooks') {
    if (!id && method === 'GET') {
      const ws = url.searchParams.get('workspace');
      if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: ws || null });
      return json({ webhooks: rows || [] });
    }

    if (!id && method === 'POST') {
      const ws = body.workspace_id;
      if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      const problem = webhookUrlProblem(body.url);
      if (problem) throw fail(400, 'bad_request', problem);
      const events = normalizeEvents(body.events);
      const rows = await userRpc(env, token, 'webhook_create', {
        p_workspace_id: ws, p_url: String(body.url), p_events: events,
        p_name: str(body.name, 80),
      });
      const w = (rows || [])[0];
      if (!w) throw fail(502, 'upstream_error', 'the webhook was not created');
      return json({
        webhook: { id: w.id, workspace_id: ws, url: String(body.url), events, active: true,
          created_at: w.created_at },
        // The only time this value exists outside the database. There is no read
        // path for it, here or in SQL.
        secret: w.secret,
        next: 'Verify each delivery: HMAC-SHA256 of "v0:{timestamp}:{body}", compared with the X-Soleil-Signature header.',
      }, 201);
    }

    if (id && !isUuid(id)) throw fail(400, 'bad_request', 'webhook id must be a uuid');

    if (id && !sub && method === 'PATCH') {
      if (body.url != null) {
        const problem = webhookUrlProblem(body.url);
        if (problem) throw fail(400, 'bad_request', problem);
      }
      const ok = await userRpc(env, token, 'webhook_update', {
        p_id: id,
        p_url: body.url != null ? String(body.url) : null,
        p_events: body.events != null ? normalizeEvents(body.events) : null,
        p_name: str(body.name, 80),
        p_active: typeof body.active === 'boolean' ? body.active : null,
      });
      if (!ok) throw fail(404, 'not_found', 'no such webhook');
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: null });
      return json({ webhook: (rows || []).find((w) => w.id === id) || null });
    }

    if (id && !sub && method === 'DELETE') {
      const ok = await userRpc(env, token, 'webhook_delete', { p_id: id });
      if (!ok) throw fail(404, 'not_found', 'no such webhook');
      return json({ deleted: true, webhook_id: id });
    }

    // POST /webhooks/:id/test — a real delivery through the real path, so what
    // it proves is what will happen, not what a separate code path does.
    if (id && sub === 'test' && method === 'POST') {
      const rows = await userRpc(env, token, 'webhook_list', { p_workspace_id: null });
      const w = (rows || []).find((x) => x.id === id);
      if (!w) throw fail(404, 'not_found', 'no such webhook');
      const inserted = await scoutInsert(env, 'webhook_deliveries', [{
        webhook_id: id,
        event: 'webhook.test',
        payload: {
          type: 'webhook.test',
          resource: { type: 'webhook', id },
          workspace: { id: w.workspace_id },
          board: null,
          data: { message: 'If you are reading this, delivery and signing work.' },
          occurred_at: new Date().toISOString(),
        },
      }], { returning: 'representation' });
      // THIS row, sent now — not a general drain of whatever is oldest across
      // every workspace, which with any backlog left the test unsent while the
      // reply said `sent: true` beside other people's counts.
      const deliveryId = inserted?.[0]?.id;
      const out = deliveryId ? await deliverOne(env, deliveryId) : null;
      return json({
        sent: !!out?.outcome?.delivered,
        delivery: deliveryOutcome(deliveryId, out?.outcome),
        check: `GET /api/v1/webhooks/${id}/deliveries`,
      });
    }

    if (id && sub === 'deliveries' && method === 'GET' && !subId) {
      let { limit } = pageParams(url);
      // `created_at|id`. A bare timestamp — what this route issued before —
      // is still accepted and continues from that instant.
      const raw = url.searchParams.get('cursor');
      const [rawTs, cursorId] = raw ? String(raw).split('|') : [null, null];
      const afterTs = readCursorTs(rawTs);
      if (afterTs && Number.isNaN(Date.parse(afterTs))) {
        throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
      }
      if (cursorId && !isUuid(cursorId)) {
        throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
      }

      // Keyset on (created_at, id), one row over the page to learn whether
      // there is another. The old function paged on the timestamp alone — and
      // one fan-out inserts many deliveries with the same now(), so the rest
      // of a tied run could never be listed or redelivered — and capped at 200
      // while this route allowed 500 and reported has_more by `rows = limit`,
      // which a 500 request could never satisfy (audit API-11, 0409).
      let rows;
      try {
        rows = await userRpc(env, token, 'webhook_deliveries_page', {
          p_webhook_id: id, p_limit: limit + 1,
          p_cursor_ts: afterTs || null, p_cursor_id: cursorId || null,
        });
      } catch (e) {
        if (!(e?.status === 404 && /PGRST202|could not find the function/i.test(e?.detail || ''))) throw e;
        // Before 0409: the old function, inside its own 200-row cap.
        limit = Math.min(limit, 199);
        rows = await userRpc(env, token, 'webhook_deliveries_list', {
          p_webhook_id: id, p_limit: limit + 1, p_cursor: afterTs || null,
        });
      }
      const all = rows || [];
      const items = all.slice(0, limit);
      const hasMore = all.length > limit;
      const last = items[items.length - 1];
      return json({
        deliveries: items,
        limit,
        has_more: hasMore,
        next_cursor: hasMore && last ? `${cursorTs(last.created_at)}|${last.id}` : null,
      });
    }

    if (id && sub === 'deliveries' && subId && method === 'POST') {
      // .../deliveries/:did/redeliver — requeued rather than re-POSTed inline,
      // so the retry goes through the same path and is recorded the same way.
      const ok = await userRpc(env, token, 'webhook_redeliver', { p_delivery_id: subId });
      if (!ok) throw fail(404, 'not_found', 'no such delivery');
      // Sent now, by id, through the same delivery path — and the answer is
      // about this delivery, not the 25 oldest due rows across every workspace.
      const out = await deliverOne(env, subId);
      return json({ requeued: true, delivery_id: subId, delivery: deliveryOutcome(subId, out?.outcome) });
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // POST /mcp — the hosted MCP server.
  //
  // Same credential, same scopes, same rate limit as everything else here. The
  // tools call back into this dispatcher rather than over the network, so there
  // is no second permission model to keep in step: what a token can do over
  // REST is exactly what it can do over MCP, by construction.
  if (head === 'mcp') {
    trace.route = '/mcp';
    // Which tool, not just which route. See mcpTraceName — one HTTP route
    // serving thirty-three tools makes a route-keyed log useless.
    trace.tool = mcpTraceName(body);
    // /mcp signed in: its tool list and the draft argument it strips (ctx.mcp).
    const out = await handleMcpRequest(request, {
      api: (path, opts = {}) => internalCall(url, env, ctx, { auth, token }, path, opts),
      // Where the inline view's pictures come from (resources/read's CSP).
      origin: url.origin,
      ...(ctx.mcp || {}),
    }, body);
    if (out.body === null) return new Response(null, { status: out.status, headers: CORS });
    return json(out.body, out.status, out.headers);
  }

  // GET /audit?since=&cursor=&limit=
  //
  // api_request_log has been written on every write since 0220 and its only
  // read path had ZERO callers anywhere in the repo — an audit trail that
  // exists and is unreachable, which for a studio is the same as not having
  // one. This also covers a workspace owner's service accounts, which the old
  // `user_id = auth.uid()` predicate could not express.
  if (head === 'audit' && method === 'GET') {
    const since = url.searchParams.get('since');
    const cursor = url.searchParams.get('cursor');
    const { limit } = pageParams(url);
    if (since && Number.isNaN(Date.parse(since))) {
      throw fail(400, 'bad_request', 'since must be an ISO timestamp');
    }
    if (cursor && !/^\d+$/.test(String(cursor))) {
      throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
    }
    const rows = await userRpc(env, token, 'api_audit_read', {
      p_since: since || null,
      p_cursor: cursor ? Number(cursor) : null,
      p_limit: limit,
    });
    const items = rows || [];
    const last = items[items.length - 1];
    return json({
      entries: items.map((r) => ({
        id: String(r.id),
        at: r.created_at,
        actor: r.actor,
        actor_id: r.actor_id,
        token_id: r.token_id,
        token_name: r.token_name,
        method: r.method,
        route: r.route,
        // The MCP tool, or the JSON-RPC method for a non-tool call. Null for
        // REST, and null for MCP entries written before this was recorded —
        // which is honest: those rows genuinely do not know.
        tool: r.tool ?? null,
        target_id: r.target_id,
        status: r.status,
        ms: r.ms,
      })),
      limit,
      // Keyset on the log's own id, descending: created_at is not unique under
      // a migration doing thousands of writes a second.
      has_more: items.length === limit,
      next_cursor: items.length === limit && last ? String(last.id) : null,
      // Said plainly rather than left to be discovered: this records writes
      // through /api/v1, not edits made in the app.
      covers: 'writes made through /api/v1 and reads of image bytes',
    });
  }

  // GET /resolve?scope=&value=[&type=][&workspace=]
  //
  // The reverse lookup, and the reason identifiers are worth storing at all.
  // A pipeline holding a ShotGrid id needs to get from that to the board
  // without keeping its own map of which board it made for which shot — which
  // is the exact bookkeeping every integration ends up doing when an API cannot
  // answer this question.
  if (head === 'resolve' && method === 'GET') {
    const scope = (url.searchParams.get('scope') || '').trim().toLowerCase();
    const value = (url.searchParams.get('value') || '').trim();
    const type = url.searchParams.get('type');
    const ws = url.searchParams.get('workspace');
    if (!scope || !value) throw fail(400, 'bad_request', 'scope and value are required');
    if (type && !OBJECT_TYPES.includes(type)) {
      throw fail(400, 'bad_request', `type must be one of ${OBJECT_TYPES.join(', ')}`);
    }
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');

    // RLS does the authorization: object_identifiers is readable exactly where
    // can_read_board is true, so an identifier on someone else's board simply
    // is not here. No filtering afterwards, and no way to probe for what exists
    // by watching which lookups come back empty.
    let q = `scope=eq.${encodeURIComponent(scope)}&value=eq.${encodeURIComponent(value)}`
      + '&select=object_type,object_id,board_id,workspace_id,scope,value,created_at';
    if (type) q += `&object_type=eq.${type}`;
    if (ws) q += `&workspace_id=eq.${ws}`;
    const rows = await userSelect(env, token, 'object_identifiers', q);

    return json({
      scope,
      value,
      // A list, not a single object. The identifier is unique per (workspace,
      // type) — not globally — so a caller who belongs to two workspaces that
      // both track the same upstream record gets both, and gets to choose.
      matches: (rows || []).map((r) => ({
        object_type: r.object_type,
        object_id: r.object_id,
        board_id: r.board_id,
        workspace_id: r.workspace_id,
        url: r.object_type === 'board'
          ? `/api/v1/boards/${r.board_id}`
          : `/api/v1/boards/${r.board_id}/cards`,
        created_at: r.created_at,
      })),
    });
  }

  // GET /search — the endpoint an assistant needs most: find the board about X
  // without reading every board.
  //
  // Built on `boards` and `card_index` directly, NOT on the entity_search view.
  // That view also unions workspace_user_directory(), which carries member
  // EMAIL ADDRESSES in its body column — searching it with a read-only token
  // would make this an email-harvesting endpoint. (It also types a board's body
  // as jsonb, so ilike on it is wrong anyway.)
  //
  // A picture is also found by what is in it: an image card whose picture a
  // vision model described (0593) carries the description in entity_search's
  // `seen` (0595). That one read goes through the view, held to kind=image (a
  // directory row is kind 'user' and has no `seen`), and comes back as its own
  // list, `pictures`, each with `in_picture`: what the model saw, never shown
  // to people in the app, data for the program reading it.
  if (head === 'search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) throw fail(400, 'bad_request', 'q must be at least 2 characters');
    const { limit, offset } = pageParams(url);
    const ws = url.searchParams.get('workspace');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
    const kind = url.searchParams.get('kind');           // 'board' | 'card' | null
    const wsFilter = ws ? `&workspace_id=eq.${ws}` : '';
    const value = pgLikeValue(q);

    const wantBoards = kind !== 'card';
    const wantCards = kind !== 'board';

    const [boardRows, cardRows, pictureRows] = await Promise.all([
      wantBoards
        ? userSelect(env, token, 'boards',
          `name=ilike.${encodeURIComponent(value)}&deleted_at=is.null${wsFilter}`
          + `&select=id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at`
          + `&order=created_at.desc&limit=${limit + 1}&offset=${offset}`)
        : Promise.resolve([]),
      wantCards
        ? userSelect(env, token, 'card_index',
          `or=${encodeURIComponent(`(title.ilike.${value},body.ilike.${value})`)}${wsFilter}`
          + `&select=board_id,card_id,kind,title,body,workspace_id,updated_at`
          + `&order=updated_at.desc&limit=${limit + 1}&offset=${offset}`)
        : Promise.resolve([]),
      wantCards
        ? userSelect(env, token, 'entity_search',
          `kind=eq.image&seen=ilike.${encodeURIComponent(value)}${wsFilter}`
          + `&select=board_id,card_id,title,seen,workspace_id,updated_at`
          + `&order=updated_at.desc&limit=${limit + 1}&offset=${offset}`)
          // Words still find words when pictures can't be searched.
          .catch(() => [])
        : Promise.resolve([]),
    ]);

    const boards = paginate(boardRows, limit, offset);
    const cards = paginate(cardRows, limit, offset);
    // A picture whose own title or text matched is a card hit already.
    const asCard = new Set(cards.items.map((r) => `${r.board_id}:${r.card_id}`));
    const pictures = paginate(pictureRows, limit, offset);
    pictures.items = pictures.items.filter((r) => !asCard.has(`${r.board_id}:${r.card_id}`));
    // The board each card is on, by name, so a hit says where it is without a
    // second call. One select for the page; a board that can't be read leaves
    // the name null rather than failing the search.
    const onIds = [...new Set([...cards.items, ...pictures.items].map((r) => r.board_id))];
    const boardNames = new Map(onIds.length
      ? (await userSelect(env, token, 'boards',
        `id=in.${encodeURIComponent(pgInList(onIds))}&select=id,name`).catch(() => []) || [])
        .map((b) => [b.id, b.name])
      : []);
    return json({
      query: q,
      // Each hit with a link that opens it in the app this API is served from.
      boards: { ...boards, items: boards.items.map((b) => ({ ...publicBoard(b), url: boardUrl(url.origin, b.id) })) },
      cards: {
        ...cards,
        items: cards.items.map((r) => ({
          board_id: r.board_id,
          board_name: boardNames.get(r.board_id) ?? null,
          card_id: r.card_id,
          kind: r.kind,
          title: r.title ?? null,
          // Enough to recognise a hit, not the whole card. Fetch the board for
          // the rest — a search that returns full bodies is a search that
          // cannot be run against a large workspace.
          excerpt: r.body ? String(r.body).slice(0, 300) : null,
          workspace_id: r.workspace_id,
          updated_at: r.updated_at,
          url: cardUrl(url.origin, r.board_id, r.card_id),
        })),
      },
      pictures: {
        ...pictures,
        items: pictures.items.map((r) => ({
          board_id: r.board_id,
          board_name: boardNames.get(r.board_id) ?? null,
          card_id: r.card_id,
          kind: 'image',
          title: r.title ?? null,
          in_picture: String(r.seen).slice(0, 300),
          workspace_id: r.workspace_id,
          updated_at: r.updated_at,
          url: cardUrl(url.origin, r.board_id, r.card_id),
        })),
      },
    });
  }

  // ── POST /uploads/multipart[/parts|/complete|/abort] ───────────────────────
  //
  // The path for files too big to send in one request — which for a studio is
  // most of them. Four calls, and only the first and last touch this Worker's
  // request budget at all:
  //
  //   1. POST /uploads/multipart?board=…   { bytes, content_type, filename? }
  //        → { key, upload_id, part_size, part_count }
  //   2. POST /uploads/multipart/parts     { key, upload_id, part_numbers[] }
  //        → { urls: { "1": "https://…" } }   PUT the bytes THERE, not here
  //   3. POST /uploads/multipart/complete  { key, upload_id, parts[] }
  //        → { image_key, bytes, width, height }
  //   4. POST /uploads/multipart/abort     { key, upload_id }
  if (head === 'uploads' && id === 'multipart' && method === 'POST') {
    const action = sub || 'create';
    trace.route = `/uploads/multipart${sub ? `/${sub}` : ''}`;

    // Every step re-states its board, and every step re-checks it. The party
    // does the same on its side (can_write_board per call): a signed part URL
    // is a capability, so nothing here may rely on a check made three calls
    // ago against a permission that could since have been revoked.
    const boardId = url.searchParams.get('board') || body.board_id;
    if (!isUuid(boardId)) throw fail(400, 'bad_request', 'board is required and must be a uuid');
    trace.target = boardId;
    const board = await boardForUser(env, token, boardId);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, boardId);

    if (action === 'create') {
      const bytes = Number(body.bytes);
      if (!Number.isFinite(bytes) || bytes <= 0) {
        throw fail(400, 'bad_request', 'bytes is required — the quota gate needs the total size up front');
      }
      const contentType = String(body.content_type || 'application/octet-stream')
        .split(';')[0].trim().toLowerCase();
      // Prefer a real extension over .bin: the app decides how to render a card
      // from it. Content type first, then the filename, then give up.
      const ext = extensionFor(contentType)
        || EXTRA_TYPES[contentType]
        || (String(body.filename || '').match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase()
        || 'bin';

      const out = await partyMpu(env, token, board.workspace_id, 'create', {
        boardId, fileExt: ext, contentType, totalBytes: bytes,
      });
      return json({
        key: out.key,
        upload_id: out.uploadId,
        part_size: out.partSize,
        part_count: out.partCount,
        content_type: contentType,
        next: 'POST /api/v1/uploads/multipart/parts for signed URLs, then PUT each part directly to it',
      }, 201);
    }

    const key = String(body.key || '');
    const uploadId = String(body.upload_id || '');
    if (!key || !uploadId) throw fail(400, 'bad_request', 'key and upload_id are required');

    if (action === 'parts') {
      const wanted = Array.isArray(body.part_numbers) ? body.part_numbers : [];
      const partNumbers = wanted
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000)
        .slice(0, MAX_PARTS_PER_CALL);
      if (!partNumbers.length) {
        throw fail(400, 'bad_request', 'part_numbers must be integers between 1 and 10000');
      }
      const out = await partyMpu(env, token, board.workspace_id, 'sign-parts', {
        boardId, key, uploadId, partNumbers,
      });
      return json({
        urls: out.urls || {},
        // Said plainly because it is the whole point of this route and the
        // thing a client is most likely to get wrong by proxying through us.
        upload_directly_to: 'PUT the part bytes to these URLs; they go straight to storage',
      });
    }

    if (action === 'abort') {
      await partyMpu(env, token, board.workspace_id, 'abort', { boardId, key, uploadId });
      return json({ aborted: true, key });
    }

    if (action !== 'complete') throw fail(404, 'not_found', 'unknown endpoint');

    const parts = (Array.isArray(body.parts) ? body.parts : [])
      .map((p) => ({ partNumber: Number(p.part_number ?? p.partNumber), etag: String(p.etag || '') }))
      .filter((p) => Number.isInteger(p.partNumber) && p.etag);
    if (!parts.length) {
      throw fail(400, 'bad_request', 'parts is required — [{ part_number, etag }] from each PUT response');
    }
    await partyMpu(env, token, board.workspace_id, 'complete', { boardId, key, uploadId, parts });

    // The object exists now, but nothing points at it. The images row is what
    // authorizes reads and what keeps the R2 orphan sweep from reclaiming it,
    // so an upload that stops here is a file that quietly dies in 30 days.
    // Same reasoning as the single-shot path.
    let size = Number(body.bytes) || 0;
    let dims = null;
    if (env.IMAGES) {
      // A ranged read: enough of the header to measure an image, without
      // pulling a 50GB object into a 128MB isolate to find out it is a video.
      const head64 = await env.IMAGES.get(key, { range: { offset: 0, length: 65536 } })
        .catch(() => null);
      if (head64) {
        size = head64.size || size;
        dims = imageDimensions(new Uint8Array(await head64.arrayBuffer())) || null;
      }
    }

    // The file's own name, if the caller says it again here: begin only uses
    // its `filename` for the extension, and nothing carries it between calls.
    // Same rule as a drop in the app (fileIngest.meaningfulFileName).
    const fileName = meaningfulFileName({ name: typeof body.filename === 'string' ? body.filename : '' });
    await userInsert(env, token, 'images', [{
      workspace_id: board.workspace_id,
      board_id: boardId,
      storage_path: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      size_bytes: size || null,
      uploaded_by: auth.userId,
      original_name: fileName,
    }], { returning: 'minimal' });

    return json({
      image_key: key,
      bytes: size || null,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      file_name: fileName,
      next: `POST /api/v1/boards/${boardId}/cards with ${JSON.stringify({ kind: 'image', image_key: key, ...(fileName ? { file_name: fileName } : {}) })}`,
    }, 201);
  }

  // POST /uploads?board=<uuid> — raw bytes in, an image key out.
  //
  // Straight to R2 through the Worker's own binding: no presign, no PartyKit
  // round trip and no new credential, because wrangler.toml already binds this
  // Worker to the same bucket the app uploads into. One call, which is what
  // makes it usable from a tool call rather than a three-step S3 dance.
  if (head === 'uploads' && method === 'POST') {
    const boardId = url.searchParams.get('board');
    if (!isUuid(boardId)) throw fail(400, 'bad_request', 'pass ?board=<uuid> — an upload is charged to a board');
    trace.route = '/uploads';
    trace.target = boardId;

    const board = await boardForUser(env, token, boardId);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, boardId);

    const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = extensionFor(contentType);
    if (!ext) {
      throw fail(415, 'unsupported_media_type',
        'send an image with its Content-Type set (jpeg, png, gif, webp, heic, avif)');
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) throw fail(400, 'bad_request', 'the request body was empty');
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw fail(413, 'payload_too_large',
        `images are limited to ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB through the API`);
    }
    if (!env.IMAGES) throw fail(503, 'storage_unavailable', 'image storage is not available right now');

    // The owner-pays byte ceiling, asked AS THE USER — the same gate the
    // browser upload path runs (party/upload.ts). A null verdict is an RPC
    // failure, and fails open exactly as it does there; the reservation below
    // is what holds the space, and it fails closed.
    const verdictRows = await userRpc(env, token, 'authorize_image_upload',
      { p_board_id: boardId, p_bytes: bytes.length }).catch(() => null);
    const verdict = Array.isArray(verdictRows) ? verdictRows[0] : verdictRows;
    if (verdict && verdict.allow !== true && verdict.reason === 'over_quota') {
      throw fail(402, 'limit_reached', 'that would go past the storage included with this account');
    }

    // Same key shape the rest of the system mints: workspace-prefixed, random,
    // extension from the declared type. The prefix is what scopes storage to a
    // workspace (0218), so it is derived from the board and never from input.
    const key = `${board.workspace_id}/${crypto.randomUUID()}.${ext}`;
    // The space itself is reserved before the bytes are written (0610), so two
    // uploads racing for the last of it can't both land; nothing is written
    // without the reservation.
    const held = await reserveUploadSpace((fn, params) => userRpc(env, token, fn, params),
      { key, bytes: bytes.length, boardId });
    if (held === 'full') throw fail(402, 'limit_reached', 'that would go past the storage included with this account');
    if (held !== 'reserved') throw fail(503, 'storage_unavailable', 'image storage is not available right now');
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });

    const dims = imageDimensions(bytes);
    // ?filename= — the file's own name, kept the way a drop in the app keeps it
    // (fileIngest.meaningfulFileName: a basename, no control characters, and
    // not a name a browser invents for a paste).
    const fileName = meaningfulFileName({ name: url.searchParams.get('filename') || '' });
    try {
      // The images row is LOAD-BEARING, not bookkeeping: it is what authorizes
      // reads, and what keeps the R2 orphan sweep from reclaiming the object.
      // An upload that skips it is an image that quietly dies in 30 days.
      await userInsert(env, token, 'images', [{
        workspace_id: board.workspace_id,
        board_id: boardId,
        storage_path: key,
        width: dims?.width ?? null,
        height: dims?.height ?? null,
        size_bytes: bytes.length,
        uploaded_by: auth.userId,
        original_name: fileName,
      }], { returning: 'minimal' });
    } catch (e) {
      // Without the row the object can never be read and nothing tracks it, so
      // leaving it would be litter that only the sweep clears. Fail the upload
      // rather than hand back a key that will never resolve.
      await env.IMAGES.delete(key).catch(() => {});
      throw e;
    }

    return json({
      image_key: key,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      bytes: bytes.length,
      content_type: contentType,
      file_name: fileName,
      // Spelled out because the next step is not guessable from the key alone.
      // The name rides along so the card keeps it too (list view, downloads).
      next: `POST /api/v1/boards/${boardId}/cards with ${JSON.stringify({ kind: 'image', image_key: key, ...(fileName ? { file_name: fileName } : {}) })}`,
    }, 201);
  }

  // GET /images — what is already stored, so a migration can be resumed.
  //
  // A client that dies at 60% of three million objects has to be able to work
  // out what landed. Without this the only options are re-uploading everything
  // (paying twice, and orphaning the first copy) or trusting a local log that
  // by definition was not written for the requests that failed.
  //
  // KEYSET, not offset. `offset=2900000` makes Postgres walk 2.9M rows to throw
  // them away, so a listing that starts fast ends unusable — exactly the shape
  // of failure that only shows up at the scale this exists for. Pass the last
  // `cursor` back to continue; ordering is (created_at, id) so it is total and
  // stable even when a thousand rows share a timestamp.
  if (head === 'images' && !id && method === 'GET') {
    trace.route = '/images';
    const { limit } = pageParams(url);
    const ws = url.searchParams.get('workspace');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
    const boardFilter = url.searchParams.get('board');
    if (boardFilter && !isUuid(boardFilter)) throw fail(400, 'bad_request', 'board must be a uuid');

    let q = 'deleted_at=is.null'
      + '&select=id,storage_path,size_bytes,width,height,board_id,workspace_id,created_at,original_name'
      + `&order=created_at.asc,id.asc&limit=${limit + 1}`;
    if (ws) q += `&workspace_id=eq.${ws}`;
    if (boardFilter) q += `&board_id=eq.${boardFilter}`;

    // `since` is the coarse filter a caller reaches for first; `cursor` is the
    // exact one that survives ties.
    const since = url.searchParams.get('since');
    if (since) {
      if (Number.isNaN(Date.parse(since))) throw fail(400, 'bad_request', 'since must be an ISO timestamp');
      q += `&created_at=gte.${encodeURIComponent(since)}`;
    }
    const cursor = url.searchParams.get('cursor');
    if (cursor) {
      const [rawAt, cId] = String(cursor).split('|');
      const cAt = readCursorTs(rawAt);
      if (!cAt || Number.isNaN(Date.parse(cAt)) || !isUuid(cId || '')) {
        throw fail(400, 'bad_request', 'cursor is not one this endpoint issued');
      }
      // (created_at, id) > (cAt, cId), spelled as PostgREST understands it.
      q += `&or=${encodeURIComponent(`(created_at.gt.${cAt},and(created_at.eq.${cAt},id.gt.${cId}))`)}`;
    }

    const rows = await userSelect(env, token, 'images', q);
    const page = paginate(rows, limit, 0);
    const last = page.items[page.items.length - 1];
    return json({
      images: page.items.map((r) => ({
        image_key: r.storage_path,
        bytes: r.size_bytes == null ? null : Number(r.size_bytes),
        width: r.width, height: r.height,
        board_id: r.board_id, workspace_id: r.workspace_id,
        created_at: r.created_at,
        // The uploaded file's own name (0355), null for anything uploaded
        // before names were kept and for derived images.
        file_name: r.original_name ?? null,
      })),
      limit,
      has_more: page.has_more,
      next_cursor: page.has_more && last ? `${cursorTs(last.created_at)}|${last.id}` : null,
    });
  }

  // GET /images/<key> — the bytes back.
  //
  // The key contains slashes, so it is taken from the raw path rather than from
  // the split segments. Authorization is a read of the `images` row AS THE USER
  // — the same check /sign-reads makes — so a key they cannot see is "not
  // found" and the route never confirms whether it exists.
  if (head === 'images' && method === 'GET') {
    const prefix = '/api/v1/images/';
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!key) throw fail(400, 'bad_request', 'no image key');
    if (!env.IMAGES) throw fail(503, 'storage_unavailable', 'image storage is not available right now');

    // preview_path comes back on the SAME row, so asking for a smaller
    // rendition costs no extra query and needs no extra authorization: whoever
    // may read the original may read its own downscaled copy.
    const rows = await userSelect(env, token, 'images',
      `storage_path=eq.${encodeURIComponent(key)}&deleted_at=is.null`
      + '&select=storage_path,preview_path,original_name&limit=1');
    if (!rows?.length) throw fail(404, 'not_found', 'image not found');
    const row = rows[0];

    // ?variant=preview asks for the smaller rendition the app generates on
    // upload (~48kB at roughly 900px, against ~470kB for a typical original).
    // It FALLS BACK to the original rather than 404ing, because only about a
    // fifth of the corpus has one and a caller should not have to ask twice —
    // the x-image-variant header says what actually came back.
    //
    // The variants are ordinary images rows of their own (0105 set_image_variant
    // inserts them, retention-locked so the sweep leaves them alone), so this is
    // not reaching around anything: it is serving a key the same person could
    // already fetch directly, having read it off a row they can already see.
    const wantPreview = url.searchParams.get('variant') === 'preview';
    const served = (wantPreview && row.preview_path) ? row.preview_path : row.storage_path;
    const variant = served === row.storage_path ? 'original' : 'preview';

    // The one read worth an audit row: this is bytes leaving, and "who took a
    // copy of unreleased material, and when" is the question a studio's
    // security review actually asks.
    trace.route = '/images/:key';
    trace.log = true;

    const obj = await env.IMAGES.get(served);
    if (!obj) throw fail(404, 'not_found', 'image not found');
    return new Response(obj.body, {
      headers: {
        ...CORS,
        'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'content-length': String(obj.size),
        // Which rendition this actually is, so a caller that asked for a
        // preview and got the original knows why it is large.
        'x-image-variant': variant,
        // private: this is someone's own picture behind their own credential,
        // and it must not land in a shared cache.
        'cache-control': 'private, max-age=300',
        // The file's own name, for the original only — a preview is a derived
        // image and has none. RFC 6266: an ASCII fallback plus the exact UTF-8.
        ...(variant === 'original' && row.original_name
          ? { 'content-disposition': contentDisposition(row.original_name) }
          : {}),
      },
    });
  }

  // GET /tags/:id?limit= — a tag, and everything carrying it across its
  // workspace's clusters, the most recently tagged first (get_things_tagged,
  // 0590, the tag page's own read). The tag is the workspace's: someone
  // outside it gets a 404, as the tags table answers them nothing.
  if (head === 'tags') {
    trace.route = '/tags/:id';
    if (!id || sub) throw fail(404, 'not_found', 'unknown endpoint');
    if (method !== 'GET') throw fail(405, 'method_not_allowed', `${method} is not supported here`);
    if (!isUuid(id)) throw fail(400, 'bad_request', 'tag id must be a uuid');
    trace.target = id;
    const [tag] = await userSelect(env, token, 'tags',
      `id=eq.${id}&status=neq.deleted&deleted_at=is.null&select=${TAG_FIELDS},workspace_id`);
    if (!tag) throw fail(404, 'not_found', 'no tag in a workspace of yours has that id');
    const raw = Number(url.searchParams.get('limit'));
    const limit = Math.max(1, Math.min(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : TAGS.defaultItems,
      TAGS.maxItems));
    // The function stops after p_limit applications and then drops any whose
    // thing is gone (a deleted card keeps its link), so it is asked for twice
    // the page: "more" is then wrong only where most of a tag's things are gone.
    const rows = (await userRpc(env, token, 'get_things_tagged', { p_tag_id: id, p_limit: limit * 2 + 1 })) || [];
    return json({
      tag: { ...publicTag(tag), workspace_id: tag.workspace_id },
      items: rows.slice(0, limit).map((r) => taggedItem(r, url.origin)),
      has_more: rows.length > limit,
    });
  }

  if (head !== 'boards') throw fail(404, 'not_found', 'unknown endpoint');

  // ── /boards ────────────────────────────────────────────────────────────────
  if (!id) {
    trace.route = '/boards';
    if (method === 'GET') {
      const { limit, offset } = pageParams(url);
      const include = parseInclude(url, ['props', 'identifiers']);
      const ws = url.searchParams.get('workspace');
      const parent = url.searchParams.get('parent');
      // `1` or `true` lists ONLY soft-deleted boards (the Trash). The docs once
      // called this "include deleted" and showed `deleted=`, which silently
      // returned live boards only.
      const deleted = ['1', 'true'].includes((url.searchParams.get('deleted') || '').toLowerCase());
      const since = url.searchParams.get('since');
      const cursor = url.searchParams.get('cursor');

      // Two modes, and which one you are in is decided by whether you asked a
      // delta question.
      //
      // Default is unchanged: created_at ascending, offset paged. Pass `since`
      // or `cursor` and it becomes a CHANGE FEED — updated_at ascending, keyset
      // paged — because a synchroniser asking "what moved" wants them in the
      // order they moved, and offset paging over a set that is being written to
      // skips and repeats rows.
      const delta = !!(since || cursor);
      const selectCols = 'id,name,workspace_id,parent_board_id,view,created_at,updated_at,deleted_at';
      // A change feed has to report deletions, or a synchroniser keeps every
      // board that was ever trashed: soft_delete_board bumps updated_at, so in
      // delta mode a trashed board arrives as a row with `deleted: true`.
      let q = (deleted ? 'deleted_at=not.is.null&' : delta ? '' : 'deleted_at=is.null&')
            + `select=${selectCols}&limit=${limit + 1}`;

      if (delta) {
        q += '&order=updated_at.asc,id.asc';
        if (since) {
          if (Number.isNaN(Date.parse(since))) {
            throw fail(400, 'bad_request', 'since must be an ISO timestamp');
          }
          q += `&updated_at=gte.${encodeURIComponent(since)}`;
        }
        if (cursor) {
          const [rawTs, cid] = String(cursor).split('|');
          const ts = readCursorTs(rawTs);
          if (!ts || !cid || Number.isNaN(Date.parse(ts))) {
            throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
          }
          // Strictly after (ts, id): the equal-timestamp tail is why the id is
          // part of the cursor at all. Two boards touched in the same
          // transaction share a timestamp, and `gt` on the timestamp alone
          // would drop whichever came second.
          q += `&or=(updated_at.gt.${encodeURIComponent(ts)},`
             + `and(updated_at.eq.${encodeURIComponent(ts)},id.gt.${encodeURIComponent(cid)}))`;
        }
      } else {
        q += `&order=created_at.asc&offset=${offset}`;
      }

      if (ws) {
        if (!isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');
        q += `&workspace_id=eq.${ws}`;
      }
      if (parent === 'root') q += '&parent_board_id=is.null';
      else if (parent) {
        if (!isUuid(parent)) throw fail(400, 'bad_request', 'parent must be a uuid or "root"');
        q += `&parent_board_id=eq.${parent}`;
      }

      const rows = await userSelect(env, token, 'boards', q);
      const page = paginate(rows, limit, offset);
      // Each with the link that opens it in the app, except a deleted board,
      // which no link opens until it is restored.
      const boards = (await decorateBoards(env, token, page.items, include))
        .map((b) => ({ ...b, url: b.deleted ? null : boardUrl(url.origin, b.id) }));
      if (!delta) return json({ boards, ...pageMeta(page) });
      const last = page.items[page.items.length - 1];
      return json({
        boards,
        limit,
        has_more: page.has_more,
        next_cursor: page.has_more && last ? `${cursorTs(last.updated_at)}|${last.id}` : null,
      });
    }

    if (method === 'POST' && Array.isArray(body.boards)) {
      // Bulk create. A 25TB library is a board TREE — a board per scene, reel
      // or shoot — so a migration's first act is making thousands of them, and
      // one round trip each is the slowest possible way to do it. Two inserts
      // total, whatever the count.
      const incoming = body.boards;
      if (!incoming.length) throw fail(400, 'bad_request', 'boards is empty');
      if (incoming.length > MAX_BOARDS_PER_CALL) {
        throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
      }

      let defaultWs = body.workspace_id;
      if (defaultWs && !isUuid(defaultWs)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      if (!defaultWs) {
        const ws = await userRpc(env, token, 'get_or_create_personal_workspace',
          { p_user_id: auth.userId, p_name: 'Personal' });
        defaultWs = (Array.isArray(ws) ? ws[0] : ws)?.id;
      }
      if (!defaultWs) throw fail(400, 'bad_request', 'could not resolve a workspace');

      // Validated in full BEFORE anything is written, so a bad entry at index
      // 900 is a clean 400 rather than 900 boards and an error.
      const prepared = incoming.map((b, i) => {
        const nm = String(b?.name || '').trim();
        if (!nm) throw fail(400, 'bad_request', `boards[${i}].name is required`);
        const ws = b.workspace_id || defaultWs;
        if (!isUuid(ws)) throw fail(400, 'bad_request', `boards[${i}].workspace_id must be a uuid`);
        if (b.parent_board_id && !isUuid(b.parent_board_id)) {
          throw fail(400, 'bad_request', `boards[${i}].parent_board_id must be a uuid`);
        }
        let meta;
        try {
          meta = metaFromBody(b);
        } catch (e) {
          e.message = `boards[${i}]: ${e.message}`;
          throw e;
        }
        try {
          refuseScheduleFields(b);
        } catch (e) {
          e.message = `boards[${i}]: ${e.message}`;
          throw e;
        }
        return {
          id: crypto.randomUUID(),
          workspace_id: ws,
          parent_board_id: b.parent_board_id || null,
          name: nm.slice(0, 200),
          view: b.view === 'list' ? 'list' : 'canvas',
          created_by: auth.userId,
          // Whether the caller SAID where this board goes. Omitting the field on
          // a re-run means "leave it where it is", not "move it to the top".
          _parentGiven: Object.prototype.hasOwnProperty.call(b, 'parent_board_id'),
          _props: meta.props,
          _identifiers: meta.identifiers,
        };
      });

      // on_conflict: "identifier" — the difference between an import you can run
      // twice and one you can run once. Without it a re-run creates a second
      // copy of everything, which is why every synchroniser that has to work
      // this way ends up maintaining its own id map instead.
      const upsert = body.on_conflict === 'identifier';
      let existingFor = prepared.map(() => null);
      if (upsert) {
        const byWs = new Map();
        for (const b of prepared) {
          if (!b._identifiers?.length) continue;
          if (!byWs.has(b.workspace_id)) byWs.set(b.workspace_id, []);
          byWs.get(b.workspace_id).push(...b._identifiers);
        }
        const matches = new Map();
        for (const [wsId, idents] of byWs) {
          const found = await matchIdentifiers(env, token,
            { workspaceId: wsId, objectType: 'board', identifiers: idents });
          for (const [k, v] of found) matches.set(k, v);
        }
        existingFor = resolveUpsert(
          prepared.map((b) => ({ identifiers: b._identifiers })),
          matches, { objectType: 'board' },
        ).map((r) => r.existing);
      }

      const creates = [];
      const updates = [];
      prepared.forEach((b, i) => {
        const hit = existingFor[i];
        if (hit) {
          // Keep the EXISTING id. That is the point — the caller's downstream
          // references, and its own record of what it created last time, stay
          // valid across runs.
          b.id = hit.board_id;
          b._target = b.parent_board_id;
          updates.push(b);
        } else {
          creates.push(b);
        }
      });

      const now = new Date().toISOString();
      const saveMetaFor = async (list) => {
        // Grouped by workspace because that is what the rows are keyed on.
        for (const wsId of new Set(list.map((b) => b.workspace_id))) {
          const entries = list
            .filter((b) => b.workspace_id === wsId)
            .map((b) => ({ objectId: b.id, boardId: b.id, props: b._props, identifiers: b._identifiers }));
          await saveMetaBulk(env, token, {
            workspaceId: wsId, objectType: 'board', entries, userId: auth.userId,
          });
        }
      };
      if (creates.length) {
        // RLS still decides: one INSERT as the user, so a workspace they cannot
        // write is refused for the whole batch rather than partly applied.
        await userInsert(env, token, 'boards',
          creates.map(({ _props, _identifiers, _parentGiven, ...row }) => row),
          { returning: 'minimal' });

        // Every board needs its empty snapshot or it cold-loads as broken
        // rather than as empty. Identical bytes for all, so encode once.
        const doc = new Y.Doc();
        const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
        doc.destroy();
        await userInsert(env, token, 'board_state',
          creates.map((b) => ({ board_id: b.id, doc: b64, updated_at: now })),
          { returning: 'minimal' });
      }
      // The new boards' identifiers go on BEFORE anything below can fail. If
      // they did not, a failure further down left boards with no identifiers,
      // which the next run cannot match — so it created them again, and failed
      // again, duplicating the batch on every retry.
      await saveMetaFor(creates);

      if (updates.length) {
        // A PATCH of name and view per matched board — the two columns the
        // client UPDATE grant covers. This used to be an INSERT … ON CONFLICT
        // (id) DO UPDATE, which sets EVERY supplied column including id and
        // workspace_id; with no UPDATE grant on those, any batch that matched
        // an existing board failed with a permission error. created_by is
        // deliberately absent so a re-run does not rewrite who made the board.
        const refused = [];
        await mapWithConcurrency(updates, 8, async (b) => {
          // No deleted_at filter: a match in the Trash was updated by the old
          // upsert too, and filtering it would report it as a refusal.
          const rows = await userPatch(env, token, 'boards',
            `id=eq.${b.id}`, { name: b.name, view: b.view });
          // RLS turns an update it refuses into zero rows, not an error.
          if (!Array.isArray(rows) || !rows.length) refused.push(b.id);
          else {
            b.parent_board_id = rows[0].parent_board_id ?? null;
            b.deleted_at = rows[0].deleted_at ?? null;
          }
        });
        if (refused.length) {
          throw fail(403, 'forbidden',
            `you cannot change board ${refused[0]}${refused.length > 1 ? ` (and ${refused.length - 1} more)` : ''}`);
        }

        // Reparenting goes through move_boards_under and nowhere else, as on
        // PATCH /boards/:id — and only where the caller named a parent. One
        // call per destination. A match in the Trash is left where it is:
        // move_boards_under skips it as 'missing', which would fail the batch
        // after the renames and creates had landed, and restore_board puts it
        // back under its nearest live ancestor anyway.
        const byTarget = new Map();
        for (const b of updates) {
          if (!b._parentGiven || b.deleted_at) continue;
          const target = b._target ?? null;
          if (!byTarget.has(target)) byTarget.set(target, []);
          byTarget.get(target).push(b);
        }
        for (const [target, list] of byTarget) {
          const out = await userRpc(env, token, 'move_boards_under',
            { p_child_ids: list.map((b) => b.id), p_target_id: target });
          const skipped = (out?.skipped || []).filter((x) => x?.reason !== 'same-parent');
          if (skipped.length) {
            throw fail(409, 'conflict', `could not reparent board ${skipped[0].id}: ${skipped[0].reason}`);
          }
          for (const b of list) b.parent_board_id = target;
        }

        await saveMetaFor(updates);
      }

      const createdIds = new Set(creates.map((b) => b.id));
      return json({
        boards: prepared.map((b) => ({
          ...publicBoard({ ...b, created_at: now }),
          created: createdIds.has(b.id),
          url: boardUrl(url.origin, b.id),
        })),
        created: creates.length,
        updated: updates.length,
      }, 201);
    }

    if (method === 'POST') {
      const name = String(body.name || '').trim();
      if (!name) throw fail(400, 'bad_request', 'name is required');
      refuseScheduleFields(body);
      let workspaceId = body.workspace_id;
      if (workspaceId && !isUuid(workspaceId)) throw fail(400, 'bad_request', 'workspace_id must be a uuid');
      if (!workspaceId) {
        const ws = await userRpc(env, token, 'get_or_create_personal_workspace',
          { p_user_id: auth.userId, p_name: 'Personal' });
        workspaceId = (Array.isArray(ws) ? ws[0] : ws)?.id;
      }
      if (!workspaceId) throw fail(400, 'bad_request', 'could not resolve a workspace');
      if (body.parent_board_id && !isUuid(body.parent_board_id)) {
        throw fail(400, 'bad_request', 'parent_board_id must be a uuid');
      }
      const meta = metaFromBody(body);

      // Same create-or-update rule as the bulk form, so a caller does not have
      // to switch shapes to get the behaviour.
      let existing = null;
      if (body.on_conflict === 'identifier' && meta.identifiers?.length) {
        const matches = await matchIdentifiers(env, token, {
          workspaceId, objectType: 'board', identifiers: meta.identifiers,
        });
        existing = resolveUpsert([{ identifiers: meta.identifiers }], matches,
          { objectType: 'board' })[0].existing;
      }

      // The id is generated HERE rather than by the database, for the reason
      // boardsApi.js:684 documents: INSERT…RETURNING re-runs the boards SELECT
      // policy, which cannot see the row it is inserting, so Postgres reports a
      // misleading RLS violation for an insert it actually allowed.
      const boardId = existing ? existing.board_id : crypto.randomUUID();
      trace.target = boardId;

      if (existing) {
        const rows = await userPatch(env, token, 'boards', `id=eq.${boardId}`, {
          name: name.slice(0, 200),
          view: body.view === 'list' ? 'list' : 'canvas',
        });
        // RLS answers an update it refuses with zero rows, not an error.
        if (!Array.isArray(rows) || !rows.length) {
          throw fail(403, 'forbidden', 'you cannot change that board');
        }
      } else {
        await userInsert(env, token, 'boards', [{
          id: boardId,
          workspace_id: workspaceId,
          parent_board_id: body.parent_board_id || null,
          name: name.slice(0, 200),
          view: body.view === 'list' ? 'list' : 'canvas',
          created_by: auth.userId,
        }], { returning: 'minimal' });

        // Seed the empty snapshot, exactly as createBoard does — a board with
        // no board_state row loads as broken rather than as empty.
        const doc = new Y.Doc();
        const b64 = bytesToB64(Y.encodeStateAsUpdate(doc));
        doc.destroy();
        await userInsert(env, token, 'board_state',
          [{ board_id: boardId, doc: b64, updated_at: new Date().toISOString() }],
          { returning: 'minimal' });
      }

      await saveMeta(env, token, {
        workspaceId, boardId, objectType: 'board', objectId: boardId,
        props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
      });

      const created = await boardForUser(env, token, boardId);
      return json({
        board: publicBoard(created || { id: boardId, name, workspace_id: workspaceId }),
        created: !existing,
        url: boardUrl(url.origin, boardId),
      }, existing ? 200 : 201);
    }

    // DELETE /boards — bulk soft-delete
    if (method === 'DELETE') {
      const ids = (Array.isArray(body.board_ids) ? body.board_ids : []).map(String).filter(Boolean);
      if (!ids.length) throw fail(400, 'bad_request', 'board_ids is required');
      if (ids.length > MAX_BOARDS_PER_CALL) {
        throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
      }
      const bad = ids.filter((b) => !isUuid(b));
      if (bad.length) throw fail(400, 'bad_request', `board_ids must be uuids — got ${bad[0]}`);

      // One RPC per board, as the single delete does. soft_delete_board is the
      // app's own path and going around it would leave the Trash and restore
      // working on something this had already changed differently.
      const deleted = [];
      const failed = [];
      for (const bid of ids) {
        try {
          await userRpc(env, token, 'soft_delete_board', { p_board_id: bid });
          deleted.push(bid);
        } catch (_) {
          failed.push(bid);
        }
      }
      return json({
        deleted: deleted.length,
        board_ids: deleted,
        failed,
        restorable: true,
        restore_with: 'POST /api/v1/boards/:id/restore',
      });
    }

    throw fail(405, 'method_not_allowed', 'method not allowed');
  }

  // POST /boards/move — bulk reparent
  //
  // move_boards_under has always taken a uuid[]; this API had only ever passed
  // it a single-element array. It is the ONLY write path for parent_board_id
  // (0118) and the only thing that checks for cycles, so restructuring a show
  // tree goes through it, in one call, with per-board reasons for anything it
  // refused rather than one opaque failure for the batch.
  if (id === 'move' && method === 'POST') {
    trace.route = '/boards/move';
    const ids = (Array.isArray(body.board_ids) ? body.board_ids : []).map(String).filter(Boolean);
    if (!ids.length) throw fail(400, 'bad_request', 'board_ids is required');
    if (ids.length > MAX_BOARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_BOARDS_PER_CALL} boards per call`);
    }
    const bad = ids.filter((b) => !isUuid(b));
    if (bad.length) throw fail(400, 'bad_request', `board_ids must be uuids — got ${bad[0]}`);
    const target = body.parent_board_id ?? null;
    if (target && !isUuid(target)) {
      throw fail(400, 'bad_request', 'parent_board_id must be a uuid or null');
    }

    const out = await userRpc(env, token, 'move_boards_under',
      { p_child_ids: ids, p_target_id: target });
    return json({
      moved: (out?.moved || []).length,
      board_ids: out?.moved || [],
      // Named reasons — missing, self, no-write, cross-workspace, same-parent,
      // cycle — because "it did not work" is not something a caller can act on.
      skipped: out?.skipped || [],
      parent_board_id: target,
    });
  }

  // GET /boards/tree?root=&workspace=&depth=
  //
  // The hierarchy in ONE call. GET /boards?parent= returns a single level, so
  // walking a show's structure — title → department → sequence → shot — costs a
  // request per node, and the first thing any integration does is walk the
  // structure. Backed by a recursive CTE that checks authorization once at the
  // root, because can_read_board grants on any readable ancestor: everything
  // beneath a board you can read is a board you can read, and asking per row
  // would make it quadratic for no added safety.
  if (id === 'tree' && method === 'GET') {
    trace.route = '/boards/tree';
    const root = url.searchParams.get('root');
    const ws = url.searchParams.get('workspace');
    const depth = Number(url.searchParams.get('depth'));
    if (!root && !ws) throw fail(400, 'bad_request', 'pass root (a board id) or workspace');
    if (root && !isUuid(root)) throw fail(400, 'bad_request', 'root must be a uuid');
    if (ws && !isUuid(ws)) throw fail(400, 'bad_request', 'workspace must be a uuid');

    const rows = await userRpc(env, token, 'board_tree', {
      p_root: root || null,
      p_workspace: ws || null,
      p_depth: Number.isFinite(depth) ? Math.round(depth) : 10,
    });
    return json({
      root: root || null,
      workspace_id: ws || null,
      boards: (rows || []).map((b) => ({
        id: b.id,
        parent_board_id: b.parent_board_id,
        name: b.name,
        view: b.view,
        workspace_id: b.workspace_id,
        depth: b.depth,
        card_count: b.card_count,
        created_at: b.created_at,
        updated_at: b.updated_at,
        deleted: !!b.deleted,
        url: b.deleted ? null : boardUrl(url.origin, b.id),
      })),
      count: (rows || []).length,
    });
  }

  if (!isUuid(id)) throw fail(400, 'bad_request', 'board id must be a uuid');
  trace.target = id;

  // ── /boards/:id ────────────────────────────────────────────────────────────
  if (!sub) {
    trace.route = '/boards/:id';
    if (method === 'GET') {
      const include = parseInclude(url, ['props', 'identifiers']);
      const b = await boardForUser(env, token, id, { includeDeleted: true });
      if (!b) throw fail(404, 'not_found', 'board not found');
      // Capacity comes back with the board so a caller learns it is near the
      // cap BEFORE a write fails with a 402 it has to interpret.
      const capRows = await userRpc(env, token, 'get_board_capacity', { p_board_id: id }).catch(() => null);
      const cap = Array.isArray(capRows) ? capRows[0] : capRows;
      // `is_capped` is the gate, NOT the number. An uncapped (paid) owner comes
      // back as (false, 0, 0) — see the header of migration 0216 — so reading
      // the zeros literally reports `remaining: 0` to a client that has no
      // limit at all, which reads as "you are full" and is the exact confusion
      // 0216 chose that shape to avoid. null means "no ceiling", and only a
      // capped owner gets numbers.
      const uncapped = !cap || cap.is_capped !== true;
      return json({
        board: (await decorateBoards(env, token, [b], include))[0],
        capacity: cap ? {
          used: uncapped ? 0 : Number(cap.used ?? 0),
          cap: uncapped || cap.cap == null ? null : Number(cap.cap),
          remaining: uncapped || cap.cap == null
            ? null
            : Math.max(0, Number(cap.cap) - Number(cap.used ?? 0)),
          capped: !!cap.is_capped,
        } : null,
        // Opens the board in the app this API is served from.
        url: boardUrl(url.origin, id),
      });
    }

    if (method === 'PATCH') {
      const b = await boardForUser(env, token, id);
      if (!b) throw fail(404, 'not_found', 'board not found');
      refuseScheduleFields(body);

      // Reparenting goes through move_boards_under and NOWHERE else. It is the
      // single authoritative write path for parent_board_id (0118) and the only
      // thing that checks for cycles — a board made its own ancestor detaches
      // that whole subtree from every view in the app.
      if ('parent_board_id' in body) {
        const target = body.parent_board_id;
        if (target && !isUuid(target)) throw fail(400, 'bad_request', 'parent_board_id must be a uuid or null');
        const out = await userRpc(env, token, 'move_boards_under',
          { p_child_ids: [id], p_target_id: target || null });
        const skipped = out?.skipped?.[0];
        if (skipped) throw fail(409, 'conflict', `could not reparent: ${skipped.reason}`);
      }

      const patch = {};
      if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
      if (body.view === 'list' || body.view === 'canvas') patch.view = body.view;
      if (Object.keys(patch).length) {
        // A refused UPDATE is not an error to PostgREST: RLS filters the row
        // out and the PATCH matches nothing. Reading the representation is the
        // only way to tell, and without it a viewer's rename answered 200 with
        // the old name, so a script or an agent reported a change that never
        // happened.
        const rows = await userPatch(env, token, 'boards', `id=eq.${id}`, patch);
        if (!Array.isArray(rows) || !rows.length) {
          throw fail(403, 'forbidden', 'you cannot rename this board');
        }
      }

      const meta = metaFromBody(body);
      await saveMeta(env, token, {
        workspaceId: b.workspace_id, boardId: id, objectType: 'board', objectId: id,
        props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
      });

      const after = await boardForUser(env, token, id);
      const include = parseInclude(url, ['props', 'identifiers']);
      return json({ board: (await decorateBoards(env, token, [after], include))[0] });
    }

    if (method === 'DELETE') {
      const b = await boardForUser(env, token, id);
      if (!b) throw fail(404, 'not_found', 'board not found');
      // SOFT delete, through the app's own soft_delete_board — not a hand-written
      // UPDATE. An API that destroys someone's board harder, or differently,
      // than their own UI does is a trap; going through the same RPC means the
      // Trash and restore paths keep working on whatever this leaves behind.
      //
      // Like the app, this trashes the board together with every board inside
      // it, as one batch that POST /boards/:id/restore brings back (0396).
      await userRpc(env, token, 'soft_delete_board', { p_board_id: id });
      return json({
        deleted: true,
        board: publicBoard(b),
        restorable: true,
        restore_with: `POST /api/v1/boards/${id}/restore`,
      });
    }

    throw fail(405, 'method_not_allowed', 'method not allowed');
  }

  // POST /boards/:id/restore — the other half of DELETE. Promising "restorable"
  // and then offering no way to do it from here made the claim true only if you
  // also had a browser open.
  if (sub === 'restore' && method === 'POST') {
    trace.route = '/boards/:id/restore';
    const b = await boardForUser(env, token, id, { includeDeleted: true });
    if (!b) throw fail(404, 'not_found', 'board not found');
    await userRpc(env, token, 'restore_board', { p_board_id: id });
    const after = await boardForUser(env, token, id, { includeDeleted: true });
    return json({ restored: true, board: publicBoard(after || b), url: boardUrl(url.origin, id) });
  }

  // GET /boards/:id/export?format=json|omc
  //
  // There was no way to get a board out. The card read is a 12-field projection
  // and every kind the API cannot create — grid, palette, schedule — read back
  // with its interior missing, so "export" meant "lose the parts we do not
  // model". That is a bad answer for a backup and a worse one for an archive.
  //
  // `json` is everything, verbatim. `omc` is MovieLabs OMC-JSON: the format a
  // studio's own standards body defined for exactly this, and the one thing in
  // this API that will still mean something to somebody in ten years.
  // POST /boards/:id/import — bring reference in from wherever it lives now.
  //
  // The gap this closes is the first one a studio hits. Everything else in this
  // API assumes the material is already here; there was no import path at all,
  // so evaluating this product meant re-uploading a decade of reference by hand.
  //
  // It is RE-RUNNABLE by construction: every item is stamped with a `source_url`
  // identifier and the create is resolved on it, so running the same manifest
  // twice updates rather than duplicates. That falls out of object_identifiers,
  // which already had the unique index — nothing new was needed for it.
  //
  // Partially fallible on purpose. A dead link in a ninety-nine item manifest
  // must not fail the other ninety-eight, so every item reports its own outcome
  // and the envelope counts them.
  if (sub === 'import' && method === 'POST') {
    trace.route = '/boards/:id/import';
    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, id);
    if (!env.IMAGES) throw fail(503, 'storage_unavailable', 'image storage is not available right now');

    // Throws on a manifest that is structurally wrong — including one internal
    // address — before a single byte is fetched.
    const items = normalizeImportItems(body.items);

    // A dry run answers "would this manifest work" without fetching anything,
    // which is what you want before pointing a hundred-item import at a board.
    if (body.dry_run === true) {
      return json({
        board_id: id,
        dry_run: true,
        items: items.map((it) => ({ url: it.url, ok: true })),
        note: `${items.length} sources look importable; nothing was fetched or created`,
      });
    }

    const importedAt = new Date().toISOString();

    // Fetch and store. Bounded concurrency: a hundred sockets at once is how a
    // Worker runs out of subrequests halfway through somebody's migration.
    const fetched = await mapWithConcurrency(items, IMPORT_CONCURRENCY,
      (item) => importItem(env, token, auth.userId, board, item));

    const usable = fetched.filter((r) => r.ok);
    let cards = [];
    let created = 0;
    let updated = 0;

    if (usable.length) {
      // Cards are created through the ORDINARY route, not a second
      // implementation of card creation. That is what keeps an imported card
      // from being a different kind of card: the same normalization, the same
      // cap trigger, the same webhook, the same upsert-on-identifier.
      const specs = usable.map((r) => cardSpecFor(r.item, {
        kind: r.kind, stored: r.stored, importedAt,
      }));
      // Justified by default: an import is almost always photographs, and the
      // uniform-grid fallback leaves a hole around every portrait frame. An
      // import into sections is placed as an add naming them is: a new section
      // laid out as `auto` lays one out, under what is there, and pictures for
      // a section the board has beside its cards.
      const sectioned = usable.some((r) => r.item.group);
      const importLayout = body.layout === null ? null : (body.layout || (sectioned ? null : DEFAULT_LAYOUT));
      if (importLayout !== null && !isApiLayout(importLayout)) throw fail(400, 'bad_request', layoutRefusal(importLayout));
      const res = await internalCall(url, env, ctx, { auth, token }, `/boards/${id}/cards`, {
        method: 'POST',
        body: {
          cards: specs,
          on_conflict: 'identifier',
          ...(importLayout ? { layout: importLayout } : {}),
          ...(Number.isFinite(body.gap) ? { gap: body.gap } : {}),
          ...(Number.isFinite(body.width) ? { width: body.width } : {}),
          ...(Number.isFinite(body.row_height) ? { row_height: body.row_height } : {}),
          ...(Number.isFinite(body.columns) ? { columns: body.columns } : {}),
        },
      });
      cards = res?.cards || [];
      created = res?.created ?? 0;
      updated = res?.updated ?? 0;
    }

    // Pair each returned card with the item that produced it — but only when
    // the counts agree. A positional guess that is off by one would attribute
    // every card to the wrong source url, which is worse than saying nothing.
    const aligned = cards.length === usable.length;

    // Provenance, written by the server after the cards exist.
    //
    // It cannot ride on the card spec: these keys are under the reserved
    // prefix, and the ordinary card route refuses reserved keys from callers —
    // which is precisely what reserving them is for. So they are merged in
    // here, on the one path allowed to set them, and a caller therefore has no
    // way to make an import misreport where a card came from.
    if (aligned && cards.length) {
      await saveMetaBulk(env, token, {
        workspaceId: board.workspace_id, boardId: id, objectType: 'card',
        userId: auth.userId,
        entries: usable.map((r, n) => (cards[n]
          ? { objectId: cards[n].id, props: provenanceProps(r.item, importedAt) }
          : null)).filter(Boolean),
      });
    }

    return json({
      board_id: id,
      imported: created,
      updated,
      failed: fetched.length - usable.length,
      items: fetched.map((r, i) => ({
        url: r.item.url,
        ok: r.ok,
        ...(r.ok ? { kind: r.kind } : { error: r.error, code: r.code }),
        ...(r.note ? { note: r.note } : {}),
        ...(r.ok && aligned ? { card_id: cards[usable.indexOf(r)]?.id ?? null } : {}),
      })),
      // Said plainly because it is the property that makes an import usable.
      next: 'Re-running this manifest updates the same cards rather than duplicating them — '
        + `each carries a "${SOURCE_SCOPE}" identifier you can also look up with GET /resolve.`,
    }, 201);
  }

  // /boards/:id/arrange — lay out cards that already exist.
  //
  // Layout used to be a side effect: omit x and y on a write and the batch got
  // packed. There was no way to ASK for one, and no way to tidy a board that
  // was already a mess. This is that operation, by name; `auto` unless another
  // is named (lib/layoutAuto.js).
  //
  // The block is re-anchored on its own current top-left rather than migrating
  // to the bottom of the board, and is pushed clear of the cards it is NOT
  // moving — tidying ten cards must not bury the other forty.
  if (sub === 'arrange' && method === 'POST') {
    trace.route = '/boards/:id/arrange';
    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, id);

    const layout = body.layout || AUTO_LAYOUT;
    if (!isApiLayout(layout)) throw fail(400, 'bad_request', layoutRefusal(body.layout));
    const order = orderFrom(body.order);

    const read = await readBoardCards(env, id, token);
    const requested = Array.isArray(body.card_ids) ? body.card_ids.map(String).filter(Boolean) : null;
    const targetIds = requested ?? read.map((c) => String(c.id));
    if (!targetIds.length) throw fail(400, 'bad_request', 'there is nothing on this board to arrange');
    if (targetIds.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per arrange — got ${targetIds.length}`);
    }
    const known = new Set(read.map((c) => String(c.id)));
    const notFound = targetIds.filter((c) => !known.has(c));
    const target = new Set(targetIds);

    // Notes the API wrote before a note showed what it was written with are
    // brought up to date first (noteRepair), so each is laid out at the size its
    // text needs; and pictures are laid out at their true shape, from their
    // images rows, where the layout sizes them (auto and justified).
    const repairs = new Map();
    const shapes = layout === AUTO_LAYOUT || layout === 'justified'
      ? await imageDims(env, token, read.filter((c) => target.has(String(c.id)) && c.kind === 'image')
        .map((c) => keyFromSrc(c.src)))
      : new Map();
    const all = read.map((c) => {
      if (!target.has(String(c.id))) return c;
      const fix = noteRepair(c);
      if (fix) repairs.set(String(c.id), { fix, html: c.html ?? null });
      const d = c.kind === 'image' ? shapes.get(keyFromSrc(c.src)) : null;
      const aspect = d ? d.width / d.height : null;
      if (!fix && !aspect) return c;
      const out = { ...c, ...fix };
      if (aspect) {
        out.aspect = aspect;
        if (Number.isFinite(out.w) && out.w > 0) out.h = Math.max(1, Math.round(out.w / aspect));
      }
      return out;
    });

    const knobs = {
      layout,
      ...(Number.isFinite(body.gap) ? { gap: body.gap } : {}),
      ...(Number.isFinite(body.width) ? { width: body.width } : {}),
      ...(Number.isFinite(body.row_height) ? { rowHeight: body.row_height } : {}),
      ...(Number.isFinite(body.columns) ? { columns: body.columns } : {}),
    };
    // Which of auto's arrangements the board got (lib/layoutAuto.js
    // ARRANGEMENTS), so a caller can say how it was laid out.
    let arrangement = null;
    const placed = (layout === AUTO_LAYOUT
      ? rearrangeAuto(all, targetIds, { ...knobs, order, onArrangement: (a) => { arrangement = a; } })
      : rearrange(cardsInOrder(all, order), targetIds, knobs)
    ).map(({ aspect: _shape, ...c }) => c);

    const box = blockBounds(placed);
    const told = {
      ...(arrangement ? { arrangement } : {}),
      sections: new Set(placed.map((c) => c.groupId).filter(Boolean)).size,
      ...(box ? { bounds: { x: box.x, y: box.y, w: box.w, h: box.h } } : {}),
    };

    // A dry run computes the whole layout and writes nothing, so an agent can
    // look at where things would land — and compare two layouts — before
    // moving anybody's board.
    if (body.dry_run === true) {
      return json({
        board_id: id,
        layout,
        dry_run: true,
        arranged: placed.length,
        repaired: placed.filter((c) => repairs.has(String(c.id))).length,
        ...told,
        not_found: notFound,
        cards: placed.map(publicCard),
      });
    }

    // A note brought up to date only while it is as it was read: one opened,
    // edited or sized by hand in the meantime keeps its text and is only moved.
    const repaired = new Set();
    const updated = await updateCardsOnBoard(env, {
      boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
      patches: placed.map((c) => {
        const geometry = { x: c.x, y: c.y, w: c.w, h: c.h };
        const was = repairs.get(String(c.id));
        if (!was) return { cardId: c.id, patch: geometry };
        return {
          cardId: c.id,
          patch: (before) => {
            if (before.noteFragmentSeeded || before.manuallyResized || (before.html ?? null) !== was.html) {
              return { x: c.x, y: c.y };
            }
            repaired.add(String(c.id));
            return { ...was.fix, ...geometry };
          },
        };
      }),
    });

    return json({
      board_id: id,
      layout,
      arranged: updated.filter(Boolean).length,
      repaired: repaired.size,
      ...told,
      not_found: notFound,
      cards: updated.filter(Boolean).map(publicCard),
    });
  }

  // /boards/:id/groups — the app's "these belong together", reachable at last.
  if (sub === 'groups') {
    if (method === 'GET') {
      trace.route = '/boards/:id/groups';
      const groups = await readBoardGroups(env, id, token);
      return json({ board_id: id, groups: groups.map(publicGroup) });
    }

    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, id);

    if (!subId && method === 'POST') {
      trace.route = '/boards/:id/groups';
      const name = str(body.name, 120);
      if (!name) throw fail(400, 'bad_request', 'name is required');
      const group = {
        id: crypto.randomUUID(),
        name,
        color: typeof body.color === 'string' ? sectionColour(body.color) : null,
        shape: body.shape === 'hug' ? 'hug' : 'box',
        outline: body.outline !== false,
        kind: null,
        createdAt: new Date().toISOString(),
        createdBy: auth.userId,
      };
      // A group given no colour takes the next named one the board's groups
      // don't wear yet (lib/boardStyle.js), as a section an add names does.
      const out = await writeBoardGroups(env, {
        boardId: id, accessToken: token, workspaceId: board.workspace_id,
        userId: auth.userId,
        upserts: (now) => [group.color ? group : { ...group, color: nextSectionColours(now.map((g) => g.color), 1)[0] }],
      });
      return json({
        board_id: id,
        group: publicGroup(out.groups.find((g) => g.id === group.id) || group),
        next: `POST /api/v1/boards/${id}/cards with {"group_id":"${group.id}"} to put cards in it`,
      }, 201);
    }

    if (subId && method === 'PATCH') {
      trace.route = '/boards/:id/groups/:groupId';
      const existing = (await readBoardGroups(env, id, token)).find((g) => String(g.id) === subId);
      if (!existing) throw fail(404, 'not_found', 'group not found');
      const patch = { id: subId };
      if ('name' in body) patch.name = str(body.name, 120);
      if ('color' in body) patch.color = typeof body.color === 'string' ? sectionColour(body.color) : null;
      if ('shape' in body) patch.shape = body.shape === 'hug' ? 'hug' : 'box';
      if ('outline' in body) patch.outline = body.outline !== false;
      const out = await writeBoardGroups(env, {
        boardId: id, accessToken: token, workspaceId: board.workspace_id,
        userId: auth.userId, upserts: [patch],
      });
      return json({ board_id: id, group: publicGroup(out.groups.find((g) => String(g.id) === subId)) });
    }

    if (subId && method === 'DELETE') {
      trace.route = '/boards/:id/groups/:groupId';
      // Ungroup, never delete. Removing a group that holds forty cards must not
      // be a way to delete forty cards, and there is no undo on an HTTP call.
      const out = await writeBoardGroups(env, {
        boardId: id, accessToken: token, workspaceId: board.workspace_id,
        userId: auth.userId, removeIds: [subId],
      });
      return json({
        board_id: id,
        ungrouped: out.ungrouped,
        note: 'the group is gone; its cards are not',
      });
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  if (sub === 'export' && method === 'GET') {
    trace.route = '/boards/:id/export';
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    if (!['json', 'omc'].includes(format)) {
      throw fail(400, 'bad_request', 'format must be json or omc');
    }
    const b = await boardForUser(env, token, id, { includeDeleted: true });
    if (!b) throw fail(404, 'not_found', 'board not found');

    const cards = await readBoardCards(env, id, token);
    const [boardMetaMap, cardMeta] = await Promise.all([
      loadBoardsMeta(env, token, [id]),
      loadMeta(env, token, { boardId: id, objectType: 'card', objectIds: cards.map((c) => c.id) }),
    ]);
    const boardMeta = boardMetaMap.get(id) || {};

    if (format === 'omc') {
      return json(boardToOmc({
        board: b, cards: cards.map(publicCard), boardMeta, cardMeta, origin: url.origin,
      }));
    }

    return json({
      format: 'soleil.board.v1',
      exported_at: new Date().toISOString(),
      board: { ...publicBoard(b), props: boardMeta.props ?? {}, identifiers: boardMeta.identifiers ?? [] },
      // The card exactly as stored, alongside the projection. A caller
      // reconstructing this board elsewhere needs the former; one reading it
      // wants the latter.
      cards: cards.map((c) => ({
        ...publicCard(c),
        raw: c,
        props: cardMeta.get(String(c.id))?.props ?? {},
        identifiers: cardMeta.get(String(c.id))?.identifiers ?? [],
      })),
      count: cards.length,
    });
  }

  // /boards/:id/share-link — the board's view-only link: anyone with it opens
  // the board without signing in, and nobody can change anything through it.
  //
  // POST hands back a live link rather than making another, as the Share
  // panel's one-tap copy does (lib/boardsApi.js ensurePublicLink), so asking
  // twice never piles up tokens; one is made only when none fits. Without
  // include_subboards any live link will do; with it, only one of that scope.
  // A link made here shows the one board unless include_subboards is true —
  // the narrower choice, since an agent may be the one asking. DELETE revokes
  // every live view link the caller may revoke and says how many others stay.
  // Invite links (kind 'invite') grant access when claimed and are never
  // touched here. The token only ever travels in a response body: in a path or
  // a query string it would land in api_request_log.
  if (sub === 'share-link') {
    trace.route = '/boards/:id/share-link';
    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    const now = Date.now();
    const isLive = (l) => (l.kind || 'view') === 'view' && !l.revoked_at
      && (!l.expires_at || Date.parse(l.expires_at) > now);
    const shape = (l) => ({
      url: `${url.origin}/share/${l.token}`,
      include_subboards: !!l.include_subboards,
      expires_at: l.expires_at ?? null,
      created_at: l.created_at ?? null,
      created_by_you: l.created_by === auth.userId,
    });
    // Answers for whoever may manage the board's links — an owner, a co-owner
    // or an editor — newest first, and refuses anyone else (42501 → 403).
    const liveLinks = async () =>
      ((await userRpc(env, token, 'list_public_links', { p_board_id: id })) || []).filter(isLive);

    if (method === 'GET') {
      return json({ board_id: id, links: (await liveLinks()).map(shape) });
    }

    if (method === 'POST') {
      const want = body?.include_subboards;
      if (want !== undefined && typeof want !== 'boolean') {
        throw fail(400, 'bad_request', 'include_subboards must be true or false');
      }
      const live = await liveLinks();
      const existing = want === undefined ? live[0] : live.find((l) => !!l.include_subboards === want);
      if (existing) return json({ board_id: id, created: false, link: shape(existing) });
      const minted = await userRpc(env, token, 'create_public_link', {
        p_board_id: id, p_expires_at: null, p_include_subboards: want === true,
      });
      if (typeof minted !== 'string' || !isUuid(minted)) {
        throw fail(502, 'upstream_error', 'the link was not made — try again');
      }
      return json({
        board_id: id,
        created: true,
        link: shape({ token: minted, include_subboards: want === true, expires_at: null,
          created_at: new Date(now).toISOString(), created_by: auth.userId }),
      }, 201);
    }

    if (method === 'DELETE') {
      let revoked = 0;
      let stillShared = 0;
      for (const l of await liveLinks()) {
        try {
          await userRpc(env, token, 'revoke_public_link', { p_token: l.token });
          revoked += 1;
        } catch (e) {
          // An editor may revoke only the links they made; the rest stay live
          // until their maker or an owner revokes them, and the answer says so.
          if (normalizeApiError(e).status !== 403) throw e;
          stillShared += 1;
        }
      }
      return json({
        board_id: id,
        revoked,
        still_shared: stillShared,
        ...(stillShared ? { message: `${stillShared} link${stillShared === 1 ? '' : 's'} made by someone else `
          + `${stillShared === 1 ? 'stays' : 'stay'} live until they, or an owner of the workspace, revoke ` + (stillShared === 1 ? 'it' : 'them') } : {}),
      });
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // GET /boards/:id/gallery — the board's pictures in the order a person reads
  // them, at a size a model can afford to look at (lib/gallery.js). inline=1
  // embeds them as base64 under a byte budget, so an agent sees a board in one
  // request rather than one per picture; card_ids picks pictures to look at
  // closely, with size=preview.
  if (sub === 'gallery' && method === 'GET') {
    trace.route = '/boards/:id/gallery';
    const sizeParam = url.searchParams.get('size');
    if (sizeParam && !['sm', 'preview'].includes(sizeParam)) {
      throw fail(400, 'bad_request', 'size must be sm or preview');
    }
    const size = sizeParam || 'sm';
    const inline = ['1', 'true'].includes(url.searchParams.get('inline') || '');
    const rawLimit = Number(url.searchParams.get('limit'));
    const limit = Math.max(1, Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : GALLERY.defaultLimit, GALLERY.maxLimit));
    const offset = decodeCursor(url.searchParams.get('cursor'));
    if (offset == null) throw fail(400, 'bad_request', 'cursor is not one this endpoint issued');
    const wanted = [...new Set((url.searchParams.get('card_ids') || '')
      .split(',').map((s) => s.trim()).filter(Boolean))];
    if (wanted.length > GALLERY.maxCardIds) {
      throw fail(400, 'bad_request', `at most ${GALLERY.maxCardIds} card_ids — got ${wanted.length}`);
    }

    const rows = await userSelect(env, token, 'boards', `id=eq.${id}&deleted_at=is.null`
      + '&select=id,name,workspace_id,thumb_key,thumb_updated_at&limit=1');
    const b = rows?.[0];
    if (!b) throw fail(404, 'not_found', 'board not found');

    const cards = await readBoardCards(env, id, token);
    const pictures = boardPictures(cards);
    let page;
    if (wanted.length) {
      const byId = new Map(pictures.map((p) => [String(p.card.id), p]));
      const missing = wanted.filter((cid) => !byId.has(cid));
      if (missing.length) {
        throw fail(404, 'not_found', `no picture on this board for card ${missing.slice(0, 3).join(', ')}`
          + ' — only image cards, and videos with a poster frame, have one');
      }
      page = wanted.map((cid) => byId.get(cid));
    } else {
      page = pictures.slice(offset, offset + limit);
    }
    const hasMore = !wanted.length && offset + page.length < pictures.length;

    // The rows behind this page, read AS THE USER: whoever may read a picture
    // may read its renditions, and one they cannot see is listed without them.
    const keys = [...new Set(page.map((p) => p.key))];
    const imageRows = keys.length
      ? await userSelect(env, token, 'images',
        `storage_path=in.${encodeURIComponent(pgInList(keys))}&deleted_at=is.null`
        + '&select=storage_path,preview_path,preview_w,preview_h,preview_sm_path,preview_sm_w,preview_sm_h,'
        + 'width,height,size_bytes')
      : [];
    const rowByKey = new Map((imageRows || []).map((r) => [r.storage_path, r]));

    // Bytes in reading order, the board's own picture first: each embedded
    // while it fits, the rest listed with the reason they were not.
    const fits = makeInlineBudget(size);
    const embed = async (key) => {
      if (!env.IMAGES) return { reason: 'storage_unavailable' };
      const obj = await env.IMAGES.get(key);
      if (!obj) return { reason: 'missing' };
      const reason = fits(obj.size);
      if (reason) {
        try { await obj.body.cancel(); } catch (_) { /* nothing to release */ }
        return { reason };
      }
      return {
        data: bytesToBase64(new Uint8Array(await obj.arrayBuffer())),
        mime: obj.httpMetadata?.contentType || 'image/webp',
        bytes: obj.size,
      };
    };

    let thumbnail = null;
    if (b.thumb_key && !wanted.length && offset === 0) {
      thumbnail = { updated_at: b.thumb_updated_at ?? null };
      if (inline) Object.assign(thumbnail, await embed(b.thumb_key));
    }

    const items = [];
    for (const [i, p] of page.entries()) {
      const c = p.card;
      const row = rowByKey.get(p.key);
      const rendition = pickRendition(row, size);
      const item = {
        card_id: String(c.id),
        kind: c.kind || 'image',
        position: wanted.length ? null : offset + i + 1,
        title: c.title ?? null,
        caption: (textOf(c) || '').slice(0, 280) || null,
        x: c.x, y: c.y, w: c.w, h: c.h,
        image_key: p.key,
        ...(p.from === 'poster' ? { poster: true } : {}),
        width: row?.width ?? null,
        height: row?.height ?? null,
        rendition: rendition ? { variant: rendition.variant, width: rendition.width, height: rendition.height } : null,
        url: cardUrl(url.origin, id, c.id),
      };
      if (inline) {
        Object.assign(item, rendition ? await embed(rendition.key) : { reason: row ? 'no_rendition' : 'not_found' });
      }
      items.push(item);
    }

    // Bytes leaving, as with GET /images/:key: the question a studio's review
    // asks is who took a copy, and when.
    if (inline) trace.log = true;

    return json({
      board: {
        id: b.id,
        name: b.name,
        workspace_id: b.workspace_id,
        url: boardUrl(url.origin, b.id),
        card_count: cards.length,
        picture_count: pictures.length,
        thumbnail,
      },
      size,
      pictures: items,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(offset + page.length) : null,
    });
  }

  // GET /boards/:id/canvas — the board as it is drawn, for drawing it
  // somewhere else (lib/canvasView.js; the inline view show_board opens in an
  // AI chat). Each picture gets an address on /api/img/ that works for an hour
  // without a session, signed only after the caller's own read found it.
  if (sub === 'canvas' && method === 'GET') {
    trace.route = '/boards/:id/canvas';
    const rows = await userSelect(env, token, 'boards', `id=eq.${id}&deleted_at=is.null`
      + '&select=id,name,bg_color&limit=1');
    const b = rows?.[0];
    if (!b) throw fail(404, 'not_found', 'board not found');

    const { cards, groups } = await readBoardCardsAndGroups(env, id, token);
    const plan = planCanvas(cards, groups);
    const [imageRows, boardRows] = await Promise.all([
      plan.keys.length
        ? userSelect(env, token, 'images',
          `storage_path=in.${encodeURIComponent(pgInList(plan.keys))}&deleted_at=is.null`
          + '&select=storage_path,preview_path,preview_w,preview_h,preview_sm_path,preview_sm_w,preview_sm_h,'
          + 'width,height,size_bytes,blur_hash')
        : [],
      plan.boardIds.length
        ? userSelect(env, token, 'boards',
          `id=in.${encodeURIComponent(pgInList(plan.boardIds))}&deleted_at=is.null&select=id,name,thumb_key`)
        : [],
    ]);

    const secret = await imageSecret(env.SUPABASE_SERVICE_ROLE_KEY);
    const expiresAt = Math.floor(Date.now() / 1000) + SIGNED_IMAGE_TTL_S;
    // Addresses handed out, as bytes leaving are logged on /gallery: who could
    // see which board's pictures, and when.
    trace.log = true;
    return json(await canvasAnswer({
      board: b,
      boardUrl: boardUrl(url.origin, b.id),
      plan,
      imageRows: imageRows || [],
      boardRows: boardRows || [],
      sign: async (key) => `${url.origin}${SIGNED_IMAGE_PATH}${await signImageKey(secret, key, expiresAt)}`,
      expiresAt,
    }));
  }

  // POST /boards/:id/docs — a new doc card holding pages written in Markdown.
  // The pages go in inside the transaction that puts the card on the board, as
  // the app's own addCard does, so the doc arrives whole; through the live room
  // or not at all (see loadDocWrite).
  if (sub === 'docs') {
    if (subId) throw fail(404, 'not_found', 'unknown endpoint');
    if (method !== 'POST') {
      throw fail(405, 'method_not_allowed', `a doc is made here; read one at GET /boards/${id}/cards/:cardId/doc`);
    }
    trace.route = '/boards/:id/docs';
    const dw = await loadDocWrite();
    const pages = dw.preparePages(body.pages);
    if (body.title != null && typeof body.title !== 'string') throw fail(400, 'bad_request', 'title must be a string');
    const target = await boardForUser(env, token, id);
    if (!target) throw fail(404, 'not_found', 'board not found');
    await requireBoardWrite(env, token, id);

    // The card takes the title given, else its one page's; a first page with
    // no title of its own takes the card's, as a new doc's first page does in
    // the app (docState.followTitle).
    const title = String(body.title ?? '').trim()
      || (pages.length === 1 && pages[0].title !== 'Untitled' ? pages[0].title : '')
      || 'Untitled doc';
    if (pages[0].title === 'Untitled' && title !== 'Untitled doc') pages[0].title = title.slice(0, dw.DOC_WRITE.maxTitle);
    // The app's size for a new doc card.
    const card = normalizeIncomingCard({ kind: 'doc', title, w: 320, h: 240, x: body.x, y: body.y });

    let images = new Set();
    let made = [];
    const result = await throughRoom(() => addCardsToBoard(env, {
      boardId: id,
      workspaceId: target.workspace_id,
      userId: auth.userId,
      accessToken: token,
      requireLive: true,
      buildCards: async (existing) => {
        images = dw.placeableImages(existing, null);
        return layoutCards([card], existing);
      },
      afterInsert: (doc, cardYMap) => {
        made = dw.writePages(doc, cardYMap, pages, { userId: auth.userId, imageAllowed: pictureFrom(images) });
      },
    }));
    const placed = result.cards[0];
    if (!placed) throw fail(409, 'conflict', 'the doc could not be placed on that board; nothing was added');
    await indexDocPages(env, token, target.workspace_id, String(placed.id), made);
    return json({
      board_id: id,
      card: publicCard(placed),
      url: cardUrl(url.origin, id, placed.id),
      pages: made.map(publicDocPage),
      live: true,
    }, 201);
  }

  // /boards/:id/comments — the board's comment threads and the ones inside its
  // docs and notes, as one list (lib/apiComments.js). The board's own are
  // written as the user, so the comments table's policies decide, as they do
  // in the app: anyone who can open a board may comment on it; a thread's
  // author or an editor of the board may resolve it; only its author deletes a
  // comment (an editor resolves someone else's instead), and a deleted one can
  // be restored. The threads inside docs and notes are the card's own, written
  // through the board's live room, and as in the app only an editor of the
  // board writes in them (DocCommentsTab's canEdit): a reply, resolving, a new
  // thread on words in a doc (lib/docCommentAnchor.js), and deleting one's own
  // thread in a doc while no one else has replied in it.
  if (sub === 'comments') {
    const action = parts[4];
    if (parts.length > 5 || (action !== undefined && action !== 'restore')) {
      throw fail(404, 'not_found', 'unknown endpoint');
    }
    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    const noSuch = () => fail(404, 'not_found', 'no such comment on this board');
    // One of the board's own comments; with `deleted`, one in its trash too.
    const commentOnBoard = async (commentId, { deleted = false } = {}) => {
      if (!isBoardCommentId(commentId)) throw noSuch();
      const rows = await userSelect(env, token, 'comments', `id=eq.${commentId}&board_id=eq.${id}`
        + `${deleted ? '' : '&deleted_at=is.null'}&select=${COMMENT_FIELDS},deleted_at`);
      if (!rows?.[0]) throw noSuch();
      return rows[0];
    };
    const threadUrl = (t) => (t.card_id != null ? cardUrl(url.origin, id, t.card_id) : boardUrl(url.origin, id));
    const when = (ms) => new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
    const editorsOnly = () => requireBoardWrite(env, token, id,
      'only an editor of this board writes in the threads inside its docs and notes, as in the app');
    // A write in the threads inside docs and notes: checked against the board
    // as its room has it, then written through the room, or not at all.
    const writeInCards = (prepare, write) => throughRoom(() => editBoardLive(env, {
      boardId: id, accessToken: token, prepare, write,
    }));

    // Resolve or reopen some of the board's own threads: one read, one write,
    // as the user (a refused update matches no rows, so the rows coming back
    // are what says it happened, as the app's updateComment checks).
    const resolveOnBoard = async (ids, resolved, out) => {
      const rows = await userSelect(env, token, 'comments', `id=in.(${ids.join(',')})&board_id=eq.${id}`
        + '&deleted_at=is.null&select=id,reply_to,anchor_kind,anchor_id');
      const found = new Map((rows || []).map((r) => [r.id, r]));
      const threads = [];
      for (const cid of ids) {
        const r = found.get(cid);
        if (!r) out.not_found.push(cid);
        else if (r.reply_to) {
          out.refused.push({ id: cid, status: 400, code: 'bad_request', reason: `that is a reply: resolve its thread, ${r.reply_to}` });
        } else {
          threads.push(cid);
          out.cards.set(cid, r.anchor_kind === 'card' ? r.anchor_id : null);
        }
      }
      if (!threads.length) return;
      const done = await userPatch(env, token, 'comments', `id=in.(${threads.join(',')})&board_id=eq.${id}`, { resolved });
      const ok = new Set((done || []).map((r) => r.id));
      for (const cid of threads) {
        if (ok.has(cid)) out.changed.push(cid);
        else {
          out.refused.push({ id: cid, status: 403, code: 'forbidden',
            reason: 'only the thread\'s author or an editor of this board can resolve it' });
        }
      }
    };

    // The same for threads inside docs and notes, all in one write (a resolve
    // filed beside each thread, naming who resolved it, as the app files one).
    const resolveInCards = async (ids, resolved, out) => {
      const refuse = (cid, status, code, reason) => out.refused.push({ id: cid, status, code, reason });
      const editor = await userRpc(env, token, 'can_write_board', { p_board_id: id }).catch(() => false);
      if (editor !== true) {
        for (const cid of ids) {
          refuse(cid, 403, 'forbidden', 'only an editor of this board resolves the threads inside its docs and notes, as in the app');
        }
        return;
      }
      const me = await commentAuthor(env, token, auth.userId);
      const plan = [];
      try {
        await writeInCards((doc) => {
          const cards = doc.getMap('cards');
          for (const cid of ids) {
            const at = findCardThread(cards, cid);
            if (!at) out.not_found.push(cid);
            else if (at.replyId) refuse(cid, 400, 'bad_request', `that is a reply: resolve its thread, ${at.thread.id}`);
            else {
              out.cards.set(cid, at.cardId);
              if (at.thread.resolved === resolved) out.changed.push(cid);
              else plan.push(at);
            }
          }
          return plan.length ? null : { unchanged: true };
        }, (doc) => {
          for (const at of plan) {
            resolveComment(doc, at.thread.id, resolved, { comments: at.comments }, { by: auth.userId, byName: me.name });
          }
        });
        for (const at of plan) out.changed.push(at.thread.id);
      } catch (e) {
        if (e?.code !== 'room_unavailable') throw e;
        // Nothing was written. The room was away before the board could be
        // read (nothing sorted yet), or didn't take the change.
        for (const cid of plan.length ? plan.map((at) => at.thread.id) : ids) refuse(cid, 503, 'room_unavailable', e.message);
      }
    };

    // A reply in a thread inside a doc or a note, filed beside the thread as
    // the app files one (docState.addCommentReply).
    const replyInCard = async ({ body: words, replyTo }) => {
      const [, me] = await Promise.all([editorsOnly(), commentAuthor(env, token, auth.userId)]);
      let at = null;
      const { result } = await writeInCards((doc) => {
        at = findCardThread(doc.getMap('cards'), replyTo);
        if (!at) throw noSuch();
        // The app offers no reply on a resolved thread, only Reopen.
        if (at.thread.resolved) {
          throw fail(409, 'conflict', 'that thread is resolved: reopen it first '
            + `(PATCH /api/v1/boards/${id}/comments/${at.thread.id} with {"resolved": false})`);
        }
      }, (doc) => {
        const replyId = addCommentReply(doc, at.thread.id, {
          body: words, author: me.name, authorId: auth.userId, authorColor: me.color, mentions: [],
          scope: { comments: at.comments },
        });
        return { replyId, ts: at.comments.get(commentReplyKey(at.thread.id, replyId))?.ts };
      });
      const link = cardUrl(url.origin, id, at.cardId);
      return json({
        board_id: id,
        comment: {
          id: result.replyId, reply_to: at.thread.id, body: words, author_id: auth.userId,
          author_name: me.name, by_you: true, created_at: when(result.ts), url: link,
        },
        url: link,
      }, 201);
    };

    // A new thread on words in a doc: filed as the app's addCommentThread
    // files one, and its mark put on the words (lib/docCommentAnchor.js).
    const startInDoc = async ({ body: words, anchor }) => {
      const [, me] = await Promise.all([editorsOnly(), commentAuthor(env, token, auth.userId)]);
      const { result } = await writeInCards((doc) => {
        const ym = doc.getMap('cards').get(String(anchor.id));
        if (!ym || typeof ym.get !== 'function') throw fail(404, 'not_found', 'no such card on this board');
        const kind = ym.get('kind') || 'note';
        if (kind === 'note') {
          throw fail(400, 'bad_request', 'words in a note take a comment in the app; leave out quote to comment on the note');
        }
        if (kind !== 'doc') throw fail(400, 'bad_request', `quote is for the words in a doc, and card ${anchor.id} isn't one`);
        const found = findQuote(ym, anchor.quote, { pageId: anchor.pageId });
        if (found.problem === 'page') throw fail(404, 'not_found', `this doc has no page ${anchor.pageId}`);
        if (found.problem === 'none') {
          throw fail(400, 'bad_request', `those words aren't in this doc${anchor.pageId ? ' on that page' : ''}: `
            + `quote them as the doc has them (GET /api/v1/boards/${id}/cards/${anchor.id}/doc)`);
        }
        if (found.problem === 'code') {
          throw fail(400, 'bad_request', 'those words are code, which takes no comment: quote the words around it');
        }
        if (found.problem === 'many') {
          throw fail(400, 'bad_request', `those words are in this doc ${found.count} times `
            + `(${found.pages.slice(0, 5).join(', ')}): quote more of the words around them`
            + `${anchor.pageId ? '' : ', or name page_id'}`);
        }
        return { ym, found };
      }, (doc, { ym, found }) => {
        // Not initCardDocStore: it also gathers a page's old stacked sheets
        // into one, which would move the very words being marked.
        if (!ym.get('docComments')) ym.set('docComments', new Y.Map());
        const comments = ym.get('docComments');
        const threadId = addCommentThread(doc, {
          pageId: found.pageId, body: words, author: me.name, authorId: auth.userId, authorColor: me.color,
          mentions: [], scope: { comments },
        });
        markQuote(found.ranges, threadId);
        return {
          threadId, ts: comments.get(threadId)?.ts, title: ym.get('title') || null,
          pageId: found.pageId, pageName: found.pageName, quote: found.quote,
        };
      });
      const link = cardUrl(url.origin, id, anchor.id);
      const comment = publicThread({
        id: result.threadId, on: 'doc', card_id: String(anchor.id), group_id: null, x: null, y: null,
        page_id: result.pageId, page_title: result.pageName, quote: result.quote,
        body: words, author_id: auth.userId, author_name: me.name, created_at: when(result.ts),
        resolved: false, hidden: false, replies: [],
      }, {
        names: new Map([[auth.userId, me.name]]),
        userId: auth.userId,
        cards: new Map([[String(anchor.id), { kind: 'doc', title: result.title }]]),
        url: link,
      });
      return json({ board_id: id, comment, url: link }, 201);
    };

    // Deleting your own thread in a doc, while no one else has replied in it:
    // the thread, everything filed under it, and its mark on the words, as the
    // app's delete takes them. There is no restore for it.
    const deleteInDoc = async (threadId) => {
      await editorsOnly();
      let cardId = null;
      await writeInCards((doc) => {
        const at = findCardThread(doc.getMap('cards'), threadId);
        if (!at) throw noSuch();
        if (at.replyId) throw fail(400, 'bad_request', `a reply inside a doc or a note stays with its thread, ${at.thread.id}`);
        if (at.kind !== 'doc') throw fail(400, 'bad_request', 'a thread inside a note is deleted in the app; resolve it instead');
        if (at.thread.authorId !== auth.userId) {
          throw fail(403, 'forbidden', 'only its author deletes a thread; resolve someone else\'s instead');
        }
        if (at.thread.replies.some((r) => r.authorId !== auth.userId)) {
          throw fail(409, 'conflict', 'someone else has replied in that thread: resolve it instead');
        }
        cardId = at.cardId;
        return { at };
      }, (doc, { at }) => {
        unmarkThread(at.ym, at.thread.id);
        deleteCommentThread(doc, at.thread.id, { comments: at.comments });
      });
      return json({
        board_id: id,
        comment_id: threadId,
        deleted: true,
        restore: null,
        note: 'a thread inside a doc is gone once deleted: there is no restore for it',
        url: cardUrl(url.origin, id, cardId),
      });
    };

    if (!subId && method === 'GET') {
      trace.route = '/boards/:id/comments';
      const status = url.searchParams.get('status') || 'open';
      if (!STATUSES.includes(status)) throw fail(400, 'bad_request', `status must be ${STATUSES.join(', ')}`);
      const rawLimit = Number(url.searchParams.get('limit'));
      const limit = Math.max(1, Math.min(
        Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : COMMENTS.defaultLimit, COMMENTS.maxLimit));
      const offset = decodeCursor(url.searchParams.get('cursor'));
      if (offset === null) throw fail(400, 'bad_request', 'cursor must be a next_cursor this endpoint gave out');
      const [rows, inCards] = await Promise.all([
        userSelect(env, token, 'comments', `board_id=eq.${id}&deleted_at=is.null`
          + `&select=${COMMENT_FIELDS}&order=created_at.asc&limit=${COMMENTS.maxRows}`),
        withBoardCards(env, id, token, ({ cards, loaded }) => ({
          loaded,
          threads: cardThreads(cards),
          cards: new Map(cards.map((c) => [String(c.id), { kind: c.kind || 'note', title: c.title }])),
        })),
      ]);
      const threads = [...boardThreads(rows), ...inCards.threads];
      const names = await commentNames(env, token, authorIds(threads));
      const { counts, page, hasMore } = pageThreads(threads, { status, offset, limit });
      const notes = [];
      if (!inCards.loaded) notes.push('the threads inside docs and notes could not be read just now, so these are the board\'s own');
      if ((rows || []).length >= COMMENTS.maxRows) notes.push(`only the board's first ${COMMENTS.maxRows} comments were read`);
      return json({
        board_id: id,
        url: boardUrl(url.origin, id),
        status,
        counts,
        threads: page.map((t) => publicThread(t, { names, userId: auth.userId, cards: inCards.cards, url: threadUrl(t) })),
        has_more: hasMore,
        next_cursor: hasMore ? encodeCursor(offset + page.length) : null,
        ...(notes.length ? { note: notes.join('; ') } : {}),
      });
    }

    if (!subId && method === 'POST') {
      trace.route = '/boards/:id/comments';
      const input = readNewComment(body);
      if (input.problem) throw fail(400, 'bad_request', input.problem);
      if (input.replyTo && !isBoardCommentId(input.replyTo)) return replyInCard(input);
      if (input.anchor?.kind === 'doc') return startInDoc(input);
      let anchor = input.anchor;
      let replyTo = null;
      let offset = null;
      if (input.replyTo) {
        // Into the thread, under its first comment, where the thread is: as a
        // reply made in the app goes (CanvasComment's submitReply).
        const parent = await commentOnBoard(input.replyTo);
        const root = parent.reply_to ? await commentOnBoard(parent.reply_to) : parent;
        anchor = anchorOf(root);
        replyTo = root.id;
      } else if (anchor.kind !== 'point') {
        // What it is on, checked, and where its bubble goes (a point is its
        // own place).
        const [onBoard, shown] = await Promise.all([
          withBoardCards(env, id, token, ({ cards, doc, loaded }) => ({
            loaded,
            cards: cards.map((c) => ({ id: String(c.id), x: c.x, y: c.y, w: c.w, h: c.h, groupId: c.groupId ?? null })),
            groups: new Set(doc.getMap('groups').keys()),
          })),
          userSelect(env, token, 'comments', `board_id=eq.${id}&deleted_at=is.null&reply_to=is.null`
            + `&resolved=is.false&hidden=is.false&select=${COMMENT_FIELDS}&limit=${COMMENTS.maxRows}`),
        ]);
        if (!onBoard.loaded) {
          throw fail(503, 'room_unavailable', 'the board could not be read to place the comment; nothing was written — try again');
        }
        if (anchor.kind === 'card' && !onBoard.cards.some((c) => c.id === String(anchor.id))) {
          throw fail(404, 'not_found', 'no such card on this board');
        }
        if (anchor.kind === 'group' && !onBoard.groups.has(String(anchor.id))) {
          throw fail(404, 'not_found', 'no such group on this board');
        }
        offset = placeComment(anchor, { cards: onBoard.cards, comments: shown || [] });
      }
      const [saved] = (await userInsert(env, token, 'comments', [commentRow({
        workspaceId: board.workspace_id, boardId: id, author: auth.userId, body: input.body, anchor, replyTo, offset,
      })])) || [];
      if (!saved) throw fail(502, 'upstream_error', 'the comment was not saved — try again');
      const names = await commentNames(env, token, [auth.userId]);
      const link = threadUrl({ card_id: anchor.kind === 'card' ? anchor.id : null });
      // A new thread as the list has it; a reply as a thread's replies are,
      // naming its thread.
      const thread = publicThread(boardThreads([{ ...saved, reply_to: null }])[0],
        { names, userId: auth.userId, url: link });
      const comment = replyTo
        ? { id: thread.id, reply_to: replyTo, body: thread.body, author_id: thread.author_id,
          author_name: thread.author_name, by_you: true, created_at: thread.created_at, url: link }
        : thread;
      return json({ board_id: id, comment, url: link }, 201);
    }

    // Several threads at once, of either kind: what changed, what isn't on the
    // board, and what was refused and why, in the order asked.
    if (!subId && method === 'PATCH') {
      trace.route = '/boards/:id/comments';
      const ask = readResolveMany(body);
      if (ask.problem) throw fail(400, 'bad_request', ask.problem);
      const out = { changed: [], not_found: [], refused: [], cards: new Map() };
      const own = ask.ids.filter(isBoardCommentId);
      const inside = ask.ids.filter((cid) => !isBoardCommentId(cid));
      if (own.length) await resolveOnBoard(own, ask.resolved, out);
      if (inside.length) await resolveInCards(inside, ask.resolved, out);
      const inOrder = (list) => ask.ids.filter((cid) => list.includes(cid));
      return json({
        board_id: id,
        resolved: ask.resolved,
        changed: inOrder(out.changed),
        not_found: inOrder(out.not_found),
        refused: ask.ids.flatMap((cid) => out.refused.filter((r) => r.id === cid))
          .map((r) => ({ id: r.id, code: r.code, reason: r.reason })),
      });
    }

    if (!subId) throw fail(405, 'method_not_allowed', `${method} is not supported here`);

    if (action === 'restore') {
      if (method !== 'POST') throw fail(405, 'method_not_allowed', 'a comment is restored with POST');
      trace.route = '/boards/:id/comments/:commentId/restore';
      if (!isBoardCommentId(subId)) {
        throw fail(400, 'bad_request', 'a thread inside a doc or a note has no restore: deleting one takes it away for good');
      }
      const c = await commentOnBoard(subId, { deleted: true });
      // Its author or an editor of the board, as restore_comment decides
      // (42501 → 403). Restoring one that isn't deleted changes nothing.
      if (c.deleted_at) await userRpc(env, token, 'restore_comment', { p_comment_id: subId });
      return json({ board_id: id, comment_id: subId, restored: true, url: threadUrl({ card_id: c.anchor_kind === 'card' ? c.anchor_id : null }) });
    }

    if (method === 'PATCH') {
      trace.route = '/boards/:id/comments/:commentId';
      if (typeof body?.resolved !== 'boolean' || Object.keys(body).length !== 1) {
        throw fail(400, 'bad_request', 'send {"resolved": true} to resolve a thread, or {"resolved": false} to reopen it');
      }
      const out = { changed: [], not_found: [], refused: [], cards: new Map() };
      await (isBoardCommentId(subId) ? resolveOnBoard : resolveInCards)([subId], body.resolved, out);
      if (out.not_found.length) throw noSuch();
      const [no] = out.refused;
      if (no) throw fail(no.status, no.code, no.reason);
      return json({ board_id: id, comment_id: subId, resolved: body.resolved, url: threadUrl({ card_id: out.cards.get(subId) ?? null }) });
    }

    if (method === 'DELETE') {
      trace.route = '/boards/:id/comments/:commentId';
      if (!isBoardCommentId(subId)) return deleteInDoc(subId);
      const c = await commentOnBoard(subId);
      if (c.author !== auth.userId) {
        throw fail(403, 'forbidden', 'only its author deletes a comment; an editor resolves someone else\'s thread instead');
      }
      await userRpc(env, token, 'soft_delete_comment', { p_comment_id: subId });
      return json({
        board_id: id,
        comment_id: subId,
        deleted: true,
        restore: `POST /api/v1/boards/${id}/comments/${subId}/restore`,
      });
    }

    throw fail(405, 'method_not_allowed', `${method} is not supported here`);
  }

  // /boards/:id/tags — the tags on this board's cards, groups and doc pages
  // (GET), and putting tags on its cards or taking them off (POST), each as
  // the app's Tag… picker does it (lib/apiTags.js): a name the workspace lacks
  // becomes a tag, which then applies itself wherever its name appears
  // (backfill_tag_applications, as ensureTag runs it); a deleted tag's name
  // brings that tag back; taking a tag off a card keeps it off for good
  // (autotag_ignored, the 0590 guard), and putting it on again lifts that.
  if (sub === 'tags') {
    trace.route = '/boards/:id/tags';
    if (parts.length > 3) throw fail(404, 'not_found', 'unknown endpoint');
    if (method === 'GET') {
      const board = await boardForUser(env, token, id);
      if (!board) throw fail(404, 'not_found', 'board not found');
      const [links, onBoard] = await Promise.all([
        selectAll(env, token, 'entity_links', `source_board_id=eq.${id}&target_kind=eq.tag&link_kind=eq.applied`
          + '&select=source_kind,source_id,source_page_id,target_id&order=created_at.asc,id.asc'),
        boardContents(env, token, id),
      ]);
      const tagIds = [...new Set(links.map((l) => l.target_id))];
      const tags = [];
      for (let i = 0; i < tagIds.length; i += 100) {
        tags.push(...await userSelect(env, token, 'tags', `id=in.(${tagIds.slice(i, i + 100).join(',')})`
          + `&status=neq.deleted&deleted_at=is.null&select=${TAG_FIELDS}`));
      }
      return json({
        board_id: id,
        tags: boardTags(links, tags, id, onBoard.loaded ? onBoard : null),
        ...(onBoard.loaded ? {} : { note: 'the board could not be read just now, so cards deleted since may be listed' }),
        url: boardUrl(url.origin, id),
      });
    }
    if (method !== 'POST') throw fail(405, 'method_not_allowed', `${method} is not supported here`);

    const asked = readTagRequest(body);
    if (asked.problem) throw fail(400, 'bad_request', asked.problem);
    const board = await boardForUser(env, token, id);
    if (!board) throw fail(404, 'not_found', 'board not found');
    const ws = board.workspace_id;
    const [canTag, onBoard, rows] = await Promise.all([
      userRpc(env, token, 'can_write_workspace', { ws }).catch(() => false),
      boardContents(env, token, id),
      findWorkspaceTags(env, token, ws, [...asked.add, ...asked.remove]),
    ]);
    if (canTag !== true) {
      throw fail(403, 'forbidden', 'only someone who can edit this board\'s workspace tags things in it, as in the app');
    }
    if (!onBoard.loaded) {
      throw fail(503, 'room_unavailable', 'the board could not be read to find the cards; nothing was written — try again');
    }
    const cardIds = asked.cardIds.filter((c) => onBoard.cards.has(c));
    if (!cardIds.length) throw fail(404, 'not_found', 'none of those cards is on this board');
    const live = (t) => t.row && !isDeadTag(t.row);
    // One entry per tag: a tag named once and also given by its id is one tag.
    const once = (list) => list.filter((t, i) => !t.row || list.findIndex((u) => u.row?.id === t.row.id) === i);
    const askedAdd = matchTags(asked.add, rows);
    const add = once(askedAdd.filter((t) => t.row || !t.id));
    const remove = matchTags(asked.remove, rows);
    const notFoundTags = [
      ...askedAdd.filter((t) => t.id && !t.row),
      ...remove.filter((t) => !live(t)),
    ].map((t) => t.name);
    const both = add.find((t) => t.row && remove.some((r) => live(r) && r.row.id === t.row.id));
    if (both) throw fail(400, 'bad_request', `${both.name} is both added and removed: leave it out of one`);
    const takeOff = once(remove.filter(live));

    // The tags to add: made where the workspace has none of the name, brought
    // back where it has a deleted one.
    await Promise.all(add.map(async (t) => {
      if (!t.row) Object.assign(t, await makeTag(env, token, ws, auth.userId, t));
      else if (isDeadTag(t.row)) {
        await userRpc(env, token, 'restore_tag', { p_tag_id: t.row.id });
        t.row = { ...t.row, status: 'active', deleted_at: null };
        t.revived = true;
      }
    }));

    // Which of the cards carry which of the tags now.
    const tagIds = [...add, ...takeOff].map((t) => t.row.id);
    const cardList = encodeURIComponent(pgInList(cardIds));
    const carried = new Set(tagIds.length ? (await selectAll(env, token, 'entity_links',
      `source_kind=eq.card&source_board_id=eq.${id}&target_kind=eq.tag&link_kind=eq.applied`
      + `&target_id=in.(${tagIds.join(',')})&source_id=in.${cardList}&select=source_id,target_id&order=id.asc`))
      .map((l) => `${l.target_id}|${l.source_id}`) : []);

    // Off: the applications go, whoever made them, and each pair is kept off.
    const removed = takeOff.map((t) => ({ tag: t, cards: cardIds.filter((c) => carried.has(`${t.row.id}|${c}`)) }));
    if (removed.some((r) => r.cards.length)) {
      await userDelete(env, token, 'entity_links', `source_kind=eq.card&source_board_id=eq.${id}`
        + `&target_kind=eq.tag&link_kind=eq.applied&target_id=in.(${takeOff.map((t) => t.row.id).join(',')})`
        + `&source_id=in.${cardList}`);
      await userInsert(env, token, 'autotag_ignored', removed.flatMap((r) => r.cards.map((c) => ({
        workspace_id: ws, target_kind: 'card', target_id: c, tag_id: r.tag.row.id, ignored_by: auth.userId,
      }))), { returning: 'minimal', onConflict: 'workspace_id,target_kind,target_id,tag_id' });
    }

    // On: an application for each pair not already there, as the person's
    // own (source 'user'), and any earlier "keep it off" lifted.
    const added = add.map((t) => ({ tag: t, cards: cardIds.filter((c) => !carried.has(`${t.row.id}|${c}`)) }));
    const links = added.flatMap((a) => a.cards.map((c) => ({
      source_kind: 'card', source_id: c, source_workspace: ws, source_board_id: id,
      target_kind: 'tag', target_id: a.tag.row.id, link_kind: 'applied', source: 'user',
    })));
    if (links.length) {
      try {
        await userInsert(env, token, 'entity_links', links, { returning: 'minimal' });
      } catch (e) {
        // Someone put one of them on meanwhile: the rest, one at a time.
        if (!isDuplicate(e)) throw e;
        await mapWithConcurrency(links, 8, (l) => userInsert(env, token, 'entity_links', [l], { returning: 'minimal' })
          .catch((err) => { if (!isDuplicate(err)) throw err; }));
      }
    }
    if (add.length) {
      await userDelete(env, token, 'autotag_ignored', `workspace_id=eq.${ws}&target_kind=eq.card`
        + `&tag_id=in.(${add.map((t) => t.row.id).join(',')})&target_id=in.${cardList}`);
    }

    // A new tag then finds the rest of what it names across the workspace, as
    // one made in the app does (ensureTag), once this call's own are written.
    for (const t of add.filter((x) => x.created)) {
      const spread = userRpc(env, token, 'backfill_tag_applications', { p_tag_id: t.row.id, p_workspace_id: ws })
        .catch(() => {});
      if (ctx.waitUntil) ctx.waitUntil(spread);
      else await spread;
    }

    return json({
      board_id: id,
      added: added.map((a) => ({
        ...publicTag(a.tag.row), created: Boolean(a.tag.created), ...(a.tag.revived ? { revived: true } : {}),
        card_ids: a.cards,
      })),
      removed: removed.map((r) => ({ ...publicTag(r.tag.row), card_ids: r.cards })),
      not_found: { card_ids: asked.cardIds.filter((c) => !onBoard.cards.has(c)), tags: notFoundTags },
      url: boardUrl(url.origin, id),
    });
  }

  if (sub !== 'cards') throw fail(404, 'not_found', 'unknown endpoint');

  // ── /boards/:id/cards ──────────────────────────────────────────────────────
  const board = await boardForUser(env, token, id);
  if (!board) throw fail(404, 'not_found', 'board not found');

  if (!subId && method === 'GET') {
    trace.route = '/boards/:id/cards';
    const { limit, offset } = pageParams(url);
    const include = parseInclude(url, ['props', 'identifiers', 'raw', 'groups', 'seen']);

    // ?source=index — the projection in card_index instead of the Y.Doc.
    //
    // The default below is the truth and stays the default, but it costs a
    // whole-document load per call: `limit`/`offset` there are applied AFTER
    // the board is in memory, so paging a large board re-downloads it once per
    // page and `total` is only knowable by reading all of it. That is fine for
    // a hundred cards and quadratic for a migration verifying a million.
    //
    // card_index is already the row-per-card mirror the triple write maintains,
    // it is indexed on (board_id, card_id), and RLS covers it. It carries a
    // PROJECTION, not the card — enough to reconcile what exists, not enough to
    // rebuild one — so it is opt-in and says so.
    if (url.searchParams.get('source') === 'index') {
      const after = url.searchParams.get('cursor');
      const since = url.searchParams.get('since');
      // Same two modes as GET /boards: ordered by id for a full walk, by
      // updated_at for a change feed. The (board_id, updated_at) index added in
      // 0222 is what makes the second one cheap.
      const delta = !!since;
      let q = `board_id=eq.${id}&select=card_id,kind,title,body,meta,updated_at`
        + `&limit=${limit + 1}`;
      if (delta) {
        if (Number.isNaN(Date.parse(since))) {
          throw fail(400, 'bad_request', 'since must be an ISO timestamp');
        }
        q += `&updated_at=gte.${encodeURIComponent(since)}&order=updated_at.asc,card_id.asc`;
        if (after) {
          const [rawTs, cid] = String(after).split('|');
          const ts = readCursorTs(rawTs);
          if (!ts || !cid || Number.isNaN(Date.parse(ts))) {
            throw fail(400, 'bad_request', 'cursor must be a next_cursor from a previous response');
          }
          q += `&or=(updated_at.gt.${encodeURIComponent(ts)},`
             + `and(updated_at.eq.${encodeURIComponent(ts)},card_id.gt.${encodeURIComponent(cid)}))`;
        }
      } else {
        q += '&order=card_id.asc';
        if (after) q += `&card_id=gt.${encodeURIComponent(after)}`;
      }
      const rows = await userSelect(env, token, 'card_index', q);
      const page = paginate(rows, limit, 0);
      const last = page.items[page.items.length - 1];

      let cards = page.items.map((r) => {
        const pos = r.meta?.pos || {};
        return {
          id: r.card_id,
          kind: r.kind || 'note',
          title: r.title ?? null,
          body: r.body ?? null,
          x: pos.x ?? null, y: pos.y ?? null, w: pos.w ?? null, h: pos.h ?? null,
          image_key: keyFromSrc(r.meta?.src),
          url: r.meta?.url ?? null,
          updated_at: r.updated_at,
        };
      });
      if (include.has('props') || include.has('identifiers')) {
        const meta = await loadMeta(env, token, {
          boardId: id, objectType: 'card', objectIds: cards.map((c) => c.id),
        });
        cards = cards.map((c) => filterMeta(withMeta(c, meta.get(String(c.id)) || {}), include));
      }

      return json({
        board_id: id,
        source: 'index',
        cards,
        limit,
        has_more: page.has_more,
        next_cursor: page.has_more && last
          ? (delta ? `${cursorTs(last.updated_at)}|${last.card_id}` : last.card_id)
          : null,
      });
    }

    // Read through the live room when we can, so a card added seconds ago by a
    // collaborator is visible rather than missing until the next snapshot.
    // include=groups reads the board's groups in the same open.
    const { cards: all, groups } = include.has('groups')
      ? await readBoardCardsAndGroups(env, id, token)
      : { cards: await readBoardCards(env, id, token), groups: null };
    const slice = all.slice(offset, offset + limit + 1);
    const page = paginate(slice, limit, offset);
    return json({
      board_id: id,
      source: 'live',
      cards: await decorateCards(env, token, id, page.items, include),
      ...(groups ? { groups: groups.map(publicGroup) } : {}),
      total: all.length,
      ...pageMeta(page),
    });
  }

  // Below a card, only its doc is a route: /doc, /doc/pages and
  // /doc/pages/:pageId. Anything else used to fall through to the card itself,
  // so a PATCH meant for something deeper would have rewritten the card.
  const leaf = parts[4];
  const docPath = leaf === 'doc' && (parts.length === 5 || (parts[5] === 'pages' && parts.length <= 7));
  if (subId && leaf !== undefined && !docPath) {
    throw fail(404, 'not_found', 'unknown endpoint');
  }

  // GET /boards/:id/cards/:cardId — one card, as the list gives it.
  if (subId && !leaf && method === 'GET') {
    trace.route = '/boards/:id/cards/:cardId';
    const include = parseInclude(url, ['props', 'identifiers', 'raw', 'seen']);
    const card = (await readBoardCards(env, id, token)).find((c) => String(c.id) === subId);
    if (!card) throw fail(404, 'not_found', 'card not found');
    return json({
      board_id: id,
      card: (await decorateCards(env, token, id, [card], include))[0],
      url: cardUrl(url.origin, id, subId),
    });
  }

  // GET /boards/:id/cards/:cardId/doc?page=&max_chars= — a doc card's pages as
  // Markdown, read from its fragments in the board's document
  // (lib/docMarkdown.js): every page listed, the text bounded by max_chars,
  // one page by ?page= (with its hash as the ETag a rewrite names). Read only —
  // nothing here may create a page or a fragment on a board that someone may
  // have open.
  if (leaf === 'doc' && parts.length === 5) {
    if (method !== 'GET') {
      throw fail(405, 'method_not_allowed', `a doc is read here; its pages are written at /boards/${id}/cards/${subId}/doc/pages`);
    }
    trace.route = '/boards/:id/cards/:cardId/doc';
    const pageId = url.searchParams.get('page') || null;
    const rawMax = Number(url.searchParams.get('max_chars'));
    const maxChars = Math.max(1, Math.min(
      Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : DOC_READ.defaultChars, DOC_READ.maxChars));
    const out = await withBoardCards(env, id, token, ({ cards, doc }) => {
      const card = cards.find((c) => String(c.id) === subId);
      if (!card) return { missing: true };
      if ((card.kind || 'note') !== 'doc') return { kind: card.kind || 'note' };
      const scope = {
        pages: card.docPages, content: card.docPageContent,
        pageSheets: card.docPageSheets, sheetContent: card.docSheetContent,
      };
      return { title: card.title ?? null, read: readDocPages(doc, scope, { pageId, maxChars }) };
    });
    if (out.missing) throw fail(404, 'not_found', 'card not found');
    if (out.kind) {
      throw fail(400, 'bad_request', `card ${subId} is a ${out.kind}, not a doc — GET /boards/${id}/cards/${subId} reads it`);
    }
    if (!out.read) throw fail(404, 'not_found', 'this doc has no such page');
    return json({
      board_id: id,
      card_id: subId,
      title: out.title,
      url: cardUrl(url.origin, id, subId),
      page_count: out.read.total,
      pages: out.read.pages,
      complete: out.read.pages.every((p) => p.markdown !== null && !p.truncated),
    }, 200, pageId ? { etag: `"${out.read.pages[0].hash}"` } : {});
  }

  // POST …/doc/pages — pages added to a doc in Markdown, after the ones it has
  // or under parent_page_id. PATCH …/doc/pages/:pageId — one page rewritten
  // from Markdown, changed by exact-text edits, or renamed. Written through the
  // live room (see loadDocWrite), as the user who could have typed it.
  if (leaf === 'doc') {
    const pageId = parts[6] || null;
    if (method !== (pageId ? 'PATCH' : 'POST')) {
      throw fail(405, 'method_not_allowed', pageId
        ? `a page is changed with PATCH and read at GET /boards/${id}/cards/${subId}/doc?page=${pageId}`
        : `pages are added with POST and read at GET /boards/${id}/cards/${subId}/doc`);
    }
    await requireBoardWrite(env, token, id);
    const dw = await loadDocWrite();
    const writableDoc = (doc, ym) => {
      const problem = dw.docProblem(doc, ym);
      if (problem) throw fail(400, 'bad_request', `card ${subId} is ${problem}`);
    };
    const docUrl = cardUrl(url.origin, id, subId);

    if (!pageId) {
      trace.route = '/boards/:id/cards/:cardId/doc/pages';
      const pages = dw.preparePages(body.pages);
      const parentId = body.parent_page_id ?? null;
      if (parentId !== null && typeof parentId !== 'string') {
        throw fail(400, 'bad_request', 'parent_page_id must be the id of a page in this doc');
      }
      const out = await throughRoom(() => editCardLive(env, {
        boardId: id, userId: auth.userId, accessToken: token, cardId: subId,
        prepare: (doc, ym) => {
          writableDoc(doc, ym);
          if (parentId && !dw.currentPage(doc, ym, parentId)) throw fail(404, 'not_found', `this doc has no page ${parentId}`);
          return { images: dw.placeableImages(readCards(doc), ym) };
        },
        write: (doc, ym, { images }) => dw.writePages(doc, ym, pages, {
          parentId, userId: auth.userId, imageAllowed: pictureFrom(images),
        }),
      }));
      if (out.missing) throw fail(404, 'not_found', 'card not found');
      await indexDocPages(env, token, board.workspace_id, subId, out.result);
      return json({ board_id: id, card_id: subId, url: docUrl, pages: out.result.map(publicDocPage) }, 201);
    }

    trace.route = '/boards/:id/cards/:cardId/doc/pages/:pageId';
    const hasMarkdown = body.markdown !== undefined;
    const hasEdits = body.edits !== undefined;
    if (hasMarkdown && hasEdits) throw fail(400, 'bad_request', 'send markdown or edits, not both');
    if (body.title != null && typeof body.title !== 'string') throw fail(400, 'bad_request', 'title must be a string');
    if (!hasMarkdown && !hasEdits && body.title == null) {
      throw fail(400, 'bad_request', 'nothing to change: send markdown (the whole page), edits, or title');
    }
    const tokens = hasMarkdown ? dw.pageMarkdown(body.markdown) : null;
    // A whole-page rewrite names the page as it was read, so it can't erase a
    // change made since; edits name the exact text they change instead.
    const ifMatch = (request.headers.get('if-match') || '').replace(/^W\//, '').replace(/"/g, '').trim();
    const expected = (typeof body.page_hash === 'string' && body.page_hash.trim()) || ifMatch || null;
    if (hasMarkdown && !expected) {
      throw fail(400, 'bad_request',
        `a whole-page rewrite needs page_hash: the hash GET /boards/${id}/cards/${subId}/doc?page=${pageId} gives for the page`);
    }
    const changedSince = () => fail(409, 'page_changed', 'the page changed after it was read; read it again '
      + `(GET /boards/${id}/cards/${subId}/doc?page=${pageId}) and make the change to that`);

    let same = null;
    const out = await throughRoom(() => editCardLive(env, {
      boardId: id, userId: auth.userId, accessToken: token, cardId: subId,
      checkpoint: { action: 'api-edit-doc-page', card_id: subId, page_id: pageId },
      prepare: (doc, ym) => {
        writableDoc(doc, ym);
        const page = dw.currentPage(doc, ym, pageId);
        if (!page) throw fail(404, 'not_found', 'this doc has no such page');
        if (expected && page.hash !== expected) throw changedSince();
        const next = hasEdits ? dw.pageMarkdown(dw.applyTextEdits(page.markdown, body.edits)) : tokens;
        const imageAllowed = pictureFrom(dw.placeableImages(readCards(doc), ym));
        const plan = dw.planPageEdit(doc, ym, pageId, next, { title: body.title ?? null, imageAllowed });
        const { markdown: _m, truncated: _t, ...summary } = page;
        same = { page: summary, blocks: { kept: plan.old.length, removed: 0, added: 0 } };
        return { tokens: next, imageAllowed, hash: page.hash, unchanged: plan.unchanged };
      },
      // Checked again at the moment of writing: the room kept talking while
      // the checkpoint was saved.
      write: (doc, ym, prep) => {
        if (prep.tokens && dw.currentPage(doc, ym, pageId)?.hash !== prep.hash) throw changedSince();
        return dw.rewritePage(doc, ym, pageId, prep.tokens, {
          title: body.title ?? null, userId: auth.userId, imageAllowed: prep.imageAllowed,
        });
      },
    }));
    if (out.missing) throw fail(404, 'not_found', 'card not found');
    if (out.unchanged) return json({ board_id: id, card_id: subId, url: docUrl, ...same, changed: false });
    await indexDocPages(env, token, board.workspace_id, subId, [out.result.page]);
    return json({
      board_id: id,
      card_id: subId,
      url: docUrl,
      page: publicDocPage(out.result.page),
      blocks: out.result.blocks,
      changed: true,
    });
  }

  // Everything below mutates cards, so it takes the explicit route: the Y.Doc
  // path runs as service role and RLS will not save us here.
  if (method !== 'GET') await requireBoardWrite(env, token, id);

  // POST /boards/:id/cards — append
  if (!subId && method === 'POST') {
    trace.route = '/boards/:id/cards';
    const incoming = Array.isArray(body.cards) ? body.cards : [body];
    if (!incoming.length) throw fail(400, 'bad_request', 'cards is required');
    if (incoming.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    // Normalized BEFORE the board is opened so a bad `kind` is a clean 400
    // rather than a rejection halfway through a Y.Doc transaction.
    const batch = Array.isArray(body.cards);
    const warnings = [];
    const built = incoming.map((c, i) => {
      try {
        return normalizeIncomingCard(c, { warn: (m) => warnings.push(`cards[${i}]: ${m}`) });
      } catch (e) {
        if (batch) e.message = `cards[${i}]: ${e.message}`;
        throw e;
      }
    });
    await sizePictures(env, token, incoming, built);
    // Sections named by name, made with their cards, and group ids checked on
    // the board (sectionsFor). null when no card names a group.
    const plan = sectionsFor(incoming, built, body, { userId: auth.userId });
    const metas = incoming.map((c, i) => {
      try {
        return metaFromBody(c);
      } catch (e) {
        e.message = `cards[${i}]: ${e.message}`;
        throw e;
      }
    });

    // on_conflict: "identifier" — a card that already carries one of these
    // identifiers is UPDATED rather than added a second time. This is what lets
    // an importer re-run over three million assets without producing six.
    if (body.on_conflict === 'identifier') {
      const upsertLayout = layoutOptionsFrom(body);
      const all = metas.flatMap((m) => m.identifiers || []);
      const matches = await matchIdentifiers(env, token, {
        workspaceId: board.workspace_id, objectType: 'card', identifiers: all,
      });
      // An identifier row outlives its card when the card is deleted or moved
      // off its board in the app — only the API's own delete purges metadata.
      // Left in place, a match on ANOTHER board refused the item with a 409
      // naming a card that no longer exists there, forever. Check those boards'
      // documents and free what names nothing. (Matches on THIS board are
      // checked against its document below, by the update itself.)
      await dropStaleForeignMatches(env, token, matches, id);
      const resolvedHits = resolveUpsert(
        metas.map((m) => ({ identifiers: m.identifiers })),
        matches, { objectType: 'card', boardId: id },
      );

      const updateIdx = [];
      const createIdx = [];
      resolvedHits.forEach((r, i) => (r.existing ? updateIdx : createIdx).push(i));

      // Existing cards first, in ONE board open — see updateCardsOnBoard.
      //
      // It answers POSITIONALLY, with null for a card that is not on the board.
      // That null has to stay in place: filtering it out shifted every later
      // result one slot, so the next item's identifiers were written onto the
      // wrong card and the stale value then collided with itself (409, after
      // the card writes had landed), and the following run duplicated cards.
      // An item whose matched card is gone is re-created instead, once the
      // dead card's metadata is purged so its identifiers are free again.
      const updatedById = new Map();
      if (updateIdx.length) {
        const out = await updateCardsOnBoard(env, {
          boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
          ...(plan ? { prepare: plan.prepare } : {}),
          patches: updateIdx.map((i) => ({
            cardId: resolvedHits[i].existing.object_id,
            patch: (before, prepared) => {
              const fields = normalizeIncomingCard(incoming[i], {
                partial: true, existingKind: before?.kind, before,
                warn: (m) => warnings.push(`cards[${i}]: ${m}`),
              });
              return plan ? plan.assign(fields, i, prepared) : fields;
            },
          })),
        });
        const gone = [];
        updateIdx.forEach((i, n) => {
          if (out[n]) updatedById.set(i, out[n]);
          else gone.push(i);
        });
        if (gone.length) {
          await purgeCardMeta(env, token, {
            boardId: id, cardIds: gone.map((i) => resolvedHits[i].existing.object_id),
          });
          createIdx.push(...gone);
          createIdx.sort((a, b) => a - b);
        }
      }

      let createdCards = [];
      if (createIdx.length) {
        const fresh = createIdx.map((i) => built[i]);
        const positionedFresh = !upsertLayout && !plan
          && fresh.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
        const res = await addCardsToBoard(env, {
          boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
          ...(positionedFresh ? { appendCards: fresh } : {}),
          ...(plan ? { prepare: plan.prepare } : {}),
          buildCards: async (existing, prepared) => layoutCards(
            plan ? tintNewNotes(createIdx.map((i) => plan.assign(built[i], i, prepared)), existing, prepared?.colours)
              : fresh,
            existing, upsertLayout, { order: prepared?.order },
          ),
        });
        createdCards = res.cards;
      }

      // Map each response position back to the card that ended up there, so the
      // caller can pair its input with what happened to it.
      const createdById = new Map(createdCards.map((c, n) => [createIdx[n], c]));
      const finalCards = incoming.map((_, i) => createdById.get(i) || updatedById.get(i)).filter(Boolean);
      embedAfterWrite(env, ctx, board.workspace_id, id, finalCards);

      await saveMetaBulk(env, token, {
        workspaceId: board.workspace_id, boardId: id, objectType: 'card',
        userId: auth.userId,
        entries: incoming.map((_, i) => {
          const card = createdById.get(i) || updatedById.get(i);
          return card
            ? { objectId: card.id, props: metas[i].props, identifiers: metas[i].identifiers }
            : null;
        }).filter(Boolean),
      });

      return json({
        board_id: id,
        cards: finalCards.map(publicCard),
        created: createIdx.length,
        updated: updatedById.size,
        ...(plan?.named ? { groups: publicSections(plan) } : {}),
        ...(warnings.length ? { warnings } : {}),
        live: true,
      }, 201);
    }

    // THE SCALING RULE, and it is a contract worth stating plainly: a batch in
    // which EVERY card carries its own x and y is appended without reading the
    // board at all — O(batch), the same cost on a board of ten cards and a
    // board of a hundred thousand. Leave out coordinates and we have to load
    // the whole document to lay out around what is already there, which is
    // correct, convenient, and O(board).
    //
    // A bulk import always knows where it wants things, so it always gets the
    // fast path. An assistant adding one note does not, and should not have to.
    // A named layout has to read the board to arrange around what is there, so
    // it gives up the O(batch) fast path. That is the caller's explicit choice.
    // Naming a group reads the board too: its name has to be looked up, or a
    // group_id checked, on the board it lands on.
    const layoutOpts = layoutOptionsFrom(body);
    const positioned = !layoutOpts && !plan && built.every((c) => Number.isFinite(c.x) && Number.isFinite(c.y));

    const result = await addCardsToBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      ...(positioned ? { appendCards: built } : {}),
      ...(plan ? { prepare: plan.prepare } : {}),
      // Positioned by the same helper Scout uses, so cards arriving from an API
      // call cannot land on top of what is already there. A caller that supplied
      // explicit x/y keeps them. A note sent with no colour, in a section with
      // one, takes the section's tint when the board tints its notes
      // (lib/boardStyle.js).
      buildCards: async (existing, prepared) => layoutCards(
        plan ? tintNewNotes(built.map((c, i) => plan.assign(c, i, prepared)), existing, prepared?.colours) : built,
        existing, layoutOpts, { order: prepared?.order },
      ),
    });

    embedAfterWrite(env, ctx, board.workspace_id, id, result.cards);

    // Metadata is keyed on the card id the server assigned, so it can only be
    // written once the cards exist.
    await saveMetaBulk(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card',
      userId: auth.userId,
      entries: result.cards.map((c, i) => ({
        objectId: c.id, props: metas[i]?.props, identifiers: metas[i]?.identifiers,
      })),
    });

    // An image uploaded through /uploads has no card_id on its images row: the
    // row is written before the card exists. That is FINE, and deliberately not
    // patched afterwards.
    //
    // What keeps the R2 object alive is recompute_image_refs, which derives
    // referenced_in_board_ids by scanning board_state.doc for r2: keys
    // (_r2_keys_in_doc) — not from card_id and not from card_index. So the
    // card's own `src` is the reference, and the triple write has already
    // persisted it. Verified end to end: after an upload + card create, the
    // image's ref_count is 1 and its board is in referenced_in_board_ids.
    //
    // A first version of this file did patch card_id here, and it silently did
    // nothing every time — `images` has no UPDATE policy, so RLS denies it, and
    // the .catch() swallowed the refusal. It bought nothing and hid a failure.
    // Adding an UPDATE policy to make it work would widen the client-writable
    // surface of that table for a field nothing reads.
    return json({
      board_id: id,
      cards: result.cards.map(publicCard),
      // The sections the add named, each with its id and whether it was made.
      ...(plan?.named ? { groups: publicSections(plan) } : {}),
      // What landed but won't look as asked (a note too long to show whole).
      ...(warnings.length ? { warnings } : {}),
      // Honest about what happened: false means the cards are durable but an
      // already-open canvas will not show them until it reloads.
      live: result.live,
    }, 201);
  }

  // PATCH /boards/:id/cards — bulk patch
  //
  // ONE board open for the whole batch, not one per card. The second pass of a
  // re-runnable import is exactly this shape, and updateCardOnBoard opens,
  // syncs, commits and closes each time — fine for one card, ruinous for five
  // hundred.
  if (!subId && method === 'PATCH') {
    trace.route = '/boards/:id/cards';
    const incoming = Array.isArray(body.cards) ? body.cards : [];
    if (!incoming.length) throw fail(400, 'bad_request', 'cards is required');
    if (incoming.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    const ids = incoming.map((c, i) => {
      const cid = String(c?.id ?? '').trim();
      if (!cid) throw fail(400, 'bad_request', `cards[${i}].id is required`);
      return cid;
    });
    const metas = incoming.map((c, i) => {
      try {
        return metaFromBody(c);
      } catch (e) {
        e.message = `cards[${i}]: ${e.message}`;
        throw e;
      }
    });

    // A section by name, or a group_id checked on the board (sectionsFor).
    const warnings = [];
    const refs = incoming.map((c) => ({ groupId: c?.group_id ? str(c.group_id, 100) : null }));
    const plan = sectionsFor(incoming, refs, body, { userId: auth.userId, partial: true });
    const out = await updateCardsOnBoard(env, {
      boardId: id, workspaceId: board.workspace_id, userId: auth.userId, accessToken: token,
      ...(plan ? { prepare: plan.prepare } : {}),
      patches: incoming.map((c, i) => ({
        cardId: ids[i],
        patch: (before, prepared) => {
          let fields;
          try {
            fields = normalizeIncomingCard(c, {
              partial: true, existingKind: before?.kind, before,
              warn: (m) => warnings.push(`cards[${i}]: ${m}`),
            });
          } catch (e) {
            e.message = `cards[${i}]: ${e.message}`;
            throw e;
          }
          return plan ? plan.assign(fields, i, prepared) : fields;
        },
      })),
    });

    embedAfterWrite(env, ctx, board.workspace_id, id, out.filter(Boolean));

    await saveMetaBulk(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card', userId: auth.userId,
      entries: out.map((c, i) => (c
        ? { objectId: c.id, props: metas[i].props, identifiers: metas[i].identifiers }
        : null)).filter(Boolean),
    });

    // A card id that was not on the board is reported, not silently dropped —
    // a bulk patch that quietly does nothing for some of its input is worse
    // than one that fails.
    const missing = ids.filter((_, i) => !out[i]);
    return json({
      board_id: id,
      cards: out.filter(Boolean).map(publicCard),
      updated: out.filter(Boolean).length,
      not_found: missing,
      ...(plan?.named ? { groups: publicSections(plan) } : {}),
      ...(warnings.length ? { warnings } : {}),
    });
  }

  // DELETE /boards/:id/cards — bulk delete
  if (!subId && method === 'DELETE') {
    trace.route = '/boards/:id/cards';
    const cardIds = (Array.isArray(body.card_ids) ? body.card_ids : []).map(String).filter(Boolean);
    if (!cardIds.length) throw fail(400, 'bad_request', 'card_ids is required');
    if (cardIds.length > MAX_CARDS_PER_CALL) {
      throw fail(400, 'bad_request', `at most ${MAX_CARDS_PER_CALL} cards per call`);
    }
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds,
    });
    await purgeCardMeta(env, token, { boardId: id, cardIds });
    // Every removed card comes back in full, for the same reason the single
    // delete does it: an HTTP client has no undo toast, so the response body IS
    // the undo.
    return json({
      deleted: removed.length,
      cards: removed.map(publicCard),
      not_found: cardIds.filter((c) => !removed.some((r) => String(r.id) === c)),
      restore_with: `POST /api/v1/boards/${id}/cards`,
      ...notRestorable(removed),
    });
  }

  // /boards/:id/cards/move
  if (subId === 'move' && method === 'POST') {
    trace.route = '/boards/:id/cards/move';
    const to = body.to_board_id;
    if (!isUuid(to)) throw fail(400, 'bad_request', 'to_board_id must be a uuid');
    const cardIds = (Array.isArray(body.card_ids) ? body.card_ids : []).map(String).filter(Boolean);
    if (!cardIds.length) throw fail(400, 'bad_request', 'card_ids is required');

    const dest = await boardForUser(env, token, to);
    if (!dest) throw fail(404, 'not_found', 'destination board not found');
    await requireBoardWrite(env, token, to);

    // Cards moved onto another meter cost what an insert would there, and the
    // card_index trigger refuses a move past its cap (0403). It refuses after
    // the destination board is already written, though, which would leave the
    // cards on both boards, so ask first. A team's workspaces share the team's
    // meter, and a personal workspace is on its owner's (0537).
    if (dest.workspace_id !== board.workspace_id) {
      const spaces = await scoutSelect(env, 'workspaces',
        `id=in.(${board.workspace_id},${dest.workspace_id})&select=id,created_by,org_id`).catch(() => []);
      const meterOf = (ws) => {
        const w = spaces.find((s) => s.id === ws);
        return w ? (w.org_id ? `org:${w.org_id}` : w.created_by) : null;
      };
      if (meterOf(board.workspace_id) !== meterOf(dest.workspace_id)) {
        const capRows = await userRpc(env, token, 'get_board_capacity', { p_board_id: to }).catch(() => null);
        const cap = Array.isArray(capRows) ? capRows[0] : capRows;
        if (cap?.is_capped === true && cap.cap != null) {
          const ids = cardIds.map((c) => `"${c.replace(/"/g, '')}"`).join(',');
          const rows = await userSelect(env, token, 'card_index',
            `board_id=eq.${id}&card_id=in.${encodeURIComponent(`(${ids})`)}&select=weight`).catch(() => []);
          const cost = rows.reduce((n, r) => n + Math.max(0, Number(r.weight) || 0), 0);
          if (Number(cap.used ?? 0) + cost > Number(cap.cap)) {
            throw fail(402, 'limit_reached',
              `those cards would take the destination board's owner past their limit of ${cap.cap} cards`);
          }
        }
      }
    }

    const out = await moveCardsBetweenBoards(env, {
      fromBoardId: id,
      toBoardId: to,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      cardIds,
      layout: async (existing, moving) => arrangeExisting({ existingCards: existing, cards: moving }),
    });

    // Metadata rows carry board_id so RLS can be can_read_board without
    // recursing, which means a move has to repoint them — otherwise they end up
    // readable only by someone who can read a board the card is no longer on.
    //
    // The destination id can differ from the source id: moveCardsBetweenBoards
    // renames a card on collision. It reports each (from, to) in `pairs`; the
    // request's card_ids cannot be zipped with `moved`, which is in board order
    // and leaves out any id that was not on the board.
    await repointCardMeta(env, token, {
      fromBoardId: id,
      toBoardId: to,
      workspaceId: dest.workspace_id,
      idPairs: out.pairs || [],
    });

    // Stars and file shares follow a card by (board, id) too. repoint_card_refs
    // runs AS THE CALLER, and identical ids are included so a same-id move
    // still carries them to the new board. A move only, never a copy. It must
    // not fail a move that already happened.
    const refPairs = (out.pairs || []).map((p) => ({ from: p.from, to: p.to }));
    for (let i = 0; i < refPairs.length; i += 500) {
      try {
        await userRpc(env, token, 'repoint_card_refs', {
          p_from: id, p_to: to, p_pairs: refPairs.slice(i, i + 500),
        });
      } catch (e) {
        console.warn('repoint_card_refs failed after a card move', e?.message || e);
      }
    }

    return json({ moved: out.count, cards: out.moved.map(publicCard), live: out.live });
  }

  if (!subId) throw fail(405, 'method_not_allowed', 'method not allowed');

  // PATCH /boards/:id/cards/:cardId
  if (method === 'PATCH') {
    trace.route = '/boards/:id/cards/:cardId';
    const warnings = [];
    const plan = sectionsFor([body], [{ groupId: body?.group_id ? str(body.group_id, 100) : null }], {},
      { userId: auth.userId, partial: true });
    const updated = await updateCardOnBoard(env, {
      boardId: id,
      workspaceId: board.workspace_id,
      userId: auth.userId,
      accessToken: token,
      cardId: subId,
      ...(plan ? { prepare: plan.prepare } : {}),
      // A function, not an object: which text field a value lands in depends on
      // the kind of card being patched, and that is only known once the card has
      // been read. Passing an object here is what sent an image caption to
      // `body`, where nothing displays it.
      patch: (before, prepared) => {
        const fields = normalizeIncomingCard(body, {
          partial: true, existingKind: before?.kind, before, warn: (m) => warnings.push(m),
        });
        return plan ? plan.assign(fields, 0, prepared) : fields;
      },
    });
    if (!updated) throw fail(404, 'not_found', 'card not found');
    embedAfterWrite(env, ctx, board.workspace_id, id, [updated]);

    const meta = metaFromBody(body);
    await saveMeta(env, token, {
      workspaceId: board.workspace_id, boardId: id, objectType: 'card', objectId: subId,
      props: meta.props, identifiers: meta.identifiers, userId: auth.userId,
    });

    const include = parseInclude(url, ['props', 'identifiers', 'raw']);
    return json({
      card: (await decorateCards(env, token, id, [updated], include))[0],
      ...(warnings.length ? { warnings } : {}),
    });
  }

  // DELETE /boards/:id/cards/:cardId
  if (method === 'DELETE') {
    trace.route = '/boards/:id/cards/:cardId';
    const removed = await deleteCardsFromBoard(env, {
      boardId: id, accessToken: token, cardIds: [subId],
    });
    if (!removed.length) throw fail(404, 'not_found', 'card not found');

    // A card is a Y.Doc key, not a row, so nothing cascades for it. Without this
    // the deleted card's identifier would hold its (scope, value) forever and
    // the next import would fail to re-create the card it names.
    await purgeCardMeta(env, token, { boardId: id, cardIds: [subId] });

    // The removed card comes back in full. There is no undo toast on an HTTP
    // call, so the response body IS the undo: POST it back to restore it.
    return json({
      deleted: true,
      card: publicCard(removed[0]),
      restore_with: `POST /api/v1/boards/${id}/cards`,
      ...notRestorable(removed),
    });
  }

  throw fail(405, 'method_not_allowed', 'method not allowed');
}

// `next` is a ready-made offset rather than a cursor: these listings are
// stable-ordered and small, and an opaque cursor would be ceremony for a caller
// who mostly wants "give me the rest".
function pageMeta(page) {
  return {
    limit: page.limit,
    offset: page.offset,
    has_more: page.has_more,
    next_offset: page.has_more ? page.offset + page.limit : null,
  };
}
