// entries.jsx — the fabricated props behind every gallery entry.
//
// Keyed by the ids in lib/galleryIndex.js. That file is pure data so it can be
// tested under `node --test`; this one holds the JSX and therefore cannot be,
// which is why galleryIndex.test.mjs scans it as TEXT to prove the two halves
// never drift apart. Keep every key at exactly two spaces of indent — that is
// what the parity scan matches.
//
//   overlay:  ({ close }) => JSX
//   toast:    (feedback)  => void        // fired through the real API
//
// ── The rule for a fixture ────────────────────────────────────────────────
// Render the REAL component with invented INPUTS. Never re-implement a
// surface's markup here: a copy of the cap wall proves the copy looks fine,
// which is worth nothing. Where a surface derives its state internally rather
// than from props, the fix belongs in that component as a narrow, defaulted
// seam (PricingModal's `tierPreview`, UpgradeChip's extracted `UpgradePill`) —
// not in a lookalike here.
//
// Nothing in this file may import CanvasSurface, PublicBoardView, LocalBoardsApp
// or AdminPage: they are the four heavy trees, and pulling one in would drag it
// into a shared chunk and inflate the build for every signed-out visitor. The
// surfaces that live inside them are listed as 'insitu' with a recipe instead.
import { Inbox, Image as ImageIcon, Search, Home, Plus } from '../../lib/icons.js';

import { PricingModal } from '../PricingModal.jsx';
import { UpgradePill } from '../UpgradeChip.jsx';
import { FirstValueUpgradeBanner } from '../FirstValueUpgradeBanner.jsx';
import { ImportCapDialog } from '../ImportCapDialog.jsx';
import { BillingSummary } from '../settings/BillingTab.jsx';
import { OnboardingCoachmark } from '../OnboardingCoachmark.jsx';
import { OnboardingTour } from '../OnboardingTour.jsx';
import { stepsFor } from '../../lib/onboardingTour.js';
import { ShareModal } from '../ShareModal.jsx';
import { PublicTopbar } from '../PublicTopbar.jsx';
import { JoinBoardCard } from '../JoinBoardCard.jsx';
import { SharePrompt } from '../SharePrompt.jsx';
import { ReturnReasonAsk } from '../ReturnReasonAsk.jsx';
import { ReferralNudge } from '../ReferralNudge.jsx';
import { FeedbackButton } from '../FeedbackButton.jsx';
import { SettingsPanel } from '../SettingsPanel.jsx';
import { DeleteAccount } from '../settings/DeleteAccount.jsx';
import { ShortcutsOverlay } from '../ShortcutsOverlay.jsx';
import { CommandPalette } from '../CommandPalette.jsx';
import { TrashModal } from '../TrashModal.jsx';
import { CustomFontsModal } from '../CustomFontsModal.jsx';
import { SaveTemplateDialog } from '../SaveTemplateDialog.jsx';
import { TemplateAddedPrompt } from '../TemplateAddedPrompt.jsx';
import { ThumbnailCropModal } from '../ThumbnailCropModal.jsx';
import { ImageEditModal } from '../ImageEditModal.jsx';
import { ImageLightbox } from '../ImageLightbox.jsx';
import { WaitlistModal } from '../WaitlistModal.jsx';
import { WorkspaceRecoveryModal } from '../WorkspaceRecoveryModal.jsx';
import { ShowcaseBanner } from '../ShowcaseBanner.jsx';
import { EmptyState } from '../EmptyState.jsx';
import { HomeEmptyState } from '../HomeEmptyState.jsx';
import { NotFoundPage } from '../../pages/NotFoundPage.jsx';
import { AdminSkeleton, AdminError, AdminAsync } from '../../pages/admin/AdminStates.jsx';
import { ChartPlaceholder } from '../../pages/admin/SmallN.jsx';
import { AppErrorBoundary } from '../AppErrorBoundary.jsx';
import { SurfaceErrorBoundary } from '../SurfaceErrorBoundary.jsx';
import { Sheet } from '../shell/Sheet.jsx';
import { MobileDrawer } from '../shell/MobileDrawer.jsx';
import { MobileBottomNav } from '../shell/MobileBottomNav.jsx';
import { POWER_REVEALS } from '../../lib/powerReveals.js';
import { PRICE_FROM_LABEL } from '../../lib/billingCopy.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

// The useMyTier shape PricingModal reads. Defaults describe the account the
// upgrade surfaces are actually aimed at: a demo user with a real body of work.
const tierShape = (over = {}) => ({
  tier: 'demo',
  demoCardCount: 41,
  serverCardCount: 41,
  effectiveCardLimit: 50,
  grantActive: false,
  creatorTrialStartedAt: null,
  ...over,
});

const NOOP = () => {};
const USER = { id: '00000000-0000-4000-8000-000000000000', email: 'preview@example.com', created_at: '2026-08-01T00:00:00Z' };
const BOARD = { id: '00000000-0000-4000-8000-00000000b0a4', name: 'Reference wall', workspace_id: '00000000-0000-4000-8000-0000000077aa' };
const WORKSPACE = { id: BOARD.workspace_id, name: 'My workspace', created_by: USER.id };

// A 2×2 mid-grey PNG. Deliberately not a 1×1: a 1×1 satisfies toBeVisible while
// proving nothing, and the same is true of a preview you are looking at.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8//8/AzbAxIAHDDFJAF2+Ah/XiJJ1AAAAAElFTkSuQmCC';

// Some surfaces open only on a window event and a quiet-DOM check, and hold a
// per-device one-shot so they cannot be re-shown. Clearing that key is fair on
// the admin's own device — it is the gallery's own preview latch, not a user's.
function nudge(eventName, detail, clearKeys = []) {
  for (const k of clearKeys) { try { localStorage.removeItem(k); } catch (_) {} }
  setTimeout(() => {
    try { window.dispatchEvent(new CustomEvent(eventName, { detail })); } catch (_) {}
  }, 60);
}

// A child that throws on render, so an error boundary can be shown in its real
// error state rather than described. The boundaries reach it no other way.
function Thrower() {
  throw new Error('Surface Gallery preview — this error is deliberate.');
}

const reveal = (key) => (feedback) => {
  const r = POWER_REVEALS.find((x) => x.key === key);
  if (!r) return;
  // ttl 60s, not the real 30s: a toast that vanishes while you are still
  // looking at it is not a preview. RevealQaHarness makes the same trade.
  feedback.toast({ message: r.message, ttl: 60000, action: { label: r.actionLabel, onClick: NOOP } });
};

// ── Renderers ──────────────────────────────────────────────────────────────

export const RENDERERS = {
  // Upgrade & billing
  'pricing-modal': ({ close }) => <PricingModal onClose={close} tierPreview={tierShape({ demoCardCount: 8, serverCardCount: 8 })} />,
  'pricing-modal-trial': ({ close }) => <PricingModal onClose={close} tierPreview={tierShape()} />,
  'pricing-modal-trialed': ({ close }) => <PricingModal onClose={close} tierPreview={tierShape({ creatorTrialStartedAt: '2026-08-20T00:00:00Z' })} />,
  'pricing-modal-trial-refused': ({ close }) => <PricingModal onClose={close} tierPreview={tierShape()} />,
  'pricing-modal-cap-hit': ({ close }) => (
    <PricingModal onClose={close} header="cap-hit" surface="cap_hit" via="cap_wall"
                  clusterCount={6} rejected={{ n: 12, noun: 'images' }}
                  tierPreview={tierShape({ demoCardCount: 50, serverCardCount: 50 })} />
  ),
  'pricing-modal-first-value': ({ close }) => <PricingModal onClose={close} header="first-value" surface="first_value" via="first_value_banner" tierPreview={tierShape({ demoCardCount: 13, serverCardCount: 13 })} />,
  'pricing-modal-storage': ({ close }) => <PricingModal onClose={close} header="storage" surface="storage" via="upload_blocked" tierPreview={tierShape()} />,
  'first-value-banner': () => <FirstValueUpgradeBanner onSeeCreator={NOOP} onDismiss={NOOP} />,
  'upgrade-pill-plain': () => <PillStage><UpgradePill near={false} count={4} limit={50} showCount={false} showPrice={false} onClick={NOOP} /></PillStage>,
  'upgrade-pill-count': () => <PillStage><UpgradePill near={false} count={28} limit={50} showCount showPrice onClick={NOOP} /></PillStage>,
  'upgrade-pill-urgent': () => <PillStage><UpgradePill near count={46} limit={50} showCount showPrice onClick={NOOP} /></PillStage>,
  'import-cap-dialog': ({ close }) => <ImportCapDialog open n={64} take={9} over={55} count={41} limit={50} kinds={{ image: 64 }} onTakePartial={close} onUpgrade={close} onCancel={close} />,
  'import-cap-dialog-full': ({ close }) => <ImportCapDialog open n={64} take={0} over={64} count={50} limit={50} kinds={{ image: 60, video: 4 }} onTakePartial={close} onUpgrade={close} onCancel={close} />,
  'billing-demo': () => <BillingStage><BillingSummary tier="demo" demoCardCount={41} effectiveCardLimit={50} onUpgrade={NOOP} /></BillingStage>,
  'billing-paid': () => <BillingStage><BillingSummary tier="paid" sub={{ plan: 'monthly', status: 'active', current_period_end: '2026-10-15T00:00:00Z' }} subscriptionStatus="active" currentPeriodEnd="2026-10-15T00:00:00Z" onManage={NOOP} /></BillingStage>,
  'billing-trialing': () => <BillingStage><BillingSummary tier="paid" sub={{ plan: 'monthly', status: 'trialing', current_period_end: '2026-09-29T00:00:00Z' }} subscriptionStatus="trialing" currentPeriodEnd="2026-09-29T00:00:00Z" onManage={NOOP} /></BillingStage>,
  'billing-trial-canceled': () => <BillingStage><BillingSummary tier="paid" sub={{ plan: 'monthly', status: 'trialing', current_period_end: '2026-09-29T00:00:00Z' }} subscriptionStatus="trialing" currentPeriodEnd="2026-09-29T00:00:00Z" cancelAtPeriodEnd onManage={NOOP} /></BillingStage>,
  'billing-canceled': () => <BillingStage><BillingSummary tier="paid" sub={{ plan: 'annual', status: 'active', current_period_end: '2026-12-01T00:00:00Z' }} subscriptionStatus="active" currentPeriodEnd="2026-12-01T00:00:00Z" cancelAtPeriodEnd onManage={NOOP} /></BillingStage>,
  'billing-grant': () => <BillingStage><BillingSummary tier="paid" grantActive grantExpiresAt="2026-12-31T00:00:00Z" /></BillingStage>,
  'billing-admin': () => <BillingStage><BillingSummary tier="admin" /></BillingStage>,

  // Onboarding
  'coachmark': ({ close }) => <OnboardingCoachmark boardId={BOARD.id} onDismiss={close} />,
  'coachmark-tutorial': ({ close }) => <OnboardingCoachmark boardId={BOARD.id} onDismiss={close} hasTutorialBoard />,
  'coachmark-escalated': ({ close }) => <OnboardingCoachmark boardId={BOARD.id} onDismiss={close} escalated />,
  'tour-desktop': ({ close }) => <OnboardingTour step={stepsFor('full')[0]} onEvent={NOOP} onSkip={close} onView={NOOP} onAction={NOOP} />,
  'tour-mobile': ({ close }) => <OnboardingTour step={stepsFor('mobile_lite')[0]} onEvent={NOOP} onSkip={close} onView={NOOP} onAction={NOOP} />,
  'tour-project': ({ close }) => <OnboardingTour step={stepsFor('project_first')[0]} onEvent={NOOP} onSkip={close} onView={NOOP} onAction={NOOP} />,

  // Sharing
  'share-modal': ({ close }) => <ShareModal board={BOARD} workspace={WORKSPACE} selfUserId={USER.id} canManage onClose={close} />,
  'share-modal-invite': ({ close }) => <ShareModal board={BOARD} workspace={WORKSPACE} selfUserId={USER.id} canManage initialSection="invite-link" onClose={close} />,
  'public-topbar-signed-out': () => <PublicTopbar hrefFor={() => '#'} onCta={() => NOOP} center={<div className="public-topbar-spacer" />} />,
  'public-topbar-remix': () => <PublicTopbar hrefFor={() => '#'} onCta={() => NOOP} remixUrl="#" center={<div className="public-topbar-spacer" />} />,
  'public-topbar-signed-in': () => <PublicTopbar hrefFor={() => '#'} onCta={() => NOOP} remixUrl="#" signedIn center={<div className="public-topbar-spacer" />} />,
  'public-topbar-open': () => <PublicTopbar hrefFor={() => '#'} onCta={() => NOOP} signedIn center={<div className="public-topbar-spacer" />} />,
  'join-editor': () => <JoinBoardCard role="editor" boardName={BOARD.name} href="#" token="preview" onJoinClick={NOOP} />,
  'join-viewer': () => <JoinBoardCard role="viewer" boardName={BOARD.name} href="#" token="preview" onJoinClick={NOOP} />,
  'share-prompt': () => <SharePrompt href="#" onCtaClick={NOOP} subboardOpened ctaClickedRef={{ current: false }} />,

  // Prompts
  'return-reason-ask': () => <ReturnAskStage /> ,
  'return-reason-probe': () => <ReturnAskStage pick />,
  'return-reason-receipt': () => <ReturnAskStage pick send />,
  'referral-nudge': () => <ReferralStage />,
  'feedback-button': () => <FeedbackButton as="floating" />,

  // Toasts & dialogs
  'toast-near-cap': (f) => f.toast({
    type: 'warning', ttl: 60000,
    message: `You're at 46/50 cards. Creator lifts the cap, ${PRICE_FROM_LABEL} — or invite friends to earn more free ones.`,
    action: { label: 'See Creator', onClick: NOOP },
  }),
  'toast-cap-rehit': (f) => f.toast({
    type: 'warning', ttl: 60000,
    message: "12 more images didn't fit. You're at your 50-card limit. Creator lifts it — or invite friends to earn more free ones.",
    action: { label: 'See Creator', onClick: NOOP },
  }),
  'toast-referral-reward': (f) => f.toast({ type: 'success', ttl: 60000, message: 'Your invite was accepted — 25 bonus cards added.', action: { label: 'Invite more', onClick: NOOP } }),
  'toast-share-ask': (f) => f.toast({ ttl: 60000, message: 'This cluster is looking good — send it to someone?', action: { label: 'Copy link', onClick: NOOP } }),
  'toast-manage-access': (f) => f.toast({ ttl: 60000, message: 'Public link created.', action: { label: 'Manage access', onClick: NOOP } }),
  'toast-reveal-grids': reveal('grids'),
  'toast-reveal-group': reveal('group'),
  'toast-reveal-list': reveal('list_drive'),
  'toast-reveal-docs': reveal('docs'),
  'toast-reveal-palette': reveal('palette'),
  'toast-success': (f) => f.toast({ type: 'success', ttl: 60000, message: 'Saved.' }),
  'toast-error': (f) => f.toast({ type: 'error', ttl: 60000, message: "That didn't save — check your connection and try again." }),
  'toast-info': (f) => f.toast({ ttl: 60000, message: 'Rendering the preview at full size.' }),
  'toast-undo': (f) => f.toast({ ttl: 60000, message: 'Cluster deleted.', action: { label: 'Undo', onClick: NOOP } }),
  'dialog-confirm': (f) => f.confirm({ title: 'Leave this workspace?', message: 'You will lose access to every cluster in it.', confirmLabel: 'Leave' }),
  'dialog-confirm-danger': (f) => f.confirm({ title: 'Delete this cluster?', message: 'Everything inside it goes too.', confirmLabel: 'Delete', danger: true }),
  'dialog-confirm-typed': (f) => f.confirm({ title: 'Delete this workspace?', message: 'This cannot be undone.', confirmLabel: 'Delete permanently', danger: true, confirmText: 'My workspace', confirmTextLabel: 'Type the workspace name to confirm' }),
  'dialog-prompt': (f) => f.prompt({ title: 'Rename cluster', label: 'Name', defaultValue: BOARD.name, confirmLabel: 'Rename' }),
  'dialog-delete-account': (f) => f.confirm({ title: 'Delete your account?', message: 'Every workspace you own, and everything in them, is removed. This cannot be undone.', confirmLabel: 'Delete permanently', danger: true }),

  // Settings — the real panel, opened on each tab.
  'settings-profile': ({ close }) => <SettingsStage tab="profile" close={close} />,
  'settings-appearance': ({ close }) => <SettingsStage tab="appearance" close={close} />,
  'settings-notifications': ({ close }) => <SettingsStage tab="notifications" close={close} />,
  'settings-connections': ({ close }) => <SettingsStage tab="connections" close={close} />,
  'settings-billing': ({ close }) => <SettingsStage tab="billing" close={close} />,
  'settings-invite': ({ close }) => <SettingsStage tab="invite" close={close} />,
  'settings-general': ({ close }) => <SettingsStage tab="general" close={close} />,
  'settings-members': ({ close }) => <SettingsStage tab="members" close={close} />,
  'settings-defaults': ({ close }) => <SettingsStage tab="defaults" close={close} />,
  'settings-docs': ({ close }) => <SettingsStage tab="docs" close={close} />,
  'settings-capture': ({ close }) => <SettingsStage tab="capture" close={close} />,
  'delete-account-panel': () => <BillingStage><DeleteAccount email={USER.email} /></BillingStage>,

  // Modals & panels
  'shortcuts': ({ close }) => <ShortcutsOverlay open onClose={close} />,
  'command-palette': ({ close }) => <CommandPalette open onClose={close} workspaceId={WORKSPACE.id} boards={[BOARD]} rootId={BOARD.id} commands={[{ id: 'c1', label: 'New cluster', keywords: ['add'], run: NOOP, available: true }]} onOpenBoard={NOOP} />,
  'command-palette-pick': ({ close }) => <CommandPalette open mode="pick" onClose={close} workspaceId={WORKSPACE.id} boards={[BOARD]} rootId={BOARD.id} onPickBoard={NOOP} placeholder="Pick a cluster…" />,
  'trash-modal': ({ close }) => <TrashModal open workspaceId={WORKSPACE.id} onClose={close} />,
  'custom-fonts': ({ close }) => <CustomFontsModal open onClose={close} />,
  'save-template': ({ close }) => <SaveTemplateDialog open layout={{ cols: 3, rows: 2, cells: [] }} size={{ w: 3, h: 2 }} defaultName="Three up" onCancel={close} onSave={close} />,
  'template-added': ({ close }) => <TemplateAddedPrompt template={{ name: 'Three up', tree: { cols: 3, rows: 2, cells: [] } }} armed onPlace={close} onDismiss={close} />,
  'thumbnail-crop': ({ close }) => <ThumbnailCropModal file={pngFile()} onCancel={close} onSave={close} />,
  'image-edit': ({ close }) => <ImageEditModal src={IMG} title="Reference" adjust={null} cardId="preview" onChange={NOOP} onReset={NOOP} onDownload={NOOP} onClose={close} />,
  'image-lightbox': ({ close }) => <ImageLightbox src={IMG} title="Reference" alt="Preview image" adjust={null} cardId="preview" onClose={close} />,
  'waitlist-modal': ({ close }) => <WaitlistModal onClose={close} />,
  'workspace-recovery': ({ close }) => <WorkspaceRecoveryModal open workspaceId={WORKSPACE.id} onClose={close} />,
  'showcase-banner': ({ close }) => <ShowcaseBanner onClear={close} boardId={BOARD.id} />,

  // Empty & error states
  'not-found': () => <NotFoundPage />,
  'empty-state': () => <PageStage><EmptyState icon={Inbox} title="Nothing here yet" body="Whatever you add will show up in this space." action={{ label: 'Add something', onClick: NOOP }} /></PageStage>,
  'home-empty': () => <PageStage><HomeEmptyState /></PageStage>,
  'splash-loading': () => <PageStage><div className="splash"><div className="splash-spinner" /></div></PageStage>,
  'app-error': () => <BoundaryStage kind="app" />,
  'surface-error': () => <BoundaryStage kind="surface" />,
  'admin-skeleton-table': () => <PageStage><AdminSkeleton variant="table" /></PageStage>,
  'admin-skeleton-cards': () => <PageStage><AdminSkeleton variant="cards" /></PageStage>,
  'admin-skeleton-chart': () => <PageStage><AdminSkeleton variant="chart" /></PageStage>,
  'admin-error': () => <PageStage><AdminError error="Could not reach the metrics service." onRetry={NOOP} /></PageStage>,
  'admin-empty': () => <PageStage><AdminAsync isEmpty empty={{ icon: Search, title: 'No rows yet', body: 'Nothing has been recorded for this window.' }} /></PageStage>,
  'chart-placeholder': () => <PageStage><ChartPlaceholder sub="Come back once a few more days have landed." /></PageStage>,

  // Mobile
  'sheet-full': ({ close }) => <Sheet open onClose={close} title="Card options" snap="full"><SheetFiller /></Sheet>,
  'sheet-half': ({ close }) => <Sheet open onClose={close} title="Card options" snap="half"><SheetFiller /></Sheet>,
  'mobile-drawer': ({ close }) => <MobileDrawer open onClose={close}><SheetFiller /></MobileDrawer>,
  'mobile-bottom-nav': () => (
    <MobileBottomNav
      tabs={[
        { key: 'home', label: 'Home', icon: <Home size={18} /> },
        { key: 'search', label: 'Search', icon: <Search size={18} /> },
        { key: 'images', label: 'Images', icon: <ImageIcon size={18} />, badge: 3 },
      ]}
      active="home" onChange={NOOP} showCreate createIcon={<Plus size={20} />} onCreate={NOOP} />
  ),
};

// ── Stages ─────────────────────────────────────────────────────────────────
// Thin frames for surfaces that normally sit inside something else. They supply
// position and a readable background, never the surface's own markup.

function PillStage({ children }) {
  return <div className="gal-stage-pill">{children}</div>;
}
function PageStage({ children }) {
  return <div className="gal-stage-page">{children}</div>;
}
function BillingStage({ children }) {
  return <div className="gal-stage-page"><div className="settings-section" style={{ maxWidth: 560 }}>{children}</div></div>;
}
function SheetFiller() {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 10 }}>
      <p className="t-meta">Whatever the caller puts inside. Sheet and MobileDrawer own the frame, the snap points and the gestures; the content is arbitrary.</p>
      <button type="button" className="settings-btn">An action</button>
      <button type="button" className="settings-btn">Another action</button>
    </div>
  );
}

// A real File, built in the browser, for the surfaces that take one.
function pngFile() {
  const bin = atob(IMG.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], 'reference.png', { type: 'image/png' });
}

// ReturnReasonAsk opens only on a window event, past a quiet-DOM check, and
// holds a per-device one-shot. Driving it through its real door is the only way
// to see it; the later states are then reached by clicking, which is also how
// the user reaches them.
function ReturnAskStage({ pick = false, send = false }) {
  return (
    <div className="gal-stage-page" ref={(el) => {
      if (!el) return;
      nudge('soleil:returned', {}, Object.keys(localStorage).filter((k) => k.startsWith('soleil.returnask')));
      if (!pick) return;
      // Walk it forward the way a person would, once it has painted.
      setTimeout(() => {
        el.querySelector('.rr-chip, .rr-choice, button[data-rr-choice]')?.click();
        if (send) setTimeout(() => el.querySelector('.rr-send, button[type="submit"]')?.click(), 120);
      }, 260);
    }}>
      <ReturnReasonAsk />
    </div>
  );
}

function ReferralStage() {
  return (
    <div className="gal-stage-page" ref={(el) => { if (el) nudge('soleil:collab-nudge', { boardId: BOARD.id }); }}>
      <ReferralNudge tier="demo" onCollaborate={NOOP} />
    </div>
  );
}

// The boundaries reach their error state no other way: they render children and
// catch what those children throw. That is the honest preview — the same code
// path a real crash takes, including whatever it reports on the way.
function BoundaryStage({ kind }) {
  const Boundary = kind === 'app' ? AppErrorBoundary : SurfaceErrorBoundary;
  return <div className="gal-stage-page"><Boundary><Thrower /></Boundary></div>;
}

// SettingsPanel is the real panel, opened on one tab. It fetches the admin's own
// settings, which is a read and correct; nothing here writes.
function SettingsStage({ tab, close }) {
  return (
    <SettingsPanel
      open onClose={close}
      user={USER}
      workspaceId={WORKSPACE.id}
      workspaceName={WORKSPACE.name}
      role="owner"
      isAdmin
      initialTab={tab}
      refresh={NOOP}
      onSaved={NOOP}
      onSignOut={NOOP}
      onWorkspacesChanged={NOOP}
      onOpenRecovery={NOOP}
      workspaceSettings={{}}
      mySettings={{}} />
  );
}
