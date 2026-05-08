// Resolves the active "defaults" object that drives every new
// card/board/doc/note's initial values. The resolution order is:
//
//   1. Workspace settings (current workspace)  — set by editors+owners
//   2. User settings                            — per-user overrides
//   3. HARDCODED_FALLBACKS                      — what shipped before
//
// At each level a top-level key (note/board/doc/shape/palette/ui)
// is treated atomically — if `workspace.note.bgColor` is set, the
// workspace's whole `note` object overrides user/fallback for the
// note category. We deep-merge by key category so a partial workspace
// `note` (e.g. only bgColor) still inherits the rest from user.
//
// The hook returns:
//   { defaults, role, refresh, mySettings, workspaceSettings }
//
// `role` is the caller's workspace role ('editor'/'owner'/'viewer'/null);
// SettingsPanel uses it to gate the workspace-side controls.

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  getWorkspaceSettings,
  getOwnProfile,
  getMyWorkspaceRole,
} from '../lib/boardsApi.js';

// Hardcoded defaults — exact values that shipped pre-settings. If a
// user/workspace doesn't override a field, this is what they get.
export const HARDCODED_FALLBACKS = Object.freeze({
  note: {
    // null => transparent floating text on the canvas. The user can
    // still repaint per-note from the bottom toolbar, or set a
    // workspace-wide default in Settings → Defaults → Notes.
    bgColor:    null,
    textColor:  null,
    fontFamily: null,           // null => inherit page font
    fontSize:   null,
    w: 200, h: 200,
  },
  board: {
    cover: 'neutral',
    view:  'canvas',
    w: 280, h: 220,
  },
  doc: {
    fontFamily: null,
    w: 320, h: 240,
  },
  shape: {
    shape: 'rect',
    stroke: '#f5f5f6',
    fill: 'transparent',
    strokeWidth: 2,
    dash: 'solid',
    w: 160, h: 100,
  },
  palette: {
    swatches: [
      { name: 'Color', hex: '#3b82f6' },
      { name: 'Color', hex: '#10b981' },
    ],
    w: 280, h: 130,
  },
  ui: {
    theme: null,                // null => leave whatever data-theme is set
    accent: null,               // null => use --soleil from CSS
    fontSans: null,
    fontDisplay: null,
    fontMono: null,
    hideChrome: false,
    sidebarOpen: true,
  },
});

// Shallow-merge two category objects (key-by-key). Right wins where
// the right side's value is non-null/undefined; left fills the rest.
function mergeCat(left, right) {
  if (!right) return { ...left };
  const out = { ...left };
  for (const k of Object.keys(right)) {
    const v = right[k];
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

export function useResolvedDefaults({ workspaceId, userId }) {
  const [workspaceSettings, setWorkspaceSettings] = useState({});
  const [mySettings, setMySettings] = useState({});
  const [role, setRole] = useState(null);
  const [tick, setTick] = useState(0);

  // Re-fetch whenever workspace/user changes or callers explicitly
  // refresh (e.g. after the SettingsPanel saves).
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceId) {
      setWorkspaceSettings({});
      setRole(null);
      return;
    }
    Promise.all([
      getWorkspaceSettings(workspaceId).catch(() => ({})),
      getMyWorkspaceRole(workspaceId).catch(() => null),
    ]).then(([ws, r]) => {
      if (cancelled) return;
      setWorkspaceSettings(ws || {});
      setRole(r);
    });
    return () => { cancelled = true; };
  }, [workspaceId, tick]);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setMySettings({});
      return;
    }
    getOwnProfile()
      .then(p => { if (!cancelled) setMySettings(p?.settings || {}); })
      .catch(() => { if (!cancelled) setMySettings({}); });
    return () => { cancelled = true; };
  }, [userId, tick]);

  const defaults = useMemo(() => {
    // Card categories (note/board/doc/shape/palette) are workspace-only.
    // The `ui` category is per-user (theme, accent, hideChrome, fonts).
    // We deliberately don't merge user.note over workspace.note — defaults
    // on the canvas are a *house style* concept, not a personal one.
    const out = {};
    for (const k of Object.keys(HARDCODED_FALLBACKS)) {
      if (k === 'ui') {
        out[k] = mergeCat(HARDCODED_FALLBACKS[k], mySettings[k]);
      } else {
        out[k] = mergeCat(HARDCODED_FALLBACKS[k], workspaceSettings[k]);
      }
    }
    return out;
  }, [workspaceSettings, mySettings]);

  return { defaults, role, refresh, workspaceSettings, mySettings };
}
