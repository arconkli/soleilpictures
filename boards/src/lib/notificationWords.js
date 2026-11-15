// The bell's words, in the person's language.
//
// public.notifications stores finished English `title` / `body` beside `kind`
// and `data` (0242), written by SQL, so nothing in the app can translate them
// as they are. In English the stored words are shown untouched. In any other
// language a kind is rebuilt here from `data` (and the row's actor), with the
// same meaning and wording as the SQL that wrote it, but only when every
// field it needs is on the row. A kind that lacks one keeps the stored
// English; the lacking fields are listed beside each case below, and in the
// step 13 triage log (a migration to add them ships with the owner's release).
//
// App-only: it imports Lingui's macro, so no Worker, script or Party file may
// import it.
import { t, plural } from '@lingui/core/macro';
import { uiLocale } from './uiLocale.js';
import { formatDate } from './intlFormat.js';
import { formatBonusBytes } from './inviteReward.js';

const text = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};
const has = (data, key) => !!data && Object.prototype.hasOwnProperty.call(data, key);
const whole = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

// 'YYYY-MM-DD' (a SQL date in `data`) as the SQL's 'Dy Mon FMDD', in the
// person's language. The date has no zone, so it is formatted as UTC.
function dayLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// _sched_day_title (0243): the day's label, then ' — ' and the date when
// there is one. Needs `day_label`: without it the SQL used the cluster's name,
// which `data` does not carry.
function scheduleTitle(data) {
  const label = text(data.day_label);
  if (!label || !has(data, 'date')) return null;
  if (data.date === null) return label;
  const when = dayLabel(data.date);
  return when ? t`${label} — ${when}` : null;
}

// Schedule is retired (owner, 2026-10-20); old rows may still be in the bell.
// schedule.day_updated stays stored English: its body lists which of start
// time and place changed, and `data` holds only their new values.
function schedule(n, data) {
  const title = scheduleTitle(data);
  if (!title) return null;
  switch (n.kind) {
    case 'schedule.published': {
      const note = text(data.note);
      const version = whole(data.version);
      if (note) return { title, body: n.body };
      if (version === null) return null;
      return { title, body: version === 1 ? t`Call sheet published` : t`Call sheet updated — v${version}` };
    }
    case 'schedule.moved': {
      if (!has(data, 'prev_date')) return null;
      if (data.prev_date === null) return { title, body: t`Added to the schedule` };
      if (data.date === null) return { title, body: t`Removed from the schedule` };
      const from = dayLabel(data.prev_date);
      const to = dayLabel(data.date);
      return from && to ? { title, body: t`Moved from ${from} to ${to}` } : null;
    }
    case 'schedule.cancelled': {
      const reason = text(data.reason);
      return { title, body: reason ? n.body : t`Cancelled` };
    }
    default:
      return null;
  }
}

// team.joined's body for one person (0897): how they came in, then what they
// can do, each its own sentence. Null when `data` lacks either.
function joinedBody(data) {
  const role = text(data.role);
  if (!role || !has(data, 'via')) return null;
  const how = data.via === 'invite' ? t`They accepted an invite.`
    : data.via === 'link' ? t`They joined through the team link.`
    : data.via === 'domain' ? t`They joined with their work email.`
    : data.via === 'request' ? t`An admin approved their request.`
    : t`They joined the team.`;
  const can = role === 'viewer' ? t`They can view.` : t`They can edit.`;
  return `${how} ${can}`;
}

// The title and body to show for a notifications row. `nameOf(userId)` is the
// person's name (userProfiles); an empty answer means the name is not known.
export function notificationText(n, { nameOf = null } = {}) {
  const stored = { title: n?.title ?? '', body: n?.body ?? null };
  if (!n || uiLocale() === 'en') return stored;
  const data = n.data && typeof n.data === 'object' ? n.data : {};
  const who = () => text(n.actor_id && nameOf ? nameOf(n.actor_id) : '');
  let built = null;
  try {
    switch (n.kind) {
      case 'file.shared': {
        // 0426. The SQL names the sharer by email; the person's name stands in.
        const sharer = who();
        const file = text(data.file_name);
        if (sharer && file) built = { title: t`${sharer} shared “${file}” with you`, body: n.body };
        break;
      }
      case 'file.commented': {
        // 0422. `body` is the comment's own words, as written.
        const author = who();
        const file = text(data.file_name);
        if (author && file) built = { title: t`${author} commented on “${file}”`, body: n.body };
        break;
      }
      case 'file.replied': {
        const author = who();
        const file = text(data.file_name);
        if (author && file) built = { title: t`${author} replied on “${file}”`, body: n.body };
        break;
      }
      case 'editors.limit_reached': {
        // 0520. Only the 'ask' notice to the account's own owner: the others
        // name a cluster or workspace, or the owner's first name, which
        // `data` does not carry.
        const asker = who();
        const limit = whole(data.editor_limit);
        if (data.via === 'ask' && data.account_owner === true && asker && limit !== null) {
          built = {
            title: t`${asker} asked for room to add an editor`,
            body: plural(limit, {
              one: 'Your plan has # person who can edit, the most it allows.',
              other: 'Your plan has # people who can edit, the most it allows.',
            }),
          };
        }
        break;
      }
      case 'invite.reward': {
        // 0863.
        const cards = whole(data.cards);
        const bytes = whole(data.storage_bytes);
        if (cards !== null && bytes !== null) {
          const storage = formatBonusBytes(bytes);
          built = {
            title: t`A friend you invited added their first card`,
            body: plural(cards, {
              one: `You earned # more card and ${storage} more storage.`,
              other: `You earned # more cards and ${storage} more storage.`,
            }),
          };
        }
        break;
      }
      case 'team.joined': {
        // 0897. One row per admin per team that counts up for a day: `count`
        // is how many joined, `name` the latest.
        const name = text(data.name);
        const team = text(data.team_name);
        const count = whole(data.count);
        if (!name || !team || count === null || count < 1) break;
        const body = count > 1 ? t`See who in People.` : joinedBody(data);
        if (!body) break;
        built = {
          title: count === 1
            ? t`${name} joined ${team}`
            : plural(count - 1, {
              one: `${name} and # other joined ${team}`,
              other: `${name} and # others joined ${team}`,
            }),
          body,
        };
        break;
      }
      case 'team.kept_viewer': {
        // 0897. The person an admin kept as a viewer.
        const target = text(data.target_name);
        const team = text(data.team_name);
        if (target && team) {
          built = {
            title: t`You can keep viewing “${target}”`,
            body: t`An admin of ${team} kept you as a viewer for now.`,
          };
        }
        break;
      }
      case 'schedule.published':
      case 'schedule.moved':
      case 'schedule.cancelled':
        built = schedule(n, data);
        break;
      // Stored English until `data` carries what the title names (a cluster,
      // workspace, team or plan owner): edit_request, edit_granted,
      // editors.joined_as_viewer, workspace.ownership_received,
      // team.join_request, team.joined_as_viewer, team.seats_full,
      // team.closed, team.workspace_moved_out, team.removed,
      // team.request_approved, team.view_only, team.active_again,
      // team.payment_failed, and old share.viewed rows.
      default:
        break;
    }
  } catch (_) {
    built = null;
  }
  return built || stored;
}
