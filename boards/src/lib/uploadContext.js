// Who is uploading, where, and on what plan — for the uploads that start
// somewhere other than the board (a new version from Files or Info). App sets
// it once the workspace and plan are known; the board passes its own.
import { isLocalQaMode } from './localMode.js';

let ctx = { workspaceId: null, userId: null, allowLong: false, canAttemptFiles: true };

export function setUploadContext(next) {
  ctx = { ...ctx, ...(next || {}) };
}

// `local`: the ?local=1 harness, where nothing is uploaded (DEV builds only).
export function uploadContext(overrides = {}) {
  return { ...ctx, local: isLocalQaMode(), ...overrides };
}
