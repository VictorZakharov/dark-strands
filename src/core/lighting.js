import { HemisphericLight, DirectionalLight, Vector3,
         Color3, MeshBuilder, ShaderMaterial, Effect,
         TransformNode, LensFlareSystem, LensFlare,
         ShadowGenerator } from 'babylonjs';
import { isWebGPU } from './scene.js';

let sunLight, hemiLight, sunCSM;
let stars = null, sunGroup = null, sunLensflare = null;

const SHADOW_FRUSTUM = 50;   // ortho half-extent (100×100 world units)
const SHADOW_MAP_SIZE = 2048;

export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }
export function getSunCSM() { return sunCSM; }
export function getStars() { return stars; }
export function getSunGroup() { return sunGroup; }
export function getSunLensflare() { return sunLensflare; }

// --- Sun glow shader (radial gradient, no hard edges) ---
Effect.ShadersStore['sunGlowVertexShader'] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore['sunGlowFragmentShader'] = `
precision highp float;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float dist = length(p);

  // Bright core (tight Gaussian)
  float core = exp(-dist * dist * 12.0);
  // Warm corona (wider Gaussian)
  float corona = exp(-dist * dist * 2.5) * 0.6;
  // Outer haze (very wide)
  float haze = exp(-dist * dist * 0.8) * 0.15;

  float glow = core + corona + haze;

  // Color: white core → warm yellow → orange edges
  vec3 white = vec3(1.0, 1.0, 0.98);
  vec3 warm  = vec3(1.0, 0.85, 0.5);
  vec3 outer = vec3(1.0, 0.6, 0.2);
  vec3 color = mix(outer, warm, smoothstep(0.7, 0.0, dist));
  color = mix(color, white, core);

  float alpha = glow;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(color * glow, alpha);
}
`;

export function initLighting(scene) {
  // Hemisphere light (sky + ground ambient)
  hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemiLight.diffuse = Color3.FromHexString('#87CEEB');
  hemiLight.groundColor = new Color3(0.227, 0.353, 0.165); // #3a5a2a
  hemiLight.intensity = 0.45;

  // Directional sun light — direction points FROM sun TO scene
  sunLight = new DirectionalLight('sun', new Vector3(-1, -2, -1).normalize(), scene);
  sunLight.diffuse = new Color3(1, 0.933, 0.867); // #ffeedd
  sunLight.intensity = 1.5;
  sunLight.position = new Vector3(30, 60, 30);

  // Fixed orthographic frustum — prevents auto-resize flickering during day/night
  sunLight.autoUpdateExtends = false;
  sunLight.orthoLeft   = -SHADOW_FRUSTUM;
  sunLight.orthoRight  =  SHADOW_FRUSTUM;
  sunLight.orthoTop    =  SHADOW_FRUSTUM;
  sunLight.orthoBottom = -SHADOW_FRUSTUM;
  sunLight.shadowMinZ  = 1;
  sunLight.shadowMaxZ  = 200;

  // Shadow generator — PCF (Percentage Closer Filtering) for sharp, reliable shadows.
  sunCSM = new ShadowGenerator(SHADOW_MAP_SIZE, sunLight);
  sunCSM.usePercentageCloserFiltering = true;
  sunCSM.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  sunCSM.setDarkness(0.1);
  sunCSM.bias        = 0.005;
  sunCSM.normalBias  = 0.02;

  // --- Sun visual (glowing radial gradient in the sky) ---
  sunGroup = new TransformNode('sunGroup', scene);

  const sunMesh = MeshBuilder.CreatePlane('sunGlow', { size: 50 }, scene);
  sunMesh.parent = sunGroup;
  sunMesh.billboardMode = 7; // BILLBOARDMODE_ALL
  const sunMat = new ShaderMaterial('sunGlowMat', scene, {
    vertex: 'sunGlow',
    fragment: 'sunGlow',
  }, {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection'],
  });
  sunMat.alpha = 0.99; // enable alpha blending
  sunMat.alphaMode = 1; // ALPHA_ADD (additive blending)
  sunMat.backFaceCulling = false;
  sunMat.disableDepthWrite = true;
  sunMesh.material = sunMat;
  sunMesh.isPickable = false;
  sunMesh.applyFog = false;

  // --- Lens flare system (skip on WebGPU — null texture binding crash) ---
  if (!isWebGPU()) {
    sunLensflare = new LensFlareSystem('sunFlares', sunGroup, scene);
    new LensFlare(0.5, 0, new Color3(1, 0.95, 0.8), null, sunLensflare);
    new LensFlare(0.1, 0.3, new Color3(0.8, 0.6, 0.2), null, sunLensflare);
    new LensFlare(0.15, 0.5, new Color3(0.5, 0.8, 1.0), null, sunLensflare);
    new LensFlare(0.08, 0.7, new Color3(1.0, 0.5, 0.3), null, sunLensflare);
    new LensFlare(0.2, 1.0, new Color3(0.6, 0.4, 0.2), null, sunLensflare);
  }
}

/**
 * Move the shadow camera to follow the player each frame.
 * Snaps the light position to the shadow map texel grid in light-space
 * to prevent shadow swimming when the sun or player moves continuously.
 */
export function updateSunShadow(px, py, pz) {
  if (!sunLight) return;
  const d = sunLight.direction;

  // Position light opposite to direction, centered on player
  let lx = px - d.x * 70;
  let ly = py - d.y * 70;
  let lz = pz - d.z * 70;

  // Texel snapping — project position onto the light's image plane (perpendicular
  // to direction), round to texel boundaries, then reconstruct world position.
  const rlen = Math.sqrt(d.x * d.x + d.z * d.z);
  if (rlen > 0.0001) {
    // Light-space right = normalize(cross(worldUp, lightDir))
    const rx = d.z / rlen;
    const rz = -d.x / rlen;
    // Light-space up = cross(lightDir, right)
    const upx = -d.y * d.x / rlen;
    const upy = rlen;
    const upz = -d.y * d.z / rlen;

    const texelSize = (SHADOW_FRUSTUM * 2) / SHADOW_MAP_SIZE;

    const projR = lx * rx + lz * rz;
    const projU = lx * upx + ly * upy + lz * upz;
    const dR = Math.round(projR / texelSize) * texelSize - projR;
    const dU = Math.round(projU / texelSize) * texelSize - projU;

    lx += dR * rx + dU * upx;
    ly += dU * upy;
    lz += dR * rz + dU * upz;
  }

  sunLight.position.set(lx, ly, lz);
}

/** Register a mesh as a shadow caster with the CSM generator */
export function addShadowCaster(mesh) {
  if (sunCSM) {
    sunCSM.addShadowCaster(mesh, true);
  }
}

/** Enable shadow receiving on a mesh */
export function enableShadowReceiving(mesh) {
  mesh.receiveShadows = true;
}

/**
 * Dump full shadow system state to the console for debugging.
 * Call from browser console: window._debugShadows()
 */
export function debugShadows() {
  const scene = sunLight?.getScene();
  console.group('[Shadow Debug]');
  console.log('scene.shadowsEnabled:', scene?.shadowsEnabled);
  console.log('sunLight exists:', !!sunLight);
  console.log('sunLight.shadowEnabled:', sunLight?.shadowEnabled);
  console.log('sunLight._shadowEnabled:', sunLight?._shadowEnabled);
  console.log('sunCSM exists:', !!sunCSM);
  console.log('sunCSM type:', sunCSM?.constructor?.name);
  console.log('sunCSM.getClassName():', sunCSM?.getClassName?.());

  const sm = sunCSM?.getShadowMap?.();
  console.log('shadowMap exists:', !!sm);
  if (sm) {
    console.log('shadowMap.renderList:', sm.renderList);
    console.log('shadowMap.renderList length:', sm.renderList?.length);
    if (sm.renderList) {
      console.log('shadowMap casters:', sm.renderList.slice(0, 10).map(m => m.name));
    }
    console.log('shadowMap size:', sm.getSize());
  }

  // Check light._shadowGenerators map
  console.log('sunLight._shadowGenerators:', sunLight?._shadowGenerators);
  if (sunLight?._shadowGenerators) {
    console.log('_shadowGenerators size:', sunLight._shadowGenerators.size);
    for (const [key, val] of sunLight._shadowGenerators.entries()) {
      console.log('  key:', key, 'val:', val?.getClassName?.());
    }
  }

  // Check getShadowGenerator with and without camera
  if (scene) {
    const sgByCam = sunLight?.getShadowGenerator?.(scene.activeCamera);
    const sgNoArg = sunLight?.getShadowGenerator?.();
    console.log('getShadowGenerator(activeCamera):', sgByCam?.getClassName?.() ?? null);
    console.log('getShadowGenerator():', sgNoArg?.getClassName?.() ?? null);
    console.log('scene.activeCamera:', scene.activeCamera?.name);
  }

  // Check receiving meshes
  if (scene) {
    const receivers = scene.meshes.filter(m => m.receiveShadows);
    console.log('receiveShadows meshes:', receivers.length, receivers.slice(0, 5).map(m => m.name));
    // Check lightSources for the ground mesh
    const ground = scene.getMeshByName('ground');
    if (ground) {
      console.log('ground.receiveShadows:', ground.receiveShadows);
      console.log('ground._lightSources:', ground._lightSources?.map(l => l.name));
    }
    // Check shadow test ground
    const testGround = scene.getMeshByName('shadowTestGround');
    if (testGround) {
      console.log('testGround.receiveShadows:', testGround.receiveShadows);
      console.log('testGround._lightSources:', testGround._lightSources?.map(l => l.name));
    }
    // Check shadow test box (caster)
    const testBox = scene.getMeshByName('shadowTestBox');
    if (testBox) {
      console.log('testBox in renderList:', sm?.renderList?.includes(testBox));
    }
    // Log total lights
    console.log('Total scene lights:', scene.lights.length);
    console.log('Enabled lights:', scene.lights.filter(l => l.isEnabled()).length);
    console.log('Scene lights:', scene.lights.filter(l => l.isEnabled()).map(l => l.name + '(' + l.getClassName() + ')'));
  }
  console.groupEnd();
}
