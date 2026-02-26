const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['lib/babylon-entry.js'],
  bundle: true,
  format: 'esm',
  outfile: 'lib/babylon.bundle.js',
  minify: false,       // readable during development
  sourcemap: true,
  target: 'es2020',
  logLevel: 'info',
}).then(() => {
  console.log('Babylon.js bundle created → lib/babylon.bundle.js');
}).catch(e => {
  console.error(e);
  process.exit(1);
});
