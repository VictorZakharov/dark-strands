const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Plugin to resolve importmap aliases to real node_modules paths
const importmapPlugin = {
  name: 'importmap-resolve',
  setup(build) {
    // 'babylonjs' → the babylon entry that re-exports @babylonjs/core + loaders + materials
    build.onResolve({ filter: /^babylonjs$/ }, () => ({
      path: path.resolve(__dirname, 'lib/babylon-entry.js'),
    }));
    // 'eztree' → the ez-tree entry (tree/bush generation + embedded textures);
    // its jpg/png asset imports need the dataurl loaders below
    build.onResolve({ filter: /^eztree$/ }, () => ({
      path: path.resolve(__dirname, 'lib/eztree-entry.js'),
    }));
    // '@babylonjs/havok' stays external — loaded via importmap (WASM needs correct relative path)
    build.onResolve({ filter: /^@babylonjs\/havok$/ }, () => ({ path: '@babylonjs/havok', external: true }));
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

function hashAssetsInDir(dir, baseDir, manifest) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      hashAssetsInDir(fullPath, baseDir, manifest);
      continue;
    }
    const hash = contentHash(fullPath);
    const ext = path.extname(entry.name);
    const base = path.basename(entry.name, ext);
    const hashedName = `${base}.${hash}${ext}`;
    const relFromDist = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    const relHashed = path.relative(baseDir, path.join(dir, hashedName)).replace(/\\/g, '/');
    const origRef = `./assets/${relFromDist}`;
    const hashedRef = `./assets/${relHashed}`;
    fs.renameSync(fullPath, path.join(dir, hashedName));
    manifest[origRef] = hashedRef;
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
    plugins: [importmapPlugin],
    loader: { '.jpg': 'dataurl', '.png': 'dataurl' }, // ez-tree bark/leaf textures
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

  // Copy static assets and content-hash filenames
  copyDir('assets', 'dist/assets');
  const assetMap = {};
  hashAssetsInDir('dist/assets', 'dist/assets', assetMap);

  // Rewrite asset paths in bundled JS
  let jsContent = fs.readFileSync(`dist/${jsFile}`, 'utf8');
  for (const [orig, hashed] of Object.entries(assetMap)) {
    jsContent = jsContent.replaceAll(orig, hashed);
  }
  fs.writeFileSync(`dist/${jsFile}`, jsContent);

  // Generate production index.html with hashed references
  const srcHtml = fs.readFileSync('index.html', 'utf8');
  const bodyMatch = srcHtml.match(/<body>([\s\S]*?)<script type="importmap">/);
  const bodyContent = bodyMatch ? bodyMatch[1].trim() : '';

  fs.mkdirSync('dist/lib', { recursive: true });

  // Copy and hash havok files
  const havokDir = 'node_modules/@babylonjs/havok/lib/esm';
  await esbuild.build({
    entryPoints: [`${havokDir}/HavokPhysics_es.js`],
    bundle: false,
    minify: true,
    outfile: 'dist/lib/_havok.js',
    format: 'esm',
    target: 'es2020',
  });
  const hkHash = contentHash('dist/lib/_havok.js');
  const hkFile = `havok.${hkHash}.js`;
  fs.renameSync('dist/lib/_havok.js', `dist/lib/${hkFile}`);

  // Copy WASM (binary, no minification — just hash)
  fs.copyFileSync(`${havokDir}/HavokPhysics.wasm`, 'dist/lib/_havok.wasm');
  const wasmHash = contentHash('dist/lib/_havok.wasm');
  const wasmFile = `havok.${wasmHash}.wasm`;
  fs.renameSync('dist/lib/_havok.wasm', `dist/lib/${wasmFile}`);

  // Rewrite WASM path inside the havok JS so it finds the hashed .wasm
  let hkContent = fs.readFileSync(`dist/lib/${hkFile}`, 'utf8');
  hkContent = hkContent.replaceAll('HavokPhysics.wasm', wasmFile);
  fs.writeFileSync(`dist/lib/${hkFile}`, hkContent);

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
<script type="importmap">
{
  "imports": {
    "@babylonjs/havok": "./lib/${hkFile}"
  }
}
</script>
<script type="module" src="${jsFile}"></script>
</body>
</html>`;

  fs.writeFileSync('dist/index.html', html);
  console.log(`Build complete → dist/`);
  console.log(`  JS:  ${jsFile} (${(fs.statSync(`dist/${jsFile}`).size / 1024).toFixed(0)}KB)`);
  console.log(`  CSS: ${cssFile} (${(fs.statSync(`dist/${cssFile}`).size / 1024).toFixed(0)}KB)`);
  console.log(`  Assets hashed:`);
  for (const [orig, hashed] of Object.entries(assetMap)) {
    console.log(`    ${orig} → ${hashed}`);
  }
}

build().catch(e => { console.error(e); process.exit(1); });
