import { Vector3, Matrix, MeshBuilder, StandardMaterial, Color3 } from 'babylonjs';
import { getPlayerState } from '../entities/player.js';
import { getCamera, getScene, getEngine } from '../core/scene.js';
import { randomWalkablePos, isWalkable } from './grid.js';
import { getTerrainHeight } from './terrain.js';
import { isInsideBuilding } from './generator.js';
import { collidesWithRock } from './vegetation.js';
import { CFG } from '../config.js';
// Shadow caster registration removed for flowers — too small for visible shadows

const flowers = [];
const PICK_DIST = 2.5;

const inventory = { flowers: 0, stones: 0, torches: 0 };

export function getInventory() { return inventory; }
export function getFlowers() { return flowers; }

export function registerFlower(model, wx, wz) {
  flowers.push({ model, wx, wz, active: true, respawnTimer: 0 });
}

// Flower template for planting clones
let flowerTemplate = null;
export function setFlowerTemplate(model) {
  flowerTemplate = model;
}

// Flower placement preview
let previewMesh = null;
let previewValid = false;

export function isPreviewValid() { return previewValid; }

export function initFlowerPreview(scene) {
  if (!flowerTemplate) return;
  // Clone the template and make it a ghost preview
  const instance = flowerTemplate.clone('flowerPreview', null);
  if (!instance) return;
  previewMesh = instance;

  // Make all child meshes transparent with green tint
  for (const mesh of previewMesh.getChildMeshes ? previewMesh.getChildMeshes() : [previewMesh]) {
    if (mesh.material) {
      mesh.material = mesh.material.clone(mesh.material.name + '_preview');
      mesh.material.alpha = 0.6;
      if (mesh.material.albedoColor) {
        mesh.material.albedoColor = new Color3(0.267, 1.0, 0.267); // green
      } else if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = new Color3(0.267, 1.0, 0.267);
      }
    }
    mesh.isPickable = false;
  }
  previewMesh.setEnabled(false);
  previewMesh.isPickable = false;
}

export function updateFlowerPreview(camera, active) {
  if (!previewMesh) return;
  if (!active || inventory.flowers <= 0) {
    previewMesh.setEnabled(false);
    previewValid = false;
    return;
  }

  const origin = camera.position.clone();
  const dir = camera.getTarget().subtract(camera.position).normalize();

  const p = getPlayerState();
  const px = p.x, pz = p.z;

  // Looking up — no ground intersection
  if (dir.y >= -0.01) {
    previewMesh.setEnabled(false);
    previewValid = false;
    return;
  }

  // Iterative ground plane intersection
  let groundY = 0;
  let hitX, hitZ, t;
  for (let i = 0; i < 3; i++) {
    t = (groundY - origin.y) / dir.y;
    if (t < 0.1 || t > 20) {
      previewMesh.setEnabled(false);
      previewValid = false;
      return;
    }
    hitX = origin.x + dir.x * t;
    hitZ = origin.z + dir.z * t;
    groundY = getTerrainHeight(hitX, hitZ);
  }

  // Distance check from player
  const dxp = hitX - px, dzp = hitZ - pz;
  const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);
  if (distPlayer > CFG.PLANT_MAX_DIST) {
    previewMesh.setEnabled(false);
    previewValid = false;
    return;
  }

  // Validate placement
  const inside = isInsideBuilding(hitX, hitZ);
  const underwater = !CFG.SNOW_MODE && groundY < CFG.WATER_Y;
  const walkable = isWalkable(hitX, hitZ);
  const rockBlock = collidesWithRock(hitX, hitZ, 0.3);

  previewValid = !inside && !underwater && walkable && !rockBlock;

  // Tint green (valid) or red (invalid)
  const tint = previewValid ? new Color3(0.267, 1.0, 0.267) : new Color3(1.0, 0.267, 0.267);
  for (const mesh of previewMesh.getChildMeshes ? previewMesh.getChildMeshes() : [previewMesh]) {
    if (mesh.material) {
      if (mesh.material.albedoColor) mesh.material.albedoColor = tint;
      else if (mesh.material.diffuseColor) mesh.material.diffuseColor = tint;
    }
  }

  previewMesh.position = new Vector3(hitX, groundY, hitZ);
  previewMesh.setEnabled(true);
}

export function plantFlower(scene) {
  if (!previewValid || inventory.flowers <= 0 || !previewMesh || !previewMesh.isEnabled()) return false;

  const wx = previewMesh.position.x;
  const wz = previewMesh.position.z;
  const ty = getTerrainHeight(wx, wz);

  let mesh;
  if (flowerTemplate) {
    mesh = flowerTemplate.clone('plantedFlower', null);
    if (mesh) {
      mesh.position = new Vector3(wx, ty, wz);
      mesh.rotation = new Vector3(0, Math.random() * Math.PI * 2, 0);
      // Flowers are too small for visible shadows — skip to save draw calls
    }
  }
  if (!mesh) {
    // Fallback cone
    mesh = MeshBuilder.CreateCylinder('plantedFlower', {
      diameterTop: 0,
      diameterBottom: 0.3,
      height: 0.35,
      tessellation: 6,
    }, scene);
    const mat = new StandardMaterial('flowerFallback', scene);
    mat.diffuseColor = new Color3(1.0, 0.412, 0.706); // #ff69b4
    mesh.material = mat;
    mesh.position = new Vector3(wx, ty + 0.15, wz);
  }
  registerFlower(mesh, wx, wz);

  inventory.flowers--;
  return true;
}

export function hideFlowerPreview() {
  if (previewMesh) {
    previewMesh.setEnabled(false);
    previewValid = false;
  }
}

export function getNearestFlower() {
  const p = getPlayerState();
  let best = null;
  let bestDist = PICK_DIST;

  for (const f of flowers) {
    if (!f.active) continue;
    const dx = p.x - f.wx;
    const dz = p.z - f.wz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return best;
}

export function pickNearestFlower() {
  const f = getNearestFlower();
  if (!f) return false;

  f.active = false;
  f.model.setEnabled(false);
  f.respawnTimer = 15 + Math.random() * 15;
  inventory.flowers++;
  return true;
}

/**
 * Project a world position to screen coords (Babylon.js).
 */
function projectToScreen(wx, wy, wz) {
  const engine = getEngine();
  const scene = getScene();
  const camera = getCamera();
  const vp = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const projected = Vector3.Project(
    new Vector3(wx, wy, wz),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    vp
  );
  return { x: projected.x, y: projected.y, behind: projected.z > 1 };
}

export function updateFlowers(dt, camera) {
  const p = getPlayerState();

  for (const f of flowers) {
    if (f.active) continue;
    f.respawnTimer -= dt;
    if (f.respawnTimer > 0) continue;

    let placed = false;
    for (let i = 0; i < 30; i++) {
      const pos = randomWalkablePos();
      if (!pos) continue;

      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      if (dx * dx + dz * dz < 40 * 40) continue;

      const ty = getTerrainHeight(pos.x, pos.z);
      const proj = projectToScreen(pos.x, ty + 0.2, pos.z);
      // If visible on screen, skip (don't pop in visibly)
      if (!proj.behind && Math.abs(proj.x / window.innerWidth - 0.5) < 0.6 &&
          Math.abs(proj.y / window.innerHeight - 0.5) < 0.6) continue;

      f.wx = pos.x;
      f.wz = pos.z;
      f.model.position = new Vector3(pos.x, ty, pos.z);
      f.model.setEnabled(true);
      f.active = true;
      placed = true;
      break;
    }

    if (!placed) {
      f.respawnTimer = 1.0;
    }
  }
}

export function updateFlowerHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;

  if (el.style.display === 'block' && (el.dataset.source === 'door' || el.dataset.source === 'soldier')) return;

  const flower = getNearestFlower();
  if (!flower) {
    if (el.dataset.source === 'flower') {
      el.style.display = 'none';
      el.dataset.source = '';
    }
    return;
  }

  const ty = getTerrainHeight(flower.wx, flower.wz);
  const proj = projectToScreen(flower.wx, ty + 0.3, flower.wz);

  if (proj.behind) {
    if (el.dataset.source === 'flower') el.style.display = 'none';
    return;
  }

  el.textContent = '[E] Pick';
  el.style.fontSize = '21px';
  el.style.left = proj.x + 'px';
  el.style.top = proj.y + 'px';
  el.style.display = 'block';
  el.dataset.source = 'flower';
}
