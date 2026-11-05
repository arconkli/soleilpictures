// chatgptPlugin.test.mjs — the ChatGPT plugin package in mcp/chatgpt-plugin/.
//
// OpenAI's plugin portal (platform.openai.com/plugins) takes a zip of that
// folder: plugin.json (the listing, the review cases, the release notes),
// mcp.json (the server and how it signs in), one skill and the icons. Build it
// with plugin.json at the archive root:
//
//   cd mcp/chatgpt-plugin && zip -r -X ../../soleil-clusters-chatgpt.zip plugin.json mcp.json skills assets
//
// These checks hold the package to the portal's limits (plugins/deploy/
// submission-errors, read 2026-11-05) and to the live tool list, so renaming a
// tool or rewording the listing can't quietly break the next submission. A
// change to the package reaches ChatGPT only as a new version uploaded and
// reviewed in the portal; tool changes on the server reach it through OpenAI's
// daily rescan, which keeps a changed tool's approved definition live until the
// new one passes, so old tool inputs must keep working meanwhile.
//
//   node --test src/lib/chatgptPlugin.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TOOLS } from './mcpTools.js';

const root = new URL('../../../mcp/chatgpt-plugin/', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const plugin = JSON.parse(read('plugin.json'));
const mcp = JSON.parse(read('mcp.json'));
const oa = plugin.extensions['com.openai'];
const ui = oa.interface;
const toolNames = new Set(TOOLS.map((t) => t.name));

test('the listing fits the portal limits', () => {
  assert.match(plugin.name, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.ok(plugin.description.length <= 1024);
  assert.ok(ui.displayName.length <= 30, ui.displayName);
  assert.ok(ui.shortDescription.length <= 30, ui.shortDescription);
  assert.ok(ui.longDescription.length <= 4000);
  assert.ok(ui.developerName.length <= 80);
  assert.ok(ui.capabilities.length <= 20 && ui.capabilities.every((c) => c.length <= 120));
  assert.ok(ui.defaultPrompt.length <= 3);
  for (const p of ui.defaultPrompt) assert.ok(p.length <= 128 && !p.includes('@') && !p.includes('\n'), p);
  for (const k of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    assert.match(ui[k], /^https:\/\/clusters\.soleilpictures\.com(\/|$)/, k);
  }
});

test('the listing promotes no plan, price or upgrade', () => {
  // OpenAI's plugin guidelines: listing text must not advertise pricing,
  // trials or promotions, and a plugin sells nothing unless it says so.
  const text = [ui.displayName, ui.shortDescription, ui.longDescription, ...ui.capabilities, ...ui.defaultPrompt].join('\n');
  assert.doesNotMatch(text, /\b(free|price|pricing|trial|discount|subscri|upgrade|\$\d)/i);
  assert.equal(oa.review.commerce, false);
});

test('the support link is a docs page that exists', () => {
  const path = new URL(ui.supportURL).pathname;
  assert.ok(existsSync(new URL(`../../content${path}.md`, import.meta.url)), path);
});

test('five cases that should use it and three that should not, naming real tools', () => {
  const { positive, negative } = oa.review.test_cases;
  assert.equal(positive.length, 5);
  assert.equal(negative.length, 3);
  for (const c of positive) {
    assert.ok(c.description && c.prompt && c.expected_behavior);
    for (const t of c.tools_triggered.split(',').map((s) => s.trim())) assert.ok(toolNames.has(t), t);
  }
  for (const c of negative) assert.ok(c.description && c.prompt);
});

test('no reviewer credentials, apps or hooks in the package', () => {
  // Credentials go in the portal's Review details, never in the public zip.
  assert.ok(!('test_credentials' in oa.review) && !('reviewer_instructions' in oa.review));
  assert.ok(!('apps' in oa) && !('hooks' in oa));
  assert.ok(oa.publication.release_notes.trim());
});

test('one streamable-http server at production /mcp, mixed sign-in over CIMD, no headers', () => {
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 1);
  const [s] = servers;
  assert.equal(s.type, 'streamable-http');
  assert.equal(s.url, 'https://clusters.soleilpictures.com/mcp');
  assert.deepEqual(s.extensions['com.openai'].auth, { type: 'mixed', client: { mode: 'cimd' } });
  assert.ok(!s.headers);
});

test('icons are square PNGs of 48 to 4096 px, and the brand colours read on both themes', () => {
  for (const k of ['logo', 'composerIcon']) {
    assert.ok(ui[k].startsWith('./'), k);
    const png = read(ui[k].slice(2));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', k);
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    assert.ok(w === h && w >= 48 && w <= 4096, `${k} ${w}x${h}`);
  }
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  assert.ok(ratio(ui.brandColor, '#FFFFFF') >= 2, 'brandColor against white');
  assert.ok(ratio(ui.brandColorDark, '#212121') >= 2, 'brandColorDark against #212121');
});

test('the skill names only tools that exist', () => {
  const skill = read('skills/moodboard/SKILL.md').toString();
  assert.match(skill, /^---\nname: moodboard\ndescription: .+\n---\n/);
  const named = [...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]).filter((n) => !n.endsWith('_id'));
  assert.ok(named.length >= 5, named.join(','));
  for (const n of named) assert.ok(toolNames.has(n), n);
});
