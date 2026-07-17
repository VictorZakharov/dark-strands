const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['lib/eztree-entry.js'],
  bundle: true,
  format: 'esm',
  outfile: 'lib/eztree.bundle.js',
  minify: true,        // mostly embedded base64 textures — keep it small
  sourcemap: false,
  target: 'es2020',
  logLevel: 'info',
  loader: { '.jpg': 'dataurl', '.png': 'dataurl' },
}).then(() => {
  console.log('ez-tree bundle created → lib/eztree.bundle.js');
}).catch(e => {
  console.error(e);
  process.exit(1);
});
