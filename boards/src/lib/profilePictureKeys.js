// profilePictureKeys.js — which profile pictures the upload party may sign for
// someone who cannot read the picture's images row. Pure, node-testable.
//
// A profile picture is uploaded with no cluster, under whichever workspace was
// open at the time. /sign-reads signs a key only when the caller can read its
// images row, so a person who shares a DIFFERENT workspace with the owner got
// no URL and saw an initial. The party (party/upload.ts handleSignReads) now
// makes two more reads for the keys it refused:
//
//   1. member_profiles, as the caller: which of these keys is the avatar_url
//      of a profile this person may read (0382: self, workspace-mates, admins).
//   2. images, as the service role: is the key really that person's own
//      never-used picture.
//
// The second read is the security half. avatar_url is written by the client,
// so anyone could point their own profile at a key from a workspace they have
// left and then read their own row. "Uploaded by the owner with no cluster"
// is not enough: a file sent through the API and never placed has no cluster,
// and neither does a picture whose cluster was hard-deleted (images.board_id
// is ON DELETE SET NULL). So a key is signed only when the profile's owner
// uploaded it and the row has never been used on a cluster, attached to a
// card, named or deleted (signableProfileKeys), and only when the key has a
// picture's extension (isPictureKey).

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Exactly what the party's sign route builds: `${workspaceId}/${randomUUID()}.${ext}`,
// the ext 1-8 lowercase letters and digits. Nothing else is considered, which
// also means no quote, comma, backslash or parenthesis can reach a query.
const UPLOAD_KEY_RE = new RegExp(`^${UUID}/${UUID}\\.[a-z0-9]{1,8}$`);

const AVATAR_PREFIX = 'r2:';

export function isUploadKey(key) {
  return typeof key === 'string' && UPLOAD_KEY_RE.test(key);
}

// An upload key whose extension is a picture's. A profile picture is always
// one of these; a PDF, a video or a zip never is.
const PICTURE_KEY_RE = /\.(?:webp|png|jpg|jpeg|gif|avif)$/;

export function isPictureKey(key) {
  return isUploadKey(key) && PICTURE_KEY_RE.test(key);
}

// The requested keys the first read refused that could be a profile picture.
export function profilePictureCandidates(requested, allowedKeys) {
  const out = [];
  const seen = new Set();
  for (const key of Array.isArray(requested) ? requested : []) {
    if (!isPictureKey(key) || allowedKeys?.has?.(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// A PostgREST in.(…) value, not yet URL-encoded. `prefix` is 'r2:' for the
// member_profiles read (avatar_url stores `r2:<key>`) and '' for images.
// Keys that are not upload-shaped are dropped here too, so the list is safe
// whoever calls it.
export function keysInList(keys, prefix = '') {
  const list = (Array.isArray(keys) ? keys : []).filter(isUploadKey).map((k) => `"${prefix}${k}"`);
  return `in.(${list.join(',')})`;
}

export function avatarInList(keys) {
  return keysInList(keys, AVATAR_PREFIX);
}

// member_profiles rows → Map<key, Set<user_id>>. A row whose avatar_url is not
// `r2:<upload key>` (an outside URL, a bare key, null) says nothing.
export function avatarOwnersByKey(profileRows) {
  const owners = new Map();
  for (const row of Array.isArray(profileRows) ? profileRows : []) {
    const url = row?.avatar_url;
    const userId = row?.user_id;
    if (typeof url !== 'string' || !url.startsWith(AVATAR_PREFIX)) continue;
    if (typeof userId !== 'string' || !userId) continue;
    const key = url.slice(AVATAR_PREFIX.length);
    if (!isUploadKey(key)) continue;
    if (!owners.has(key)) owners.set(key, new Set());
    owners.get(key).add(userId);
  }
  return owners;
}

// Columns that must all be null on a profile picture's images row: it is on no
// cluster and no card, no cluster's card ever used it (first_referenced_at,
// 0315/0603, which outlives the cluster), it carries no file name (0355: file
// and API drops do, the profile upload does not) and it is not deleted.
const MUST_BE_NULL = ['board_id', 'card_id', 'first_referenced_at', 'original_name', 'deleted_at'];

// The keys to sign: an images row with that storage_path, never used (see
// MUST_BE_NULL), uploaded by a person whose readable profile carries it.
// `owners` is avatarOwnersByKey's map; `imageRows` are { storage_path,
// board_id, card_id, first_referenced_at, original_name, deleted_at,
// uploaded_by } read as the service role. The party's query filters on the
// same columns; they are checked again here so the rule holds if the query
// changes. A column missing from a row counts as null, so the query has to
// select them all (profilePictureKeys.test.mjs pins that).
export function signableProfileKeys(owners, imageRows) {
  const out = new Set();
  for (const row of Array.isArray(imageRows) ? imageRows : []) {
    const key = row?.storage_path;
    if (!isPictureKey(key)) continue;
    if (MUST_BE_NULL.some((col) => row[col] != null)) continue;
    const uploader = row?.uploaded_by;
    if (typeof uploader !== 'string' || !uploader) continue;
    if (owners?.get?.(key)?.has(uploader)) out.add(key);
  }
  return out;
}
