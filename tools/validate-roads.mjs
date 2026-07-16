// Node harness: runs REAL world generation (roads → buildings → door spurs →
// smoothed ribbon geometry) headlessly and asserts the road-mesh invariants.
// No Babylon — imports only the pure modules (roadNetwork, generator, grid,
// terrain, helpers, config).
//
//   node tools/validate-roads.mjs           # one world (+ ASCII preview with --map)
//   (loop it from the shell for many worlds — module state is per-process)
import { CFG } from '../src/config.js';
import { initGrid, getGrid, isRoadCell, isIndoor } from '../src/world/grid.js';
import { getTerrainHeight } from '../src/world/terrain.js';
import { g2w } from '../src/utils/helpers.js';
import {
  generateRoads, getRoadPaths, carveDoorSpurs, getSpurCells, getSpurLandings,
  buildRoadRibbonData, roadSurfaceBase, CROSS_ROWS,
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
if (getRoadPaths().length === 0) {
  console.log('no roads this world (rare valid outcome) — nothing to validate');
  process.exit(0);
}
generateBuildings();

// Snapshot the pre-spur road set (for spur-completeness + gap invariants)
const preSpurRoad = new Set();
for (let gx = 0; gx < CFG.GRID; gx++) {
  for (let gz = 0; gz < CFG.GRID; gz++) {
    if (isRoadCell(gx, gz)) preSpurRoad.add(`${gx},${gz}`);
  }
}

carveDoorSpurs();
const data = buildRoadRibbonData();
assert(data !== null, 'ribbon builder returned null despite roads existing');

const spurCells = getSpurCells();
const landings = getSpurLandings();
const buildings = getBuildings();
const grid = getGrid();
const pos = data.positions;
const vCount = pos.length / 3;

// ── 1. Vertices: no NaN, heights track the visible surface (rendered ground
// mesh ∨ analytic terrain) within [offset, offset+0.15] ─────────────────────
let minY = Infinity, maxY = -Infinity;
for (let v = 0; v < vCount; v++) {
  const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  assert(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z),
    `vertex ${v} has non-finite coords (${x},${y},${z})`);
  const lift = y - roadSurfaceBase(x, z);
  assert(lift >= CFG.ROAD_Y_OFFSET - 1e-9 && lift <= CFG.ROAD_Y_OFFSET + 0.15,
    `vertex ${v} at (${x.toFixed(2)},${z.toFixed(2)}) lift ${lift.toFixed(4)} outside [offset, offset+0.15]`);
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
for (const i of data.indices) {
  assert(i >= 0 && i < vCount, `index ${i} out of range (${vCount} verts)`);
}

// Roads must follow terrain elevation, not sit flat
assert(maxY - minY > 0.2,
  `road elevation range ${(maxY - minY).toFixed(3)} — ribbon is suspiciously flat`);

// ── 2. Strips: continuity of centerline and exact height rule per strip ─────
const distPointSeg = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const distToPolyline = (px, pz, poly) => {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const d = distPointSeg(px, pz, poly[i - 1].x, poly[i - 1].z, poly[i].x, poly[i].z);
    if (d < best) best = d;
  }
  return best;
};

const mainStrip = data.strips[0];
for (const strip of data.strips) {
  const c = strip.centers;
  assert(c.length >= 2, `${strip.kind} strip has ${c.length} samples`);
  for (let i = 1; i < c.length; i++) {
    const d = Math.hypot(c[i].x - c[i - 1].x, c[i].z - c[i - 1].z);
    assert(d > 1e-6 && d < 1.2, `${strip.kind} centerline sample gap ${d.toFixed(3)} at ${i}`);
  }
  // Every marked cell of this strip must lie under the smoothed ribbon:
  // Chaikin pulls at most ~0.32u off a 90° corner cell center, min half-width
  // is ROAD_WIDTH/2*0.85 - JITTER ≈ 0.57 — assert generous 0.6.
  for (const cell of strip.cells) {
    const w = g2w(cell.gx, cell.gz);
    const d = distToPolyline(w.x, w.z, c);
    assert(d < 0.6,
      `${strip.kind} cell ${cell.gx},${cell.gz} is ${d.toFixed(2)}u off its ribbon centerline (hole)`);
  }
  // Junction attachment: branches fork exactly on the main centerline; spurs
  // start on SOME road strip's centerline (main or branch).
  if (strip.kind === 'branch') {
    const d = distToPolyline(c[0].x, c[0].z, mainStrip.centers);
    assert(d < 0.35, `branch start ${d.toFixed(2)}u off the main road centerline (junction gap)`);
  } else if (strip.kind === 'spur') {
    let best = Infinity;
    for (const other of data.strips) {
      if (other.kind === 'spur') continue;
      best = Math.min(best, distToPolyline(c[0].x, c[0].z, other.centers));
    }
    assert(best < 0.35, `spur start ${best.toFixed(2)}u off any road centerline (junction gap)`);
  }
  // Per-strip constant lift (strip vertices all share strip.yOff)
  assert(strip.yOff >= CFG.ROAD_Y_OFFSET && strip.yOff <= CFG.ROAD_Y_OFFSET + 0.15,
    `${strip.kind} yOff ${strip.yOff} out of bounds`);
}

// Strip continuity by construction: total vertex count must equal
// samples*CROSS_ROWS plus cap-fan vertices — duplicated rows would break this.
{
  let expected = 0;
  for (const s of data.strips) expected += s.centers.length * CROSS_ROWS;
  const capVerts = vCount - expected; // 1 + 2*(CAP_SEGS+1) = 15 per emitted cap
  assert(capVerts >= 0 && capVerts % 15 === 0,
    `vertex count ${vCount} != strips(${expected}) + caps*15 (rows duplicated between segments?)`);
}

// ── 3. The visible ground never pokes through the roadbed (tri centroids
// and edge midpoints vs rendered-ground ∨ analytic surface). The crowned
// interior must clear strictly; the outermost edge band (where pavement
// meets grass by design) tolerates ≤2.5cm of contact. ────────────────────────
let worstPen = -Infinity, worstEdgePen = -Infinity;
for (let t = 0; t < data.indices.length; t += 3) {
  const a = data.indices[t], b = data.indices[t + 1], c = data.indices[t + 2];
  const isEdgeBand = data.edgeFrac[a] >= 0.49 && data.edgeFrac[b] >= 0.49 && data.edgeFrac[c] >= 0.49;
  const probes = [
    [(pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3],
    [(pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2],
    [(pos[b * 3] + pos[c * 3]) / 2, (pos[b * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[b * 3 + 2] + pos[c * 3 + 2]) / 2],
    [(pos[a * 3] + pos[c * 3]) / 2, (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2],
  ];
  for (const [cx, cy, cz] of probes) {
    const pen = roadSurfaceBase(cx, cz) - cy; // >0 → grass above the road surface
    if (isEdgeBand) { if (pen > worstEdgePen) worstEdgePen = pen; }
    else if (pen > worstPen) worstPen = pen;
  }
}
assert(worstPen < 0, `ground pokes ${worstPen.toFixed(3)}u through the road interior`);
// Edge band meets the grass by design — a few cm of overlap reads as turf
// growing against the pavement; more than that means the edge is buried.
assert(worstEdgePen < 0.04, `ground pokes ${worstEdgePen.toFixed(3)}u through the road edge band`);

// ── 4. Gap invariant: no non-spur road cell adjacent to a building footprint ─
const inFootprint = (gx, gz) => buildings.some(b =>
  gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h);
for (const key of preSpurRoad) {
  const [gx, gz] = key.split(',').map(Number);
  assert(!inFootprint(gx, gz), `road cell ${key} inside a building footprint`);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      assert(!inFootprint(gx + dx, gz + dz),
        `road cell ${key} adjacent to a building footprint (no grass verge)`);
    }
  }
}
for (const key of spurCells) {
  const [gx, gz] = key.split(',').map(Number);
  assert(!inFootprint(gx, gz), `spur cell ${key} inside a building footprint`);
}

// ── 5. Spur completeness: every road-facing primary door got its spur ───────
const DOOR_NORMALS = { south: [0, 1], north: [0, -1], west: [-1, 0], east: [1, 0] };
let spurredDoors = 0;
for (const b of buildings) {
  const door = b.doors[0];
  if (!door) continue;
  const n = DOOR_NORMALS[door.wall];
  // Re-walk against the PRE-SPUR world: where should a spur have landed?
  let hit = -1;
  for (let k = 1; k <= CFG.ROAD_SPUR_MAX; k++) {
    const gx = door.gx + n[0] * k, gz = door.gz + n[1] * k;
    if (gx < 0 || gx >= CFG.GRID || gz < 0 || gz >= CFG.GRID) break;
    if (preSpurRoad.has(`${gx},${gz}`)) { hit = k; break; }
    if (!grid[gx][gz] || isIndoor(gx, gz)) break;
  }
  if (hit < 0) continue; // door doesn't face a reachable road — no spur expected
  spurredDoors++;
  for (let k = 1; k < hit; k++) {
    const gx = door.gx + n[0] * k, gz = door.gz + n[1] * k;
    assert(isRoadCell(gx, gz) && spurCells.has(`${gx},${gz}`),
      `spur gap: cell ${gx},${gz} between door ${door.gx},${door.gz} and road not marked`);
  }
  const lgx = door.gx + n[0], lgz = door.gz + n[1];
  assert(landings.some(L => L.gx === lgx && L.gz === lgz),
    `door ${door.gx},${door.gz} (${door.wall}) reaches a road but has no landing recorded`);
  // The spur ribbon must reach the doorstep
  const lw = g2w(lgx, lgz);
  const near = data.strips.some(s => s.kind === 'spur'
    && distToPolyline(lw.x, lw.z, s.centers) < 0.6);
  assert(near, `no spur ribbon passes the landing of door ${door.gx},${door.gz}`);
}

// ── ASCII preview of the smoothed network (--map) ────────────────────────────
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
  for (const s of data.strips) {
    const ch = s.kind === 'main' ? '@' : s.kind === 'branch' ? '+' : '.';
    for (let i = 1; i < s.centers.length; i++) {
      const a = s.centers[i - 1], b2 = s.centers[i];
      for (let t = 0; t <= 1; t += 0.25) {
        plot(a.x + (b2.x - a.x) * t, a.z + (b2.z - a.z) * t, ch);
      }
    }
  }
  console.log(img.map(r => r.join('')).join('\n'));
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(
  `roads: ${preSpurRoad.size}+${spurCells.size} cells, ${data.strips.length} strips ` +
  `(${landings.length} landings), ${buildings.length} buildings (${spurredDoors} road-facing doors), ` +
  `${vCount} verts, ${data.indices.length / 3} tris, ` +
  `elevation ${minY.toFixed(2)}..${maxY.toFixed(2)} (range ${(maxY - minY).toFixed(2)}), ` +
  `clearance deficit interior ${worstPen.toFixed(3)} / edge ${worstEdgePen.toFixed(3)}`
);
if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  process.exit(1);
}
console.log('OK');
