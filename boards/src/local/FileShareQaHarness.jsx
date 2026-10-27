// Dev-only harness for ?fileshareqa=<fixture>. The REAL <FileSharePage> over a
// fake of 0421's RPCs and the party's /file-share response, so
// tests/file-share.spec.js can drive every state, the viewers, the comment
// rail and the undo with no backend. main.jsx mounts it behind the literal
// import.meta.env.DEV guard, so none of this reaches a production bundle.
//
// window.__fileShareQa.calls records every api call as {fn, args}.
// A fixture may also carry: errors {fn: error} (that write fails), delayMs (the
// settings writes answer that late, so two can queue), shareSeq (the first
// fetchFileShare answers, in order, before `share`), staleAfterMs (the page's
// "these urls are old" threshold, so a spec can watch a viewer remount).
// FIXTURES holds every fixture; makeFakeApi(fixture) is exported so another
// harness view (the owner dialog) can share the same fake.
// A fixture with `viewer: 'lightbox' | 'pdf'` mounts that full-screen viewer
// with a shareTarget, plus a FileShareHost over the same fake, the way the
// canvas does: the Share button opens the dialog over the viewer.
// `mode: 'overlay'` mounts the in-app viewer (SharedFileHost) over a stand-in
// app with an "Open" button; `mode: 'shared-page'` mounts the Shared page over
// fake 0424 lists (fixture.withMe / fixture.byMe).
// The doc-* fixtures open a shared doc (DocShareView) on an in-memory room
// (fakeDocRoom): the doc as the room would send it, a hello, caught up.
// window.__fileShareQa.docRooms holds each room, so a spec can refuse a
// write (refuse(reason)), close it (end(code)), put a new card in the doc's
// place (restore(lines)) or bring in a thread one of its members wrote
// (thread({ body, author, authorId }) → its id). In an edit room every write
// this tab makes is judged by the real room's rule (validateGuestUpdate) on a
// copy of the doc written by another client, as its members' would be; what
// it refuses lands in window.__fileShareQa.refusals.
// `mode: 'shortcuts'` draws a shortcut card (components/cards/ShortcutCard.jsx)
// for each answer in fixture.shortcuts (token → the share's answer), and one
// on a public board.
import { useMemo, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { addCommentThread, addPage, cardScope, initCardDocStore } from '../lib/docState.js';
import { validateGuestUpdate } from '../lib/docRoomBridge.js';
import { ShortcutCard } from '../components/cards/ShortcutCard.jsx';
import { SharedFileHost } from '../components/fileShare/SharedFileHost.jsx';
import { SharedPage } from '../components/shared/SharedPage.jsx';
import { setSharedFilesSource } from '../hooks/useSharedFiles.js';
import { openSharedFile } from '../lib/sharedFileBus.js';
import { useFeedback } from '../components/AppFeedback.jsx';
import { FeedbackProvider } from '../components/AppFeedback.jsx';
import { FileSharePage } from '../components/fileShare/FileSharePage.jsx';
import { FileShareDialog } from '../components/fileShare/FileShareDialog.jsx';
import { FileShareHost } from '../components/fileShare/FileShareHost.jsx';
import { ImageLightbox } from '../components/ImageLightbox.jsx';
import { PdfViewer } from '../components/PdfViewer.jsx';

export const QA_TOKEN = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';

const MEDIA = {
  video: new URL('../../tests/fixtures/media/frames-vp9.mp4', import.meta.url).href,
  pdf: '/sample.pdf',
  image: '/landing/film-noir-look-book.webp',
  audio: '/sample-loop_120_Amin.wav',
};

const SHARED_BY = { name: 'Rae Okafor', avatar_url: null };
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const author = (name, color = '#4f8df8') => ({ name, avatar_url: null, color });

function comment(id, body, extra = {}) {
  return {
    id, body, deleted: false, at_ms: null, page: null, reply_to: null, resolved: false,
    created_at: iso(30), edited_at: null, on_current: true, mine: false,
    author: author('Rae Okafor'), can_delete: false, can_resolve: false, ...extra,
  };
}

function ok(file, extra = {}) {
  return {
    status: 'ok', access: 'comment', signed_in: true, can_comment: true, allow_download: true,
    file: { kind: 'file', name: 'File', mime: null, size: null, duration: null, page_count: null, ext: null, risky: false, ...file },
    shared_by: SHARED_BY, comment_count: 0, urls: {}, ttl: 21600, ...extra,
  };
}

// A shared doc: its share, its card, its rooms.
const DOC_SHARE_ID = '5d0c5d0c-0000-4000-8000-00000000d0c0';
const DOC_CARD = 'doc-qa-1';
const docRoom = (variant) => `${DOC_SHARE_ID}.${variant}.0123456789ab`;
function okDoc(extra = {}) {
  const canEdit = !!extra.can_edit;
  return {
    status: 'ok', access: 'view', signed_in: true, can_edit: false, edit_needs_sign_in: false, allow_download: false,
    file: { kind: 'doc', name: 'Pilot, revisions' }, room: docRoom(canEdit ? 'edit' : 'view'), card_key: DOC_CARD,
    shared_by: SHARED_BY, urls: {}, ttl: 21600, ...extra,
  };
}

// Shortcut cards, one token per state (the share cache is per token).
const SHORTCUT_TOKENS = {
  ok: '5c000000-0000-4000-8000-000000000001',
  doc: '5c000000-0000-4000-8000-000000000002',
  gone: '5c000000-0000-4000-8000-000000000003',
  noAccess: '5c000000-0000-4000-8000-000000000004',
  public: '5c000000-0000-4000-8000-000000000005',
};

const SHARED_TOKENS = {
  video: '1a2b3c4d-0000-4000-8000-000000000001',
  pdf: '1a2b3c4d-0000-4000-8000-000000000002',
  link: '1a2b3c4d-0000-4000-8000-000000000003',
  mine: '1a2b3c4d-0000-4000-8000-000000000004',
};

export const FIXTURES = {
  'shared-page': {
    mode: 'shared-page',
    withMe: [
      { token: SHARED_TOKENS.video, kind: 'video', name: 'Opening titles v3', ext: 'mp4', size: 2304, access: 'comment',
        allow_download: true, shared_by: SHARED_BY, source: 'person', shared_at: iso(90), opened_at: null, activity_at: null, unread: true },
      { token: SHARED_TOKENS.pdf, kind: 'pdf', name: 'Shooting script.pdf', ext: 'pdf', access: 'view',
        allow_download: false, shared_by: { name: 'Jun Park', avatar_url: null }, source: 'person', shared_at: iso(60 * 30), opened_at: iso(60 * 29), activity_at: null, unread: false },
      { token: SHARED_TOKENS.link, kind: 'file', name: 'Selects.zip', ext: 'zip', access: 'view',
        allow_download: true, shared_by: SHARED_BY, source: 'link', shared_at: iso(60 * 50), opened_at: iso(60 * 50), activity_at: null, unread: false },
    ],
    byMe: [
      { token: SHARED_TOKENS.mine, board_id: 'qa-board', board_name: 'Opening sequence', card_id: 'vid-qa', kind: 'video',
        name: 'Rough cut', link_access: 'view', allow_download: true, people_count: 2, people: ['a@example.com', 'b@example.com'], comment_count: 1, updated_at: iso(10) },
    ],
  },
  overlay: {
    mode: 'overlay',
    share: ok({ kind: 'video', name: 'Opening titles v3', mime: 'video/mp4', size: 2304, duration: 2, ext: 'mp4' },
      { access: 'comment', urls: { src: new URL('../../tests/fixtures/media/frames-vp9.mp4', import.meta.url).href } }),
    comments: [],
  },

  'video-comment': {
    share: ok({ kind: 'video', name: 'Opening titles v3', mime: 'video/mp4', size: 2304, duration: 2, ext: 'mp4' },
      { access: 'manage', comment_count: 3, urls: { src: MEDIA.video, download: `${MEDIA.video}#download` } }),
    comments: [
      comment('c-late', 'Hold this frame a beat longer', { at_ms: 1500, created_at: iso(50), mine: true, can_delete: true, can_resolve: true }),
      comment('c-early', 'Title card <b>x</b> comes in early', { at_ms: 500, created_at: iso(40), author: author('Jun Park', '#8e5cf7'), can_delete: true, can_resolve: true }),
      comment('c-reply', 'Agreed, two frames', { reply_to: 'c-early', created_at: iso(20), mine: true, can_delete: true }),
      comment('c-done', 'Fixed the colour', { at_ms: 1000, resolved: true, created_at: iso(60), can_delete: true, can_resolve: true }),
      comment('c-old', 'On the first cut', { at_ms: 200, on_current: false, created_at: iso(70), can_resolve: true }),
    ],
  },
  pdf: {
    share: ok({ kind: 'pdf', name: 'Treatment.pdf', mime: 'application/pdf', size: 48211, page_count: 3, ext: 'pdf' },
      { comment_count: 1, urls: { src: MEDIA.pdf, download: `${MEDIA.pdf}#download` } }),
    comments: [comment('p-1', 'Tighten this page', { page: 2 })],
  },
  image: {
    share: ok({ kind: 'image', name: 'Look book', mime: 'image/webp', size: 81234, ext: 'webp' },
      { access: 'view', can_comment: false, allow_download: false, comment_count: null, urls: { src: MEDIA.image, poster: MEDIA.image } }),
    comments: [],
  },
  audio: {
    share: ok({ kind: 'audio', name: 'Loop 120 A minor', mime: 'audio/wav', size: 400000, duration: 8, ext: 'wav' },
      { urls: { src: MEDIA.audio, download: `${MEDIA.audio}#download` } }),
    comments: [],
  },
  'file-risky': {
    share: ok({ kind: 'file', name: 'setup.exe', mime: 'application/x-msdownload', size: 1048576, ext: 'exe', risky: true },
      { access: 'view', can_comment: false, comment_count: null, urls: { download: '/sample.pdf#download' } }),
    comments: [],
  },
  'view-only': {
    share: ok({ kind: 'image', name: 'Still 04', mime: 'image/webp', size: 81234, ext: 'webp' },
      { access: 'view', signed_in: false, can_comment: false, allow_download: false, comment_count: null, urls: { src: MEDIA.image } }),
    comments: [],
  },
  'signed-out-comment': {
    share: ok({ kind: 'video', name: 'Rough cut', mime: 'video/mp4', size: 2304, duration: 2, ext: 'mp4' },
      { access: 'comment', signed_in: false, can_comment: false, comment_count: 1, urls: { src: MEDIA.video } }),
    comments: [comment('s-1', 'Love the opening', { at_ms: 500 })],
  },
  // The owner's dialog (Task 8): FileShareDialog over the fake settings calls.
  dialog: {
    dialog: true,
    share: { status: 'gone' },
    comments: [],
    card: { id: 'card-1', kind: 'video', title: 'Opening titles v3', src: 'r2:qa/opening.mp4', mime: 'video/mp4' },
    settings: {
      exists: true, token: QA_TOKEN, link_access: 'none', allow_download: true, comment_count: 0,
      people: [{ email: 'jun@example.com', role: 'comment', pending: false, name: 'Jun Park', avatar_url: null }],
    },
  },
  // Two queued writes that both fail: the dialog must end on the server's row.
  'dialog-fail': {
    dialog: true,
    share: { status: 'gone' },
    comments: [],
    card: { id: 'card-1', kind: 'video', title: 'Opening titles v3', src: 'r2:qa/opening.mp4', mime: 'video/mp4' },
    settings: {
      exists: true, token: QA_TOKEN, link_access: 'none', allow_download: true, comment_count: 0,
      people: [
        { email: 'jun@example.com', role: 'comment', pending: false, name: 'Jun Park', avatar_url: null },
        { email: 'sam@example.com', role: 'comment', pending: false, name: 'Sam Lee', avatar_url: null },
      ],
    },
    errors: {
      setFileShare: { code: 'P0001', hint: 'new_account_risky', message: 'new_account_risky' },
      setFileSharePerson: { code: 'P0001', message: 'offline' },
    },
    delayMs: 400,
  },
  // Urls count as old after 1.5s, so a refresh with new ones remounts the viewer.
  'video-stale': {
    share: ok({ kind: 'video', name: 'Opening titles v3', mime: 'video/mp4', size: 2304, duration: 2, ext: 'mp4' },
      { access: 'manage', comment_count: 1, urls: { src: MEDIA.video } }),
    comments: [comment('c-late', 'Hold this frame a beat longer', { at_ms: 1500, can_resolve: true })],
    staleAfterMs: 1500,
  },
  'pdf-stale': {
    share: ok({ kind: 'pdf', name: 'Treatment.pdf', mime: 'application/pdf', size: 48211, page_count: 3, ext: 'pdf' },
      { comment_count: 1, urls: { src: MEDIA.pdf } }),
    comments: [comment('p-1', 'Tighten this page', { page: 2 })],
    staleAfterMs: 1500,
  },
  // The signed-in read keeps answering auth_expired; the anonymous retry opens it.
  'auth-expired': {
    shareSeq: [{ status: 'auth_expired' }],
    share: ok({ kind: 'image', name: 'Look book', mime: 'image/webp', size: 81234, ext: 'webp' },
      { access: 'view', signed_in: false, can_comment: false, allow_download: false, comment_count: null, urls: { src: MEDIA.image } }),
    comments: [],
  },
  // The full-screen viewers with a Share button (the canvas's lightbox and
  // PDF viewer). Shared already (a person), so the image's button says Shared.
  'lightbox-share': {
    viewer: 'lightbox',
    share: { status: 'gone' },
    comments: [],
    card: { id: 'card-1', kind: 'image', title: 'Look book', src: 'r2:qa/look.webp' },
    media: MEDIA.image,
    settings: {
      exists: true, token: QA_TOKEN, link_access: 'none', allow_download: true, comment_count: 0,
      people: [{ email: 'jun@example.com', role: 'comment', pending: false, name: 'Jun Park', avatar_url: null }],
    },
  },
  // Not shared yet: the PDF's button says Share until the dialog adds someone.
  'pdf-share': {
    viewer: 'pdf',
    share: { status: 'gone' },
    comments: [],
    card: { id: 'card-2', kind: 'pdf', title: 'Treatment.pdf', pdfSrc: 'r2:qa/treatment.pdf' },
    media: MEDIA.pdf,
    settings: { exists: false },
  },
  // The /f/ page as someone who can manage the file: "Manage sharing".
  'manage-page': {
    share: ok({ kind: 'image', name: 'Look book', mime: 'image/webp', size: 81234, ext: 'webp' },
      { access: 'manage', board_id: 'qa-board', card_id: 'card-1', comment_count: 0, urls: { src: MEDIA.image } }),
    comments: [],
    settings: {
      exists: true, token: QA_TOKEN, link_access: 'view', allow_download: true, comment_count: 0, people: [],
    },
  },
  // A doc shared on its own (0426): read in the view room, edited in the edit
  // room, the link that edits once you sign in, and its owner's page.
  'doc-view': { share: okDoc(), comments: [] },
  'doc-edit': { share: okDoc({ access: 'edit', can_edit: true }), comments: [] },
  'doc-signed-out': { share: okDoc({ signed_in: false, edit_needs_sign_in: true }), comments: [] },
  // The same doc to edit, opened over the app (the Shared page, the bell).
  'doc-overlay': { mode: 'overlay', share: okDoc({ access: 'edit', can_edit: true }), comments: [] },
  'doc-manage': {
    share: okDoc({ access: 'manage', can_edit: true, allow_download: true, board_id: 'qa-board', card_id: DOC_CARD }),
    comments: [],
    settings: {
      exists: true, kind: 'doc', token: QA_TOKEN, link_access: 'edit', allow_download: false, comment_count: 0,
      people: [{ email: 'sam@example.com', role: 'edit', pending: false, name: 'Sam Rivera', avatar_url: null }],
    },
  },
  'doc-dialog': {
    dialog: true,
    card: { id: DOC_CARD, kind: 'doc', title: 'Pilot, revisions' },
    settings: { exists: false, kind: 'doc' },
  },
  // Shortcut cards in each state.
  shortcuts: {
    mode: 'shortcuts',
    share: { status: 'gone' },
    comments: [],
    shortcuts: {
      [SHORTCUT_TOKENS.ok]: ok({ kind: 'image', name: 'Look book', mime: 'image/webp', ext: 'webp' }, { urls: { src: MEDIA.image } }),
      [SHORTCUT_TOKENS.doc]: okDoc(),
      [SHORTCUT_TOKENS.gone]: { status: 'gone' },
      [SHORTCUT_TOKENS.noAccess]: { status: 'no_access', email: 'sam@example.com' },
      [SHORTCUT_TOKENS.public]: ok({ kind: 'video', name: 'Never asked for' }),
    },
  },
  gone: { share: { status: 'gone' }, comments: [] },
  'sign-in': { share: { status: 'sign_in' }, comments: [] },
  'no-access': { share: { status: 'no_access', email: 'sam@example.com' }, comments: [] },
  error: { share: { status: 'error' }, comments: [] },
};

let seq = 0;

// Whose comments a signed-in guest writes, here (the room checks it).
const QA_USER_ID = '9a9a9a9a-0000-4000-8000-00000000a11e';

// The doc's live room, in memory (see the header).
function fakeDocRoom(fx, log) {
  // What the doc's page says; restore(lines) puts a new card in its place,
  // as an undo of its delete or a doc-only restore would, and every room
  // after that starts from it.
  let lines = ['A quiet street before dawn. A van idles with its lights off.',
    'MARA checks her watch, then the mirror, then her watch again.'];
  return (ydoc, { room, onHello, onSync, onRefused, onEnd }) => {
    log('attachDocRoom', [room]);
    const share = fx.share || {};
    const awareness = new Awareness(ydoc);
    awareness.setLocalState({});
    // The doc as its members wrote it: another client's.
    const board = new Y.Doc();
    let pageId = null;
    const writeCard = () => board.transact(() => {
      const card = new Y.Map();
      board.getMap('cards').set(DOC_CARD, card);
      card.set('id', DOC_CARD);
      card.set('kind', 'doc');
      card.set('title', share.file?.name || 'Pilot, revisions');
      initCardDocStore(board, card);
      // The view room holds no comment threads.
      if (!share.can_edit) card.delete('docComments');
      const scope = cardScope(card);
      pageId = addPage(board, { name: 'Act one', scope });
      const block = (text, type = 'paragraph', attrs = {}) => {
        const el = new Y.XmlElement(type);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        el.insert(0, [new Y.XmlText(text)]);
        return el;
      };
      scope.content.get(pageId).insert(0, [
        block('Cold open', 'heading', { level: 2 }),
        ...lines.map((t) => block(t)),
      ]);
    });
    writeCard();
    // The room's copy, which judges this tab's writes as the real room does.
    const roomDoc = new Y.Doc();
    const start = Y.encodeStateAsUpdate(board);
    Y.applyUpdate(roomDoc, start, 'room');
    Y.applyUpdate(ydoc, start, 'room');
    const claims = new Set();
    const judge = (update, origin) => {
      if (origin === 'room' || !share.can_edit) return;
      const verdict = validateGuestUpdate(roomDoc, update, {
        cardKey: DOC_CARD, claims, userId: QA_USER_ID, displayName: 'Sam Rivera',
        trustedKeys: new Set(), maxBytes: 1024 * 1024,
      });
      if (!verdict.ok) {
        if (typeof window !== 'undefined' && window.__fileShareQa) (window.__fileShareQa.refusals ||= []).push(verdict.reason);
        onRefused(verdict.reason);
        return;
      }
      for (const c of verdict.clients || []) claims.add(c);
      Y.applyUpdate(roomDoc, update, 'room');
    };
    ydoc.on('update', judge);
    const restore = (next) => {
      if (Array.isArray(next) && next.length) lines = next.map(String);
      writeCard();
      const u = Y.encodeStateAsUpdate(board);
      Y.applyUpdate(roomDoc, u, 'room');
      Y.applyUpdate(ydoc, u, 'room');
    };
    // A thread one of the doc's members wrote, arriving from the room, on
    // the words `on` in the page (the comment mark, as the editor writes it).
    const thread = ({ body = 'Is it dawn already?', author = 'Rae Okafor', authorId = 'rae-okafor-0000', on = 'before dawn' } = {}) => {
      const scope = cardScope(board.getMap('cards').get(DOC_CARD));
      const id = addCommentThread(board, { pageId, body, author, authorId, authorColor: '#d9822b', scope });
      board.transact(() => {
        for (const el of scope.content.get(pageId).toArray()) {
          const text = el.get?.(0);
          const words = text instanceof Y.XmlText
            ? text.toDelta().map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('') : '';
          const at = words.indexOf(on);
          if (at >= 0) { text.format(at, on.length, { comment: { id } }); break; }
        }
      });
      const u = Y.encodeStateAsUpdate(board);
      Y.applyUpdate(roomDoc, u, 'room');
      Y.applyUpdate(ydoc, u, 'room');
      return id;
    };
    const handle = { room, refuse: (reason) => onRefused(reason), end: (code) => onEnd({ action: 'reask', code }), restore, thread };
    if (typeof window !== 'undefined' && window.__fileShareQa) (window.__fileShareQa.docRooms ||= []).push(handle);
    const timer = setTimeout(() => {
      onHello({ type: 'hello', me: { name: 'Sam Rivera', color: '#2fb67c' }, access: share.access,
                readOnly: !share.can_edit, variant: share.can_edit ? 'edit' : 'view' });
      onSync();
    }, 30);
    return {
      awareness, provider: null,
      whenSynced: async () => true,
      destroy() { clearTimeout(timer); ydoc.off('update', judge); try { awareness.destroy(); } catch (_) {} },
    };
  };
}

// A fake of the client API (lib/fileShares.js + the page's signOut). Comments
// live in memory so add/resolve/delete/restore round-trip through the list.
// The settings calls answer from fixture.settings, for the owner dialog.
export function makeFakeApi(fixture, calls = []) {
  const fx = fixture || { share: { status: 'gone' }, comments: [] };
  let comments = (fx.comments || []).map((c) => ({ ...c }));
  let share = fx.share;
  const shareSeq = (fx.shareSeq || []).slice();
  let settings = fx.settings ? JSON.parse(JSON.stringify(fx.settings)) : { exists: false };
  const log = (fn, args) => { calls.push({ fn, args }); };
  const res = (data) => Promise.resolve({ data, error: null });
  const err = (fn) => (fx.errors && fx.errors[fn]) || null;
  // A settings write's answer, after fx.delayMs (or its error).
  const later = (fn, make) => {
    const e = err(fn);
    const out = () => (e ? { data: null, error: e } : { data: make(), error: null });
    if (!fx.delayMs) return Promise.resolve(out());
    return new Promise((r) => setTimeout(() => r(out()), fx.delayMs));
  };

  return {
    calls,
    attachDocRoom: fakeDocRoom(fx, log),
    getSessionUserId: async () => QA_USER_ID,
    createDocImageResolver: () => ({ cached: () => null, resolve: async () => null, onAuthError() {} }),
    recheckDocRooms(token) { log('recheckDocRooms', [token]); return Promise.resolve(); },
    setShare(next) { share = next; },
    getShare() { return JSON.parse(JSON.stringify(share)); },
    fetchFileShare(token, opts) {
      log('fetchFileShare', opts === undefined ? [token] : [token, opts]);
      if (fx.shortcuts && fx.shortcuts[token]) return Promise.resolve(JSON.parse(JSON.stringify(fx.shortcuts[token])));
      const next = shareSeq.length ? shareSeq.shift() : share;
      return Promise.resolve(JSON.parse(JSON.stringify(next)));
    },
    listFileComments(token) {
      log('listFileComments', [token]);
      if (share?.status !== 'ok') return res({ status: share?.status || 'gone' });
      const live = comments.filter((c) => !c.deleted || comments.some((r) => r.reply_to === c.id && !r.deleted))
        .map((c) => (c.deleted ? { ...c, body: null } : c));
      return res({ status: 'ok', access: share.access, comments: live });
    },
    addFileComment(token, args) {
      log('addFileComment', [token, args]);
      if (err('addFileComment')) return Promise.resolve({ data: null, error: err('addFileComment') });
      const id = `new-${++seq}`;
      comments.push(comment(id, args.body, {
        at_ms: args.atMs ?? null, page: args.page ?? null, reply_to: args.replyTo ?? null,
        created_at: new Date().toISOString(), mine: true, can_delete: true,
        can_resolve: share?.access === 'manage' && !args.replyTo, author: author('You', '#2fb67c'),
      }));
      return res({ id });
    },
    resolveFileComment(id, resolved) {
      log('resolveFileComment', [id, resolved]);
      comments = comments.map((c) => (c.id === id ? { ...c, resolved: !!resolved } : c));
      return res(null);
    },
    deleteFileComment(id) {
      log('deleteFileComment', [id]);
      comments = comments.map((c) => (c.id === id ? { ...c, deleted: true } : c));
      return res(null);
    },
    restoreFileComment(id) {
      log('restoreFileComment', [id]);
      comments = comments.map((c) => (c.id === id ? { ...c, deleted: false } : c));
      return res(null);
    },
    markFileShareOpened(token) { log('markFileShareOpened', [token]); return res(true); },
    listSharedWithMe(opts) { log('listSharedWithMe', [opts]); return res({ items: fx.withMe || [], next_before: null }); },
    listMyFileShares(opts) { log('listMyFileShares', [opts]); return res({ items: fx.byMe || [] }); },
    fetchSharedThumbs(tokens) { log('fetchSharedThumbs', [tokens]); return Promise.resolve({}); },
    hideSharedFile(token, hidden) { log('hideSharedFile', [token, hidden]); return res(true); },
    stopFileShare(boardId, cardId) {
      log('stopFileShare', [boardId, cardId]);
      return res({ link_access: 'view', stopped_at: '2026-10-18T12:00:00.123456+00:00', people: 2 });
    },
    undoStopFileShare(boardId, cardId, opts) { log('undoStopFileShare', [boardId, cardId, opts]); return res(settings); },
    signOut() {
      log('signOut', []);
      // Survives the navigation to sign-in, so the spec can see it came first.
      try { sessionStorage.setItem('fileshareqa.signedOut', '1'); } catch (_) {}
      return Promise.resolve();
    },
    getFileShareSettings(boardId, cardId) { log('getFileShareSettings', [boardId, cardId]); return res(settings); },
    setFileShare(boardId, cardId, opts) {
      log('setFileShare', [boardId, cardId, opts]);
      return later('setFileShare', () => {
        settings = { ...settings, exists: true, token: settings.token || QA_TOKEN, link_access: opts?.linkAccess ?? settings.link_access ?? 'none',
          allow_download: opts?.allowDownload ?? settings.allow_download ?? true, people: settings.people || [] };
        return settings;
      });
    },
    addFileSharePeople(boardId, cardId, emails, role) {
      log('addFileSharePeople', [boardId, cardId, emails, role]);
      if (err('addFileSharePeople')) return Promise.resolve({ data: null, error: err('addFileSharePeople') });
      const valid = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
      const norm = (emails || []).map((e) => String(e).trim().toLowerCase());
      const added = norm.filter(valid);
      const skipped = norm.filter((e) => !valid(e));
      const people = (settings.people || []).filter((p) => !added.includes(p.email))
        .concat(added.map((email) => ({ email, role, pending: true, name: null, avatar_url: null })));
      settings = { ...settings, exists: true, token: settings.token || QA_TOKEN, link_access: settings.link_access || 'none', people };
      return res({ ...settings, added, skipped });
    },
    setFileSharePerson(boardId, cardId, email, role) {
      log('setFileSharePerson', [boardId, cardId, email, role]);
      return later('setFileSharePerson', () => {
        const people = (settings.people || []).filter((p) => p.email !== email);
        const prev = (settings.people || []).find((p) => p.email === email);
        settings = { ...settings, people: role ? [...people, { ...(prev || { email, pending: true, name: null, avatar_url: null }), role }] : people };
        return settings;
      });
    },
  };
}

// The in-app viewer over a stand-in app: Open dispatches openSharedFile, the
// way the Shared page and the bell do.
function OverlayView({ api }) {
  const feedback = useFeedback();
  return (
    <div style={{ padding: 24 }}>
      <button type="button" data-qa-open-shared="1" onClick={() => openSharedFile({ token: QA_TOKEN, via: 'shared_page' })}>Open shared file</button>
      <SharedFileHost api={api}
                      onAddShortcut={async ({ token, res }) => { api.calls.push({ fn: 'onAddShortcut', args: [token, res?.file?.kind || null] }); }}
                      onSaveCopy={async ({ token, res }) => {
                        api.calls.push({ fn: 'onSaveCopy', args: [token, res?.file?.kind || null] });
                        feedback.toast({ type: 'success', message: 'Saved to Opening sequence' });
                      }} />
    </div>
  );
}

function SharedPageView({ api }) {
  const feedback = useFeedback();
  return <SharedPage api={api} feedback={feedback} onClose={() => api.calls.push({ fn: 'onClose', args: [] })}
                     onAddShortcut={async ({ token, res }) => { api.calls.push({ fn: 'onAddShortcut', args: [token, res?.file?.kind || null] }); }}
                     onSaveCopy={async ({ token }) => { api.calls.push({ fn: 'onSaveCopy', args: [token] }); }} />;
}

export function FileShareQaHarness() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [viewerOpen, setViewerOpen] = useState(true);
  const name = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fileshareqa')) || '';
  const fixture = FIXTURES[name];
  const api = useMemo(() => {
    const a = makeFakeApi(fixture);
    if (typeof window !== 'undefined') window.__fileShareQa = { calls: a.calls, api: a, fixture: name };
    // The Shared page's store reads this fake instead of the RPCs.
    if (fixture?.mode === 'shared-page') setSharedFilesSource(a);
    return a;
  }, [fixture, name]);

  if (!fixture) {
    return (
      <div data-fileshareqa-ready="1" style={{ padding: 24, fontFamily: 'system-ui' }}>
        Unknown fixture “{name}”. Try: {Object.keys(FIXTURES).join(', ')}
      </div>
    );
  }
  if (fixture.mode === 'shared-page') {
    return (
      <FeedbackProvider>
        <div data-fileshareqa-ready="1" data-fixture={name} style={{ height: '100vh', display: 'flex' }}>
          <SharedPageView api={api} />
        </div>
      </FeedbackProvider>
    );
  }
  if (fixture.mode === 'shortcuts') {
    const box = { width: 240, height: 180, borderRadius: 12 };
    return (
      <FeedbackProvider>
        <div data-fileshareqa-ready="1" data-fixture={name}
             style={{ padding: 24, display: 'flex', flexWrap: 'wrap', gap: 20, background: 'var(--bg-0)', minHeight: '100vh' }}>
          {['ok', 'doc', 'gone', 'noAccess'].map((k) => (
            <div key={k} data-shortcut-fixture={k} style={box}>
              <ShortcutCard shareToken={SHORTCUT_TOKENS[k]} api={api}
                            onRemove={() => api.calls.push({ fn: 'onRemove', args: [k] })} />
            </div>
          ))}
          <div data-shortcut-fixture="public" style={box}>
            <ShortcutCard shareToken={SHORTCUT_TOKENS.public} api={api} isPublic />
          </div>
        </div>
      </FeedbackProvider>
    );
  }
  if (fixture.mode === 'overlay') {
    return (
      <FeedbackProvider>
        <div data-fileshareqa-ready="1" data-fixture={name}>
          <OverlayView api={api} />
        </div>
      </FeedbackProvider>
    );
  }
  if (fixture.viewer) {
    const shareTarget = { boardId: 'qa-board', cardId: fixture.card.id, card: fixture.card, boardName: 'Opening sequence', api };
    let viewer = <p data-fileshareqa-viewer-closed="1">Viewer closed</p>;
    if (viewerOpen && fixture.viewer === 'lightbox') {
      viewer = <ImageLightbox src={fixture.media} title={fixture.card.title} cardId={fixture.card.id}
                              shareTarget={shareTarget} onClose={() => setViewerOpen(false)} />;
    } else if (viewerOpen && fixture.viewer === 'pdf') {
      viewer = <PdfViewer src={fixture.media} name={fixture.card.title}
                          shareTarget={shareTarget} onClose={() => setViewerOpen(false)} />;
    }
    return (
      <FeedbackProvider>
        <div data-fileshareqa-ready="1" data-fixture={name}>
          {viewer}
          <FileShareHost api={api} />
        </div>
      </FeedbackProvider>
    );
  }
  if (fixture.dialog) {
    return (
      <FeedbackProvider>
        <div data-fileshareqa-ready="1" data-fixture={name}>
          {dialogOpen
            ? <FileShareDialog boardId="qa-board" card={fixture.card} boardName="Opening sequence" api={api} onClose={() => setDialogOpen(false)} />
            : <p data-fileshareqa-closed="1">Closed</p>}
        </div>
      </FeedbackProvider>
    );
  }
  return (
    <FeedbackProvider>
      <div data-fileshareqa-ready="1" data-fixture={name}>
        <FileSharePage token={QA_TOKEN} api={api}
                       {...(fixture.staleAfterMs != null ? { staleAfterMs: fixture.staleAfterMs } : {})} />
      </div>
    </FeedbackProvider>
  );
}

export default FileShareQaHarness;
