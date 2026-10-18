// share-panel-simplicity.spec.js
//
// The share panel is a permissions console, and permissions are genuinely
// detailed — none of what it renders is unnecessary. The defect it had was that
// ALL of it was present at rest, so the common case (hand someone a link) was
// buried inside the rare one (audit and revoke): two kinds of link in two
// sections with two create flows, four selects, two checkboxes, up to four
// buttons per link row, two people lists with two headers and two empty states.
//
// This spec is the ratchet on that. It does not assert "looks simple" — it
// asserts the specific structural claims that make it simple, each of which a
// future change could quietly undo:
//
//   1. the advanced controls live INSIDE the disclosure, not beside it
//   2. one gold control at a time, one access decision, one people list
//   3. nothing that used to be reachable stopped being reachable
//
// Since 2026-10-17 the panel is invite-first (owner decision): Invite people,
// People with access, Link access, Explore, and a footer with Copy link and
// Done that never scrolls away.
//
// SOURCE-LEVEL, deliberately: App.jsx early-returns to LocalBoardsApp under
// ?local=1, so the panel never mounts in the harness and LocalBoardsApp has no
// share control to mirror. The derivation itself is unit-tested in
// shareAccess.test.mjs; this pins the wiring, the same way
// collab-nudge-wiring.spec.js does.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const modal = () => read('src/components/ShareModal.jsx');
const explore = () => read('src/components/ExplorePublishSection.jsx');
const css = () => read('src/styles.css');

// The <details className="share-link-options"> block, sliced out so "inside the
// disclosure" is a real containment check and not a pair of indexOf comparisons
// that a later section could satisfy by accident.
function linkSettingsBlock(s) {
  const start = s.indexOf('<details className="share-link-options"');
  expect(start, 'the Link settings disclosure is gone').toBeGreaterThan(-1);
  const end = s.indexOf('</details>', start);
  expect(end).toBeGreaterThan(start);
  return s.slice(start, end);
}

test.describe('the resting panel is one decision and one action', () => {
  test('one gold control at a time, decided in one place', () => {
    // Every action in here was gold once, so "hand someone a link" and "submit
    // for editorial review" pulled the eye equally. Gold marks the action the
    // panel is about to take: Copy link at rest, Invite while there are
    // addresses in the box, nothing when no link can exist.
    const s = modal();
    expect(s.match(/share-btn-gold/g)?.length, 'only goldIf may add the class').toBe(1);
    expect(s).toMatch(/const goldIf = \(which\) => \(goldControl === which \? ' share-btn-gold' : ''\);/);
    expect(s).toMatch(/inviteEmail\.trim\(\) \? 'invite'\s*:\s*accessMode === 'off' \? null : 'copy';/);
    expect(s).toMatch(/className=\{'share-invite-btn' \+ goldIf\('invite'\)\}/);
    expect(s).toMatch(/className=\{'share-invite-btn share-foot-btn' \+ goldIf\('copy'\)\}/);
    expect(css()).not.toContain('share-invite-btn-primary');
  });

  test('the panel opens on Copy link, or on Done for someone who cannot make one', () => {
    // Share → Enter is a link on the clipboard. Never the email box: on a
    // phone, focusing it throws the keyboard up over the panel.
    const s = modal();
    expect(s).toMatch(/initialFocusRef=\{canInvite \? copyLinkRef : doneRef\}/);
    expect(s).toMatch(/ref=\{copyLinkRef\}\s*\n\s*onClick=\{takeLink\}/);
    expect(s).toMatch(/ref=\{doneRef\}\s*\n\s*onClick=\{onClose\}/);
  });

  test('the invite row says what the role means and what an invitation earns', () => {
    const s = modal();
    expect(s).toContain('<div className="share-hint share-role-hint">{roleHint}</div>');
    expect(s).toContain('<InviteRewardNote tier={rewardTier} stats={referralStats} onOpenInvites={onOpenInvites} />');
    // The tier comes in as a prop: a second useMyTier() instance without a
    // userId resets the app's one shared tier store.
    expect(s).not.toMatch(/=\s*useMyTier\(/);
    expect(s).not.toContain("from '../hooks/useMyTier.js'");
  });

  test('one picker with exactly three states, over both kinds of link', () => {
    const s = modal();
    const start = s.indexOf('share-access-select');
    const end = s.indexOf('</select>', start);
    const opts = s.slice(start, end).match(/<option value="/g) || [];
    expect(opts.length, 'the access picker must offer exactly view / edit / off').toBe(3);
    expect(s.slice(start, end)).toContain('value="view"');
    expect(s.slice(start, end)).toContain('value="edit"');
    expect(s.slice(start, end)).toContain('value="off"');
  });

  test('the button label never claims a link that does not exist', () => {
    // "Copy link" on a board with no link sends someone to paste nothing.
    const s = modal();
    expect(s).toMatch(/currentLink \? 'Copy link' : 'Create link & copy'/);
    // And the status line is built from rows, not from the picker's value.
    expect(s).toMatch(/const linkStatus = \(\) => \{[\s\S]{0,200}if \(!currentLink\) return 'No link yet'/);
  });
});

test.describe('everything that was on the front page is one disclosure away', () => {
  test('expiry, scope and indexing all live inside Link settings', () => {
    const block = linkSettingsBlock(modal());
    expect(block, 'expiry escaped the disclosure').toContain('setLinkExpiry');
    expect(block, 'expiry escaped the disclosure').toContain('setInviteLinkExpiry');
    expect(block, 'sub-cluster scope escaped the disclosure').toContain('setLinkIncludeSubboards');
    // The live-link list — with its four-buttons-per-row density — is correct
    // in here and wrong on the front page.
    expect(block, 'the live-link list escaped the disclosure').toContain('live.map(linkRow)');
  });

  test('the per-link toggles still exist, they only moved', () => {
    // Simplifying by deletion would be a different change than the one made.
    const s = modal();
    for (const call of ['setPublicLinkSubboards', 'setPublicLinkIndexing', 'revokePublicLink', 'onCopyPublicLink']) {
      expect(s, `${call} was removed rather than relocated`).toContain(call);
    }
    expect(s).toContain('Allow indexing');
    expect(s).toContain('Hide from search');
  });

  test('Publish to Explore collapses but keeps its status visible', () => {
    expect(modal()).toMatch(/<ExplorePublishSection[^>]*collapsible/);
    const e = explore();
    expect(e).toMatch(/collapsible = false/);
    // A disclosure that hides whether your submission is still pending gets
    // opened every time, which is not a disclosure.
    expect(e).toMatch(/statusChip = isLive \? '✓ Live'/);
    expect(e).toMatch(/<summary>[\s\S]{0,300}share-advanced-status/);
    // The standalone rendering must survive for any non-panel caller.
    expect(e).toMatch(/if \(!collapsible\)/);
  });
});

test.describe('one list, one scroll region', () => {
  test('the two people lists became one, and none of their controls were lost', () => {
    const s = modal();
    expect(s.match(/People with access · /g)?.length).toBe(1);
    // The sub-headers that split it are gone — scope is carried per row.
    expect(s).not.toContain('share-subhead');
    expect(s).toContain('Member — can edit every cluster');
    expect(s).toMatch(/ROLE_LABEL\[s\.role\]\} — this cluster/);
    // One empty state, not two.
    expect(s.match(/className="share-empty"/g)?.length).toBe(2);   // loading + empty
    // Every per-row control kept its gate. 0391 widened "the owner" to "the
    // owner or a co-owner" (isManager); handing the workspace over stays the
    // owner's alone.
    expect(s).toMatch(/isManager && !isSelf && !isWsOwner/);
    // 0397: a viewer or a service account can't be made owner (the server
    // refuses both), and a service account's row has no actions at all.
    expect(s).toMatch(/isManager && !isSelf && !isWsOwner && m\.role !== 'service'/);
    expect(s).toMatch(/\{isOwner && m\.role !== 'viewer' && \(\s*<button className="share-remove" onClick=\{\(\) => onMakeOwner\(m\)\}/);
    expect(s).toMatch(/\(isManager \|\| s\.invited_by === selfUserId\)/);
    expect(s).toMatch(/\(isManager \|\| row\.invited_by === selfUserId\)/);
    expect(s).toMatch(/const isManager = isOwner \|\| myRole === 'coowner';/);
  });

  test('people who reach a sub-cluster through a parent are listed, read-only', () => {
    // SHARE-14: access cascades down the tree, so a list of this cluster's own
    // shares told an owner auditing a sub-cluster the wrong answer.
    const s = modal();
    expect(s).toContain('listInheritedBoardShares(board.id)');
    expect(s).toMatch(/inheritedAccessRows\(inheritedShares, \{ shares, workspaceMembers \}\)/);
    expect(s).toMatch(/shares\.length \+ inherited\.length/);
    const start = s.indexOf('{inherited.map(');
    expect(start).toBeGreaterThan(-1);
    const row = s.slice(start, s.indexOf('{pendingBoardInvites.map(', start));
    expect(row).toContain('— via {via}');
    // Granted on the parent, removed on the parent: no Remove, no role select.
    expect(row).not.toContain('onRemoveShare');
    expect(row).not.toContain('<select');
  });

  test('the panel scrolls as one body', () => {
    // Three sections each with their own overflow-y meant three independently
    // scrolling regions inside one dialog on a phone, where .share-modal is a
    // full-screen flex column.
    expect(modal()).toMatch(/className="share-body"/);
    const c = css();
    expect(c).toMatch(/\.share-body \{[\s\S]{0,160}overflow-y: auto/);
    const section = c.slice(c.indexOf('.share-section {'), c.indexOf('.share-section:last-child'));
    expect(section, '.share-section scrolls again').not.toContain('overflow-y');
  });

  test('the footer sits outside the scrolling body', () => {
    // Copy link and Done stay one press away wherever the panel is scrolled.
    const s = modal();
    expect(s.indexOf('className="share-foot"')).toBeGreaterThan(s.indexOf('<ExplorePublishSection'));
    expect(css()).toMatch(/\.share-foot \{\s*flex: 0 0 auto;/);
  });
});

test.describe('the simplification did not weaken the permissions', () => {
  test('viewers get no link controls at all', () => {
    // canInvite gates the invite row (and the reward note in it), the link
    // section and the footer's Copy link; a viewer cannot mint a link, and
    // offering one produces an RLS error.
    const s = modal();
    // Anchor on the rendered headings, not on the prose — the section names
    // appear in this file's header comment first.
    for (const heading of ['Invite people</h3>', 'Link access</h3>', 'ref={copyLinkRef}']) {
      const at = s.indexOf(heading);
      expect(at, `${heading} missing`).toBeGreaterThan(-1);
      expect(s.slice(Math.max(0, at - 300), at)).toContain('{canInvite && (');
    }
  });

  test('workspace membership stays with the owner and co-owners', () => {
    const s = modal();
    expect(s).toMatch(/isManager && \(\s*\n\s*<option value="workspace"/);
    expect(s).toMatch(/isManager && \(\s*\n\s*<option value="workspaceviewer"/);
  });

  test('turning access off is the only path that revokes, and it confirms first', () => {
    const s = modal();
    const start = s.indexOf('const onPickAccess');
    const end = s.indexOf('const onCopyPublicLink');
    expect(start).toBeGreaterThan(-1);
    const body = s.slice(start, end);
    // Switching between view and edit must never revoke: a link already pasted
    // into a message keeps working, and the status line names it as still live.
    expect(body.match(/revokePublicLink/g)?.length).toBe(1);
    expect(body.indexOf('feedback.confirm')).toBeLessThan(body.indexOf('revokePublicLink'));
    // A cancelled confirm must leave the picker where it was, or the panel
    // claims an access level the server never applied.
    expect(body).toMatch(/if \(!ok\) return;/);
    expect(body.indexOf('if (!ok) return;')).toBeLessThan(body.indexOf("setAccessMode('off')"));
  });

  test("turning access off revokes only the links this person may revoke", () => {
    // SHARE-7: revoke_public_link refuses an editor on someone else's link, so
    // revoking every live link made "Only invited people" fail on every try.
    const s = modal();
    const body = s.slice(s.indexOf('const onPickAccess'), s.indexOf('const onCopyPublicLink'));
    expect(body).toMatch(/const \{ mine, others \} = revocableLinks\(publicLinks, \{ isManager, selfUserId \}\);/);
    expect(body).toContain('mine.map(l => revokePublicLink(l.token))');
    expect(body).not.toContain('live.map(l => revokePublicLink');
  });

  test('the panel and the topbar converge on one link', () => {
    // ensurePublicLink reuses by SCOPE, so a panel defaulting to
    // this-cluster-only while the topbar minted with sub-clusters left a board
    // with two live links that were the same link in every way a person cares
    // about. Both surfaces now go through ensurePublicLink with the same scope.
    const s = modal();
    expect(s).toContain('ensurePublicLink');
    expect(s).toMatch(/const \[linkIncludeSubboards, setLinkIncludeSubboards\] = useState\(true\)/);
    expect(read('src/App.jsx')).toMatch(/ensurePublicLink\(\{ boardId: currentBoard\.id, includeSubboards: true \}\)/);
  });
});
