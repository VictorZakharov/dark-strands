import { Scene, FreeCamera, HemisphericLight, DirectionalLight, PointLight,
         MeshBuilder, Mesh, PBRMaterial, StandardMaterial, Texture, DynamicTexture,
         Color3, Color4, Vector3, VertexData, SceneLoader, ShadowGenerator,
         TransformNode } from 'babylonjs';
import { CFG } from '../config.js';
import { getEngine } from '../core/scene.js';
import { createAnimMixer } from '../entities/modelLoader.js';

let menuScene, menuCamera, menuMixer;
let mouseX = 0, mouseY = 0;
let disposed = false;
let camBase, camLookAt;
let menuSnow = false;

// Menu character control
let menuCharModel = null;
let menuCharActions = {};
let menuCharCurrentAction = null;
let menuCharPos = { x: 0, y: 0, z: 0 };
let menuCharFacing = 0;
let menuCharFacingOffset = Math.PI;
const MENU_CHAR_SPEED = 4;
const MENU_CHAR_R = 0.35;
let menuKeys = {};
let menuColliders = [];
let menuBoxColliders = [];

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));

// Shared soft-circle texture for fire/ember particles (created once per menu scene)
let softParticleTex = null;
function getSoftParticleTex(scene) {
  if (softParticleTex && !softParticleTex.isDisposed) return softParticleTex;
  const sz = 64;
  const dt = new DynamicTexture('softCircle', sz, scene, false);
  const ctx = dt.getContext();
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  dt.update();
  dt.hasAlpha = true;
  softParticleTex = dt;
  return dt;
}

function isOnPath(px, pz, ax, az, bx, bz, hw) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.001) return false;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const cx = ax + t * dx, cz = az + t * dz;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz) < hw * hw;
}

function rndAvoid(xMin, xMax, zMin, zMax, cx, cz, tx, tz, hw) {
  let x, z;
  for (let i = 0; i < 30; i++) {
    x = rnd(xMin, xMax); z = rnd(zMin, zMax);
    if (!isOnPath(x, z, cx, cz, tx, tz, hw)) return { x, z };
  }
  return { x, z };
}

// --- Shared materials (created lazily) ---
let wallMat, groundMat, trunkMat, leafMat, rockMat, roofMat;

function loadTex(path, uScale, vScale, scene) {
  const tex = new Texture(path, scene);
  tex.uScale = uScale;
  tex.vScale = vScale;
  return tex;
}

function initMaterials(scene) {
  wallMat = new PBRMaterial('mWall', scene);
  wallMat.albedoTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
  wallMat.roughness = 0.9; wallMat.metallic = 0;

  trunkMat = new PBRMaterial('mTrunk', scene);
  trunkMat.albedoTexture = loadTex('./assets/textures/bark.jpg', 1, 2, scene);
  trunkMat.roughness = 0.95; trunkMat.metallic = 0;

  rockMat = new PBRMaterial('mRock', scene);
  rockMat.albedoTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
  rockMat.roughness = 0.95; rockMat.metallic = 0;

  roofMat = new PBRMaterial('mRoof', scene);
  roofMat.albedoColor = Color3.FromHexString('#8B4513');
  roofMat.roughness = 0.85; roofMat.metallic = 0;
  roofMat.backFaceCulling = false;

  if (menuSnow) {
    groundMat = new PBRMaterial('mGround', scene);
    groundMat.albedoColor = new Color3(0.867, 0.894, 0.910);
    groundMat.roughness = 0.85; groundMat.metallic = 0;

    leafMat = new PBRMaterial('mLeaf', scene);
    leafMat.albedoColor = new Color3(0.784, 0.804, 0.816);
    leafMat.roughness = 0.9; leafMat.metallic = 0;
  } else {
    groundMat = new PBRMaterial('mGround', scene);
    groundMat.albedoTexture = loadTex('./assets/textures/grass.jpg', 6, 6, scene);
    groundMat.roughness = 0.95; groundMat.metallic = 0;

    leafMat = new PBRMaterial('mLeaf', scene);
    leafMat.albedoColor = new Color3(0.227, 0.541, 0.227);
    leafMat.roughness = 0.9; leafMat.metallic = 0;
  }
}

// --- Visibility & Collision helpers ---
const MENU_WANDER_RADIUS = 5;

function isInCameraView(x, z) {
  if (camLookAt) {
    const dx = x - camLookAt.x, dz = z - camLookAt.z;
    if (dx * dx + dz * dz > MENU_WANDER_RADIUS * MENU_WANDER_RADIUS) return false;
  }
  // Simple distance check from camera — more reliable than projection in Babylon
  if (menuCamera) {
    const cp = menuCamera.position;
    const dx = x - cp.x, dz = z - cp.z;
    if (dx * dx + dz * dz > 100) return false; // >10 units
  }
  return true;
}

function collidesMenu(x, z, r) {
  for (const c of menuColliders) {
    const dx = x - c.x, dz = z - c.z;
    const minD = r + c.r;
    if (dx * dx + dz * dz < minD * minD) return true;
  }
  for (const b of menuBoxColliders) {
    const cx = Math.max(b.xMin, Math.min(b.xMax, x));
    const cz = Math.max(b.zMin, Math.min(b.zMax, z));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

// --- Shared builders ---

function createTree(x, z, scale, scene) {
  const parent = new TransformNode('tree', scene);
  const s = scale || rnd(1.4, 2.6);
  const trunkH = rnd(1.5, 2.2), trunkR = rnd(0.12, 0.18);
  const trunk = MeshBuilder.CreateCylinder('trunk', {
    diameterTop: trunkR * 0.6 * 2, diameterBottom: trunkR * 2, height: trunkH, tessellation: 6,
  }, scene);
  trunk.material = trunkMat;
  trunk.position.y = trunkH / 2;
  trunk.parent = parent;

  for (let i = 0, n = rndInt(3, 5); i < n; i++) {
    const frac = 1 - i / n;
    const coneR = Math.max(rnd(0.8, 1.3) * (0.25 + 0.75 * frac), 0.25);
    const cone = MeshBuilder.CreateCylinder('leaf', {
      diameterTop: 0, diameterBottom: coneR * 2, height: rnd(0.8, 1.3), tessellation: 6,
    }, scene);
    cone.material = leafMat;
    cone.position.y = trunkH + i * rnd(0.45, 0.65);
    cone.parent = parent;
  }
  parent.scaling = new Vector3(s, s, s);
  parent.position = new Vector3(x, 0, z);
  menuColliders.push({ x, z, r: s * 0.35 });
  return parent;
}

function createRock(x, z, size, scene) {
  const s = size || rnd(0.2, 0.8);
  const rock = MeshBuilder.CreateIcoSphere('rock', { radius: s, subdivisions: 2 }, scene);
  rock.material = rockMat;
  rock.position = new Vector3(x, s * 0.35, z);
  rock.rotation = new Vector3(rnd(0, Math.PI), rnd(0, Math.PI), 0);
  if (s > 0.15) menuColliders.push({ x, z, r: s * 0.85 });
  return rock;
}

function addGround(scene, size) {
  const g = MeshBuilder.CreateGround('mGround', { width: size || 40, height: size || 40 }, scene);
  g.material = groundMat;
  g.receiveShadows = true;
}

function setupShadows(light, scene) {
  const sg = new ShadowGenerator(1024, light);
  sg.usePercentageCloserFiltering = true;
  sg.bias = 0.002;
  return sg;
}

// --- Shelter builder ---

function buildShelter(scene) {
  const wallH = 3.5, wallT = 0.5;
  const shelterW = rnd(5, 7), shelterD = rnd(4, 5.5);
  const cx = rnd(-1.5, 0), cz = rnd(-3, -2);

  const back = MeshBuilder.CreateBox('sBack', { width: shelterW, height: wallH, depth: wallT }, scene);
  back.material = wallMat; back.position = new Vector3(cx, wallH / 2, cz - shelterD / 2);

  const left = MeshBuilder.CreateBox('sLeft', { width: wallT, height: wallH, depth: shelterD }, scene);
  left.material = wallMat; left.position = new Vector3(cx - shelterW / 2 + wallT / 2, wallH / 2, cz);

  const rightLen = shelterD * rnd(0.4, 0.6);
  const right = MeshBuilder.CreateBox('sRight', { width: wallT, height: wallH, depth: rightLen }, scene);
  right.material = wallMat; right.position = new Vector3(cx + shelterW / 2 - wallT / 2, wallH / 2, cz - shelterD / 2 + rightLen / 2);

  menuBoxColliders.push(
    { xMin: cx - shelterW / 2, xMax: cx + shelterW / 2, zMin: cz - shelterD / 2 - wallT / 2, zMax: cz - shelterD / 2 + wallT / 2 },
    { xMin: cx - shelterW / 2, xMax: cx - shelterW / 2 + wallT, zMin: cz - shelterD / 2, zMax: cz + shelterD / 2 },
    { xMin: cx + shelterW / 2 - wallT, xMax: cx + shelterW / 2, zMin: cz - shelterD / 2, zMax: cz - shelterD / 2 + rightLen },
  );

  const pad = 8;
  menuBoxColliders.push(
    { xMin: cx - pad, xMax: cx + pad, zMin: cz - shelterD / 2 - pad, zMax: cz - shelterD / 2 - wallT / 2 },
    { xMin: cx - shelterW / 2 - pad, xMax: cx - shelterW / 2, zMin: cz - pad, zMax: cz + pad },
    { xMin: cx + shelterW / 2, xMax: cx + shelterW / 2 + pad, zMin: cz - pad, zMax: cz + shelterD / 2 },
  );

  // Gable roof — triangular prism custom mesh
  const oh = 0.6, span = shelterW + oh * 2, len = shelterD + oh * 2;
  const ridgeH = 1.6;
  const halfSpan = span / 2, halfLen = len / 2;
  const roofMesh = new Mesh('sRoof', scene);
  const positions = [
    -halfSpan, 0, -halfLen,  halfSpan, 0, -halfLen,  0, ridgeH, -halfLen,
    -halfSpan, 0, halfLen,  0, ridgeH, halfLen,  halfSpan, 0, halfLen,
    -halfSpan, 0, -halfLen,  0, ridgeH, -halfLen,  0, ridgeH, halfLen,  -halfSpan, 0, halfLen,
    halfSpan, 0, -halfLen,  halfSpan, 0, halfLen,  0, ridgeH, halfLen,  0, ridgeH, -halfLen,
    -halfSpan, 0, -halfLen,  -halfSpan, 0, halfLen,  halfSpan, 0, halfLen,  halfSpan, 0, -halfLen,
  ];
  const indices = [0,1,2, 3,4,5, 6,7,8,6,8,9, 10,11,12,10,12,13, 14,15,16,14,16,17];
  const vd = new VertexData();
  vd.positions = positions; vd.indices = indices;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  vd.applyToMesh(roofMesh);
  roofMesh.material = roofMat;
  roofMesh.position = new Vector3(cx, wallH, cz);

  // Torch near doorway
  const doorEdgeZ = cz - shelterD / 2 + rightLen;
  const torchX = cx + shelterW / 2 - wallT / 2 - 0.15;
  const torchZ = doorEdgeZ - 0.3;

  const stickMat = new PBRMaterial('sStick', scene);
  stickMat.albedoColor = Color3.FromHexString('#553311'); stickMat.roughness = 0.9; stickMat.metallic = 0;
  const stick = MeshBuilder.CreateBox('sTorch', { width: 0.07, height: 0.45, depth: 0.07 }, scene);
  stick.material = stickMat; stick.position = new Vector3(torchX, 1.65, torchZ);

  const flameMat = new PBRMaterial('sFlame', scene);
  flameMat.albedoColor = Color3.FromHexString('#ff6600');
  flameMat.emissiveColor = Color3.FromHexString('#ff4400');
  flameMat.roughness = 1; flameMat.metallic = 0;
  const flame = MeshBuilder.CreateSphere('sFlame', { diameter: 0.2, segments: 6 }, scene);
  flame.material = flameMat; flame.position = new Vector3(torchX, 1.9, torchZ);

  const tl = new PointLight('sTorch', new Vector3(torchX + 0.3, 1.9, torchZ + 0.5), scene);
  tl.diffuse = Color3.FromHexString('#ff8833'); tl.intensity = 4; tl.range = 12;

  const dl = new PointLight('sDoorFill', new Vector3(cx + shelterW / 2 + 0.5, 1.2, doorEdgeZ + 1.0), scene);
  dl.diffuse = Color3.FromHexString('#ffaa66'); dl.intensity = 2; dl.range = 8;

  return {
    cx, cz, shelterW, shelterD, wallH, wallT,
    xMin: cx - shelterW / 2 - 1, xMax: cx + shelterW / 2 + 1,
    zMin: cz - shelterD / 2 - 1, zMax: cz + shelterD / 2 + 1,
    doorX: cx + shelterW / 2, doorZ: cz + shelterD * 0.15,
    torchX, torchZ,
  };
}

// ==================== MENU CHARACTER UPDATE ====================

function crossfadeMenu(from, to, dur) {
  if (from === to || !from || !to) return;
  to.reset().setEffectiveWeight(1).fadeIn(dur || 0.25).play();
  if (from) from.fadeOut(dur || 0.25);
  menuCharCurrentAction = to;
}

function updateMenuCharacter(dt) {
  if (!menuCharModel || !menuCharActions.idle) return;

  // Camera-relative directions
  const camFwd = camLookAt.subtract(menuCamera.position);
  camFwd.y = 0;
  camFwd.normalize();
  const camRight = new Vector3(-camFwd.z, 0, camFwd.x);

  let mvX = 0, mvZ = 0;
  if (menuKeys['KeyW']) { mvX += camFwd.x; mvZ += camFwd.z; }
  if (menuKeys['KeyS']) { mvX -= camFwd.x; mvZ -= camFwd.z; }
  if (menuKeys['KeyA']) { mvX -= camRight.x; mvZ -= camRight.z; }
  if (menuKeys['KeyD']) { mvX += camRight.x; mvZ += camRight.z; }

  const mvLen = Math.sqrt(mvX * mvX + mvZ * mvZ);
  const moving = mvLen > 0;

  if (moving) {
    mvX /= mvLen; mvZ /= mvLen;
    const targetAngle = Math.atan2(mvX, mvZ);

    let diff = targetAngle - menuCharFacing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    menuCharFacing += diff * Math.min(1, dt * 12);

    const speed = MENU_CHAR_SPEED * dt;
    const nx = menuCharPos.x + mvX * speed;
    const nz = menuCharPos.z + mvZ * speed;

    if (!collidesMenu(nx, menuCharPos.z, MENU_CHAR_R) && isInCameraView(nx, menuCharPos.z)) menuCharPos.x = nx;
    if (!collidesMenu(menuCharPos.x, nz, MENU_CHAR_R) && isInCameraView(menuCharPos.x, nz)) menuCharPos.z = nz;
  }

  if (moving && menuCharCurrentAction !== menuCharActions.walk) {
    crossfadeMenu(menuCharCurrentAction, menuCharActions.walk);
  } else if (!moving && menuCharCurrentAction !== menuCharActions.idle) {
    crossfadeMenu(menuCharCurrentAction, menuCharActions.idle);
  }

  menuCharModel.position = new Vector3(menuCharPos.x, 0, menuCharPos.z);
  menuCharModel.rotation = new Vector3(0, menuCharFacing + menuCharFacingOffset, 0);
}

// ==================== SCENE TEMPLATES ====================

function templateShelterNight(scene) {
  scene.clearColor = new Color4(0.024, 0.024, 0.063, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.03;
  scene.fogColor = new Color3(0.024, 0.024, 0.063);
  scene.ambientColor = new Color3(0.03, 0.03, 0.06);

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.08;
  const moon = new DirectionalLight('moon', new Vector3(5, -10, -5), scene);
  moon.diffuse = new Color3(0.533, 0.6, 0.8); moon.intensity = 0.1;
  setupShadows(moon, scene);

  addGround(scene);
  const s = buildShelter(scene);

  // Interior floor
  const floorMesh = MeshBuilder.CreateGround('sFloor', { width: s.shelterW - s.wallT * 2, height: s.shelterD - s.wallT }, scene);
  const floorMat = new PBRMaterial('sFloorMat', scene);
  floorMat.albedoTexture = loadTex('./assets/textures/stone_wall.jpg', 2, 2, scene);
  floorMat.roughness = 0.85; floorMat.metallic = 0;
  floorMesh.material = floorMat;
  floorMesh.position = new Vector3(s.cx, 0.01, s.cz + s.wallT / 2);
  floorMesh.receiveShadows = true;

  const interiorFill = new PointLight('sFill', new Vector3(s.cx, 2.0, s.cz), scene);
  interiorFill.diffuse = Color3.FromHexString('#ffaa66'); interiorFill.intensity = 0.8; interiorFill.range = 8;

  const backWallLight = new PointLight('sBack', new Vector3(s.cx, 1.5, s.cz - s.shelterD / 2 + s.wallT + 0.5), scene);
  backWallLight.diffuse = Color3.FromHexString('#ff9944'); backWallLight.intensity = 0.5; backWallLight.range = 6;

  const charX = s.torchX - rnd(0.4, 0.8);
  const charZ = s.torchZ + rnd(0.1, 0.4);
  const camX = s.cx - s.shelterW / 2 + s.wallT + rnd(0.6, 1.2);
  const camZ = s.cz - s.shelterD / 2 + s.wallT + rnd(0.5, 1.0);
  const cam = { x: camX, y: 1.5, z: camZ };
  const look = new Vector3(charX, 1.0, charZ);

  for (let i = 0; i < rndInt(2, 4); i++) {
    createTree(s.cx + s.shelterW / 2 + rnd(2, 6), s.cz + rnd(-3, 3), rnd(1.8, 2.8), scene);
  }
  for (let i = 0; i < rndInt(1, 3); i++) {
    createRock(s.cx + s.shelterW / 2 + rnd(1, 4), s.cz + rnd(-2, 2), rnd(0.15, 0.4), scene);
  }

  const faceRot = Math.atan2(camX - charX, camZ - charZ) + Math.PI + rnd(-0.3, 0.3);

  return {
    baseCam: cam, lookAt: look,
    character: {
      url: './assets/models/Soldier.glb', anim: /idle/i,
      pos: [charX, 0, charZ], rot: faceRot, scale: CFG.SOLDIER_H,
    },
  };
}

function templateLakeside(scene) {
  const isDay = Math.random() < 0.5;
  if (isDay) {
    scene.clearColor = new Color4(0.4, 0.533, 0.667, 1);
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.03;
    scene.fogColor = new Color3(0.4, 0.533, 0.667);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
    const sun = new DirectionalLight('sun', new Vector3(-4, -8, -5), scene);
    sun.diffuse = Color3.FromHexString('#ffeedd'); sun.intensity = 0.9;
    setupShadows(sun, scene);
  } else {
    scene.clearColor = new Color4(0.2, 0.133, 0.267, 1);
    scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.035;
    scene.fogColor = new Color3(0.2, 0.133, 0.267);
    scene.ambientColor = new Color3(0.05, 0.05, 0.08);
    new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.12;
    const sun = new DirectionalLight('sun', new Vector3(4, -4, -6), scene);
    sun.diffuse = Color3.FromHexString('#ffaa66'); sun.intensity = 0.25;
    setupShadows(sun, scene);
  }

  addGround(scene);

  const waterMat = new PBRMaterial('mWater', scene);
  if (menuSnow) {
    waterMat.albedoColor = new Color3(0.722, 0.831, 0.890); waterMat.roughness = 0.15;
  } else {
    waterMat.albedoColor = new Color3(0.102, 0.2, 0.333); waterMat.alpha = 0.7; waterMat.roughness = 0.2;
  }
  waterMat.metallic = 0.1;
  const water = MeshBuilder.CreateGround('mWater', { width: 30, height: 20 }, scene);
  water.material = waterMat; water.position = new Vector3(0, -0.08, -6);

  const cam = { x: 4, y: 1.5, z: 5 };
  const look = new Vector3(0, 0.5, -2);
  const charX = rnd(-1, 1), charZ = rnd(-2.5, -1.5);

  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-6, 4, 0, 5, cam.x, cam.z, charX, charZ, 2);
    createTree(p.x, p.z, rnd(1.8, 2.8), scene);
  }
  for (let i = 0; i < rndInt(1, 3); i++) {
    const p = rndAvoid(-4, 3, -2, 1, cam.x, cam.z, charX, charZ, 1.5);
    createRock(p.x, p.z, rnd(0.2, 0.5), scene);
  }

  const useFox = Math.random() < 0.4;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ], rot: Math.PI + rnd(-0.3, 0.3),
      scale: useFox ? CFG.FOX_H : CFG.SOLDIER_H,
    },
  };
}

function templateForestFox(scene) {
  scene.clearColor = new Color4(0.102, 0.165, 0.102, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.05;
  scene.fogColor = new Color3(0.102, 0.165, 0.102);
  scene.ambientColor = new Color3(0.15, 0.2, 0.15);

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
  const sun = new DirectionalLight('sun', new Vector3(-3, -8, -4), scene);
  sun.diffuse = Color3.FromHexString('#ffeedd'); sun.intensity = 0.8;
  setupShadows(sun, scene);

  addGround(scene);

  const cam = { x: 5, y: 1.5, z: 5 };
  const look = new Vector3(0, 0.3, 0);
  const charX = rnd(-0.5, 0.5), charZ = rnd(-0.5, 0.5);

  const treeCount = rndInt(6, 9);
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + rnd(-0.3, 0.3);
    const dist = rnd(4, 7);
    const tx = Math.cos(angle) * dist, tz = Math.sin(angle) * dist;
    if (!isOnPath(tx, tz, cam.x, cam.z, charX, charZ, 2.5)) {
      createTree(tx, tz, rnd(1.8, 3.0), scene);
    }
  }
  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-3, 3, -3, 3, cam.x, cam.z, charX, charZ, 2);
    createRock(p.x, p.z, rnd(0.15, 0.4), scene);
  }

  return {
    baseCam: cam, lookAt: look,
    character: {
      url: './assets/models/Fox.glb', anim: /survey/i,
      pos: [charX, 0, charZ], rot: rnd(0, Math.PI * 2), scale: CFG.FOX_H,
    },
  };
}

function templateRockyDay(scene) {
  scene.clearColor = new Color4(0.467, 0.533, 0.6, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.025;
  scene.fogColor = new Color3(0.467, 0.533, 0.6);
  scene.ambientColor = new Color3(0.3, 0.3, 0.35);

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
  const sun = new DirectionalLight('sun', new Vector3(-5, -10, -3), scene);
  sun.diffuse = new Color3(1, 1, 1); sun.intensity = 1.0;
  setupShadows(sun, scene);

  addGround(scene);

  const cam = { x: 5, y: 1.8, z: 6 };
  const look = new Vector3(0, 0.8, 0);
  const charX = rnd(0.5, 1.5), charZ = rnd(-0.5, 0.5);

  for (let i = 0; i < rndInt(4, 7); i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = rnd(0.5, 2.5);
    const rx = Math.cos(angle) * dist, rz = Math.sin(angle) * dist;
    if (!isOnPath(rx, rz, cam.x, cam.z, charX, charZ, 1.5)) {
      createRock(rx, rz, rnd(0.5, 1.5), scene);
    }
  }
  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-8, -2, -6, 3, cam.x, cam.z, charX, charZ, 2.5);
    createTree(p.x, p.z, rnd(2.0, 3.0), scene);
  }

  const useFox = Math.random() < 0.3;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ], rot: Math.PI * rnd(0.3, 0.7),
      scale: useFox ? CFG.FOX_H : CFG.SOLDIER_H,
    },
  };
}

// --- Campfire animation state ---
let campfireFlames = [];
let campfireEmbers = [];
let campfireLight = null;
let campfireLightBase = 0;

function updateCampfire(dt) {
  if (!campfireFlames.length) return;
  const t = performance.now() * 0.001;

  for (const f of campfireFlames) {
    const wave = Math.sin(t * f.speed + f.phase);
    const wave2 = Math.cos(t * f.speed * 1.3 + f.phase * 0.7);
    f.mesh.position.y = f.baseY + wave * 0.04;
    f.mesh.position.x = f.baseX + wave2 * 0.03;
    const sc = f.baseScale * (0.85 + 0.3 * Math.sin(t * f.speed * 0.8 + f.phase));
    f.mesh.scaling = new Vector3(sc, sc * (1.0 + wave * 0.2), sc);
    f.mesh.material.alpha = 0.5 + 0.4 * Math.sin(t * f.speed * 1.2 + f.phase * 2);
  }

  for (const e of campfireEmbers) {
    e.life -= dt;
    if (e.life <= 0) {
      e.mesh.position = new Vector3(rnd(-0.15, 0.15), rnd(0.2, 0.4), rnd(-0.15, 0.15));
      e.vx = rnd(-0.2, 0.2); e.vy = rnd(0.8, 1.8); e.vz = rnd(-0.2, 0.2);
      e.life = e.maxLife = rnd(1.0, 2.5);
    }
    e.mesh.position.x += e.vx * dt;
    e.mesh.position.y += e.vy * dt;
    e.mesh.position.z += e.vz * dt;
    e.vx += rnd(-2, 2) * dt;
    const frac = e.life / e.maxLife;
    e.mesh.material.alpha = frac * 0.9;
    const sc = 0.04 + 0.06 * frac;
    e.mesh.scaling = new Vector3(sc, sc, sc);
  }

  if (campfireLight) {
    campfireLight.intensity = campfireLightBase + Math.sin(t * 8) * 0.5 + Math.sin(t * 13) * 0.3 + Math.sin(t * 21) * 0.15;
  }
}

function templateCampfire(scene) {
  scene.clearColor = new Color4(0.02, 0.02, 0.031, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.06;
  scene.fogColor = new Color3(0.02, 0.02, 0.031);
  scene.ambientColor = new Color3(0.04, 0.04, 0.08);

  addGround(scene);

  const fx = 0, fz = 0;

  // Rock ring
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd(-0.15, 0.15);
    const rd = rnd(0.42, 0.52);
    createRock(fx + Math.cos(a) * rd, fz + Math.sin(a) * rd, rnd(0.08, 0.14), scene);
  }
  menuColliders.push({ x: fx, z: fz, r: 0.7 });

  // Crossed logs
  const logMat = new PBRMaterial('mLog', scene);
  logMat.albedoTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
  logMat.roughness = 0.9; logMat.metallic = 0;
  logMat.emissiveColor = new Color3(0.2, 0.067, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + rnd(-0.2, 0.2);
    const log = MeshBuilder.CreateCylinder('log', { diameterTop: 0.08, diameterBottom: 0.1, height: 0.55, tessellation: 5 }, scene);
    log.material = logMat;
    log.position = new Vector3(fx, 0.06, fz);
    log.rotation = new Vector3(0, a, rnd(0.15, 0.35));
  }

  // Charred base
  const charMat = new PBRMaterial('mChar', scene);
  charMat.albedoColor = new Color3(0.067, 0.067, 0.067);
  charMat.emissiveColor = new Color3(0.133, 0.031, 0);
  charMat.roughness = 1; charMat.metallic = 0;
  const charBase = MeshBuilder.CreateDisc('charBase', { radius: 0.3, tessellation: 8 }, scene);
  charBase.material = charMat;
  charBase.rotation = new Vector3(Math.PI / 2, 0, 0);
  charBase.position = new Vector3(fx, 0.005, fz);

  // Fire — use billboarded planes instead of sprites
  campfireFlames = [];
  const flameConfigs = [
    { y: 0.28, scale: 0.4, speed: 4.5 },
    { y: 0.38, scale: 0.32, speed: 5.5 },
    { y: 0.48, scale: 0.22, speed: 6.5 },
    { y: 0.22, scale: 0.35, speed: 3.8 },
    { y: 0.32, scale: 0.28, speed: 5.0 },
  ];
  const pTex = getSoftParticleTex(scene);
  for (const fc of flameConfigs) {
    const mat = new StandardMaterial('flameMat', scene);
    mat.emissiveColor = new Color3(1.0, rnd(0.3, 0.6), 0);
    mat.disableLighting = true;
    mat.opacityTexture = pTex;
    mat.alphaMode = 1; // ALPHA_ADD
    const plane = MeshBuilder.CreatePlane('flame', { size: fc.scale }, scene);
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position = new Vector3(fx + rnd(-0.05, 0.05), fc.y, fz + rnd(-0.05, 0.05));
    plane.isPickable = false;
    campfireFlames.push({
      mesh: plane, baseY: fc.y, baseX: plane.position.x,
      phase: rnd(0, Math.PI * 2), speed: fc.speed, baseScale: fc.scale,
    });
  }

  // Glowing ember core
  const coreMat = new PBRMaterial('mCore', scene);
  coreMat.albedoColor = Color3.FromHexString('#ff4400');
  coreMat.emissiveColor = Color3.FromHexString('#ff6600');
  coreMat.roughness = 1; coreMat.metallic = 0;
  const core = MeshBuilder.CreateIcoSphere('core', { radius: 0.08, subdivisions: 0 }, scene);
  core.material = coreMat; core.position = new Vector3(fx, 0.12, fz);

  // Floating ember particles
  campfireEmbers = [];
  for (let i = 0; i < 12; i++) {
    const mat = new StandardMaterial('emberMat', scene);
    mat.emissiveColor = new Color3(1.0, rnd(0.4, 0.8), 0);
    mat.disableLighting = true;
    mat.opacityTexture = pTex;
    mat.alphaMode = 1; // ALPHA_ADD
    const sc = rnd(0.03, 0.08);
    const plane = MeshBuilder.CreatePlane('ember', { size: sc }, scene);
    plane.material = mat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.position = new Vector3(fx + rnd(-0.15, 0.15), rnd(0.2, 1.0), fz + rnd(-0.15, 0.15));
    plane.isPickable = false;
    campfireEmbers.push({
      mesh: plane,
      vx: rnd(-0.2, 0.2), vy: rnd(0.8, 1.8), vz: rnd(-0.2, 0.2),
      life: rnd(0.3, 2.5), maxLife: rnd(1.0, 2.5),
    });
  }

  // Warm ground glow
  const glowMat = new PBRMaterial('mGlow', scene);
  glowMat.albedoColor = new Color3(0, 0, 0);
  glowMat.emissiveColor = Color3.FromHexString('#ff6622');
  glowMat.alpha = 0.3; glowMat.roughness = 1; glowMat.metallic = 0;
  const glowDisc = MeshBuilder.CreateDisc('glow', { radius: 1.5, tessellation: 16 }, scene);
  glowDisc.material = glowMat;
  glowDisc.rotation = new Vector3(Math.PI / 2, 0, 0);
  glowDisc.position = new Vector3(fx, 0.01, fz);

  // Lights
  campfireLightBase = 1.5;
  campfireLight = new PointLight('fireLight', new Vector3(fx, 0.6, fz), scene);
  campfireLight.diffuse = Color3.FromHexString('#ff8833');
  campfireLight.intensity = campfireLightBase; campfireLight.range = 10;

  const fillLight = new PointLight('fireFill', new Vector3(fx, 0.15, fz), scene);
  fillLight.diffuse = Color3.FromHexString('#ff6622');
  fillLight.intensity = 0.5; fillLight.range = 6;

  const charAngle = rnd(-0.6, 0.6);
  const charDist = rnd(1.5, 2.0);
  const charX = fx + Math.sin(charAngle) * charDist;
  const charZ = fz - Math.cos(charAngle) * charDist;
  const dirToFire = Math.atan2(fx - charX, fz - charZ);

  const cam = { x: 3, y: 1.2, z: 4 };
  const look = new Vector3(0, 0.4, 0);

  for (let i = 0; i < rndInt(3, 5); i++) {
    const p = rndAvoid(-6, 4, -7, -2, cam.x, cam.z, charX, charZ, 2);
    createTree(p.x, p.z, rnd(1.8, 2.8), scene);
  }
  for (let i = 0; i < rndInt(1, 2); i++) {
    const p = rndAvoid(-6, -2, -2, 3, cam.x, cam.z, charX, charZ, 2);
    createTree(p.x, p.z, rnd(1.6, 2.4), scene);
  }

  const useFox = Math.random() < 0.3;
  const faceRot = useFox ? dirToFire : dirToFire + Math.PI;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ], rot: faceRot,
      scale: useFox ? CFG.FOX_H : CFG.SOLDIER_H,
    },
  };
}

// ==================== TEMPLATE REGISTRY ====================

const TEMPLATES = [
  templateShelterNight,
  templateLakeside,
  templateForestFox,
  templateRockyDay,
  templateCampfire,
];

// ==================== EVENT HANDLERS ====================

function onMouseMove(e) {
  if (disposed) return;
  mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
  mouseY = (e.clientY / window.innerHeight - 0.5) * 2;

  if (menuCamera && camBase) {
    menuCamera.position = new Vector3(
      camBase.x + mouseX * 0.5,
      camBase.y - mouseY * 0.3,
      camBase.z
    );
    menuCamera.setTarget(camLookAt);
  }

  const panel = document.getElementById('menu-panel');
  if (panel) {
    panel.style.transform = `translate(${mouseX * 12}px, ${mouseY * 8}px)`;
  }
}

function onMenuKeyDown(e) {
  if (disposed) return;
  menuKeys[e.code] = true;
}

function onMenuKeyUp(e) {
  menuKeys[e.code] = false;
}

// ==================== PUBLIC API ====================

export function initMenuScene() {
  disposed = false;
  menuColliders = [];
  menuBoxColliders = [];
  menuCharModel = null;
  menuCharActions = {};
  menuCharCurrentAction = null;
  menuKeys = {};
  campfireFlames = [];
  campfireEmbers = [];
  campfireLight = null;

  menuSnow = Math.random() < 0.5;

  const engine = getEngine();
  menuScene = new Scene(engine);
  menuScene.useRightHandedSystem = true;
  menuScene.skipPointerMovePicking = true;
  menuScene.pointerMovePredicate = () => false;
  // PBR materials need an environment texture to show colors properly (not grey)
  menuScene.createDefaultEnvironment({ createGround: false, createSkybox: false });

  initMaterials(menuScene);

  // Pick random template
  let lastIdx = -1;
  try { lastIdx = parseInt(localStorage.getItem('menuLastTemplate') || '-1', 10); } catch (e) {}
  let idx;
  do { idx = Math.floor(Math.random() * TEMPLATES.length); } while (idx === lastIdx && TEMPLATES.length > 1);
  try { localStorage.setItem('menuLastTemplate', String(idx)); } catch (e) {}

  const config = TEMPLATES[idx](menuScene);

  // Scale IBL environment intensity based on scene brightness so night scenes stay dark
  const cc = menuScene.clearColor;
  const brightness = cc.r * 0.299 + cc.g * 0.587 + cc.b * 0.114;
  menuScene.environmentIntensity = brightness < 0.25 ? 0.0 : 0.6;

  camBase = { x: config.baseCam.x, y: config.baseCam.y, z: config.baseCam.z };
  camLookAt = config.lookAt;

  menuCamera = new FreeCamera('menuCam', new Vector3(camBase.x, camBase.y, camBase.z), menuScene);
  menuCamera.fov = 50 * Math.PI / 180;
  menuCamera.minZ = 0.1; menuCamera.maxZ = 120;
  menuCamera.inputs.clear();
  menuCamera.setTarget(camLookAt);
  menuScene.activeCamera = menuCamera;

  // Load character model
  if (config.character) {
    const ch = config.character;
    const isFox = ch.url.includes('Fox');
    menuCharFacingOffset = isFox ? 0 : Math.PI;
    menuCharFacing = ch.rot - menuCharFacingOffset;
    menuCharPos = { x: ch.pos[0], y: 0, z: ch.pos[2] };

    SceneLoader.ImportMeshAsync('', ch.url, '', menuScene).then(result => {
      if (disposed) return;
      const meshes = result.meshes;
      const animGroups = result.animationGroups;
      const rootMesh = meshes[0];

      // Strip unused UV channels (uv2–uv6) to stay within WebGPU's 8 vertex buffer limit
      for (const m of meshes) {
        if (!m.geometry) continue;
        for (const kind of ['uv2', 'uv3', 'uv4', 'uv5', 'uv6']) {
          if (m.isVerticesDataPresent(kind)) m.removeVerticesData(kind);
        }
      }

      // Normalize scale
      rootMesh.scaling = new Vector3(1, 1, 1);
      rootMesh.computeWorldMatrix(true);
      for (const m of rootMesh.getChildMeshes()) m.computeWorldMatrix(true);
      const bounds = rootMesh.getHierarchyBoundingVectors(true);
      const geoH = bounds.max.y - bounds.min.y;
      if (geoH > 0) {
        const s = ch.scale / geoH;
        rootMesh.scaling = new Vector3(s, s, s);
      }

      // Tint soldier with random hue
      if (!isFox) {
        for (const mesh of rootMesh.getChildMeshes()) {
          if (mesh.material) {
            mesh.material = mesh.material.clone(mesh.material.name + '_menu');
            if (mesh.material.albedoColor) {
              const hue = Math.random();
              // Simple HSL-like tint
              const r = 0.75 + 0.2 * Math.cos(hue * Math.PI * 2);
              const g = 0.75 + 0.2 * Math.cos(hue * Math.PI * 2 + 2.09);
              const b = 0.75 + 0.2 * Math.cos(hue * Math.PI * 2 + 4.19);
              const c = mesh.material.albedoColor;
              mesh.material.albedoColor = new Color3(c.r * r, c.g * g, c.b * b);
            }
          }
        }
      }

      rootMesh.position = new Vector3(ch.pos[0], ch.pos[1], ch.pos[2]);
      rootMesh.rotation = new Vector3(0, ch.rot, 0);

      menuCharModel = rootMesh;
      menuMixer = createAnimMixer(animGroups);

      const idleGroup = animGroups.find(c => /idle|survey/i.test(c.name)) || animGroups[0];
      const walkGroup = animGroups.find(c => /walk/i.test(c.name)) || animGroups[1] || idleGroup;

      menuCharActions.idle = menuMixer.clipAction(idleGroup);
      menuCharActions.walk = menuMixer.clipAction(walkGroup);

      if (menuCharActions.walk && menuCharActions.walk._group) {
        menuCharActions.walk.timeScale = 0.9;
      }

      // Start all groups playing with weight control
      if (idleGroup) { idleGroup.play(true); idleGroup.setWeightForAllAnimatables(1); }
      if (walkGroup && walkGroup !== idleGroup) { walkGroup.play(true); walkGroup.setWeightForAllAnimatables(0); }

      menuCharActions.idle.play();
      menuCharCurrentAction = menuCharActions.idle;
    }).catch(err => {
      console.warn('Menu character load failed:', err);
    });
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onMenuKeyDown);
  document.addEventListener('keyup', onMenuKeyUp);
}

export function renderMenu(engine, dt) {
  if (!menuScene || !menuCamera) return;
  if (menuMixer && dt) menuMixer.update(dt);
  updateMenuCharacter(dt);
  if (dt) updateCampfire(dt);
  menuScene.render();
}

export function disposeMenu() {
  disposed = true;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('keydown', onMenuKeyDown);
  document.removeEventListener('keyup', onMenuKeyUp);

  const panel = document.getElementById('menu-panel');
  if (panel) panel.style.transform = '';

  // Don't call menuScene.dispose() — WebGPU may still reference textures in
  // in-flight command buffers, causing "Destroyed texture" errors.  Just stop
  // rendering; the scene and its resources will be GC'd when all refs are cleared.
  menuScene = null;
  menuCamera = null;
  menuMixer = null;
  menuCharModel = null;
  menuCharActions = {};
  menuCharCurrentAction = null;
  menuKeys = {};
  menuColliders = [];
  menuBoxColliders = [];
  campfireFlames = [];
  campfireEmbers = [];
  campfireLight = null;
}
