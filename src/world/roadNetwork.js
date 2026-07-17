// Pure road-network logic — CURVE-FIRST, CELLS-SECOND.
// Roads are Catmull-Rom splines through a handful of offset control points
// (long sweeping bends, no grid-flavored wiggle); the grid road cells are a
// RASTERIZATION of the sampled centerlines, kept only for gameplay systems
// (building seeding, vegetation exclusion, torch-placement rejection,
// isNearRoad). NO Babylon imports here — this module is shared by roads.js
// (which turns the data into a mesh) and tools/validate-roads.mjs.
import { CFG } from '../config.js';
import { getGrid, markRoadCell, isRoadCell, isIndoor } from './grid.js';
import { g2w, rng, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getBuildings } from './generator.js';

const SAMPLE_DS = 0.5;     // spline sample spacing (world units)
const SPUR_MIN_RADIUS = 3; // spurs may curve tighter than roads

// ─── State ───────────────────────────────────────────────────────────────────

// Sampled centerlines. samples: [{ x, z, wL, wR }] — wL/wR are per-side
// half-widths interpolated from per-control-point values (low-frequency).
const roadCurves = [];   // { kind: 'main' | 'branch', samples }
const spurCurves = [];   // { samples, door, landing }

// Ordered 4-connected centerline cells per road curve — generator.js seeds
// buildings beside these exactly as it always did.
const roadPaths = [];

const spurCells = new Set();   // cells rasterized by spurs (not by roads)
const spurLandings = [];       // { gx, gz, x, z } — doorstep cell (world center)
const doorSpurDiag = [];       // { gx, gz, wall, eligible, reason } per primary door

export function getRoadPaths() { return roadPaths; }
export function getRoadCurves() { return roadCurves; }
export function getSpurCurves() { return spurCurves; }
export function getSpurCells() { return spurCells; }
export function getSpurLandings() { return spurLandings; }
export function getDoorSpurDiag() { return doorSpurDiag; }

// ─── Spline machinery ────────────────────────────────────────────────────────

/** Uniform Catmull-Rom through control points (endpoint-clamped), densely
 *  sampled then arc-length resampled every ~ds. Control widths (wL/wR)
 *  interpolate along with the positions — width changes are low-frequency. */
function catmullRom(controls, ds) {
  const P = [controls[0], ...controls, controls[controls.length - 1]];
  const dense = [];
  for (let i = 0; i + 3 < P.length; i++) {
    const p0 = P[i], p1 = P[i + 1], p2 = P[i + 2], p3 = P[i + 3];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(4, Math.ceil(segLen / (ds * 0.5)));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      dense.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t
          + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2
          + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        wL: p1.wL + (p2.wL - p1.wL) * t,
        wR: p1.wR + (p2.wR - p1.wR) * t,
      });
    }
  }
  const last = controls[controls.length - 1];
  dense.push({ x: last.x, z: last.z, wL: last.wL, wR: last.wR });
  return resample(dense, ds);
}

/** Arc-length resample (~ds spacing, endpoints kept exactly, widths lerped). */
function resample(pts, ds) {
  const first = pts[0];
  const out = [{ x: first.x, z: first.z, wL: first.wL, wR: first.wR }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = { x: pts[i - 1].x, z: pts[i - 1].z, wL: pts[i - 1].wL, wR: pts[i - 1].wR };
    const b = pts[i];
    let seg = Math.hypot(b.x - a.x, b.z - a.z);
    while (carry + seg >= ds) {
      const t = (ds - carry) / seg;
      a = {
        x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
        wL: a.wL + (b.wL - a.wL) * t, wR: a.wR + (b.wR - a.wR) * t,
      };
      out.push(a);
      seg = Math.hypot(b.x - a.x, b.z - a.z);
      carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last.x - tail.x, last.z - tail.z) > ds * 0.3) {
    out.push({ x: last.x, z: last.z, wL: last.wL, wR: last.wR });
  } else {
    tail.x = last.x; tail.z = last.z; tail.wL = last.wL; tail.wR = last.wR;
  }
  return out;
}

/** Minimum turning radius over a sampled polyline (and where it occurs). */
export function minTurnRadius(samples) {
  let worstK = 0, worstIdx = -1;
  for (let i = 1; i < samples.length - 1; i++) {
    const ax = samples[i].x - samples[i - 1].x, az = samples[i].z - samples[i - 1].z;
    const bx = samples[i + 1].x - samples[i].x, bz = samples[i + 1].z - samples[i].z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
    const k = Math.acos(cos) / ((la + lb) / 2);
    if (k > worstK) { worstK = k; worstIdx = i; }
  }
  return { radius: worstK > 1e-9 ? 1 / worstK : Infinity, idx: worstIdx };
}

// ─── Constraint solving (water / margins / spawn clearing / curvature) ───────

const marginBox = () => CFG.HALF - CFG.ROAD_EDGE_MARGIN * CFG.CELL;
const clearingR = () => (CFG.PLAYER_CLEAR + 1) * CFG.CELL + 1; // spawn clearing (u)

function isWet(x, z) { return getTerrainHeight(x, z) < CFG.WATER_Y + 0.3; }

/** First constraint violation among samples, or null. */
function findViolation(samples, checkCenter) {
  const m = marginBox(), cr = clearingR();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (isWet(s.x, s.z)) return { type: 'water', idx: i };
    if (Math.abs(s.x) > m || Math.abs(s.z) > m) return { type: 'box', idx: i };
    if (checkCenter && Math.abs(s.x) < cr && Math.abs(s.z) < cr) return { type: 'center', idx: i };
  }
  return null;
}

function clampToBox(p) {
  const m = marginBox() - 1;
  p.x = Math.max(-m, Math.min(m, p.x));
  p.z = Math.max(-m, Math.min(m, p.z));
}

/**
 * Iteratively fix a control polygon until its sampled curve is valid:
 * wet / out-of-bounds / through-spawn samples push the nearest MOVABLE
 * control away from the offender; bends tighter than minRadius relax the
 * nearest control back toward its base (straight-line) position. Returns
 * samples, or null if constraints could not be satisfied (caller retries).
 * `movable` = [firstIdx, lastIdx] inclusive range of adjustable controls
 * (anchors stay put; a branch's far end is free, its junction end is not).
 */
function solveCurve(controls, bases, movable, opts) {
  const nearestMovable = (s) => {
    let best = -1, bestD = Infinity;
    for (let c = movable[0]; c <= movable[1]; c++) {
      const d = (controls[c].x - s.x) ** 2 + (controls[c].z - s.z) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  };
  for (let iter = 0; iter < 28; iter++) {
    const samples = catmullRom(controls, SAMPLE_DS);
    const v = findViolation(samples, opts.checkCenter);
    if (v) {
      const s = samples[v.idx];
      const best = nearestMovable(s);
      if (best < 0) return null;
      const ctrl = controls[best];
      let dx, dz;
      if (v.type === 'water') { dx = ctrl.x - s.x; dz = ctrl.z - s.z; }
      else if (v.type === 'center') { dx = ctrl.x; dz = ctrl.z; } // away from origin
      else { dx = -ctrl.x; dz = -ctrl.z; }                        // box: inward
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) { dx = 1; dz = 0; } else { dx /= l; dz /= l; }
      ctrl.x += dx * 2.5;
      ctrl.z += dz * 2.5;
      clampToBox(ctrl);
      continue;
    }
    const { radius, idx } = minTurnRadius(samples);
    if (radius < opts.minRadius && idx >= 0) {
      const best = nearestMovable(samples[idx]);
      if (best < 0) return null;
      // Relax the offending control toward its base position — straightens
      // the bend; converges because the bases form a straight/gentle line
      controls[best].x += (bases[best].x - controls[best].x) * 0.4;
      controls[best].z += (bases[best].z - controls[best].z) * 0.4;
      continue;
    }
    return samples;
  }
  return null;
}

// ─── Rasterization (gameplay cells) ──────────────────────────────────────────

/** Mark every grid cell whose center lies within r of a sample point (the
 *  containing cell is always marked — a sample near a cell corner is farther
 *  than r from the center but the road still runs through that cell).
 *  Newly-marked cells are collected into outSet when provided. */
function rasterize(samples, r, outSet = null) {
  const r2 = r * r;
  for (const s of samples) {
    const cgx = Math.floor((s.x + CFG.HALF) / CFG.CELL);
    const cgz = Math.floor((s.z + CFG.HALF) / CFG.CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const gx = cgx + dx, gz = cgz + dz;
        if (gx < 0 || gx >= CFG.GRID || gz < 0 || gz >= CFG.GRID) continue;
        if (dx !== 0 || dz !== 0) {
          const c = g2w(gx, gz);
          if ((c.x - s.x) ** 2 + (c.z - s.z) ** 2 > r2) continue;
        }
        if (outSet && !isRoadCell(gx, gz)) outSet.add(`${gx},${gz}`);
        markRoadCell(gx, gz);
      }
    }
  }
}

export const roadRasterR = () => CFG.ROAD_WIDTH / 2 + 0.6;
const spurRasterR = () => (CFG.ROAD_WIDTH * 0.85) / 2 + 0.6;

/** Ordered 4-connected cell path under a sampled centerline (generator.js
 *  seeds buildings beside these cells with local directions, unchanged). */
function cellPathOf(samples) {
  const path = [];
  let cur = null;
  for (const p of samples) {
    const gx = Math.floor((p.x + CFG.HALF) / CFG.CELL);
    const gz = Math.floor((p.z + CFG.HALF) / CFG.CELL);
    if (cur && gx === cur.gx && gz === cur.gz) continue;
    if (cur && gx !== cur.gx && gz !== cur.gz) {
      // Diagonal hop — insert the 4-connected intermediate nearer the curve
      const a = { gx, gz: cur.gz }, b = { gx: cur.gx, gz };
      const wa = g2w(a.gx, a.gz), wb = g2w(b.gx, b.gz);
      const da = (p.x - wa.x) ** 2 + (p.z - wa.z) ** 2;
      const db = (p.x - wb.x) ** 2 + (p.z - wb.z) ** 2;
      path.push(da <= db ? a : b);
    }
    cur = { gx, gz };
    path.push(cur);
  }
  return path;
}

// ─── Generation ──────────────────────────────────────────────────────────────

const W2 = () => CFG.ROAD_WIDTH / 2;
const ctrlWidths = (scale = 1) => ({
  wL: (W2() + rng(-CFG.ROAD_WIDTH_JITTER, CFG.ROAD_WIDTH_JITTER)) * scale,
  wR: (W2() + rng(-CFG.ROAD_WIDTH_JITTER, CFG.ROAD_WIDTH_JITTER)) * scale,
});

/**
 * Generate the village road network — curve first, cells second.
 * Main road: two far-apart anchors (near opposite map edges, offset to pass
 * near but not through the center), 3-5 intermediate controls offset
 * perpendicular by low-frequency amounts, Catmull-Rom through them → long
 * sweeping bends, zero high-frequency wiggle. Branches (2-3) fork
 * perpendicular off main-curve sample points and wander gently outward.
 * Cells are rasterized from the sampled curves afterwards.
 * Must run BEFORE generateBuildings — buildings orient to roads.
 */
export function generateRoads() {
  roadCurves.length = 0;
  spurCurves.length = 0;
  roadPaths.length = 0;
  spurCells.clear();
  spurLandings.length = 0;
  doorSpurDiag.length = 0;

  // ── Main road
  let main = null;
  for (let att = 0; att < 20 && !main; att++) {
    const horizontal = Math.random() < 0.5;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = (CFG.PLAYER_CLEAR + 2 + rng(0, 4)) * CFG.CELL * side;
    const m = marginBox();
    const a0 = -m + rng(0, 6), a1 = m - rng(0, 6);
    const pt = (along, perp) => horizontal ? { x: along, z: perp } : { x: perp, z: along };

    const A = { ...pt(a0, off + rng(-4, 4)), ...ctrlWidths() };
    const B = { ...pt(a1, off + rng(-4, 4)), ...ctrlWidths() };
    if (isWet(A.x, A.z) || isWet(B.x, B.z)) continue;

    const controls = [A], bases = [{ x: A.x, z: A.z }];
    const K = rngInt(3, 5);
    for (let k = 1; k <= K; k++) {
      const f = k / (K + 1);
      const along = a0 + (a1 - a0) * f + rng(-3, 3);
      const perpOff = rng(4, CFG.ROAD_CONTROL_OFFSET) * (Math.random() < 0.5 ? 1 : -1);
      const c = { ...pt(along, off + perpOff), ...ctrlWidths() };
      clampToBox(c);
      controls.push(c);
      bases.push(pt(along, off)); // relax target: back on the straight chord
    }
    controls.push(B);
    bases.push({ x: B.x, z: B.z });

    const samples = solveCurve(controls, bases, [1, controls.length - 2],
      { minRadius: CFG.ROAD_MIN_RADIUS, checkCenter: true });
    if (samples && samples.length * SAMPLE_DS > 60) main = samples;
  }
  if (!main) {
    console.warn('[ROADS] Main road generation failed — no roads this world');
    return;
  }
  roadCurves.push({ kind: 'main', samples: main });
  rasterize(main, roadRasterR());
  roadPaths.push(cellPathOf(main));

  // ── Branches: fork perpendicular off the main curve, wander gently outward
  const branchTarget = rngInt(CFG.ROAD_MIN_BRANCHES, CFG.ROAD_MAX_BRANCHES);
  const usedArc = [];
  let placed = 0;
  for (let att = 0; att < 24 && placed < branchTarget; att++) {
    const idx = rngInt(Math.floor(main.length * 0.15), Math.floor(main.length * 0.85));
    const arc = idx * SAMPLE_DS;
    if (usedArc.some(u => Math.abs(u - arc) < 20)) continue;

    const P0 = main[idx];
    const pa = main[idx - 1], pb = main[idx + 1];
    let tx = pb.x - pa.x, tz = pb.z - pa.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const s = Math.random() < 0.5 ? 1 : -1;
    const perpX = -tz * s, perpZ = tx * s; // perpendicular to the main curve
    let dirX = perpX, dirZ = perpZ;

    const targetLen = rng(15, 35);
    const nCtrl = rngInt(2, 3);
    const step = targetLen / nCtrl;
    const controls = [{ x: P0.x, z: P0.z, ...ctrlWidths() }];
    const bases = [{ x: P0.x, z: P0.z }];
    let cx = P0.x, cz = P0.z;
    for (let k = 1; k <= nCtrl; k++) {
      const rot = rng(-0.45, 0.45); // gentle wander (±25°) per control
      const nx = dirX * Math.cos(rot) - dirZ * Math.sin(rot);
      const nz = dirX * Math.sin(rot) + dirZ * Math.cos(rot);
      dirX = nx; dirZ = nz;
      cx += dirX * step; cz += dirZ * step;
      const c = { x: cx, z: cz, ...ctrlWidths() };
      clampToBox(c);
      controls.push(c);
      // Bases lie straight out along the initial perpendicular — relaxing
      // toward them straightens the branch
      bases.push({ x: P0.x + perpX * step * k, z: P0.z + perpZ * step * k });
    }

    // Junction end is fixed ON the main curve; the far end may move freely
    const samples = solveCurve(controls, bases, [1, controls.length - 1],
      { minRadius: CFG.ROAD_MIN_RADIUS, checkCenter: true });
    if (!samples || samples.length * SAMPLE_DS < 12) continue;
    roadCurves.push({ kind: 'branch', samples });
    rasterize(samples, roadRasterR());
    roadPaths.push(cellPathOf(samples));
    usedArc.push(arc);
    placed++;
  }
}

/** Min distance from any ROAD curve sample to a building footprint rect
 *  (grid coords) — generator.js keeps walls a real distance off the CURVE,
 *  not just off the coarse rasterized cells. */
export function roadDistanceToRect(bx, bz, w, h) {
  const p0 = g2w(bx, bz), p1 = g2w(bx + w - 1, bz + h - 1);
  const x0 = p0.x - CFG.CELL / 2, z0 = p0.z - CFG.CELL / 2;
  const x1 = p1.x + CFG.CELL / 2, z1 = p1.z + CFG.CELL / 2;
  let best = Infinity;
  for (const curve of roadCurves) {
    for (const s of curve.samples) {
      const dx = Math.max(x0 - s.x, 0, s.x - x1);
      const dz = Math.max(z0 - s.z, 0, s.z - z1);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

// ─── Door spurs ──────────────────────────────────────────────────────────────

// Outward normal (grid axis) of each door wall
const DOOR_NORMALS = {
  south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0],
};

/** World-space footprint rect of a building. */
function buildingRect(b) {
  const p0 = g2w(b.x, b.z), p1 = g2w(b.x + b.w - 1, b.z + b.h - 1);
  return {
    x0: p0.x - CFG.CELL / 2, z0: p0.z - CFG.CELL / 2,
    x1: p1.x + CFG.CELL / 2, z1: p1.z + CFG.CELL / 2,
  };
}

/**
 * Curve a short spur from the nearest road sample to the landing in front of
 * each road-facing primary door, ending tucked under the door. Tighter bends
 * are allowed (radius >= SPUR_MIN_RADIUS). Spur cells rasterize like roads.
 * Must run AFTER generateBuildings.
 */
export function carveDoorSpurs() {
  if (roadCurves.length === 0) return;
  const buildings = getBuildings();
  const rects = buildings.map(buildingRect);

  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    const door = b.doors[0]; // primary door — faces the seeding road
    if (!door) continue;
    const n = DOOR_NORMALS[door.wall];
    if (!n) continue;
    const diag = { gx: door.gx, gz: door.gz, wall: door.wall, eligible: false, reason: '' };
    doorSpurDiag.push(diag);

    const lgx = door.gx + n[0], lgz = door.gz + n[1];
    const L = g2w(lgx, lgz); // landing: the cell in front of the door
    // End tucked under the door (wall face ≈ CELL - WALL_T/2 from the landing)
    const E = { x: L.x - n[0] * 1.5, z: L.z - n[1] * 1.5 };

    // Nearest road sample to the landing
    let S = null, bestD = Infinity;
    for (const curve of roadCurves) {
      for (const smp of curve.samples) {
        const d = (smp.x - L.x) ** 2 + (smp.z - L.z) ** 2;
        if (d < bestD) { bestD = d; S = smp; }
      }
    }
    if (!S || Math.sqrt(bestD) > CFG.ROAD_SPUR_MAX * CFG.CELL) {
      diag.reason = 'no road within reach';
      continue;
    }

    // Perpendicular of the road→landing chord (for a gentle bow)
    let px = -(L.z - S.z), pz = L.x - S.x;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;

    let committed = false;
    for (const bow of [rng(-1.2, 1.2), 0]) { // curved attempt, then straight
      const controls = [
        { x: S.x, z: S.z, ...ctrlWidths(0.85) },
        {
          x: (S.x + L.x) / 2 + px * bow,
          z: (S.z + L.z) / 2 + pz * bow,
          ...ctrlWidths(0.85),
        },
        { x: L.x, z: L.z, ...ctrlWidths(0.85) },
        { x: E.x, z: E.z, ...ctrlWidths(0.85) },
      ];
      const bases = controls.map(c => ({ x: c.x, z: c.z }));
      bases[1] = { x: (S.x + L.x) / 2, z: (S.z + L.z) / 2 };
      const samples = solveCurve(controls, bases, [1, 1],
        { minRadius: SPUR_MIN_RADIUS, checkCenter: false });
      if (!samples) continue;

      // Must not cut through buildings (the spur's own doorway zone near the
      // end point is exempt — that's where it tucks under the door)
      let blocked = false;
      for (const smp of samples) {
        const nearDoor = (smp.x - E.x) ** 2 + (smp.z - E.z) ** 2 < 2.2 * 2.2;
        for (let ri = 0; ri < rects.length; ri++) {
          if (ri === bi && nearDoor) continue;
          const r = rects[ri];
          if (smp.x > r.x0 && smp.x < r.x1 && smp.z > r.z0 && smp.z < r.z1) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (blocked) continue;

      spurCurves.push({
        samples,
        door: { gx: door.gx, gz: door.gz, wall: door.wall },
        landing: { gx: lgx, gz: lgz, x: L.x, z: L.z },
      });
      rasterize(samples, spurRasterR(), spurCells);
      spurLandings.push({ gx: lgx, gz: lgz, x: L.x, z: L.z });
      diag.eligible = true;
      committed = true;
      break;
    }
    if (!committed && !diag.reason) diag.reason = 'blocked by building/water/bend';
  }
}

// ─── Torch post sites (pure — rock rejection happens Babylon-side) ───────────

/**
 * Walk the road curves by arc length (ROAD_TORCH_SPACING cells worth of units,
 * ~18u) and emit candidate post sites offset perpendicular to the curve,
 * alternating sides. Checks that need only grid/terrain happen here; roads.js
 * additionally rejects rock collisions and applies ROAD_TORCH_MAX.
 * Returns [{ x, z, y, nx, nz }] — (nx,nz) points back toward the road.
 */
export function computeTorchSites() {
  const grid = getGrid();
  const spacing = CFG.ROAD_TORCH_SPACING * CFG.CELL;
  const offset = W2() + 0.8;
  const clearR = W2() + 0.5;
  const sites = [];
  let side = 1;

  for (const curve of roadCurves) {
    const smp = curve.samples;
    let acc = 0;
    for (let i = 1; i < smp.length - 1; i++) {
      acc += Math.hypot(smp[i].x - smp[i - 1].x, smp[i].z - smp[i - 1].z);
      if (acc < spacing) continue;
      acc = 0;
      let tx = smp[i + 1].x - smp[i - 1].x, tz = smp[i + 1].z - smp[i - 1].z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const sd = side;
      side = -side; // alternate even when a site is rejected
      const wx = smp[i].x + (-tz * sd) * offset;
      const wz = smp[i].z + (tx * sd) * offset;

      const gx = Math.floor((wx + CFG.HALF) / CFG.CELL);
      const gz = Math.floor((wz + CFG.HALF) / CFG.CELL);
      if (gx < 0 || gx >= CFG.GRID || gz < 0 || gz >= CFG.GRID) continue;
      // NOTE: no isRoadCell rejection — the raster cells extend past the
      // ribbon (the verge often shares the cell), and the geometric
      // clearance below is the real "off the road" check
      if (!grid[gx][gz] || isIndoor(gx, gz)) continue;
      const y = getTerrainHeight(wx, wz);
      if (y < CFG.WATER_Y + 0.3) continue;
      // Off every ribbon (another road may pass right behind the verge)
      let clear = true;
      for (const c of [...roadCurves, ...spurCurves]) {
        for (const q of c.samples) {
          if ((q.x - wx) ** 2 + (q.z - wz) ** 2 < clearR * clearR) { clear = false; break; }
        }
        if (!clear) break;
      }
      if (!clear) continue;
      sites.push({ x: wx, z: wz, y, nx: tz * sd, nz: -tx * sd });
    }
  }
  return sites;
}

// ─── Surfaces (analytic terrain vs the rendered ground lattice) ──────────────

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
// cm near building flat zones. Interior road vertices must clear BOTH
// surfaces; edge vertices pin BELOW both. Both diagonal triangulations of the
// lattice quad are evaluated (we can't know which way Babylon split it).
const GROUND_SIZE = CFG.GRID * CFG.CELL + 20;
const GROUND_SEGS = 64; // must match terrainMeshes.js buildGround
const GSTEP = GROUND_SIZE / GROUND_SEGS;

function groundSurfaceRange(x, z) {
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
  return dA < dB ? [dA, dB] : [dB, dA];
}

/** Highest surface the road interior must clear (analytic ∨ rendered). */
export function roadSurfaceBase(x, z) {
  return Math.max(getTerrainHeight(x, z), groundSurfaceRange(x, z)[1]);
}

export const EDGE_SINK = 0.03;   // outer edges sit this far BELOW the ground
export const SKIRT_DEPTH = 0.3;  // vertical stone skirt under each outer edge

/** Lowest visible surface minus EDGE_SINK — road EDGES pin here, so the
 *  ribbon never floats above the grass (analytic ∧ rendered). */
export function roadEdgeBase(x, z) {
  return Math.min(getTerrainHeight(x, z), groundSurfaceRange(x, z)[0]) - EDGE_SINK;
}

// ─── Ribbon geometry ─────────────────────────────────────────────────────────

export const CROSS_ROWS = 5; // vertices across the ribbon — hugs cross-slope terrain
const CAP_SEGS = 6;          // half-disc fan segments on free road ends

// Crown profile: the roadbed arches ROAD_CROWN above ROAD_Y_OFFSET at the
// centerline; the OUTER edges are pinned into the ground (at roadEdgeBase) so
// the ribbon reads as bedded pavement — never floating, underside never seen.
export const ROAD_CROWN = 0.07;

// Per-strip Y lift above ROAD_Y_OFFSET for the INTERIOR vertices: strips that
// cross (branch over main, spur over either) sit on different levels so
// overlapping triangles at junctions never z-fight.
const LIFT_BRANCH = [0.01, 0.02]; // alternating per branch ordinal
const LIFT_SPUR = 0.03;

/**
 * Extrude a ribbon along a sampled centerline: CROSS_ROWS vertices per sample
 * perpendicular to the local tangent. Edge vertices (|s|=1) pin at
 * roadEdgeBase (below the grass); interior vertices carry yOff + crown above
 * roadSurfaceBase. Each outer edge additionally extrudes a SKIRT_DEPTH
 * vertical skirt so a dipping rendered ground never exposes the underside.
 * edgeFrac per vertex: 0..1 across the top surface, 2 = skirt (excluded from
 * clearance logic). Free ends get two-ring half-disc caps, also skirted.
 */
function emitStrip(samples, opts, out) {
  const n = samples.length;
  if (n < 2) return;
  const { positions, normals, uvs, indices, edgeFrac } = out;
  const yOff = opts.yOff;

  const pushTop = (x, z, s) => {
    const idx = positions.length / 3;
    const y = Math.abs(s) > 0.999
      ? roadEdgeBase(x, z)
      : roadSurfaceBase(x, z) + yOff + ROAD_CROWN * (1 - s * s);
    positions.push(x, y, z);
    const nm = terrainNormal(x, z);
    normals.push(nm[0], nm[1], nm[2]);
    uvs.push(x * 0.25, z * 0.25); // world-mapped — stones stay a constant size
    edgeFrac.push(Math.abs(s));
    return idx;
  };

  // Skirt vertex: vertical drop below an edge point, lit as a side face
  const pushSkirt = (x, z, y, nx, nz) => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx, 0, nz);
    uvs.push((x + z) * 0.25, y * 0.25); // vertical mapping — no smear
    edgeFrac.push(2);
    return idx;
  };

  const widen = (i) => {
    if (!opts.widenEnd) return 1;
    const dist = (n - 1 - i) * SAMPLE_DS;
    if (dist >= 1.5) return 1;
    const t = 1 - dist / 1.5;
    return 1 + 0.35 * t * t * (3 - 2 * t); // rounded widened landing
  };

  let prevRow = null;
  const edgeL = [], edgeR = []; // outer-edge points per sample, for the skirts
  for (let i = 0; i < n; i++) {
    const p = samples[i];
    const pa = samples[Math.max(0, i - 1)], pb = samples[Math.min(n - 1, i + 1)];
    let tx = pb.x - pa.x, tz = pb.z - pa.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const px = -tz, pz = tx; // left perpendicular
    const wm = widen(i);
    const hwL = Math.max(0.3, p.wL * wm), hwR = Math.max(0.3, p.wR * wm);
    const row = [];
    for (let k = 0; k < CROSS_ROWS; k++) {
      const s = (k / (CROSS_ROWS - 1)) * 2 - 1; // -1 (right) .. +1 (left)
      const off = s > 0 ? s * hwL : s * hwR;
      row.push(pushTop(p.x + px * off, p.z + pz * off, s));
    }
    if (prevRow) {
      for (let k = 0; k < CROSS_ROWS - 1; k++) {
        indices.push(prevRow[k], row[k], row[k + 1], prevRow[k], row[k + 1], prevRow[k + 1]);
      }
    }
    prevRow = row;
    edgeL.push({
      x: p.x + px * hwL, z: p.z + pz * hwL,
      y: positions[row[CROSS_ROWS - 1] * 3 + 1], nx: px, nz: pz,
    });
    edgeR.push({
      x: p.x - px * hwR, z: p.z - pz * hwR,
      y: positions[row[0] * 3 + 1], nx: -px, nz: -pz,
    });
  }

  // Side skirts: vertical strips hanging SKIRT_DEPTH below each outer edge
  for (const edge of [edgeL, edgeR]) {
    let prevT = null, prevB = null;
    for (const e of edge) {
      const t = pushSkirt(e.x, e.z, e.y, e.nx, e.nz);
      const bt = pushSkirt(e.x, e.z, e.y - SKIRT_DEPTH, e.nx, e.nz);
      if (prevT !== null) indices.push(prevT, prevB, bt, prevT, bt, t);
      prevT = t; prevB = bt;
    }
  }

  // Half-disc fans over free ends (a bare cut edge reads unfinished), with a
  // skirt ring so the cap edge is grounded too
  const cap = (i, sign) => {
    const p = samples[i];
    const q = samples[i + sign]; // neighbor toward the strip
    let bx = p.x - q.x, bz = p.z - q.z; // outward along the strip axis
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    const r = (p.wL + p.wR) / 2;
    const c = pushTop(p.x, p.z, 0);
    const mid = [], outer = [], ring = [];
    for (let s2 = 0; s2 <= CAP_SEGS; s2++) {
      const a = -Math.PI / 2 + (s2 / CAP_SEGS) * Math.PI;
      const dx = bx * Math.cos(a) - bz * Math.sin(a);
      const dz = bx * Math.sin(a) + bz * Math.cos(a);
      mid.push(pushTop(p.x + dx * r * 0.5, p.z + dz * r * 0.5, 0.5));
      outer.push(pushTop(p.x + dx * r, p.z + dz * r, 1));
      ring.push({ x: p.x + dx * r, z: p.z + dz * r, nx: dx, nz: dz });
    }
    for (let s2 = 0; s2 < CAP_SEGS; s2++) {
      indices.push(c, mid[s2], mid[s2 + 1]);
      indices.push(mid[s2], outer[s2], outer[s2 + 1], mid[s2], outer[s2 + 1], mid[s2 + 1]);
    }
    let prevT = null, prevB = null;
    for (let s2 = 0; s2 <= CAP_SEGS; s2++) {
      const y = positions[outer[s2] * 3 + 1];
      const t = pushSkirt(ring[s2].x, ring[s2].z, y, ring[s2].nx, ring[s2].nz);
      const bt = pushSkirt(ring[s2].x, ring[s2].z, y - SKIRT_DEPTH, ring[s2].nx, ring[s2].nz);
      if (prevT !== null) indices.push(prevT, prevB, bt, prevT, bt, t);
      prevT = t; prevB = bt;
    }
  };
  if (opts.capStart) cap(0, 1);
  if (opts.capEnd) cap(n - 1, -1);
}

/**
 * Road ribbon geometry straight from the sampled spline centerlines (already
 * smooth — no post-smoothing). Keeps: crown profile, pinned edges + skirts,
 * per-vertex conformance to analytic terrain AND the rendered ground lattice,
 * adaptive interior clearance, junction Y-lifts, end caps, low-frequency
 * width jitter. Returns raw arrays plus per-strip diagnostics for the
 * validation harness.
 * Must run AFTER generateBuildings — building flat zones alter terrain height.
 */
export function buildRoadRibbonData() {
  if (roadCurves.length === 0) return null;
  const out = { positions: [], normals: [], uvs: [], indices: [], edgeFrac: [] };
  const strips = []; // { kind, yOff, samples }

  let branchOrd = 0;
  for (const curve of roadCurves) {
    const isMain = curve.kind === 'main';
    const yOff = CFG.ROAD_Y_OFFSET + (isMain ? 0 : LIFT_BRANCH[branchOrd++ % 2]);
    emitStrip(curve.samples, { yOff, capStart: isMain, capEnd: true }, out);
    strips.push({ kind: curve.kind, yOff, samples: curve.samples });
  }
  for (const spur of spurCurves) {
    const yOff = CFG.ROAD_Y_OFFSET + LIFT_SPUR;
    emitStrip(spur.samples, {
      yOff, capStart: false, capEnd: false, widenEnd: true, // flat against the door
    }, out);
    strips.push({ kind: 'spur', yOff, samples: spur.samples });
  }

  // Adaptive clearance pass: the base surface (rendered ground ∨ analytic)
  // kinks where the two cross, and a linear road quad can undershoot the kink
  // by ~1cm — grass would slice through the cobbles. Probe each fully-
  // INTERIOR triangle (centroid + edge midpoints) and raise it just enough to
  // clear. Pinned edge vertices and skirts are NEVER moved — the bevel
  // meeting the grass at the edge band is by design.
  const pos = out.positions, ef = out.edgeFrac;
  const MIN_CLEAR = 0.01;
  for (let pass = 0; pass < 3; pass++) {
    let raised = false;
    for (let t = 0; t < out.indices.length; t += 3) {
      const a = out.indices[t], b = out.indices[t + 1], c = out.indices[t + 2];
      if (ef[a] > 0.99 || ef[b] > 0.99 || ef[c] > 0.99) continue; // edge/skirt
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

/** Deterministic integer-lattice hash → [0,1). */
function hash01(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

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
          const sx = s.x + (ci + di - wi) / N * sz;
          const sy = s.y + (cj + dj - wj) / N * sz;
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
