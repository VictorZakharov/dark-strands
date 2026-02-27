/**
 * BACKUP: Custom 4-layer ParticleSystem campfire effect
 * Saved from menu.js before switching to ParticleHelper.CreateAsync("fire") approach.
 *
 * This code uses procedural DynamicTexture generation and 4 hand-tuned particle layers:
 *   Layer 1 — Fire Core (dense, bright base)
 *   Layer 2 — Flame Tips (taller tongues reaching up)
 *   Layer 3 — Embers/Sparks (bright particles rising/drifting)
 *   Layer 4 — Smoke (grey wisps above flames)
 *
 * Plus enhanced light flicker with random chaos, bright flash spikes,
 * and color temperature shifting.
 */

// ===================== PROCEDURAL TEXTURES =====================

// Shared soft-circle texture for ember particles
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

// 128px fire texture — bright white-hot core → orange → transparent falloff
let fireTex = null;
function getFireTexture(scene) {
  if (fireTex && !fireTex.isDisposed) return fireTex;
  const sz = 128;
  const dt = new DynamicTexture('fireTex', sz, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext();
  const c = sz / 2;

  const base = ctx.createRadialGradient(c, c, 0, c, c, c);
  base.addColorStop(0, 'rgba(255,255,250,1)');
  base.addColorStop(0.12, 'rgba(255,240,200,0.95)');
  base.addColorStop(0.3, 'rgba(255,180,60,0.7)');
  base.addColorStop(0.55, 'rgba(255,100,20,0.3)');
  base.addColorStop(0.8, 'rgba(200,40,5,0.08)');
  base.addColorStop(1, 'rgba(120,10,0,0)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, sz, sz);

  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.35);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.5, 'rgba(255,220,140,0.4)');
  core.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, sz, sz);
  ctx.globalCompositeOperation = 'source-over';

  dt.update();
  fireTex = dt;
  return dt;
}

// 64px smoke texture — soft grey puff with subtle noise
let campSmokeTex = null;
function getCampSmokeTexture(scene) {
  if (campSmokeTex && !campSmokeTex.isDisposed) return campSmokeTex;
  const sz = 64;
  const dt = new DynamicTexture('campSmokeTex', sz, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext();
  const c = sz / 2;

  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(180,170,160,0.3)');
  grad.addColorStop(0.25, 'rgba(150,140,130,0.2)');
  grad.addColorStop(0.5, 'rgba(120,115,110,0.1)');
  grad.addColorStop(0.75, 'rgba(90,85,80,0.03)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);

  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) {
    const ox = (Math.random() - 0.5) * sz * 0.45;
    const oy = (Math.random() - 0.5) * sz * 0.45;
    const r = sz * (0.12 + Math.random() * 0.22);
    const ng = ctx.createRadialGradient(c + ox, c + oy, 0, c + ox, c + oy, r);
    ng.addColorStop(0, 'rgba(160,155,145,0.1)');
    ng.addColorStop(1, 'rgba(100,95,85,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(0, 0, sz, sz);
  }
  ctx.globalCompositeOperation = 'source-over';

  dt.update();
  campSmokeTex = dt;
  return dt;
}

// ===================== PARTICLE SYSTEM LAYERS =====================
// Insert this inside templateCampfire() after creating the ember core mesh,
// replacing the billboard flame and manual ember code.

function createCustomCampfireParticles(scene, fx, fz) {
  const fireEmitter = new TransformNode('fireEmitter', scene);
  fireEmitter.position = new Vector3(fx, 0.1, fz);

  const fireTexture = getFireTexture(scene);
  const emberTexture = getSoftParticleTex(scene);
  const smokeTexture = getCampSmokeTexture(scene);
  const systems = [];

  // --- Layer 1: Fire Core (dense, bright base) ---
  const fireCore = new ParticleSystem('fireCore', 80, scene);
  fireCore.particleTexture = fireTexture;
  fireCore.emitter = fireEmitter;
  fireCore.minEmitBox = new Vector3(-0.15, 0, -0.15);
  fireCore.maxEmitBox = new Vector3(0.15, 0.1, 0.15);
  fireCore.minLifeTime = 0.3;
  fireCore.maxLifeTime = 0.8;
  fireCore.emitRate = 40;
  fireCore.addSizeGradient(0, 0.06, 0.1);
  fireCore.addSizeGradient(0.3, 0.2, 0.25);
  fireCore.addSizeGradient(0.7, 0.15, 0.2);
  fireCore.addSizeGradient(1.0, 0.03, 0.05);
  fireCore.direction1 = new Vector3(-0.15, 0.6, -0.15);
  fireCore.direction2 = new Vector3(0.15, 1.2, 0.15);
  fireCore.minEmitPower = 0.3;
  fireCore.maxEmitPower = 0.8;
  fireCore.gravity = new Vector3(0, 0.3, 0);
  fireCore.addColorGradient(0, new Color4(1, 1, 0.95, 1.0), new Color4(1, 1, 0.85, 0.9));
  fireCore.addColorGradient(0.2, new Color4(1, 0.9, 0.4, 0.95), new Color4(1, 0.8, 0.2, 0.9));
  fireCore.addColorGradient(0.5, new Color4(1, 0.6, 0.1, 0.8), new Color4(1, 0.4, 0.05, 0.7));
  fireCore.addColorGradient(0.8, new Color4(0.9, 0.2, 0.02, 0.4));
  fireCore.addColorGradient(1.0, new Color4(0.6, 0.1, 0, 0));
  fireCore.blendMode = ParticleSystem.BLENDMODE_ADD;
  fireCore.minAngularSpeed = -1.0;
  fireCore.maxAngularSpeed = 1.0;
  fireCore.start();
  systems.push(fireCore);

  // --- Layer 2: Flame Tips (taller tongues reaching up) ---
  const flameTips = new ParticleSystem('flameTips', 50, scene);
  flameTips.particleTexture = fireTexture;
  flameTips.emitter = fireEmitter;
  flameTips.minEmitBox = new Vector3(-0.1, 0.15, -0.1);
  flameTips.maxEmitBox = new Vector3(0.1, 0.35, 0.1);
  flameTips.minLifeTime = 0.5;
  flameTips.maxLifeTime = 1.2;
  flameTips.emitRate = 25;
  flameTips.addSizeGradient(0, 0.08, 0.12);
  flameTips.addSizeGradient(0.25, 0.2, 0.3);
  flameTips.addSizeGradient(0.7, 0.1, 0.15);
  flameTips.addSizeGradient(1.0, 0.01, 0.02);
  flameTips.direction1 = new Vector3(-0.2, 0.8, -0.2);
  flameTips.direction2 = new Vector3(0.2, 1.8, 0.2);
  flameTips.minEmitPower = 0.4;
  flameTips.maxEmitPower = 1.0;
  flameTips.gravity = new Vector3(0, 0.15, 0);
  flameTips.addColorGradient(0, new Color4(1, 0.9, 0.3, 0.9), new Color4(1, 0.8, 0.15, 0.85));
  flameTips.addColorGradient(0.3, new Color4(1, 0.6, 0.08, 0.75), new Color4(1, 0.45, 0.05, 0.7));
  flameTips.addColorGradient(0.6, new Color4(0.8, 0.2, 0.02, 0.5), new Color4(0.6, 0.12, 0.01, 0.35));
  flameTips.addColorGradient(1.0, new Color4(0.3, 0.05, 0, 0));
  flameTips.blendMode = ParticleSystem.BLENDMODE_ADD;
  flameTips.minAngularSpeed = -2.0;
  flameTips.maxAngularSpeed = 2.0;
  flameTips.addVelocityGradient(0, 1.0);
  flameTips.addVelocityGradient(0.5, 0.6);
  flameTips.addVelocityGradient(1.0, 0.2);
  flameTips.start();
  systems.push(flameTips);

  // --- Layer 3: Embers/Sparks (bright particles rising/drifting) ---
  const embers = new ParticleSystem('campEmbers', 40, scene);
  embers.particleTexture = emberTexture;
  embers.emitter = fireEmitter;
  embers.minEmitBox = new Vector3(-0.12, 0.05, -0.12);
  embers.maxEmitBox = new Vector3(0.12, 0.25, 0.12);
  embers.minLifeTime = 1.0;
  embers.maxLifeTime = 3.5;
  embers.emitRate = 15;
  embers.addSizeGradient(0, 0.02, 0.04);
  embers.addSizeGradient(0.15, 0.04, 0.06);
  embers.addSizeGradient(0.5, 0.03, 0.05);
  embers.addSizeGradient(1.0, 0.005, 0.01);
  embers.direction1 = new Vector3(-0.5, 0.5, -0.5);
  embers.direction2 = new Vector3(0.5, 1.8, 0.5);
  embers.minEmitPower = 0.3;
  embers.maxEmitPower = 1.2;
  embers.gravity = new Vector3(0, 0.15, 0);
  embers.minAngularSpeed = -4.0;
  embers.maxAngularSpeed = 4.0;
  embers.addColorGradient(0, new Color4(1, 1, 0.9, 1.0), new Color4(1, 0.95, 0.7, 0.9));
  embers.addColorGradient(0.1, new Color4(1, 0.8, 0.2, 0.9), new Color4(1, 0.6, 0.1, 0.85));
  embers.addColorGradient(0.4, new Color4(1, 0.3, 0.05, 0.7), new Color4(0.9, 0.2, 0.02, 0.6));
  embers.addColorGradient(0.75, new Color4(0.5, 0.1, 0.0, 0.3), new Color4(0.3, 0.05, 0.0, 0.15));
  embers.addColorGradient(1.0, new Color4(0.1, 0.0, 0.0, 0.0));
  embers.blendMode = ParticleSystem.BLENDMODE_ADD;
  embers.addVelocityGradient(0, 1.0);
  embers.addVelocityGradient(0.3, 0.7);
  embers.addVelocityGradient(1.0, 0.2);
  embers.start();
  systems.push(embers);

  // --- Layer 4: Smoke (grey wisps above flames) ---
  const smoke = new ParticleSystem('campSmoke', 15, scene);
  smoke.particleTexture = smokeTexture;
  smoke.emitter = fireEmitter;
  smoke.minEmitBox = new Vector3(-0.08, 0.4, -0.08);
  smoke.maxEmitBox = new Vector3(0.08, 0.6, 0.08);
  smoke.minLifeTime = 2.0;
  smoke.maxLifeTime = 4.0;
  smoke.emitRate = 5;
  smoke.addSizeGradient(0, 0.08, 0.12);
  smoke.addSizeGradient(0.3, 0.2, 0.35);
  smoke.addSizeGradient(1.0, 0.5, 0.65);
  smoke.direction1 = new Vector3(-0.12, 0.3, -0.12);
  smoke.direction2 = new Vector3(0.12, 0.8, 0.12);
  smoke.minEmitPower = 0.1;
  smoke.maxEmitPower = 0.35;
  smoke.gravity = new Vector3(0, 0.08, 0);
  smoke.minAngularSpeed = -1.2;
  smoke.maxAngularSpeed = 1.2;
  smoke.addColorGradient(0, new Color4(0.45, 0.4, 0.35, 0.0));
  smoke.addColorGradient(0.15, new Color4(0.4, 0.35, 0.3, 0.12));
  smoke.addColorGradient(0.5, new Color4(0.25, 0.23, 0.2, 0.08));
  smoke.addColorGradient(1.0, new Color4(0.12, 0.11, 0.1, 0.0));
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.start();
  systems.push(smoke);

  return systems;
}

// ===================== ENHANCED LIGHT FLICKER =====================
// Call from updateCampfire(dt):

function updateCampfireCustomFlicker(dt) {
  if (!campfireLight) return;
  const t = performance.now() * 0.001;

  const base = campfireLightBase;
  const wave1 = Math.sin(t * 8.3) * 0.4;
  const wave2 = Math.sin(t * 13.7) * 0.25;
  const wave3 = Math.sin(t * 21.1) * 0.12;
  const chaos = (Math.random() - 0.5) * 0.6;
  const flash = Math.random() < 0.05 ? rnd(0.8, 1.5) : 0;

  campfireLight.intensity = Math.max(0.3, base + wave1 + wave2 + wave3 + chaos + flash);

  // Color temperature shift (red ↔ yellow)
  const tempShift = Math.sin(t * 3.1) * 0.08;
  campfireLight.diffuse.r = Math.min(1, 1.0 + tempShift * 0.5);
  campfireLight.diffuse.g = 0.533 + tempShift;
  campfireLight.diffuse.b = 0.2 - tempShift * 0.3;

  if (campfireFillLight) {
    campfireFillLight.intensity = 0.4 + wave1 * 0.15 + chaos * 0.1;
  }

  if (campfireEmberCore) {
    const pulse = 0.9 + Math.sin(t * 5) * 0.1 + Math.sin(t * 11) * 0.05;
    campfireEmberCore.scaling = new Vector3(pulse, pulse, pulse);
    campfireEmberCore.material.emissiveColor.g = 0.4 + Math.sin(t * 7) * 0.1;
  }
}
