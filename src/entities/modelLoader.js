import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MODEL_REGISTRY } from './models.js';
import { randomWalkablePos } from '../world/grid.js';
import { registerSoldier, registerFox } from '../systems/npcAI.js';
import { getTerrainHeight } from '../world/terrain.js';

const animMixers = [];

export function getAnimMixers() {
  return animMixers;
}

function loadGLTF(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function normalizeScale(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  model.scale.multiplyScalar(targetHeight / maxDim);
}

function enableShadows(model) {
  model.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function placeSoldier(scene, model, gltf) {
  const pos = randomWalkablePos();
  if (!pos) return;

  const clone = SkeletonUtils.clone(model);
  const mixer = new THREE.AnimationMixer(clone);

  const idleClip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
  const walkClip = gltf.animations.find(a => /walk/i.test(a.name)) || gltf.animations[1] || idleClip;

  mixer.setTime(Math.random() * idleClip.duration);
  animMixers.push(mixer);

  clone.traverse(c => {
    if (c.isMesh) {
      c.material = c.material.clone();
      c.material.color.multiply(new THREE.Color(0.7, 1.0, 0.75));
    }
  });

  clone.position.set(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  clone.rotation.y = Math.random() * Math.PI * 2;
  scene.add(clone);

  registerSoldier(clone, mixer, { idle: idleClip, walk: walkClip });
}

function placeFox(scene, model, gltf) {
  const pos = randomWalkablePos();
  if (!pos) return;

  const clone = SkeletonUtils.clone(model);
  const mixer = new THREE.AnimationMixer(clone);

  const anims = gltf.animations;
  const idleClip = anims.find(a => /survey/i.test(a.name)) || anims[0];
  const walkClip = anims.find(a => /walk/i.test(a.name)) || anims[1] || idleClip;
  const runClip = anims.find(a => /run/i.test(a.name)) || anims[2] || walkClip;

  mixer.setTime(Math.random() * idleClip.duration);
  animMixers.push(mixer);

  clone.position.set(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  clone.rotation.y = Math.random() * Math.PI * 2;
  scene.add(clone);

  registerFox(clone, mixer, { idle: idleClip, walk: walkClip, run: runClip });
}

function placeClone(scene, model, gltf, def) {
  const pos = randomWalkablePos();
  if (!pos) return;

  let clone;
  if (def.animated && gltf.animations.length) {
    clone = SkeletonUtils.clone(model);
    const mixer = new THREE.AnimationMixer(clone);
    const clip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
    mixer.clipAction(clip).play();
    mixer.setTime(Math.random() * clip.duration);
    animMixers.push(mixer);
  } else {
    clone = model.clone();
  }

  clone.position.set(pos.x, getTerrainHeight(pos.x, pos.z), pos.z);
  clone.rotation.y = Math.random() * Math.PI * 2;
  scene.add(clone);
}

export async function loadAllModels(scene) {
  const loader = new GLTFLoader();
  const progressFill = document.getElementById('load-fill');
  let loaded = 0;

  for (const def of MODEL_REGISTRY) {
    try {
      const gltf = await loadGLTF(loader, def.url);
      const model = gltf.scene;

      normalizeScale(model, def.targetHeight);
      enableShadows(model);

      for (let i = 0; i < def.count; i++) {
        if (def.id === 'soldier') {
          placeSoldier(scene, model, gltf);
        } else if (def.id === 'fox') {
          placeFox(scene, model, gltf);
        } else {
          placeClone(scene, model, gltf, def);
        }
      }

      console.log(`Loaded: ${def.name} (x${def.count})`);
    } catch (err) {
      console.warn(`Failed to load ${def.name}:`, err.message || err);
    }

    loaded++;
    if (progressFill) {
      progressFill.style.width = `${(loaded / MODEL_REGISTRY.length) * 100}%`;
    }
  }

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';
}
