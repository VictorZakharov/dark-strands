import * as THREE from 'three';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';
import { getRockTexture, registerPickableRock, collidesWithRock, getRockPushback } from '../world/vegetation.js';
import { isWalkable } from '../world/grid.js';
import { getPlayerState } from '../entities/player.js';

const projectiles = [];
const BOUNCE = 0.5; // coefficient of restitution

export function spawnProjectile(camera, scene) {
  // Camera ray determines where the crosshair points
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  camera.getWorldPosition(camPos);
  camera.getWorldDirection(camDir);

  // Spawn from player eye position (works in both 1st/3rd person)
  const p = getPlayerState();
  const eyePos = new THREE.Vector3(p.x, p.y + CFG.PLAYER_H, p.z);

  // Throw direction: from player eye toward where crosshair points
  const target = new THREE.Vector3().copy(camPos).addScaledVector(camDir, 50);
  const dir = new THREE.Vector3().subVectors(target, eyePos).normalize();

  const geo = new THREE.DodecahedronGeometry(CFG.THROWN_STONE_SIZE, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: getRockTexture(),
    roughness: 0.95,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Spawn slightly forward from player eye so stone doesn't clip player model
  mesh.position.copy(eyePos).addScaledVector(dir, 0.5);
  mesh.position.y -= 0.3;
  scene.add(mesh);

  projectiles.push({
    mesh,
    vx: dir.x * CFG.THROW_SPEED,
    vy: dir.y * CFG.THROW_SPEED + 4,
    vz: dir.z * CFG.THROW_SPEED,
    alive: true,
    age: 0,
    sx: mesh.position.x,
    sz: mesh.position.z,
  });
}

export function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (!p.alive) continue;

    p.age += dt;

    // Save old position
    const ox = p.mesh.position.x;
    const oz = p.mesh.position.z;

    // Apply physics
    p.vy -= CFG.THROW_GRAV * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;

    const nx = p.mesh.position.x;
    const nz = p.mesh.position.z;

    // Spin for visual flair
    p.mesh.rotation.x += dt * 5;
    p.mesh.rotation.z += dt * 3;

    // Wall/building/tree collision (grid-based) — bounce off
    if (!isWalkable(nx, nz)) {
      const hitX = !isWalkable(nx, oz);
      const hitZ = !isWalkable(ox, nz);

      if (hitX) p.vx *= -BOUNCE;
      if (hitZ) p.vz *= -BOUNCE;
      if (!hitX && !hitZ) { p.vx *= -BOUNCE; p.vz *= -BOUNCE; }
      p.vy *= BOUNCE;

      // Revert to pre-collision position
      p.mesh.position.x = ox;
      p.mesh.position.z = oz;
    }

    // Rock collider collision — bounce off
    if (collidesWithRock(nx, nz, CFG.THROWN_STONE_SIZE)) {
      const push = getRockPushback(nx, nz, CFG.THROWN_STONE_SIZE);
      if (push) {
        const len = Math.sqrt(push.x * push.x + push.z * push.z);
        if (len > 0) {
          const pnx = push.x / len;
          const pnz = push.z / len;
          const dot = p.vx * pnx + p.vz * pnz;
          p.vx = (p.vx - 2 * dot * pnx) * BOUNCE;
          p.vz = (p.vz - 2 * dot * pnz) * BOUNCE;
          p.vy *= BOUNCE;
        }
        p.mesh.position.x = ox;
        p.mesh.position.z = oz;
      }
    }

    // Ground collision — stone lands, becomes pickable
    const groundY = getTerrainHeight(p.mesh.position.x, p.mesh.position.z);
    const restY = groundY + CFG.THROWN_STONE_SIZE * 0.4;
    if (p.mesh.position.y <= restY) {
      p.mesh.position.y = restY;
      p.alive = false;
      registerPickableRock(p.mesh, p.mesh.position.x, p.mesh.position.z, CFG.THROWN_STONE_SIZE);
      projectiles.splice(i, 1);
      continue;
    }

    // Too far from spawn — remove
    if (Math.abs(p.mesh.position.x - p.sx) > 200 ||
        Math.abs(p.mesh.position.z - p.sz) > 200) {
      p.mesh.parent.remove(p.mesh);
      p.alive = false;
      projectiles.splice(i, 1);
    }
  }
}
