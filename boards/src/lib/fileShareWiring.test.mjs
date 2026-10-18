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
  player: '../components/film/FilmReview.jsx',
  quicklook: '../components/clusterBrowser/QuickLook.jsx',
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

test('NotificationsPanel routes file.* kinds to /f/<token>', () => {
  const s = src('../components/NotificationsPanel.jsx');
  assert.match(s, /startsWith\('file\.'\)/);
  assert.match(s, /window\.open\('\/f\/' \+ encodeURIComponent\(n\.data\.token\)/);
});

test('the live notification toast opens a file.* share in /f/', () => {
  const s = src('../hooks/useNotifications.js');
  assert.match(s, /startsWith\('file\.'\)/);
  assert.match(s, /'\/f\/' \+ encodeURIComponent\(fileToken\)/);
});
