// Signing in from a terminal, without a token to paste.
//
// The hosted server gets OAuth for free: an MCP client discovers the flow from
// a 401 and drives it. This package is stdio — there is no 401 for a client to
// see and no browser it controls — so `npx soleil-clusters-mcp login` runs the
// same flow itself: register, open a browser, catch the callback on a loopback
// port, exchange the code, and write the result to disk.
//
// It is the ordinary shape for a public client (RFC 8252): a loopback redirect
// and PKCE. There is no client secret because there is nowhere to keep one — a
// secret shipped inside an npm package is not a secret, and pretending
// otherwise is worse than admitting it, since PKCE actually does the job.
//
// SOLEIL_API_TOKEN still wins if it is set. Anyone with a working config or a
// service account should not have their setup changed by a new feature.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'soleil-clusters');
const CREDENTIALS = join(CONFIG_DIR, 'credentials.json');

// Refresh a little before the token actually dies. A token that expires
// mid-conversation surfaces to the user as the assistant suddenly losing access
// for no visible reason.
const REFRESH_SKEW_MS = 120_000;

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = (s) => createHash('sha256').update(s).digest();

async function readJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ── Stored credentials ───────────────────────────────────────────────────────

export async function loadCredentials() {
  try {
    return JSON.parse(await readFile(CREDENTIALS, 'utf8'));
  } catch {
    return null;
  }
}

async function saveCredentials(creds) {
  await mkdir(dirname(CREDENTIALS), { recursive: true, mode: 0o700 });
  // 0600: this file holds a live credential. Node does not apply the mode to an
  // existing file, so it is set explicitly afterwards too.
  await writeFile(CREDENTIALS, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export async function clearCredentials() {
  try { await unlink(CREDENTIALS); return true; } catch { return false; }
}

export const credentialsPath = () => CREDENTIALS;

// ── The token the server should present ──────────────────────────────────────

/**
 * Resolve a bearer token, refreshing a stored one if it has expired.
 *
 * Returns null when there is nothing to use, which the caller reports as a
 * setup problem rather than letting every tool call fail with a 401.
 */
export async function resolveToken(base) {
  if (process.env.SOLEIL_API_TOKEN) return process.env.SOLEIL_API_TOKEN;

  const creds = await loadCredentials();
  if (!creds?.access_token) return null;

  const fresh = creds.expires_at && Date.parse(creds.expires_at) - REFRESH_SKEW_MS > Date.now();
  if (fresh) return creds.access_token;
  if (!creds.refresh_token) return creds.access_token;   // let the API be the judge

  const res = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: creds.client_id,
    }),
  }).catch(() => null);

  if (!res?.ok) {
    // The refresh token is single-use and rotates, so a failure here usually
    // means it was already spent or the connection was revoked in the app.
    // Say which, once, rather than failing every subsequent tool call silently.
    process.stderr.write(
      'soleil-clusters-mcp: the stored sign-in is no longer valid — run `npx soleil-clusters-mcp login`\n');
    return null;
  }

  const body = await readJson(res);
  await saveCredentials({
    ...creds,
    access_token: body.access_token,
    refresh_token: body.refresh_token || creds.refresh_token,
    expires_at: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
    scope: body.scope || creds.scope,
  });
  return body.access_token;
}

// ── The interactive flow ─────────────────────────────────────────────────────

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

// One request on a loopback port, then the server closes. Bound to 127.0.0.1
// rather than 0.0.0.0 so nothing off the machine can reach it while it waits.
function awaitCallback(server, expectedState, expectedIssuer) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for the browser — nothing was changed'));
    }, 5 * 60_000);

    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const done = (message) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Soleil Clusters</title>`
          + `<body style="font:16px/1.5 system-ui;display:grid;place-items:center;height:100vh;margin:0">`
          + `<p>${message}</p></body>`);
        clearTimeout(timer);
        server.close();
      };

      const error = url.searchParams.get('error');
      if (error) {
        done('You can close this tab.');
        reject(new Error(url.searchParams.get('error_description') || error));
        return;
      }

      // RFC 9207. The issuer is compared before the code goes anywhere — that
      // one comparison is what stops a second authorization server from
      // persuading this client to hand it a code meant for Soleil.
      const iss = url.searchParams.get('iss');
      if (iss && iss !== expectedIssuer) {
        done('Something went wrong. You can close this tab.');
        reject(new Error(`the response came from ${iss}, not ${expectedIssuer}`));
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        done('Something went wrong. You can close this tab.');
        reject(new Error('the reply did not match the request that was sent'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        done('Something went wrong. You can close this tab.');
        reject(new Error('no authorization code came back'));
        return;
      }
      done('Signed in. You can close this tab and go back to your terminal.');
      resolve(code);
    });
  });
}

export async function login(base, { scope = 'read write' } = {}) {
  const out = (s) => process.stdout.write(`${s}\n`);

  // Port 0 = let the OS pick a free one. The redirect URI is registered with
  // whatever it chose, which is why registration happens after listening.
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Soleil Clusters CLI',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope,
      }),
    });
    if (!reg.ok) {
      const body = await readJson(reg);
      throw new Error(body.error_description || `registration failed (${reg.status})`);
    }
    const { client_id: clientId } = await reg.json();

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(sha256(verifier));
    const state = base64url(randomBytes(16));

    const authorize = new URL(`${base}/oauth/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${base}/api/v1/mcp`,
    }).toString();

    const waiting = awaitCallback(server, state, base);
    out('\nOpening your browser to sign in…');
    if (!openBrowser(authorize.toString())) {
      out('Could not open a browser. Visit this URL:');
    }
    out(`\n  ${authorize.toString()}\n`);

    const code = await waiting;

    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    if (!tokenRes.ok) {
      const body = await readJson(tokenRes);
      throw new Error(body.error_description || `could not exchange the code (${tokenRes.status})`);
    }
    const token = await tokenRes.json();

    await saveCredentials({
      base,
      client_id: clientId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: new Date(Date.now() + (Number(token.expires_in) || 3600) * 1000).toISOString(),
      scope: token.scope || scope,
    });

    out(`Signed in. Scopes: ${token.scope || scope}`);
    out(`Stored in ${CREDENTIALS}`);
    out('Disconnect at any time under Settings → API → Connected apps.');
  } finally {
    // listen() succeeded, so this must be closed on every path — including a
    // registration failure, or the process hangs on an open handle.
    server.close();
  }
}
