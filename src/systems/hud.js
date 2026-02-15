import { CFG } from '../config.js';
import { getGrid } from '../world/grid.js';
import { getBuildings } from '../world/generator.js';
import { getPlayerState } from '../entities/player.js';
import { w2g } from '../utils/helpers.js';

let frameCount = 0;
let fpsTime = 0;

export function updateFPS(time) {
  frameCount++;
  if (time - fpsTime >= 1000) {
    const el = document.getElementById('fps-display');
    if (el) el.textContent = `FPS: ${frameCount}`;
    frameCount = 0;
    fpsTime = time;
  }
}

export function updateCameraMode() {
  const state = getPlayerState();
  const el = document.getElementById('camera-mode');
  if (el) el.textContent = state.firstPerson ? '1ST PERSON' : '3RD PERSON';
}

export function updateMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 160, 160);

  const grid = getGrid();
  const buildings = getBuildings();
  const state = getPlayerState();
  const s = 160 / CFG.GRID;

  // Grid cells
  for (let x = 0; x < CFG.GRID; x++) {
    for (let z = 0; z < CFG.GRID; z++) {
      ctx.fillStyle = grid[x][z] ? '#1a3a1a' : '#555';
      ctx.fillRect(x * s, z * s, Math.ceil(s), Math.ceil(s));
    }
  }

  // Building interiors
  ctx.fillStyle = '#3a2a1a';
  for (const b of buildings) {
    ctx.fillRect((b.x + 1) * s, (b.z + 1) * s, (b.w - 2) * s, (b.h - 2) * s);
  }

  // Player dot
  const pg = w2g(state.x, state.z);
  ctx.fillStyle = '#ff0';
  ctx.beginPath();
  ctx.arc(pg.x * s, pg.z * s, 3, 0, Math.PI * 2);
  ctx.fill();

  // Direction line
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pg.x * s, pg.z * s);
  ctx.lineTo(
    (pg.x - Math.sin(state.yaw) * 4) * s,
    (pg.z - Math.cos(state.yaw) * 4) * s
  );
  ctx.stroke();
}
