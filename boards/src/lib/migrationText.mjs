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

// 0461 restated 31 admin functions to change one predicate: 0149's verified
// rule (email_confirmed_at and last_sign_in_at both set), or in five
// populations email_confirmed_at alone, became "has entered the emailed code".
// Each body is otherwise the live one, byte for byte, so the file that wrote a
// function's logic is still the one before 0461. A test that pins a function to
// that file reads past the restatement: the latest definition, stepping back
// over each one in CODE_ENTRY_FILES that is nothing but codeEntrySwap of the
// one before it. (0462 took the same swap to the one column 0461 left reading
// the raw stamp.) Bodies are compared, not headers, because 0461 spells each
// header the catalog's way; signupAtCodeEntryMigration.test.mjs pins the swaps
// and the headers.
export const CODE_ENTRY_FILE = '0461_signups_count_once_the_code_is_entered.sql';
export const CODE_ENTRY_FILES = [CODE_ENTRY_FILE, '0462_users_list_says_who_entered_the_code.sql'];

const ENTERED = 'id in (select ec.entered_id from public._admin_entered_code() ec)';
const NOT_ENTERED = 'id not in (select ec.entered_id from public._admin_entered_code() ec)';

export function codeEntrySwap(sql, { confirmedAlone = false } = {}) {
  if (confirmedAlone) return sql.replace(/([a-z_]+\.)?email_confirmed_at\s+is\s+not\s+null/gi, `$1${ENTERED}`);
  return sql
    .replace(/([a-z_]+\.)?email_confirmed_at\s+is\s+not\s+null\s+and\s+([a-z_]+\.)?last_sign_in_at\s+is\s+not\s+null/gi, `$1${ENTERED}`)
    .replace(/([a-z_]+\.)?email_confirmed_at\s+is\s+null\s+or\s+([a-z_]+\.)?last_sign_in_at\s+is\s+null/gi, `$1${NOT_ENTERED}`);
}

// The dollar-quoted body alone, whitespace collapsed.
export function bodyText(definition) {
  const m = definition.match(/as\s*(\$[a-z_]*\$)([\s\S]*?)\1/i);
  return m ? m[2].replace(/\s+/g, ' ').trim() : null;
}

export function definitionsOf(fnName, dir = MIGRATIONS_DIR) {
  const re = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fnName}\\s*\\(` +
    `[\\s\\S]*?as\\s*(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    'i',
  );
  const found = [];
  for (const f of migrationFiles(dir)) {
    const m = read(dir, f).match(re);
    if (m) found.push({ file: f, body: m[0] });
  }
  return found;
}

export function latestDefinitionPastCodeEntry(fnName, dir = MIGRATIONS_DIR) {
  const defs = definitionsOf(fnName, dir);
  const isSwapOf = (def, prev) => [false, true].some((confirmedAlone) =>
    bodyText(def.body) === bodyText(codeEntrySwap(prev.body, { confirmedAlone })));
  let i = defs.length - 1;
  while (i > 0 && CODE_ENTRY_FILES.includes(defs[i].file) && isSwapOf(defs[i], defs[i - 1])) i -= 1;
  return defs[i] ?? null;
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
