import { MeshBuilder, ShaderMaterial, Effect, Vector3, Color3 } from 'babylonjs';

// --- Boundary shield: static hex grid with traveling light wave ---

const POOL_SIZE = 8;
const RIPPLE_DURATION = 1.2;
const SHIELD_SIZE = 12;

const ripplePool = [];
let _playerAtBoundary = false;

/** Called each frame by player.js to indicate whether the player is pressing into a boundary */
export function setBoundaryContact(active) { _playerAtBoundary = active; }

// Register custom shader code with Babylon.js Effect store
const SHADER_NAME = 'boundaryShield';

Effect.ShadersStore[SHADER_NAME + 'VertexShader'] = `
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

Effect.ShadersStore[SHADER_NAME + 'FragmentShader'] = `
precision highp float;
uniform float uWave;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float dist = length(p);
  if (dist > 1.0) discard;

  // Flat-top hex tiling using known-good two-grid Voronoi approach
  float scale = 6.0;
  vec2 uv = p * scale;

  vec2 r = vec2(1.0, 1.7320508);   // period: (1, sqrt(3))
  vec2 h = r * 0.5;
  vec2 a = mod(uv + h, r) - h;     // grid A
  vec2 b = mod(uv, r) - h;         // grid B (offset by half-period)
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;  // local offset from nearest center
  vec2 cellId = uv - gv;           // cell center in grid space

  float cellDist = length(cellId) / scale;  // normalized distance from shield center

  // Flat-top hex SDF: apothem = 0.5
  vec2 ag = abs(gv);
  float hd = max(ag.x, dot(ag, vec2(0.5, 0.866025)));
  float edge = smoothstep(0.42, 0.5, hd);

  // Wave: bright ring traveling outward
  float waveDelta = cellDist - uWave;
  float waveGlow = exp(-waveDelta * waveDelta * 100.0);

  // Trailing afterglow behind wave (edges only)
  float behind = max(0.0, uWave - cellDist);
  float trail = behind * exp(-behind * 5.0) * 0.4;

  // Only edges glow — transparent inside hexagons
  float ambient = edge * 0.08;
  float total = edge * (ambient + waveGlow * 0.9 + trail * 0.6);

  // Circular fade
  float fade = 1.0 - smoothstep(0.7, 1.0, dist);

  vec3 baseColor = vec3(0.1, 0.35, 0.8);
  vec3 waveColor = vec3(0.4, 0.9, 1.0);
  vec3 color = mix(baseColor, waveColor, waveGlow + trail * 0.5);

  float alpha = total * fade * uOpacity;
  gl_FragColor = vec4(color, alpha);
}
`;

export function initBoundaryShield(scene) {
  for (let i = 0; i < POOL_SIZE; i++) {
    const mesh = MeshBuilder.CreatePlane('shield_' + i, {
      width: SHIELD_SIZE,
      height: SHIELD_SIZE,
      sideOrientation: 2, // DOUBLESIDE
    }, scene);

    const mat = new ShaderMaterial('shieldMat_' + i, scene, {
      vertex: SHADER_NAME,
      fragment: SHADER_NAME,
    }, {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'uWave', 'uOpacity'],
    });
    mat.setFloat('uWave', 0);
    mat.setFloat('uOpacity', 0);
    mat.alpha = 0.99; // enables alpha blending
    mat.alphaMode = 1; // ALPHA_ADD (additive blending)
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;

    mesh.material = mat;
    mesh.setEnabled(false);
    mesh.isPickable = false; // visual-only, skip all raycasts

    ripplePool.push({ mesh, mat, active: false, timer: 0 });
  }
}

export function spawnBoundaryHit(x, y, z, nx, nz) {
  let ripple = null;
  for (const r of ripplePool) {
    if (!r.active) { ripple = r; break; }
  }
  if (!ripple) {
    let oldest = -1;
    for (const r of ripplePool) {
      if (r.timer > oldest) { oldest = r.timer; ripple = r; }
    }
  }
  if (!ripple) return;

  ripple.active = true;
  ripple.timer = 0;
  ripple.mesh.setEnabled(true);
  ripple.mesh.position = new Vector3(x, y, z);

  // Face the shield toward the inward normal
  const lookTarget = new Vector3(x + nx, y, z + nz);
  ripple.mesh.lookAt(lookTarget);

  ripple.mat.setFloat('uWave', 0);
  ripple.mat.setFloat('uOpacity', 1);
}

export function updateBoundaryShield(dt) {
  for (const r of ripplePool) {
    if (!r.active) continue;

    // When player stops pressing into the boundary, fade out 4x faster
    const speed = _playerAtBoundary ? 1 : 4;
    r.timer += dt * speed;
    const t = r.timer / RIPPLE_DURATION;

    if (t >= 1) {
      r.active = false;
      r.mesh.setEnabled(false);
      continue;
    }

    r.mat.setFloat('uWave', Math.min(t, 1));
    r.mat.setFloat('uOpacity', t < 0.6 ? 1.0 : 1.0 - (t - 0.6) / 0.4);
  }
}
