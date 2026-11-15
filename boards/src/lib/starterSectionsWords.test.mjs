// The mirror of the shared English: the starter document's section headings and
// prompts read the same through starterSectionsWords as through starterSections.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TREATMENT_SECTIONS } from './starterSections.js';
import { treatmentSectionWords } from './starterSectionsWords.js';
import { setUiLocale } from './uiLocale.js';

afterEach(() => setUiLocale('en'));

test('every section has the heading and prompt the shared module has', () => {
  const words = treatmentSectionWords();
  assert.equal(words.length, TREATMENT_SECTIONS.length);
  for (const [i, s] of TREATMENT_SECTIONS.entries()) {
    assert.equal(words[i].t, s.t, s.t);
    assert.equal(words[i].prompt, s.prompt, s.t);
  }
});

test('the words are read per call, so another language reaches them', () => {
  setUiLocale('es');   // catalogs are empty in node: the source English comes back
  assert.deepEqual(treatmentSectionWords().map((s) => s.t), TREATMENT_SECTIONS.map((s) => s.t));
});
