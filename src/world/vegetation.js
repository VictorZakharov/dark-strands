import * as THREE from 'three';
import { CFG } from '../config.js';
import { getGrid, setCell, markTreeCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rng, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { createStaticSphere } from '../core/physics.js';

const texLoader = new THREE.TextureLoader();
let barkTex, leafTex, rockTex;

const rockColliders = [];

// Tree positions for foliage collision checks
const treePosData = []; // { x, z, ty, scale }

// Shared depth material for leaf shadow rendering — discards ~45% of fragments
// via world-position hash to create dappled/lighter shadows
const leafShadowDepth = new THREE.MeshDepthMaterial({
  depthPacking: THREE.RGBADepthPacking,
});
leafShadowDepth.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    'varying vec2 vHighPrecisionZW;',
    `varying vec2 vHighPrecisionZW;
    varying vec3 vWPos;`
  );
  shader.vertexShader = shader.vertexShader.replace(
    'vHighPrecisionZW = gl_Position.zw;',
    `vHighPrecisionZW = gl_Position.zw;
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    'varying vec2 vHighPrecisionZW;',
    `varying vec2 vHighPrecisionZW;
    varying vec3 vWPos;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <clipping_planes_fragment>',
    `#include <clipping_planes_fragment>
    vec2 snapped = floor(vWPos.xz * 3.0);
    float lh = fract(sin(dot(snapped, vec2(12.9898, 78.233))) * 43758.5453);
    if (lh > 0.55) discard;`
  );
};

function getBarkTexture() {
  if (!barkTex) {
    barkTex = texLoader.load('./assets/textures/bark.jpg');
    barkTex.wrapS = THREE.RepeatWrapping;
    barkTex.wrapT = THREE.RepeatWrapping;
    barkTex.repeat.set(1, 2);
    barkTex.colorSpace = THREE.SRGBColorSpace;
  }
  return barkTex;
}

function getLeafTexture() {
  if (!leafTex) {
    leafTex = texLoader.load('./assets/textures/grass.jpg');
    leafTex.wrapS = THREE.RepeatWrapping;
    leafTex.wrapT = THREE.RepeatWrapping;
    leafTex.repeat.set(2, 2);
    leafTex.colorSpace = THREE.SRGBColorSpace;
  }
  return leafTex;
}

export function getRockTexture() {
  if (!rockTex) {
    rockTex = texLoader.load('./assets/textures/stone_wall.jpg');
    rockTex.wrapS = THREE.RepeatWrapping;
    rockTex.wrapT = THREE.RepeatWrapping;
    rockTex.repeat.set(1, 1);
    rockTex.colorSpace = THREE.SRGBColorSpace;
  }
  return rockTex;
}

/**
 * Circle-based collision check against all rocks.
 * Returns true if the circle (wx, wz, entityR) overlaps any rock.
 * If entityY is provided, skip rocks whose top is below entityY (jumpable).
 */
export function collidesWithRock(wx, wz, entityR, entityY) {
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    if (entityY !== undefined && entityY >= rc.top - rc.height * 0.3) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const minDist = entityR + rc.r;
    if (dx * dx + dz * dz < minDist * minDist) return true;
  }
  return false;
}

/**
 * Returns a push-back vector to resolve the deepest rock overlap, or null.
 * If entityY is provided, skip rocks whose top is below entityY (jumpable).
 */
export function getRockPushback(wx, wz, entityR, entityY) {
  let worstPen = 0;
  let pushX = 0, pushZ = 0;

  for (const rc of rockColliders) {
    if (!rc.active) continue;
    if (entityY !== undefined && entityY >= rc.top - rc.height * 0.3) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = entityR + rc.r;
    const pen = minDist - dist;
    if (pen > worstPen && dist > 0) {
      worstPen = pen;
      pushX = (dx / dist) * pen;
      pushZ = (dz / dist) * pen;
    }
  }

  return worstPen > 0 ? { x: pushX, z: pushZ } : null;
}

/**
 * Returns the top Y of the highest rock the point is standing on, or null.
 */
export function getRockSurfaceHeight(wx, wz, currentY) {
  let bestTop = null;
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const standR = rc.r * 0.6;
    if (dx * dx + dz * dz < standR * standR) {
      const threshold = rc.top - rc.height * 0.3;
      if (currentY >= threshold) {
        if (bestTop === null || rc.top > bestTop) {
          bestTop = rc.top;
        }
      }
    }
  }
  return bestTop;
}

function createTree(wx, wz) {
  const group = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({
    map: getBarkTexture(),
    roughness: 0.95,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: CFG.SNOW_MODE ? 0xc8cdd0 : 0x3a8a3a,
    roughness: 0.9,
    flatShading: true,
  });

  // Randomize tree shape
  const trunkH = rng(1.4, 2.4);
  const trunkRadBot = rng(0.14, 0.22);
  const trunkRadTop = trunkRadBot * rng(0.5, 0.75);
  const numCones = rngInt(3, 5);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkRadTop, trunkRadBot, trunkH, 6),
    trunkMat
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  group.add(trunk);

  for (let i = 0; i < numCones; i++) {
    // Wider at bottom, narrower at top (fir/pine shape)
    const frac = 1 - i / numCones;
    const coneR = rng(1.0, 1.5) * (0.25 + 0.75 * frac);
    const coneH = rng(0.9, 1.4);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(coneR, 0.25), coneH, 6),
      leafMat
    );
    cone.position.y = trunkH + i * rng(0.5, 0.7);
    cone.castShadow = true;
    cone.receiveShadow = true;
    cone.customDepthMaterial = leafShadowDepth;
    group.add(cone);
  }

  const ty = getTerrainHeight(wx, wz);
  group.position.set(wx, ty, wz);

  // 2x bigger base, with random variation
  const s = rng(1.6, 3.2);
  group.scale.set(s, s, s);
  return group;
}

export function placeTrees(scene) {
  const grid = getGrid();
  const buildings = getBuildings();
  let placed = 0;

  for (let i = 0; i < CFG.TREES * 3 && placed < CFG.TREES; i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);

    if (!grid[gx][gz]) continue;
    if (Math.abs(gx - CFG.GRID / 2) < 5 && Math.abs(gz - CFG.GRID / 2) < 5) continue;

    let tooClose = false;
    for (const b of buildings) {
      if (gx >= b.x - 2 && gx < b.x + b.w + 2 && gz >= b.z - 2 && gz < b.z + b.h + 2) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const p = g2w(gx, gz);
    // Skip below water level
    if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y) continue;

    setCell(gx, gz, false);
    markTreeCell(gx, gz);
    const tree = createTree(p.x, p.z);
    scene.add(tree);
    treePosData.push({ x: p.x, z: p.z, ty: getTerrainHeight(p.x, p.z), scale: tree.scale.x });
    placed++;
  }
}

export function placeRocks(scene) {
  const rockMat = new THREE.MeshStandardMaterial({
    map: getRockTexture(),
    roughness: 0.95,
    flatShading: true,
  });

  const grid = getGrid();
  const buildings = getBuildings();

  // Spawn throwable pebbles first, then environment rocks
  const totalRocks = CFG.ROCKS + CFG.THROWABLE_STONES;
  let placedPebbles = 0;
  let placedEnv = 0;

  for (let i = 0; i < totalRocks * 3 && (placedPebbles < CFG.THROWABLE_STONES || placedEnv < CFG.ROCKS); i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);

    if (!grid[gx][gz]) continue;
    if (Math.abs(gx - CFG.GRID / 2) < 5 && Math.abs(gz - CFG.GRID / 2) < 5) continue;

    let inside = false;
    for (const b of buildings) {
      if (gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h) {
        inside = true;
        break;
      }
    }
    if (inside) continue;

    // Check door proximity — prevent rocks spawning near doors (would block them)
    let nearDoor = false;
    for (const b of buildings) {
      for (const d of b.doors) {
        if (Math.abs(gx - d.gx) <= 2 && Math.abs(gz - d.gz) <= 2) {
          nearDoor = true;
          break;
        }
      }
      if (nearDoor) break;
    }
    if (nearDoor) continue;

    const p0 = g2w(gx, gz);
    if (getTerrainHeight(p0.x, p0.z) < CFG.WATER_Y) continue;

    // Decide: throwable pebble or environment rock
    let s;
    if (placedPebbles < CFG.THROWABLE_STONES && (placedEnv >= CFG.ROCKS || Math.random() < 0.3)) {
      // Throwable pebble — fixed small size (matches thrown stone)
      s = CFG.THROWN_STONE_SIZE;
      placedPebbles++;
    } else if (placedEnv < CFG.ROCKS) {
      // Environment rock — clearly bigger (random, 3x+ diameter of pebbles)
      const r = Math.random();
      if (r < 0.2) {
        s = rng(1.5, 2.5); // big
      } else if (r < 0.5) {
        s = rng(0.9, 1.5); // medium
      } else {
        s = rng(0.6, 0.9); // small env (still 3x pebble diameter)
      }
      placedEnv++;
    } else {
      continue;
    }

    // Only block grid cell for large rocks (small/medium use circle collision only)
    if (s > 1.2) setCell(gx, gz, false);

    const ox = rng(-0.3, 0.3);
    const oz = rng(-0.3, 0.3);
    const ty = getTerrainHeight(p0.x + ox, p0.z + oz);

    const geo = new THREE.DodecahedronGeometry(s, 1);
    const rock = new THREE.Mesh(geo, rockMat);
    rock.position.set(p0.x + ox, ty + s * 0.4, p0.z + oz);
    rock.rotation.set(rng(0, Math.PI), rng(0, Math.PI), 0);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);

    const rc = {
      x: p0.x + ox, z: p0.z + oz,
      r: s * 0.85, top: ty + s * 0.8, height: s * 0.8,
      mesh: rock, size: s, active: true,
    };
    // Physics body for rocks large enough to block movement
    if (s > 0.5) {
      rc.physicsBody = createStaticSphere(s * 0.65, p0.x + ox, ty + s * 0.4, p0.z + oz);
    }
    rockColliders.push(rc);
  }
}

/**
 * Returns the top Y of the highest rock that overlaps (wx, wz) from above.
 * Used for stacking placed rocks on existing rocks.
 */
export function getRockStackHeight(wx, wz, currentY) {
  let bestTop = null;
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    if (dx * dx + dz * dz < rc.r * rc.r) {
      if (currentY > rc.top - 0.1) {
        if (bestTop === null || rc.top > bestTop) {
          bestTop = rc.top;
        }
      }
    }
  }
  return bestTop;
}

/**
 * Returns the top Y of the first rock collider the ray point is inside.
 * Used for rock placement preview ray-march.
 */
export function findRockSurface(wx, wz, wy) {
  for (const rc of rockColliders) {
    if (!rc.active) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    if (dx * dx + dz * dz < rc.r * rc.r) {
      if (wy <= rc.top + 0.2 && wy >= rc.top - rc.height) {
        return rc.top;
      }
    }
  }
  return null;
}

/**
 * Check if a world position is inside any tree's foliage area.
 * Returns a damping factor (0-1, where 0 = full stop, 1 = no effect), or null if not in foliage.
 */
export function getTreeFoliageDamping(wx, wy, wz) {
  for (const t of treePosData) {
    const dx = wx - t.x;
    const dz = wz - t.z;
    const hDist = Math.sqrt(dx * dx + dz * dz);
    const foliageR = t.scale * 1.3; // foliage radius (scaled cones)
    if (hDist > foliageR) continue;
    const trunkTop = t.ty + t.scale * 1.4; // scaled trunk top
    const foliageTop = t.ty + t.scale * 5.0; // top of foliage
    if (wy < trunkTop || wy > foliageTop) continue;
    // Inside foliage — return damping (closer to center = more damping)
    const centerDist = hDist / foliageR;
    return 0.3 + 0.5 * centerDist; // 0.3 at center, 0.8 at edge
  }
  return null;
}

export function registerPickableRock(mesh, x, z, size) {
  const top = mesh.position.y + size * 0.4;
  const rc = {
    x, z,
    r: size * 0.85, top, height: size * 0.8,
    mesh, size, active: true,
  };
  rc.physicsBody = createStaticSphere(size * 0.65, x, mesh.position.y, z);
  rockColliders.push(rc);
}

/**
 * Returns a pickable rock near world position (wx, wz, wy), or null.
 * Used for projectile-on-rock knockback detection.
 */
export function getPickableRockNear(wx, wz, wy, hitRadius) {
  for (const rc of rockColliders) {
    if (!rc.active || rc.size > CFG.ROCK_PICK_MAX_SIZE) continue;
    const dx = wx - rc.x;
    const dz = wz - rc.z;
    const dy = wy - (rc.top - rc.height * 0.4);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < hitRadius + rc.size * 0.5) return rc;
  }
  return null;
}

/**
 * Deactivate a rock collider (for knockback conversion to projectile).
 * Caller must handle physics body removal.
 */
export function deactivateRock(rc) {
  rc.active = false;
  rc.mesh.visible = false;
}

export function getNearestPickableRock() {
  const p = getPlayerState();
  let best = null;
  let bestDist = CFG.ROCK_PICK_DIST;
  for (const rc of rockColliders) {
    if (!rc.active || rc.size > CFG.ROCK_PICK_MAX_SIZE) continue;
    const dx = p.x - rc.x;
    const dz = p.z - rc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = rc;
    }
  }
  return best;
}

export function pickNearestRock(inventory) {
  const rc = getNearestPickableRock();
  if (!rc) return false;
  rc.active = false;
  rc.mesh.visible = false;
  inventory.stones++;
  return true;
}

const _projRock = new THREE.Vector3();

/** Returns all active pickable rocks (for minimap display) */
export function getPickableRocks() {
  return rockColliders.filter(rc => rc.active && rc.size <= CFG.ROCK_PICK_MAX_SIZE);
}

export function updateRockHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;
  if (el.style.display === 'block' &&
      (el.dataset.source === 'door' || el.dataset.source === 'soldier' || el.dataset.source === 'flower')) return;

  const rock = getNearestPickableRock();
  if (!rock) {
    if (el.dataset.source === 'rock') { el.style.display = 'none'; el.dataset.source = ''; }
    return;
  }

  const camera = getCamera();
  _projRock.set(rock.x, rock.top + 0.3, rock.z);
  _projRock.project(camera);
  if (_projRock.z > 1) {
    if (el.dataset.source === 'rock') el.style.display = 'none';
    return;
  }

  const hw = window.innerWidth / 2;
  const hh = window.innerHeight / 2;
  el.textContent = '[E] Pick up';
  el.style.fontSize = '21px';
  el.style.left = (_projRock.x * hw + hw) + 'px';
  el.style.top = (-_projRock.y * hh + hh) + 'px';
  el.style.display = 'block';
  el.dataset.source = 'rock';
}
