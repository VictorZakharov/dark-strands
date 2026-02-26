import { MeshBuilder, PBRMaterial, StandardMaterial, Vector3, Color3, Ray, Quaternion } from 'babylonjs';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';
import { getRockTexture, registerPickableRock, findRockSurface, getPickableRockNear, deactivateRock, getTreeFoliageDamping } from '../world/vegetation.js';
import { isWalkable, isWindowCell } from '../world/grid.js';
import { w2g } from '../utils/helpers.js';
import { tryBreakWindow, isWindowBrokenAt } from '../world/windows.js';
import { getPlayerState, getPlayerBody } from '../entities/player.js';
import { createProjectileSphere, removeBody } from '../core/physics.js';
import { spawnBoundaryHit } from '../world/boundary.js';
import { getScene, getCamera } from '../core/scene.js';
// Shadow caster registration removed for stones — too small for visible shadows

const projectiles = [];

// Cached stone material — reused for all projectiles (avoids WebGPU pipeline recompilation)
let _stoneMat = null;
function getStoneMat(scene) {
  if (_stoneMat) return _stoneMat;
  _stoneMat = new PBRMaterial('stoneMat', scene);
  const rockTex = getRockTexture();
  if (rockTex) _stoneMat.albedoTexture = rockTex;
  _stoneMat.roughness = 0.95;
  _stoneMat.metallic = 0;
  return _stoneMat;
}

export function spawnProjectile(camera, scene) {
  const camPos = camera.position.clone();
  // Babylon FreeCamera: forward = target - position
  const camDir = camera.getTarget().subtract(camera.position).normalize();

  const p = getPlayerState();
  const eyePos = new Vector3(p.x, p.y + CFG.PLAYER_H, p.z);

  // Raycast from camera to find exact crosshair target (fixes 3rd person parallax)
  const ray = new Ray(camPos, camDir, 200);
  const hit = scene.pickWithRay(ray, (mesh) => {
    // Skip player model and non-pickable meshes
    let node = mesh;
    while (node) {
      if (node.name === 'playerRoot') return false;
      node = node.parent;
    }
    return mesh.isPickable !== false;
  });

  let targetPoint;
  if (hit && hit.hit && hit.pickedPoint) {
    targetPoint = hit.pickedPoint;
  } else {
    targetPoint = camPos.add(camDir.scale(200));
  }
  const dir = targetPoint.subtract(eyePos).normalize();

  const mesh = MeshBuilder.CreateIcoSphere('stone', {
    radius: CFG.THROWN_STONE_SIZE,
    subdivisions: 2,
  }, scene);
  mesh.material = getStoneMat(scene);
  mesh.rotationQuaternion = Quaternion.Identity();
  // Thrown stones are tiny — skip shadow caster to save draw calls
  mesh.isPickable = false;

  const spawnPos = eyePos.add(dir.scale(0.5));
  spawnPos.y -= 0.3;
  mesh.position = spawnPos.clone();

  const vx = dir.x * CFG.THROW_SPEED;
  const vy = dir.y * CFG.THROW_SPEED + 4;
  const vz = dir.z * CFG.THROW_SPEED;

  const body = createProjectileSphere(
    CFG.THROWN_STONE_SIZE, spawnPos.x, spawnPos.y, spawnPos.z, vx, vy, vz
  );

  projectiles.push({
    mesh, body, alive: true, age: 0, restTime: 0,
    sx: spawnPos.x, sz: spawnPos.z,
    prevX: spawnPos.x, prevY: spawnPos.y, prevZ: spawnPos.z,
  });
}

/** Spawn a rock that falls straight down from the given position (placement drop) */
function spawnDroppingRock(x, y, z, scene) {
  const s = CFG.THROWN_STONE_SIZE;
  const mesh = MeshBuilder.CreateIcoSphere('stone', {
    radius: s,
    subdivisions: 2,
  }, scene);
  mesh.material = getStoneMat(scene);
  mesh.rotationQuaternion = Quaternion.Identity();
  mesh.isPickable = false;
  mesh.position = new Vector3(x, y, z);

  const body = createProjectileSphere(s, x, y, z, 0, 0, 0);

  projectiles.push({
    mesh, body, alive: true, age: 0, restTime: 0,
    sx: x, sz: z, dropping: true,
    prevX: x, prevY: y, prevZ: z,
  });
}

export function updateProjectiles(dt) {
  const s = CFG.THROWN_STONE_SIZE;
  const scene = getScene();

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (!p.alive) continue;

    p.age += dt;

    // Sync mesh from physics body
    p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
    if (p.mesh.rotationQuaternion) {
      p.mesh.rotationQuaternion.set(
        p.body.quaternion.x, p.body.quaternion.y,
        p.body.quaternion.z, p.body.quaternion.w
      );
    }

    const bx = p.body.position.x;
    let by = p.body.position.y;
    const bz = p.body.position.z;

    // Per-frame terrain floor clamp
    const terrainFloorY = getTerrainHeight(bx, bz) + s * 0.4;
    if (by < terrainFloorY) {
      p.body.position.y = terrainFloorY;
      by = terrainFloorY;
      if (p.body.velocity.y < 0) {
        p.body.velocity.y *= -0.3;
      }
    }

    // Window breaking — fine-grained sweep from previous to current position
    {
      const ddx = bx - p.prevX, ddz = bz - p.prevZ;
      const dist = Math.sqrt(ddx * ddx + ddz * ddz);
      const steps = Math.max(1, Math.ceil(dist / 0.5));
      let broken = false;
      for (let si = 0; si <= steps && !broken; si++) {
        const t = si / steps;
        const swx = p.prevX + ddx * t;
        const swy = p.prevY + (by - p.prevY) * t;
        const swz = p.prevZ + ddz * t;
        const gc = w2g(swx, swz);
        // Check this cell and 4 neighbors to handle boundary cases
        for (let dg = 0; dg < 5 && !broken; dg++) {
          const cgx = gc.x + (dg === 1 ? -1 : dg === 2 ? 1 : 0);
          const cgz = gc.z + (dg === 3 ? -1 : dg === 4 ? 1 : 0);
          if (isWindowCell(cgx, cgz)) {
            if (!isWindowBrokenAt(cgx, cgz, swx, swz, swy)) {
              if (tryBreakWindow(cgx, cgz, swx, swz, swy, p.body.velocity.x, p.body.velocity.y, p.body.velocity.z)) {
                broken = true;
                p.body.velocity.x *= 0.8;
                p.body.velocity.y *= 0.8;
                p.body.velocity.z *= 0.8;
              }
            }
          }
        }
      }
      p.prevX = bx; p.prevY = by; p.prevZ = bz;
    }

    // Water damping
    if (!CFG.SNOW_MODE && by < CFG.WATER_Y) {
      p.body.linearDamping = 0.85;
    } else {
      p.body.linearDamping = 0.01;
    }

    // Tree foliage damping
    const foliageDamp = getTreeFoliageDamping(bx, by, bz);
    if (foliageDamp !== null) {
      const factor = Math.pow(foliageDamp, dt * 60);
      p.body.velocity.x *= factor;
      p.body.velocity.z *= factor;
      if (p.body.velocity.y > 0) {
        p.body.velocity.y *= factor;
      }
      p.restTime = 0;
    }

    const speed = Math.sqrt(
      p.body.velocity.x ** 2 + p.body.velocity.y ** 2 + p.body.velocity.z ** 2
    );

    // Rock-on-rock knockback
    if (speed > 2) {
      const hitRock = getPickableRockNear(bx, bz, by, s);
      if (hitRock) {
        const rockY = hitRock.top - hitRock.height * 0.4;
        deactivateRock(hitRock);
        if (hitRock.physicsBody) removeBody(hitRock.physicsBody);
        const factor = 0.6;
        spawnDroppingRock(hitRock.x, rockY, hitRock.z, scene);
        const newProj = projectiles[projectiles.length - 1];
        if (newProj && newProj.body) {
          newProj.body.velocity.set(
            p.body.velocity.x * factor,
            Math.abs(p.body.velocity.y) * 0.3 + 2,
            p.body.velocity.z * factor
          );
        }
        p.body.velocity.x *= 0.3;
        p.body.velocity.y *= 0.3;
        p.body.velocity.z *= 0.3;
      }
    }

    // Rest detection
    if (speed < 0.5 && p.age > 0.3) {
      p.restTime += dt;
      if (p.restTime > 0.3) {
        p.alive = false;
        removeBody(p.body);
        const groundY = getTerrainHeight(bx, bz);
        const minY = groundY + s * 0.4;
        if (by < minY) {
          p.mesh.position.y = minY;
        }
        registerPickableRock(p.mesh, bx, bz, s);
        projectiles.splice(i, 1);
        continue;
      }
    } else {
      p.restTime = 0;
    }

    // World boundary
    const worldEdge = CFG.HALF - 1;
    const shieldWall = worldEdge + 2;
    if (Math.abs(bx) > worldEdge || Math.abs(bz) > worldEdge) {
      if (bx > worldEdge) {
        spawnBoundaryHit(shieldWall, by, bz, -1, 0);
        p.body.velocity.x = -Math.abs(p.body.velocity.x) * 0.4;
      } else if (bx < -worldEdge) {
        spawnBoundaryHit(-shieldWall, by, bz, 1, 0);
        p.body.velocity.x = Math.abs(p.body.velocity.x) * 0.4;
      }
      if (bz > worldEdge) {
        spawnBoundaryHit(bx, by, shieldWall, 0, -1);
        p.body.velocity.z = -Math.abs(p.body.velocity.z) * 0.4;
      } else if (bz < -worldEdge) {
        spawnBoundaryHit(bx, by, -shieldWall, 0, 1);
        p.body.velocity.z = Math.abs(p.body.velocity.z) * 0.4;
      }
      p.body.position.x = Math.max(-worldEdge, Math.min(worldEdge, bx));
      p.body.position.z = Math.max(-worldEdge, Math.min(worldEdge, bz));
    }

    // Too far from spawn — remove
    if (Math.abs(bx - p.sx) > 200 || Math.abs(bz - p.sz) > 200) {
      p.mesh.dispose();
      p.alive = false;
      removeBody(p.body);
      projectiles.splice(i, 1);
      continue;
    }

    // Failsafe: fallen below world
    if (by < -50) {
      p.mesh.dispose();
      p.alive = false;
      removeBody(p.body);
      projectiles.splice(i, 1);
    }
  }

}

/** Returns the nearest in-flight projectile within pickup range, or null. */
export function getNearestInFlightRock() {
  const p = getPlayerState();
  let best = null;
  let bestDist = CFG.ROCK_PICK_DIST;

  for (const pr of projectiles) {
    if (!pr.alive) continue;
    if (pr.age < 0.5) continue;
    const dx = p.x - pr.body.position.x;
    const dy = (p.y + CFG.PLAYER_H * 0.5) - pr.body.position.y;
    const dz = p.z - pr.body.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = pr;
    }
  }
  return best;
}

/** Pick up the nearest in-flight projectile within reach. Returns true if picked. */
export function pickNearestInFlightRock(inventory) {
  const p = getPlayerState();
  let bestIdx = -1;
  let bestDist = CFG.ROCK_PICK_DIST;

  for (let i = 0; i < projectiles.length; i++) {
    const pr = projectiles[i];
    if (!pr.alive) continue;
    if (pr.age < 0.5) continue;
    const dx = p.x - pr.body.position.x;
    const dy = (p.y + CFG.PLAYER_H * 0.5) - pr.body.position.y;
    const dz = p.z - pr.body.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return false;

  const pr = projectiles[bestIdx];
  pr.alive = false;
  pr.mesh.dispose();
  removeBody(pr.body);
  projectiles.splice(bestIdx, 1);
  inventory.stones++;
  return true;
}

/** Returns positions of all active (in-flight/rolling) projectiles for minimap */
export function getActiveProjectilePositions() {
  const result = [];
  for (const p of projectiles) {
    if (!p.alive) continue;
    result.push({ x: p.body.position.x, z: p.body.position.z });
  }
  return result;
}

/** Kick a nearby pebble when the player walks into it */
export function kickNearbyRock(scene) {
  const p = getPlayerState();
  const body = getPlayerBody();
  if (!body) return;

  const vx = body.velocity.x;
  const vz = body.velocity.z;
  const hSpeed = Math.sqrt(vx * vx + vz * vz);
  if (hSpeed < 1) return;

  const hitRock = getPickableRockNear(p.x, p.z, p.y + 0.2, CFG.PLAYER_R);
  if (!hitRock) return;

  deactivateRock(hitRock);
  if (hitRock.physicsBody) removeBody(hitRock.physicsBody);

  const rockY = hitRock.top - hitRock.height * 0.4;
  spawnDroppingRock(hitRock.x, rockY + 0.1, hitRock.z, scene);

  const newProj = projectiles[projectiles.length - 1];
  if (newProj && newProj.body) {
    const dx = hitRock.x - p.x;
    const dz = hitRock.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    const kickSpeed = Math.min(hSpeed * 0.7, 8);
    newProj.body.velocity.set(
      (dx / dist) * kickSpeed,
      2,
      (dz / dist) * kickSpeed
    );
  }
}

// ---- Rock placement preview ----

let rockPreviewMesh = null;
let rockPlacementHit = null;
const ROCK_PLACE_MAX_DIST = 3;
const ROCK_PLACE_STEP = 0.12;

export function initRockPreview(scene) {
  const mat = new StandardMaterial('rockPreviewMat', scene);
  mat.diffuseColor = new Color3(0.267, 1.0, 0.267); // #44ff44
  mat.alpha = 0.5;
  mat.disableLighting = true;

  rockPreviewMesh = MeshBuilder.CreateIcoSphere('rockPreview', {
    radius: CFG.THROWN_STONE_SIZE,
    subdivisions: 2,
  }, scene);
  rockPreviewMesh.material = mat;
  rockPreviewMesh.setEnabled(false);
  rockPreviewMesh.isPickable = false;

  // Pre-warm the PBR stone material so WebGPU compiles the pipeline during loading
  // (not on first throw). Create a temp mesh, it'll be included in the first render.
  // Keep it alive (hidden at y=-100) to avoid "destroyed texture" WebGPU errors.
  const warmMesh = MeshBuilder.CreateIcoSphere('stoneWarm', {
    radius: CFG.THROWN_STONE_SIZE, subdivisions: 2,
  }, scene);
  warmMesh.material = getStoneMat(scene);
  warmMesh.position = new Vector3(0, -100, 0);
  warmMesh.isPickable = false;
}

function findRockPlacementTarget(camera) {
  const origin = camera.position.clone();
  const dir = camera.getTarget().subtract(camera.position).normalize();

  const p = getPlayerState();
  const px = p.x, pz = p.z;
  const sz = CFG.THROWN_STONE_SIZE;
  let lastValid = null;

  const playerFeetY = p.y;
  const playerTerrainY = getTerrainHeight(px, pz);
  const onElevated = playerFeetY > playerTerrainY + 1.0;

  for (let t = 0.3; t < 12; t += ROCK_PLACE_STEP) {
    const x = origin.x + dir.x * t;
    let y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;

    const dxp = x - px, dzp = z - pz;
    const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);
    if (distPlayer > ROCK_PLACE_MAX_DIST) break;

    if (onElevated && y < playerFeetY) {
      y = playerFeetY + sz * 0.4;
    }

    if (!isWalkable(x, z)) break;

    const groundY = getTerrainHeight(x, z);
    if (y < groundY + sz * 0.4) break;

    const rockTop = findRockSurface(x, z, y);
    if (rockTop !== null) {
      return { x, y: rockTop + sz * 0.4, z };
    }

    lastValid = { x, y, z };
  }
  return lastValid;
}

export function updateRockPreview(camera, active) {
  if (!rockPreviewMesh) return;
  rockPlacementHit = null;

  if (!active) {
    rockPreviewMesh.setEnabled(false);
    return;
  }

  const hit = findRockPlacementTarget(camera);
  if (!hit) {
    rockPreviewMesh.setEnabled(false);
    return;
  }

  rockPlacementHit = hit;
  rockPreviewMesh.setEnabled(true);
  rockPreviewMesh.position = new Vector3(hit.x, hit.y, hit.z);
}

export function isRockPreviewValid() {
  return rockPlacementHit !== null;
}

export function placeRockAtPreview(scene) {
  if (!rockPlacementHit) return false;
  spawnDroppingRock(rockPlacementHit.x, rockPlacementHit.y, rockPlacementHit.z, scene);
  return true;
}
