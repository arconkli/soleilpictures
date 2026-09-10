//
// Shared reader for migration-text tests. The house rule is that a test which
// guards a function's shape reads the LATEST definition in supabase/migrations,
// because that is what is live in Postgres. Three things every such test needs
// and inviteUpsert.test.mjs first wrote locally:
//   * apply order, not filename order — 22 prefixes are used twice, and Supabase
//     applies by full version string, so sort by numeric prefix and then name;
//   * both definition syntaxes — `create or replace function` and the
//     `drop function` + `create function` form a RETURNS TABLE change forces;
//   * both dollar-quote tags — `$$` by hand, `$function$` from pg_get_functiondef.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = new URL('../../../supabase/migrations/', import.meta.url).pathname;

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => {
      const na = Number(a.slice(0, 4)), nb = Number(b.slice(0, 4));
      return na !== nb ? na - nb : (a < b ? -1 : a > b ? 1 : 0);
    });
}

function read(dir, f) { return readFileSync(join(dir, f), 'utf8'); }

export function latestDefinition(fnName, dir = MIGRATIONS_DIR) {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fnName}\\s*\\(` +
    `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    'i',
  );
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(re);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

export function latestPolicy(policyName, dir = MIGRATIONS_DIR) {
  const re = new RegExp(`create\\s+policy\\s+"${policyName}"[\\s\\S]*?;`, 'i');
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(re);
    if (m) found = { file: f, body: m[0] };
  }
  return found;
}

export function latestMatch(regex, dir = MIGRATIONS_DIR) {
  let found = null;
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(regex);
    if (m) found = { file: f, match: m };
  }
  return found;
}

export function duplicatePrefixes(dir = MIGRATIONS_DIR) {
  const seen = new Map();
  for (const f of migrationFiles(dir)) {
    const p = f.slice(0, 4);
    seen.set(p, (seen.get(p) || 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([p]) => p).sort();
}
