import * as THREE from 'three';
import { getGrid, isDoorCell, isWindowCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rngInt } from '../utils/helpers.js';
import { CFG } from '../config.js';

const torchLights = [];

export function getTorchLights() {
  return torchLights;
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
          if (nx >= 0 && nx < CFG.GRID && nz >= 0 && nz < CFG.GRID && !grid[nx][nz] && !isDoorCell(nx, nz) && !isWindowCell(nx, nz)) {
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
