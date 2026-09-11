// Source-guard for Phase 0's client half: the ShareModal can invite a
// workspace viewer, the Members tab exists and is documented, the permission
// mirror honours viewer, the presence party checks identity. The ?local=1
// harness stubs Supabase and never mounts ShareModal or SettingsPanel, so this
// reads the source the way collab-invite-link-wiring does.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('workspace roles wiring', () => {
  test('ShareModal sends the chosen workspace role, not a hard-coded editor', () => {
    const s = read('src/components/ShareModal.jsx');
    expect(s).toContain("const workspaceRole = inviteRole === 'workspaceviewer' ? 'viewer' : 'editor';");
    expect(s).toMatch(/inviteWorkspaceMember\(\{[\s\S]{0,120}role: workspaceRole,/);
    expect(s).not.toMatch(/inviteWorkspaceMember\(\{[\s\S]{0,120}role: 'editor'/);
    expect(s).toContain('<option value="workspaceviewer">');
  });

  test('Settings has a members tab, in the right key order for the docs gate', () => {
    const s = read('src/components/SettingsPanel.jsx');
    expect(s).toMatch(/\{ id: 'members',\s+label: 'Members',\s+group: 'workspace' \}/);
    expect(s).toContain("{tab === 'members' && (");
    expect(read('content/docs/account/settings.md')).toContain('### Members');
  });

  test('the Members tab uses the 0318 RPC and confirms before removing', () => {
    const s = read('src/components/settings/MembersTab.jsx');
    expect(s).toContain('setWorkspaceMemberRole({');
    expect(s).toMatch(/feedback\.confirm\(\{[\s\S]{0,200}confirmLabel: 'Remove member'/);
    expect(read('src/lib/boardsApi.js')).toContain("rpc('set_workspace_member_role'");
  });

  test('the permission mirror returns viewer for a viewer member', () => {
    const s = read('src/hooks/useBoardPermission.js');
    expect(s).toContain("membership.role !== 'viewer'");
    expect(s).toContain("return { role: 'viewer', canEdit: false, source: 'workspace' };");
  });

  test('the workspace party refuses a presence claim for another user', () => {
    const s = read('party/workspace.ts');
    expect(s).toContain('req.headers.set("x-user-id", auth.userId ?? "");');
    expect(s).toContain('String(msg.user.id) !== owner');
  });

  test('the upload party reports the object size it measured', () => {
    expect(read('party/upload.ts')).toContain('{ key, bytes: result.bytes ?? null }');
    expect(read('src/lib/uploads.js')).toContain('sizeBytes: serverBytes');
  });
});
