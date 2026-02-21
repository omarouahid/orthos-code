import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['bin/orthos.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist/bin',
  clean: true,
  sourcemap: true,
  external: ['fsevents'],
});
