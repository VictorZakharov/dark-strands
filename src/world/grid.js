import { CFG } from '../config.js';
import { w2g, g2w, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';

const grid = [];
const stairZones = [];
const upperFloorCells = new Set();
const upperWallCells = new Set(); // Cells blocked on upper floor (perimeter of 2-story buildings)
const indoorCells = new Set();    // Ground-floor interior cells (inside building bounds)

export function getGrid() {
  return grid;
}

export function initGrid() {
  for (let x = 0; x < CFG.GRID; x++) {
    grid[x] = [];
    for (let z = 0; z < CFG.GRID; z++) {
      grid[x][z] = true;
    }
  }
  stairZones.length = 0;
  upperFloorCells.clear();
  upperWallCells.clear();
  doorCells.clear();
  windowCells.clear();
  stairCells.clear();
  treeCells.clear();
}

export function setCell(gx, gz, value) {
  if (gx >= 0 && gx < CFG.GRID && gz >= 0 && gz < CFG.GRID) {
    grid[gx][gz] = value;
  }
}

export function isWalkable(wx, wz, entityY) {
  const g = w2g(wx, wz);
  if (g.x < 0 || g.x >= CFG.GRID || g.z < 0 || g.z >= CFG.GRID) return false;

  // Upper wall cells: blocked when entity is at upper floor height
  if (entityY !== undefined && upperWallCells.has(`${g.x},${g.z}`)) {
    const terrain = getTerrainHeight(wx, wz);
    if (entityY > terrain + CFG.WALL_H - 1.0) return false;
  }

  if (grid[g.x][g.z]) return true;

  // If cell is blocked but entity is on the stair ramp at this position, allow it
  if (entityY !== undefined) {
    const terrain = getTerrainHeight(wx, wz);
    for (const s of stairZones) {
      if (wx >= s.xMin && wx <= s.xMax && wz >= s.zMin && wz <= s.zMax) {
        const t = Math.max(0, Math.min(1, (wz - s.zMin) / (s.zMax - s.zMin)));
        const stairY = terrain + s.hStart + t * (s.hEnd - s.hStart);
        if (entityY > stairY - 1.5 && entityY < stairY + 1.0) return true;
        // Player on upper floor above stair zone — still walkable
        if (entityY >= terrain + CFG.WALL_H - 0.5) return true;
      }
    }
  }

  return false;
}

export function canMoveTo(x, z, entityY) {
  const r = CFG.PLAYER_R;
  return isWalkable(x - r, z - r, entityY) &&
         isWalkable(x + r, z - r, entityY) &&
         isWalkable(x - r, z + r, entityY) &&
         isWalkable(x + r, z + r, entityY);
}

export function canMoveToR(x, z, r) {
  return isWalkable(x - r, z - r) &&
         isWalkable(x + r, z - r) &&
         isWalkable(x - r, z + r) &&
         isWalkable(x + r, z + r);
}

const doorCells = new Map();
const windowCells = new Set();
const stairCells = new Set();
const treeCells = new Set();

export function addDoor(gx, gz, data) {
  doorCells.set(`${gx},${gz}`, data);
}

export function isDoorCell(gx, gz) {
  return doorCells.has(`${gx},${gz}`);
}

export function getDoorCells() {
  return doorCells;
}

export function addWindowCell(gx, gz) {
  windowCells.add(`${gx},${gz}`);
}

export function isWindowCell(gx, gz) {
  return windowCells.has(`${gx},${gz}`);
}

export function addStairZone(zone) {
  stairZones.push(zone);
}

export function markStairCell(gx, gz) {
  stairCells.add(`${gx},${gz}`);
}

export function isStairCell(gx, gz) {
  return stairCells.has(`${gx},${gz}`);
}

export function markTreeCell(gx, gz) {
  treeCells.add(`${gx},${gz}`);
}

export function isTreeCell(gx, gz) {
  return treeCells.has(`${gx},${gz}`);
}

export function isUpperFloorCell(gx, gz) {
  return upperFloorCells.has(`${gx},${gz}`);
}

export function markUpperFloor(gx, gz) {
  upperFloorCells.add(`${gx},${gz}`);
}

export function markUpperWall(gx, gz) {
  upperWallCells.add(`${gx},${gz}`);
}

export function markIndoor(gx, gz) {
  indoorCells.add(`${gx},${gz}`);
}

export function isIndoor(gx, gz) {
  return indoorCells.has(`${gx},${gz}`);
}

/**
 * Get the floor height at a world position. Uses stair ramps and
 * upper floor detection based on current player Y.
 */
export function getFloorHeight(wx, wz, currentY) {
  const terrain = getTerrainHeight(wx, wz);

  // Stair zones: terrain + stair ramp (only if player is near the ramp surface)
  for (const s of stairZones) {
    if (wx >= s.xMin && wx <= s.xMax && wz >= s.zMin && wz <= s.zMax) {
      const t = Math.max(0, Math.min(1, (wz - s.zMin) / (s.zMax - s.zMin)));
      const stairY = terrain + s.hStart + t * (s.hEnd - s.hStart);
      // Only catch the player if they're near/above the stair surface
      // If well below (under the stairs), ignore the ramp
      if (currentY > stairY - 1.5 && currentY < stairY + 1.0) {
        return stairY;
      }
      // Player above stair ramp on upper floor — return upper floor height
      if (currentY >= terrain + CFG.WALL_H - 0.5) {
        return terrain + CFG.WALL_H;
      }
    }
  }

  // Upper floor cells
  const g = w2g(wx, wz);
  if (g.x >= 0 && g.x < CFG.GRID && g.z >= 0 && g.z < CFG.GRID) {
    if (upperFloorCells.has(`${g.x},${g.z}`) && currentY > terrain + CFG.WALL_H - 0.5) {
      return terrain + CFG.WALL_H;
    }
  }

  return terrain;
}

export function randomWalkablePos() {
  for (let i = 0; i < 200; i++) {
    const gx = rngInt(2, CFG.GRID - 3);
    const gz = rngInt(2, CFG.GRID - 3);
    if (grid[gx][gz]) {
      if (Math.abs(gx - CFG.GRID / 2) < 4 && Math.abs(gz - CFG.GRID / 2) < 4) continue;
      // Don't spawn inside buildings
      if (indoorCells.has(`${gx},${gz}`)) continue;
      const p = g2w(gx, gz);
      // Don't spawn in water (unless snow mode where water is ice)
      if (!CFG.SNOW_MODE && getTerrainHeight(p.x, p.z) < CFG.WATER_Y) continue;
      return p;
    }
  }
  return null;
}
