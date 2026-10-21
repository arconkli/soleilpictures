// pixelSchedule: the Meta Pixel's script loads after what the visit came for.
// Run: node --test src/lib/pixelSchedule.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { schedulePixel, PIXEL_AFTER_PAINT_MS, PIXEL_CAP_MS } from './pixelSchedule.js';

function harness(signedInApp) {
  const log = [];
  const on = { paint: null, image: null, load: null, idle: null };
  const waits = [];
  schedulePixel({
    signedInApp,
    onPaint: (fn) => { on.paint = fn; },
    onImage: (fn) => { on.image = fn; },
    onLoad: (fn) => { on.load = fn; },
    wait: (ms, fn) => { waits.push({ ms, fn }); },
    idle: (fn) => { on.idle = fn; },
    load: () => log.push('load'),
  });
  const after = (ms) => waits.find((w) => w.ms === ms).fn;
  return { log, on, waits, after };
}

test('a signed-in open waits for its board\'s first picture, then for idle', () => {
  const { log, on, after } = harness(true);
  assert.equal(on.load, null, 'never the load event');
  assert.equal(on.image, null, 'a picture counts only once the board has painted');
  on.paint();
  assert.deepEqual(log, [], 'never straight from the paint');
  on.image();
  assert.deepEqual(log, [], 'nor straight from the picture');
  on.idle();
  assert.deepEqual(log, ['load']);
  after(PIXEL_AFTER_PAINT_MS)();
  after(PIXEL_CAP_MS)();
  assert.equal(log.length, 1, 'once');
});

test('a board with no picture: a while after its paint', () => {
  const { log, on, waits, after } = harness(true);
  assert.deepEqual(waits.map((w) => w.ms), [PIXEL_CAP_MS], 'nothing counts from the paint before it happens');
  on.paint();
  after(PIXEL_AFTER_PAINT_MS)();
  on.idle();
  assert.deepEqual(log, ['load']);
});

test('no board at all: the cap', () => {
  const { log, on, after } = harness(true);
  after(PIXEL_CAP_MS)();
  on.idle();
  assert.deepEqual(log, ['load']);
  on.paint();
  on.image();
  assert.equal(log.length, 1);
});

test('any other page waits for its load event', () => {
  const { log, on, waits } = harness(false);
  assert.equal(on.paint, null);
  assert.deepEqual(waits, []);
  on.load();
  on.idle();
  assert.deepEqual(log, ['load']);
});

const read = (rel) => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');

test('index.html queues every call at parse time and adds the script only when asked', () => {
  const html = read('../../index.html');
  const snippet = html.slice(html.indexOf('!function(f,b,e,v,n,t,s)'), html.indexOf("fbq('init'"));
  assert.ok(snippet.includes('n.queue=[];f.__soleilPixel=function(){'), 'the script is added by __soleilPixel, not at parse');
  // An address the app moved to before then is checked again, so the pixel
  // still never loads on a page holding a link's token.
  assert.ok(snippet.includes('if(t||soleilLinkToken(f.location.pathname,f.location.search))return;'));
  assert.ok(!html.includes('<link rel="preconnect" href="https://connect.facebook.net"'), 'nothing warms a host the boot no longer uses');
  const main = read('../main.jsx');
  assert.match(main, /installSpaPageViews\(\);\nloadPixelLater\(\{ signedIn: hasCachedSession\(\) \}\);/);
  assert.match(read('metaPixel.js'), /signedInApp: signedIn && \/\^\\\/\?\$\/\.test\(window\.location\.pathname\),/);
});
