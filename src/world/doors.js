import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3,
         Vector3, TransformNode, Ray } from 'babylonjs';
import { CFG } from '../config.js';
import { setCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getPlayerState } from '../entities/player.js';
import { getTerrainHeight } from './terrain.js';
import { getCamera, getScene } from '../core/scene.js';
import { collidesWithRock } from './vegetation.js';
import { createKinematicBox, hasLineOfSight, GRP_DOOR } from '../core/physics.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { addTorchShadowCaster } from '../world/torches.js';

const doors = [];
const INTERACT_DIST = 3.5;
const OPEN_SPEED = 4.0; // radians per second

/* ── Shared materials (created lazily on first placeDoors call) ─── */
let doorMat = null;
let baseMat = null;
let knobMat = null;

function ensureMaterials(scene) {
  if (doorMat) return;

  const barkTex = new Texture('./assets/textures/bark.jpg', scene);
  barkTex.uScale = 1;
  barkTex.vScale = 1.5;

  // StandardMaterial, not PBR: PBR renders desaturated blue-grey in this
  // right-handed scene (same family of issues as the CLAUDE.md note about PBR
  // shadows) — doors looked "transparent" fog-blue at distance.
  doorMat = new StandardMaterial('doorMat', scene);
  doorMat.diffuseTexture = barkTex;
  doorMat.diffuseColor = Color3.FromHexString('#8b5a2b');
  doorMat.specularColor = new Color3(0.04, 0.04, 0.04);

  baseMat = new StandardMaterial('doorBaseMat', scene);
  baseMat.diffuseTexture = barkTex.clone();
  baseMat.diffuseColor = Color3.FromHexString('#663311');
  baseMat.specularColor = new Color3(0.02, 0.02, 0.02);

  knobMat = new StandardMaterial('doorKnobMat', scene);
  knobMat.diffuseColor = Color3.FromHexString('#886633');
  knobMat.specularColor = new Color3(0.5, 0.45, 0.3); // polished metal knob
  knobMat.specularPower = 64;
}

/* ── Fancy door leaf builder ─────────────────────────────────────── */
// Knob always at +X (the free swinging edge).
// Orientation is handled entirely by the placement rotation below.
// All sub-meshes merged into one mesh with multi-material for performance.
function buildFancyDoorLeaf(scene, w, h, thick, leafIndex) {
  const leaf = new TransformNode(`doorLeaf_${leafIndex}`, scene);

  const stileW = 0.45;
  const railH = 0.25;
  const knobZ = thick / 2 + 0.10;
  const knobX = w / 2 - stileW / 2;

  // Build all sub-parts as temp meshes, bake positions, then merge
  const baseParts = [];  // baseMat
  const frameParts = []; // doorMat
  const knobParts = [];  // knobMat

  // Base thin panel
  const base = MeshBuilder.CreateBox('_db', { width: w, height: h, depth: thick * 0.3 }, scene);
  base.bakeCurrentTransformIntoVertices();
  baseParts.push(base);

  // Stiles
  const ls = MeshBuilder.CreateBox('_dls', { width: stileW, height: h, depth: thick }, scene);
  ls.position.x = -w / 2 + stileW / 2;
  ls.bakeCurrentTransformIntoVertices();
  frameParts.push(ls);

  const rs = MeshBuilder.CreateBox('_drs', { width: stileW, height: h, depth: thick }, scene);
  rs.position.x = w / 2 - stileW / 2;
  rs.bakeCurrentTransformIntoVertices();
  frameParts.push(rs);

  // Rails
  const tr = MeshBuilder.CreateBox('_dtr', { width: w, height: railH, depth: thick }, scene);
  tr.position.y = h / 2 - railH / 2;
  tr.bakeCurrentTransformIntoVertices();
  frameParts.push(tr);

  const br = MeshBuilder.CreateBox('_dbr', { width: w, height: railH, depth: thick }, scene);
  br.position.y = -h / 2 + railH / 2;
  br.bakeCurrentTransformIntoVertices();
  frameParts.push(br);

  const mr1 = MeshBuilder.CreateBox('_dmr1', { width: w, height: railH, depth: thick }, scene);
  mr1.position.y = h / 6;
  mr1.bakeCurrentTransformIntoVertices();
  frameParts.push(mr1);

  const mr2 = MeshBuilder.CreateBox('_dmr2', { width: w, height: railH, depth: thick }, scene);
  mr2.position.y = -h / 4;
  mr2.bakeCurrentTransformIntoVertices();
  frameParts.push(mr2);

  // Knobs
  const kR = MeshBuilder.CreateSphere('_dkr', { diameter: 0.24, segments: 8 }, scene);
  kR.position = new Vector3(knobX, 0, knobZ);
  kR.bakeCurrentTransformIntoVertices();
  knobParts.push(kR);

  const kL = MeshBuilder.CreateSphere('_dkl', { diameter: 0.24, segments: 8 }, scene);
  kL.position = new Vector3(knobX, 0, -knobZ);
  kL.bakeCurrentTransformIntoVertices();
  knobParts.push(kL);

  // Backplates
  const pR = MeshBuilder.CreateCylinder('_dpr', { diameter: 0.12, height: 0.04, tessellation: 8 }, scene);
  pR.rotation.x = Math.PI / 2;
  pR.position = new Vector3(knobX, 0, thick / 2 + 0.02);
  pR.bakeCurrentTransformIntoVertices();
  knobParts.push(pR);

  const pL = MeshBuilder.CreateCylinder('_dpl', { diameter: 0.12, height: 0.04, tessellation: 8 }, scene);
  pL.rotation.x = Math.PI / 2;
  pL.position = new Vector3(knobX, 0, -thick / 2 - 0.02);
  pL.bakeCurrentTransformIntoVertices();
  knobParts.push(pL);

  // Merge each material group, then merge groups with multiMaterial
  const mBase = Mesh.MergeMeshes(baseParts, true, true, undefined, false, false);
  mBase.material = baseMat;
  const mFrame = Mesh.MergeMeshes(frameParts, true, true, undefined, false, false);
  mFrame.material = doorMat;
  const mKnob = Mesh.MergeMeshes(knobParts, true, true, undefined, false, false);
  mKnob.material = knobMat;

  const merged = Mesh.MergeMeshes([mBase, mFrame, mKnob], true, true, undefined, true, true);
  merged.name = `doorMerged_${leafIndex}`;
  merged.parent = leaf;
  addShadowCaster(merged);
  addTorchShadowCaster(merged);
  enableShadowReceiving(merged);

  return leaf;
}

/* ── Place all doors in the world ────────────────────────────────── */
export function placeDoors(scene) {
  ensureMaterials(scene);

  const doorW = CFG.CELL;
  const doorH = CFG.WALL_H * 0.88;

  let leafIdx = 0;

  for (const b of getBuildings()) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const group = new TransformNode(`doorGroup_${leafIdx}`, scene);
      group.position = new Vector3(p.x, 0, p.z);

      const isNS = d.wall === 'south' || d.wall === 'north';
      const leafGroup = buildFancyDoorLeaf(scene, doorW, doorH, 0.16, leafIdx);
      leafGroup.parent = group;

      // Leaf +X = free edge (knob side), leaf -X = hinge side.
      // Rotation chosen so +X always maps to the free swinging end in world space.
      if (isNS) {
        // No rotation — +X stays as +X in parent. Hinge at left (-X edge of cell).
        leafGroup.position = new Vector3(doorW / 2, doorH / 2, 0);
        group.position.x -= doorW / 2;
      } else {
        // -PI/2 rotation: leaf +X maps to parent +Z (free end).
        // Hinge at -Z edge of cell (group origin).
        leafGroup.rotation.y = -Math.PI / 2;
        leafGroup.position = new Vector3(0, doorH / 2, doorW / 2);
        group.position.z -= doorW / 2;
      }

      // Create kinematic physics body for door panel
      const doorHalfW = doorW / 2;
      const doorHalfH = doorH / 2;
      const doorHalfT = 0.25; // half thickness (thicker than visual for reliable projectile collision)
      const hingeX = isNS ? p.x - doorHalfW : p.x;
      const hingeZ = isNS ? p.z : p.z - doorHalfW;
      const physBody = createKinematicBox(
        isNS ? doorHalfW : doorHalfT,
        doorHalfH,
        isNS ? doorHalfT : doorHalfW,
        isNS ? hingeX + doorHalfW : hingeX,
        doorHalfH,
        isNS ? hingeZ : hingeZ + doorHalfW
      );

      doors.push({
        group,
        gx: d.gx,
        gz: d.gz,
        wx: p.x,
        wz: p.z,
        wall: d.wall,
        isNS,
        open: false,
        currentRotY: 0,
        targetRotY: 0,
        physBody,
        hingeX,
        hingeZ,
      });

      leafIdx++;
    }
  }
}

/* ── Query helpers ───────────────────────────────────────────────── */

export function getDoorByCell(gx, gz) {
  for (const door of doors) {
    if (door.gx === gx && door.gz === gz) return door;
  }
  return null;
}

export function getAllDoors() { return doors; }

export function getNearestDoor() {
  const p = getPlayerState();
  const cam = getCamera();
  if (!cam) return null;
  
  let best = null;
  let bestDot = -Infinity; // highest dot product wins (closest to crosshair)

  const eyePos = new Vector3(p.x, p.y + CFG.PLAYER_H * 0.8, p.z);
  const viewDir = cam.getForwardRay(1).direction;

  for (const door of doors) {
    // Skip doors if player is above door level (e.g. on 2nd floor)
    const doorBaseY = door.group.position.y;
    if (p.y > doorBaseY + CFG.WALL_H * 0.7) continue;

    // Distance from player to nearest point on door panel segment (hinge→tip)
    const doorW = CFG.CELL;
    const rot = door.currentRotY;
    let hx, hz, tx, tz;
    if (door.isNS) {
      hx = door.wx - doorW / 2;
      hz = door.wz;
      tx = hx + doorW * Math.cos(rot);
      tz = door.wz - doorW * Math.sin(rot);
    } else {
      hx = door.wx;
      hz = door.wz - doorW / 2;
      tx = door.wx + doorW * Math.sin(rot);
      tz = hz + doorW * Math.cos(rot);
    }
    const segDx = tx - hx, segDz = tz - hz;
    const len2 = segDx * segDx + segDz * segDz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - hx) * segDx + (p.z - hz) * segDz) / len2)) : 0;
    const nearX = hx + t * segDx;
    const nearZ = hz + t * segDz;
    const dist = Math.sqrt((p.x - nearX) ** 2 + (p.z - nearZ) ** 2);
    
    // Must be in interaction range
    if (dist > INTERACT_DIST) continue;

    const doorY = doorBaseY + CFG.WALL_H * 0.5;
    const pc = getDoorPanelCenter(door);
    
    // Calculate dot product to center of door panel
    const doorCenterPos = new Vector3(pc.x, doorY, pc.z);
    const toTarget = doorCenterPos.subtract(eyePos).normalize();
    const dot = Vector3.Dot(viewDir, toTarget);

    if (dot > 0.4 && dot > bestDot) {
      // Check line of sight to the door panel center to prevent interacting through walls
      // Ignore the door collision group so the ray cast doesn't hit the very door we want to interact with
      if (!hasLineOfSight(eyePos, doorCenterPos, GRP_DOOR)) continue;

      bestDot = dot;
      best = door;
    }
  }

  return best;
}

/* ── Door panel geometry helpers ─────────────────────────────────── */

/** Compute door panel positions at a given rotation */
function getDoorPanelPositions(door, rot) {
  const doorW = CFG.CELL;
  let cx, cz, tx, tz;
  if (door.isNS) {
    const hingeX = door.wx - doorW / 2;
    cx = hingeX + doorW / 2 * Math.cos(rot);
    cz = door.wz - doorW / 2 * Math.sin(rot);
    tx = hingeX + doorW * Math.cos(rot);
    tz = door.wz - doorW * Math.sin(rot);
  } else {
    const hingeZ = door.wz - doorW / 2;
    cx = door.wx + doorW / 2 * Math.sin(rot);
    cz = hingeZ + doorW / 2 * Math.cos(rot);
    tx = door.wx + doorW * Math.sin(rot);
    tz = hingeZ + doorW * Math.cos(rot);
  }
  return { cx, cz, tx, tz };
}

function panelHitsRock(door, rot, panelR) {
  const { cx, cz, tx, tz } = getDoorPanelPositions(door, rot);
  // Check center, 3/4-point, and tip along the panel for thorough coverage
  const qx = (cx + tx) / 2, qz = (cz + tz) / 2;
  return collidesWithRock(cx, cz, panelR) || collidesWithRock(qx, qz, panelR) || collidesWithRock(tx, tz, panelR);
}

/** Binary search refinement between a safe angle and a collision angle */
function refineContact(door, lo, hi, panelR) {
  for (let j = 0; j < 8; j++) {
    const mid = (lo + hi) / 2;
    if (panelHitsRock(door, mid, panelR)) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** Sweep test: find the maximum rotation before the door panel collides with a rock */
function findMaxDoorRotation(door) {
  const panelR = 0.12; // match door panel visual thickness for flush contact
  const steps = 60;
  // South/West walls: +PI/2 opens inward.  North/East walls: -PI/2 opens inward.
  const fullRot = (door.wall === 'south' || door.wall === 'west') ? Math.PI / 2 : -Math.PI / 2;
  let safeRot = 0;

  for (let i = 1; i <= steps; i++) {
    const rot = fullRot * (i / steps);
    if (panelHitsRock(door, rot, panelR)) {
      return refineContact(door, safeRot, rot, panelR);
    }
    safeRot = rot;
  }
  return fullRot;
}

/** Sweep from current open angle toward 0; returns the closest-to-closed angle the door can reach */
function findClosingTarget(door) {
  const panelR = 0.12; // match door panel visual thickness for flush contact
  const steps = 60;
  const currentRot = door.currentRotY;
  let safeRot = currentRot;

  for (let i = 1; i <= steps; i++) {
    const rot = currentRot * (1 - i / steps);
    if (panelHitsRock(door, rot, panelR)) {
      return refineContact(door, safeRot, rot, panelR);
    }
    safeRot = rot;
  }
  return 0;
}

/* ── Toggle interaction ──────────────────────────────────────────── */

export function toggleNearestDoor() {
  const door = getNearestDoor();
  if (!door) return;

  if (!door.open) {
    // Opening: sweep test to find max rotation before hitting a rock
    const maxRot = findMaxDoorRotation(door);
    if (Math.abs(maxRot) < 0.05) return; // rock completely blocks door
    door.open = true;
    door.targetRotY = maxRot;
  } else {
    // Recompute max open angle (rock situation may have changed)
    const maxRot = findMaxDoorRotation(door);

    // If door isn't at its max open angle, re-open it (e.g. after partial close against rock)
    if (Math.abs(door.currentRotY - maxRot) > 0.1 && Math.abs(maxRot) > 0.05) {
      door.targetRotY = maxRot;
    } else {
      // Door at max open — try to close
      const closeTarget = findClosingTarget(door);
      if (Math.abs(closeTarget) < 0.05) {
        door.open = false;
        door.targetRotY = 0;
      } else {
        // Rock blocks full close — close as far as possible (stays open)
        door.targetRotY = closeTarget;
      }
    }
  }
  // Doorway passable when open, blocked when closed
  setCell(door.gx, door.gz, door.open);
}

/* ── Per-frame update ────────────────────────────────────────────── */

export function updateDoors(dt) {
  const doorW = CFG.CELL;
  const doorH = CFG.WALL_H * 0.88;
  for (const door of doors) {
    if (Math.abs(door.currentRotY - door.targetRotY) > 0.01) {
      const dir = Math.sign(door.targetRotY - door.currentRotY);
      door.currentRotY += dir * OPEN_SPEED * dt;

      // Clamp to target
      if (dir > 0 && door.currentRotY > door.targetRotY) door.currentRotY = door.targetRotY;
      if (dir < 0 && door.currentRotY < door.targetRotY) door.currentRotY = door.targetRotY;

      door.group.rotation.y = door.currentRotY;
    }

    // Sync kinematic physics body to match door rotation
    if (door.physBody) {
      const rot = door.currentRotY;
      const halfW = doorW / 2;
      let cx, cz;
      if (door.isNS) {
        cx = door.hingeX + halfW * Math.cos(rot);
        cz = door.hingeZ - halfW * Math.sin(rot);
      } else {
        cx = door.hingeX + halfW * Math.sin(rot);
        cz = door.hingeZ + halfW * Math.cos(rot);
      }
      door.physBody.position.set(cx, doorH / 2, cz);
      door.physBody.quaternion.setFromEuler(0, rot, 0);
    }
  }
}

/* ── Door panel center/collision ─────────────────────────────────── */

/**
 * Get the current world-space center of a door panel based on its rotation.
 */
export function getDoorPanelCenter(door) {
  const doorW = CFG.CELL;
  const rot = door.currentRotY;
  if (door.isNS) {
    return {
      x: (door.wx - doorW / 2) + doorW / 2 * Math.cos(rot),
      z: door.wz - doorW / 2 * Math.sin(rot),
    };
  } else {
    return {
      x: door.wx + doorW / 2 * Math.sin(rot),
      z: (door.wz - doorW / 2) + doorW / 2 * Math.cos(rot),
    };
  }
}

/**
 * Check if position overlaps a door panel (tracks current rotation).
 */
export function collidesWithDoorPanel(wx, wz, entityR) {
  const doorW = CFG.CELL;
  const panelR = doorW * 0.35;

  for (const door of doors) {
    if (Math.abs(door.currentRotY) < 0.01) continue;

    const pc = getDoorPanelCenter(door);
    const dx = wx - pc.x;
    const dz = wz - pc.z;
    const minDist = entityR + panelR;
    if (dx * dx + dz * dz < minDist * minDist) return true;
  }
  return false;
}

/**
 * Push-back vector to resolve overlap with a door panel, or null.
 */
export function getDoorPanelPushback(wx, wz, entityR) {
  const doorW = CFG.CELL;
  const panelR = doorW * 0.35;
  let worstPen = 0;
  let pushX = 0, pushZ = 0;

  for (const door of doors) {
    if (Math.abs(door.currentRotY) < 0.01) continue;

    const pc = getDoorPanelCenter(door);
    const dx = wx - pc.x;
    const dz = wz - pc.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = entityR + panelR;
    const pen = minDist - dist;
    if (pen > worstPen && dist > 0) {
      worstPen = pen;
      pushX = (dx / dist) * pen;
      pushZ = (dz / dist) * pen;
    }
  }

  return worstPen > 0 ? { x: pushX, z: pushZ } : null;
}

/* ── HUD hint ────────────────────────────────────────────────────── */

export function updateDoorHint() {
  const el = document.getElementById('interact-hint');
  if (!el) return;

  const door = getNearestDoor();
  if (!door) {
    if (el.dataset.source === 'door') {
      el.style.display = 'none';
      el.dataset.source = '';
    }
    return;
  }

  const scene = getScene();
  const camera = getCamera();
  const engine = scene.getEngine();

  // Project the door's world position to screen space
  const pc = getDoorPanelCenter(door);
  const doorY = door.group.position.y + CFG.WALL_H * 0.5;
  const worldPos = new Vector3(pc.x, doorY, pc.z);

  const projected = Vector3.Project(
    worldPos,
    camera.getWorldMatrix(),
    camera.getTransformationMatrix(),
    camera.viewport.toGlobal(
      engine.getRenderWidth(),
      engine.getRenderHeight()
    )
  );

  // Behind camera — hide (z > 1 in NDC means behind)
  if (projected.z > 1) {
    if (el.dataset.source === 'door') el.style.display = 'none';
    return;
  }

  el.textContent = door.open ? '[E] Close' : '[E] Open';
  el.style.fontSize = '';
  el.style.left = projected.x + 'px';
  el.style.top = projected.y + 'px';
  el.style.display = 'block';
  el.dataset.source = 'door';
}
