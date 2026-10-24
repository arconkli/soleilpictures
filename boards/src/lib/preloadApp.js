// preloadSignedInApp — start downloading the signed-in app before there is a
// session to open it with.
//
// Called when a sign-in code is sent, and when a remembered code step comes
// back: the half minute someone spends finding the email and typing the code
// is enough to fetch the whole app, which used to start downloading only after
// the code was accepted. `setup` adds the held workspace setup a new account
// may open on first.
//
// The lists and the code that fetches them come from the inline script the
// build writes into index.html (src/lib/appPreloadList.mjs). This only preloads;
// the code step then runs the app as well (AuthGate's warmApp). Dev has no
// such script, and nothing to preload.
//
// No imports: AuthGate is in the entry chunk.

export function preloadSignedInApp({ setup = false } = {}) {
  if (typeof window === 'undefined') return;
  try {
    const p = window.__soleilAppPreload;
    if (!p) return;
    p.run('app');
    if (setup) p.run('setup');
  } catch (_) { /* a preload is only ever a head start */ }
}
