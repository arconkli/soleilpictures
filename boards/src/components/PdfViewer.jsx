// Fullscreen in-app PDF viewer. Modeled on ImageLightbox (backdrop + Escape +
// Download), but renders the PDF with pdf.js (lazy via pdfEngine). Pages render
// only when near the viewport (virtualized) so a 200-page PDF doesn't OOM.
// Zoom (buttons + ctrl/⌘-wheel), page nav (prev/next + "N / total" + jump),
// keyboard (↑/↓ or PgUp/PgDn page, +/- zoom, Esc close), and a clear
// error+retry state for the brief window where a just-copied/shared original
// key isn't yet authorized.
//
// `src` is the ORIGINAL pdf reference ('r2:<key>' or a plain URL). It is
// resolved through resolveSrc, which honors the public-share presigned-URL
// override — so this works on /share boards without hitting the auth endpoint.

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveSrc } from '../lib/r2.js';
import { loadPdfDocument, getPageCount, renderPageToCanvas, getPageViewport } from '../lib/pdfEngine.js';
import { Spinner } from './Spinner.jsx';

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.2;
const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));

function PdfPage({ doc, pageNum, scale, base, dpr, onRef }) {
  const wrapRef = useRef(null);
  const canvasHostRef = useRef(null);
  const renderedScaleRef = useRef(0);
  const tokenRef = useRef(0);
  const [near, setNear] = useState(false);

  // Register the page element so the parent can scroll to it.
  useEffect(() => { onRef?.(pageNum, wrapRef.current); return () => onRef?.(pageNum, null); }, [pageNum, onRef]);

  // Render when near the viewport, and re-render when the scale changes.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setNear(e.isIntersecting);
    }, { root: el.closest('.pdfv-scroll') || null, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) return;
    if (renderedScaleRef.current === scale) return;
    let cancelled = false;
    const token = ++tokenRef.current;
    (async () => {
      try {
        const canvas = await renderPageToCanvas(doc, pageNum, { scale: scale * dpr });
        if (cancelled || token !== tokenRef.current) return;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        const host = canvasHostRef.current;
        if (host) { host.replaceChildren(canvas); }
        renderedScaleRef.current = scale;
      } catch (_) { /* leave the placeholder */ }
    })();
    return () => { cancelled = true; };
  }, [near, scale, dpr, doc, pageNum]);

  const w = Math.round((base?.width || 612) * scale);
  const h = Math.round((base?.height || 792) * scale);
  return (
    <div className="pdfv-page" ref={wrapRef} data-page={pageNum}
         style={{ width: w, height: h }}>
      <div className="pdfv-page-canvas" ref={canvasHostRef} />
    </div>
  );
}

export function PdfViewer({ src, name, onClose }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [doc, setDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [base, setBase] = useState(null);          // page-1 viewport at scale 1
  const [scale, setScale] = useState(1);
  const [current, setCurrent] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRef = useRef(null);
  const pageEls = useRef(new Map());
  const fittedRef = useRef(false);
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(2, window.devicePixelRatio) : 1;

  // Load the document (re-runs on retry via reloadKey).
  useEffect(() => {
    let cancelled = false;
    let localDoc = null;
    setStatus('loading');
    (async () => {
      try {
        const url = await resolveSrc(src);
        if (!url) throw new Error('Could not resolve the PDF URL');
        const d = await loadPdfDocument(url);
        if (cancelled) { try { d.destroy?.(); } catch (_) {} return; }
        localDoc = d;
        const vp = await getPageViewport(d, 1, 1).catch(() => ({ width: 612, height: 792 }));
        if (cancelled) return;
        setDoc(d);
        setNumPages(getPageCount(d));
        setBase(vp);
        fittedRef.current = false;
        setStatus('ready');
      } catch (_) {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; try { localDoc?.destroy?.(); } catch (_) {} };
  }, [src, reloadKey]);

  // Fit-to-width once we know the page size + container width.
  useEffect(() => {
    if (status !== 'ready' || !base || fittedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const avail = el.clientWidth - 48; // page gutter
    if (avail > 0 && base.width > 0) {
      setScale(clampZoom(Math.min(1.5, avail / base.width)));
      fittedRef.current = true;
    }
  }, [status, base]);

  // Track the current page from scroll position.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || status !== 'ready') return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = el.scrollTop + el.clientHeight / 2;
        let best = 1, bestDist = Infinity;
        for (const [n, node] of pageEls.current) {
          if (!node) continue;
          const top = node.offsetTop;
          const dist = Math.abs(top + node.offsetHeight / 2 - mid);
          if (dist < bestDist) { bestDist = dist; best = n; }
        }
        setCurrent(best);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [status]);

  const scrollToPage = useCallback((n) => {
    const target = Math.max(1, Math.min(numPages, n));
    const node = pageEls.current.get(target);
    const el = scrollRef.current;
    if (node && el) el.scrollTo({ top: node.offsetTop - 16, behavior: 'smooth' });
  }, [numPages]);

  const registerPage = useCallback((n, node) => {
    if (node) pageEls.current.set(n, node);
    else pageEls.current.delete(n);
  }, []);

  // ctrl/⌘-wheel zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale((z) => clampZoom(z * Math.exp(-e.deltaY * 0.01)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [status]);

  // Keyboard. Capture-phase so this top-most modal owns Escape (and nav/zoom
  // keys) before the canvas's own handlers (e.g. selection-clear) can consume
  // them — otherwise Escape would clear a selected card instead of closing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (status !== 'ready') return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); scrollToPage(current + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); scrollToPage(current - 1); }
      else if ((e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); setScale((z) => clampZoom(z + ZOOM_STEP)); }
      else if (e.key === '-' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); setScale((z) => clampZoom(z - ZOOM_STEP)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [status, current, scrollToPage, onClose]);

  const filename = useCallback(() => {
    let b = (name || 'document').toString().trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    if (!/\.pdf$/i.test(b)) b += '.pdf';
    return b;
  }, [name]);

  const onDownload = useCallback(async (e) => {
    e?.stopPropagation?.();
    if (downloading) return;
    setDownloading(true);
    try {
      const url = await resolveSrc(src);
      if (!url) return;
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl; a.download = filename();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
    } catch (_) {
      const url = await resolveSrc(src).catch(() => null);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloading(false);
    }
  }, [src, downloading, filename]);

  return (
    <div className="pdfv" role="dialog" aria-label={name || 'PDF preview'}
         onClick={() => onClose?.()}>
      <div className="pdfv-bar" onClick={(e) => e.stopPropagation()}>
        <span className="pdfv-title" title={name || ''}>{name || 'PDF'}</span>
        <span className="pdfv-spacer" />
        {status === 'ready' && (
          <span className="pdfv-nav">
            <button className="pdfv-btn" aria-label="Previous page" title="Previous page"
                    onClick={() => scrollToPage(current - 1)} disabled={current <= 1}>↑</button>
            <span className="pdfv-pageind">{current} / {numPages}</span>
            <button className="pdfv-btn" aria-label="Next page" title="Next page"
                    onClick={() => scrollToPage(current + 1)} disabled={current >= numPages}>↓</button>
          </span>
        )}
        {status === 'ready' && (
          <span className="pdfv-zoom">
            <button className="pdfv-btn" aria-label="Zoom out" title="Zoom out"
                    onClick={() => setScale((z) => clampZoom(z - ZOOM_STEP))}>−</button>
            <span className="pdfv-zoomind">{Math.round(scale * 100)}%</span>
            <button className="pdfv-btn" aria-label="Zoom in" title="Zoom in"
                    onClick={() => setScale((z) => clampZoom(z + ZOOM_STEP))}>+</button>
          </span>
        )}
        <button className="pdfv-btn" aria-label="Download" title="Download"
                disabled={downloading} onClick={onDownload}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
               stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2 V11 M4 8 L8 12 L12 8 M3 14 H13" />
          </svg>
        </button>
        <button className="pdfv-btn pdfv-x" aria-label="Close" title="Close"
                onClick={(e) => { e.stopPropagation(); onClose?.(); }}>×</button>
      </div>

      <div className="pdfv-scroll" ref={scrollRef} onClick={(e) => e.stopPropagation()}>
        {status === 'loading' && (
          <div className="pdfv-state"><Spinner size={28} tone="on-dark" label="Loading PDF" /></div>
        )}
        {status === 'error' && (
          <div className="pdfv-state pdfv-error">
            <div className="pdfv-error-msg">Couldn’t load this PDF.</div>
            <button className="pdfv-retry" onClick={(e) => { e.stopPropagation(); setReloadKey((k) => k + 1); }}>
              Try again
            </button>
          </div>
        )}
        {status === 'ready' && doc && Array.from({ length: numPages }, (_, i) => (
          <PdfPage key={i + 1} doc={doc} pageNum={i + 1} scale={scale} base={base} dpr={dpr} onRef={registerPage} />
        ))}
      </div>
    </div>
  );
}

export default PdfViewer;
