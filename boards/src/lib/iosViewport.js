// iOS Safari zooms the page in when a field whose text is under 16px takes the
// focus, and leaves it zoomed. A note's body is 15px (and its size is the
// owner's choice), so opening a note on an iPhone zoomed the whole app. With
// maximum-scale=1 in the viewport meta iOS skips that zoom; since iOS 10 a
// person can still pinch the page. Android honours maximum-scale (it would
// block pinch there) and never zooms on focus, so it is left alone. The
// canvas's own zoom is ours (use-gesture under touch-action:none) and never
// touches the page scale either way.
//
// Set from the app bundle, not an inline script, which the CSP may forbid.

// iPhone, iPad, iPod, and iPadOS, which reports itself as a Mac with a touch screen.
export function isIosLike(nav) {
  const ua = String(nav?.userAgent || '');
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1;
}

// The viewport content with maximum-scale=1, every other part as it was.
export function withMaxScaleOne(content) {
  const parts = String(content || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^maximum-scale\s*=/i.test(s));
  parts.push('maximum-scale=1');
  return parts.join(', ');
}

export function stopIosFocusZoom(doc = typeof document !== 'undefined' ? document : null,
                                 nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!doc || !isIosLike(nav)) return false;
  const meta = doc.querySelector('meta[name="viewport"]');
  if (!meta) return false;
  meta.setAttribute('content', withMaxScaleOne(meta.getAttribute('content')));
  return true;
}
