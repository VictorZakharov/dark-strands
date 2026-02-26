import { MeshBuilder, Mesh, VertexData, StandardMaterial,
         Texture, Color3, Vector3, ShaderMaterial, Effect } from 'babylonjs';
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
        mat.diffuseColor = new Color3(1.2, 1.2, 1.0);
        mat.ambientColor = new Color3(0.6, 0.6, 0.5);
        mat.specularColor = new Color3(0.02, 0.02, 0.02);
        mat.emissiveColor = new Color3(0.02, 0.03, 0.01);
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

    vWorldPos = (world * vec4(p, 1.0)).xyz;
    vNormal   = normalize((world * vec4(N, 0.0)).xyz);

    gl_Position = worldViewProjection * vec4(p, 1.0);
}
`;

Effect.ShadersStore['oceanFragmentShader'] = `
precision highp float;

varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 uCameraPos;
uniform vec3 uSunDir;      // normalized, pointing FROM sun TO scene
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogStart;
uniform float uFogEnd;

const vec3 DEEP    = vec3(0.02, 0.08, 0.15);
const vec3 SHALLOW = vec3(0.05, 0.20, 0.30);

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);
    vec3 L = -normalize(uSunDir);  // direction TO sun

    // Fresnel (Schlick, F0 = 0.02 for water IOR ~1.33)
    float NdV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

    // Water body color — deep at steep view, shallow at grazing
    vec3 body = mix(DEEP, SHALLOW, fresnel);

    // Sky reflection (tinted)
    vec3 refl = uSkyColor * 0.7 + vec3(0.05, 0.08, 0.12);

    // Combine body + reflection via Fresnel
    vec3 col = mix(body, refl, fresnel);

    // Sun specular (Blinn-Phong, tight highlight for shimmer)
    vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 256.0);
    col += uSunColor * spec * 1.5 * NdL;

    // Fake subsurface scattering toward sun
    vec3 sssDir = normalize(L + N * 0.6);
    float sss = pow(max(dot(V, -sssDir), 0.0), 4.0) * 0.3;
    col += vec3(0.05, 0.15, 0.12) * sss * max(L.y, 0.0);

    // Linear fog (manual, matching scene fog)
    float fogDist = length(uCameraPos - vWorldPos);
    float fogFac  = clamp((uFogEnd - fogDist) / (uFogEnd - uFogStart), 0.0, 1.0);
    col = mix(uFogColor, col, fogFac);

    // Alpha: more opaque at shallow (grazing) angles
    float alpha = mix(0.55, 0.85, fresnel);

    gl_FragColor = vec4(col, alpha);
}
`;

// ─── Water Mesh + Material ───────────────────────────────────────────────────

let _waterMat = null;

export function getWaterMaterial() { return _waterMat; }

export function buildWater(scene) {
    const size = CFG.GRID * CFG.CELL + 20;

    if (CFG.SNOW_MODE) {
        // Frozen ice — flat mesh, opaque, no waves
        const water = MeshBuilder.CreateGround('water', {
            width: size, height: size,
        }, scene);
        water.position.y = CFG.WATER_Y;
        const mat = new StandardMaterial('iceMat', scene);
        mat.diffuseColor = new Color3(0.722, 0.831, 0.890);
        mat.specularColor = new Color3(0.3, 0.3, 0.3);
        mat.specularPower = 64;
        water.material = mat;
        water.metadata = { isGround: true };
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
            'uSkyColor', 'uFogColor', 'uFogStart', 'uFogEnd',
        ],
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
    mat.backFaceCulling = false;

    water.material = mat;
    water.metadata = { isGround: true, isOcean: true };
    water.alwaysSelectAsActiveMesh = true; // prevent frustum culling

    _waterMat = mat;
}
