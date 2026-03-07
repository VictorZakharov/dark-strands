import {
  MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, Ray
} from 'babylonjs';
import { getAllDoors } from './doors.js';
import { getPlayerState } from '../entities/player.js';
import { CFG } from '../config.js';
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

// Floor slab bottom Y (visible ceiling from below) in 2-story buildings
const FLOOR_SLAB_BOTTOM = CFG.WALL_H - 0.125 - 0.25; // 3.125

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

/** Find placement target using scene raycasting against visual meshes */
function findPlacementTarget(camera) {
  const scene = camera.getScene();
  const ray = camera.getForwardRay(12);
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  const hit = scene.pickWithRay(ray, (mesh) => {
    if (!mesh.isPickable || !mesh.isVisible) return false;
    const n = mesh.name;
    return n === 'ground' || 
           n === 'walls' || 
           n === 'mergedFloors' || 
           n === 'mergedMidFloors' || 
           n === 'mergedStairs' || 
           n === 'flatRoofs' || 
           n === 'slantRoofs' || 
           n === 'windowGlass' ||
           n.startsWith('doorMerged_');
  });

  if (!hit || !hit.hit) return null;

  const hitX = hit.pickedPoint.x;
  const hitY = hit.pickedPoint.y;
  const hitZ = hit.pickedPoint.z;

  const dpx = hitX - px;
  const dpz = hitZ - pz;
  const distPlayerSq = dpx * dpx + dpz * dpz;

  const normal = hit.getNormal(true, true);
  if (!normal) return null;

  const pickedName = hit.pickedMesh ? hit.pickedMesh.name : '';
  if (pickedName === 'windowGlass') return null; // Prevent placing through glass

  // Floor check: normal is mostly pointing up (y > 0.5)
  if (normal.y > 0.5) {
    if (distPlayerSq > PLACE_MAX_DIST_GROUND * PLACE_MAX_DIST_GROUND) return null;
    if (isTooCloseToTorch(hitX, hitY + STICK_LEN, hitZ)) return null;

    return { type: 'ground', x: hitX, z: hitZ, y: hitY };
  } else {
    // Wall / door check: normal is mostly sideways
    if (distPlayerSq > PLACE_MAX_DIST_WALL * PLACE_MAX_DIST_WALL) return null;

    let nx = normal.x;
    let nz = normal.z;
    const len = Math.sqrt(nx * nx + nz * nz);
    if (len > 0.001) {
      nx /= len;
      nz /= len;
    } else {
      return null;
    }

    if (isTooCloseToTorch(hitX, hitY, hitZ)) return null;

    // Check for ceiling clip: cast a short ray straight up from the torch tip position
    const tipOrigin = new Vector3(hitX + nx * TIP_OUT, hitY + TIP_UP - 0.1, hitZ + nz * TIP_OUT);
    const upHit = scene.pickWithRay(new Ray(tipOrigin, new Vector3(0, 1, 0), 0.2), (m) => m.isPickable && m !== hit.pickedMesh);
    if (upHit && upHit.hit) return null;

    if (pickedName.startsWith('doorMerged_')) {
      const allDoors = getAllDoors();
      let doorHit = null;
      for (const door of allDoors) {
        // hit.pickedMesh is doorMerged_X, whose parent is the leaf, whose parent is the hinge group
        if (hit.pickedMesh.parent && door.group === hit.pickedMesh.parent.parent) {
          doorHit = door;
          break;
        }
      }
      if (doorHit) {
        return { type: 'door', x: hitX, z: hitZ, y: hitY, nx, nz, door: doorHit };
      }
    }

    return { type: 'wall', x: hitX, z: hitZ, y: hitY, nx, nz };
  }
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
    const yaw = Math.atan2(hit.nx, hit.nz);
    previewStick.rotation = new Vector3(TILT, yaw, 0);
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
  if (!placementHit) {
    // DEBUG: log failed placement attempt
    const p = getPlayerState();
    const cam = scene.activeCamera;
    console.log('[TORCH NO-HIT]', {
      player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      cam: { x: +cam.globalPosition.x.toFixed(2), y: +cam.globalPosition.y.toFixed(2), z: +cam.globalPosition.z.toFixed(2) },
      dir: cam.getForwardRay(1).direction.toString(),
    });
    return false;
  }
  const inv = getInventory();
  if (inv.torches <= 0) return false;

  // DEBUG: log placement details
  const p = getPlayerState();
  const cam = scene.activeCamera;
  console.log('[TORCH PLACE]', {
    type: placementHit.type,
    pos: { x: +placementHit.x.toFixed(2), y: +placementHit.y.toFixed(2), z: +placementHit.z.toFixed(2) },
    normal: placementHit.nx != null ? { nx: placementHit.nx, nz: placementHit.nz } : null,
    player: { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
    cam: { x: +cam.globalPosition.x.toFixed(2), y: +cam.globalPosition.y.toFixed(2), z: +cam.globalPosition.z.toFixed(2) },
    dir: cam.getForwardRay(1).direction.toString(),
  });

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
    
    // Calculate yaw relative to the door, then apply tilt
    const localYaw = Math.atan2(localNormal.x, localNormal.z);
    t.stick.rotation = new Vector3(TILT, localYaw, 0);
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
