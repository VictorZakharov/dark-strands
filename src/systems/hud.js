import { CFG } from '../config.js';
import { getInventory, getFlowers } from '../world/flowers.js';
import { getGrid } from '../world/grid.js';
import { getBuildings } from '../world/generator.js';
import { getPlayerState } from '../entities/player.js';
import { w2g } from '../utils/helpers.js';
import { getSlotItem, ITEM_META } from '../systems/hotbar.js';
import { getPickableRocks } from '../world/vegetation.js';
import { getActiveProjectilePositions } from '../systems/projectiles.js';
import { getTerrainHeight } from '../world/terrain.js';

// 5-petal flower icon in the given petal/stroke/centre colors.
function flowerSVG(petal, stroke, centre) {
  return '<svg class="slot-icon-svg" viewBox="0 0 24 24" width="26" height="26">'
    + '<g fill="' + petal + '" stroke="' + stroke + '" stroke-width="0.6">'
    + '<circle cx="12" cy="5" r="4"/><circle cx="18.7" cy="9.8" r="4"/>'
    + '<circle cx="16.1" cy="17.7" r="4"/><circle cx="7.9" cy="17.7" r="4"/>'
    + '<circle cx="5.3" cy="9.8" r="4"/></g>'
    + '<circle cx="12" cy="12" r="3.4" fill="' + centre + '"/></svg>';
}

const SVG_ICONS = {
  rock: '<svg class="slot-icon-svg" viewBox="0 0 24 24" width="26" height="26"><polygon points="5,18 2,12 4,7 9,4 15,3 20,6 22,12 19,18 14,20 8,20" fill="#8a7a60" stroke="#5c4e3a" stroke-width="1"/><polygon points="7,16 5,11 8,7 13,6 17,8 18,13 15,17 10,17" fill="#a08c6e"/><line x1="9" y1="7" x2="14" y2="16" stroke="#6e5e46" stroke-width="0.5"/><line x1="5" y1="12" x2="17" y2="9" stroke="#6e5e46" stroke-width="0.5"/></svg>',
  flower_white:  flowerSVG('#eef1f6', '#c3cad6', '#f2c94c'),
  flower_yellow: flowerSVG('#f4d24a', '#d9a72a', '#a86a12'),
  flower_blue:   flowerSVG('#7ea8e6', '#5b84c4', '#f3e185'),
};

let frameCount = 0;
let fpsTime = 0;
let _waterCells = null; // cached water cell coordinates

export function updateFPS(time) {
  frameCount++;
  if (time - fpsTime >= 1000) {
    const el = document.getElementById('fps-display');
    if (el) el.textContent = `FPS: ${frameCount}`;
    frameCount = 0;
    fpsTime = time;
  }
}

export function updateInventory() {
  const inv = getInventory();

  for (let i = 0; i < 5; i++) {
    const sl = document.querySelector('.hotbar-slot[data-slot="' + i + '"]');
    if (!sl) continue;

    const item = getSlotItem(i);
    const meta = item ? ITEM_META[item] : null;
    const count = meta ? inv[meta.invKey] : 0;

    if (meta && count > 0) {
      const iconHtml = meta.icon.startsWith('svg:')
        ? SVG_ICONS[meta.icon.slice(4)] || ''
        : '<span class="slot-icon">' + meta.icon + '</span>';
      sl.innerHTML = '<span class="slot-label">' + (i + 1) + '</span>'
        + iconHtml
        + '<span class="slot-count">' + count + '</span>';
    } else {
      sl.innerHTML = '<span class="slot-label">' + (i + 1) + '</span>';
    }
  }
}

export function updateCameraMode() {
  const state = getPlayerState();
  const el = document.getElementById('camera-mode');
  if (el) el.textContent = state.firstPerson ? '1ST PERSON' : '3RD PERSON';
}

let _mapBase = null;   // offscreen canvas: grid + water + buildings (static)
let _mapFrame = 0;

/** Render the static map layers once — 6,400 fillRects were being redrawn
 *  EVERY FRAME (plus water + buildings), a constant multi-ms CPU cost that
 *  ran even while paused. */
function buildMinimapBase() {
  const grid = getGrid();
  const buildings = getBuildings();
  const s = 160 / CFG.GRID;
  _mapBase = document.createElement('canvas');
  _mapBase.width = 160;
  _mapBase.height = 160;
  const ctx = _mapBase.getContext('2d');

  for (let x = 0; x < CFG.GRID; x++) {
    for (let z = 0; z < CFG.GRID; z++) {
      ctx.fillStyle = grid[x][z] ? '#1a3a1a' : '#555';
      ctx.fillRect(x * s, z * s, Math.ceil(s), Math.ceil(s));
    }
  }

  if (!CFG.SNOW_MODE) {
    if (!_waterCells) {
      _waterCells = [];
      for (let x = 0; x < CFG.GRID; x++) {
        for (let z = 0; z < CFG.GRID; z++) {
          const wx = (x - CFG.GRID / 2) * CFG.CELL + CFG.CELL / 2;
          const wz = (z - CFG.GRID / 2) * CFG.CELL + CFG.CELL / 2;
          if (getTerrainHeight(wx, wz) < CFG.WATER_Y) {
            _waterCells.push(x, z);
          }
        }
      }
    }
    ctx.fillStyle = 'rgba(30, 90, 180, 0.5)';
    for (let i = 0; i < _waterCells.length; i += 2) {
      ctx.fillRect(_waterCells[i] * s, _waterCells[i + 1] * s, Math.ceil(s), Math.ceil(s));
    }
  }

  for (const b of buildings) {
    ctx.fillStyle = b.stories === 2 ? '#4a3a2a' : '#3a2a1a';
    ctx.fillRect((b.x + 1) * s, (b.z + 1) * s, (b.w - 2) * s, (b.h - 2) * s);
  }
}

/** Force a static-layer rebuild (call if the grid/buildings ever change). */
export function invalidateMinimapBase() { _mapBase = null; }

export function updateMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 160, 160);

  const state = getPlayerState();
  const s = 160 / CFG.GRID;

  if (!_mapBase) buildMinimapBase();
  ctx.drawImage(_mapBase, 0, 0);

  // Flowers (cyan dots)
  ctx.fillStyle = '#0ff';
  for (const f of getFlowers()) {
    if (!f.active) continue;
    const fg = w2g(f.wx, f.wz);
    ctx.fillRect(fg.x * s, fg.z * s, Math.ceil(s), Math.ceil(s));
  }

  // Pickable rocks (orange dots)
  ctx.fillStyle = '#e89030';
  for (const rc of getPickableRocks()) {
    const rg = w2g(rc.x, rc.z);
    ctx.fillRect(rg.x * s - 0.5, rg.z * s - 0.5, Math.ceil(s * 0.6), Math.ceil(s * 0.6));
  }

  // In-flight projectiles (orange dots)
  for (const pp of getActiveProjectilePositions()) {
    const rg = w2g(pp.x, pp.z);
    ctx.fillRect(rg.x * s - 0.5, rg.z * s - 0.5, Math.ceil(s * 0.6), Math.ceil(s * 0.6));
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
