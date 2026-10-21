// pixelSchedule — when the Meta Pixel's script loads.
//
// index.html defines Meta's queueing stub at parse time, so init, the cold
// PageView and every later fbq() call queue just as they always have, and
// window.__soleilPixel(), which adds the script itself. That script is the
// biggest download most pages make, with Meta's config behind it; added at
// parse time it raced the entry and the signed-in app for the network and ran
// in the middle of the boot. Now it waits for what the visit came for, then
// for the next idle moment:
//   * a signed-in open of the app: its board's first picture (boot:image), or
//     PIXEL_AFTER_PAINT_MS after the board painted (boot:paint) when there is
//     no picture, or PIXEL_CAP_MS when there is no board at all (the setup
//     screens, or a stored session that turns out to be signed out). Its
//     sign-ups, checkouts and purchases reach Meta from the server anyway;
//   * any other page: its load event.
//
// Pure: lib/afterBoot.js hands it the browser, for the pixel and for the chunks
// App fetches ahead of a first click. No imports.

export const PIXEL_AFTER_PAINT_MS = 3000;
export const PIXEL_CAP_MS = 8000;

export function schedulePixel({ signedInApp, onPaint, onImage, onLoad, wait, idle, load }) {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    idle(load);
  };
  if (!signedInApp) {
    onLoad(go);
    return;
  }
  onPaint(() => {
    onImage(go);
    wait(PIXEL_AFTER_PAINT_MS, go);
  });
  wait(PIXEL_CAP_MS, go);
}
