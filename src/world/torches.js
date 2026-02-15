import * as THREE from 'three';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rngInt } from '../utils/helpers.js';
import { CFG } from '../config.js';

const torchLights = [];
const doorTorchLights = [];
const doorTorchFlames = [];

export function getTorchLights() {
  return torchLights;
}

export function getDoorTorchLights() {
  return doorTorchLights;
}

export function getDoorTorchFlames() {
  return doorTorchFlames;
}

export function placeTorches(scene) {
  const grid = getGrid();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });

  const wallOffset = 0.85; // distance from cell center toward adjacent wall

  for (const b of getBuildings()) {
    // Collect all valid wall-adjacent interior positions
    const candidates = [];

    for (let gx = b.x + 1; gx < b.x + b.w - 1; gx++) {
      for (let gz = b.z + 1; gz < b.z + b.h - 1; gz++) {
        if (!grid[gx][gz]) continue; // skip wall cells

        // Check each cardinal direction for an adjacent wall
        const dirs = [
          { dx: -1, dz: 0 },
          { dx: 1, dz: 0 },
          { dx: 0, dz: -1 },
          { dx: 0, dz: 1 },
        ];

        for (const d of dirs) {
          const nx = gx + d.dx;
          const nz = gz + d.dz;
          if (nx >= 0 && nx < CFG.GRID && nz >= 0 && nz < CFG.GRID && !grid[nx][nz] && !isDoorCell(nx, nz) && !isWindowCell(nx, nz) && !isStairCell(nx, nz)) {
            candidates.push({
              gx, gz,
              ox: d.dx * wallOffset,
              oz: d.dz * wallOffset,
            });
          }
        }
      }
    }

    if (candidates.length === 0) continue;

    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Place 1-2 torches per building
    const count = Math.min(candidates.length, rngInt(1, 2));

    for (let i = 0; i < count; i++) {
      const tp = candidates[i];
      const p = g2w(tp.gx, tp.gz);
      const wx = p.x + tp.ox;
      const wz = p.z + tp.oz;
      const torchY = 2.2;

      const light = new THREE.PointLight(0xff8833, 2, 12, 1.5);
      light.position.set(wx, torchY + 0.4, wz);
      scene.add(light);
      torchLights.push(light);

      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), flameMat);
      flame.position.set(wx, torchY + 0.35, wz);
      scene.add(flame);

      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 4), stickMat);
      stick.position.set(wx, torchY, wz);
      stick.castShadow = true;
      scene.add(stick);
    }
  }
}

export function placeDoorTorches(scene) {
  const grid = getGrid();
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });
  const torchY = 2.2;
  // Keep torch within the door cell laterally (avoids clipping into corner blocks)
  const sideOff = CFG.CELL * 0.45;
  // Just outside the thin wall surface (WALL_T/2 from cell center)
  const normOff = CFG.WALL_T / 2 + 0.08;

  for (const b of getBuildings()) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const isNS = d.wall === 'south' || d.wall === 'north';

      // Pick which side of the door has a solid wall (not another door)
      let side = 1;
      if (isNS) {
        const rightOk = d.gx + 1 < CFG.GRID && !grid[d.gx + 1][d.gz] && !isDoorCell(d.gx + 1, d.gz);
        const leftOk = d.gx - 1 >= 0 && !grid[d.gx - 1][d.gz] && !isDoorCell(d.gx - 1, d.gz);
        if (!rightOk && leftOk) side = -1;
        else if (!rightOk && !leftOk) continue;
      } else {
        const rightOk = d.gz + 1 < CFG.GRID && !grid[d.gx][d.gz + 1] && !isDoorCell(d.gx, d.gz + 1);
        const leftOk = d.gz - 1 >= 0 && !grid[d.gx][d.gz - 1] && !isDoorCell(d.gx, d.gz - 1);
        if (!rightOk && leftOk) side = -1;
        else if (!rightOk && !leftOk) continue;
      }

      let wx, wz;
      switch (d.wall) {
        case 'south': wx = p.x + side * sideOff; wz = p.z + normOff; break;
        case 'north': wx = p.x + side * sideOff; wz = p.z - normOff; break;
        case 'west':  wx = p.x - normOff; wz = p.z + side * sideOff; break;
        case 'east':  wx = p.x + normOff; wz = p.z + side * sideOff; break;
      }

      // Point light (starts off — controlled by daynight system)
      const light = new THREE.PointLight(0xff8833, 0, 10, 1.5);
      light.position.set(wx, torchY + 0.4, wz);
      scene.add(light);
      doorTorchLights.push(light);

      // Flame (starts hidden)
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), flameMat);
      flame.position.set(wx, torchY + 0.35, wz);
      flame.visible = false;
      scene.add(flame);
      doorTorchFlames.push(flame);

      // Stick (always visible)
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 4), stickMat);
      stick.position.set(wx, torchY, wz);
      stick.castShadow = true;
      scene.add(stick);
    }
  }
}
