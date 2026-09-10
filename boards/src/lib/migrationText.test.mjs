import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrationFiles, latestDefinition, latestPolicy, latestMatch, duplicatePrefixes } from './migrationText.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  writeFileSync(join(dir, '0001_init.sql'),
    `create or replace function foo(x uuid) returns boolean language sql as $$ select true $$;\n` +
    `create policy "p read" on t for select using (true);\n`);
  writeFileSync(join(dir, '0002_b.sql'),
    `create function public.foo(x uuid) returns boolean language sql as $function$ select false $function$;\n`);
  writeFileSync(join(dir, '0002_a.sql'),
    `drop policy if exists "p read" on t;\ncreate policy "p read" on t for select using (false);\n`);
  writeFileSync(join(dir, '0010_c.sql'), `-- nothing\n`);
  return dir;
}

test('migrationFiles orders by numeric prefix then name', () => {
  const dir = fixture();
  assert.deepEqual(migrationFiles(dir), ['0001_init.sql', '0002_a.sql', '0002_b.sql', '0010_c.sql']);
});

test('latestDefinition returns the last file that defines the function, either syntax', () => {
  const dir = fixture();
  const def = latestDefinition('foo', dir);
  assert.equal(def.file, '0002_b.sql');
  assert.match(def.body, /select false/);
});

test('latestPolicy returns the last create policy for that name', () => {
  const dir = fixture();
  const p = latestPolicy('p read', dir);
  assert.equal(p.file, '0002_a.sql');
  assert.match(p.body, /using \(false\)/);
});

test('latestMatch and duplicatePrefixes', () => {
  const dir = fixture();
  assert.equal(latestMatch(/nothing/, dir).file, '0010_c.sql');
  assert.deepEqual(duplicatePrefixes(dir), ['0002']);
});
