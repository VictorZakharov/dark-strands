import * as THREE from 'three';

// --- Boundary shield: static hex grid with traveling light wave ---

const POOL_SIZE = 8;
const RIPPLE_DURATION = 1.2;
const SHIELD_SIZE = 12;

const ripplePool = [];

const vertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
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
  // Edge normals at 0deg, 60deg, 120deg
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
  const geo = new THREE.PlaneGeometry(SHIELD_SIZE, SHIELD_SIZE);

  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uWave: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.raycast = function() {}; // visual-only, skip all raycasts
    scene.add(mesh);
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
  ripple.mesh.visible = true;
  ripple.mesh.position.set(x, y, z);

  const lookTarget = new THREE.Vector3(x + nx, y, z + nz);
  ripple.mesh.lookAt(lookTarget);

  ripple.mat.uniforms.uWave.value = 0;
  ripple.mat.uniforms.uOpacity.value = 1;
}

export function updateBoundaryShield(dt) {
  for (const r of ripplePool) {
    if (!r.active) continue;

    r.timer += dt;
    const t = r.timer / RIPPLE_DURATION;

    if (t >= 1) {
      r.active = false;
      r.mesh.visible = false;
      continue;
    }

    r.mat.uniforms.uWave.value = t;
    r.mat.uniforms.uOpacity.value = t < 0.6 ? 1.0 : 1.0 - (t - 0.6) / 0.4;
  }
}
