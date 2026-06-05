import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build-time release tag stamped onto first-party client error logs
// (public.client_errors via errorReporting.js, which reads VITE_RELEASE). The
// short git SHA makes prod errors attributable to a deploy. Cloudflare Workers
// Builds runs the build in a checked-out repo so this resolves there too; the
// try/catch keeps it a no-op (null) if git is unavailable.
const release = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim() || null; }
  catch (_) { return null; }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_RELEASE': JSON.stringify(release),
  },
  server: {
    port: 5173,
    strictPort: false,
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
          // Most specific first.
          if (id.includes('react-force-graph') || id.includes('/three/') || id.includes('three-') || id.includes('d3-force-3d')) return 'vendor-graph3d';
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
