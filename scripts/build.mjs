import { build } from 'esbuild';
await build({
  entryPoints: { api: 'apps/api/src/lambda.ts', worker: 'apps/worker/src/lambda.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  sourcemap: true,
});
