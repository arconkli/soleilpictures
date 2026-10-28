// AdminUserSharing — one person's sharing, in the Users drawer (0745's
// admin_user_sharing, 0746's admin_user_workspaces). Look B, "By cluster":
// what they shared, a card per cluster, workspace or file with its routes, the
// five steps its people climbed (Seen → Co-creating) and the faces of those
// people; what others shared with them; and everyone they reached. How they
// themselves were brought in is Acquisition's (BroughtIn, below), so a deleted
// link, an invitation or a workspace add never reads as "organic / direct".
//
// Its own read, keyed on the user, so a failure blanks this section alone.

import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { formatCount, fmtDateTime, relativeTime } from '../../lib/adminFormat.js';
import {
  objectSub, objectLadder, broughtInWords, withThemSub, withThemTail, titleOf, personLabel, personFlags,
  routeLabel, plural, shortDay, ROUTE_ORDER,
} from '../../lib/shareRoutes.js';
import { Icon } from '../../components/Icon.jsx';
import { Share2, LayoutGrid, Users as UsersIcon, FileText, ArrowSquareOut } from '../../lib/icons.js';
import { useAdminData } from './useAdminData.js';
import { AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { Avatar, DetailSection } from './AdminUserDetailParts.jsx';

const CARDS = 8;
const FACES = 5;

const KIND_ICON = { cluster: LayoutGrid, workspace: UsersIcon, file: FileText };

// The read both Acquisition and the Sharing section draw on. Workspaces are a
// second, optional read: a profile without them still shows its sharing.
export function useUserSharing(userId) {
  const fetchSharing = useCallback(async () => {
    const [s, w] = await Promise.all([
      supabase.rpc('admin_user_sharing', { p_user_id: userId }),
      supabase.rpc('admin_user_workspaces', { p_user_id: userId }),
    ]);
    if (s.error) throw s.error;
    return { ...(s.data || {}), workspaces: w.error ? null : (w.data || []) };
  }, [userId]);
  return useAdminData(fetchSharing, [userId]);
}

function PersonButton({ person, onOpenUser, children }) {
  if (!onOpenUser || !person?.user_id) return children;
  return (
    <button type="button" className="admin-sh-linkbtn" onClick={() => onOpenUser(person)}
            title={`Open ${personLabel(person)}`}>
      {children}
    </button>
  );
}

// Acquisition's "Brought in" block: the route, who, through what, and what to
// know about it.
export function BroughtIn({ bi, onOpenUser }) {
  const w = broughtInWords(bi);
  if (!w) return null;
  return (
    <>
      <div className="admin-detail-subhead">Brought in</div>
      <dl className="admin-detail-kv">
        <dt>How</dt>
        <dd>
          <span className="is-strong">{w.how.charAt(0).toUpperCase() + w.how.slice(1)}</span>
          {bi.at && <span className="is-muted" title={fmtDateTime(bi.at)}> · {shortDay(bi.at)}</span>}
        </dd>
        <dt>By</dt>
        <dd>
          {w.by ? (
            <span className="admin-sh-by">
              <Avatar email={w.by.email} name={w.by.name} size={20} />
              <PersonButton person={w.by} onOpenUser={onOpenUser}>{personLabel(w.by)}</PersonButton>
            </span>
          ) : <span className="is-muted">not recorded</span>}
        </dd>
        {w.note && (<><dt>Note</dt><dd className="is-muted">{w.note}</dd></>)}
      </dl>
    </>
  );
}

// A profile header's workspaces: each with its cards, the most first.
export function WorkspaceCards({ list, more = 0 }) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return null;
  return (
    <div className="admin-ws-cards" aria-label="Workspaces and their cards">
      {items.map((w) => (
        <span key={w.workspace_id} className="admin-ws-card"
              title={`${w.name || 'Untitled workspace'} · ${w.role || 'member'}${w.clusters != null ? ` · ${formatCount(w.clusters)} clusters` : ''}${w.members != null ? ` · ${formatCount(w.members)} people` : ''}`}>
          <Icon as={UsersIcon} size={11} />
          <span className="admin-ws-name">{w.name || 'Untitled workspace'}</span>
          <b>{formatCount(w.cards || 0)}</b>
          <span className="admin-ws-unit">card{w.cards === 1 ? '' : 's'}</span>
        </span>
      ))}
      {more > 0 && <span className="admin-ws-more">+{more} more</span>}
    </div>
  );
}

function Ladder({ o }) {
  return (
    <div className="admin-sh-ladder">
      {objectLadder(o).map((s) => (
        <div key={s.key} className={`admin-sh-step${s.n === 0 || s.n === '—' ? ' is-zero' : ''}${s.on ? ' is-people' : ''}`}>
          <span className="admin-sh-step-n">{typeof s.n === 'number' ? formatCount(s.n) : s.n}</span>
          <span className="admin-sh-step-l">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectCard({ o, onOpenUser }) {
  const people = Array.isArray(o.people) ? o.people : [];
  const notes = [];
  if (o.seen_view_link > 0 && o.seen_edit_link > 0) {
    notes.push(`Seen through the view link on ${plural(o.seen_view_link, 'device')}, the edit link on ${o.seen_edit_link}.`);
  }
  if (o.deleted) notes.push(`The ${o.kind || 'cluster'} has since been deleted.`);
  return (
    <div className="admin-sh-card">
      <div className="admin-sh-card-head">
        <span className="admin-sh-lic"><Icon as={KIND_ICON[o.kind] || LayoutGrid} size={12} /></span>
        <div>
          <div className="admin-sh-card-title">{titleOf(o)}</div>
          <div className="admin-sh-card-sub">{objectSub(o)}</div>
        </div>
      </div>
      <Ladder o={o} />
      {(people.length > 0 || o.waiting > 0) && (
        <div className="admin-sh-faces">
          {people.slice(0, FACES).map((p) => (
            <PersonButton key={p.user_id} person={p} onOpenUser={onOpenUser}>
              <span className="admin-sh-face" title={personFlags(p).join(' · ') || undefined}>
                <Avatar email={p.email} name={p.name} size={18} />
                {personLabel(p)}
              </span>
            </PersonButton>
          ))}
          {people.length > FACES && <span className="admin-sh-face is-wait">+{people.length - FACES}</span>}
          {o.waiting > 0 && <span className="admin-sh-face is-wait">{formatCount(o.waiting)} waiting</span>}
        </div>
      )}
      {notes.length > 0 && <div className="admin-sh-cnote">{notes.join(' ')}</div>}
    </div>
  );
}

// A thing worth a card: anyone got anywhere with it, someone is invited to it,
// or it went out some way other than a view link.
function worthACard(o) {
  if ((o.people || []).length || o.waiting > 0) return true;
  if (o.signed_up || o.got_in || o.made_something || o.co_creating) return true;
  return Object.keys(o.routes || {}).some((r) => r !== 'view_link');
}

function ByThem({ d, onOpenUser }) {
  const objects = Array.isArray(d.objects) ? d.objects : [];
  if (!objects.length) return <div className="admin-detail-note">They haven’t shared anything.</div>;
  const cards = objects.filter(worthACard);
  const shown = cards.slice(0, CARDS);
  const rest = objects.filter((o) => !shown.includes(o));
  const restSeen = rest.reduce((n, o) => n + Number(o.seen || 0), 0);
  const restViewOnly = rest.filter((o) => !worthACard(o)).length;
  const more = rest.length + Number(d.objects_more || 0);
  return (
    <div className="admin-sh-cards">
      {shown.map((o) => <ObjectCard key={`${o.kind}:${o.id}`} o={o} onOpenUser={onOpenUser} />)}
      {more > 0 && (
        <div className="admin-sh-rest">
          <b>{formatCount(more)} more</b> {more === 1 ? 'thing' : 'things'} shared
          {restViewOnly === rest.length && rest.length > 0 ? ', each with only a view link' : ''}
          {restSeen > 0 ? `, seen on ${plural(restSeen, 'device')}` : ''}
          {rest.length > 0 && rest.length === restViewOnly ? ' and nobody in yet' : ''}.
        </div>
      )}
    </div>
  );
}

function WithThem({ d, onOpenUser }) {
  const rows = Array.isArray(d.with_them) ? d.with_them : [];
  if (!rows.length) return <div className="admin-detail-note">Nobody has shared anything with them.</div>;
  return (
    <ul className="admin-sh-led">
      {rows.map((w) => (
        <li key={`${w.kind}:${w.id}:${w.route}`} className="admin-sh-lrow">
          <span className="admin-sh-lic"><Icon as={KIND_ICON[w.kind] || LayoutGrid} size={12} /></span>
          <div>
            <div className="admin-sh-ltitle">{titleOf(w)}</div>
            <div className="admin-sh-lsub">
              {w.by ? (
                <>
                  {routeLabel(w.route)} from{' '}
                  <PersonButton person={w.by} onOpenUser={onOpenUser}>{personLabel(w.by)}</PersonButton>
                  {withThemTail(w) && ` · ${withThemTail(w)}`}
                </>
              ) : withThemSub(w)}
            </div>
          </div>
          <div className="admin-sh-tags">
            {personFlags(w).map((f) => <span key={f} className="admin-sh-out is-people">{f}</span>)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function People({ d, onOpenUser }) {
  const people = Array.isArray(d.people) ? d.people : [];
  const waiting = Array.isArray(d.waiting) ? d.waiting : [];
  if (!people.length && !waiting.length) return <div className="admin-detail-note">Nobody has come in through them yet.</div>;
  return (
    <>
      <ul className="admin-sh-led">
        {people.map((p) => {
          const first = (p.via || [])[0];
          return (
            <li key={p.user_id} className="admin-sh-prow">
              <Avatar email={p.email} name={p.name} size={28} />
              <div>
                <div className="admin-sh-pwho">
                  <PersonButton person={p} onOpenUser={onOpenUser}>{personLabel(p)}</PersonButton>
                </div>
                <div className="admin-sh-phow">
                  {first ? `${routeLabel(first.route)} · ${titleOf({ kind: first.object_kind, title: first.title, deleted: first.deleted })}` : 'Through them'}
                  {p.first_at && ` · ${shortDay(p.first_at)}`}
                </div>
              </div>
              <div className="admin-sh-tags">
                {personFlags(p).map((f) => <span key={f} className="admin-sh-out is-people">{f}</span>)}
              </div>
            </li>
          );
        })}
      </ul>
      {waiting.length > 0 && (
        <div className="admin-sh-wait">
          {plural(Number(d.waiting_n || waiting.length), 'invitation')} not yet taken up, the latest {relativeTime(waiting[0].at)}
          {waiting[0].title ? ` (to “${titleOf({ kind: waiting[0].object_kind, title: waiting[0].title })}”)` : ''}.
        </div>
      )}
    </>
  );
}

function Panel({ t }) {
  if (!t || !(t.panel_opens > 0 || t.copies > 0)) return null;
  const byRoute = Object.entries(t.copies_by_route || {})
    .sort(([a], [b]) => ROUTE_ORDER.indexOf(a) - ROUTE_ORDER.indexOf(b))
    .map(([r, n]) => `${routeLabel(r).toLowerCase()} ${formatCount(n)}`)
    .join(' · ');
  return (
    <>
      <div className="admin-detail-subhead">The Share panel</div>
      <dl className="admin-detail-kv">
        <dt>Opened</dt><dd>{formatCount(t.panel_opens || 0)} time{t.panel_opens === 1 ? '' : 's'}</dd>
        <dt>Copied a link</dt>
        <dd>{formatCount(t.copies || 0)}{byRoute && <span className="is-muted"> · {byRoute}</span>}</dd>
        {t.last_copy_at && <><dt>Last copy</dt><dd title={fmtDateTime(t.last_copy_at)}>{relativeTime(t.last_copy_at)}</dd></>}
      </dl>
    </>
  );
}

// Every workspace they're in, with what it holds (0746's admin_user_workspaces).
function Workspaces({ list }) {
  if (!Array.isArray(list) || !list.length) return null;
  return (
    <>
      <div className="admin-detail-subhead">Workspaces · {formatCount(list.length)}</div>
      <ul className="admin-sh-ws">
        {list.map((w) => (
          <li key={w.workspace_id}>
            <span className="admin-sh-ws-name">{w.name || 'Untitled workspace'}</span>
            <span className="admin-sh-ws-role">{w.role || 'member'}</span>
            <span className="admin-sh-ws-n"><b>{formatCount(w.cards || 0)}</b> card{w.cards === 1 ? '' : 's'}</span>
            <span className="admin-sh-ws-n">{formatCount(w.clusters || 0)} cluster{w.clusters === 1 ? '' : 's'}</span>
            <span className="admin-sh-ws-n">{plural(Number(w.members || 0), 'person', 'people')}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function AdminUserSharing({ q, onOpenUser }) {
  const [tab, setTab] = useState('by');
  const d = q.data || {};
  const t = d.totals || {};
  const counts = {
    by: Number(t.objects || 0),
    with: (d.with_them || []).length,
    people: (d.people || []).length,
  };
  const reached = new Set((d.people || []).map((p) => p.user_id)).size;
  return (
    <DetailSection title="Sharing" icon={Share2}>
      <AdminAsync loading={q.loading} error={q.error} hasData={q.hasData} onRetry={q.refresh}
                  skeleton={<AdminSkeleton variant="list" rows={3} />}>
        <div className="admin-sh">
          {counts.by > 0 && (
            <div className="t-meta">
              Shared {plural(counts.by, 'thing')} {plural(Number(t.shares || 0), 'time')}
              {t.devices > 0 && ` · seen on ${plural(t.devices, 'device')}`}
              {reached > 0 && ` · ${plural(reached, 'person', 'people')} came in`}
            </div>
          )}
          <div className="admin-sh-seg" role="tablist" aria-label="Sharing">
            {[['by', 'Shared by them'], ['with', 'Shared with them'], ['people', 'People']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k}
                      className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
                {label} · {formatCount(counts[k])}
              </button>
            ))}
          </div>
          {tab === 'by' && <ByThem d={d} onOpenUser={onOpenUser} />}
          {tab === 'with' && <WithThem d={d} onOpenUser={onOpenUser} />}
          {tab === 'people' && <People d={d} onOpenUser={onOpenUser} />}
          {tab === 'by' && <Panel t={t} />}
          <Workspaces list={d.workspaces} />
          {d.banned_left_out?.shares > 0 && (
            <div className="admin-detail-note">
              Left out: {plural(d.banned_left_out.shares, 'share')} with {plural(d.banned_left_out.accounts || 0, 'banned account')}.
            </div>
          )}
          {onOpenUser && (counts.people > 0) && (
            <div className="t-meta admin-sh-hint">
              <Icon as={ArrowSquareOut} size={10} /> A name opens that person’s profile.
            </div>
          )}
        </div>
      </AdminAsync>
    </DetailSection>
  );
}
