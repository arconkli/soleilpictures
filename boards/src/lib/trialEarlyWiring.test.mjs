// trial_early wiring: every surface that decides the Creator trial must pass
// the arm to the rule. A surface that forgets `early` prices arm B while the
// chip offers it the trial.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const FILES = ['components/UpgradeChip.jsx', 'components/PricingModal.jsx', 'components/settings/BillingTab.jsx', 'App.jsx'];
const MSG = 'a surface that forgets `early` prices arm B while the chip offers it the trial';

for (const file of FILES) {
  test(`${file} passes early to every trial decision`, () => {
    const src = readFileSync(new URL(file, root), 'utf8');
    const raw = src.split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
    const rawCount = (raw.match(/\b(creatorTrialEligibility|trialAwaitingServer)\(/g) || []).length;
    const plain = (raw.match(/creatorTrialEligibility\(trial\)/g) || []).length;
    const literals = [...raw.matchAll(/(creatorTrialEligibility|trialAwaitingServer)\(\{([^}]*)\}\)/g)];
    for (const m of literals) {
      assert.ok(/\bearly\b/.test(m[2]) || m[2].includes('...trial'), `${file}: ${m[0].slice(0, 80)} -- ${MSG}`);
    }
    assert.equal(literals.length, rawCount - plain, `${file}: a call does not match the wired pattern -- ${MSG}`);
  });
}

test('App.jsx trial object and seed loop', () => {
  const src = readFileSync(new URL('App.jsx', root), 'utf8');
  const m = src.match(/const trial = \{([^}]*)\};/);
  assert.ok(m, 'const trial = {...} not found');
  assert.ok(/\bearly\b/.test(m[1]), MSG);
  assert.ok(src.includes("if (key === 'trial_early') continue;"));
});
