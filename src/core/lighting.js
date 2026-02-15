import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

let sunLight, hemiLight, stars, sunGroup, sunLensflare;

export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }
export function getStars() { return stars; }
export function getSunGroup() { return sunGroup; }
export function getSunLensflare() { return sunLensflare; }

/** Generate a soft radial gradient texture on canvas */
function createGlowTexture(size, innerColor, outerColor) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(0.15, innerColor);
  gradient.addColorStop(0.4, outerColor);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/** Generate a flare ring texture */
function createFlareTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, half * 0.6, half, half, half);
  gradient.addColorStop(0, 'rgba(255,200,100,0)');
  gradient.addColorStop(0.5, 'rgba(255,180,80,0.08)');
  gradient.addColorStop(0.7, 'rgba(255,160,60,0.04)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function initLighting(scene) {
  hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3a5a2a, 0.7);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -50;
  sunLight.shadow.camera.right = 50;
  sunLight.shadow.camera.top = 50;
  sunLight.shadow.camera.bottom = -50;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 150;
  sunLight.shadow.bias = -0.001;
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Stars
  const sGeo = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < 800; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const R = 180;
    positions.push(
      R * Math.sin(phi) * Math.cos(theta),
      R * Math.cos(phi),
      R * Math.sin(phi) * Math.sin(theta)
    );
  }
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const sMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.6,
    transparent: true,
    opacity: 0,
  });
  stars = new THREE.Points(sGeo, sMat);
  scene.add(stars);

  // Sun — group with core sphere + glow layers
  sunGroup = new THREE.Group();
  sunGroup.visible = false;

  // Core sun sphere (bright, solid)
  const sunGeo = new THREE.SphereGeometry(4, 16, 16);
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xfffff0,
    fog: false,
  });
  const sunCore = new THREE.Mesh(sunGeo, sunMat);
  sunGroup.add(sunCore);

  // Inner glow (warm, tight)
  const glowTex1 = createGlowTexture(256, 'rgba(255,255,220,1)', 'rgba(255,220,100,0.3)');
  const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex1,
    color: 0xffeeaa,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  }));
  innerGlow.scale.set(30, 30, 1);
  sunGroup.add(innerGlow);

  // Outer corona (wide, soft)
  const glowTex2 = createGlowTexture(256, 'rgba(255,200,100,0.6)', 'rgba(255,150,50,0.05)');
  const outerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex2,
    color: 0xffcc66,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    fog: false,
    depthWrite: false,
  }));
  outerGlow.scale.set(60, 60, 1);
  sunGroup.add(outerGlow);

  // Put sun on layer 2 so raycasters (layer 0) don't hit sprites
  sunGroup.traverse(obj => obj.layers.set(2));
  scene.add(sunGroup);

  // Lensflare — attached to the sun group position, adds flare elements when looking at sun
  const flareTex = createGlowTexture(256, 'rgba(255,255,255,1)', 'rgba(255,200,100,0.2)');
  const flareRing = createFlareTexture(256);

  sunLensflare = new Lensflare();
  sunLensflare.addElement(new LensflareElement(flareTex, 300, 0, new THREE.Color(0xffffff)));
  sunLensflare.addElement(new LensflareElement(flareRing, 500, 0.1, new THREE.Color(0xffddaa)));
  sunLensflare.addElement(new LensflareElement(flareTex, 120, 0.3, new THREE.Color(0xff9944)));
  sunLensflare.addElement(new LensflareElement(flareTex, 80, 0.6, new THREE.Color(0xffaa55)));
  sunLensflare.addElement(new LensflareElement(flareRing, 200, 0.7, new THREE.Color(0xffcc88)));
  sunLensflare.addElement(new LensflareElement(flareTex, 60, 1.0, new THREE.Color(0xffbb66)));
  sunLensflare.visible = false;
  sunLensflare.layers.set(2);
  scene.add(sunLensflare);
}
