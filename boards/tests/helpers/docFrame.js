// The doc window's controls by what they do, in either of its frames: today's,
// and the doc look's (held: lib/appHost.js docLookAllowed, the dev opt-in
// soleil.dev.docLook), whose header carries the same controls under its own
// names (tests/doc-look-frame.spec.js). A spec that reaches a control through
// these passes with the look on and off. `scope` is the page or a locator.

// Opens the page list as a phone's or a touch tablet's drawer: today the button
// above the toolbar, in the look the header's pages toggle.
export const pageListButton = (scope) =>
  scope.getByRole('button', { name: /^(Page list|Pages and scenes|Show pages)$/ });

// Docks the doc beside the canvas.
export const dockButton = (scope) =>
  scope.getByRole('button', { name: /^(Dock to side|Dock beside the canvas)$/ });

// The doc's footer: under the page today, across the whole window in the look.
export const docFooter = (scope) => scope.locator('.doc-foot, .dl-foot');

// Makes the doc a screenplay (`on`), or a document again: today the bar's
// Screenplay toggle, in the look the Doc type menu's rows (a screenplay keeps
// today's bar in the look for now, so its toggle is the way back there too).
export async function setScreenplay(scope, on = true) {
  const page = typeof scope.page === 'function' ? scope.page() : scope;
  const toggle = scope.locator('.doc-tb-screenplay-toggle');
  const docType = scope.getByRole('button', { name: 'Doc type', exact: true });
  await toggle.or(docType).first().waitFor();
  if (await toggle.count()) {
    if ((await toggle.getAttribute('aria-pressed')) !== String(on)) await toggle.click();
    return;
  }
  await docType.click();
  await page.getByRole('menuitemradio', { name: on ? /^Screenplay/ : /^Document/ }).click();
}
