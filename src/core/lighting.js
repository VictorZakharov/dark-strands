import { HemisphericLight, DirectionalLight, Vector3,
         Color3, MeshBuilder, ShaderMaterial, Effect,
         TransformNode, LensFlareSystem, LensFlare,
         ShadowGenerator, CascadedShadowGenerator } from 'babylonjs';
import { isWebGPU } from './scene.js';
import { CFG } from '../config.js';

let sunLight, hemiLight, sunCSM;
let stars = null, sunGroup = null, sunLensflare = null;
let sunGlowMat = null;
let _throttleSunShadow = false; // WebGL2 only — see initLighting

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
uniform float uFade;
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

  float alpha = glow * uFade;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(color * glow * uFade, alpha);
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

  if (CFG.GFX.SHADOWS === 'csm') {
    // Cascaded shadow maps — frusta derived from the active camera every frame,
    // dense texel budget where the player is looking. Note: CSM was tried and
    // reverted once (commit 00273ef -> 1d2cb64) when the world was ~100 unmerged
    // casters; geometry is now merged into a handful of meshes, so the
    // cascades * casters draw cost is acceptable.
    sunCSM = new CascadedShadowGenerator(CFG.GFX.SHADOW_MAP, sunLight);
    sunCSM.numCascades = CFG.GFX.CASCADES;
    sunCSM.lambda = 0.8;              // log-heavy split — near-field density
    sunCSM.shadowMaxZ = 100;          // fog hides everything past ~90 anyway
    sunCSM.stabilizeCascades = true;  // kills translation shimmer
    sunCSM.cascadeBlendPercentage = 0;
    sunCSM.depthClamp = true;
    sunCSM.autoCalcDepthBounds = false; // avoids a full-scene depth reduction pass
    sunCSM.usePercentageCloserFiltering = true;
    sunCSM.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sunCSM.setDarkness(0.1);
    sunCSM.bias = 0.01;
    sunCSM.normalBias = 0.02;
  } else {
    // Default — single-map PCF following the player (identical to pre-VFX look).
    // FIXED-SIZE frustum: the default auto-fit re-fits the projection around
    // ALL casters (including wandering NPCs) on every render, so a throttled
    // map reframes between refreshes and tree canopies strobe between
    // shadowed/unshadowed facets. A fixed frustum makes every re-render
    // identically framed, which is what allows the event-driven refresh in
    // updateSunShadow (the sun shadow pass is ~870 draws — by far the largest
    // per-frame cost when rendered every frame).
    sunCSM = new ShadowGenerator(CFG.GFX.SHADOW_MAP, sunLight);
    sunCSM.usePercentageCloserFiltering = true;
    // MEDIUM, not HIGH: HIGH doubles per-pixel shadow cost SCENE-WIDE and
    // measurably capped FPS (~34ms GPU floor). The day/night shadow lurch it
    // was bumped for is actually fixed by the rotation-aware texel rounding.
    sunCSM.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    sunCSM.setDarkness(0.1);
    // Bias low: high values open a lit "shadow gap" strip under roof eaves
    // (peter-panning). The acne flicker that motivated higher bias is fixed
    // structurally — the shadow frustum follows the player on a FIXED texel
    // lattice, so shadow sampling is world-stable while moving.
    sunCSM.bias        = 0.002;
    sunCSM.normalBias  = 0.012;
    sunLight.shadowFrustumSize = 120; // ±60 around the player — fog hides the rest
    sunLight.shadowMinZ = 1;
    sunLight.shadowMaxZ = 200;
    // Event-driven refresh is WebGL2-ONLY. On WebGPU a throttled shadow map
    // (any skipped frame: refreshRate=0+re-arm, 2, or 8) intermittently
    // re-renders from stale GPU-side state — a bit-exact replay of an
    // earlier pass that ignores current uniforms — so trees/houses strobe
    // at the refresh cadence. Reproduced on Babylon 8.52.1/8.56.2/9.17.0,
    // compat mode on/off, UBO content-check off, drawContext.reset(), with
    // and without skinned casters (screenshot pixel-diff harness). Until
    // fixed upstream, WebGPU renders the map every frame; the fixed frustum
    // still culls casters, which keeps the pass far cheaper than auto-fit.
    _throttleSunShadow = !isWebGPU();
    if (_throttleSunShadow) {
      const sm = sunCSM.getShadowMap();
      if (sm) sm.refreshRate = 0; // REFRESHRATE_RENDER_ONCE; resetRefreshCounter() re-arms
    }
  }

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
    uniforms: ['worldViewProjection', 'uFade'],
  });
  sunMat.setFloat('uFade', 1);
  sunGlowMat = sunMat;
  sunMat.alpha = 0.99; // enable alpha blending
  sunMat.alphaMode = 1; // ALPHA_ADD (additive blending)
  sunMat.backFaceCulling = false;
  sunMat.disableDepthWrite = true;
  sunMesh.material = sunMat;
  sunMesh.isPickable = false;
  sunMesh.applyFog = false;
  sunMesh.metadata = { noDepthPass: true }; // sky element — keep out of the fog depth map

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
 * Call from the game loop with the player's world position.
 */
let _shSnapX = Infinity, _shSnapY = Infinity, _shSnapZ = Infinity;
const _shLastDir = new Vector3(0, 0, 0);
let _shFrame = 0;
// The transform the CURRENT shadow map contents were rendered from. On the
// throttled path this must be re-asserted every frame: Babylon rebuilds the
// shadow sampling matrix from sunLight.position in the main pass EVERY frame,
// so if anything else moves the light between refreshes, the matrix no longer
// matches the texture and the whole shadow field slides off its casters.
const _shCommittedPos = new Vector3(0, 0, 0);
let _shHasCommitted = false;

export function updateSunShadow(px, py, pz) {
  if (!sunLight) return;
  // CSM fits cascade frusta from the active camera automatically — light
  // position is ignored, only sunLight.direction matters (set in main loop).
  if (CFG.GFX.SHADOWS === 'csm') return;

  // WebGPU renders the map every frame, so follow the player CONTINUOUSLY —
  // the texel-lattice rounding below keeps the map's world-space texel grid
  // stationary, so a wall pixel's shadow classification never changes while
  // walking. (The old 2-unit snap re-framed the map in 34-texel jumps and
  // the grazing eave-shadow band on walls flickered at every crossing.)
  // WebGL2 keeps the snap: it gates the event-driven re-render cadence.
  const SNAP = _throttleSunShadow ? 2 : 0;
  const qx = SNAP ? Math.round(px / SNAP) * SNAP : px;
  const qy = SNAP ? Math.round(py / SNAP) * SNAP : py;
  const qz = SNAP ? Math.round(pz / SNAP) * SNAP : pz;
  _shFrame++;

  const d = sunLight.direction;
  const dirChanged = Math.abs(d.x - _shLastDir.x) + Math.abs(d.y - _shLastDir.y)
                   + Math.abs(d.z - _shLastDir.z) > 0.0005;
  if (_throttleSunShadow) {
    const moved = qx !== _shSnapX || qy !== _shSnapY || qz !== _shSnapZ;
    const heartbeat = _shFrame % 8 === 0;
    if (!moved && !dirChanged && !heartbeat) {
      // Skipped frame: the map is NOT re-rendering, so pin the light to the
      // transform it was last rendered from (see _shCommittedPos above).
      if (_shHasCommitted) sunLight.position.copyFrom(_shCommittedPos);
      return;
    }
    _shSnapX = qx; _shSnapY = qy; _shSnapZ = qz;
  }
  _shLastDir.copyFrom(d);

  // Texel-align the frustum center: a 2-unit world snap is a NON-integer
  // number of shadow texels (2 / (120/2048) = 34.13), so each refresh would
  // re-resolve every shadow edge slightly differently and borderline
  // flat-shaded facets flip (flickering trees/houses). Snapping the center to
  // whole texels in the light's view basis makes consecutive maps exact
  // whole-texel shifts of each other — same idea as CSM stabilizeCascades.
  // Basis matches Babylon's shadow view matrix: LookAtLH(pos, pos+dir, UP).
  const fl = Math.hypot(d.x, d.y, d.z);
  const fx = d.x / fl, fy = d.y / fl, fz = d.z / fl;
  let axx = fz, axy = 0, axz = -fx;            // cross(UP, f)
  const al = Math.hypot(axx, axz);
  if (al > 1e-4) { axx /= al; axz /= al; } else { axx = 1; axz = 0; } // sun overhead
  const ayx = fy * axz - fz * axy;             // cross(f, xaxis)
  const ayy = fz * axx - fx * axz;
  const ayz = fx * axy - fy * axx;
  // Texel-round ONLY while the sun is stationary. Rounding against a
  // ROTATING basis (day/night cycle on) disagrees between frames by up to a
  // whole texel, lurching the entire map sideways each frame — shadow bands
  // on walls visibly flicker while standing still. A smooth crawl reads as
  // intended motion; the snap only exists to stabilize the static-sun case.
  const texel = (sunLight.shadowFrustumSize || 120) / CFG.GFX.SHADOW_MAP;
  let cx = qx * axx + qy * axy + qz * axz;
  let cy = qx * ayx + qy * ayy + qz * ayz;
  if (!dirChanged) {
    cx = Math.round(cx / texel) * texel;
    cy = Math.round(cy / texel) * texel;
  }
  const cf = qx * fx + qy * fy + qz * fz;      // along-dir: depth only, no snap needed
  sunLight.position.set(
    axx * cx + ayx * cy + fx * (cf - 70),
    axy * cx + ayy * cy + fy * (cf - 70),
    axz * cx + ayz * cy + fz * (cf - 70)
  );
  _shCommittedPos.copyFrom(sunLight.position);
  _shHasCommitted = true;
  if (_throttleSunShadow) {
    const sm = sunCSM ? sunCSM.getShadowMap() : null;
    if (sm) sm.resetRefreshCounter();
  }
}

/** Fade the sun glow billboard (0..1) — cloud cover hides the sun disc */
export function setSunGlowFade(f) {
  if (sunGlowMat) sunGlowMat.setFloat('uFade', f);
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
