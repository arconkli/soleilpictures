import { useRef } from 'react';
import { Modal } from './Modal.jsx';
import { rejectedNoun } from '../lib/demoCardCap.js';
import { rich } from '../lib/richParts.js';
import { CREATOR_TRIAL_DAYS, PLAN_NAME } from '../lib/billingCopy.js';
import { CTA, storageAmountLabel, creatorStorageLabel, addonBlockLabel } from '../lib/billingCopyWords.js';
import './importCapDialog.css';
import { t, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// The over-cap folder drop, asked BEFORE anything uploads.
//
// This dialog exists because of a measured trace: someone signs up, drops a
// folder of a hundred-odd photographs minutes later, and ends up holding a
// fraction of it. The canvas drop path had no cap check at all, so the whole
// folder rendered and uploaded and was then withdrawn by the server trigger.
// The upgrade ask arrived attached to a data-loss event, which is the worst
// possible moment to make it — the pricing modal was seen once, at the wall,
// and never looked at again.
//
// So: no card is created, no byte is uploaded, and nothing is destroyed until
// this is answered. The stake named on screen is the user's OWN folder, which
// is the most concrete thing this product will ever have to sell against.
//
// Both actions are real and both are safe. "Add the first N" is not a
// consolation prize — it is the cards they are entitled to, which is precisely
// what the old path threw away along with the overflow. Cancelling keeps the
// folder on their disk and the cluster as it was.
//
// The count is stated, never estimated: `take` and `over` come from
// planImport() (importPreflight.js), which is the same evaluateDemoCap
// arithmetic the server trigger enforces.

// `trialOffer`: this person is owed the Creator trial (decided by the caller on
// the server's count, like every other trial surface). The dialog was the one
// place an eligible person met the limit and was never told the first two
// weeks are free — the only purchase intent the product has ever recorded was
// a press of this button, and it read "Upgrade".
// `folder` ({ files, clusters }): the drop was a folder. Then `n` and `take` are
// counted in CARDS — every file is one, and so is every cluster it becomes —
// so the copy names the folder's files and clusters rather than calling the
// total "photos", and the partial button adds what fits rather than "the first
// N", since a folder is cut down whole folders first (lib/folderPlan slicePlan).
// `limitKind` 'storage' (0413): the DRIVE is what this drop overflows, not the
// card cap. `bytesNeeded` is what the drop weighs and `bytesLeft` what the
// drive has room for; `take` is then how many files fit, in drop order.
// `canUpgrade` is false where buying would not help — a paying owner whose
// drive is full, or someone dropping into another person's cluster.
// `onAddStorage` (0415): for a paying owner whose drive is what overflows, the
// way to extra storage. Null hides it — anyone else, or while it is held.
// `holds`: whatever this answer leaves out waits in the tab and uploads once
// there is room (lib/heldUploads.js) — true on the person's own plan, so the
// note can say they will not have to drop the files again.
// A rich line (strings and { b } runs) drawn with <strong>, the dialog's own bold.
const Strong = ({ parts }) => parts.map((p, i) => (typeof p === 'string' ? p : <strong key={i}>{p.b}</strong>));

export function ImportCapDialog({ open, n, take, over, count, limit, kinds, folder = null, trialOffer = false,
  limitKind = 'cards', bytesNeeded = null, bytesLeft = null, canUpgrade = true, onAddStorage = null, holds = false,
  onTakePartial, onUpgrade, onCancel }) {
  const primaryRef = useRef(null);
  if (!open) return null;
  const CREATOR_STORAGE_LABEL = creatorStorageLabel();
  const STORAGE_ADDON_BLOCK_LABEL = addonBlockLabel();

  // Name the actual thing. A user who just dropped a folder of photographs and
  // is told "cards" has to translate; rejectedNoun already owns this decision
  // and already falls back to the neutral noun for a mixed batch. Asked with 2
  // only to learn which noun it picked: the words themselves are whole
  // messages below, one per noun, so a language can inflect each.
  const photos = rejectedNoun(kinds, 2) === 'photos';
  const storage = limitKind === 'storage';
  const weighs = storageAmountLabel(bytesNeeded);
  const showWeighs = storage && !!weighs;
  const left = storageAmountLabel(bytesLeft) || t`no room`;
  // What releases a held drop by itself is the plan or the drive growing
  // (lib/heldUploads readyFor), never a delete: room made that way is the
  // bar's Upload now. A folder cut down to what fits is not held at all (App
  // importFolderOnce): only the whole of one waits. One whole message per
  // variant, never the clause stitched into the sentence.
  const goes = canUpgrade ? 'upgrade' : onAddStorage ? 'storage' : 'room';
  const waits = !holds ? ''
    : folder && take > 0
      ? (goes === 'upgrade'
        ? t`Add what fits and the rest stays on your computer. Otherwise, unless you cancel, the folder waits in this tab and goes on by itself when you upgrade — no dropping it again.`
        : goes === 'storage'
          ? t`Add what fits and the rest stays on your computer. Otherwise, unless you cancel, the folder waits in this tab and goes on by itself when you add ${STORAGE_ADDON_BLOCK_LABEL} — no dropping it again.`
          : t`Add what fits and the rest stays on your computer. Otherwise, unless you cancel, the folder waits in this tab and goes on when you make room and press Upload now.`)
      : (goes === 'upgrade'
        ? t`Unless you cancel, whatever doesn’t go on now waits in this tab and goes on by itself when you upgrade — no dropping it again.`
        : goes === 'storage'
          ? t`Unless you cancel, whatever doesn’t go on now waits in this tab and goes on by itself when you add ${STORAGE_ADDON_BLOCK_LABEL} — no dropping it again.`
          : t`Unless you cancel, whatever doesn’t go on now waits in this tab and goes on when you make room and press Upload now.`);

  // The title: whole sentences, with the drive's size or without.
  let title;
  if (folder) {
    title = showWeighs
      ? t`You dropped ${plural(folder.files, { one: '# file', other: '# files' })} in ${plural(folder.clusters, { one: '# folder', other: '# folders' })} (${weighs}).`
      : t`You dropped ${plural(folder.files, { one: '# file', other: '# files' })} in ${plural(folder.clusters, { one: '# folder', other: '# folders' })}.`;
  } else if (photos) {
    title = showWeighs
      ? plural(n, { one: `You dropped # photo (${weighs}).`, other: `You dropped # photos (${weighs}).` })
      : plural(n, { one: 'You dropped # photo.', other: 'You dropped # photos.' });
  } else {
    title = showWeighs
      ? plural(n, { one: `You dropped # card (${weighs}).`, other: `You dropped # cards (${weighs}).` })
      : plural(n, { one: 'You dropped # card.', other: 'You dropped # cards.' });
  }
  const addFirst = photos
    ? plural(take, { one: 'Add the first # photo', other: 'Add the first # photos' })
    : plural(take, { one: 'Add the first # card', other: 'Add the first # cards' });

  // The lede: whole sentences too.
  let lede;
  if (storage) {
    if (take > 0) {
      lede = canUpgrade
        ? t`Your free storage has **${left}** left — enough for the first **${take}**.`
        : t`This drive has **${left}** left — enough for the first **${take}**.`;
    } else {
      lede = canUpgrade ? t`Your free storage has **${left}** left.` : t`This drive has **${left}** left.`;
    }
  } else {
    lede = plural(limit, {
      one: `This free cluster holds **${take}** more — you’re at ${count} of # card.`,
      other: `This free cluster holds **${take}** more — you’re at ${count} of # cards.`,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      className="impcap"
      backdropClassName="impcap-back"
      labelledBy="impcap-title"
      initialFocusRef={primaryRef}
    >
      <div className="impcap-head">
        <div className="impcap-kicker">{storage ? t`Storage limit` : t`Card limit`}</div>
        <div className="impcap-title" id="impcap-title">{title}</div>
      </div>

      <div className="impcap-body">
        <p className="impcap-lede">
          <Strong parts={rich(lede)} />
          {!storage && folder ? ' ' + t`Each file is a card, and so is each folder, which becomes a cluster.` : ''}
        </p>
        {/* The meter is information, not pressure: it shows what the number
            already is rather than dramatising how little is left. Hidden at
            zero, where an empty track reads as a stray divider and says
            nothing the sentence above hasn't already said. */}
        {!storage && count > 0 && (
          <div className="impcap-meter" aria-hidden="true">
            <span className="impcap-meter-fill" style={{ width: `${Math.min(100, Math.round((count / (limit || 1)) * 100))}%` }} />
          </div>
        )}
        <p className="impcap-note">
          {storage
            ? (canUpgrade
              ? (trialOffer
                ? t`Nothing has been uploaded yet. ${PLAN_NAME} gives you ${CREATOR_STORAGE_LABEL}, and it's free for ${CREATOR_TRIAL_DAYS} days.`
                : t`Nothing has been uploaded yet. ${PLAN_NAME} gives you ${CREATOR_STORAGE_LABEL}.`)
              : onAddStorage
                ? (holds
                  ? t`Nothing has been uploaded yet. Add ${STORAGE_ADDON_BLOCK_LABEL} more, or delete files or empty the trash to make room.`
                  : t`Nothing has been uploaded yet. Add ${STORAGE_ADDON_BLOCK_LABEL} more and drop them again, or delete files or empty the trash to make room.`)
                : t`Nothing has been uploaded yet. Deleting files or emptying the trash makes room.`)
            : !canUpgrade
              ? t`Nothing has been uploaded yet. This cluster is on its owner’s plan, so their plan sets the limit.`
              : (trialOffer
                ? t`Nothing has been uploaded yet. Creator removes the limit entirely, and it's free for ${CREATOR_TRIAL_DAYS} days.`
                : t`Nothing has been uploaded yet. Creator removes the limit entirely.`)}
          {waits ? ' ' + waits : ''}
        </p>
      </div>

      <div className="impcap-actions">
        <button type="button" className="impcap-btn" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </button>
        {take > 0 && (
          <button type="button" className="impcap-btn" onClick={onTakePartial}
                  ref={canUpgrade ? undefined : primaryRef}>
            {folder ? t`Add what fits` : addFirst}
          </button>
        )}
        {storage && !canUpgrade && onAddStorage && (
          <button type="button" className="impcap-btn impcap-btn-primary" onClick={onAddStorage}>
            <Trans>Add {STORAGE_ADDON_BLOCK_LABEL}</Trans>
          </button>
        )}
        {canUpgrade && (
          <button
            type="button"
            ref={primaryRef}
            className="impcap-btn impcap-btn-primary"
            onClick={onUpgrade}
          >
            {trialOffer
              ? t`${ph({ tryCreatorShort: CTA.tryCreatorShort })} — keep all ${ph({ value: folder ? folder.files : n })}`
              : t`Upgrade — keep all ${ph({ value: folder ? folder.files : n })}`}
          </button>
        )}
      </div>
    </Modal>
  );
}
