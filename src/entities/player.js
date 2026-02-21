import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CFG } from '../config.js';
import { createPlayerBody, getPhysicsWorld } from '../core/physics.js';
import { getScene } from '../core/scene.js';
import { isRightMouseDown } from '../systems/controls.js';
import { getSunOffset } from '../systems/daynight.js';
import { getNpcCollision } from '../systems/npcAI.js';
import { getTerrainHeight } from '../world/terrain.js';
import { spawnBoundaryHit } from '../world/boundary.js';

let playerModel;
let mixer, idleAction, walkAction, runAction;
let currentAction;
let modelReady = false;
let facingAngle = Math.PI;
const camRay = new THREE.Raycaster();
camRay.layers.set(0); // Only test layer 0 (skip sky objects on layer 2)

// Camera blend: 0 = first person, 1 = third person
let camBlend = 1;          // Start at 3rd person
let camBlendTarget = 0;    // Animate to 1st person on game start
let camTransT = 0;         // Transition elapsed time
const CAM_TRANS_DUR = 1.0; // 1 second transition
let convergenceDist = 30;  // crosshair convergence distance (set on V toggle)

// 3→1 world-space crosshair tracking
const _crosshairTarget = new THREE.Vector3();
const _targetLocal = new THREE.Vector3(); // target in player-local coords (right, up, fwd)
let _trackWorldTarget = false; // true during 3→1 transition

// Zoom state
const BASE_FOV = 75;
const ZOOM_FOV = 25; // 3x zoom
const ZOOM_DUR = 0.5;
let zoomT = 0; // 0 = no zoom, 1 = fully zoomed

// Pre-allocated temporaries for camera blending
const _fpPos = new THREE.Vector3();
const _tpPos = new THREE.Vector3();
const _blendedLookAt = new THREE.Vector3();
const _probeTarget = new THREE.Vector3();
const _probeDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _lastCamPos = new THREE.Vector3();
const _lastCamFwd = new THREE.Vector3(0, 0, -1);
const _toHit = new THREE.Vector3();


const state = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  velY: 0,
  firstPerson: true,
};

let playerBody = null;
let _moving = false, _sprinting = false;
let _boundaryShieldCD = 0; // frame cooldown for boundary shield spawns
let _frozenY = null; // locked Y when standing still to eliminate terrain jitter

export function getPlayerState() { return state; }
export function getPlayerModel() { return playerModel; }
export function getCamBlend() { return camBlend; } // 0 = fully 1st person, 1 = fully 3rd person

export function getPlayerBody() { return playerBody; }

export function initPlayer(scene) {
  playerModel = new THREE.Group();
  playerModel.visible = false;
  scene.add(playerModel);

  // Create physics capsule body at spawn position (exactly on terrain surface)
  const spawnY = getTerrainHeight(state.x, state.z);
  state.y = spawnY;
  playerBody = createPlayerBody(state.x, spawnY, state.z);

  // Load soldier model for the player
  const loader = new GLTFLoader();
  loader.load('./assets/models/Soldier.glb', (gltf) => {
    const model = gltf.scene;

    // Scale to match NPC soldiers
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    model.scale.multiplyScalar(0.6 / maxDim);

    model.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
        c.frustumCulled = false;
        c.material = c.material.clone();
        c.material.color.multiply(new THREE.Color(0.5, 0.55, 1.0));
      }
    });

    playerModel.add(model);

    // Put player model on layer 1 only — camera toggles layer 1 for FP/TP visibility
    // Shadow map still renders it regardless of camera layers
    playerModel.traverse(obj => obj.layers.set(1));

    // Set up animations
    mixer = new THREE.AnimationMixer(model);
    const clips = gltf.animations;

    const idleClip = clips.find(c => /idle/i.test(c.name)) || clips[0];
    const walkClip = clips.find(c => /walk/i.test(c.name)) || clips[1] || idleClip;
    const runClip = clips.find(c => /run/i.test(c.name)) || clips[2] || walkClip;

    idleAction = mixer.clipAction(idleClip);
    walkAction = mixer.clipAction(walkClip);
    runAction = mixer.clipAction(runClip);

    walkAction.timeScale = 0.9;
    runAction.timeScale = 1.0;

    idleAction.play();
    currentAction = idleAction;
    modelReady = true;

    console.log('Player model loaded');
  });
}

function crossfade(from, to, duration = 0.2) {
  if (from === to) return;
  to.reset().setEffectiveWeight(1).fadeIn(duration).play();
  from.fadeOut(duration);
  currentAction = to;
}

export function toggleCamera() {
  // If toggling mid-3→1 transition, preserve current camera direction
  if (_trackWorldTarget) {
    state.yaw = Math.atan2(-_lastCamFwd.x, -_lastCamFwd.z);
    state.pitch = Math.asin(Math.max(-1, Math.min(1, _lastCamFwd.y)));
    _trackWorldTarget = false;
  }

  state.firstPerson = !state.firstPerson;
  camBlendTarget = state.firstPerson ? 0 : 1;
  // Start transition from current blend position (no jerk on rapid toggle)
  const progress = camBlendTarget === 1 ? camBlend : 1 - camBlend;
  camTransT = inverseSmoothstep(progress) * CAM_TRANS_DUR;

  const fpEye = new THREE.Vector3(state.x, state.y + CFG.PLAYER_H, state.z);
  const fpFwd = new THREE.Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();

  if (state.firstPerson) {
    // 3→1: raycast from TP camera to find what crosshair is actually on
    camRay.set(_lastCamPos, _lastCamFwd);
    camRay.far = 200;
    camRay.near = 0;
    const scene = getScene();
    const hits = camRay.intersectObjects(scene.children, true);

    let found = false;
    for (const hit of hits) {
      let isPlayer = false;
      let obj = hit.object;
      while (obj) { if (obj === playerModel) { isPlayer = true; break; } obj = obj.parent; }
      if (isPlayer) continue;
      if (hit.object.userData && hit.object.userData.isGround) continue;
      _crosshairTarget.copy(hit.point);
      found = true;
      break;
    }
    if (!found) {
      // No geometry hit — use far point along camera direction
      _crosshairTarget.copy(_lastCamPos).addScaledVector(_lastCamFwd, 100);
    }
    _trackWorldTarget = true;

    // convergenceDist for after the transition ends
    _toHit.subVectors(_crosshairTarget, fpEye);
    convergenceDist = Math.max(15, _toHit.dot(fpFwd));

    // Decompose target offset into player-local (right, up, fwd) coords
    // so mouse rotation during transition moves the target naturally.
    const localRight = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const localUp = new THREE.Vector3().crossVectors(localRight, fpFwd).normalize();
    _targetLocal.set(_toHit.dot(localRight), _toHit.dot(localUp), _toHit.dot(fpFwd));
  } else {
    // 1→3: raycast from actual camera to find convergence distance
    _trackWorldTarget = false;
    camRay.set(_lastCamPos, _lastCamFwd);
    camRay.far = 200;
    camRay.near = 0;
    const scene = getScene();
    const hits = camRay.intersectObjects(scene.children, true);

    convergenceDist = 30;
    for (const hit of hits) {
      let isPlayer = false;
      let obj = hit.object;
      while (obj) { if (obj === playerModel) { isPlayer = true; break; } obj = obj.parent; }
      if (isPlayer) continue;
      if (hit.object.userData && hit.object.userData.isGround) continue;
      _toHit.subVectors(hit.point, fpEye);
      convergenceDist = Math.max(15, _toHit.dot(fpFwd));
      break;
    }
  }
}

function inverseSmoothstep(y) {
  // Solve 3x² - 2x³ = y for x ∈ [0,1] via Newton-Raphson
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  let x = y;
  for (let i = 0; i < 5; i++) {
    const f = x * x * (3 - 2 * x) - y;
    const fp = 6 * x * (1 - x);
    if (Math.abs(fp) < 1e-10) break;
    x -= f / fp;
    x = Math.max(0, Math.min(1, x));
  }
  return x;
}

// --- Physics-based movement ---

const _rayFrom = new CANNON.Vec3();
const _rayTo = new CANNON.Vec3();
const _rayResult = new CANNON.RaycastResult();

function isPlayerGrounded() {
  if (!playerBody) return true;
  const world = getPhysicsWorld();
  // Cast ray from inside bottom sphere down past capsule bottom
  _rayFrom.set(playerBody.position.x, playerBody.position.y + 0.3, playerBody.position.z);
  _rayTo.set(playerBody.position.x, playerBody.position.y - 0.15, playerBody.position.z);
  _rayResult.reset();
  // collisionFilterMask ~2 excludes player body (group 2)
  world.raycastClosest(_rayFrom, _rayTo, { collisionFilterMask: ~2 }, _rayResult);
  return _rayResult.hasHit;
}

/** Called BEFORE physics step — sets body velocity from input */
export function updatePlayerMovement(dt, keys) {
  if (!playerBody) return;

  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  _sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const underwater = !CFG.SNOW_MODE && (state.y + CFG.PLAYER_H) < CFG.WATER_Y;
  const spdMul = underwater ? 0.4 : 1;
  const spd = (_sprinting ? CFG.SPRINT : CFG.SPEED) * spdMul;
  const mv = new THREE.Vector3();

  if (keys['KeyW']) mv.add(fwd);
  if (keys['KeyS']) mv.sub(fwd);
  if (keys['KeyA']) mv.sub(right);
  if (keys['KeyD']) mv.add(right);

  _moving = mv.lengthSq() > 0;

  if (_moving) {
    mv.normalize();

    // Smooth facing rotation
    const targetAngle = Math.atan2(mv.x, mv.z);
    let diff = targetAngle - facingAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    facingAngle += diff * Math.min(1, dt * 12);

    playerBody.velocity.x = mv.x * spd;
    playerBody.velocity.z = mv.z * spd;
  } else {
    playerBody.velocity.x = 0;
    playerBody.velocity.z = 0;
  }

  // Ground check (used for jump and slope anti-slide)
  const grounded = isPlayerGrounded();

  // Prevent sliding on slopes when not moving — freeze position
  // IMPORTANT: Only freeze if we are actually grounded, otherwise we hang in mid-air on spawn!
  if (!_moving && grounded && !keys['Space'] && playerBody.velocity.y <= 0.1) {
    playerBody.velocity.set(0, 0, 0);
    playerBody.applyForce(new CANNON.Vec3(0, playerBody.mass * CFG.GRAV, 0));
    // Lock Y position to eliminate terrain contact jitter
    if (_frozenY === null) _frozenY = playerBody.position.y;
  } else {
    _frozenY = null;
  }

  // Damp small terrain-contact bounces when walking on ground
  if (_moving && grounded && playerBody.velocity.y > 0 && playerBody.velocity.y < 1.5) {
    playerBody.velocity.y = 0;
  }

  // Jump
  if (keys['Space'] && grounded) {
    playerBody.velocity.y = underwater ? CFG.JUMP * 0.5 : CFG.JUMP;
  }

  // Underwater: counteract 70% of gravity
  if (underwater) {
    playerBody.applyForce(new CANNON.Vec3(0, playerBody.mass * CFG.GRAV * 0.7, 0));
  }

  playerBody.wakeUp();
}

/** Called AFTER physics step — reads body position back into state */
export function syncPlayerFromPhysics() {
  if (!playerBody) return;

  state.x = playerBody.position.x;
  state.y = playerBody.position.y;
  state.z = playerBody.position.z;
  state.velY = playerBody.velocity.y;

  // Restore frozen Y when standing still — eliminates terrain contact jitter
  if (_frozenY !== null) {
    state.y = _frozenY;
    playerBody.position.y = _frozenY;
    playerBody.velocity.y = 0;
  }

  // Damp vertical micro-bounces from heightfield/floor contact resolution
  if (playerBody.velocity.y > 0 && playerBody.velocity.y < 0.8) {
    playerBody.velocity.y = 0;
  }

  // Ceiling clamp — safety net: raycast upward to catch any floor/roof penetration
  const world = getPhysicsWorld();
  _rayFrom.set(state.x, state.y + 0.1, state.z);
  _rayTo.set(state.x, state.y + CFG.PLAYER_H + 0.1, state.z);
  _rayResult.reset();
  world.raycastClosest(_rayFrom, _rayTo, { collisionFilterMask: ~2 }, _rayResult);
  if (_rayResult.hasHit) {
    const ceilingY = _rayResult.hitPointWorld.y;
    const maxY = ceilingY - CFG.PLAYER_H;
    if (state.y > maxY) {
      state.y = maxY;
      playerBody.position.y = maxY;
      if (playerBody.velocity.y > 0) playerBody.velocity.y = 0;
    }
  }

  // Snow mode: water acts as ice floor
  if (CFG.SNOW_MODE && state.y < CFG.WATER_Y) {
    state.y = CFG.WATER_Y;
    playerBody.position.y = CFG.WATER_Y;
    if (playerBody.velocity.y < 0) playerBody.velocity.y = 0;
  }

  // NPC pushback (post-physics nudge)
  const push = getNpcCollision(state.x, state.z, CFG.PLAYER_R);
  if (push) {
    state.x += push.x;
    state.z += push.z;
    playerBody.position.x = state.x;
    playerBody.position.z = state.z;
  }

  // World boundary — only trigger shield when player actually crosses the hard edge
  const edge = CFG.HALF - 1;
  const eyeY = state.y + CFG.PLAYER_H * 0.5;
  const shieldVis = edge + 2; // visual placed past clamp so 1st person can see it
  let hitBoundary = false;

  if (state.x > edge) {
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(shieldVis, eyeY, state.z, -1, 0); hitBoundary = true; }
    state.x = edge; playerBody.position.x = edge; playerBody.velocity.x = 0;
  } else if (state.x < -edge) {
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(-shieldVis, eyeY, state.z, 1, 0); hitBoundary = true; }
    state.x = -edge; playerBody.position.x = -edge; playerBody.velocity.x = 0;
  }
  if (state.z > edge) {
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(state.x, eyeY, shieldVis, 0, -1); hitBoundary = true; }
    state.z = edge; playerBody.position.z = edge; playerBody.velocity.z = 0;
  } else if (state.z < -edge) {
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(state.x, eyeY, -shieldVis, 0, 1); hitBoundary = true; }
    state.z = -edge; playerBody.position.z = -edge; playerBody.velocity.z = 0;
  }

  if (hitBoundary) _boundaryShieldCD = 30; // ~0.5s at 60fps
  else if (_boundaryShieldCD > 0) _boundaryShieldCD--;
}

export function updatePlayer(dt, camera, sunLight, keys) {
  const underwater = !CFG.SNOW_MODE && (state.y + CFG.PLAYER_H) < CFG.WATER_Y;

  // Player animation state
  if (modelReady) {
    if (_moving && _sprinting && currentAction !== runAction) {
      crossfade(currentAction, runAction);
    } else if (_moving && !_sprinting && currentAction !== walkAction) {
      crossfade(currentAction, walkAction);
    } else if (!_moving && currentAction !== idleAction) {
      crossfade(currentAction, idleAction);
    }
    mixer.update(dt);
  }

  // Camera blend transition (smoothstep over CAM_TRANS_DUR)
  if (camBlend !== camBlendTarget) {
    camTransT += dt;
    const t = Math.min(camTransT / CAM_TRANS_DUR, 1);
    const smooth = t * t * (3 - 2 * t); // smoothstep
    camBlend = camBlendTarget === 0 ? 1 - smooth : smooth;
    if (t >= 1) camBlend = camBlendTarget;
  }

  // First-person: camera at eye height, looking along yaw/pitch
  _fpPos.set(state.x, state.y + CFG.PLAYER_H, state.z);
  const fpFwd = new THREE.Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();
  // Third-person: over-the-shoulder behind player, pitch-aware orbit
  const tpDist = 3;
  const tpBaseHeight = 2.2;
  const tpRight = 1.2;
  const rightVec = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

  // Camera orbits vertically using pitch (negated so mouse-up = look up)
  const tpPitch = Math.max(-1.0, Math.min(1.2, -state.pitch));
  const hDist = tpDist * Math.cos(tpPitch);   // horizontal distance shrinks as pitch increases
  const vOff = tpBaseHeight + tpDist * Math.sin(tpPitch); // height offset follows pitch

  const tpOff = new THREE.Vector3(
    Math.sin(state.yaw) * hDist + rightVec.x * tpRight,
    vOff,
    Math.cos(state.yaw) * hDist + rightVec.z * tpRight
  );

  const desiredCamY = Math.max(state.y + 0.5, state.y + tpOff.y);
  const desiredCam = new THREE.Vector3(state.x + tpOff.x, desiredCamY, state.z + tpOff.z);

  // Raycast from player eye toward desired camera to prevent clipping through walls
  // Cast center ray + lateral probes to catch corner clipping
  const toCamera = new THREE.Vector3().subVectors(desiredCam, _fpPos);
  const maxDist = toCamera.length();
  toCamera.normalize();

  _camRight.crossVectors(toCamera, new THREE.Vector3(0, 1, 0)).normalize();

  const scene = getScene();
  let finalDist = maxDist;
  const PULL_BACK = 0.4;
  const PROBE_W = 0.6;

  // Probe offsets: center, left, right (catches walls at corners)
  const offsets = [0, -PROBE_W, PROBE_W];
  for (const off of offsets) {
    _probeTarget.copy(desiredCam).addScaledVector(_camRight, off);
    _probeDir.subVectors(_probeTarget, _fpPos);
    const probeDist = _probeDir.length();
    _probeDir.normalize();

    camRay.set(_fpPos, _probeDir);
    camRay.far = probeDist;
    camRay.near = 0;

    const hits = camRay.intersectObjects(scene.children, true);
    for (const hit of hits) {
      // Skip player model
      let isPlayer = false;
      let obj = hit.object;
      while (obj) { if (obj === playerModel) { isPlayer = true; break; } obj = obj.parent; }
      if (isPlayer) continue;
      // Skip ground/water planes (they clip camera near flat areas)
      if (hit.object.userData && hit.object.userData.isGround) continue;
      // Project hit distance onto main ray direction
      const projDist = Math.max(0.5, hit.distance * _probeDir.dot(toCamera) - PULL_BACK);
      if (projDist < finalDist) finalDist = projDist;
      break;
    }
  }

  _tpPos.copy(_fpPos).addScaledVector(toCamera, finalDist);

  // Blend camera position
  camera.position.lerpVectors(_fpPos, _tpPos, camBlend);

  // Camera look-at during 3→1: reconstruct world target from player-local coords
  // using current yaw/pitch each frame. This lets mouse rotation work during the
  // transition while still absorbing shoulder-offset parallax smoothly.
  if (_trackWorldTarget) {
    if (camBlend > 0) {
      // Reconstruct target from local coords using current orientation
      _toHit.crossVectors(rightVec, fpFwd); // local up (already unit length)
      _crosshairTarget.copy(_fpPos)
        .addScaledVector(rightVec, _targetLocal.x)
        .addScaledVector(_toHit, _targetLocal.y)
        .addScaledVector(fpFwd, _targetLocal.z);

      _blendedLookAt.copy(_crosshairTarget);
    } else {
      // Transition complete: set yaw/pitch so fpFwd exactly matches direction to target
      const dir = _toHit.subVectors(_crosshairTarget, _fpPos).normalize();
      state.yaw = Math.atan2(-dir.x, -dir.z);
      state.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));

      const newFwd = new THREE.Vector3(
        -Math.sin(state.yaw) * Math.cos(state.pitch),
        Math.sin(state.pitch),
        -Math.cos(state.yaw) * Math.cos(state.pitch)
      ).normalize();
      _toHit.subVectors(_crosshairTarget, _fpPos);
      convergenceDist = Math.max(15, _toHit.dot(newFwd));

      _blendedLookAt.copy(_fpPos).addScaledVector(newFwd, convergenceDist);
      _trackWorldTarget = false;
    }
  } else {
    _blendedLookAt.copy(_fpPos).addScaledVector(fpFwd, convergenceDist);
  }
  camera.lookAt(_blendedLookAt);

  // Player model always exists for shadows; layer 1 controls camera visibility
  playerModel.visible = true;
  playerModel.position.set(state.x, state.y, state.z);
  playerModel.rotation.y = facingAngle + Math.PI;

  // FP: hide model from camera (layer 1 off) — shadows still cast
  // TP: show model in camera (layer 1 on)
  if (camBlend > 0.15) {
    camera.layers.enable(1);
  } else {
    camera.layers.disable(1);
  }
  // Layer 2: sky objects (sun, lensflare) — always visible, never raycasted
  camera.layers.enable(2);
  // Shadow camera always renders the model
  sunLight.shadow.camera.layers.enable(1);

  // Crosshair always visible during gameplay
  const crosshair = document.getElementById('crosshair');
  if (crosshair) crosshair.style.display = 'block';

  // Underwater blue tint overlay
  const uwOverlay = document.getElementById('underwater-overlay');
  if (uwOverlay) uwOverlay.style.display = underwater ? 'block' : 'none';

  // Right-click zoom (FOV animation)
  const zooming = isRightMouseDown();
  if (zooming && zoomT < 1) {
    zoomT = Math.min(1, zoomT + dt / ZOOM_DUR);
  } else if (!zooming && zoomT > 0) {
    zoomT = Math.max(0, zoomT - dt / ZOOM_DUR);
  }
  if (zoomT > 0 || camera.fov !== BASE_FOV) {
    const smooth = zoomT * zoomT * (3 - 2 * zoomT);
    camera.fov = BASE_FOV + (ZOOM_FOV - BASE_FOV) * smooth;
    camera.updateProjectionMatrix();
  }

  // Store actual camera state for next toggle's convergence raycast
  _lastCamPos.copy(camera.position);
  camera.getWorldDirection(_lastCamFwd);

  // Shadow camera follows player — direction from daynight.js, position relative to player
  const off = getSunOffset();
  sunLight.target.position.set(state.x, 0, state.z);
  sunLight.position.set(state.x + off.x, off.y, state.z + off.z);
  sunLight.target.updateMatrixWorld();
}
