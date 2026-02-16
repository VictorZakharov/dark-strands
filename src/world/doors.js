import * as THREE from 'three';
import { CFG } from '../config.js';
import { setCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getPlayerState } from '../entities/player.js';
import { getTerrainHeight } from './terrain.js';
import { getCamera } from '../core/scene.js';

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
      });
    }
  }
}

export function getNearestDoor() {
  const p = getPlayerState();
  let best = null;
  let bestDist = INTERACT_DIST;

  for (const door of doors) {
    // Skip doors if player is above door level (e.g. on 2nd floor)
    const doorBaseY = door.group.position.y;
    if (p.y > doorBaseY + CFG.WALL_H * 0.7) continue;

    const dx = p.x - door.wx;
    const dz = p.z - door.wz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = door;
    }
  }

  return best;
}

export function toggleNearestDoor() {
  const door = getNearestDoor();
  if (!door) return;

  door.open = !door.open;
  door.targetRotY = door.open ? -Math.PI / 2 : 0;
  // Doorway passable when open, blocked when closed
  setCell(door.gx, door.gz, door.open);
}

export function updateDoors(dt) {
  for (const door of doors) {
    if (Math.abs(door.currentRotY - door.targetRotY) > 0.01) {
      const dir = Math.sign(door.targetRotY - door.currentRotY);
      door.currentRotY += dir * OPEN_SPEED * dt;

      // Clamp to target
      if (dir > 0 && door.currentRotY > door.targetRotY) door.currentRotY = door.targetRotY;
      if (dir < 0 && door.currentRotY < door.targetRotY) door.currentRotY = door.targetRotY;

      door.group.rotation.y = door.currentRotY;
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
