import { ParticleSystem, DynamicTexture, Vector3, Color4, NoiseProceduralTexture } from 'babylonjs';
import { CFG } from '../config.js';
import { w2g, g2w } from '../utils/helpers.js';
import { isIndoor, isUpperFloorCell, isStairCell } from '../world/grid.js';
import { getBuildings } from '../world/generator.js';
import { getTerrainHeight } from '../world/terrain.js';
import { getWeatherModifiers } from './weather.js';

// Player-following precipitation (rain streaks or snow flakes by biome) with
// ground/roof kill, indoor suppression via the building grid, and splash
// rings queued at rain impact points. CPU ParticleSystem (proven on WebGPU
// in this project; per-particle kill logic needs the updateFunction hook).

let _precip = null;
let _splash = null;
let _isSnow = false;

// Per-cell landing surface Y: roof top over indoor cells, terrain/water otherwise
let _surfaceY = null;

// Splash impact queue (ring buffer)
const SPLASH_QUEUE_MAX = 48;
const _queue = [];

function bakeSurfaceMap() {
  const N = CFG.GRID;
  _surfaceY = new Float32Array(N * N);
  for (let gx = 0; gx < N; gx++) {
    for (let gz = 0; gz < N; gz++) {
      const w = g2w(gx, gz);
      const terrain = getTerrainHeight(w.x, w.z);
      let y;
      if (isIndoor(gx, gz)) {
        // Stair cells of 2-story buildings are deliberately NOT marked as
        // upper-floor (the stairwell is open) but their roof is still 2 stories up
        const stories = (isUpperFloorCell(gx, gz) || isStairCell(gx, gz)) ? 2 : 1;
        y = terrain + stories * CFG.WALL_H; // eave height (flat-roof top)
        // Gable roofs rise above the eaves — track the ridge profile so drops
        // land on the visible slanted surface instead of falling through it
        const b = buildingAt(gx, gz);
        if (b && b.roofType === 'slanted') {
          const c = buildingCenter(b);
          const longAxis = b.w >= b.h;
          const halfSpan = ((longAxis ? b.h : b.w) * CFG.CELL) / 2 + 0.4; // + overhang
          const dist = Math.abs(longAxis ? w.z - c.z : w.x - c.x);
          y += Math.max(0, 1.8 * (1 - dist / halfSpan)); // ridgeHeight = 1.8 (walls.js)
        }
      } else {
        y = Math.max(terrain, CFG.WATER_Y); // land on ground or water/ice surface
      }
      _surfaceY[gx * N + gz] = y;
    }
  }
}

function buildingAt(gx, gz) {
  for (const b of getBuildings()) {
    if (gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h) return b;
  }
  return null;
}

/** World-space building center (matches walls.js getBuildingCenter) */
function buildingCenter(b) {
  const p1 = g2w(b.x, b.z);
  const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
  return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

function surfaceYAt(wx, wz) {
  const g = w2g(wx, wz);
  const gx = Math.max(0, Math.min(CFG.GRID - 1, g.x));
  const gz = Math.max(0, Math.min(CFG.GRID - 1, g.z));
  return _surfaceY[gx * CFG.GRID + gz];
}

function makeStreakTexture(scene) {
  const tex = new DynamicTexture('rainStreakTex', { width: 8, height: 64 }, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 8, 64);
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(200,215,235,0)');
  grad.addColorStop(0.4, 'rgba(200,215,235,0.85)');
  grad.addColorStop(0.6, 'rgba(220,230,245,0.85)');
  grad.addColorStop(1, 'rgba(200,215,235,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(2, 0, 4, 64);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function makeSplashTexture(scene) {
  const sz = 64;
  const tex = new DynamicTexture('rainSplashTex', sz, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, sz, sz);
  ctx.strokeStyle = 'rgba(210,225,240,0.7)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(sz / 2, sz / 2, sz / 2 - 6, 0, Math.PI * 2);
  ctx.stroke();
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function makeFlakeTexture(scene) {
  const sz = 32;
  const tex = new DynamicTexture('snowFlakeTex', sz, scene, false);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, sz, sz);
  const c = sz / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.5, 'rgba(245,248,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

function queueSplash(x, y, z) {
  if (_queue.length < SPLASH_QUEUE_MAX) _queue.push({ x, y, z });
}

/** Wrap the default particle update with surface-kill + splash spawning. */
function addKillPlane(ps, spawnSplashes) {
  const orig = ps.updateFunction;
  ps.updateFunction = function (particles) {
    orig.call(this, particles);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const gy = surfaceYAt(p.position.x, p.position.z);
      if (p.position.y <= gy + 0.05) {
        if (spawnSplashes) queueSplash(p.position.x, gy + 0.02, p.position.z);
        p.age = p.lifeTime; // recycle
      }
    }
  };
}

export function initRainFX(scene) {
  if (!CFG.GFX.WEATHER) return;
  bakeSurfaceMap();
  _isSnow = CFG.SNOW_MODE;

  if (_isSnow) {
    _precip = new ParticleSystem('snow', 2600, scene);
    _precip.particleTexture = makeFlakeTexture(scene);
    _precip.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    _precip.emitter = new Vector3(0, 12, 0);
    _precip.minEmitBox = new Vector3(-15, 0, -15);
    _precip.maxEmitBox = new Vector3(15, 2, 15);
    _precip.direction1 = new Vector3(0, -1, 0);
    _precip.direction2 = new Vector3(0, -1, 0);
    _precip.minEmitPower = 1.0;
    _precip.maxEmitPower = 2.0;
    _precip.gravity = new Vector3(0, -0.6, 0);
    _precip.minLifeTime = 6;
    _precip.maxLifeTime = 9;
    _precip.minSize = 0.04;
    _precip.maxSize = 0.09;
    _precip.color1 = new Color4(1, 1, 1, 0.9);
    _precip.color2 = new Color4(0.9, 0.94, 1, 0.7);
    _precip.updateSpeed = 1 / 60;
    // Lateral drift
    const noise = new NoiseProceduralTexture('snowDrift', 256, scene);
    noise.animationSpeedFactor = 3;
    noise.brightness = 0.5;
    _precip.noiseTexture = noise;
    _precip.noiseStrength = new Vector3(0.6, 0.1, 0.6);
    addKillPlane(_precip, false);
  } else {
    _precip = new ParticleSystem('rain', 2500, scene);
    _precip.particleTexture = makeStreakTexture(scene);
    _precip.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    _precip.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    _precip.emitter = new Vector3(0, 14, 0);
    _precip.minEmitBox = new Vector3(-12, 0, -12);
    _precip.maxEmitBox = new Vector3(12, 2, 12);
    _precip.direction1 = new Vector3(0, -1, 0);
    _precip.direction2 = new Vector3(0, -1, 0);
    _precip.minEmitPower = 20;
    _precip.maxEmitPower = 26;
    _precip.minLifeTime = 0.7;
    _precip.maxLifeTime = 0.9;
    _precip.minScaleX = 0.015;
    _precip.maxScaleX = 0.025;
    _precip.minScaleY = 0.35;
    _precip.maxScaleY = 0.55;
    _precip.color1 = new Color4(0.62, 0.68, 0.8, 0.35);
    _precip.color2 = new Color4(0.62, 0.68, 0.8, 0.35);
    _precip.updateSpeed = 1 / 60;
    addKillPlane(_precip, true);

    // Splash rings at impact points — driven purely by manualEmitCount
    _splash = new ParticleSystem('rainSplash', 300, scene);
    _splash.particleTexture = makeSplashTexture(scene);
    _splash.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    _splash.emitter = new Vector3(0, 0, 0);
    _splash.emitRate = 0;
    _splash.manualEmitCount = 0;
    // FLAT ground rings: non-billboard particle quads lie perpendicular to
    // the particle's direction (shader: yaxis = normalize(direction)), so
    // direction straight up + non-billboard = ring lying on the ground.
    // Camera-facing billboards read as circles floating in the air ("screen
    // effect"). Power must be nonzero or the stored direction collapses to
    // a zero vector and the shader normalize() produces NaN.
    _splash.isBillboardBased = false;
    _splash.direction1 = new Vector3(0, 1, 0);
    _splash.direction2 = new Vector3(0, 1, 0);
    _splash.minEmitPower = 0.001;
    _splash.maxEmitPower = 0.001;
    _splash.gravity = new Vector3(0, 0, 0);
    _splash.minLifeTime = 0.25;
    _splash.maxLifeTime = 0.35;
    _splash.addSizeGradient(0, 0.08);
    _splash.addSizeGradient(1, 0.35);
    _splash.addColorGradient(0, new Color4(0.8, 0.86, 0.95, 0.55));
    _splash.addColorGradient(1, new Color4(0.8, 0.86, 0.95, 0));
    _splash.updateSpeed = 1 / 60;
    _splash.startPositionFunction = (worldMatrix, positionToUpdate) => {
      const s = _queue.pop();
      if (s) positionToUpdate.set(s.x, s.y, s.z);
      else positionToUpdate.set(0, -100, 0);
    };
  }

  _precip.emitRate = 0;
  _precip.start();
  if (_splash) _splash.start();
}

/** Emit a burst during the loading-screen warm-up so WebGPU pipelines compile early. */
export function prewarmRainFX() {
  if (!_precip) return;
  _precip.manualEmitCount = 60;
  if (_splash) {
    queueSplash(0, -50, 0);
    _splash.manualEmitCount = 1;
  }
}

/** Clear warm-up particles and restore normal emission after the warm-up renders. */
export function resetRainFX() {
  if (!_precip) return;
  _precip.reset();
  _precip.manualEmitCount = -1; // re-enable emitRate-driven emission
  if (_splash) {
    _splash.reset();
    _splash.manualEmitCount = 0;
    _queue.length = 0;
  }
}

export function updateRainFX(gdt, player, timeScale) {
  if (!_precip) return;
  const m = getWeatherModifiers();

  let rate = _isSnow ? m.rainRate / 2.5 : m.rainRate;
  if (timeScale > 5) rate = 0; // sleeping — screen is dark, skip the work

  _precip.emitRate = rate;
  const lead = _isSnow ? 2.0 : 0.6;
  _precip.emitter.set(player.x - m.windX * lead, player.y + (_isSnow ? 12 : 14), player.z - m.windZ * lead);
  const drift = _isSnow ? 0.15 : 0.06;
  _precip.direction1.set(m.windX * drift, -1, m.windZ * drift);
  _precip.direction2.set(m.windX * drift, -1, m.windZ * drift);

  if (_splash) {
    // Clamp per-frame emission — a stale backlog (e.g. after pause) drains
    // over a few frames instead of popping 48 rings at once
    _splash.manualEmitCount = Math.min(_queue.length, 16);
  }
}

/** Call while the game is paused: rain particles keep animating during the
 *  paused render, so freeze emission and drop queued impacts to avoid a
 *  splash burst on resume. */
export function pauseRainFX() {
  if (!_precip) return;
  _precip.emitRate = 0;
  _queue.length = 0;
  if (_splash) _splash.manualEmitCount = 0;
}
