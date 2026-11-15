// The one Lingui transform, shared by Vite (vite.config.js linguiMacros) and
// node (scripts/linguiNodeLoader.mjs, which `npm test` registers): Lingui's
// macro, then scripts/linguiCompiledMessages.mjs, so every message the code
// writes is already in the compiled form the runtime reads.
//
// Babel and the plugins load on the first call, so importing this module costs
// nothing for a file that has no macro.
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = fileURLToPath(new URL('../lingui.config.js', import.meta.url));

// Cheap test first, then the real one: only an import of a Lingui macro needs it.
export function needsLingui(code) {
  if (!code.includes('@lingui/')) return false;
  return /(?:\bfrom\s*|\bimport\s*)["']@lingui\/(?:core|react)\/macro["']/.test(code);
}

let loaded = null;
function load() {
  loaded ||= (async () => {
    const [{ transformAsync }, macro, compiled, { getConfig }] = await Promise.all([
      import('@babel/core'),
      import('@lingui/babel-plugin-lingui-macro'),
      import('./linguiCompiledMessages.mjs'),
      import('@lingui/conf'),
    ]);
    return {
      transformAsync,
      linguiMacro: macro.default,
      linguiCompiledMessages: compiled.default,
      linguiConfig: getConfig({ configPath: CONFIG_PATH }),
    };
  })();
  return loaded;
}

export async function linguiTransform(code, filename) {
  const { transformAsync, linguiMacro, linguiCompiledMessages, linguiConfig } = await load();
  const out = await transformAsync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: { plugins: ['jsx'] },
    plugins: [[linguiMacro, { descriptorFields: 'message', linguiConfig }], linguiCompiledMessages],
  });
  return { code: out.code, map: out.map };
}
