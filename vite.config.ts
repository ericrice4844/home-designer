import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorkerSource } from './build/serviceWorker';

/** Emit sw.js listing every built file, with a cache name that changes whenever the build changes. */
function serviceWorker(): Plugin {
  return {
    name: 'hds-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== 'sw.js' && !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
      const all = [...new Set([...files, ...publicFiles])].sort();
      const version = createHash('sha256').update(all.join('|')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, all) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
  },
} as any);
