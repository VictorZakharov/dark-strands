import * as THREE from 'three';
import { getGrid, isDoorCell, isWindowCell, isStairCell, isWalkable } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, w2g, rngInt } from '../utils/helpers.js';
import { CFG } from '../config.js';
import { getPlayerState, getCamBlend } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { getTerrainHeight } from './terrain.js';
import { getInventory } from './flowers.js';

const torchLights = [];
const doorTorchLights = [];
const doorTorchFlames = [];

// All pickable torches (interior + door + player-placed)
const pickableTorches = [];

// Pre-allocated light pool — avoids adding/removing PointLights which triggers shader recompile
const LIGHT_POOL_SIZE = 20;
const lightPool = [];       // { light, inUse }

export function initTorchLightPool(scene) {
  for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xff8833, 0, 12, 1.5);
    scene.add(light);
    lightPool.push({ light, inUse: false });
  }
}

function acquirePoolLight() {
  for (const entry of lightPool) {
    if (!entry.inUse) {
      entry.inUse = true;
      return entry.light;
    }
  }
  return null; // pool exhausted — shouldn't happen in normal play
}

function releasePoolLight(light) {
  light.intensity = 0;
  for (const entry of lightPool) {
    if (entry.light === light) { entry.inUse = false; return; }
  }
}

export function getTorchLights() { return torchLights; }
export function getDoorTorchLights() { return doorTorchLights; }
export function getDoorTorchFlames() { return doorTorchFlames; }

// Shared materials (reused for placement)
const _flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
const _stickMat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });
const TILT = Math.PI / 6;
const STICK_LEN = 0.6;
const TIP_OUT = Math.sin(TILT) * STICK_LEN / 2;
const TIP_UP = Math.cos(TILT) * STICK_LEN / 2;

/** Create a wall-mounted torch at given position, returns { light, flame, stick } */
function createWallTorch(scene, mountX, mountZ, mountY, normalX, normalZ, usePool) {
  const tipX = mountX + normalX * TIP_OUT;
  const tipZ = mountZ + normalZ * TIP_OUT;
  const tipY = mountY + TIP_UP;

  let light;
  if (usePool) {
    light = acquirePoolLight();
    if (!light) return null;
  } else {
    light = new THREE.PointLight(0xff8833, 0, 12, 1.5);
    scene.add(light);
  }
  light.intensity = 2;
  light.position.set(tipX, tipY + 0.12, tipZ);

  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), _flameMat);
  flame.position.set(tipX, tipY + 0.08, tipZ);
  scene.add(flame);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, STICK_LEN, 4), _stickMat);
  stick.position.set(
    mountX + normalX * TIP_OUT / 2,
    mountY + TIP_UP / 2,
    mountZ + normalZ * TIP_OUT / 2
  );
  if (Math.abs(normalX) > 0.5) {
    stick.rotation.z = normalX > 0 ? -TILT : TILT;
  } else {
    stick.rotation.x = normalZ > 0 ? TILT : -TILT;
  }
  stick.castShadow = true;
  scene.add(stick);

  return { light, flame, stick, wx: tipX, wz: tipZ, pooled: !!usePool };
}

/** Create a vertical ground torch, returns { light, flame, stick } */
function createGroundTorch(scene, x, groundY, z, usePool) {
  let light;
  if (usePool) {
    light = acquirePoolLight();
    if (!light) return null;
  } else {
    light = new THREE.PointLight(0xff8833, 0, 12, 1.5);
    scene.add(light);
  }
  light.intensity = 2;
  light.position.set(x, groundY + STICK_LEN + 0.12, z);

  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), _flameMat);
  flame.position.set(x, groundY + STICK_LEN + 0.08, z);
  scene.add(flame);

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, STICK_LEN, 4), _stickMat);
  stick.position.set(x, groundY + STICK_LEN / 2, z);
  stick.castShadow = true;
  scene.add(stick);

  return { light, flame, stick, wx: x, wz: z, pooled: !!usePool };
}

// ---- World generation ----

export function placeTorches(scene) {
  const grid = getGrid();
  const wallOffset = CFG.CELL - CFG.WALL_T / 2 - 0.1;

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
  const sideOff = CFG.CELL - CFG.WALL_T / 2 - 0.1; // flush with adjacent wall surface
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
        case 'west':  mountX = p.x - normOff; mountZ = p.z + side * sideOff; nx = -1; break;
        case 'east':  mountX = p.x + normOff; mountZ = p.z + side * sideOff; nx = 1; break;
      }

      // Angled wall torch (same geometry as interior torches)
      const tipX = mountX + nx * TIP_OUT;
      const tipZ = mountZ + nz * TIP_OUT;
      const tipY = torchY + TIP_UP;

      const light = new THREE.PointLight(0xff8833, 0, 10, 1.5);
      light.position.set(tipX, tipY + 0.12, tipZ);
      scene.add(light);
      doorTorchLights.push(light);

      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), _flameMat);
      flame.position.set(tipX, tipY + 0.08, tipZ);
      flame.visible = false;
      scene.add(flame);
      doorTorchFlames.push(flame);

      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, STICK_LEN, 4), _stickMat);
      stick.position.set(
        mountX + nx * TIP_OUT / 2,
        torchY + TIP_UP / 2,
        mountZ + nz * TIP_OUT / 2
      );
      if (Math.abs(nx) > 0.5) {
        stick.rotation.z = nx > 0 ? -TILT : TILT;
      } else {
        stick.rotation.x = nz > 0 ? TILT : -TILT;
      }
      stick.castShadow = true;
      scene.add(stick);

      const wx = tipX, wz = tipZ;
      pickableTorches.push({ light, flame, stick, wx, wz, active: true });
    }
  }
}

// ---- Torch pickup ----

export function getNearestPickableTorch() {
  const p = getPlayerState();
  let best = null;
  let bestDist = CFG.TORCH_PICK_DIST;
  for (const t of pickableTorches) {
    if (!t.active) continue;
    const dx = p.x - t.wx, dz = p.z - t.wz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) { bestDist = dist; best = t; }
  }
  return best;
}

export function pickNearestTorch(inventory) {
  const t = getNearestPickableTorch();
  if (!t) return false;
  t.active = false;
  t.stick.visible = false;
  t.flame.visible = false;
  if (t.pooled) {
    // Return pooled light for reuse
    releasePoolLight(t.light);
  } else {
    // World-gen light: keep visible, zero intensity so shader count stays stable
    t.light.intensity = 0;
    t.light.userData.picked = true;
  }
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
  const mat = new THREE.MeshBasicMaterial({
    color: 0x44ff44, transparent: true, opacity: 0.5, depthWrite: false,
  });

  previewGroup = new THREE.Group();

  previewStick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, STICK_LEN, 4), mat);
  previewGroup.add(previewStick);

  previewFlame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), mat.clone());
  previewFlame.material.color.set(0x44ff44);
  previewGroup.add(previewFlame);

  previewGroup.visible = false;
  scene.add(previewGroup);
}

/** Ray-march from camera through crosshair; distances measured from player */
function findPlacementTarget(camera) {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);

  // Player position for distance checks (consistent between 1st/3rd person)
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  let prevX = origin.x, prevZ = origin.z;
  let prevWalkable = true;
  let groundDone = false;

  for (let t = 0.3; t < 12; t += PLACE_STEP) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    const groundY = getTerrainHeight(x, z);

    // Distance from player to this point (horizontal)
    const dxp = x - px, dzp = z - pz;
    const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);

    // Ground hit (only within shorter range from player)
    if (!groundDone && y <= groundY + 0.05) {
      if (distPlayer <= PLACE_MAX_DIST_GROUND) {
        const valid = isWalkable(x, z) && (CFG.SNOW_MODE || groundY >= CFG.WATER_Y);
        return valid ? { type: 'ground', x, z, y: groundY } : null;
      }
      groundDone = true; // past ground range, keep scanning for walls
    }

    // Past wall range from player — stop
    if (distPlayer > PLACE_MAX_DIST_WALL) break;

    // Wall hit (walkable → non-walkable transition)
    const walkable = isWalkable(x, z);
    if (!walkable && prevWalkable) {
      // Reject window cells
      const g = w2g(x, z);
      if (isWindowCell(g.x, g.z)) return null;

      const hitX = !isWalkable(x, prevZ);
      const hitZ = !isWalkable(prevX, z);
      let nx = 0, nz = 0;
      if (hitX && !hitZ) { nx = dir.x > 0 ? -1 : 1; }
      else if (hitZ && !hitX) { nz = dir.z > 0 ? -1 : 1; }
      else { return null; } // corner hit — reject, no clean wall surface
      // Snap mount point to wall surface, pushed 0.1 inside (matches world-gen)
      const wc = g2w(g.x, g.z);
      const wallSurf = CFG.CELL / 2 - CFG.WALL_T / 2 - 0.1;
      const mountX = nx !== 0 ? wc.x + nx * wallSurf : prevX;
      const mountZ = nz !== 0 ? wc.z + nz * wallSurf : prevZ;
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
    previewGroup.visible = false;
    return;
  }

  const hit = findPlacementTarget(camera);
  if (!hit) {
    previewGroup.visible = false;
    return;
  }

  placementHit = hit;
  previewGroup.visible = true;

  // Reset transforms
  previewGroup.rotation.set(0, 0, 0);
  previewStick.position.set(0, 0, 0);
  previewStick.rotation.set(0, 0, 0);
  previewFlame.position.set(0, 0.3, 0);

  if (hit.type === 'wall') {
    // Wall-mounted — position at wall face, tilted away
    const mx = hit.x, mz = hit.z, my = hit.y;
    previewGroup.position.set(
      mx + hit.nx * TIP_OUT / 2,
      my + TIP_UP / 2,
      mz + hit.nz * TIP_OUT / 2
    );
    if (Math.abs(hit.nx) > 0.5) {
      previewStick.rotation.z = hit.nx > 0 ? -TILT : TILT;
    } else {
      previewStick.rotation.x = hit.nz > 0 ? TILT : -TILT;
    }
    previewFlame.position.set(hit.nx * TIP_OUT / 2, TIP_UP / 2, hit.nz * TIP_OUT / 2);
  } else {
    // Ground — vertical
    previewGroup.position.set(hit.x, hit.y + STICK_LEN / 2, hit.z);
    previewFlame.position.set(0, STICK_LEN / 2 + 0.08, 0);
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
  if (placementHit.type === 'wall') {
    t = createWallTorch(scene, placementHit.x, placementHit.z, placementHit.y, placementHit.nx, placementHit.nz, true);
  } else {
    t = createGroundTorch(scene, placementHit.x, placementHit.y, placementHit.z, true);
  }
  if (!t) return false; // pool exhausted
  const entry = { ...t, active: true };
  pickableTorches.push(entry);
  addTorchEmbers(entry);
  inv.torches--;
  return true;
}

// ---- Hint (used by old system, kept for reference but main uses unified hint) ----

const _projTorch = new THREE.Vector3();

export function updateTorchHint() {
  // Now handled by unified updateInteractHint in main.js
}

// ---- Held torch (first-person equipped) ----

let heldGroup = null;
let heldLight = null;
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

export function initHeldTorch(scene) {
  heldGroup = new THREE.Group();

  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 4), _stickMat);
  heldGroup.add(stick);

  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 5), _flameMat);
  flame.position.y = 0.3;
  heldGroup.add(flame);

  heldGroup.visible = false;
  scene.add(heldGroup);

  heldLight = new THREE.PointLight(0xff8833, 0, 15, 1.5);
  scene.add(heldLight);
}

export function updateHeldTorch(camera, active, playerState) {
  if (!heldGroup || !heldLight) return;

  if (!active) {
    heldGroup.visible = false;
    heldLight.intensity = 0;
    return;
  }

  heldGroup.visible = true;
  heldLight.intensity = 2;

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
    camera.getWorldDirection(_fwd);
    _right.crossVectors(_fwd, _yAxis).normalize();
    px = camera.position.x + _right.x * 0.35 + _fwd.x * 0.3;
    py = camera.position.y - 0.45;
    pz = camera.position.z + _right.z * 0.35 + _fwd.z * 0.3;
  }

  heldGroup.position.set(px, py, pz);

  // Keep torch upright with subtle tilt
  heldGroup.rotation.set(0, 0, -0.15);

  // Light at flame tip
  heldLight.position.set(px, py + 0.35, pz);
}

export function hideHeldTorch() {
  if (heldGroup) heldGroup.visible = false;
  if (heldLight) heldLight.intensity = 0;
}

// ---- Torch ember particles ----

let emberTex = null;
const EMBERS_PER_TORCH = 3;
const EMBER_VIS_DIST = 30; // only animate embers near player
let torchEmbers = []; // { sprite, torch, vel, life, maxLife }

function getEmberTexture() {
  if (emberTex) return emberTex;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,200,50,1)');
  grad.addColorStop(0.5, 'rgba(255,100,0,0.6)');
  grad.addColorStop(1, 'rgba(255,50,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  emberTex = new THREE.CanvasTexture(c);
  return emberTex;
}

let _emberScene = null;

export function initTorchEmbers(scene) {
  _emberScene = scene;
  const tex = getEmberTexture();

  // Create ember sprites for all active torches (pickable list covers all)
  for (const t of pickableTorches) {
    if (!t.active) continue;
    for (let i = 0; i < EMBERS_PER_TORCH; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, blending: THREE.AdditiveBlending,
        transparent: true, opacity: 0, depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.layers.set(2); // skip raycaster (layer 0 only)
      sprite.scale.set(0.04, 0.04, 0.04);
      sprite.visible = false;
      scene.add(sprite);
      torchEmbers.push({
        sprite, torch: t,
        vel: new THREE.Vector3(), life: 0, maxLife: rnd(0.8, 2.0),
      });
    }
  }
}

function rnd(a, b) { return a + Math.random() * (b - a); }

function resetEmber(e) {
  const fx = e.torch.flame.position.x;
  const fy = e.torch.flame.position.y;
  const fz = e.torch.flame.position.z;
  e.sprite.position.set(fx + rnd(-0.05, 0.05), fy, fz + rnd(-0.05, 0.05));
  e.vel.set(rnd(-0.15, 0.15), rnd(0.5, 1.2), rnd(-0.15, 0.15));
  e.maxLife = rnd(0.8, 2.0);
  e.life = e.maxLife;
}

export function updateTorchEmbers(dt) {
  if (!torchEmbers.length) return;
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  for (const e of torchEmbers) {
    // Skip inactive or unlit torches (door torches off during day)
    if (!e.torch.active || e.torch.light.intensity < 0.1) {
      e.sprite.visible = false;
      e.life = 0;
      continue;
    }

    // Distance culling
    const dx = e.torch.wx - px, dz = e.torch.wz - pz;
    if (dx * dx + dz * dz > EMBER_VIS_DIST * EMBER_VIS_DIST) {
      e.sprite.visible = false;
      e.life = 0;
      continue;
    }

    e.sprite.visible = true;
    e.life -= dt;
    if (e.life <= 0) {
      resetEmber(e);
    }

    e.sprite.position.x += e.vel.x * dt;
    e.sprite.position.y += e.vel.y * dt;
    e.sprite.position.z += e.vel.z * dt;
    e.vel.x += rnd(-1.5, 1.5) * dt; // wind wobble

    const frac = Math.max(0, e.life / e.maxLife);
    e.sprite.material.opacity = frac * 0.7;
    const sc = 0.03 + 0.05 * frac;
    e.sprite.scale.set(sc, sc, sc);
  }
}

/** Add embers for a newly placed torch */
export function addTorchEmbers(torch) {
  if (!_emberScene) return;
  const tex = getEmberTexture();
  for (let i = 0; i < EMBERS_PER_TORCH; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.layers.set(2); // skip raycaster (layer 0 only)
    sprite.scale.set(0.04, 0.04, 0.04);
    sprite.visible = false;
    _emberScene.add(sprite);
    torchEmbers.push({
      sprite, torch,
      vel: new THREE.Vector3(), life: 0, maxLife: rnd(0.8, 2.0),
    });
  }
}
