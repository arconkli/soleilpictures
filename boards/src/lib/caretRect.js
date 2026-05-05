// Returns the bounding rect of the caret position in a textarea or
// contenteditable. Used to anchor the @-mention picker.
export function caretRect(el) {
  if (!el) return null;
  if (el.tagName === 'TEXTAREA') {
    // Mirror trick — render the textarea content up to the caret in a
    // hidden div with identical styling, then measure the cursor span.
    const mirror = document.createElement('div');
    const styles = window.getComputedStyle(el);
    for (const prop of ['fontFamily','fontSize','fontWeight','lineHeight','padding','border','width','letterSpacing','wordSpacing','whiteSpace']) {
      mirror.style[prop] = styles[prop];
    }
    mirror.style.position = 'fixed';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.boxSizing = styles.boxSizing;
    document.body.appendChild(mirror);
    const value = el.value.substring(0, el.selectionEnd);
    const span = document.createElement('span');
    span.textContent = '|';
    mirror.textContent = value;
    mirror.appendChild(span);
    const r = el.getBoundingClientRect();
    const sr = span.getBoundingClientRect();
    const mr = mirror.getBoundingClientRect();
    document.body.removeChild(mirror);
    return {
      left:   r.left + (sr.left - mr.left) - el.scrollLeft,
      top:    r.top  + (sr.top  - mr.top)  - el.scrollTop,
      right:  r.left + (sr.left - mr.left) - el.scrollLeft + 1,
      bottom: r.top  + (sr.top  - mr.top)  - el.scrollTop + sr.height,
      width:  1,
      height: sr.height,
    };
  }
  // contenteditable: use Range + getClientRects.
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rects = range.getClientRects();
  if (rects.length === 0) return null;
  return rects[0];
}
