// Appearance — everything personal about how the app looks and how the canvas
// answers your hands. None of it is shared with the workspace: it all writes
// profiles.settings.ui and follows the account between devices.
//
// This was two tabs, Theme and Display, sitting behind a button labelled
// "Workspace settings" — which was wrong twice over. They are one tab now,
// in the personal half of the panel, split into three sections instead.
import { updateOwnSettings } from '../../lib/boardsApi.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { applyThemeNow, osPrefersLight } from '../../lib/theme.js';
import { WHEEL_MODES, getWheelMode, applyWheelModeNow } from '../../lib/wheelMode.js';
import { Field, Toggle, SettingsCategory, AccentPicker, FontField } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';

// Cmd on a Mac, Ctrl everywhere else — the copy has to name the key the reader
// actually has. Same derivation as ShortcutsOverlay.
const WHEEL_CMD = (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')) ? '⌘' : 'Ctrl';

// `null` first, because it is the state you are in before you ever touch this
// and the one the app is designed around — not a fallback for the other two.
const THEME_MODES = [
  { id: null,    label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark',  label: 'Dark' },
];

export function AppearanceTab({ mySettings, refresh }) {
  const save = useSettingsSave();
  const ui = mySettings.ui || {};
  const setUi = (patch) => save(async () => {
    await updateOwnSettings({ ui: { ...ui, ...patch } });
    refresh?.();
  });

  // Apply theme live on change so the user sees it instantly. applyThemeNow
  // sets data-theme AND mirrors it into the soleil.ui cache synchronously —
  // the same shared path the topbar quick toggle uses — so the two controls
  // and the next remount/cold-load can never disagree. setUi then persists
  // the choice server-side.
  //
  // `null` is a real choice meaning "follow the OS", and it must persist AS
  // null: it is the absence of an explicit theme that lets resolveTheme() and
  // the matchMedia listener in App.jsx take over. Keep this in step with
  // setTheme() there — same rule, two callers.
  const applyTheme = (choice) => {
    applyThemeNow(choice);
    setUi({ theme: choice });
  };

  // getWheelMode() rather than ui.wheelMode: the module is what the canvas
  // actually reads, so the pills can never show a mode the wheel isn't using.
  const wheelMode = getWheelMode();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Appearance</h3>
      <p className="settings-section-hint">
        Personal — these change how Clusters looks and behaves for you, on every
        {' '}device you sign in on. Nobody else in the workspace sees them.
      </p>

      <SettingsCategory title="Theme" desc="How the app is painted">
        {/* Three states, because there have always BEEN three: an explicit
            light or dark, or no choice at all, which follows the OS. Only two
            pills shipped, and "no choice" was drawn as Dark — so somebody on a
            light Mac saw a light app with Dark highlighted, and the first click
            on either pill locked them out of OS-following for good. */}
        <Field label="Mode">
          <div className="settings-pill-row">
            {THEME_MODES.map((m) => (
              <button key={m.id || 'system'} type="button"
                      className={`settings-pill ${(ui.theme ?? null) === m.id ? 'is-active' : ''}`}
                      onClick={() => applyTheme(m.id)}>{m.label}</button>
            ))}
          </div>
        </Field>
        {(ui.theme ?? null) === null && (
          <p className="settings-section-hint">
            Following your system — Clusters is {osPrefersLight() ? 'light' : 'dark'} right
            {' '}now and switches when your device does.
          </p>
        )}

        <Field label="Accent">
          <AccentPicker value={ui.accent || null} onChange={(v) => setUi({ accent: v })} />
        </Field>

        <Field label="Body font">
          <FontField value={ui.fontSans || null} onChange={(v) => setUi({ fontSans: v })} />
        </Field>
      </SettingsCategory>

      <SettingsCategory title="Layout" desc="What's on screen when you start">
        <Toggle
          label="Clean mode"
          desc="Hide the sidebar, toolbar, breadcrumb, and overlays. ⌘. toggles."
          value={!!ui.hideChrome}
          onChange={(v) => {
            if (v) document.body.setAttribute('data-clean-mode', '1');
            else document.body.removeAttribute('data-clean-mode');
            setUi({ hideChrome: v });
          }} />

        <Toggle
          label="Sidebar open by default"
          desc="When you launch the app, start with the sidebar expanded."
          value={ui.sidebarOpen !== false}
          onChange={(v) => setUi({ sidebarOpen: v })} />
      </SettingsCategory>

      {/* Scroll wheel. The convention splits across the tools people arrive
          from — PureRef and Miro zoom, Figma and Milanote pan — so this is a
          preference rather than a default we could get right for everyone.
          Applied synchronously as well as saved: the canvas reads the module,
          not this component, so the gesture changes under the user's hand
          rather than after the profile round-trip. */}
      <SettingsCategory title="Canvas" desc="How the canvas answers your hands">
        <Field label="Scroll wheel">
          <div className="settings-pill-row">
            {WHEEL_MODES.map((m) => (
              <button key={m} type="button"
                      className={`settings-pill ${wheelMode === m ? 'is-active' : ''}`}
                      onClick={() => {
                        applyWheelModeNow(m);
                        setUi({ wheelMode: m });
                        try { logEvent(EV.WHEEL_MODE_SET, { mode: m, source: 'settings' }); } catch (_) {}
                      }}>
                {m === 'pan' ? 'Pan' : 'Zoom'}
              </button>
            ))}
          </div>
        </Field>
        <p className="settings-section-hint">
          {wheelMode === 'zoom'
            ? `Scrolling zooms at the pointer. ${WHEEL_CMD}-scroll, Alt-scroll or Shift-scroll pans.`
            : `Scrolling pans the canvas. ${WHEEL_CMD}-scroll zooms.`}
          {' '}Pinching a trackpad always zooms.
        </p>
      </SettingsCategory>
    </div>
  );
}
