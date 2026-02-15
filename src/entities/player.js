import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CFG } from '../config.js';
import { canMoveTo, getFloorHeight } from '../world/grid.js';
import { getNpcCollision } from '../systems/npcAI.js';
import { collidesWithRock, getRockPushback, getRockSurfaceHeight } from '../world/vegetation.js';
import { collidesWithDoorPanel, getDoorPanelPushback } from '../world/doors.js';
import { getScene } from '../core/scene.js';
import { isRightMouseDown } from '../systems/controls.js';

let playerModel;
let mixer, idleAction, walkAction, runAction;
let currentAction;
let modelReady = false;
let facingAngle = Math.PI;
const camRay = new THREE.Raycaster();

// Camera blend: 0 = first person, 1 = third person
let camBlend = 1;          // Start at 3rd person
let camBlendTarget = 0;    // Animate to 1st person on game start
let camTransT = 0;         // Transition elapsed time
const CAM_TRANS_DUR = 1.0; // 1 second transition

// Zoom state
const BASE_FOV = 75;
const ZOOM_FOV = 37.5; // 2x zoom
const ZOOM_DUR = 1.0;
let zoomT = 0; // 0 = no zoom, 1 = fully zoomed

// Pre-allocated temporaries for camera blending
const _fpPos = new THREE.Vector3();
const _fpLookAt = new THREE.Vector3();
const _tpPos = new THREE.Vector3();
const _tpLookAt = new THREE.Vector3();
const _blendedLookAt = new THREE.Vector3();

const state = {
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  velY: 0,
  firstPerson: true,
};

export function getPlayerState() { return state; }
export function getPlayerModel() { return playerModel; }

export function initPlayer(scene) {
  playerModel = new THREE.Group();
  playerModel.visible = false;
  scene.add(playerModel);

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
        c.material = c.material.clone();
        c.material.color.multiply(new THREE.Color(0.5, 0.55, 1.0));
      }
    });

    playerModel.add(model);

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
  state.firstPerson = !state.firstPerson;
  if (state.firstPerson) {
    // Look horizontal, facing same direction as model
    state.pitch = 0;
    state.yaw = facingAngle + Math.PI;
  }
  camBlendTarget = state.firstPerson ? 0 : 1;
  camTransT = 0;
}

export function updatePlayer(dt, camera, sunLight, dayTime, keys) {
  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const sprinting = keys['ShiftLeft'] || keys['ShiftRight'];
  // Underwater slows movement to 40%
  const underwater = !CFG.SNOW_MODE && (state.y + CFG.PLAYER_H) < CFG.WATER_Y;
  const spdMul = underwater ? 0.4 : 1;
  const spd = (sprinting ? CFG.SPRINT : CFG.SPEED) * spdMul;
  const mv = new THREE.Vector3();

  if (keys['KeyW']) mv.add(fwd);
  if (keys['KeyS']) mv.sub(fwd);
  if (keys['KeyA']) mv.sub(right);
  if (keys['KeyD']) mv.add(right);

  const moving = mv.lengthSq() > 0;

  if (moving) {
    mv.normalize();

    // Target facing = direction of movement
    const targetAngle = Math.atan2(mv.x, mv.z);

    // Smooth rotation — lerp the shortest arc
    let diff = targetAngle - facingAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    facingAngle += diff * Math.min(1, dt * 12);

    mv.multiplyScalar(spd * dt);
    if (canMoveTo(state.x + mv.x, state.z, state.y) && !collidesWithRock(state.x + mv.x, state.z, CFG.PLAYER_R, state.y) && !collidesWithDoorPanel(state.x + mv.x, state.z, CFG.PLAYER_R)) state.x += mv.x;
    if (canMoveTo(state.x, state.z + mv.z, state.y) && !collidesWithRock(state.x, state.z + mv.z, CFG.PLAYER_R, state.y) && !collidesWithDoorPanel(state.x, state.z + mv.z, CFG.PLAYER_R)) state.z += mv.z;
  }

  // NPC collision — push player out of NPCs
  const push = getNpcCollision(state.x, state.z, CFG.PLAYER_R);
  if (push) {
    const nx = state.x + push.x;
    const nz = state.z + push.z;
    if (canMoveTo(nx, nz, state.y)) { state.x = nx; state.z = nz; }
  }

  // Rock collision — push player out of rocks (skip if above rock)
  const rockPush = getRockPushback(state.x, state.z, CFG.PLAYER_R, state.y);
  if (rockPush) {
    const rx = state.x + rockPush.x;
    const rz = state.z + rockPush.z;
    if (canMoveTo(rx, rz, state.y)) { state.x = rx; state.z = rz; }
  }

  // Door panel pushback — prevent getting stuck in swinging doors
  const doorPush = getDoorPanelPushback(state.x, state.z, CFG.PLAYER_R);
  if (doorPush) {
    const dpx = state.x + doorPush.x;
    const dpz = state.z + doorPush.z;
    if (canMoveTo(dpx, dpz, state.y)) { state.x = dpx; state.z = dpz; }
  }

  // Player animation state
  if (modelReady) {
    if (moving && sprinting && currentAction !== runAction) {
      crossfade(currentAction, runAction);
    } else if (moving && !sprinting && currentAction !== walkAction) {
      crossfade(currentAction, walkAction);
    } else if (!moving && currentAction !== idleAction) {
      crossfade(currentAction, idleAction);
    }
    mixer.update(dt);
  }

  // Jump & gravity
  let groundY = getFloorHeight(state.x, state.z, state.y);
  const rockY = getRockSurfaceHeight(state.x, state.z, state.y);
  if (rockY !== null) groundY = Math.max(groundY, rockY);
  if (CFG.SNOW_MODE) groundY = Math.max(groundY, CFG.WATER_Y);
  if (keys['Space'] && state.y < groundY + 0.01) state.velY = underwater ? CFG.JUMP * 0.5 : CFG.JUMP;
  state.velY -= (underwater ? CFG.GRAV * 0.3 : CFG.GRAV) * dt;
  state.y += state.velY * dt;
  if (state.y < groundY) { state.y = groundY; state.velY = 0; }

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
  _fpLookAt.copy(_fpPos).addScaledVector(fpFwd, 10);

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

  _tpLookAt.set(
    state.x + rightVec.x * tpRight, state.y + 1.0, state.z + rightVec.z * tpRight
  );
  const desiredCamY = Math.max(state.y + 0.5, state.y + tpOff.y);
  const desiredCam = new THREE.Vector3(state.x + tpOff.x, desiredCamY, state.z + tpOff.z);

  // Raycast from look target toward desired camera to prevent clipping through walls
  const toCamera = new THREE.Vector3().subVectors(desiredCam, _tpLookAt);
  const maxDist = toCamera.length();
  toCamera.normalize();

  camRay.set(_tpLookAt, toCamera);
  camRay.far = maxDist;
  camRay.near = 0;

  const scene = getScene();
  const hits = camRay.intersectObjects(scene.children, true);
  let finalDist = maxDist;

  for (const hit of hits) {
    let isPlayer = false;
    let obj = hit.object;
    while (obj) { if (obj === playerModel) { isPlayer = true; break; } obj = obj.parent; }
    if (isPlayer) continue;
    finalDist = Math.max(0.5, hit.distance - 0.25);
    break;
  }

  _tpPos.copy(_tpLookAt).addScaledVector(toCamera, finalDist);

  // Blend position and look-at target (no quaternion flip)
  camera.position.lerpVectors(_fpPos, _tpPos, camBlend);
  _blendedLookAt.lerpVectors(_fpLookAt, _tpLookAt, camBlend);
  camera.lookAt(_blendedLookAt);

  // Player model visible whenever not fully in first person
  playerModel.visible = camBlend > 0.15;
  playerModel.position.set(state.x, state.y, state.z);
  playerModel.rotation.y = facingAngle + Math.PI;

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

  // Shadow camera follows player
  const sunAngle = dayTime * Math.PI * 2;
  const sx = Math.cos(sunAngle) * 40;
  const sy = Math.sin(sunAngle) * 40;
  sunLight.position.set(state.x + sx, Math.max(sy, 2), state.z + 20);
  sunLight.target.position.set(state.x, 0, state.z);
  sunLight.target.updateMatrixWorld();
}
