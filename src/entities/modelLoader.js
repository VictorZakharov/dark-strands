import { SceneLoader, Vector3, Color3, Matrix } from 'babylonjs';
import { MODEL_REGISTRY } from './models.js';
import { randomWalkablePos } from '../world/grid.js';
import { registerFlower, setFlowerTemplate } from '../world/flowers.js';
import { registerSoldier, registerFox } from '../systems/npcAI.js';
import { getTerrainHeight } from '../world/terrain.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { addFogDepthMesh } from '../core/postfx.js';

// In Babylon.js, AnimationGroups are updated automatically by the scene.
// We still expose animMixers array for compatibility — each entry has an update(dt) method
// that wraps Babylon's animation group weight-based crossfade system.
const animMixers = [];

export function getAnimMixers() {
  return animMixers;
}

// Asset containers per model ID — loaded once, instanced many times
const _containers = new Map();

/**
 * Strip unused UV vertex data (uv2–uv6) from all meshes in a container.
 * WebGPU limits pipelines to 8 vertex buffers; Soldier.glb ships with 7 UV
 * channels (TEXCOORD_0–6) but materials only reference TEXCOORD_0.
 * Without stripping, animated models exceed the 8-buffer limit on WebGPU.
 */
function stripExtraUVs(container) {
  for (const mesh of container.meshes) {
    if (!mesh.geometry) continue;
    for (const kind of ['uv2', 'uv3', 'uv4', 'uv5', 'uv6']) {
      if (mesh.isVerticesDataPresent(kind)) {
        mesh.removeVerticesData(kind);
      }
    }
  }
}

/**
 * Normalize model scale so it fits targetHeight.
 * Uses Babylon's getHierarchyBoundingVectors for the whole subtree.
 */
function normalizeScale(rootNode, targetHeight) {
  // Reset scaling first
  rootNode.scaling = new Vector3(1, 1, 1);
  rootNode.computeWorldMatrix(true);
  // Force child meshes to recompute
  for (const m of rootNode.getChildMeshes()) m.computeWorldMatrix(true);

  const bounds = rootNode.getHierarchyBoundingVectors(true);
  const height = bounds.max.y - bounds.min.y;
  if (height > 0) {
    const s = targetHeight / height;
    rootNode.scaling = new Vector3(s, s, s);
  }
}

/**
 * Enable shadow casting/receiving on all child meshes.
 * @param {boolean} sunShadow — register with sun shadow generator (default true)
 */
function enableShadows(rootNode, sunShadow = true) {
  for (const mesh of rootNode.getChildMeshes()) {
    if (sunShadow) addShadowCaster(mesh);
    enableShadowReceiving(mesh);
    // Fog depth pass: without this, a model silhouetted against the sky
    // reads as sky depth and gets fully fog-colored at any distance
    addFogDepthMesh(mesh);
  }
}

/**
 * Create a Babylon.js animation crossfade mixer wrapper.
 * Mimics Three.js AnimationMixer API for compatibility with npcAI.js.
 */
export function createAnimMixer(animationGroups) {
  const mixer = {
    _groups: animationGroups,
    _active: null,
    _fadeFrom: null,
    _fadeTo: null,
    _fadeDur: 0,
    _fadeElapsed: 0,

    /** Create an action-like wrapper for an animation group */
    clipAction(group) {
      if (!group) return null;
      return {
        _group: group,
        _mixer: mixer,
        _weight: 0,
        play() {
          this._group.play(true); // loop
          this._weight = 1;
          return this;
        },
        stop() {
          this._group.stop();
          this._weight = 0;
          return this;
        },
        reset() {
          this._group.reset();
          this._weight = 0;
          return this;
        },
        setEffectiveWeight(w) {
          this._weight = w;
          this._group.setWeightForAllAnimatables(w);
          return this;
        },
        fadeIn(duration) {
          this._mixer._fadeTo = this;
          this._mixer._fadeDur = duration;
          this._mixer._fadeElapsed = 0;
          return this;
        },
        fadeOut(duration) {
          this._mixer._fadeFrom = this;
          return this;
        },
        get timeScale() { return this._group.speedRatio; },
        set timeScale(v) { this._group.speedRatio = v; },
      };
    },

    /** Set initial time offset (for desynchronizing NPC animations) */
    setTime(t) {
      for (const g of animationGroups) {
        // Babylon doesn't have a direct setTime, but we can use goToFrame
        // approximation: convert seconds to frame (assume 30fps in GLTF)
        const frame = t * 30;
        if (g.isPlaying) {
          g.goToFrame(frame);
        }
      }
    },

    /** Called each frame by main loop — handles crossfade interpolation */
    update(dt) {
      if (this._fadeFrom && this._fadeTo && this._fadeDur > 0) {
        this._fadeElapsed += dt;
        const t = Math.min(1, this._fadeElapsed / this._fadeDur);
        this._fadeFrom._weight = 1 - t;
        this._fadeTo._weight = t;
        this._fadeFrom._group.setWeightForAllAnimatables(1 - t);
        this._fadeTo._group.setWeightForAllAnimatables(t);

        if (t >= 1) {
          this._fadeFrom._group.stop();
          this._fadeFrom._weight = 0;
          this._fadeFrom = null;
          this._fadeTo = null;
          this._fadeDur = 0;
        }
      }
    },
  };
  return mixer;
}

function placeSoldier(scene, container) {
  const pos = randomWalkablePos();
  if (!pos) return;

  const instance = container.instantiateModelsToScene(
    name => name + '_soldier_' + Math.random().toString(36).slice(2, 6)
  );
  const rootNode = instance.rootNodes[0];
  const animGroups = instance.animationGroups;

  normalizeScale(rootNode, MODEL_REGISTRY.find(d => d.id === 'soldier').targetHeight);
  enableShadows(rootNode); // sun shadows only — NPCs rarely near torches

  // Tint soldier meshes
  for (const mesh of rootNode.getChildMeshes()) {
    if (mesh.material) {
      mesh.material = mesh.material.clone(mesh.material.name + '_soldierClone');
      if (mesh.material.albedoColor) {
        const c = mesh.material.albedoColor;
        mesh.material.albedoColor = new Color3(c.r * 0.7, c.g * 1.0, c.b * 0.75);
      }
    }
  }

  rootNode.position = new Vector3(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  rootNode.rotation = new Vector3(0, Math.random() * Math.PI * 2, 0);

  const idleGroup = animGroups.find(a => /idle/i.test(a.name)) || animGroups[0];
  const walkGroup = animGroups.find(a => /walk/i.test(a.name)) || animGroups[1] || idleGroup;

  const mixer = createAnimMixer(animGroups);
  // Start with idle playing
  if (idleGroup) { idleGroup.play(true); idleGroup.setWeightForAllAnimatables(1); }
  if (walkGroup && walkGroup !== idleGroup) { walkGroup.play(true); walkGroup.setWeightForAllAnimatables(0); }

  // Randomize initial animation time
  mixer.setTime(Math.random() * 3);

  animMixers.push(mixer);

  registerSoldier(rootNode, mixer, { idle: idleGroup, walk: walkGroup });
}

function placeFox(scene, container) {
  const pos = randomWalkablePos();
  if (!pos) return;

  const instance = container.instantiateModelsToScene(
    name => name + '_fox_' + Math.random().toString(36).slice(2, 6)
  );
  const rootNode = instance.rootNodes[0];
  const animGroups = instance.animationGroups;

  normalizeScale(rootNode, MODEL_REGISTRY.find(d => d.id === 'fox').targetHeight);
  enableShadows(rootNode); // sun shadows only

  rootNode.position = new Vector3(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  rootNode.rotation = new Vector3(0, Math.random() * Math.PI * 2, 0);

  const anims = animGroups;
  const idleGroup = anims.find(a => /survey/i.test(a.name)) || anims[0];
  const walkGroup = anims.find(a => /walk/i.test(a.name)) || anims[1] || idleGroup;
  const runGroup = anims.find(a => /run/i.test(a.name)) || anims[2] || walkGroup;

  const mixer = createAnimMixer(animGroups);
  if (idleGroup) { idleGroup.play(true); idleGroup.setWeightForAllAnimatables(1); }
  if (walkGroup && walkGroup !== idleGroup) { walkGroup.play(true); walkGroup.setWeightForAllAnimatables(0); }
  if (runGroup && runGroup !== idleGroup && runGroup !== walkGroup) { runGroup.play(true); runGroup.setWeightForAllAnimatables(0); }

  mixer.setTime(Math.random() * 3);
  animMixers.push(mixer);

  registerFox(rootNode, mixer, { idle: idleGroup, walk: walkGroup, run: runGroup });
}

function placeClone(scene, container, def) {
  const pos = randomWalkablePos();
  if (!pos) return;

  const instance = container.instantiateModelsToScene(
    name => name + '_' + def.id + '_' + Math.random().toString(36).slice(2, 6)
  );
  const rootNode = instance.rootNodes[0];
  const animGroups = instance.animationGroups;

  normalizeScale(rootNode, def.targetHeight);
  // Flowers are tiny — skip shadows entirely to save draw calls
  enableShadows(rootNode, def.id !== 'flower');

  if (def.animated && animGroups.length > 0) {
    const mixer = createAnimMixer(animGroups);
    const idleGroup = animGroups.find(a => /idle/i.test(a.name)) || animGroups[0];
    if (idleGroup) idleGroup.play(true);
    mixer.setTime(Math.random() * 3);
    animMixers.push(mixer);
  }

  rootNode.position = new Vector3(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  rootNode.rotation = new Vector3(0, Math.random() * Math.PI * 2, 0);

  if (def.id === 'flower') registerFlower(rootNode, pos.x, pos.z);
}

export async function loadAllModels(scene, onModel) {
  const progressFill = document.getElementById('load-fill');
  let loaded = 0;

  for (const def of MODEL_REGISTRY) {
    const mt0 = performance.now();
    try {
      // Load asset container (loaded once, instanced per clone)
      const container = await SceneLoader.LoadAssetContainerAsync(
        '', def.url, scene
      );
      stripExtraUVs(container);
      _containers.set(def.id, container);

      const fetchMs = (performance.now() - mt0).toFixed(0);

      // For flower, set the template from the first instance
      if (def.id === 'flower') {
        const templateInstance = container.instantiateModelsToScene(
          name => name + '_flowerTemplate'
        );
        const templateRoot = templateInstance.rootNodes[0];
        normalizeScale(templateRoot, def.targetHeight);
        setFlowerTemplate(templateRoot);
      }

      for (let i = 0; i < def.count; i++) {
        if (def.id === 'soldier') {
          placeSoldier(scene, container);
        } else if (def.id === 'fox') {
          placeFox(scene, container);
        } else {
          placeClone(scene, container, def);
        }
      }

      const totalMs = (performance.now() - mt0).toFixed(0);
      if (onModel) onModel(`${def.name} x${def.count} (fetch ${fetchMs}ms, total ${totalMs}ms)`);
    } catch (err) {
      console.warn(`Failed to load ${def.name}:`, err.message || err);
      if (onModel) onModel(`${def.name} FAILED`);
    }

    loaded++;
    if (progressFill) {
      progressFill.style.width = `${(loaded / MODEL_REGISTRY.length) * 100}%`;
    }
  }

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';
}

/** Get the container for a model ID (used by player.js to load Soldier) */
export function getContainer(id) {
  return _containers.get(id);
}
