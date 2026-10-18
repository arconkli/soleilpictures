// Source pins for the single-file share wiring: every entry point opens the
// dialog behind fileSharesAllowed(), App mounts the host behind it, and a
// file.* notification goes to /f/<token>. Reads source text only (the
// components import JSX and import.meta.env, which node --test cannot load).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('App mounts FileShareHost only behind fileSharesAllowed()', () => {
  const s = src('../App.jsx');
  assert.match(s, /import \{ FileShareHost \} from '\.\/components\/fileShare\/FileShareHost\.jsx'/);
  assert.match(s, /\{fileSharesAllowed\(\) && <FileShareHost \/>\}/);
  assert.equal(s.match(/<FileShareHost/g).length, 1);
});

const ENTRY_POINTS = {
  canvas: '../components/CanvasSurface.jsx',
  list: '../components/ListSurface.jsx',
};
for (const [surface, rel] of Object.entries(ENTRY_POINTS)) {
  test(`the ${surface} entry point opens the dialog behind fileSharesAllowed()`, () => {
    const s = src(rel);
    assert.match(s, /fileSharesAllowed\(\)/);
    assert.match(s, /isShareableCard\(/);
    assert.match(s, /openFileShare\(\{[^}]*surface: '/);
    assert.ok(s.includes(`surface: '${surface}'`), `surface '${surface}' is reported`);
    // The gate comes before the call, in source order.
    const at = s.indexOf('openFileShare({');
    assert.ok(at > -1 && s.slice(Math.max(0, at - 400), at).includes('fileSharesAllowed()'), 'gate sits just before the call');
  });
}

// The viewers' Share button (FileShareButton) replaced the plain buttons; the
// gates stay with each viewer.
const BUTTON_POINTS = {
  player: ['../components/film/FilmReview.jsx', /fileSharesAllowed\(\) && canEdit && boardId && cardId && isShareableCard\(card\) && \(\s*<FileShareButton variant="frv" surface="player"/],
  quicklook: ['../components/clusterBrowser/QuickLook.jsx', /canEdit && item\.boardId && !isPublicSurface\(\) && fileSharesAllowed\(\) && isShareableCard\(item\.card\) && \(\s*<FileShareButton [^>]*variant="ql" surface="quicklook"/],
};
for (const [surface, [rel, re]] of Object.entries(BUTTON_POINTS)) {
  test(`the ${surface} uses FileShareButton behind its gates`, () => {
    const s = src(rel);
    assert.match(s, re);
    assert.equal(s.match(/<FileShareButton/g).length, 1);
    assert.ok(!s.includes('openFileShare('), 'no second, plain Share button');
  });
}

test('FileShareButton opens the bus and keeps Shared neutral', () => {
  const s = src('../components/fileShare/FileShareButton.jsx');
  assert.match(s, /openFileShare\(\{ boardId, cardId, card: card \|\| \{ id: cardId \}, boardName, surface \}\)/);
  assert.match(s, /'Shared - manage sharing' : 'Share file'/);
  assert.match(s, /frv: \{ className: 'frv-iconbtn/);
  assert.match(s, /ql: \{ className: 'ql-btn/);
  assert.match(s, /lightbox: \{ className: 'lightbox-download lightbox-share/);
  assert.match(s, /pdfv: \{ className: 'pdfv-btn/);
  assert.ok(!/soleil/.test(src('../components/fileShare/fileShareButton.css')), 'no gold on the button');
});

test('CanvasSurface hands both viewers a shareTarget only behind every gate', () => {
  const s = src('../components/CanvasSurface.jsx');
  const gate = /\(canEdit && !isPublic && fileSharesAllowed\(\) && isShareableCard\(shareCard\)\)\s*\?\s*\{ boardId: board\.id, cardId: shareCard\.id/g;
  assert.equal(s.match(gate)?.length, 2, 'one gate per viewer');
  assert.match(s, /<ImageLightbox [^>]*shareTarget=\{shareTarget\}/);
  assert.match(s, /<PdfViewer [^>]*shareTarget=\{shareTarget\}/);
  assert.equal(s.match(/setPdfViewer\(\{ src: c\.pdfSrc, name: c\.name \|\| c\.title \|\| 'PDF', cardId: c\.id \}\)/g)?.length, 3);
});

test('the viewers draw the button only when handed a shareTarget', () => {
  const lb = src('../components/ImageLightbox.jsx');
  assert.match(lb, /shareTarget = null/);
  assert.match(lb, /\{shareTarget\?\.boardId && shareTarget\?\.cardId && \(\s*<FileShareButton variant="lightbox"/);
  const pdf = src('../components/PdfViewer.jsx');
  assert.match(pdf, /shareTarget = null/);
  assert.match(pdf, /\{!embedded && shareTarget\?\.boardId && shareTarget\?\.cardId && \(\s*<FileShareButton variant="pdfv"/);
  // Before Download, in the bar.
  assert.ok(pdf.indexOf('<FileShareButton') < pdf.indexOf('aria-label="Download"'));
});

test('the dialog never toasts, and tells the bus after a write', () => {
  const s = src('../components/fileShare/FileShareDialog.jsx');
  assert.ok(!/feedback\.toast|undoToast|useOptionalFeedback/.test(s), 'messages stay inline (.fsd-notice)');
  assert.match(s, /className="fsd-notice" role="status"/);
  assert.match(s, /notifyFileShareChanged\(\{ boardId, cardId \}\)/);
});

test('NotificationsPanel routes file.* kinds to /f/<token>', () => {
  const s = src('../components/NotificationsPanel.jsx');
  assert.match(s, /startsWith\('file\.'\)/);
  assert.match(s, /window\.open\('\/f\/' \+ encodeURIComponent\(n\.data\.token\)/);
  assert.match(s, /import \{ fileSharesAllowed \} from '\.\.\/lib\/appHost\.js'/);
  assert.match(s, /startsWith\('file\.'\) && n\.data\?\.token && fileSharesAllowed\(\)/);
});

test('the live notification toast opens a file.* share in /f/', () => {
  const s = src('../hooks/useNotifications.js');
  assert.match(s, /startsWith\('file\.'\)/);
  assert.match(s, /'\/f\/' \+ encodeURIComponent\(fileToken\)/);
  assert.match(s, /import \{ fileSharesAllowed \} from '\.\.\/lib\/appHost\.js'/);
  assert.match(s, /fileSharesAllowed\(\) && String\(payload\.kind/);
});

test('the share dialog backdrop ties the top-layer viewers (lightbox, PDF), on desktop and phone', () => {
  const css = src('../components/fileShare/fileShareDialog.css');
  const rules = css.match(/\.modal-shell-bg\.fsd-backdrop\s*\{[^}]*\}/g) || [];
  assert.equal(rules.length, 2);
  for (const r of rules) assert.match(r, /z-index:\s*2147483647/);
  assert.match(src('../components/fileShare/FileShareDialog.jsx'), /backdropClassName="fsd-backdrop"/);
});
