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
import { useMemo, useState } from 'react';
import { FeedbackProvider } from '../components/AppFeedback.jsx';
import { FileSharePage } from '../components/fileShare/FileSharePage.jsx';
import { FileShareDialog } from '../components/fileShare/FileShareDialog.jsx';

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

export const FIXTURES = {
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
  gone: { share: { status: 'gone' }, comments: [] },
  'sign-in': { share: { status: 'sign_in' }, comments: [] },
  'no-access': { share: { status: 'no_access', email: 'sam@example.com' }, comments: [] },
  error: { share: { status: 'error' }, comments: [] },
};

let seq = 0;

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
    setShare(next) { share = next; },
    getShare() { return JSON.parse(JSON.stringify(share)); },
    fetchFileShare(token, opts) {
      log('fetchFileShare', opts === undefined ? [token] : [token, opts]);
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

export function FileShareQaHarness() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const name = (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fileshareqa')) || '';
  const fixture = FIXTURES[name];
  const api = useMemo(() => {
    const a = makeFakeApi(fixture);
    if (typeof window !== 'undefined') window.__fileShareQa = { calls: a.calls, api: a, fixture: name };
    return a;
  }, [fixture, name]);

  if (!fixture) {
    return (
      <div data-fileshareqa-ready="1" style={{ padding: 24, fontFamily: 'system-ui' }}>
        Unknown fixture “{name}”. Try: {Object.keys(FIXTURES).join(', ')}
      </div>
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
