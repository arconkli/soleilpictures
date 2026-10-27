// Text pins on supabase/migrations/0661_file_views.sql and 0662 (documents):
// that the MCP can apply them, that no client can call their functions, and
// that their view names are lib/fileView.js's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { viewKeys, isViewKey, isViewPdfKey } from './fileView.js';

const sql = readFileSync(new URL('../../../supabase/migrations/0661_file_views.sql', import.meta.url), 'utf8');
// Comments first: an apostrophe in one would open a string.
const statements = sql.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
const FUNCTIONS = [
  '_file_view_request(text,text,uuid,boolean)',
  '_file_view_claim(integer)',
  '_file_view_heartbeat(text,integer)',
  '_file_view_finish(text,text,jsonb)',
  '_file_view_due()',
];

test('0661 has no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
  assert.doesNotMatch(statements, /\bdrop\s/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i, 'not even in a comment or a string');
});

test('every function is definer, pinned to no search path, and the service role\'s alone', () => {
  const made = [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]);
  assert.deepEqual(made.sort(), FUNCTIONS.map((f) => f.split('(')[0]).sort());
  for (const f of FUNCTIONS) {
    const name = f.split('(')[0];
    const at = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
    const header = sql.slice(at, sql.indexOf('$function$', at));
    assert.match(header, /security definer/, `${name} is definer`);
    assert.match(header, /set search_path to ''/, `${name} pins search_path`);
    const spaced = f.replace(/,/g, ',\\s*').replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke execute on function public\\.${spaced} from public, anon, authenticated;`), `${name} revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${spaced} to service_role;`), `${name} granted`);
    assert.ok(sql.includes(`'public.${f}'`), `${name} is in the proof block`);
  }
  const grants = [...statements.matchAll(/\bgrant\s+([^;]+);/gi)].map((m) => m[1]);
  assert.deepEqual(grants.filter((g) => /\bto\s+(anon|authenticated|public)\b/i.test(g)),
    ['select on table public.file_views to authenticated'], 'members may only read the record');
});

test('the view names derived in SQL are lib/fileView.js\'s', () => {
  // _file_view_finish derives the keys it records.
  assert.ok(sql.includes(String.raw`regexp_replace(p_storage_path, '^(.*/)?([^/]+)$', '\1previews/\2')`));
  assert.ok(sql.includes(`v_view := v_base || '.view.webp';`));
  assert.ok(sql.includes(`v_sm := v_base || '.view_sm.webp';`));
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.deepEqual(viewKeys(`${ws}/scan.final.tif`), {
    view: `${ws}/previews/scan.final.tif.view.webp`,
    sm: `${ws}/previews/scan.final.tif.view_sm.webp`,
    pdf: `${ws}/previews/scan.final.tif.view.pdf`,
  });
  // …and nothing under previews/ is ever an original, in either place.
  assert.ok(sql.includes(`if p_storage_path like '%/previews/%' then return 'not_view'; end if;`));
  assert.ok(isViewKey(`${ws}/previews/x.heic.view.webp`) && isViewKey(`${ws}/previews/x.heic.VIEW_SM.WEBP`));
});

test('views are retention-locked, a browser\'s preview is never replaced, and a job gets three tries', () => {
  assert.equal((sql.match(/retention_locked_until\)\s*\n\s*values \([^)]*timestamptz '2999-01-01'\)/g) || []).length, 2);
  assert.match(sql, /where i\.storage_path = p_storage_path and i\.preview_path is null;/);
  assert.match(sql, /if v_state is null and v_img\.preview_path is not null then return 'has_preview'; end if;/);
  // A view re-queued because its object went missing is not a browser's preview.
  assert.match(sql, /and i\.preview_path not like '%\.view\.webp';/);
  assert.match(sql, /f\.attempts < 3/);
  assert.match(sql, /greatest\(60, least\(coalesce\(p_lease_seconds, 900\), 3600\)\)/);
  assert.match(sql, /for update skip locked/);
});

// ── 0662: documents ───────────────────────────────────────────────────────

const docs = readFileSync(new URL('../../../supabase/migrations/0662_file_views_documents.sql', import.meta.url), 'utf8');
const docStatements = docs.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
const DOC_FUNCTIONS = ['_file_view_request(text,text,uuid,boolean)', '_file_view_finish(text,text,jsonb)'];

test('0662 has no DROP and no DELETE FROM statement, and only adds columns', () => {
  assert.doesNotMatch(docStatements, /\bdrop\s/i);
  assert.doesNotMatch(docs, /\bdelete\s+from\b/i);
  const alters = [...docStatements.matchAll(/\balter\s+table\s+([^;]+);/gi)].map((m) => m[1].trim());
  assert.deepEqual(alters, [
    'public.file_views add column if not exists view_pdf_path text',
    'public.file_views add column if not exists page_count integer',
  ]);
});

test('0662 replaces two functions with their own signatures, still definer and the service role\'s alone', () => {
  const made = [...docs.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]);
  assert.deepEqual(made.sort(), DOC_FUNCTIONS.map((f) => f.split('(')[0]).sort());
  for (const f of DOC_FUNCTIONS) {
    const name = f.split('(')[0];
    const at = docs.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
    const header = docs.slice(at, docs.indexOf('$function$', at));
    assert.match(header, /security definer/, `${name} is definer`);
    assert.match(header, /set search_path to ''/, `${name} pins search_path`);
    // The same arguments as 0661's, so the replace keeps the function (and its grants).
    const args = (src) => {
      const i = src.search(new RegExp(`function\\s+public\\.${name}\\s*\\(`, 'i'));
      return src.slice(src.indexOf('(', i), src.indexOf(')\n', i) + 1).replace(/\s+/g, ' ');
    };
    assert.equal(args(docs), args(sql), `${name} keeps 0661's arguments`);
    const spaced = f.replace(/,/g, ',\\s*').replace(/[()]/g, '\\$&');
    assert.match(docs, new RegExp(`revoke execute on function public\\.${spaced} from public, anon, authenticated;`), `${name} revoked`);
    assert.match(docs, new RegExp(`grant execute on function public\\.${spaced} to service_role;`), `${name} granted`);
    assert.ok(docs.includes(`'public.${f}'`), `${name} is in the proof block`);
  }
  assert.deepEqual([...docStatements.matchAll(/\bgrant\s+([^;]+);/gi)].map((m) => m[1])
    .filter((g) => /\bto\s+(anon|authenticated|public)\b/i.test(g)), [], 'no grant to a client');
});

test('0662 takes documents, names their PDF as lib/fileView.js does, and keeps every rule 0661 had', () => {
  assert.ok(docs.includes(`if p_kind is null or p_kind not in ('image', 'doc') then return 'not_view'; end if;`));
  assert.ok(docs.includes(`if p_storage_path like '%/previews/%' then return 'not_view'; end if;`));
  assert.match(docs, /if v_state is null and v_img\.preview_path is not null then return 'has_preview'; end if;/);
  assert.ok(docs.includes(String.raw`regexp_replace(p_storage_path, '^(.*/)?([^/]+)$', '\1previews/\2')`));
  assert.ok(docs.includes(`v_view := v_base || '.view.webp';`));
  assert.ok(docs.includes(`v_sm := v_base || '.view_sm.webp';`));
  assert.ok(docs.includes(`v_pdf := v_base || '.view.pdf';`));
  assert.match(docs, /if v_job\.kind = 'doc' and v_pages > 0 then/, 'only a document, and only with pages, has a PDF');
  const ws = '0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11';
  assert.equal(viewKeys(`${ws}/Pitch v3.final.pptx`).pdf, `${ws}/previews/Pitch v3.final.pptx.view.pdf`);
  assert.ok(isViewPdfKey(viewKeys(`${ws}/a.docx`).pdf));
  // Three images rows, each retention-locked; the preview only where there was none.
  assert.equal((docs.match(/timestamptz '2999-01-01'\)/g) || []).length, 3);
  assert.match(docs, /where i\.storage_path = p_storage_path and i\.preview_path is null;/);
  assert.match(docs, /view_pdf_path = v_pdf,\s*\n\s*page_count = case when v_pdf is not null then v_pages end,/);
  // Everything 0661's finish recorded is still recorded.
  for (const col of ['probe', 'reason', 'error', 'view_path', 'view_w', 'view_h', 'view_sm_path', 'view_sm_w', 'view_sm_h', 'width = v_w, height = v_h']) {
    assert.ok(docs.includes(col), col);
  }
  assert.match(docs, /if v_job\.state <> 'working' then return v_job\.state; end if;/);
});
