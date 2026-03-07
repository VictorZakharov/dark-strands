import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3, Matrix } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, setCell, markTreeCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rng, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { createStaticSphere, createStaticCylinder, hasLineOfSight, ROCK_COLLISION_GROUP } from '../core/physics.js';

let barkTex, leafTex, rockTex;

const rockColliders = [];

// Tree positions for foliage collision checks
const treePosData = []; // { x, z, ty, scale }

function getBarkTexture(scene) {
  if (!barkTex) {
    barkTex = new Texture('./assets/textures/bark.jpg', scene);
    barkTex.uScale = 1;
    barkTex.vScale = 2;
  }
  return barkTex;
}

function getLeafTexture(scene) {
  if (!leafTex) {
    leafTex = new Texture('./assets/textures/grass.jpg', scene);
    leafTex.uScale = 2;
    leafTex.vScale = 2;
  }
  return leafTex;
}

export function getRockTexture(scene) {
  if (!rockTex) {
    rockTex = new Texture('./assets/textures/stone_wall.jpg', scene);
    rockTex.uScale = 1;
    rockTex.vScale = 1;
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

export function placeTrees(scene) {
  const grid = getGrid();
  const buildings = getBuildings();

  // Shared materials (StandardMaterial for shadow compatibility)
  const trunkMat = new StandardMaterial('trunkMat', scene);
  trunkMat.diffuseTexture = getBarkTexture(scene);
  trunkMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const leafMat = new StandardMaterial('leafMat', scene);
  leafMat.diffuseColor = CFG.SNOW_MODE ? new Color3(0xc8 / 255, 0xcd / 255, 0xd0 / 255) : new Color3(0x3a / 255, 0x8a / 255, 0x3a / 255);
  leafMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const trunkMeshes = [];
  const coneMeshes = [];
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
    if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y) continue;

    setCell(gx, gz, false);
    markTreeCell(gx, gz);

    const ty = getTerrainHeight(p.x, p.z);
    const trunkH = rng(1.4, 2.4);
    const trunkRadBot = rng(0.14, 0.22);
    const trunkRadTop = trunkRadBot * rng(0.5, 0.75);
    const numCones = rngInt(3, 5);
    const s = rng(1.6, 3.2);

    // Trunk — create temp mesh, position/scale, bake transform for merging
    const tMesh = MeshBuilder.CreateCylinder('_trunk', {
      diameterTop: trunkRadTop * 2,
      diameterBottom: trunkRadBot * 2,
      height: trunkH,
      tessellation: 6,
    }, scene);
    tMesh.scaling = new Vector3(s, s, s);
    tMesh.position = new Vector3(p.x, ty + trunkH / 2 * s, p.z);
    tMesh.bakeCurrentTransformIntoVertices();
    trunkMeshes.push(tMesh);

    // Canopy cones
    for (let j = 0; j < numCones; j++) {
      const frac = 1 - j / numCones;
      const coneR = rng(1.0, 1.5) * (0.25 + 0.75 * frac);
      const coneH = rng(0.9, 1.4);
      const coneY = trunkH + j * rng(0.5, 0.7);
      const cMesh = MeshBuilder.CreateCylinder('_cone', {
        diameterTop: 0,
        diameterBottom: Math.max(coneR, 0.25) * 2,
        height: coneH,
        tessellation: 6,
      }, scene);
      cMesh.scaling = new Vector3(s, s, s);
      cMesh.position = new Vector3(p.x, ty + coneY * s, p.z);
      cMesh.bakeCurrentTransformIntoVertices();
      coneMeshes.push(cMesh);
    }

    treePosData.push({ x: p.x, z: p.z, ty, scale: s });
    createStaticCylinder(trunkRadBot * s, trunkH * s / 2, p.x, ty + trunkH * s / 2, p.z);
    placed++;
  }

  // Merge all trunks into 1 draw call
  if (trunkMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(trunkMeshes, true, true, undefined, false, true);
    merged.name = 'mergedTrunks';
    merged.material = trunkMat;
    addShadowCaster(merged);
  }

  // Merge all canopy cones into 1 draw call
  if (coneMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(coneMeshes, true, true, undefined, false, true);
    merged.name = 'mergedCanopy';
    merged.material = leafMat;
    merged.convertToFlatShadedMesh();
    addShadowCaster(merged);
    enableShadowReceiving(merged);
  }
}

export function placeRocks(scene) {
  const rockMat = new StandardMaterial('rockMat', scene);
  rockMat.diffuseTexture = getRockTexture(scene);
  rockMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const grid = getGrid();
  const buildings = getBuildings();
  const mergedRockMeshes = [];

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
      if (gx >= b.x - 1 && gx < b.x + b.w + 1 && gz >= b.z - 1 && gz < b.z + b.h + 1) {
        inside = true;
        break;
      }
    }
    if (inside) continue;

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

    let s;
    if (placedPebbles < CFG.THROWABLE_STONES && (placedEnv >= CFG.ROCKS || Math.random() < 0.3)) {
      s = CFG.THROWN_STONE_SIZE;
      placedPebbles++;
    } else if (placedEnv < CFG.ROCKS) {
      const r = Math.random();
      if (r < 0.2) {
        s = rng(1.5, 2.5);
      } else if (r < 0.5) {
        s = rng(0.9, 1.5);
      } else {
        s = rng(0.6, 0.9);
      }
      placedEnv++;
    } else {
      continue;
    }

    if (s > 1.2) setCell(gx, gz, false);

    const ox = rng(-0.3, 0.3);
    const oz = rng(-0.3, 0.3);
    const ty = getTerrainHeight(p0.x + ox, p0.z + oz);
    const rx = rng(0, Math.PI);
    const ry = rng(0, Math.PI);

    const pickable = s <= CFG.ROCK_PICK_MAX_SIZE;

    if (pickable) {
      // Pickable rocks stay individual (can be hidden on pickup)
      const rock = MeshBuilder.CreateIcoSphere('pickableRock', { radius: s, subdivisions: 2 }, scene);
      rock.position = new Vector3(p0.x + ox, ty + s * 0.4, p0.z + oz);
      rock.rotation = new Vector3(rx, ry, 0);
      rock.material = rockMat;
      // Pickable rocks are tiny — skip sun shadow to save draw calls
      enableShadowReceiving(rock);

      const rc = {
        x: p0.x + ox, z: p0.z + oz,
        r: s * 0.85, top: ty + s * 0.8, height: s * 0.8,
        mesh: rock, size: s, active: true,
      };
      if (s > 0.5) {
        rc.physicsBody = createStaticSphere(s * 0.75, p0.x + ox, ty + s * 0.4, p0.z + oz, undefined, ROCK_COLLISION_GROUP);
      }
      rockColliders.push(rc);
    } else {
      // Non-pickable rocks — bake transform into mesh for merging
      const rockMesh = MeshBuilder.CreateIcoSphere('_rock', { radius: s, subdivisions: 2 }, scene);
      rockMesh.position = new Vector3(p0.x + ox, ty + s * 0.4, p0.z + oz);
      rockMesh.rotation = new Vector3(rx, ry, 0);
      rockMesh.bakeCurrentTransformIntoVertices();
      mergedRockMeshes.push(rockMesh);

      const rc = {
        x: p0.x + ox, z: p0.z + oz,
        r: s * 0.85, top: ty + s * 0.8, height: s * 0.8,
        mesh: null, size: s, active: true,
      };
      if (s > 0.5) {
        rc.physicsBody = createStaticSphere(s * 0.75, p0.x + ox, ty + s * 0.4, p0.z + oz, undefined, ROCK_COLLISION_GROUP);
      }
      rockColliders.push(rc);
    }
  }

  // Merge all non-pickable rocks into 1 draw call
  if (mergedRockMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(mergedRockMeshes, true, true, undefined, false, true);
    merged.name = 'mergedRocks';
    merged.material = rockMat;
    merged.convertToFlatShadedMesh();
    addShadowCaster(merged);
    enableShadowReceiving(merged);
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
  rc.physicsBody = createStaticSphere(size * 0.85, x, mesh.position.y, z, undefined, ROCK_COLLISION_GROUP);
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
  if (rc.mesh) rc.mesh.isVisible = false;
}

export function getNearestPickableRock() {
  const p = getPlayerState();
  const cam = getCamera();
  if (!cam) return null;

  let best = null;
  let bestDot = -Infinity;

  const eyePos = { x: p.x, y: p.y + CFG.PLAYER_H * 0.8, z: p.z };
  const viewDir = cam.getForwardRay(1).direction;

  for (const rc of rockColliders) {
    if (!rc.active || rc.size > CFG.ROCK_PICK_MAX_SIZE) continue;
    const dx = p.x - rc.x;
    const dz = p.z - rc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist > CFG.ROCK_PICK_DIST) continue;

    const rockPos = new Vector3(rc.x, rc.top, rc.z);
    const toTarget = rockPos.subtract(new Vector3(eyePos.x, eyePos.y, eyePos.z)).normalize();
    const dot = Vector3.Dot(viewDir, toTarget);

    if (dot > 0.4 && dot > bestDot) {
      if (!hasLineOfSight(eyePos, rockPos, ROCK_COLLISION_GROUP.membership)) continue;
      bestDot = dot;
      best = rc;
    }
  }
  return best;
}

export function pickNearestRock(inventory) {
  const rc = getNearestPickableRock();
  if (!rc) return false;
  rc.active = false;
  if (rc.mesh) rc.mesh.isVisible = false;
  inventory.stones++;
  return true;
}

const _projRock = new Vector3();

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
  const scn = camera.getScene();
  const engine = scn.getEngine();

  // Project rock world position to screen coordinates
  const worldPos = new Vector3(rock.x, rock.top + 0.3, rock.z);
  const projected = Vector3.Project(
    worldPos,
    Matrix.Identity(),
    scn.getTransformMatrix(),
    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  );

  // Check if behind camera (z > 1 in NDC equivalent)
  if (projected.z > 1) {
    if (el.dataset.source === 'rock') el.style.display = 'none';
    return;
  }

  el.textContent = '[E] Pick up';
  el.style.fontSize = '21px';
  el.style.left = projected.x + 'px';
  el.style.top = projected.y + 'px';
  el.style.display = 'block';
  el.dataset.source = 'rock';
}
