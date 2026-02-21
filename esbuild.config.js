import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
  target: ['es2020'],
};

// IIFE build — for <script> tag usage
// Bundles tus-js-client; htmx must be loaded as a global before this script.
/** @type {esbuild.BuildOptions} */
const iifeOptions = {
  ...shared,
  format: 'iife',
  outfile: 'dist/htmx-ext-tus.js',
  globalName: 'HtmxTus',
  // tus-js-client is bundled in; htmx is expected as a browser global
};

// ESM build — for bundler usage
// Both tus-js-client and htmx.org are external (consumers provide them).
/** @type {esbuild.BuildOptions} */
const esmOptions = {
  ...shared,
  format: 'esm',
  outfile: 'dist/htmx-ext-tus.esm.js',
  external: ['tus-js-client', 'htmx.org'],
};

if (watch) {
  const [iifeCtx, esmCtx] = await Promise.all([
    esbuild.context(iifeOptions),
    esbuild.context(esmOptions),
  ]);
  await Promise.all([iifeCtx.watch(), esmCtx.watch()]);
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(iifeOptions),
    esbuild.build(esmOptions),
  ]);
  console.log('Build complete.');
}
