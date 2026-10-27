// Every control a finger can see must be one a finger can take, on every touch
// device: a hit area of at least 40px each way (measured the way a tap finds it,
// as tests/touch/helpers.js hitBox does, all in one pass so a page that
// re-renders as it settles can't lose a control between steps), text fields and
// selects at 16px or more (smaller and iOS zooms the page in on focus), and
// nothing tappable sitting invisible at rest.
//
// The pages are the dev-only harnesses that draw the new tools with no backend,
// plus the local app's canvas and Files, some with a menu or a popover opened
// first, and every toolbar, opened the way a finger opens it. A control is a
// button, a link, a field or a role, or anything else with a pointer cursor (a
// breadcrumb, a zoom readout). A control that is small on purpose goes in
// ALLOW (or its page's `allow`) with the reason; a failure prints every offender.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { arrowBar, pickArrowHead } from '../helpers/arrowBar.js';
import { dockFromCard } from '../helpers/docFrame.js';

const tapOn = async (page, sel) => {
  const el = page.locator(sel).first();
  if (!(await el.isVisible())) return false;
  await el.tap();
  return true;
};

// Two taps on one spot, the way a finger opens a note or a doc
// (lib/doubleTap), straight to the screen as the other touch specs tap: a
// locator's tap first waits for its target to be in view and still, which
// under load stretched the gap past the 320ms a double tap allows.
const twoTaps = async (page, sel) => {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  const x = Math.round(b.x + b.width / 2);
  const y = Math.round(b.y + b.height / 2);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(90);
  await page.touchscreen.tap(x, y);
};

// The local board's note, open for writing: its bar is up.
async function editNote(page) {
  await twoTaps(page, '.canvas-wrap .card[data-card-id="home-note"] .note');
  await page.locator('.note-body[contenteditable="true"]').waitFor();
  await page.locator('.tob').waitFor();
  return true;
}

// A doc open over the ?docqa harness, with some words in it.
async function openDoc(page) {
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await page.locator('.doc-card-modal .tt-editor').first().waitFor();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent(
    '<h2>Sundown Highway</h2><p>A night drive across the desert, told in three long takes.</p>'));
}

// The doc's words selected: the bubble is up (a phone has none: the row on
// the keyboard has its formats).
async function selectInDoc(page) {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().selectAll().run());
  if (page.viewportSize().width <= 640) return false;
  await page.locator('.doc-bubble').waitFor();
  return true;
}
// One of the doc bar's menus, open from its button (`name`), or where the bar
// has folded it into its ⋯ (a touch tablet's width, a phone's row on the
// keyboard), from its row there (`folded`): ⋯ and the menu, both open.
async function docBarMenu(page, name, folded = null) {
  await openDoc(page);
  const phone = page.viewportSize().width <= 640;
  if (phone) {
    await page.locator('.doc-card-modal .ProseMirror p').first().tap();
    await page.waitForTimeout(300);
  }
  const bar = page.locator(phone ? '.dl-acc' : '.doc-card-modal .dl-bar');
  if (!(await bar.count())) return false;
  const btn = bar.getByRole('button', typeof name === 'string' ? { name, exact: true } : { name }).first();
  if (await btn.isVisible()) {
    await btn.tap();
    await page.locator('.tl-menu').first().waitFor();
    return true;
  }
  if (!folded) return false;
  await bar.getByRole('button', { name: phone ? 'More formatting' : 'More', exact: true }).tap();
  const more = page.locator('.dl-more');
  await more.waitFor();
  await more.getByRole('menuitem', { name: folded }).tap();
  await expect(page.locator('.tl-menu')).toHaveCount(2);
  return true;
}
// A picture in the doc, tapped: its bar is up.
async function pickDocImage(page) {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus('end')
    .setImage({ src: '/src/local/qa-photos/street.jpg' }).run());
  await page.locator('.doc-card-modal .ProseMirror img').first().tap();
  await page.locator('.tt-img-wrap.is-selected .tt-img-tb').waitFor();
  return true;
}
// An arrow drawn across the middle of an empty board, then picked: its bar is
// up (helpers/arrowBar.js).
async function pickAnArrow(page) {
  await page.keyboard.press('a');
  const b = await page.locator('.canvas-wrap').boundingBox();
  const from = { x: b.x + b.width * 0.3, y: b.y + b.height * 0.4 };
  const to = { x: b.x + b.width * 0.7, y: b.y + b.height * 0.55 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
  await arrowBar(page).waitFor();
}

const CLIP = readFileSync(new URL('../fixtures/media/frames-vp9.mp4', import.meta.url)).toString('base64');

// `open` runs once the page is ready: false skips the page on this device (its
// way in isn't drawn here, e.g. the floating bar's ⋯ in the phone's drawer).
// `scope`: what it opened, the only part judged (the page under it has its own
// test, and an open menu half-covers whatever it hangs over).
// `allow(width)`: this page's own ALLOW, for the screen's width.
// Home with `drawer=0`: on a phone the harness opens the drawer over it, as
// the menu button would.

// The note bar (NoteBarA), on the local board's note: one of its buttons
// tapped and the menu it opens up.
async function noteBarMenu(page, name, menu) {
  await editNote(page);
  await page.locator('.tob').getByRole('button', { name }).tap();
  await page.locator(menu).waitFor();
  return true;
}

// The draw tool and the shape tool armed: their bars are up.
async function drawTool(page) {
  if (!(await tapOn(page, '.cnv-tools [aria-label="Free-draw tool"]'))) await page.keyboard.press('d');
  await page.locator('.tob').waitFor();
  return true;
}
async function shapeTool(page) {
  await tapOn(page, '.cnv-tools [aria-label="Add menu"]');
  await page.locator('.cnv-add-menu [role="menuitem"][aria-label="Shape"]').tap();
  await page.locator('.tob').waitFor();
  return true;
}
// The sketch pad, opened from the draw tool's bar.
async function openSketchPad(page) {
  if (!(await tapOn(page, '.cnv-tools [aria-label="Free-draw tool"]'))) await page.keyboard.press('d');
  await page.locator('.tob').getByRole('button', { name: 'Open a fullscreen drawing canvas' }).tap();
  await page.locator('.sketchpad-frame').waitFor();
  return true;
}
// One of the canvas bars' buttons tapped, and the menu it opens up; false
// where the bar doesn't have it on this device.
async function barMenu(page, name, menu) {
  const btn = page.locator('.tob').getByRole('button', { name });
  if (!(await btn.count())) return false;
  await btn.first().tap();
  await page.locator(menu).waitFor();
  return true;
}

const PAGES = [
  { name: 'home', url: '/?sidebarqa=1&surface=home&drawer=0', ready: '[data-sidebarqa-ready]' },
  { name: 'home naming', url: '/?sidebarqa=1&surface=home&drawer=0', ready: '[data-sidebarqa-ready]',
    // The map's bottom bar, or a phone's row under the search.
    open: (page) => tapOn(page, '.ch-bar .ch-quiet, .ch-find-row .ch-quiet'), scope: '.ch-naming' },
  // The top islands (FloatingChrome, toolbarLook.css), and ⋯'s menu
  // (ChromeMoreA).
  { name: 'sidebar + board', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]' },
  { name: 'bar menu', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.chrome-more-btn'), scope: '.tl-menu' },
  { name: 'new cluster', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.tb-newcluster'), scope: '.ncl-pop' },
  { name: 'cluster switcher', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.sbf-tab.is-cluster'), scope: '.sbf-switch' },
  { name: 'files filter', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.sbf-filter-btn'), scope: '.sbf-menu' },
  // The full Files page (the card grown), and its "All files ⌄": on a phone
  // Grid | List are in it, and in Grid the tile Size.
  { name: 'files page', url: '/?sidebarqa=1&surface=files&drawer=0', ready: '[data-sidebarqa-ready]' },
  { name: 'files page menu', url: '/?sidebarqa=1&surface=files&drawer=0', ready: '[data-sidebarqa-ready]',
    open: (page) => tapOn(page, '.fp-tools .sbf-filter-btn'), scope: '.sbf-menu' },
  // Two files picked in the Files card: the bar of what to do with them.
  { name: 'files picked', url: '/?sidebarqa=1', ready: '[data-sidebarqa-ready]',
    open: async (page) => {
      const rows = page.locator('[data-sb-item^="film:film-img-"]');
      if (!(await rows.first().isVisible())) return false;
      await rows.nth(0).click({ modifiers: ['ControlOrMeta'] });
      await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
      // Under the files, where a short screen has scrolled it out of view.
      await page.locator('.sbf-bulk').scrollIntoViewIfNeeded();
      return true;
    }, scope: '.sbf-bulk' },
  { name: 'import tray', url: '/?importqa=1', ready: '#root[data-importqa-ready]' },
  { name: 'import guide', url: '/?importqa=1&guide=1', ready: '#root[data-importqa-ready]' },
  { name: 'import ask', url: '/?importqa=1&dialog=free', ready: '#root[data-importqa-ready]' },
  { name: 'upload menu', url: '/?importqa=1&menu=1', ready: '#root[data-importqa-ready]' },
  // The rail, the top islands and the comments toggle over the rail.
  { name: 'canvas', url: '/?local=1&reset=1', ready: '.canvas-wrap .card' },
  { name: 'files', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
      await page.locator('.list-wrap .ct-tile').first().waitFor();
      return true;
    } },
  { name: 'files picked in the list', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.view-pill--primary .view-pill-btn').nth(1).tap();
      const tiles = page.locator('.list-wrap .ct-tile');
      await tiles.nth(1).waitFor();
      await tiles.nth(0).click({ modifiers: ['ControlOrMeta'] });
      await tiles.nth(1).click({ modifiers: ['ControlOrMeta'] });
      await page.locator('.list-selbar').waitFor();
      return true;
    }, scope: '.list-selbar' },

  // ── The canvas's bars ──
  { name: 'add menu', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: (page) => tapOn(page, '.cnv-tools [aria-label="Add menu"]'), scope: '.cnv-add-menu' },
  { name: 'a card picked', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.canvas-wrap .card[data-card-id="home-note"]').tap();
      await page.locator('.sel-menu > .card-menu-btn').waitFor();
      return true;
    }, scope: '.sel-menu' },
  { name: 'card menu', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.canvas-wrap .card[data-card-id="home-note"]').tap();
      await page.locator('.sel-menu > .card-menu-btn').tap();
      await page.locator('.ctx-menu').waitFor();
      return true;
    }, scope: '.ctx-menu' },
  // The note bar, folded under a finger to its five groups and ⋯ (NoteBarA;
  // note-bar-look.spec.js), and each of its menus.
  { name: 'note bar', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: (page) => editNote(page), scope: '.tob' },
  { name: 'note bar fonts', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: (page) => noteBarMenu(page, /^Font/, '.nb-font-pop'), scope: '.nb-font-pop' },
  { name: 'note colours', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: (page) => noteBarMenu(page, 'Text color', '.nb-colour-menu'), scope: '.nb-colour-menu' },
  { name: 'note bar more', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: (page) => noteBarMenu(page, 'More formatting', '.nb-more'), scope: '.nb-more' },
  // The background's menu, off ⋯ (a phone's are ⋯'s own: 'note bar more').
  { name: 'note bar background', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await noteBarMenu(page, 'More formatting', '.nb-more');
      const row = page.locator('.nb-more').getByRole('menuitem', { name: 'Card background' });
      if (!(await row.count())) return false;
      await row.tap();
      await page.locator('.nb-colour-menu').waitFor();
      return true;
    }, scope: '.nb-colour-menu' },
  // A phone's lists are a menu of their own.
  { name: 'note bar lists', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await editNote(page);
      const lists = page.locator('.tob').getByRole('button', { name: /^Lists/ });
      if (!(await lists.count())) return false;
      await lists.tap();
      await page.locator('.tl-menu.tob-menu').waitFor();
      return true;
    }, scope: '.tl-menu.tob-menu' },
  // ── The draw, shape, line and arrow bars (components/toolbar/CanvasBarsA.jsx) ──
  { name: 'draw bar', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: drawTool, scope: '.tob' },
  { name: 'draw bar menu', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => { await drawTool(page); return barMenu(page, 'Brush, color and width', '.db-menu'); },
    scope: '.db-menu' },
  { name: 'shape bar', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: shapeTool, scope: '.tob' },
  { name: 'shape bar shapes', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => { await shapeTool(page); return barMenu(page, /^Shape: /, '.tl-menu.tob-menu'); },
    scope: '.tl-menu.tob-menu' },
  { name: 'shape bar fill', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => { await shapeTool(page); return barMenu(page, 'Fill', '.sb-colour-menu'); },
    scope: '.sb-colour-menu' },
  { name: 'shape bar more', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => { await shapeTool(page); return barMenu(page, 'More shape options', '.sb-more'); },
    scope: '.sb-more' },
  { name: 'arrow bar', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.locator('.cnv-tools [aria-label="Arrow tool"]').tap();
      await page.locator('.tob').waitFor();
      return true;
    }, scope: '.tob' },
  // A picked arrow's (PickedArrowBarA), finger sized where it is, and its ⋯.
  { name: 'an arrow picked', url: '/?local=1&reset=1&blank=1', ready: '.canvas-wrap',
    open: async (page) => { await pickAnArrow(page); return true; }, scope: '.tl-bar.pa-a' },
  { name: 'an arrow picked more', url: '/?local=1&reset=1&blank=1', ready: '.canvas-wrap',
    open: async (page) => {
      await pickAnArrow(page);
      const more = arrowBar(page).getByRole('button', { name: 'More arrow options' });
      if (!(await more.count())) return false;
      await more.tap();
      await page.locator('.pa-more').waitFor();
      return true;
    }, scope: '.pa-more' },
  { name: 'line bar', url: '/?local=1&reset=1&blank=1', ready: '.canvas-wrap',
    open: async (page) => {
      await pickAnArrow(page);
      await pickArrowHead(page, 'No arrowheads');
      await page.locator('.tob[aria-label="Line"]').waitFor();
      return true;
    }, scope: '.tob' },
  { name: 'line bar more', url: '/?local=1&reset=1&blank=1', ready: '.canvas-wrap',
    open: async (page) => {
      await pickAnArrow(page);
      await pickArrowHead(page, 'No arrowheads');
      await page.locator('.tob[aria-label="Line"]').waitFor();
      return barMenu(page, 'More line options', '.ln-more');
    }, scope: '.ln-more' },
  { name: 'sketch pad', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: openSketchPad, scope: '.sketchpad-frame' },
  // Two versions, so its header carries the version pills (on a phone, their menu).
  { name: 'review player', url: '/?local=1&reset=1', ready: '.canvas-wrap .card',
    open: async (page) => {
      await page.evaluate((data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        const media = { fps: [24, 1], frames: 48, dur: 2, w: 64, h: 36, probed: 1 };
        window.__soleilVideoLive.addVideo({ id: 'vid-1', src: url, fileName: 'frames.mp4', x: 700, y: 500, w: 480, h: 270, media,
          versions: [{ src: url, id: 'v1', n: 1, media }, { src: url, id: 'v2', n: 2, media }] });
      }, CLIP);
      // The card's own bar shows on a hover, or not at all on a phone's card,
      // a few pixels wide at the board's zoom: its button is pressed directly.
      const review = page.locator('[data-card-id="vid-1"] button[aria-label="Open in the review player"]');
      await review.waitFor({ state: 'attached' });
      await review.dispatchEvent('click');
      await page.locator('.frv .film-dock').waitFor();
      return true;
    }, scope: '.frv' },

  // ── A doc's bars (the doc look: its header, one row of tools and footer,
  // the side panel, and on a phone the row on the keyboard) ──
  { name: 'doc selection', url: '/?docqa=1', ready: '#root',
    open: selectInDoc, scope: '.doc-bubble' },
  { name: 'doc image', url: '/?docqa=1', ready: '#root',
    open: pickDocImage, scope: '.tt-img-tb' },
  { name: 'doc frame', url: '/?docqa=1', ready: '#root',
    open: async (page) => { await openDoc(page); return true; },
    scope: '.doc-card-modal :is(.dl-head, .dl-bar, .dl-foot)' },
  { name: 'doc, the row on the keyboard', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      await page.locator('.doc-card-modal .ProseMirror p').first().tap();
      await page.waitForTimeout(300);
      return (await page.locator('.dl-acc').count()) > 0;
    }, scope: '.dl-acc' },
  { name: 'doc more', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      const phone = page.locator('.dl-head').getByRole('button', { name: /^More/ });
      if (await phone.count()) await phone.tap();
      else await page.locator('.dl-bar').getByRole('button', { name: 'More', exact: true }).tap();
      await page.locator('.dl-more').waitFor();
      return true;
    }, scope: '.dl-more' },
  { name: 'doc comments', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      // A thread on "night", its card open by a tap on the words.
      await page.evaluate(() => {
        const T = window.__soleilDocTest;
        const id = T.addCommentThread(T.ydoc, { body: 'Which road?', author: 'Maya Chen', authorId: 'u-maya', scope: T.getScope() });
        const ed = T.editor;
        let at = null;
        ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text.includes('night')) at = pos + n.text.indexOf('night'); return at == null; });
        ed.chain().setTextSelection({ from: at, to: at + 5 }).setMark('comment', { id }).setTextSelection(1).run();
      });
      await page.locator('.doc-card-modal .tt-comment').first().tap();
      await page.locator('.dl-panel .dl-th.is-on .dl-reply').waitFor();
      return true;
    }, scope: '.dl-panel' },
  { name: 'doc find', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      const phone = page.locator('.dl-head').getByRole('button', { name: /^More/ });
      if (await phone.count()) {
        await phone.tap();
        await page.getByRole('menu', { name: 'More' }).getByRole('menuitem', { name: /^Find/ }).tap();
      } else {
        await page.locator('.dl-head').getByRole('button', { name: /^Comments/ }).tap();
        await page.locator('.dl-panel').getByRole('tab', { name: 'Find' }).tap();
      }
      await page.locator('.dl-panel').getByRole('textbox', { name: 'Find', exact: true }).fill('night');
      await page.locator('.dl-panel .dl-fr').first().waitFor();
      return true;
    }, scope: '.dl-panel' },
  { name: 'doc table', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent(
        '<p>Shots.</p><table><tr><th>#</th><th>Shot</th></tr><tr><td>1</td><td>Wide</td></tr></table>'));
      await page.locator('.doc-card-modal .ProseMirror td').nth(1).tap();
      await page.locator('.dl-tbar').waitFor();
      return true;
    }, scope: '.dl-tbar' },
  { name: 'doc pages', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      await openDoc(page);
      await page.evaluate(() => {
        const T = window.__soleilDocTest;
        for (const name of ['Act two', 'Act three']) T.addPage(T.ydoc, { name, scope: T.getScope() });
      });
      // A drawer on a phone or a portrait iPad; open beside the page already
      // on a landscape one.
      const show = page.locator('.dl-head').getByRole('button', { name: 'Show pages' });
      if (await show.count()) await show.tap();
      await page.locator('.doc-card-modal .doc-tree-add').first().waitFor();
      return true;
    }, scope: '.doc-card-modal .doc-rail-left' },
  // The bar's menus, each from its button or, folded, from ⋯'s row.
  { name: 'doc insert menu', url: '/?docqa=1', ready: '#root',
    open: (page) => docBarMenu(page, 'Insert'), scope: '.tl-menu' },
  { name: 'doc fonts', url: '/?docqa=1', ready: '#root',
    open: (page) => docBarMenu(page, /^Font(:|$)/, /^Font/), scope: '.tl-menu' },
  { name: 'doc size presets', url: '/?docqa=1', ready: '#root',
    open: (page) => docBarMenu(page, 'Preset sizes', /^Size/), scope: '.tl-menu' },
  { name: 'doc colours', url: '/?docqa=1', ready: '#root',
    open: (page) => docBarMenu(page, 'Colour and highlight', /^Text colour/), scope: '.tl-menu' },
  // A screenplay's bar: its type, undo and redo, link, comment and bookmark.
  { name: 'doc screenplay bar', url: '/?docqa=1', ready: '#root',
    open: async (page) => {
      if (page.viewportSize().width <= 640) return false;
      await openDoc(page);
      await page.evaluate(() => { const T = window.__soleilDocTest; T.setDocMode(T.ydoc, T.getScope(), 'screenplay'); });
      await page.locator('.doc-paper.is-screenplay .ProseMirror').waitFor();
      await page.locator('.doc-card-modal .dl-bar').waitFor();
      return true;
    }, scope: '.doc-card-modal .dl-bar' },
  // Docked beside the board: the bar in the pane's width. A phone's header
  // has no dock.
  { name: 'docked doc bar', url: '/?docqa=1&panes=1', ready: '[data-docqa-panes-ready]',
    open: async (page) => {
      if (page.viewportSize().width <= 640) return false;
      await dockFromCard(page.locator('[data-docqa-card="doc-a"] .doc-card'));
      await page.locator('[data-doc-pane="split"] .dl-bar').waitFor();
      return true;
    }, scope: '[data-doc-pane="split"] .dl-bar' },
];

// selector → why it may be smaller than a finger.
const ALLOW = {
  // The sidebar harness's own readout and fake canvas, not app chrome.
  '.sbqa-readout, .sbqa-readout *': 'harness readout',
  '.sbqa-card, .sbqa-card *': 'harness stand-in card',
  // The local app still draws the old workspace rail; the app dropped it.
  '.rail, .rail *': 'local harness only',
  // Inside a card: drawn at the board's zoom, like the card itself. Zoom in to
  // use them; the selection's ⋯ is the route that holds at every zoom.
  '.canvas .card, .canvas .card *': 'card content, scaled with the board',
  // Messages belongs to the messages-rework session; its findings were handed over.
  '.msg-panel, .msg-panel *': 'Messages UI (handed to its own session)',
};

// What a page opened comes in with a fade (a menu's rise-in): its finite
// animations and transitions run out before it's judged, since under load the
// half-second after `open` can end mid-fade, where a control reads as
// invisible at rest. An endless one (a spinner) isn't waited for, nor anything
// past 3s.
const settled = (page, scope) => page.evaluate((sel) => {
  const inScope = (a) => {
    const el = a.effect?.target;
    return !!el && (!!el.closest?.(sel) || !!el.querySelector?.(sel));
  };
  const runs = document.getAnimations()
    .filter((a) => inScope(a) && Number.isFinite(a.effect.getComputedTiming().endTime));
  return Promise.race([
    Promise.all(runs.map((a) => a.finished.catch(() => {}))),
    new Promise((r) => { setTimeout(r, 3000); }),
  ]).then(() => undefined);
}, scope);

async function audit(page, allow, scope = null) {
  return page.evaluate(([allow, scope]) => {
    const out = [];
    const SEL = 'button, [role=button], a[href], input:not([type=hidden]), select, textarea, [role=menuitem], [role=tab], [role=option], [role=switch], [role=checkbox], [contenteditable=true]';
    const allowed = (el) => Object.keys(allow).some((s) => { try { return el.matches(s); } catch (_) { return false; } });
    const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
    const name = (el) => {
      const cls = [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-tip') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 24);
      return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label}"` : ''}`;
    };
    // The outermost element of a pointer-cursor patch that isn't a control
    // already (cursor inherits, so its children all say pointer too).
    const pointerOnly = (el) => !el.matches(SEL) && !el.closest(SEL)
      && getComputedStyle(el).cursor === 'pointer'
      && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
    // Partly scrolled out of its list, or off the screen: a scroll away from
    // whole, so it's judged where it shows whole. A list's own pinned foot (a
    // sticky row at its bottom, the drawer's meter) is where its view ends.
    const stickies = [...document.querySelectorAll('body *')].filter((k) => getComputedStyle(k).position === 'sticky');
    const scrolledOut = (el, r) => {
      if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) return true;
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const o = getComputedStyle(n);
        if (!/auto|scroll/.test(o.overflowX + o.overflowY)) continue;
        if (n.scrollHeight <= n.clientHeight && n.scrollWidth <= n.clientWidth) continue;
        const b = n.getBoundingClientRect();
        let bottom = b.bottom;
        for (const k of stickies) {
          if (!n.contains(k) || k.contains(el)) continue;
          const kr = k.getBoundingClientRect();
          if (kr.height > 0 && kr.top > r.top && kr.bottom >= b.bottom - kr.height - 64) bottom = Math.min(bottom, kr.top);
        }
        if (r.top < b.top - 0.5 || r.bottom > bottom + 0.5 || r.left < b.left - 0.5 || r.right > b.right + 0.5) return true;
      }
      return false;
    };
    // helpers.js hitBox: walk out from the centre while a tap there still lands
    // on the control. Covered at its centre: under a menu or a sheet right now.
    // WebKit on a Mac hit-tests a scroller's overlay scrollbar along its right
    // and bottom edges; a finger on iOS taps through a scroll indicator. A
    // point inside the control that lands there is the control's.
    const overlayBar = (at, el, r, x, y) => {
      if (!at.contains(el) || x < r.left || x >= r.right || y < r.top || y >= r.bottom) return false;
      const o = getComputedStyle(at);
      if (!/auto|scroll/.test(o.overflowX + o.overflowY)) return false;
      const b = at.getBoundingClientRect();
      return x >= b.right - 16 || y >= b.bottom - 16;
    };
    const hitOf = (el, r) => {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hits = (x, y) => {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const at = document.elementFromPoint(x, y);
        return !!at && (at === el || el.contains(at) || overlayBar(at, el, r, x, y));
      };
      if (!hits(cx, cy)) return { covered: true };
      const run = (dx, dy) => {
        let n = 0;
        while (n < 40 + Math.max(r.width, r.height) && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
        return n;
      };
      return { w: run(-1, 0) + run(1, 0) + 1, h: run(0, -1) + run(0, 1) + 1 };
    };
    for (const el of document.querySelectorAll('body *')) {
      if (scope && !el.closest(scope)) continue;
      if (!el.matches(SEL) && !pointerOnly(el)) continue;
      if (el.disabled || el.closest('[inert], [aria-hidden=true]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      if (allowed(el) || scrolledOut(el, r)) continue;
      const field = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]), textarea, select, [contenteditable=true]');
      out.push({ name: name(el), field, fontSize: parseFloat(cs.fontSize), opacity: opacityOf(el), box: hitOf(el, r) });
    }
    return out;
  }, [allow, scope]);
}

for (const p of PAGES) {
  test(`${p.name}: every control fits a finger`, async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('soleil.dev.sidebarFiles', '1');
        localStorage.setItem('soleil.dev.bulkImport', '1');
        localStorage.setItem('soleil.dev.clusterNudges', '1');
      } catch (_) {}
    });
    if (p.storage) {
      await page.addInitScript((kv) => {
        try { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); } catch (_) {}
      }, p.storage);
    }
    await page.goto(p.url);
    await page.waitForSelector(p.ready, { timeout: 30000 });
    // What only the dev harness draws: the LOCAL QA banner over the bar's top
    // edge, and the tweaks gear in the corner.
    await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
    // Home's map fades its names in once the sky is drawn.
    if (await page.locator('.hg-map').count()) await page.locator('.hg-map.is-ready').waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    if (p.open) {
      const shown = await p.open(page);
      test.skip(!shown, `${p.name} isn't reached this way on this device`);
      await page.waitForTimeout(500);
    }
    if (p.scope) await settled(page, p.scope);
    const width = page.viewportSize().width;
    const found = await audit(page, { ...ALLOW, ...p.allow?.(width) }, p.scope);
    if (p.scope) expect(found.length, `${p.name}: nothing to judge in ${p.scope}`).toBeGreaterThan(0);
    const bad = [];
    for (const c of found) {
      if (c.opacity < 0.05) { bad.push(`${c.name}: invisible at rest (opacity ${c.opacity.toFixed(2)})`); continue; }
      if (c.field && c.fontSize < 16) bad.push(`${c.name}: field text ${c.fontSize}px (iOS zooms below 16)`);
      const { box } = c;
      if (box.covered) continue;  // under something else right now (a menu, a sheet): not reachable to judge
      // A pixel of slack: a 40px control flush with the screen's edge, or on a
      // half-pixel, measures 39.
      if (Math.min(box.w, box.h) >= 39) continue;
      bad.push(`${c.name}: hit area ${box.w}×${box.h}`);
    }
    expect(bad, `${p.name} — controls a finger can't take:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
}
