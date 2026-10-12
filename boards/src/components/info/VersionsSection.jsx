// Info's Versions: every version of a file, newest first — who uploaded it,
// when, its size and label — and what you can do with each. The one on show
// is marked; Make current swaps it in; Delete keeps it for a month under
// Recently deleted; Upload new version adds one (so does dropping a file onto
// the card). All the logic is lib/cardVersions.js; this lays it out.
import { useState } from 'react';
import { liveVersions, versionsOf, currentOf, versionLabel, DELETED_KEEP_DAYS } from '../../lib/cardVersions.js';
import { formatSize, formatWhen } from '../../lib/cardInfo.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { Icon } from '../Icon.jsx';
import { Upload, Download, MoreHorizontal } from '../../lib/icons.js';
import { CardContextMenu } from '../CardContextMenu.jsx';

export function VersionsSection({
  card, canEdit = false, personName = (id) => id, getMeta = null,
  onUpload, onMakeCurrent, onDelete, onRestore, onLabel, onDownload, onOpen,
}) {
  const [menu, setMenu] = useState(null);       // { x, y, v }
  const [showDeleted, setShowDeleted] = useState(false);
  const live = liveVersions(card);
  const deleted = versionsOf(card).filter((v) => v.del);
  const cur = currentOf(card);
  if (!live.length) return null;

  const size = (v) => {
    if (Number.isFinite(v.sizeBytes)) return formatSize(v.sizeBytes);
    const f = v.src || v.fileSrc || v.pdfSrc;
    const m = f && getMeta ? getMeta(String(f).replace(/^r2:/, '')) : null;
    return Number.isFinite(m?.sizeBytes) ? formatSize(m.sizeBytes) : '';
  };
  const uploadedBy = (v) => {
    const f = v.src || v.fileSrc || v.pdfSrc;
    const m = f && getMeta ? getMeta(String(f).replace(/^r2:/, '')) : null;
    return { by: v.by || m?.uploadedBy || null, at: v.at || m?.uploadedAt || null };
  };

  const row = (v, { isDeleted = false } = {}) => {
    const isCur = !isDeleted && v.id === cur?.id;
    const who = uploadedBy(v);
    const name = personName(who.by);
    const when = formatWhen(who.at);
    return (
      <li key={v.id} className={`cbd-ver${isCur ? ' is-current' : ''}${isDeleted ? ' is-deleted' : ''}`} data-version-id={v.id}>
        <button type="button" className="cbd-ver-main" onClick={() => onOpen?.(v)} disabled={!onOpen || isDeleted}
                title={onOpen && !isDeleted ? 'Look at this version' : undefined}>
          <span className="cbd-ver-n">{versionLabel(v)}</span>
          <span className="cbd-ver-text">
            <span className="cbd-ver-name">{v.label || v.fileName || v.name || versionLabel(v)}{isCur && <span className="cbd-ver-cur">Current</span>}</span>
            <span className="cbd-ver-meta" title={when || undefined}>
              {[name, when ? relativeTimeShort(who.at) : '', size(v)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        {isDeleted ? (
          canEdit && <button type="button" className="cbd-ver-act" onClick={() => onRestore?.(v)}>Restore</button>
        ) : (
          <button type="button" className="cbd-ver-more" aria-label={`More for ${versionLabel(v)}`}
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 4, y: r.bottom + 2, v }); }}>
            <Icon as={MoreHorizontal} size={16} />
          </button>
        )}
      </li>
    );
  };

  const menuItems = (v) => [
    canEdit && v.id !== cur?.id && { id: 'cur', label: 'Make current', run: () => onMakeCurrent?.(v) },
    onOpen && { id: 'open', label: 'Look at it', run: () => onOpen(v) },
    onDownload && { id: 'dl', label: 'Download', run: () => onDownload(v) },
    canEdit && onLabel && { id: 'label', label: v.label ? 'Rename label…' : 'Add a label…', run: () => onLabel(v) },
    canEdit && live.length > 1 && { divider: true },
    canEdit && live.length > 1 && { id: 'del', label: 'Delete version', danger: true, run: () => onDelete?.(v) },
  ].filter(Boolean);

  return (
    <section className="cbd-section cbd-versions" aria-label="Versions">
      <div className="cbd-section-head">
        <h3 className="cbd-section-label">Versions <span className="cbd-count">{live.length}</span></h3>
        {canEdit && onUpload && (
          <button type="button" className="cbd-mini" onClick={onUpload} title="Upload a new version of this file">
            <Icon as={Upload} size={14} /><span>New version</span>
          </button>
        )}
      </div>
      <ol className="cbd-ver-list">{[...live].reverse().map((v) => row(v))}</ol>
      {deleted.length > 0 && (
        <div className="cbd-ver-deleted">
          <button type="button" className="cbd-linkbtn" onClick={() => setShowDeleted((s) => !s)} aria-expanded={showDeleted}>
            Recently deleted ({deleted.length})
          </button>
          {showDeleted && (
            <>
              <p className="cbd-hint">Kept for {DELETED_KEEP_DAYS} days, then gone for good.</p>
              <ol className="cbd-ver-list">{[...deleted].reverse().map((v) => row(v, { isDeleted: true }))}</ol>
            </>
          )}
        </div>
      )}
      {menu && (
        <CardContextMenu open x={menu.x} y={menu.y} items={menuItems(menu.v)} onClose={() => setMenu(null)} card={null} />
      )}
    </section>
  );
}
