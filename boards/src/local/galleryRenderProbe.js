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
import SurfaceGallery from '../components/gallery/SurfaceGallery.jsx';
import { FeedbackProvider } from '../components/AppFeedback.jsx';
import { armGallery, openGallery, closeGallery, previewSurface } from '../lib/galleryState.js';

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

// The list UI itself — the one piece the fixture sweep above cannot reach,
// because it is the thing doing the rendering rather than a thing rendered.
// Mounts the real SurfaceGallery with the store armed, types into the real
// search box, and opens a real preview.
export async function probeGalleryList() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  const settle = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

  try {
    armGallery(true);
    openGallery();
    root.render(React.createElement(FeedbackProvider, null, React.createElement(SurfaceGallery)));
    for (let i = 0; i < 40 && !document.querySelector('.gal-panel'); i += 1) await settle();

    const input = document.querySelector('.gal-input');
    if (!input) throw new Error('the gallery list never painted');

    const rows = () => document.querySelectorAll('.gal-row').length;
    const all = rows();

    // Type through the real onChange the way a person does.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setValue.call(input, 'trial');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 40 && rows() === all; i += 1) await settle();
    const filtered = rows();
    const firstLabel = document.querySelector('.gal-row-label')?.textContent || '';
    const groupsShown = document.querySelectorAll('.gal-group-label').length;

    // An 'insitu' row is a note, not a button — it must not be clickable.
    setValue.call(input, 'empty board');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 40 && !document.querySelector('.gal-row.is-insitu'); i += 1) await settle();
    const insituDisabled = !!document.querySelector('.gal-row.is-insitu .gal-row-main[disabled]');
    const insituNote = (document.querySelector('.gal-row-note')?.textContent || '').length;

    // Open a preview and check the bar appears and can go back.
    previewSurface('first-value-banner');
    for (let i = 0; i < 40 && !document.querySelector('.gal-bar'); i += 1) await settle();
    const barName = document.querySelector('.gal-bar-name')?.textContent || '';
    const listGoneWhilePreviewing = !document.querySelector('.gal-panel');
    const stageText = (document.querySelector('.gal-stage')?.textContent || '').trim().length;

    previewSurface(null);
    for (let i = 0; i < 40 && !document.querySelector('.gal-panel'); i += 1) await settle();
    const backToList = !!document.querySelector('.gal-panel') && !document.querySelector('.gal-bar');

    return { all, filtered, firstLabel, groupsShown, insituDisabled, insituNote,
             barName, listGoneWhilePreviewing, stageText, backToList };
  } finally {
    try { closeGallery(); armGallery(false); root.unmount(); } catch (_) { /* nothing to undo */ }
    host.remove();
  }
}
