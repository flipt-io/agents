import { createServer } from 'vite';
import { flueDependencyResolverPlugin, markdownImportPlugin } from '@flue/vite/internal';

// Match Flue 2.3.1's own CLI module loader, not its application dev server.
// Loading vite.config.ts would start a second runtime asynchronously. These
// internal helpers are version-coupled to our pinned @flue/vite dependency.
export function createWorkflowModuleServer() {
  const root = process.cwd();
  return createServer({
    configFile: false,
    root,
    appType: 'custom',
    resolve: { preserveSymlinks: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ['@earendil-works/pi-ai'] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [
      markdownImportPlugin(),
      flueDependencyResolverPlugin({ root, external: true, importers: [] }),
    ],
  });
}
