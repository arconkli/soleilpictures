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
import { readFile, writeFile, mkdir, unlink, open, stat, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'soleil-clusters');
const CREDENTIALS = join(CONFIG_DIR, 'credentials.json');
// Held while one process refreshes. See withRefreshLock.
const REFRESH_LOCK = `${CREDENTIALS}.lock`;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;

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
  //
  // Written aside and renamed into place: every tool call re-reads this file
  // outside the refresh lock, and a plain writeFile truncates first, so a read
  // landing mid-write saw empty JSON and failed that call as "Not signed in".
  // rename() swaps the whole file at once.
  const tmp = `${CREDENTIALS}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, CREDENTIALS);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function clearCredentials() {
  try { await unlink(CREDENTIALS); return true; } catch { return false; }
}

export const credentialsPath = () => CREDENTIALS;

// ── The token the server should present ──────────────────────────────────────
//
// WHY THIS IS A SOURCE AND NOT A STRING. The server used to resolve a token
// once at startup and send it for the life of the process. An OAuth access
// token lives an hour, so every `login` user lost access an hour into a
// session and every tool call failed with "invalid token" until the MCP host
// was restarted. And two hosts sharing one sign-in raced on the single-use
// refresh token: the loser printed "no longer valid" and exited, and the
// winner's rotation killed the other's token in memory (2026-10-11 audit,
// API-06).
//
// So the token is read from credentials.json for each request, refreshed when
// it is near expiry, and re-read after a 401 in case another process rotated
// it. Refreshes are serialised: in-process by sharing one promise, and across
// processes by a lock file around the read-refresh-write.

const isFresh = (creds) => !!creds?.expires_at
  && Date.parse(creds.expires_at) - REFRESH_SKEW_MS > Date.now();

let warned = false;
function warnSignedOut() {
  // Once per process: a dead sign-in fails every call after it, and the same
  // sentence on every one of them buries whatever else stderr has to say.
  if (warned) return;
  warned = true;
  process.stderr.write(
    'soleil-clusters-mcp: the stored sign-in is no longer valid — run `npx soleil-clusters-mcp login`\n');
}

// Run `fn` holding the refresh lock. A lock older than LOCK_STALE_MS belongs to
// a process that died mid-refresh and is taken over. After LOCK_WAIT_MS this
// goes ahead without it rather than hang a tool call — the worst case is then
// the race this exists to prevent, not a stuck assistant.
async function withRefreshLock(fn) {
  await mkdir(dirname(REFRESH_LOCK), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held) {
    try {
      await (await open(REFRESH_LOCK, 'wx')).close();
      held = true;
    } catch (e) {
      if (e?.code !== 'EEXIST') break;
      const st = await stat(REFRESH_LOCK).catch(() => null);
      if (st && Date.now() - st.mtimeMs > LOCK_STALE_MS) {
        await unlink(REFRESH_LOCK).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    if (held) await unlink(REFRESH_LOCK).catch(() => {});
  }
}

// Refresh the stored sign-in, unless someone already has. `rejected` is the
// token the API just refused, if that is why we are here: a stored token that
// differs from it was rotated in by another process and is used as it is.
async function refreshStored(base, rejected) {
  return withRefreshLock(async () => {
    const creds = await loadCredentials();
    if (!creds?.access_token) return null;
    if (creds.access_token !== rejected && isFresh(creds)) return creds.access_token;
    if (!creds.refresh_token) return rejected ? null : creds.access_token;   // let the API judge

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
      warnSignedOut();
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
  });
}

/**
 * Where the server gets its bearer token, per request.
 *
 *   get()            the token to send now, refreshed first if near expiry;
 *                    null when there is nothing to use
 *   rejected(token)  the API answered 401 to `token`: a different token worth
 *                    one retry, or null
 *
 * SOLEIL_API_TOKEN wins when set, and is never refreshed — it is a personal
 * access token, which does not expire on a timer.
 */
export function tokenSource(base) {
  const fixed = process.env.SOLEIL_API_TOKEN;
  if (fixed) return { get: async () => fixed, rejected: async () => null };

  let inflight = null;
  const single = (fn) => inflight || (inflight = fn().finally(() => { inflight = null; }));
  return {
    async get() {
      const creds = await loadCredentials();
      if (!creds?.access_token) return null;
      if (isFresh(creds) || !creds.refresh_token) return creds.access_token;
      return single(() => refreshStored(base, null));
    },
    async rejected(token) {
      const next = await single(() => refreshStored(base, token));
      return next && next !== token ? next : null;
    },
  };
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
    out('Disconnect at any time under Settings → Connections → Connected apps.');
  } finally {
    // listen() succeeded, so this must be closed on every path — including a
    // registration failure, or the process hangs on an open handle.
    server.close();
  }
}
