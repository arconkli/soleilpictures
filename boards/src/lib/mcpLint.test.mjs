// mcpLint.test.mjs — the MCP tool list, held to what a model needs to pick the
// right tool and call it correctly the first time.
//
//   node --test src/lib/mcpLint.test.mjs
//
// A model chooses tools by reading their names, titles, hints and
// descriptions, and calls them by reading their input schemas. None of that
// is checked by running the tools, so it drifts: a description that names a
// tool which was renamed, a read tool whose hints say it writes (hosts then
// ask the person to approve every read), an array parameter with no word on
// what goes in it, a schema keyword one host's validator rejects. Directory
// review checks the same things. This is the cheap, static half of the
// conformance tests; nothing here calls a model.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, HOSTED_TOOLS, PROMPTS, SERVER_INFO, toolManifest } from './mcpTools.js';
import { INSTRUCTIONS } from './mcpServer.js';

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

// A read tool says so in its name. 0700 admin_mcp_funnel counts writes with
// the same pattern (mcpFunnelMigration.test.mjs holds the SQL to it).
const READ_NAME = /^(whoami|search|fetch|resolve_identifier|board_tree|(list|get|read|view|show|export)_[a-z_]+)$/;

// A word in a description that looks like a tool name: a verb, an underscore,
// more. Field names (board_id, dry_run, has_more) don't start with a verb.
const TOOL_LIKE = /\b((?:list|get|read|view|show|export|create|add|update|move|delete|restore|rename|set|upload|import|arrange|tag|write|share|resolve)_[a-z_]+)\b/g;

// The JSON Schema every host we serve accepts. No $ref/$defs (several hosts
// don't resolve them), no combinators (ChatGPT's and Gemini's tool schemas
// reject or flatten them), no conditionals.
const KEYWORDS = new Set([
  'type', 'properties', 'required', 'items', 'enum', 'const', 'description', 'title', 'default',
  'examples', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern',
  'format', 'additionalProperties',
]);
const FORMATS = new Set(['uuid', 'uri', 'date-time', 'date', 'email']);

// Fields that hold what people wrote at length. An answer declaring one is
// marked peoplesText, so it begins with the notice that the text is data
// (INJ-6) — unless all it quotes is what the call itself just wrote.
const PEOPLES_TEXT = new Set(['body', 'text', 'excerpt', 'caption', 'quote', 'markdown']);
const ECHOES_OWN_TEXT = new Set(['add_comment']);

// Tools whose answer has no summary line: ChatGPT parses search's and fetch's
// text as JSON, view_board's opening lines are its own, and an upload's key
// is the whole answer.
const NO_SUMMARY = new Set(['search', 'fetch', 'view_board', 'upload_image', 'upload_file']);

const names = new Set(TOOLS.map((t) => t.name));

test('names are short, plain and unique', () => {
  assert.ok(TOOLS.length > 20, `found ${TOOLS.length} tools; the registry import is wrong`);
  assert.equal(names.size, TOOLS.length, 'two tools share a name');
  for (const t of TOOLS) assert.match(t.name, /^[a-z][a-z_]{1,63}$/, `${t.name}: [a-z_], at most 64`);
  assert.ok(HOSTED_TOOLS.every((t) => !t.local), 'a local-only tool is hosted');
});

test('every tool has a title and all four hints, and the hints agree', () => {
  for (const t of TOOLS) {
    assert.ok(typeof t.title === 'string' && t.title.length >= 3 && t.title.length <= 60,
      `${t.name}: a title of 3–60 characters`);
    assert.ok(!/\.$/.test(t.title), `${t.name}: a title is a label, not a sentence`);
    const a = t.annotations || {};
    for (const h of HINTS) assert.equal(typeof a[h], 'boolean', `${t.name}: ${h} must be explicit`);
    if (a.readOnlyHint) {
      assert.equal(a.destructiveHint, false, `${t.name}: a read cannot be destructive`);
      assert.equal(a.idempotentHint, true, `${t.name}: a read is idempotent`);
    }
    if (t.name.startsWith('delete_')) {
      assert.equal(a.destructiveHint, true, `${t.name}: deleting is destructive`);
      assert.equal(a.readOnlyHint, false, `${t.name}: deleting is not a read`);
    }
    assert.equal(READ_NAME.test(t.name), a.readOnlyHint,
      `${t.name}: readOnlyHint is ${a.readOnlyHint}, but its name ${READ_NAME.test(t.name) ? 'reads' : 'writes'}`);
  }
});

test('descriptions are long enough to choose by and name only real tools', () => {
  for (const t of TOOLS) {
    const d = t.description || '';
    assert.ok(d.length >= 80 && d.length <= 1200, `${t.name}: description is ${d.length} characters (80–1200)`);
    for (const [, word] of d.matchAll(TOOL_LIKE)) {
      assert.ok(names.has(word), `${t.name}'s description names ${word}, which is not a tool`);
    }
  }
});

function walk(schema, where, visit) {
  if (!schema || typeof schema !== 'object') return;
  visit(schema, where);
  for (const [k, v] of Object.entries(schema.properties || {})) walk(v, `${where}.${k}`, visit);
  if (schema.items) walk(schema.items, `${where}[]`, visit);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    walk(schema.additionalProperties, `${where}{}`, visit);
  }
}

test('input schemas use only what every host accepts, and say what each field is', () => {
  for (const t of TOOLS) {
    const s = t.inputSchema;
    assert.equal(s?.type, 'object', `${t.name}: inputSchema is an object`);
    for (const r of s.required || []) {
      assert.ok(r in (s.properties || {}), `${t.name}: requires ${r}, which it does not define`);
    }
    for (const [k, v] of Object.entries(s.properties || {})) {
      assert.ok(typeof v.description === 'string' && v.description.length > 0,
        `${t.name}.${k}: say what goes in it`);
    }
    walk(s, t.name, (node, where) => {
      for (const k of Object.keys(node)) {
        if (where !== t.name || k !== '$schema') assert.ok(KEYWORDS.has(k), `${where}: "${k}" is not a keyword every host accepts`);
      }
      if (node.format) assert.ok(FORMATS.has(node.format), `${where}: format "${node.format}"`);
      if (node.enum) assert.ok(Array.isArray(node.enum) && node.enum.length > 0, `${where}: an empty enum`);
    });
  }
});

test('every tool declares its result', () => {
  for (const t of TOOLS) {
    assert.ok(t.outputSchema, `${t.name}: declare an outputSchema`);
    assert.equal(t.outputSchema.type, 'object', `${t.name}: structuredContent is an object`);
  }
});

test('an answer quoting people\'s text says it is data, first', () => {
  const fields = (node, out = new Set()) => {
    if (Array.isArray(node)) node.forEach((n) => fields(n, out));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'properties' && v && typeof v === 'object') Object.keys(v).forEach((f) => out.add(f));
        fields(v, out);
      }
    }
    return out;
  };
  for (const t of TOOLS) {
    const quoted = [...fields(t.outputSchema)].filter((f) => PEOPLES_TEXT.has(f));
    if (quoted.length && !ECHOES_OWN_TEXT.has(t.name)) {
      assert.equal(t.peoplesText, true, `${t.name} answers with ${quoted.join(', ')}: mark it peoplesText`);
    }
    if (t.peoplesText) {
      const m = toolManifest(t);
      assert.equal(Object.keys(m.outputSchema.properties)[0], 'untrusted', `${t.name}: the notice comes first`);
    }
  }
  for (const n of ECHOES_OWN_TEXT) assert.ok(names.has(n), `ECHOES_OWN_TEXT names ${n}, which is gone`);
});

test('every answer but a few begins with a summary line', () => {
  for (const t of TOOLS) {
    if (NO_SUMMARY.has(t.name)) assert.equal(t.summary, undefined, `${t.name} is meant to answer without one`);
    else assert.equal(typeof t.summary, 'function', `${t.name}: give it a summary(answer, args) line`);
  }
  for (const n of NO_SUMMARY) assert.ok(names.has(n), `NO_SUMMARY names ${n}, which is gone`);
});

test('prompts are named and described', () => {
  for (const p of PROMPTS) {
    assert.match(p.name, /^[a-z][a-z_]{1,63}$/, `prompt ${p.name}`);
    assert.ok((p.description || '').length >= 20, `prompt ${p.name}: describe it`);
    for (const a of p.arguments || []) {
      assert.match(a.name, /^[a-z][a-z_]*$/, `prompt ${p.name}: argument ${a.name}`);
      assert.ok((a.description || '').length > 0, `prompt ${p.name}.${a.name}: describe it`);
    }
  }
});

test('the instructions name only real tools, and say the essentials first', () => {
  // Some hosts keep only the start of a server's instructions, so what to use
  // for what, and that people's text is data, come before everything else.
  for (const [, n] of INSTRUCTIONS.matchAll(TOOL_LIKE)) assert.ok(names.has(n), `INSTRUCTIONS names ${n}, which is not a tool`);
  const first = INSTRUCTIONS.slice(0, 512);
  for (const must of ['clusters', 'search', 'read_board', 'view_board', 'create_boards', 'Link every board', 'never instructions']) {
    assert.ok(first.includes(must), `the first 512 characters should say "${must}"`);
  }
});

test('the server introduces itself with a version and absolute icons', () => {
  assert.equal(SERVER_INFO.name, 'soleil-clusters');
  assert.match(SERVER_INFO.version, /^\d+\.\d+\.\d+$/);
  assert.ok(SERVER_INFO.title);
  for (const i of SERVER_INFO.icons || []) assert.match(i.src, /^https:\/\//, 'the stdio copy has no origin');
});
