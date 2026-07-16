import { CFG } from '../config.js';
import { getGrid, setCell, addStairZone, markUpperFloor, markUpperWall, markStairCell, addDoor, addWindowCell, markIndoor, isRoadCell } from './grid.js';
import { rngInt } from '../utils/helpers.js';
import { g2w } from '../utils/helpers.js';
import { addFlatZone } from './terrain.js';
import { getRoadPaths, roadDistanceToRect } from './roadNetwork.js';

const buildings = [];

export function getBuildings() {
  return buildings;
}

/** Get the wall height at a grid cell (building stories * WALL_H) */
export function getWallHeightAt(gx, gz) {
  for (const b of buildings) {
    if (gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h) {
      return b.stories * CFG.WALL_H;
    }
  }
  return CFG.WALL_H;
}

/** Check if a world position is inside any building interior */
export function isInsideBuilding(wx, wz) {
  for (const b of buildings) {
    const bx1 = b.x * 2 - CFG.GRID + 1;
    const bz1 = b.z * 2 - CFG.GRID + 1;
    const bx2 = (b.x + b.w) * 2 - CFG.GRID - 1;
    const bz2 = (b.z + b.h) * 2 - CFG.GRID - 1;
    if (wx > bx1 && wx < bx2 && wz > bz1 && wz < bz2) return true;
  }
  return false;
}

export function generateBuildings() {
  // Flat zone around player spawn
  addFlatZone(-8, -8, 8, 8);

  const target = rngInt(CFG.MIN_BUILDINGS, CFG.MAX_BUILDINGS);

  // Directed road seeds: each road cell with its local forward direction —
  // buildings are placed beside these so the village lines the roads
  const roadSeeds = [];
  for (const path of getRoadPaths()) {
    for (let i = 1; i < path.length; i++) {
      const dx = Math.sign(path[i].gx - path[i - 1].gx);
      const dz = Math.sign(path[i].gz - path[i - 1].gz);
      if (dx === 0 && dz === 0) continue;
      roadSeeds.push({ gx: path[i].gx, gz: path[i].gz, dx, dz });
    }
  }

  for (let att = 0; att < 300 && buildings.length < target; att++) {
    const w = rngInt(CFG.MIN_ROOM, CFG.MAX_ROOM);
    const h = rngInt(CFG.MIN_ROOM, CFG.MAX_ROOM);

    // Place beside a road: footprint 1-2 cells off a road cell, near wall
    // facing the road segment (that wall gets the primary door)
    let bx, bz, roadWall = null, seed = null;
    if (roadSeeds.length > 0) {
      seed = roadSeeds[Math.floor(Math.random() * roadSeeds.length)];
      const gap = rngInt(2, 3);                 // GRASS cells between road and near wall
      const s = Math.random() < 0.5 ? 1 : -1;   // which side of the road
      const px = -seed.dz * s, pz = seed.dx * s; // perpendicular to road direction
      if (px !== 0) {
        bx = px > 0 ? seed.gx + gap + 1 : seed.gx - gap - w;
        bz = seed.gz - rngInt(1, h - 2);        // seed row lands in door-eligible range
        roadWall = px > 0 ? 'west' : 'east';
      } else {
        bz = pz > 0 ? seed.gz + gap + 1 : seed.gz - gap - h;
        bx = seed.gx - rngInt(1, w - 2);
        roadWall = pz > 0 ? 'north' : 'south';
      }
      if (bx < 3 || bz < 3 || bx + w > CFG.GRID - 3 || bz + h > CFG.GRID - 3) continue;
    } else {
      // No roads (generation failed) — legacy random placement
      bx = rngInt(3, CFG.GRID - w - 3);
      bz = rngInt(3, CFG.GRID - h - 3);
    }

    let ok = true;
    for (const b of buildings) {
      if (bx - 2 < b.x + b.w && bx + w + 2 > b.x &&
        bz - 2 < b.z + b.h && bz + h + 2 > b.z) {
        ok = false;
        break;
      }
    }

    const cx = CFG.GRID / 2;
    const cz = CFG.GRID / 2;
    const cl = CFG.PLAYER_CLEAR;
    if (bx <= cx + cl && bx + w >= cx - cl && bz <= cz + cl && bz + h >= cz - cl) {
      ok = false;
    }

    // Footprint must never cover a road cell, and walls keep a real grass
    // verge measured from the road CURVE itself (cells are only a coarse
    // rasterization of it) — door spurs are carved separately afterwards.
    if (ok) {
      for (let gx = bx; gx < bx + w && ok; gx++) {
        for (let gz = bz; gz < bz + h && ok; gz++) {
          if (isRoadCell(gx, gz)) ok = false;
        }
      }
    }
    if (ok && roadDistanceToRect(bx, bz, w, h) < 4) ok = false;

    if (!ok) continue;

    const large = w >= 5 && h >= 5;
    const stories = large && Math.random() > 0.65 ? 2 : 1;
    const roofType = Math.random() > 0.5 ? 'slanted' : 'flat';

    const building = { x: bx, z: bz, w, h, stories, roofType, stair: null, doors: [], windows: [] };
    buildings.push(building);

    // Register flat zone for terrain (with 2-cell margin)
    const fp1 = g2w(bx - 1, bz - 1);
    const fp2 = g2w(bx + w, bz + h);
    addFlatZone(fp1.x - CFG.CELL / 2, fp1.z - CFG.CELL / 2,
      fp2.x + CFG.CELL / 2, fp2.z + CFG.CELL / 2);

    // walls on perimeter
    for (let gx = bx; gx < bx + w; gx++) {
      setCell(gx, bz, false);
      setCell(gx, bz + h - 1, false);
    }
    for (let gz = bz; gz < bz + h; gz++) {
      setCell(bx, gz, false);
      setCell(bx + w - 1, gz, false);
    }

    // Mark interior cells as indoor (so flowers/rocks don't spawn inside)
    for (let gx = bx; gx < bx + w; gx++) {
      for (let gz = bz; gz < bz + h; gz++) {
        markIndoor(gx, gz);
      }
    }

    // Stairs for 2-story buildings (computed early so doors can avoid stairwell)
    let stairGx = -1;
    if (stories === 2) {
      stairGx = bx + w - 2;
      const stairGzStart = bz + 1;
      const stairNumCells = Math.min(3, h - 3);
      const stairGzEnd = stairGzStart + stairNumCells - 1;

      building.stair = { gx: stairGx, gzStart: stairGzStart, gzEnd: stairGzEnd };

      // Block stair cells so ground-floor entities can't walk under
      for (let gz = stairGzStart; gz <= stairGzEnd; gz++) {
        setCell(stairGx, gz, false);
        markStairCell(stairGx, gz);
      }

      const p1 = g2w(stairGx, stairGzStart);
      const p2 = g2w(stairGx, stairGzEnd);
      addStairZone({
        xMin: p1.x - CFG.CELL / 2,
        xMax: p1.x + CFG.CELL / 2,
        zMin: p1.z - CFG.CELL / 2,
        zMax: p2.z + CFG.CELL / 2,
        // Geometry zMin (floors.js) differs from zone zMin — geometry extends to building wall
        geomZMin: g2w(0, bz).z + CFG.WALL_T / 2,
        hStart: CFG.WALL_H,
        hEnd: 0,
      });

      // Interior cells = upper floor (walkable on 2nd floor)
      for (let gx = bx + 1; gx < bx + w - 1; gx++) {
        for (let gz = bz + 1; gz < bz + h - 1; gz++) {
          if (gx === stairGx && gz >= stairGzStart && gz <= stairGzEnd) continue;
          markUpperFloor(gx, gz);
        }
      }
      // Perimeter cells = upper wall (blocked on 2nd floor, prevents walking through doors/walls)
      for (let gx = bx; gx < bx + w; gx++) {
        markUpperWall(gx, bz);
        markUpperWall(gx, bz + h - 1);
      }
      for (let gz = bz + 1; gz < bz + h - 1; gz++) {
        markUpperWall(bx, gz);
        markUpperWall(bx + w - 1, gz);
      }
    }

    // Doors — cells stay BLOCKED, tracked separately for door meshes
    // Primary door: FORCED onto the wall facing the road this building was
    // seeded from (legacy fallback: south wall) — avoid stair column
    const primaryWall = roadWall || 'south';
    let d1gx, d1gz;
    if (primaryWall === 'north' || primaryWall === 'south') {
      // Door directly opposite the seed road cell when possible
      d1gx = seed ? Math.max(bx + 1, Math.min(bx + w - 2, seed.gx)) : bx + rngInt(1, w - 2);
      if (stairGx >= 0 && d1gx === stairGx) {
        d1gx = d1gx > bx + 1 ? d1gx - 1 : d1gx + 1;
        d1gx = Math.max(bx + 1, Math.min(bx + w - 2, d1gx));
      }
      d1gz = primaryWall === 'south' ? bz + h - 1 : bz;
    } else {
      d1gz = seed ? Math.max(bz + 1, Math.min(bz + h - 2, seed.gz)) : bz + rngInt(1, h - 2);
      // East wall is adjacent to the stair column — keep the door off the stairwell rows
      if (primaryWall === 'east' && building.stair
        && d1gz >= building.stair.gzStart && d1gz <= building.stair.gzEnd) {
        d1gz = Math.min(bz + h - 2, building.stair.gzEnd + 1);
      }
      d1gx = primaryWall === 'west' ? bx : bx + w - 1;
    }
    building.doors.push({ gx: d1gx, gz: d1gz, wall: primaryWall });
    addDoor(d1gx, d1gz, { wall: primaryWall });

    // Optional secondary doors on the remaining walls (legacy odds)
    if (primaryWall !== 'south' && Math.random() > 0.6) {
      let dgx = bx + rngInt(1, w - 2);
      if (stairGx >= 0 && dgx === stairGx) {
        dgx = dgx > bx + 1 ? dgx - 1 : dgx + 1;
        dgx = Math.max(bx + 1, Math.min(bx + w - 2, dgx));
      }
      building.doors.push({ gx: dgx, gz: bz + h - 1, wall: 'south' });
      addDoor(dgx, bz + h - 1, { wall: 'south' });
    }

    // Optional west door
    if (primaryWall !== 'west' && Math.random() > 0.4) {
      const dgz = bz + rngInt(1, h - 2);
      building.doors.push({ gx: bx, gz: dgz, wall: 'west' });
      addDoor(bx, dgz, { wall: 'west' });
    }

    // Optional north door — avoid stair column
    if (primaryWall !== 'north' && Math.random() > 0.6) {
      let dgx = bx + rngInt(1, w - 2);
      if (stairGx >= 0 && dgx === stairGx) {
        dgx = dgx > bx + 1 ? dgx - 1 : dgx + 1;
        dgx = Math.max(bx + 1, Math.min(bx + w - 2, dgx));
      }
      building.doors.push({ gx: dgx, gz: bz, wall: 'north' });
      addDoor(dgx, bz, { wall: 'north' });
    }

    // Windows — at most 1 per wall direction, ~50% chance each
    const doorSet = new Set(building.doors.map(d => `${d.gx},${d.gz}`));
    const wallCands = { north: [], south: [], east: [], west: [] };

    for (let gx = bx + 1; gx < bx + w - 1; gx++) {
      // The staircase climbs along the east column (stairGx) with its top
      // landing against the NORTH wall — a window there is embedded in the
      // stair volume and reads as a hole through the steps.
      const behindStairTop = stairGx >= 0 && gx === stairGx;
      if (!doorSet.has(`${gx},${bz}`) && !behindStairTop) {
        wallCands.north.push({ gx, gz: bz, wall: 'north' });
      }
      if (!doorSet.has(`${gx},${bz + h - 1}`)) wallCands.south.push({ gx, gz: bz + h - 1, wall: 'south' });
    }
    for (let gz = bz + 1; gz < bz + h - 1; gz++) {
      if (!doorSet.has(`${bx},${gz}`)) wallCands.west.push({ gx: bx, gz, wall: 'west' });

      // East wall is at bx + w - 1, directly adjacent to the stair at stairGx (bx + w - 2).
      // Prevent windows on the east wall behind the stairs.
      let behindStairs = false;
      if (stairGx >= 0 && (bx + w - 1 === stairGx + 1)) {
        if (gz >= building.stair.gzStart && gz <= building.stair.gzEnd) {
          behindStairs = true;
        }
      }

      if (!doorSet.has(`${bx + w - 1},${gz}`) && !behindStairs) {
        wallCands.east.push({ gx: bx + w - 1, gz, wall: 'east' });
      }
    }

    // Random window size: wFrac = width fraction of cell, hFrac = height fraction of wall
    const rndWin = () => ({ wFrac: 0.35 + Math.random() * 0.5, hFrac: 0.25 + Math.random() * 0.4 });

    // Ground floor: each wall has ~50% chance of 1 window
    for (const dir of ['north', 'south', 'east', 'west']) {
      const cands = wallCands[dir];
      if (cands.length > 0 && Math.random() > 0.5) {
        const pick = cands[Math.floor(Math.random() * cands.length)];
        building.windows.push({ ...pick, floor: 1, ...rndWin() });
        addWindowCell(pick.gx, pick.gz);
      }
    }

    // 2nd floor: each wall has ~60% chance of 1 window
    if (stories === 2) {
      for (const dir of ['north', 'south', 'east', 'west']) {
        const cands = wallCands[dir];
        if (cands.length > 0 && Math.random() > 0.4) {
          const pick = cands[Math.floor(Math.random() * cands.length)];
          building.windows.push({ ...pick, floor: 2, ...rndWin() });
          addWindowCell(pick.gx, pick.gz);
        }
      }
    }
  }
}
