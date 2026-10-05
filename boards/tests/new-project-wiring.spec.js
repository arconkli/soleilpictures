// new-project-wiring.spec.js — source guards for the App.jsx-only wiring of
// "New project". ?local=1 mounts LocalBoardsApp, so App.jsx's body is not
// reachable in a live test; these assert on CODE SHAPE, not prose (the
// collab-nudge-wiring idiom). The behaviour itself is driven live in
// projects-home.spec.js against the harness's mirror.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');

// The body of a `const name = async (…) => { … };` declaration, by brace depth,
// so an assertion about "inside addNewProject" cannot match some other function
// 300k characters away (the whole-file indexOf trap).
function fnBody(src, name) {
  const start = src.indexOf(`const ${name} = async (`);
  if (start < 0) return '';
  let i = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return '';
}

test.describe('new project wiring', () => {
  test('a new project is created under the ROOT, not the open board', () => {
    const body = fnBody(app(), 'addNewProject');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/parentBoardId:\s*rootBoard\.id/);
    expect(body).not.toMatch(/parentBoardId:\s*boardId\b/);
  });

  test('the cap is asked BEFORE the board is created, the way addCard asks it', () => {
    const body = fnBody(app(), 'addNewProject');
    const cap = body.indexOf('evaluateDemoCap(');
    const create = body.indexOf('createBoard(');
    expect(cap).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(cap).toBeLessThan(create);
    expect(body).toMatch(/surfaceCapHit\(cs\)/);
  });

  test('the sidebar "+" and cmd-K start a project, each saying which door it was', () => {
    const s = app();
    expect(s).toMatch(/onCreateBoard=\{canEditBoard\(rootBoard\.id\) \? \(\) => \{ mainMutators\.addNewProject\?\.\(\{ via: 'sidebar' \}\); \}/);
    expect(s).toMatch(/id: 'new-board', label: 'New project'[\s\S]{0,200}addNewProject\?\.\(\{ via: 'palette' \}\)/);
    // Neither still makes a nested cluster on whatever canvas is open.
    expect(s).not.toMatch(/onCreateBoard=\{canEditCurrent \? \(\) => \{ setCurrentSurface\('board'\); mainMutators\.addNewBoard/);
  });

  test('"All clusters" opens a cluster instead of dropping a link card', () => {
    const s = app();
    expect(s).toMatch(/onOpenPicker=\{\(\) => setBrowsePickerOpen\(true\)\}/);
    expect(s).toMatch(/open=\{browsePickerOpen\}/);
  });

  test('the trial offer at a new project is trial-only and once per account', () => {
    const body = fnBody(app(), 'offerTrialForProject');
    expect(body.length).toBeGreaterThan(200);
    expect(body).toMatch(/creatorTrialEligibility\(trial\)\.eligible/);
    expect(body).toMatch(/projectOfferDue\(/);
    expect(body).toMatch(/readUpgradePrompts\(\)/);
    expect(body).toMatch(/project_offer_at/);
    expect(body).toMatch(/claimUpsellSlot\('cap-toast'\)/);
    // Never a price pitch here: the copy is the trial sentence.
    expect(body).toMatch(/newProjectSentence\(/);
    expect(body).not.toMatch(/PRICE_FROM_LABEL|nearCapSentence\(/);
  });

  test('the canvas is told when the open board is a top-level project', () => {
    expect(app()).toMatch(/freshProject=\{isTopLevelProject\(boards, board\.id, rootBoard\.id\)\}/);
  });

  test('Home renders the projects panel with the graph as its backdrop', () => {
    const s = app();
    // The window spans the element's props, and Home's workspace switcher added
    // a dozen of them ahead of `graph` — 1,200 characters stopped reaching it.
    expect(s).toMatch(/<ProjectsHome[\s\S]{0,2400}graph=\{mobileShell \? null : \(/);
    expect(s).toMatch(/<HomeGraph[\s\S]{0,120}backdrop=\{!homeExploring\}/);
  });
});
