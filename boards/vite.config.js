import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { appPreloadList, withoutList, preloadScript, WORKSPACE_SETUP_MODULE } from './src/lib/appPreloadList.mjs';

// Build-time release tag stamped onto first-party client error logs
// (public.client_errors via errorReporting.js, which reads VITE_RELEASE). The
// short git SHA makes prod errors attributable to a deploy. Cloudflare Workers
// Builds runs the build in a checked-out repo so this resolves there too; the
// try/catch keeps it a no-op (null) if git is unavailable.
const release = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() || null; }
  catch (_) { return null; }
})();

// Writes the signed-in app's file list into index.html, with the script that
// preloads it while the HTML parses on a signed-in open and that the sign-in
// form calls when a code is sent (src/lib/appPreloadList.mjs says why, and how
// the hrefs have to be spelled for Vite's helper to reuse them). `setup` is
// what the held workspace setup adds on top, for a new account that opens on
// it. A bundle without AppShell gets nothing, and neither does dev, where
// nothing is bundled to preload.
function appPreload() {
  return {
    name: 'soleil-app-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return;
        const app = appPreloadList(ctx.bundle);
        if (!app) return;
        const setup = withoutList(appPreloadList(ctx.bundle, WORKSPACE_SETUP_MODULE), app);
        const script = preloadScript(setup ? { app, setup } : { app });
        // Right after <meta charset>, which must stay inside the first 1024
        // bytes, and above every stylesheet: an inline script waits for the
        // stylesheets before it to load, and this one has to run at once.
        const charset = /<meta charset=[^>]*>/i.exec(html);
        if (!charset) return [{ tag: 'script', children: script, injectTo: 'head-prepend' }];
        const at = charset.index + charset[0].length;
        return `${html.slice(0, at)}\n  <script>${script}</script>${html.slice(at)}`;
      },
    },
  };
}

// Which Phosphor icons an open of the app draws: the ones the entry and AppShell
// import, statically, through lib/icons.js or straight from the package. Those
// stay in vendor-icons, which the app loads at once; manualChunks below sends
// every other icon to vendor-icons-lazy, which only a lazy chunk (Share,
// Messages, the doc editor, the admin page…) ever asks for. It only regroups
// modules, so a use this misses costs bytes, never a missing icon: the closure
// then imports vendor-icons-lazy too, and scripts/bundleBudget.mjs fails on that.
let bootIcons = null;   // null: keep every icon in vendor-icons
function iconSplit() {
  return {
    name: 'soleil-icon-split',
    apply: 'build',
    async buildEnd() {
      bootIcons = null;
      const ids = [...this.getModuleIds()];
      const find = (suffix) => ids.find((id) => id.endsWith(suffix));
      const iconsId = find('/src/lib/icons.js');
      const roots = [find('/src/main.jsx'), find('/src/AppShell.jsx')];
      if (!iconsId || roots.includes(undefined)) return;
      const astOf = (id) => { const info = this.getModuleInfo(id); return info.ast || this.parse(info.code); };
      const alias = new Map();   // the app's name → Phosphor's
      for (const node of astOf(iconsId).body) {
        if (node.type === 'ExportNamedDeclaration' && node.source?.value === '@phosphor-icons/react') {
          for (const s of node.specifiers) alias.set(s.exported.name, s.local.name);
        }
      }
      const ours = (id) => !id.includes('node_modules') && /\.(jsx?|mjs)$/.test(id);
      const seen = new Set();
      const stack = [...roots];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id) || !ours(id)) continue;
        seen.add(id);
        stack.push(...this.getModuleInfo(id).importedIds);
      }
      const icons = new Set();
      for (const id of seen) {
        if (id === iconsId) continue;
        for (const node of astOf(id).body) {
          const from = node.source?.value;
          if (!from || !/^(Import|ExportNamed|ExportAll)Declaration$/.test(node.type)) continue;
          const viaIcons = from !== '@phosphor-icons/react' && /(^|\/)icons(\.js)?$/.test(from)
            && (await this.resolve(from, id))?.id === iconsId;
          if (!viaIcons && from !== '@phosphor-icons/react') continue;
          for (const s of node.specifiers || []) {
            const name = s.type === 'ImportSpecifier' ? s.imported.name : s.type === 'ExportSpecifier' ? s.local.name : null;
            if (!name) return;   // a namespace import or export *: keep every icon
            icons.add(viaIcons ? (alias.get(name) || name) : name);
          }
          if (node.type === 'ExportAllDeclaration') return;
        }
      }
      bootIcons = icons;
    },
  };
}

export default defineConfig({
  plugins: [react(), appPreload(), iconSplit()],
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(release),
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  // jspdf is reached only via a dynamic import() in screenplayPdf.js (so it
  // stays a lazy chunk in prod). Pre-bundle it for dev so the first export
  // doesn't trigger Vite's "new dependency optimized → full reload".
  optimizeDeps: {
    include: ['jspdf'],
  },
  build: {
    // The app is large by nature (CRDT editor + graph + charts); the win is
    // splitting it off the signed-out landing, not shrinking it. Don't warn on
    // the post-auth vendor chunks.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Group heavy deps into separate, content-hashed vendor chunks so
        // (a) the entry stays small and (b) returning visitors reuse them
        // across deploys. react + supabase are needed by the landing too, so
        // they get their own chunks but are still imported eagerly by the
        // entry — the value there is cross-deploy caching. Everything else is
        // app-only and only loads behind the lazy AppShell / share / legal.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          const icon = /@phosphor-icons\/react\/dist\/(?:csr|defs)\/([^/.]+)\.es\.js$/.exec(id);
          if (icon && bootIcons && !bootIcons.has(icon[1])) return 'vendor-icons-lazy';
          // Most specific first.
          // three.js on its own: the admin Universe needs only this, and it
          // used to arrive with HomeGraph's react-force-graph stack attached.
          // three/webgpu (and its TSL) stays with that stack: only
          // three-render-objects imports it, and it is most of three's weight.
          if (id.includes('/node_modules/three/build/three.webgpu') || id.includes('/node_modules/three/build/three.tsl')) return 'vendor-graph3d';
          if (id.includes('/node_modules/three/')) return 'vendor-three';
          if (id.includes('react-force-graph') || id.includes('three-') || id.includes('d3-force-3d')) return 'vendor-graph3d';
          if (id.includes('@cosmograph')) return 'vendor-cosmograph';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-editor';
          if (id.includes('/yjs/') || id.includes('y-partykit') || id.includes('y-protocol') || id.includes('partysocket') || id.includes('/partykit/')) return 'vendor-yjs';
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) return 'vendor-charts';
          if (id.includes('@phosphor-icons')) return 'vendor-icons';
          if (id.includes('@supabase')) return 'vendor-supabase';        // shared by landing + app
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) return 'vendor-react';
          // everything else falls into Rollup's default per-chunk vendor split
        },
      },
    },
  },
});
