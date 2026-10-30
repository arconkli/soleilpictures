// Pins the brand entity both sites declare, so Google reads ONE description of
// "Soleil Clusters" and one of its parent studio.
//
// clusters.soleilpictures.com (boards/index.html, the template every page is
// served from) declares the Soleil Clusters Organization with
// parentOrganization = Soleil Pictures. soleilpictures.com (the static site at
// the repo root) declares Soleil Pictures with subOrganization = Soleil
// Clusters. Until 10-29 the Clusters site called its organization "Soleil
// Pictures" while using the Clusters logo and profiles: the brand people
// search had no entity of its own. Change these only together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CLUSTERS_ORG = 'https://clusters.soleilpictures.com/#organization';
const STUDIO_ORG = 'https://soleilpictures.com/#organization';
// Only the profiles the owner has confirmed. Adding one is a decision, not a fix.
const CONFIRMED_SAMEAS = [
  'https://www.instagram.com/soleilclusters',
  'https://x.com/soleilclusters',
  'https://www.wikidata.org/wiki/Q141922414', // Soleil Clusters, posted by the owner 10-29
];

function jsonLdBlocks(file) {
  const html = readFileSync(here(file), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    out.push(JSON.parse(m[1])); // throws on invalid JSON, e.g. a /* */ comment
  }
  assert.ok(out.length > 0, `${file} has no JSON-LD`);
  return out;
}

function nodes(file) {
  const all = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      all.push(v);
      Object.values(v).forEach(walk);
    }
  };
  jsonLdBlocks(file).forEach(walk);
  return all;
}

test('Clusters site: one Soleil Clusters Organization, child of Soleil Pictures', () => {
  const graph = jsonLdBlocks('../../index.html')[0]['@graph'];
  const orgs = graph.filter((n) => n['@type'] === 'Organization');
  assert.equal(orgs.length, 1, 'exactly one top-level Organization');
  const [org] = orgs;
  assert.equal(org['@id'], CLUSTERS_ORG);
  assert.equal(org.name, 'Soleil Clusters');
  assert.equal(org.url, 'https://clusters.soleilpictures.com/');
  assert.deepEqual(org.sameAs, CONFIRMED_SAMEAS);
  for (const u of org.sameAs) assert.match(u, /^https:\/\//);
  assert.equal(org.parentOrganization['@id'], STUDIO_ORG);
  assert.equal(org.parentOrganization.name, 'Soleil Pictures');
  // Every publisher/brand reference points at the one org node.
  for (const n of graph) {
    for (const k of ['publisher', 'brand']) if (n[k]) assert.equal(n[k]['@id'], CLUSTERS_ORG, `${n['@id']}.${k}`);
  }
  const ids = graph.map((n) => n['@id']);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate @id in the graph');
});

test('soleilpictures.com: the studio names Clusters as its subOrganization, same words', () => {
  const clusters = jsonLdBlocks('../../index.html')[0]['@graph'].find((n) => n['@id'] === CLUSTERS_ORG);
  const studio = jsonLdBlocks('../../../index.html').find((n) => n['@type'] === 'Organization');
  assert.equal(studio['@id'], STUDIO_ORG);
  assert.equal(studio.name, 'Soleil Pictures');
  assert.equal(studio.subOrganization['@id'], CLUSTERS_ORG);
  assert.equal(studio.subOrganization.name, clusters.name);
  assert.equal(studio.subOrganization.url, clusters.url);
  assert.equal(studio.subOrganization.description, clusters.description);
});

test('soleilpictures.com: every Soleil Pictures reference carries the studio @id', () => {
  for (const f of ['../../../index.html', '../../../about-us.html', '../../../projects.html']) {
    const refs = nodes(f).filter((n) => n['@type'] === 'Organization' && n.name === 'Soleil Pictures');
    assert.ok(refs.length > 0, `${f} names the studio`);
    for (const r of refs) assert.equal(r['@id'], STUDIO_ORG, f);
  }
});
