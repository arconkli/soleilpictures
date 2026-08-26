// Connections — the two ways something other than this browser reaches your
// account: a phone bound to Soleil Scout, and API tokens / OAuth apps.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useFeedback } from '../AppFeedback.jsx';
import { isShellEmail } from '../ScoutClaimBanner.jsx';

// Soleil Scout — connect a phone to THIS account.
//
// Two directions exist for linking. This is the web-first one: mint a
// short-lived code here, text it to the bot, and the bot binds the handle.
// It's one tap and never has to email anybody.
//
// Codes are minted lazily (on open, not on mount of the whole panel) and the
// RPC reuses an unclaimed one rather than littering the table, so reopening
// this tab shows the same code instead of invalidating what the user already
// half-typed into their phone.
export function ScoutTab({ user }) {
  const feedback = useFeedback();
  const [code, setCode] = useState(null);
  const [identities, setIdentities] = useState([]);
  const [pendingClaim, setPendingClaim] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // scout_identities is self-readable by RLS (0206); everything else in
        // the Scout schema is service-role only.
        const [codeRes, idRes, statusRes] = await Promise.all([
          supabase.rpc('scout_create_link_code', { p_ttl_minutes: 15 }),
          supabase.from('scout_identities').select('platform,handle,created_at').order('created_at'),
          // An UNCONFIRMED claim: a phone number this account asked to be
          // connected to, from the /scout waitlist box, which has not yet
          // texted to prove anyone holds it. It is shown because a claim
          // nobody can see is a claim nobody can dispute — and anyone can type
          // anyone's number into a web form. (0233)
          //
          // Third, not last: the destructure above is positional, and the
          // fire-and-forget below returns nothing worth reading.
          supabase.rpc('scout_my_status'),
          // Settle a stale is_shell flag. The address change happens in the
          // user's inbox, out of band, with no webhook back — so the flag can
          // only clear the next time someone asks, and this tab is where a
          // Scout user turns up. Cheap, self-keyed on auth.uid(), and a no-op
          // for the accounts that were never shells.
          supabase.rpc('scout_settle_shell').catch(() => {}),
        ]);
        if (!alive) return;
        if (codeRes.error) setErr(true); else setCode(codeRes.data || null);
        setIdentities(idRes.data || []);
        const status = Array.isArray(statusRes?.data) ? statusRes.data[0] : statusRes?.data;
        setPendingClaim(status?.pending_claim_masked || null);
      } catch (_) {
        if (alive) setErr(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      feedback.toast({ type: 'success', message: 'Code copied.' });
    } catch (_) {
      feedback.toast({ type: 'error', message: 'Couldn’t copy — select the code and copy it manually.' });
    }
  };

  // Mask the middle of a phone number: this panel can be open on a shared
  // screen, and the last four are enough to tell two devices apart.
  const maskHandle = (h) => {
    const s = String(h || '');
    if (s.includes('@')) return s;
    return s.length > 6 ? `${s.slice(0, 3)}…${s.slice(-4)}` : s;
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Soleil Scout</h3>
      <p className="settings-section-hint">
        Text photos, links and notes from set and they land on your canvas —
        {' '}no app, nothing to open. Connect your phone once and everything you
        {' '}send files into <b>your</b> boards.
      </p>

      {/* A shell account arrived here BY texting, so "connect your phone" is
          advice it has already taken. What it is missing is an address. */}
      {isShellEmail(user?.email) && (
        <p className="settings-section-hint" style={{ marginTop: 12 }}>
          <b>This account has no email address yet.</b> Add one from the banner on
          {' '}your canvas and you will be able to sign in from anywhere — the
          {' '}boards and photos you already have stay exactly where they are.
        </p>
      )}

      {/* A number waiting on proof. Worded so it is unmistakably NOT connected
          yet — somebody reading this who does not recognise the last four needs
          to understand that nothing has happened to their account, and that
          nothing will until that phone texts. */}
      {pendingClaim && (
        <div style={{ marginTop: 14 }}>
          <div className="settings-billing-label">Waiting to connect</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 13 }}>
            <span aria-hidden="true" style={{ opacity: 0.6 }}>◦</span>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{pendingClaim}</b>
            <span style={{ opacity: 0.6 }}>from the Scout waitlist</span>
          </div>
          <p className="settings-section-hint" style={{ marginTop: 6 }}>
            Not connected yet. It links to this account the first time that phone
            {' '}texts Scout and confirms — never before.
          </p>
        </div>
      )}

      {identities.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="settings-billing-label">Connected</div>
          {identities.map((i) => (
            <div key={`${i.platform}:${i.handle}`}
                 style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 13 }}>
              <span aria-hidden="true">✓</span>
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{maskHandle(i.handle)}</b>
              <span style={{ opacity: 0.6 }}>{i.platform === 'imessage' ? 'iMessage' : i.platform}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="settings-empty" style={{ marginTop: 14 }}>Loading…</div>
      ) : err || !code ? (
        <div className="settings-empty" style={{ marginTop: 14 }}>
          Couldn’t generate a code. Reopen this tab to try again.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 18 }} className="settings-billing-label">
            {identities.length ? 'Connect another phone' : 'Connect your phone'}
          </div>
          <p className="settings-section-hint" style={{ marginTop: 4 }}>
            Text this code to Soleil Scout from the phone you want to connect.
            {' '}It expires in 15 minutes.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              readOnly
              value={code}
              onFocus={(e) => e.target.select()}
              aria-label="Your Scout connect code"
              style={{
                flex: '0 1 190px', minWidth: 0, padding: '9px 12px', borderRadius: 10,
                border: '1px solid var(--line-1, rgba(255,255,255,.14))',
                background: 'var(--surface-2, rgba(255,255,255,.04))',
                color: 'var(--text-1, inherit)',
                fontSize: 18, fontWeight: 600, letterSpacing: '0.16em',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
            />
            <button type="button" className="settings-btn settings-btn-primary" onClick={copy}>
              Copy code
            </button>
          </div>
          <p className="settings-section-hint" style={{ marginTop: 12 }}>
            New to Scout? <a href="/scout">See how it works</a>.
          </p>
        </>
      )}
    </div>
  );
}

// Personal access tokens for /api/v1.
//
// The plaintext is shown ONCE and then never again — not because that is a
// convention, but because only its SHA-256 is stored, so there is genuinely
// nothing left to show. The UI has to be honest about that at the moment it
// matters, which is why the freshly minted token gets its own panel with an
// explicit warning rather than being dropped into the list.
// Named for what the token can do, not for the array it holds. `read` is always
// present so listing it adds nothing; what someone scanning this list needs to
// know is whether that token can change or destroy their work.
function scopeLabel(scopes) {
  const s = Array.isArray(scopes) ? scopes : [];
  if (s.includes('delete')) return 'read + write + delete';
  if (s.includes('write')) return 'read + write';
  return 'read only';
}

// Apps connected through OAuth (migration 0224 / worker-oauth.js).
//
// Kept separate from the token list below on purpose. A personal access token
// is something a person deliberately made and must be shown their own list of;
// a connection is something they APPROVED for an application, and listing its
// access token as "a token you created" would be a lie they cannot act on.
// api_token_list excludes them for the same reason.
//
// This section is the other half of consent. A connection you can grant but
// cannot see or end is not consent — so it ships with the flow, not after it.
function ConnectedApps({ user, feedback }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data, error } = await supabase.rpc('oauth_connections_list');
    if (!error) setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const disconnect = async (row) => {
    const ok = await feedback.confirm({
      title: `Disconnect ${row.client_name}?`,
      message: 'It stops being able to reach your clusters immediately. '
        + 'Anything it already created stays where it is. You can connect it again later.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('oauth_connection_revoke', { p_id: row.id });
    if (error) {
      feedback.toast({ type: 'error', message: 'Could not disconnect that app.' });
      return;
    }
    feedback.toast({ type: 'success', message: `Disconnected ${row.client_name}.` });
    load();
  };

  // Nothing connected is the ordinary case and does not deserve a heading — it
  // would read as a feature that is broken rather than one not yet used.
  if (loading || !rows.length) return null;

  return (
    <>
      <div className="settings-billing-label" style={{ marginTop: 22 }}>Connected apps</div>
      <div style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <div key={r.id} className="api-token-item">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{r.client_name}</div>
              <div className="api-token-meta">
                {scopeLabel(r.scope)}
                {' · '}connected {new Date(r.created_at).toLocaleDateString()}
                {r.last_used_at
                  ? ` · last used ${new Date(r.last_used_at).toLocaleDateString()}`
                  : ' · never used'}
                {r.calls > 0 && ` · ${r.calls} call${r.calls === 1 ? '' : 's'}`}
              </div>
            </div>
            <button type="button" className="settings-btn" onClick={() => disconnect(r)}>
              Disconnect
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export function ApiTab({ user }) {
  const feedback = useFeedback();
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  // Two boxes, not one, because "may add to my boards" and "may destroy them"
  // are different decisions — especially when the token is going to an AI
  // assistant. The database normalizes the rest (delete implies write, read is
  // always granted), so this only has to model the intent.
  const [canWrite, setCanWrite] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [minting, setMinting] = useState(false);
  const [fresh, setFresh] = useState(null);   // { token, prefix } — shown once

  const load = async () => {
    const { data, error } = await supabase.rpc('api_token_list');
    if (!error) setTokens(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  const mint = async (e) => {
    e.preventDefault();
    if (minting) return;
    setMinting(true);
    const scopes = ['read'];
    if (canWrite || canDelete) scopes.push('write');
    if (canDelete) scopes.push('delete');
    const { data, error } = await supabase.rpc('api_token_mint', {
      p_name: name.trim() || 'API token',
      p_scopes: scopes,
      p_ttl_days: null,
    });
    setMinting(false);
    if (error) {
      feedback.toast({ type: 'error', message: error.message || 'Could not create that token.' });
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setFresh({ token: row?.token, prefix: row?.prefix });
    setName('');
    setCanWrite(false);
    setCanDelete(false);
    load();
  };

  const revoke = async (id, label) => {
    // Revocation is deliberately NOT undoable — a revoked credential must be
    // dead the moment you decide it is. Which is exactly why this needs the
    // confirm it never had: one misclick permanently killed an integration.
    const ok = await feedback.confirm({
      title: `Revoke ${label}?`,
      message: 'Anything using this token stops working immediately. This cannot be undone — you would need to create a new token.',
      confirmLabel: 'Revoke',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('api_token_revoke', { p_id: id });
    if (error) {
      feedback.toast({ type: 'error', message: 'Could not revoke that token.' });
      return;
    }
    feedback.toast({ type: 'success', message: `Revoked ${label}. It stops working immediately.` });
    load();
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      feedback.toast({ type: 'success', message: 'Token copied.' });
    } catch (_) {
      feedback.toast({ type: 'error', message: 'Couldn’t copy — select the token and copy it manually.' });
    }
  };

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">API access</h3>
      <p className="settings-section-hint">
        Drive your boards from your own software, or connect an AI assistant.
        {' '}A token acts as you — it can reach exactly what you can reach, and
        {' '}nothing more.
      </p>
      <p className="settings-section-hint">
        {/* Said first because for most people it is the right answer and it
            skips this entire screen. A token is for your own scripts. */}
        <b>Connecting an AI assistant?</b> You probably do not need a token — point it at{' '}
        <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/mcp</code>
        {' '}and approve it in the browser. See the{' '}
        <a href="/docs/mcp" target="_blank" rel="noreferrer noopener">MCP setup</a>.
      </p>

      {fresh?.token && (
        <div className="api-token-fresh">
          <div className="api-token-fresh-title">Copy this now — it is not shown again.</div>
          <p className="settings-section-hint" style={{ margin: '4px 0 10px' }}>
            We only store a hash of it, so there is no way to look it up later.
            {' '}Lost tokens get revoked and replaced.
          </p>
          <div className="api-token-row">
            <input readOnly value={fresh.token} onFocus={(e) => e.target.select()}
                   aria-label="Your new API token" className="api-token-value" />
            <button type="button" className="settings-btn settings-btn-primary"
                    onClick={() => copy(fresh.token)}>Copy</button>
            <button type="button" className="settings-btn" onClick={() => setFresh(null)}>Done</button>
          </div>
        </div>
      )}

      <form className="api-token-new" onSubmit={mint}>
        <div className="settings-billing-label" style={{ marginTop: 18 }}>New token</div>
        <div className="api-token-row" style={{ marginTop: 8 }}>
          <input
            className="auth-input"
            placeholder="What is it for? e.g. shot-list script"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Token name"
            maxLength={80}
          />
          <button type="submit" className="settings-btn settings-btn-primary" disabled={minting}>
            {minting ? 'Creating…' : 'Create token'}
          </button>
        </div>
        <label className="api-token-scope">
          <input type="checkbox" checked={canWrite || canDelete}
                 onChange={(e) => { setCanWrite(e.target.checked); if (!e.target.checked) setCanDelete(false); }} />
          <span>
            <b>Allow writes.</b> Create boards, add cards and change them.
            {' '}Without this the token can only read.
          </span>
        </label>
        <label className="api-token-scope">
          {/* Ticking this implies writes, so the box above follows it rather
              than letting someone build a token that may destroy but not edit. */}
          <input type="checkbox" checked={canDelete}
                 onChange={(e) => { setCanDelete(e.target.checked); if (e.target.checked) setCanWrite(true); }} />
          <span>
            <b>Allow deletes.</b> Remove cards and boards. Leave this off for an AI
            {' '}assistant unless you specifically want it able to throw things away —
            {' '}deletes are recoverable, but you would have to notice first.
          </span>
        </label>
      </form>

      <div className="settings-billing-label" style={{ marginTop: 22 }}>Your tokens</div>
      {loading ? (
        <div className="settings-empty" style={{ marginTop: 8 }}>Loading…</div>
      ) : !active.length ? (
        <div className="settings-empty" style={{ marginTop: 8 }}>No tokens yet.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {active.map((t) => (
            <div key={t.id} className="api-token-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div className="api-token-meta">
                  <code>{t.prefix}…</code>
                  {' · '}{scopeLabel(t.scopes)}
                  {' · '}{t.last_used_at
                    ? `last used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : 'never used'}
                  {/* Only worth showing once a token is actually being used —
                      "0 of 1000 this hour" on an idle token is noise. */}
                  {t.req_count > 0 && ` · ${t.req_count} of 1000 requests this hour`}
                </div>
              </div>
              <button type="button" className="settings-btn" onClick={() => revoke(t.id, t.name)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}

      <ConnectedApps user={user} feedback={feedback} />

      <p className="settings-section-hint" style={{ marginTop: 18 }}>
        Base URL <code>/api/v1</code>, sent as <code>Authorization: Bearer …</code>.
        {' '}Read the{' '}
        <a href="/docs/api" target="_blank" rel="noreferrer noopener">API reference</a>,
        {' '}the{' '}
        <a href="/docs/mcp" target="_blank" rel="noreferrer noopener">MCP setup</a>
        {' '}for AI assistants, or the{' '}
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer noopener">OpenAPI spec</a>.
      </p>
    </div>
  );
}
