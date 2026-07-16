import { MeshBuilder, ShaderMaterial, Effect, Vector3, Color3, Vector2 } from 'babylonjs';
import { CFG } from '../config.js';
import { getScene } from './scene.js';
import { getSunLight } from './lighting.js';
import { getSunH, getSkyColor } from '../systems/daynight.js';
import { getWeatherModifiers } from '../systems/weather.js';

// Procedural sky dome: atmosphere gradient, domain-warped fbm clouds,
// hash stars, moon, sunset scatter, lightning flash, horizon fog merge.
// GLSL kept WGSL-transpile-safe (fixed loops, functions before use, no textures).

Effect.ShadersStore['skyDomeVertexShader'] = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore['skyDomeFragmentShader'] = `
precision highp float;
varying vec3 vDir;

uniform float uTime;
uniform vec3 uSunDir;      // normalized, pointing TOWARD the sun
uniform float uSunH;       // sun height -1..1
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uCloudCover; // 0..1
uniform float uCloudDark;  // 0 fair-weather .. 1 storm
uniform vec2 uWindOff;     // CPU-integrated wind displacement (NOT wind * time)
uniform float uStarAlpha;
uniform float uFlash;      // lightning envelope 0..1
uniform float uSunVis;     // sun visibility through clouds 0..1

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i),                   hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)),  hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return 0.5   * vnoise(p)
       + 0.25  * vnoise(p * 2.13 + vec2(11.7, 3.1))
       + 0.125 * vnoise(p * 4.42 + vec2(5.9, 27.4));
}

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  float sd = dot(dir, uSunDir);

  // Atmosphere gradient (zenith -> horizon)
  float grad = pow(1.0 - clamp(h, 0.0, 1.0), 2.2);
  vec3 col = mix(uZenith, uHorizon, grad);

  // Warm forward-scatter wedge near the sun at sunrise/sunset
  float sunsetK = clamp(1.0 - abs(uSunH) * 3.0, 0.0, 1.0);
  col += vec3(1.0, 0.45, 0.15) * pow(max(sd, 0.0), 6.0) * sunsetK * 0.6;

  // Clouds — 3-octave domain-warped fbm on a virtual plane above the camera.
  // uWindOff is integrated on the CPU (offset += wind * dt): multiplying the
  // CURRENT wind by absolute time would amplify every wind change by elapsed
  // session time, making the cloud field race/boil after long play sessions.
  vec2 cp = dir.xz / max(dir.y, 0.06) * 0.9 + uWindOff;
  vec2 q = vec2(fbm(cp), fbm(cp + vec2(5.2, 1.3)));
  float f = fbm(cp + q * 1.8 + uWindOff * 0.5);
  float thr = mix(0.72, 0.18, uCloudCover);
  float cloud = smoothstep(thr, thr + 0.28, f) * smoothstep(0.02, 0.18, h);
  float dens = smoothstep(thr, thr + 0.55, f);

  // Stars — hash-based on quantized direction, twinkling, hidden by clouds.
  // Azimuth cell count is an exact integer (138 / 2pi) so the atan seam falls
  // on a cell boundary — no sliced stars at the +-pi wrap.
  vec2 sp = vec2(atan(dir.x, dir.z) * 21.9634954, dir.y * 60.0);
  vec2 cell = floor(sp);
  vec2 fp = fract(sp) - 0.5;
  float hs = hash12(cell);
  vec2 starOff = (vec2(hash12(cell + 7.1), hash12(cell + 3.7)) - 0.5) * 0.7;
  float star = smoothstep(0.10, 0.02, length(fp - starOff)) * step(0.92, hs);
  star *= 0.6 + 0.4 * sin(uTime * (2.0 + hs * 4.0) + hs * 6.28);
  star *= 1.0 - smoothstep(0.95, 0.995, h); // lat-long cells degenerate at the zenith
  col += vec3(star) * uStarAlpha * (1.0 - cloud) * step(0.0, h);

  // Moon — antipodal to the sun, with a soft halo
  vec3 moonDir = -uSunDir;
  float md = dot(dir, moonDir);
  col += vec3(0.9, 0.93, 1.0)
       * (smoothstep(0.9994, 0.9998, md) * 0.9 + pow(max(md, 0.0), 256.0) * 0.15)
       * uStarAlpha * (1.0 - cloud);

  // Broad sun haze (the billboard glow keeps the tight core)
  col += vec3(1.0, 0.85, 0.55) * pow(max(sd, 0.0), 32.0) * 0.35 * uSunVis * step(0.0, uSunH);

  // Cloud shading: lit tops -> dark bases, day/night tint, sunset-lit edges
  float dayLum = clamp(uSunH * 1.4 + 0.12, 0.03, 1.0);
  vec3 cloudCol = mix(vec3(1.0, 0.98, 0.95), vec3(0.28, 0.30, 0.35),
                      dens * (0.35 + uCloudDark * 0.65));
  cloudCol *= dayLum;
  cloudCol += vec3(1.0, 0.5, 0.25) * pow(max(sd, 0.0), 3.0) * sunsetK * (1.0 - dens) * 0.8;
  col = mix(col, cloudCol, cloud);

  // Lightning flash — clouds light up from within
  col += uFlash * vec3(0.9, 0.95, 1.1) * (0.35 + 0.65 * cloud);

  // Horizon fog merge — LAST, so the dome meets fogged world geometry seamlessly
  float fogBand = 1.0 - smoothstep(0.0, 0.14, h);
  col = mix(col, uFogColor, fogBand);

  gl_FragColor = vec4(col, 1.0);
}
`;

let _dome = null;
let _mat = null;
let _time = 0;
const _sunTo = new Vector3(0, 1, 0);
const _windOff = new Vector2(0, 0); // integrated wind displacement for cloud drift
const _zenith = new Color3(0.2, 0.4, 0.8);

export function getSkyDome() { return _dome; }

export function initSkyDome(scene) {
  if (!CFG.GFX.SKY_DOME) return;

  // Radius 300 < camera.maxZ 400 — no infinite-depth projection tricks needed.
  // Depth test stays ON, depth write OFF: world geometry always wins.
  _dome = MeshBuilder.CreateSphere('skyDome', { diameter: 600, segments: 24 }, scene);
  _dome.infiniteDistance = true;       // ignores camera translation — auto follow
  _dome.isPickable = false;
  _dome.applyFog = false;
  _dome.alwaysSelectAsActiveMesh = true; // infiniteDistance breaks frustum culling
  _dome.metadata = { noDepthPass: true };

  _mat = new ShaderMaterial('skyDomeMat', scene, {
    vertex: 'skyDome',
    fragment: 'skyDome',
  }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'uTime', 'uSunDir', 'uSunH', 'uZenith', 'uHorizon',
               'uFogColor', 'uCloudCover', 'uCloudDark', 'uWindOff', 'uStarAlpha',
               'uFlash', 'uSunVis'],
  });
  _mat.backFaceCulling = false; // render sphere interior without winding games
  _mat.disableDepthWrite = true;

  _mat.setFloat('uTime', 0);
  _mat.setVector3('uSunDir', _sunTo);
  _mat.setFloat('uSunH', 1);
  _mat.setColor3('uZenith', _zenith);
  _mat.setColor3('uHorizon', getSkyColor());
  _mat.setColor3('uFogColor', scene.fogColor);
  _mat.setFloat('uCloudCover', 0.15);
  _mat.setFloat('uCloudDark', 0);
  _mat.setVector2('uWindOff', _windOff);
  _mat.setFloat('uStarAlpha', 0);
  _mat.setFloat('uFlash', 0);
  _mat.setFloat('uSunVis', 1);

  _dome.material = _mat;
}

export function updateSkyDome(gdt) {
  if (!_mat) return;
  const scene = getScene();
  const sun = getSunLight();
  const m = getWeatherModifiers();
  const sunH = getSunH();
  const sky = getSkyColor();

  _time += gdt;

  if (sun) {
    // sunLight.direction points FROM sun TO scene; the dome wants TO-sun
    _sunTo.set(-sun.direction.x, -sun.direction.y, -sun.direction.z).normalize();
  }

  // Zenith: deeper blue than horizon by day, matches flat night sky after dark
  const dayF = Math.max(0, Math.min(1, sunH * 2));
  _zenith.set(
    sky.r * 0.55 + 0.05 * 0.45 * dayF + sky.r * 0.45 * (1 - dayF),
    sky.g * 0.55 + 0.12 * 0.45 * dayF + sky.g * 0.45 * (1 - dayF),
    sky.b * 0.55 + 0.35 * 0.45 * dayF + sky.b * 0.45 * (1 - dayF)
  );

  const starAlpha = Math.max(0, Math.min(1, (0.15 - sunH) / 0.35)) * (1 - m.cloudCover);
  const sunVis = Math.max(0, 1 - m.cloudCover * 1.2);

  _windOff.x += m.windX * gdt * 0.01;
  _windOff.y += m.windZ * gdt * 0.01;

  _mat.setFloat('uTime', _time);
  _mat.setVector3('uSunDir', _sunTo);
  _mat.setFloat('uSunH', sunH);
  _mat.setColor3('uZenith', _zenith);
  _mat.setColor3('uHorizon', sky);
  _mat.setColor3('uFogColor', scene.fogColor);
  _mat.setFloat('uCloudCover', m.cloudCover);
  _mat.setFloat('uCloudDark', m.cloudDark);
  _mat.setVector2('uWindOff', _windOff);
  _mat.setFloat('uStarAlpha', starAlpha);
  _mat.setFloat('uFlash', m.flash);
  _mat.setFloat('uSunVis', sunVis);
}
