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
//   2. there is one primary action, one access decision, one people list
//   3. nothing that used to be reachable stopped being reachable
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
  test('exactly one primary button, and it leads its row', () => {
    const s = modal();
    expect(s.match(/share-invite-btn-primary/g)?.length).toBe(1);
    // The button precedes the picker: the first thing you can press is the
    // thing you came for, and the picker qualifies it rather than gating it.
    expect(s.indexOf('share-invite-btn-primary')).toBeLessThan(s.indexOf('share-access-select'));
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
    expect(s.match(/PEOPLE WITH ACCESS · /g)?.length).toBe(1);
    // The sub-headers that split it are gone — scope is carried per row.
    expect(s).not.toContain('share-subhead');
    expect(s).toContain('Member — can edit every cluster');
    expect(s).toMatch(/ROLE_LABEL\[s\.role\]\} — this cluster/);
    // One empty state, not two.
    expect(s.match(/className="share-empty"/g)?.length).toBe(2);   // loading + empty
    // Every per-row control kept its gate.
    expect(s).toMatch(/isOwner && !isSelf && !isWsOwner/);
    expect(s).toMatch(/\(isOwner \|\| s\.invited_by === selfUserId\)/);
    expect(s).toMatch(/\(isOwner \|\| row\.invited_by === selfUserId\)/);
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
});

test.describe('the simplification did not weaken the permissions', () => {
  test('viewers get no link controls at all', () => {
    // canInvite gates both the general-access block and the invite row; a
    // viewer cannot mint a link, and offering one produces an RLS error.
    const s = modal();
    // Anchor on the rendered eyebrow, not on the prose — the section names
    // appear in this file's header comment first.
    for (const eyebrow of ['GENERAL ACCESS</div>', 'INVITE SPECIFIC PEOPLE</div>']) {
      const at = s.indexOf(eyebrow);
      expect(at, `${eyebrow} missing`).toBeGreaterThan(-1);
      expect(s.slice(Math.max(0, at - 300), at)).toContain('{canInvite && (');
    }
  });

  test('workspace membership stays owner-only', () => {
    const s = modal();
    expect(s).toMatch(/isOwner && \(\s*\n\s*<option value="workspace"/);
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
