// Workspace settings — the shared half of the panel.
//
// Editable by workspace editors and owners only. Viewers see the values for
// context but the inputs are disabled. Changes apply to every member when they
// create a new card next.
import { useEffect, useState } from 'react';
import { updateWorkspaceSettings } from '../../lib/boardsApi.js';
import { uploadImage } from '../../lib/uploads.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { useFeedback } from '../AppFeedback.jsx';
import { HARDCODED_FALLBACKS } from '../../hooks/useResolvedDefaults.js';
import { Field, SettingsCategory, SwatchInput, FontField, AvatarUploadRow } from './fields.jsx';

export function DefaultsTab({ workspaceId, workspaceName, user, role, workspaceSettings, refresh, onWorkspacesChanged, onOpenRecovery }) {
  const feedback = useFeedback();
  const canEdit = role === 'editor' || role === 'owner';
  const isOwner = role === 'owner';
  const disabled = !canEdit;
  // "Saving… → Saved ✓" indicator: visible while the RPC is in flight so a
  // slow network doesn't read as "did my change take?", then flashes Saved.
  const [savedAt, setSavedAt] = useState(0);
  const [saving, setSaving] = useState(false);
  const flashSaved = () => setSavedAt(Date.now());
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Workspace icon upload — top-level key on workspaces.settings so the
  // sidebar can read it from the workspace row without an extra query.
  // Owner-only edit; viewers and editors see the section read-only so
  // the icon is at least visible.
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconSrc = workspaceSettings?.icon_url || '';
  const setIcon = async (nextSrc) => {
    if (!isOwner || !workspaceId) return;
    try {
      await updateWorkspaceSettings(workspaceId, { icon_url: nextSrc || null });
      await refresh?.();
      await onWorkspacesChanged?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Could not update icon: ' + (err.message || err) });
    }
  };
  const onIconPick = async (file) => {
    if (!file || !workspaceId || !user?.id) return;
    setUploadingIcon(true);
    try {
      const { src } = await uploadImage({
        file, workspaceId, boardId: null, userId: user.id,
      });
      await setIcon(src);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Upload failed: ' + (err.message || err) });
    } finally {
      setUploadingIcon(false);
    }
  };

  const settings = workspaceSettings;
  const setKey = (cat, key, value) => savePatch(cat, { [key]: value });
  const savePatch = async (cat, patch) => {
    if (!canEdit || !workspaceId) return;
    const merged = { ...(settings[cat] || {}), ...patch };
    // Prune empties so the hardcoded fallback shines through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    setSaving(true);
    try {
      await updateWorkspaceSettings(workspaceId, { [cat]: merged });
      refresh?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed — check your connection and try again. (' + (err.message || err) + ')' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-headrow">
        <h3 className="settings-section-title">Workspace defaults</h3>
        <span className={`settings-saved-flash ${saving || savedAt ? 'is-on' : ''}`}>{saving ? 'Saving…' : 'Saved ✓'}</span>
      </div>
      <p className="settings-section-hint">
        These set the starting look of every new card on this workspace.
        {canEdit
          ? ' Anyone you create now will pick these up; existing cards aren’t changed.'
          : ' You have viewer access — only editors and owners can change them.'}
      </p>

      <SettingsCategory title="Workspace icon" desc={isOwner ? 'Shows in the sidebar and switcher.' : 'Only owners can change the icon.'}>
        <Field label={workspaceName || 'Workspace'}>
          <AvatarUploadRow
            src={iconSrc}
            fallbackColor={pickPresenceColor(workspaceId || '')}
            fallbackInitial={((workspaceName || '?').trim().charAt(0) || '?').toUpperCase()}
            uploading={uploadingIcon}
            disabled={!isOwner}
            shape="square"
            onPick={onIconPick}
            onRemove={() => setIcon('')}
          />
        </Field>
      </SettingsCategory>

      {/* NOTES */}
      <SettingsCategory title="Notes" desc="When you create a sticky note">
        <Field label="Background">
          <SwatchInput
            value={settings.note?.bgColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.bgColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'bgColor', v)} />
        </Field>
        <Field label="Text color">
          <SwatchInput
            value={settings.note?.textColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.textColor}
            disabled={disabled}
            onChange={(v) => setKey('note', 'textColor', v)} />
        </Field>
        <Field label="Font">
          <FontField value={settings.note?.fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('note', 'fontFamily', v)} />
        </Field>
        <Field label="Font size">
          <input type="number" min="8" max="36"
                 className="settings-input"
                 placeholder="12.5"
                 value={settings.note?.fontSize ?? ''}
                 disabled={disabled}
                 onChange={(e) => {
                   const v = e.target.value;
                   setKey('note', 'fontSize', v === '' ? null : Number(v));
                 }} />
        </Field>
      </SettingsCategory>

      {/* BOARDS */}
      <SettingsCategory title="Clusters" desc="When you create a new cluster">
        <Field label="Default view">
          <select className="settings-input"
                  value={settings.board?.view ?? 'canvas'}
                  disabled={disabled}
                  onChange={(e) => setKey('board', 'view', e.target.value)}>
            <option value="canvas">Canvas</option>
            <option value="list">List</option>
          </select>
        </Field>
      </SettingsCategory>

      {/* DOCS */}
      <SettingsCategory title="Docs" desc="When you create a new doc">
        <Field label="Font">
          <FontField value={settings.doc?.fontFamily ?? null}
                     disabled={disabled}
                     onChange={(v) => setKey('doc', 'fontFamily', v)} />
        </Field>
      </SettingsCategory>

      {/* SHAPES */}
      <SettingsCategory title="Shapes" desc="When you draw a shape">
        <Field label="Stroke">
          <SwatchInput
            value={settings.shape?.stroke ?? null}
            fallback={HARDCODED_FALLBACKS.shape.stroke}
            disabled={disabled}
            onChange={(v) => setKey('shape', 'stroke', v)} />
        </Field>
        <Field label="Fill">
          <SwatchInput
            value={settings.shape?.fill ?? null}
            fallback={HARDCODED_FALLBACKS.shape.fill}
            allowTransparent
            disabled={disabled}
            onChange={(v) => setKey('shape', 'fill', v)} />
        </Field>
        <Field label="Stroke width">
          <input type="number" min="1" max="12"
                 className="settings-input"
                 value={settings.shape?.strokeWidth ?? HARDCODED_FALLBACKS.shape.strokeWidth}
                 disabled={disabled}
                 onChange={(e) => setKey('shape', 'strokeWidth', Number(e.target.value) || 2)} />
        </Field>
      </SettingsCategory>

      {isOwner && onOpenRecovery && (
        <SettingsCategory title="Workspace recovery" desc="Owner-only. Rewinds every cluster in this workspace atomically — useful after an accidental mass-delete. Each cluster's pre-rewind state is preserved so the operation is reversible.">
          <button type="button" className="settings-link-btn" onClick={onOpenRecovery}>
            Open recovery →
          </button>
        </SettingsCategory>
      )}
    </div>
  );
}
