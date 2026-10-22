// editorLimitPreview — where Settings › Preview keeps an admin's "show my
// account as…" for the 10-editor limit. Preview host and dev only; per
// browser; look only (lib/editorLimit.js applyEditorLimitPreview).
import { onPreviewHost } from './appHost.js';
import { EDITOR_LIMIT_PREVIEW_STATES } from './editorLimit.js';

export const EDITOR_LIMIT_PREVIEW_KEY = 'soleil.preview.editorLimitAs';
export const EDITOR_LIMIT_PREVIEW_EVENT = 'soleil:editor-limit-preview';

export function editorLimitPreviewAvailable() {
  return onPreviewHost() || !!import.meta.env.DEV;
}

export function readEditorLimitPreview() {
  if (!editorLimitPreviewAvailable()) return null;
  try {
    const v = window.localStorage.getItem(EDITOR_LIMIT_PREVIEW_KEY);
    return EDITOR_LIMIT_PREVIEW_STATES.includes(v) ? v : null;
  } catch (_) { return null; }
}

export function writeEditorLimitPreview(state) {
  try {
    if (EDITOR_LIMIT_PREVIEW_STATES.includes(state)) window.localStorage.setItem(EDITOR_LIMIT_PREVIEW_KEY, state);
    else window.localStorage.removeItem(EDITOR_LIMIT_PREVIEW_KEY);
  } catch (_) {}
  try { window.dispatchEvent(new Event(EDITOR_LIMIT_PREVIEW_EVENT)); } catch (_) {}
}
