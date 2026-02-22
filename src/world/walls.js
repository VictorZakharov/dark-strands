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

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
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

    // Add door-side fill blocks (wall between door cell edge and adjacent corners)
    for (const b of buildings) {
        for (const d of b.doors) {
            const isNS = d.wall === 'south' || d.wall === 'north';
            const floors = b.stories;
            if (isNS) {
                if (isThinPost(d.gx - 1, d.gz)) count += floors;
                if (isThinPost(d.gx + 1, d.gz)) count += floors;
            } else {
                if (isThinPost(d.gx, d.gz - 1)) count += floors;
                if (isThinPost(d.gx, d.gz + 1)) count += floors;
            }
        }
    }

    const wallGeo = new THREE.BoxGeometry(1, 1, 1);
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex,
        roughness: 0.9,
        side: THREE.DoubleSide,
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

    const ext = CFG.CELL / 2; // extend to corner cell center (overlap eliminates gaps)

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
                    // Keep as WALL_T × WALL_T; adjacent straight walls already extend to cover the gap.
                    sx = CFG.WALL_T; sz = CFG.WALL_T;
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
            let sx = isNS ? CFG.CELL : CFG.WALL_T;
            let sz = isNS ? CFG.WALL_T : CFG.CELL;
            let px = p.x, pz = p.z;

            // Extend toward thin posts (corners) — same as regular walls
            if (isNS) {
                const extW = isThinPost(d.gx - 1, d.gz) ? ext : 0;
                const extE = isThinPost(d.gx + 1, d.gz) ? ext : 0;
                sx += extW + extE;
                px += (extE - extW) / 2;
            } else {
                const extN = isThinPost(d.gx, d.gz - 1) ? ext : 0;
                const extS = isThinPost(d.gx, d.gz + 1) ? ext : 0;
                sz += extN + extS;
                pz += (extS - extN) / 2;
            }

            // Gap above door on ground floor
            const gapH = CFG.WALL_H - doorTopY;
            if (gapH > 0.01) {
                dummy.position.set(px, doorTopY + gapH / 2, pz);
                dummy.scale.set(sx, gapH, sz);
                dummy.updateMatrix();
                walls.setMatrixAt(idx++, dummy.matrix);
            }

            // Full wall above door on 2nd floor (for 2-story buildings)
            if (b.stories === 2) {
                dummy.position.set(px, CFG.WALL_H + CFG.WALL_H / 2, pz);
                dummy.scale.set(sx, CFG.WALL_H, sz);
                dummy.updateMatrix();
                walls.setMatrixAt(idx++, dummy.matrix);
            }
        }
    }

    // Door-side fill blocks (wall between door cell edge and adjacent corners)
    const fillW = ext + CFG.WALL_T / 2; // extend from cell edge to corner far edge
    for (const b of buildings) {
        const bWallH = b.stories * CFG.WALL_H;
        for (const d of b.doors) {
            const p = g2w(d.gx, d.gz);
            const isNS = d.wall === 'south' || d.wall === 'north';

            // Check neighbors along wall direction
            const neighbors = isNS
                ? [{ dg: -1, check: isThinPost(d.gx - 1, d.gz), sign: -1 },
                { dg: +1, check: isThinPost(d.gx + 1, d.gz), sign: +1 }]
                : [{ dg: -1, check: isThinPost(d.gx, d.gz - 1), sign: -1 },
                { dg: +1, check: isThinPost(d.gx, d.gz + 1), sign: +1 }];

            for (const n of neighbors) {
                if (!n.check) continue;

                // Fill block from door cell edge toward corner
                const bottom = -0.5;
                for (let floor = 0; floor < b.stories; floor++) {
                    const floorH = floor === 0 ? CFG.WALL_H * 0.88 : CFG.WALL_H; // ground floor = door height, upper = full
                    const floorBase = floor * CFG.WALL_H + bottom;
                    const totalH = (floor === 0 ? floorH - bottom : floorH);

                    if (isNS) {
                        const fx = p.x + n.sign * (CFG.CELL / 2 + fillW / 2);
                        dummy.position.set(fx, floorBase + totalH / 2, p.z);
                        dummy.scale.set(fillW, totalH, CFG.WALL_T);
                    } else {
                        const fz = p.z + n.sign * (CFG.CELL / 2 + fillW / 2);
                        dummy.position.set(p.x, floorBase + totalH / 2, fz);
                        dummy.scale.set(CFG.WALL_T, totalH, fillW);
                    }
                    dummy.updateMatrix();
                    walls.setMatrixAt(idx++, dummy.matrix);
                }
            }
        }
    }

    walls.instanceMatrix.needsUpdate = true;
    scene.add(walls);
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
