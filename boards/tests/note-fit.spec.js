// Calibration for lib/noteFit.js: does its estimate of a note's rendered height
// track real Chromium layout? Local only (CI doesn't run Playwright) and needs
// no dev server -- it builds its own page that reproduces the note CSS.
//
//   NOTE_FONT_DIR=/path/to/aileron-woff2 npx playwright test --config <a scratch config with no webServer> 
//
// The estimate must never be short (>= real - 1) and never more than one line
// plus the safety margin too tall (<= real + 26.5). Two font setups: Aileron
// (needs NOTE_FONT_DIR; skipped without it) and the system fallback stack only.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { noteContentHeight } from '../src/lib/noteFit.js';

const FONT_DIR = process.env.NOTE_FONT_DIR;
const WIDTHS = [280, 320];

// Copied from src/styles.css: `*` reset (line 8), body (230), .note (5123),
// .note-body (5178), p:empty (5212), lists (5275-5279), headings (5285-5294),
// checklist (5299-5324). Colours, transitions and hover states are left out;
// only what affects layout is kept.
const NOTE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-sans); font-size: 13px; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }
.note {
  width: 100%; height: 100%;
  border: 1px solid transparent; border-radius: 8px; padding: 14px;
  overflow: hidden; display: flex; flex-direction: column; position: relative;
}
.note-body {
  font-size: var(--note-font-size, 15px); line-height: 1.5; color: inherit;
  letter-spacing: -0.002em;
  white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word;
  flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
.note-body p:empty::before { content: "\\00a0"; }
.note-body a { text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; word-break: break-word; }
.note-body ul:not(.note-checklist), .note-body ol { padding-left: 24px; margin: 6px 0; list-style-position: outside; }
.note-body ul:not(.note-checklist) > li, .note-body ol > li { margin: 2px 0; }
.note-body h1, .note-body h2, .note-body h3 { font-weight: 650; line-height: 1.25; letter-spacing: -0.012em; margin: .5em 0 .2em; }
.note-body h1 { font-size: 1.35em; }
.note-body h2 { font-size: 1.18em; }
.note-body h3 { font-size: 1.05em; }
.note-body > :is(h1, h2, h3):first-child { margin-top: 0; }
.note-checklist { list-style: none; padding-left: 0; margin: 6px 0; }
.note-checklist .ck { display: flex; gap: 8px; align-items: flex-start; padding: 2px 0; }
.note-checklist .ck-box {
  flex: 0 0 14px; width: 14px; height: 14px;
  margin-top: 4px; margin-top: calc((1lh - 14px) / 2);
  border: 1px solid #888; border-radius: 4px; position: relative;
}
.note-checklist .ck-text { flex: 1; min-width: 0; }
.note.measure { height: auto; margin-bottom: 8px; }
`;

const p = (t) => `<p>${t}</p>`;
const ul = (...items) => `<ul>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ul>`;
const ol = (...items) => `<ol>${items.map((i) => `<li><p>${i}</p></li>`).join('')}</ol>`;
const ck = (...items) => `<ul class="note-checklist">${items.map((i, n) => `<li class="ck"><span class="${n % 2 ? 'ck-box is-checked' : 'ck-box'}" role="checkbox"></span><div class="ck-text"><p>${i}</p></div></li>`).join('')}</ul>`;
const LOREM = 'The quick brown fox jumps over the lazy dog while a thoughtful editor reads the second draft of the pitch aloud to the whole room. ';
const URL1 = 'https://www.example.com/articles/2025/10/a-very-long-path-segment-that-never-breaks/and-another-one-after-it?utm_source=newsletter&utm_medium=email&utm_campaign=autumn';

const NOTES = [
  p('Call mom'),
  p('Pick up the dry cleaning and drop the package at the post office before 5.'),
  p('ok'),
  p(''),
  p('<strong>Reminder</strong>: the <em>final</em> cut is due <strong>Friday</strong>, no extensions.'),
  '<h1>Q4 planning</h1>' + p(LOREM + LOREM),
  '<h2>MARTY SUPREME (2025)</h2><p>9.75 / 10</p><p></p><p>One of your highest-rated films.</p><p></p><p>NOTES</p><ul><li><p>What makes the lead performance electric?</p></li><li><p>How does the film build momentum?</p></li><li><p>Favorite scene / sequence:</p></li></ul>',
  '<h3>Small heading</h3>' + p('Body text under a small heading that is long enough to wrap onto a second line at this width.'),
  p('Intro') + '<h2>Middle heading</h2>' + p('After the heading.') + '<h1>Another big heading that is long enough to wrap</h1>' + p('tail'),
  ul('Milk', 'Eggs', 'Sourdough bread from the bakery on the corner', 'Coffee beans, the dark roast, two bags'),
  ul('A single long bullet that goes on and on and on, wrapping across several lines inside the narrower list column.'),
  ol('Preheat the oven to 220 degrees', 'Chop the onions and the garlic finely', 'Sear the meat on both sides until it has a deep brown crust, then set it aside', 'Deglaze the pan'),
  ol(...Array.from({ length: 12 }, (_, i) => `Step number ${i + 1} of the process, described in a sentence`)),
  ck('Buy tickets', 'Book the hotel near the station', 'Send the invite to everyone on the list, including the people from the other office', 'Pack'),
  ck('One', 'Two', 'Three', 'Four', 'Five', 'Six'),
  p('Shopping') + ck('Apples', 'Pears') + p('Then home.'),
  p('Intro paragraph.') + ul('first', 'second') + p('Outro paragraph.') + ol('one', 'two'),
  p(URL1),
  p('See ' + `<a href="${URL1}">${URL1}</a>` + ' for details.'),
  p('SHOOT SCHEDULE: DAY 1 INT. WAREHOUSE - NIGHT. ALL CAST ON SET BY SIX. NO EXCEPTIONS WHATSOEVER.'),
  p('WWWWWWWWWWWWWWWWWWWWWWWWWWWW MMMMMMMMMMMMMMMMMMMMMM'),
  '<h1>BIG LOUD ALL CAPS HEADING FOR THE WHOLE BOARD</h1>' + p('MIXED Case And ALL CAPS SENTENCES TOGETHER'),
  p('Café crème brûlée, façade, naïve, jalapeño, Zürich, Ångström, Ærø, Œuvre, ñandú, über, Đurđevak, çok güzel.'),
  p('Prices: €12, £9, ¥1,500 — “quoted” text, ‘single’ quotes, it’s … fine • bullets · dots ™ © ®'),
  p('日本語のテキストはスペースなしで続きます。これは長い一行で、カードの幅で折り返されるはずです。もう少し長くしてみましょう。'),
  p('Mixed 日本語 and English words together, 한국어 too, and 中文 as well, so the line has to break in odd places.'),
  p('Launch day 🚀🚀🚀 party 🎉 with cake 🍰 and friends 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀'),
  p('Arrows → and ← and stars ★☆ and checks ✓ ✔ ☐ ☑ degrees 20°C'),
  p(Array.from({ length: 6 }, () => LOREM).join('')),
  p(LOREM.repeat(5)),
  Array.from({ length: 10 }, (_, i) => p(`Paragraph ${i + 1}. ` + LOREM)).join(''),
  p('Line one<br>Line two<br>Line three that is a bit longer than the others and wraps<br><br>After a blank line'),
  p('a<br><br><br>b'),
  p('   leading spaces and    multiple    spaces    inside the text    and more    spaces'),
  p('Numbers 0123456789 0123456789 0123456789 0123456789 0123456789 1111111111 0000000000 8888888888'),
  p('1.5 2.25 3.75 10.5 1,000,000 $19.99 (555) 123-4567 12:30pm 2025-10-27'),
  '<h2>Meeting notes</h2>' + p('<strong>Attendees:</strong> Ana, Ben, Chloe, Dmitri, Esperanza, Farouk') + '<h3>Decisions</h3>' + ul('Ship the beta on <strong>Monday</strong>', 'Cut the settings rewrite', 'Revisit pricing after the <em>first</em> two weeks of data') + '<h3>Actions</h3>' + ck('Ana: write the announcement', 'Ben: fix the upload bug', 'Chloe: book the room'),
  '<h1>Everything</h1>' + p(LOREM) + ul('bullet one is quite long and wraps to a second line here', 'bullet two') + ol('step one', 'step two is also long enough to wrap to another line') + ck('check one', 'check two is long enough that it wraps as well') + p(`<strong>${LOREM}</strong>`) + p(URL1),
  p('<strong>' + LOREM.repeat(4) + '</strong>'),
  p('iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'),
];

const fontFaces = (dir) => [400, 600, 700].map((w) => {
  const b64 = fs.readFileSync(path.join(dir, `aileron-${w}.woff2`)).toString('base64');
  return `@font-face{font-family:aileron;font-weight:${w};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}).join('');

const SETUPS = [
  { name: 'Aileron', needsFonts: true, stack: 'aileron, -apple-system, system-ui, sans-serif' },
  { name: 'fallback stack', needsFonts: false, stack: '-apple-system, system-ui, sans-serif' },
];

for (const setup of SETUPS) {
  test.describe(`note-fit calibration: ${setup.name}`, () => {
    // The widths were measured in Chromium (scripts/measure-note-metrics.mjs),
    // once: the other projects would measure the same page again.
    test.skip(({ browserName }) => browserName !== 'chromium', 'measured in Chromium');
    test(`estimate tracks real layout (${NOTES.length} notes x ${WIDTHS.join('/')}px)`, async ({ page }) => {
      test.skip(setup.needsFonts && !FONT_DIR, 'set NOTE_FONT_DIR to run the Aileron setup');
      const faces = setup.needsFonts ? fontFaces(FONT_DIR) : '';
      const rows = [];
      for (const w of WIDTHS) {
        const html = `<!doctype html><html><head><style>:root{--font-sans:${setup.stack};}${faces}${NOTE_CSS}</style></head><body>` +
          NOTES.map((n) => `<div class="note measure" style="width:${w}px"><div class="note-body">${n}</div></div>`).join('') +
          '</body></html>';
        await page.setContent(html);
        if (setup.needsFonts) {
          await page.evaluate(() => Promise.all([400, 600, 700].map((wt) => document.fonts.load(`${wt} 15px aileron`))));
        }
        await page.evaluate(() => document.fonts.ready);
        const real = await page.evaluate(() => [...document.querySelectorAll('.note.measure')].map((n) => n.getBoundingClientRect().height));
        real.forEach((r, i) => rows.push({ i, w, real: r, est: noteContentHeight(NOTES[i], w) }));
      }
      rows.forEach((r) => { r.diff = r.est - r.real; });
      const f = (n) => n.toFixed(1).padStart(7);
      const table = (title, list) => console.log(`\n[${setup.name}] ${title}\n  note   w     real     est    diff  start\n` +
        list.map((r) => `  ${String(r.i).padStart(4)} ${r.w} ${f(r.real)} ${f(r.est)} ${f(r.diff)}  ${NOTES[r.i].replace(/<[^>]+>/g, ' ').trim().slice(0, 40)}`).join('\n'));
      table('8 most under-estimated (est - real, smallest first)', [...rows].sort((a, b) => a.diff - b.diff).slice(0, 8));
      table('8 most over-estimated', [...rows].sort((a, b) => b.diff - a.diff).slice(0, 8));
      const bad = rows.filter((r) => r.est < r.real - 1 || r.est > r.real + 26.5)
        .map((r) => `note ${r.i} @${r.w}: real ${r.real.toFixed(1)} est ${r.est.toFixed(1)}`);
      expect(bad).toEqual([]);
    });
  });
}
