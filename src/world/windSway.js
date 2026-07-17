/**
 * Wind sway — vertex-animation material plugin for vegetation.
 *
 * A MaterialPluginBase subclass injects a 3-octave sine displacement at
 * CUSTOM_VERTEX_UPDATE_WORLDPOS (post-instance-transform, so the wind blows
 * in a coherent WORLD direction no matter each thin instance's random yaw,
 * and the phase can be seeded from world position — that's what
 * de-synchronizes thousands of identical tuft/leaf instances). Ported from
 * the ez-tree demo's onBeforeCompile wind shader, minus the simplex noise:
 * a cheap spatial phase hash gives the same nearby-plants-sway-together feel.
 *
 * Per-material parameters (amp, invHeight) ride the material's UBO — NOT
 * baked as shader literals. Two materials with the same defines share ONE
 * compiled effect in Babylon's global cache (keyed by shader-name + defines,
 * NOT by injected code), so literals would collide: every leaf category would
 * silently inherit whichever amp compiled first. Uniforms are bound per
 * material in bindForSubMesh, so each keeps its own amplitude correctly.
 *
 * Sway weight (0 = pinned, 1 = full swing):
 *   - WINDSWAYUV define ON  → uvUpdated.y — ez-tree leaf quads bake uv.y=0 at
 *                             the branch attachment and 1 at the leaf tip
 *   - WINDSWAYUV define OFF → clamp(positionUpdated.y * invHeight) — grass
 *                             blades (base y=0, tip y=rawH; their uv.v is
 *                             INVERTED so uv weighting would wave the roots)
 *                             and wildflowers (petal-atlas UVs carry no height)
 * Weight-mode is a define (not a uniform) so height-mode materials never
 * reference uvUpdated — which is only in scope when the material has UV1.
 *
 * WebGPU vs WebGL2: StandardMaterial/PBRMaterial compile NATIVE WGSL on
 * WebGPU in Babylon 9.17 — getCustomCode ships both GLSL and WGSL variants
 * and isCompatible() must accept both languages. No comments inside the
 * shader strings (the WebGPU GLSL processor splits lines on ';' even in
 * comments).
 *
 * KNOWN LIMITS (deliberate): the sun shadow map and the volumetric-fog depth
 * pass render with their own shaders (no plugin hooks), so shadows and fog
 * silhouettes stay static — amplitudes are kept small enough that the
 * mismatch never reads. The water mirror renders real materials, so
 * reflections sway correctly for free.
 */
import { MaterialPluginBase } from 'babylonjs';
import { CFG } from '../config.js';

// Per-frame globals (single writer: updateWindSway in the main loop).
// windSway uniform packs (dirX, dirZ, strength, time).
let _dirX = 1, _dirZ = 0, _strength = 0, _time = 0;
const _plugins = [];

class WindSwayPlugin extends MaterialPluginBase {
  /**
   * @param material material to attach to (Standard or PBR)
   * @param opts { weight: 'uv'|'height', heightMax, amp, freq }
   */
  constructor(material, opts) {
    super(material, 'WindSway', 200, { WINDSWAY: false, WINDSWAYUV: false });
    this._amp = opts.amp;
    this._invHeight = 1 / (opts.heightMax ?? 1);
    this._freq = opts.freq ?? 1;
    this._uvWeight = opts.weight === 'uv';
    this._isEnabled = true;
    this._enable(true);
  }

  get isEnabled() { return this._isEnabled; }
  set isEnabled(v) {
    if (this._isEnabled === v) return;
    this._isEnabled = v;
    this.markAllDefinesAsDirty();
    this._enable(v);
  }

  getClassName() { return 'WindSwayPlugin'; }

  // Base class rejects WGSL — we ship both languages
  isCompatible() { return true; }

  prepareDefines(defines) {
    defines.WINDSWAY = this._isEnabled;
    defines.WINDSWAYUV = this._isEnabled && this._uvWeight;
  }

  getUniforms() {
    return { ubo: [{ name: 'windSway', size: 4, type: 'vec4' },
                   { name: 'windSwayParams', size: 4, type: 'vec4' }] };
  }

  bindForSubMesh(ubo) {
    if (!this._isEnabled) return;
    ubo.updateFloat4('windSway', _dirX, _dirZ, _strength, _time * this._freq);
    ubo.updateFloat4('windSwayParams', this._amp, this._invHeight, 0, 0);
  }

  getCustomCode(shaderType, shaderLanguage) {
    if (shaderType !== 'vertex') return null;
    if (shaderLanguage === 1) { // ShaderLanguage.WGSL
      return {
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WINDSWAY
var swayPh: f32 = dot(worldPos.xz, vec2f(0.043, 0.057)) + 3.0 * sin(worldPos.x * 0.021 + worldPos.z * 0.017);
var swayT: f32 = uniforms.windSway.w;
var swayOsc: f32 = 0.55 * sin(swayT + swayPh) + 0.3 * sin(2.13 * swayT + 1.3 * swayPh) + 0.15 * sin(4.7 * swayT + 1.5 * swayPh);
#ifdef WINDSWAYUV
var swayWgt: f32 = uvUpdated.y;
#else
var swayWgt: f32 = clamp(positionUpdated.y * uniforms.windSwayParams.y, 0.0, 1.0);
#endif
var swayAmt: f32 = swayOsc * uniforms.windSway.z * uniforms.windSwayParams.x * swayWgt;
worldPos.x = worldPos.x + uniforms.windSway.x * swayAmt;
worldPos.z = worldPos.z + uniforms.windSway.y * swayAmt;
#endif`,
      };
    }
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef WINDSWAY
float swayPh = dot(worldPos.xz, vec2(0.043, 0.057)) + 3.0 * sin(worldPos.x * 0.021 + worldPos.z * 0.017);
float swayT = windSway.w;
float swayOsc = 0.55 * sin(swayT + swayPh) + 0.3 * sin(2.13 * swayT + 1.3 * swayPh) + 0.15 * sin(4.7 * swayT + 1.5 * swayPh);
#ifdef WINDSWAYUV
float swayWgt = uvUpdated.y;
#else
float swayWgt = clamp(positionUpdated.y * windSwayParams.y, 0., 1.);
#endif
float swayAmt = swayOsc * windSway.z * windSwayParams.x * swayWgt;
worldPos.x += windSway.x * swayAmt;
worldPos.z += windSway.y * swayAmt;
#endif`,
    };
  }
}

/**
 * Attach wind sway to a material. No-op (returns null) when CFG.GFX.WIND_SWAY
 * is off. opts: { weight: 'uv'|'height', heightMax, amp, freq } — amp is the
 * world-unit displacement at weight=1 × strength=1.
 */
export function attachWindSway(material, opts) {
  if (!CFG.GFX.WIND_SWAY || !material) return null;
  const p = new WindSwayPlugin(material, opts);
  _plugins.push(p);
  return p;
}

/**
 * Per-frame driver (main loop, env bucket, after updateWeather). Integrates
 * gdt — NEVER wind × absolute time (see skyDome.js uWindOff comment: that
 * amplifies every wind change by elapsed session time) — so sway freezes on
 * pause and honors Q fast-forward for free. Weather already lerps windX/windZ
 * smoothly, so strength and oscillation rate glide through state changes.
 */
export function updateWindSway(gdt, mods) {
  const mag = Math.hypot(mods.windX, mods.windZ);
  if (mag > 1e-4) { _dirX = mods.windX / mag; _dirZ = mods.windZ / mag; }
  // CLEAR (wind 1.5) → gentle idle motion, STORM (10-12) → full throw.
  // NEUTRAL (weather off) publishes windX=1 → a whisper of movement.
  _strength = Math.min(1, 0.18 + mag * 0.082);
  // Stronger wind also oscillates faster. Wrap at 2π×4096 so the clock never
  // grows large enough for f32 precision loss to make sin() visibly step in a
  // marathon session (the wrap point is a near-period of all three octaves —
  // any phase jump is far below one pixel of sway).
  _time = (_time + gdt * (1.1 + 0.14 * mag)) % (Math.PI * 8192);
}

/** Runtime kill-switch (window._gfx.wind) — recompiles the materials. */
export function setWindSwayEnabled(on) {
  for (const p of _plugins) p.isEnabled = !!on;
}
