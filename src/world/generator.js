import { CFG } from '../config.js';
import { getGrid, setCell, addStairZone, markUpperFloor, markUpperWall, markStairCell, addDoor, addWindowCell } from './grid.js';
import { rngInt } from '../utils/helpers.js';
import { g2w } from '../utils/helpers.js';
import { addFlatZone } from './terrain.js';

const buildings = [];

export function getBuildings() {
  return buildings;
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

  for (let att = 0; att < 80 && buildings.length < target; att++) {
    const w = rngInt(CFG.MIN_ROOM, CFG.MAX_ROOM);
    const h = rngInt(CFG.MIN_ROOM, CFG.MAX_ROOM);
    const bx = rngInt(3, CFG.GRID - w - 3);
    const bz = rngInt(3, CFG.GRID - h - 3);

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
    // Primary door (south wall, always) — avoid stair column
    let d1gx = bx + rngInt(1, w - 2);
    if (stairGx >= 0 && d1gx === stairGx) {
      d1gx = d1gx > bx + 1 ? d1gx - 1 : d1gx + 1;
      d1gx = Math.max(bx + 1, Math.min(bx + w - 2, d1gx));
    }
    const d1gz = bz + h - 1;
    building.doors.push({ gx: d1gx, gz: d1gz, wall: 'south' });
    addDoor(d1gx, d1gz, { wall: 'south' });

    // Optional west door
    if (Math.random() > 0.4) {
      const dgz = bz + rngInt(1, h - 2);
      building.doors.push({ gx: bx, gz: dgz, wall: 'west' });
      addDoor(bx, dgz, { wall: 'west' });
    }

    // Optional north door — avoid stair column
    if (Math.random() > 0.6) {
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
      if (!doorSet.has(`${gx},${bz}`)) wallCands.north.push({ gx, gz: bz, wall: 'north' });
      if (!doorSet.has(`${gx},${bz + h - 1}`)) wallCands.south.push({ gx, gz: bz + h - 1, wall: 'south' });
    }
    for (let gz = bz + 1; gz < bz + h - 1; gz++) {
      if (!doorSet.has(`${bx},${gz}`)) wallCands.west.push({ gx: bx, gz, wall: 'west' });
      if (!doorSet.has(`${bx + w - 1},${gz}`)) wallCands.east.push({ gx: bx + w - 1, gz, wall: 'east' });
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
