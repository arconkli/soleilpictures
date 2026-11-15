// `node --import ./scripts/linguiNode.mjs`: the Lingui macro for source files
// (scripts/linguiNodeLoader.mjs) and English active, as lib/i18n.js leaves it
// in the browser. Used by npm test.
import { register } from 'node:module';

register('./linguiNodeLoader.mjs', import.meta.url);

const { i18n } = await import('@lingui/core');
i18n.loadAndActivate({ locale: 'en', messages: {} });
