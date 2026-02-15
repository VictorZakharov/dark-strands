import * as THREE from 'three';
import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';

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

    // Ground floor — solid slab covering full building footprint (including under walls)
    // Seals all light paths: extends past wall edges and below ground
    const fw = b.w * CFG.CELL;
    const fh = b.h * CFG.CELL;
    const GROUND_SLAB = 0.6;
    const fg = new THREE.BoxGeometry(fw, GROUND_SLAB, fh);
    const fm = new THREE.Mesh(fg, floorMat);
    fm.position.set(c.x, 0.02 - GROUND_SLAB / 2, c.z);
    fm.receiveShadow = true;
    scene.add(fm);

    // Mid-level floor for 2-story buildings (with stairwell gap)
    const FLOOR_THICK = 0.25;
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
        mesh.position.set(intLeft + p1w / 2, floorY, intBack + p1d / 2);
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
        mesh.position.set(stairLeft + p2w / 2, floorY, stairFront + p2d / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }

      buildStairSteps(scene, b, stairMat);
    } else if (b.stories === 2) {
      // Full floor, no stairwell — extend into walls
      const fullW = b.w * CFG.CELL;
      const fullH = b.h * CFG.CELL;
      const mg = new THREE.BoxGeometry(fullW, FLOOR_THICK, fullH);
      const mm = new THREE.Mesh(mg, floorMat);
      mm.position.set(c.x, CFG.WALL_H, c.z);
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

  // Add upper wall blocks for doors on 2-story buildings
  for (const b of buildings) {
    if (b.stories === 2) count += b.doors.length;
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

        let sx, sz;
        if (facesNS && facesEW) {
          sx = CFG.CELL; sz = CFG.CELL; // corner
        } else if (facesNS) {
          sx = CFG.CELL; sz = CFG.WALL_T;
        } else if (facesEW) {
          sx = CFG.WALL_T; sz = CFG.CELL;
        } else {
          sx = CFG.CELL; sz = CFG.CELL;
        }

        // Ignore terrain (buildings on flat zones ≈ 0); fixed baseline seals all gaps
        const bottom = -0.5;
        const totalH = h - bottom;
        dummy.position.set(p.x, bottom + totalH / 2, p.z);
        dummy.scale.set(sx, totalH, sz);
        dummy.updateMatrix();
        walls.setMatrixAt(idx++, dummy.matrix);
      }
    }
  }

  // Upper wall blocks above doors on 2-story buildings
  for (const b of buildings) {
    if (b.stories === 2) {
      for (const d of b.doors) {
        const p = g2w(d.gx, d.gz);
        const isNS = d.wall === 'south' || d.wall === 'north';
        const sx = isNS ? CFG.CELL : CFG.WALL_T;
        const sz = isNS ? CFG.WALL_T : CFG.CELL;
        dummy.position.set(p.x, CFG.WALL_H + CFG.WALL_H / 2, p.z);
        dummy.scale.set(sx, CFG.WALL_H, sz);
        dummy.updateMatrix();
        walls.setMatrixAt(idx++, dummy.matrix);
      }
    }
  }

  scene.add(walls);
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
    const bw = b.w * CFG.CELL;
    const bh = b.h * CFG.CELL;
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
  scene.add(water);
}
