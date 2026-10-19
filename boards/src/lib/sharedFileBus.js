// Open a file shared with you inside the app (SharedFileHost listens):
//   openSharedFile({ token, via })
// via: 'shared_page' | 'bell' | 'toast' | 'shortcut' | 'link'.
import { FILE_TOKEN_RE } from './fileShareBundle.js';

export const SHARED_FILE_EVENT = 'soleil-open-shared-file';

export function openSharedFile(detail) {
  if (typeof document === 'undefined' || !FILE_TOKEN_RE.test(String(detail?.token || ''))) return;
  document.dispatchEvent(new CustomEvent(SHARED_FILE_EVENT, { detail }));
}

// Something on the Shared page's lists changed (a file opened, hidden, saved,
// or a share stopped): the page and the sidebar's count read again.
export const SHARED_FILES_CHANGED_EVENT = 'soleil-shared-files-changed';

export function notifySharedFilesChanged() {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(SHARED_FILES_CHANGED_EVENT));
}
