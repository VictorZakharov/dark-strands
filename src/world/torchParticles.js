import {
  ParticleSystem, DynamicTexture, Color3, Color4, Vector3
} from 'babylonjs';
import { CFG } from '../config.js';
import { getPlayerState } from '../entities/player.js';
import { getShadowSlots, setSlotShadowCasters, clearSlotShadowCasters } from './torchLighting.js';
import { getPickableTorches } from './torches.js';
import { glowSetVisible } from '../core/postfx.js';
import { hasLineOfSightMask, GRP_ALL, GRP_PLAYER, GRP_WINDOW } from '../core/physics.js';
import { getCamera } from '../core/scene.js';

const EMBER_VIS_DIST = 30;
let _emberTex = null;
let _smokeTex = null;
let _emberScene = null;
let _torchTimer = 0;
let _slotFrame = 0; // staggered shadow-slot refresh heartbeat
let _losFrame = 0;  // staggered torch line-of-sight raycasts

export function getTorchTimer() { return _torchTimer; }

/** 64px procedural ember texture — bright hot core with soft orange glow halo */
function getEmberTexture(scene) {
  if (_emberTex && !_emberTex.isDisposed) return _emberTex;
  const sz = 64;
  const dt = new DynamicTexture('emberTex', sz, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext();
  const c = sz / 2;

  // Outer warm glow halo
  const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,240,1)');
  glow.addColorStop(0.15, 'rgba(255,220,140,0.95)');
  glow.addColorStop(0.35, 'rgba(255,140,40,0.5)');
  glow.addColorStop(0.6, 'rgba(255,60,10,0.15)');
  glow.addColorStop(1, 'rgba(180,20,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, sz, sz);

  // Bright core overlay (additive feel via lighter composite)
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.4);
  core.addColorStop(0, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.5, 'rgba(255,200,100,0.4)');
  core.addColorStop(1, 'rgba(255,100,20,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, sz, sz);
  ctx.globalCompositeOperation = 'source-over';

  dt.update();
  _emberTex = dt;
  return dt;
}

/** 64px procedural smoke texture — soft wispy circle with noise-like falloff */
function getSmokeTexture(scene) {
  if (_smokeTex && !_smokeTex.isDisposed) return _smokeTex;
  const sz = 64;
  const dt = new DynamicTexture('smokeTex', sz, scene, false);
  dt.hasAlpha = true;
  const ctx = dt.getContext();
  const c = sz / 2;

  // Soft smoke puff with very gentle falloff
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(180,170,160,0.25)');
  grad.addColorStop(0.3, 'rgba(140,130,120,0.15)');
  grad.addColorStop(0.6, 'rgba(100,95,90,0.06)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);

  // Add subtle noise-like variation with offset circles
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const ox = (Math.random() - 0.5) * sz * 0.4;
    const oy = (Math.random() - 0.5) * sz * 0.4;
    const r = sz * (0.15 + Math.random() * 0.2);
    const ng = ctx.createRadialGradient(c + ox, c + oy, 0, c + ox, c + oy, r);
    ng.addColorStop(0, 'rgba(160,155,145,0.08)');
    ng.addColorStop(1, 'rgba(100,95,85,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(0, 0, sz, sz);
  }
  ctx.globalCompositeOperation = 'source-over';

  dt.update();
  _smokeTex = dt;
  return dt;
}

/** Wrap a particle system's updateFunction to kill particles at a ceiling Y */
function _applyCeilingClamp(ps, ceilingY) {
  const fadeStart = ceilingY - 0.3;
  const orig = ps.updateFunction;
  ps.updateFunction = function(particles) {
    orig(particles);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.position.y >= ceilingY) {
        p.age = p.lifeTime; // Kill particle at ceiling
      } else if (p.position.y > fadeStart) {
        // Fade out as approaching ceiling
        const t = (p.position.y - fadeStart) / (ceilingY - fadeStart);
        p.color.a *= (1 - t);
      }
    }
  };
}

export function createEmberSystem(scene, torch) {
  if (torch.particles) return; // Already exists

  // Compute ceiling Y for this torch's floor to prevent particles
  // from propagating through the floor above (e.g. 1st->2nd floor)
  const flameY = torch.flame.position.y;
  const ceilingY = (Math.floor(flameY / CFG.WALL_H) + 1) * CFG.WALL_H;

  // === EMBERS — bright sparks rising and swirling ===
  const embers = new ParticleSystem(`embers_${torch.light.name}`, 30, scene);
  embers.particleTexture = getEmberTexture(scene);
  embers.emitter = torch.flame;
  embers.minEmitBox = new Vector3(-0.08, -0.04, -0.08);
  embers.maxEmitBox = new Vector3(0.08, 0.04, 0.08);

  embers.minLifeTime = 0.3;
  embers.maxLifeTime = 2.5;
  embers.emitRate = 12;

  embers.minSize = 0.01;
  embers.maxSize = 0.05;
  embers.addSizeGradient(0, 0.02, 0.04);
  embers.addSizeGradient(0.2, 0.04, 0.08);
  embers.addSizeGradient(0.6, 0.02, 0.05);
  embers.addSizeGradient(1.0, 0.005, 0.01);

  embers.direction1 = new Vector3(-0.4, 0.4, -0.4);
  embers.direction2 = new Vector3(0.4, 1.4, 0.4);
  embers.minEmitPower = 0.4;
  embers.maxEmitPower = 1.2;

  embers.gravity = new Vector3(0, 0.2, 0);

  embers.minAngularSpeed = -4.0;
  embers.maxAngularSpeed = 4.0;

  embers.addColorGradient(0, new Color4(1, 1, 0.9, 1.0), new Color4(1, 0.95, 0.7, 0.9));
  embers.addColorGradient(0.1, new Color4(1, 0.8, 0.2, 0.9), new Color4(1, 0.6, 0.1, 0.85));
  embers.addColorGradient(0.4, new Color4(1, 0.3, 0.05, 0.7), new Color4(0.9, 0.2, 0.02, 0.6));
  embers.addColorGradient(0.8, new Color4(0.5, 0.1, 0.0, 0.3), new Color4(0.3, 0.05, 0.0, 0.1));
  embers.addColorGradient(1.0, new Color4(0.1, 0.0, 0.0, 0.0));

  embers.blendMode = ParticleSystem.BLENDMODE_ADD;

  embers.addVelocityGradient(0, 1.0);
  embers.addVelocityGradient(0.3, 0.8);
  embers.addVelocityGradient(1.0, 0.3);

  // === SPARKS — rare, extremely fast white-hot sparks ===
  const sparks = new ParticleSystem(`sparks_${torch.light.name}`, 15, scene);
  sparks.particleTexture = getEmberTexture(scene);
  sparks.emitter = torch.flame;
  sparks.minEmitBox = new Vector3(-0.02, 0, -0.02);
  sparks.maxEmitBox = new Vector3(0.02, 0.02, 0.02);
  sparks.minLifeTime = 0.15;
  sparks.maxLifeTime = 0.5;
  sparks.emitRate = 4;
  sparks.minSize = 0.01;
  sparks.maxSize = 0.03;
  sparks.direction1 = new Vector3(-1, 0.5, -1);
  sparks.direction2 = new Vector3(1, 2, 1);
  sparks.minEmitPower = 2.0;
  sparks.maxEmitPower = 5.0;
  sparks.color1 = new Color4(1, 1, 1, 1);
  sparks.color2 = new Color4(1, 0.9, 0.5, 1);
  sparks.colorDead = new Color4(1, 0.5, 0, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.gravity = new Vector3(0, -1.0, 0);

  // === SMOKE ===
  const smoke = new ParticleSystem(`smoke_${torch.light.name}`, 8, scene);
  smoke.particleTexture = getSmokeTexture(scene);
  smoke.emitter = torch.flame;
  smoke.minEmitBox = new Vector3(-0.04, 0.05, -0.04);
  smoke.maxEmitBox = new Vector3(0.04, 0.12, 0.04);

  smoke.minLifeTime = 1.2;
  smoke.maxLifeTime = 3.0;
  smoke.emitRate = 3;

  smoke.addSizeGradient(0, 0.05, 0.08);
  smoke.addSizeGradient(1.0, 0.3, 0.4);

  smoke.direction1 = new Vector3(-0.1, 0.3, -0.1);
  smoke.direction2 = new Vector3(0.1, 0.7, 0.1);
  smoke.minEmitPower = 0.1;
  smoke.maxEmitPower = 0.4;
  smoke.gravity = new Vector3(0, 0.1, 0);
  smoke.minAngularSpeed = -0.8;
  smoke.maxAngularSpeed = 0.8;

  smoke.addColorGradient(0, new Color4(0.5, 0.45, 0.4, 0.0));
  smoke.addColorGradient(0.2, new Color4(0.4, 0.35, 0.3, 0.15));
  smoke.addColorGradient(1.0, new Color4(0.15, 0.15, 0.15, 0.0));

  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;

  // Clamp particles at floor ceiling to prevent propagation through floors
  _applyCeilingClamp(embers, ceilingY);
  _applyCeilingClamp(sparks, ceilingY);
  _applyCeilingClamp(smoke, ceilingY);

  torch.particles = embers;
  torch.smokeParticles = smoke;
  torch.sparkParticles = sparks;
}

export function initTorchEmbers(scene) {
  _emberScene = scene;
  if (!_emberScene) return;
  for (const t of getPickableTorches()) {
    if (!t.active) continue;
    createEmberSystem(scene, t);
  }
}

export function updateTorchEmbers(dt) {
  const p = getPlayerState();
  if (!p || isNaN(p.x)) return;
  const px = p.x, pz = p.z;

  if (isNaN(_torchTimer)) _torchTimer = 0;
  _torchTimer += dt;
  const flicker = 0.95 + 0.05 * Math.sin(_torchTimer * 8.0) + 0.03 * Math.cos(_torchTimer * 15.0);

  const pickableTorches = getPickableTorches();
  const shadowSlots = getShadowSlots();
  const torchDistances = [];
  _losFrame++;
  let _losIdx = 0;
  for (const t of pickableTorches) {
    try {
      if (!t || !t.active || !t.light) continue;
      const meta = t.light.metadata || {};
      if (meta.picked) continue;

      if (meta.baseIntensity === undefined || isNaN(meta.baseIntensity)) meta.baseIntensity = 2.0;
      let targetIntensity = meta.baseIntensity * flicker;
      if (isNaN(targetIntensity)) targetIntensity = 0;
      t._lit = (meta.baseIntensity > 0);

      // Clustered torch lights have NO shadow maps, so their light passes
      // straight through walls into adjacent rooms/exteriors. Fade a torch's
      // clustered contribution out when the camera has no line of sight to
      // it. The two shadow-slot torches are given their UNFADED intensity in
      // the slot loop below — their shadow cubes occlude correctly, and the
      // slots always hold the torches nearest the player. Windows are
      // excluded from the ray: light through glass is legitimate.
      // Raycasts are staggered — each torch re-tests every 4th frame and the
      // 0.25s fade hides the staleness (35 Havok casts/frame was measurable).
      const cam = getCamera();
      if (cam && t.light.position && (_losFrame + _losIdx) % 4 === 0) {
        const ldx = t.light.position.x - cam.globalPosition.x;
        const ldy = t.light.position.y - cam.globalPosition.y;
        const ldz = t.light.position.z - cam.globalPosition.z;
        // Mask keeps CEILING blocking (mid-floor slabs are in that group —
        // the interaction-oriented hasLineOfSight excludes it and let light
        // and glow leak between floors of 2-story buildings)
        meta.losVisible = (ldx * ldx + ldy * ldy + ldz * ldz < 2500)
          && hasLineOfSightMask(cam.globalPosition, t.light.position,
               GRP_ALL & ~GRP_PLAYER & ~GRP_WINDOW);
        // The screen-space glow halo needs STRICT visibility — window glass
        // may pass LIGHT, but a halo blooming onto the wall beside a window
        // (ray threads the glass, flame is screen-occluded) reads as a leak
        meta.losGlow = meta.losVisible
          && hasLineOfSightMask(cam.globalPosition, t.light.position,
               GRP_ALL & ~GRP_PLAYER);
      }
      _losIdx++;
      const los = meta.losVisible !== false;
      if (meta.losFade === undefined) meta.losFade = 1;
      meta.losFade = Math.max(0, Math.min(1, meta.losFade + (los ? 1 : -1) * dt * 4));
      meta.fullIntensity = targetIntensity;
      t._losVisible = los;
      t.light.intensity = targetIntensity * meta.losFade;

      const s = 0.9 + 0.1 * flicker;
      const validS = isNaN(s) ? 1.0 : s;

      if (t.flame) {
        t.flame.scaling.set(validS * 0.8, validS * 1.4, validS * 0.8);
        if (t.glow) {
          t.glow.scaling.set(validS * 1.5, validS * 1.5, 1);
          t.glow.isVisible = t.flame.isVisible;
        }

        // GlowLayer bleeds through walls (screen-space additive, no depth) —
        // gate flame inclusion on the STRICT (glass-blocking) visibility.
        glowSetVisible(t.flame, t._lit && meta.losGlow === true);
      }

      if (targetIntensity > 0 && !isNaN(t.wx)) {
        const dx = t.wx - px, dz = t.wz - pz;
        torchDistances.push({ t, dist2: dx * dx + dz * dz });
      }

      if (t.particles) {
        const lit = t.active && t._lit;
        const dx = (t.wx || 0) - px, dz = (t.wz || 0) - pz;
        const inRange = (dx * dx + dz * dz < EMBER_VIS_DIST * EMBER_VIS_DIST);

        if (lit && inRange) {
          if (!t.particles.isStarted()) {
            t.particles.start();
            if (t.smokeParticles) t.smokeParticles.start();
            if (t.sparkParticles) t.sparkParticles.start();
          }
        } else {
          if (t.particles.isStarted()) {
            t.particles.stop();
            if (t.smokeParticles) t.smokeParticles.stop();
            if (t.sparkParticles) t.sparkParticles.stop();
          }
        }
      }
      t.light.metadata = meta;
    } catch (e) { }
  }

  torchDistances.sort((a, b) => a.dist2 - b.dist2);
  _slotFrame++;
  for (let i = 0; i < shadowSlots.length; i++) {
    try {
      const slot = shadowSlots[i];
      if (i < torchDistances.length) {
        const { t } = torchDistances[i];
        // Re-render this slot's shadow cube only when it jumps to a different
        // torch, or on a staggered heartbeat (player/NPCs moving in its range).
        const moved = Math.abs(slot.position.x - t.light.position.x) > 0.01
                   || Math.abs(slot.position.y - t.light.position.y) > 0.01
                   || Math.abs(slot.position.z - t.light.position.z) > 0.01;
        slot.position.copyFrom(t.light.position);
        // Unfaded intensity: the slot's shadow cube occludes correctly, so
        // the camera-LOS fade applied to clustered torches must not dim it
        const tm = t.light.metadata || {};
        slot.intensity = tm.fullIntensity !== undefined ? tm.fullIntensity : t.light.intensity;
        slot.shadowEnabled = true;
        t.light.intensity = 0;
        if (moved) {
          // Slot jumped to another torch — rebuild its near-torch caster
          // subset (the cube renders every frame; the subset keeps it cheap)
          setSlotShadowCasters(i, slot.position);
          const sm = slot.metadata.shadowGen && slot.metadata.shadowGen.getShadowMap();
          if (sm) sm.resetRefreshCounter(); // WebGL2 throttled path re-arm
        } else if ((_slotFrame + i * 4) % 8 === 0) {
          const sm = slot.metadata.shadowGen && slot.metadata.shadowGen.getShadowMap();
          if (sm) sm.resetRefreshCounter(); // WebGL2 heartbeat (no-op on WebGPU)
        }
      } else {
        if (slot.position.y !== -100) clearSlotShadowCasters(i);
        slot.position.y = -100;
        slot.intensity = 0.001;
      }
    } catch (e) { }
  }
}

/** Add embers for a newly placed torch */
export function addTorchEmbers(torch) {
  if (!_emberScene) return;
  createEmberSystem(_emberScene, torch);
}
