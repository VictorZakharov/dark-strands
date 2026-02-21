import * as THREE from 'three';
import { CFG } from './config.js';
import { initScene, getRenderer, getScene, getCamera } from './core/scene.js';
import { initLighting } from './core/lighting.js';
import { initGrid } from './world/grid.js';
import { generateBuildings } from './world/generator.js';
import { buildGround, buildFloors, buildWalls, buildWindows, buildRoofs, buildWater, createWorldPhysicsBodies } from './world/geometry.js';
import { placeTrees, placeRocks, getNearestPickableRock } from './world/vegetation.js';
import { placeTorches, placeDoorTorches, getNearestPickableTorch, initHeldTorch, updateHeldTorch, initTorchPreview, updateTorchPreview, initTorchLightPool, initTorchEmbers, updateTorchEmbers, updateDoorTorchPositions } from './world/torches.js';
import { placeDoors, updateDoors, getNearestDoor, getDoorPanelCenter } from './world/doors.js';
import { placeFurniture, getNearestBed } from './world/furniture.js';
import { loadAllModels, getAnimMixers } from './entities/modelLoader.js';
import { initPlayer, updatePlayer, updatePlayerMovement, syncPlayerFromPhysics, getPlayerState, getPlayerBody } from './entities/player.js';
import { initPhysics, stepPhysics, createTerrainBody } from './core/physics.js';
import { initControls, isGameActive, getKeys, doInteract, doUseItem, getThrowCooldownFrac, isTimeStopped } from './systems/controls.js';
import { isTouchDevice, getTouchMove, consumeTouchLook, consumeJump, consumeInteract, consumeUse, consumeSlotTap, setMobileGameActive, updateTouchProgress } from './systems/touch.js';
import { updateDayNight, setCycleEnabled, setStartTime, getSunOffset, getSunH, isCycleEnabled } from './systems/daynight.js';
import { updateFPS, updateCameraMode, updateMinimap, updateInventory } from './systems/hud.js';
import { updateFlowers, getNearestFlower, initFlowerPreview, updateFlowerPreview } from './world/flowers.js';
import { getTerrainHeight } from './world/terrain.js';
import { initHotbar, getSelectedSlot, getSlotItem, isPlacementMode, isAltMode, selectSlot } from './systems/hotbar.js';
import { updateProjectiles, initRockPreview, updateRockPreview, getNearestInFlightRock, kickNearbyRock } from './systems/projectiles.js';
import { getSunLight, getSunGroup, getSunLensflare } from './core/lighting.js';
import { updateNpcs, updateSoldierHint, getNearestSoldier } from './systems/npcAI.js';
import { initMenuScene, renderMenu, disposeMenu } from './systems/menu.js';
import { initBoundaryShield, updateBoundaryShield } from './world/boundary.js';

const clock = new THREE.Clock();
let minimapTick = 0;
let menuMode = true;
let altBlend = 0; // 0 = normal, 1 = greyscale (ALT mode)
const _projHint = new THREE.Vector3();
let _hintSx = 0, _hintSy = 0, _hintActive = false;

// Cooldown ring canvas overlay (drawn at crosshair)
let cdCanvas = null, cdCtx = null;
function ensureCooldownCanvas() {
  if (cdCanvas) return;
  cdCanvas = document.createElement('canvas');
  cdCanvas.width = 40; cdCanvas.height = 40;
  cdCanvas.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:60;';
  document.body.appendChild(cdCanvas);
  cdCtx = cdCanvas.getContext('2d');
}

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

  const pre = isTouchDevice ? 'Hold to ' : '[E] ';

  const door = getNearestDoor();
  if (door) {
    const pc = getDoorPanelCenter(door);
    const doorY = door.group.position.y + CFG.WALL_H * 0.5;
    const action = door.open ? 'Close' : 'Open';
    tryCandidate(pc.x, doorY, pc.z, pre + action, '', 'door');
  }

  const soldier = getNearestSoldier();
  if (soldier) {
    const pos = soldier.model.position;
    tryCandidate(pos.x, pos.y + 1.0, pos.z, pre + 'Talk', '21px', 'soldier');
  }

  const flower = getNearestFlower();
  if (flower) {
    const ty = getTerrainHeight(flower.wx, flower.wz);
    tryCandidate(flower.wx, ty + 0.3, flower.wz, pre + 'Pick', '21px', 'flower');
  }

  const rock = getNearestPickableRock();
  if (rock) {
    tryCandidate(rock.x, rock.top + 0.3, rock.z, pre + 'Pick up', '21px', 'rock');
  }

  const flyRock = getNearestInFlightRock();
  if (flyRock) {
    tryCandidate(flyRock.body.position.x, flyRock.body.position.y + 0.3, flyRock.body.position.z, pre + 'Catch', '21px', 'rock');
  }

  const torch = getNearestPickableTorch();
  if (torch) {
    const torchHintY = torch.flame.position.y + 0.35;
    tryCandidate(torch.wx, torchHintY, torch.wz, pre + 'Take', '21px', 'torch');
  }

  const bed = getNearestBed(getPlayerState());
  if (bed) {
    const bedHintY = bed.y + 0.4; // Slightly above mattress
    if (isCycleEnabled()) {
      tryCandidate(bed.x, bedHintY, bed.z, pre + 'Sleep', '21px', 'bed');
    } else {
      tryCandidate(bed.x, bedHintY, bed.z, 'Enable Day/Night Cycle to Sleep', '14px', 'bed');
    }
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

// Global sleep state
let activeSleepTime = 0; // accumulated fast-forward time in hours
let targetSleepTime = 0; // total hours requested

window.addEventListener('sleep-requested', (e) => {
  console.log(`[SLEEP] main.js received sleep-requested for ${e.detail.hours} hours`);
  targetSleepTime = e.detail.hours;
  activeSleepTime = 0;
});

function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.1);

  const renderer = getRenderer();

  if (isGameActive()) {
    // First time entering game — leave menu mode
    if (menuMode) {
      menuMode = false;
      disposeMenu();
      const blocker = document.getElementById('blocker');
      if (blocker) { blocker.dataset.mode = 'game'; blocker.style.display = 'none'; }
      const loadingBar = document.getElementById('menu-loading');
      if (loadingBar) loadingBar.style.display = 'none';
      // Show HUD elements (hide keyboard hints on touch)
      const hudIds = isTouchDevice
        ? ['minimap-wrap', 'crosshair', 'hud-top-left']
        : ['hud-bottom', 'minimap-wrap', 'crosshair', 'hud-top-left'];
      for (const id of hudIds) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
      }
      const hotbar = document.getElementById('hotbar');
      if (hotbar) hotbar.style.display = 'flex';
    }

    const scene = getScene();
    const camera = getCamera();
    const keys = getKeys();
    const player = getPlayerState();

    // Touch input processing
    if (isTouchDevice) {
      const tm = getTouchMove();
      const DZ = 0.15;
      keys['KeyW'] = tm.z < -DZ;
      keys['KeyS'] = tm.z > DZ;
      keys['KeyA'] = tm.x < -DZ;
      keys['KeyD'] = tm.x > DZ;
      keys['Space'] = consumeJump();

      const tl = consumeTouchLook();
      player.yaw -= tl.dx;
      player.pitch -= tl.dy;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch));

      if (consumeInteract()) doInteract();
      if (consumeUse()) doUseItem();
      const tappedSlot = consumeSlotTap();
      if (tappedSlot >= 0) selectSlot(tappedSlot);
      updateTouchProgress();
    }

    // Q key = 3× game speed (time, movement, animations)
    // Sleep = 30x game speed until target time reached
    const alt = isAltMode();
    let speed = keys['KeyQ'] && !alt ? 3 : 1;

    // Check sleep state
    if (activeSleepTime < targetSleepTime) {
      speed = 30; // Very fast simulation
    }

    // Explicit override for the sleep menu 
    if (isTimeStopped()) {
      speed = 0;
    }

    const gdt = dt * speed;

    if (activeSleepTime < targetSleepTime) {
      // Accumulate the amount of actual game-world hours that have passed this frame
      activeSleepTime += (gdt / CFG.DAY_SEC) * 24;

      if (activeSleepTime >= targetSleepTime) {
        // Sleep finished
        console.log(`[SLEEP] Finished sleeping for ${targetSleepTime} hours.`);
        targetSleepTime = 0;
        activeSleepTime = 0;
      }
    }

    // In ALT mode: freeze player input but keep world ticking
    const emptyKeys = {};
    const activeKeys = alt || targetSleepTime > 0 ? emptyKeys : keys; // Lock out movement during sleep

    updatePlayerMovement(gdt, activeKeys);
    stepPhysics(gdt);
    syncPlayerFromPhysics();
    kickNearbyRock(scene);
    updatePlayer(gdt, camera, getSunLight(), activeKeys);
    updateDayNight(gdt, scene);

    // Greyscale transition or Sleep Darkening
    const isSleeping = targetSleepTime > 0;
    altBlend = Math.max(0, Math.min(1, altBlend + (alt ? 1 : -1) * Math.min(1, dt * 2))); // 0.5s transition
    const canvas = renderer.domElement;

    if (isSleeping) {
      canvas.style.filter = 'brightness(0.3) blur(0.5px)'; // Reduced blur
    } else {
      canvas.style.filter = altBlend > 0.001 ? `saturate(${1 - altBlend * 0.85})` : '';
    }

    // Crosshair visibility
    const chEl = document.getElementById('crosshair');
    if (chEl) chEl.style.opacity = alt ? '0' : '';

    // Cooldown ring at crosshair
    ensureCooldownCanvas();
    const cdFrac = getThrowCooldownFrac();
    if (cdFrac > 0) {
      cdCanvas.style.display = '';
      cdCtx.clearRect(0, 0, 40, 40);
      cdCtx.beginPath();
      cdCtx.arc(20, 20, 16, -Math.PI / 2, -Math.PI / 2 + cdFrac * Math.PI * 2);
      cdCtx.strokeStyle = 'rgba(255,200,100,0.7)';
      cdCtx.lineWidth = 2.5;
      cdCtx.stroke();
    } else if (cdCanvas) {
      cdCanvas.style.display = 'none';
    }

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
    updateDoorTorchPositions();
    updateNpcs(gdt);
    updateFlowers(gdt, camera);
    updateProjectiles(gdt);
    updateBoundaryShield(gdt);

    // Flower/torch previews — disabled in ALT mode
    const slotItem = alt ? null : getSlotItem(getSelectedSlot());
    const placementActive = !alt && isPlacementMode() && slotItem === 'flower';
    updateFlowerPreview(camera, placementActive);

    const torchActive = !alt && isPlacementMode() && slotItem === 'torch';
    updateHeldTorch(camera, torchActive, getPlayerState());
    updateTorchPreview(camera, torchActive);
    updateTorchEmbers(gdt);

    const rockPlaceActive = !alt && isPlacementMode() && slotItem === 'stone';
    updateRockPreview(camera, rockPlaceActive);

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
  if (fill) fill.style.transform = `scaleX(${pct / 100})`;
}

// Yield to browser so progress bar can repaint
const yieldFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function buildWorld() {
  const scene = getScene();
  const step = (pct) => setLoadProgress(pct);

  // Batch 1: World structure (0→3%)
  await yieldFrame();
  initPhysics();
  initLighting(scene);
  initGrid();
  generateBuildings();
  buildGround(scene);
  buildFloors(scene);
  step(3);

  // Batch 2a: Visual world (3→4%)
  await yieldFrame();
  buildWalls(scene);
  buildRoofs(scene);
  placeTrees(scene);
  placeRocks(scene);
  placeTorches(scene);
  placeDoors(scene);
  placeDoorTorches(scene);
  placeFurniture(scene);
  buildWindows(scene);
  buildWater(scene);
  step(4);

  // Batch 2b: Physics bodies (4→5%)
  await yieldFrame();
  createTerrainBody();
  createWorldPhysicsBodies();
  initBoundaryShield(scene);
  step(5);

  // Batch 3: Player + controls (5→6%)
  await yieldFrame();
  initPlayer(scene);
  const pb = getPlayerBody();
  for (let i = 0; i < 5; i++) {
    if (pb) pb.velocity.y = 0; // Prevent gravity buildup before game starts
    stepPhysics(0.016);
  }
  syncPlayerFromPhysics();
  initControls();
  initHotbar();
  step(6);

  // Wire up day/night toggle
  const dnCheckbox = document.getElementById('daynight-checkbox');
  if (dnCheckbox) {
    setCycleEnabled(dnCheckbox.checked);
    dnCheckbox.addEventListener('change', () => setCycleEnabled(dnCheckbox.checked));
  }
  updateDayNight(0, scene);

  // Batch 4: Models (6→14%)
  await yieldFrame();
  await loadAllModels(scene);
  step(14);

  // Batch 5: Previews + shader compile (14→18%)
  await yieldFrame();
  initFlowerPreview(scene);
  initHeldTorch(scene);
  initTorchLightPool(scene);
  initTorchPreview(scene);
  initTorchEmbers(scene);
  initRockPreview(scene);
  const hiddenMeshes = [];
  scene.traverse(c => { if (!c.visible && c.isMesh) { c.visible = true; hiddenMeshes.push(c); } });
  getRenderer().compile(scene, getCamera());
  step(18);

  // GPU render (18→100%) — blocks main thread
  await yieldFrame();
  getRenderer().render(scene, getCamera());
  for (const m of hiddenMeshes) m.visible = false;

  // Animate bar to 100% and let user see it before entering game
  const fill = document.getElementById('menu-load-fill');
  if (fill) {
    fill.style.transition = 'transform 0.35s ease-out';
    fill.style.transform = 'scaleX(1)';
  }
  step(100);
  await new Promise(r => setTimeout(r, 400));
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
      fill.style.transform = 'scaleX(0)';
    }

    // Build the world (progress bar updates during build via yieldFrame)
    await buildWorld();

    // World ready — enter game
    if (loadText) loadText.textContent = 'Entering world...';
    await yieldFrame();

    if (isTouchDevice) {
      setMobileGameActive(true);
    } else {
      const p = getRenderer().domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => { });
    }
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
