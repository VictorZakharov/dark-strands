import { Vector3, Matrix, MeshBuilder, StandardMaterial, Color3, SceneInstrumentation } from 'babylonjs';
import { CFG } from './config.js';
import { initScene, initRenderer, getRenderer, getScene, getCamera, getEngine } from './core/scene.js';
import { initLighting } from './core/lighting.js';
import { initGrid } from './world/grid.js';
import { generateBuildings } from './world/generator.js';
import { buildGround, buildWater, getWaterMaterial } from './world/terrainMeshes.js';
import { buildFloors, getMergedFloors, getMergedMidFloors, getMergedStairs } from './world/floors.js';
import { buildWalls, buildRoofs, getWallMesh } from './world/walls.js';
import { buildWindows } from './world/windows.js';
import { createWorldPhysicsBodies } from './world/staticPhysics.js';
import { placeTrees, placeRocks, getNearestPickableRock } from './world/vegetation.js';
import { placeTorches, placeDoorTorches, getNearestPickableTorch, initHeldTorch, updateHeldTorch, initTorchPreview, updateTorchPreview, initTorchLightPool, initTorchEmbers, updateTorchEmbers, updateDoorTorchPositions, addTorchShadowCaster, prewarmHeldTorch, hideHeldTorch, getTorchShadowGenerators } from './world/torches.js';
import { placeDoors, updateDoors, getNearestDoor, getDoorPanelCenter } from './world/doors.js';
import { placeFurniture, getNearestBed } from './world/furniture.js';
import { loadAllModels, getAnimMixers } from './entities/modelLoader.js';
import { initPlayer, updatePlayer, updatePlayerMovement, syncPlayerFromPhysics, getPlayerState, getPlayerBody } from './entities/player.js';
import { initPhysics, stepPhysics, createTerrainBody } from './core/physics.js';
import { initControls, isGameActive, setGameStarted, getKeys, doInteract, doUseItem, getThrowCooldownFrac, isTimeStopped } from './systems/controls.js';
import { isTouchDevice, getTouchMove, consumeTouchLook, consumeJump, consumeInteract, consumeUse, consumeSlotTap, setMobileGameActive, updateTouchProgress } from './systems/touch.js';
import { updateDayNight, setCycleEnabled, setStartTime, getSunOffset, getSunH, isCycleEnabled, getSkyColor } from './systems/daynight.js';
import { updateFPS, updateCameraMode, updateMinimap, updateInventory } from './systems/hud.js';
import { updateFlowers, getNearestFlower, initFlowerPreview, updateFlowerPreview } from './world/flowers.js';
import { getTerrainHeight } from './world/terrain.js';
import { initHotbar, getSelectedSlot, getSlotItem, isPlacementMode, isAltMode, selectSlot } from './systems/hotbar.js';
import { updateProjectiles, initRockPreview, updateRockPreview, getNearestInFlightRock, kickNearbyRock } from './systems/projectiles.js';
import { getSunLight, getSunGroup, getSunLensflare, updateSunShadow, addShadowCaster, enableShadowReceiving } from './core/lighting.js';
import { updateNpcs, updateSoldierHint, getNearestSoldier } from './systems/npcAI.js';
import { initMenuScene, renderMenu, disposeMenu } from './systems/menu.js';
import { initBoundaryShield, updateBoundaryShield } from './world/boundary.js';
import { initPostFX, updatePostFX, setDepthRenderList } from './core/postfx.js';
import { initSkyDome, updateSkyDome } from './core/skyDome.js';
import { initWeather, updateWeather, getWeatherModifiers } from './systems/weather.js';
import { initRainFX, updateRainFX, prewarmRainFX, resetRainFX, pauseRainFX } from './systems/rainFX.js';
import { setSunGlowFade } from './core/lighting.js';

// Delta time via performance.now() (replaces THREE.Clock)
let _lastTime = 0;
function getDelta(time) {
  if (_lastTime === 0) { _lastTime = time; return 0; }
  const dt = (time - _lastTime) / 1000;
  _lastTime = time;
  return Math.min(dt, 0.1);
}

let minimapTick = 0;
let _waterTime = 0;
let menuMode = true;
let pendingMenuDispose = 0; // countdown frames before disposal (0 = none)
let altBlend = 0;
const _projVec = new Vector3();
let _hintSx = 0, _hintSy = 0, _hintActive = false;

// Cooldown ring canvas overlay
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
 * Project world position to screen coordinates (Babylon.js).
 * Returns { x, y, behind } where behind=true if behind camera.
 */
function projectToScreen(wx, wy, wz) {
  const scene = getScene();
  const camera = getCamera();
  // Use CSS pixel dimensions (not render pixels) so the result matches
  // DOM element positioning with el.style.left/top.
  const vp = camera.viewport.toGlobal(window.innerWidth, window.innerHeight);
  const projected = Vector3.Project(
    new Vector3(wx, wy, wz),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    vp
  );
  // z > 1 means behind camera
  return { x: projected.x, y: projected.y, behind: projected.z > 1 };
}

function updateInteractHint(camera) {
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

  const playerY = getPlayerState().y;

  function tryCandidate(wx, wy, wz, text, fontSize, source) {
    if (wy < playerY - 1.5) return;
    const p = projectToScreen(wx, wy, wz);
    if (p.behind) return;
    const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
    if (dist < bestDist) {
      bestDist = dist;
      bestText = text;
      bestSize = fontSize;
      bestSx = p.x;
      bestSy = p.y;
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
    const pos = torch.flame.getAbsolutePosition();
    tryCandidate(pos.x, pos.y + 0.35, pos.z, pre + 'Take', '21px', 'torch');
  }

  const bed = getNearestBed(getPlayerState());
  if (bed) {
    const bedHintY = bed.y + 0.4;
    if (isCycleEnabled()) {
      tryCandidate(bed.x, bedHintY, bed.z, pre + 'Sleep', '21px', 'bed');
    } else {
      tryCandidate(bed.x, bedHintY, bed.z, 'Enable Day/Night Cycle to Sleep', '14px', 'bed');
    }
  }

  if (bestSource) {
    const margin = 40;
    const maxY = window.innerHeight - 110;
    let targetX = Math.max(margin, Math.min(window.innerWidth - margin, bestSx));
    let targetY = bestSy;
    if (targetY > maxY) targetY = (cy + maxY) / 2;
    targetY = Math.max(margin, targetY);

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
let activeSleepTime = 0;
let targetSleepTime = 0;

window.addEventListener('sleep-requested', (e) => {
  console.log(`[SLEEP] main.js received sleep-requested for ${e.detail.hours} hours`);
  targetSleepTime = e.detail.hours;
  activeSleepTime = 0;
});

function gameLoop(time) {
  requestAnimationFrame(gameLoop);
  const engine = getEngine();

  // Deferred menu disposal — wait 3 frames after last menu render so all
  // in-flight WebGPU command buffers finish before textures are destroyed.
  if (pendingMenuDispose > 0) {
    pendingMenuDispose--;
    if (pendingMenuDispose === 0) disposeMenu();
  }

  engine.beginFrame();
  const dt = getDelta(time);

  if (isGameActive()) {
    if (menuMode) {
      menuMode = false;
      pendingMenuDispose = 10; // wait extra frames for WebGPU command buffers to fully drain
      const blocker = document.getElementById('blocker');
      if (blocker) { blocker.dataset.mode = 'game'; blocker.style.display = 'none'; }
      const loadingBar = document.getElementById('menu-loading');
      if (loadingBar) loadingBar.style.display = 'none';
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

    const alt = isAltMode();
    let speed = keys['KeyQ'] && !alt ? 3 : 1;

    if (activeSleepTime < targetSleepTime) speed = 30;
    if (isTimeStopped()) speed = 0;

    const gdt = dt * speed;

    if (activeSleepTime < targetSleepTime) {
      activeSleepTime += (gdt / CFG.DAY_SEC) * 24;
      if (activeSleepTime >= targetSleepTime) {
        console.log(`[SLEEP] Finished sleeping for ${targetSleepTime} hours.`);
        targetSleepTime = 0;
        activeSleepTime = 0;
      }
    }

    const emptyKeys = {};
    const activeKeys = alt || targetSleepTime > 0 ? emptyKeys : keys;

    updatePlayerMovement(gdt, activeKeys);
    stepPhysics(gdt);
    syncPlayerFromPhysics();
    kickNearbyRock(scene);
    updatePlayer(gdt, camera, getSunLight(), activeKeys);
    updateWeather(gdt); // before daynight — it consumes the weather modifiers
    updateDayNight(gdt, scene);
    updatePostFX();
    updateRainFX(gdt, player, speed);

    // Update sun light direction from day/night offset and shadow camera position
    const _sl = getSunLight();
    if (_sl) {
      const off = getSunOffset();
      const offLen = Math.sqrt(off.x * off.x + off.y * off.y + off.z * off.z) || 1;
      // Direction = from sun toward scene (negate the offset)
      _sl.direction.set(-off.x / offLen, -off.y / offLen, -off.z / offLen);
      // Center shadow frustum on the player
      updateSunShadow(player.x, player.y, player.z);
    }

    // Sky dome after the sun direction update so its sun position is current
    updateSkyDome(gdt);

    // Update ocean water shader uniforms
    const _wm = getWaterMaterial();
    if (_wm) {
      _waterTime += gdt;
      _wm.setFloat('uTime', _waterTime);
      _wm.setVector3('uCameraPos', camera.position);
      if (_sl) {
        _wm.setVector3('uSunDir', _sl.direction);
        _wm.setColor3('uSunColor', _sl.diffuse);
      }
      _wm.setColor3('uSkyColor', getSkyColor());
      _wm.setColor3('uFogColor', scene.fogColor);
      _wm.setFloat('uFogStart', scene.fogStart);
      _wm.setFloat('uFogEnd', scene.fogEnd);
    }

    // Greyscale transition or Sleep Darkening
    const isSleeping = targetSleepTime > 0;
    const canvas = getEngine().getRenderingCanvas();
    altBlend = Math.max(0, Math.min(1, altBlend + (alt ? 1 : -1) * Math.min(1, dt * 2)));

    if (isSleeping) {
      canvas.style.filter = 'brightness(0.3) blur(0.5px)';
    } else {
      canvas.style.filter = altBlend > 0.001 ? `saturate(${1 - altBlend * 0.85})` : '';
    }

    const chEl = document.getElementById('crosshair');
    if (chEl) chEl.style.opacity = alt ? '0' : '';

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

    // Sun visual + lens flare follow player
    const sunH = getSunH();
    const sg = getSunGroup();
    const lf = getSunLensflare();
    if (sg) {
      if (sunH > 0) {
        sg.setEnabled(true);
        const off = getSunOffset();
        const len = Math.sqrt(off.x * off.x + off.y * off.y + off.z * off.z);
        const R = 170;
        const p = getPlayerState();
        sg.position = new Vector3(
          p.x + off.x / len * R,
          off.y / len * R,
          p.z + off.z / len * R
        );
        // Cloud cover hides the sun disc and kills the lens flare
        const cover = getWeatherModifiers().cloudCover;
        setSunGlowFade(Math.max(0, 1 - cover * 1.2));
        if (lf) lf.isEnabled = cover < 0.4;
        // LensFlareSystem follows its emitter (sunGroup) automatically
      } else {
        sg.setEnabled(false);
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

    scene.render();

    updateFPS(time);
    updateCameraMode();
    updateInventory();

    minimapTick++;
    if (minimapTick % 10 === 0) updateMinimap();

  } else if (menuMode) {
    renderMenu(engine, dt);
  } else {
    // Paused: particles still animate during render — freeze rain emission
    // and drop queued splash impacts so resume doesn't burst
    pauseRainFX();
    getScene().render();
  }
  engine.endFrame();
}

function setLoadProgress(pct) {
  const fill = document.getElementById('menu-load-fill');
  if (fill) fill.style.transform = `scaleX(${pct / 100})`;
}

const yieldFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

async function buildWorld() {
  const scene = getScene();
  const step = (pct) => setLoadProgress(pct);

  await yieldFrame();
  await initPhysics();
  initLighting(scene);
  // Post-FX before world build: materials created after this compile once with
  // applyByPostProcess/prepass defines; GlowLayer exists before torches spawn.
  initPostFX(scene, getCamera());
  initSkyDome(scene);
  initWeather();

  // Skip Babylon's per-frame pointer-move picking — we use our own raycasting
  scene.skipPointerMovePicking = true;
  scene.pointerMovePredicate = () => false;

  initGrid();
  generateBuildings();
  buildGround(scene);
  buildFloors(scene);
  step(3);

  await yieldFrame();
  buildWalls(scene);
  buildRoofs(scene);
  placeTrees(scene);
  placeRocks(scene);
  initTorchLightPool(scene); // must precede placeTorches — creates clustered container
  // Register floor meshes as torch shadow casters (blocks light between floors)
  const wallMesh = getWallMesh();
  if (wallMesh) addTorchShadowCaster(wallMesh);
  const floorMesh = getMergedFloors();
  if (floorMesh) addTorchShadowCaster(floorMesh);
  const midFloorMesh = getMergedMidFloors();
  if (midFloorMesh) addTorchShadowCaster(midFloorMesh);
  const stairMesh = getMergedStairs();
  if (stairMesh) addTorchShadowCaster(stairMesh);
  placeTorches(scene);
  placeDoors(scene);
  placeDoorTorches(scene);
  placeFurniture(scene);
  buildWindows(scene);
  buildWater(scene);
  initRainFX(scene); // needs the building grid marks + terrain
  setDepthRenderList(scene); // fog depth pass: big merged meshes only
  step(4);

  await yieldFrame();
  createTerrainBody();
  createWorldPhysicsBodies();
  initBoundaryShield(scene);
  step(5);

  await yieldFrame();
  initPlayer(scene);
  const pb = getPlayerBody();
  for (let i = 0; i < 5; i++) {
    if (pb) pb.velocity.y = 0;
    stepPhysics(0.016);
  }
  syncPlayerFromPhysics();
  initControls();
  initHotbar();
  step(6);

  const dnCheckbox = document.getElementById('daynight-checkbox');
  if (dnCheckbox) {
    setCycleEnabled(dnCheckbox.checked);
    dnCheckbox.addEventListener('change', () => setCycleEnabled(dnCheckbox.checked));
  }
  updateDayNight(0, scene);

  await yieldFrame();
  await loadAllModels(scene);
  step(14);

  await yieldFrame();
  initFlowerPreview(scene);
  initHeldTorch(scene);
  initTorchPreview(scene);
  initTorchEmbers(scene);
  initRockPreview(scene);
  step(18);

  // Allow up to 8 simultaneous lights per material.
  // PBRMaterial defaults to 4, which is too few — with 20+ torch PointLights
  // the directional sun light gets excluded from merged meshes (huge bounding boxes),
  // which breaks CSM shadow receiving. 8 keeps the sun/hemi in the budget.
  for (const mat of scene.materials) {
    if (mat.maxSimultaneousLights !== undefined) {
      mat.maxSimultaneousLights = 8;
    }
    // Keep rendering with old shader while new one compiles — prevents
    // world flicker when torch PointLights are enabled/disabled during gameplay.
    mat.allowShaderHotSwapping = true;
  }

  scene.shadowsEnabled = true;
  const _sunLight = getSunLight();
  if (_sunLight) _sunLight.shadowEnabled = true;

  await yieldFrame();
  // Pre-warm held torch so WebGPU compiles the pipeline during loading (not on first equip)
  const ps = getPlayerState();
  prewarmHeldTorch(ps);
  scene.render(); // first render — all lights active, WebGPU pipelines compile once
  hideHeldTorch(); // park held torch far away after pipeline is warm

  // Freeze world matrices on static meshes — saves CPU per frame by skipping
  // matrix recalculation and bounding info updates for geometry that never moves.
  // NOTE: Do NOT freeze materials — frozen materials skip BindLights() which
  // breaks shadow receiving.
  // Freeze world matrices on static meshes — saves per-frame matrix recalculation.
  const staticMeshNames = new Set([
    'ground', 'walls', 'mergedFloors', 'mergedStairs',
    'flatRoofs', 'slantRoofs', 'windowFrames', 'windowGlass',
    'mergedTrunks', 'mergedCanopy', 'mergedRocks',
  ]);
  let frozenCount = 0;
  for (const mesh of scene.meshes) {
    if (staticMeshNames.has(mesh.name)) {
      mesh.freezeWorldMatrix();
      frozenCount++;
    }
  }
  // Log shadow caster counts for draw call analysis
  const sunSG = getSunLight()?.getShadowGenerator?.();
  const sunCasters = sunSG?.getShadowMap?.()?.renderList?.length ?? '?';
  const torchSGs = getTorchShadowGenerators();
  const torchCasters = torchSGs[0]?.getShadowMap?.()?.renderList?.length ?? '?';
  console.log(`Scene: ${scene.meshes.length} meshes, ${frozenCount} frozen, ${scene.lights.length} lights, ${scene.materials.length} materials, sunShadowCasters:${sunCasters}, torchShadowCasters:${torchCasters}`);

  // Performance instrumentation — log breakdown every 5s to find bottleneck
  const _instr = new SceneInstrumentation(scene);
  _instr.captureFrameTime = true;
  _instr.captureRenderTime = true;
  _instr.captureActiveMeshesEvaluationTime = true;
  _instr.captureRenderTargetsRenderTime = true;
  setInterval(() => {
    const e = getEngine();
    const ft = _instr.frameTimeCounter.lastSecAverage.toFixed(1);
    const rt = _instr.renderTimeCounter.lastSecAverage.toFixed(1);
    const am = _instr.activeMeshesEvaluationTimeCounter.lastSecAverage.toFixed(1);
    const shadow = _instr.renderTargetsRenderTimeCounter.lastSecAverage.toFixed(1);
    const draws = e._drawCalls?.current ?? '?';
    console.log(`[PERF] frame:${ft}ms render:${rt}ms activeMesh:${am}ms shadows:${shadow}ms draws:${draws}`);
  }, 5000);

  // Dev/debug console API (also used by automated visual verification)
  window._dbg = {
    setTime: (h) => setStartTime((h % 24) / 24),
    look: (yaw, pitch) => {
      const p = getPlayerState();
      p.yaw = yaw;
      if (pitch !== undefined) p.pitch = pitch;
    },
    tp: (x, z, y) => {
      const body = getPlayerBody();
      if (body && body.transformNode) {
        const ty = y !== undefined ? y : getTerrainHeight(x, z) + 2;
        body.transformNode.position.set(x, ty, z);
      }
    },
    pos: () => {
      const p = getPlayerState();
      return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
    },
    scene: () => getScene(),
  };

  const fill = document.getElementById('menu-load-fill');
  if (fill) {
    fill.style.transition = 'transform 0.35s ease-out';
    fill.style.transform = 'scaleX(1)';
  }
  step(100);

  // WARM-UP RENDERING: Render multiple frames while covered to ensure
  // WebGPU pipelines are fully compiled and the viewport is stable.
  // This prevents the "cyan screen" or "NPCs in air" flash.
  prewarmRainFX(); // compile rain/splash pipelines behind the loading screen
  for (let i = 0; i < 5; i++) {
    scene.render();
    await yieldFrame();
  }
  resetRainFX(); // clear warm-up particles, restore emitRate-driven emission

  await new Promise(r => setTimeout(r, 200));
}

function setupPlayButton() {
  const playBtn = document.getElementById('menu-play');
  if (!playBtn) return;

  let building = false;
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (building) return; // guard against double-click
    building = true;

    const snowCheckbox = document.getElementById('snow-checkbox');
    CFG.SNOW_MODE = snowCheckbox ? snowCheckbox.checked : false;
    if (CFG.SNOW_MODE) setStartTime(10 / 24);

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

    try {
      await buildWorld();
    } catch (err) {
      console.error('[BUILD] World build failed:', err);
      // buildWorld is not re-entrant (post-FX chain, shadow slots, particle
      // systems and physics bodies would all stack on retry) — reload for a
      // clean engine state instead of restoring the menu. `building` stays
      // true so a second click during the delay is ignored.
      if (loadText) loadText.textContent = 'World build failed — reloading...';
      setTimeout(() => location.reload(), 1500);
      return;
    }

    const blocker = document.getElementById('blocker');
    if (isTouchDevice) {
      if (blocker) blocker.style.display = 'none';
      setMobileGameActive(true);
    } else {
      // Mark game as started so the game loop activates immediately
      setGameStarted(true);
      if (blocker) {
        blocker.dataset.mode = 'game';
        blocker.style.display = 'none';
      }
      // Try to acquire pointer lock (may fail if gesture expired during async build)
      // If it fails, game still runs — clicking the canvas will lock via tryRelock
      const canvas = getEngine().getRenderingCanvas();
      try { await canvas.requestPointerLock(); } catch { }
    }

    // Final fade out of the heavy loading screen
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => {
        loading.style.display = 'none';
      }, 800);
    }
  });
}

async function init() {
  await initScene();
  await initRenderer();
  window._cfg = CFG; // console access for debugging/A-B testing GFX flags
  window._engine = getEngine();

  initMenuScene();

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';

  requestAnimationFrame(gameLoop);

  setupPlayButton();

  await new Promise(r => setTimeout(r, 300));
  const panel = document.getElementById('menu-panel');
  if (panel) panel.style.display = 'flex';
}

init();
