// homeAfterSwitch — a workspace switched (or created) from Home opens on Home.
//
// App keys the whole Workspace by its id, so switching remounts all of it and
// every piece of its state starts over: the surface comes back as the canvas.
// That is right for the sidebar's switcher, which takes you to work. It is
// wrong for Home's, which is a place to look across projects — switching there
// should show the other workspace's projects, not drop you into its Studio.
//
// So Home's switcher notes the TARGET workspace here just before switching,
// and the new Workspace reads it as it mounts (homeAfterSwitchFor, in its
// surface's initial state) and clears it just after (clearHomeAfterSwitch, in
// an effect — reading and clearing in one go inside a state initializer would
// break under StrictMode, which runs initializers twice). The note names the
// workspace it is for, so a switch that never happened (a failed create, the
// tab reloaded) cannot send some later mount to Home. sessionStorage: this tab
// only, gone with it.
//
// The same remount throws away an open Settings panel, so a second note carries
// that across too: "Rename & icon…" on a workspace you are not in switches you
// into it and has to open its Settings in the NEW mount, not the dying one.
//
// Pure apart from the storage handed in.

export const HOME_AFTER_SWITCH_KEY = 'soleil.home.afterSwitch';
export const SETTINGS_AFTER_SWITCH_KEY = 'soleil.settings.afterSwitch';

function store(storage) {
  if (storage) return storage;
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch (_) { return null; }
}

export function markHomeAfterSwitch(workspaceId, storage) {
  const s = store(storage);
  if (!s || !workspaceId) return false;
  try { s.setItem(HOME_AFTER_SWITCH_KEY, String(workspaceId)); return true; } catch (_) { return false; }
}

// Is there a note, and is it for THIS workspace? Reads only.
export function homeAfterSwitchFor(workspaceId, storage) {
  const s = store(storage);
  if (!s || !workspaceId) return false;
  try { return s.getItem(HOME_AFTER_SWITCH_KEY) === String(workspaceId); } catch (_) { return false; }
}

export function clearHomeAfterSwitch(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(HOME_AFTER_SWITCH_KEY); } catch (_) { /* nothing to clear */ }
}

// Settings to open in the workspace being switched to, and on which tab.
export function markSettingsAfterSwitch(workspaceId, tab = 'general', storage) {
  const s = store(storage);
  if (!s || !workspaceId) return false;
  try {
    s.setItem(SETTINGS_AFTER_SWITCH_KEY, JSON.stringify({ ws: String(workspaceId), tab: tab || 'general' }));
    return true;
  } catch (_) { return false; }
}

// The tab to open for THIS workspace, or null. Reads only.
export function settingsAfterSwitchFor(workspaceId, storage) {
  const s = store(storage);
  if (!s || !workspaceId) return null;
  try {
    const n = JSON.parse(s.getItem(SETTINGS_AFTER_SWITCH_KEY) || 'null');
    return n && n.ws === String(workspaceId) && typeof n.tab === 'string' ? n.tab : null;
  } catch (_) { return null; }
}

export function clearSettingsAfterSwitch(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(SETTINGS_AFTER_SWITCH_KEY); } catch (_) { /* nothing to clear */ }
}
