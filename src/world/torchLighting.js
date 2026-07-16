import {
  PointLight, ShadowGenerator, Color3, Vector3,
  ClusteredLightContainer
} from 'babylonjs';

const MAX_SHADOW_TORCHES = 2;
const shadowSlots = [];
const _shadowGenerators = [];
let _container = null;
let _scene = null;

/** Register a mesh as a shadow caster for all torch shadow generators */
export function addTorchShadowCaster(mesh) {
  for (const sg of _shadowGenerators) {
    sg.addShadowCaster(mesh, true);
  }
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
    // Event-driven refresh (6 cube faces x casters otherwise render every
    // frame): torchParticles re-arms via resetRefreshCounter when a slot
    // moves to another torch, plus a staggered heartbeat.
    const sm = sg.getShadowMap();
    if (sm) sm.refreshRate = 0;
    _shadowGenerators.push(sg);
    shadowSlots.push(light);
  }
}
