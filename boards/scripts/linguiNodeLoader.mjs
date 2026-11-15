// A node module-customization hook: runs Lingui's macro on the source files
// that use it, so `npm test` can import them as Vite builds them. Registered
// by scripts/linguiNode.mjs. Everything else passes through untouched.
import { fileURLToPath } from 'node:url';
import { needsLingui } from './linguiTransform.mjs';

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (
    url.startsWith('file:') && !url.includes('/node_modules/') && /\.m?js$/.test(url.split('?')[0])
    && result.format === 'module' && result.source != null
  ) {
    const src = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    if (needsLingui(src)) {
      const { linguiTransform } = await import('./linguiTransform.mjs');
      const out = await linguiTransform(src, fileURLToPath(url));
      return { format: 'module', source: out.code, shortCircuit: true };
    }
  }
  return result;
}
