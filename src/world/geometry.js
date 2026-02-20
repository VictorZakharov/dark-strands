import * as THREE from 'three';
import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell, isTreeCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';
import { createStaticBox } from '../core/physics.js';

const loader = new THREE.TextureLoader();

function loadTex(path, repeatX, repeatY) {
  const tex = loader.load(path);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function getBuildingCenter(b) {
  const p1 = g2w(b.x, b.z);
  const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
  return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

export function buildGround(scene) {
  const size = CFG.GRID * CFG.CELL + 20;
  const segments = 128;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);

  // Displace vertices for terrain elevation
  const positions = geo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const lx = positions.getX(i);
    const ly = positions.getY(i);
    // After -PI/2 rotation: world X = lx, world Z = -ly
    const h = getTerrainHeight(lx, -ly);
    positions.setZ(i, h);
  }
  positions.needsUpdate = true;
  geo.computeVertexNormals();

  let mat;
  if (CFG.SNOW_MODE) {
    mat = new THREE.MeshStandardMaterial({ color: 0xdde4e8, roughness: 0.85 });
  } else {
    const grassTex = loadTex('./assets/textures/grass.jpg', size / 4, size / 4);
    mat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.userData.isGround = true;
  scene.add(mesh);
}

export function buildFloors(scene) {
  const woodTex = loadTex('./assets/textures/wood_planks.jpg', 3, 3);
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    roughness: 0.75,
    side: THREE.DoubleSide,
  });

  const stairWoodTex = loadTex('./assets/textures/wood_planks.jpg', 1, 2);
  const stairMat = new THREE.MeshStandardMaterial({
    map: stairWoodTex,
    roughness: 0.75,
  });

  const stoneTex = loadTex('./assets/textures/stone_wall.jpg', 4, 4);
  const midFloorMat = new THREE.MeshStandardMaterial({
    map: stoneTex,
    roughness: 0.85,
  });

  for (const b of getBuildings()) {
    const c = getBuildingCenter(b);

    // Ground floor — inset slightly inside walls to avoid z-fighting at edges
    const fw = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
    const fh = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
    const GROUND_SLAB = 0.6;
    const fg = new THREE.BoxGeometry(fw, GROUND_SLAB, fh);
    const fm = new THREE.Mesh(fg, floorMat);
    fm.position.set(c.x, 0.02 - GROUND_SLAB / 2, c.z);
    fm.receiveShadow = true;
    scene.add(fm);

    // Mid-level floor for 2-story buildings (with stairwell gap)
    const FLOOR_THICK = 0.5;
    const FLOOR_TOP_OFFSET = -0.125; // shift down so top surface stays at original visual position
    if (b.stories === 2 && b.stair) {
      const s = b.stair;
      const stairP = g2w(s.gx, s.gzStart);

      // Extend floor into walls for seamless coverage
      const intLeft = g2w(b.x, 0).x;
      const intRight = g2w(b.x + b.w - 1, 0).x;
      const intBack = g2w(0, b.z).z;
      const intFront = g2w(0, b.z + b.h - 1).z;

      const stairLeft = stairP.x - CFG.CELL / 2;
      const stairRight = stairP.x + CFG.CELL / 2;
      const stairFront = g2w(0, s.gzEnd).z + CFG.CELL / 2;

      const floorY = CFG.WALL_H;

      // Piece 1: left of stairwell, full depth
      const p1w = stairLeft - intLeft;
      const p1d = intFront - intBack;
      if (p1w > 0.1 && p1d > 0.1) {
        const geo = new THREE.BoxGeometry(p1w, FLOOR_THICK, p1d);
        const mesh = new THREE.Mesh(geo, floorMat);
        mesh.position.set(intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }

      // Piece 2: above stairwell (front of stair to front of interior)
      const p2w = stairRight - stairLeft;
      const p2d = intFront - stairFront;
      if (p2w > 0.1 && p2d > 0.1) {
        const geo = new THREE.BoxGeometry(p2w, FLOOR_THICK, p2d);
        const mesh = new THREE.Mesh(geo, floorMat);
        mesh.position.set(stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }

      // Piece 3: right of stairwell, full depth
      const p3w = intRight - stairRight;
      const p3d = intFront - intBack;
      if (p3w > 0.1 && p3d > 0.1) {
        const geo = new THREE.BoxGeometry(p3w, FLOOR_THICK, p3d);
        const mesh = new THREE.Mesh(geo, floorMat);
        mesh.position.set(stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }

      // Piece 4: behind stairwell (north of first stair cell), stair column width
      const stairBack = stairP.z - CFG.CELL / 2;
      const p4d = stairBack - intBack;
      if (p2w > 0.1 && p4d > 0.1) {
        const geo = new THREE.BoxGeometry(p2w, FLOOR_THICK, p4d);
        const mesh = new THREE.Mesh(geo, floorMat);
        mesh.position.set(stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }

      buildStairSteps(scene, b, stairMat);
    } else if (b.stories === 2) {
      // Full floor, no stairwell — inset slightly inside walls
      const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
      const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
      const mg = new THREE.BoxGeometry(fullW, FLOOR_THICK, fullH);
      const mm = new THREE.Mesh(mg, floorMat);
      mm.position.set(c.x, CFG.WALL_H - 0.125, c.z);
      mm.castShadow = true;
      mm.receiveShadow = true;
      scene.add(mm);
    }
  }
}

function buildStairSteps(scene, b, mat) {
  const s = b.stair;
  const stairP1 = g2w(s.gx, s.gzStart);
  const stairP2 = g2w(s.gx, s.gzEnd);

  const stairWidth = CFG.CELL * 0.95;
  // Flush against the right wall (shift right so right edge meets wall inner face)
  const stairX = stairP1.x + (CFG.CELL - stairWidth) / 2;
  const zMin = stairP1.z - CFG.CELL / 2;
  const zMax = stairP2.z + CFG.CELL / 2;
  const totalDepth = zMax - zMin;

  const numSteps = 8;
  const stepH = CFG.WALL_H / numSteps;
  const stepD = totalDepth / numSteps;

  for (let i = 0; i < numSteps; i++) {
    const h = (i + 1) * stepH;
    const geo = new THREE.BoxGeometry(stairWidth, h, stepD);
    const step = new THREE.Mesh(geo, mat);
    step.position.set(stairX, h / 2, zMax - (i + 0.5) * stepD);
    step.castShadow = true;
    step.receiveShadow = true;
    scene.add(step);
  }
}

export function buildWalls(scene) {
  const grid = getGrid();
  const buildings = getBuildings();

  const wallTex = loadTex('./assets/textures/stone_wall.jpg', 1, 1);

  const wallH = [];
  for (let x = 0; x < CFG.GRID; x++) {
    wallH[x] = new Array(CFG.GRID).fill(CFG.WALL_H);
  }

  for (const b of buildings) {
    const h = b.stories * CFG.WALL_H;
    for (let gx = b.x; gx < b.x + b.w; gx++) {
      wallH[gx][b.z] = h;
      wallH[gx][b.z + b.h - 1] = h;
    }
    for (let gz = b.z; gz < b.z + b.h; gz++) {
      wallH[b.x][gz] = h;
      wallH[b.x + b.w - 1][gz] = h;
    }
  }

  // Count regular walls (excluding door and window cells)
  let count = 0;
  for (let x = 0; x < CFG.GRID; x++) {
    for (let z = 0; z < CFG.GRID; z++) {
      if (!grid[x][z] && !isDoorCell(x, z) && !isWindowCell(x, z) && !isStairCell(x, z)) count++;
    }
  }

  // Add wall blocks above doors: 1 above-door block per door + 1 extra for 2-story
  for (const b of buildings) {
    count += b.doors.length; // gap above door on ground floor
    if (b.stories === 2) count += b.doors.length; // full wall on 2nd floor
  }

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.9,
  });

  // World-space triplanar UVs so texture tiles uniformly regardless of wall dimensions
  wallMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      {
        vec4 wp = instanceMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(instanceMatrix) * normal);
        vec3 an = abs(wn);
        float ts = 0.5;
        if (an.y >= an.x && an.y >= an.z) {
          vMapUv = wp.xz * ts;
        } else if (an.x >= an.z) {
          vMapUv = wp.zy * ts;
        } else {
          vMapUv = wp.xy * ts;
        }
      }
      `
    );
  };

  const walls = new THREE.InstancedMesh(wallGeo, wallMat, count);
  walls.castShadow = true;
  walls.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let idx = 0;

  // Helper: is cell a thin post? (corner, outer corner, or isolated — not a straight wall)
  function isThinPost(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= CFG.GRID || gz >= CFG.GRID) return false;
    if (grid[gx][gz] || isDoorCell(gx, gz) || isWindowCell(gx, gz) || isStairCell(gx, gz)) return false;
    const oN = gz > 0 && grid[gx][gz - 1];
    const oS = gz < CFG.GRID - 1 && grid[gx][gz + 1];
    const oW = gx > 0 && grid[gx - 1][gz];
    const oE = gx < CFG.GRID - 1 && grid[gx + 1][gz];
    const facesNS = oN || oS;
    const facesEW = oW || oE;
    // Thin if faces both directions (inner corner) or neither (outer corner / isolated)
    return (facesNS && facesEW) || (!facesNS && !facesEW);
  }

  const ext = (CFG.CELL - CFG.WALL_T) / 2; // how far to extend toward a thin post

  for (let x = 0; x < CFG.GRID; x++) {
    for (let z = 0; z < CFG.GRID; z++) {
      if (!grid[x][z] && !isDoorCell(x, z) && !isWindowCell(x, z) && !isStairCell(x, z)) {
        const p = g2w(x, z);
        const h = wallH[x][z];

        // Determine wall orientation from neighbors
        const openN = z > 0 && grid[x][z - 1];
        const openS = z < CFG.GRID - 1 && grid[x][z + 1];
        const openW = x > 0 && grid[x - 1][z];
        const openE = x < CFG.GRID - 1 && grid[x + 1][z];
        const facesNS = openN || openS;
        const facesEW = openW || openE;

        let sx, sz, px = p.x, pz = p.z;
        if (facesNS && !facesEW) {
          sx = CFG.CELL; sz = CFG.WALL_T;
          // Extend toward thin posts (corners / outer corners) in X direction
          const extW = isThinPost(x - 1, z) ? ext : 0;
          const extE = isThinPost(x + 1, z) ? ext : 0;
          sx += extW + extE;
          px += (extE - extW) / 2;
        } else if (facesEW && !facesNS) {
          sx = CFG.WALL_T; sz = CFG.CELL;
          // Extend toward thin posts in Z direction
          const extN = isThinPost(x, z - 1) ? ext : 0;
          const extS = isThinPost(x, z + 1) ? ext : 0;
          sz += extN + extS;
          pz += (extS - extN) / 2;
        } else {
          // Corner (both) or outer corner / isolated (neither) — thin post
          // Extend toward any adjacent non-walkable cell (wall, door, window, etc.)
          sx = CFG.WALL_T; sz = CFG.WALL_T;
          const wallW = x > 0 && !grid[x - 1][z] ? ext : 0;
          const wallE = x < CFG.GRID - 1 && !grid[x + 1][z] ? ext : 0;
          const wallN = z > 0 && !grid[x][z - 1] ? ext : 0;
          const wallS = z < CFG.GRID - 1 && !grid[x][z + 1] ? ext : 0;
          sx += wallW + wallE;
          sz += wallN + wallS;
          px += (wallE - wallW) / 2;
          pz += (wallS - wallN) / 2;
        }

        // Ignore terrain (buildings on flat zones ≈ 0); fixed baseline seals all gaps
        const bottom = -0.5;
        const totalH = h - bottom;
        dummy.position.set(px, bottom + totalH / 2, pz);
        dummy.scale.set(sx, totalH, sz);
        dummy.updateMatrix();
        walls.setMatrixAt(idx++, dummy.matrix);
      }
    }
  }

  // Wall blocks above doors (fills gap between door top and ceiling/roof)
  const doorTopY = CFG.WALL_H * 0.88;
  for (const b of buildings) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const isNS = d.wall === 'south' || d.wall === 'north';
      const sx = isNS ? CFG.CELL : CFG.WALL_T;
      const sz = isNS ? CFG.WALL_T : CFG.CELL;

      // Gap above door on ground floor
      const gapH = CFG.WALL_H - doorTopY;
      if (gapH > 0.01) {
        dummy.position.set(p.x, doorTopY + gapH / 2, p.z);
        dummy.scale.set(sx, gapH, sz);
        dummy.updateMatrix();
        walls.setMatrixAt(idx++, dummy.matrix);
      }

      // Full wall above door on 2nd floor (for 2-story buildings)
      if (b.stories === 2) {
        dummy.position.set(p.x, CFG.WALL_H + CFG.WALL_H / 2, p.z);
        dummy.scale.set(sx, CFG.WALL_H, sz);
        dummy.updateMatrix();
        walls.setMatrixAt(idx++, dummy.matrix);
      }
    }
  }

  scene.add(walls);
}

// Window registry for breakable glass — keyed by "gx,gz"
const windowPanes = new Map();

/** Try to break a window at cell (gx,gz) at world position (wx,wz,wy). Returns true if glass broke. */
export function tryBreakWindow(gx, gz, wx, wz, wy) {
  const key = `${gx},${gz}`;
  const wins = windowPanes.get(key);
  if (!wins) return false;
  const p = g2w(gx, gz);
  for (const w of wins) {
    if (w.broken) continue;
    const baseY = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
    const winH = CFG.WALL_H * w.hFrac;
    const winW = CFG.CELL * w.wFrac;
    if (wy < baseY - winH / 2 || wy > baseY + winH / 2) continue;
    const isNS = w.wall === 'south' || w.wall === 'north';
    if (isNS) { if (Math.abs(wx - p.x) > winW / 2) continue; }
    else { if (Math.abs(wz - p.z) > winW / 2) continue; }
    w.broken = true;
    if (w.pane.parent) w.pane.parent.remove(w.pane);
    w.pane.geometry.dispose();
    return true;
  }
  return false;
}

/** Check if a broken window at cell (gx,gz) allows pass-through at world position wy. */
export function isWindowBrokenAt(gx, gz, wx, wz, wy) {
  const key = `${gx},${gz}`;
  const wins = windowPanes.get(key);
  if (!wins) return false;
  const p = g2w(gx, gz);
  for (const w of wins) {
    if (!w.broken) continue;
    const baseY = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
    const winH = CFG.WALL_H * w.hFrac;
    const winW = CFG.CELL * w.wFrac;
    if (wy < baseY - winH / 2 || wy > baseY + winH / 2) continue;
    const isNS = w.wall === 'south' || w.wall === 'north';
    if (isNS) { if (Math.abs(wx - p.x) > winW / 2) continue; }
    else { if (Math.abs(wz - p.z) > winW / 2) continue; }
    return true;
  }
  return false;
}

/** Check if a position is within any window opening at cell (gx,gz). Used by torch placement.
 *  When wx,wz are provided, also checks horizontal bounds with uniform margin. */
export function isInsideWindowOpening(gx, gz, wy, wx, wz) {
  const key = `${gx},${gz}`;
  const wins = windowPanes.get(key);
  if (!wins) return false;
  const p = g2w(gx, gz);
  const margin = 0.15;
  for (const w of wins) {
    const baseY = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
    const winH = CFG.WALL_H * w.hFrac;
    if (wy < baseY - winH / 2 - margin || wy > baseY + winH / 2 + margin) continue;
    // Horizontal check (if wx/wz provided)
    if (wx !== undefined) {
      const winW = CFG.CELL * w.wFrac;
      const isNS = w.wall === 'south' || w.wall === 'north';
      const hPos = isNS ? (wx - p.x) : (wz - p.z);
      if (Math.abs(hPos) > winW / 2 + margin) continue;
    }
    return true;
  }
  return false;
}

export function buildWindows(scene) {
  const wallTex = loadTex('./assets/textures/stone_wall.jpg', 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.9,
  });

  // World-space triplanar UVs for window wall segments
  wallMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 wn = normalize(mat3(modelMatrix) * normal);
        vec3 an = abs(wn);
        float ts = 0.5;
        if (an.y >= an.x && an.y >= an.z) {
          vMapUv = wp.xz * ts;
        } else if (an.x >= an.z) {
          vMapUv = wp.zy * ts;
        } else {
          vMapUv = wp.xy * ts;
        }
      }
      `
    );
  };

  // Wooden frame material (bark texture, same as doors)
  const frameTex = loadTex('./assets/textures/bark.jpg', 2, 2);
  const frameMat = new THREE.MeshStandardMaterial({
    map: frameTex,
    color: 0x8b5a2b,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const FRAME_T = 0.07;  // frame bar cross-section thickness
  const FRAME_D = CFG.WALL_T + 0.1; // extends slightly past wall on both sides

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccee,
    transparent: true,
    opacity: 0.25,
    roughness: 0.05,
    metalness: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Group windows by cell to create one wall piece per cell
  const cellWindows = new Map();
  for (const b of getBuildings()) {
    const bWallH = b.stories * CFG.WALL_H;
    for (const w of b.windows) {
      const key = `${w.gx},${w.gz}`;
      if (!cellWindows.has(key)) {
        cellWindows.set(key, { gx: w.gx, gz: w.gz, wall: w.wall, wallH: bWallH, wins: [] });
      }
      cellWindows.get(key).wins.push({
        floor: w.floor,
        wFrac: w.wFrac || 0.6,
        hFrac: w.hFrac || 0.4,
      });
    }
  }

  for (const [, cw] of cellWindows) {
    const p = g2w(cw.gx, cw.gz);
    const ty = 0; // buildings on flat zones — use fixed baseline
    const isNS = cw.wall === 'south' || cw.wall === 'north';

    // Build wall shape with window holes (extend below ground to match regular walls)
    const shape = new THREE.Shape();
    shape.moveTo(-CFG.CELL / 2, -0.5);
    shape.lineTo(CFG.CELL / 2, -0.5);
    shape.lineTo(CFG.CELL / 2, cw.wallH);
    shape.lineTo(-CFG.CELL / 2, cw.wallH);
    shape.closePath();

    // Deduplicate by floor, keep first entry's size
    const floorMap = new Map();
    for (const win of cw.wins) {
      if (!floorMap.has(win.floor)) floorMap.set(win.floor, win);
    }
    const uniqueWins = [...floorMap.values()];

    for (const win of uniqueWins) {
      const winW = CFG.CELL * win.wFrac;
      const winH = CFG.WALL_H * win.hFrac;
      const baseY = (win.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
      const hole = new THREE.Path();
      hole.moveTo(-winW / 2, baseY - winH / 2);
      hole.lineTo(winW / 2, baseY - winH / 2);
      hole.lineTo(winW / 2, baseY + winH / 2);
      hole.lineTo(-winW / 2, baseY + winH / 2);
      hole.closePath();
      shape.holes.push(hole);
    }

    const wallGeo = new THREE.ExtrudeGeometry(shape, {
      depth: CFG.WALL_T,
      bevelEnabled: false,
    });
    wallGeo.translate(0, 0, -CFG.WALL_T / 2);

    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.set(p.x, ty, p.z);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    // Rotate for EW walls
    if (!isNS) {
      wallMesh.rotation.y = Math.PI / 2;
    }

    scene.add(wallMesh);

    // Glass panes + wooden frames in each window opening
    for (const win of uniqueWins) {
      const winW = CFG.CELL * win.wFrac;
      const winH = CFG.WALL_H * win.hFrac;
      const baseY = (win.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
      const paneGeo = new THREE.PlaneGeometry(winW, winH);
      const pane = new THREE.Mesh(paneGeo, glassMat);

      if (isNS) {
        pane.position.set(p.x, ty + baseY, p.z);
      } else {
        pane.rotation.y = Math.PI / 2;
        pane.position.set(p.x, ty + baseY, p.z);
      }

      scene.add(pane);

      // Register pane for breakable window system
      const regKey = `${cw.gx},${cw.gz}`;
      if (!windowPanes.has(regKey)) windowPanes.set(regKey, []);
      windowPanes.get(regKey).push({
        pane, wall: cw.wall, floor: win.floor,
        wFrac: win.wFrac, hFrac: win.hFrac, broken: false,
      });

      // Wooden frame — 4 bars around window opening
      const outerW = winW + FRAME_T * 2;
      const outerH = winH + FRAME_T * 2;

      // Top bar
      const topGeo = isNS
        ? new THREE.BoxGeometry(outerW, FRAME_T, FRAME_D)
        : new THREE.BoxGeometry(FRAME_D, FRAME_T, outerW);
      const topBar = new THREE.Mesh(topGeo, frameMat);
      topBar.position.set(p.x, ty + baseY + winH / 2 + FRAME_T / 2, p.z);
      topBar.castShadow = true;
      scene.add(topBar);

      // Bottom bar
      const botBar = new THREE.Mesh(topGeo, frameMat);
      botBar.position.set(p.x, ty + baseY - winH / 2 - FRAME_T / 2, p.z);
      botBar.castShadow = true;
      scene.add(botBar);

      // Left bar
      const sideGeo = isNS
        ? new THREE.BoxGeometry(FRAME_T, outerH, FRAME_D)
        : new THREE.BoxGeometry(FRAME_D, outerH, FRAME_T);
      const leftBar = new THREE.Mesh(sideGeo, frameMat);
      if (isNS) {
        leftBar.position.set(p.x - winW / 2 - FRAME_T / 2, ty + baseY, p.z);
      } else {
        leftBar.position.set(p.x, ty + baseY, p.z - winW / 2 - FRAME_T / 2);
      }
      leftBar.castShadow = true;
      scene.add(leftBar);

      // Right bar
      const rightBar = new THREE.Mesh(sideGeo, frameMat);
      if (isNS) {
        rightBar.position.set(p.x + winW / 2 + FRAME_T / 2, ty + baseY, p.z);
      } else {
        rightBar.position.set(p.x, ty + baseY, p.z + winW / 2 + FRAME_T / 2);
      }
      rightBar.castShadow = true;
      scene.add(rightBar);
    }
  }
}

export function buildRoofs(scene) {
  const buildings = getBuildings();

  const flatMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
  const slantMat = new THREE.MeshStandardMaterial({
    color: 0x8B4513,
    roughness: 0.85,
    side: THREE.DoubleSide,
  });

  const overhang = 0.4;
  const ridgeHeight = 1.8;

  for (const b of buildings) {
    const topY = b.stories * CFG.WALL_H;
    const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
    const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
    const c = getBuildingCenter(b);

    if (b.roofType === 'flat') {
      const geo = new THREE.BoxGeometry(bw + overhang, 0.25, bh + overhang);
      const roof = new THREE.Mesh(geo, flatMat);
      roof.position.set(c.x, topY + 0.125, c.z);
      roof.castShadow = true;
      roof.receiveShadow = true;
      scene.add(roof);
    } else {
      const longAxis = bw >= bh;
      const roofLen = (longAxis ? bw : bh) + overhang * 2;
      const roofSpan = (longAxis ? bh : bw) + overhang * 2;

      const shape = new THREE.Shape();
      shape.moveTo(-roofSpan / 2, 0);
      shape.lineTo(0, ridgeHeight);
      shape.lineTo(roofSpan / 2, 0);
      shape.closePath();

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: roofLen,
        bevelEnabled: false,
      });
      geo.translate(0, 0, -roofLen / 2);

      const roof = new THREE.Mesh(geo, slantMat);
      roof.position.set(c.x, topY, c.z);

      if (longAxis) {
        roof.rotation.y = Math.PI / 2;
      }

      roof.castShadow = true;
      roof.receiveShadow = true;
      scene.add(roof);
    }
  }
}

export function buildWater(scene) {
  const size = CFG.GRID * CFG.CELL + 20;
  const geo = new THREE.PlaneGeometry(size, size);
  let mat;
  if (CFG.SNOW_MODE) {
    mat = new THREE.MeshStandardMaterial({
      color: 0xb8d4e3,
      roughness: 0.15,
      metalness: 0.1,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      color: 0x2266aa,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = CFG.WATER_Y;
  water.receiveShadow = true;
  water.userData.isGround = true;
  scene.add(water);
}

/** Create static physics bodies for walls, floors, stairs, doors-above */
export function createWorldPhysicsBodies() {
  const grid = getGrid();
  const buildings = getBuildings();

  // Wall heights per cell (same logic as buildWalls)
  const wallH = [];
  for (let x = 0; x < CFG.GRID; x++) {
    wallH[x] = new Array(CFG.GRID).fill(CFG.WALL_H);
  }
  for (const b of buildings) {
    const h = b.stories * CFG.WALL_H;
    for (let gx = b.x; gx < b.x + b.w; gx++) {
      wallH[gx][b.z] = h;
      wallH[gx][b.z + b.h - 1] = h;
    }
    for (let gz = b.z; gz < b.z + b.h; gz++) {
      wallH[b.x][gz] = h;
      wallH[b.x + b.w - 1][gz] = h;
    }
  }

  // Helper: thin post detection (same as buildWalls)
  function isThinPost(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= CFG.GRID || gz >= CFG.GRID) return false;
    if (grid[gx][gz] || isDoorCell(gx, gz) || isWindowCell(gx, gz) || isStairCell(gx, gz)) return false;
    const oN = gz > 0 && grid[gx][gz - 1];
    const oS = gz < CFG.GRID - 1 && grid[gx][gz + 1];
    const oW = gx > 0 && grid[gx - 1][gz];
    const oE = gx < CFG.GRID - 1 && grid[gx + 1][gz];
    const facesNS = oN || oS;
    const facesEW = oW || oE;
    return (facesNS && facesEW) || (!facesNS && !facesEW);
  }

  const ext = (CFG.CELL - CFG.WALL_T) / 2;

  // --- Wall + window cell bodies ---
  for (let x = 0; x < CFG.GRID; x++) {
    for (let z = 0; z < CFG.GRID; z++) {
      // Include window cells (full box — window breaking handled elsewhere)
      // Exclude doors (kinematic bodies) and stairs
      if (grid[x][z] || isDoorCell(x, z) || isStairCell(x, z)) continue;
      const isWin = isWindowCell(x, z);
      if (!isWin && grid[x][z]) continue; // walkable non-window — skip

      const p = g2w(x, z);
      let h = wallH[x][z];

      // Tree cells: only trunk height (3 units), not full wall
      if (isTreeCell(x, z)) h = Math.min(h, 3);

      const openN = z > 0 && grid[x][z - 1];
      const openS = z < CFG.GRID - 1 && grid[x][z + 1];
      const openW = x > 0 && grid[x - 1][z];
      const openE = x < CFG.GRID - 1 && grid[x + 1][z];
      const facesNS = openN || openS;
      const facesEW = openW || openE;

      let sx, sz, px = p.x, pz = p.z;
      if (isWin) {
        // Window cells: use cell-width in wall direction, wall thickness in other
        // Determine wall direction from the window data
        const isNSWin = facesNS || (!facesNS && !facesEW);
        sx = isNSWin ? CFG.CELL : CFG.WALL_T;
        sz = isNSWin ? CFG.WALL_T : CFG.CELL;
      } else if (facesNS && !facesEW) {
        sx = CFG.CELL; sz = CFG.WALL_T;
        const extW = isThinPost(x - 1, z) ? ext : 0;
        const extE = isThinPost(x + 1, z) ? ext : 0;
        sx += extW + extE;
        px += (extE - extW) / 2;
      } else if (facesEW && !facesNS) {
        sx = CFG.WALL_T; sz = CFG.CELL;
        const extN = isThinPost(x, z - 1) ? ext : 0;
        const extS = isThinPost(x, z + 1) ? ext : 0;
        sz += extN + extS;
        pz += (extS - extN) / 2;
      } else {
        sx = CFG.WALL_T; sz = CFG.WALL_T;
        const wallW = x > 0 && !grid[x - 1][z] ? ext : 0;
        const wallE = x < CFG.GRID - 1 && !grid[x + 1][z] ? ext : 0;
        const wallN = z > 0 && !grid[x][z - 1] ? ext : 0;
        const wallS = z < CFG.GRID - 1 && !grid[x][z + 1] ? ext : 0;
        sx += wallW + wallE;
        sz += wallN + wallS;
        px += (wallE - wallW) / 2;
        pz += (wallS - wallN) / 2;
      }

      const bottom = -0.5;
      const totalH = h - bottom;
      const body = createStaticBox(sx / 2, totalH / 2, sz / 2, px, bottom + totalH / 2, pz);

      // Window walls: group 4, don't collide with projectiles (group 8)
      if (isWin) {
        body.collisionFilterGroup = 4;
        body.collisionFilterMask = ~8;
      }
    }
  }

  // --- Above-door lintel + 2nd floor door wall bodies ---
  const doorTopY = CFG.WALL_H * 0.88;
  for (const b of buildings) {
    for (const d of b.doors) {
      const p = g2w(d.gx, d.gz);
      const isNS = d.wall === 'south' || d.wall === 'north';
      const sx = isNS ? CFG.CELL : CFG.WALL_T;
      const sz = isNS ? CFG.WALL_T : CFG.CELL;

      const gapH = CFG.WALL_H - doorTopY;
      if (gapH > 0.01) {
        createStaticBox(sx / 2, gapH / 2, sz / 2, p.x, doorTopY + gapH / 2, p.z);
      }
      if (b.stories === 2) {
        createStaticBox(sx / 2, CFG.WALL_H / 2, sz / 2, p.x, CFG.WALL_H + CFG.WALL_H / 2, p.z);
      }
    }
  }

  // --- Mid-floor slabs (2-story buildings) ---
  // Physics slab is thicker than visual (1.0 vs 0.5) to prevent fast-moving capsules phasing through
  const PHYS_FLOOR_THICK = 1.0;
  const FLOOR_TOP_OFFSET = -0.125;
  for (const b of buildings) {
    if (b.stories !== 2) continue;
    const c = getBuildingCenter(b);

    if (b.stair) {
      const s = b.stair;
      const stairP = g2w(s.gx, s.gzStart);
      const intLeft = g2w(b.x, 0).x;
      const intRight = g2w(b.x + b.w - 1, 0).x;
      const intBack = g2w(0, b.z).z;
      const intFront = g2w(0, b.z + b.h - 1).z;
      const stairLeft = stairP.x - CFG.CELL / 2;
      const stairRight = stairP.x + CFG.CELL / 2;
      const stairFront = g2w(0, s.gzEnd).z + CFG.CELL / 2;
      const floorY = CFG.WALL_H;

      // Piece 1: left of stairwell
      const p1w = stairLeft - intLeft;
      const p1d = intFront - intBack;
      if (p1w > 0.1 && p1d > 0.1) {
        createStaticBox(p1w / 2, PHYS_FLOOR_THICK / 2, p1d / 2, intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2);
      }
      // Piece 2: above stairwell
      const p2w = stairRight - stairLeft;
      const p2d = intFront - stairFront;
      if (p2w > 0.1 && p2d > 0.1) {
        createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p2d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2);
      }
      // Piece 3: right of stairwell
      const p3w = intRight - stairRight;
      const p3d = intFront - intBack;
      if (p3w > 0.1 && p3d > 0.1) {
        createStaticBox(p3w / 2, PHYS_FLOOR_THICK / 2, p3d / 2, stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2);
      }
      // Piece 4: behind stairwell
      const stairBack = stairP.z - CFG.CELL / 2;
      const p4d = stairBack - intBack;
      if (p2w > 0.1 && p4d > 0.1) {
        createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p4d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2);
      }

      // --- Stair steps ---
      const stairP2 = g2w(s.gx, s.gzEnd);
      const stairWidth = CFG.CELL * 0.95;
      const stairX = stairP.x + (CFG.CELL - stairWidth) / 2;
      const zMin = stairP.z - CFG.CELL / 2;
      const zMax = stairP2.z + CFG.CELL / 2;
      const totalDepth = zMax - zMin;
      // Use 16 steps so step height (0.22) < player sphere radius (0.35)
      const numSteps = 16;
      const stepH = CFG.WALL_H / numSteps;
      const stepD = totalDepth / numSteps;

      for (let i = 0; i < numSteps; i++) {
        const sh = (i + 1) * stepH;
        createStaticBox(stairWidth / 2, sh / 2, stepD / 2, stairX, sh / 2, zMax - (i + 0.5) * stepD);
      }
    } else {
      // Full floor, no stairwell
      const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
      const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
      createStaticBox(fullW / 2, PHYS_FLOOR_THICK / 2, fullH / 2, c.x, CFG.WALL_H + FLOOR_TOP_OFFSET, c.z);
    }
  }

  // --- Ground floor slabs ---
  for (const b of buildings) {
    const c2 = getBuildingCenter(b);
    const fw = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
    const fh = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
    const GROUND_SLAB = 0.6;
    createStaticBox(fw / 2, GROUND_SLAB / 2, fh / 2, c2.x, 0.02 - GROUND_SLAB / 2, c2.z);
  }

  // --- Roof bodies (prevent jumping through ceilings) ---
  for (const b of buildings) {
    const topY = b.stories * CFG.WALL_H;
    const c = getBuildingCenter(b);
    const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
    const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
    const overhang = 0.4;
    createStaticBox((bw + overhang) / 2, 0.125, (bh + overhang) / 2, c.x, topY + 0.125, c.z);
  }
}
