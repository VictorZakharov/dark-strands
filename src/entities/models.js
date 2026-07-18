import { CFG } from '../config.js';

export const MODEL_REGISTRY = [
  {
    id: 'soldier',
    name: 'Soldier',
    url: './assets/models/Soldier.glb',
    targetHeight: CFG.SOLDIER_H,
    count: 5,
    animated: true,
    license: 'MIT (Three.js examples)',
  },
  {
    id: 'fox',
    name: 'Fox',
    url: './assets/models/Fox.glb',
    targetHeight: CFG.FOX_H,
    count: 4,
    animated: true,
    license: 'CC-BY 4.0 (Khronos glTF-Sample-Assets)',
  },
  // NOTE: wildflowers are NOT here — they're thin-instanced by
  // world/vegetation.js (placeFlowers) and made pickable/plantable by
  // world/flowers.js, so every flower in the field is interactable.
];
