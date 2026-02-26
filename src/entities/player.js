import { SceneLoader, TransformNode, Vector3, Color3, Ray, Matrix, Viewport } from 'babylonjs';
import { CFG } from '../config.js';
import { createPlayerBody, raycastClosest } from '../core/physics.js';
import { getScene, getCamera, getEngine } from '../core/scene.js';
import { isRightMouseDown } from '../systems/controls.js';
import { getSunOffset } from '../systems/daynight.js';
import { getNpcCollision } from '../systems/npcAI.js';
import { getTerrainHeight } from '../world/terrain.js';
import { spawnBoundaryHit, setBoundaryContact } from '../world/boundary.js';
import { getContainer, createAnimMixer } from './modelLoader.js';
import { addShadowCaster, enableShadowReceiving, getSunCSM } from '../core/lighting.js';

let playerModel; // TransformNode root
let mixer, idleAction, walkAction, runAction;
let currentAction;
let modelReady = false;
let facingAngle = Math.PI;

// Camera blend: 0 = first person, 1 = third person
let camBlend = 1;          // Start at 3rd person
let camBlendTarget = 0;    // Animate to 1st person on game start
let camTransT = 0;         // Transition elapsed time
const CAM_TRANS_DUR = 1.0; // 1 second transition
let convergenceDist = 30;  // crosshair convergence distance (set on V toggle)

// 3→1 world-space crosshair tracking
const _crosshairTarget = new Vector3();
const _targetLocal = new Vector3(); // target in player-local coords (right, up, fwd)
let _trackWorldTarget = false; // true during 3→1 transition

// Zoom state
const BASE_FOV = 75 * Math.PI / 180; // Babylon uses radians
const ZOOM_FOV = 25 * Math.PI / 180;
const ZOOM_DUR = 0.5;
let zoomT = 0; // 0 = no zoom, 1 = fully zoomed

// Pre-allocated temporaries for camera blending
const _fpPos = new Vector3();
const _tpPos = new Vector3();
const _blendedLookAt = new Vector3();
const _probeTarget = new Vector3();
const _probeDir = new Vector3();
const _camRight = new Vector3();
const _lastCamPos = new Vector3();
const _lastCamFwd = new Vector3(0, 0, -1);
const _toHit = new Vector3();
let _camFracSmooth = 1.0; // smoothed camera collision fraction

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
let _boundaryShieldCD = 0;
let _frozenY = null;
let _lastGroundedTime = 0;
const COYOTE_TIME_MS = 150;
let _airJumpsLeft = 0;
const MAX_AIR_JUMPS = 1;
let _spaceWasDown = false;

export function getPlayerState() { return state; }
export function getPlayerModel() { return playerModel; }
export function getCamBlend() { return camBlend; }
export function getPlayerBody() { return playerBody; }

/**
 * Visual scene raycast from origin along direction.
 * Returns array of { point: Vector3, distance: number, pickedMesh: Mesh }.
 * Filters out playerModel children automatically.
 */
function sceneRaycast(origin, direction, maxDist) {
  const scene = getScene();
  const ray = new Ray(origin, direction, maxDist);
  const hits = scene.multiPickWithRay(ray, (mesh) => {
    // Skip player model meshes
    let node = mesh;
    while (node) {
      if (node === playerModel) return false;
      node = node.parent;
    }
    return mesh.isPickable !== false;
  });
  if (!hits) return [];
  return hits.filter(h => h.hit).map(h => ({
    point: h.pickedPoint,
    distance: h.distance,
    pickedMesh: h.pickedMesh,
  }));
}

export function initPlayer(scene) {
  playerModel = new TransformNode('playerRoot', scene);
  playerModel.setEnabled(false);

  // Create physics capsule body at spawn position
  const spawnY = getTerrainHeight(state.x, state.z);
  state.y = spawnY;
  playerBody = createPlayerBody(state.x, spawnY, state.z);

  // Load soldier model for the player
  SceneLoader.ImportMeshAsync('', './assets/models/Soldier.glb', '', scene).then(result => {
    const meshes = result.meshes;
    const animGroups = result.animationGroups;
    const rootMesh = meshes[0]; // __root__ node

    // Parent to playerModel TransformNode
    rootMesh.parent = playerModel;

    // Normalize scale using bounding info
    rootMesh.scaling = new Vector3(1, 1, 1);
    rootMesh.computeWorldMatrix(true);
    for (const m of rootMesh.getChildMeshes()) m.computeWorldMatrix(true);

    const bounds = rootMesh.getHierarchyBoundingVectors(true);
    const geoH = bounds.max.y - bounds.min.y;
    if (geoH > 0) {
      const s = CFG.SOLDIER_H / geoH;
      rootMesh.scaling = new Vector3(s, s, s);
    }

    // Tint player blue, enable shadows
    for (const mesh of rootMesh.getChildMeshes()) {
      if (mesh.material) {
        mesh.material = mesh.material.clone(mesh.material.name + '_player');
        if (mesh.material.albedoColor) {
          const c = mesh.material.albedoColor;
          mesh.material.albedoColor = new Color3(c.r * 0.5, c.g * 0.55, c.b * 1.0);
        }
      }
      addShadowCaster(mesh);
      enableShadowReceiving(mesh);
    }

    // Layer mask: player model on layer 2 (bit 1), default world on layer 1 (bit 0)
    // Camera toggles layer 2 for FP/TP visibility
    for (const mesh of rootMesh.getChildMeshes()) {
      mesh.layerMask = 0x20000000; // custom layer for player
    }

    // Set up animations
    const idleGroup = animGroups.find(a => /idle/i.test(a.name)) || animGroups[0];
    const walkGroup = animGroups.find(a => /walk/i.test(a.name)) || animGroups[1] || idleGroup;
    const runGroup = animGroups.find(a => /run/i.test(a.name)) || animGroups[2] || walkGroup;

    mixer = createAnimMixer(animGroups);

    idleAction = mixer.clipAction(idleGroup);
    walkAction = mixer.clipAction(walkGroup);
    runAction = mixer.clipAction(runGroup);

    if (walkGroup) walkGroup.speedRatio = 0.9;
    if (runGroup) runGroup.speedRatio = 1.0;

    // Start all animation groups playing (weight controls which is visible)
    if (idleGroup) { idleGroup.play(true); idleGroup.setWeightForAllAnimatables(1); }
    if (walkGroup && walkGroup !== idleGroup) { walkGroup.play(true); walkGroup.setWeightForAllAnimatables(0); }
    if (runGroup && runGroup !== idleGroup && runGroup !== walkGroup) { runGroup.play(true); runGroup.setWeightForAllAnimatables(0); }

    currentAction = idleAction;
    modelReady = true;

    console.log('Player model loaded');
  }).catch(err => {
    console.warn('Failed to load player model:', err);
  });
}

function crossfade(from, to, duration = 0.2) {
  if (from === to) return;
  to.reset().setEffectiveWeight(1).fadeIn(duration).play();
  from.fadeOut(duration);
  currentAction = to;
}

export function toggleCamera() {
  const scene = getScene();

  // If toggling mid-3→1 transition, preserve current camera direction
  if (_trackWorldTarget) {
    state.yaw = Math.atan2(-_lastCamFwd.x, -_lastCamFwd.z);
    state.pitch = Math.asin(Math.max(-1, Math.min(1, _lastCamFwd.y)));
    _trackWorldTarget = false;
  }

  state.firstPerson = !state.firstPerson;
  camBlendTarget = state.firstPerson ? 0 : 1;
  const progress = camBlendTarget === 1 ? camBlend : 1 - camBlend;
  camTransT = inverseSmoothstep(progress) * CAM_TRANS_DUR;

  const fpEye = new Vector3(state.x, state.y + CFG.PLAYER_H, state.z);
  const fpFwd = new Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();

  if (state.firstPerson) {
    // 3→1: raycast from TP camera to find what crosshair is actually on
    const hits = sceneRaycast(_lastCamPos, _lastCamFwd, 200);

    let found = false;
    for (const hit of hits) {
      if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.isGround) continue;
      _crosshairTarget.copyFrom(hit.point);
      found = true;
      break;
    }
    if (!found) {
      _crosshairTarget.copyFrom(_lastCamPos).addInPlace(
        _lastCamFwd.scale(100)
      );
    }
    _trackWorldTarget = true;

    // convergenceDist for after the transition ends
    _toHit.copyFrom(_crosshairTarget).subtractInPlace(fpEye);
    convergenceDist = Math.max(15, Vector3.Dot(_toHit, fpFwd));

    // Decompose target offset into player-local (right, up, fwd) coords
    const localRight = new Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const localUp = Vector3.Cross(localRight, fpFwd).normalize();
    _targetLocal.set(Vector3.Dot(_toHit, localRight), Vector3.Dot(_toHit, localUp), Vector3.Dot(_toHit, fpFwd));
  } else {
    // 1→3: raycast from actual 1st-person camera to find what crosshair is currently on
    _trackWorldTarget = true;
    const hits = sceneRaycast(fpEye, fpFwd, 200);

    let found = false;
    for (const hit of hits) {
      if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.isGround) continue;
      _crosshairTarget.copyFrom(hit.point);
      found = true;
      break;
    }
    if (!found) {
      _crosshairTarget.copyFrom(fpEye).addInPlace(fpFwd.scale(100));
    }

    // convergenceDist for after the transition ends
    _toHit.copyFrom(_crosshairTarget).subtractInPlace(fpEye);
    convergenceDist = Math.max(15, Vector3.Dot(_toHit, fpFwd));

    // Decompose target offset into player-local
    const localRight = new Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const localUp = Vector3.Cross(localRight, fpFwd).normalize();
    _targetLocal.set(Vector3.Dot(_toHit, localRight), Vector3.Dot(_toHit, localUp), Vector3.Dot(_toHit, fpFwd));
  }
}

function inverseSmoothstep(y) {
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

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isPlayerGrounded() {
  if (!playerBody) return true;
  const from = { x: playerBody.position.x, y: playerBody.position.y + 0.3, z: playerBody.position.z };
  const to   = { x: playerBody.position.x, y: playerBody.position.y - 0.15, z: playerBody.position.z };
  return raycastClosest(from, to).hasHit;
}

/** Called BEFORE physics step — sets body velocity from input */
export function updatePlayerMovement(dt, keys) {
  if (!playerBody) return;

  const fwdX = -Math.sin(state.yaw), fwdZ = -Math.cos(state.yaw);
  const rightX = Math.cos(state.yaw), rightZ = -Math.sin(state.yaw);
  _sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  const underwater = !CFG.SNOW_MODE && (state.y + CFG.PLAYER_H) < CFG.WATER_Y;
  const spdMul = underwater ? 0.4 : 1;
  const spd = (_sprinting ? CFG.SPRINT : CFG.SPEED) * spdMul;
  let mvX = 0, mvZ = 0;

  if (keys['KeyW']) { mvX += fwdX; mvZ += fwdZ; }
  if (keys['KeyS']) { mvX -= fwdX; mvZ -= fwdZ; }
  if (keys['KeyA']) { mvX -= rightX; mvZ -= rightZ; }
  if (keys['KeyD']) { mvX += rightX; mvZ += rightZ; }

  const mvLen = Math.sqrt(mvX * mvX + mvZ * mvZ);
  _moving = mvLen > 0;

  if (_moving) {
    mvX /= mvLen; mvZ /= mvLen;

    // Smooth facing rotation
    const targetAngle = Math.atan2(mvX, mvZ);
    let diff = targetAngle - facingAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    facingAngle += diff * Math.min(1, dt * 12);

    playerBody.velocity.x = mvX * spd;
    playerBody.velocity.z = mvZ * spd;
  } else {
    playerBody.velocity.x = 0;
    playerBody.velocity.z = 0;
  }

  // Ground check
  const grounded = isPlayerGrounded();
  if (grounded) {
    _lastGroundedTime = performance.now();
    _airJumpsLeft = MAX_AIR_JUMPS;
  }

  // Prevent sliding on slopes when not moving
  if (!_moving && grounded && !keys['Space'] && playerBody.velocity.y <= 2.0) {
    playerBody.velocity.set(0, 0, 0);
    if (_frozenY === null) _frozenY = playerBody.position.y;
  } else {
    _frozenY = null;
  }

  // Coyote Time Jump
  const canGroundJump = grounded || (performance.now() - _lastGroundedTime < COYOTE_TIME_MS);
  const spacePressed = keys['Space'] && !_spaceWasDown;
  const canAirJump = !canGroundJump && _airJumpsLeft > 0 && spacePressed;
  if (keys['Space'] && (canGroundJump || canAirJump)) {
    playerBody.velocity.y = underwater ? CFG.JUMP * 0.5 : CFG.JUMP;
    _lastGroundedTime = 0;
    if (canAirJump) _airJumpsLeft--;
  }
  _spaceWasDown = !!keys['Space'];

  // Underwater slow sinking
  if (underwater && playerBody.velocity.y < -2) {
    playerBody.velocity.y = -2;
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

  // Restore frozen Y
  if (_frozenY !== null) {
    state.y = _frozenY;
    playerBody.position.y = _frozenY;
    playerBody.velocity.y = 0;
  }

  // Ceiling clamp
  const ceilFrom = { x: state.x, y: state.y + 0.1, z: state.z };
  const ceilTo   = { x: state.x, y: state.y + CFG.PLAYER_H + 3.0, z: state.z };
  const ceilHit = raycastClosest(ceilFrom, ceilTo);
  if (ceilHit.hasHit) {
    const ceilingY = ceilHit.hitPointWorld.y;
    const maxY = ceilingY - CFG.PLAYER_H;
    if (state.y > maxY) {
      state.y = maxY;
      playerBody.position.y = maxY;
      if (playerBody.velocity.y > 0) playerBody.velocity.y = 0;
    }
  }

  // Floor clamp
  const terrainY = getTerrainHeight(state.x, state.z);
  if (state.y < terrainY) {
    state.y = terrainY;
    playerBody.position.y = terrainY;
    if (playerBody.velocity.y < 0) {
      playerBody.velocity.y = 0;
    }
    _frozenY = terrainY;
  }

  // Snow mode: water acts as ice floor
  if (CFG.SNOW_MODE && state.y < CFG.WATER_Y) {
    state.y = CFG.WATER_Y;
    playerBody.position.y = CFG.WATER_Y;
    if (playerBody.velocity.y < 0) playerBody.velocity.y = 0;
  }

  // NPC pushback
  const push = getNpcCollision(state.x, state.z, CFG.PLAYER_R);
  if (push) {
    state.x += push.x;
    state.z += push.z;
    playerBody.position.x = state.x;
    playerBody.position.z = state.z;
  }

  // World boundary
  const edge = CFG.HALF - 1;
  const eyeY = state.y + CFG.PLAYER_H * 0.5;
  const shieldVis = edge + 2;
  let hitBoundary = false;
  let atBound = false;

  if (state.x > edge) {
    atBound = true;
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(shieldVis, eyeY, state.z, -1, 0); hitBoundary = true; }
    state.x = edge; playerBody.position.x = edge; playerBody.velocity.x = 0;
  } else if (state.x < -edge) {
    atBound = true;
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(-shieldVis, eyeY, state.z, 1, 0); hitBoundary = true; }
    state.x = -edge; playerBody.position.x = -edge; playerBody.velocity.x = 0;
  }
  if (state.z > edge) {
    atBound = true;
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(state.x, eyeY, shieldVis, 0, -1); hitBoundary = true; }
    state.z = edge; playerBody.position.z = edge; playerBody.velocity.z = 0;
  } else if (state.z < -edge) {
    atBound = true;
    if (_boundaryShieldCD <= 0) { spawnBoundaryHit(state.x, eyeY, -shieldVis, 0, 1); hitBoundary = true; }
    state.z = -edge; playerBody.position.z = -edge; playerBody.velocity.z = 0;
  }

  setBoundaryContact(atBound);
  if (hitBoundary) _boundaryShieldCD = 30;
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
    const smooth = t * t * (3 - 2 * t);
    camBlend = camBlendTarget === 0 ? 1 - smooth : smooth;
    if (t >= 1) camBlend = camBlendTarget;
  }

  // First-person: camera at eye height
  _fpPos.set(state.x, state.y + CFG.PLAYER_H, state.z);

  // Clamp 1st-person eye below ceiling so FOV can't peek into attic when jumping
  const fpCeil = raycastClosest(
    { x: state.x, y: state.y + 0.5, z: state.z },
    { x: state.x, y: state.y + CFG.PLAYER_H + 2.0, z: state.z }
  );
  if (fpCeil.hasHit) {
    const maxEyeY = fpCeil.hitPointWorld.y - 0.15;
    if (_fpPos.y > maxEyeY) _fpPos.y = maxEyeY;
  }

  const fpFwd = new Vector3(
    -Math.sin(state.yaw) * Math.cos(state.pitch),
    Math.sin(state.pitch),
    -Math.cos(state.yaw) * Math.cos(state.pitch)
  ).normalize();

  // Third-person: over-the-shoulder
  const tpDist = 3;
  const tpBaseHeight = 2.2;
  const tpRightBase = 1.2;
  const rightVec = new Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

  const tpPitch = Math.max(-1.0, Math.min(1.2, -state.pitch));
  const hDist = tpDist * Math.cos(tpPitch);
  const vOff = tpBaseHeight + tpDist * Math.sin(tpPitch);

  const MARGIN = 0.35;

  // Shoulder clearance: reduce right offset if a wall is to the player's right
  let tpRight = tpRightBase;
  const shoulderHits = sceneRaycast(_fpPos, rightVec, tpRightBase + MARGIN);
  for (const hit of shoulderHits) {
    if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.isGround) continue;
    tpRight = Math.max(0, hit.distance - MARGIN);
    break;
  }

  const tpOffX = Math.sin(state.yaw) * hDist + rightVec.x * tpRight;
  const tpOffY = vOff;
  const tpOffZ = Math.cos(state.yaw) * hDist + rightVec.z * tpRight;

  const desiredCamY = Math.max(state.y + 0.5, state.y + tpOffY);
  const desiredCam = new Vector3(state.x + tpOffX, desiredCamY, state.z + tpOffZ);

  // Clamp camera Y well below ceiling so FOV can't see above walls
  const ceilCheckFrom = { x: state.x, y: state.y + 0.5, z: state.z };
  const ceilCheckTo   = { x: state.x, y: state.y + CFG.PLAYER_H + 5.0, z: state.z };
  const ceilCheck = raycastClosest(ceilCheckFrom, ceilCheckTo);
  if (ceilCheck.hasHit) {
    const maxCamY = ceilCheck.hitPointWorld.y - 0.5;
    if (desiredCam.y > maxCamY) desiredCam.y = maxCamY;
  }

  // --- CAMERA COLLISION ---
  const toCamera = desiredCam.subtract(_fpPos);
  const maxDist = toCamera.length();

  const targetNear = 0.1 + camBlend * 0.2;
  const fovRad = BASE_FOV;
  const aspect = getEngine().getRenderWidth() / getEngine().getRenderHeight() || 16 / 9;

  // Camera coordinate frame
  const lookTarget = _fpPos.add(fpFwd.scale(convergenceDist));
  const camFwd = lookTarget.subtract(desiredCam).normalize();
  const worldUp = new Vector3(0, 1, 0);
  const camRight2 = Vector3.Cross(camFwd, worldUp).normalize();
  const camUp = Vector3.Cross(camRight2, camFwd).normalize();

  const frustumMargin = 0.1;
  const halfH = Math.tan(fovRad / 2) * targetNear + frustumMargin;
  const halfW = halfH * aspect + frustumMargin;

  // 5 probe targets: center + 4 corners of near plane
  const offsets = [
    new Vector3(0, 0, 0),
    camRight2.scale(halfW).add(camUp.scale(halfH)),
    camRight2.scale(-halfW).add(camUp.scale(halfH)),
    camRight2.scale(halfW).add(camUp.scale(-halfH)),
    camRight2.scale(-halfW).add(camUp.scale(-halfH)),
  ];

  let minFraction = 1.0;

  for (const offset of offsets) {
    const target = desiredCam.add(camFwd.scale(targetNear)).add(offset);
    const dir = target.subtract(_fpPos);
    const rayLen = dir.length();
    if (rayLen < 0.001) continue;
    dir.scaleInPlace(1 / rayLen);

    const hits = sceneRaycast(_fpPos, dir, rayLen);
    for (const hit of hits) {
      if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.isGround) continue;
      // Skip roof meshes — ceiling Y clamp already prevents camera from entering attic
      const mn = hit.pickedMesh.name;
      if (mn === 'slantRoofs' || mn === 'flatRoofs') continue;
      const safeDist = Math.max(0, hit.distance - 0.05);
      const fraction = safeDist / rayLen;
      if (fraction < minFraction) {
        minFraction = fraction;
      }
      break; // closest non-ground hit
    }
  }

  // Smooth camera fraction — snap in instantly, ease out slowly to prevent oscillation
  const rawFraction = Math.max(0.05, minFraction);
  if (rawFraction < _camFracSmooth) {
    _camFracSmooth = rawFraction;
  } else {
    _camFracSmooth += (rawFraction - _camFracSmooth) * Math.min(1, dt * 5);
  }
  _tpPos.copyFrom(_fpPos).addInPlace(toCamera.scale(_camFracSmooth));

  // Blend camera position
  Vector3.LerpToRef(_fpPos, _tpPos, camBlend, camera.position);

  // Dynamic near plane squish
  const squishedNear = Math.max(0.02, targetNear * _camFracSmooth);
  if (Math.abs(camera.minZ - squishedNear) > 0.001) {
    camera.minZ = squishedNear;
  }

  // Camera look-at during transitions
  if (_trackWorldTarget) {
    if (camBlend > 0 && camBlend < 1) {
      // Reconstruct target from local coords using current orientation
      const localUp2 = Vector3.Cross(rightVec, fpFwd);
      _crosshairTarget.copyFrom(_fpPos);
      _crosshairTarget.addInPlace(rightVec.scale(_targetLocal.x));
      _crosshairTarget.addInPlace(localUp2.scale(_targetLocal.y));
      _crosshairTarget.addInPlace(fpFwd.scale(_targetLocal.z));

      _blendedLookAt.copyFrom(_crosshairTarget);
    } else if (camBlend === 0) {
      // 3→1 Transition complete: snap pitch/yaw
      const dir = _crosshairTarget.subtract(_fpPos).normalize();
      state.yaw = Math.atan2(-dir.x, -dir.z);
      state.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));

      const newFwd = new Vector3(
        -Math.sin(state.yaw) * Math.cos(state.pitch),
        Math.sin(state.pitch),
        -Math.cos(state.yaw) * Math.cos(state.pitch)
      ).normalize();
      _toHit.copyFrom(_crosshairTarget).subtractInPlace(_fpPos);
      convergenceDist = Math.max(15, Vector3.Dot(_toHit, newFwd));

      _blendedLookAt.copyFrom(_fpPos).addInPlace(newFwd.scale(convergenceDist));
      _trackWorldTarget = false;
    } else if (camBlend === 1) {
      // 1→3 Transition complete
      _blendedLookAt.copyFrom(lookTarget);
      _trackWorldTarget = false;
    }
  } else {
    // Normal gameplay (not transitioning)
    if (camBlend === 0) {
      _blendedLookAt.copyFrom(_fpPos).addInPlace(fpFwd.scale(convergenceDist));
    } else {
      _blendedLookAt.copyFrom(lookTarget);
    }
  }
  camera.setTarget(_blendedLookAt);

  // Player model visibility
  playerModel.setEnabled(true);
  playerModel.position = new Vector3(state.x, state.y, state.z);
  playerModel.rotation = new Vector3(0, facingAngle + Math.PI, 0);

  // Layer mask: show/hide player model based on camera blend
  // Player meshes are on layerMask 0x20000000
  if (camBlend > 0.15) {
    camera.layerMask = 0x0FFFFFFF | 0x20000000; // see everything including player
  } else {
    camera.layerMask = 0x0FFFFFFF; // see everything except player layer
  }

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
  }

  // Store actual camera state for next toggle's convergence raycast
  _lastCamPos.copyFrom(camera.position);
  // Babylon FreeCamera: forward direction = target - position
  _lastCamFwd.copyFrom(camera.getTarget()).subtractInPlace(camera.position).normalize();

  // Shadow follows player (CSM handles this mostly, but we still position the directional light)
  const off = getSunOffset();
  sunLight.position = new Vector3(state.x + off.x, off.y, state.z + off.z);
  // Directional light in Babylon.js uses .direction, not .target
  sunLight.direction = new Vector3(-off.x, -off.y, -off.z).normalize();
}
