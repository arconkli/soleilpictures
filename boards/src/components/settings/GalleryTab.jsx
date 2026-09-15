// Gallery — the admin-only browser for every surface in the app.
//
// This tab is a door, not a workspace. The gallery itself cannot render here:
// .settings-bg sits at z-index 2147483646 and .upgrade-backdrop at 2147483647,
// the 32-bit maximum, so a previewed command palette (z-index 1200) would draw
// behind the settings backdrop and look broken for reasons that have nothing to
// do with the surface. Opening therefore closes Settings and mounts the gallery
// at the app root instead — see SurfaceGallery.jsx.
//
// Admin-only, and like Capture it is pure client-side rendering with no server
// capability behind it, so the tier check IS the gate. galleryState refuses
// every write until App arms it from the same tier read.
import { SettingsCategory } from './fields.jsx';

export function GalleryTab({ onOpen }) {
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Gallery</h3>
      <p className="settings-section-hint">
        Every popup, banner, toast, empty state and screen in the app, searchable,
        rendered on demand with made-up data. For checking that a surface still
        looks right without arranging the account that normally produces it.
      </p>

      <SettingsCategory title="Browse" desc="Opens over the app — Settings closes behind it">
        <div className="settings-row-actions">
          <span style={{ flex: 1 }} />
          <button type="button" className="settings-btn settings-btn-primary" onClick={onOpen}>
            Open the gallery →
          </button>
        </div>
      </SettingsCategory>

      <p className="settings-section-hint" style={{ marginTop: 8 }}>
        Nothing you open here is recorded. While the gallery is up, analytics are
        marked synthetic, the upsell coordination is bypassed, the once-per-account
        price stamps are held, and checkout refuses to start — so previewing the
        trial offer cannot spend a real trial or land in the conversion funnel.
      </p>
    </div>
  );
}
