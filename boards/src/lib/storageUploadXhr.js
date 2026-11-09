// The request @supabase/storage-js sends for `from(bucket).upload(path, file)`,
// sent by XMLHttpRequest instead, because fetch has no upload progress.
//
// Mirrors StorageFileApi.uploadOrUpdate (storage-js 2.105.1) for a File/Blob
// body: POST `${storageUrl}/object/${bucket}/${path}`; headers = the client's
// own headers + `x-upsert`, with `apikey` and `Authorization: Bearer <token>`
// the way supabase-js's fetchWithAuth adds them; body = FormData with
// `cacheControl` then the file under the empty field name. No content-type
// header is set for a form body (the browser adds the boundary). The
// contentType option is not sent for a Blob either: the file part carries the
// File's own type, exactly as storage-js does. That is why uploadMessageFile
// hands this a file already retyped (retype below) to the type to be served.
//
// storageUploadXhr.test.mjs runs storage-js's real upload against a stubbed
// fetch and asserts this builder produces the same request. If the package
// is upgraded and the test fails, the request moved: re-read uploadOrUpdate.
// Pure: no supabase import, so node --test can load it.

const DEFAULT_CACHE_CONTROL = '3600';

// A File that declares `type`, sharing the original's bytes (no copy).
export function retype(file, type) {
  if (!file || !type || file.type === type) return file;
  if (typeof File === 'function') {
    return new File([file], file.name || 'file', { type, lastModified: file.lastModified });
  }
  return new Blob([file], { type });
}

// storage-js: _removeEmptyFolders, then _getFinalPath.
function finalPath(bucket, path) {
  const clean = String(path).replace(/^\/|\/$/g, '').replace(/\/+/g, '/');
  return { clean, full: `${bucket}/${clean.replace(/^\/+/, '')}` };
}

// → { url, method, headers (lower-case names), fields: [[name, value], ...], cleanPath }
export function buildStorageUpload({
  storageUrl, bucket, path, file, headers = {}, apikey, token, cacheControl = DEFAULT_CACHE_CONTROL, upsert = false,
}) {
  const { clean, full } = finalPath(bucket, path);
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = String(v);
  out['x-upsert'] = String(upsert);
  if (apikey && !('apikey' in out)) out.apikey = apikey;
  if (!('authorization' in out)) out.authorization = `Bearer ${token || apikey}`;
  return {
    url: `${storageUrl}/object/${full}`,
    method: 'POST',
    headers: out,
    fields: [['cacheControl', String(cacheControl)], ['', file]],
    cleanPath: clean,
  };
}

// Send it. Resolves { data: { path, id, fullPath }, error: null } or
// { data: null, error: { message, status } }, storage-js's own shape.
export function sendStorageUpload(req, { onProgress = null, XHR = (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null) } = {}) {
  return new Promise((resolve) => {
    if (!XHR) { resolve({ data: null, error: { message: 'No XMLHttpRequest', status: 0 } }); return; }
    const xhr = new XHR();
    const fail = (message, status = 0) => resolve({ data: null, error: { message, status } });
    xhr.open(req.method, req.url);
    for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e && e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onerror = () => fail('Network error');
    xhr.onabort = () => fail('Upload cancelled');
    xhr.ontimeout = () => fail('Upload timed out');
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ data: { path: req.cleanPath, id: body?.Id, fullPath: body?.Key }, error: null });
      } else {
        fail(body?.message || body?.error || xhr.statusText || `HTTP ${xhr.status} error`, xhr.status);
      }
    };
    const form = new FormData();
    for (const [k, v] of req.fields) form.append(k, v);
    xhr.send(form);
  });
}
