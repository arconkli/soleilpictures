// Appearance — everything personal about how the app looks and how the canvas
// answers your hands. None of it is shared with the workspace: it all writes
// profiles.settings.ui and follows the account between devices.
//
// This was two tabs, Theme and Display, sitting behind a button labelled
// "Workspace settings" — which was wrong twice over. They are one tab now,
// in the personal half of the panel, split into three sections instead.
import { useEffect, useRef, useState } from 'react';
import { useLingui, Trans } from '@lingui/react/macro';
import { t as tr } from '@lingui/core/macro';
import { updateOwnSettings } from '../../lib/boardsApi.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { applyThemeNow, osPrefersLight } from '../../lib/theme.js';
import { WHEEL_MODES, getWheelMode, applyWheelModeNow } from '../../lib/wheelMode.js';
import { getWasdPan, applyWasdPanNow } from '../../lib/wasdPan.js';
import { useHapticsEnabled } from '../HapticTap.jsx';
import { setHapticsEnabled, isTouchDevice, hapticsAvailable, usesSwitchTrick } from '../../lib/haptics.js';
import { Field, Toggle, SettingsCategory, AccentPicker, FontField } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';
import { useMatchMedia } from '../../hooks/useMatchMedia.js';
import { overlayPending, settlePending } from './pendingPatch.js';
import { LOCALES, LOCALE_NAMES } from '../../lib/i18n.js';
import { effectiveLocale, followAccountLocale } from '../../lib/accountLocale.js';

// Cmd on a Mac, Ctrl everywhere else — the copy has to name the key the reader
// actually has. Same derivation as ShortcutsOverlay.
const WHEEL_CMD = (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '')) ? '⌘' : 'Ctrl';

// `null` first, because it is the state you are in before you ever touch this
// and the one the app is designed around — not a fallback for the other two.
const THEME_MODES = [
  { id: null,    get label() { return tr({ message: 'System', context: 'theme' }); } },
  { id: 'light', get label() { return tr({ message: 'Light', context: 'theme' }); } },
  { id: 'dark',  get label() { return tr`Dark`; } },
];

export function AppearanceTab({ mySettings, refresh }) {
  const { t } = useLingui();
  const save = useSettingsSave();
  // A finger has no wheel and no W A S D: those rows, and the ⌘. hint, are a
  // computer's.
  const coarse = useMatchMedia('(pointer: coarse)');
  const showHaptics = isTouchDevice() && hapticsAvailable();
  // `ui` is the fetched copy with our unconfirmed writes on top. The RPC
  // replaces the whole `ui` key, so building a write from the fetched copy
  // alone let a second quick change revert the first (pendingPatch.js).
  // The ref carries the latest overlay into a write fired before a re-render.
  const serverUi = mySettings.ui || {};
  const [pending, setPending] = useState({});
  const pendingRef = useRef(pending);
  const serverUiRef = useRef(serverUi);
  serverUiRef.current = serverUi;
  useEffect(() => {
    const next = settlePending(serverUi, pendingRef.current);
    if (next !== pendingRef.current) { pendingRef.current = next; setPending(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySettings]);
  const ui = overlayPending(serverUi, pending);
  const setUi = (patch) => {
    const next = { ...pendingRef.current, ...patch };
    pendingRef.current = next;
    setPending(next);
    return save(async () => {
      await updateOwnSettings({ ui: overlayPending(serverUiRef.current, next) });
      refresh?.();
    });
  };

  // The choice is saved with the rest of Appearance (null is Automatic, which
  // follows the browser), then the page reloads into it (lib/accountLocale.js).
  const lang = LOCALES.includes(ui.lang) ? ui.lang : '';
  const autoName = LOCALE_NAMES[effectiveLocale(null)];
  const chooseLanguage = async (value) => {
    const next = LOCALES.includes(value) ? value : null;
    const ok = await setUi({ lang: next });
    if (!ok) return;
    try { logEvent(EV.LANGUAGE_SET, { lang: next || 'auto', locale: effectiveLocale(next) }); } catch (_) {}
    followAccountLocale(next);
  };

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
  // Same rule for W A S D movement: the canvas reads the module.
  const wasdPan = getWasdPan();
  // Haptics are per device (localStorage in lib/haptics.js), not part of the
  // account's ui settings.
  const hapticsOn = useHapticsEnabled();

  return (
    <div className="settings-section">
      <h3 className="settings-section-title"><Trans>Appearance</Trans></h3>
      <p className="settings-section-hint">
        <Trans>Personal — these change how Clusters looks and behaves for you, on every
        {' '}device you sign in on. Nobody else in the workspace sees them.</Trans>
      </p>

      <SettingsCategory title={t`Language`} desc={t`Menus, dates and the emails we send you`}>
        <Field label={t`Language`}>
          {/* Each language in its own words, so anyone can find theirs. */}
          <select className="settings-input" value={lang}
                  onChange={(e) => chooseLanguage(e.target.value)}>
            <option value="">{t`Automatic (${autoName})`}</option>
            {LOCALES.map((l) => (
              <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>
            ))}
          </select>
        </Field>
        <p className="settings-section-hint">
          {t`Automatic follows this browser. Cards, clusters and comments stay in the language they were written in.`}
        </p>
      </SettingsCategory>

      <SettingsCategory title={t`Theme`} desc={t`How the app is painted`}>
        {/* Three states, because there have always BEEN three: an explicit
            light or dark, or no choice at all, which follows the OS. Only two
            pills shipped, and "no choice" was drawn as Dark — so somebody on a
            light Mac saw a light app with Dark highlighted, and the first click
            on either pill locked them out of OS-following for good. */}
        <Field label={t`Mode`}>
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
            {osPrefersLight()
              ? t`Following your system — Clusters is light right now and switches when your device does.`
              : t`Following your system — Clusters is dark right now and switches when your device does.`}
          </p>
        )}

        <Field label={t`Accent`}>
          <AccentPicker value={ui.accent || null} onChange={(v) => setUi({ accent: v })} />
        </Field>

        <Field label={t`Body font`}>
          <FontField value={ui.fontSans || null} onChange={(v) => setUi({ fontSans: v })} />
        </Field>
      </SettingsCategory>

      <SettingsCategory title={t`Layout`} desc={t`What's on screen when you start`}>
        <Toggle
          label={t`Clean mode`}
          desc={coarse
            ? t`Hide the sidebar, toolbar, breadcrumb, and overlays.`
            : t`Hide the sidebar, toolbar, breadcrumb, and overlays. ⌘. toggles.`}
          value={!!ui.hideChrome}
          onChange={(v) => {
            if (v) document.body.setAttribute('data-clean-mode', '1');
            else document.body.removeAttribute('data-clean-mode');
            setUi({ hideChrome: v });
          }} />

        <Toggle
          label={t`Sidebar open by default`}
          desc={t`When you launch the app, start with the sidebar expanded.`}
          value={ui.sidebarOpen !== false}
          onChange={(v) => setUi({ sidebarOpen: v })} />
      </SettingsCategory>

      {/* Scroll wheel. The convention splits across the tools people arrive
          from — PureRef and Miro zoom, Figma and Milanote pan — so this is a
          preference rather than a default we could get right for everyone.
          Applied synchronously as well as saved: the canvas reads the module,
          not this component, so the gesture changes under the user's hand
          rather than after the profile round-trip. */}
      {(!coarse || showHaptics) && (
      <SettingsCategory title={t`Canvas`} desc={t`How the canvas answers your hands`}>
        {!coarse && (<>
        <Field label={t`Scroll wheel`}>
          <div className="settings-pill-row">
            {WHEEL_MODES.map((m) => (
              <button key={m} type="button"
                      className={`settings-pill ${wheelMode === m ? 'is-active' : ''}`}
                      onClick={() => {
                        applyWheelModeNow(m);
                        setUi({ wheelMode: m });
                        try { logEvent(EV.WHEEL_MODE_SET, { mode: m, source: 'settings' }); } catch (_) {}
                      }}>
                {m === 'pan' ? t`Pan` : t`Zoom`}
              </button>
            ))}
          </div>
        </Field>
        <p className="settings-section-hint">
          {wheelMode === 'zoom'
            ? t`Scrolling zooms at the pointer. ${WHEEL_CMD}-scroll, Alt-scroll or Shift-scroll pans.`
            : t`Scrolling pans the canvas. ${WHEEL_CMD}-scroll zooms.`}
          {' '}<Trans>Pinching a trackpad always zooms.</Trans>
        </p>

        {/* Off by default: A and D are the Arrow and Free-draw keys, and only
            somebody who chose this should find them moving the board instead
            (lib/wasdPan.js). Applied at once as well as saved, like the wheel. */}
        <Toggle
          label={t`Move with W A S D`}
          desc={t`Hold W, A, S or D to move around a board and Q or E to zoom in or out, with Shift to go faster. While it's on, A and D no longer pick the Arrow and Free-draw tools.`}
          value={wasdPan}
          onChange={(v) => {
            applyWasdPanNow(v);
            setUi({ wasdPan: v });
            try { logEvent(EV.WASD_PAN_SET, { on: v }); } catch (_) {}
          }} />
        </>)}

        {showHaptics && (
          <Toggle
            label={t`Vibration`}
            desc={usesSwitchTrick()
              ? t`A light tap when you tick a checklist box or choose Delete in a menu. That is all Safari on iPhone lets a website do.`
              : t`A light tap when you pick up, drop or snap a card, open a hold menu or delete something.`}
            value={hapticsOn}
            onChange={(v) => setHapticsEnabled(v)} />
        )}
      </SettingsCategory>
      )}
    </div>
  );
}
