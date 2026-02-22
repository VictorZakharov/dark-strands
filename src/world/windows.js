import * as THREE from 'three';
import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';

const loader = new THREE.TextureLoader();

function loadTex(path, repeatX, repeatY) {
    const tex = loader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
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
        side: THREE.DoubleSide,
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

    // Thin-post detection for window wall extension (mirrors buildWalls logic)
    const grid = getGrid();
    function isWinThinPost(gx, gz) {
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
    const winExt = CFG.CELL / 2; // same extension as buildWalls

    for (const [, cw] of cellWindows) {
        const p = g2w(cw.gx, cw.gz);
        const ty = 0; // buildings on flat zones — use fixed baseline
        const isNS = cw.wall === 'south' || cw.wall === 'north';

        // Detect thin-post neighbors along the wall direction and extend toward them
        // Shape local X = wall's primary axis. For EW walls (rotated PI/2), local +X = world -Z.
        let extLeft = 0, extRight = 0; // in shape-local X
        if (isNS) {
            extLeft = isWinThinPost(cw.gx - 1, cw.gz) ? winExt : 0;
            extRight = isWinThinPost(cw.gx + 1, cw.gz) ? winExt : 0;
        } else {
            // After PI/2 rotation: local -X = world +Z, local +X = world -Z
            extLeft = isWinThinPost(cw.gx, cw.gz + 1) ? winExt : 0;  // world +Z → local -X
            extRight = isWinThinPost(cw.gx, cw.gz - 1) ? winExt : 0; // world -Z → local +X
        }

        const halfW = CFG.CELL / 2;
        const left = -halfW - extLeft;
        const right = halfW + extRight;

        // Build wall shape with window holes (extend below ground to match regular walls)
        const shape = new THREE.Shape();
        shape.moveTo(left, -0.5);
        shape.lineTo(right, -0.5);
        shape.lineTo(right, cw.wallH);
        shape.lineTo(left, cw.wallH);
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
