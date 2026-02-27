import { Scene, FreeCamera, HemisphericLight, PointLight,
         MeshBuilder, PBRMaterial, Texture,
         Color3, Color4, Vector3, SceneLoader,
         TransformNode, ParticleHelper, DefaultRenderingPipeline,
         ImageProcessingConfiguration } from 'babylonjs';
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
let groundMat, trunkMat, leafMat, rockMat;

function loadTex(path, uScale, vScale, scene) {
  const tex = new Texture(path, scene);
  tex.uScale = uScale;
  tex.vScale = vScale;
  return tex;
}

function initMaterials(scene) {
  trunkMat = new PBRMaterial('mTrunk', scene);
  trunkMat.albedoTexture = loadTex('./assets/textures/bark.jpg', 1, 2, scene);
  trunkMat.roughness = 0.95; trunkMat.metallic = 0;

  rockMat = new PBRMaterial('mRock', scene);
  rockMat.albedoTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
  rockMat.roughness = 0.95; rockMat.metallic = 0;

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

// ==================== CAMPFIRE SCENE ====================

// --- Campfire animation state ---
let campfireParticleSet = null;
let campfirePendingSet = null;  // loaded but waiting for scene to warm up
let campfireLight = null;
let campfireFillLight = null;
let campfireLightBase = 0;
let menuPipeline = null;
let menuFrameCount = 0;

function updateCampfire(dt) {
  if (!campfireLight) return;
  const t = performance.now() * 0.001;

  // Organic flicker: layered sine waves + random chaos (scaled to base intensity)
  const base = campfireLightBase;
  const wave1 = Math.sin(t * 8.3) * base * 0.12;
  const wave2 = Math.sin(t * 13.7) * base * 0.08;
  const wave3 = Math.sin(t * 21.1) * base * 0.04;
  const chaos = (Math.random() - 0.5) * base * 0.15;

  // Occasional bright flash spike (~5% chance per frame)
  const flash = Math.random() < 0.05 ? rnd(base * 0.2, base * 0.4) : 0;

  campfireLight.intensity = Math.max(base * 0.5, base + wave1 + wave2 + wave3 + chaos + flash);

  // Subtle color temperature shift (red ↔ yellow)
  const tempShift = Math.sin(t * 3.1) * 0.08;
  campfireLight.diffuse.r = Math.min(1, 1.0 + tempShift * 0.5);
  campfireLight.diffuse.g = 0.533 + tempShift;
  campfireLight.diffuse.b = 0.2 - tempShift * 0.3;

  // Fill light follows at lower intensity
  if (campfireFillLight) {
    campfireFillLight.intensity = 0.6 + wave1 * 0.15 + chaos * 0.1;
  }

}

function templateCampfire(scene) {
  scene.clearColor = new Color4(0.02, 0.02, 0.031, 1);
  scene.fogMode = Scene.FOGMODE_EXP2; scene.fogDensity = 0.06;
  scene.fogColor = new Color3(0.02, 0.02, 0.031);
  scene.ambientColor = new Color3(0.04, 0.04, 0.08);

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.15;

  addGround(scene);

  const fx = 0, fz = 0;

  // --- Even stone ring (12 stones, uniform spacing) ---
  const stoneCount = 12;
  const ringR = 0.48;
  const stoneMat = new PBRMaterial('mStone', scene);
  stoneMat.albedoTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
  stoneMat.roughness = 0.95; stoneMat.metallic = 0;
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2;
    const sx = fx + Math.cos(a) * ringR;
    const sz = fz + Math.sin(a) * ringR;
    const s = rnd(0.09, 0.12);
    const stone = MeshBuilder.CreateIcoSphere('rStone', { radius: s, subdivisions: 1 }, scene);
    stone.material = stoneMat;
    stone.position = new Vector3(sx, s * 0.45, sz);
    stone.rotation = new Vector3(rnd(-0.2, 0.2), a, rnd(-0.2, 0.2));
    stone.scaling = new Vector3(1, rnd(0.7, 0.9), 1); // slightly flattened
  }
  menuColliders.push({ x: fx, z: fz, r: 1.2 });

  // --- Proper log stack (teepee-style leaning + flat base logs) ---
  const logMat = new PBRMaterial('mLog', scene);
  logMat.albedoTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
  logMat.roughness = 0.9; logMat.metallic = 0;
  logMat.emissiveColor = new Color3(0.15, 0.05, 0);

  // Two base logs (lying flat, crossed)
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI / 2 + rnd(-0.15, 0.15);
    const log = MeshBuilder.CreateCylinder('baseLog', {
      diameterTop: 0.06, diameterBottom: 0.08, height: 0.5, tessellation: 6,
    }, scene);
    log.material = logMat;
    log.position = new Vector3(fx, 0.04, fz);
    log.rotation = new Vector3(Math.PI / 2, a, 0);
  }

  // Three leaning logs (teepee style, meeting at top)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd(-0.1, 0.1);
    const log = MeshBuilder.CreateCylinder('leanLog', {
      diameterTop: 0.04, diameterBottom: 0.07, height: 0.45, tessellation: 6,
    }, scene);
    log.material = logMat;
    const dist = 0.12;
    log.position = new Vector3(fx + Math.cos(a) * dist * 0.3, 0.18, fz + Math.sin(a) * dist * 0.3);
    log.rotation = new Vector3(0, a, 0.45); // lean inward
  }

  // Charred base — subtle, blends with ground
  const charMat = new PBRMaterial('mChar', scene);
  charMat.albedoColor = new Color3(0.12, 0.1, 0.08);
  charMat.roughness = 1; charMat.metallic = 0;
  charMat.alpha = 0.6;
  const charBase = MeshBuilder.CreateDisc('charBase', { radius: 0.35, tessellation: 12 }, scene);
  charBase.material = charMat;
  charBase.rotation = new Vector3(Math.PI / 2, 0, 0);
  charBase.position = new Vector3(fx, 0.005, fz);

  // === Fire particles (fetched from CDN, started after warm-up in initMenuScene) ===
  const FIRE_SCALE = 0.25;
  const firePromise = ParticleHelper.CreateAsync('fire', scene).then(pset => {
    if (disposed) { pset.dispose(); return; }
    for (const ps of pset.systems) {
      ps.emitter = new Vector3(fx, 0.1, fz);
      ps.minSize *= FIRE_SCALE;
      ps.maxSize *= FIRE_SCALE;
      ps.minEmitBox.scaleInPlace(FIRE_SCALE);
      ps.maxEmitBox.scaleInPlace(FIRE_SCALE);
      ps.minEmitPower *= FIRE_SCALE;
      ps.maxEmitPower *= FIRE_SCALE;
      ps.emitRate *= 0.6;
      if (ps.gravity) ps.gravity.scaleInPlace(FIRE_SCALE);
    }
    // Don't start yet — wait for scene to render a few frames so geometry is visible
    campfirePendingSet = pset;
  }).catch(err => console.warn('Fire particles failed:', err));

  // Warm ground glow
  const glowMat = new PBRMaterial('mGlow', scene);
  glowMat.albedoColor = new Color3(0, 0, 0);
  glowMat.emissiveColor = Color3.FromHexString('#ff6622');
  glowMat.alpha = 0.15; glowMat.roughness = 1; glowMat.metallic = 0;
  const glowDisc = MeshBuilder.CreateDisc('glow', { radius: 1.5, tessellation: 16 }, scene);
  glowDisc.material = glowMat;
  glowDisc.rotation = new Vector3(Math.PI / 2, 0, 0);
  glowDisc.position = new Vector3(fx, 0.01, fz);

  // Lights
  campfireLightBase = 2.5;
  campfireLight = new PointLight('fireLight', new Vector3(fx, 0.6, fz), scene);
  campfireLight.diffuse = Color3.FromHexString('#ff8833');
  campfireLight.intensity = campfireLightBase; campfireLight.range = 10;

  campfireFillLight = new PointLight('fireFill', new Vector3(fx, 0.15, fz), scene);
  campfireFillLight.diffuse = Color3.FromHexString('#ff6622');
  campfireFillLight.intensity = 0.8; campfireFillLight.range = 6;

  // --- Randomized character (fox or soldier) ---
  const useFox = Math.random() < 0.35;
  const charAngle = rnd(-0.6, 0.6);
  const charDist = rnd(2.0, 2.5);
  const charX = fx + Math.sin(charAngle) * charDist;
  const charZ = fz - Math.cos(charAngle) * charDist;
  const dirToFire = Math.atan2(fx - charX, fz - charZ);
  const faceRot = useFox ? dirToFire : dirToFire + Math.PI;

  const cam = { x: 3, y: 1.2, z: 4 };
  const look = new Vector3(0, 0.4, 0);

  // --- Randomized tree placement (avoid campfire and camera-character line) ---
  const treeCount = rndInt(3, 6);
  for (let i = 0; i < treeCount; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const p = rndAvoid(-7, 5, -7, 4, cam.x, cam.z, charX, charZ, 2);
      const dfc = p.x * p.x + p.z * p.z;
      if (dfc > 4) { createTree(p.x, p.z, rnd(1.6, 2.8), scene); break; } // >2 units from fire center
    }
  }
  // A few scattered rocks (also avoid campfire)
  for (let i = 0; i < rndInt(1, 3); i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const p = rndAvoid(-5, 3, -5, 3, cam.x, cam.z, charX, charZ, 1.5);
      const dfc = p.x * p.x + p.z * p.z;
      if (dfc > 2.25) { createRock(p.x, p.z, rnd(0.15, 0.4), scene); break; } // >1.5 units from fire
    }
  }

  return {
    firePromise,
    baseCam: cam, lookAt: look,
    character: {
      url: useFox ? './assets/models/Fox.glb' : './assets/models/Soldier.glb',
      anim: useFox ? /survey/i : /idle/i,
      pos: [charX, 0, charZ], rot: faceRot,
      scale: useFox ? CFG.FOX_H : CFG.SOLDIER_H,
    },
  };
}

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
  campfireParticleSet = null;
  campfirePendingSet = null;
  campfireLight = null;
  campfireFillLight = null;
  menuPipeline = null;
  menuFrameCount = 0;

  menuSnow = Math.random() < 0.5;

  const engine = getEngine();
  menuScene = new Scene(engine);
  menuScene.useRightHandedSystem = true;
  menuScene.skipPointerMovePicking = true;
  menuScene.pointerMovePredicate = () => false;
  // PBR materials need an environment texture to show colors properly (not grey)
  menuScene.createDefaultEnvironment({ createGround: false, createSkybox: false });

  initMaterials(menuScene);

  const config = templateCampfire(menuScene);

  // Keep IBL low so campfire light dominates, but non-zero so PBR materials render
  menuScene.environmentIntensity = 0.15;

  camBase = { x: config.baseCam.x, y: config.baseCam.y, z: config.baseCam.z };
  camLookAt = config.lookAt;

  menuCamera = new FreeCamera('menuCam', new Vector3(camBase.x, camBase.y, camBase.z), menuScene);
  menuCamera.fov = 50 * Math.PI / 180;
  menuCamera.minZ = 0.1; menuCamera.maxZ = 120;
  menuCamera.inputs.clear();
  menuCamera.setTarget(camLookAt);
  menuScene.activeCamera = menuCamera;

  // ACES tone mapping + bloom for fire glow
  menuScene.imageProcessingConfiguration.toneMappingEnabled = true;
  menuScene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  menuScene.imageProcessingConfiguration.exposure = 1.2;

  menuPipeline = new DefaultRenderingPipeline('menuPipeline', true, menuScene);
  menuPipeline.bloomEnabled = true;
  menuPipeline.bloomThreshold = 0.8;
  menuPipeline.bloomWeight = 1;
  menuPipeline.bloomKernel = 64;
  menuPipeline.bloomScale = 0.5;

  // Load character model (fire-and-forget, not blocking)
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
  menuFrameCount++;
  // Start fire particles only after scene has rendered enough frames for geometry to be visible
  if (campfirePendingSet && menuFrameCount > 10) {
    campfireParticleSet = campfirePendingSet;
    campfirePendingSet = null;
    campfireParticleSet.start();
  }
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

  // Stop and release particle set before dropping scene ref
  if (campfireParticleSet) campfireParticleSet.dispose();
  if (campfirePendingSet) campfirePendingSet.dispose();

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
  campfireParticleSet = null;
  campfirePendingSet = null;
  campfireLight = null;
  campfireFillLight = null;
  menuPipeline = null;
  menuFrameCount = 0;
}
