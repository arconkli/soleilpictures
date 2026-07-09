// Right-side detail popout for the cluster browser. Click an item → this panel
// shows a large preview + metadata (type / size / dimensions / dates / location)
// and the actions Open-on-canvas · Download · Copy link · Delete. A grid FAMILY
// (group node) shows a family overview + a jumpable member list. Inline
// <aside> in the split layout (modeled on EntityBacklinksPanel's frosted panel).
import { useEffect } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { useFeedback } from '../AppFeedback.jsx';
import { Icon } from '../Icon.jsx';
import { X, Download, Trash2 as TrashIcon, Maximize2, Link as LinkIcon } from '../../lib/icons.js';
import { humanSize } from '../cards/FileCard.jsx';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { getMeta } from '../../lib/imageMeta.js';
import { resolveSrc } from '../../lib/r2.js';
import { downloadImage } from '../../lib/imageExport.js';

const DOWNLOADABLE = new Set(['image', 'pdf', 'video', 'audio', 'file']);

function MetaRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="cbd-meta-row">
      <span className="cbd-meta-k">{label}</span>
      <span className="cbd-meta-v" title={typeof value === 'string' ? value : undefined}>{value}</span>
    </div>
  );
}

async function downloadCard(card, kind, name) {
  try {
    if (kind === 'image' && card.src) { await downloadImage({ src: card.src, title: name, adjust: card.adjust }); return; }
    const src = card.fileSrc || card.src || card.pdfSrc || card.poster;
    if (!src) return;
    const url = await resolveSrc(src);
    if (!url) return;
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = name || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
  } catch (_) { /* best-effort */ }
}

export function DetailPanel({ target, boards = {}, canEdit = true, onClose, onReveal, onDelete }) {
  const feedback = useFeedback();

  // Esc closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!target) return null;

  const copyLink = async (cardId, boardId) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('board', boardId || '');
      url.searchParams.set('card', cardId);
      await navigator.clipboard.writeText(`${url.origin}${url.pathname}?${url.searchParams.toString()}`);
      feedback?.toast?.({ type: 'success', message: 'Link copied' });
    } catch (_) { feedback?.toast?.({ type: 'error', message: 'Could not copy link' }); }
  };

  // ── Grid family view ────────────────────────────────────────────────────────
  if (target.type === 'group') {
    const g = target.group;
    return (
      <aside className="cb-detail surface-frosted">
        <div className="cbd-head">
          <span className="cbd-title" title={g.name}>{g.name}</span>
          <button className="cbd-close" onClick={onClose} aria-label="Close"><Icon as={X} size={16} /></button>
        </div>
        <div className="cbd-body">
          <div className="cbd-preview"><CardPreview item={g} size="tile" /></div>
          <MetaRow label="Type" value="Grid family" />
          <MetaRow label="Grids" value={`${g.count}`} />
          <div className="cbd-members">
            <div className="cbd-members-label">Grids in this family</div>
            {g.members.map((m, i) => (
              <button key={m.id} className="cbd-member" onClick={() => onReveal?.(m.id)} title={m.name}>
                <span className="cbd-member-thumb"><CardPreview item={m} size="row" /></span>
                <span className="cbd-member-name">{m.name || `Grid ${i + 1}`}</span>
                <span className="cbd-member-open"><Icon as={Maximize2} size={13} /></span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  // ── Single card view ────────────────────────────────────────────────────────
  const item = target.item;
  const card = item.card || {};
  const key = String(card.src || card.poster || card.pdfSrc || '').replace(/^r2:/, '');
  const meta = key ? getMeta(key) : null;
  const dims = meta && meta.w && meta.h ? `${meta.w} × ${meta.h}` : null;
  const downloadable = DOWNLOADABLE.has(item.kind);
  const location = boards[item.boardId]?.name || null;

  return (
    <aside className="cb-detail surface-frosted">
      <div className="cbd-head">
        <span className="cbd-title" title={item.name}>{item.name}</span>
        <button className="cbd-close" onClick={onClose} aria-label="Close"><Icon as={X} size={16} /></button>
      </div>
      <div className="cbd-body">
        <div className="cbd-preview"><CardPreview item={item} size="tile" /></div>
        <MetaRow label="Type" value={item.typeLabel} />
        <MetaRow label="Size" value={item.sizeBytes != null ? humanSize(item.sizeBytes) : null} />
        <MetaRow label="Dimensions" value={dims} />
        {item.kind === 'pdf' && <MetaRow label="Pages" value={item.sub} />}
        <MetaRow label="Modified" value={item.updatedAt ? relativeTimeShort(item.updatedAt) : null} />
        <MetaRow label="Added" value={item.createdAt ? relativeTimeShort(item.createdAt) : null} />
        <MetaRow label="Location" value={location} />
      </div>
      <div className="cbd-actions">
        <button className="cbd-act" onClick={() => onReveal?.(item.id)}>
          <Icon as={Maximize2} size={15} /><span>Open on canvas</span>
        </button>
        {downloadable && (
          <button className="cbd-act" onClick={() => downloadCard(card, item.kind, card.fileName || card.name || item.name)}>
            <Icon as={Download} size={15} /><span>Download</span>
          </button>
        )}
        <button className="cbd-act" onClick={() => copyLink(item.id, item.boardId)}>
          <Icon as={LinkIcon} size={15} /><span>Copy link</span>
        </button>
        {canEdit && (
          <button className="cbd-act cbd-act-danger" onClick={() => onDelete?.([item.id])}>
            <Icon as={TrashIcon} size={15} /><span>Delete</span>
          </button>
        )}
      </div>
    </aside>
  );
}
