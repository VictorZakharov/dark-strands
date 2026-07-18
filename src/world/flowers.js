import { Vector3, Matrix, Quaternion, Color3, StandardMaterial } from 'babylonjs';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { isWalkable, isRoadCell } from './grid.js';
import { getTerrainHeight } from './terrain.js';
import { isOnBuildingFloor } from './generator.js';
import { collidesWithRock } from './vegetation.js';
import { CFG } from '../config.js';
import { hasLineOfSight } from '../core/physics.js';
import { w2g } from '../utils/helpers.js';

const PICK_DIST = 2.5;

// Every wildflower in the world is a thin instance of one of these per-color
// field meshes (built + registered by vegetation.js placeFlowers). Picking
// hides an instance (its slot returns to the plant pool — picked flowers do NOT
// respawn); planting fills a free slot. This is what makes the whole flower
// field pickable/plantable in ~3 draw calls instead of a mesh per flower.
// field = { itemType, invKey, mesh, records[], norm, freeSlots, previewMesh, ghostMat }
const fields = [];

const inventory = { stones: 0, torches: 0, flowerWhite: 0, flowerYellow: 0, flowerBlue: 0 };
export function getInventory() { return inventory; }

// Flat list of all instance records for the minimap (reads .active/.wx/.wz).
export function getFlowers() {
  const out = [];
  for (const f of fields) for (const r of f.records) out.push(r);
  return out;
}

const GREEN = new Color3(0.267, 1.0, 0.267);
const RED = new Color3(1.0, 0.267, 0.267);

// Degenerate transform parked far below the world — marks a hidden slot.
const HIDDEN = Matrix.Scaling(0.00001, 0.00001, 0.00001);
HIDDEN.setTranslation(new Vector3(0, -2000, 0));

const _m = new Matrix();
const _q = Quaternion.Identity();
const _scl = new Vector3();
const _pos = new Vector3();

function fieldByItem(itemType) {
  for (const f of fields) if (f.itemType === itemType) return f;
  return null;
}

/** Called by vegetation.js once per flower color after building the field. */
export function registerFlowerField(field) {
  field.previewMesh = null;
  field.ghostMat = null;
  // Free slots available for planting: any inactive record (the reserved
  // headroom to start). Picking a flower frees its slot back into this pool.
  field.freeSlots = 0;
  for (const r of field.records) if (!r.active) field.freeSlots++;
  fields.push(field);
}

// --- placement preview -----------------------------------------------------
let previewValid = false;
export function isPreviewValid() { return previewValid; }

export function initFlowerPreview(scene) {
  // Ghost = the single-mesh clone vegetation handed us, wearing a cheap
  // translucent StandardMaterial. Deliberately NOT the field's textured PBR
  // material: a light shader compiles fast (fixes the plant-toggle stall) and
  // green/red reads clearly as valid/invalid.
  for (const f of fields) {
    const ghost = f.previewBase;
    if (!ghost) continue;
    ghost.name = f.itemType + '_preview';
    ghost.isPickable = false;
    ghost.scaling = new Vector3(f.norm, f.norm, f.norm);
    const gm = new StandardMaterial(f.itemType + '_ghostMat', scene);
    gm.alpha = 0.6;
    gm.backFaceCulling = false;
    gm.specularColor = new Color3(0, 0, 0);
    ghost.material = gm;
    f.previewMesh = ghost;
    f.ghostMat = gm;
    setPreviewTint(f, GREEN);
    ghost.setEnabled(false);
  }
}

function setPreviewTint(f, color) {
  if (!f.ghostMat) return;
  f.ghostMat.diffuseColor = color;
  f.ghostMat.emissiveColor = color.scale(0.35);
}

/** Park each ghost in front of the camera and render once (behind the loading
 *  screen) so WebGPU compiles the translucent pipeline now, not on first toggle.
 *  Caller renders, then calls hideFlowerPreview(). */
export function prewarmFlowerPreviews() {
  const cam = getCamera();
  if (!cam) return;
  const dir = cam.getForwardRay(1).direction;
  for (const f of fields) {
    if (!f.previewMesh) continue;
    f.previewMesh.position = cam.position.add(dir.scale(2));
    f.previewMesh.setEnabled(true);
  }
}

export function hideFlowerPreview() {
  for (const f of fields) if (f.previewMesh) f.previewMesh.setEnabled(false);
  previewValid = false;
}

export function updateFlowerPreview(camera, active, itemType) {
  const field = active ? fieldByItem(itemType) : null;
  // Only the selected color's ghost may be visible.
  for (const f of fields) {
    if (f !== field && f.previewMesh) f.previewMesh.setEnabled(false);
  }
  if (!field || !field.previewMesh) { previewValid = false; return; }
  const ghost = field.previewMesh;
  if (inventory[field.invKey] <= 0) { ghost.setEnabled(false); previewValid = false; return; }

  const origin = camera.position.clone();
  const dir = camera.getTarget().subtract(camera.position).normalize();
  const p = getPlayerState();
  const px = p.x, pz = p.z;

  // Looking up — no ground intersection
  if (dir.y >= -0.01) { ghost.setEnabled(false); previewValid = false; return; }

  // Iterative ground plane intersection (accounts for terrain curvature)
  let groundY = 0, hitX, hitZ, t;
  for (let i = 0; i < 3; i++) {
    t = (groundY - origin.y) / dir.y;
    if (t < 0.1 || t > 20) { ghost.setEnabled(false); previewValid = false; return; }
    hitX = origin.x + dir.x * t;
    hitZ = origin.z + dir.z * t;
    groundY = getTerrainHeight(hitX, hitZ);
  }

  const dxp = hitX - px, dzp = hitZ - pz;
  if (Math.sqrt(dxp * dxp + dzp * dzp) > CFG.PLANT_MAX_DIST) {
    ghost.setEnabled(false); previewValid = false; return;
  }

  // Validate: on walkable ground, off building floors (full footprint + 0.6u
  // margin so the wood floor AND the doorway threshold just outside the wall
  // are both off-limits), off roads, not underwater, clear of rocks, and this
  // color still has a free slot to plant into (else the ghost goes red rather
  // than the click silently doing nothing).
  const g = w2g(hitX, hitZ);
  const onFloor = isOnBuildingFloor(hitX, hitZ, 0.6);
  const underwater = !CFG.SNOW_MODE && groundY < CFG.WATER_Y;
  const walkable = isWalkable(hitX, hitZ);
  const onRoad = isRoadCell(g.x, g.z);
  const rockBlock = collidesWithRock(hitX, hitZ, 0.3);
  previewValid = !onFloor && !underwater && walkable && !onRoad && !rockBlock &&
    field.freeSlots > 0;

  setPreviewTint(field, previewValid ? GREEN : RED);
  ghost.position = new Vector3(hitX, groundY - 0.02, hitZ);
  ghost.setEnabled(true);
}

// --- pick / plant / respawn ------------------------------------------------
function composeInstance(field, wx, wz, out) {
  const wy = getTerrainHeight(wx, wz);
  const s = (0.8 + Math.random() * 0.5) * field.norm;
  _scl.set(s, s, s);
  Quaternion.RotationYawPitchRollToRef(Math.random() * Math.PI * 2, 0, 0, _q);
  _pos.set(wx, wy - 0.02, wz);
  Matrix.ComposeToRef(_scl, _q, _pos, out);
}

export function getNearestFlower() {
  const p = getPlayerState();
  const cam = getCamera();
  if (!cam) return null;

  const eye = { x: p.x, y: p.y + CFG.PLAYER_H * 0.8, z: p.z };
  const eyeV = new Vector3(eye.x, eye.y, eye.z);
  const viewDir = cam.getForwardRay(1).direction;

  let best = null, bestDot = -Infinity;
  for (const f of fields) {
    const recs = f.records;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r.active) continue;
      const dx = p.x - r.wx, dz = p.z - r.wz;
      if (dx * dx + dz * dz > PICK_DIST * PICK_DIST) continue;
      const ty = getTerrainHeight(r.wx, r.wz);
      const fp = new Vector3(r.wx, ty + 0.3, r.wz);
      const dot = Vector3.Dot(viewDir, fp.subtract(eyeV).normalize());
      if (dot > 0.4 && dot > bestDot) {
        if (!hasLineOfSight(eye, fp)) continue;
        bestDot = dot;
        best = { field: f, index: i, wx: r.wx, wz: r.wz };
      }
    }
  }
  return best;
}

/** Pick the flower under the crosshair. Returns its hotbar item type, or null.
 *  Picked flowers do NOT respawn — the slot just returns to the plant pool. */
export function pickNearestFlower() {
  const hit = getNearestFlower();
  if (!hit) return null;
  const { field, index } = hit;
  const r = field.records[index];
  r.active = false;
  field.mesh.thinInstanceSetMatrixAt(index, HIDDEN, true);
  field.freeSlots++;
  inventory[field.invKey]++;
  return field.itemType;
}

/** Plant one flower of `itemType` at the current (valid) preview position. */
export function plantFlower(scene, itemType) {
  const field = fieldByItem(itemType);
  if (!field || !previewValid || inventory[field.invKey] <= 0) return false;
  const ghost = field.previewMesh;
  if (!ghost || !ghost.isEnabled()) return false;

  // Fill any free (inactive) slot.
  let slot = -1;
  for (let i = 0; i < field.records.length; i++) {
    if (!field.records[i].active) { slot = i; break; }
  }
  if (slot < 0) return false; // no free slot (shouldn't happen — picking frees them)

  const wx = ghost.position.x, wz = ghost.position.z;
  composeInstance(field, wx, wz, _m);
  field.mesh.thinInstanceSetMatrixAt(slot, _m, true);
  const r = field.records[slot];
  r.active = true; r.wx = wx; r.wz = wz;
  field.freeSlots--;
  inventory[field.invKey]--;
  return true;
}
