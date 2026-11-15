// The words of the starter treatment document, in the person's language.
//
// A MIRROR of starterSections.js: the public landing pages (seoLanding.js,
// through treatmentPageSteps) read the same sections in English, so that module
// stays plain English and this app-only one says them through Lingui. Only the
// heading and the line under it are written into the document, so those are
// the two it carries. starterSectionsWords.test.mjs keeps it equal to the
// shared English. Called when a starter is written, never at module load.
import { t } from '@lingui/core/macro';

export function treatmentSectionWords() {
  return [
    { t: t`Concept`, prompt: t`What the piece is and why it works, in one paragraph.` },
    { t: t`Tone and references`, prompt: t`The frames, films and photographs that set the feel. Bring in the ones the team agreed on.` },
    { t: t`Look and light`, prompt: t`Palette, lensing, light and texture.` },
    { t: t`Casting`, prompt: t`Faces and types, with a line on each.` },
    { t: t`Wardrobe and art direction`, prompt: t`Silhouettes, fabrics, sets and props.` },
    { t: t`Locations`, prompt: t`Scout photos and found references, setting by setting.` },
    { t: t`Edit, music and pace`, prompt: t`How it moves: the cut, the music and the rhythm you are after.` },
  ];
}
