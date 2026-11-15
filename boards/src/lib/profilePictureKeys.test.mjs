import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isUploadKey, isPictureKey, profilePictureCandidates, keysInList, avatarInList, avatarOwnersByKey, signableProfileKeys,
} from './profilePictureKeys.js';

const WS = '11111111-2222-4333-8444-555555555555';
const OBJ = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY = `${WS}/${OBJ}.jpg`;
const KEY2 = `${WS}/99999999-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';

test('only the key the sign route builds counts as an upload key', () => {
  assert.equal(isUploadKey(KEY), true);
  assert.equal(isUploadKey(`${WS}/${OBJ}.bin`), true);
  assert.equal(isUploadKey(`${WS}/${OBJ}.a`), true);
  assert.equal(isUploadKey(`${WS}/${OBJ}.jpeg2000`), true);

  for (const bad of [
    '', null, undefined, 42, {},
    `${WS}/${OBJ}`,                       // no extension
    `${WS}/${OBJ}.`,                      // empty extension
    `${WS}/${OBJ}.jpeg20001`,             // nine characters
    `${WS}/${OBJ}.JPG`,                   // uppercase extension
    `${WS}/${OBJ.toUpperCase()}.jpg`,     // uppercase id
    `${WS}/${OBJ}.jpg"`,                  // quote
    `"${WS}/${OBJ}.jpg`,
    `${WS}/${OBJ}.jp,g`,                  // comma
    `${KEY},${KEY2}`,
    `${WS}/${OBJ}.jpg\\`,                 // backslash
    `${WS}\\${OBJ}.jpg`,
    `${WS}/../${OBJ}.jpg`,                // traversal
    `../${WS}/${OBJ}.jpg`,
    `${WS}/thumbs/${OBJ}.jpg`,            // extra segment
    `${WS}/${OBJ}.jpg/x`,
    `${WS}/${OBJ}.tar.gz`,
    `r2:${KEY}`,                          // the stored form, not a key
    ` ${KEY}`, `${KEY}\n`,
    `${WS}/${OBJ}.jpg)`,
    `${WS}/not-a-uuid.jpg`,
  ]) {
    assert.equal(isUploadKey(bad), false, JSON.stringify(bad));
  }
});

test('candidates are the refused, well-formed keys, once each', () => {
  const allowed = new Set([KEY2]);
  assert.deepEqual(
    profilePictureCandidates([KEY, KEY2, KEY, 'x","y', `${WS}/../${OBJ}.jpg`], allowed),
    [KEY],
  );
  assert.deepEqual(profilePictureCandidates([], allowed), []);
  assert.deepEqual(profilePictureCandidates(null, allowed), []);
});

test('only a key with a picture extension is a candidate', () => {
  for (const ext of ['webp', 'png', 'jpg', 'jpeg', 'gif', 'avif']) {
    const key = `${WS}/${OBJ}.${ext}`;
    assert.equal(isPictureKey(key), true, ext);
    assert.deepEqual(profilePictureCandidates([key], new Set()), [key], ext);
  }
  for (const ext of ['pdf', 'mp4', 'zip', 'bin', 'svg', 'heic', 'psd', 'jpg2', 'xjpg', 'PNG']) {
    const key = `${WS}/${OBJ}.${ext}`;
    assert.equal(isPictureKey(key), false, ext);
    assert.deepEqual(profilePictureCandidates([key], new Set()), [], ext);
  }
  assert.equal(isPictureKey(`${WS}/thumbs/${OBJ}.jpg`), false);
  assert.equal(isPictureKey(null), false);
});

test('the IN lists quote each key, and avatar_url is looked up with its r2: prefix', () => {
  assert.equal(keysInList([KEY, KEY2]), `in.("${KEY}","${KEY2}")`);
  assert.equal(avatarInList([KEY, KEY2]), `in.("r2:${KEY}","r2:${KEY2}")`);
  // A malformed key never reaches a query, whoever built the list.
  assert.equal(avatarInList([KEY, 'a","b']), `in.("r2:${KEY}")`);
  assert.equal(keysInList(['a\\', '"']), 'in.()');
});

test('profile rows map to key → owners with the r2: prefix stripped', () => {
  const owners = avatarOwnersByKey([
    { user_id: OWNER, avatar_url: `r2:${KEY}` },
    { user_id: OTHER, avatar_url: `r2:${KEY}` },          // two profiles, one key
    { user_id: OTHER, avatar_url: KEY2 },                 // no prefix: says nothing
    { user_id: OTHER, avatar_url: 'https://example.com/a.jpg' },
    { user_id: OTHER, avatar_url: null },
    { user_id: OTHER, avatar_url: 'r2:not/a/key.jpg' },
    { user_id: null, avatar_url: `r2:${KEY2}` },
    null,
  ]);
  assert.deepEqual([...owners.keys()], [KEY]);
  assert.deepEqual([...owners.get(KEY)].sort(), [OWNER, OTHER].sort());
  assert.equal(avatarOwnersByKey(null).size, 0);
  assert.equal(avatarOwnersByKey({ not: 'rows' }).size, 0);
});

test('a key is signed only when the profile owner uploaded it, with no cluster', () => {
  const owners = avatarOwnersByKey([{ user_id: OWNER, avatar_url: `r2:${KEY}` }]);

  // Uploaded by the owner, no cluster: signed.
  assert.deepEqual(
    [...signableProfileKeys(owners, [{ storage_path: KEY, board_id: null, uploaded_by: OWNER }])],
    [KEY],
  );
  // On a readable profile, but someone else's upload: the profile was pointed
  // at a key that is not its owner's. Not signed.
  assert.equal(signableProfileKeys(owners, [{ storage_path: KEY, board_id: null, uploaded_by: OTHER }]).size, 0);
  // The owner's upload, but onto a cluster: a card's picture, not a profile's.
  assert.equal(
    signableProfileKeys(owners, [{ storage_path: KEY, board_id: 'bbbbbbbb-0000-4000-8000-000000000009', uploaded_by: OWNER }]).size,
    0,
  );
  // No images row at all, a row for a key no profile carries, a row with no uploader.
  assert.equal(signableProfileKeys(owners, []).size, 0);
  assert.equal(signableProfileKeys(owners, [{ storage_path: KEY2, board_id: null, uploaded_by: OWNER }]).size, 0);
  assert.equal(signableProfileKeys(owners, [{ storage_path: KEY, board_id: null, uploaded_by: null }]).size, 0);
  assert.equal(signableProfileKeys(owners, null).size, 0);
  assert.equal(signableProfileKeys(new Map(), [{ storage_path: KEY, board_id: null, uploaded_by: OWNER }]).size, 0);
});

// The owner's own cluster-less upload, as the service-role read returns it.
const cleanRow = (over = {}) => ({
  storage_path: KEY, board_id: null, card_id: null, first_referenced_at: null,
  original_name: null, deleted_at: null, uploaded_by: OWNER, ...over,
});
const ownersOf = (key = KEY) => avatarOwnersByKey([{ user_id: OWNER, avatar_url: `r2:${key}` }]);

test('a never-used picture the owner uploaded is signed', () => {
  assert.deepEqual([...signableProfileKeys(ownersOf(), [cleanRow()])], [KEY]);
});

test('refused: the picture is attached to a card', () => {
  assert.equal(signableProfileKeys(ownersOf(), [cleanRow({ card_id: 'card-1' })]).size, 0);
});

test('refused: a cluster card once used the picture, even though its cluster is gone', () => {
  assert.equal(signableProfileKeys(ownersOf(), [cleanRow({ first_referenced_at: '2026-10-01T00:00:00Z' })]).size, 0);
});

test('refused: the file carries a name, as file and API drops do', () => {
  assert.equal(signableProfileKeys(ownersOf(), [cleanRow({ original_name: 'contract.jpg' })]).size, 0);
});

test('refused: the picture is deleted', () => {
  assert.equal(signableProfileKeys(ownersOf(), [cleanRow({ deleted_at: '2026-11-01T00:00:00Z' })]).size, 0);
});

test('refused: a .pdf key, as a candidate and as a row', () => {
  const pdf = `${WS}/${OBJ}.pdf`;
  assert.deepEqual(profilePictureCandidates([pdf], new Set()), []);
  assert.equal(signableProfileKeys(ownersOf(pdf), [cleanRow({ storage_path: pdf })]).size, 0);
});

test('refused: another user uploaded it', () => {
  assert.equal(signableProfileKeys(ownersOf(), [cleanRow({ uploaded_by: OTHER })]).size, 0);
});

test('the upload party signs profile pictures with it, and never fails the request over it', () => {
  const src = readFileSync(new URL('../../party/upload.ts', import.meta.url), 'utf8');
  assert.match(src, /from "\.\.\/src\/lib\/profilePictureKeys\.js"/);
  const start = src.indexOf('async handleSignReads(');
  const end = src.indexOf('// ── Multipart upload', start);
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.match(body, /this\.profilePictureKeys\(requested, allowedKeys, accessToken\)/);

  const hStart = src.indexOf('private async profilePictureKeys(');
  assert.ok(hStart > 0);
  const helper = src.slice(hStart, src.indexOf('\n  }\n', hStart));
  assert.match(helper, /profilePictureCandidates\(/);
  assert.match(helper, /avatarInList\(/);
  assert.match(helper, /avatarOwnersByKey\(/);
  assert.match(helper, /signableProfileKeys\(/);
  // The images read is the service role's, and only never-used rows: every
  // column signableProfileKeys checks is selected and required to be null.
  assert.match(helper, /SUPABASE_SERVICE_ROLE_KEY/);
  const select = helper.match(/images\?select=([a-z_,]+)&/)?.[1].split(',') || [];
  assert.ok(select.includes('storage_path') && select.includes('uploaded_by'));
  for (const col of ['board_id', 'card_id', 'first_referenced_at', 'original_name', 'deleted_at']) {
    assert.ok(select.includes(col), `selects ${col}`);
    assert.ok(helper.includes(`&${col}=is.null`), `requires ${col} to be null`);
  }
  // No error response and no logging from this path.
  assert.doesNotMatch(helper, /Response\.json|status: 5\d\d|console\./);
});
