import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let menuScene, menuCamera, menuMixer;
let mouseX = 0, mouseY = 0;
let disposed = false;
let camBase, camLookAt;
let menuSnow = false;

// Menu character control
let menuCharModel = null;
let menuCharActions = {};
let menuCharCurrentAction = null;
let menuCharPos = new THREE.Vector3();
let menuCharFacing = 0;
let menuCharFacingOffset = Math.PI; // PI for soldier, 0 for fox
const MENU_CHAR_SPEED = 4;
const MENU_CHAR_R = 0.35;
let menuKeys = {};
let menuColliders = [];     // { x, z, r }
let menuBoxColliders = [];  // { xMin, xMax, zMin, zMax }

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));

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

// --- Shared texture loader & materials ---
const texLoader = new THREE.TextureLoader();

function loadTex(path, rx, ry) {
  const tex = texLoader.load(path);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let wallMat, groundMat, trunkMat, leafMat, rockMat, roofMat;

function initMaterials() {
  wallMat = new THREE.MeshStandardMaterial({ map: loadTex('./assets/textures/stone_wall.jpg', 1, 1), roughness: 0.9 });
  trunkMat = new THREE.MeshStandardMaterial({ map: loadTex('./assets/textures/bark.jpg', 1, 2), roughness: 0.95 });
  rockMat = new THREE.MeshStandardMaterial({ map: loadTex('./assets/textures/stone_wall.jpg', 1, 1), roughness: 0.95, flatShading: true });
  roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.85, side: THREE.DoubleSide });

  if (menuSnow) {
    groundMat = new THREE.MeshStandardMaterial({ color: 0xdde4e8, roughness: 0.85 });
    leafMat = new THREE.MeshStandardMaterial({ color: 0xc8cdd0, roughness: 0.9, flatShading: true });
  } else {
    groundMat = new THREE.MeshStandardMaterial({ map: loadTex('./assets/textures/grass.jpg', 6, 6), roughness: 0.95 });
    leafMat = new THREE.MeshStandardMaterial({ color: 0x3a8a3a, roughness: 0.9, flatShading: true });
  }
}

// --- Visibility & Collision helpers ---

const _projCheck = new THREE.Vector3();

/** Check if a ground position is within the camera's visible area (with margin) */
function isInCameraView(x, z) {
  _projCheck.set(x, 0.5, z);
  _projCheck.project(menuCamera);
  // Reject if behind camera or outside NDC bounds with margin
  return _projCheck.z < 1 && Math.abs(_projCheck.x) < 0.9 && Math.abs(_projCheck.y) < 0.85;
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

function createTree(x, z, scale) {
  const group = new THREE.Group();
  const s = scale || rnd(1.4, 2.6);
  const trunkH = rnd(1.5, 2.2), trunkR = rnd(0.12, 0.18);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6), trunkMat);
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0, n = rndInt(3, 5); i < n; i++) {
    const frac = 1 - i / n;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(rnd(0.8, 1.3) * (0.25 + 0.75 * frac), 0.25), rnd(0.8, 1.3), 6),
      leafMat
    );
    cone.position.y = trunkH + i * rnd(0.45, 0.65);
    cone.castShadow = true;
    cone.receiveShadow = true;
    group.add(cone);
  }
  group.scale.set(s, s, s);
  group.position.set(x, 0, z);
  // Register collider (trunk + canopy footprint)
  menuColliders.push({ x, z, r: s * 0.35 });
  return group;
}

function createRock(x, z, size) {
  const s = size || rnd(0.2, 0.8);
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 1), rockMat);
  rock.position.set(x, s * 0.35, z);
  rock.rotation.set(rnd(0, Math.PI), rnd(0, Math.PI), 0);
  rock.castShadow = true;
  rock.receiveShadow = true;
  // Register collider
  if (s > 0.15) menuColliders.push({ x, z, r: s * 0.85 });
  return rock;
}

function addGround(scene, size) {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size || 40, size || 40), groundMat);
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);
}

function setupShadows(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.left = -12;
  light.shadow.camera.right = 12;
  light.shadow.camera.top = 12;
  light.shadow.camera.bottom = -12;
  light.shadow.bias = -0.002;
}

// --- Shelter builder (used by shelter template) ---

function buildShelter(scene) {
  const wallH = 3.5, wallT = 0.5;
  const shelterW = rnd(5, 7), shelterD = rnd(4, 5.5);
  const cx = rnd(-1.5, 0), cz = rnd(-3, -2);

  const back = new THREE.Mesh(new THREE.BoxGeometry(shelterW, wallH, wallT), wallMat);
  back.position.set(cx, wallH / 2, cz - shelterD / 2);
  back.castShadow = true; back.receiveShadow = true;
  scene.add(back);

  const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, shelterD), wallMat);
  left.position.set(cx - shelterW / 2 + wallT / 2, wallH / 2, cz);
  left.castShadow = true; left.receiveShadow = true;
  scene.add(left);

  const rightLen = shelterD * rnd(0.4, 0.6);
  const right = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, rightLen), wallMat);
  right.position.set(cx + shelterW / 2 - wallT / 2, wallH / 2, cz - shelterD / 2 + rightLen / 2);
  right.castShadow = true; right.receiveShadow = true;
  scene.add(right);

  // Register wall box colliders
  menuBoxColliders.push(
    { xMin: cx - shelterW / 2, xMax: cx + shelterW / 2, zMin: cz - shelterD / 2 - wallT / 2, zMax: cz - shelterD / 2 + wallT / 2 },
    { xMin: cx - shelterW / 2, xMax: cx - shelterW / 2 + wallT, zMin: cz - shelterD / 2, zMax: cz + shelterD / 2 },
    { xMin: cx + shelterW / 2 - wallT, xMax: cx + shelterW / 2, zMin: cz - shelterD / 2, zMax: cz - shelterD / 2 + rightLen },
  );

  // Gable roof
  const oh = 0.6, span = shelterW + oh * 2, len = shelterD + oh * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0); shape.lineTo(0, 1.6); shape.lineTo(span / 2, 0); shape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  roofGeo.translate(0, 0, -len / 2);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(cx, wallH, cz);
  roof.rotation.y = Math.PI / 2;
  roof.castShadow = true; roof.receiveShadow = true;
  scene.add(roof);

  // Torch near doorway
  const doorEdgeZ = cz - shelterD / 2 + rightLen;
  const torchX = cx + shelterW / 2 - wallT / 2 - 0.15;
  const torchZ = doorEdgeZ - 0.3;

  const stick = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.45, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x553311, roughness: 0.9 })
  );
  stick.position.set(torchX, 1.65, torchZ);
  scene.add(stick);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 6, 4),
    new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 2 })
  );
  flame.position.set(torchX, 1.9, torchZ);
  scene.add(flame);

  const tl = new THREE.PointLight(0xff8833, 4, 12, 1.5);
  tl.position.set(torchX + 0.3, 1.9, torchZ + 0.5);
  scene.add(tl);

  // Fill light at doorway
  const dl = new THREE.PointLight(0xffaa66, 2, 8, 2);
  dl.position.set(cx + shelterW / 2 + 0.5, 1.2, doorEdgeZ + 1.0);
  scene.add(dl);

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
  const camFwd = new THREE.Vector3();
  menuCamera.getWorldDirection(camFwd);
  camFwd.y = 0;
  camFwd.normalize();
  const camRight = new THREE.Vector3(-camFwd.z, 0, camFwd.x);

  const mv = new THREE.Vector3();
  if (menuKeys['KeyW']) mv.add(camFwd);
  if (menuKeys['KeyS']) mv.sub(camFwd);
  if (menuKeys['KeyA']) mv.sub(camRight);
  if (menuKeys['KeyD']) mv.add(camRight);

  const moving = mv.lengthSq() > 0;

  if (moving) {
    mv.normalize();
    const targetAngle = Math.atan2(mv.x, mv.z);

    // Smooth rotation
    let diff = targetAngle - menuCharFacing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    menuCharFacing += diff * Math.min(1, dt * 12);

    const speed = MENU_CHAR_SPEED * dt;
    const nx = menuCharPos.x + mv.x * speed;
    const nz = menuCharPos.z + mv.z * speed;

    // Per-axis collision + camera boundary
    if (!collidesMenu(nx, menuCharPos.z, MENU_CHAR_R) && isInCameraView(nx, menuCharPos.z)) menuCharPos.x = nx;
    if (!collidesMenu(menuCharPos.x, nz, MENU_CHAR_R) && isInCameraView(menuCharPos.x, nz)) menuCharPos.z = nz;
  }

  // Animation crossfade
  if (moving && menuCharCurrentAction !== menuCharActions.walk) {
    crossfadeMenu(menuCharCurrentAction, menuCharActions.walk);
  } else if (!moving && menuCharCurrentAction !== menuCharActions.idle) {
    crossfadeMenu(menuCharCurrentAction, menuCharActions.idle);
  }

  // Update model position and facing
  menuCharModel.position.set(menuCharPos.x, 0, menuCharPos.z);
  menuCharModel.rotation.y = menuCharFacing + menuCharFacingOffset;
}

// ==================== SCENE TEMPLATES ====================

function templateShelterNight(scene) {
  scene.background = new THREE.Color(0x060610);
  scene.fog = new THREE.FogExp2(0x060610, 0.03);

  scene.add(new THREE.AmbientLight(0x1a1a30, 0.5));
  scene.add(new THREE.HemisphereLight(0x1a2244, 0x111108, 0.3));
  const moon = new THREE.DirectionalLight(0x8899cc, 0.3);
  moon.position.set(-5, 10, 5);
  setupShadows(moon);
  scene.add(moon); scene.add(moon.target);

  addGround(scene);
  const s = buildShelter(scene);

  // Interior floor
  const floorGeo = new THREE.PlaneGeometry(s.shelterW - s.wallT * 2, s.shelterD - s.wallT);
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    map: loadTex('./assets/textures/stone_wall.jpg', 2, 2), roughness: 0.85,
  }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(s.cx, 0.01, s.cz + s.wallT / 2);
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);

  // Extra interior light — warm fill bouncing off walls
  const interiorFill = new THREE.PointLight(0xffaa66, 3, 10, 1.5);
  interiorFill.position.set(s.cx, 2.0, s.cz);
  scene.add(interiorFill);

  // Back wall light — prevents completely black back wall
  const backWallLight = new THREE.PointLight(0xff9944, 2, 8, 2);
  backWallLight.position.set(s.cx, 1.5, s.cz - s.shelterD / 2 + s.wallT + 0.5);
  scene.add(backWallLight);

  // Soldier inside near torch, facing slightly toward camera
  const charX = s.torchX - rnd(0.4, 0.8);
  const charZ = s.torchZ + rnd(0.1, 0.4);

  // Camera inside shelter, near left-back corner, looking toward soldier/torch
  const camX = s.cx - s.shelterW / 2 + s.wallT + rnd(0.6, 1.2);
  const camZ = s.cz - s.shelterD / 2 + s.wallT + rnd(0.5, 1.0);
  const cam = { x: camX, y: 1.5, z: camZ };
  const look = new THREE.Vector3(charX, 1.0, charZ);

  // Some trees visible outside through the doorway
  for (let i = 0; i < rndInt(2, 4); i++) {
    const tx = s.cx + s.shelterW / 2 + rnd(2, 6);
    const tz = s.cz + rnd(-3, 3);
    scene.add(createTree(tx, tz, rnd(1.8, 2.8)));
  }
  for (let i = 0; i < rndInt(1, 3); i++) {
    const rx = s.cx + s.shelterW / 2 + rnd(1, 4);
    const rz = s.cz + rnd(-2, 2);
    scene.add(createRock(rx, rz, rnd(0.15, 0.4)));
  }

  // Soldier faces slightly toward camera (away from wall)
  const faceRot = Math.atan2(camX - charX, camZ - charZ) + Math.PI + rnd(-0.3, 0.3);

  return {
    baseCam: cam, lookAt: look,
    character: {
      url: './assets/models/Soldier.glb', anim: /idle/i,
      pos: [charX, 0, charZ], rot: faceRot, scale: 0.6,
    },
  };
}

function templateLakeside(scene) {
  const isDay = Math.random() < 0.5;
  if (isDay) {
    scene.background = new THREE.Color(0x6688aa);
    scene.fog = new THREE.FogExp2(0x6688aa, 0.03);
    scene.add(new THREE.AmbientLight(0x889999, 0.6));
    scene.add(new THREE.HemisphereLight(0x88aacc, 0x445522, 0.5));
    const sun = new THREE.DirectionalLight(0xffeedd, 0.9);
    sun.position.set(4, 8, 5);
    setupShadows(sun); scene.add(sun); scene.add(sun.target);
  } else {
    scene.background = new THREE.Color(0x332244);
    scene.fog = new THREE.FogExp2(0x332244, 0.035);
    scene.add(new THREE.AmbientLight(0x443355, 0.5));
    scene.add(new THREE.HemisphereLight(0x665544, 0x222211, 0.4));
    const sun = new THREE.DirectionalLight(0xffaa66, 0.8);
    sun.position.set(-4, 4, 6);
    setupShadows(sun); scene.add(sun); scene.add(sun.target);
  }

  addGround(scene);

  // Water plane (or ice in snow mode)
  const waterMat = menuSnow
    ? new THREE.MeshStandardMaterial({ color: 0xb8d4e3, roughness: 0.15, metalness: 0.1 })
    : new THREE.MeshStandardMaterial({ color: 0x1a3355, transparent: true, opacity: 0.7, roughness: 0.2, metalness: 0.1 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.08, -6);
  scene.add(water);

  const cam = { x: 4, y: 1.5, z: 5 };
  const look = new THREE.Vector3(0, 0.5, -2);
  const charX = rnd(-1, 1), charZ = rnd(-2.5, -1.5);

  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-6, 4, 0, 5, cam.x, cam.z, charX, charZ, 2);
    scene.add(createTree(p.x, p.z, rnd(1.8, 2.8)));
  }
  for (let i = 0; i < rndInt(1, 3); i++) {
    const p = rndAvoid(-4, 3, -2, 1, cam.x, cam.z, charX, charZ, 1.5);
    scene.add(createRock(p.x, p.z, rnd(0.2, 0.5)));
  }

  const useFox = Math.random() < 0.4;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ],
      rot: Math.PI + rnd(-0.3, 0.3),
      scale: useFox ? 1.6 : 0.6,
    },
  };
}

function templateForestFox(scene) {
  scene.background = new THREE.Color(0x1a2a1a);
  scene.fog = new THREE.FogExp2(0x1a2a1a, 0.05);

  scene.add(new THREE.AmbientLight(0x446644, 0.6));
  scene.add(new THREE.HemisphereLight(0x88aacc, 0x334422, 0.5));
  const sun = new THREE.DirectionalLight(0xffeedd, 0.8);
  sun.position.set(3, 8, 4);
  setupShadows(sun); scene.add(sun); scene.add(sun.target);

  addGround(scene);

  const cam = { x: 5, y: 1.5, z: 5 };
  const look = new THREE.Vector3(0, 0.3, 0);
  const charX = rnd(-0.5, 0.5), charZ = rnd(-0.5, 0.5);

  // Ring of trees around a clearing
  const treeCount = rndInt(6, 9);
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + rnd(-0.3, 0.3);
    const dist = rnd(4, 7);
    const tx = Math.cos(angle) * dist, tz = Math.sin(angle) * dist;
    if (!isOnPath(tx, tz, cam.x, cam.z, charX, charZ, 2.5)) {
      scene.add(createTree(tx, tz, rnd(1.8, 3.0)));
    }
  }
  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-3, 3, -3, 3, cam.x, cam.z, charX, charZ, 2);
    scene.add(createRock(p.x, p.z, rnd(0.15, 0.4)));
  }

  return {
    baseCam: cam, lookAt: look,
    character: {
      url: './assets/models/Fox.glb', anim: /survey/i,
      pos: [charX, 0, charZ], rot: rnd(0, Math.PI * 2), scale: 1.6,
    },
  };
}

function templateRockyDay(scene) {
  scene.background = new THREE.Color(0x778899);
  scene.fog = new THREE.FogExp2(0x778899, 0.025);

  scene.add(new THREE.AmbientLight(0x8899aa, 0.7));
  scene.add(new THREE.HemisphereLight(0xaabbdd, 0x445533, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 10, 3);
  setupShadows(sun); scene.add(sun); scene.add(sun.target);

  addGround(scene);

  const cam = { x: 5, y: 1.8, z: 6 };
  const look = new THREE.Vector3(0, 0.8, 0);
  const charX = rnd(0.5, 1.5), charZ = rnd(-0.5, 0.5);

  // Cluster of large rocks
  for (let i = 0; i < rndInt(4, 7); i++) {
    const angle = rnd(0, Math.PI * 2);
    const dist = rnd(0.5, 2.5);
    const rx = Math.cos(angle) * dist, rz = Math.sin(angle) * dist;
    if (!isOnPath(rx, rz, cam.x, cam.z, charX, charZ, 1.5)) {
      scene.add(createRock(rx, rz, rnd(0.5, 1.5)));
    }
  }
  for (let i = 0; i < rndInt(2, 4); i++) {
    const p = rndAvoid(-8, -2, -6, 3, cam.x, cam.z, charX, charZ, 2.5);
    scene.add(createTree(p.x, p.z, rnd(2.0, 3.0)));
  }

  const useFox = Math.random() < 0.3;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ],
      rot: Math.PI * rnd(0.3, 0.7),
      scale: useFox ? 1.6 : 0.6,
    },
  };
}

// --- Campfire animation state ---
let campfireFlames = [];   // { mesh, baseY, phase, speed, baseScale }
let campfireEmbers = [];   // { mesh, vel, life, maxLife }
let campfireLight = null;
let campfireLightBase = 0;

function createFireTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,220,100,1)');
  grad.addColorStop(0.3, 'rgba(255,140,20,0.8)');
  grad.addColorStop(0.6, 'rgba(255,60,0,0.4)');
  grad.addColorStop(1, 'rgba(100,10,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

function createEmberTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
  grad.addColorStop(0, 'rgba(255,200,50,1)');
  grad.addColorStop(0.5, 'rgba(255,100,0,0.6)');
  grad.addColorStop(1, 'rgba(255,50,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 16);
  return new THREE.CanvasTexture(c);
}

function updateCampfire(dt) {
  if (!campfireFlames.length) return;
  const t = performance.now() * 0.001;

  // Animate flame sprites — flicker, sway, pulse
  for (const f of campfireFlames) {
    const wave = Math.sin(t * f.speed + f.phase);
    const wave2 = Math.cos(t * f.speed * 1.3 + f.phase * 0.7);
    f.mesh.position.y = f.baseY + wave * 0.04;
    f.mesh.position.x = f.baseX + wave2 * 0.03;
    const sc = f.baseScale * (0.85 + 0.3 * Math.sin(t * f.speed * 0.8 + f.phase));
    f.mesh.scale.set(sc, sc * (1.0 + wave * 0.2), sc);
    f.mesh.material.opacity = 0.5 + 0.4 * Math.sin(t * f.speed * 1.2 + f.phase * 2);
  }

  // Animate embers — float upward, fade
  for (const e of campfireEmbers) {
    e.life -= dt;
    if (e.life <= 0) {
      // Reset ember
      e.mesh.position.set(rnd(-0.15, 0.15), rnd(0.2, 0.4), rnd(-0.15, 0.15));
      e.vel.set(rnd(-0.2, 0.2), rnd(0.8, 1.8), rnd(-0.2, 0.2));
      e.life = e.maxLife = rnd(1.0, 2.5);
    }
    e.mesh.position.x += e.vel.x * dt;
    e.mesh.position.y += e.vel.y * dt;
    e.mesh.position.z += e.vel.z * dt;
    e.vel.x += rnd(-2, 2) * dt; // wind wobble
    const frac = e.life / e.maxLife;
    e.mesh.material.opacity = frac * 0.9;
    const sc = 0.04 + 0.06 * frac;
    e.mesh.scale.set(sc, sc, sc);
  }

  // Flicker the light
  if (campfireLight) {
    campfireLight.intensity = campfireLightBase + Math.sin(t * 8) * 0.5 + Math.sin(t * 13) * 0.3 + Math.sin(t * 21) * 0.15;
  }
}

function templateCampfire(scene) {
  scene.background = new THREE.Color(0x050508);
  scene.fog = new THREE.FogExp2(0x050508, 0.06);

  scene.add(new THREE.AmbientLight(0x0a0a15, 0.3));

  addGround(scene);

  const fx = 0, fz = 0;

  // --- Rock ring (10 rocks, varied sizes, tighter circle) ---
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd(-0.15, 0.15);
    const rd = rnd(0.42, 0.52);
    scene.add(createRock(fx + Math.cos(a) * rd, fz + Math.sin(a) * rd, rnd(0.08, 0.14)));
  }
  menuColliders.push({ x: fx, z: fz, r: 0.7 });

  // --- Crossed logs (3 logs with bark texture) ---
  const logMat = new THREE.MeshStandardMaterial({
    map: loadTex('./assets/textures/bark.jpg', 1, 1), roughness: 0.9,
    emissive: 0x331100, emissiveIntensity: 0.3,
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + rnd(-0.2, 0.2);
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.55, 5), logMat);
    log.position.set(fx, 0.06, fz);
    log.rotation.z = rnd(0.15, 0.35);
    log.rotation.y = a;
    log.castShadow = true;
    scene.add(log);
  }

  // --- Charred base (dark disc under fire) ---
  const charMat = new THREE.MeshStandardMaterial({
    color: 0x111111, emissive: 0x220800, emissiveIntensity: 0.5, roughness: 1,
  });
  const charBase = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), charMat);
  charBase.rotation.x = -Math.PI / 2;
  charBase.position.set(fx, 0.005, fz);
  scene.add(charBase);

  // --- Fire sprites (layered, animated) ---
  const fireTex = createFireTexture();
  campfireFlames = [];
  const flameConfigs = [
    { y: 0.28, scale: 0.4, speed: 4.5 },   // core
    { y: 0.38, scale: 0.32, speed: 5.5 },   // mid
    { y: 0.48, scale: 0.22, speed: 6.5 },   // tip
    { y: 0.22, scale: 0.35, speed: 3.8 },   // side flame 1
    { y: 0.32, scale: 0.28, speed: 5.0 },   // side flame 2
  ];
  for (const fc of flameConfigs) {
    const mat = new THREE.SpriteMaterial({
      map: fireTex, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.7, depthWrite: false,
      color: new THREE.Color().setHSL(rnd(0.04, 0.1), 1, 0.6),
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(fc.scale, fc.scale * 1.4, fc.scale);
    sprite.position.set(fx + rnd(-0.05, 0.05), fc.y, fz + rnd(-0.05, 0.05));
    scene.add(sprite);
    campfireFlames.push({
      mesh: sprite, baseY: fc.y, baseX: sprite.position.x,
      phase: rnd(0, Math.PI * 2), speed: fc.speed, baseScale: fc.scale,
    });
  }

  // --- Glowing ember core (small bright mesh in center) ---
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff4400, emissive: 0xff6600, emissiveIntensity: 4, roughness: 1,
  });
  const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), coreMat);
  core.position.set(fx, 0.12, fz);
  scene.add(core);

  // --- Floating ember particles ---
  const emberTex = createEmberTexture();
  campfireEmbers = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({
      map: emberTex, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.8, depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    const sc = rnd(0.03, 0.08);
    sprite.scale.set(sc, sc, sc);
    sprite.position.set(fx + rnd(-0.15, 0.15), rnd(0.2, 1.0), fz + rnd(-0.15, 0.15));
    scene.add(sprite);
    campfireEmbers.push({
      mesh: sprite,
      vel: new THREE.Vector3(rnd(-0.2, 0.2), rnd(0.8, 1.8), rnd(-0.2, 0.2)),
      life: rnd(0.3, 2.5),
      maxLife: rnd(1.0, 2.5),
    });
  }

  // --- Warm ground glow (subtle disc below fire) ---
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xff6622, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.3, roughness: 1,
  });
  const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16), glowMat);
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.set(fx, 0.01, fz);
  scene.add(glowDisc);

  // --- Lights ---
  campfireLightBase = 5;
  campfireLight = new THREE.PointLight(0xff8833, campfireLightBase, 14, 1.5);
  campfireLight.position.set(fx, 0.6, fz);
  scene.add(campfireLight);
  // Secondary fill (warm uplight for character illumination)
  const fillLight = new THREE.PointLight(0xff6622, 2, 8, 2);
  fillLight.position.set(fx, 0.15, fz);
  scene.add(fillLight);

  // Place character at a fixed distance from fire, facing it directly
  const charAngle = rnd(-0.6, 0.6);
  const charDist = rnd(1.5, 2.0);
  const charX = fx + Math.sin(charAngle) * charDist;
  const charZ = fz - Math.cos(charAngle) * charDist;
  const dirToFire = Math.atan2(fx - charX, fz - charZ);

  const cam = { x: 3, y: 1.2, z: 4 };
  const look = new THREE.Vector3(0, 0.4, 0);

  for (let i = 0; i < rndInt(3, 5); i++) {
    const p = rndAvoid(-6, 4, -7, -2, cam.x, cam.z, charX, charZ, 2);
    scene.add(createTree(p.x, p.z, rnd(1.8, 2.8)));
  }
  for (let i = 0; i < rndInt(1, 2); i++) {
    const p = rndAvoid(-6, -2, -2, 3, cam.x, cam.z, charX, charZ, 2);
    scene.add(createTree(p.x, p.z, rnd(1.6, 2.4)));
  }

  const useFox = Math.random() < 0.3;
  const faceRot = useFox ? dirToFire : dirToFire + Math.PI;
  return {
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ],
      rot: faceRot,
      scale: useFox ? 1.6 : 0.6,
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
    menuCamera.position.set(
      camBase.x + mouseX * 0.5,
      camBase.y - mouseY * 0.3,
      camBase.z
    );
    menuCamera.lookAt(camLookAt);
  }

  const panel = document.getElementById('menu-panel');
  if (panel) {
    panel.style.transform = `translate(${mouseX * 12}px, ${mouseY * 8}px)`;
  }
}

function onMenuResize() {
  if (!menuCamera) return;
  menuCamera.aspect = window.innerWidth / window.innerHeight;
  menuCamera.updateProjectionMatrix();
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

  // Randomize snow for menu (50% chance)
  menuSnow = Math.random() < 0.5;

  initMaterials();

  menuScene = new THREE.Scene();

  // Pick a random template (never same as last, persists across reloads)
  let lastIdx = -1;
  try { lastIdx = parseInt(localStorage.getItem('menuLastTemplate') || '-1', 10); } catch (e) {}
  let idx;
  do {
    idx = Math.floor(Math.random() * TEMPLATES.length);
  } while (idx === lastIdx && TEMPLATES.length > 1);
  try { localStorage.setItem('menuLastTemplate', String(idx)); } catch (e) {}
  const template = TEMPLATES[idx];
  const config = template(menuScene);

  camBase = { x: config.baseCam.x, y: config.baseCam.y, z: config.baseCam.z };
  camLookAt = config.lookAt;

  menuCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
  menuCamera.position.set(camBase.x, camBase.y, camBase.z);
  menuCamera.lookAt(camLookAt);

  // Load character model with WASD control
  if (config.character) {
    const ch = config.character;
    const isFox = ch.url.includes('Fox');
    menuCharFacingOffset = isFox ? 0 : Math.PI;
    menuCharFacing = ch.rot - menuCharFacingOffset;
    menuCharPos.set(ch.pos[0], 0, ch.pos[2]);

    const loader = new GLTFLoader();
    loader.load(ch.url, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.scale.multiplyScalar(ch.scale / Math.max(size.x, size.y, size.z));
      model.traverse(c => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (!isFox) {
            c.material = c.material.clone();
            const hue = Math.random();
            c.material.color.multiply(new THREE.Color().setHSL(hue, 0.4, 0.75));
          }
        }
      });
      model.position.set(ch.pos[0], ch.pos[1], ch.pos[2]);
      model.rotation.y = ch.rot;
      menuScene.add(model);

      menuCharModel = model;
      menuMixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations;

      const idleClip = clips.find(c => /idle|survey/i.test(c.name)) || clips[0];
      const walkClip = clips.find(c => /walk/i.test(c.name)) || clips[1] || idleClip;

      menuCharActions.idle = menuMixer.clipAction(idleClip);
      menuCharActions.walk = menuMixer.clipAction(walkClip);

      if (menuCharActions.walk !== menuCharActions.idle) {
        menuCharActions.walk.timeScale = 0.9;
      }

      menuCharActions.idle.play();
      menuCharCurrentAction = menuCharActions.idle;
    });
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onMenuKeyDown);
  document.addEventListener('keyup', onMenuKeyUp);
  window.addEventListener('resize', onMenuResize);
}

export function renderMenu(renderer, dt) {
  if (!menuScene || !menuCamera) return;
  if (menuMixer && dt) menuMixer.update(dt);
  updateMenuCharacter(dt);
  if (dt) updateCampfire(dt);
  renderer.render(menuScene, menuCamera);
}

export function disposeMenu() {
  disposed = true;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('keydown', onMenuKeyDown);
  document.removeEventListener('keyup', onMenuKeyUp);
  window.removeEventListener('resize', onMenuResize);

  const panel = document.getElementById('menu-panel');
  if (panel) panel.style.transform = '';

  if (menuScene) {
    menuScene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    menuScene = null;
  }
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
