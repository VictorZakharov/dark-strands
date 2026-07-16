// Pure road-network logic: generation, door spurs, and ribbon geometry data.
// NO Babylon imports here — this module is shared by roads.js (which turns the
// data into a mesh) and tools/validate-roads.mjs (Node invariant harness).
import { CFG } from '../config.js';
import { getGrid, markRoadCell, isRoadCell, isIndoor } from './grid.js';
import { g2w, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getBuildings } from './generator.js';

// Ordered cell polylines, one per road (main road first, then branches).
// Cells are also marked in grid.js roadCells — roads stay WALKABLE.
const roadPaths = [];

// For each roadPaths entry: the main-road cell a branch forks from (null for
// the main road) — the visual ribbon starts there so junctions connect.
const pathJoins = [];

// Door spurs: short stubs from the main road to the cell in front of each
// road-facing primary door. Cells are marked as road cells (so vegetation
// avoids them and the mesh covers them) but are NOT part of roadPaths —
// torch spacing walks the ordered paths only.
const spurCells = new Set();      // "gx,gz" keys
const spurLandings = [];          // { gx, gz, x, z } — doorstep cell (world center)
const spurPolys = [];             // { cells: [road hit → landing], dir: [nx,nz] outward }

export function getRoadPaths() { return roadPaths; }
export function getSpurCells() { return spurCells; }
export function getSpurLandings() { return spurLandings; }
export function getSpurPolys() { return spurPolys; }

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

function commitPath(path, join = null) {
  for (const c of path) markRoadCell(c.gx, c.gz);
  roadPaths.push(path);
  pathJoins.push(join);
}

/**
 * Generate the village road network: one main road spanning the map past
 * (but not through) the center, plus 2-3 perpendicular branch roads.
 * Must run BEFORE generateBuildings — buildings orient to roads.
 */
export function generateRoads() {
  roadPaths.length = 0;
  pathJoins.length = 0;
  spurCells.clear();
  spurLandings.length = 0;
  spurPolys.length = 0;
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
    commitPath(path, { gx: start.gx, gz: start.gz }); // ribbon forks from the main road
    usedIdx.push(idx);
    placed++;
  }
}

// Outward normal (grid axis) of each door wall
const DOOR_NORMALS = {
  south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0],
};

/**
 * Carve a short spur from each road-facing primary door to the road: walk
 * straight out from the door; if a road cell lies within ROAD_SPUR_MAX cells
 * over open ground, mark the cells between as road (the doorstep cell becomes
 * a widened "landing" in the mesh). Must run AFTER generateBuildings.
 */
export function carveDoorSpurs() {
  const grid = getGrid();
  for (const b of getBuildings()) {
    const door = b.doors[0]; // primary door — faces the seeding road
    if (!door) continue;
    const n = DOOR_NORMALS[door.wall];
    if (!n) continue;
    let hit = -1;
    for (let k = 1; k <= CFG.ROAD_SPUR_MAX; k++) {
      const gx = door.gx + n[0] * k, gz = door.gz + n[1] * k;
      if (gx < 0 || gx >= CFG.GRID || gz < 0 || gz >= CFG.GRID) break;
      if (isRoadCell(gx, gz)) { hit = k; break; }
      if (!grid[gx][gz] || isIndoor(gx, gz)) break; // wall/scenery in the way
    }
    if (hit < 0) continue; // door doesn't face a nearby road — no spur
    // Ordered polyline for the visual ribbon: road hit cell → ... → landing
    // (the cell in front of the door). The geometry extends it to the door.
    const poly = [];
    for (let k = hit; k >= 1; k--) {
      const gx = door.gx + n[0] * k, gz = door.gz + n[1] * k;
      if (k < hit) {
        markRoadCell(gx, gz);
        spurCells.add(`${gx},${gz}`);
      }
      poly.push({ gx, gz });
    }
    spurPolys.push({ cells: poly, dir: n });
    const lgx = door.gx + n[0], lgz = door.gz + n[1];
    const lp = g2w(lgx, lgz);
    spurLandings.push({ gx: lgx, gz: lgz, x: lp.x, z: lp.z });
  }
}

// ─── Ribbon geometry ─────────────────────────────────────────────────────────

const DS = 0.45;          // centerline resample spacing (world units)
const CHAIKIN_ITERS = 2;  // corner-cutting passes: 90° grid corners → smooth arcs
export const CROSS_ROWS = 5; // vertices across the ribbon — hugs cross-slope terrain
const CAP_SEGS = 6;       // half-disc fan segments on free road ends

// Crown profile: the roadbed arches ROAD_CROWN above ROAD_Y_OFFSET at the
// centerline and comes back down to ROAD_Y_OFFSET at the edges (real cobble
// roads are crowned for drainage). This is also what keeps the coarse
// rendered ground (2.8u lattice) from poking through the interior: its
// surface kinks against the analytic terrain by up to ~6cm between road
// vertices, which a flat 5cm offset cannot clear.
export const ROAD_CROWN = 0.07;

// Per-strip Y lift above ROAD_Y_OFFSET: strips that cross (branch over main,
// spur over either) sit on different levels so overlapping triangles at
// junctions never z-fight. Kept small — harness bounds total lift at +0.15.
const LIFT_BRANCH = [0.01, 0.02]; // alternating per branch ordinal
const LIFT_SPUR = 0.03;

/** Deterministic integer-lattice hash → [0,1). No Math.random — widths must be
 *  identical wherever the same world position is sampled. */
function hash01(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [-1,1], ~1.7u wavelength — wobbles the edge width. */
function edgeNoise(x, z) {
  const fx = x * 0.6, fz = z * 0.6;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash01(ix, iz), b = hash01(ix + 1, iz);
  const c = hash01(ix, iz + 1), d = hash01(ix + 1, iz + 1);
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1;
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

// The RENDERED ground is CreateGround(size 180, 64 subdivisions) displaced to
// the analytic heightmap at its ~2.8u lattice (terrainMeshes.js buildGround) —
// between lattice points it under/overshoots the analytic terrain by tens of
// cm near building flat zones. A road that follows only the analytic height
// can therefore end up UNDER the visible grass surface (the original
// "grass-colored hole mid-road"). Sample both triangulations of the lattice
// quad and take the max — whichever way Babylon split the quad, we're above it.
const GROUND_SIZE = CFG.GRID * CFG.CELL + 20;
const GROUND_SEGS = 64; // must match terrainMeshes.js buildGround
const GSTEP = GROUND_SIZE / GROUND_SEGS;

function groundSurfaceHeight(x, z) {
  const fx = (x + GROUND_SIZE / 2) / GSTEP;
  const fz = (z + GROUND_SIZE / 2) / GSTEP;
  const i = Math.max(0, Math.min(GROUND_SEGS - 1, Math.floor(fx)));
  const j = Math.max(0, Math.min(GROUND_SEGS - 1, Math.floor(fz)));
  const u = fx - i, v = fz - j;
  const x0 = i * GSTEP - GROUND_SIZE / 2, z0 = j * GSTEP - GROUND_SIZE / 2;
  const h00 = getTerrainHeight(x0, z0);
  const h10 = getTerrainHeight(x0 + GSTEP, z0);
  const h01 = getTerrainHeight(x0, z0 + GSTEP);
  const h11 = getTerrainHeight(x0 + GSTEP, z0 + GSTEP);
  const dA = u >= v
    ? h00 + (h10 - h00) * u + (h11 - h10) * v
    : h00 + (h01 - h00) * v + (h11 - h01) * u;
  const dB = u + v <= 1
    ? h00 + (h10 - h00) * u + (h01 - h00) * v
    : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  return Math.max(dA, dB);
}

/** Base surface the road must clear: analytic terrain (grass tufts, physics
 *  heightfield) AND the rendered ground mesh, whichever is higher. */
export function roadSurfaceBase(x, z) {
  return Math.max(getTerrainHeight(x, z), groundSurfaceHeight(x, z));
}

/** Chaikin corner cutting (open polyline, endpoints kept): straight runs stay
 *  straight, the grid's 90° corners and sidestep zigzags become arcs. */
function chaikin(pts, iters) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/** Resample a polyline at ~ds arc-length spacing (endpoints kept exactly). */
function resample(pts, ds) {
  const out = [{ x: pts[0].x, z: pts[0].z }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1].x, az = pts[i - 1].z;
    const bx = pts[i].x, bz = pts[i].z;
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= ds) {
      const t = (ds - carry) / seg;
      ax += (bx - ax) * t; az += (bz - az) * t;
      out.push({ x: ax, z: az });
      seg = Math.hypot(bx - ax, bz - az);
      carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > ds * 0.3) {
    out.push({ x: last.x, z: last.z });
  } else {
    tail.x = last.x; tail.z = last.z;
  }
  return out;
}

/** Drop consecutive duplicate points (joins can coincide with path starts). */
function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const t = out[out.length - 1];
    if (Math.abs(pts[i].x - t.x) > 1e-6 || Math.abs(pts[i].z - t.z) > 1e-6) out.push(pts[i]);
  }
  return out;
}

/** Closest point on a polyline — branch/spur starts snap onto their parent's
 *  SMOOTHED centerline (raw cell centers drift ~0.3u off it at corners, which
 *  would leave a sliver gap at the junction). */
function closestOnPolyline(px, pz, poly) {
  let bx = poly[0].x, bz = poly[0].z, bestD = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const ax = poly[i - 1].x, az = poly[i - 1].z;
    const dx = poly[i].x - ax, dz = poly[i].z - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cz = az + dz * t;
    const d = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
    if (d < bestD) { bestD = d; bx = cx; bz = cz; }
  }
  return { x: bx, z: bz };
}

/**
 * Extrude a constant-width ribbon along a smoothed centerline: CROSS_ROWS
 * vertices per sample offset perpendicular to the local tangent, quads between
 * consecutive samples (edge vertices shared — the strip is continuous by
 * construction). Per-vertex terrain height + yOff so the road rolls with the
 * land. Optional half-disc caps close free ends.
 */
function emitStrip(centers, opts, out) {
  const n = centers.length;
  if (n < 2) return;
  const { positions, normals, uvs, indices, edgeFrac } = out;
  const yOff = opts.yOff;

  // s = signed cross fraction (-1 right edge .. 0 center .. +1 left edge)
  const pushVert = (x, z, s) => {
    const idx = positions.length / 3;
    positions.push(x, roadSurfaceBase(x, z) + yOff + ROAD_CROWN * (1 - s * s), z);
    const nm = terrainNormal(x, z);
    normals.push(nm[0], nm[1], nm[2]);
    uvs.push(x * 0.25, z * 0.25); // world-mapped — stones stay a constant size
    edgeFrac.push(Math.abs(s));
    return idx;
  };

  // Half-width per sample and side: base ± deterministic wobble, optionally
  // ramping wider toward the end (door landings)
  const halfW = (i, side) => {
    const p = centers[i];
    let w = opts.baseHalf + CFG.ROAD_WIDTH_JITTER
      * edgeNoise(p.x + side * 37.7, p.z - side * 11.3);
    if (opts.widenEnd) {
      const dist = (n - 1 - i) * DS;
      if (dist < 1.5) {
        const t = 1 - dist / 1.5;
        w *= 1 + 0.35 * t * t * (3 - 2 * t); // rounded widened landing
      }
    }
    return Math.max(0.3, w);
  };

  let prevRow = null;
  for (let i = 0; i < n; i++) {
    const p = centers[i];
    const pa = centers[Math.max(0, i - 1)], pb = centers[Math.min(n - 1, i + 1)];
    let tx = pb.x - pa.x, tz = pb.z - pa.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const px = -tz, pz = tx; // left perpendicular
    const hwL = halfW(i, 1), hwR = halfW(i, -1);
    const row = [];
    for (let k = 0; k < CROSS_ROWS; k++) {
      const s = (k / (CROSS_ROWS - 1)) * 2 - 1; // -1 (right) .. +1 (left)
      const off = s > 0 ? s * hwL : s * hwR;
      row.push(pushVert(p.x + px * off, p.z + pz * off, s));
    }
    if (prevRow) {
      for (let k = 0; k < CROSS_ROWS - 1; k++) {
        indices.push(prevRow[k], row[k], row[k + 1], prevRow[k], row[k + 1], prevRow[k + 1]);
      }
    }
    prevRow = row;
  }

  // Half-disc fans over free ends (a bare cut edge reads unfinished). Two
  // rings, so the fan hugs the terrain like the strip does (a single ~1u
  // triangle span can let a terrain hump poke through the offset).
  const cap = (i, sign) => {
    const p = centers[i];
    const q = centers[i + sign]; // neighbor toward the strip
    let bx = p.x - q.x, bz = p.z - q.z; // outward along the strip axis
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    const r = (halfW(i, 1) + halfW(i, -1)) / 2;
    const c = pushVert(p.x, p.z, 0);
    const mid = [], outer = [];
    for (let s2 = 0; s2 <= CAP_SEGS; s2++) {
      const a = -Math.PI / 2 + (s2 / CAP_SEGS) * Math.PI;
      const dx = bx * Math.cos(a) - bz * Math.sin(a);
      const dz = bx * Math.sin(a) + bz * Math.cos(a);
      mid.push(pushVert(p.x + dx * r * 0.5, p.z + dz * r * 0.5, 0.5));
      outer.push(pushVert(p.x + dx * r, p.z + dz * r, 1));
    }
    for (let s2 = 0; s2 < CAP_SEGS; s2++) {
      indices.push(c, mid[s2], mid[s2 + 1]);
      indices.push(mid[s2], outer[s2], outer[s2 + 1], mid[s2], outer[s2 + 1], mid[s2 + 1]);
    }
  };
  if (opts.capStart) cap(0, 1);
  if (opts.capEnd) cap(n - 1, -1);
}

/**
 * Road ribbon geometry: each ordered cell polyline (roads + door spurs) is
 * smoothed with Chaikin corner cutting and resampled every DS units, then
 * extruded into a terrain-hugging strip — long straights stay straight, grid
 * corners and sidesteps become smooth curves instead of square steps, and a
 * continuous strip cannot have per-cell holes. Branch/spur ribbons start ON
 * their parent road's centerline (junctions connect), with a small per-strip
 * Y lift so overlapping junction triangles never z-fight.
 * The grid-cell road marks are untouched — gameplay still sees cells.
 * Returns raw arrays plus per-strip diagnostics for the validation harness.
 * Must run AFTER generateBuildings — building flat zones alter terrain height.
 */
export function buildRoadRibbonData() {
  if (roadPaths.length === 0) return null;
  const out = { positions: [], normals: [], uvs: [], indices: [], edgeFrac: [] };
  const strips = []; // { kind, yOff, centers, cells }

  for (let pi = 0; pi < roadPaths.length; pi++) {
    const pts = [];
    const join = pathJoins[pi];
    if (join) pts.push(g2w(join.gx, join.gz));
    for (const c of roadPaths[pi]) pts.push(g2w(c.gx, c.gz));
    const poly = dedupe(pts);
    if (poly.length < 2) continue;
    // Fork exactly ON the main road's smoothed centerline (not the raw cell)
    if (join && strips.length > 0) poly[0] = closestOnPolyline(poly[0].x, poly[0].z, strips[0].centers);
    const yOff = CFG.ROAD_Y_OFFSET + (pi === 0 ? 0 : LIFT_BRANCH[(pi - 1) % 2]);
    const centers = resample(chaikin(poly, CHAIKIN_ITERS), DS);
    emitStrip(centers, {
      yOff, baseHalf: CFG.ROAD_WIDTH / 2,
      capStart: !join, capEnd: true,
    }, out);
    strips.push({ kind: pi === 0 ? 'main' : 'branch', yOff, centers, cells: roadPaths[pi] });
  }

  const roadStrips = strips.slice();
  for (const spur of spurPolys) {
    const pts = spur.cells.map(c => g2w(c.gx, c.gz));
    // Extend past the landing to just under the door (wall face ≈ 1.65u from
    // the landing center: one cell to the wall-cell center minus WALL_T/2).
    // dir is the door's OUTWARD normal, so toward the door is -dir.
    const last = pts[pts.length - 1];
    pts.push({ x: last.x - spur.dir[0] * 1.5, z: last.z - spur.dir[1] * 1.5 });
    const poly = dedupe(pts);
    if (poly.length < 2) continue;
    // Curve off the parent road: start ON the nearest smoothed centerline
    let best = poly[0], bestD = Infinity;
    for (const rs of roadStrips) {
      const c = closestOnPolyline(poly[0].x, poly[0].z, rs.centers);
      const d = Math.hypot(c.x - poly[0].x, c.z - poly[0].z);
      if (d < bestD) { bestD = d; best = c; }
    }
    poly[0] = best;
    const yOff = CFG.ROAD_Y_OFFSET + LIFT_SPUR;
    const centers = resample(chaikin(dedupe(poly), CHAIKIN_ITERS), DS);
    emitStrip(centers, {
      yOff, baseHalf: CFG.ROAD_WIDTH / 2 * 0.85,
      capStart: false, capEnd: false, widenEnd: true, // flat against the door
    }, out);
    strips.push({ kind: 'spur', yOff, centers, cells: spur.cells });
  }

  // Adaptive clearance pass: the base surface (rendered ground ∨ analytic)
  // kinks where the two cross, and in rare flat-zone spots a linear road quad
  // undershoots the kink by ~1cm — grass would slice through the cobbles.
  // Probe each triangle (centroid + edge midpoints) and raise its vertices
  // just enough to clear. Raising is monotone, so this converges fast.
  const pos = out.positions;
  const MIN_CLEAR = 0.01;
  for (let pass = 0; pass < 3; pass++) {
    let raised = false;
    for (let t = 0; t < out.indices.length; t += 3) {
      const a = out.indices[t], b = out.indices[t + 1], c = out.indices[t + 2];
      let deficit = 0;
      const probe = (px, py, pz) => {
        const d = roadSurfaceBase(px, pz) + MIN_CLEAR - py;
        if (d > deficit) deficit = d;
      };
      probe((pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3);
      probe((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
      probe((pos[b * 3] + pos[c * 3]) / 2, (pos[b * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[b * 3 + 2] + pos[c * 3 + 2]) / 2);
      probe((pos[a * 3] + pos[c * 3]) / 2, (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2);
      if (deficit > 0) {
        pos[a * 3 + 1] += deficit;
        pos[b * 3 + 1] += deficit;
        pos[c * 3 + 1] += deficit;
        raised = true;
      }
    }
    if (!raised) break;
  }

  return { ...out, strips };
}

// ─── Cobblestone texture pixels ──────────────────────────────────────────────

/**
 * Procedural cobblestone pixels (RGBA, sz×sz), pure math so the harness can
 * dump it to an image. Jittered-grid Voronoi with WRAPPED seeds → seamless
 * tile: each texel finds its nearest stone seed; texels near the boundary
 * between two stones become dark mortar, the rest get a per-stone grey-brown
 * tone domed toward the stone center for relief. At the road's world-mapped
 * UV scale (0.25 → 4u tile) STONES_PER_TILE=14 gives ~0.29u cobbles.
 */
export function makeCobblePixels(sz) {
  const N = 14; // stones per tile edge
  const cellPx = sz / N;
  const data = new Uint8ClampedArray(sz * sz * 4);

  // Wrapped jittered seeds + per-stone tone
  const seeds = [];
  for (let i = 0; i < N; i++) {
    seeds[i] = [];
    for (let j = 0; j < N; j++) {
      const jx = (hash01(i * 3 + 1, j * 7 + 2) - 0.5) * 0.7;
      const jy = (hash01(i * 5 + 3, j * 11 + 4) - 0.5) * 0.7;
      // Grey-brown villager cobble: vary lightness a lot, warmth a little
      const l = 95 + hash01(i * 13 + 5, j * 17 + 6) * 60;   // 95..155
      const warm = hash01(i * 19 + 7, j * 23 + 8) * 18;      // brownish cast
      seeds[i][j] = {
        x: (i + 0.5 + jx) * cellPx,
        y: (j + 0.5 + jy) * cellPx,
        r: l + warm * 0.7, g: l + warm * 0.25, b: l - warm * 0.35,
      };
    }
  }

  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const ci = Math.floor(x / cellPx), cj = Math.floor(y / cellPx);
      let d1 = 1e9, d2 = 1e9, s1 = null;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const wi = (ci + di + N) % N, wj = (cj + dj + N) % N;
          const s = seeds[wi][wj];
          // Wrapped offset: seed may live across the tile border
          let sx = s.x + (ci + di - wi) / N * sz;
          let sy = s.y + (cj + dj - wj) / N * sz;
          const dd = (x - sx) * (x - sx) + (y - sy) * (y - sy);
          if (dd < d1) { d2 = d1; d1 = dd; s1 = s; }
          else if (dd < d2) { d2 = dd; }
        }
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1); // 0 on stone boundaries
      const o = (y * sz + x) * 4;
      const grit = (hash01(x, y) - 0.5) * 14; // per-pixel speckle
      if (e < 1.8) {
        // Mortar gap — dark packed dirt between stones
        data[o] = 52 + grit; data[o + 1] = 46 + grit; data[o + 2] = 38 + grit * 0.8;
      } else {
        // Stone face: domed shading (bright center, darker toward the gap)
        const dome = Math.min(1, e / (cellPx * 0.55));
        const k = 0.72 + 0.28 * dome;
        data[o] = s1.r * k + grit;
        data[o + 1] = s1.g * k + grit;
        data[o + 2] = s1.b * k + grit * 0.8;
      }
      data[o + 3] = 255;
    }
  }
  return data;
}
