// Node harness: runs REAL world generation (curve-first roads → buildings →
// door spurs → ribbon geometry → torch sites) headlessly and asserts the
// road invariants. No Babylon — imports only the pure modules.
//
//   node tools/validate-roads.mjs           # one world (+ ASCII preview with --map)
//   (loop it from the shell for many worlds — module state is per-process)
import { CFG } from '../src/config.js';
import { initGrid, isRoadCell } from '../src/world/grid.js';
import { getTerrainHeight } from '../src/world/terrain.js';
import { g2w } from '../src/utils/helpers.js';
import {
  generateRoads, getRoadCurves, getSpurCurves, getRoadPaths, getDoorSpurDiag,
  getSpurLandings, carveDoorSpurs, buildRoadRibbonData, computeTorchSites,
  roadSurfaceBase, roadEdgeBase, roadDistanceToRect, minTurnRadius,
  roadRasterR, EDGE_SINK, SKIRT_DEPTH,
} from '../src/world/roadNetwork.js';
import { generateBuildings, getBuildings } from '../src/world/generator.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL: ' + msg);
  }
}

// ── Generate a world exactly like main.js does ──────────────────────────────
initGrid();
generateRoads();
if (getRoadCurves().length === 0) {
  console.log('no roads this world (rare valid outcome) — nothing to validate');
  process.exit(0);
}
generateBuildings();
carveDoorSpurs();
const data = buildRoadRibbonData();
const sites = computeTorchSites();
assert(data !== null, 'ribbon builder returned null despite roads existing');

const roadCurves = getRoadCurves();
const spurCurves = getSpurCurves();
const buildings = getBuildings();
const landings = getSpurLandings();
const diags = getDoorSpurDiag();

// ── 1. Curves: bounded curvature, on land, in bounds, off the spawn clearing ─
const marginBox = CFG.HALF - CFG.ROAD_EDGE_MARGIN * CFG.CELL;
const clearingR = (CFG.PLAYER_CLEAR + 1) * CFG.CELL + 1;
const allSampleSets = [
  ...roadCurves.map(c => ({ kind: c.kind, samples: c.samples, minR: CFG.ROAD_MIN_RADIUS })),
  ...spurCurves.map(c => ({ kind: 'spur', samples: c.samples, minR: 3 })),
];
for (const { kind, samples, minR } of allSampleSets) {
  const { radius } = minTurnRadius(samples);
  assert(radius >= minR * 0.85,
    `${kind} min turning radius ${radius.toFixed(2)} < bound ${minR}`);
  for (const s of samples) {
    assert(getTerrainHeight(s.x, s.z) >= CFG.WATER_Y + 0.3 - 1e-6,
      `${kind} sample (${s.x.toFixed(1)},${s.z.toFixed(1)}) is underwater`);
    assert(Math.abs(s.x) <= marginBox + 0.5 && Math.abs(s.z) <= marginBox + 0.5,
      `${kind} sample (${s.x.toFixed(1)},${s.z.toFixed(1)}) outside the edge margin`);
    if (kind !== 'spur') {
      assert(!(Math.abs(s.x) < clearingR && Math.abs(s.z) < clearingR),
        `${kind} sample (${s.x.toFixed(1)},${s.z.toFixed(1)}) crosses the spawn clearing`);
    }
    assert(s.wL > 0.3 && s.wR > 0.3 && s.wL < 2 && s.wR < 2,
      `${kind} sample width out of range (${s.wL},${s.wR})`);
  }
  // Uniform-ish arc sampling — the ribbon extruder depends on it
  for (let i = 1; i < samples.length; i++) {
    const d = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    assert(d > 1e-6 && d < 0.8, `${kind} sample spacing ${d.toFixed(3)} at ${i}`);
  }
}

// Main road spans a real distance and branches begin ON the main curve
assert(roadCurves[0].kind === 'main', 'first curve is not the main road');
assert(roadCurves[0].samples.length * 0.5 > 60, 'main road is too short');
for (const c of roadCurves.slice(1)) {
  const s0 = c.samples[0];
  let best = Infinity;
  for (const m of roadCurves[0].samples) {
    best = Math.min(best, Math.hypot(m.x - s0.x, m.z - s0.z));
  }
  assert(best < 0.6, `branch starts ${best.toFixed(2)}u off the main curve (junction gap)`);
}

// ── 2. Rasterization: cells cover the curves, coverage is one connected blob ─
const cellKey = (gx, gz) => `${gx},${gz}`;
const roadCellSet = new Set();
for (let gx = 0; gx < CFG.GRID; gx++) {
  for (let gz = 0; gz < CFG.GRID; gz++) {
    if (isRoadCell(gx, gz)) roadCellSet.add(cellKey(gx, gz));
  }
}
const allSamples = [];
for (const { samples } of allSampleSets) allSamples.push(...samples);
for (const s of allSamples) {
  const gx = Math.floor((s.x + CFG.HALF) / CFG.CELL);
  const gz = Math.floor((s.z + CFG.HALF) / CFG.CELL);
  assert(isRoadCell(gx, gz), `sample (${s.x.toFixed(1)},${s.z.toFixed(1)}) cell not rasterized`);
}
// No stray cells: every marked cell is near some sample
const maxR = roadRasterR() + 1e-6;
for (const key of roadCellSet) {
  const [gx, gz] = key.split(',').map(Number);
  const c = g2w(gx, gz);
  let best = Infinity;
  for (const s of allSamples) {
    const d = (s.x - c.x) ** 2 + (s.z - c.z) ** 2;
    if (d < best) best = d;
  }
  assert(Math.sqrt(best) <= maxR, `road cell ${key} is ${Math.sqrt(best).toFixed(2)}u from any sample (stray)`);
}
// Single 8-connected component (branches touch main, spurs touch roads)
{
  const first = roadCellSet.values().next().value;
  const seen = new Set([first]);
  const stack = [first];
  while (stack.length) {
    const [gx, gz] = stack.pop().split(',').map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const k = cellKey(gx + dx, gz + dz);
        if (roadCellSet.has(k) && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
  }
  assert(seen.size === roadCellSet.size,
    `rasterized road cells not contiguous (${seen.size}/${roadCellSet.size} reachable)`);
}
// Cell paths handed to generator.js stay 4-connected
for (const path of getRoadPaths()) {
  for (let i = 1; i < path.length; i++) {
    const man = Math.abs(path[i].gx - path[i - 1].gx) + Math.abs(path[i].gz - path[i - 1].gz);
    assert(man === 1, `cellPath step ${i} is not 4-connected (manhattan ${man})`);
  }
}

// ── 3. Buildings keep a real verge, measured from the curve ─────────────────
for (const b of buildings) {
  const d = roadDistanceToRect(b.x, b.z, b.w, b.h);
  assert(d >= 4 - 1e-6, `building at ${b.x},${b.z} is ${d.toFixed(2)}u from the road curve (< 4)`);
}

// ── 4. Spurs: every eligible primary door is served ─────────────────────────
assert(diags.length === buildings.length, 'spur diagnostics missing for some buildings');
let served = 0;
for (const d of diags) {
  if (!d.eligible) {
    assert(d.reason.length > 0, `door ${d.gx},${d.gz} ineligible without a reason`);
    continue;
  }
  served++;
  const n = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] }[d.wall];
  const lgx = d.gx + n[0], lgz = d.gz + n[1];
  const L = g2w(lgx, lgz);
  const spur = spurCurves.find(s => s.landing.gx === lgx && s.landing.gz === lgz);
  assert(!!spur, `eligible door ${d.gx},${d.gz} has no spur curve`);
  if (!spur) continue;
  assert(isRoadCell(lgx, lgz), `landing cell ${lgx},${lgz} not rasterized as road`);
  // Spur starts on a road curve and passes the landing on its way to the door
  const s0 = spur.samples[0];
  let onRoad = Infinity;
  for (const c of roadCurves) {
    for (const q of c.samples) {
      onRoad = Math.min(onRoad, Math.hypot(q.x - s0.x, q.z - s0.z));
    }
  }
  assert(onRoad < 0.3, `spur for door ${d.gx},${d.gz} starts ${onRoad.toFixed(2)}u off the road`);
  let nearLanding = Infinity;
  for (const q of spur.samples) {
    nearLanding = Math.min(nearLanding, Math.hypot(q.x - L.x, q.z - L.z));
  }
  assert(nearLanding < 0.6, `spur misses its landing by ${nearLanding.toFixed(2)}u (door ${d.gx},${d.gz})`);
  const end = spur.samples[spur.samples.length - 1];
  const doorDist = Math.hypot(end.x - L.x, end.z - L.z);
  assert(doorDist > 1.0 && doorDist < 2.0,
    `spur end ${doorDist.toFixed(2)}u from landing — not tucked under the door`);
}
assert(landings.length === served, 'landings count != served doors');

// ── 5. Torch sites: on land, off the roads, just off the ribbon edge ────────
const W2 = CFG.ROAD_WIDTH / 2;
for (const site of sites) {
  assert(site.y >= CFG.WATER_Y + 0.3 - 1e-6, `torch site (${site.x.toFixed(1)},${site.z.toFixed(1)}) underwater`);
  let best = Infinity;
  for (const s of allSamples) {
    best = Math.min(best, Math.hypot(s.x - site.x, s.z - site.z));
  }
  assert(best >= W2 + 0.5 - 1e-6 && best <= W2 + 1.3,
    `torch site ${best.toFixed(2)}u from the nearest centerline (expected ~${(W2 + 0.8).toFixed(2)})`);
  assert(Math.hypot(site.nx, site.nz) > 0.99, 'torch site normal not unit length');
}
assert(sites.length >= 1, 'no torch post sites at all on a full-size road network');

// ── 6. Mesh: finite, pinned edges, interior clearance, skirts cover gaps ────
const pos = data.positions, ef = data.edgeFrac;
const vCount = pos.length / 3;
let minY = Infinity, maxY = -Infinity;
for (let v = 0; v < vCount; v++) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  assert(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
    `vertex ${v} has non-finite coords`);
  if (ef[v] > 1.5) continue; // skirt verts checked via triangles below
  const base = roadSurfaceBase(x, z);
  if (ef[v] > 0.999) {
    // Pinned outer edge: at or below the ground, never floating
    assert(y <= base + 0.01, `edge vertex ${v} floats ${(y - base).toFixed(3)}u above ground`);
    assert(y >= base - 2, `edge vertex ${v} absurdly deep`);
  } else {
    const lift = y - base;
    assert(lift >= CFG.ROAD_Y_OFFSET - 1e-9 && lift <= 0.3,
      `interior vertex ${v} lift ${lift.toFixed(3)} out of range`);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
for (const i of data.indices) {
  assert(i >= 0 && i < vCount, `index ${i} out of range`);
}
assert(maxY - minY > 0.2, `road elevation range ${(maxY - minY).toFixed(2)} — suspiciously flat`);

// Interior triangles: the visible ground never pokes through the roadbed
let worstPen = -Infinity;
for (let t = 0; t < data.indices.length; t += 3) {
  const a = data.indices[t], b = data.indices[t + 1], c = data.indices[t + 2];
  if (ef[a] > 0.99 || ef[b] > 0.99 || ef[c] > 0.99) continue;
  const probes = [
    [(pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3],
    [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2],
    [(pos[b * 3] + pos[c * 3]) / 2, (pos[b * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[b * 3 + 2] + pos[c * 3 + 2]) / 2],
    [(pos[a * 3] + pos[c * 3]) / 2, (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2],
  ];
  for (const [cx, cy, cz] of probes) {
    const pen = roadSurfaceBase(cx, cz) - cy;
    if (pen > worstPen) worstPen = pen;
  }
}
assert(worstPen < 0, `ground pokes ${worstPen.toFixed(3)}u through the road interior`);

// Skirts: at every skirt triangle the lowest visible ground must stay above
// the skirt bottom (no exposed underside anywhere along the edges); measure
// how much depth was actually needed
let maxGapNeeded = -Infinity;
for (let t = 0; t < data.indices.length; t += 3) {
  const a = data.indices[t], b = data.indices[t + 1], c = data.indices[t + 2];
  if (!(ef[a] > 1.5 && ef[b] > 1.5 && ef[c] > 1.5)) continue;
  const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
  const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
  const topY = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
  const botY = Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
  const groundLow = roadEdgeBase(cx, cz) + EDGE_SINK; // min(analytic, rendered)
  const gap = topY - groundLow;
  if (gap > maxGapNeeded) maxGapNeeded = gap;
  assert(groundLow >= botY - 0.01,
    `underside exposed: ground ${groundLow.toFixed(2)} below skirt bottom ${botY.toFixed(2)} at (${cx.toFixed(1)},${cz.toFixed(1)})`);
}
assert(maxGapNeeded <= SKIRT_DEPTH,
  `edge-to-ground gap ${maxGapNeeded.toFixed(3)} exceeds SKIRT_DEPTH ${SKIRT_DEPTH}`);

// ── ASCII preview of the curve network (--map) ───────────────────────────────
if (process.argv.includes('--map')) {
  const W = 156, H = 78;
  const img = Array.from({ length: H }, () => new Array(W).fill(' '));
  const plot = (x, z, ch) => {
    const ix = Math.round((x + CFG.HALF) / (2 * CFG.HALF) * (W - 1));
    const iz = Math.round((z + CFG.HALF) / (2 * CFG.HALF) * (H - 1));
    if (ix >= 0 && ix < W && iz >= 0 && iz < H && img[iz][ix] !== 'D') img[iz][ix] = ch;
  };
  for (const b of buildings) {
    for (let gx = b.x; gx < b.x + b.w; gx++) {
      for (let gz = b.z; gz < b.z + b.h; gz++) {
        const w = g2w(gx, gz);
        plot(w.x, w.z, '#');
      }
    }
    const d0 = b.doors[0];
    const dw = g2w(d0.gx, d0.gz);
    plot(dw.x, dw.z, 'D');
  }
  for (const { kind, samples } of allSampleSets) {
    const ch = kind === 'main' ? '@' : kind === 'branch' ? '+' : '.';
    for (const s of samples) plot(s.x, s.z, ch);
  }
  for (const s of sites) plot(s.x, s.z, 'T');
  console.log(img.map(r => r.join('')).join('\n'));
}

// ── Summary ──────────────────────────────────────────────────────────────────
const mainRad = minTurnRadius(roadCurves[0].samples).radius;
console.log(
  `curves: 1 main (${(roadCurves[0].samples.length * 0.5).toFixed(0)}u, minR ${mainRad === Infinity ? 'inf' : mainRad.toFixed(1)}) ` +
  `+ ${roadCurves.length - 1} branches + ${spurCurves.length} spurs, ` +
  `${roadCellSet.size} cells, ${buildings.length} buildings (${served} doors served), ` +
  `${sites.length} torch sites, ${vCount} verts, ${data.indices.length / 3} tris, ` +
  `interior clearance ${(-worstPen).toFixed(3)}, skirt need ${maxGapNeeded.toFixed(3)}/${SKIRT_DEPTH}`
);
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('OK');
