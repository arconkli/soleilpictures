// The boards engine's publish step (scripts/engine/publish.mjs): an OK'd
// board's article for /c/<slug>, its photographers named at the end, and its
// share picture.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sayList, creditsLine, articleOf, heroOf } from '../../scripts/engine/publish.mjs';

test('photographers are named once each, by library', () => {
  assert.equal(sayList(['A']), 'A');
  assert.equal(sayList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(creditsLine([
    { name: 'Esra Afşar', source: 'Pexels' }, { name: 'Jo Lin', source: 'Unsplash' },
    { name: 'Esra Afşar', source: 'Pexels' }, { name: 'Sam Ode', source: 'Pexels' }, { name: '', source: 'Pexels' },
  ]), 'Photos by Esra Afşar and Sam Ode on Pexels and Jo Lin on Unsplash.');
  assert.equal(creditsLine([]), '');
});

test('a sound is credited by title, maker and licence, after the photographers', () => {
  const sound = { kind: 'sound', name: 'Jo Lin', source: 'Wikimedia Commons', licence: 'CC BY 4.0', title: 'File:Rain_on tin.ogg' };
  assert.equal(creditsLine([{ name: 'Sam Ode', source: 'Pexels' }, sound]),
    'Photos by Sam Ode on Pexels. Sound: "Rain on tin" by Jo Lin (CC BY 4.0) on Wikimedia Commons.');
  assert.equal(creditsLine([sound]), 'Sound: "Rain on tin" by Jo Lin (CC BY 4.0) on Wikimedia Commons.');
});

test('the article is the recipe\'s seo with the credits as its last paragraph', () => {
  const recipe = { slug: 'k', seo: { title: ' Kyoto in Autumn ', description: 'A plan.', body: 'First.\n\nSecond.', keyword: 'travel mood board' } };
  const a = articleOf(recipe, [{ name: 'A', source: 'Pexels' }]);
  assert.deepEqual(a, { seo_title: 'Kyoto in Autumn', seo_description: 'A plan.', seo_body: 'First.\n\nSecond.\n\nPhotos by A on Pexels.', target_keyword: 'travel mood board' });
  assert.equal(articleOf(recipe, []).seo_body, 'First.\n\nSecond.');
  assert.throws(() => articleOf({ slug: 'x', seo: { title: 't' } }, []), /no article text/);
});

test('the share picture is the biggest photo, never a video file', () => {
  assert.equal(heroOf([
    { storage_path: 'w/a.jpg', width: 1600, height: 1600 },
    { storage_path: 'w/b.mp4', width: 3840, height: 2160 },
    { storage_path: 'w/c.jpg', width: 2400, height: 1600 },
  ]), 'w/c.jpg');
  assert.equal(heroOf([]), null);
});

test('the article keeps its paragraphs on the page', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.pa-body \{[^}]*white-space: pre-line/);
});
