import {
  PointLight, ShadowGenerator, Color3, Vector3,
  ClusteredLightContainer
} from 'babylonjs';
import { shadowThrottled } from '../core/scene.js';

// 3 slots: with near-torch caster subsets a cube costs ~70 draws/frame, and
// two slots left the 3rd-nearest torch (e.g. mounted under a ceiling in a
// multi-torch building) lighting the floor above through the slab
const MAX_SHADOW_TORCHES = 3;
const shadowSlots = [];
const _shadowGenerators = [];
const _allCasters = []; // master caster list — slots get a near-torch subset
let _container = null;
let _scene = null;

/** Register a mesh as a shadow caster for all torch shadow generators */
export function addTorchShadowCaster(mesh) {
  _allCasters.push(mesh);
  if (mesh.getChildMeshes) _allCasters.push(...mesh.getChildMeshes());
  for (const sg of _shadowGenerators) {
    sg.addShadowCaster(mesh, true);
  }
}

/**
 * Rebuild one slot's shadow render list with only casters near its torch.
 * The cubes render 6 faces x every caster submesh EVERY frame (throttling is
 * broken on WebGPU — see initTorchLightPool), and Babylon's per-face culling
 * does not drop far-away doors, so without this each 6-unit-range light was
 * re-rendering every door in the world (~528 draws per cube per frame).
 * Skinned meshes (player model) stay in unconditionally — they move.
 */
export function setSlotShadowCasters(i, center) {
  const sg = _shadowGenerators[i];
  const sm = sg && sg.getShadowMap();
  if (!sm) return;
  sm.renderList = _allCasters.filter((m) => {
    if (m.skeleton) return true;
    const bi = m.getBoundingInfo && m.getBoundingInfo();
    if (!bi) return true;
    const bs = bi.boundingSphere;
    const dx = bs.centerWorld.x - center.x;
    const dy = bs.centerWorld.y - center.y;
    const dz = bs.centerWorld.z - center.z;
    const r = 10 + bs.radiusWorld; // light shadowMaxZ 8 + margin
    return dx * dx + dy * dy + dz * dz < r * r;
  });
}

/** Empty a parked slot's render list — its cube still clears each frame. */
export function clearSlotShadowCasters(i) {
  const sg = _shadowGenerators[i];
  const sm = sg && sg.getShadowMap();
  if (sm) sm.renderList = [];
}

export function getTorchShadowGenerators() { return _shadowGenerators; }

export function getShadowSlots() { return shadowSlots; }

export function getClusteredContainer() { return _container; }

export function initTorchLightPool(scene) {
  _scene = scene;
  // Clustered container — manages all torch PointLights via GPU tiling
  _container = new ClusteredLightContainer("torchCluster", [], scene);

  // Shadow slot lights — in the scene (not clustered), for shadow-casting
  for (let i = 0; i < MAX_SHADOW_TORCHES; i++) {
    const light = new PointLight(`torchShadow_${i}`, new Vector3(0, -100, 0), scene);
    light.diffuse = new Color3(1, 0.533, 0.2);
    light.intensity = 0;
    light.range = 6;
    light.metadata = {};
    const sg = new ShadowGenerator(256, light);
    sg.usePercentageCloserFiltering = true;
    sg.bias = 0.001;
    sg.normalBias = 0.01;
    light.shadowMinZ = 0.1;
    light.shadowMaxZ = 8;
    light.metadata.shadowGen = sg;
    // Event-driven refresh is WebGL2-ONLY (torchParticles re-arms on slot
    // moves + a staggered heartbeat). On WebGPU any throttled shadow map
    // intermittently re-renders from stale GPU state — see the sun shadow
    // comment in core/lighting.js — so the cubes render every frame there.
    if (shadowThrottled()) {
      const sm = sg.getShadowMap();
      if (sm) sm.refreshRate = 0;
    }
    _shadowGenerators.push(sg);
    shadowSlots.push(light);
  }
}
