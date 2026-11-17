import { Icon } from './Icon.jsx';
import { R2Image } from './R2Image.jsx';
import { EyeOff, FilePdf, FileIcon, FileText, Link as LinkIcon, LayoutGrid, StickyNote, Palette, FilmStrip, Waveform, Image as ImageIcon } from '../lib/icons.js';
import { useEntityNavigate } from '../hooks/useEntityNavigate.js';
import { storageKey, kindWord, unitMeta, isNoteKind } from '../lib/messageThing.js';
import { useReadableBoards } from '../hooks/useReadableBoards.js';
import { t, ph, plural } from '@lingui/core/macro';
import './messageSharedCard.css';

// A card or a cluster someone sent, as a preview card: its picture or words on
// top, its name and where it lives underneath, and Open. Sent and received
// look the same; the side follows the bubble. Built to the picked look B
// (mockups/b-preview-card.html). `unit` is one of lib/messageThing.js
// sharedUnits(): a cluster, or a run of cards from one cluster.

const SHOWN_IN_STRIP = 3;

// A colour we are willing to put in a style attribute.
const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

// Snapshot keys come from another person's message: only a bare storage key is
// drawn, and only as r2:<key>.
const r2 = (k) => { const s = storageKey(k); return s ? `r2:${s}` : null; };

const KINDS_WITH_PICTURE = new Set(['image', 'video', 'pdf', 'link']);

export function MessageSharedCard({ unit, onDragStart }) {
  const navigate = useEntityNavigate();
  const isReadable = useReadableBoards([unit.boardId]);
  const readable = !unit.boardId || isReadable(unit.boardId);

  const cluster = unit.type === 'cluster';
  const cards = cluster ? [] : unit.cards;
  const first = cluster ? unit.att : cards[0];
  const snap = (cluster ? unit.att.snap : cards[0]?.snap) || {};
  const several = !cluster && cards.length > 1;
  const kind = cluster ? 'cluster' : (snap.k || 'card');

  const title = cluster
    ? String(first.title || '').trim() || t`Cluster`
    : several
      ? String(first.title || '').trim() || t`${plural(cards.length, { one: '# card', other: '# cards' })}`
      : String(first.title || snap.heading || '').trim() || kindWord(kind);

  // Words that stay readable without access: a note, a palette, a link.
  const stays = !cluster && !several && (isNoteKind(kind) || kind === 'palette' || kind === 'link');
  const lockedPanel = !readable && !stays;

  const open = () => {
    if (!readable) return;
    if (cluster) navigate({ kind: 'board', id: unit.boardId });
    else navigate({ kind: 'card', boardId: unit.boardId, cardId: cards[0].cardId }, { cardIds: cards.map((c) => c.cardId).filter(Boolean) });
  };

  const meta = !readable
    ? t`You can't open ${ph({ name: unitBoardName(unit, title) })}.`
    : unitMeta({ cluster, several, count: cards.length, kind, snap, boardTitle: unit.boardTitle || first.boardTitle || '' });

  const cover = readable ? r2(snap.cover) : null;

  return (
    <div className={`msg-sc${readable ? ' is-open' : ' is-locked'}`}
         draggable={!!onDragStart}
         onDragStart={(e) => onDragStart?.(e, first)}
         onClick={readable ? (e) => { if (!e.target.closest?.('button')) open(); } : undefined}>
      {lockedPanel ? (
        <div className="msg-sc-lock">
          <Icon as={EyeOff} size={22} weight="regular" />
          <span dir="auto">{t`You can't open ${ph({ name: unitBoardName(unit, title) })}.`}</span>
        </div>
      ) : (
        <Media unit={unit} kind={kind} snap={snap} cards={cards} several={several} />
      )}
      <div className="msg-sc-ft">
        <div className="msg-sc-tx">
          <div className="msg-sc-t1" dir="auto">{title}</div>
          {!lockedPanel && (
            <div className="msg-sc-t2">
              {cover && <span className="msg-sc-cv" aria-hidden="true"><R2Image src={cover} alt="" /></span>}
              <span className="msg-sc-t2-text" dir="auto">{meta}</span>
            </div>
          )}
        </div>
        {readable && (
          <button type="button" className="msg-sc-open" aria-label={t`Open ${ph({ name: title })}`} onClick={open}>
            {t`Open`}
          </button>
        )}
      </div>
    </div>
  );
}

// A locked card names the cluster it can't open when it knows its name, else
// the thing it carried.
function unitBoardName(unit, fallback) {
  if (unit.type === 'cluster') return fallback;
  return unit.boardTitle || unit.cards[0]?.boardTitle || fallback;
}

function Media({ unit, kind, snap, cards, several }) {
  if (unit.type === 'cluster') return <Mosaic snap={snap} />;
  if (several) return <Strip cards={cards} />;
  if (isNoteKind(kind)) {
    const heading = String(snap.heading || '').trim();
    return (
      <div className="msg-sc-md is-note">
        {heading && <h4 dir="auto">{heading}</h4>}
        <p dir="auto">{String(snap.text || '')}</p>
      </div>
    );
  }
  if (kind === 'palette') {
    const sw = (Array.isArray(snap.swatches) ? snap.swatches : []).map((s) => safeColor(typeof s === 'string' ? s : (s?.hex || s?.color))).filter(Boolean);
    if (sw.length) return <div className="msg-sc-md is-pal">{sw.map((c, i) => <i key={i} style={{ background: c }} />)}</div>;
    return <Panel icon={Palette} />;
  }
  const pic = r2(snap.key);
  if (kind === 'link') return pic ? <Pic src={pic} /> : null;
  if (KINDS_WITH_PICTURE.has(kind) && pic) return <Pic src={pic} />;
  return <Panel icon={kindIcon(kind, snap)} />;
}

function kindIcon(kind, snap) {
  if (kind === 'image') return ImageIcon;
  if (kind === 'video') return FilmStrip;
  if (kind === 'audio') return Waveform;
  if (kind === 'doc') return FileText;
  if (kind === 'pdf' || /pdf/i.test(snap?.mime || snap?.name || '')) return FilePdf;
  if (kind === 'file') return FileIcon;
  if (kind === 'link') return LinkIcon;
  return StickyNote;
}

function Pic({ src }) {
  return <div className="msg-sc-md is-pic"><R2Image src={src} alt="" /></div>;
}

function Panel({ icon }) {
  return <div className="msg-sc-md is-panel"><Icon as={icon} size={28} weight="regular" /></div>;
}

// 1 / 1+1 / 1+2 / 2x2 picture keys, and the cluster's size in a pill.
function Mosaic({ snap }) {
  const keys = (Array.isArray(snap.keys) ? snap.keys : []).map(r2).filter(Boolean).slice(0, 4);
  const count = Number(snap.count) || 0;
  return (
    <div className={`msg-sc-md is-mosaic${keys.length ? ` has-${keys.length}` : ''}`}>
      {keys.length
        ? keys.map((k, i) => <span key={i} className="msg-sc-tile"><R2Image src={k} alt="" /></span>)
        : <span className="msg-sc-panel-icon"><Icon as={LayoutGrid} size={28} weight="regular" /></span>}
      {count > 0 && <span className="msg-sc-n">{t`${plural(count, { one: '# card', other: '# cards' })}`}</span>}
    </div>
  );
}

// Several cards: a three-up strip, "+N" on the last when there are more.
function Strip({ cards }) {
  const shown = cards.slice(0, SHOWN_IN_STRIP);
  const more = cards.length - SHOWN_IN_STRIP;
  return (
    <div className="msg-sc-md is-strip">
      {shown.map((c, i) => {
        const s = c.snap || {};
        const k = s.k || 'card';
        const pic = KINDS_WITH_PICTURE.has(k) ? r2(s.key) : null;
        const pal = k === 'palette' ? safeColor(typeof s.swatches?.[0] === 'string' ? s.swatches[0] : (s.swatches?.[0]?.hex || s.swatches?.[0]?.color)) : null;
        return (
          <span key={c.cardId || i} className="msg-sc-tile">
            {pic
              ? <R2Image src={pic} alt="" />
              : <span className="msg-sc-tile-kind" style={pal ? { background: pal } : undefined}>
                  {!pal && <Icon as={kindIcon(k, s)} size={20} weight="regular" />}
                </span>}
            {i === shown.length - 1 && more > 0 && <span className="msg-sc-n">+{more}</span>}
          </span>
        );
      })}
    </div>
  );
}
