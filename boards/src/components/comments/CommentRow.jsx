import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { MoreHorizontal, Edit, LinkSimple, Trash2 } from '../../lib/icons.js';
import { CommentFace } from './CommentFace.jsx';
import { shownAuthor, commentBy } from '../../lib/commentAuthor.js';
import { CommentTime } from './CommentTime.jsx';
import { MentionText } from './MentionText.jsx';
import { CommentMenu } from './CommentMenu.jsx';
import { CommentComposer } from './CommentComposer.jsx';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';

// One comment: who, when, the words. Your own gets Edit; the ⋯ menu holds
// Copy link, Edit and Delete as the powers allow (lib/commentRules.js). A
// deleted comment that still has replies is a line with no name and no face.
//
//   row         a Row (lib/commentModel.js)
//   powers      { edit, delete, copyLink } for this row
//   people      who "@" can find while editing
//   unread      show the unread dot
//   extra       anything the surface adds under the words (a timecode, a quote)
//   draftKey    where an unfinished edit is kept
//   maxLength   the most characters the surface takes
//   onEdit(rowId, { body, mentions })   may return a promise
//   onDelete(rowId)                     the surface shows the undo
//   onCopyLink(rowId)
//   onDirtyChange(bool)                 an edit has unsaved words
//   onProfile()                         your own comment: your face opens your profile
export function CommentRow({
  row,
  powers = null,
  people = null,
  unread = false,
  extra = null,
  draftKey = null,
  maxLength = null,
  onEdit,
  onDelete,
  onCopyLink,
  onDirtyChange,
  onProfile = null,
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const moreRef = useRef(null);
  const rowRef = useRef(null);
  const wasEditing = useRef(false);
  // An edit saved or cancelled takes its box with it: the caret goes to the
  // row's More button, not to nothing.
  useEffect(() => {
    if (wasEditing.current && !editing) {
      const a = document.activeElement;
      if (!a || a === document.body || rowRef.current?.contains(a)) moreRef.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);
  if (!row) return null;

  if (row.deleted) {
    return (
      <div className="cmt-row is-deleted" data-cmt-row={row.id}>
        <span className="cmt-face cmt-face--gone" aria-hidden="true"><Icon as={Trash2} size={12} weight="regular" /></span>
        <div className="cmt-gone"><Trans>Comment deleted</Trans></div>
        {extra != null && <div className="cmt-rowextra">{extra}</div>}
      </div>
    );
  }

  const p = powers || {};
  const canEdit = !!p.edit && !!onEdit;
  const canDelete = !!p.delete && !!onDelete;
  const canCopy = !!p.copyLink && !!onCopyLink;
  const items = [];
  if (canCopy) items.push({ key: 'copy', label: tr`Copy link`, icon: LinkSimple, onSelect: () => onCopyLink(row.id) });
  if (canEdit) items.push({ key: 'edit', label: tr`Edit`, icon: Edit, refocus: false, onSelect: () => setEditing(true) });
  if (canDelete) {
    if (items.length) items.push({ sep: true });
    items.push({ key: 'delete', label: tr`Delete`, icon: Trash2, danger: true, refocus: false, onSelect: () => onDelete(row.id) });
  }
  const name = shownAuthor(row.authorName || 'Someone');

  return (
    <div ref={rowRef} className={`cmt-row${row.pending ? ' is-pending' : ''}${row.failed ? ' is-failed' : ''}${editing ? ' is-editing' : ''}`} data-cmt-row={row.id}>
      <CommentFace name={name} userId={row.authorId} color={row.authorColor} size={24} onProfile={onProfile} />
      <div className="cmt-meta">
        <span className="cmt-who">{name}</span>
        <CommentTime at={row.createdAt} />
        {row.editedAt != null && <span className="cmt-ed"><Trans>· edited</Trans></span>}
        {unread && <span className="cmt-new" role="img" aria-label={tr`Unread`} />}
      </div>
      {editing ? (
        <CommentComposer
          mode="edit"
          autoFocus
          draftKey={draftKey}
          maxLength={maxLength}
          initialValue={row.body}
          initialMentions={row.mentions}
          people={people}
          onSubmit={async (next) => { await onEdit(row.id, next); setEditing(false); }}
          onCancel={() => setEditing(false)}
          onDirtyChange={onDirtyChange}
        />
      ) : (
        <MentionText body={row.body} mentions={row.mentions} />
      )}
      {row.failed && <div className="cmt-state is-failed"><Trans>Not sent</Trans></div>}
      {extra != null && <div className="cmt-rowextra">{extra}</div>}
      {!editing && !row.pending && items.length > 0 && (
        <div className={`cmt-rowacts${menu ? ' is-open' : ''}`}>
          {canEdit && (
            <button type="button" className="cmt-ib cmt-ib--edit" aria-label={tr`Edit`} onClick={() => setEditing(true)}>
              <Icon as={Edit} size={14} weight="regular" />
            </button>
          )}
          <button
            ref={moreRef}
            type="button"
            className="cmt-ib cmt-ib--more"
            aria-label={tr`More`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <Icon as={MoreHorizontal} size={16} weight="regular" />
          </button>
        </div>
      )}
      {menu && <CommentMenu anchor={moreRef.current} label={commentBy(row.authorName, row.meta?.mine === true)} items={items} onClose={() => setMenu(false)} />}
    </div>
  );
}
