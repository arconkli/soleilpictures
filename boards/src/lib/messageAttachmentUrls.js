import { attachmentUrl } from './messageAttachmentLinks.js';

// Where a message attachment's bytes are served from. message-attachments is a
// public bucket, so the object URL is derived from the storage path alone.
// (messageAttachmentLinks.js stays pure so node --test can import it; the
// build-time env lives here.)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

// Dev QA harness only (?msgqa=1): Playwright's example.supabase.co never serves
// an image, so the harness swaps in a resolver that serves local photos.
let qaResolver = null;
export function installAttachmentResolverForQa(fn) {
  if (!import.meta.env.DEV) return;
  qaResolver = typeof fn === 'function' ? fn : null;
}

export function publicAttachmentUrl(path, { download } = {}) {
  if (qaResolver) return qaResolver(path, { download }) || '';
  return attachmentUrl(SUPABASE_URL, path, { download });
}
