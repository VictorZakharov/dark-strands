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
import { initHotbar, getSelectedSlot, getSlotItem, isPlacementMode, isAltMode } from './systems/hotbar.js';
import { updateProjectiles } from './systems/projectiles.js';
import { getSunLight, getSunGroup, getSunLensflare } from './core/lighting.js';
import { updateNpcs, updateSoldierHint, getNearestSoldier } from './systems/npcAI.js';
import { initMenuScene, renderMenu, disposeMenu } from './systems/menu.js';

const clock = new THREE.Clock();
let minimapTick = 0;
let menuMode = true;
let altBlend = 0; // 0 = normal, 1 = greyscale (ALT mode)
const _projHint = new THREE.Vector3();
let _hintSx = 0, _hintSy = 0, _hintActive = false;

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
    tryCandidate(pos.x, pos.y + 1.0, pos.z, '[E] Talk', '21px', 'soldier');
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
    // Clamp to viewport, staying above hotbar (bottom: 40px + 52px height + gap)
    const margin = 40;
    const maxY = window.innerHeight - 110; // above hotbar
    let targetX = Math.max(margin, Math.min(window.innerWidth - margin, bestSx));
    let targetY = bestSy;
    if (targetY > maxY) {
      targetY = (cy + maxY) / 2;
    }
    targetY = Math.max(margin, targetY);

    // Smooth lerp toward target so hint never jumps
    const lerpSpeed = 0.18;
    if (!_hintActive) {
      _hintSx = targetX;
      _hintSy = targetY;
      _hintActive = true;
    } else {
      _hintSx += (targetX - _hintSx) * lerpSpeed;
      _hintSy += (targetY - _hintSy) * lerpSpeed;
    }

    el.textContent = bestText;
    el.style.fontSize = bestSize;
    el.style.left = _hintSx + 'px';
    el.style.top = _hintSy + 'px';
    el.style.display = 'block';
    el.dataset.source = bestSource;
  } else {
    el.style.display = 'none';
    el.dataset.source = '';
    _hintActive = false;
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
    const alt = isAltMode();
    const speed = keys['KeyQ'] && !alt ? 3 : 1;
    const gdt = dt * speed;

    // In ALT mode: freeze player input but keep world ticking
    const emptyKeys = {};
    updatePlayer(gdt, camera, getSunLight(), alt ? emptyKeys : keys);
    updateDayNight(gdt, scene);

    // Greyscale transition
    altBlend = Math.max(0, Math.min(1, altBlend + (alt ? 1 : -1) * dt * 2)); // 0.5s transition
    const canvas = renderer.domElement;
    canvas.style.filter = altBlend > 0.001 ? `saturate(${1 - altBlend * 0.85})` : '';

    // Crosshair visibility
    const chEl = document.getElementById('crosshair');
    if (chEl) chEl.style.opacity = alt ? '0' : '';

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

    if (!alt) updateInteractHint(camera);
    else {
      const hEl = document.getElementById('interact-hint');
      if (hEl) { hEl.style.display = 'none'; hEl.dataset.source = ''; }
      _hintActive = false;
    }

    updateDoors(gdt);
    updateNpcs(gdt);
    updateFlowers(gdt, camera);
    updateProjectiles(gdt);

    // Flower/torch previews — disabled in ALT mode
    const slotItem = alt ? null : getSlotItem(getSelectedSlot());
    const placementActive = !alt && isPlacementMode() && slotItem === 'flower';
    updateFlowerPreview(camera, placementActive);

    const torchActive = !alt && isPlacementMode() && slotItem === 'torch';
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
