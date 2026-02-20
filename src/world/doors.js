import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CFG } from '../config.js';
import { setCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getPlayerState } from '../entities/player.js';
import { getTerrainHeight } from './terrain.js';
import { getCamera } from '../core/scene.js';
import { collidesWithRock } from './vegetation.js';
import { createKinematicBox } from '../core/physics.js';

const _projVec = new THREE.Vector3();

const doors = [];
const INTERACT_DIST = 3.5;
const OPEN_SPEED = 4.0; // radians per second

const texLoader = new THREE.TextureLoader();
const barkTex = texLoader.load('./assets/textures/bark.jpg');
barkTex.wrapS = THREE.RepeatWrapping;
barkTex.wrapT = THREE.RepeatWrapping;
barkTex.repeat.set(1, 1.5);
barkTex.colorSpace = THREE.SRGBColorSpace;

const doorMat = new THREE.MeshStandardMaterial({
  map: barkTex,
  color: 0x8b5a2b,
  roughness: 0.85,
});

const knobMat = new THREE.MeshStandardMaterial({
  color: 0x886633,
  metalness: 0.8,
  roughness: 0.3,
});
const knobGeo = new THREE.SphereGeometry(0.12, 8, 6);

export function placeDoors(scene) {
  const doorW = CFG.CELL;
  const doorH = CFG.WALL_H * 0.88;
  const doorGeoNS = new THREE.BoxGeometry(doorW, doorH, 0.12);
  const doorGeoEW = new THREE.BoxGeometry(0.12, doorH, doorW);

  for (const b of getBuildings()) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const group = new THREE.Group();
      group.position.set(p.x, 0, p.z);

      const isNS = d.wall === 'south' || d.wall === 'north';
      const mesh = new THREE.Mesh(isNS ? doorGeoNS : doorGeoEW, doorMat);

      if (isNS) {
        mesh.position.set(doorW / 2, doorH / 2, 0);
        group.position.x -= doorW / 2;
      } else {
        mesh.position.set(0, doorH / 2, doorW / 2);
        group.position.z -= doorW / 2;
      }

      mesh.castShadow = true;
      group.add(mesh);

      // Door knobs on both sides
      const knobY = doorH * 0.5;
      if (isNS) {
        const knobX = doorW * 0.85; // near opening edge
        for (const side of [-1, 1]) {
          const knob = new THREE.Mesh(knobGeo, knobMat);
          knob.position.set(knobX, knobY, side * 0.08);
          group.add(knob);
        }
      } else {
        const knobZ = doorW * 0.85;
        for (const side of [-1, 1]) {
          const knob = new THREE.Mesh(knobGeo, knobMat);
          knob.position.set(side * 0.08, knobY, knobZ);
          group.add(knob);
        }
      }

      scene.add(group);

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
        isNS,
        open: false,
        currentRotY: 0,
        targetRotY: 0,
        physBody,
        hingeX,
        hingeZ,
      });
    }
  }
}

export function getDoorByCell(gx, gz) {
  for (const door of doors) {
    if (door.gx === gx && door.gz === gz) return door;
  }
  return null;
}

export function getNearestDoor() {
  const p = getPlayerState();
  let best = null;
  let bestDist = INTERACT_DIST;

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
    if (dist < bestDist) {
      bestDist = dist;
      best = door;
    }
  }

  return best;
}

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
  const fullRot = -Math.PI / 2;
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

  const camera = getCamera();
  // Project the door's world position to screen space
  const pc = getDoorPanelCenter(door);
  const doorY = door.group.position.y + CFG.WALL_H * 0.5;
  _projVec.set(pc.x, doorY, pc.z);
  _projVec.project(camera);

  // Behind camera — hide
  if (_projVec.z > 1) {
    if (el.dataset.source === 'door') el.style.display = 'none';
    return;
  }

  const hw = window.innerWidth / 2;
  const hh = window.innerHeight / 2;
  const sx = (_projVec.x * hw) + hw;
  const sy = -(_projVec.y * hh) + hh;

  el.textContent = door.open ? '[E] Close' : '[E] Open';
  el.style.fontSize = '';
  el.style.left = sx + 'px';
  el.style.top = sy + 'px';
  el.style.display = 'block';
  el.dataset.source = 'door';
}
