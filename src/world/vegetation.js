import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3,
         Vector3, Matrix, Quaternion, VertexData, SceneLoader } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, setCell, markTreeCell, isTreeCell, isRoadCell, isNearRoad } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rng, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { createStaticSphere, createStaticCylinder, hasLineOfSight, ROCK_COLLISION_GROUP } from '../core/physics.js';
import { spawnEz, finalizeEz } from './ezTreeFactory.js';

let rockTex;

const rockColliders = [];

// Tree positions for foliage collision checks
const treePosData = []; // { x, z, ty, scale }

export function getRockTexture(scene) {
  if (!rockTex) {
    rockTex = new Texture('./assets/textures/stone_wall.jpg', scene);
    rockTex.uScale = 1;
    rockTex.vScale = 1;
  }
  return rockTex;
}

/**
 * Circle-based collision check against all rocks.
 * Returns true if the circle (wx, wz, entityR) overlaps any rock.
 * If entityY is provided, skip rocks whose top is below entityY (jumpable).
 */
export function collidesWithRock(wx, wz, entityR, entityY) {
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    if (entityY !== undefined && entityY >= rc.top - rc.height * 0.3) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const minDist = entityR + rc.r;
    if (dx * dx + dz * dz < minDist * minDist) return true;
  }
  return false;
}

/**
 * Returns a push-back vector to resolve the deepest rock overlap, or null.
 * If entityY is provided, skip rocks whose top is below entityY (jumpable).
 */
export function getRockPushback(wx, wz, entityR, entityY) {
  let worstPen = 0;
  let pushX = 0, pushZ = 0;

  for (const rc of rockColliders) {
    if (!rc.active) continue;
    if (entityY !== undefined && entityY >= rc.top - rc.height * 0.3) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = entityR + rc.r;
    const pen = minDist - dist;
    if (pen > worstPen && dist > 0) {
      worstPen = pen;
      pushX = (dx / dist) * pen;
      pushZ = (dz / dist) * pen;
    }
  }

  return worstPen > 0 ? { x: pushX, z: pushZ } : null;
}

/**
 * Returns the top Y of the highest rock the point is standing on, or null.
 */
export function getRockSurfaceHeight(wx, wz, currentY) {
  let bestTop = null;
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const standR = rc.r * 0.6;
    if (dx * dx + dz * dz < standR * standR) {
      const threshold = rc.top - rc.height * 0.3;
      if (currentY >= threshold) {
        if (bestTop === null || rc.top > bestTop) {
          bestTop = rc.top;
        }
      }
    }
  }
  return bestTop;
}

// ─── Zoned tree placement ────────────────────────────────────────────────────
// The map is planted with intent instead of uniform scatter:
//   - FORESTS: single-species stands (separate pine forests and leafy
//     forests) around centers picked far from the roads,
//   - ROADSIDE: sparse ornamental leafy trees lining the road verges,
//   - SCATTERED: a few lone trees anywhere valid.

// BFS distance-to-nearest-road-cell over the walk grid, in cells (4-connected,
// ~Manhattan). Roads span the map so the flood reaches everywhere.
function computeRoadDistField() {
  const N = CFG.GRID;
  const d = Array.from({ length: N }, () => new Array(N).fill(Infinity));
  const q = [];
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      if (isRoadCell(x, z)) { d[x][z] = 0; q.push(x, z); }
    }
  }
  for (let head = 0; head < q.length; head += 2) {
    const x = q[head], z = q[head + 1], nd = d[x][z] + 1;
    if (x + 1 < N && d[x + 1][z] > nd) { d[x + 1][z] = nd; q.push(x + 1, z); }
    if (x - 1 >= 0 && d[x - 1][z] > nd) { d[x - 1][z] = nd; q.push(x - 1, z); }
    if (z + 1 < N && d[x][z + 1] > nd) { d[x][z + 1] = nd; q.push(x, z + 1); }
    if (z - 1 >= 0 && d[x][z - 1] > nd) { d[x][z - 1] = nd; q.push(x, z - 1); }
  }
  return d;
}

// Shared placement validity (bounds, walkable, off roads/verges, off the
// spawn clearing, clear of buildings, on land)
function treeCellOk(gx, gz, grid, buildings, clearance) {
  if (gx < 1 || gx > CFG.GRID - 2 || gz < 1 || gz > CFG.GRID - 2) return false;
  if (!grid[gx][gz]) return false;
  if (isNearRoad(gx, gz, 1)) return false;
  if (Math.abs(gx - CFG.GRID / 2) < 5 && Math.abs(gz - CFG.GRID / 2) < 5) return false;
  for (const b of buildings) {
    if (gx >= b.x - clearance && gx < b.x + b.w + clearance &&
        gz >= b.z - clearance && gz < b.z + b.h + clearance) return false;
  }
  const p = g2w(gx, gz);
  if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y) return false;
  return true;
}

// Trunk tubes are open-bottomed cylinders — the rim must sit below the LOWEST
// ground the base can meet. Sample the analytic height around the trunk
// (slopes), then sink further for the coarse rendered lattice, which can dip
// a couple tenths below the analytic surface (measured on the road work).
function trunkBaseY(x, z, sink) {
  let y = getTerrainHeight(x, z);
  y = Math.min(y, getTerrainHeight(x + 0.7, z), getTerrainHeight(x - 0.7, z),
               getTerrainHeight(x, z + 0.7), getTerrainHeight(x, z - 0.7));
  return y - sink;
}

// Forest zones live for the whole world build — placeBushes seeds undergrowth
// around the same centers. { gx, gz, r (cells), type: 'pine'|'leafy' }
let _forestZones = [];

export function getForestZones() { return _forestZones; }

function placeOneTree(gx, gz, category) {
  const p = g2w(gx, gz);
  setCell(gx, gz, false);
  markTreeCell(gx, gz);
  const ty = getTerrainHeight(p.x, p.z);
  const spawned = spawnEz(category, p.x, trunkBaseY(p.x, p.z, CFG.EZTREE.SINK), p.z);
  if (!spawned) return false;
  const h = spawned.height;
  treePosData.push({ x: p.x, z: p.z, ty, scale: h / 5 });
  // Trunk physics: lower trunk only — the canopy has no collision
  const trunkR = Math.min(0.45, Math.max(0.18, h * 0.04));
  const colH = h * 0.45;
  createStaticCylinder(trunkR, colH / 2, p.x, ty + colH / 2, p.z);
  return true;
}

export function placeTrees(scene) {
  const grid = getGrid();
  const buildings = getBuildings();
  const roadDist = computeRoadDistField();
  const Z = CFG.EZTREE.ZONING;

  // Chebyshev spacing between placed trees (forests breathe, roadside stays
  // sparse) — tracked per-cell across all three passes
  const taken = new Set();
  const spaced = (gx, gz, r) => {
    for (let ox = -r; ox <= r; ox++) {
      for (let oz = -r; oz <= r; oz++) {
        if (taken.has((gx + ox) * 1000 + gz + oz)) return false;
      }
    }
    return true;
  };

  // ---- forest zone centers: far from roads, apart from each other --------
  _forestZones = [];
  const wantZones = [];
  for (let i = 0; i < Z.PINE_FORESTS; i++) wantZones.push('pine');
  for (let i = 0; i < Z.LEAFY_FORESTS; i++) wantZones.push(CFG.SNOW_MODE ? 'pine' : 'leafy');
  for (const type of wantZones) {
    for (let tries = 0; tries < 300; tries++) {
      const gx = rngInt(8, CFG.GRID - 9);
      const gz = rngInt(8, CFG.GRID - 9);
      if (roadDist[gx][gz] < Z.FOREST_ROAD_DIST) continue;
      if (!treeCellOk(gx, gz, grid, buildings, 2)) continue;
      if (_forestZones.some(f => Math.hypot(f.gx - gx, f.gz - gz) < Z.FOREST_SEPARATION)) continue;
      _forestZones.push({ gx, gz, r: rngInt(Z.FOREST_R[0], Z.FOREST_R[1]), type });
      break;
    }
  }

  // ---- budgets ------------------------------------------------------------
  const nRoadside = Math.round(CFG.TREES * Z.ROADSIDE_SHARE);
  const nScattered = Math.round(CFG.TREES * Z.SCATTERED_SHARE);
  const nForest = CFG.TREES - nRoadside - nScattered;

  // ---- forests: dense single-species stands (uniform disc around center) --
  if (_forestZones.length > 0) {
    const perZone = Math.ceil(nForest / _forestZones.length);
    for (const zone of _forestZones) {
      let placed = 0;
      for (let i = 0; i < perZone * 8 && placed < perZone; i++) {
        const ang = rng(0, Math.PI * 2);
        const rad = zone.r * Math.sqrt(rng(0, 1));
        const gx = zone.gx + Math.round(Math.cos(ang) * rad);
        const gz = zone.gz + Math.round(Math.sin(ang) * rad);
        if (!treeCellOk(gx, gz, grid, buildings, 2)) continue;
        if (roadDist[gx][gz] < Z.FOREST_ROAD_DIST - zone.r) continue; // forest never spills onto the road
        if (!spaced(gx, gz, 1)) continue; // 1-cell gap: dense but not merged
        if (placeOneTree(gx, gz, zone.type)) { taken.add(gx * 1000 + gz); placed++; }
      }
    }
  }

  // ---- roadside: sparse ornamental leafy trees lining the verges ----------
  let roadsidePlaced = 0;
  for (let i = 0; i < nRoadside * 30 && roadsidePlaced < nRoadside; i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);
    const d = roadDist[gx][gz];
    if (d < 2 || d > 3) continue; // just off the verge, clearly "planted along the road"
    if (!treeCellOk(gx, gz, grid, buildings, 2)) continue;
    if (!spaced(gx, gz, 3)) continue; // avenue spacing, not a wall of trees
    if (placeOneTree(gx, gz, CFG.SNOW_MODE ? 'pine' : 'leafy')) {
      taken.add(gx * 1000 + gz);
      roadsidePlaced++;
    }
  }

  // ---- scattered: lone trees anywhere valid, clear of roads and forests ---
  let scatteredPlaced = 0;
  for (let i = 0; i < nScattered * 10 && scatteredPlaced < nScattered; i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);
    if (roadDist[gx][gz] < 4) continue;
    if (!treeCellOk(gx, gz, grid, buildings, 2)) continue;
    if (!spaced(gx, gz, 2)) continue;
    const category = CFG.SNOW_MODE || rng(0, 1) < 0.3 ? 'pine' : 'leafy';
    if (placeOneTree(gx, gz, category)) { taken.add(gx * 1000 + gz); scatteredPlaced++; }
  }

  // Upload thin-instance buffers + register shadow/fog-depth per variant
  finalizeEz('leafy');
  finalizeEz('pine');
}

/**
 * Bushes — ez-tree Bush presets, thin-instanced (2 draw calls per variant).
 * Bushes don't block the grid or have physics — the player walks through.
 */
export function placeBushes(scene) {
  const grid = getGrid();
  const buildings = getBuildings();
  const roadDist = computeRoadDistField();
  let placed = 0;

  for (let i = 0; i < CFG.BUSHES * 6 && placed < CFG.BUSHES; i++) {
    let gx, gz;
    // Bushes read as undergrowth, not scatter: most hug the forest edges,
    // some line the road verges, the rest go anywhere valid.
    const roll = rng(0, 1);
    if (roll < 0.55 && _forestZones.length > 0) {
      // Forest edge ring (just inside to well outside the tree line)
      const zone = _forestZones[rngInt(0, _forestZones.length - 1)];
      const ang = rng(0, Math.PI * 2);
      const rad = zone.r * rng(0.8, 1.6);
      gx = zone.gx + Math.round(Math.cos(ang) * rad);
      gz = zone.gz + Math.round(Math.sin(ang) * rad);
      if (gx < 1 || gx > CFG.GRID - 2 || gz < 1 || gz > CFG.GRID - 2) continue;
    } else if (roll < 0.75) {
      // Road verge band
      gx = rngInt(1, CFG.GRID - 2);
      gz = rngInt(1, CFG.GRID - 2);
      const d = roadDist[gx][gz];
      if (d < 2 || d > 4) continue;
    } else {
      gx = rngInt(1, CFG.GRID - 2);
      gz = rngInt(1, CFG.GRID - 2);
    }

    if (!grid[gx][gz]) continue;
    if (isNearRoad(gx, gz, 1)) continue; // clear of the road and its curved verges
    if (Math.abs(gx - CFG.GRID / 2) < 4 && Math.abs(gz - CFG.GRID / 2) < 4) continue;

    let inside = false;
    for (const b of buildings) {
      if (gx >= b.x - 1 && gx < b.x + b.w + 1 && gz >= b.z - 1 && gz < b.z + b.h + 1) {
        inside = true;
        break;
      }
    }
    if (inside) continue;

    const p = g2w(gx, gz);
    if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y + 0.2) continue;

    // Bushes place after rocks — never grow one inside a boulder
    if (collidesWithRock(p.x, p.z, 0.7)) continue;

    // Shallower than trees, but still below the lowest nearby rendered ground
    // — bush stems are open tubes too
    spawnEz('bush', p.x, trunkBaseY(p.x, p.z, CFG.EZTREE.SINK * 0.6), p.z);
    placed++;
  }

  finalizeEz('bush');
}

/**
 * Grass tufts — a single 5-blade fan mesh drawn thousands of times via thin
 * instances (1 draw call total). Clumped into meadows by a smooth sine field
 * so coverage reads as patches instead of uniform noise. No physics, no
 * shadow casting; normals point up so blades shade like the ground.
 */
/** Loads a GLB (FULL literal './assets/...' path — the production build
 *  content-hashes asset filenames and rewrites full path literals in the
 *  bundle, so never build these URLs by concatenation), returns a single
 *  unparented mesh (multi-mesh files get merged, materials preserved) with
 *  transforms baked, plus its bounding height — a thin-instance template. */
async function loadEzTemplate(scene, url) {
  const cut = url.lastIndexOf('/') + 1;
  const res = await SceneLoader.ImportMeshAsync('', url.slice(0, cut), url.slice(cut), scene);
  const real = res.meshes.filter(m => m.getTotalVertices() > 0);
  let tmpl;
  if (real.length > 1) {
    tmpl = Mesh.MergeMeshes(real, true, true, undefined, false, true);
  } else {
    tmpl = real[0];
    tmpl.setParent(null);
    tmpl.bakeCurrentTransformIntoVertices();
  }
  // dispose leftover empty transform nodes (gltf __root__ etc.)
  for (const m of res.meshes) if (m !== tmpl && !m.isDisposed()) m.dispose();
  tmpl.refreshBoundingInfo();
  const bb = tmpl.getBoundingInfo().boundingBox;
  return { tmpl, height: bb.maximum.y - bb.minimum.y };
}

export async function placeGrass(scene) {
  if (CFG.SNOW_MODE) return; // buried under snow

  // Grass clump model from the ez-tree demo app (MIT) — real blade geometry,
  // not alpha cards, so no cutout/mip issues. One thin-instanced draw call.
  const { tmpl: tuft, height: rawH } = await loadEzTemplate(scene, './assets/models/eztree/grass.glb');
  tuft.name = 'grassTufts';
  const norm = 0.58 / rawH; // world-unit clump height before per-instance jitter

  // Straight-up normals: blades inherit the ground's lighting instead of
  // going dark side-on at low sun angles (same trick the old tufts used)
  const nVerts = tuft.getTotalVertices();
  const upNormals = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) upNormals[i * 3 + 1] = 1;
  tuft.setVerticesData('normal', upNormals);

  const mat = new StandardMaterial('grassTuftMat', scene);
  const loadedTex = tuft.material && tuft.material.albedoTexture;
  mat.diffuseTexture = loadedTex || new Texture('./assets/models/eztree/grass.jpg', scene);
  // The clump is a few crossed CARDS — the blade shapes live in the texture's
  // alpha channel (same recipe as the old foliage cards: alpha TEST, no blend)
  mat.diffuseTexture.hasAlpha = true;
  mat.useAlphaFromDiffuseTexture = false;
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.04, 0.07, 0.03); // never fully black in shade
  mat.backFaceCulling = false;
  // NO twoSidedLighting: it flips the hand-set up-normals to DOWN on
  // back-winding blades (near-black tufts). Culling off + up normals is
  // exactly the old tuft recipe — both sides take the ground's lighting.
  tuft.material = mat;

  const grid = getGrid();
  const buildings = getBuildings();
  const matrices = [];
  const instColors = [];
  const m = new Matrix();
  const q = Quaternion.Identity();
  const scl = new Vector3();
  const pos = new Vector3();

  // Building footprints as a lookup — interior floor cells are WALKABLE in
  // the grid, so grid[x][z] alone lets grass grow through the floor slabs
  const inBuilding = (gx, gz) => {
    for (const b of buildings) {
      if (gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h) return true;
    }
    return false;
  };

  for (let gx = 1; gx < CFG.GRID - 1; gx++) {
    for (let gz = 1; gz < CFG.GRID - 1; gz++) {
      if (!grid[gx][gz]) continue;
      if (inBuilding(gx, gz)) continue;
      if (isRoadCell(gx, gz)) continue; // packed dirt — no grass tufts
      // Meadow clumps: smooth patch field + per-cell thinning
      const clump = 0.5 + 0.5 * Math.sin(gx * 0.31 + 1.7) * Math.sin(gz * 0.27 + 4.2);
      if (clump < 0.4) continue;
      const p = g2w(gx, gz);
      const tufts = clump > 0.75 ? 4 : 3;
      for (let t = 0; t < tufts; t++) {
        const wx = p.x + rng(-0.9, 0.9);
        const wz = p.z + rng(-0.9, 0.9);
        const wy = getTerrainHeight(wx, wz);
        if (wy < CFG.WATER_Y + 0.15) continue;
        const s = rng(0.7, 1.5) * norm;
        scl.set(s, s * rng(0.8, 1.3), s);
        Quaternion.RotationYawPitchRollToRef(rng(0, Math.PI * 2), 0, 0, q);
        pos.set(wx, wy - 0.02, wz);
        Matrix.ComposeToRef(scl, q, pos, m);
        const base = matrices.length;
        matrices.length += 16;
        m.copyToArray(matrices, base);
        // per-tuft tint MULTIPLIES the blade texture — bright meadow greens,
        // slightly deeper in sparse cells so patches read as variation
        const v = 0.85 + clump * 0.15;
        instColors.push(rng(0.75, 0.95) * v, rng(0.95, 1.2) * v, rng(0.5, 0.7) * v, 1);
      }
    }
  }

  if (matrices.length === 0) { tuft.dispose(); return; }
  tuft.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  tuft.thinInstanceSetBuffer('color', new Float32Array(instColors), 4, true);
  tuft.alwaysSelectAsActiveMesh = true; // one draw call — skip culling math
  tuft.isPickable = false;
  // No shadow receive: invisible at tuft scale, and shadow-sampling 100k+
  // grass vertices' pixels costs real GPU time
  tuft.freezeWorldMatrix();
  console.log(`[GRASS] ${instColors.length / 4} tufts x ${tuft.getTotalVertices()} verts (1 draw call)`);

  await placeFlowers(scene, grid, buildings, inBuilding);
}

/** Wildflowers from the ez-tree demo app (MIT): white/blue/yellow GLB
 *  clusters thin-instanced across grassy cells — 1 draw call per color. */
async function placeFlowers(scene, grid, buildings, inBuilding) {
  const kinds = [
    ['./assets/models/eztree/flower_white.glb', 'flowersWhite', 55],
    ['./assets/models/eztree/flower_yellow.glb', 'flowersYellow', 50],
    ['./assets/models/eztree/flower_blue.glb', 'flowersBlue', 35],
  ];
  const m = new Matrix();
  const q = Quaternion.Identity();
  const scl = new Vector3();
  const pos = new Vector3();
  for (const [file, name, count] of kinds) {
    const { tmpl, height: rawH } = await loadEzTemplate(scene, file);
    tmpl.name = name;
    const norm = 0.32 / rawH;
    const matrices = [];
    for (let i = 0; i < count * 12 && matrices.length / 16 < count; i++) {
      const gx = rngInt(1, CFG.GRID - 2);
      const gz = rngInt(1, CFG.GRID - 2);
      if (!grid[gx][gz]) continue;
      if (inBuilding(gx, gz)) continue;
      if (isRoadCell(gx, gz)) continue;
      const p = g2w(gx, gz);
      const wx = p.x + rng(-0.8, 0.8);
      const wz = p.z + rng(-0.8, 0.8);
      const wy = getTerrainHeight(wx, wz);
      if (wy < CFG.WATER_Y + 0.15) continue;
      const s = rng(0.8, 1.3) * norm;
      scl.set(s, s, s);
      Quaternion.RotationYawPitchRollToRef(rng(0, Math.PI * 2), 0, 0, q);
      pos.set(wx, wy - 0.02, wz);
      Matrix.ComposeToRef(scl, q, pos, m);
      const base = matrices.length;
      matrices.length += 16;
      m.copyToArray(matrices, base);
    }
    if (matrices.length === 0) { tmpl.dispose(); continue; }
    tmpl.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
    tmpl.alwaysSelectAsActiveMesh = true; // tiny meshes, 1 draw call each
    tmpl.isPickable = false;
    tmpl.freezeWorldMatrix();
  }
}

export function placeRocks(scene) {
  const rockMat = new StandardMaterial('rockMat', scene);
  rockMat.diffuseTexture = getRockTexture(scene);
  rockMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const grid = getGrid();
  const buildings = getBuildings();
  const mergedRockMeshes = [];

  const totalRocks = CFG.ROCKS + CFG.THROWABLE_STONES;
  let placedPebbles = 0;
  let placedEnv = 0;

  for (let i = 0; i < totalRocks * 3 && (placedPebbles < CFG.THROWABLE_STONES || placedEnv < CFG.ROCKS); i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);

    if (!grid[gx][gz]) continue;
    // Full-cell margin: boulders reach ~1.5u past their cell and the
    // smoothed road ribbon cuts corners across neighboring cells
    if (isNearRoad(gx, gz, 1)) continue;
    if (Math.abs(gx - CFG.GRID / 2) < 5 && Math.abs(gz - CFG.GRID / 2) < 5) continue;

    let inside = false;
    for (const b of buildings) {
      if (gx >= b.x - 1 && gx < b.x + b.w + 1 && gz >= b.z - 1 && gz < b.z + b.h + 1) {
        inside = true;
        break;
      }
    }
    if (inside) continue;

    let nearDoor = false;
    for (const b of buildings) {
      for (const d of b.doors) {
        if (Math.abs(gx - d.gx) <= 2 && Math.abs(gz - d.gz) <= 2) {
          nearDoor = true;
          break;
        }
      }
      if (nearDoor) break;
    }
    if (nearDoor) continue;

    const p0 = g2w(gx, gz);
    if (getTerrainHeight(p0.x, p0.z) < CFG.WATER_Y) continue;

    // Boulders bulge ~1.5u past their own cell — never grow one against a
    // tree trunk placed earlier (reads as a tree sprouting from the rock)
    let nearTree = false;
    for (let tox = -1; tox <= 1 && !nearTree; tox++) {
      for (let toz = -1; toz <= 1; toz++) {
        if (isTreeCell(gx + tox, gz + toz)) { nearTree = true; break; }
      }
    }
    if (nearTree) continue;

    let s;
    if (placedPebbles < CFG.THROWABLE_STONES && (placedEnv >= CFG.ROCKS || Math.random() < 0.3)) {
      s = CFG.THROWN_STONE_SIZE;
      placedPebbles++;
    } else if (placedEnv < CFG.ROCKS) {
      const r = Math.random();
      if (r < 0.2) {
        s = rng(1.5, 2.5);
      } else if (r < 0.5) {
        s = rng(0.9, 1.5);
      } else {
        s = rng(0.6, 0.9);
      }
      placedEnv++;
    } else {
      continue;
    }

    if (s > 1.2) setCell(gx, gz, false);

    const ox = rng(-0.3, 0.3);
    const oz = rng(-0.3, 0.3);
    const ty = getTerrainHeight(p0.x + ox, p0.z + oz);
    const rx = rng(0, Math.PI);
    const ry = rng(0, Math.PI);

    const pickable = s <= CFG.ROCK_PICK_MAX_SIZE;

    if (pickable) {
      // Pickable rocks stay individual (can be hidden on pickup)
      const rock = MeshBuilder.CreateIcoSphere('pickableRock', { radius: s, subdivisions: 2 }, scene);
      rock.position = new Vector3(p0.x + ox, ty + s * 0.4, p0.z + oz);
      rock.rotation = new Vector3(rx, ry, 0);
      rock.material = rockMat;
      // Pickable rocks are tiny — skip sun shadow to save draw calls
      enableShadowReceiving(rock);

      const rc = {
        x: p0.x + ox, z: p0.z + oz,
        r: s * 0.85, top: ty + s * 0.8, height: s * 0.8,
        mesh: rock, size: s, active: true,
      };
      if (s > 0.5) {
        rc.physicsBody = createStaticSphere(s * 0.75, p0.x + ox, ty + s * 0.4, p0.z + oz, undefined, ROCK_COLLISION_GROUP);
      }
      rockColliders.push(rc);
    } else {
      // Non-pickable rocks — bake transform into mesh for merging
      const rockMesh = MeshBuilder.CreateIcoSphere('_rock', { radius: s, subdivisions: 2 }, scene);
      rockMesh.position = new Vector3(p0.x + ox, ty + s * 0.4, p0.z + oz);
      rockMesh.rotation = new Vector3(rx, ry, 0);
      rockMesh.bakeCurrentTransformIntoVertices();
      mergedRockMeshes.push(rockMesh);

      const rc = {
        x: p0.x + ox, z: p0.z + oz,
        r: s * 0.85, top: ty + s * 0.8, height: s * 0.8,
        mesh: null, size: s, active: true,
      };
      if (s > 0.5) {
        rc.physicsBody = createStaticSphere(s * 0.75, p0.x + ox, ty + s * 0.4, p0.z + oz, undefined, ROCK_COLLISION_GROUP);
      }
      rockColliders.push(rc);
    }
  }

  // Merge all non-pickable rocks into 1 draw call
  if (mergedRockMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(mergedRockMeshes, true, true, undefined, false, true);
    merged.name = 'mergedRocks';
    merged.material = rockMat;
    merged.convertToFlatShadedMesh();
    addShadowCaster(merged);
    enableShadowReceiving(merged);
  }
}

/**
 * Returns the top Y of the highest rock that overlaps (wx, wz) from above.
 * Used for stacking placed rocks on existing rocks.
 */
export function getRockStackHeight(wx, wz, currentY) {
  let bestTop = null;
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    if (dx * dx + dz * dz < rc.r * rc.r) {
      if (currentY > rc.top - 0.1) {
        if (bestTop === null || rc.top > bestTop) {
          bestTop = rc.top;
        }
      }
    }
  }
  return bestTop;
}

/**
 * Returns the top Y of the first rock collider the ray point is inside.
 * Used for rock placement preview ray-march.
 */
export function findRockSurface(wx, wz, wy) {
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    if (dx * dx + dz * dz < rc.r * rc.r) {
      if (wy <= rc.top + 0.2 && wy >= rc.top - rc.height) {
        return rc.top;
      }
    }
  }
  return null;
}

/**
 * Check if a world position is inside any tree's foliage area.
 * Returns a damping factor (0-1, where 0 = full stop, 1 = no effect), or null if not in foliage.
 */
export function getTreeFoliageDamping(wx, wy, wz) {
  for (const t of treePosData) {
    const dx = wx - t.x;
    const dz = wz - t.z;
    const hDist = Math.sqrt(dx * dx + dz * dz);
    const foliageR = t.scale * 1.3; // foliage radius (scaled cones)
    if (hDist > foliageR) continue;
    const trunkTop = t.ty + t.scale * 1.4; // scaled trunk top
    const foliageTop = t.ty + t.scale * 5.0; // top of foliage
    if (wy < trunkTop || wy > foliageTop) continue;
    // Inside foliage — return damping (closer to center = more damping)
    const centerDist = hDist / foliageR;
    return 0.3 + 0.5 * centerDist; // 0.3 at center, 0.8 at edge
  }
  return null;
}

export function registerPickableRock(mesh, x, z, size) {
  const top = mesh.position.y + size * 0.4;
  const rc = {
    x, z,
    r: size * 0.85, top, height: size * 0.8,
    mesh, size, active: true,
  };
  rc.physicsBody = createStaticSphere(size * 0.85, x, mesh.position.y, z, undefined, ROCK_COLLISION_GROUP);
  rockColliders.push(rc);
}

/**
 * Returns a pickable rock near world position (wx, wz, wy), or null.
 * Used for projectile-on-rock knockback detection.
 */
export function getPickableRockNear(wx, wz, wy, hitRadius) {
  for (const rc of rockColliders) {
    if (!rc.active || rc.size > CFG.ROCK_PICK_MAX_SIZE) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const dy = wy - (rc.top - rc.height * 0.4);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < hitRadius + rc.size * 0.5) return rc;
  }
  return null;
}

/**
 * Deactivate a rock collider (for knockback conversion to projectile).
 * Caller must handle physics body removal.
 */
export function deactivateRock(rc) {
  rc.active = false;
  if (rc.mesh) rc.mesh.isVisible = false;
}

export function getNearestPickableRock() {
  const p = getPlayerState();
  const cam = getCamera();
  if (!cam) return null;

  let best = null;
  let bestDot = -Infinity;

  const eyePos = { x: p.x, y: p.y + CFG.PLAYER_H * 0.8, z: p.z };
  const viewDir = cam.getForwardRay(1).direction;

  for (const rc of rockColliders) {
    if (!rc.active || rc.size > CFG.ROCK_PICK_MAX_SIZE) continue;
    const dx = p.x - rc.x;
    const dz = p.z - rc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist > CFG.ROCK_PICK_DIST) continue;

    const rockPos = new Vector3(rc.x, rc.top, rc.z);
    const toTarget = rockPos.subtract(new Vector3(eyePos.x, eyePos.y, eyePos.z)).normalize();
    const dot = Vector3.Dot(viewDir, toTarget);

    if (dot > 0.4 && dot > bestDot) {
      if (!hasLineOfSight(eyePos, rockPos, ROCK_COLLISION_GROUP.membership)) continue;
      bestDot = dot;
      best = rc;
    }
  }
  return best;
}

export function pickNearestRock(inventory) {
  const rc = getNearestPickableRock();
  if (!rc) return false;
  rc.active = false;
  if (rc.mesh) rc.mesh.isVisible = false;
  inventory.stones++;
  return true;
}

const _projRock = new Vector3();

/** Returns all active pickable rocks (for minimap display) */
export function getPickableRocks() {
  return rockColliders.filter(rc => rc.active && rc.size <= CFG.ROCK_PICK_MAX_SIZE);
}

export function updateRockHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;
  if (el.style.display === 'block' &&
    (el.dataset.source === 'door' || el.dataset.source === 'soldier' || el.dataset.source === 'flower')) return;

  const rock = getNearestPickableRock();
  if (!rock) {
    if (el.dataset.source === 'rock') { el.style.display = 'none'; el.dataset.source = ''; }
    return;
  }

  const camera = getCamera();
  const scn = camera.getScene();
  const engine = scn.getEngine();

  // Project rock world position to screen coordinates
  const worldPos = new Vector3(rock.x, rock.top + 0.3, rock.z);
  const projected = Vector3.Project(
    worldPos,
    Matrix.Identity(),
    scn.getTransformMatrix(),
    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  );

  // Check if behind camera (z > 1 in NDC equivalent)
  if (projected.z > 1) {
    if (el.dataset.source === 'rock') el.style.display = 'none';
    return;
  }

  el.textContent = '[E] Pick up';
  el.style.fontSize = '21px';
  el.style.left = projected.x + 'px';
  el.style.top = projected.y + 'px';
  el.style.display = 'block';
  el.dataset.source = 'rock';
}
