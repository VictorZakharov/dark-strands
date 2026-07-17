import { PostProcess, SSAO2RenderingPipeline, DefaultRenderingPipeline, GlowLayer,
         Effect, Texture, Constants, Vector3, Color3, Scene } from 'babylonjs';
import { CFG } from '../config.js';
import { getEngine } from './scene.js';
import { getSunLight, getSunGroup } from './lighting.js';
import { getSunH, getSkyColor } from '../systems/daynight.js';
import { getWeatherModifiers } from '../systems/weather.js';

// Post-processing stack. Attach order (= execution order) matters:
//   1. SSAO2 pipeline (prepass MRT)          — AO composited on scene color (off by default)
//   2. volumetric fog PostProcess            — height fog + sun in-scatter + god rays
//   3. DefaultRenderingPipeline              — bloom, FXAA, sharpen (image processing stays
//                                              INLINE on materials — see note in initPostFX)
// Plus a GlowLayer (effect layer, not a post-process) for torch flames.
//
// The fog pass therefore receives tonemapped gamma-space color and mixes fog
// the same way the old built-in linear fog did — consistent with the pre-PR look.

// ─── Volumetric fog shader ───────────────────────────────────────────────────
// Analytic exponential height fog (density falls off with altitude) integrated
// along the view ray, plus Schlick-phase sun in-scatter and a screen-space
// god-ray march over the depth buffer's sky mask.
// Depth source: DepthRenderer with storeCameraSpaceZ (RH: negative in front,
// 0.0 = sky) — no NDC convention differences between WebGL2 and WebGPU.
// GLSL is WGSL-transpile-safe: fixed loop bounds, no gl_FragCoord, vUV only.

Effect.ShadersStore['volumetricFogFragmentShader'] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;   // scene color (linear HDR once DRP exists)
uniform sampler2D depthSampler;     // camera-space Z (negative in front, 0 = sky)

uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec2 uTanFov;               // (tan(fov/2)*aspect, tan(fov/2))
uniform vec3 uSunDir;               // normalized, TOWARD the sun
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform vec2 uSunScreenUV;
uniform vec4 uFogParams;            // x: sigma0, y: height falloff k, z: fog base Y, w: fog start distance
uniform vec4 uRayParams;            // x: ray intensity, y: per-sample decay, z: sun visibility, w: anisotropy g
uniform vec3 uBoxMin[16];           // building interior AABBs — fog-free volumes
uniform vec3 uBoxMax[16];
uniform float uBoxCount;

#define RAY_SAMPLES 24
#define SKY_DIST 340.0

float phaseSchlick(float mu, float g) {
  float k = 1.55 * g - 0.55 * g * g * g;
  float d = 1.0 - k * mu;
  return (1.0 - k * k) / (12.566371 * d * d);
}

// Height-fog integral over ray segment [a, b] (same closed form as main)
float segInteg(float a, float b, float dy) {
  return (abs(dy) > 1e-4) ? (exp(-a * dy) - exp(-b * dy)) / dy : (b - a);
}

void main() {
  vec3 sceneCol = texture2D(textureSampler, vUV).rgb;
  vec2 ndc = vUV * 2.0 - 1.0;
  vec3 rayDir = normalize(uCamForward + ndc.x * uTanFov.x * uCamRight
                                      + ndc.y * uTanFov.y * uCamUp);

  float zView = texture2D(depthSampler, vUV).r;
  float viewDist = -zView;                       // RH: stored Z negative in front
  float t = (viewDist < 1e-4) ? SKY_DIST
            : viewDist / max(dot(rayDir, uCamForward), 1e-4);

  // Analytic exponential height fog: density(y) = sigma0 * exp(-(y - baseY) * k),
  // integrated from a start offset s0 so near geometry (and building interiors,
  // where every ray is short) stays clear — matches the old linear fogStart.
  float k = uFogParams.y;
  float sigma = uFogParams.x * exp(-(uCamPos.y - uFogParams.z) * k);
  float dy = rayDir.y * k;
  float s0 = min(uFogParams.w, t);
  float integ = segInteg(s0, t, dy);

  // Subtract the ray segments that pass INSIDE buildings — there is no fog
  // indoors, whether the camera is in the room or looking in from outside
  // through a doorway or window. Ray-AABB slab tests against the (few)
  // building interior boxes.
  vec3 safeDir = mix(rayDir, vec3(1e-5), vec3(lessThan(abs(rayDir), vec3(1e-5))));
  vec3 invDir = 1.0 / safeDir;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uBoxCount) break;
    vec3 t0 = (uBoxMin[i] - uCamPos) * invDir;
    vec3 t1 = (uBoxMax[i] - uCamPos) * invDir;
    vec3 tmin3 = min(t0, t1);
    vec3 tmax3 = max(t0, t1);
    float tn = max(max(tmin3.x, tmin3.y), tmin3.z);
    float tf = min(min(tmax3.x, tmax3.y), tmax3.z);
    float a = max(max(tn, s0), 0.0);
    float b = min(tf, t);
    if (b > a) integ -= segInteg(a, b, dy);
  }
  integ = max(integ, 0.0);
  float trans = exp(-max(sigma * integ, 0.0));   // transmittance along the ray

  // Sun in-scatter tint on the fog. Multiplier deliberately well below the
  // physical 4pi normalization — at full strength the phase lobe turns the
  // horizon fog under the sun into a bright "second sun" blob.
  float mu = dot(rayDir, uSunDir);
  float phase = phaseSchlick(mu, uRayParams.w);
  vec3 inscatter = uFogColor + uSunColor * phase * uRayParams.z * 3.0;

  // Screen-space god rays: march toward the sun, accumulating sky visibility
  float rays = 0.0;
  if (uRayParams.z > 0.001) {
    vec2 duv = (uSunScreenUV - vUV) / float(RAY_SAMPLES);
    vec2 p = vUV;
    float w = 1.0;
    for (int i = 0; i < RAY_SAMPLES; i++) {
      p += duv;
      float sky = (texture2D(depthSampler, p).r > -1e-4) ? 1.0 : 0.0;
      rays += sky * w;
      w *= uRayParams.y;
    }
    rays = (rays / float(RAY_SAMPLES)) * uRayParams.x * uRayParams.z;
  }

  vec3 col = sceneCol * trans + inscatter * (1.0 - trans);
  col += uSunColor * rays * phase;
  gl_FragColor = vec4(col, 1.0);
}
`;

// The fog depth map only needs the big static occluders (fog varies smoothly
// with distance — small dynamic props contribute nothing visible). Bisect
// measured this pass at ~13ms/frame when it carried interior geometry and
// every door with zero culling — it re-rasterized the whole world at full
// res each frame. Interior meshes (floors/stairs/doors) are EXCLUDED: the
// fog integral starts past interior distances by design, so they contribute
// nothing. Water is included (forceDepthWriteTransparentMeshes) so the fog
// pass sees the water surface, not the seabed behind it.
const DEPTH_PASS_MESHES = [
  'ground', 'water', 'walls', 'flatRoofs', 'slantRoofs',
  // mergedMidFloors is REQUIRED: 1st-floor ceiling pixels whose ray exits
  // through a 2nd-floor window otherwise read sky depth, and the fog paints
  // ghost windows + fog lines onto the ceiling
  'mergedMidFloors',
  // ez-tree vegetation (ezTree_* branches/leaves) registers itself via
  // addFogDepthMesh at world-gen — trees/bushes silhouette against the sky
  // and MUST write fog depth.
  'mergedRocks',
];

// Dynamic meshes (NPCs, doors, torches, stones) opt into the fog depth pass —
// without a depth entry, anything silhouetted against the sky would be fogged
// at sky distance (fully fog-colored at close range) and god rays would shine
// straight through it.
const _extraDepthMeshes = [];

let _depthSet = null;

export function addFogDepthMesh(mesh) {
  if (!mesh || !CFG.GFX.VOL_FOG) return;
  _extraDepthMeshes.push(mesh);
  if (_depthSet) _depthSet.add(mesh);
  mesh.onDisposeObservable.add(() => {
    const i = _extraDepthMeshes.indexOf(mesh);
    if (i >= 0) _extraDepthMeshes.splice(i, 1);
    if (_depthSet) _depthSet.delete(mesh);
  });
}

/** Call after world build — points the fog depth pass at the merged world meshes. */
export function setDepthRenderList(scene) {
  if (!_depthRenderer) return;
  const list = DEPTH_PASS_MESHES.map(n => scene.getMeshByName(n)).filter(Boolean);
  // Doors MUST write fog depth: a closed door fills a doorway silhouetted
  // against outdoor sky — without a depth entry the fog paints the sky
  // gradient over the door and it reads as half transparent. They're cheap
  // now that the list is frustum-culled per frame.
  for (const m of scene.meshes) {
    if (m.name.startsWith('doorMerged_')) list.push(m);
  }
  list.push(..._extraDepthMeshes);
  _depthSet = new Set(list);
  const dm = _depthRenderer.getDepthMap();
  dm.renderList = list;
  // Per-pass list: frustum-culled (Babylon 9 RTTs do NO culling of their
  // own) and layerMask-aware (the 3rd-person player model is hidden in
  // first person purely via camera.layerMask — without this check the fog
  // pass would paint a model-shaped ghost).
  const scratch = [];
  dm.getCustomRenderList = () => {
    scratch.length = 0;
    const cam = scene.activeCamera;
    const planes = scene.frustumPlanes;
    for (const m of _depthSet) {
      if (!m.isEnabled() || !m.isVisible) continue;
      // __fogDepthAlways: opt-out for hidden-layer meshes that must write
      // fog depth even though no camera renders them (none at present)
      if (!m.__fogDepthAlways && cam && (m.layerMask & cam.layerMask) === 0) continue;
      if (planes && !m.isInFrustum(planes)) continue;
      scratch.push(m);
    }
    return scratch;
  };
}

let _depthRenderer = null;
let _fogPP = null;
let _fogDisabled = false; // debug passthrough (window._gfx.fog)
let _ssao = null;
let _drp = null;
let _glow = null;
let _glowMul = 1; // debug multiplier (window._gfx.glow) — updatePostFX applies it
const _pendingGlow = [];

const _fwd = new Vector3(0, 0, -1);
const _right = new Vector3(1, 0, 0);
const _up = new Vector3(0, 1, 0);
const _axisF = new Vector3(0, 0, -1);
const _axisR = new Vector3(1, 0, 0);
const _axisU = new Vector3(0, 1, 0);
const _sunTo = new Vector3(0, 1, 0);
const _sunNdc = new Vector3(0, 0, 0);
const _sunCol = new Color3(1, 0.9, 0.8);

export function getGlowLayer() { return _glow; }
export function getFogPostProcess() { return _fogPP; }

const _glowVisible = new Set(); // flames currently in the includedOnly list

// Building interior AABBs for the fog shader (max 16, packed xyz triplets)
let _fogBoxMin = new Array(48).fill(0);
let _fogBoxMax = new Array(48).fill(0);
let _fogBoxCount = 0;

/** Register building interiors as fog-free volumes (call after world gen). */
export function setFogInteriorBoxes(boxes) {
  _fogBoxCount = Math.min(boxes.length, 16);
  for (let i = 0; i < _fogBoxCount; i++) {
    _fogBoxMin[i * 3] = boxes[i].min.x;
    _fogBoxMin[i * 3 + 1] = boxes[i].min.y;
    _fogBoxMin[i * 3 + 2] = boxes[i].min.z;
    _fogBoxMax[i * 3] = boxes[i].max.x;
    _fogBoxMax[i * 3 + 1] = boxes[i].max.y;
    _fogBoxMax[i * 3 + 2] = boxes[i].max.z;
  }
}

/** Register a mesh with the glow layer (torch flames). Safe to call before init. */
export function glowInclude(mesh) {
  if (_glow) {
    _glow.addIncludedOnlyMesh(mesh);
    _glowVisible.add(mesh);
  } else {
    _pendingGlow.push(mesh);
  }
}

/**
 * Toggle a flame's glow-layer membership. The GlowLayer composites
 * additively in screen space with NO depth occlusion, so an occluded flame
 * bleeds its halo through walls — callers gate this with a physics
 * line-of-sight test from the camera (see updateTorchEmbers).
 */
export function glowSetVisible(mesh, visible) {
  if (!_glow || !mesh) return;
  const has = _glowVisible.has(mesh);
  if (visible && !has) {
    _glow.addIncludedOnlyMesh(mesh);
    _glowVisible.add(mesh);
  } else if (!visible && has) {
    _glow.removeIncludedOnlyMesh(mesh);
    _glowVisible.delete(mesh);
  }
}

function smoothstep01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function initPostFX(scene, camera) {
  const engine = getEngine();

  // 1. SSAO2 — half-res AO through the prepass path (no extra geometry pass)
  if (CFG.GFX.SSAO) {
    _ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]);
    _ssao.samples = 12;
    _ssao.radius = 0.8;
    _ssao.totalStrength = 1.0;
    _ssao.maxZ = 60;             // fade well before fogEnd hides the cutoff
    _ssao.minZAspect = 0.3;
    _ssao.epsilon = 0.02;
    _ssao.expensiveBlur = true;  // bilateral — avoids halos on hard low-poly edges
    _ssao.textureSamples = CFG.GFX.MSAA;
  }

  // 2. Volumetric fog
  if (CFG.GFX.VOL_FOG) {
    _depthRenderer = scene.enableDepthRenderer(
      camera, false, /* force32bitsFloat */ true,
      Texture.NEAREST_SAMPLINGMODE, /* storeCameraSpaceZ */ true);
    _depthRenderer.useOnlyInActiveCamera = true;
    // Water must write fog depth (it's alpha-blended); the whitelist in
    // setDepthRenderList keeps every other translucent mesh out of the pass
    _depthRenderer.forceDepthWriteTransparentMeshes = true;

    // Ratio MUST stay 1.0: this is the FIRST post-process in the chain, and
    // the first PP's ratio defines the render target the whole SCENE draws
    // into — 0.5 here rendered the entire game at half resolution ("looks
    // low res now"), and FPS didn't even move, proving the frame cost is
    // not pixel-bound.
    _fogPP = new PostProcess('volumetricFog', 'volumetricFog',
      ['uCamPos', 'uCamForward', 'uCamRight', 'uCamUp', 'uTanFov', 'uSunDir', 'uSunColor',
       'uFogColor', 'uSunScreenUV', 'uFogParams', 'uRayParams',
       'uBoxMin', 'uBoxMax', 'uBoxCount'],
      ['depthSampler'],
      1.0, camera, Texture.BILINEAR_SAMPLINGMODE, engine, false, null,
      Constants.TEXTURETYPE_HALF_FLOAT);

    _fogPP.onApplyObservable.add((effect) => {
      const sun = getSunLight();
      const m = getWeatherModifiers();
      const sunH = getSunH();

      camera.getDirectionToRef(_axisF, _fwd);
      camera.getDirectionToRef(_axisR, _right);
      camera.getDirectionToRef(_axisU, _up);
      const tanY = Math.tan(camera.fov / 2);
      const tanX = tanY * engine.getAspectRatio(camera);

      effect.setTexture('depthSampler', _depthRenderer.getDepthMap());
      effect.setVector3('uCamPos', camera.position);
      effect.setVector3('uCamForward', _fwd);
      effect.setVector3('uCamRight', _right);
      effect.setVector3('uCamUp', _up);
      effect.setFloat2('uTanFov', tanX, tanY);

      // Fog density mapped from the day/night+weather fog distances:
      // old linear fogEnd ~= 2% transmittance distance -> sigma0 = 3.9 / fogEnd
      const sigma0 = _fogDisabled ? 0 : 2.8 / Math.max(20, scene.fogEnd);
      effect.setFloat4('uFogParams', sigma0, 0.09, CFG.WATER_Y - 0.5, scene.fogStart);
      // Building interior boxes — the shader subtracts in-building ray
      // segments so interiors are fog-free from ANY viewpoint (inside the
      // room, or looking in through a doorway/window during a storm)
      effect.setFloat('uBoxCount', _fogBoxCount);
      effect.setArray3('uBoxMin', _fogBoxMin);
      effect.setArray3('uBoxMax', _fogBoxMax);

      if (sun) {
        _sunTo.set(-sun.direction.x, -sun.direction.y, -sun.direction.z).normalize();
      }
      effect.setVector3('uSunDir', _sunTo);
      const sunI = sun ? Math.min(1, sun.intensity) * 0.35 : 0;
      if (sun) {
        _sunCol.set(sun.diffuse.r * sunI, sun.diffuse.g * sunI, sun.diffuse.b * sunI);
        effect.setColor3('uSunColor', _sunCol);
      } else {
        effect.setColor3('uSunColor', getSkyColor());
      }
      effect.setColor3('uFogColor', scene.fogColor);

      // Sun screen position + god-ray visibility fades
      let sunVis = 0;
      let su = 0.5, sv = 0.5;
      const sg = getSunGroup();
      if (CFG.GFX.GOD_RAYS && !_fogDisabled && sg && sunH > 0) {
        Vector3.TransformCoordinatesToRef(sg.position, scene.getTransformMatrix(), _sunNdc);
        su = _sunNdc.x * 0.5 + 0.5;
        sv = _sunNdc.y * 0.5 + 0.5;
        const facing = _fwd.x * _sunTo.x + _fwd.y * _sunTo.y + _fwd.z * _sunTo.z;
        const offscreen = Math.max(0, Math.max(-su, su - 1, -sv, sv - 1));
        sunVis = smoothstep01(0, 0.15, sunH)
               * Math.max(0, Math.min(1, facing * 3))
               * Math.max(0, 1 - offscreen * 2.5)
               * Math.max(0, 1 - m.cloudCover * 1.2);
      }
      effect.setFloat2('uSunScreenUV', su, sv);
      effect.setFloat4('uRayParams', 1.2, 0.93, sunVis, 0.45); // g 0.45: wider, subtler sun lobe
    });

    // The post-process now owns fogging — kill built-in linear fog
    scene.fogMode = Scene.FOGMODE_NONE;
  }

  // 3. DefaultRenderingPipeline — FXAA only by default.
  // MSAA is deliberately 1: the fog pass samples a single-sampled depth map,
  // and MSAA'd scene edges vs aliased fog depth produce crawling fringes on
  // every tree/sky silhouette ("flickering trees"). With FXAA-only, color and
  // fog alias identically and FXAA smooths the combined result.
  // Bloom/sharpen are off for the same reason — bloom pulses around thin dark
  // canopy edges against the bright sky; the GlowLayer carries the torches.
  if (CFG.GFX.PIPELINE) {
    _drp = new DefaultRenderingPipeline('drp', true /* HDR chain */, scene, [camera]);
    _drp.samples = 1;
    _drp.fxaaEnabled = true;
    _drp.bloomEnabled = CFG.GFX.BLOOM === true; // opt-in via flag
    _drp.bloomThreshold = 0.9;
    _drp.bloomWeight = 0.15;
    _drp.bloomKernel = 56;
    _drp.bloomScale = 0.5;
    // Tone mapping stays INLINE on materials (scene.imageProcessingConfiguration
    // ACES, same as before this PR). Moving IP into the post chain makes the
    // ACES curve operate on linear values — empirically far darker mids, and
    // it retints every custom shader. FXAA doesn't need it.
    _drp.imageProcessingEnabled = false;
    _drp.grainEnabled = false;   // film grain reads as noise here
    _drp.sharpenEnabled = false; // amplifies edge crawl on flat-shaded geometry
  }

  // 4. GlowLayer — torch flames only (includeOnly keeps the RTT pass tiny)
  if (CFG.GFX.GLOW) {
    _glow = new GlowLayer('glow', scene, {
      mainTextureFixedSize: 512,
      blurKernelSize: 32,
    });
    _glow.intensity = 0.8;
    for (const m of _pendingGlow) {
      _glow.addIncludedOnlyMesh(m);
      _glowVisible.add(m);
    }
    _pendingGlow.length = 0;
  }

  // Runtime A/B toggles for tuning: window._gfx.ssao(false) etc.
  if (typeof window !== 'undefined') {
    window._gfx = {
      ssao: (on) => { if (_ssao) { _ssao.totalStrength = on ? 1.0 : 0.0; } },
      fog: (on) => { _fogDisabled = !on; }, // passthrough — never detach a PP around pipelines
      bloom: (on) => { if (_drp) _drp.bloomEnabled = !!on; },
      grain: (on) => { if (_drp) _drp.grainEnabled = !!on; },
      sharpen: (on) => { if (_drp) _drp.sharpenEnabled = !!on; },
      glow: (v) => { _glowMul = v; }, // multiplier — updatePostFX owns the base intensity
      // Bisect helper: force the sun shadow map back to every-frame rendering
      // (disables the event-driven refresh optimization entirely)
      shadowEveryFrame: () => {
        const sun = getSunLight();
        const sg = sun && sun.getShadowGenerator && sun.getShadowGenerator();
        const sm = sg && sg.getShadowMap();
        if (sm) { sm.refreshRate = 1; return 'sun shadow: every frame'; }
        return 'no shadow map';
      },
      pipeline: () => ({ ssao: !!_ssao, fog: !!_fogPP, drp: !!_drp, glow: !!_glow }),
    };
  }
}

/** Per-frame post-FX state driven by day/night — call after updateDayNight. */
export function updatePostFX() {
  if (_glow) {
    const nightBlend = Math.max(0, -getSunH());
    _glow.intensity = (0.4 + nightBlend * 0.8) * _glowMul;
  }
}
