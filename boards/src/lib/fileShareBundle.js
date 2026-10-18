// Pure core of the party Worker's POST /file-share route. get_file_share (SQL)
// decides who may open the file; this turns its answer into the response the
// recipient page reads, and decides which storage keys get a presigned URL.
// Storage keys never leave the Worker: the page gets URLs only.

export const FILE_SHARE_URL_TTL_SECONDS = 6 * 60 * 60;
export const FILE_SHARE_CACHE_CONTROL = 'private, max-age=21600';
export const FILE_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The name a saved copy gets: file.name, plus `.ext` when the name carries no
// extension of its own and the extension is known.
export function downloadName(file) {
  const name = String((file && file.name) || '').trim() || 'File';
  const ext = String((file && file.ext) || '').replace(/^\./, '').trim();
  if (!ext || /\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
  return `${name}.${ext}`;
}

// result: the get_file_share jsonb (or null). sign(key, disposition|null) →
// Promise<url>; dispositionFor(name) → a Content-Disposition value or null.
export async function fileShareResponse(result, sign, dispositionFor) {
  const status = result && typeof result === 'object' ? result.status : null;
  if (status === 'sign_in') return { status: 'sign_in' };
  if (status === 'no_access') return { status: 'no_access', email: result.email ?? null };
  if (status !== 'ok' || !result.file) return { status: 'gone' };

  const { keys, ...rest } = result;
  const file = result.file;
  const k = keys && typeof keys === 'object' ? keys : {};
  const urls = {};
  const jobs = [];
  const add = (name, key, disposition) => {
    jobs.push((async () => {
      try { urls[name] = await sign(key, disposition); } catch (_) { /* drop this url only */ }
    })());
  };
  // A program file or a plain file is never previewed inline.
  if (k.src && !file.risky && file.kind !== 'file') add('src', k.src, null);
  if (k.poster) add('poster', k.poster, null);
  if (result.allow_download && k.src) {
    add('download', k.src, dispositionFor ? dispositionFor(downloadName(file)) : null);
  }
  await Promise.all(jobs);
  return { ...rest, urls, ttl: FILE_SHARE_URL_TTL_SECONDS };
}
