// The phone drawer is the sidebar at styles.css's mobile-shell z-index, over
// its backdrop (the dim and blur meant for what lies under the drawer). The
// files sidebar's rules outrank the shell's bare `.sidebar`, so one that sets
// the sidebar's own z-index anywhere but the floating layout reaches the
// drawer too: on 2026-10-22 `.app.sb-files > .sidebar { z-index: 2 }` put the
// backdrop over the open drawer on every phone and portrait iPad, blurring and
// dimming it and taking every tap in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Every innermost rule that sets a z-index, as [selectors, value]; an at-rule's
// own head never matches, so the rules inside a media query are read as rules.
const zRules = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => [sel.split(',').map((s) => s.trim()), body.match(/z-index\s*:\s*([^;]+)/)?.[1].trim()])
  .filter(([, z]) => z !== undefined);
// The sidebar element itself: not a part inside it, not its ::after.
const subject = (s) => s.split(/[\s>+~]+/).pop();
const isSidebar = (s) => /\.sidebar(?![\w-])/.test(subject(s)) && !subject(s).includes('::');

test('the phone drawer stacks over its own backdrop', () => {
  const shell = zRules(css('../styles.css'));
  const drawer = shell.find(([sels]) => sels.includes('.sidebar'))?.[1];
  const backdrop = shell.find(([sels]) => sels.includes('.sidebar-mobile-backdrop'))?.[1];
  assert.ok(Number(drawer) > Number(backdrop), `drawer ${drawer} over backdrop ${backdrop}`);
});

test('the files sidebar lifts the sidebar only where it floats, never the drawer', () => {
  const lifts = zRules(css('../components/sidebar/clusterSidebar.css'))
    .flatMap(([sels, z]) => sels.filter(isSidebar).map((s) => [s, z]));
  for (const [s, z] of lifts) {
    assert.match(s, /\.is-floating-chrome(?![\w-])/, `${s} { z-index: ${z} } reaches the phone drawer and sinks it under its backdrop`);
  }
  // The floating cards' handles still need the lift (see the rule's comment).
  assert.ok(lifts.length > 0, 'the floating sidebar keeps its lift');
});
