// Deterministic filing — "put these in Diner Recce" without a model.
//
// Cloudflare AI credentials are optional and were unset, so this is the path
// production actually runs. Before it existed, fallbackIntent always answered
// `ingest` and a filing instruction became a sticky note on the user's canvas.
//
// The two directions of failure are NOT symmetric, and the tests are weighted
// accordingly:
//
//   · missing a filing instruction → the sentence becomes a note card. Annoying,
//     visible, deletable.
//   · inventing one → the user's note is swallowed and their photos move
//     somewhere they didn't ask for. Silent and destructive.
//
// So the matcher is narrow on purpose and most of what follows pins the things
// it must REFUSE to match.

import { test, expect } from '@playwright/test';
import { parseFileIntent, fallbackIntent } from '../src/lib/scoutIntent.js';

test('the phrasings people actually use', () => {
  const yes = {
    'put these in Diner Recce': 'Diner Recce',
    'put these in the diner board': 'diner',
    'Put this in Locations': 'Locations',
    'file these under Locations': 'Locations',
    'file under Locations': 'Locations',
    'move them to Scene 4': 'Scene 4',
    'add all of them to Warehouse': 'Warehouse',
    'drop the photos in Night Ext': 'Night Ext',
    'stick these on Mood': 'Mood',
    'chuck it in Refs': 'Refs',
    'please put these in Diner': 'Diner',
    'can you put these in Diner': 'Diner',
    'put everything in Diner Recce': 'Diner Recce',
    'these go in Diner Recce': 'Diner Recce',
    'these all go in Diner': 'Diner',
    'this belongs in Locations': 'Locations',
    'put these in "Diner Recce"': 'Diner Recce',
    'put these in the diner board.': 'diner',
  };
  for (const [text, board] of Object.entries(yes)) {
    expect(parseFileIntent(text), text).toEqual({ board });
  }
});

test('an ordinary sentence is never mistaken for filing', () => {
  // Every one of these contains a filing verb AND a preposition, which is
  // exactly why the subject has to be a pronoun for the match to fire.
  const no = [
    'move the lighting rig into the truck at 6am',
    'add a note to remind me about the power drops',
    'put the generator on the north side',
    'we should move craft services to the back lot',
    'file a permit for the diner shoot',
    'drop the extra flags in the van before we wrap',
    'save the wide shot for tomorrow',
    'throw a scrim on the window',
    'this looks great',
    'scene 4 diner, check power drops',
    '',
    'put these in',                       // no board named
    'in the diner',                       // no verb
  ];
  for (const text of no) {
    expect(parseFileIntent(text), text).toBeNull();
  }
});

test('a paragraph is content, however it starts', () => {
  // Someone dictating notes can easily open with a filing verb. Length is the
  // cheap signal that this is prose, not a command.
  const long = 'put these in the diner board and then remember that the power '
    + 'drops on the north wall are dead, the practical over the counter is on a '
    + 'separate circuit, and we need a genny for the night exterior on Thursday';
  expect(parseFileIntent(long)).toBeNull();
  expect(fallbackIntent(long).action).toBe('ingest');
});

test('fallbackIntent files when it should and ingests otherwise', () => {
  const filed = fallbackIntent('put these in Diner Recce');
  expect(filed.action).toBe('file');
  expect(filed.board).toBe('Diner Recce');
  // A filing instruction is not also a label — using it as `topic` would stamp
  // a section header reading "put these in Diner Recce" onto the board.
  expect(filed.topic).toBeNull();

  const ingested = fallbackIntent('scene 4 diner, check power drops');
  expect(ingested.action).toBe('ingest');
  expect(ingested.board).toBeNull();
  expect(ingested.topic).toBe('scene 4 diner, check power drops');
});

test('board names are cleaned but not mangled', () => {
  // "board" is stripped only as a trailing word — a board genuinely called
  // "Storyboard" or "Mood Board Two" must survive.
  expect(parseFileIntent('put these in Storyboard')).toEqual({ board: 'Storyboard' });
  expect(parseFileIntent('put these in Mood Board Two')).toEqual({ board: 'Mood Board Two' });
  expect(parseFileIntent('put these in the mood board')).toEqual({ board: 'mood' });
});

test('an absurdly long board name is refused rather than truncated into a wrong match', () => {
  expect(parseFileIntent(`put these in ${'x'.repeat(80)}`)).toBeNull();
});
