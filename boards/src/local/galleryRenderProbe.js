// galleryRenderProbe — exercises every Surface Gallery fixture in a real browser.
//
// Lives in src/ rather than in the spec because Vite only rewrites bare module
// specifiers ('react', 'react-dom/client') inside files it transforms. A
// page.evaluate string is not one, so the import has to happen from here.
//
// Imported by NOTHING in the app — only tests/surface-gallery-render.spec.js
// reaches it, over the dev server, by path. It is therefore in no chunk and
// ships nowhere; the spec asserts that no app file imports it, which is a
// stronger guarantee than a DEV guard would give (a guard would still let a
// careless import pull it into a bundle).
import React from 'react';
import * as ReactDOM from 'react-dom/client';

import { RENDERERS } from '../components/gallery/entries.jsx';
import { GALLERY_ENTRIES } from '../lib/galleryIndex.js';

export async function probeGallery(mountable = []) {
  const out = { invoked: 0, toasts: 0, elements: 0, mounted: [], failures: [], missing: [] };
  const stub = {
    toast: () => { out.toasts += 1; },
    confirm: () => { out.toasts += 1; return Promise.resolve(false); },
    prompt: () => { out.toasts += 1; return Promise.resolve(null); },
  };

  for (const entry of GALLERY_ENTRIES) {
    if (entry.kind !== 'overlay' && entry.kind !== 'toast') continue;
    const fn = RENDERERS[entry.id];
    if (typeof fn !== 'function') { out.missing.push(entry.id); continue; }
    try {
      const r = entry.kind === 'toast' ? fn(stub) : fn({ close: () => {} });
      out.invoked += 1;
      if (entry.kind === 'overlay') {
        if (!React.isValidElement(r)) throw new Error('did not return a React element');
        out.elements += 1;
      }
    } catch (e) {
      out.failures.push(`${entry.id}: ${e?.message || e}`);
    }
  }

  // Mount the context-free ones for real. Element creation proves a fixture is
  // callable; only mounting proves it is right.
  //
  // A render-time throw is caught by the boundary rather than left to surface
  // as a bare "rendered nothing" — React unmounts the tree on an uncaught
  // error, so without this every real failure reports the same useless message.
  class Catch extends React.Component {
    constructor(p) { super(p); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    render() { return this.state.err ? null : this.props.children; }
  }

  for (const id of mountable) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    let caught = null;
    try {
      root.render(React.createElement(Catch, {
        ref: (r) => { if (r) caught = () => r.state.err; },
      }, React.createElement(() => RENDERERS[id]({ close: () => {} }))));
      // React 18 commits concurrently, so a fixed number of frames is a race —
      // it made the same fixture pass or fail run to run. Poll for the commit
      // (DOM, or the boundary catching) instead of guessing at a deadline.
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && !host.firstChild && !caught?.()) {
        await new Promise((res) => requestAnimationFrame(res));
      }
      const err = caught?.();
      if (err) throw new Error(`threw on render — ${err.message}`);
      if (!host.firstChild) throw new Error('rendered nothing');
      out.mounted.push({
        id,
        chars: (host.textContent || '').trim().length,
        nodes: host.querySelectorAll('*').length,
      });
    } catch (e) {
      out.failures.push(`mount ${id}: ${e?.message || e}`);
    } finally {
      try { root.unmount(); } catch (_) { /* nothing to undo */ }
      host.remove();
    }
  }
  return out;
}
