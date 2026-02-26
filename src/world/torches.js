import {
  MeshBuilder, Mesh, StandardMaterial, PointLight,
  ShadowGenerator, Texture, Color3, Color4,
  Vector3, TransformNode, Ray, ParticleSystem,
  ClusteredLightContainer, DynamicTexture
} from 'babylonjs';
import { getGrid, isDoorCell, isWindowCell, isStairCell, isWalkable } from './grid.js';
import { getBuildings, getWallHeightAt, isInsideBuilding } from './generator.js';
import { isInsideWindowOpening } from './windows.js';
import { collidesWithRock } from './vegetation.js';
import { getDoorByCell } from './doors.js';
import { g2w, w2g, rngInt } from '../utils/helpers.js';
import { CFG } from '../config.js';
import { getPlayerState, getCamBlend } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { getTerrainHeight } from './terrain.js';
import { getInventory } from './flowers.js';
// addShadowCaster removed from torch sticks — too small for visible shadows

const torchLights = [];
const doorTorchLights = [];
const doorTorchFlames = [];

// All pickable torches (interior + door + player-placed)
const pickableTorches = [];

// Player-placed door torches — need wx/wz updates when door rotates
const playerDoorTorches = [];

// Clustered lighting: all torch PointLights are managed by a ClusteredLightContainer
// (GPU tile-based pipeline, unlimited count). They are removed from the scene's
// standard light list so they don't count against maxSimultaneousLights.
// 3 shadow slot lights remain in the scene for shadow-casting (clustering can't shadow).
let _container = null;
let _scene = null;

const MAX_SHADOW_TORCHES = 2;
const shadowSlots = [];
const _shadowGenerators = [];



/** Register a mesh as a shadow caster for all torch shadow generators */
export function addTorchShadowCaster(mesh) {
  for (const sg of _shadowGenerators) {
    sg.addShadowCaster(mesh, true);
  }
}

export function getTorchShadowGenerators() { return _shadowGenerators; }

export function initTorchLightPool(scene) {
  _scene = scene;
  // Clustered container — manages all torch PointLights via GPU tiling
  _container = new ClusteredLightContainer("torchCluster", [], scene);

  // Shadow slot lights — in the scene (not clustered), for shadow-casting
  for (let i = 0; i < MAX_SHADOW_TORCHES; i++) {
    const light = new PointLight(`torchShadow_${i}`, new Vector3(0, -100, 0), scene);
    light.diffuse = new Color3(1, 0.533, 0.2);
    light.intensity = 0;
    light.range = 6;
    light.metadata = {};
    const sg = new ShadowGenerator(256, light);
    sg.usePercentageCloserFiltering = true;
    sg.bias = 0.001;
    sg.normalBias = 0.01;
    light.shadowMinZ = 0.1;
    light.shadowMaxZ = 8;
    light.metadata.shadowGen = sg;
    _shadowGenerators.push(sg);
    shadowSlots.push(light);
  }
}

export function getTorchLights() { return torchLights; }
export function getDoorTorchLights() { return doorTorchLights; }
export function getDoorTorchFlames() { return doorTorchFlames; }

// Shared materials (reused for placement)
let _flameMat = null;
let _stickMat = null;

function ensureMaterials(scene) {
  if (!_flameMat) {
    _flameMat = new StandardMaterial('torchFlameMat', scene);
    _flameMat.disableLighting = true;
    _flameMat.emissiveColor = new Color3(1, 0.467, 0.133); // 0xff7722
  }
  if (!_stickMat) {
    _stickMat = new StandardMaterial('torchStickMat', scene);
    _stickMat.diffuseColor = new Color3(0.29, 0.188, 0.125); // 0x4a3020
    _stickMat.specularColor = new Color3(0.02, 0.02, 0.02);
  }
}

const TILT = Math.PI / 6;
const STICK_LEN = 0.6;
const TIP_OUT = Math.sin(TILT) * STICK_LEN;
const TIP_UP = Math.cos(TILT) * STICK_LEN;

/** Create a wall-mounted torch at given position, returns { light, flame, stick } */
function createWallTorch(scene, mountX, mountZ, mountY, normalX, normalZ) {
  ensureMaterials(scene);

  // Tip = mount point + tilt projection (base flush with wall)
  const tipX = mountX + normalX * TIP_OUT;
  const tipZ = mountZ + normalZ * TIP_OUT;
  const tipY = mountY + TIP_UP;

  const name = `torchLight_${torchLights.length + doorTorchLights.length}_${pickableTorches.length}`;
  const light = new PointLight(name, Vector3.Zero(), scene);
  light.diffuse = new Color3(1, 0.533, 0.2); // 0xff8833
  light.range = 6;
  light.metadata = {};
  light.intensity = 2;
  light.position = new Vector3(tipX, tipY + 0.06, tipZ);

  // Move from standard pipeline to clustered pipeline
  // NOTE: do NOT call scene.removeLight — addLight handles it internally
  if (_container) {
    _container.addLight(light);
  }

  const flame = MeshBuilder.CreateSphere('torchFlame', { diameter: 0.16, segments: 5 }, scene);
  flame.material = _flameMat;
  flame.position = new Vector3(tipX, tipY, tipZ);
  flame.isPickable = false;

  const stick = MeshBuilder.CreateCylinder('torchStick', {
    diameterTop: 0.06, diameterBottom: 0.08, height: STICK_LEN, tessellation: 4,
  }, scene);
  stick.material = _stickMat;
  stick.position = new Vector3(
    mountX + normalX * TIP_OUT / 2,
    mountY + TIP_UP / 2,
    mountZ + normalZ * TIP_OUT / 2
  );
  // Apply tilt rotation based on wall normal direction
  if (Math.abs(normalX) > 0.5) {
    stick.rotation.z = normalX > 0 ? -TILT : TILT;
  } else {
    stick.rotation.x = normalZ > 0 ? TILT : -TILT;
  }
  stick.isPickable = false;
  // Torch sticks are too small for visible shadows — skip shadow caster registration
  // to reduce draw calls (~40 sticks × 8 passes = 320 draw calls saved).

  return { light, flame, stick, wx: tipX, wz: tipZ };
}

/** Create a vertical ground torch, returns { light, flame, stick } */
function createGroundTorch(scene, x, groundY, z) {
  ensureMaterials(scene);

  const name = `groundTorchLight_${torchLights.length}_${pickableTorches.length}`;
  const light = new PointLight(name, Vector3.Zero(), scene);
  light.diffuse = new Color3(1, 0.533, 0.2); // 0xff8833
  light.range = 6;
  light.metadata = {};
  light.intensity = 2;
  light.position = new Vector3(x, groundY + STICK_LEN + 0.12, z);

  // Move from standard pipeline to clustered pipeline
  // NOTE: do NOT call scene.removeLight — addLight handles it internally
  if (_container) {
    _container.addLight(light);
  }

  const flame = MeshBuilder.CreateSphere('groundTorchFlame', { diameter: 0.16, segments: 5 }, scene);
  flame.material = _flameMat;
  flame.position = new Vector3(x, groundY + STICK_LEN + 0.08, z);
  flame.isPickable = false;

  const stick = MeshBuilder.CreateCylinder('groundTorchStick', {
    diameterTop: 0.06, diameterBottom: 0.08, height: STICK_LEN, tessellation: 4,
  }, scene);
  stick.material = _stickMat;
  stick.position = new Vector3(x, groundY + STICK_LEN / 2, z);
  stick.isPickable = false;
  // Torch sticks are too small for visible shadows — skip to save draw calls.

  return { light, flame, stick, wx: x, wz: z };
}

// ---- World generation ----

export function placeTorches(scene) {
  const grid = getGrid();
  const wallOffset = CFG.CELL - CFG.WALL_T / 2;

  for (const b of getBuildings()) {
    const candidates = [];
    for (let gx = b.x + 1; gx < b.x + b.w - 1; gx++) {
      for (let gz = b.z + 1; gz < b.z + b.h - 1; gz++) {
        if (!grid[gx][gz]) continue;
        const dirs = [{ dx: -1, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: 0, dz: 1 }];
        for (const d of dirs) {
          const nx = gx + d.dx, nz = gz + d.dz;
          if (nx >= 0 && nx < CFG.GRID && nz >= 0 && nz < CFG.GRID && !grid[nx][nz] && !isDoorCell(nx, nz) && !isWindowCell(nx, nz) && !isStairCell(nx, nz)) {
            candidates.push({ gx, gz, ox: d.dx * wallOffset, oz: d.dz * wallOffset });
          }
        }
      }
    }
    if (candidates.length === 0) continue;
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const count = Math.min(candidates.length, rngInt(1, 2));
    for (let i = 0; i < count; i++) {
      const tp = candidates[i];
      const p = g2w(tp.gx, tp.gz);
      const wx = p.x + tp.ox, wz = p.z + tp.oz;
      const awayX = -tp.ox / wallOffset, awayZ = -tp.oz / wallOffset;
      const t = createWallTorch(scene, wx, wz, 2.2, awayX, awayZ);
      torchLights.push(t.light);
      pickableTorches.push({ ...t, active: true });
    }
  }
}

export function placeDoorTorches(scene) {
  const grid = getGrid();
  const torchY = 2.2;
  const sideOff = CFG.CELL - CFG.WALL_T / 2; // flush with adjacent wall surface
  const normOff = CFG.WALL_T / 2 + 0.08;

  for (const b of getBuildings()) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const isNS = d.wall === 'south' || d.wall === 'north';
      let side = 1;
      if (isNS) {
        const rightOk = d.gx + 1 < CFG.GRID && !grid[d.gx + 1][d.gz] && !isDoorCell(d.gx + 1, d.gz) && !isWindowCell(d.gx + 1, d.gz);
        const leftOk = d.gx - 1 >= 0 && !grid[d.gx - 1][d.gz] && !isDoorCell(d.gx - 1, d.gz) && !isWindowCell(d.gx - 1, d.gz);
        if (!rightOk && leftOk) side = -1;
        else if (!rightOk && !leftOk) continue;
      } else {
        const rightOk = d.gz + 1 < CFG.GRID && !grid[d.gx][d.gz + 1] && !isDoorCell(d.gx, d.gz + 1) && !isWindowCell(d.gx, d.gz + 1);
        const leftOk = d.gz - 1 >= 0 && !grid[d.gx][d.gz - 1] && !isDoorCell(d.gx, d.gz - 1) && !isWindowCell(d.gx, d.gz - 1);
        if (!rightOk && leftOk) side = -1;
        else if (!rightOk && !leftOk) continue;
      }

      // Mount point on adjacent wall, normal pointing outward (away from wall)
      let mountX, mountZ, nx = 0, nz = 0;
      switch (d.wall) {
        case 'south': mountX = p.x + side * sideOff; mountZ = p.z + normOff; nz = 1; break;
        case 'north': mountX = p.x + side * sideOff; mountZ = p.z - normOff; nz = -1; break;
        case 'west': mountX = p.x - normOff; mountZ = p.z + side * sideOff; nx = -1; break;
        case 'east': mountX = p.x + normOff; mountZ = p.z + side * sideOff; nx = 1; break;
      }

      const t = createWallTorch(scene, mountX, mountZ, torchY, nx, nz);
      t.light.intensity = 0; // Let dayNight set it
      t.light.metadata.baseIntensity = 0;
      t.flame.isVisible = false;
      doorTorchLights.push(t.light);
      doorTorchFlames.push(t.flame);
      pickableTorches.push({ ...t, active: true }); // Remains pickable even when light is off during day
    }
  }
}

// ---- Torch pickup ----

export function getNearestPickableTorch() {
  const p = getPlayerState();
  let best = null;
  let bestDist = CFG.TORCH_PICK_DIST;

  const eyePos = new Vector3(p.x, p.y + CFG.PLAYER_H * 0.8, p.z);

  for (const t of pickableTorches) {
    if (!t.active) continue;

    // Get flame world position (works whether flame is parented to a door group or scene root)
    const targetPos = t.flame.getAbsolutePosition();

    const dist = Vector3.Distance(eyePos, targetPos);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

export function pickNearestTorch(inventory) {
  const t = getNearestPickableTorch();
  if (!t) return false;
  t.active = false;
  t.stick.isVisible = false;
  t.flame.isVisible = false;
  t.light.metadata.picked = true;
  // Park the light far away with zero intensity — keep it in the clustered
  // container so the light count stays stable (avoids WebGPU pipeline recompilation).
  t.light.intensity = 0;
  t.light.position.y = -200;
  // Defer particle disposal to avoid synchronous GPU buffer teardown stall
  const ps = t.particles;
  t.particles = null;
  if (ps) setTimeout(() => ps.dispose(), 100);
  // Remove from door-torch tracking if it was door-parented
  const dIdx = playerDoorTorches.indexOf(t);
  if (dIdx >= 0) playerDoorTorches.splice(dIdx, 1);
  inventory.torches++;
  return true;
}

// ---- Torch placement preview + placement ----

let previewGroup = null;
let previewStick = null;
let previewFlame = null;
let placementHit = null; // { type:'wall'|'ground', x,z,y, nx?,nz? }

const PLACE_MAX_DIST_WALL = 6;
const PLACE_MAX_DIST_GROUND = 3;
const PLACE_STEP = 0.12;

export function initTorchPreview(scene) {
  const mat = new StandardMaterial('torchPreviewMat', scene);
  mat.disableLighting = true;
  mat.emissiveColor = new Color3(0.267, 1, 0.267); // 0x44ff44
  mat.alpha = 0.5;
  // Babylon.js handles depth write via needDepthPrePass or material settings
  // For transparent preview, alpha < 1 is sufficient

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
  previewFlame.isPickable = false;

  previewGroup.setEnabled(false);
}

const MIN_TORCH_SPACING = 0.6;

function isTooCloseToTorch(x, y, z) {
  for (const t of pickableTorches) {
    if (!t.active) continue;
    const dx = x - t.wx;
    const dz = z - t.wz;
    const dy = y - t.flame.position.y;
    if (dx * dx + dy * dy + dz * dz < MIN_TORCH_SPACING * MIN_TORCH_SPACING) return true;
  }
  return false;
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

  let prevX = origin.x, prevZ = origin.z;
  let prevWalkable = true;
  let groundDone = false;

  for (let t = 0.3; t < 12; t += PLACE_STEP) {
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
        return valid ? { type: 'ground', x, z, y: effectiveGroundY } : null;
      }
      groundDone = true; // past ground range, keep scanning for walls
    }

    // Past wall range from player — stop
    if (distPlayer > PLACE_MAX_DIST_WALL) break;

    // Wall hit (walkable -> non-walkable transition)
    const walkable = isWalkable(x, z);
    if (!walkable && prevWalkable) {
      const g = w2g(x, z);

      // Door cell: allow placing torch ON the door panel or ABOVE the door gap
      if (isDoorCell(g.x, g.z)) {
        const door = getDoorByCell(g.x, g.z);
        if (!door) return null;
        const doorTopY = CFG.WALL_H * 0.88;
        if (y >= doorTopY && y <= CFG.WALL_H) {
          // Above door gap — mount on lintel wall, normal outward
          const hitX2 = !isWalkable(x, prevZ);
          const hitZ2 = !isWalkable(prevX, z);
          let nx2 = 0, nz2 = 0;
          if (hitX2 && !hitZ2) nx2 = dir.x > 0 ? -1 : 1;
          else if (hitZ2 && !hitX2) nz2 = dir.z > 0 ? -1 : 1;
          else return null;
          const wc = g2w(g.x, g.z);
          const wallSurf = CFG.WALL_T / 2;
          const mountX = nx2 !== 0 ? wc.x + nx2 * wallSurf : prevX;
          const mountZ = nz2 !== 0 ? wc.z + nz2 * wallSurf : prevZ;
          if (isTooCloseToTorch(mountX, y, mountZ)) return null;
          // Reject if torch tip would clip through ceiling
          if (y + TIP_UP > CFG.WALL_H - 0.05) return null;
          return { type: 'wall', x: mountX, z: mountZ, y, nx: nx2, nz: nz2 };
        }
        // On door panel itself
        const hitX2 = !isWalkable(x, prevZ);
        const hitZ2 = !isWalkable(prevX, z);
        let nx2 = 0, nz2 = 0;
        if (hitX2 && !hitZ2) nx2 = dir.x > 0 ? -1 : 1;
        else if (hitZ2 && !hitX2) nz2 = dir.z > 0 ? -1 : 1;
        else return null;
        if (y < 0.3 || y > doorTopY) return null;
        if (y + TIP_UP > CFG.WALL_H - 0.05) return null;
        if (isTooCloseToTorch(prevX, y, prevZ)) return null;
        return { type: 'door', x: prevX, z: prevZ, y, nx: nx2, nz: nz2, door };
      }

      if (isWindowCell(g.x, g.z) && isInsideWindowOpening(g.x, g.z, y, prevX, prevZ)) return null;

      // Reject if Y is above the wall height (torch would be on/above roof)
      const maxWallY = getWallHeightAt(g.x, g.z);
      if (y > maxWallY || y < 0) return null;
      // Per-floor ceiling check — prevent torch tip from clipping through ceiling
      const floorCeilY = Math.min((Math.floor(y / CFG.WALL_H) + 1) * CFG.WALL_H, maxWallY);
      if (y + TIP_UP > floorCeilY - 0.05) return null;

      const hitX = !isWalkable(x, prevZ);
      const hitZ = !isWalkable(prevX, z);
      let nx = 0, nz = 0;
      if (hitX && !hitZ) { nx = dir.x > 0 ? -1 : 1; }
      else if (hitZ && !hitX) { nz = dir.z > 0 ? -1 : 1; }
      else { return null; } // corner hit — reject, no clean wall surface
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
  return null;
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
    // Re-parent flame + stick into door group (convert to door-local coords)
    const doorGroup = door.group;
    for (const child of [t.flame, t.stick]) {
      const wp = child.getAbsolutePosition();
      child.parent = doorGroup;
      // Convert world position to door-group-local coordinates
      const invWorld = doorGroup.getWorldMatrix().clone().invert();
      const localPos = Vector3.TransformCoordinates(wp, invWorld);
      child.position = localPos;
    }
    const entry = { ...t, active: true, doorGroup };
    pickableTorches.push(entry);
    playerDoorTorches.push(entry);
    torchLights.push(t.light); // register for daynight intensity management
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
  torchLights.push(t.light); // register for daynight intensity management
  pickableTorches.push(entry);
  addTorchEmbers(entry);
  inv.torches--;
  return true;
}

/** Update world-space coords for player-placed door torches (door rotation changes their position) */
export function updateDoorTorchPositions() {
  for (const t of playerDoorTorches) {
    if (!t.active || !t.doorGroup) continue;
    // Convert flame local position to world position for light + ember tracking
    const wp = t.flame.getAbsolutePosition();
    t.wx = wp.x;
    t.wz = wp.z;
    // Update pooled light position to match
    t.light.position = new Vector3(wp.x, wp.y + 0.04, wp.z);
  }
}

// ---- Hint (used by old system, kept for reference but main uses unified hint) ----

export function updateTorchHint() {
  // Now handled by unified updateInteractHint in main.js
}

// ---- Held torch (first-person equipped) ----

let heldGroup = null;
let heldLight = null;

export function initHeldTorch(scene) {
  heldGroup = new TransformNode('heldTorchGroup', scene);

  ensureMaterials(scene);

  const stick = MeshBuilder.CreateCylinder('heldTorchStick', {
    diameterTop: 0.04, diameterBottom: 0.06, height: 0.5, tessellation: 4,
  }, scene);
  stick.material = _stickMat;
  stick.parent = heldGroup;
  stick.isPickable = false;

  const flame = MeshBuilder.CreateSphere('heldTorchFlame', { diameter: 0.12, segments: 5 }, scene);
  flame.material = _flameMat;
  flame.position = new Vector3(0, 0.3, 0);
  flame.parent = heldGroup;
  flame.isPickable = false;

  heldGroup.setEnabled(false);

  // Held torch light — always enabled, tiny intensity when inactive.
  // Keeps WebGPU shader pipelines pre-compiled (avoids 2s freeze on first equip).
  heldLight = new PointLight('heldTorchLight', new Vector3(0, -100, 0), scene);
  heldLight.diffuse = new Color3(1, 0.533, 0.2); // 0xff8833
  heldLight.intensity = 0.001;
  heldLight.range = 6;
  heldLight.metadata = {};
}

export function updateHeldTorch(camera, active, playerState) {
  if (!heldGroup || !heldLight) return;

  if (!active) {
    heldGroup.setEnabled(false);
    heldLight.intensity = 0.001; // tiny — keeps WebGPU pipeline warm
    heldLight.position.y = -100; // park far away so it doesn't affect any mesh
    return;
  }

  heldGroup.setEnabled(true);
  heldLight.intensity = 1.5;

  let px, py, pz;

  // Use 3rd-person positioning whenever camera isn't fully in 1st person
  // (prevents torch jumping to camera during blend transition)
  if (playerState && getCamBlend() > 0.01) {
    // 3rd person (or transitioning) — position torch relative to player model
    const yaw = playerState.yaw;
    const rX = Math.cos(yaw), rZ = -Math.sin(yaw);   // right vector
    const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);   // forward vector
    px = playerState.x + rX * 0.35 + fX * 0.25;
    py = playerState.y + 1.1;
    pz = playerState.z + rZ * 0.35 + fZ * 0.25;
  } else {
    // 1st person — position relative to camera
    const fwd = camera.getForwardRay(1).direction;
    const yAxis = new Vector3(0, 1, 0);
    const right = Vector3.Cross(fwd, yAxis).normalize();
    px = camera.globalPosition.x + right.x * 0.35 + fwd.x * 0.3;
    py = camera.globalPosition.y - 0.45;
    pz = camera.globalPosition.z + right.z * 0.35 + fwd.z * 0.3;
  }

  heldGroup.position = new Vector3(px, py, pz);

  // Keep torch upright with subtle tilt
  heldGroup.rotation = new Vector3(0, 0, -0.15);

  // Light at flame tip
  heldLight.position = new Vector3(px, py + 0.35, pz);
}

export function hideHeldTorch() {
  if (heldGroup) heldGroup.setEnabled(false);
  if (heldLight) {
    heldLight.intensity = 0.001;
    heldLight.position.y = -100;
  }
}

/** Pre-warm held torch for WebGPU pipeline compilation (call before first scene.render) */
export function prewarmHeldTorch(playerPos) {
  if (!heldGroup || !heldLight) return;
  heldGroup.setEnabled(true);
  heldLight.intensity = 1.5;
  heldLight.position = new Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z);
  heldGroup.position = new Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z);
}

// ---- Torch ember particles (GPU ParticleSystem per torch) ----

const EMBER_VIS_DIST = 30;
let _emberTex = null;
let _emberScene = null;

function getEmberTexture(scene) {
  if (_emberTex) return _emberTex;
  const dt = new DynamicTexture('emberTex', 32, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext();
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,180,80,0.6)');
  grad.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  dt.update();
  _emberTex = dt;
  return dt;
}

function createEmberSystem(scene, torch) {
  const ps = new ParticleSystem(`embers_${torch.light.name}`, 8, scene);
  ps.particleTexture = getEmberTexture(scene);
  ps.emitter = torch.flame; // auto-follows mesh (handles door-parented torches)
  ps.minEmitBox = new Vector3(-0.04, 0, -0.04);
  ps.maxEmitBox = new Vector3(0.04, 0.02, 0.04);

  ps.minLifeTime = 0.6;
  ps.maxLifeTime = 1.8;
  ps.emitRate = 3;

  ps.minSize = 0.02;
  ps.maxSize = 0.06;

  ps.direction1 = new Vector3(-0.12, 0.4, -0.12);
  ps.direction2 = new Vector3(0.12, 1.0, 0.12);
  ps.gravity = new Vector3(0, 0.05, 0);

  ps.color1 = new Color4(1, 0.6, 0.15, 0.7);
  ps.color2 = new Color4(1, 0.35, 0.08, 0.5);
  ps.colorDead = new Color4(0.3, 0.1, 0, 0);

  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  torch.particles = ps;
}

export function initTorchEmbers(scene) {
  _emberScene = scene;
  for (const t of pickableTorches) {
    if (!t.active) continue;
    createEmberSystem(scene, t);
  }
}

export function updateTorchEmbers(dt) {
  const p = getPlayerState();
  const px = p.x, py = p.y, pz = p.z;

  // Update intensity on all clustered torch lights and find nearest for shadow slots.
  // All torches stay lit — clustered lighting handles unlimited count efficiently.
  const torchDistances = [];
  for (const t of pickableTorches) {
    if (!t.active || t.light.metadata.picked) continue;
    if (t.light.metadata.baseIntensity === undefined) t.light.metadata.baseIntensity = 2.0;

    let targetIntensity = t.light.metadata.baseIntensity;
    // Clustered lighting handles unlimited lights — never cull torch intensity.
    // Shadow slots handle per-floor shadow casting separately.
    t.light.intensity = targetIntensity;
    // All active torches with positive baseIntensity are considered lit (embers + flames visible).
    t._lit = t.light.metadata.baseIntensity > 0;

    // Track distance for shadow slot assignment
    if (targetIntensity > 0) {
      const dx = t.wx - px, dz = t.wz - pz;
      torchDistances.push({ t, dist2: dx * dx + dz * dz });
    }
  }

  // Assign nearest visible torches to shadow slot lights
  torchDistances.sort((a, b) => a.dist2 - b.dist2);
  for (let i = 0; i < shadowSlots.length; i++) {
    const slot = shadowSlots[i];
    if (i < torchDistances.length) {
      const { t } = torchDistances[i];
      slot.position.copyFrom(t.light.position);
      slot.intensity = t.light.intensity;
      slot.shadowEnabled = true; // enable shadow map rendering
      // Zero out clustered light — shadow slot handles this torch's illumination
      t.light.intensity = 0;
    } else {
      slot.position.y = -100;
      slot.intensity = 0.001; // tiny — keeps WebGPU shadow pipeline warm
      // Keep shadowEnabled=true to prevent WebGPU pipeline recompilation freeze
      // when transitioning between floors (~100 extra draws but avoids 1s stall)
    }
  }

  // Start/stop ember particle systems based on distance and visibility
  for (const t of pickableTorches) {
    if (!t.particles) continue;
    const lit = t.active && t._lit && t.flame.isVisible && !t.light.metadata.picked;
    const dx = t.wx - px, dz = t.wz - pz;
    const inRange = dx * dx + dz * dz < EMBER_VIS_DIST * EMBER_VIS_DIST;

    if (lit && inRange) {
      if (!t.particles.isStarted()) t.particles.start();
    } else {
      if (t.particles.isStarted()) t.particles.stop();
    }
  }
}

/** Add embers for a newly placed torch */
export function addTorchEmbers(torch) {
  if (!_emberScene) return;
  createEmberSystem(_emberScene, torch);
}
