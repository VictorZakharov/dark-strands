import * as THREE from 'three';
import { CFG } from './config.js';
import { initScene, getRenderer, getScene, getCamera } from './core/scene.js';
import { initLighting } from './core/lighting.js';
import { initGrid } from './world/grid.js';
import { generateBuildings } from './world/generator.js';
import { buildGround, buildFloors, buildWalls, buildWindows, buildRoofs, buildWater } from './world/geometry.js';
import { placeTrees, placeRocks, getNearestPickableRock } from './world/vegetation.js';
import { placeTorches, placeDoorTorches, getNearestPickableTorch, initHeldTorch, updateHeldTorch, initTorchPreview, updateTorchPreview, initTorchLightPool, initTorchEmbers, updateTorchEmbers } from './world/torches.js';
import { placeDoors, updateDoors, getNearestDoor, getDoorPanelCenter } from './world/doors.js';
import { loadAllModels, getAnimMixers } from './entities/modelLoader.js';
import { initPlayer, updatePlayer, getPlayerState } from './entities/player.js';
import { initControls, isPointerLocked, getKeys } from './systems/controls.js';
import { updateDayNight, setCycleEnabled, setStartTime, getSunOffset, getSunH } from './systems/daynight.js';
import { updateFPS, updateCameraMode, updateMinimap, updateInventory } from './systems/hud.js';
import { updateFlowers, getNearestFlower, initFlowerPreview, updateFlowerPreview } from './world/flowers.js';
import { getTerrainHeight } from './world/terrain.js';
import { initHotbar, getSelectedSlot, getSlotItem, isPlacementMode } from './systems/hotbar.js';
import { updateProjectiles } from './systems/projectiles.js';
import { getSunLight, getSunGroup, getSunLensflare } from './core/lighting.js';
import { updateNpcs, updateSoldierHint, getNearestSoldier } from './systems/npcAI.js';
import { initMenuScene, renderMenu, disposeMenu } from './systems/menu.js';

const clock = new THREE.Clock();
let minimapTick = 0;
let menuMode = true;
const _projHint = new THREE.Vector3();

/**
 * Unified interact hint — picks the interactable closest to the crosshair.
 * Also updates the soldier speech bubble (separate element).
 */
function updateInteractHint(camera) {
  // Soldier speech bubble (always updates, uses separate #npc-speech element)
  updateSoldierHint();

  const el = document.getElementById('interact-hint');
  if (!el) return;

  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;

  let bestDist = Infinity;
  let bestText = '';
  let bestSize = '21px';
  let bestSx = 0, bestSy = 0;
  let bestSource = '';

  function tryCandidate(wx, wy, wz, text, fontSize, source) {
    _projHint.set(wx, wy, wz);
    _projHint.project(camera);
    if (_projHint.z > 1) return; // behind camera
    const sx = _projHint.x * cx + cx;
    const sy = -_projHint.y * cy + cy;
    const dist = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestText = text;
      bestSize = fontSize;
      bestSx = sx;
      bestSy = sy;
      bestSource = source;
    }
  }

  const door = getNearestDoor();
  if (door) {
    const pc = getDoorPanelCenter(door);
    const doorY = door.group.position.y + CFG.WALL_H * 0.5;
    tryCandidate(pc.x, doorY, pc.z, door.open ? '[E] Close' : '[E] Open', '', 'door');
  }

  const soldier = getNearestSoldier();
  if (soldier) {
    const pos = soldier.model.position;
    tryCandidate(pos.x, pos.y + 0.8, pos.z, '[E] Talk', '21px', 'soldier');
  }

  const flower = getNearestFlower();
  if (flower) {
    const ty = getTerrainHeight(flower.wx, flower.wz);
    tryCandidate(flower.wx, ty + 0.3, flower.wz, '[E] Pick', '21px', 'flower');
  }

  const rock = getNearestPickableRock();
  if (rock) {
    tryCandidate(rock.x, rock.top + 0.3, rock.z, '[E] Pick up', '21px', 'rock');
  }

  const torch = getNearestPickableTorch();
  if (torch) {
    const torchHintY = torch.flame.position.y + 0.35;
    tryCandidate(torch.wx, torchHintY, torch.wz, '[E] Take torch', '21px', 'torch');
  }

  if (bestSource) {
    el.textContent = bestText;
    el.style.fontSize = bestSize;
    el.style.left = bestSx + 'px';
    el.style.top = bestSy + 'px';
    el.style.display = 'block';
    el.dataset.source = bestSource;
  } else {
    el.style.display = 'none';
    el.dataset.source = '';
  }
}

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

    updatePlayer(gdt, camera, getSunLight(), keys);
    updateDayNight(gdt, scene);

    // Sun group + lensflare follow player position in sky
    const sunH = getSunH();
    const sg = getSunGroup();
    const lf = getSunLensflare();
    if (sg) {
      if (sunH > 0) {
        sg.visible = true;
        const off = getSunOffset();
        const len = Math.sqrt(off.x * off.x + off.y * off.y + off.z * off.z);
        const R = 170;
        const p = getPlayerState();
        const sx = p.x + off.x / len * R;
        const sy = off.y / len * R;
        const sz = p.z + off.z / len * R;
        sg.position.set(sx, sy, sz);
        if (lf) { lf.position.set(sx, sy, sz); lf.visible = true; }
      } else {
        sg.visible = false;
        if (lf) lf.visible = false;
      }
    }

    updateInteractHint(camera);

    updateDoors(gdt);
    updateNpcs(gdt);
    updateFlowers(gdt, camera);
    updateProjectiles(gdt);

    // Flower placement preview — active when flower slot selected via key press
    const slotItem = getSlotItem(getSelectedSlot());
    const placementActive = isPlacementMode() && slotItem === 'flower';
    updateFlowerPreview(camera, placementActive);

    // Held torch — active when torch slot selected and equipped
    const torchActive = isPlacementMode() && slotItem === 'torch';
    updateHeldTorch(camera, torchActive, getPlayerState());
    updateTorchPreview(camera, torchActive);
    updateTorchEmbers(gdt);

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
  initHotbar();
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
  initFlowerPreview(scene);
  initHeldTorch(scene);
  initTorchLightPool(scene);
  initTorchPreview(scene);
  initTorchEmbers(scene);

  // Pre-compile all shaders during loading to avoid stutter on first use
  // Temporarily show hidden meshes so their shaders get compiled
  const hiddenMeshes = [];
  scene.traverse(c => { if (!c.visible && c.isMesh) { c.visible = true; hiddenMeshes.push(c); } });
  getRenderer().compile(scene, getCamera());
  for (const m of hiddenMeshes) m.visible = false;
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

    // Winter sunrise is 08:00 — start at 10:00 so the sun is well up
    if (CFG.SNOW_MODE) setStartTime(10 / 24);

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
