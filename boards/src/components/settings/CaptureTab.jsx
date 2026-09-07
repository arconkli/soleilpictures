// Capture — staging the app for a screenshot or a screen recording.
//
// Admin-only, and deliberately not wired to the settings save pipeline: nothing
// on this tab touches profiles.settings. Capture state lives in sessionStorage
// so a reload mid-shoot resumes, and the identity swap lives only in memory. A
// staging mode that follows your account onto another device — or that outlives
// the tab — is a support incident waiting to happen, so it does neither.
//
// This tab is reachable on a phone, which is the point: the real device is
// where the phone footage gets made, and /admin is desktop-only.
import { Toggle, SettingsCategory, Field } from './fields.jsx';
import { setCapture, resetCapture } from '../../lib/captureState.js';
import { useCaptureState } from '../../hooks/useCaptureState.js';
import { ASPECTS } from '../../lib/captureAspect.js';
import { TAKES, takeDuration } from '../../lib/captureTakes.js';
import { recordingSupport, elementCaptureSupported } from '../../lib/captureRecorder.js';

const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
const CMD = IS_MAC ? '⌘' : 'Ctrl';

export function CaptureTab() {
  const cap = useCaptureState();
  const recording = recordingSupport();
  const set = (patch) => setCapture(patch);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Capture</h3>
      <p className="settings-section-hint">
        Stages this device for a screenshot or a recording. Nothing here is saved to
        {' '}your account or synced anywhere — it clears when you close the tab.
      </p>

      <SettingsCategory title="Mode" desc="The master switch">
        <Toggle
          label="Capture mode"
          desc={`Turns the staging controls below on. ${CMD}⇧. toggles it from anywhere.`}
          value={cap.on}
          onChange={(v) => set({ on: v })} />
        {cap.on && (
          <p className="settings-section-hint">
            On. The floating controls sit at the corner of the canvas — hide them with
            {' '}their ✕, then {CMD}⇧H or a three-finger tap brings them back mid-take.
          </p>
        )}
      </SettingsCategory>

      <SettingsCategory title="Stage" desc="What the camera sees">
        <Toggle
          label="Hide chrome"
          desc="Sidebar, topbar, breadcrumb, tool rail, zoom, presence, banners — everything but the canvas."
          value={cap.clean}
          onChange={(v) => set({ clean: v })} />

        <Toggle
          label="Silence toasts"
          desc="Stops a stray “Copied” landing mid-take. Confirm dialogs still appear — they block a flow, so muting one would strand you."
          value={cap.silence}
          onChange={(v) => set({ silence: v })} />
        {cap.silence && (
          <p className="settings-section-hint">
            Deleting normally offers an undo in a toast. While silenced it still
            {' '}deletes and {CMD}Z still works — you just won’t be offered the shortcut.
          </p>
        )}

        <Toggle
          label="Drop the film grain"
          desc="The grain is an animated texture. It’s invisible in a still and ruinous in a video — pure noise compresses terribly — so a shoot is better without it."
          value={cap.freeze}
          onChange={(v) => set({ freeze: v })} />

        <Toggle
          label="Cursor spotlight"
          desc="Draws your pointer with a click ripple, so a recording reads at phone size."
          value={cap.spotlight}
          onChange={(v) => set({ spotlight: v })} />
      </SettingsCategory>

      <SettingsCategory title="Fit" desc="Reshape the board for the frame">
        <Toggle
          label="Reframe for the frame"
          desc="Reflows the cards into a column that suits the shape you’re shooting, instead of zooming out until nothing is readable."
          value={cap.reframe}
          onChange={(v) => set({ reframe: v })} />
        {cap.reframe && (
          <>
            <p className="settings-section-hint">
              Nothing is saved. The document never hears about it, so no collaborator
              {' '}sees the board move, a refresh brings the real layout straight back, and
              {' '}your desktop arrangement is untouched. Arrows follow the new positions.
              {' '}Dragging and resizing are locked while this is on — a drag would write a
              {' '}position taken from the temporary layout into the real board.
            </p>
            <Field label="Width">
              <div className="capture-width">
                <input
                  type="range"
                  min="320" max="2400" step="20"
                  value={cap.width || 0}
                  aria-label="Reframe width in board units"
                  onChange={(e) => set({ width: Number(e.target.value) })} />
                <button type="button" className="settings-pill" onClick={() => set({ width: 0 })}>
                  {cap.width ? `${cap.width}` : 'Auto'}
                </button>
              </div>
            </Field>
            <p className="settings-section-hint">
              Auto works it out from this board’s own median card size and the framing
              {' '}guide below — what matters is how many cards read across, not how many
              {' '}pixels wide the screen is.
            </p>
          </>
        )}
      </SettingsCategory>

      <SettingsCategory title="Framing" desc="The shape you’re shipping">
        <Field label="Guide">
          <div className="settings-pill-row">
            {ASPECTS.map(a => (
              <button key={a.id ?? 'off'} type="button"
                      className={`settings-pill ${(cap.aspect ?? null) === a.id ? 'is-active' : ''}`}
                      onClick={() => set({ aspect: a.id })}>{a.label}</button>
            ))}
          </div>
        </Field>
        <p className="settings-section-hint">
          Dims everything outside the crop and marks a safe area inside it. It only
          {' '}draws the frame — the app keeps its real size, so what you see inside is
          {' '}exactly what it does at that size.
        </p>
      </SettingsCategory>

      <SettingsCategory title="Cast" desc="Who else is in the shot">
        <Toggle
          label="Persona"
          desc="Swaps your name, address and avatar for a consistent stand-in — sidebar, share panel, comments and your own cursor flag."
          value={cap.persona}
          onChange={(v) => set({ persona: v })} />
        {cap.persona && (
          <p className="settings-section-hint">
            Your name is broadcast, so anyone else on the board sees the persona too
            {' '}while this is on — which is what makes THEIR recording clean as well.
            {' '}It is never written to your account and never survives this tab.
          </p>
        )}

        <Field label="Collaborators">
          <div className="settings-pill-row">
            {[0, 1, 2, 3, 5].map(n => (
              <button key={n} type="button"
                      className={`settings-pill ${cap.cast === n ? 'is-active' : ''}`}
                      onClick={() => set({ cast: n })}>{n === 0 ? 'None' : n}</button>
            ))}
          </div>
        </Field>
        <p className="settings-section-hint">
          Adds stand-in collaborators with moving cursors and live selections, so
          {' '}multiplayer can be filmed without arranging three other people. They
          {' '}exist only in your own view — nothing is sent, and nobody really on the
          {' '}board sees them.
        </p>
      </SettingsCategory>

      <SettingsCategory title="Takes" desc="Written-down camera moves">
        <p className="settings-section-hint">
          A clip isn’t one move, it’s a shape: establish, hold, go in on what matters,
          {' '}come back. Pick one on the floating controls and press Record — it starts,
          {' '}plays the take, stops, and saves the file. Same shape every retake.
        </p>
        <div className="capture-takes">
          {TAKES.map(t => (
            <div key={t.id} className="capture-take">
              <span className="capture-take-name">{t.label}</span>
              <span className="capture-take-secs">{(takeDuration(t.moves) / 1000).toFixed(1)}s</span>
              <span className="capture-take-blurb">{t.blurb}</span>
            </div>
          ))}
        </div>
        <p className="settings-section-hint">
          {recording.ok
            ? 'Recording saves an .mp4 to your downloads, and stills save as .png. The browser asks which surface to share once — pick this tab.'
            : recording.reason}
        </p>
        {recording.ok && (
          <p className="settings-section-hint">
            {elementCaptureSupported()
              ? 'This browser can film the app while ignoring anything drawn over it, so the floating controls stay usable mid-take and never appear in the video — they read “Off-camera” while that’s true. The trade-off: modals and the command palette are drawn outside the filmed layer, so they’re left out too. If the modal IS the shot, record with the controls hidden instead.'
              : 'This browser films the whole tab, so the floating controls duck out of frame while recording and ⌘⇧H brings them back — that press lands in the video. Chrome can film the app while ignoring overlays, which keeps them usable mid-take.'}
          </p>
        )}
      </SettingsCategory>

      <SettingsCategory title="Reset" desc="Back to a normal app">
        <button type="button" className="settings-btn" onClick={resetCapture}>
          Turn everything off
        </button>
      </SettingsCategory>
    </div>
  );
}
