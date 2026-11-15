import { useContext, useSyncExternalStore } from 'react';
import {
  discardHeld, heldEntries, heldSnapshot, markAllReady, restoreHeld, subscribeHeld,
} from '../lib/heldUploads.js';
import { storageAmountLabel } from '../lib/billingCopyWords.js';
import { sizeLabel } from '../lib/importCopy.js';
import { Icon } from './Icon.jsx';
import { ChevronDown, Clock } from '../lib/icons.js';
import { ActivityTrayContext } from './activityTrayContext.js';
import { Thumb } from './activityThumb.jsx';
import { Rich } from './ImportTray.jsx';
import { rich } from '../lib/richParts.js';
import './importTray.css';
// The bar is drawn inside the activity tray, whose chunk brings activityTray.css.
import './heldUploadsBar.css';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

// HeldUploadsBar — the files a drop could not place, kept in this tab until
// there is room (lib/heldUploads.js), and what they are waiting for. The
// activity tray's held panel (ActivityTray.jsx): the tray's chip speaks for it
// while folded, and it draws nothing then.
//
// Three states, from the store alone:
//   waiting  "3 files · 6.4GB are waiting for room": Upload now (try again —
//            the person made room by deleting, or wants to see the question
//            again) and Discard;
//   paying   a checkout or a bank's confirmation page is open for them, so
//            they will go as soon as it lands — Upload now stays, for a
//            checkout given up on;
//   ready    released, but the cluster they belong to is not open here, so
//            nothing can claim them until it is: Open names it.
//
// Discard is undoable, like every other letting-go in the app: the files are
// still on the person's disk, but they would have to find and drop them again.
// Neutral ink throughout; gold is for active, selection and focus states.
const ROW_CAP = 50;

export function HeldUploadsBar({ openBoardIds = [], boardName = null, onOpenBoard = null, toast = null }) {
  const { entries: held, awaiting } = useSyncExternalStore(subscribeHeld, heldSnapshot, heldSnapshot);
  const tray = useContext(ActivityTrayContext);
  // A bulk import's hold is the import tray's to show (lib/importStart.js):
  // it only keeps a checkout in another tab while the import waits in this one.
  const entries = held.filter((e) => e.via !== 'import');
  if (!entries.length || tray?.folded) return null;

  const count = entries.reduce((n, e) => n + e.count, 0);
  const bytes = entries.reduce((n, e) => n + e.bytes, 0);
  const size = bytes > 0 ? storageAmountLabel(bytes) : '';
  const open = new Set(openBoardIds.filter(Boolean));
  const elsewhere = entries.find((e) => !open.has(e.boardId)) || null;
  const allReady = entries.every((e) => e.ready);
  const paying = !allReady && awaiting;
  const name = elsewhere ? (boardName?.(elsewhere.boardId) || tr`its cluster`) : null;
  const title = allReady ? tr`Ready to upload` : tr`Waiting for room`;

  // Whole sentences per state, size or not: the bold run is marked with ** and
  // split by rich().
  let line;
  if (allReady && elsewhere) {
    line = rich(size
      ? plural(count, { one: `**# file · ${size}** ready to upload to ${name}`, other: `**# files · ${size}** ready to upload to ${name}` })
      : plural(count, { one: `**# file** ready to upload to ${name}`, other: `**# files** ready to upload to ${name}` }));
  } else if (paying) {
    line = rich(size
      ? plural(count, { one: `**# file · ${size}** will upload as soon as your payment goes through`, other: `**# files · ${size}** will upload as soon as your payment goes through` })
      : plural(count, { one: `**# file** will upload as soon as your payment goes through`, other: `**# files** will upload as soon as your payment goes through` }));
  } else {
    line = rich(size
      ? plural(count, { one: `**# file · ${size}** is waiting for room — keep this tab open`, other: `**# files · ${size}** are waiting for room — keep this tab open` })
      : plural(count, { one: `**# file** is waiting for room — keep this tab open`, other: `**# files** are waiting for room — keep this tab open` }));
  }

  // One row per file; a folder is one row.
  const rows = [];
  for (const e of entries) {
    if (e.folder) {
      rows.push({ key: e.id, name: e.folder.name || tr`Folder`, type: '', c: tr`${plural(e.count, { one: '# file', other: '# files' })} · ${ph({ size: sizeLabel(e.bytes) })}` });
      continue;
    }
    e.files.forEach((f, i) => rows.push({ key: `${e.id}:${i}`, name: f?.name || tr`File`, type: f?.type || '', c: sizeLabel(f?.size || 0) }));
  }
  const more = rows.length - ROW_CAP;
  const t = tray?.phone || tray?.touch ? ' is-touch' : '';

  const onDiscard = () => {
    const gone = heldEntries().filter((e) => e.via !== 'import');
    discardHeld(gone.map((e) => e.id));
    toast?.({
      type: 'info',
      message: size
        ? plural(count, { one: `Let go of # file · ${size}. It's still on your computer.`, other: `Let go of # files · ${size}. They're still on your computer.` })
        : plural(count, { one: `Let go of # file. It's still on your computer.`, other: `Let go of # files. They're still on your computer.` }),
      ttl: 8000,
      action: { label: tr`Undo`, onClick: () => restoreHeld(gone) },
    });
  };

  return (
    <section className="imptray atr is-static" aria-label={title}>
      <header className="imptray-head">
        <span className="atr-hic" aria-hidden="true"><Icon as={Clock} size={15} weight="regular" /></span>
        <span className="imptray-title">{title}</span>
        {tray && (
          <button type="button" className="imptray-ib" aria-label={tr`Fold`} onClick={tray.fold}>
            <Icon as={ChevronDown} size={14} weight="regular" />
          </button>
        )}
      </header>
      <div className="imptray-sum">
        <div className="imptray-line" role="status" aria-live="polite"><Rich parts={line} /></div>
        {!allReady && !paying && <div className="imptray-meta"><Trans>Upload now tries again, or shows the ways to make room</Trans></div>}
      </div>
      <div className="imptray-list atr-list">
        {rows.slice(0, ROW_CAP).map((r) => (
          <div key={r.key} className={'atr-row is-later' + t}>
            <Thumb mime={r.type} name={r.name} />
            <span className="n" title={r.name}>{r.name}</span>
            <span className="c">{r.c}</span>
          </div>
        ))}
        {more > 0 && <div className={'atr-row is-later' + t}><span className="n">{tr`${more} more`}</span></div>}
      </div>
      <footer className="imptray-foot">
        <span className="imptray-gap" />
        <button type="button" className="imptray-btn is-sm is-quiet" onClick={onDiscard}><Trans>Discard</Trans></button>
        {/* Even while paying: a checkout given up on without its cancel link
            must not leave the files with nothing to press. */}
        {!allReady && (
          <button type="button" className="imptray-btn is-sm is-default" onClick={() => markAllReady()}><Trans>Upload now</Trans></button>
        )}
        {elsewhere && onOpenBoard && (
          <button type="button" className="imptray-btn is-sm is-default held-uploads-open" onClick={() => onOpenBoard(elsewhere.boardId)}>
            <Trans>Open {name}</Trans>
          </button>
        )}
      </footer>
    </section>
  );
}
