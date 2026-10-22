// PreviewTab: admin only, on preview and dev. Shows your own account as the
// 10-editor limit would (the owner, 2026-10-21: "give me a way as an admin to
// … see what that looks like"), without inviting anyone. Look only. Lives in
// ADMIN_TABS, so the docs gate never sees it.
import { useState } from 'react';
import { SettingsCategory } from './fields.jsx';
import {
  editorLimitPreviewAvailable, readEditorLimitPreview, writeEditorLimitPreview,
} from '../../lib/editorLimitPreview.js';

const OPTIONS = [
  { id: null, label: 'As it is' },
  { id: 'near', label: '2 places left' },
  { id: 'full', label: 'Full' },
  { id: 'full_ask', label: 'Full, as a co-owner' },
];

export function PreviewTab() {
  const [as, setAs] = useState(() => readEditorLimitPreview());
  if (!editorLimitPreviewAvailable()) {
    return (
      <div className="settings-section">
        <h3 className="settings-section-title">Preview</h3>
        <p className="settings-section-hint">Only on preview.</p>
      </div>
    );
  }
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Preview</h3>
      <p className="settings-section-hint">
        See what’s coming on your own account before it launches. Only on preview, and only for you.
      </p>

      <SettingsCategory title="10-editor limit" desc="Show my account as">
        <div className="settings-pill-row">
          {OPTIONS.map((o) => (
            <button key={o.id || 'real'} type="button"
                    className={`settings-pill ${as === o.id ? 'is-active' : ''}`}
                    aria-pressed={as === o.id ? 'true' : 'false'}
                    onClick={() => { writeEditorLimitPreview(o.id); setAs(o.id); }}>{o.label}</button>
          ))}
        </div>
      </SettingsCategory>

      <p className="settings-section-hint" style={{ marginTop: 8 }}>
        Then open a cluster’s Share panel, or Settings › Members. Nothing changes: the numbers and
        the example people are pretend, and inviting still counts your real places.
      </p>
    </div>
  );
}
