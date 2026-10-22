import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import { R2Image } from './R2Image.jsx';
import { toListItem } from '../lib/listItem.js';
import { getMeta, subscribeMeta, primeImageMeta } from '../lib/imageMeta.js';
import { tileImageSrc } from '../lib/justifiedGrid.js';
import { subscribeImportJobs, importForBoard } from '../lib/importJobs.js';
import { landingCopy } from '../lib/importCopy.js';
import { PUT_ON_BOARD_MAX, layoutForPut } from '../lib/placement.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './unplacedOffer.css';

// An empty board whose cluster has files in Files (lib/placement.js) — after a
// bulk import, the canvas of every folder it made: files land in Files and
// nothing is laid out unless asked (the owner, 2026-10-19; mockup r5-Land-*).
// Up to three of its pictures, what's there and what's still to come, and the
// two ways on: all of them at once, or the ones you choose in Files. Every
// word is importCopy.landingCopy's. Neutral ink: gold is selection's.
//
// Its own component so the import store's ticks re-render this, never the
// canvas: it selects one cluster's entry, which the job keeps steady.

// Where each picture sits in the fan, by how many there are: the first one
// always on top.
const SPOTS = { 1: ['is-mid'], 2: ['is-right is-front', 'is-left'], 3: ['is-mid', 'is-left', 'is-right'] };

// One picture: the smallest stored size that covers it, and nothing at all
// until the stored sizes are known — three thumbnails must never cost three
// originals (the board's metadata is usually still on its way when this
// shows). A stored file with no smaller size falls back to the original.
function OfferPic({ src, spot }) {
  const key = typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : null;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!key) return undefined;
    const off = subscribeMeta(key, () => bump((n) => n + 1));
    if (getMeta(key) == null) primeImageMeta([key]);
    return off;
  }, [key]);
  const meta = key ? getMeta(key) : null;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  return (
    <span className={`cnv-offer-pic ${spot}`}>
      {(key ? meta != null : !!src) && (
        <R2Image src={key ? tileImageSrc(src, meta, 100 * dpr) : src} alt="" className="cbp-img" draggable="false" w={100} h={76} />
      )}
    </span>
  );
}

// cards: the cluster's cards that aren't on the board, in order. onPut(ids,
// layout) places them; onChoose opens Files.
export function UnplacedOffer({ boardId, cards, canPut, onPut, onChoose }) {
  const titleId = useId();
  const from = useSyncExternalStore(subscribeImportJobs, () => importForBoard(boardId), () => null);
  const ready = useMemo(() => cards.filter((c) => !c.pending), [cards]);
  const pics = useMemo(() => {
    const out = [];
    for (const c of ready) {
      const p = toListItem(c)?.preview;
      if (p?.mode === 'r2' && p.src) out.push({ id: c.id, src: p.src });
      if (out.length === 3) break;
    }
    return out;
  }, [ready]);
  const kind = cards.every((c) => c.kind === 'image') ? 'image'
    : cards.every((c) => c.kind === 'video') ? 'video' : null;
  const words = landingCopy({
    total: cards.length, ready: ready.length, kind,
    waiting: from?.waiting || 0, path: from?.path || null, cap: PUT_ON_BOARD_MAX,
  });
  const note = (choice, n) => {
    if (from) logEvent(EV.IMPORT_JOB, { phase: 'landing', choice, board_id: boardId, n_files: cards.length, n, waiting: from.waiting });
  };
  const put = () => {
    const take = ready.slice(0, PUT_ON_BOARD_MAX);
    note('put', take.length);
    onPut(take.map((c) => c.id), layoutForPut(take));
  };
  const choose = () => {
    note('choose', 0);
    onChoose();
  };
  return (
    <section className="cnv-offer" aria-labelledby={titleId}>
      {pics.length > 0 && (
        <div className="cnv-offer-stack" aria-hidden="true">
          {pics.map((it, i) => <OfferPic key={it.id} src={it.src} spot={SPOTS[pics.length][i]} />)}
        </div>
      )}
      <h2 id={titleId} className="cnv-offer-title">{words.title}</h2>
      <p className="cnv-offer-sub">{words.sub}</p>
      <div className="cnv-offer-acts">
        {canPut && words.put && <button type="button" className="cnv-offer-btn" onClick={put}>{words.put}</button>}
        <button type="button" className="cnv-offer-btn is-plain" onClick={choose}>{words.choose}</button>
      </div>
    </section>
  );
}
