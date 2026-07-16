import { Mesh, VertexData, StandardMaterial, Color3, DynamicTexture, Texture } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, markRoadCell, isRoadCell, isIndoor } from './grid.js';
import { g2w, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { enableShadowReceiving } from '../core/lighting.js';
import { createGroundTorch, getTorchLights, getPickableTorches } from './torches.js';
import { addTorchEmbers } from './torchParticles.js';

// Ordered cell polylines, one per road (main road first, then branches).
// Cells are also marked in grid.js roadCells — roads stay WALKABLE.
const roadPaths = [];

export function getRoadPaths() { return roadPaths; }

/** A cell a road may pass through: inside edge margin, off the spawn
 *  clearing, and above the waterline (routes around lakes). */
function roadCellOk(gx, gz) {
  const m = CFG.ROAD_EDGE_MARGIN;
  if (gx < m || gx >= CFG.GRID - m || gz < m || gz >= CFG.GRID - m) return false;
  // Near — but never through — the map center (spawn clearing)
  const c = CFG.GRID / 2;
  if (Math.abs(gx - c) <= CFG.PLAYER_CLEAR + 1 && Math.abs(gz - c) <= CFG.PLAYER_CLEAR + 1) return false;
  const p = g2w(gx, gz);
  if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y + 0.3) return false;
  return true;
}

/**
 * Greedy axis walker: marches along forward dir (dax,daz) from a start cell,
 * drifting sideways at random for a natural wander, and routing laterally
 * around blocked cells (water, edge margin, spawn clearing). Cells are NOT
 * marked here — the caller commits accepted paths. Returns the ordered
 * 4-connected cell path (may stop early at a dead end).
 */
function carveRoad(startGx, startGz, dax, daz, maxSteps) {
  const lax = -daz, laz = dax; // lateral axis (perpendicular to forward)
  let gx = startGx, gz = startGz;
  if (!roadCellOk(gx, gz)) return null;
  const path = [{ gx, gz }];
  let sinceTurn = 0;

  for (let i = 0; i < maxSteps; i++) {
    // Gentle wander: sidestep 1 cell every few steps (keeps direction changes soft)
    if (sinceTurn >= 3 && Math.random() < 0.3) {
      const s = Math.random() < 0.5 ? 1 : -1;
      const sx = gx + lax * s, sz = gz + laz * s;
      if (roadCellOk(sx, sz) && roadCellOk(sx + dax, sz + daz)) {
        path.push({ gx: sx, gz: sz });
        gx = sx; gz = sz;
        sinceTurn = 0;
      }
    }

    let nx = gx + dax, nz = gz + daz;

    if (!roadCellOk(nx, nz)) {
      // Blocked ahead — try lateral detours of growing size around the obstacle
      let routed = false;
      const sides = Math.random() < 0.5 ? [1, -1] : [-1, 1];
      for (let off = 1; off <= 8 && !routed; off++) {
        for (const s of sides) {
          const sx = gx + lax * off * s, sz = gz + laz * off * s;
          if (!roadCellOk(sx, sz) || !roadCellOk(sx + dax, sz + daz)) continue;
          // Every connector cell must be passable too (keeps path 4-connected)
          let clear = true;
          for (let k = 1; k <= off; k++) {
            if (!roadCellOk(gx + lax * k * s, gz + laz * k * s)) { clear = false; break; }
          }
          if (!clear) continue;
          for (let k = 1; k <= off; k++) {
            path.push({ gx: gx + lax * k * s, gz: gz + laz * k * s });
          }
          gx += lax * off * s; gz += laz * off * s;
          nx = gx + dax; nz = gz + daz;
          routed = true;
          sinceTurn = 0;
          break;
        }
      }
      if (!routed) break; // dead end (lake/edge too wide) — road terminates here
    }

    path.push({ gx: nx, gz: nz });
    gx = nx; gz = nz;
    sinceTurn++;
  }
  return path;
}

function commitPath(path) {
  for (const c of path) markRoadCell(c.gx, c.gz);
  roadPaths.push(path);
}

/**
 * Generate the village road network: one main road spanning the map past
 * (but not through) the center, plus 2-3 perpendicular branch roads.
 * Must run BEFORE generateBuildings — buildings orient to roads.
 */
export function generateRoads() {
  roadPaths.length = 0;
  const c = CFG.GRID / 2;
  const span = CFG.GRID - 2 * CFG.ROAD_EDGE_MARGIN;

  // Main road: carved OUTWARD from a near-center start in both directions —
  // the edge margins are often underwater, so edge-to-edge walks die
  // immediately. Retry a few center offsets, keep the longest result.
  const horizontal = Math.random() < 0.5;
  let main = null;
  for (let att = 0; att < 12; att++) {
    const off = (CFG.PLAYER_CLEAR + 2 + rngInt(0, 4)) * (Math.random() < 0.5 ? 1 : -1);
    const along = rngInt(-3, 3); // start jitter along the road axis
    const sgx = horizontal ? c + along : c + off;
    const sgz = horizontal ? c + off : c + along;
    const dax = horizontal ? 1 : 0;
    const daz = horizontal ? 0 : 1;
    const fwd = carveRoad(sgx, sgz, dax, daz, span);
    if (!fwd) continue;
    const back = carveRoad(sgx - dax, sgz - daz, -dax, -daz, span);
    const path = back ? back.reverse().concat(fwd) : fwd;
    if (!main || path.length > main.length) main = path;
    if (main.length >= span * 0.7) break;
  }
  if (!main || main.length < 10) {
    console.warn('[ROADS] Main road generation failed — no roads this world');
    return;
  }
  commitPath(main);

  // Branch roads: leave the main road perpendicularly, spaced apart
  const branchTarget = rngInt(CFG.ROAD_MIN_BRANCHES, CFG.ROAD_MAX_BRANCHES);
  const usedIdx = [];
  let placed = 0;
  for (let att = 0; att < 24 && placed < branchTarget; att++) {
    const idx = rngInt(Math.floor(main.length * 0.15), Math.floor(main.length * 0.85));
    if (usedIdx.some(u => Math.abs(u - idx) < 10)) continue;
    const start = main[idx];
    const s = Math.random() < 0.5 ? 1 : -1;
    const dax = horizontal ? 0 : s;
    const daz = horizontal ? s : 0;
    const path = carveRoad(start.gx + dax, start.gz + daz, dax, daz, rngInt(14, 30));
    if (!path || path.length < 8) continue;
    commitPath(path);
    usedIdx.push(idx);
    placed++;
  }
}

// ─── Road visuals ────────────────────────────────────────────────────────────

/** Procedural packed-dirt texture: brown base, worn blotches, fine speckle.
 *  Blotches are stamped at 3x3 wrapped offsets so the texture tiles seamlessly. */
function makeDirtTexture(scene) {
  const sz = 256;
  const tex = new DynamicTexture('roadDirtTex', sz, scene, true);
  const ctx = tex.getContext();

  ctx.fillStyle = '#7a6448'; // dusty packed-earth base
  ctx.fillRect(0, 0, sz, sz);

  const shades = ['#6b5334', '#83704e', '#75603f', '#8a7355', '#5f4a30', '#907a58'];
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = shades[Math.floor(Math.random() * shades.length)];
    ctx.globalAlpha = 0.10 + Math.random() * 0.18;
    const bx = Math.random() * sz;
    const by = Math.random() * sz;
    const rx = 8 + Math.random() * 28;
    const ry = 6 + Math.random() * 20;
    const rot = Math.random() * Math.PI;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        ctx.beginPath();
        ctx.ellipse(bx + ox * sz, by + oy * sz, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  // Per-pixel speckle — gravel/grit grain
  const img = ctx.getImageData(0, 0, sz, sz);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.8;
  }
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/** Terrain normal via central differences (matches analytic heightmap). */
function terrainNormal(x, z) {
  const e = 0.5;
  const hx = getTerrainHeight(x + e, z) - getTerrainHeight(x - e, z);
  const hz = getTerrainHeight(x, z + e) - getTerrainHeight(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return [nx / l, ny / l, nz / l];
}

/**
 * Merged flat ribbon mesh over the road cells. Per cell: one quad conforming
 * to terrain height, inset on open sides (ROAD_WIDTH) and extended to the
 * full cell edge toward road neighbors so quads join into a continuous path.
 * Must run AFTER generateBuildings — building flat zones alter terrain height.
 */
export function buildRoadMesh(scene) {
  const seen = new Set();
  const cells = [];
  for (const path of roadPaths) {
    for (const cell of path) {
      const k = `${cell.gx},${cell.gz}`;
      if (seen.has(k)) continue; // paths can share cells (branch junctions)
      seen.add(k);
      cells.push(cell);
    }
  }
  if (cells.length === 0) return;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const inset = CFG.ROAD_WIDTH / 2;
  const full = CFG.CELL / 2;
  const yOff = CFG.ROAD_Y_OFFSET;

  for (const cell of cells) {
    const p = g2w(cell.gx, cell.gz);
    const w = (dx, dz) => (isRoadCell(cell.gx + dx, cell.gz + dz) ? full : inset);
    const x0 = p.x - w(-1, 0), x1 = p.x + w(1, 0);
    const z0 = p.z - w(0, -1), z1 = p.z + w(0, 1);

    const base = positions.length / 3;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (const [x, z] of corners) {
      positions.push(x, getTerrainHeight(x, z) + yOff, z);
      const n = terrainNormal(x, z);
      normals.push(n[0], n[1], n[2]);
      uvs.push(x * 0.25, z * 0.25); // world-mapped so the texture never tiles per-cell
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const mesh = new Mesh('roads', scene);
  const vd = new VertexData();
  vd.positions = new Float32Array(positions);
  vd.normals = new Float32Array(normals);
  vd.uvs = new Float32Array(uvs);
  vd.indices = new Uint32Array(indices);
  vd.applyToMesh(mesh);

  const mat = new StandardMaterial('roadMat', scene);
  mat.diffuseTexture = makeDirtTexture(scene);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.backFaceCulling = false; // thin ribbon — immune to RH winding direction
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.metadata = { isGround: true };
  enableShadowReceiving(mesh);
  mesh.freezeWorldMatrix();
}

// ─── Road torches ────────────────────────────────────────────────────────────

/**
 * Standing ground torches along the roads: every ROAD_TORCH_SPACING cells,
 * alternating sides, 1 cell off the road pulled slightly toward the verge.
 * Uses the shared ground-torch path (clustered light, shadow slots, flicker,
 * embers, pickable). Must run after initTorchLightPool; initTorchEmbers picks
 * up the ember systems retroactively (same as placeTorches).
 */
export function placeRoadTorches(scene) {
  const grid = getGrid();
  let count = 0;
  let side = 1;

  for (const path of roadPaths) {
    for (let i = CFG.ROAD_TORCH_SPACING; i < path.length; i += CFG.ROAD_TORCH_SPACING) {
      if (count >= CFG.ROAD_TORCH_MAX) return;
      const cell = path[i];
      const prev = path[i - 1];
      // Perpendicular to the local road direction, alternating sides
      const dx = Math.sign(cell.gx - prev.gx);
      const dz = Math.sign(cell.gz - prev.gz);
      let ox = -dz * side, oz = dx * side;
      if (ox === 0 && oz === 0) { ox = side; }
      side = -side;

      const tgx = cell.gx + ox, tgz = cell.gz + oz;
      if (tgx < 0 || tgx >= CFG.GRID || tgz < 0 || tgz >= CFG.GRID) continue;
      if (!grid[tgx][tgz] || isRoadCell(tgx, tgz) || isIndoor(tgx, tgz)) continue;

      const p = g2w(tgx, tgz);
      // Stand at the verge — pull a quarter cell back toward the road edge
      const wx = p.x - ox * CFG.CELL * 0.25;
      const wz = p.z - oz * CFG.CELL * 0.25;
      const y = getTerrainHeight(wx, wz);
      if (y < CFG.WATER_Y + 0.3) continue;

      const t = createGroundTorch(scene, wx, y, wz);
      getTorchLights().push(t.light);
      const entry = { ...t, active: true };
      getPickableTorches().push(entry);
      addTorchEmbers(entry);
      count++;
    }
  }
}
