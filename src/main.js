import * as THREE from 'three';
import { CFG } from './config.js';
import { initScene, getRenderer, getScene, getCamera } from './core/scene.js';
import { initLighting } from './core/lighting.js';
import { initGrid } from './world/grid.js';
import { generateBuildings } from './world/generator.js';
import { buildGround, buildFloors, buildWalls, buildWindows, buildRoofs, buildWater } from './world/geometry.js';
import { placeTrees, placeRocks } from './world/vegetation.js';
import { placeTorches, placeDoorTorches } from './world/torches.js';
import { placeDoors, updateDoors, updateDoorHint } from './world/doors.js';
import { loadAllModels, getAnimMixers } from './entities/modelLoader.js';
import { initPlayer, updatePlayer, getPlayerState } from './entities/player.js';
import { initControls, isPointerLocked, getKeys } from './systems/controls.js';
import { updateDayNight, getDayTime, setCycleEnabled } from './systems/daynight.js';
import { updateFPS, updateCameraMode, updateMinimap, updateInventory } from './systems/hud.js';
import { updateFlowers, updateFlowerHint } from './world/flowers.js';
import { getSunLight } from './core/lighting.js';
import { updateNpcs, updateSoldierHint } from './systems/npcAI.js';
import { initMenuScene, renderMenu, disposeMenu } from './systems/menu.js';

const clock = new THREE.Clock();
let minimapTick = 0;
let menuMode = true;

function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.1);

  const renderer = getRenderer();

  if (isPointerLocked()) {
    // First time locking — leave menu mode
    if (menuMode) {
      menuMode = false;
      disposeMenu();
      const blocker = document.getElementById('blocker');
      if (blocker) blocker.dataset.mode = 'game';
      const loadingBar = document.getElementById('menu-loading');
      if (loadingBar) loadingBar.style.display = 'none';
      // Show all HUD elements (override CSS display:none)
      for (const id of ['hud-bottom', 'minimap-wrap', 'crosshair', 'hud-top-left']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
      }
      const hotbar = document.getElementById('hotbar');
      if (hotbar) hotbar.style.display = 'flex';
    }

    const scene = getScene();
    const camera = getCamera();
    const keys = getKeys();

    // Q key = 3× game speed (time, movement, animations)
    const speed = keys['KeyQ'] ? 3 : 1;
    const gdt = dt * speed;

    updatePlayer(gdt, camera, getSunLight(), getDayTime(), keys);
    updateDayNight(gdt, scene);

    updateDoorHint();
    updateSoldierHint();
    updateFlowerHint();

    updateDoors(gdt);
    updateNpcs(gdt);
    updateFlowers(gdt, camera);
    for (const m of getAnimMixers()) m.update(gdt);

    renderer.render(scene, camera);

    updateFPS(time);
    updateCameraMode();
    updateInventory();

    minimapTick++;
    if (minimapTick % 10 === 0) updateMinimap();
  } else if (menuMode) {
    // Menu screen — render the procedural menu scene
    renderMenu(renderer, dt);
  } else {
    // Paused (ESC) — keep rendering game scene frozen
    const scene = getScene();
    const camera = getCamera();
    renderer.render(scene, camera);
  }
}

function setLoadProgress(pct) {
  const fill = document.getElementById('menu-load-fill');
  if (fill) fill.style.width = pct + '%';
}

// Yield to browser so progress bar can repaint
const yieldFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function buildWorld() {
  const scene = getScene();

  await yieldFrame();
  initLighting(scene);
  setLoadProgress(5);

  await yieldFrame();
  initGrid();
  setLoadProgress(10);

  await yieldFrame();
  generateBuildings();
  setLoadProgress(18);

  await yieldFrame();
  buildGround(scene);
  setLoadProgress(25);

  await yieldFrame();
  buildFloors(scene);
  setLoadProgress(30);

  await yieldFrame();
  buildWalls(scene);
  setLoadProgress(40);

  await yieldFrame();
  buildRoofs(scene);
  setLoadProgress(45);

  await yieldFrame();
  placeTrees(scene);
  setLoadProgress(52);

  await yieldFrame();
  placeRocks(scene);
  setLoadProgress(58);

  await yieldFrame();
  placeTorches(scene);
  placeDoorTorches(scene);
  setLoadProgress(62);

  await yieldFrame();
  placeDoors(scene);
  setLoadProgress(66);

  await yieldFrame();
  buildWindows(scene);
  setLoadProgress(70);

  await yieldFrame();
  buildWater(scene);
  setLoadProgress(75);

  await yieldFrame();
  initPlayer(scene);
  setLoadProgress(80);

  await yieldFrame();
  initControls();
  setLoadProgress(85);

  // Wire up day/night toggle
  const dnCheckbox = document.getElementById('daynight-checkbox');
  if (dnCheckbox) {
    setCycleEnabled(dnCheckbox.checked);
    dnCheckbox.addEventListener('change', () => setCycleEnabled(dnCheckbox.checked));
  }

  updateDayNight(0, scene);
  setLoadProgress(88);

  // Load models async
  await yieldFrame();
  await loadAllModels(scene);
  setLoadProgress(100);
}

function setupPlayButton() {
  const playBtn = document.getElementById('menu-play');
  if (!playBtn) return;

  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    // Read snow biome toggle before building world
    const snowCheckbox = document.getElementById('snow-checkbox');
    CFG.SNOW_MODE = snowCheckbox ? snowCheckbox.checked : false;

    // Hide panel + keys, show loading bar
    const panel = document.getElementById('menu-panel');
    const keys = document.getElementById('menu-keys');
    const loading = document.getElementById('menu-loading');
    const fill = document.getElementById('menu-load-fill');
    const loadText = document.getElementById('menu-load-text');
    if (panel) panel.style.display = 'none';
    if (keys) keys.style.display = 'none';
    if (loading) loading.style.display = 'flex';
    if (loadText) loadText.textContent = 'Building world...';
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '0%';
    }

    // Build the world (progress bar updates during build via yieldFrame)
    await buildWorld();

    // World ready — request pointer lock
    if (loadText) loadText.textContent = 'Entering world...';
    await yieldFrame();
    const p = getRenderer().domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  });
}

async function init() {
  initScene();

  // Start menu scene immediately
  initMenuScene();

  // Hide old loading screen — menu 3D scene is now the background
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';

  // Start render loop so menu scene is visible
  requestAnimationFrame(gameLoop);

  // Show menu panel immediately (world builds on "Enter World" click)
  setupPlayButton();

  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('menu-panel');
  if (panel) panel.style.display = 'flex';
}

init();
