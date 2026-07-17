import { MeshBuilder, Mesh, VertexData, StandardMaterial,
         Texture, Color3, Color4, Vector3, Matrix, Plane,
         ShaderMaterial, Effect, MirrorTexture, RawTexture, Constants } from 'babylonjs';
import { CFG } from '../config.js';
import { getTerrainHeight } from './terrain.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

function loadTex(path, uScale, vScale, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = uScale;
    tex.vScale = vScale;
    // Babylon.js defaults to WRAP (repeat) addressing
    return tex;
}

export function buildGround(scene) {
    const size = CFG.GRID * CFG.CELL + 20;
    const segments = 64;

    // Create a ground mesh with subdivisions
    const ground = MeshBuilder.CreateGround('ground', {
        width: size,
        height: size,
        subdivisions: segments,
        updatable: true,
    }, scene);

    // Displace vertices for terrain elevation
    const positions = ground.getVerticesData('position');
    for (let i = 0; i < positions.length; i += 3) {
        const wx = positions[i];     // x
        const wz = positions[i + 2]; // z
        const h = getTerrainHeight(wx, wz);
        positions[i + 1] = h;        // y = height
    }

    ground.updateVerticesData('position', positions);
    ground.createNormals(true); // recompute normals after displacement

    // Fix normals if flipped (useRightHandedSystem + createNormals may invert winding)
    const normals = ground.getVerticesData('normal');
    if (normals && normals[1] < 0) {
        console.warn('[GROUND] Flipping normals — were pointing DOWN (Y=' + normals[1].toFixed(3) + ')');
        for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
        ground.updateVerticesData('normal', normals);
    } else {
        console.warn('[GROUND] Normals OK — pointing UP (Y=' + (normals ? normals[1].toFixed(3) : 'null') + ')');
    }

    ground.refreshBoundingInfo();  // update bounding box after vertex displacement

    // StandardMaterial for shadow compatibility (PBR shadows broken with useRightHandedSystem)
    let mat;
    if (CFG.SNOW_MODE) {
        mat = new StandardMaterial('groundMat', scene);
        mat.diffuseColor = new Color3(0.867, 0.894, 0.910);
        mat.specularColor = new Color3(0.02, 0.02, 0.02);
    } else {
        mat = new StandardMaterial('groundMat', scene);
        mat.diffuseTexture = loadTex('./assets/textures/grass.jpg', size / 4, size / 4, scene);
        // Green-shifted tint — the sparse-grass texture reads as bare dirt
        // with a neutral tint; the instanced grass tufts sit on top of this.
        mat.diffuseColor = new Color3(0.8, 1.2, 0.6);
        mat.ambientColor = new Color3(0.45, 0.6, 0.38);
        mat.specularColor = new Color3(0.02, 0.02, 0.02);
        mat.emissiveColor = new Color3(0.015, 0.03, 0.01);
    }
    ground.material = mat;
    ground.metadata = { isGround: true };
    enableShadowReceiving(ground);
}

// ─── Gerstner Ocean Shaders ──────────────────────────────────────────────────

Effect.ShadersStore['oceanVertexShader'] = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 world;
uniform mat4 worldViewProjection;
uniform float uTime;

// Wave params packed as vec3: A=(amp,freq,speed) B=(steepness,dirX,dirZ)
uniform vec3 uWA0; uniform vec3 uWB0;
uniform vec3 uWA1; uniform vec3 uWB1;
uniform vec3 uWA2; uniform vec3 uWB2;
uniform vec3 uWA3; uniform vec3 uWB3;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vJacobian;

vec3 gerstner(vec3 wa, vec3 wb, vec3 p, inout vec3 T, inout vec3 B) {
    float amp   = wa.x;
    float freq  = wa.y;
    float spd   = wa.z;
    float steep = wb.x;
    vec2  d     = normalize(wb.yz);

    float phase = dot(d, p.xz) * freq + uTime * spd;
    float s = sin(phase);
    float c = cos(phase);
    float Q = steep / (freq * amp * 4.0 + 0.001);

    T += vec3(
        -Q * d.x * d.x * freq * amp * s,
         d.x * freq * amp * c,
        -Q * d.x * d.y * freq * amp * s
    );
    B += vec3(
        -Q * d.x * d.y * freq * amp * s,
         d.y * freq * amp * c,
        -Q * d.y * d.y * freq * amp * s
    );

    return vec3(Q * amp * d.x * c, amp * s, Q * amp * d.y * c);
}

void main() {
    vec3 p = position;
    vec3 T = vec3(1.0, 0.0, 0.0);
    vec3 B = vec3(0.0, 0.0, 1.0);

    p += gerstner(uWA0, uWB0, position, T, B);
    p += gerstner(uWA1, uWB1, position, T, B);
    p += gerstner(uWA2, uWB2, position, T, B);
    p += gerstner(uWA3, uWB3, position, T, B);

    // Clamp: waves can dip below base level but never rise above it.
    // Prevents water from poking through terrain as random puddles.
    p.y = min(p.y, 0.0);

    vec3 N = normalize(cross(B, T));

    // Horizontal Jacobian — drops below 1 where waves pinch into crests
    vJacobian = T.x * B.z - T.z * B.x;

    vWorldPos = (world * vec4(p, 1.0)).xyz;
    vNormal   = normalize((world * vec4(N, 0.0)).xyz);

    gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

Effect.ShadersStore['oceanFragmentShader'] = `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vJacobian;

uniform float uTime;
uniform vec3 uCameraPos;
uniform vec3 uSunDir;      // normalized, pointing FROM sun TO scene
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uUseShaderFog;   // 1 = legacy linear fog here, 0 = fogged by the volumetric post-process
                               // (NOTE: never put a ';' inside a comment on a uniform line —
                               //  the WebGPU GLSL processor splits lines on ';' inside comments)

uniform mat4 uReflectVP;       // reflected view-projection for projective mirror UV
uniform sampler2D uReflectionTex;
uniform float uReflOn;         // 0 = procedural sky fallback only

uniform sampler2D uHeightTex;  // baked terrain height (R8, world-XZ mapped)
uniform float uHeightMin;
uniform float uHeightRange;
uniform float uWorldHalf;
uniform float uCrestThreshold;
uniform float uRainRipple;

const vec3 DEEP       = vec3(0.02, 0.08, 0.15);
const vec3 SHALLOW    = vec3(0.05, 0.20, 0.30);
const vec3 SHORE_TINT = vec3(0.10, 0.30, 0.32);

float hash12(vec2 p) {
    // Wrap cell coords to keep hash inputs small: raw world-XZ + growing time
    // offsets degrade float precision and the hash collapses into a hard
    // checkerboard (noise tiles seamlessly every 289 cells instead).
    p = mod(p, 289.0);
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i),                  hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 3; k++) {
        v += a * vnoise(p);
        p = p * 2.03 + vec2(17.13, 9.77);
        a *= 0.5;
    }
    return v;
}

vec2 rainRing(vec2 p, float t) {
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash12(cell * 7.31);
    float phase = fract(t * 0.9 + h);
    vec2 off = (vec2(hash12(cell + 3.7), hash12(cell + 9.1)) - 0.5) * 0.5;
    float d = length(f + off);
    float ring = exp(-70.0 * abs(d - phase * 0.45)) * (1.0 - phase);
    return normalize(f + off + vec2(1e-4)) * ring;
}

void main() {
    float camDist = length(uCameraPos - vWorldPos);
    float distFade = 1.0 - smoothstep(25.0, 70.0, camDist); // kills detail shimmer far away

    // Detail normal: procedural fbm height-gradient perturbation
    vec2 np = vWorldPos.xz * 0.9 + vec2(uTime * 0.15, -uTime * 0.11);
    float e = 0.35;
    float h0 = fbm(np);
    vec2 grad = vec2(fbm(np + vec2(e, 0.0)) - h0, fbm(np + vec2(0.0, e)) - h0) / e;
    vec3 N = normalize(normalize(vNormal) + vec3(-grad.x, 0.0, -grad.y) * 0.35 * distFade);

    // Rain ripples: expanding phase-offset rings, one per surface cell,
    // two overlapping scales so the grid never reads as a grid
    if (uRainRipple > 0.001) {
        vec2 rr = rainRing(vWorldPos.xz * 1.6, uTime)
                + rainRing(vWorldPos.xz * 2.7 + 13.1, uTime * 1.25) * 0.6;
        N = normalize(N + vec3(rr.x, 0.0, rr.y) * 0.5 * uRainRipple * distFade);
    }

    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = -normalize(uSunDir);  // direction TO sun

    // Fresnel (Schlick, F0 = 0.02 for water IOR ~1.33)
    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

    // Shoreline: water depth from baked terrain height
    vec2 huv = (vWorldPos.xz + uWorldHalf) / (2.0 * uWorldHalf);
    float terrainH = texture2D(uHeightTex, huv).r * uHeightRange + uHeightMin;
    float waterDepth = vWorldPos.y - terrainH;   // >0 => water above terrain

    // Water body color — deep at steep view, lifted toward shore tint in shallows
    vec3 body = mix(DEEP, SHALLOW, fresnel);
    body = mix(SHORE_TINT, body, smoothstep(0.0, 1.2, waterDepth));

    // Planar reflection (mirror RTT, projective UV) with procedural-sky fallback.
    // Distort with the SMOOTH geometric wave normal, not the fbm detail normal:
    // the fbm gradient aliases per-pixel at distance, and at reflected object
    // silhouettes that noise flips samples between object and sky every frame
    // — houses/rocks visibly flicker in the reflection while moving.
    vec3 Ng2 = normalize(vNormal);
    vec4 clipR = uReflectVP * vec4(vWorldPos, 1.0);
    vec2 ruv = clipR.xy / max(clipR.w, 1e-4) * 0.5 + 0.5;
    ruv = clamp(ruv + Ng2.xz * 0.022 + N.xz * 0.012 * distFade, 0.001, 0.999);
    vec4 mir = texture2D(uReflectionTex, ruv);
    vec3 skyRefl = uSkyColor * 0.7 + vec3(0.05, 0.08, 0.12);
    vec3 refl = mix(skyRefl, mir.rgb, mir.a * uReflOn); // alpha-0 clear = no geometry -> sky

    // Combine body + reflection via Fresnel
    vec3 col = mix(body, refl, fresnel);

    // Sun specular (broad Blinn-Phong shimmer)
    vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 256.0);
    col += uSunColor * spec * 1.5 * NdL;

    // (No cell-based sun glitter: constant jittered normals per grid cell
    // light up as solid hard-edged squares at grazing sun angles — looked
    // like pixelation. The pow-256 specular + detail normals shimmer enough.)

    // Fake subsurface scattering toward sun
    vec3 sssDir = normalize(L + N * 0.6);
    float sss = pow(max(dot(V, -sssDir), 0.0), 4.0) * 0.3;
    col += vec3(0.05, 0.15, 0.12) * sss * max(L.y, 0.0);

    // Foam: animated shoreline band + wave-crest pinch (Gerstner Jacobian).
    // The gate starts AT the waterline (0.0) — a negative start let the foam
    // band render as a white film on the beach above the water's edge.
    float shoreNoise = fbm(vWorldPos.xz * 2.5 + vec2(uTime * 0.35, -uTime * 0.27));
    float foamShore = (1.0 - smoothstep(0.05, 0.55 + shoreNoise * 0.35, waterDepth))
                    * smoothstep(0.0, 0.06, waterDepth);
    float crest = clamp((uCrestThreshold - vJacobian) * 3.0, 0.0, 1.0);
    float crestNoise = fbm(vWorldPos.xz * 3.0 + vec2(uTime * 0.6, uTime * 0.4));
    float foamCrest = crest * smoothstep(0.35, 0.75, crestNoise) * distFade;
    float foamMask = clamp(foamCrest + foamShore, 0.0, 1.0);
    col = mix(col, vec3(0.92, 0.95, 0.97) * (0.35 + 0.65 * NdL), foamMask);

    // Legacy linear fog — only when the volumetric fog post-process is off
    float fogFac = clamp((uFogEnd - camDist) / (uFogEnd - uFogStart), 0.0, 1.0);
    col = mix(col, mix(uFogColor, col, fogFac), uUseShaderFog);

    // Alpha: more opaque at grazing angles, soft fade onto the shore, foam
    // solid. Window starts slightly ABOVE the waterline so no translucent
    // water film (or shadows cast onto it) survives over dry land.
    float alphaShore = smoothstep(0.02, 0.45, waterDepth);
    float alpha = mix(0.55, 0.85, fresnel) * alphaShore;
    alpha = max(alpha, foamMask * 0.9 * alphaShore);

    gl_FragColor = vec4(col, alpha);
}
`;

// ─── Water Mesh + Material ───────────────────────────────────────────────────

let _waterMat = null;

export function getWaterMaterial() { return _waterMat; }

/** Bake the analytic terrain heightmap into an R8 texture for shore foam/fade. */
function bakeShoreHeightTexture(scene, mat, size) {
    // 1024: at 512 the ~0.35u texels + 8-bit quantization let the shore
    // foam/alpha bands bleed well past the real waterline onto the beach
    const HRES = 1024;
    const HALF = size / 2;
    const raw = new Float32Array(HRES * HRES);
    let hMin = Infinity, hMax = -Infinity;
    for (let j = 0; j < HRES; j++) {
        for (let i = 0; i < HRES; i++) {
            const h = getTerrainHeight(i / (HRES - 1) * size - HALF, j / (HRES - 1) * size - HALF);
            raw[j * HRES + i] = h;
            if (h < hMin) hMin = h;
            if (h > hMax) hMax = h;
        }
    }
    const range = Math.max(1e-3, hMax - hMin);
    const data = new Uint8Array(HRES * HRES);
    for (let k = 0; k < raw.length; k++) {
        data[k] = Math.round((raw[k] - hMin) / range * 255);
    }
    // R8 unsigned byte — bilinear-filterable on every WebGPU device
    const heightTex = RawTexture.CreateRTexture(data, HRES, HRES, scene,
        false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    heightTex.wrapU = Texture.CLAMP_ADDRESSMODE;
    heightTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    mat.setTexture('uHeightTex', heightTex);
    mat.setFloat('uHeightMin', hMin);
    mat.setFloat('uHeightRange', range);
    mat.setFloat('uWorldHalf', HALF);
}

/** Half-res planar mirror over the water plane, sampled projectively by the ocean shader. */
function setupWaterReflection(scene, mat) {
    // Plane sits 0.4 BELOW the waterline: shore-level geometry (house bases,
    // rocks) straddles the surface, and with the plane right at WATER_Y the
    // walking head-bob clipped them in/out of the reflection every frame —
    // "objects flicker in the water". Reflecting 0.4u of underwater geometry
    // is visually harmless.
    const mirrorPlane = new Plane(0, -1, 0, CFG.WATER_Y - 0.4);
    const mirror = new MirrorTexture('waterRefl', { ratio: 0.5 }, scene, true);
    mirror.mirrorPlane = mirrorPlane;
    // Small list of big outdoor meshes — interiors/props aren't visible from open water
    // NOTE: no hidden-layer proxies here — RTT renderLists IGNORE camera
    // layer masks, so proxies would show in the mirror as solid blobs that
    // don't exist in the world. ez-tree vegetation (thin-instanced, visible
    // geometry) is picked up by its 'ezTree_' name prefix.
    // wallsPlaster/wallTrims: plaster skins float 0.015u off the stone face
    // and timber trim sits proud of it — without them plaster/timber houses
    // reflect as bare stone. Both may be absent (no such buildings) —
    // filter(Boolean) tolerates that.
    const names = ['ground', 'walls', 'wallsPlaster', 'wallTrims',
                   'flatRoofs', 'slantRoofs', 'mergedRocks'];
    mirror.renderList = names.map(n => scene.getMeshByName(n)).filter(Boolean);
    // Bushes excluded: 0.9-1.6u ground-hugging shrubs are invisible in the
    // half-res blurred mirror (the old card system never reflected them),
    // and the mirror re-renders its whole list every frame at refreshRate 1
    for (const m of scene.meshes) {
      if (m.name.startsWith('ezTree_') && m.isEnabled() &&
          m.metadata?.ezCategory !== 'bush') mirror.renderList.push(m);
    }
    // Skip frustum culling for these — culling against the REFLECTED camera
    // is marginal while the player moves, and meshes popping in/out of the
    // mirror read as objects flickering in the reflection. The list is a
    // handful of world-sized merged meshes that are effectively always
    // visible anyway, so the cost of always drawing them is nil.
    for (const m of mirror.renderList) m.alwaysSelectAsActiveMesh = true;
    // Alpha-0 clear: mirror alpha becomes a geometry coverage mask, sky elsewhere
    mirror.onClearObservable.add((eng) => eng.clear(new Color4(0, 0, 0, 0), true, true, true));
    // Soft reflections: the mirror is half-res, and raw bilinear sampling of
    // it shimmers/flickers during camera motion. A blur suits wave-distorted
    // water anyway. A/B at runtime via:
    //   _dbg.scene().customRenderTargets.find(t => t.name === 'waterRefl').blurKernel = 0
    mirror.blurKernel = 24;
    // refreshRate MUST stay 1: planar reflections are view-dependent, so a
    // frame-old mirror seen from the current camera is misaligned — at
    // refreshRate 2 the reflection visibly jerks back and forth while moving.
    mirror.refreshRate = 1;
    // A ShaderMaterial never triggers RTT rendering by itself — must be a customRenderTarget
    scene.customRenderTargets.push(mirror);
    mat.setTexture('uReflectionTex', mirror);
    mat.setFloat('uReflOn', 1);

    // Reflected view-projection for the projective UV, captured when the mirror
    // renders. MirrorTexture's internal observer (registered first) has already
    // set the scene transform to reflection*view*proj at this point; copy it
    // because the scene transform is restored after the mirror pass.
    const _RVP = new Matrix();
    mirror.onBeforeRenderObservable.add(() => {
        _RVP.copyFrom(scene.getTransformMatrix());
        mat.setMatrix('uReflectVP', _RVP);
    });
}

export function buildWater(scene) {
    const size = CFG.GRID * CFG.CELL + 20;

    if (CFG.SNOW_MODE) {
        // Frozen ice — flat mesh, opaque, no waves. Deliberately BLUER and
        // glossier than the snow ground (0.867,0.894,0.910): the two used to
        // be near-identical whites, and under the bloom/fog/tonemap pipeline
        // the lake visually vanished into the snowfield.
        const water = MeshBuilder.CreateGround('water', {
            width: size, height: size,
        }, scene);
        water.position.y = CFG.WATER_Y;
        const mat = new StandardMaterial('iceMat', scene);
        mat.diffuseColor = new Color3(0.55, 0.72, 0.86);
        mat.specularColor = new Color3(0.5, 0.55, 0.6); // hard sun glint off the sheet
        mat.specularPower = 96;
        mat.emissiveColor = new Color3(0.03, 0.05, 0.08); // cold glow in shade
        water.material = mat;
        water.metadata = { isGround: true };
        water.isPickable = false;
        enableShadowReceiving(water);
        return;
    }

    // --- Animated Gerstner ocean ---
    const water = MeshBuilder.CreateGround('water', {
        width: size,
        height: size,
        subdivisions: CFG.WATER_SUBS,
    }, scene);
    water.position.y = CFG.WATER_Y;

    const mat = new ShaderMaterial('oceanMat', scene, {
        vertex: 'ocean',
        fragment: 'ocean',
    }, {
        attributes: ['position', 'uv'],
        uniforms: [
            'world', 'worldViewProjection', 'uTime',
            'uWA0', 'uWB0', 'uWA1', 'uWB1',
            'uWA2', 'uWB2', 'uWA3', 'uWB3',
            'uCameraPos', 'uSunDir', 'uSunColor',
            'uSkyColor', 'uFogColor', 'uFogStart', 'uFogEnd', 'uUseShaderFog',
            'uReflectVP', 'uReflOn',
            'uHeightMin', 'uHeightRange', 'uWorldHalf', 'uCrestThreshold',
            'uRainRipple',
        ],
        samplers: ['uReflectionTex', 'uHeightTex'],
        needAlphaBlending: true,
    });

    // Pack wave parameters into vec3 uniforms
    const waves = CFG.WATER_WAVES;
    for (let i = 0; i < 4; i++) {
        const w = waves[i] || [0, 1, 0, 0, 1, 0];
        mat.setVector3('uWA' + i, new Vector3(w[0], w[1], w[2]));
        mat.setVector3('uWB' + i, new Vector3(w[3], w[4], w[5]));
    }

    mat.setFloat('uTime', 0);
    mat.setFloat('uCrestThreshold', 0.9);
    mat.setFloat('uRainRipple', 0);
    mat.setFloat('uUseShaderFog', CFG.GFX.VOL_FOG ? 0 : 1);
    mat.setMatrix('uReflectVP', Matrix.Identity());
    mat.backFaceCulling = false;

    bakeShoreHeightTexture(scene, mat, size);

    if (CFG.GFX.WATER_REFLECTION) {
        setupWaterReflection(scene, mat);
    } else {
        // Dummy 1x1 transparent texture: shader falls back to procedural sky (mir.a = 0)
        const dummy = RawTexture.CreateRGBATexture(new Uint8Array([0, 0, 0, 0]), 1, 1, scene,
            false, false, Texture.NEAREST_SAMPLINGMODE);
        mat.setTexture('uReflectionTex', dummy);
        mat.setFloat('uReflOn', 0);
    }

    water.material = mat;
    water.metadata = { isGround: true, isOcean: true };
    water.alwaysSelectAsActiveMesh = true; // prevent frustum culling

    _waterMat = mat;
}
