import {
  MeshBuilder, Mesh, StandardMaterial, PointLight,
  Color3, Vector3, TransformNode
} from 'babylonjs';
import { getCamBlend } from '../entities/player.js';
import { ensureMaterials, getMaterials } from './torches.js';
import { createEmberSystem, getTorchTimer } from './torchParticles.js';
import { glowInclude, addFogDepthMesh } from '../core/postfx.js';

let heldGroup = null;
let heldLight = null;
let heldFlame = null;
let heldGlow = null;
let heldParticles = null;
let heldSmoke = null;
let heldSparks = null;

export function initHeldTorch(scene) {
  heldGroup = new TransformNode('heldTorchGroup', scene);

  ensureMaterials(scene);
  const { flameMat, stickMat, glowMat } = getMaterials();

  const stick = MeshBuilder.CreateCylinder('heldTorchStick', {
    diameterTop: 0.04, diameterBottom: 0.06, height: 0.5, tessellation: 4,
  }, scene);
  stick.material = stickMat;
  stick.parent = heldGroup;
  stick.isPickable = false;

  heldFlame = MeshBuilder.CreateSphere('heldTorchFlame', { diameter: 0.12, segments: 5 }, scene);
  heldFlame.material = flameMat;
  heldFlame.position = new Vector3(0, 0.3, 0);
  heldFlame.scaling.set(0.8, 1.4, 0.8);
  heldFlame.parent = heldGroup;
  heldFlame.isPickable = false;
  glowInclude(heldFlame);
  addFogDepthMesh(stick);
  addFogDepthMesh(heldFlame); // held torch vs sky must not fog at sky distance

  heldGlow = MeshBuilder.CreatePlane('heldTorchGlow', { size: 0.8 }, scene);
  heldGlow.material = glowMat;
  heldGlow.parent = heldGroup;
  heldGlow.position = heldFlame.position.clone();
  heldGlow.billboardMode = Mesh.BILLBOARDMODE_ALL;
  heldGlow.isPickable = false;

  heldGroup.setEnabled(false);

  // Held torch light
  heldLight = new PointLight('heldTorchLight', new Vector3(0, -100, 0), scene);
  heldLight.diffuse = new Color3(1, 0.533, 0.2);
  heldLight.intensity = 0.001;
  heldLight.range = 6;
  heldLight.metadata = {};

  // Create particle systems for held torch
  const tWrapper = { light: { name: 'held' }, flame: heldFlame };
  createEmberSystem(scene, tWrapper);
  heldParticles = tWrapper.particles;
  heldSmoke = tWrapper.smokeParticles;
  heldSparks = tWrapper.sparkParticles;
}

export function updateHeldTorch(camera, active, playerState) {
  try {
    if (!heldGroup || !heldLight) return;

    if (!active) {
      heldGroup.setEnabled(false);
      heldLight.intensity = 0.001; // tiny — keeps WebGPU pipeline warm
      heldLight.position.set(0, -100, 0); // park far away
      if (heldParticles && heldParticles.isStarted()) {
        heldParticles.stop();
        if (heldSmoke) heldSmoke.stop();
        if (heldSparks) heldSparks.stop();
      }
      return;
    }

    heldGroup.setEnabled(true);

    const _torchTimer = getTorchTimer();
    const flicker = 0.95 + 0.05 * Math.sin(_torchTimer * 8.0) + 0.03 * Math.cos(_torchTimer * 15.0);
    heldLight.intensity = 1.6 * (isNaN(flicker) ? 1.0 : flicker);
    const s = 0.9 + 0.1 * (isNaN(flicker) ? 1.0 : flicker);
    heldFlame.scaling.set(s * 0.8, s * 1.4, s * 0.8);
    heldGlow.scaling.set(s * 1.4, s * 1.4, 1);

    // Start particles if not running
    if (heldParticles && !heldParticles.isStarted()) {
      heldParticles.start();
      if (heldSmoke) heldSmoke.start();
      if (heldSparks) heldSparks.start();
    }

    let px = 0, py = 0, pz = 0;
    try {
      // Use 3rd-person positioning whenever camera isn't fully in 1st person
      if (playerState && !isNaN(playerState.x) && getCamBlend() > 0.01) {
        const yaw = playerState.yaw || 0;
        const rX = Math.cos(yaw), rZ = -Math.sin(yaw);
        const fX = -Math.sin(yaw), fZ = -Math.cos(yaw);
        px = playerState.x + rX * 0.35 + fX * 0.25;
        py = playerState.y + 1.1;
        pz = playerState.z + rZ * 0.35 + fZ * 0.25;
      } else {
        const fwd = camera.getForwardRay(1).direction;
        const yAxis = new Vector3(0, 1, 0);
        const right = Vector3.Cross(fwd, yAxis).normalize();
        px = camera.globalPosition.x + right.x * 0.35 + fwd.x * 0.3;
        py = camera.globalPosition.y - 0.45;
        pz = camera.globalPosition.z + right.z * 0.35 + fwd.z * 0.3;
      }
    } catch (e) {
      // Fallback if camera ray fails
      px = camera.globalPosition.x; py = camera.globalPosition.y; pz = camera.globalPosition.z;
    }

    if (!isNaN(px)) heldGroup.position.set(px, py, pz);

    // Force absolute position update for particles
    heldFlame.computeWorldMatrix(true);
    heldGlow.computeWorldMatrix(true);

    // Particle position update — sync all three systems
    if (heldParticles) heldParticles.emitter = heldFlame;
    if (heldSmoke) heldSmoke.emitter = heldFlame;
    if (heldSparks) heldSparks.emitter = heldFlame;

    // Keep torch upright with subtle tilt
    heldGroup.rotation = new Vector3(0, 0, -0.15);

    // Light at flame tip
    if (!isNaN(px)) heldLight.position.set(px, py + 0.35, pz);
  } catch (err) {
    console.warn("[TORCH] updateHeldTorch failed:", err);
  }
}

export function hideHeldTorch() {
  if (heldGroup) heldGroup.setEnabled(false);
  if (heldLight) {
    heldLight.intensity = 0.001;
    heldLight.position.y = -100;
  }
}

/** Pre-warm held torch for WebGPU pipeline compilation (call before first scene.render) */
export function prewarmHeldTorch(playerPos) {
  if (!heldGroup || !heldLight) return;
  heldGroup.setEnabled(true);
  heldLight.intensity = 1.5;
  heldLight.position = new Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z);
  heldGroup.position = new Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z);
}
