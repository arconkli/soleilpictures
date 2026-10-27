import { placeAnchored } from '../../lib/anchoredPlacement.js';
import { keyCaps } from '../../lib/looks.js';
import './toolbar.css';

// The one tooltip of the toolbar look (the owner's pick "A · Islands",
// 2026-10-21): glass, the control's words, and the shortcut's keys each in a
// cap. A control asks for it with data-tl-tip (lib/looks.js tlTip), and one
// host serves the page: a bar needs no tooltip of its own, and a control in a
// menu portaled out of its bar gets the same one. main.jsx installs it on
// every page.
//
//  - Under a mouse, after a pause; while one shows, or just after, the next
//    comes at once, so a pointer run along a bar reads it. On a keyboard's
//    focus at once. Never under a finger or a pen.
//  - Placed by lib/anchoredPlacement on the side data-tl-tip-side asks for
//    (the rail's go right), else over a control in the window's lower half and
//    under one in its upper half; flipped when there's no room, and always
//    inside the window.
//  - Gone on a press, a key, a wheel or a scroll, when the pointer or the
//    focus leaves, when its control opens its menu (aria-expanded), and when
//    its control leaves the page.
//  - It's for the eye: aria-hidden, since the control's name and its
//    aria-keyshortcuts already say it to a screen reader.
const DELAY = 500;
const WARM = 400;
const WATCH = 250;
const SEL = '[data-tl-tip]';

let tip = null;
let words = null;
let caps = null;
let anchor = null;
let timer = 0;
let watch = 0;
let hiddenAt = -Infinity;

function build() {
  if (tip) return;
  tip = document.createElement('div');
  tip.className = 'tl-tip';
  tip.setAttribute('aria-hidden', 'true');
  words = document.createElement('span');
  caps = document.createElement('span');
  caps.className = 'tl-keys';
  tip.append(words, caps);
  document.body.appendChild(tip);
}

function place() {
  const r = anchor.getBoundingClientRect();
  if (!r.width && !r.height) { hide(); return; }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const asked = anchor.getAttribute('data-tl-tip-side');
  const side = asked === 'right' || asked === 'above' || asked === 'below' ? asked
    : (r.top + r.height / 2 > vh / 2 ? 'above' : 'below');
  const p = placeAnchored(r, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: vw, height: vh },
    { side, align: 'center', gap: side === 'right' ? 12 : 10, pad: 6 });
  tip.style.transform = `translate(${Math.round(p.left)}px, ${Math.round(p.top)}px)`;
}

function show(el) {
  clearTimeout(timer);
  const text = el.getAttribute('data-tl-tip');
  if (!text || !el.isConnected || el.getAttribute('aria-expanded') === 'true') { hide(); return; }
  build();
  anchor = el;
  words.textContent = text;
  const keys = keyCaps(el.getAttribute('data-tl-keys'));
  caps.replaceChildren(...keys.map((k) => {
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    return kbd;
  }));
  caps.hidden = !keys.length;
  tip.classList.toggle('is-plain', !keys.length);
  place();
  tip.classList.add('is-shown');
  clearInterval(watch);
  watch = setInterval(() => {
    if (!anchor || !anchor.isConnected || anchor.getAttribute('aria-expanded') === 'true') hide();
  }, WATCH);
}

function hide() {
  clearTimeout(timer);
  clearInterval(watch);
  timer = 0;
  if (anchor) hiddenAt = performance.now();
  anchor = null;
  tip?.classList.remove('is-shown');
}

function soon(el) {
  clearTimeout(timer);
  if (anchor || performance.now() - hiddenAt < WARM) { show(el); return; }
  timer = setTimeout(() => show(el), DELAY);
}

function onOver(e) {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest?.(SEL);
  if (!el) return;
  if (el !== anchor) soon(el);
}

function onOut(e) {
  if (e.pointerType !== 'mouse') return;
  const from = e.target.closest?.(SEL);
  if (!from) return;
  const to = e.relatedTarget;
  if (to && from.contains(to)) return;
  if (from === anchor) hide();
  else if (timer) { clearTimeout(timer); timer = 0; }
}

function onFocusIn(e) {
  const el = e.target.closest?.(SEL);
  if (!el || el !== e.target) return;
  let keyboard = false;
  try { keyboard = el.matches(':focus-visible'); } catch (_) {}
  if (keyboard) show(el);
}

function onFocusOut(e) {
  if (anchor && e.target === anchor) hide();
}

let installed = false;
export function installTipHost() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => {
    // A key moves the focus on (an arrow along a bar): its focusin shows the
    // next one after this has hidden this one.
    if (e.key !== 'Shift' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Alt') hide();
  }, true);
  document.addEventListener('wheel', hide, { capture: true, passive: true });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
}
