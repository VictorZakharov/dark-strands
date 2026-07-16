import { MeshBuilder, Mesh, StandardMaterial, Texture, DynamicTexture, Color3,
         Vector3, Matrix, Quaternion, VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, setCell, markTreeCell, isRoadCell, isNearRoad } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w, rng, rngInt } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { getPlayerState } from '../entities/player.js';
import { getCamera } from '../core/scene.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { createStaticSphere, createStaticCylinder, hasLineOfSight, ROCK_COLLISION_GROUP } from '../core/physics.js';
import { addFogDepthMesh } from '../core/postfx.js';

let barkTex, leafTex, rockTex, leafCardTex, needleCardTex, needleMassTex;

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

/**
 * Procedural leaf-cluster card texture — dozens of overlapping leaf shapes
 * on a transparent background. Alpha-tested on the merged card mesh, so no
 * blend sorting is needed and depth writes stay correct.
 */
function getLeafCardTexture(scene) {
  if (leafCardTex) return leafCardTex;
  const SZ = 256;
  leafCardTex = new DynamicTexture('leafCards', SZ, scene, true);
  const ctx = leafCardTex.getContext();
  ctx.clearRect(0, 0, SZ, SZ);
  // leaf = pointed ellipse; scatter clusters denser near the center
  for (let i = 0; i < 170; i++) {
    const cx = SZ / 2 + (Math.random() - 0.5) * SZ * 0.82;
    const cy = SZ / 2 + (Math.random() - 0.5) * SZ * 0.82;
    const r = Math.hypot(cx - SZ / 2, cy - SZ / 2) / (SZ / 2);
    if (r > 0.92) continue;
    const len = 16 + Math.random() * 18;
    const wid = len * (0.38 + Math.random() * 0.2);
    const ang = Math.random() * Math.PI * 2;
    const shade = 0.75 + Math.random() * 0.45;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(${Math.floor(95 * shade)}, ${Math.floor(160 * shade)}, ${Math.floor(62 * shade)}, 1)`;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.quadraticCurveTo(wid / 2, 0, 0, len / 2);
    ctx.quadraticCurveTo(-wid / 2, 0, 0, -len / 2);
    ctx.fill();
    // central vein
    ctx.strokeStyle = `rgba(${Math.floor(40 * shade)}, ${Math.floor(90 * shade)}, ${Math.floor(30 * shade)}, 0.9)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0, len / 2);
    ctx.stroke();
    ctx.restore();
  }
  leafCardTex.update();
  leafCardTex.hasAlpha = true;
  return leafCardTex;
}

/** Needle-cluster card texture for pine fringes — thin radiating needles. */
function getNeedleCardTexture(scene) {
  if (needleCardTex) return needleCardTex;
  const SZ = 256;
  needleCardTex = new DynamicTexture('needleCards', SZ, scene, true);
  const ctx = needleCardTex.getContext();
  ctx.clearRect(0, 0, SZ, SZ);
  // DIRECTIONAL spray: all sprigs fan from the left edge toward +X, so a
  // card rolled to point away from the trunk reads as a fir branch spray.
  // CRITICAL for alpha-tested foliage: thin lines alone MIP-AVERAGE below
  // the alpha cutoff and the cards vanish at any distance ("bare pole"
  // trees) — each sprig first lays down a SOLID tapering backing mass that
  // survives mipmapping, then draws needle detail over it.
  for (let c = 0; c < 7; c++) {
    const cx = 12 + Math.random() * 30;
    const cy = 28 + Math.random() * (SZ - 56);
    const twigAng = (Math.random() - 0.5) * 0.9; // fan around +X
    const twigLen = 160 + Math.random() * 80;
    const shade = 0.65 + Math.random() * 0.5;
    const tx = Math.cos(twigAng), tyv = Math.sin(twigAng);
    const px = -tyv, py = tx; // perpendicular

    // solid feathered backing wedge (wide at base, pointed at tip)
    ctx.fillStyle = `rgba(${Math.floor(24 * shade)}, ${Math.floor(72 * shade)}, ${Math.floor(38 * shade)}, 1)`;
    ctx.beginPath();
    ctx.moveTo(cx + px * 13, cy + py * 13);
    for (let i = 1; i <= 6; i++) {
      const f = i / 6;
      const w = 13 * (1 - f * 0.85) * (0.8 + Math.random() * 0.5);
      ctx.lineTo(cx + tx * twigLen * f + px * w, cy + tyv * twigLen * f + py * w);
    }
    for (let i = 6; i >= 0; i--) {
      const f = i / 6;
      const w = 13 * (1 - f * 0.85) * (0.8 + Math.random() * 0.5);
      ctx.lineTo(cx + tx * twigLen * f - px * w, cy + tyv * twigLen * f - py * w);
    }
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = `rgba(${Math.floor(52 * shade)}, ${Math.floor(42 * shade)}, ${Math.floor(30 * shade)}, 1)`;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + tx * twigLen, cy + tyv * twigLen);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${Math.floor(34 * shade)}, ${Math.floor(96 * shade)}, ${Math.floor(50 * shade)}, 1)`;
    ctx.lineWidth = 3.5;
    for (let i = 0; i < 30; i++) {
      const f = 0.05 + (i / 30) * 0.95;
      const bx = cx + tx * twigLen * f;
      const by = cy + tyv * twigLen * f;
      const side = i % 2 === 0 ? 1 : -1;
      // needles sweep toward the twig tip and shorten near it
      const na = twigAng + side * (1.05 - f * 0.3);
      const nl = (16 + Math.random() * 6) * (1 - f * 0.45);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(na) * nl, by + Math.sin(na) * nl);
      ctx.stroke();
    }
  }
  needleCardTex.update();
  needleCardTex.hasAlpha = true;
  return needleCardTex;
}

/**
 * Opaque tileable needle-mass texture for the pine crown cones — smooth
 * vertex-colored cones read as plastic "green blobs" against the detailed
 * needle sprays; this makes the whole crown one visual language.
 */
function getNeedleMassTexture(scene) {
  if (needleMassTex) return needleMassTex;
  const SZ = 256;
  needleMassTex = new DynamicTexture('needleMass', SZ, scene, true);
  const ctx = needleMassTex.getContext();
  ctx.fillStyle = 'rgb(22, 40, 24)';
  ctx.fillRect(0, 0, SZ, SZ);
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * SZ;
    const y = Math.random() * SZ;
    const a = Math.random() * Math.PI * 2;
    const len = 7 + Math.random() * 8;
    const shade = 0.55 + Math.random() * 0.75;
    ctx.strokeStyle = `rgba(${Math.floor(38 * shade)}, ${Math.floor(84 * shade)}, ${Math.floor(46 * shade)}, 1)`;
    ctx.lineWidth = 1.8;
    // draw with wrap offsets so the tile is seamless at the edges
    for (const ox of [0, -SZ, SZ]) {
      for (const oy of [0, -SZ, SZ]) {
        if ((ox !== 0 || oy !== 0) && x > 24 && x < SZ - 24 && y > 24 && y < SZ - 24) continue;
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  }
  needleMassTex.update();
  return needleMassTex;
}

/** Shared material factory for alpha-tested foliage card meshes. */
function makeCardMaterial(scene, name, texture) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = texture;
  mat.useAlphaFromDiffuseTexture = false; // alpha TEST
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  mat.emissiveColor = new Color3(0.06, 0.1, 0.04);
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
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

  // Canopy color comes from per-vertex colors (per-tree hue variation baked
  // into the single merged mesh) — the material just passes them through.
  const leafMat = new StandardMaterial('leafMat', scene);
  leafMat.diffuseColor = new Color3(1, 1, 1);
  leafMat.specularColor = new Color3(0.02, 0.02, 0.02);

  const trunkMeshes = [];
  const coneMeshes = [];
  const lobeMeshes = []; // leafy canopy volumes — INVISIBLE shadow proxies
  const cardMeshes = []; // alpha-tested leaf cards — the visible foliage
  const needleMeshes = []; // needle-cluster fringe cards on pine tiers
  let placed = 0;

  // Fir GROVES: conifers grow in single-species stands, so pines cluster
  // around a few grove centers instead of scattering randomly (random
  // placement reads fine for leafy trees, incoherent for firs).
  const pineTarget = CFG.SNOW_MODE ? CFG.TREES : Math.floor(CFG.TREES * 0.45);
  const groves = [];
  for (let tries = 0; groves.length < 3 && tries < 80; tries++) {
    const ggx = rngInt(8, CFG.GRID - 9);
    const ggz = rngInt(8, CFG.GRID - 9);
    if (!grid[ggx][ggz]) continue;
    if (Math.abs(ggx - CFG.GRID / 2) < 8 && Math.abs(ggz - CFG.GRID / 2) < 8) continue;
    const gp = g2w(ggx, ggz);
    if (getTerrainHeight(gp.x, gp.z) < CFG.WATER_Y + 0.3) continue;
    groves.push({ gx: ggx, gz: ggz });
  }
  let pinesPlaced = 0;

  for (let i = 0; i < CFG.TREES * 4 && placed < CFG.TREES; i++) {
    const wantPine = groves.length > 0 && pinesPlaced < pineTarget;
    let gx, gz;
    if (wantPine) {
      const gv = groves[rngInt(0, groves.length - 1)];
      gx = gv.gx + Math.round(rng(-4.5, 4.5));
      gz = gv.gz + Math.round(rng(-4.5, 4.5));
      if (gx < 1 || gx > CFG.GRID - 2 || gz < 1 || gz > CFG.GRID - 2) continue;
    } else {
      gx = rngInt(1, CFG.GRID - 2);
      gz = rngInt(1, CFG.GRID - 2);
    }

    if (!grid[gx][gz]) continue;
    if (isNearRoad(gx, gz, 1)) continue; // keep trees off roads and verges
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
    // Mixed forest: pines + leafy deciduous. Snow biome stays pine-only
    // (bare/snowy deciduous would need their own look).
    const leafy = !CFG.SNOW_MODE && !wantPine;
    const trunkH = leafy ? rng(1.9, 2.9) : rng(1.5, 2.1);
    const trunkRadBot = rng(0.16, 0.26);
    const trunkRadTop = trunkRadBot * rng(0.5, 0.75);
    const numCones = leafy ? rngInt(4, 6) : rngInt(5, 7); // firs: taller denser stack
    // Pines stay modest: tall scales blew the crown stack up to 3x house
    // height with metre-thick branch poles
    const s = leafy ? rng(1.3, 2.3) : rng(1.3, 2.2);
    // Firs grow STRAIGHT — lean also broke the base/upper trunk joint (the
    // two segments pivot differently, leaving a visible kink mid-trunk)
    const leanX = leafy ? rng(-0.05, 0.05) : 0;
    const leanZ = leafy ? rng(-0.05, 0.05) : 0;

    // Per-tree canopy tint — merged into one mesh via vertex colors
    const treeCol = CFG.SNOW_MODE
      ? { r: rng(0.76, 0.86), g: rng(0.80, 0.88), b: rng(0.84, 0.92) }
      : leafy
        ? { r: rng(0.20, 0.34), g: rng(0.45, 0.62), b: rng(0.12, 0.20) }
        : { r: rng(0.55, 0.75), g: rng(0.75, 0.95), b: rng(0.6, 0.8) }; // firs: brightness multiplier over the needle-mass texture

    // Trunk — create temp mesh, position/scale, bake transform for merging
    const tMesh = MeshBuilder.CreateCylinder('_trunk', {
      diameterTop: trunkRadTop * 2,
      diameterBottom: trunkRadBot * 2,
      height: trunkH,
      tessellation: 6,
    }, scene);
    tMesh.scaling = new Vector3(s, s, s);
    tMesh.rotation.set(leanX, 0, leanZ);
    tMesh.position = new Vector3(p.x, ty + trunkH / 2 * s, p.z);
    tMesh.bakeCurrentTransformIntoVertices();
    trunkMeshes.push(tMesh);

    if (leafy) {
      // Deciduous: 2-4 branches off the upper trunk + jagged ellipsoid
      // canopy lobes (same displacement technique as the bushes, scaled up)
      const jagSeed = rng(0, Math.PI * 2);
      const numBranches = rngInt(2, 4);
      const lobeSpecs = [{ ax: 0, az: 0, ay: trunkH + rng(0.5, 0.9), d: rng(1.9, 2.6) }];

      for (let j = 0; j < numBranches; j++) {
        const az = rng(0, Math.PI * 2);
        const el = rng(0.6, 1.1); // tilt from vertical
        const len = rng(0.8, 1.3);
        const attachY = trunkH * rng(0.6, 0.92);
        const dir = new Vector3(Math.sin(el) * Math.cos(az), Math.cos(el), Math.sin(el) * Math.sin(az));

        const br = MeshBuilder.CreateCylinder('_branch', {
          diameterTop: 0.05, diameterBottom: 0.1, height: len, tessellation: 5,
        }, scene);
        br.rotationQuaternion = new Quaternion();
        Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, br.rotationQuaternion);
        br.scaling.set(s, s, s);
        br.position.set(
          p.x + (leanX * attachY + dir.x * len * 0.5) * s,
          ty + (attachY + dir.y * len * 0.5) * s,
          p.z + (leanZ * attachY + dir.z * len * 0.5) * s
        );
        br.bakeCurrentTransformIntoVertices();
        trunkMeshes.push(br);

        // A lobe at each branch tip
        lobeSpecs.push({
          ax: (leanX * attachY + dir.x * len) , az: (leanZ * attachY + dir.z * len),
          ay: attachY + dir.y * len + 0.25, d: rng(1.1, 1.7),
        });
      }
      // 1-2 filler lobes to round the crown
      for (let j = 0, n = rngInt(1, 2); j < n; j++) {
        lobeSpecs.push({ ax: rng(-0.7, 0.7), az: rng(-0.7, 0.7), ay: trunkH + rng(0.2, 0.7), d: rng(1.2, 1.8) });
      }

      for (const spec of lobeSpecs) {
        const lobe = MeshBuilder.CreateSphere('_lobe', { diameter: spec.d, segments: 4 }, scene);
        const pos = lobe.getVerticesData('position');
        for (let k = 0; k < pos.length; k += 3) {
          const ang = Math.atan2(pos[k + 2], pos[k]);
          const yn = pos[k + 1] / spec.d;
          const jag = 1
            + 0.15 * Math.sin(ang * 5 + jagSeed + yn * 4)
            + 0.10 * Math.sin(ang * 8 + jagSeed * 1.7 - yn * 6);
          pos[k] *= jag;
          pos[k + 1] *= 1 + 0.08 * Math.sin(ang * 6 + jagSeed * 2.9);
          pos[k + 2] *= jag;
        }
        lobe.updateVerticesData('position', pos);

        // Lobe tint: DARK — the lobe is the canopy's shadowed interior mass;
        // the leaf cards over it carry the lit foliage look
        const vCount = pos.length / 3;
        const cols = new Float32Array(vCount * 4);
        for (let k = 0; k < vCount; k++) {
          const t2 = 0.38 + 0.3 * Math.max(0, pos[k * 3 + 1] / spec.d + 0.5) * 0.7;
          cols[k * 4] = Math.min(1, treeCol.r * t2);
          cols[k * 4 + 1] = Math.min(1, treeCol.g * t2);
          cols[k * 4 + 2] = Math.min(1, treeCol.b * t2);
          cols[k * 4 + 3] = 1;
        }
        lobe.setVerticesData('color', cols);

        lobe.scaling.set(s, s * rng(0.72, 0.88), s);
        lobe.rotation.y = rng(0, Math.PI * 2);
        const lcx = p.x + spec.ax * s + rng(-0.08, 0.08);
        const lcy = ty + spec.ay * s;
        const lcz = p.z + spec.az * s + rng(-0.08, 0.08);
        lobe.position.set(lcx, lcy, lcz);
        lobe.bakeCurrentTransformIntoVertices();
        lobeMeshes.push(lobe);

        // Leaf cards: textured alpha-tested quads scattered over the lobe
        // surface. The solid lobe stays underneath as the dark inner mass
        // and the shadow caster; cards give the soft realistic silhouette.
        // Card normals are radial (plane +Z rotated onto the surface dir),
        // so the canopy shades like one soft sphere instead of hard quads.
        // The cards ARE the canopy now (the lobe underneath is an invisible
        // shadow proxy) — dense volumetric fill, not a surface shell.
        // 50, not 70: alpha-test overdraw of a screen-filling crown is a
        // real GPU cost when standing under a tree.
        const cardN = 50;
        for (let c = 0; c < cardN; c++) {
          const card = MeshBuilder.CreatePlane('_leafCard', {
            size: spec.d * s * rng(0.46, 0.62),
          }, scene);
          const az2 = rng(0, Math.PI * 2);
          const el2 = Math.acos(rng(-0.85, 1)); // full sphere, light top bias
          const dir2 = new Vector3(
            Math.sin(el2) * Math.cos(az2), Math.cos(el2), Math.sin(el2) * Math.sin(az2));
          card.rotationQuaternion = new Quaternion();
          Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), dir2, card.rotationQuaternion);
          Quaternion.RotationAxis(dir2, rng(0, Math.PI * 2))
            .multiplyToRef(card.rotationQuaternion, card.rotationQuaternion);
          const r2 = spec.d * 0.5 * rng(0.35, 0.95) * s; // fill the volume, not just the shell
          card.position.set(
            lcx + dir2.x * r2, lcy + dir2.y * r2 * 0.8, lcz + dir2.z * r2);

          const tc = rng(0.8, 1.25);
          const cc = new Float32Array(4 * 4);
          for (let vi = 0; vi < 4; vi++) {
            cc[vi * 4] = Math.min(1, treeCol.r * tc + 0.08);
            cc[vi * 4 + 1] = Math.min(1, treeCol.g * tc + 0.08);
            cc[vi * 4 + 2] = Math.min(1, treeCol.b * tc + 0.08);
            cc[vi * 4 + 3] = 1;
          }
          card.setVerticesData('color', cc);
          card.bakeCurrentTransformIntoVertices();
          cardMeshes.push(card);
        }
      }

      treePosData.push({ x: p.x, z: p.z, ty, scale: s });
      createStaticCylinder(trunkRadBot * s, trunkH * s / 2, p.x, ty + trunkH * s / 2, p.z);
      placed++;
      continue;
    }

    // Canopy tiers — jagged lobed silhouettes + drooped edges + per-tier tint.
    // Radial jitter is a deterministic function of vertex ANGLE so the cap
    // ring and side ring (duplicated verts) displace identically — no tearing.
    const jagSeed = rng(0, Math.PI * 2);
    // Tiers chain upward with spacing < tier height so they always overlap —
    // independent per-tier offsets left gaps and detached floating tops.
    // Reference-fir proportions: the crown starts LOW (trunk mostly hidden)
    // and is wide at the base, tapering to the tip.
    let tierY = trunkH * 0.35;
    for (let j = 0; j < numCones; j++) {
      const frac = 1 - j / numCones;
      const coneR = rng(1.05, 1.35) * (0.25 + 0.75 * frac);
      const coneH = rng(0.9, 1.3);
      const coneY = tierY;
      tierY += coneH * rng(0.36, 0.46); // tight stack — denser crown
      const cMesh = MeshBuilder.CreateCylinder('_cone', {
        diameterTop: 0,
        diameterBottom: Math.max(coneR, 0.25) * 2,
        height: coneH,
        tessellation: 7,
      }, scene);

      // Jag + droop the base ring by angle
      const pos = cMesh.getVerticesData('position');
      let minY = Infinity;
      for (let k = 1; k < pos.length; k += 3) minY = Math.min(minY, pos[k]);
      const droop = coneH * rng(0.10, 0.22);
      for (let k = 0; k < pos.length; k += 3) {
        if (pos[k + 1] < minY + 0.01) {
          const x = pos[k], z = pos[k + 2];
          const r = Math.sqrt(x * x + z * z);
          if (r > 0.01) {
            const ang = Math.atan2(z, x);
            const jag = 1 + 0.17 * (Math.sin(ang * 3 + jagSeed) + Math.sin(ang * 5 + jagSeed * 1.7));
            pos[k] = x * jag;
            pos[k + 2] = z * jag;
            pos[k + 1] -= droop * (0.5 + 0.5 * Math.sin(ang * 4 + jagSeed * 2.3));
          }
        }
      }
      cMesh.updateVerticesData('position', pos);

      // Tier tint: darker at the bottom, brighter toward the tip
      const shade = 0.72 + 0.38 * (j / Math.max(1, numCones - 1));
      const vCount = pos.length / 3;
      const cols = new Float32Array(vCount * 4);
      for (let k = 0; k < vCount; k++) {
        cols[k * 4] = Math.min(1, treeCol.r * shade + 0.03);
        cols[k * 4 + 1] = Math.min(1, treeCol.g * shade + 0.03);
        cols[k * 4 + 2] = Math.min(1, treeCol.b * shade + 0.03);
        cols[k * 4 + 3] = 1;
      }
      cMesh.setVerticesData('color', cols);

      cMesh.scaling = new Vector3(s, s, s);
      cMesh.rotation.y = rng(0, Math.PI * 2); // break aligned tier silhouettes
      cMesh.position = new Vector3(
        p.x + leanX * coneY * s + rng(-0.06, 0.06) * s,
        ty + coneY * s,
        p.z + leanZ * coneY * s + rng(-0.06, 0.06) * s
      );
      cMesh.bakeCurrentTransformIntoVertices();
      coneMeshes.push(cMesh);

      // Branch whorl with needle sprays ON the branches: fir foliage grows
      // from branches in horizontal sprays pointing away from the trunk —
      // free-floating randomly-oriented cards read as debris in the air.
      for (let b2 = 0; b2 < 5; b2++) {
        const ab = rng(0, Math.PI * 2);
        const blen = Math.min(Math.max(coneR, 0.3) * rng(0.6, 0.85), 0.85);
        const branch = MeshBuilder.CreateCylinder('_pineBranch', {
          diameterTop: 0.025, diameterBottom: 0.055, height: blen, tessellation: 4,
        }, scene);
        const dirB = new Vector3(Math.cos(ab) * 0.96, -0.22, Math.sin(ab) * 0.96).normalize();
        branch.rotationQuaternion = new Quaternion();
        Quaternion.FromUnitVectorsToRef(Vector3.Up(), dirB, branch.rotationQuaternion);
        branch.scaling.set(s, s, s);
        const bBaseY = ty + (coneY - coneH * 0.3) * s;
        branch.position.set(
          p.x + leanX * coneY * s + dirB.x * blen * 0.5 * s,
          bBaseY,
          p.z + leanZ * coneY * s + dirB.z * blen * 0.5 * s
        );
        branch.bakeCurrentTransformIntoVertices();
        trunkMeshes.push(branch);

        // 3 sprays per branch, lying nearly flat, texture +X rolled to point
        // outward along the branch (the spray texture is directional)
        const outX = Math.cos(ab), outZ = Math.sin(ab);
        for (let c2 = 0; c2 < 3; c2++) {
          const f2 = c2 === 0 ? rng(0.3, 0.55) : c2 === 1 ? rng(0.6, 0.85) : rng(0.9, 1.1);
          const card = MeshBuilder.CreatePlane('_needleCard', {
            size: blen * s * rng(1.1, 1.45),
          }, scene);
          // card basis: normal mostly up with outward droop tilt
          const n2 = new Vector3(outX * rng(0.1, 0.35), 1, outZ * rng(0.1, 0.35)).normalize();
          let bx = new Vector3(outX, 0, outZ);
          bx = bx.subtract(n2.scale(Vector3.Dot(bx, n2))).normalize();
          const by = Vector3.Cross(n2, bx);
          card.rotationQuaternion = Quaternion.RotationQuaternionFromAxis(bx, by, n2);
          card.position.set(
            p.x + leanX * coneY * s + dirB.x * blen * f2 * s + outX * blen * 0.35 * s,
            bBaseY + dirB.y * blen * f2 * s - rng(0, 0.06) * s,
            p.z + leanZ * coneY * s + dirB.z * blen * f2 * s + outZ * blen * 0.35 * s
          );
          const tcn = rng(0.85, 1.2);
          const ccn = new Float32Array(4 * 4);
          for (let vi = 0; vi < 4; vi++) {
            ccn[vi * 4] = Math.min(1, treeCol.r * tcn + 0.05);
            ccn[vi * 4 + 1] = Math.min(1, treeCol.g * tcn + 0.05);
            ccn[vi * 4 + 2] = Math.min(1, treeCol.b * tcn + 0.05);
            ccn[vi * 4 + 3] = 1;
          }
          card.setVerticesData('color', ccn);
          card.bakeCurrentTransformIntoVertices();
          needleMeshes.push(card);
        }
      }
    }

    // Upper trunk: the base trunk ends at trunkH but the needle crown stacks
    // well past it — without this the top of the pine floats on nothing
    const pineTopY = tierY;
    if (pineTopY > trunkH + 0.3) {
      const upperH = pineTopY - trunkH;
      const upper = MeshBuilder.CreateCylinder('_trunkUpper', {
        diameterTop: 0.05, diameterBottom: trunkRadTop * 2, height: upperH, tessellation: 6,
      }, scene);
      upper.scaling.set(s, s, s);
      upper.rotation.set(leanX, 0, leanZ);
      upper.position.set(
        p.x + leanX * (trunkH + upperH / 2) * s,
        ty + (trunkH + upperH / 2) * s,
        p.z + leanZ * (trunkH + upperH / 2) * s
      );
      upper.bakeCurrentTransformIntoVertices();
      trunkMeshes.push(upper);
    }

    treePosData.push({ x: p.x, z: p.z, ty, scale: s });
    createStaticCylinder(trunkRadBot * s, trunkH * s / 2, p.x, ty + trunkH * s / 2, p.z);
    placed++;
    if (!leafy) pinesPlaced++;
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
    merged.isPickable = false; // interactions are physics-based; camera raycasts pay per triangle
    // Needle-mass texture unifies the crown with the sprays — smooth
    // vertex-colored cones read as plastic blobs next to needle detail
    const pineMat = new StandardMaterial('pineCrownMat', scene);
    pineMat.diffuseTexture = getNeedleMassTexture(scene);
    pineMat.diffuseTexture.uScale = 3;
    pineMat.diffuseTexture.vScale = 3;
    pineMat.diffuseColor = new Color3(1, 1, 1); // vertex colors carry per-tree tint
    pineMat.specularColor = new Color3(0.01, 0.01, 0.01);
    merged.material = pineMat;
    merged.convertToFlatShadedMesh();
    // VISIBLE (v5): a real fir is a dense solid cone of foliage — the
    // needle sprays alone read as sparse whorls on a bare pole. The jagged
    // tier cones are the crown body; sprays add silhouette detail over it.
    addShadowCaster(merged);
    enableShadowReceiving(merged);
  }

  // Leafy canopy volumes: INVISIBLE shadow proxies. Hidden from every camera
  // via layerMask (shadow maps ignore camera layer masks — same trick that
  // hides the 1st-person player model while keeping its shadow), so the
  // canopy still casts believable blob shadows while only cards are seen.
  if (lobeMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(lobeMeshes, true, true, undefined, false, true);
    merged.name = 'mergedCanopyCore';
    merged.isPickable = false; // invisible shadow proxy — never raycast it
    merged.material = leafMat;
    merged.convertToFlatShadedMesh();
    merged.layerMask = 0x40000000; // proxy-only bit: NEVER in any camera mask (0x20000000 is the 3rd-person player-model bit)
    addShadowCaster(merged);
    merged.freezeWorldMatrix();
  }

  // Merge all leaf cards into 1 alpha-tested draw call. Cards do NOT cast
  // shadows — untested alpha would shadow as solid quads; the lobes cast.
  if (cardMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(cardMeshes, true, true, undefined, false, true);
    merged.name = 'mergedLeafCards';
    // ~40k alpha-tested triangles — letting the camera-collision raycasts
    // test these cost ~30ms/frame (the 50 -> 23 FPS regression)
    merged.isPickable = false;
    merged.material = makeCardMaterial(scene, 'leafCardMat', getLeafCardTexture(scene));
    merged.freezeWorldMatrix();
    // MUST write fog depth: without it the volumetric fog samples the SKY
    // behind the cards and fogs entire crowns into translucent ghosts (the
    // old opaque lobes used to provide this depth before they went hidden)
    addFogDepthMesh(merged);
  }

  // Pine needle fringe cards — same treatment, needle texture
  if (needleMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(needleMeshes, true, true, undefined, false, true);
    merged.name = 'mergedNeedleCards';
    merged.isPickable = false;
    merged.material = makeCardMaterial(scene, 'needleCardMat', getNeedleCardTexture(scene));
    merged.freezeWorldMatrix();
    addFogDepthMesh(merged);
  }
}

/**
 * Low-poly bushes — 1-3 squashed jagged spheres per bush, per-bush hue via
 * vertex colors, all merged into a single flat-shaded mesh (1 draw call).
 * Bushes don't block the grid or have physics — the player walks through.
 */
export function placeBushes(scene) {
  const grid = getGrid();
  const buildings = getBuildings();
  const blobMeshes = [];
  const bushCardMeshes = []; // leaf cards over the dark cores
  const twigMeshes = []; // bark twigs fanning out of the ground
  let placed = 0;

  for (let i = 0; i < CFG.BUSHES * 3 && placed < CFG.BUSHES; i++) {
    const gx = rngInt(1, CFG.GRID - 2);
    const gz = rngInt(1, CFG.GRID - 2);
    if (!grid[gx][gz]) continue;
    if (isNearRoad(gx, gz, 1)) continue; // clear of the road and its curved verges
    if (Math.abs(gx - CFG.GRID / 2) < 4 && Math.abs(gz - CFG.GRID / 2) < 4) continue;

    let inside = false;
    for (const b of buildings) {
      if (gx >= b.x - 1 && gx < b.x + b.w + 1 && gz >= b.z - 1 && gz < b.z + b.h + 1) {
        inside = true;
        break;
      }
    }
    if (inside) continue;

    const p = g2w(gx, gz);
    if (getTerrainHeight(p.x, p.z) < CFG.WATER_Y + 0.2) continue;

    const bushCol = CFG.SNOW_MODE
      ? { r: rng(0.72, 0.84), g: rng(0.78, 0.88), b: rng(0.82, 0.92) }
      : { r: rng(0.12, 0.24), g: rng(0.35, 0.55), b: rng(0.10, 0.22) };
    const numBlobs = rngInt(3, 5);
    const jagSeed = rng(0, Math.PI * 2);

    for (let j = 0; j < numBlobs; j++) {
      const d = rng(0.45, 0.85);
      const blob = MeshBuilder.CreateSphere('_bush', { diameter: d, segments: 4 }, scene);

      // Leafy lobes: multi-frequency radial displacement. Deterministic in
      // (angle, y) with INTEGER angular frequencies so the duplicated seam
      // ring (ang = ±PI) displaces identically — no tearing. A single low
      // frequency here reads as a faceted rock, not foliage.
      const pos = blob.getVerticesData('position');
      for (let k = 0; k < pos.length; k += 3) {
        const ang = Math.atan2(pos[k + 2], pos[k]);
        const yn = pos[k + 1] / d;
        const jag = 1
          + 0.16 * Math.sin(ang * 5 + jagSeed + yn * 4)
          + 0.11 * Math.sin(ang * 9 + jagSeed * 1.7 - yn * 7)
          + 0.07 * Math.sin(ang * 3 - jagSeed * 2.3 + yn * 11);
        pos[k] *= jag;
        pos[k + 1] *= 1 + 0.10 * Math.sin(ang * 7 + jagSeed * 3.1);
        pos[k + 2] *= jag;
      }
      blob.updateVerticesData('position', pos);

      // Dark core — the leaf cards over it carry the lit foliage surface
      const vCount = pos.length / 3;
      const cols = new Float32Array(vCount * 4);
      for (let k = 0; k < vCount; k++) {
        const t = (0.75 + 0.5 * Math.max(0, pos[k * 3 + 1] / d)) * 0.55;
        cols[k * 4] = Math.min(1, bushCol.r * t);
        cols[k * 4 + 1] = Math.min(1, bushCol.g * t);
        cols[k * 4 + 2] = Math.min(1, bushCol.b * t);
        cols[k * 4 + 3] = 1;
      }
      blob.setVerticesData('color', cols);

      const bx = p.x + (j === 0 ? 0 : rng(-0.45, 0.45));
      const bz = p.z + (j === 0 ? 0 : rng(-0.45, 0.45));
      const by = getTerrainHeight(bx, bz);
      blob.scaling.set(1, rng(0.6, 0.8), 1); // squash into a shrub
      blob.rotation.y = rng(0, Math.PI * 2);
      blob.position.set(bx, by + d * rng(0.2, 0.38), bz);
      blob.bakeCurrentTransformIntoVertices();
      blobMeshes.push(blob);
    }

    // Twigs: thin bark branches fanning up-and-out of the ground — a bush is
    // a cluster of woody stems, not a floating ball of leaves
    const bushY = getTerrainHeight(p.x, p.z);
    for (let t2 = 0, nT = rngInt(3, 5); t2 < nT; t2++) {
      const at = rng(0, Math.PI * 2);
      const tl = rng(0.5, 0.85);
      const twig = MeshBuilder.CreateCylinder('_bushTwig', {
        diameterTop: 0.02, diameterBottom: 0.05, height: tl, tessellation: 4,
      }, scene);
      const dirT = new Vector3(Math.cos(at) * rng(0.3, 0.6), 1, Math.sin(at) * rng(0.3, 0.6)).normalize();
      twig.rotationQuaternion = new Quaternion();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dirT, twig.rotationQuaternion);
      twig.position.set(
        p.x + rng(-0.15, 0.15) + dirT.x * tl * 0.5,
        bushY + dirT.y * tl * 0.5,
        p.z + rng(-0.15, 0.15) + dirT.z * tl * 0.5
      );
      twig.bakeCurrentTransformIntoVertices();
      twigMeshes.push(twig);
    }
    for (let c = 0; c < 16; c++) {
      const card = MeshBuilder.CreatePlane('_bushCard', { size: rng(0.6, 0.95) }, scene);
      const az2 = rng(0, Math.PI * 2);
      const el2 = Math.acos(rng(-0.3, 1)); // upper-biased
      const dir2 = new Vector3(
        Math.sin(el2) * Math.cos(az2), Math.cos(el2), Math.sin(el2) * Math.sin(az2));
      card.rotationQuaternion = new Quaternion();
      Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), dir2, card.rotationQuaternion);
      Quaternion.RotationAxis(dir2, rng(0, Math.PI * 2))
        .multiplyToRef(card.rotationQuaternion, card.rotationQuaternion);
      const rr = rng(0.15, 0.65);
      card.position.set(
        p.x + dir2.x * rr, bushY + 0.3 + dir2.y * rr * 0.55, p.z + dir2.z * rr);
      const tc = rng(0.9, 1.4);
      const cc = new Float32Array(4 * 4);
      for (let vi = 0; vi < 4; vi++) {
        cc[vi * 4] = Math.min(1, bushCol.r * tc + 0.06);
        cc[vi * 4 + 1] = Math.min(1, bushCol.g * tc + 0.06);
        cc[vi * 4 + 2] = Math.min(1, bushCol.b * tc + 0.06);
        cc[vi * 4 + 3] = 1;
      }
      card.setVerticesData('color', cc);
      card.bakeCurrentTransformIntoVertices();
      bushCardMeshes.push(card);
    }
    placed++;
  }

  if (bushCardMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(bushCardMeshes, true, true, undefined, false, true);
    merged.name = 'mergedBushCards';
    merged.isPickable = false;
    merged.material = makeCardMaterial(scene, 'bushCardMat', getLeafCardTexture(scene));
    merged.freezeWorldMatrix();
    addFogDepthMesh(merged);
  }

  if (twigMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(twigMeshes, true, true, undefined, false, true);
    merged.name = 'mergedBushTwigs';
    merged.isPickable = false;
    const twigMat = new StandardMaterial('bushTwigMat', scene);
    twigMat.diffuseTexture = getBarkTexture(scene);
    twigMat.specularColor = new Color3(0.02, 0.02, 0.02);
    merged.material = twigMat;
    merged.freezeWorldMatrix();
  }

  if (blobMeshes.length > 0) {
    const merged = Mesh.MergeMeshes(blobMeshes, true, true, undefined, false, true);
    merged.name = 'mergedBushes';
    merged.isPickable = false; // camera scene-raycasts pay per TRIANGLE
    const bushMat = new StandardMaterial('bushMat', scene);
    bushMat.diffuseColor = new Color3(1, 1, 1); // vertex colors carry the hue
    bushMat.specularColor = new Color3(0.02, 0.02, 0.02);
    merged.material = bushMat;
    merged.convertToFlatShadedMesh();
    // Hidden shadow proxy — the bush cards are the visible foliage
    merged.layerMask = 0x40000000; // proxy-only bit: NEVER in any camera mask (0x20000000 is the 3rd-person player-model bit)
    addShadowCaster(merged);
    merged.freezeWorldMatrix();
  }
}

/**
 * Grass tufts — a single 5-blade fan mesh drawn thousands of times via thin
 * instances (1 draw call total). Clumped into meadows by a smooth sine field
 * so coverage reads as patches instead of uniform noise. No physics, no
 * shadow casting; normals point up so blades shade like the ground.
 */
export function placeGrass(scene) {
  if (CFG.SNOW_MODE) return; // buried under snow

  // Template: 5 outward-leaning triangular blades
  const BLADES = 5;
  const positions = [];
  const indices = [];
  const normals = [];
  const colors = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2;
    const lean = 0.16;
    const bx = Math.cos(a), bz = Math.sin(a);
    const base = positions.length / 3;
    // two base verts + one tip, leaning outward
    positions.push(
      bx * 0.05 - bz * 0.045, 0, bz * 0.05 + bx * 0.045,
      bx * 0.05 + bz * 0.045, 0, bz * 0.05 - bx * 0.045,
      bx * lean, 0.32, bz * lean
    );
    // up normals: blades take the ground's lighting, no dark backfaces
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    // dark base -> light tip (multiplied by per-instance color)
    colors.push(0.55, 0.6, 0.45, 1, 0.55, 0.6, 0.45, 1, 0.95, 0.92, 0.7, 1);
    indices.push(base, base + 1, base + 2);
  }
  const tuft = new Mesh('grassTufts', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.applyToMesh(tuft);

  const mat = new StandardMaterial('grassTuftMat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  tuft.material = mat;

  const grid = getGrid();
  const buildings = getBuildings();
  const matrices = [];
  const instColors = [];
  const m = new Matrix();
  const q = Quaternion.Identity();
  const scl = new Vector3();
  const pos = new Vector3();

  // Building footprints as a lookup — interior floor cells are WALKABLE in
  // the grid, so grid[x][z] alone lets grass grow through the floor slabs
  const inBuilding = (gx, gz) => {
    for (const b of buildings) {
      if (gx >= b.x && gx < b.x + b.w && gz >= b.z && gz < b.z + b.h) return true;
    }
    return false;
  };

  for (let gx = 1; gx < CFG.GRID - 1; gx++) {
    for (let gz = 1; gz < CFG.GRID - 1; gz++) {
      if (!grid[gx][gz]) continue;
      if (inBuilding(gx, gz)) continue;
      if (isRoadCell(gx, gz)) continue; // packed dirt — no grass tufts
      // Meadow clumps: smooth patch field + per-cell thinning
      const clump = 0.5 + 0.5 * Math.sin(gx * 0.31 + 1.7) * Math.sin(gz * 0.27 + 4.2);
      if (clump < 0.4) continue;
      const p = g2w(gx, gz);
      const tufts = clump > 0.75 ? 3 : 2;
      for (let t = 0; t < tufts; t++) {
        const wx = p.x + rng(-0.9, 0.9);
        const wz = p.z + rng(-0.9, 0.9);
        const wy = getTerrainHeight(wx, wz);
        if (wy < CFG.WATER_Y + 0.15) continue;
        const s = rng(0.7, 1.5);
        scl.set(s, s * rng(0.8, 1.3), s);
        Quaternion.RotationYawPitchRollToRef(rng(0, Math.PI * 2), 0, 0, q);
        pos.set(wx, wy - 0.01, wz);
        Matrix.ComposeToRef(scl, q, pos, m);
        const base = matrices.length;
        matrices.length += 16;
        m.copyToArray(matrices, base);
        // per-tuft hue: earthy olive-green keyed to the clump field —
        // vivid greens read as plastic against the muted ground texture
        const g = rng(0.42, 0.6) * (0.85 + clump * 0.2);
        instColors.push(rng(0.26, 0.36), g, rng(0.12, 0.2), 1);
      }
    }
  }

  if (matrices.length === 0) { tuft.dispose(); return; }
  tuft.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16, true);
  tuft.thinInstanceSetBuffer('color', new Float32Array(instColors), 4, true);
  tuft.alwaysSelectAsActiveMesh = true; // one draw call — skip culling math
  tuft.isPickable = false;
  // No shadow receive: invisible at tuft scale, and shadow-sampling 100k+
  // grass vertices' pixels costs real GPU time
  tuft.freezeWorldMatrix();
  console.log(`[GRASS] ${instColors.length / 4} tufts (1 draw call)`);
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
    // Full-cell margin: boulders reach ~1.5u past their cell and the
    // smoothed road ribbon cuts corners across neighboring cells
    if (isNearRoad(gx, gz, 1)) continue;
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
