// markupParsing.test.mjs — every place the client turns a string into DOM
// nodes, and every iframe, is listed here with the reason it is fine.
//
// Card html (notes, grid cells), a peer's live edit and pasted html all come
// from other people. They reach the page only through sanitizeNoteHtml, and
// they are parsed for reading or rewriting only through inertContainer
// (lib/inertHtml.js) or a <template>. An embed becomes an iframe only through
// safeEmbed (lib/oembed.js).
//
// A new assignment fails this test until it is added to REVIEWED with its
// reason, so it gets looked at. A REVIEWED entry that no longer matches any
// line fails too, so the list stays true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SINK = /\.(innerHTML|outerHTML)\s*=(?!=)|insertAdjacentHTML\(|createContextualFragment\(|document\.write(ln)?\(|\.srcdoc\s*=|\bsrcDoc=/;

// [file under src/, a fragment unique to the line, why it is fine]
const REVIEWED = [
  ['lib/inertHtml.js', 'root.innerHTML = html', 'the inert parser itself'],
  ['lib/renderHtmlWithAutoLinks.jsx', 'wrapper.innerHTML = sanitizeNoteHtml(html)', 'sanitized'],
  ['lib/renderThumbnail.js', 'tmp.innerHTML = sanitizeNoteHtml(c.html)', 'sanitized'],
  ['components/NoteTiptapSurface.jsx', 'probe.innerHTML = sanitizeNoteHtml(html)', 'sanitized'],
  ['components/cards.jsx', 'root.innerHTML = source', 'a <template> (toggleChecklistInHtml)'],
  ['lib/googleFonts.js', 'tpl.innerHTML = String(html)', 'a <template>'],
  ['components/RichNoteEditor.jsx', 'ref.current.innerHTML = next', 'next is sanitizeNoteHtml output'],
  ['components/RichNoteEditor.jsx', 'ref.current.innerHTML = newHtml', "the editor's own content, relinked"],
  ['components/RichNoteEditor.jsx', 'ref.current.innerHTML = initialRef.current', "the editor's own content as seeded"],
  ['components/RichNoteEditor.jsx', 'preview.innerHTML = `<div class="note-link-preview-meta">', 'fixed markup, values escaped'],
  ['lib/noteLinkify.js', 'preview.innerHTML = `<div class="note-link-preview-meta">', 'fixed markup, values escaped'],
  ['lib/noteMeasure.js', 'el.innerHTML = bodyEl.innerHTML', 'a copy of nodes already on the page'],
  ['components/ToolOptionsBar.jsx', 'root.innerHTML = snapshotRef.current', "the editor's own content, restored"],
  ['auth/SignInBackdrop.jsx', 'el.innerHTML = cardInner(c)', 'built-in demo cards'],
  ['auth/SignInBackdrop.jsx', "el.innerHTML = ARROW.replace('COLOR', cu.color)", 'built-in demo cursors'],
  ['components/DocBlockHandle.jsx', "handle.innerHTML = '<svg", 'a fixed icon'],
  ['components/docExtensions/BoardEmbed.js', "dom.innerHTML = ''", 'clears'],
  ['components/docExtensions/BoardEmbed.js', "icon.innerHTML = '<svg", 'a fixed icon'],
  ['components/docExtensions/screenplay/ScreenplaySuggest.js', "el.innerHTML = ''", 'clears'],
  ['lib/exportBoard.js', 'w.document.write(`<!doctype html>', 'print window: the serialized board picture, title without < or >'],
  ['components/DocExportMenu.jsx', 'iframe.srcdoc = html', 'print frame: editor.getHTML() from the doc schema'],
];

// Files allowed to render an <iframe>, with the guard they must contain.
const IFRAMES = [
  ['components/cards.jsx', 'const embed = useMemo(() => safeEmbed(storedEmbed), [storedEmbed]);'],
];

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'local' || name === 'node_modules') continue;
      sources(p, out);
    } else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const FILES = sources(SRC).map((p) => ({ rel: relative(SRC, p), lines: readFileSync(p, 'utf8').split('\n') }));

test('every string-to-DOM assignment in the client is reviewed', () => {
  const unreviewed = [];
  const used = new Set();
  for (const { rel, lines } of FILES) {
    lines.forEach((line, i) => {
      if (!SINK.test(line)) return;
      const hit = REVIEWED.findIndex(([file, frag]) => file === rel && line.includes(frag));
      if (hit < 0) unreviewed.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      else used.add(hit);
    });
  }
  assert.deepEqual(unreviewed, [],
    'Parse stored or pasted html with inertContainer (lib/inertHtml.js), or render it through sanitizeNoteHtml, then add the line to REVIEWED with its reason.');
  const stale = REVIEWED.filter((_, i) => !used.has(i)).map(([file, frag]) => `${file}: ${frag}`);
  assert.deepEqual(stale, [], 'REVIEWED entries that match no line any more: remove them.');
});

test('iframes are rendered only where an embed is vetted first', () => {
  const found = [];
  for (const { rel, lines } of FILES) {
    if (lines.some((l) => /<iframe\b/.test(l) && !/^\s*(\/\/|\*)/.test(l))) found.push(rel);
  }
  assert.deepEqual(found.sort(), IFRAMES.map(([f]) => f).sort());
  for (const [file, guard] of IFRAMES) {
    const text = FILES.find((f) => f.rel === file).lines.join('\n');
    assert.ok(text.includes(guard), `${file} must vet its embed: ${guard}`);
  }
});

// Every window.open in the client, with why its address is safe. An address
// that comes from card, doc, link or entity data goes through openableUrl
// (http, https or mailto only) first.
const OPENERS = [
  ['App.jsx', "const u = openableUrl(ref?.href); if (u) window.open(u,", 'entity link, vetted'],
  ['App.jsx', "const u = openableUrl(target?.href); if (u) window.open(u,", 'Home graph link, vetted'],
  ['App.jsx', "window.open(`/c/${slug}`,", 'our own page'],
  ['App.jsx', "window.open('/docs',", 'our own page'],
  ['components/DocSurface.jsx', "if (u) window.open(u,", 'doc link, vetted'],
  ['components/cards.jsx', "if (u) window.open(u,", 'list item link, vetted'],
  ['components/cards.jsx', "window.open(openHref,", 'link card, vetted by openableUrl'],
  ['components/CanvasSurface.jsx', "window.open('/templates',", 'our own page'],
  ['components/CanvasSurface.jsx', "if (href) window.open(href,", 'link card menu, vetted by openableUrl'],
  ['components/StorageAddonSheet.jsx', "window.open(answer.hosted_invoice_url,", 'Stripe invoice address from our server'],
  ['components/NotificationsPanel.jsx', "window.open('/f/' + encodeURIComponent(", 'our own page'],
  ['hooks/useNotifications.js', "window.open('/f/' + encodeURIComponent(", 'our own page'],
  ['components/HelpHub.jsx', "window.open(path,", 'a help path from the built-in list'],
  ['components/gallery/SurfaceGallery.jsx', "window.open(url,", 'admin gallery route from its registry'],
  ['components/fileShare/FileShareDialog.jsx', "window.open(fileShareUrl(s.token),", 'our own page'],
  ['lib/exportBoard.js', "window.open('', '_blank')", 'a blank print window'],
  ['lib/checkout.js', "window.open('', '_blank')", 'a blank tab for Stripe checkout'],
  ['lib/cardDownload.js', "window.open(url,", 'download fallback, vetted by openableUrl'],
];

test('every window.open in the client is reviewed', () => {
  const unreviewed = [];
  const used = new Set();
  for (const { rel, lines } of FILES) {
    lines.forEach((line, i) => {
      if (!/window\.open\(/.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const hit = OPENERS.findIndex(([file, frag]) => file === rel && line.includes(frag));
      if (hit < 0) unreviewed.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      else used.add(hit);
    });
  }
  assert.deepEqual(unreviewed, [], 'Pass data-derived addresses through openableUrl, then add the line to OPENERS with its reason.');
  const stale = OPENERS.filter((_, i) => !used.has(i)).map(([file, frag]) => `${file}: ${frag}`);
  assert.deepEqual(stale, [], 'OPENERS entries that match no line any more: remove them.');
  const download = FILES.find((f) => f.rel === 'lib/cardDownload.js').lines.join('\n');
  assert.match(download, /const url = openableUrl\(await resolveSrc\(src\)\);/, 'the download fallback vets the address');
});
