// Settings panel — tabbed home for everything user/workspace-scoped.
// Replaces the old single-purpose AccountSettings modal:
//
//   Profile   — display_name + presence color (per-user, today's UI)
//   Defaults  — note/board/doc/shape/palette defaults (workspace OR per-user)
//   Theme     — light/dark, accent color, font picks (per-user)
//   Templates — list / rename / delete saved board templates
//   Display   — clean-mode + sidebar default (per-user)
//
// Workspace defaults are editable by editors AND owners, read-only for
// viewers. Per-user defaults are always editable (it's your account).
// Settings persist via the merge_*_settings RPCs which do atomic
// jsonb || patch so two clients can save different keys at once.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import {
  getOwnProfile, saveOwnProfile,
  updateWorkspaceSettings,
  updateOwnSettings,
} from '../lib/boardsApi.js';
import { useFeedback } from './AppFeedback.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { COVER_TINTS } from './primitives.jsx';
import { HARDCODED_FALLBACKS } from '../hooks/useResolvedDefaults.js';
import {
  listBoardTemplates, deleteBoardTemplate, renameBoardTemplate,
} from '../lib/templatesApi.js';

const TABS = [
  { id: 'profile',   label: 'Profile' },
  { id: 'defaults',  label: 'Defaults' },
  { id: 'theme',     label: 'Theme' },
  { id: 'templates', label: 'Templates' },
  { id: 'display',   label: 'Display' },
];

const FONT_PRESETS = [
  { id: 'sans',     name: 'Aileron',     css: 'aileron, -apple-system, system-ui, sans-serif' },
  { id: 'inter',    name: 'Inter',       css: 'Inter, -apple-system, system-ui, sans-serif' },
  { id: 'serif',    name: 'Serif',       css: 'Georgia, "Times New Roman", serif' },
  { id: 'caveat',   name: 'Handwritten', css: 'Caveat, cursive' },
  { id: 'mono',     name: 'Mono',        css: '"JetBrains Mono", ui-monospace, monospace' },
];

const ACCENT_PRESETS = [
  '#d4a04a', // soleil (default)
  '#cf6a4f', // terracotta
  '#7c5cc9', // violet
  '#3fa39a', // teal
  '#5b8fc7', // blue
  '#10b981', // emerald
  '#ec4899', // pink
  '#5b574e', // ink
];

export function SettingsPanel({
  open, onClose,
  user, onSignOut,
  workspaceId, onWorkspacesChanged,
  onSaved,
  // Settings hook output — passed in so the panel and the rest of the
  // app share one source of truth and refresh together.
  defaults, role, refresh, workspaceSettings, mySettings,
}) {
  const [tab, setTab] = useState('profile');
  const feedback = useFeedback();

  if (!open) return null;

  return createPortal(
    <div className="settings-bg" onMouseDown={onClose}>
      <div className="settings-modal"
           onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <span style={{ flex: 1 }} />
          {onSignOut && (
            <button type="button" className="settings-link-btn settings-head-signout"
                    onClick={async () => {
                      const ok = await feedback.confirm({
                        title: 'Sign out',
                        message: `Sign out of ${user?.email || 'this account'}?`,
                        confirmLabel: 'Sign out',
                      });
                      if (ok) { onClose?.(); onSignOut?.(); }
                    }}>Sign out</button>
          )}
          <button type="button" className="settings-x"
                  onClick={onClose} aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-tabs" role="tablist">
            {TABS.map(t => (
              <button key={t.id}
                      type="button"
                      role="tab"
                      className={`settings-tab ${tab === t.id ? 'is-active' : ''}`}
                      onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {tab === 'profile' && (
              <ProfileTab user={user} onSaved={onSaved} />
            )}
            {tab === 'defaults' && (
              <DefaultsTab workspaceId={workspaceId}
                           role={role}
                           workspaceSettings={workspaceSettings}
                           mySettings={mySettings}
                           refresh={refresh} />
            )}
            {tab === 'theme' && (
              <ThemeTab mySettings={mySettings} refresh={refresh} />
            )}
            {tab === 'templates' && (
              <TemplatesTab workspaceId={workspaceId} role={role} />
            )}
            {tab === 'display' && (
              <DisplayTab mySettings={mySettings} refresh={refresh} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Profile tab (today's AccountSettings, lifted in) ────────────────────
function ProfileTab({ user, onSaved }) {
  const feedback = useFeedback();
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [initial, setInitial] = useState({ name: '', color: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerPos, setPickerPos] = useState(null);
  const chipRef = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setLoading(true);
    getOwnProfile()
      .then(p => {
        if (cancelled) return;
        const fallbackName = user.user_metadata?.full_name
                          || user.email?.split('@')[0] || '';
        const n = p?.display_name || fallbackName;
        const c = p?.color || '';
        setName(n); setColor(c);
        setInitial({ name: n, color: c });
      })
      .catch(err => {
        feedback.toast({ type: 'error', message: 'Could not load profile.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id]);

  const dirty = name.trim() !== initial.name.trim() || (color || '') !== (initial.color || '');

  const onSave = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      await saveOwnProfile({
        userId: user.id,
        displayName: name.trim() || null,
        color: color || null,
      });
      feedback.toast({ type: 'success', message: 'Profile saved.' });
      onSaved?.({ name: name.trim(), color });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Profile</h3>
      <Field label="Display name">
        <input className="settings-input"
               value={name}
               placeholder={user?.email?.split('@')[0] || 'Your name'}
               onChange={(e) => setName(e.target.value)}
               disabled={loading || saving} />
      </Field>
      <Field label="Presence color">
        <div className="settings-color-row">
          <button ref={chipRef}
                  type="button"
                  className="settings-color-chip"
                  style={{ background: color || '#4f8df8' }}
                  onClick={() => {
                    const r = chipRef.current?.getBoundingClientRect();
                    if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
                  }}
                  disabled={loading || saving}>
            <span>{color ? color.toUpperCase() : 'Pick'}</span>
          </button>
          {color && (
            <button type="button" className="settings-link-btn"
                    onClick={() => setColor('')}
                    disabled={loading || saving}>Reset</button>
          )}
        </div>
      </Field>
      <Field label="Email">
        <div className="settings-readonly">{user?.email || '—'}</div>
      </Field>
      <div className="settings-row-actions">
        <span style={{ flex: 1 }} />
        <button type="button" className="settings-btn settings-btn-primary"
                onClick={onSave}
                disabled={!dirty || loading || saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
      {pickerPos && (
        <ColorPicker
          value={color || '#4f8df8'}
          onChange={(c) => setColor(c)}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={false} />
      )}
    </div>
  );
}

// ── Defaults tab — workspace OR user defaults for new cards ─────────────
function DefaultsTab({ workspaceId, role, workspaceSettings, mySettings, refresh }) {
  const feedback = useFeedback();
  const canEditWorkspace = role === 'editor' || role === 'owner';
  // Which scope the user is currently editing. Viewers are pinned to
  // 'mine' since they can't write workspace settings.
  const [scope, setScope] = useState(canEditWorkspace ? 'workspace' : 'mine');
  // "Saved ✓" flash that fades after each successful save.
  const [savedAt, setSavedAt] = useState(0);
  const flashSaved = () => setSavedAt(Date.now());
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Settings being viewed/edited — live snapshot of the right scope.
  const settings = scope === 'workspace' ? workspaceSettings : mySettings;
  const setKey = (cat, key, value) => savePatch(cat, { [key]: value });
  const savePatch = async (cat, patch) => {
    const merged = { ...(settings[cat] || {}), ...patch };
    // Prune null/undefined so the workspace value can shine through.
    for (const k of Object.keys(merged)) {
      if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    const top = { [cat]: merged };
    try {
      if (scope === 'workspace') {
        if (!workspaceId) return;
        await updateWorkspaceSettings(workspaceId, top);
      } else {
        await updateOwnSettings(top);
      }
      refresh?.();
      flashSaved();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Defaults</h3>
      <p className="settings-section-hint">
        Defaults flow into every new card you create.
        Resolution order is: Workspace → Yours → built-in.
      </p>
      <div className="settings-scope-row" role="tablist">
        <button type="button"
                role="tab"
                className={`settings-scope-pill ${scope === 'workspace' ? 'is-active' : ''} ${!canEditWorkspace ? 'is-locked' : ''}`}
                onClick={() => setScope('workspace')}
                title={canEditWorkspace
                  ? 'Edit defaults that apply to everyone on the workspace'
                  : 'Workspace defaults are read-only — you have viewer access'}>
          <span className="settings-scope-dot settings-scope-dot-ws" />
          Workspace {!canEditWorkspace && '(read-only)'}
        </button>
        <button type="button"
                role="tab"
                className={`settings-scope-pill ${scope === 'mine' ? 'is-active' : ''}`}
                onClick={() => setScope('mine')}>
          <span className="settings-scope-dot settings-scope-dot-mine" />
          Yours
        </button>
        <span style={{ flex: 1 }} />
        <span className={`settings-saved-flash ${savedAt ? 'is-on' : ''}`}>Saved ✓</span>
      </div>
      {!canEditWorkspace && scope === 'workspace' && (
        <p className="settings-section-hint settings-viewer-hint">
          You have viewer access — workspace defaults show below for context,
          but only editors and owners can change them. Switch to “Yours” to
          set personal overrides.
        </p>
      )}

      {/* NOTES */}
      <SettingsCategory title="Notes" desc="When you create a sticky note">
        <Field label="Background">
          <SwatchInput
            value={settings.note?.bgColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.bgColor}
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(v) => setKey('note', 'bgColor', v)} />
        </Field>
        <Field label="Text color">
          <SwatchInput
            value={settings.note?.textColor ?? null}
            fallback={HARDCODED_FALLBACKS.note.textColor}
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(v) => setKey('note', 'textColor', v)} />
        </Field>
        <Field label="Font">
          <select className="settings-input"
                  value={settings.note?.fontFamily ?? ''}
                  disabled={scope === 'workspace' && !canEditWorkspace}
                  onChange={(e) => setKey('note', 'fontFamily', e.target.value || null)}>
            <option value="">Default</option>
            {FONT_PRESETS.map(f => (
              <option key={f.id} value={f.css}>{f.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Font size">
          <input type="number" min="8" max="36"
                 className="settings-input"
                 placeholder="12.5"
                 value={settings.note?.fontSize ?? ''}
                 disabled={scope === 'workspace' && !canEditWorkspace}
                 onChange={(e) => {
                   const v = e.target.value;
                   setKey('note', 'fontSize', v === '' ? null : Number(v));
                 }} />
        </Field>
        <Field label="Default size">
          <SizeInput
            w={settings.note?.w ?? null} h={settings.note?.h ?? null}
            wFallback={HARDCODED_FALLBACKS.note.w} hFallback={HARDCODED_FALLBACKS.note.h}
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(w, h) => savePatch('note', { w, h })} />
        </Field>
      </SettingsCategory>

      {/* BOARDS */}
      <SettingsCategory title="Boards" desc="When you create a new board">
        <Field label="Cover tint">
          <select className="settings-input"
                  value={settings.board?.cover ?? 'neutral'}
                  disabled={scope === 'workspace' && !canEditWorkspace}
                  onChange={(e) => setKey('board', 'cover', e.target.value === 'neutral' ? null : e.target.value)}>
            {Object.keys(COVER_TINTS).map(k => (
              <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
            ))}
          </select>
        </Field>
        <Field label="Default view">
          <select className="settings-input"
                  value={settings.board?.view ?? 'canvas'}
                  disabled={scope === 'workspace' && !canEditWorkspace}
                  onChange={(e) => setKey('board', 'view', e.target.value)}>
            <option value="canvas">Canvas</option>
            <option value="list">List</option>
          </select>
        </Field>
      </SettingsCategory>

      {/* DOCS */}
      <SettingsCategory title="Docs" desc="When you create a new doc">
        <Field label="Font">
          <select className="settings-input"
                  value={settings.doc?.fontFamily ?? ''}
                  disabled={scope === 'workspace' && !canEditWorkspace}
                  onChange={(e) => setKey('doc', 'fontFamily', e.target.value || null)}>
            <option value="">Default</option>
            {FONT_PRESETS.map(f => (
              <option key={f.id} value={f.css}>{f.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Default size">
          <SizeInput
            w={settings.doc?.w ?? null} h={settings.doc?.h ?? null}
            wFallback={HARDCODED_FALLBACKS.doc.w} hFallback={HARDCODED_FALLBACKS.doc.h}
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(w, h) => savePatch('doc', { w, h })} />
        </Field>
      </SettingsCategory>

      {/* SHAPES */}
      <SettingsCategory title="Shapes" desc="When you draw a shape">
        <Field label="Stroke">
          <SwatchInput
            value={settings.shape?.stroke ?? null}
            fallback={HARDCODED_FALLBACKS.shape.stroke}
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(v) => setKey('shape', 'stroke', v)} />
        </Field>
        <Field label="Fill">
          <SwatchInput
            value={settings.shape?.fill ?? null}
            fallback={HARDCODED_FALLBACKS.shape.fill}
            allowTransparent
            disabled={scope === 'workspace' && !canEditWorkspace}
            onChange={(v) => setKey('shape', 'fill', v)} />
        </Field>
        <Field label="Stroke width">
          <input type="number" min="1" max="12"
                 className="settings-input"
                 value={settings.shape?.strokeWidth ?? HARDCODED_FALLBACKS.shape.strokeWidth}
                 disabled={scope === 'workspace' && !canEditWorkspace}
                 onChange={(e) => setKey('shape', 'strokeWidth', Number(e.target.value) || 2)} />
        </Field>
      </SettingsCategory>
    </div>
  );
}

function SettingsCategory({ title, desc, children }) {
  return (
    <div className="settings-cat">
      <div className="settings-cat-head">
        <span className="settings-cat-title">{title}</span>
        {desc && <span className="settings-cat-desc">{desc}</span>}
      </div>
      <div className="settings-cat-body">
        {children}
      </div>
    </div>
  );
}

function SwatchInput({ value, fallback, onChange, disabled, allowTransparent = false }) {
  const [pickerPos, setPickerPos] = useState(null);
  const ref = useRef(null);
  const showing = value || fallback || '#4f8df8';
  return (
    <div className="settings-color-row">
      <button ref={ref}
              type="button"
              className="settings-color-chip"
              style={{ background: showing }}
              disabled={disabled}
              onClick={() => {
                const r = ref.current?.getBoundingClientRect();
                if (r) setPickerPos({ x: r.left + r.width / 2, y: r.top });
              }}>
        <span>{value ? value.toUpperCase() : <em>default</em>}</span>
      </button>
      {value && (
        <button type="button" className="settings-link-btn"
                onClick={() => onChange(null)}
                disabled={disabled}>Reset</button>
      )}
      {pickerPos && (
        <ColorPicker
          value={showing}
          onChange={onChange}
          onClose={() => setPickerPos(null)}
          position={pickerPos}
          allowTransparent={allowTransparent} />
      )}
    </div>
  );
}

function SizeInput({ w, h, wFallback, hFallback, onChange, disabled }) {
  return (
    <div className="settings-size-row">
      <input type="number" min="40" max="2000"
             className="settings-input settings-size-input"
             value={w ?? wFallback}
             disabled={disabled}
             onChange={(e) => onChange(Number(e.target.value) || wFallback, h ?? hFallback)} />
      <span className="settings-size-x">×</span>
      <input type="number" min="40" max="2000"
             className="settings-input settings-size-input"
             value={h ?? hFallback}
             disabled={disabled}
             onChange={(e) => onChange(w ?? wFallback, Number(e.target.value) || hFallback)} />
    </div>
  );
}

// ── Theme tab ───────────────────────────────────────────────────────────
function ThemeTab({ mySettings, refresh }) {
  const feedback = useFeedback();
  const ui = mySettings.ui || {};
  const setUi = async (patch) => {
    try {
      await updateOwnSettings({ ui: { ...ui, ...patch } });
      refresh?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    }
  };

  // Apply theme attribute live on change so the user sees it instantly.
  const applyTheme = (theme) => {
    if (!theme) return;
    document.documentElement.setAttribute('data-theme', theme);
    setUi({ theme });
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Theme</h3>
      <p className="settings-section-hint">
        These are personal — they only affect how the app looks for you.
      </p>

      <Field label="Mode">
        <div className="settings-pill-row">
          <button type="button"
                  className={`settings-pill ${ui.theme === 'dark' || !ui.theme ? 'is-active' : ''}`}
                  onClick={() => applyTheme('dark')}>Dark</button>
          <button type="button"
                  className={`settings-pill ${ui.theme === 'light' ? 'is-active' : ''}`}
                  onClick={() => applyTheme('light')}>Light</button>
        </div>
      </Field>

      <Field label="Accent">
        <div className="settings-accent-row">
          {ACCENT_PRESETS.map(c => (
            <button key={c}
                    type="button"
                    className={`settings-accent-dot ${ui.accent === c ? 'is-active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setUi({ accent: c })} />
          ))}
          <button type="button"
                  className={`settings-accent-dot settings-accent-dot-clear ${!ui.accent ? 'is-active' : ''}`}
                  title="Default soleil gold"
                  onClick={() => setUi({ accent: null })}>×</button>
        </div>
      </Field>

      <Field label="Body font">
        <select className="settings-input"
                value={ui.fontSans || ''}
                onChange={(e) => setUi({ fontSans: e.target.value || null })}>
          <option value="">Default (Aileron)</option>
          {FONT_PRESETS.filter(f => f.id !== 'mono').map(f => (
            <option key={f.id} value={f.css}>{f.name}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

// ── Templates tab ───────────────────────────────────────────────────────
function TemplatesTab({ workspaceId, role }) {
  const feedback = useFeedback();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const canManage = role === 'editor' || role === 'owner';

  const refetch = async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await listBoardTemplates(workspaceId);
      setItems(list || []);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Could not load templates.' });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refetch(); }, [workspaceId]);

  const onRename = async (t) => {
    const next = await feedback.prompt({
      title: 'Rename template',
      label: 'Name',
      defaultValue: t.name || '',
      confirmLabel: 'Rename',
    });
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === t.name) return;
    try {
      await renameBoardTemplate(t.id, trimmed);
      refetch();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Rename failed: ' + (err.message || err) });
    }
  };

  const onDelete = async (t) => {
    const ok = await feedback.confirm({
      title: 'Delete template',
      message: `Delete "${t.name || 'Untitled'}"? This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteBoardTemplate(t.id);
      refetch();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Templates</h3>
      <p className="settings-section-hint">
        Saved board templates show up when you create a new board.
        Save a template from any board's right-click menu.
      </p>
      {loading && <div className="settings-empty">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="settings-empty">No templates yet.</div>
      )}
      <div className="settings-templates-grid">
        {items.map(t => {
          const tint = COVER_TINTS[t.cover || 'neutral'] || COVER_TINTS.neutral;
          return (
            <div key={t.id} className="settings-template-tile">
              <div className="settings-template-cover" style={{ background: tint }}>
                <span className="settings-template-tag">{t.scope === 'user' ? 'PERSONAL' : 'WORKSPACE'}</span>
              </div>
              <div className="settings-template-meta">
                <span className="settings-template-name">{t.name || 'Untitled'}</span>
                {canManage && (
                  <div className="settings-template-actions">
                    <button type="button" className="settings-link-btn"
                            onClick={() => onRename(t)}>Rename</button>
                    <button type="button" className="settings-link-btn settings-link-btn-danger"
                            onClick={() => onDelete(t)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Display tab — clean mode + sidebar default ──────────────────────────
function DisplayTab({ mySettings, refresh }) {
  const feedback = useFeedback();
  const ui = mySettings.ui || {};
  const setUi = async (patch) => {
    try {
      await updateOwnSettings({ ui: { ...ui, ...patch } });
      refresh?.();
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) });
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Display</h3>
      <p className="settings-section-hint">
        Personal layout preferences — only apply for you.
      </p>

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
    </div>
  );
}

// ── Generic field wrappers ──────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">{label}</span>
      <div className="settings-field-control">{children}</div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }) {
  return (
    <label className="settings-toggle">
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {desc && <span className="settings-toggle-desc">{desc}</span>}
      </span>
      <span className={`settings-toggle-switch ${value ? 'is-on' : ''}`}
            onClick={() => onChange(!value)}
            role="switch"
            aria-checked={value}>
        <span className="settings-toggle-thumb" />
      </span>
    </label>
  );
}
