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
  quicklook: ['../components/clusterBrowser/QuickLook.jsx', /itemCanEdit && item\.boardId && !isPublicSurface\(\) && fileSharesAllowed\(\) && isShareableCard\(item\.card\) && \(\s*<FileShareButton [^>]*variant="ql" surface="quicklook"/],
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
  // The PDF viewer: this cluster's card.
  const gate = /\(canEdit && !isPublic && fileSharesAllowed\(\) && isShareableCard\(shareCard\)\)\s*\?\s*\{ boardId: board\.id, cardId: shareCard\.id/g;
  assert.equal(s.match(gate)?.length, 1, 'the PDF viewer gate');
  // The lightbox: this cluster's card, or a sub-cluster row's card, whose
  // rights are asked of that cluster.
  assert.match(s, /const mayEdit = fromChild \? !!canEditBoard\?\.\(shareBoardId\) : canEdit;/);
  assert.match(s, /\(mayEdit && !isPublic && fileSharesAllowed\(\) && isShareableCard\(shareCard\)\)\s*\?\s*\{ boardId: shareBoardId, cardId: shareCard\.id/);
  assert.match(s, /setLightbox\(\{ src: item\.src, title: item\.name, shareBoardId: c\.id, shareCard: item\.card \|\| null \}\)/);
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

// A file.* notification opens the file inside the app, over what you were
// doing: the Shared page's hold (sharedFilesAllowed) is open since the sidebar
// release (2026-10-21). The /f/ page in a tab is what the bell falls back to
// only if that hold is ever closed again.
test('the Shared page hold is open, so file.* notifications open in the app', () => {
  assert.match(src('./appHost.js'), /export function sharedFilesAllowed\(\) \{\n  return true;\n\}/);
});

test('NotificationsPanel opens file.* kinds in the app, else /f/<token>', () => {
  const s = src('../components/NotificationsPanel.jsx');
  assert.match(s, /import \{ fileSharesAllowed, sharedFilesAllowed \} from '\.\.\/lib\/appHost\.js'/);
  // The rule moved into lib/notificationsBell.js's notificationTarget (pinned
  // by notificationsBell.test.mjs): file.* with a token, behind the holds.
  assert.match(src('./notificationsBell.js'), /kind\.startsWith\('file\.'\) && n\.data\?\.token && fileShares\)/);
  assert.match(s, /notificationTarget\(n, \{ fileShares: fileSharesAllowed\(\), sharedFiles: sharedFilesAllowed\(\) \}\)/);
  assert.match(s, /if \(target\.inApp\) openSharedFile\(\{ token: target\.token, via: 'bell' \}\);\s+else window\.open\('\/f\/' \+ encodeURIComponent\(target\.token\)/);
});

test('the live notification toast opens a file.* share in the app, else /f/', () => {
  const s = src('../hooks/useNotifications.js');
  assert.match(s, /startsWith\('file\.'\)/);
  assert.match(s, /import \{ fileSharesAllowed, sharedFilesAllowed \} from '\.\.\/lib\/appHost\.js'/);
  assert.match(s, /fileSharesAllowed\(\) && String\(payload\.kind/);
  assert.match(s, /sharedFilesAllowed\(\)\s+\? openSharedFile\(\{ token: fileToken, via: 'toast' \}\)\s+: window\.open\('\/f\/' \+ encodeURIComponent\(fileToken\)/);
});

test('the share dialog backdrop ties the top-layer viewers (lightbox, PDF), on desktop and phone', () => {
  const css = src('../components/fileShare/fileShareDialog.css');
  const rules = css.match(/\.modal-shell-bg\.fsd-backdrop\s*\{[^}]*\}/g) || [];
  assert.equal(rules.length, 2);
  for (const r of rules) assert.match(r, /z-index:\s*2147483647/);
  assert.match(src('../components/fileShare/FileShareDialog.jsx'), /backdropClassName="fsd-backdrop"/);
});

// Every fullscreen view offers Share when you can edit that file's cluster
// (owner, 2026-10-18: "when i open ANY file full screen").
test('Quick look asks edit rights per file where it can cross clusters', () => {
  const ql = src('../components/clusterBrowser/QuickLook.jsx');
  assert.match(ql, /const itemCanEdit = item \? \(canEditItem \? !!canEditItem\(item\) : canEdit\) : false;/);
  assert.match(ql, /<DetailPanel inline [^>]*canEdit=\{itemCanEdit\}/);
  const sb = src('../components/sidebar/ClusterSidebar.jsx');
  assert.match(sb, /canEditItem=\{\(it\) => !!boardsSectionProps\?\.canEditBoard\?\.\(it\.boardId\)\}/);
  const ls = src('../components/ListSurface.jsx');
  assert.match(ls, /canEditItem=\{canEditBoard \? \(it\) => !!canEditBoard\(it\.boardId\) : null\}/);
  const app = src('../App.jsx');
  assert.match(app, /canEditBoard=\{canEditBoard\}\s+peersHereByBoard/);
  assert.match(app, /ydoc=\{yd\}\s+canEditBoard=\{canEditBoard\}/);
  assert.match(app, /setShareRightsResolver\(canEditBoard\);/);
});

test('viewers opened far from a pane share through shareTargetForRef', () => {
  for (const rel of ['../components/TagDetailView.jsx', '../components/EntityHoverPopover.jsx', '../components/TagRangeHoverPopover.jsx']) {
    const s = src(rel);
    assert.match(s, /<ImageLightbox[\s\S]{0,400}shareTarget=\{shareTargetForRef\(/, rel);
  }
  const tv = src('./tagVisuals.js');
  assert.match(tv, /boardId: hit2\.board_id \|\| r\.source_board_id \|\| null,/);
});

test('a plain file opens Quick look on the board instead of downloading', () => {
  const s = src('../components/CanvasSurface.jsx');
  assert.match(s, /if \(c\.kind === 'file'\) \{\s+if \(!c\.fileSrc \|\| c\.pending\) return;\s+e\.stopPropagation\(\);\s+setFileView\(\{ cardId: c\.id \}\);/);
  assert.match(s, /<QuickLook items=\{\[item\]\}[\s\S]{0,300}canEdit=\{canEdit && !isPublic\}/);
  assert.match(s, /opensOnBoard\n/);
  const fc = src('../components/cards/FileCard.jsx');
  assert.match(fc, /onDoubleClick=\{opensOnBoard \? undefined : download\}/);
});
