// The screenplay element names the doc toolbar and the Elements tab show. They
// moved here from components/docExtensions/screenplay/screenplayFlow.js, which
// the Playwright QA harness and the PDF/print code share and so can't read
// Lingui. Keyed by the same element ids as ELEMENTS. App-only.
import { t } from '@lingui/core/macro';

// A screenplay's own terms: a translator may use the trade's word for each.
// The context is written out each time: Lingui reads only a literal one.

export function elementLabel(el) {
  switch (el) {
    case 'scene': return t({ message: 'Scene Heading', context: 'screenplay element' });
    case 'action': return t({ message: 'Action', context: 'screenplay element' });
    case 'character': return t({ message: 'Character', context: 'screenplay element' });
    case 'parenthetical': return t({ message: 'Parenthetical', context: 'screenplay element' });
    case 'dialogue': return t({ message: 'Dialogue', context: 'screenplay element' });
    case 'transition': return t({ message: 'Transition', context: 'screenplay element' });
    case 'shot': return t({ message: 'Shot', context: 'screenplay element' });
    case 'centered': return t({ message: 'Centered', context: 'screenplay element' });
    default: return el;
  }
}
