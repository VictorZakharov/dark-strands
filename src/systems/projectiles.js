import * as THREE from 'three';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';
import { getRockTexture, registerPickableRock, findRockSurface, getPickableRockNear, deactivateRock, getTreeFoliageDamping } from '../world/vegetation.js';
import { isWalkable, isWindowCell } from '../world/grid.js';
import { w2g } from '../utils/helpers.js';
import { tryBreakWindow, isWindowBrokenAt } from '../world/geometry.js';
import { getPlayerState, getPlayerBody } from '../entities/player.js';
import { createProjectileSphere, removeBody } from '../core/physics.js';
import { spawnBoundaryHit } from '../world/boundary.js';

const projectiles = [];
const _throwRay = new THREE.Raycaster();
_throwRay.layers.set(0); // skip player model (layer 1) and sky objects (layer 2)

// Glass shard particles
const glassShards = [];
const SHARD_COUNT = 8;
const SHARD_LIFE = 2.0;

function spawnGlassShards(x, y, z, scene) {
  for (let i = 0; i < SHARD_COUNT; i++) {
    const size = 0.03 + Math.random() * 0.06;
    const geo = new THREE.PlaneGeometry(size, size * (0.5 + Math.random()));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x88ccee, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.position.set(
      x + (Math.random() - 0.5) * 0.3,
      y + (Math.random() - 0.5) * 0.3,
      z + (Math.random() - 0.5) * 0.3
    );
    shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    scene.add(shard);
    glassShards.push({
      mesh: shard,
      vx: (Math.random() - 0.5) * 2,
      vy: Math.random() * 2 + 1,
      vz: (Math.random() - 0.5) * 2,
      life: SHARD_LIFE,
      spin: Math.random() * 5,
    });
  }
}

export function spawnProjectile(camera, scene) {
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);

  const p = getPlayerState();
  const eyePos = new THREE.Vector3(p.x, p.y + CFG.PLAYER_H, p.z);

  // Raycast from camera to find exact crosshair target (fixes 3rd person parallax)
  _throwRay.set(camPos, camDir);
  _throwRay.far = 200;
  const hits = _throwRay.intersectObjects(scene.children, true);
  let targetPoint;
  if (hits.length > 0) {
    targetPoint = hits[0].point;
  } else {
    targetPoint = new THREE.Vector3().copy(camPos).addScaledVector(camDir, 200);
  }
  const dir = new THREE.Vector3().subVectors(targetPoint, eyePos).normalize();

  const geo = new THREE.DodecahedronGeometry(CFG.THROWN_STONE_SIZE, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: getRockTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const spawnPos = eyePos.clone().addScaledVector(dir, 0.5);
  spawnPos.y -= 0.3;
  mesh.position.copy(spawnPos);
  scene.add(mesh);

  const vx = dir.x * CFG.THROW_SPEED;
  const vy = dir.y * CFG.THROW_SPEED + 4;
  const vz = dir.z * CFG.THROW_SPEED;

  const body = createProjectileSphere(
    CFG.THROWN_STONE_SIZE, spawnPos.x, spawnPos.y, spawnPos.z, vx, vy, vz
  );

  projectiles.push({
    mesh, body, alive: true, age: 0, restTime: 0,
    sx: spawnPos.x, sz: spawnPos.z,
  });
}

/** Spawn a rock that falls straight down from the given position (placement drop) */
function spawnDroppingRock(x, y, z, scene) {
  const s = CFG.THROWN_STONE_SIZE;
  const geo = new THREE.DodecahedronGeometry(s, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: getRockTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(x, y, z);
  scene.add(mesh);

  const body = createProjectileSphere(s, x, y, z, 0, 0, 0);

  projectiles.push({
    mesh, body, alive: true, age: 0, restTime: 0,
    sx: x, sz: z, dropping: true,
  });
}

export function updateProjectiles(dt) {
  const s = CFG.THROWN_STONE_SIZE;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (!p.alive) continue;

    p.age += dt;

    // Sync mesh from physics body
    p.mesh.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
    p.mesh.quaternion.set(
      p.body.quaternion.x, p.body.quaternion.y,
      p.body.quaternion.z, p.body.quaternion.w
    );

    const bx = p.body.position.x;
    const by = p.body.position.y;
    const bz = p.body.position.z;

    // Window breaking — projectiles pass through window bodies (collision group),
    // so we manually check when they enter a window cell
    const gHit = w2g(bx, bz);
    if (isWindowCell(gHit.x, gHit.z)) {
      if (!isWindowBrokenAt(gHit.x, gHit.z, bx, bz, by)) {
        if (tryBreakWindow(gHit.x, gHit.z, bx, bz, by)) {
          spawnGlassShards(bx, by, bz, p.mesh.parent);
          p.body.velocity.x *= 0.8;
          p.body.velocity.y *= 0.8;
          p.body.velocity.z *= 0.8;
        }
      }
    }

    // Water damping — slow rocks in water
    if (!CFG.SNOW_MODE && by < CFG.WATER_Y) {
      p.body.linearDamping = 0.85;
    } else {
      p.body.linearDamping = 0.01;
    }

    // Tree foliage damping — rocks passing through leaves slow down
    const foliageDamp = getTreeFoliageDamping(bx, by, bz);
    if (foliageDamp !== null) {
      // Frame-rate independent damping (foliageDamp is per-second retention)
      const factor = Math.pow(foliageDamp, dt * 60);
      p.body.velocity.x *= factor;
      p.body.velocity.z *= factor;
      // Only damp upward velocity — let gravity pull rock down through leaves
      if (p.body.velocity.y > 0) {
        p.body.velocity.y *= factor;
      }
      // Never trigger rest detection while in foliage
      p.restTime = 0;
    }

    const speed = Math.sqrt(
      p.body.velocity.x ** 2 + p.body.velocity.y ** 2 + p.body.velocity.z ** 2
    );

    // Rock-on-rock knockback — fast projectile hits a stationary pebble
    if (speed > 2) {
      const hitRock = getPickableRockNear(bx, bz, by, s);
      if (hitRock) {
        const rockY = hitRock.top - hitRock.height * 0.4;
        deactivateRock(hitRock);
        if (hitRock.physicsBody) removeBody(hitRock.physicsBody);
        const factor = 0.6;
        spawnDroppingRock(hitRock.x, rockY, hitRock.z, p.mesh.parent);
        // Give the new rock velocity from the projectile's momentum
        const newProj = projectiles[projectiles.length - 1];
        if (newProj && newProj.body) {
          newProj.body.velocity.set(
            p.body.velocity.x * factor,
            Math.abs(p.body.velocity.y) * 0.3 + 2,
            p.body.velocity.z * factor
          );
        }
        // Slow down the original projectile
        p.body.velocity.x *= 0.3;
        p.body.velocity.y *= 0.3;
        p.body.velocity.z *= 0.3;
      }
    }

    // Rest detection — if velocity stays low, stone has landed
    if (speed < 0.5 && p.age > 0.3) {
      p.restTime += dt;
      if (p.restTime > 0.3) {
        // Stone at rest — register as pickable rock
        p.alive = false;
        removeBody(p.body);
        // Ensure stone rests on terrain, not underground
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

    // World boundary — shield ripple + deflect
    const worldEdge = CFG.HALF - 1;
    const shieldWall = worldEdge + 2; // visual placed past clamp so player can see it
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
      p.mesh.parent.remove(p.mesh);
      p.alive = false;
      removeBody(p.body);
      projectiles.splice(i, 1);
      continue;
    }

    // Failsafe: fallen below world — remove
    if (by < -50) {
      p.mesh.parent.remove(p.mesh);
      p.alive = false;
      removeBody(p.body);
      projectiles.splice(i, 1);
    }
  }

  // Update glass shards (non-physics particles)
  for (let i = glassShards.length - 1; i >= 0; i--) {
    const sh = glassShards[i];
    sh.life -= dt;
    if (sh.life <= 0) {
      sh.mesh.parent.remove(sh.mesh);
      sh.mesh.geometry.dispose();
      sh.mesh.material.dispose();
      glassShards.splice(i, 1);
      continue;
    }
    sh.vy -= 8 * dt;
    sh.mesh.position.x += sh.vx * dt;
    sh.mesh.position.y += sh.vy * dt;
    sh.mesh.position.z += sh.vz * dt;
    sh.mesh.rotation.x += sh.spin * dt;
    sh.mesh.rotation.z += sh.spin * 0.7 * dt;
    sh.mesh.material.opacity = Math.min(0.6, sh.life / SHARD_LIFE * 0.6);
  }
}

/** Returns the nearest in-flight projectile within pickup range, or null. */
export function getNearestInFlightRock() {
  const p = getPlayerState();
  let best = null;
  let bestDist = CFG.ROCK_PICK_DIST;

  for (const pr of projectiles) {
    if (!pr.alive) continue;
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
  pr.mesh.parent.remove(pr.mesh);
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
  if (hSpeed < 1) return; // not moving fast enough

  const hitRock = getPickableRockNear(p.x, p.z, p.y + 0.2, CFG.PLAYER_R);
  if (!hitRock) return;

  deactivateRock(hitRock);
  if (hitRock.physicsBody) removeBody(hitRock.physicsBody);

  const rockY = hitRock.top - hitRock.height * 0.4;
  spawnDroppingRock(hitRock.x, rockY + 0.1, hitRock.z, scene);

  const newProj = projectiles[projectiles.length - 1];
  if (newProj && newProj.body) {
    // Kick direction: from player center toward rock
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
  const mat = new THREE.MeshBasicMaterial({
    color: 0x44ff44, transparent: true, opacity: 0.5, depthWrite: false,
  });
  rockPreviewMesh = new THREE.Mesh(
    new THREE.DodecahedronGeometry(CFG.THROWN_STONE_SIZE, 1),
    mat
  );
  rockPreviewMesh.visible = false;
  scene.add(rockPreviewMesh);
}

function findRockPlacementTarget(camera) {
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);

  const p = getPlayerState();
  const px = p.x, pz = p.z;
  const sz = CFG.THROWN_STONE_SIZE;
  let lastValid = null;

  for (let t = 0.3; t < 12; t += ROCK_PLACE_STEP) {
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;

    const dxp = x - px, dzp = z - pz;
    const distPlayer = Math.sqrt(dxp * dxp + dzp * dzp);
    if (distPlayer > ROCK_PLACE_MAX_DIST) break;

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
    rockPreviewMesh.visible = false;
    return;
  }

  const hit = findRockPlacementTarget(camera);
  if (!hit) {
    rockPreviewMesh.visible = false;
    return;
  }

  rockPlacementHit = hit;
  rockPreviewMesh.visible = true;
  rockPreviewMesh.position.set(hit.x, hit.y, hit.z);
}

export function isRockPreviewValid() {
  return rockPlacementHit !== null;
}

export function placeRockAtPreview(scene) {
  if (!rockPlacementHit) return false;
  spawnDroppingRock(rockPlacementHit.x, rockPlacementHit.y, rockPlacementHit.z, scene);
  return true;
}
