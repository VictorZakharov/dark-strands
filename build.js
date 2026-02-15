const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Plugin to resolve 'three/addons/' to 'three/examples/jsm/' (matches importmap)
const threeAddonsPlugin = {
  name: 'three-addons',
  setup(build) {
    build.onResolve({ filter: /^three\/addons\// }, args => ({
      path: path.resolve(__dirname, 'node_modules', args.path.replace('three/addons/', 'three/examples/jsm/')),
    }));
  },
};

function contentHash(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(data).digest('hex').slice(0, 8);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function build() {
  // Clean dist
  fs.rmSync('dist', { recursive: true, force: true });
  fs.mkdirSync('dist', { recursive: true });

  // Bundle JS (temp name, will rename with hash)
  await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: true,
    sourcemap: true,
    format: 'esm',
    outfile: 'dist/_main.js',
    plugins: [threeAddonsPlugin],
  });

  // Hash and rename JS
  const jsHash = contentHash('dist/_main.js');
  const jsFile = `main.${jsHash}.js`;
  fs.renameSync('dist/_main.js', `dist/${jsFile}`);
  fs.renameSync('dist/_main.js.map', `dist/${jsFile}.map`);

  // Copy and hash CSS
  fs.copyFileSync('styles.css', 'dist/_styles.css');
  const cssHash = contentHash('dist/_styles.css');
  const cssFile = `styles.${cssHash}.css`;
  fs.renameSync('dist/_styles.css', `dist/${cssFile}`);

  // Copy static assets (models, textures — keep original names for loader URLs)
  copyDir('assets', 'dist/assets');

  // Generate production index.html with hashed references
  const srcHtml = fs.readFileSync('index.html', 'utf8');
  const bodyMatch = srcHtml.match(/<body>([\s\S]*?)<script type="importmap">/);
  const bodyContent = bodyMatch ? bodyMatch[1].trim() : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dark Strands</title>
<link rel="stylesheet" href="${cssFile}">
</head>
<body>
${bodyContent}
<script type="module" src="${jsFile}"></script>
</body>
</html>`;

  fs.writeFileSync('dist/index.html', html);
  console.log(`Build complete → dist/`);
  console.log(`  JS:  ${jsFile} (${(fs.statSync(`dist/${jsFile}`).size / 1024).toFixed(0)}KB)`);
  console.log(`  CSS: ${cssFile} (${(fs.statSync(`dist/${cssFile}`).size / 1024).toFixed(0)}KB)`);
}

build().catch(e => { console.error(e); process.exit(1); });
