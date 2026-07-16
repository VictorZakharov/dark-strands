import {
  MeshBuilder, Mesh, StandardMaterial, PointLight,
  Color3, Vector3, DynamicTexture, Engine
} from 'babylonjs';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rngInt } from '../utils/helpers.js';
import { CFG } from '../config.js';
import { getPlayerState } from '../entities/player.js';
import { hasLineOfSight, GRP_WINDOW } from '../core/physics.js';
import { getInventory } from './flowers.js';
import { getClusteredContainer } from './torchLighting.js';
import { addTorchEmbers } from './torchParticles.js';
import { getCamera } from '../core/scene.js';
import { glowInclude, addFogDepthMesh } from '../core/postfx.js';

// Re-export from submodules for external consumers
export { addTorchShadowCaster, getTorchShadowGenerators, initTorchLightPool } from './torchLighting.js';
export { initTorchEmbers, updateTorchEmbers } from './torchParticles.js';
export { initTorchPreview, updateTorchPreview, isTorchPreviewValid, placeTorchAtPreview } from './torchPlacement.js';
export { initHeldTorch, updateHeldTorch, hideHeldTorch, prewarmHeldTorch } from './torchHeld.js';

const torchLights = [];
const doorTorchLights = [];
const doorTorchFlames = [];

// All pickable torches (interior + door + player-placed)
const pickableTorches = [];

// Player-placed door torches — need wx/wz updates when door rotates
const playerDoorTorches = [];

export function getTorchLights() { return torchLights; }
export function getDoorTorchLights() { return doorTorchLights; }
export function getDoorTorchFlames() { return doorTorchFlames; }
export function getPickableTorches() { return pickableTorches; }
export function getPlayerDoorTorches() { return playerDoorTorches; }

// Shared materials (reused for placement)
let _flameMat = null;
let _glowMat = null;
let _stickMat = null;

export function ensureMaterials(scene) {
  if (!_flameMat) {
    _flameMat = new StandardMaterial('torchFlameMat', scene);
    _flameMat.disableLighting = true;
    _flameMat.emissiveColor = new Color3(1, 0.467, 0.133); // 0xff7722
  }
  if (!_glowMat) {
    _glowMat = new StandardMaterial('torchGlowMat', scene);
    _glowMat.disableLighting = true;
    _glowMat.emissiveColor = new Color3(1, 0.4, 0.1);
    _glowMat.alphaMode = Engine.ALPHA_ADD;

    // Procedural glow gradient — much softer falloff for billboarded halo
    const sz = 128;
    const tex = new DynamicTexture('torchGlowTex', sz, scene, false);
    const ctx = tex.getContext();
    const c = sz / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,220,150,0.6)');
    grad.addColorStop(0.2, 'rgba(255,140,40,0.3)');
    grad.addColorStop(0.5, 'rgba(200,60,10,0.1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, sz, sz);
    tex.update();
    _glowMat.emissiveTexture = tex;
    _glowMat.opacityTexture = tex;
  }
  if (!_stickMat) {
    _stickMat = new StandardMaterial('torchStickMat', scene);
    _stickMat.diffuseColor = new Color3(0.29, 0.188, 0.125); // 0x4a3020
    _stickMat.specularColor = new Color3(0.02, 0.02, 0.02);
  }
}

export function getMaterials() {
  return { flameMat: _flameMat, glowMat: _glowMat, stickMat: _stickMat };
}

export const TILT = Math.PI / 6;
export const STICK_LEN = 0.6;
export const TIP_OUT = Math.sin(TILT) * STICK_LEN;
export const TIP_UP = Math.cos(TILT) * STICK_LEN;

/** Create a wall-mounted torch at given position, returns { light, flame, stick, glow, wx, wz } */
export function createWallTorch(scene, mountX, mountZ, mountY, normalX, normalZ) {
  ensureMaterials(scene);
  const _container = getClusteredContainer();

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
  if (_container) {
    _container.addLight(light);
  }

  const flame = MeshBuilder.CreateSphere('torchFlame', { diameter: 0.16, segments: 5 }, scene);
  flame.material = _flameMat;
  flame.position = new Vector3(tipX, tipY, tipZ);
  flame.scaling.set(0.8, 1.4, 0.8); // Teardrop shape
  flame.isPickable = false;
  glowInclude(flame);

  // Billboard glow halo — soft texture that always faces camera
  const glow = MeshBuilder.CreatePlane('torchGlow', { size: 1.0 }, scene);
  glow.material = _glowMat;
  glow.position = flame.position.clone();
  glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
  glow.isPickable = false;

  const stick = MeshBuilder.CreateCylinder('torchStick', {
    diameterTop: 0.06, diameterBottom: 0.08, height: STICK_LEN, tessellation: 4,
  }, scene);
  stick.material = _stickMat;
  stick.position = new Vector3(
    mountX + normalX * TIP_OUT / 2,
    mountY + TIP_UP / 2,
    mountZ + normalZ * TIP_OUT / 2
  );
  const yaw = Math.atan2(normalX, normalZ);
  stick.rotation = new Vector3(TILT, yaw, 0);
  stick.isPickable = false;
  addFogDepthMesh(stick);
  addFogDepthMesh(flame);

  return { light, flame, glow, stick, wx: tipX, wz: tipZ };
}

/** Create a vertical ground torch, returns { light, flame, stick, glow, wx, wz } */
export function createGroundTorch(scene, x, groundY, z) {
  ensureMaterials(scene);
  const _container = getClusteredContainer();

  const name = `groundTorchLight_${torchLights.length}_${pickableTorches.length}`;
  const light = new PointLight(name, Vector3.Zero(), scene);
  light.diffuse = new Color3(1, 0.533, 0.2); // 0xff8833
  light.range = 6;
  light.metadata = {};
  light.intensity = 2;
  light.position = new Vector3(x, groundY + STICK_LEN + 0.12, z);

  if (_container) {
    _container.addLight(light);
  }

  const flame = MeshBuilder.CreateSphere('groundTorchFlame', { diameter: 0.16, segments: 5 }, scene);
  flame.material = _flameMat;
  flame.position = new Vector3(x, groundY + STICK_LEN + 0.08, z);
  flame.scaling.set(0.8, 1.4, 0.8);
  flame.isPickable = false;
  glowInclude(flame);

  const glow = MeshBuilder.CreatePlane('groundTorchGlow', { size: 1.0 }, scene);
  glow.material = _glowMat;
  glow.position = flame.position.clone();
  glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
  glow.isPickable = false;

  const stick = MeshBuilder.CreateCylinder('groundTorchStick', {
    diameterTop: 0.06, diameterBottom: 0.08, height: STICK_LEN, tessellation: 4,
  }, scene);
  stick.material = _stickMat;
  stick.position = new Vector3(x, groundY + STICK_LEN / 2, z);
  stick.isPickable = false;
  addFogDepthMesh(stick);
  addFogDepthMesh(flame);

  return { light, flame, glow, stick, wx: x, wz: z };
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
      const entry = { ...t, active: true };
      pickableTorches.push(entry);
      addTorchEmbers(entry);
    }
  }
}

export function placeDoorTorches(scene) {
  const grid = getGrid();
  const torchY = 2.2;
  const sideOff = CFG.CELL - CFG.WALL_T / 2;
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

      let mountX, mountZ, nx = 0, nz = 0;
      switch (d.wall) {
        case 'south': mountX = p.x + side * sideOff; mountZ = p.z + normOff; nz = 1; break;
        case 'north': mountX = p.x + side * sideOff; mountZ = p.z - normOff; nz = -1; break;
        case 'west': mountX = p.x - normOff; mountZ = p.z + side * sideOff; nx = -1; break;
        case 'east': mountX = p.x + normOff; mountZ = p.z + side * sideOff; nx = 1; break;
      }

      const t = createWallTorch(scene, mountX, mountZ, torchY, nx, nz);
      t.light.intensity = 0;
      t.light.metadata.baseIntensity = 0;
      t.flame.isVisible = false;
      doorTorchLights.push(t.light);
      doorTorchFlames.push(t.flame);
      const entry = { ...t, active: true };
      pickableTorches.push(entry);
      playerDoorTorches.push(entry);
      addTorchEmbers(entry);
    }
  }
}

// ---- Torch pickup ----

export function getNearestPickableTorch() {
  const p = getPlayerState();
  const cam = getCamera();
  if (!cam) return null;
  
  let best = null;
  let bestDot = -Infinity; // Find highest dot product (closest to crosshair)

  const eyePos = new Vector3(p.x, p.y + CFG.PLAYER_H * 0.8, p.z);
  const viewDir = cam.getForwardRay(1).direction;

  for (const t of pickableTorches) {
    if (!t.active) continue;

    const targetPos = t.flame.getAbsolutePosition();
    const dist = Vector3.Distance(eyePos, targetPos);
    
    // Must be within interaction distance and generally in front of player
    if (dist > CFG.TORCH_PICK_DIST) continue;

    const toTarget = targetPos.subtract(eyePos).normalize();
    const dot = Vector3.Dot(viewDir, toTarget);

    if (dot > 0.5 && dot > bestDot) {
      // Pull target slightly towards eye to avoid raycasting into the wall/stair geometry
      // behind the flame, which would block the line of sight check
      const dir = eyePos.subtract(targetPos).normalize();
      const testPos = targetPos.add(dir.scale(0.15));
      
      if (!hasLineOfSight(eyePos, testPos, GRP_WINDOW)) continue;
      bestDot = dot;
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
  if (t.glow) t.glow.isVisible = false;
  t.light.metadata.picked = true;
  // Park the light far away with zero intensity
  t.light.intensity = 0;
  t.light.position.y = -200;
  // Defer particle disposal to avoid synchronous GPU buffer teardown stall
  const ps = t.particles;
  const sps = t.smokeParticles;
  const skps = t.sparkParticles;
  t.particles = null;
  t.smokeParticles = null;
  t.sparkParticles = null;
  if (ps) setTimeout(() => ps.dispose(false), 100);
  if (sps) setTimeout(() => sps.dispose(false), 120);
  if (skps) setTimeout(() => skps.dispose(false), 140);
  // Remove from door-torch tracking if it was door-parented
  const dIdx = playerDoorTorches.indexOf(t);
  if (dIdx >= 0) playerDoorTorches.splice(dIdx, 1);
  inventory.torches++;
  return true;
}

/** Update world-space coords for player-placed door torches (door rotation changes their position) */
export function updateDoorTorchPositions() {
  for (const t of playerDoorTorches) {
    if (!t.active || !t.doorGroup) continue;
    const wp = t.flame.getAbsolutePosition();
    t.wx = wp.x;
    t.wz = wp.z;
    t.light.position = new Vector3(wp.x, wp.y + 0.04, wp.z);
    if (t.glow) t.glow.position.set(wp.x, wp.y, wp.z);
  }
}

// ---- Hint (kept for API compatibility) ----
export function updateTorchHint() {
  // Now handled by unified updateInteractHint in main.js
}
