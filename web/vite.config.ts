import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain ESM helper shared with the build script
import { buildManifest, loadInputs } from './scripts/manifest-lib.mjs';

/** Dev server only: serve the same manifest and ABIs the build emits (without asset hashes). */
function devDeployment(): Plugin {
  return {
    name: 'imd-dev-deployment',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const inputs = loadInputs();
        if (url.endsWith('/imd-deployment.json')) {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(buildManifest(inputs, [])));
        }
        const abi = inputs.abis.find((a: { path: string }) => url.endsWith('/' + a.path));
        if (abi) {
          res.setHeader('content-type', 'application/json');
          return res.end(abi.bytes);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), devDeployment()],
  build: { outDir: '../dist', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], testTimeout: 20000 },
} as never);
