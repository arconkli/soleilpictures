// Info. One panel for everything Info can describe — a file or card, a
// cluster, several things at once, a canvas group, a grid family — wherever it
// opens: beside Files (the split layout), beside Quick look (`inline`), and as
// the app-wide drawer that every right-click menu and ⌘I open (`variant=
// "drawer"`, mounted by info/InfoHost.jsx). The rows come from lib/cardInfo.js,
// so what Info says is the same in all three places.
//
//   target  { type: 'card', item }                 item from lib/listItem.toListItem
//           { type: 'group', group }               a grid family (Files)
//           { type: 'cluster', board, cards? }     cards when the cluster is open
//           { type: 'selection', cards }
//           { type: 'canvasGroup', group, members }
import { useEffect, useReducer } from 'react';
import { CardPreview } from './CardPreview.jsx';
import { copyCardLink } from '../../lib/cardLink.js';
import { useFeedback } from '../AppFeedback.jsx';
import { Icon } from '../Icon.jsx';
import { X, Download, ArrowsOutSimple, Link as LinkIcon, BoundingBox } from '../../lib/icons.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { getMeta as getMetaDefault, primeFileFacts, subscribeMeta } from '../../lib/imageMeta.js';
import { DOWNLOADABLE, downloadCardAsset, isPublicSurface } from '../../lib/cardDownload.js';
import * as userProfiles from '../../lib/userProfiles.js';
import { describeCard, describeCluster, describeSelection, describeGroup, fileKeyOf, formatSize, formatWhen } from '../../lib/cardInfo.js';
import { useMediaFacts } from '../../hooks/useMediaFacts.js';
import { VersionsSection } from '../info/VersionsSection.jsx';
import { openPlayer } from '../../lib/playerBus.js';
import { canVersion } from '../../lib/cardVersions.js';
import { pickVersionFile, makeCurrent, deleteVersion, restoreVersion, labelVersion } from '../../lib/versionActions.js';

const FILE_KINDS = new Set(['image', 'video', 'audio', 'pdf', 'file']);

function MetaRow({ label, value, title }) {
  if (!value) return null;
  return (
    <div className="cbd-meta-row">
      <span className="cbd-meta-k">{label}</span>
      <span className="cbd-meta-v" title={title || (typeof value === 'string' ? value : undefined)}>{value}</span>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section className="cbd-section" aria-label={label}>
      <h3 className="cbd-section-label">{label}</h3>
      {children}
    </section>
  );
}

// Names arrive asynchronously (userProfiles batches a lookup); re-render when
// they do.
function useProfiles(ids) {
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => userProfiles.subscribe(tick), []);
  const key = (ids || []).filter(Boolean).join(',');
  useEffect(() => {
    for (const id of key ? key.split(',') : []) userProfiles.resolve(id);
  }, [key]);
}

function personName(id, selfId) {
  if (!id) return null;
  if (selfId && id === selfId) return 'You';
  const e = userProfiles.get(id);
  return e?.name || e?.email || 'A teammate';
}

function PersonRow({ k, by, at, selfId }) {
  const name = personName(by, selfId);
  const abs = formatWhen(at);
  const rel = abs ? relativeTimeShort(at) : '';
  if (!name && !abs) return null;
  return (
    <div className="cbd-meta-row cbd-person">
      <span className="cbd-meta-k">{k}</span>
      <span className="cbd-person-v">
        {name && <span className="cbd-person-name">{name}</span>}
        {abs && <span className="cbd-person-when" title={abs}>{abs}{rel ? ` · ${rel}` : ''}</span>}
      </span>
    </div>
  );
}

function Rows({ details }) {
  return details.map((r) => <MetaRow key={r.k} label={r.k} value={r.v} title={r.title} />);
}

function People({ people, selfId }) {
  people = people.filter((p) => p.by || formatWhen(p.at));
  if (!people.length) return null;
  return (
    <Section label="History">
      {people.map((p) => <PersonRow key={p.k} {...p} selfId={selfId} />)}
    </Section>
  );
}

// Re-render when the images-row facts for this key land (size, uploader).
function useFileMeta(key, getMeta) {
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!key) return undefined;
    const off = subscribeMeta(key, tick);
    if (getMeta === getMetaDefault && !getMeta(key)?.uploadedAt) primeFileFacts([key]);
    return off;
  }, [key, getMeta]);
}

// `inline`: Info beside Quick look, which is already showing the preview.
export function DetailPanel({
  target, boards = {}, canEdit = true, onClose, onReveal, onDelete, inline = false, onPutOnBoard = null,
  variant = 'split', selfId = null, onOpenCluster = null, gridTemplates = {}, getMeta = getMetaDefault,
  writeMeta = null,
  // { mutators, feedback, userId, getCard, ctx } — lib/versionActions.js. Null: Versions is read-only.
  versionEnv = null,
}) {
  const feedback = useFeedback();
  const rawCard = target?.type === 'card' ? (target.item?.card || {}) : null;
  const key = rawCard ? fileKeyOf(rawCard) : '';
  useFileMeta(key, getMeta);
  // A clip uploaded before Info read containers is probed now (lib/mediaProbe.js);
  // an editor's result is kept on the card (writeMeta = mutators.updateCardMeta).
  const media = useMediaFacts(rawCard?.kind === 'video' ? rawCard : null, { writeMeta: canEdit ? writeMeta : null });
  const card = rawCard && media && rawCard.media !== media ? { ...rawCard, media } : rawCard;

  const info = !target ? null
    : target.type === 'card' ? describeCard(card, { getMeta, boards, gridTemplates })
    : target.type === 'cluster' ? describeCluster(target.board, { boards, cards: target.cards || null, getMeta })
    : target.type === 'selection' ? describeSelection(target.cards, { getMeta })
    : target.type === 'canvasGroup' ? describeGroup(target.group, target.members)
    : null;
  // A published pack shows when, never who: a visitor has no session to look
  // a teammate up with, and their names aren't the visitor's business.
  if (info && isPublicSurface()) info.people = info.people.map((p) => ({ ...p, by: null }));
  useProfiles((info?.people || []).map((p) => p.by));

  // Esc closes it through ListSurface's keyboard handler (clearing the
  // selection it shows), which already defers to an open dialog and to the
  // pane that has the keyboard — its own window listener did neither. The
  // drawer is the exception: it isn't inside Files, so it takes Esc itself
  // while it has focus (InfoHost).

  if (!target) return null;
  const cls = `cb-detail surface-frosted${inline ? ' is-inline' : ''}${variant === 'drawer' ? ' is-drawer' : ''}`;
  // The drawer takes focus when it opens (InfoHost), so Esc reaches it.
  const asideProps = { className: cls, 'aria-label': 'Info', 'data-target': target.type, tabIndex: variant === 'drawer' ? -1 : undefined };
  const head = (title, sub) => (
    <div className="cbd-head">
      <div className="cbd-titles">
        <span className="cbd-title" title={title}>{title}</span>
        {sub && <span className="cbd-sub">{sub}</span>}
      </div>
      <button className="cbd-close" onClick={onClose} aria-label="Close info"><Icon as={X} size={16} weight="light" /></button>
    </div>
  );

  // ── Grid family view ────────────────────────────────────────────────────────
  if (target.type === 'group') {
    const g = target.group;
    return (
      <aside {...asideProps}>
        {head(g.name, 'Grid family')}
        <div className="cbd-body">
          <div className="cbd-preview"><CardPreview key={g.id} item={g} size="tile" /></div>
          <MetaRow label="Type" value="Grid family" />
          <MetaRow label="Grids" value={`${g.count}`} />
          <div className="cbd-members">
            <div className="cbd-members-label">Grids in this family</div>
            {g.members.map((m, i) => (
              <button key={m.id} className="cbd-member" onClick={() => onReveal?.(m.id)} title={m.name}>
                <span className="cbd-member-thumb"><CardPreview item={m} size="row" /></span>
                <span className="cbd-member-name">{m.name || `Grid ${i + 1}`}</span>
                <span className="cbd-member-open"><Icon as={ArrowsOutSimple} size={14} weight="light" /></span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  // ── A cluster, several things, a canvas group ───────────────────────────────
  if (target.type !== 'card') {
    const isCluster = target.type === 'cluster';
    return (
      <aside {...asideProps}>
        {head(info.title, info.subtitle)}
        <div className="cbd-body">
          <Section label="Details"><Rows details={info.details} /></Section>
          <People people={info.people} selfId={selfId} />
        </div>
        {isCluster && onOpenCluster && (
          <div className="cbd-actions">
            <button className="cbd-act is-primary" onClick={() => onOpenCluster(target.board.id)}>
              <Icon as={ArrowsOutSimple} size={16} weight="light" /><span>Open cluster</span>
            </button>
          </div>
        )}
      </aside>
    );
  }

  // ── Single card view ────────────────────────────────────────────────────────
  const item = target.item;
  // Only when there's a file behind it — a tag-index snapshot has none.
  const downloadable = DOWNLOADABLE.has(item.kind) && !item.pending && !!(card.src || card.fileSrc || card.pdfSrc);
  // The filename is resolved inside the helper from fileName → ext → mime →
  // the R2 key's own suffix. This panel used to build it from
  // `card.fileName || card.name || item.name`, which for an audio card meant
  // the user-editable TITLE — so renaming a loop to "Kick 1" downloaded a file
  // called "Kick 1", with no extension and no application willing to open it.
  const doDownload = async () => {
    try {
      await downloadCardAsset(card, item.kind, { surface: 'cluster_browser' });
    } catch (err) {
      feedback?.toast?.({ type: 'error', code: 'file_download_failed', message: 'Download failed: ' + (err?.message || err) });
    }
  };
  const location = boards[item.boardId]?.name || null;
  const size = info.details.find((r) => r.k === 'Size')?.v || (item.sizeBytes != null ? formatSize(item.sizeBytes) : '');
  const sub = [info.details.find((r) => r.k === 'Kind')?.v || item.typeLabel, size].filter(Boolean).join(' · ');

  return (
    <aside {...asideProps}>
      {head(item.name, sub)}
      <div className="cbd-body">
        {!inline && <div className="cbd-preview"><CardPreview key={item.id} item={item} size="tile" /></div>}
        <Section label="Details">
          <Rows details={info.details} />
          <MetaRow label="Location" value={location ? (item.unplaced ? `${location} · not on the board` : location) : null} />
        </Section>
        <People people={info.people} selfId={selfId} />
        {FILE_KINDS.has(item.kind) && (card.src || card.fileSrc || card.pdfSrc) && (
          <VersionsSection
            card={card}
            canEdit={canEdit && !!versionEnv && canVersion(card)}
            getMeta={getMeta}
            personName={(id) => (isPublicSurface() ? null : personName(id, selfId))}
            onUpload={versionEnv ? () => pickVersionFile(versionEnv, card.id) : null}
            onMakeCurrent={versionEnv ? (v) => makeCurrent(versionEnv, card.id, v.id) : null}
            onDelete={versionEnv ? (v) => deleteVersion(versionEnv, card.id, v.id) : null}
            onRestore={versionEnv ? (v) => restoreVersion(versionEnv, card.id, v.id) : null}
            onLabel={versionEnv ? (v) => labelVersion(versionEnv, card.id, v.id) : null}
            onOpen={item.kind === 'video' && item.boardId && !isPublicSurface() ? (v) => openPlayer({ boardId: item.boardId, cardId: card.id, versionId: v.id, card }) : null}
            onDownload={(v) => downloadCardAsset({ ...card, src: v.src ?? card.src, fileSrc: v.fileSrc ?? card.fileSrc, pdfSrc: v.pdfSrc ?? card.pdfSrc, fileName: v.fileName || card.fileName, name: v.name || card.name }, item.kind, { surface: 'cluster_browser' }).catch(() => {})}
          />
        )}
      </div>
      <div className="cbd-actions">
        {/* Both of these used to render unconditionally, and both are dead on a
            published pack: the public viewer passes no reveal handler, and the
            ?board=&card= link copyLink builds is only read by the signed-in
            app. The first action a visitor tried was the one that did
            nothing. */}
        {/* A file waiting in Files has no spot on the canvas to open to —
            it can be put there instead. */}
        {item.unplaced ? (onPutOnBoard && (
          <button className="cbd-act is-primary" onClick={() => onPutOnBoard(item.id)}>
            <Icon as={BoundingBox} size={16} weight="light" /><span>Put on board</span>
          </button>
        )) : onReveal && (
          <button className="cbd-act is-primary" onClick={() => onReveal(item.id)}>
            <Icon as={BoundingBox} size={16} weight="light" /><span>Show on board</span>
          </button>
        )}
        {downloadable && (
          <button className="cbt-iconbtn cbd-icon" onClick={() => doDownload()} aria-label="Download" title="Download">
            <Icon as={Download} size={16} weight="light" />
          </button>
        )}
        {!isPublicSurface() && item.boardId && (
          <button className="cbt-iconbtn cbd-icon" onClick={() => copyCardLink(item.id, item.boardId, feedback)} aria-label="Copy link" title="Copy link">
            <Icon as={LinkIcon} size={16} weight="light" />
          </button>
        )}
        {canEdit && onDelete && (
          <button className="cbd-act cbd-act-danger" onClick={() => onDelete([item.id])}>
            <span>Delete</span>
          </button>
        )}
      </div>
    </aside>
  );
}
