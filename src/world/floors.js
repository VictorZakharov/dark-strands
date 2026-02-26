import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3, VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

function loadTex(path, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = 1;
    tex.vScale = 1;
    return tex;
}

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

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

function createTempBox(name, w, h, d, x, y, z, scene) {
    const box = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    box.position = new Vector3(x, y, z);
    applyWorldUVs(box);
    return box;
}

export function buildFloors(scene) {
    const floorMat = new StandardMaterial('floorMat', scene);
    floorMat.diffuseTexture = loadTex('./assets/textures/wood_planks.jpg', scene);
    floorMat.specularColor = new Color3(0.02, 0.02, 0.02);
    floorMat.backFaceCulling = false;

    const stairMat = new StandardMaterial('stairMat', scene);
    stairMat.diffuseTexture = loadTex('./assets/textures/wood_planks.jpg', scene);
    stairMat.specularColor = new Color3(0.02, 0.02, 0.02);

    const midFloorMat = new StandardMaterial('midFloorMat', scene);
    midFloorMat.diffuseTexture = loadTex('./assets/textures/stone_wall.jpg', scene);
    midFloorMat.specularColor = new Color3(0.02, 0.02, 0.02);

    const floorMeshes = [];
    const stairMeshes = [];

    for (const b of getBuildings()) {
        const c = getBuildingCenter(b);

        // Ground floor — inset slightly inside walls to avoid z-fighting at edges
        const fw = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const fh = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const GROUND_SLAB = 0.6;
        const fg = createTempBox('floorGround', fw, GROUND_SLAB, fh,
            c.x, 0.02 - GROUND_SLAB / 2, c.z, scene);
        floorMeshes.push(fg);

        // Mid-level floor for 2-story buildings (with stairwell gap)
        const FLOOR_THICK = 0.5;
        const FLOOR_TOP_OFFSET = -0.125;
        if (b.stories === 2 && b.stair) {
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

            const p1w = stairLeft - intLeft;
            const p1d = intFront - intBack;
            if (p1w > 0.1 && p1d > 0.1) {
                const box = createTempBox('midFloorP1', p1w, FLOOR_THICK, p1d,
                    intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2, scene);
                floorMeshes.push(box);
            }

            const p2w = stairRight - stairLeft;
            const p2d = intFront - stairFront;
            if (p2w > 0.1 && p2d > 0.1) {
                const box = createTempBox('midFloorP2', p2w, FLOOR_THICK, p2d,
                    stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2, scene);
                floorMeshes.push(box);
            }

            const p3w = intRight - stairRight;
            const p3d = intFront - intBack;
            if (p3w > 0.1 && p3d > 0.1) {
                const box = createTempBox('midFloorP3', p3w, FLOOR_THICK, p3d,
                    stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2, scene);
                floorMeshes.push(box);
            }

            const stairBack = stairP.z - CFG.CELL / 2;
            const p4d = stairBack - intBack;
            if (p2w > 0.1 && p4d > 0.1) {
                const box = createTempBox('midFloorP4', p2w, FLOOR_THICK, p4d,
                    stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2, scene);
                floorMeshes.push(box);
            }

            collectStairSteps(stairMeshes, b, scene);
        } else if (b.stories === 2) {
            const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const box = createTempBox('midFloorFull', fullW, FLOOR_THICK, fullH,
                c.x, CFG.WALL_H - 0.125, c.z, scene);
            floorMeshes.push(box);
        }
    }

    // Merge all floors into one mesh
    if (floorMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(floorMeshes, true, true, undefined, false, true);
        if (merged) {
            merged.name = 'mergedFloors';
            merged.material = floorMat;
            addShadowCaster(merged);
            enableShadowReceiving(merged);
        }
    }

    // Merge all stairs into one mesh
    if (stairMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(stairMeshes, true, true, undefined, false, true);
        if (merged) {
            merged.name = 'mergedStairs';
            merged.material = stairMat;
            addShadowCaster(merged);
            enableShadowReceiving(merged);
        }
    }
}

function collectStairSteps(collector, b, scene) {
    const s = b.stair;
    const stairP1 = g2w(s.gx, s.gzStart);
    const stairP2 = g2w(s.gx, s.gzEnd);

    const stairWidth = CFG.CELL * 0.95;
    const stairX = stairP1.x + (CFG.CELL - stairWidth) / 2;
    const zMin = stairP1.z - CFG.CELL / 2;
    const zMax = stairP2.z + CFG.CELL / 2;
    const totalDepth = zMax - zMin;

    const numSteps = 8;
    const stepH = CFG.WALL_H / numSteps;
    const stepD = totalDepth / numSteps;

    for (let i = 0; i < numSteps; i++) {
        const h = (i + 1) * stepH;
        const box = createTempBox('stairStep' + i, stairWidth, h, stepD,
            stairX, h / 2, zMax - (i + 0.5) * stepD, scene);
        collector.push(box);
    }
}
