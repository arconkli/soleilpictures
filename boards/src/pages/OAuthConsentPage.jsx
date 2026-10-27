// /oauth/authorize — the one screen a person sees when an assistant connects.
//
// It renders INSIDE <AuthGate>, and that is the whole design. Our sign-in is a
// single email box that creates the account if there isn't one, so a person who
// has never heard of Soleil Clusters can press "Connect" in Claude, type their
// address, approve, and have a working assistant — without ever visiting the
// site. The sign-in wall stops being a wall and becomes the sign-up.
//
// SECURITY POSTURE. The rule that governs every branch here: never redirect to
// a URI we have not confirmed belongs to the client. A malformed or unknown
// request is shown as an error page, not bounced onward — bouncing is exactly
// the open redirect the flow is supposed to prevent. So the page asks
// /oauth/client whether this redirect_uri is registered BEFORE it renders
// anything, and the Deny button goes through the Worker (which re-checks)
// rather than building a redirect in the browser.
//
// The Worker owns the code; this page owns none of it. Approving POSTs to
// /oauth/authorize with the person's own Supabase session, and the code is
// bound to auth.uid() inside Postgres — so nothing here can approve on
// somebody else's behalf even if it wanted to.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { Icon } from '../components/Icon.jsx';
import { Lock, Eye, Edit, Trash2, SealCheck, Monitor, Warning } from '../lib/icons.js';
import { consentError, consentRequestProblem, consentRequestFault } from '../lib/oauthConsentCopy.js';
import { connectEventProps } from '../lib/oauthConnect.js';
import { consentTrust, consentScopes, scopeSentence, returnLabel, SCOPE_CHIPS } from '../lib/oauthTrust.js';
import { logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './oauthConsent.css';

// Direction D, "Trust banner" (the owner's pick, 2026-10-26): who vouches for
// the app across the top of the card (lib/oauthTrust.js), then the app, the
// account it will act as, what it may do as chips with one plain sentence, and
// two answers. "write" is not a permission anyone can weigh; "create and
// change" is.
const CHIP_ICON = { read: Eye, write: Edit, delete: Trash2 };
const BANNER_ICON = { verified: SealCheck, local: Monitor, unverified: Warning };

// The first character of a name, for the app's tile and the account's avatar.
// Never a remote logo: a registered client's logo_uri is whatever it typed.
const initialOf = (s) => (Array.from(String(s || '').trim())[0] || '?').toUpperCase();

function Shell({ children }) {
  return (
    <div className="oauth-screen">
      <div className="oauth-column">
        <div className="oauth-brand"><SoleilWordmark size="block" /></div>
        <div className="oauth-card">{children}</div>
      </div>
    </div>
  );
}

export function OAuthConsentPage() {
  const { user, signOut } = useAuth();
  const params = new URLSearchParams(window.location.search);

  const clientId = params.get('client_id') || '';
  const redirectUri = params.get('redirect_uri') || '';
  const responseType = params.get('response_type') || '';
  const codeChallenge = params.get('code_challenge') || '';
  const challengeMethod = params.get('code_challenge_method') || '';
  const state = params.get('state');
  const resource = params.get('resource') || '';
  const { shown, offerDelete } = consentScopes((params.get('scope') || '')
    .split(/[\s,]+/).map((s) => s.trim().toLowerCase()));

  const [client, setClient] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState('');
  // An app that asked to write can be allowed to delete too; the token
  // response's `scope` tells it what it got.
  const [allowDelete, setAllowDelete] = useState(false);
  const granted = offerDelete && allowDelete ? [...shown, 'delete'] : shown;

  // Everything wrong with the REQUEST itself, decided before any network call.
  // Phrased for the person who clicked, not the person who integrated — see
  // lib/oauthConsentCopy.js.
  const request = { clientId, redirectUri, responseType, codeChallenge, challengeMethod };
  const requestProblem = consentRequestProblem(request);

  // What the connect funnel records at each step — lib/oauthConnect.js decides
  // what may go in (a host, never the redirect URI; never the code or state).
  const eventProps = () => connectEventProps({
    clientId, redirectUri, scopes: shown, userCreatedAt: user?.created_at,
  });

  // A failure the page shows, with where it happened and why, for the error
  // event. The person reads consentError's sentence either way.
  const fail = (stage, reason, description) => setProblem({
    ...consentError(reason === 'network' ? 'server_error' : reason, description),
    stage,
    reason,
  });

  useEffect(() => {
    if (requestProblem) return undefined;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/oauth/client?client_id=${encodeURIComponent(clientId)}`
          + `&redirect_uri=${encodeURIComponent(redirectUri)}`);
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          fail('client', body?.error || `http_${res.status}`, body?.error_description);
          return;
        }
        if (!body?.redirect_uri_registered) {
          // Deliberately NOT redirected back with an error — an unregistered
          // callback is the thing we refuse to send anything to at all.
          fail('client', 'invalid_redirect_uri');
          return;
        }
        setClient(body);
      } catch {
        if (alive) fail('client', 'network');
      }
    })();
    return () => { alive = false; };
  }, [clientId, redirectUri, requestProblem]);

  const send = async (path) => {
    setBusy(path);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token || '';
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: granted,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state,
          resource,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.redirect_to) {
        fail('consent', body?.error || (res.ok ? 'no_redirect' : `http_${res.status}`), body?.error_description);
        setBusy('');
        return;
      }
      // Beaconed: the redirect on the next line unloads the page.
      logEventNow(path === '/oauth/deny' ? EV.OAUTH_CONSENT_DENIED : EV.OAUTH_CONSENT_ALLOWED, eventProps());
      window.location.assign(body.redirect_to);
    } catch {
      fail('consent', 'network');
      setBusy('');
    }
  };

  useEffect(() => {
    if (client) logEventOnce(`oauth_view:${clientId}`, EV.OAUTH_AUTHORIZE_VIEW, eventProps());
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const fatal = requestProblem || problem;
  const failStage = requestProblem ? 'request' : problem?.stage;
  const failReason = requestProblem ? consentRequestFault(request) : problem?.reason;
  useEffect(() => {
    if (!failReason) return;
    logEventOnce(`oauth_error:${failStage}:${failReason}`, EV.OAUTH_AUTHORIZE_ERROR, {
      ...eventProps(), stage: failStage, reason: String(failReason).slice(0, 40),
    });
  }, [failStage, failReason]); // eslint-disable-line react-hooks/exhaustive-deps

  if (fatal) {
    return (
      <Shell>
        <div className="oauth-body">
          <EmptyState
            icon={Lock}
            title={fatal.title}
            body={fatal.body}
            action={{ label: 'Go to Clusters', onClick: () => window.location.assign('/') }}
          />
        </div>
      </Shell>
    );
  }

  if (!client) {
    return (
      <Shell>
        <div className="oauth-loading">Checking that application…</div>
      </Shell>
    );
  }

  const name = client.client_name || 'This app';
  const trust = consentTrust(client, redirectUri);

  return (
    <Shell>
      <div className={`oauth-banner is-${trust.tone}`} data-trust={trust.kind}>
        <Icon as={BANNER_ICON[trust.kind]} size={15} weight="regular" className="oauth-banner-icon" />
        <span><b>{trust.lead}</b> {trust.rest}</span>
      </div>

      <div className="oauth-body">
        <div className="oauth-app" aria-hidden="true">{initialOf(name)}</div>
        <h1 className="oauth-name">{name}</h1>
        <div className="oauth-wants">wants to connect to your clusters</div>

        {/* Signing out leaves this page where it is: AuthGate asks for an
            email, and the same request comes back for whoever signs in. */}
        <button type="button" className="oauth-account" disabled={!!busy} onClick={() => signOut()}
          title="Connect a different account">
          <span className="oauth-account-avatar" aria-hidden="true">{initialOf(user?.email)}</span>
          <span className="oauth-account-email">{user?.email}</span>
          <span className="oauth-account-switch">· Switch</span>
        </button>

        <div className="oauth-chips">
          {shown.map((s) => (
            <span key={s} className="oauth-chip">
              <Icon as={CHIP_ICON[s]} size={14} weight="regular" />{SCOPE_CHIPS[s]}
            </span>
          ))}
          {offerDelete && (
            <button type="button" className={`oauth-chip oauth-chip-toggle${allowDelete ? ' is-on' : ''}`}
              aria-pressed={allowDelete} disabled={!!busy} onClick={() => setAllowDelete((on) => !on)}>
              <Icon as={Trash2} size={14} weight="regular" />{allowDelete ? SCOPE_CHIPS.delete : 'Allow deleting'}
            </button>
          )}
        </div>
        <div className="oauth-sentence">{scopeSentence(granted)}</div>

        <button type="button" className="oauth-allow" disabled={!!busy} onClick={() => send('/oauth/authorize')}>
          {busy === '/oauth/authorize' ? 'Connecting…' : `Connect ${name}`}
        </button>
        <button type="button" className="oauth-deny" disabled={!!busy} onClick={() => send('/oauth/deny')}>
          {busy === '/oauth/deny' ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>

      <div className="oauth-foot">
        Returns to <b>{returnLabel(redirectUri)}</b> · Disconnect any time in Settings → Connections ·
        Everything it does is in your audit log
      </div>
    </Shell>
  );
}
