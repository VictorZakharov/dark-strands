/**
 * ez-tree vegetation factory — real generated tree/bush geometry instead of
 * card-based foliage.
 *
 * At world-gen time each CFG.EZTREE variant (an ez-tree preset + a seed) is
 * generated ONCE into a template mesh pair (branches + leaves) and every
 * placement becomes a thin instance — 2 draw calls per variant no matter how
 * many trees use it. ez-tree/three.js only produce BufferGeometry arrays;
 * Babylon consumes them directly (three never renders anything).
 *
 * COORDINATES: this scene uses `useRightHandedSystem = true` and three.js is
 * also right-handed Y-up, so positions/normals/uvs/indices are copied
 * VERBATIM — no winding flip, no z negation.
 */
import { Mesh, VertexData, StandardMaterial, Texture, Color3,
         Vector3, Matrix, Quaternion } from 'babylonjs';
import { CFG } from '../config.js';
import { rng, rngInt } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { addFogDepthMesh } from '../core/postfx.js';
import { attachWindSway } from './windSway.js';

// id -> { def, branches, leaves, unitScale, matrices: number[] }
const _variants = new Map();
// category -> [variant, ...] (for weighted picking)
const _byCategory = new Map();

function colorFromInt(v) {
  return new Color3(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** three BufferGeometry -> Babylon mesh. Arrays copied verbatim (both RH Y-up). */
function geometryToMesh(name, geo, scene, category) {
  const mesh = new Mesh(name, scene);
  mesh.metadata = { ezCategory: category }; // pass filters (water mirror skips bushes)
  const vd = new VertexData();
  vd.positions = new Float32Array(geo.getAttribute('position').array);
  const nrm = geo.getAttribute('normal');
  if (nrm) vd.normals = new Float32Array(nrm.array);
  const uv = geo.getAttribute('uv');
  if (uv) vd.uvs = new Float32Array(uv.array);
  // ez-tree indices are Uint16 — widen so Babylon never guesses wrong
  vd.indices = new Uint32Array(geo.getIndex().array);
  vd.applyToMesh(mesh);
  mesh.isPickable = false; // camera raycasts pay per TRIANGLE of pickables
  return mesh;
}

/**
 * Generate all CFG.EZTREE.VARIANTS template meshes. Must run after
 * initLighting/initPostFX (shadow + fog registration happens at finalize) and
 * before placeTrees/placeBushes. Dynamic import keeps the 4MB bundle out of
 * the critical path until world build.
 */
export async function initEzTreeFactory(scene) {
  const { Tree, TEXTURE_URIS } = await import('eztree');

  for (const def of CFG.EZTREE.VARIANTS) {
    const tree = new Tree();
    tree.loadPreset(def.preset);
    tree.options.seed = rngInt(0, 0x7fffffff);
    // Triangle-budget caps (CFG.EZTREE.DETAIL): clamp the preset's per-level
    // branch tessellation and thin the leaves BEFORE generate(). Raw presets
    // total ~2.31M visible tris across all instances, ×4-ish again in the
    // shadow/fog-depth/mirror passes — branch tube tessellation is the
    // biggest single cost, not leaf count.
    const detail = CFG.EZTREE.DETAIL[def.category];
    if (detail) {
      for (let lvl = 0; lvl < 4; lvl++) {
        tree.options.branch.sections[lvl] =
          Math.min(tree.options.branch.sections[lvl], detail.sections[lvl]);
        tree.options.branch.segments[lvl] =
          Math.min(tree.options.branch.segments[lvl], detail.segments[lvl]);
      }
      if (detail.leafMult !== 1) {
        tree.options.leaves.count =
          Math.max(1, Math.round(tree.options.leaves.count * detail.leafMult));
        // Fewer-but-bigger: keep total canopy coverage roughly constant
        tree.options.leaves.size *= 1 / Math.sqrt(detail.leafMult);
      }
    }
    tree.generate();

    // --- branches -------------------------------------------------------
    const branches = geometryToMesh(`ezTree_${def.id}_branches`, tree.branchesMesh.geometry, scene, def.category);
    const barkOpts = tree.options.bark;
    const barkMat = new StandardMaterial(`ezBark_${def.id}`, scene);
    const barkTex = new Texture(TEXTURE_URIS.bark[barkOpts.type].color, scene);
    // Mirror ez-tree textureScale semantics: repeat.x = x, repeat.y = 1/y
    barkTex.uScale = barkOpts.textureScale.x;
    barkTex.vScale = 1 / barkOpts.textureScale.y;
    barkMat.diffuseTexture = barkTex;
    const barkNrm = new Texture(TEXTURE_URIS.bark[barkOpts.type].normal, scene);
    barkNrm.uScale = barkTex.uScale;
    barkNrm.vScale = barkTex.vScale;
    barkNrm.level = 0.6; // mild — full-strength normals sparkle under the sun
    barkMat.bumpTexture = barkNrm;
    // Lift dark presets toward a woody brown so bark reads as textured wood.
    barkMat.diffuseColor = Color3.Lerp(colorFromInt(barkOpts.tint),
      new Color3(0.5, 0.42, 0.32), 0.4);
    barkMat.specularColor = new Color3(0.02, 0.02, 0.02);
    // ez-tree branch tubes render inside-out / hollow with single-sided culling
    // — the near OUTER wall is dropped and you see the dark INNER wall (why the
    // trunk read as a near-black hollow). Double-sided + two-sided lighting
    // shows a correctly-lit outer surface from any angle, the same recipe the
    // leaves use. Bark is a big triangle cost, but correctness wins here.
    barkMat.backFaceCulling = false;
    barkMat.twoSidedLighting = true;
    // Ambient floor: trunks sit inside their own canopy shadow, so a face the
    // sun never reaches gets only hemi light — floor it so bark isn't a black
    // silhouette. (GlowLayer is include-only/torches, so this does NOT bloom.)
    barkMat.emissiveColor = new Color3(0.1, 0.085, 0.065);
    branches.material = barkMat;

    // --- leaves ---------------------------------------------------------
    const leaves = geometryToMesh(`ezTree_${def.id}_leaves`, tree.leavesMesh.geometry, scene, def.category);
    const leafOpts = tree.options.leaves;
    // Same alpha-test card-material recipe as the old vegetation cards —
    // these exact settings survived many WebGPU/fog iterations
    const leafMat = new StandardMaterial(`ezLeaf_${def.id}`, scene);
    const leafTex = new Texture(TEXTURE_URIS.leaves[leafOpts.type], scene);
    leafTex.hasAlpha = true;
    leafMat.diffuseTexture = leafTex;
    leafMat.useAlphaFromDiffuseTexture = false; // alpha TEST, not blend
    leafMat.backFaceCulling = false;
    leafMat.twoSidedLighting = true;
    // Snow: cool blue-grey ambient glow instead of the warm green one — the
    // instance tints only MULTIPLY the green-leaning leaf texture (they can't
    // add blue that isn't there), so the icy cast has to come in additively
    leafMat.emissiveColor = CFG.SNOW_MODE
      ? new Color3(0.09, 0.12, 0.18) : new Color3(0.06, 0.1, 0.04);
    leafMat.specularColor = new Color3(0, 0, 0);
    leafMat.diffuseColor = colorFromInt(leafOpts.tint); // preset tint multiply
    leaves.material = leafMat;
    // Wind sway: ez-tree bakes uv.y=0 at each leaf quad's branch attachment
    // and 1 at its tip — the only per-vertex base/tip signal (positions are
    // pre-baked to tree-local space). Bark stays rigid.
    const swayAmp = { leafy: CFG.WIND.AMP_LEAFY, pine: CFG.WIND.AMP_PINE,
                      bush: CFG.WIND.AMP_BUSH }[def.category];
    attachWindSway(leafMat, { weight: 'uv', amp: swayAmp, freq: CFG.WIND.FREQ_TREE });

    // Normalize by the branch structure's height (trunk base is at origin)
    const pos = tree.branchesMesh.geometry.getAttribute('position').array;
    let maxY = 0;
    for (let i = 1; i < pos.length; i += 3) if (pos[i] > maxY) maxY = pos[i];
    const unitScale = maxY > 0 ? 1 / maxY : 1;

    // Hidden until finalize() confirms it has instances — a bare thin-instance
    // source mesh with no buffer would render one tree at the world origin
    branches.setEnabled(false);
    leaves.setEnabled(false);

    const variant = { def, branches, leaves, unitScale, matrices: [], colors: [] };
    _variants.set(def.id, variant);
    if (!_byCategory.has(def.category)) _byCategory.set(def.category, []);
    _byCategory.get(def.category).push(variant);
  }
}

const _m = new Matrix();
const _q = Quaternion.Identity();
const _scl = new Vector3();
const _pos = new Vector3();

/**
 * Queue one instance of a weighted-random variant of `category` at (x, z),
 * trunk base at worldY (sink applied by the caller's terrain height minus
 * CFG.EZTREE.SINK). Returns { height } — the world-unit target height chosen,
 * for physics colliders / foliage damping.
 */
export function spawnEz(category, x, y, z) {
  const list = _byCategory.get(category);
  if (!list || list.length === 0) return null;
  let total = 0;
  for (const v of list) total += v.def.weight;
  let roll = rng(0, total);
  let variant = list[list.length - 1];
  for (const v of list) {
    roll -= v.def.weight;
    if (roll <= 0) { variant = v; break; }
  }

  const height = rng(variant.def.h[0], variant.def.h[1]);
  const s = height * variant.unitScale;
  _scl.set(s, s, s);
  Quaternion.RotationYawPitchRollToRef(rng(0, Math.PI * 2), 0, 0, _q);
  _pos.set(x, y, z);
  Matrix.ComposeToRef(_scl, _q, _pos, _m);
  const base = variant.matrices.length;
  variant.matrices.length += 16;
  _m.copyToArray(variant.matrices, base);

  // Per-instance leaf tint (thin-instance 'color' buffer): weighted pick from
  // the category palette + brightness jitter so same-tint neighbors differ.
  // Snow swaps in the frosted palettes (branch at read — mutating TINTS in
  // place would leak snow tints into a later non-snow world)
  const snow = CFG.SNOW_MODE;
  const tints = (snow ? CFG.EZTREE.TINTS_SNOW : CFG.EZTREE.TINTS)[category];
  let cr = 1, cg = 1, cb = 1;
  if (tints) {
    let tTotal = 0;
    for (const t of tints) tTotal += t.w;
    let tRoll = rng(0, tTotal);
    let pick = tints[tints.length - 1];
    for (const t of tints) {
      tRoll -= t.w;
      if (tRoll <= 0) { pick = t; break; }
    }
    const b = snow ? rng(0.9, 1.05) : rng(0.85, 1.1);
    cr = pick.c[0] * b; cg = pick.c[1] * b; cb = pick.c[2] * b;
  }
  variant.colors.push(cr, cg, cb, 1);
  return { height };
}

/**
 * Build the thin-instance buffers for every variant of `category` and
 * register the meshes with the render passes (sun shadows, fog depth).
 * The water-mirror render list picks the meshes up by 'ezTree_' name prefix
 * in terrainMeshes.js.
 */
export function finalizeEz(category) {
  const list = _byCategory.get(category);
  if (!list) return;
  for (const v of list) {
    if (!v.matrices || v.matrices.length === 0) continue; // finalized already / nothing placed — stays as-is
    const buf = new Float32Array(v.matrices);
    for (const mesh of [v.branches, v.leaves]) {
      mesh.setEnabled(true);
      mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
      // Expand bounding info over all instances — the fog depth pass frustum-
      // culls via mesh.isInFrustum, and a stale origin-sized box would cull
      // the whole batch away (fog-ghosted vegetation)
      mesh.thinInstanceRefreshBoundingInfo();
      // Sun shadow (renders EVERY FRAME on WebGPU): trees cast with full
      // geometry; bushes cast leaves-only — a shrub's branch tubes are
      // invisible inside its own leaf shadow blob, and 90 bushes' branches
      // are pure vertex-stage waste in the shadow map
      if (v.def.category !== 'bush' || mesh === v.leaves) {
        addShadowCaster(mesh); // Babylon shadow maps alpha-test leaf materials
      }
      addFogDepthMesh(mesh); // silhouettes against sky MUST write fog depth
      mesh.freezeWorldMatrix();
    }
    // Per-instance leaf tint (autumn palette + jitter, queued by spawnEz).
    // 'color' is a Babylon built-in thin-instance attribute — StandardMaterial
    // multiplies it in like a vertex color; channels >1 brighten (verified on
    // WebGPU). Leaves only — bark keeps its material tint.
    v.leaves.thinInstanceSetBuffer('color', new Float32Array(v.colors), 4, true);
    enableShadowReceiving(v.branches);
    v.matrices = null; // buffers uploaded — release the staging arrays
    v.colors = null;
    console.log(`[EZTREE] ${v.def.id}: ${buf.length / 16} instances`);
  }
}
