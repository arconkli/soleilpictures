// The shared half of the panel — the two tabs under "This workspace".
//
// General is what the workspace IS: its name and icon. Those were in two
// different places before (name behind the switcher popover's ⋯ menu, icon
// buried inside the defaults tab), which is most of why the panel felt
// arbitrary. Card defaults is what new cards START as, which is a genuinely
// different question and keeps its own tab.
//
// Editable by workspace editors and owners; viewers see the values for context
// but the inputs are disabled. Naming and the icon are owner-only.
import { useEffect, useState } from 'react';
import { updateWorkspaceSettings, renameWorkspace } from '../../lib/boardsApi.js';
import { uploadImage } from '../../lib/uploads.js';
import { pickPresenceColor } from '../../lib/presenceColor.js';
import { useFeedback } from '../AppFeedback.jsx';
import { HARDCODED_FALLBACKS } from '../../hooks/useResolvedDefaults.js';
import { Field, SettingsCategory, SwatchInput, FontField, AvatarUploadRow } from './fields.jsx';
import { useSettingsSave } from './saveState.jsx';

const ROLE_COPY = {
  owner:  'Owner — you can rename it, change the icon, and delete it.',
  editor: 'Editor — you can change what new cards start as, but not the name or icon.',
  viewer: 'Viewer — you can see these settings but not change them.',
};

export function WorkspaceGeneralTab({
  workspaceId, workspaceName, user, role, workspaceSettings,
  refresh, onWorkspacesChanged, onOpenRecovery,
}) {
  const feedback = useFeedback();
  const save = useSettingsSave();
  const isOwner = role === 'owner';

  // Name is a text field, so it holds a draft and commits on blur/Enter
  // rather than per keystroke. Re-seeds when the active workspace changes
  // underneath (switching workspaces with the panel open).
  const [name, setName] = useState(workspaceName || '');
  useEffect(() => { setName(workspaceName || ''); }, [workspaceName, workspaceId]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!isOwner || !workspaceId) return;
    if (!trimmed) { setName(workspaceName || ''); return; }
    if (trimmed === (workspaceName || '')) return;
    save(async () => {
      await renameWorkspace(workspaceId, trimmed);
      await onWorkspacesChanged?.();
    });
  };

  // Workspace icon upload — top-level key on workspaces.settings so the
  // sidebar can read it from the workspace row without an extra query.
  // Owner-only edit; everyone else sees the section read-only so the icon
  // is at least visible.
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const iconSrc = workspaceSettings?.icon_url || '';
  const setIcon = async (nextSrc) => {
    if (!isOwner || !workspaceId) return;
    await save(async () => {
      await updateWorkspaceSettings(workspaceId, { icon_url: nextSrc || null });
      await refresh?.();
      await onWorkspacesChanged?.();
    });
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

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">General</h3>
      <p className="settings-section-hint">
        {ROLE_COPY[role] || 'These settings belong to the workspace, not to you — everyone in it sees the same values.'}
      </p>

      <SettingsCategory title="Identity" desc="Shows in the sidebar and the workspace switcher">
        <Field label="Name">
          <input className="settings-input"
                 value={name}
                 placeholder="e.g. Soleil Studio"
                 disabled={!isOwner}
                 onChange={(e) => setName(e.target.value)}
                 onBlur={commitName}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                   if (e.key === 'Escape') { e.preventDefault(); setName(workspaceName || ''); }
                 }} />
        </Field>
        <Field label="Icon">
          <AvatarUploadRow
            src={iconSrc}
            fallbackColor={pickPresenceColor(workspaceId || '')}
            fallbackInitial={((name || workspaceName || '?').trim().charAt(0) || '?').toUpperCase()}
            uploading={uploadingIcon}
            disabled={!isOwner}
            shape="square"
            onPick={onIconPick}
            onRemove={() => setIcon('')}
          />
        </Field>
      </SettingsCategory>

      {isOwner && onOpenRecovery && (
        <SettingsCategory
          title="Recovery"
          desc="Rewinds every cluster in this workspace at once — for after an accidental mass-delete. The pre-rewind state is kept, so the rewind itself is reversible.">
          <button type="button" className="settings-link-btn" onClick={onOpenRecovery}>
            Open recovery →
          </button>
        </SettingsCategory>
      )}
    </div>
  );
}

export function CardDefaultsTab({ workspaceId, role, workspaceSettings, refresh }) {
  const save = useSettingsSave();
  const canEdit = role === 'editor' || role === 'owner';
  const disabled = !canEdit;

  const settings = workspaceSettings;
  const setKey = (cat, key, value) => savePatch(cat, { [key]: value });
  const savePatch = (cat, patch) => {
    if (!canEdit || !workspaceId) return;
    const merged = { ...(settings[cat] || {}), ...patch };
    // Prune empties so the hardcoded fallback shines through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    save(async () => {
      await updateWorkspaceSettings(workspaceId, { [cat]: merged });
      refresh?.();
    });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Card defaults</h3>
      <p className="settings-section-hint">
        These set the starting look of every new card on this workspace.
        {canEdit
          ? ' Anything you create now will pick these up; existing cards aren’t changed.'
          : ' You have viewer access — only editors and owners can change them.'}
      </p>

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
    </div>
  );
}
