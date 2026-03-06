import {
  MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode
} from 'babylonjs';
import { isWalkable, isDoorCell, isWindowCell } from './grid.js';
import { getWallHeightAt, isInsideBuilding } from './generator.js';
import { isInsideWindowOpening } from './windows.js';
import { collidesWithRock } from './vegetation.js';
import { getDoorByCell, getAllDoors } from './doors.js';
import { g2w, w2g } from '../utils/helpers.js';
import { CFG } from '../config.js';
import { getPlayerState, getCamBlend } from '../entities/player.js';
import { getTerrainHeight } from './terrain.js';
import { getInventory } from './flowers.js';
import { getClusteredContainer } from './torchLighting.js';
import { addTorchEmbers } from './torchParticles.js';
import {
  getPickableTorches, getPlayerDoorTorches, getTorchLights,
  createWallTorch, createGroundTorch, TILT, TIP_OUT, TIP_UP, STICK_LEN
} from './torches.js';

let previewGroup = null;
let previewStick = null;
let previewFlame = null;
let placementHit = null; // { type:'wall'|'ground', x,z,y, nx?,nz? }

const PLACE_MAX_DIST_WALL = 6;
const PLACE_MAX_DIST_GROUND = 3;
const PLACE_STEP = 0.12;

const MIN_TORCH_SPACING = 0.6;

function isTooCloseToTorch(x, y, z) {
  for (const t of getPickableTorches()) {
    if (!t.active) continue;
    const dx = x - t.wx;
    const dz = z - t.wz;
    const dy = y - t.flame.position.y;
    if (dx * dx + dy * dy + dz * dz < MIN_TORCH_SPACING * MIN_TORCH_SPACING) return true;
  }
  return false;
}

/** Ray-plane intersection test against all door panels (works regardless of open/closed state) */
function findDoorPanelHit(origin, dir, playerX, playerZ) {
  const allDoors = getAllDoors();
  if (!allDoors.length) return null;

  const doorW = CFG.CELL;
  const doorH = CFG.WALL_H * 0.88;

  let bestHit = null;
  let bestT = Infinity;

  for (const door of allDoors) {
    const rot = door.currentRotY;

    // Door panel hinge and direction in world space
    let hx, hz, panelDirX, panelDirZ;
    if (door.isNS) {
      hx = door.wx - doorW / 2;
      hz = door.wz;
      panelDirX = Math.cos(rot);
      panelDirZ = -Math.sin(rot);
    } else {
      hx = door.wx;
      hz = door.wz - doorW / 2;
      panelDirX = Math.sin(rot);
      panelDirZ = Math.cos(rot);
    }

    // Panel normal (perpendicular to panel direction in XZ)
    const baseNx = -panelDirZ;
    const baseNz = panelDirX;

    // Test both faces of the door panel
    for (const side of [1, -1]) {
      const pnx = baseNx * side;
      const pnz = baseNz * side;

      // Ray-plane intersection: plane through hinge with normal (pnx, 0, pnz)
      const denom = dir.x * pnx + dir.z * pnz;
      if (denom >= -0.01) continue; // Ray must face toward surface

      const toPx = hx - origin.x;
      const toPz = hz - origin.z;
      const t = (toPx * pnx + toPz * pnz) / denom;

      if (t < 0.3 || t > 12 || t >= bestT) continue;

      const hitX = origin.x + dir.x * t;
      const hitY = origin.y + dir.y * t;
      const hitZ = origin.z + dir.z * t;

      // Distance from player
      const dpx = hitX - playerX;
      const dpz = hitZ - playerZ;
      if (dpx * dpx + dpz * dpz > PLACE_MAX_DIST_WALL * PLACE_MAX_DIST_WALL) continue;

      // Check hit is on the door panel (along panel from hinge)
      const along = (hitX - hx) * panelDirX + (hitZ - hz) * panelDirZ;
      if (along < 0.15 || along > doorW - 0.15) continue; // Margin from edges

      // Vertical bounds
      if (hitY < 0.3 || hitY > doorH - 0.1) continue;

      // Torch tip ceiling clip
      if (hitY + TIP_UP > CFG.WALL_H - 0.05) continue;

      // Existing torch proximity
      if (isTooCloseToTorch(hitX, hitY, hitZ)) continue;

      bestT = t;
      bestHit = {
        type: 'door',
        x: hitX,
        z: hitZ,
        y: hitY,
        nx: pnx,
        nz: pnz,
        door: door,
        _t: t, // ray parameter for distance comparison
      };
    }
  }

  return bestHit;
}

/** Ray-march from camera through crosshair; distances measured from player */
function findPlacementTarget(camera) {
  const origin = camera.globalPosition.clone();
  const dir = camera.getForwardRay(1).direction.clone();

  // Player position for distance checks (consistent between 1st/3rd person)
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  // Indoor floor placement: use building floor level instead of terrain height
  const isPlayerInside = isInsideBuilding(px, pz);
  const playerFloorY = Math.floor(Math.max(0, p.y) / CFG.WALL_H) * CFG.WALL_H;

  // Door panel ray test (works regardless of door open/closed state)
  const doorHit = findDoorPanelHit(origin, dir, px, pz);

  let prevX = origin.x, prevZ = origin.z;
  let prevWalkable = true;
  let groundDone = false;

  for (let t = 0.3; t < 12; t += PLACE_STEP) {
    // If we've passed the door panel hit, return it (no closer wall/ground found)
    if (doorHit && t > doorHit._t) return doorHit;

    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const groundY = getTerrainHeight(x, z);
    // Inside buildings, use the building floor level (handles 2nd floor)
    const effectiveGroundY = isPlayerInside ? Math.max(groundY, playerFloorY) : groundY;

    // Distance from player to this point (horizontal)
    const dxp = x - px, dzp = z - pz;
    const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);

    // Ground hit (only within shorter range from player)
    if (!groundDone && y <= effectiveGroundY + 0.05) {
      if (distPlayer <= PLACE_MAX_DIST_GROUND) {
        const valid = isWalkable(x, z) && (CFG.SNOW_MODE || effectiveGroundY >= CFG.WATER_Y)
          && !collidesWithRock(x, z, 0.15)
          && !isTooCloseToTorch(x, effectiveGroundY + STICK_LEN, z);
        if (valid) return { type: 'ground', x, z, y: effectiveGroundY };
        // Invalid ground hit (e.g. near wall boundary) — don't abort,
        // keep marching so the ray can still find a wall placement behind it
        groundDone = true;
      }
      groundDone = true; // past ground range, keep scanning for walls
    }

    // Past wall range from player — stop
    if (distPlayer > PLACE_MAX_DIST_WALL) break;

    // Wall hit (walkable -> non-walkable transition)
    const walkable = isWalkable(x, z);
    if (!walkable && prevWalkable) {
      const g = w2g(x, z);
      const isDoor = isDoorCell(g.x, g.z);

      // Door opening: skip but keep prevWalkable=true so lintel triggers on next step
      if (isDoor && y < CFG.WALL_H * 0.88) { prevX = x; prevZ = z; continue; }
      // Window opening: block placement
      if (isWindowCell(g.x, g.z) && isInsideWindowOpening(g.x, g.z, y, prevX, prevZ)) return null;

      // Reject if Y is above the wall height (torch would be on/above roof)
      const maxWallY = getWallHeightAt(g.x, g.z);
      if (y > maxWallY || y < 0) return null;
      // Per-floor ceiling check — prevent torch tip from clipping through ceiling
      // Door cells: only check against max wall height (exterior wall, floor slab not visible)
      const ceilY = isDoor ? maxWallY : Math.min((Math.floor(y / CFG.WALL_H) + 1) * CFG.WALL_H, maxWallY);
      if (y + TIP_UP > ceilY - 0.05) return null;

      // Determine wall normal
      let nx = 0, nz = 0;
      if (isDoor) {
        // Door cell is non-walkable like its neighbours — grid-based normal detection
        // is ambiguous. Use the door's known wall direction instead.
        const door = getDoorByCell(g.x, g.z);
        if (!door) { prevX = x; prevZ = z; prevWalkable = walkable; continue; }
        const isNS = door.wall === 'north' || door.wall === 'south';
        if (isNS) nz = dir.z > 0 ? -1 : 1;
        else nx = dir.x > 0 ? -1 : 1;
      } else {
        const hitX = !isWalkable(x, prevZ);
        const hitZ = !isWalkable(prevX, z);
        if (hitX && !hitZ) { nx = dir.x > 0 ? -1 : 1; }
        else if (hitZ && !hitX) { nz = dir.z > 0 ? -1 : 1; }
        else if (hitX && hitZ) {
          if (Math.abs(dir.x) > Math.abs(dir.z)) { nx = dir.x > 0 ? -1 : 1; }
          else { nz = dir.z > 0 ? -1 : 1; }
        } else { prevX = x; prevZ = z; prevWalkable = walkable; continue; }
      }

      // Snap mount point to wall surface (flush)
      const wc = g2w(g.x, g.z);
      const wallSurf = CFG.WALL_T / 2;
      const mountX = nx !== 0 ? wc.x + nx * wallSurf : prevX;
      const mountZ = nz !== 0 ? wc.z + nz * wallSurf : prevZ;

      // Reject if too close to an existing torch (prevent stacking)
      if (isTooCloseToTorch(mountX, y, mountZ)) return null;

      return { type: 'wall', x: mountX, z: mountZ, y, nx, nz };
    }

    prevX = x;
    prevZ = z;
    prevWalkable = walkable;
  }
  // No wall/ground hit — return door panel hit if any
  return doorHit || null;
}

export function initTorchPreview(scene) {
  const mat = new StandardMaterial('torchPreviewMat', scene);
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(0.267, 1, 0.267); // 0x44ff44
  mat.alpha = 0.5;

  previewGroup = new TransformNode('torchPreviewGroup', scene);

  previewStick = MeshBuilder.CreateCylinder('previewStick', {
    diameterTop: 0.06, diameterBottom: 0.08, height: STICK_LEN, tessellation: 4,
  }, scene);
  previewStick.material = mat;
  previewStick.parent = previewGroup;
  previewStick.isPickable = false;

  const flameMat = mat.clone('torchPreviewFlameMat');
  flameMat.emissiveColor = new Color3(0.267, 1, 0.267); // 0x44ff44
  flameMat.alpha = 0.5;

  previewFlame = MeshBuilder.CreateSphere('previewFlame', { diameter: 0.16, segments: 5 }, scene);
  previewFlame.material = flameMat;
  previewFlame.parent = previewGroup;
  previewFlame.position = new Vector3(0, 0.3, 0);
  previewFlame.scaling.set(0.8, 1.4, 0.8);
  previewFlame.isPickable = false;

  previewGroup.setEnabled(false);
}

export function updateTorchPreview(camera, active) {
  if (!previewGroup) return;
  placementHit = null;

  if (!active || getInventory().torches <= 0) {
    previewGroup.setEnabled(false);
    return;
  }

  const hit = findPlacementTarget(camera);
  if (!hit) {
    previewGroup.setEnabled(false);
    return;
  }

  placementHit = hit;
  previewGroup.setEnabled(true);

  // Reset transforms
  previewGroup.rotation = Vector3.Zero();
  previewStick.position = Vector3.Zero();
  previewStick.rotation = Vector3.Zero();
  previewFlame.position = new Vector3(0, 0.3, 0);

  if (hit.type === 'wall' || hit.type === 'door') {
    // Wall/door-mounted — tilted away from wall, base flush
    const mx = hit.x, mz = hit.z, my = hit.y;
    previewGroup.position = new Vector3(
      mx + hit.nx * TIP_OUT / 2,
      my + TIP_UP / 2,
      mz + hit.nz * TIP_OUT / 2
    );
    if (Math.abs(hit.nx) > 0.5) {
      previewStick.rotation.z = hit.nx > 0 ? -TILT : TILT;
    } else {
      previewStick.rotation.x = hit.nz > 0 ? TILT : -TILT;
    }
    previewFlame.position = new Vector3(hit.nx * TIP_OUT / 2, TIP_UP / 2, hit.nz * TIP_OUT / 2);
  } else {
    // Ground — vertical
    previewGroup.position = new Vector3(hit.x, hit.y + STICK_LEN / 2, hit.z);
    previewFlame.position = new Vector3(0, STICK_LEN / 2, 0);
  }
}

export function isTorchPreviewValid() {
  return placementHit !== null;
}

export function placeTorchAtPreview(scene) {
  if (!placementHit) return false;
  const inv = getInventory();
  if (inv.torches <= 0) return false;

  let t;
  if (placementHit.type === 'door') {
    // Place torch on door panel — parent meshes to door group so they rotate with it
    t = createWallTorch(scene, placementHit.x, placementHit.z, placementHit.y, placementHit.nx, placementHit.nz);
    if (!t) return false;
    const door = placementHit.door;
    const doorGroup = door.group;
    // Ensure world matrix is fresh (door may be mid-rotation)
    doorGroup.computeWorldMatrix(true);
    const invWorld = doorGroup.getWorldMatrix().clone().invert();
    // Re-parent flame + stick into door group (convert to door-local coords)
    // Glow billboard is NOT parented — billboard mode breaks parent-rotation positioning;
    // its position is synced every frame in updateDoorTorchPositions instead.
    for (const child of [t.flame, t.stick]) {
      if (!child) continue;
      const wp = child.getAbsolutePosition();
      child.parent = doorGroup;
      const localPos = Vector3.TransformCoordinates(wp, invWorld);
      child.position = localPos;
    }
    // Fix stick rotation: convert world normal to door-local space
    // so the tilt stays relative to the panel regardless of door rotation
    const worldNormal = new Vector3(placementHit.nx, 0, placementHit.nz);
    const localNormal = Vector3.TransformNormal(worldNormal, invWorld);
    if (Math.abs(localNormal.x) > Math.abs(localNormal.z)) {
      t.stick.rotation = new Vector3(0, 0, localNormal.x > 0 ? -TILT : TILT);
    } else {
      t.stick.rotation = new Vector3(localNormal.z > 0 ? TILT : -TILT, 0, 0);
    }
    const entry = { ...t, active: true, doorGroup };
    getPickableTorches().push(entry);
    getPlayerDoorTorches().push(entry);
    getTorchLights().push(t.light);
    addTorchEmbers(entry);
    inv.torches--;
    return true;
  } else if (placementHit.type === 'wall') {
    t = createWallTorch(scene, placementHit.x, placementHit.z, placementHit.y, placementHit.nx, placementHit.nz);
  } else {
    t = createGroundTorch(scene, placementHit.x, placementHit.y, placementHit.z);
  }
  if (!t) return false;
  const entry = { ...t, active: true };
  getTorchLights().push(t.light);
  getPickableTorches().push(entry);
  addTorchEmbers(entry);
  inv.torches--;
  return true;
}
