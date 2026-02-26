import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3, Matrix,
         VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

function loadTex(path, uScale, vScale, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = uScale;
    tex.vScale = vScale;
    return tex;
}

/**
 * Rewrite a box mesh's UV coordinates based on world position + vertex normal.
 * This is triplanar-style: faces pointing along X use (Z,Y), along Z use (X,Y), along Y use (X,Z).
 * Produces consistent tiling regardless of face order, RHS, or rotation.
 */
function applyWorldUVs(mesh) {
    const positions = mesh.getVerticesData('position');
    const normals = mesh.getVerticesData('normal');
    const uvs = new Float32Array(positions.length / 3 * 2);
    const wx = mesh.position.x, wy = mesh.position.y, wz = mesh.position.z;
    for (let i = 0; i < positions.length / 3; i++) {
        const px = positions[i * 3] + wx;
        const py = positions[i * 3 + 1] + wy;
        const pz = positions[i * 3 + 2] + wz;
        const nx = Math.abs(normals[i * 3]);
        const ny = Math.abs(normals[i * 3 + 1]);
        const nz = Math.abs(normals[i * 3 + 2]);
        if (nx > ny && nx > nz) {
            uvs[i * 2] = pz; uvs[i * 2 + 1] = py;
        } else if (ny > nx && ny > nz) {
            uvs[i * 2] = px; uvs[i * 2 + 1] = pz;
        } else {
            uvs[i * 2] = px; uvs[i * 2 + 1] = py;
        }
    }
    mesh.setVerticesData('uv', uvs);
}

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

/**
 * Build wall segments around rectangular window holes within a wall cell.
 * Returns array of un-positioned Babylon box meshes in local space (centered at x=0).
 */
function buildWallWithHoles(cellWidth, wallH, wallT, windows, scene) {
    const meshes = [];
    const left = -cellWidth / 2;
    const right = cellWidth / 2;
    const totalW = cellWidth;
    const bottom = -0.5;

    const sorted = windows.map(win => {
        const baseY = (win.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
        const winH = CFG.WALL_H * win.hFrac;
        const winW = CFG.CELL * win.wFrac;
        return {
            winW, winH,
            winBot: baseY - winH / 2,
            winTop: baseY + winH / 2,
            winLeft: -winW / 2,
            winRight: winW / 2,
        };
    }).sort((a, b) => a.winBot - b.winBot);

    const bands = [];
    let cursor = bottom;

    for (const win of sorted) {
        if (win.winBot > cursor + 0.001) {
            bands.push({ type: 'full', y: cursor, h: win.winBot - cursor });
        }
        bands.push({ type: 'window', y: win.winBot, h: win.winH, win });
        cursor = win.winTop;
    }
    if (wallH > cursor + 0.001) {
        bands.push({ type: 'full', y: cursor, h: wallH - cursor });
    }

    for (const band of bands) {
        if (band.type === 'full') {
            const box = MeshBuilder.CreateBox('wh', {
                width: totalW, height: band.h, depth: wallT,
            }, scene);
            box.position = new Vector3(0, band.y + band.h / 2, 0);
            meshes.push(box);
        } else {
            const win = band.win;
            const leftW = win.winLeft - left;
            if (leftW > 0.001) {
                const lBox = MeshBuilder.CreateBox('whl', {
                    width: leftW, height: band.h, depth: wallT,
                }, scene);
                lBox.position = new Vector3(left + leftW / 2, band.y + band.h / 2, 0);
                meshes.push(lBox);
            }
            const rightW = right - win.winRight;
            if (rightW > 0.001) {
                const rBox = MeshBuilder.CreateBox('whr', {
                    width: rightW, height: band.h, depth: wallT,
                }, scene);
                rBox.position = new Vector3(right - rightW / 2, band.y + band.h / 2, 0);
                meshes.push(rBox);
            }
        }
    }

    return meshes;
}

export function buildWalls(scene) {
    const grid = getGrid();
    const buildings = getBuildings();

    // Single material for ALL wall geometry (regular + window walls).
    // Merging into one mesh eliminates seam lines between adjacent cells.
    const wallMat = new StandardMaterial('wallMat', scene);
    wallMat.diffuseTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
    wallMat.specularColor = new Color3(0.02, 0.02, 0.02);

    // Wall heights per cell — multi-story buildings have taller walls
    const wallH = [];
    for (let x = 0; x < CFG.GRID; x++) {
        wallH[x] = new Array(CFG.GRID).fill(CFG.WALL_H);
    }

    // Building corner cells — always thin posts regardless of neighbor state
    const cornerCells = new Set();
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
        cornerCells.add(`${b.x},${b.z}`);
        cornerCells.add(`${b.x + b.w - 1},${b.z}`);
        cornerCells.add(`${b.x},${b.z + b.h - 1}`);
        cornerCells.add(`${b.x + b.w - 1},${b.z + b.h - 1}`);
    }

    function isThinPost(gx, gz) {
        if (gx < 0 || gz < 0 || gx >= CFG.GRID || gz >= CFG.GRID) return false;
        if (grid[gx][gz] || isDoorCell(gx, gz) || isWindowCell(gx, gz) || isStairCell(gx, gz)) return false;
        if (cornerCells.has(`${gx},${gz}`)) return true;
        const oN = gz > 0 && grid[gx][gz - 1];
        const oS = gz < CFG.GRID - 1 && grid[gx][gz + 1];
        const oW = gx > 0 && grid[gx - 1][gz];
        const oE = gx < CFG.GRID - 1 && grid[gx + 1][gz];
        const facesNS = oN || oS;
        const facesEW = oW || oE;
        return (facesNS && facesEW) || (!facesNS && !facesEW);
    }

    const ext = CFG.CELL / 2 + CFG.WALL_T / 2; // extend past thin-post center to cover corner gaps

    // Pre-compute window data per cell for wall-with-holes geometry
    const cellWindows = new Map();
    for (const b of buildings) {
        for (const w of b.windows) {
            const key = `${w.gx},${w.gz}`;
            if (!cellWindows.has(key)) {
                cellWindows.set(key, { wall: w.wall, wins: [] });
            }
            cellWindows.get(key).wins.push({
                floor: w.floor,
                wFrac: w.wFrac || 0.6,
                hFrac: w.hFrac || 0.4,
            });
        }
    }

    const tempMeshes = [];

    // --- Wall cells (regular + window) ---
    for (let x = 0; x < CFG.GRID; x++) {
        for (let z = 0; z < CFG.GRID; z++) {
            if (grid[x][z] || isDoorCell(x, z) || isStairCell(x, z)) continue;

            const isWin = isWindowCell(x, z);
            const p = g2w(x, z);
            const h = wallH[x][z];
            const bottom = -0.5;
            const totalH = h - bottom;

            if (isWin) {
                // Window cell — wall segments with holes for window openings
                const cw = cellWindows.get(`${x},${z}`);
                if (!cw) continue;

                const isNS = cw.wall === 'south' || cw.wall === 'north';
                let extLeft = 0, extRight = 0;
                if (isNS) {
                    extLeft = isThinPost(x - 1, z) ? ext : 0;
                    extRight = isThinPost(x + 1, z) ? ext : 0;
                } else {
                    extLeft = isThinPost(x, z - 1) ? ext : 0;
                    extRight = isThinPost(x, z + 1) ? ext : 0;
                }

                const halfW = CFG.CELL / 2;
                const cellWidth = (halfW + extLeft) + (halfW + extRight);

                const floorMap = new Map();
                for (const win of cw.wins) {
                    if (!floorMap.has(win.floor)) floorMap.set(win.floor, win);
                }

                const wallPieces = buildWallWithHoles(cellWidth, h, CFG.WALL_T,
                    [...floorMap.values()], scene);
                const offsetCenter = (extRight - extLeft) / 2;

                for (const piece of wallPieces) {
                    piece.position.x += offsetCenter;
                    if (isNS) {
                        piece.position.x += p.x;
                        piece.position.z += p.z;
                    } else {
                        const lx = piece.position.x;
                        const lz = piece.position.z;
                        piece.position.x = p.x - lz;
                        piece.position.z = p.z + lx;
                        piece.rotation.y = Math.PI / 2;
                    }
                    applyWorldUVs(piece);
                    tempMeshes.push(piece);
                }
            } else {
                // Regular wall cell
                const openN = z > 0 && grid[x][z - 1];
                const openS = z < CFG.GRID - 1 && grid[x][z + 1];
                const openW = x > 0 && grid[x - 1][z];
                const openE = x < CFG.GRID - 1 && grid[x + 1][z];
                const facesNS = openN || openS;
                const facesEW = openW || openE;

                const isCorner = cornerCells.has(`${x},${z}`);
                if (isCorner) continue; // adjacent wall extensions fully cover corners
                let sx, sz, px = p.x, pz = p.z;
                if (facesNS && !facesEW) {
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
                }

                const box = MeshBuilder.CreateBox('w', { width: sx, height: totalH, depth: sz }, scene);
                box.position = new Vector3(px, bottom + totalH / 2, pz);
                applyWorldUVs(box);
                tempMeshes.push(box);
            }
        }
    }

    // --- Wall blocks above doors ---
    const doorTopY = CFG.WALL_H * 0.88;
    for (const b of buildings) {
        for (const d of b.doors) {
            const p = g2w(d.gx, d.gz);
            const isNS = d.wall === 'south' || d.wall === 'north';
            let sx = isNS ? CFG.CELL : CFG.WALL_T;
            let sz = isNS ? CFG.WALL_T : CFG.CELL;
            let px = p.x, pz = p.z;

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

            const gapH = CFG.WALL_H - doorTopY;
            if (gapH > 0.01) {
                const box = MeshBuilder.CreateBox('wd', { width: sx, height: gapH, depth: sz }, scene);
                box.position = new Vector3(px, doorTopY + gapH / 2, pz);
                applyWorldUVs(box);
                tempMeshes.push(box);
            }

            if (b.stories === 2) {
                const box = MeshBuilder.CreateBox('wd2', { width: sx, height: CFG.WALL_H, depth: sz }, scene);
                box.position = new Vector3(px, CFG.WALL_H + CFG.WALL_H / 2, pz);
                applyWorldUVs(box);
                tempMeshes.push(box);
            }
        }
    }

    // --- Door-side fill blocks ---
    const fillW = ext + CFG.WALL_T / 2;
    for (const b of buildings) {
        for (const d of b.doors) {
            const p = g2w(d.gx, d.gz);
            const isNS = d.wall === 'south' || d.wall === 'north';

            const neighbors = isNS
                ? [{ check: isThinPost(d.gx - 1, d.gz), sign: -1 },
                   { check: isThinPost(d.gx + 1, d.gz), sign: +1 }]
                : [{ check: isThinPost(d.gx, d.gz - 1), sign: -1 },
                   { check: isThinPost(d.gx, d.gz + 1), sign: +1 }];

            for (const n of neighbors) {
                if (!n.check) continue;
                const ngx = isNS ? d.gx + n.sign : d.gx;
                const ngz = isNS ? d.gz : d.gz + n.sign;
                const fw = cornerCells.has(`${ngx},${ngz}`) ? ext : fillW;

                const bottom = -0.5;
                for (let floor = 0; floor < b.stories; floor++) {
                    const floorH = floor === 0 ? CFG.WALL_H * 0.88 : CFG.WALL_H;
                    const floorBase = floor * CFG.WALL_H + bottom;
                    const totalH = (floor === 0 ? floorH - bottom : floorH);

                    let box;
                    if (isNS) {
                        const fx = p.x + n.sign * (CFG.CELL / 2 + fw / 2);
                        box = MeshBuilder.CreateBox('wf', { width: fw, height: totalH, depth: CFG.WALL_T }, scene);
                        box.position = new Vector3(fx, floorBase + totalH / 2, p.z);
                    } else {
                        const fz = p.z + n.sign * (CFG.CELL / 2 + fw / 2);
                        box = MeshBuilder.CreateBox('wf', { width: CFG.WALL_T, height: totalH, depth: fw }, scene);
                        box.position = new Vector3(p.x, floorBase + totalH / 2, fz);
                    }
                    applyWorldUVs(box);
                    tempMeshes.push(box);
                }
            }
        }
    }

    // Merge ALL wall geometry into a single mesh — eliminates seam lines
    if (tempMeshes.length > 0) {
        const walls = Mesh.MergeMeshes(tempMeshes, true, true, undefined, false, true);
        if (walls) {
            walls.name = 'walls';
            walls.material = wallMat;
            addShadowCaster(walls);
            enableShadowReceiving(walls);
        }
    }
}

export function buildRoofs(scene) {
    const buildings = getBuildings();

    const flatMat = new StandardMaterial('flatRoofMat', scene);
    flatMat.diffuseTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
    flatMat.diffuseColor = new Color3(0.4, 0.4, 0.4); // tint stone darker for flat roof
    flatMat.specularColor = new Color3(0.02, 0.02, 0.02);
    flatMat.backFaceCulling = false; // visible from inside (looking up at ceiling)

    const slantMat = new StandardMaterial('slantRoofMat', scene);
    slantMat.diffuseTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
    slantMat.diffuseColor = new Color3(0.545, 0.271, 0.075); // #8B4513
    slantMat.specularColor = new Color3(0.02, 0.02, 0.02);
    slantMat.backFaceCulling = false; // DoubleSide

    const overhang = 0.4;
    const ridgeHeight = 1.8;

    const flatMeshes = [];
    const slantMeshes = [];

    for (const b of buildings) {
        const topY = b.stories * CFG.WALL_H;
        const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
        const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
        const c = getBuildingCenter(b);

        // Overlap roof into wall top by 0.15 to eliminate light strip at junction
        const ROOF_OVERLAP = 0.15;

        if (b.roofType === 'flat') {
            const rw = bw + overhang, rh = 0.25 + ROOF_OVERLAP, rd = bh + overhang;
            const box = MeshBuilder.CreateBox('rf', {
                width: rw, height: rh, depth: rd,
            }, scene);
            box.position = new Vector3(c.x, topY + 0.125 - ROOF_OVERLAP / 2, c.z);
            applyWorldUVs(box);
            flatMeshes.push(box);
        } else {
            const longAxis = bw >= bh;
            const roofLen = (longAxis ? bw : bh) + overhang * 2;
            const roofSpan = (longAxis ? bh : bw) + overhang * 2;

            // Build triangular prism for gable roof using custom vertex data
            const halfSpan = roofSpan / 2;
            const halfLen = roofLen / 2;

            // Triangle cross-section vertices (in XY plane, extruded along Z)
            const slopeLen = Math.sqrt(halfSpan * halfSpan + ridgeHeight * ridgeHeight);
            const positions = [
                // Front face
                -halfSpan, 0, -halfLen,
                 halfSpan, 0, -halfLen,
                 0, ridgeHeight, -halfLen,
                // Back face
                -halfSpan, 0,  halfLen,
                 0, ridgeHeight,  halfLen,
                 halfSpan, 0,  halfLen,
                // Left slope
                -halfSpan, 0, -halfLen,
                 0, ridgeHeight, -halfLen,
                 0, ridgeHeight,  halfLen,
                -halfSpan, 0,  halfLen,
                // Right slope
                 halfSpan, 0, -halfLen,
                 halfSpan, 0,  halfLen,
                 0, ridgeHeight,  halfLen,
                 0, ridgeHeight, -halfLen,
                // Bottom
                -halfSpan, 0, -halfLen,
                -halfSpan, 0,  halfLen,
                 halfSpan, 0,  halfLen,
                 halfSpan, 0, -halfLen,
            ];
            const uvs = [
                // Front face (triangle)
                0, 0,
                roofSpan, 0,
                halfSpan, ridgeHeight,
                // Back face (triangle)
                0, 0,
                halfSpan, ridgeHeight,
                roofSpan, 0,
                // Left slope (quad)
                0, 0,
                slopeLen, 0,
                slopeLen, roofLen,
                0, roofLen,
                // Right slope (quad)
                0, 0,
                0, roofLen,
                slopeLen, roofLen,
                slopeLen, 0,
                // Bottom (quad)
                0, 0,
                0, roofLen,
                roofSpan, roofLen,
                roofSpan, 0,
            ];
            const indices = [
                0, 1, 2,           // front
                3, 4, 5,           // back
                6, 7, 8,  6, 8, 9, // left slope
                10,11,12, 10,12,13, // right slope
                14,15,16, 14,16,17, // bottom
            ];

            const mesh = new Mesh('rs', scene);
            const vd = new VertexData();
            vd.positions = positions;
            vd.indices = indices;
            vd.uvs = uvs;
            VertexData.ComputeNormals(positions, indices, vd.normals = []);
            vd.applyToMesh(mesh);

            // Apply rotation for long axis + position at building top
            if (longAxis) {
                mesh.rotation.y = Math.PI / 2;
            }
            mesh.position = new Vector3(c.x, topY - ROOF_OVERLAP, c.z);
            slantMeshes.push(mesh);
        }
    }

    if (flatMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(flatMeshes, true, true, undefined, false, true);
        if (merged) {
            merged.name = 'flatRoofs';
            merged.material = flatMat;
            addShadowCaster(merged);
            enableShadowReceiving(merged);
        }
    }

    if (slantMeshes.length > 0) {
        // Bake world transforms before merging (needed for rotated meshes)
        for (const m of slantMeshes) m.bakeCurrentTransformIntoVertices();
        const merged = Mesh.MergeMeshes(slantMeshes, true, true, undefined, false, true);
        if (merged) {
            merged.name = 'slantRoofs';
            merged.material = slantMat;
            addShadowCaster(merged);
            enableShadowReceiving(merged);
        }
    }
}
