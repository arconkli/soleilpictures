// Pins the search pages' orbit art (lib/sunArt.js): the logo's parts, never
// the mark, every glide ending exactly where the still picture puts the sun.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ORBIT_ART, orbitArtSvg, orbitPoint, orbitArtWidth, sunSvg } from './sunArt.js';

const KINDS = ['full', 'phone', 'behind', 'behindPhone', 'og'];

test('every look has its box, a thick ring first and suns on real orbits', () => {
  for (const k of KINDS) {
    const A = ORBIT_ART[k];
    assert.ok(A, k);
    assert.equal(A.box.length, 2, k);
    assert.ok(A.orbits[0][4] >= 6, `${k}: the first orbit is the mark's thick ring`);
    for (const [o] of A.suns) assert.ok(A.orbits[o], `${k}: sun on orbit ${o}`);
  }
});

test('a sun is drawn the mark\'s way: orange, a clipped shade, a cream disc', () => {
  const s = sunSvg(0, 0, 100, 0, 'x');
  assert.match(s, /<circle cx="0" cy="0" r="100" fill="#ffa500"\/>/);
  assert.match(s, /cx="37" cy="0" r="60" fill="#ef7300" clip-path="url\(#x\)"/);
  assert.match(s, /cx="85" cy="0" r="79" fill="#fffaf0"/);
});

test('the art never draws the mark itself, and every id is prefixed', () => {
  for (const k of KINDS) {
    const svg = orbitArtSvg(k, { id: 'zz' });
    assert.doesNotMatch(svg, /viewBox="0 0 2048/, k);
    for (const [, id] of svg.matchAll(/ id="([^"]+)"/g)) assert.ok(id.startsWith('zz'), `${k}: ${id}`);
    assert.equal((svg.match(/class="orb"/g) || []).length, ORBIT_ART[k].suns.length, k);
  }
});

test('each glide ends at the sun\'s own place, and only script starts it', () => {
  for (const k of KINDS) {
    const svg = orbitArtSvg(k);
    const glides = [...svg.matchAll(/<animateMotion ([^>]+)\/>/g)].map((m) => m[1]);
    assert.equal(glides.length, ORBIT_ART[k].suns.length, k);
    for (const g of glides) {
      assert.match(g, /begin="indefinite"/);
      assert.match(g, /fill="freeze"/);
      assert.match(g, /path="M[-\d. ]+A[^"]* 0 0"/, 'the path ends at 0 0, the sun\'s own place');
    }
  }
  assert.doesNotMatch(orbitArtSvg('og', { motion: false }), /animateMotion/);
});

test('orbit points: 0° is the right end, 90° the bottom, before the tilt', () => {
  assert.deepEqual(orbitPoint([10, 20], 5, 3, 0, 0).map(Math.round), [15, 20]);
  assert.deepEqual(orbitPoint([10, 20], 5, 3, 0, 90).map(Math.round), [10, 23]);
});

test('behind art is sized against the frame and stays near it', () => {
  assert.equal(orbitArtWidth('full'), 100);
  assert.ok(orbitArtWidth('behind') > 140 && orbitArtWidth('behind') < 170);
  // The rings reach no further than ~90 units above or below a 912-wide frame
  // (whose shot is 2048×1000, plus its bar and caption), so they stay inside
  // the band's bottom margin.
  const { orbits, tilt } = ORBIT_ART.behind;
  const half = (912 * 1000) / 2048 / 2 + 43;
  for (const [rx, ry] of orbits) {
    const t = (tilt * Math.PI) / 180;
    const reach = Math.sqrt((rx * Math.sin(t)) ** 2 + (ry * Math.cos(t)) ** 2);
    assert.ok(reach - half < 90, `ring ${rx}×${ry} reaches ${Math.round(reach - half)} past the frame`);
  }
});
