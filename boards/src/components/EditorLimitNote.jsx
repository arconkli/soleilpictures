// EditorLimitNote — the note at the top of the share panel's invite area (the
// owner's pick B, 2026-10-21). lib/editorLimit.js editorLimitNote says what it
// reads; this draws it. Ink on the panel's raised ground: the limit is news,
// not an action, so nothing here is gold.
import { Users as UsersIcon, Check as CheckIcon } from '../lib/icons.js';
import { Icon as Glyph } from './Icon.jsx';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// "More than 10 people? Start a Team": the way out of the limit for a personal
// plan's owner (editorLimitTeamLine says when). Opens Team's setup, which
// preselects the person's workspaces. Settings › Members draws it too.
export function TeamLine({ teamLine, surface = 'share_modal', buttonClass = 'share-linkish' }) {
  if (!teamLine) return null;
  const { limit, stage } = teamLine;
  const start = () => {
    try { logEventNow(EV.EDITOR_LIMIT_TEAM_START, { stage, surface }); } catch (_) {}
    window.location.assign('/team/new');
  };
  return (
    // Inline: styles.css is the entry stylesheet and has no room to spare.
    <div className="lim-line" style={{ paddingTop: 7, borderTop: '1px solid var(--line-2)' }}>
      <Trans>More than {limit} people? <button type="button" className={buttonClass} onClick={start}>Start a Team</button></Trans>
    </div>
  );
}

export function EditorLimitNote({ note, onSeeWho = null, onAsk = null, asking = false }) {
  if (!note) return null;
  const seeWhoButton = note.seeWho === 'button' && onSeeWho;
  const askButton = note.ask && onAsk;
  return (
    <div className="lim-note" role="status">
      <span className="lim-note-icon" aria-hidden="true"><Glyph as={UsersIcon} size={15} weight="regular" /></span>
      <div className="lim-note-text">
        <span className="lim-note-lead">{note.lead}</span> {note.body}
        {note.seeWho === 'link' && onSeeWho && (
          <> <button type="button" className="share-linkish" onClick={onSeeWho}><Trans>See who</Trans></button></>
        )}
        {(seeWhoButton || askButton) && (
          <div className="lim-note-acts">
            {seeWhoButton && (
              <button type="button" className="lim-btn" onClick={onSeeWho}><Trans>See who can edit</Trans></button>
            )}
            {askButton && (
              <button type="button" className="lim-btn" onClick={onAsk} disabled={asking}>
                {asking ? t`Asking…` : note.ask}
              </button>
            )}
          </div>
        )}
        {note.done && (
          <div className="lim-line lim-done">
            <Glyph as={CheckIcon} size={13} weight="regular" />{note.done}
          </div>
        )}
        <TeamLine teamLine={note.teamLine} />
      </div>
    </div>
  );
}
