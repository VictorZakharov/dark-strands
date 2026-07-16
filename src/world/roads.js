import {
  Mesh, MeshBuilder, VertexData, StandardMaterial, Color3, DynamicTexture, Texture,
} from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, isRoadCell, isIndoor } from './grid.js';
import { g2w } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { enableShadowReceiving, addShadowCaster } from '../core/lighting.js';
import { addFogDepthMesh } from '../core/postfx.js';
import { createWallTorch, getDoorTorchLights, getDoorTorchFlames, getPickableTorches } from './torches.js';
import { addTorchEmbers } from './torchParticles.js';
import { getRoadPaths, carveDoorSpurs, buildRoadRibbonData, makeCobblePixels } from './roadNetwork.js';
import { collidesWithRock } from './vegetation.js';

// Network generation + geometry math live in roadNetwork.js (pure module,
// shared with the Node validation harness tools/validate-roads.mjs).
export { generateRoads, getRoadPaths } from './roadNetwork.js';

// ─── Road visuals ────────────────────────────────────────────────────────────

/** Procedural cobblestone texture — pixels come from makeCobblePixels
 *  (wrapped-Voronoi stones + mortar gaps, seamless tile). */
function makeCobbleTexture(scene) {
  const sz = 256;
  const tex = new DynamicTexture('roadCobbleTex', sz, scene, true);
  const ctx = tex.getContext();
  const img = ctx.createImageData(sz, sz);
  img.data.set(makeCobblePixels(sz));
  ctx.putImageData(img, 0, 0);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  return tex;
}

/**
 * Merged cobblestone ribbon along the smoothed road network. Geometry comes
 * from roadNetwork.js buildRoadRibbonData: Chaikin-smoothed centerlines
 * (curves instead of square grid corners) extruded to terrain-hugging strips,
 * plus door spurs curving off the roads to each road-facing entrance.
 * Must run AFTER generateBuildings — flat zones alter terrain height, and
 * door spurs need the placed buildings.
 */
export function buildRoadMesh(scene) {
  carveDoorSpurs(); // mark + record door→road stubs before building ribbons
  const data = buildRoadRibbonData();
  if (!data || data.indices.length === 0) return;

  const mesh = new Mesh('roads', scene);
  const vd = new VertexData();
  vd.positions = new Float32Array(data.positions);
  vd.normals = new Float32Array(data.normals);
  vd.uvs = new Float32Array(data.uvs);
  vd.indices = new Uint32Array(data.indices);
  vd.applyToMesh(mesh);

  const mat = new StandardMaterial('roadMat', scene);
  mat.diffuseTexture = makeCobbleTexture(scene);
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.backFaceCulling = false; // thin ribbon — immune to RH winding direction
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.metadata = { isGround: true };
  enableShadowReceiving(mesh);
  mesh.freezeWorldMatrix();
}

// ─── Road torches ────────────────────────────────────────────────────────────

let _postMat = null;

/** Bark-textured wood material for the torch posts (same Poly Haven bark the
 *  tree trunks use — see vegetation.js getBarkTexture pattern). */
function getPostMaterial(scene) {
  if (!_postMat) {
    const tex = new Texture('./assets/textures/bark.jpg', scene);
    tex.uScale = 1;
    tex.vScale = 1.5;
    _postMat = new StandardMaterial('roadPostMat', scene);
    _postMat.diffuseTexture = tex;
    _postMat.specularColor = new Color3(0.02, 0.02, 0.02);
  }
  return _postMat;
}

/**
 * Standing torch posts along the roads: every ROAD_TORCH_SPACING cells,
 * alternating sides, 1 cell off the road pulled slightly toward the verge.
 * Each site is a permanent tapered wooden post (merged into one 'roadPosts'
 * mesh, sun-shadow caster, not pickable) with a wall-style angled torch
 * mounted near the top, leaning over the road. The TORCH is pickable exactly
 * like house torches (E to take — flame/embers/glow/light all standard) and
 * follows the door-torch day/night cycle: off during the day, lit at dusk
 * (registered in the doorTorch lists that daynight.js drives).
 * Must run after initTorchLightPool; initTorchEmbers picks up the ember
 * systems retroactively (same as placeTorches).
 */
export function placeRoadTorches(scene) {
  const grid = getGrid();
  const postH = CFG.ROAD_TORCH_POST_H;
  const postMeshes = [];
  const entries = [];
  let count = 0;
  let side = 1;

  for (const path of getRoadPaths()) {
    if (count >= CFG.ROAD_TORCH_MAX) break;
    for (let i = CFG.ROAD_TORCH_SPACING; i < path.length; i += CFG.ROAD_TORCH_SPACING) {
      if (count >= CFG.ROAD_TORCH_MAX) break;
      const cell = path[i];
      const prev = path[i - 1];
      // Perpendicular to the local road direction, alternating sides
      const dx = Math.sign(cell.gx - prev.gx);
      const dz = Math.sign(cell.gz - prev.gz);
      let ox = -dz * side, oz = dx * side;
      if (ox === 0 && oz === 0) { ox = side; }
      side = -side;

      const tgx = cell.gx + ox, tgz = cell.gz + oz;
      if (tgx < 0 || tgx >= CFG.GRID || tgz < 0 || tgz >= CFG.GRID) continue;
      if (!grid[tgx][tgz] || isRoadCell(tgx, tgz) || isIndoor(tgx, tgz)) continue;

      const p = g2w(tgx, tgz);
      // Stand at the verge — pull a quarter cell back toward the road edge
      const wx = p.x - ox * CFG.CELL * 0.25;
      const wz = p.z - oz * CFG.CELL * 0.25;
      const y = getTerrainHeight(wx, wz);
      if (y < CFG.WATER_Y + 0.3) continue;
      // Never plant a post inside a boulder (rocks don't block grid cells,
      // so the grid walkability check above can't catch them)
      if (collidesWithRock(wx, wz, 0.7)) continue;

      // Tapered wooden post — permanent scenery, merged below. Sunk slightly:
      // the rendered ground (coarse 2.8u lattice) can dip below the analytic
      // height, and a floating post base is far more visible than a buried one.
      const sink = 0.12;
      const post = MeshBuilder.CreateCylinder('roadPost', {
        diameterTop: 0.15, diameterBottom: 0.22, height: postH, tessellation: 7,
      }, scene);
      post.position.set(wx, y - sink + postH / 2, wz);
      post.isPickable = false;
      postMeshes.push(post);

      // Wall-style angled torch mounted near the top, tilted toward the road
      const nx = -ox, nz = -oz;
      const t = createWallTorch(scene, wx + nx * 0.09, wz + nz * 0.09, y - sink + postH - 0.25, nx, nz);
      // Day/night: same registration as exterior door torches — daynight.js
      // drives baseIntensity (light) and setEnabled (flame) from these lists
      t.light.intensity = 0;
      t.light.metadata.baseIntensity = 0;
      t.flame.isVisible = false;
      t.flame.setEnabled(false);
      if (t.glow) t.glow.isVisible = false;
      getDoorTorchLights().push(t.light);
      getDoorTorchFlames().push(t.flame);
      const entry = { ...t, active: true };
      getPickableTorches().push(entry);
      addTorchEmbers(entry);
      entries.push(entry);
      count++;
    }
  }

  if (postMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(postMeshes, true, true, undefined, false, false);
    if (merged) {
      merged.name = 'roadPosts';
      merged.material = getPostMaterial(scene);
      merged.isPickable = false;
      addShadowCaster(merged);
      enableShadowReceiving(merged);
      addFogDepthMesh(merged); // thin poles silhouette against sky/far fog
      merged.freezeWorldMatrix();
    }
  }

  if (entries.length > 0) {
    // daynight.js toggles doorTorchFlames with setEnabled, but the glow
    // billboard mirrors flame.isVisible (updateTorchEmbers) — sync isVisible
    // to the enabled state so flame AND glow appear at dusk, vanish at dawn.
    scene.onBeforeRenderObservable.add(() => {
      for (const e of entries) {
        if (!e.active) continue; // picked up — stays hidden
        const on = e.flame.isEnabled();
        if (e.flame.isVisible !== on) e.flame.isVisible = on;
      }
    });
  }
}
