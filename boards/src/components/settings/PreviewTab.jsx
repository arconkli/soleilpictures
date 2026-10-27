// PreviewTab: admin only, on preview and dev. Shows your own account as the
// 10-editor limit would (the owner, 2026-10-21: "give me a way as an admin to
// … see what that looks like"), without inviting anyone, and opens a test team
// (Northlight Films) as its owner, an admin, a member or unpaid: the Team page
// and the workspace menu's team section (lib/teamPreview.js). Look only. Lives
// in ADMIN_TABS, so the docs gate never sees it.
import { useState } from 'react';
import { SettingsCategory } from './fields.jsx';
import {
  editorLimitPreviewAvailable, readEditorLimitPreview, writeEditorLimitPreview,
} from '../../lib/editorLimitPreview.js';
import { readTeamPreview, writeTeamPreview, openTeamPage } from '../../lib/teamPreview.js';

const OPTIONS = [
  { id: null, label: 'As it is' },
  { id: 'near', label: '2 places left' },
  { id: 'full', label: 'Full' },
  { id: 'full_ask', label: 'Full, as a co-owner' },
];

const TEAM_OPTIONS = [
  { id: null, label: 'Off' },
  { id: 'owner', label: 'Owner' },
  { id: 'admin', label: 'Admin' },
  { id: 'member', label: 'Member' },
  { id: 'unpaid', label: 'Unpaid' },
];

export function PreviewTab({ onClose }) {
  const [as, setAs] = useState(() => readEditorLimitPreview());
  const [teamAs, setTeamAs] = useState(() => readTeamPreview());
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

      <SettingsCategory title="Team plan" desc="Open a test team as">
        <div className="settings-pill-row">
          {TEAM_OPTIONS.map((o) => (
            <button key={o.id || 'off'} type="button"
                    className={`settings-pill ${teamAs === o.id ? 'is-active' : ''}`}
                    aria-pressed={teamAs === o.id ? 'true' : 'false'}
                    onClick={() => { writeTeamPreview(o.id); setTeamAs(o.id); }}>{o.label}</button>
          ))}
        </div>
        <div className="settings-pill-row" style={{ marginTop: 8 }}>
          <button type="button" className="settings-btn" disabled={!teamAs}
                  onClick={() => { onClose?.(); openTeamPage(); }}>Open the team page</button>
          <button type="button" className="settings-btn"
                  onClick={() => {
                    if (!teamAs) { writeTeamPreview('owner'); setTeamAs('owner'); }
                    // Leave with Settings open: closing it rewinds the history
                    // entry it keeps for Back (lib/modalGuard.js), and that
                    // rewind cancels the trip. replace() takes the entry's
                    // place, so Back from pricing lands on the app.
                    window.location.replace('/pricing');
                  }}>Walk through buying it</button>
        </div>
      </SettingsCategory>

      <p className="settings-section-hint" style={{ marginTop: 8 }}>
        Northlight Films, a test team with example people, shows at the top of the workspace menu
        and on its own page. “Walk through buying it” opens the pricing page and the team setup. Nothing is billed, nobody is emailed, and only you see it.
      </p>
    </div>
  );
}
