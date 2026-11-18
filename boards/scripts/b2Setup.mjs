#!/usr/bin/env node
// Backblaze B2 for Clusters' files: the three buckets, their settings, the
// app's keys and main → backup replication, declared once here and applied
// idempotently. boards/storage-cors.json is the R2 twin of the CORS rule below.
//
//   node scripts/b2Setup.mjs check      compare the account with SPEC; changes nothing
//   node scripts/b2Setup.mjs apply      make missing buckets; set CORS, lifecycle,
//                                       encryption and Object Lock retention
//   node scripts/b2Setup.mjs keys       make missing app keys and add them to .env
//   node scripts/b2Setup.mjs replicate  main → backup replication, with its own two keys
//
// Credentials come from boards/scripts/.env (git-ignored; ENV_FILE overrides):
// B2_ADMIN_KEY_ID / B2_ADMIN_APP_KEY when present, else the temporary
// B2_MASTER_KEY_ID / B2_MASTER_APP_KEY. No secret is ever printed.
// Checked the official b2 CLI; built our own because this is a handful of REST
// calls and the settings belong in the repo next to the code that relies on them.

import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_FILE = process.env.ENV_FILE || fileURLToPath(new URL('./.env', import.meta.url));

// Browsers that read and upload files directly: the app, previews, local dev.
const ORIGINS = [
  'https://clusters.soleilpictures.com',
  'https://main-soleil-boards.arconkli.workers.dev',
  'https://*.arconkli.workers.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

// One rule for the whole bucket. B2 keeps every version until a rule removes
// it: S3 DELETE only hides a file, and a re-upload to the same name keeps the
// old version.
const lifecycle = (daysFromHidingToDeleting) => [{
  daysFromHidingToDeleting,
  daysFromStartingToCancelingUnfinishedLargeFiles: 7,
  daysFromUploadingToHiding: null,
  fileNamePrefix: '',
}];

export const SPEC = {
  main: {
    name: 'soleil-boards-images',
    lock: null,
    cors: [{
      corsRuleName: 'clusters-app',
      allowedOrigins: ORIGINS,
      allowedOperations: ['s3_get', 's3_head', 's3_put'],
      allowedHeaders: ['*'],
      // Uploads in parts read each part's ETag.
      exposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
      maxAgeSeconds: 3600,
    }],
    // A deleted or replaced file is gone a day later.
    lifecycle: lifecycle(1),
  },
  backup: {
    name: 'soleil-boards-images-backup',
    // Governance, not compliance: a key with bypassGovernance can still remove
    // a file for a legal takedown.
    lock: { mode: 'governance', period: { duration: 90, unit: 'days' } },
    cors: [],
    // Replication never copies deletes, so a deleted file keeps its backup.
    // A version replaced by a newer upload is kept 90 days.
    lifecycle: lifecycle(90),
  },
  db: {
    name: 'soleil-db-backups',
    lock: { mode: 'governance', period: { duration: 14, unit: 'days' } },
    cors: [],
    // .github/workflows/backup.yml prunes to 30 daily + 12 monthly dumps; a
    // pruned dump is gone a day later.
    lifecycle: lifecycle(1),
  },
};

// listBuckets (of its own bucket only): without it a bucket-restricted key gets
// 403 AccessDenied instead of 404 for a file that isn't there (tested 2026-11-18).
const FILE_CAPS = ['listBuckets', 'listFiles', 'readFiles', 'writeFiles', 'deleteFiles'];
// Each app key reaches one bucket. Saved as B2_<env>_KEY_ID / B2_<env>_APP_KEY.
const APP_KEYS = [
  { keyName: 'clusters-worker', env: 'WORKER', bucket: 'main', capabilities: FILE_CAPS },
  { keyName: 'clusters-party', env: 'PARTY', bucket: 'main', capabilities: FILE_CAPS },
  { keyName: 'clusters-db-backup', env: 'DB_BACKUP', bucket: 'db', capabilities: FILE_CAPS },
];
// Stands in for the master key after setup: everything except deleting a
// bucket and getting past Object Lock.
const ADMIN_KEY = { keyName: 'clusters-admin', env: 'ADMIN', without: ['deleteBuckets', 'bypassGovernance'] };
// What Backblaze's replication needs (the b2 SDK's ReplicationSetupHelper defaults).
const REPL = {
  rule: 'clusters-backup',
  source: { keyName: 'clusters-repl-source', capabilities: ['readFiles', 'readFileLegalHolds', 'readFileRetentions'] },
  dest: { keyName: 'clusters-repl-dest', capabilities: ['writeFiles', 'writeFileLegalHolds', 'writeFileRetentions', 'deleteFiles'] },
};
const SSE = { algorithm: 'AES256', mode: 'SSE-B2' };

function readEnv() {
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function saveEnv(lines, note) {
  appendFileSync(ENV_FILE, `\n# ${note}\n${lines.join('\n')}\n`, { mode: 0o600 });
}

// Drops a replaced key's lines (and the note above them) from .env.
function forgetEnv(envName, keyName) {
  const drop = new Set([`# Backblaze B2 key ${keyName} (scripts/b2Setup.mjs)`]);
  const kept = readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => (
    !drop.has(l) && !l.startsWith(`B2_${envName}_KEY_ID=`) && !l.startsWith(`B2_${envName}_APP_KEY=`)));
  writeFileSync(ENV_FILE, kept.join('\n').replace(/\n{3,}/g, '\n\n'), { mode: 0o600 });
}

const sameCaps = (a, b) => norm([...a].sort()) === norm([...b].sort());

async function authorize(env) {
  const admin = Boolean(env.B2_ADMIN_KEY_ID && env.B2_ADMIN_APP_KEY);
  const id = admin ? env.B2_ADMIN_KEY_ID : env.B2_MASTER_KEY_ID;
  const secret = admin ? env.B2_ADMIN_APP_KEY : env.B2_MASTER_APP_KEY;
  if (!id || !secret) throw new Error(`No Backblaze key in ${ENV_FILE}`);
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`b2_authorize_account → ${res.status} ${j.code || ''}`);
  const s = j.apiInfo.storageApi;
  return {
    accountId: j.accountId, apiUrl: s.apiUrl, s3ApiUrl: s.s3ApiUrl, token: j.authorizationToken,
    capabilities: s.capabilities || [], as: admin ? 'clusters-admin' : 'master key',
  };
}

async function call(auth, name, body) {
  const res = await fetch(`${auth.apiUrl}/b2api/v3/${name}`, {
    method: 'POST',
    headers: { authorization: auth.token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${name} → ${res.status} ${j.code || ''}: ${j.message || ''}`);
    err.code = j.code;
    throw err;
  }
  return j;
}

// Stable comparison: object keys sorted, arrays kept in order.
const norm = (v) => JSON.stringify(v ?? null, (_, x) => (
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
// Backblaze reorders operations and lowercases header names, so compare as sets.
const set = (a, lower = false) => (a ? [...a].map((x) => (lower ? x.toLowerCase() : x)).sort() : null);
const pickCors = (rules) => (rules || []).map((r) => ({
  corsRuleName: r.corsRuleName,
  allowedOrigins: set(r.allowedOrigins),
  allowedOperations: set(r.allowedOperations),
  allowedHeaders: set(r.allowedHeaders, true),
  exposeHeaders: set(r.exposeHeaders, true),
  maxAgeSeconds: r.maxAgeSeconds,
}));
const pickCorsSpec = pickCors;

// A taken name gets `-sp` (bucket names are shared by every Backblaze customer).
async function listBuckets(auth) {
  const { buckets } = await call(auth, 'b2_list_buckets', { accountId: auth.accountId });
  const out = {};
  for (const [role, s] of Object.entries(SPEC)) {
    out[role] = buckets.find((b) => b.bucketName === s.name)
      || buckets.find((b) => b.bucketName === `${s.name}-sp`) || null;
  }
  return out;
}

function drift(role, b) {
  const s = SPEC[role];
  if (!b) return ['missing'];
  const d = [];
  if (b.bucketType !== 'allPrivate') d.push(`files are ${b.bucketType}`);
  const enc = b.defaultServerSideEncryption?.value;
  if (norm(enc) !== norm(SSE)) d.push(`encryption ${norm(enc)}`);
  const lock = b.fileLockConfiguration?.value;
  if (Boolean(s.lock) !== Boolean(lock?.isFileLockEnabled)) d.push(`object lock ${lock?.isFileLockEnabled ? 'on' : 'off'}`);
  if (s.lock && norm(lock?.defaultRetention) !== norm(s.lock)) d.push(`retention ${norm(lock?.defaultRetention)}`);
  if (norm(pickCors(b.corsRules)) !== norm(pickCorsSpec(s.cors))) d.push(`cors ${norm(pickCors(b.corsRules))}`);
  if (norm(b.lifecycleRules) !== norm(s.lifecycle)) d.push(`lifecycle ${norm(b.lifecycleRules)}`);
  return d;
}

function replicationDrift(buckets) {
  const src = buckets.main?.replicationConfiguration?.value?.asReplicationSource;
  const rule = src?.replicationRules?.find((r) => r.replicationRuleName === REPL.rule);
  if (!rule) return ['no replication rule'];
  const d = [];
  if (rule.destinationBucketId !== buckets.backup?.bucketId) d.push('rule points at another bucket');
  if (!rule.isEnabled) d.push('rule is off');
  if (rule.fileNamePrefix !== '') d.push(`rule only covers ${rule.fileNamePrefix}`);
  const map = buckets.backup?.replicationConfiguration?.value?.asReplicationDestination?.sourceToDestinationKeyMapping || {};
  if (!map[src.sourceApplicationKeyId]) d.push('backup bucket does not accept the source key');
  return d;
}

async function check(auth) {
  const buckets = await listBuckets(auth);
  let ok = true;
  for (const role of Object.keys(SPEC)) {
    const d = drift(role, buckets[role]);
    ok &&= d.length === 0;
    console.log(`${d.length ? '✗' : '✓'} ${buckets[role]?.bucketName || SPEC[role].name}${d.length ? `: ${d.join('; ')}` : ''}`);
  }
  if (buckets.main && buckets.backup) {
    const d = replicationDrift(buckets);
    ok &&= d.length === 0;
    console.log(`${d.length ? '✗' : '✓'} replication main → backup${d.length ? `: ${d.join('; ')}` : ''}`);
  }
  const env = readEnv();
  const { keys } = await call(auth, 'b2_list_keys', { accountId: auth.accountId, maxKeyCount: 1000 });
  for (const k of [ADMIN_KEY, ...APP_KEYS]) {
    const live = keys.find((x) => x.keyName === k.keyName);
    const saved = env[`B2_${k.env}_KEY_ID`];
    const inEnv = Boolean(live && saved === live.applicationKeyId && env[`B2_${k.env}_APP_KEY`]);
    const capsOk = !k.capabilities || (live && sameCaps(live.capabilities, k.capabilities));
    const good = inEnv && capsOk;
    ok &&= Boolean(good);
    const where = live?.bucketId ? Object.values(buckets).find((b) => b?.bucketId === live.bucketId)?.bucketName : 'all buckets';
    console.log(`${good ? '✓' : '✗'} key ${k.keyName}${live ? ` (${where}: ${live.capabilities.length} capabilities)` : ': missing'}`
      + `${live && !inEnv ? ': not in .env' : ''}${live && !capsOk ? `: has ${live.capabilities.join(', ')}` : ''}`);
  }
  console.log(ok ? 'All as declared.' : 'Differs from the declaration (see ✗).');
  return ok;
}

async function apply(auth) {
  let buckets = await listBuckets(auth);
  for (const [role, s] of Object.entries(SPEC)) {
    const b = buckets[role];
    if (!b) {
      const body = {
        accountId: auth.accountId, bucketType: 'allPrivate', corsRules: s.cors, lifecycleRules: s.lifecycle,
        defaultServerSideEncryption: SSE, fileLockEnabled: Boolean(s.lock),
      };
      let made;
      try {
        made = await call(auth, 'b2_create_bucket', { ...body, bucketName: s.name });
      } catch (e) {
        if (e.code !== 'duplicate_bucket_name') throw e;
        console.log(`${s.name} is taken by another Backblaze customer; using ${s.name}-sp`);
        made = await call(auth, 'b2_create_bucket', { ...body, bucketName: `${s.name}-sp` });
      }
      console.log(`made ${made.bucketName}`);
      if (s.lock) {
        await call(auth, 'b2_update_bucket', { accountId: auth.accountId, bucketId: made.bucketId, defaultRetention: s.lock });
        console.log(`  ${made.bucketName}: ${s.lock.mode} lock, ${s.lock.period.duration} ${s.lock.period.unit}`);
      }
      continue;
    }
    const d = drift(role, b);
    if (!d.length) { console.log(`${b.bucketName} already as declared`); continue; }
    if (d.includes('object lock on')) throw new Error(`${b.bucketName} has Object Lock on and it can't be switched off; it needs a decision`);
    await call(auth, 'b2_update_bucket', {
      accountId: auth.accountId, bucketId: b.bucketId, bucketType: 'allPrivate',
      corsRules: s.cors, lifecycleRules: s.lifecycle, defaultServerSideEncryption: SSE,
      ...(s.lock ? { fileLockEnabled: true, defaultRetention: s.lock } : {}),
    });
    console.log(`updated ${b.bucketName}: ${d.join('; ')}`);
  }
  buckets = await listBuckets(auth);
  const region = auth.s3ApiUrl.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1];
  const env = readEnv();
  const plain = {
    B2_S3_ENDPOINT: auth.s3ApiUrl, B2_REGION: region,
    B2_BUCKET: buckets.main?.bucketName, B2_BACKUP_BUCKET: buckets.backup?.bucketName, B2_DB_BUCKET: buckets.db?.bucketName,
  };
  const missing = Object.entries(plain).filter(([k, v]) => v && env[k] !== v).map(([k, v]) => `${k}=${v}`);
  if (missing.length) saveEnv(missing, 'Backblaze B2 endpoint and buckets (scripts/b2Setup.mjs)');
}

async function makeKey(auth, existing, k, bucketId, capabilities) {
  if (existing.some((x) => x.keyName === k.keyName)) {
    throw new Error(`${k.keyName} exists in Backblaze but its secret isn't in .env: delete that key, then run again`);
  }
  const made = await call(auth, 'b2_create_key', {
    accountId: auth.accountId, keyName: k.keyName, capabilities, ...(bucketId ? { bucketId } : {}),
  });
  return made;
}

async function keys(auth) {
  const env = readEnv();
  const buckets = await listBuckets(auth);
  let { keys: existing } = await call(auth, 'b2_list_keys', { accountId: auth.accountId, maxKeyCount: 1000 });
  const saved = (k) => env[`B2_${k.env}_KEY_ID`] && existing.find((x) => x.applicationKeyId === env[`B2_${k.env}_KEY_ID`]);
  for (const k of [ADMIN_KEY, ...APP_KEYS]) {
    const live = saved(k);
    if (live && (!k.capabilities || sameCaps(live.capabilities, k.capabilities))) { console.log(`key ${k.keyName} already made`); continue; }
    if (live) {
      // Capabilities can't be edited: replace the key, then its .env lines.
      await call(auth, 'b2_delete_key', { applicationKeyId: live.applicationKeyId });
      forgetEnv(k.env, k.keyName);
      existing = existing.filter((x) => x.applicationKeyId !== live.applicationKeyId);
      console.log(`replacing key ${k.keyName} (capabilities changed)`);
    }
    let bucketId = null;
    let capabilities = k.capabilities;
    if (k === ADMIN_KEY) {
      if (auth.as !== 'master key') throw new Error('clusters-admin can only be made with the master key');
      capabilities = auth.capabilities.filter((c) => !k.without.includes(c));
    } else {
      bucketId = buckets[k.bucket]?.bucketId;
      if (!bucketId) throw new Error(`${k.keyName}: bucket ${SPEC[k.bucket].name} doesn't exist yet (run apply)`);
    }
    const made = await makeKey(auth, existing, k, bucketId, capabilities);
    saveEnv([`B2_${k.env}_KEY_ID=${made.applicationKeyId}`, `B2_${k.env}_APP_KEY=${made.applicationKey}`],
      `Backblaze B2 key ${k.keyName} (scripts/b2Setup.mjs)`);
    console.log(`made key ${k.keyName}: ${bucketId ? buckets[k.bucket].bucketName : 'all buckets'}, ${capabilities.join(', ')}`);
  }
}

async function replicate(auth) {
  const buckets = await listBuckets(auth);
  if (!buckets.main || !buckets.backup) throw new Error('Both buckets must exist first (run apply)');
  if (!replicationDrift(buckets).length) { console.log('replication already on'); return; }
  const { keys: existing } = await call(auth, 'b2_list_keys', { accountId: auth.accountId, maxKeyCount: 1000 });
  const reuse = (name) => existing.find((x) => x.keyName === name);
  // Backblaze holds these two keys' secrets itself; nothing is saved here.
  const src = reuse(REPL.source.keyName) || await call(auth, 'b2_create_key', {
    accountId: auth.accountId, keyName: REPL.source.keyName, capabilities: REPL.source.capabilities, bucketId: buckets.main.bucketId,
  });
  const dst = reuse(REPL.dest.keyName) || await call(auth, 'b2_create_key', {
    accountId: auth.accountId, keyName: REPL.dest.keyName, capabilities: REPL.dest.capabilities, bucketId: buckets.backup.bucketId,
  });
  await call(auth, 'b2_update_bucket', {
    accountId: auth.accountId, bucketId: buckets.backup.bucketId,
    replicationConfiguration: { asReplicationDestination: { sourceToDestinationKeyMapping: { [src.applicationKeyId]: dst.applicationKeyId } } },
  });
  await call(auth, 'b2_update_bucket', {
    accountId: auth.accountId, bucketId: buckets.main.bucketId,
    replicationConfiguration: {
      asReplicationSource: {
        replicationRules: [{
          destinationBucketId: buckets.backup.bucketId, fileNamePrefix: '', includeExistingFiles: true,
          isEnabled: true, priority: 1, replicationRuleName: REPL.rule,
        }],
        sourceApplicationKeyId: src.applicationKeyId,
      },
    },
  });
  console.log(`replication on: ${buckets.main.bucketName} → ${buckets.backup.bucketName}, existing files included`);
}

const cmd = process.argv[2];
const commands = { check, apply, keys, replicate };
if (!commands[cmd]) {
  console.log('usage: node scripts/b2Setup.mjs check|apply|keys|replicate');
  process.exit(2);
}
try {
  const auth = await authorize(readEnv());
  console.log(`Backblaze account ${auth.accountId}, ${auth.s3ApiUrl}, as ${auth.as}`);
  const ok = await commands[cmd](auth);
  if (cmd === 'check' && !ok) process.exitCode = 1;
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
