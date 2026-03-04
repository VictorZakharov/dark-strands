import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3, VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

let _mergedFloors = null;
export function getMergedFloors() { return _mergedFloors; }

let _mergedMidFloors = null;
export function getMergedMidFloors() { return _mergedMidFloors; }

let _mergedStairs = null;
export function getMergedStairs() { return _mergedStairs; }

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
    stairMat.backFaceCulling = false;

    const midFloorMat = new StandardMaterial('midFloorMat', scene);
    midFloorMat.diffuseTexture = loadTex('./assets/textures/wood_planks.jpg', scene);
    midFloorMat.specularColor = new Color3(0.02, 0.02, 0.02);
    midFloorMat.zOffset = 2; // push behind walls at junctions

    const floorMeshes = [];
    const midFloorMeshes = [];
    const stairPos = [], stairNorm = [], stairUv = [], stairIdx = [];
    let stairVerts = 0;
    function appendStair(geom) {
        const off = stairVerts;
        for (let i = 0; i < geom.positions.length; i++) stairPos.push(geom.positions[i]);
        for (let i = 0; i < geom.normals.length; i++) stairNorm.push(geom.normals[i]);
        for (let i = 0; i < geom.uvs.length; i++) stairUv.push(geom.uvs[i]);
        for (let i = 0; i < geom.indices.length; i++) stairIdx.push(geom.indices[i] + off);
        stairVerts += geom.positions.length / 3;
    }

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

            // Mid-floor extends to the wall inner face + 0.03 overlap into the wall.
            // Combined with zOffset=2, walls always win at junctions so the floor
            // doesn't bleed through from outside the building.
            const intLeft = g2w(b.x, 0).x + CFG.WALL_T / 2 - 0.03;
            const intRight = g2w(b.x + b.w - 1, 0).x - CFG.WALL_T / 2 + 0.03;
            const intBack = g2w(0, b.z).z + CFG.WALL_T / 2 - 0.03;
            const intFront = g2w(0, b.z + b.h - 1).z - CFG.WALL_T / 2 + 0.03;

            const stairLeft = stairP.x - CFG.CELL / 2;
            const stairRight = g2w(b.x + b.w - 1, 0).x - CFG.WALL_T / 2;
            const stairFront = g2w(0, s.gzEnd).z + CFG.CELL / 2;

            const floorY = CFG.WALL_H;

            const p1w = stairLeft - intLeft;
            const p1d = intFront - intBack;
            if (p1w > 0.1 && p1d > 0.1) {
                const box = createTempBox('midFloorP1', p1w, FLOOR_THICK, p1d,
                    intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2, scene);
                midFloorMeshes.push(box);
            }

            const p2w = stairRight - stairLeft;
            const p2d = intFront - stairFront;
            if (p2w > 0.1 && p2d > 0.1) {
                const box = createTempBox('midFloorP2', p2w, FLOOR_THICK, p2d,
                    stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2, scene);
                midFloorMeshes.push(box);
            }

            const p3w = intRight - stairRight;
            const p3d = intFront - intBack;
            if (p3w > 0.1 && p3d > 0.1) {
                const box = createTempBox('midFloorP3', p3w, FLOOR_THICK, p3d,
                    stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2, scene);
                midFloorMeshes.push(box);
            }

            const stairBack = g2w(0, b.z).z + CFG.WALL_T / 2;
            const p4d = stairBack - intBack;
            if (p2w > 0.1 && p4d > 0.1) {
                const box = createTempBox('midFloorP4', p2w, FLOOR_THICK, p4d,
                    stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2, scene);
                midFloorMeshes.push(box);
            }

            appendStair(buildStairGeometry(b));
        } else if (b.stories === 2) {
            // Inner face to inner face + 0.06 (0.03 overlap per side)
            const fullW = (b.w - 1) * CFG.CELL - CFG.WALL_T + 0.06;
            const fullH = (b.h - 1) * CFG.CELL - CFG.WALL_T + 0.06;
            const box = createTempBox('midFloorFull', fullW, FLOOR_THICK, fullH,
                c.x, CFG.WALL_H - 0.125, c.z, scene);
            midFloorMeshes.push(box);
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
            _mergedFloors = merged;
        }
    }

    // Merge all mid-floors into one mesh (separate material with backFaceCulling
    // to avoid z-fighting between adjacent pieces and stair boundary faces)
    if (midFloorMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(midFloorMeshes, true, true, undefined, false, true);
        if (merged) {
            merged.name = 'mergedMidFloors';
            merged.material = midFloorMat;
            addShadowCaster(merged);
            enableShadowReceiving(merged);
            _mergedMidFloors = merged;
        }
    }

    // Build stairs as a single mesh from raw geometry
    if (stairPos.length > 0) {
        const mesh = new Mesh('mergedStairs', scene);
        const vd = new VertexData();
        vd.positions = new Float32Array(stairPos);
        vd.normals   = new Float32Array(stairNorm);
        vd.uvs       = new Float32Array(stairUv);
        vd.indices   = new Uint32Array(stairIdx);
        vd.applyToMesh(mesh);
        mesh.material = stairMat;
        addShadowCaster(mesh);
        enableShadowReceiving(mesh);
        _mergedStairs = mesh;
    }
}

/* ─────────────────────────────────────────────────────────────────────
 * Build single-mesh staircase geometry (treads, risers, side profiles,
 * back wall, bottom) — no overlapping faces, no z-fighting.
 * ─────────────────────────────────────────────────────────────────── */
function buildStairGeometry(b) {
    const s = b.stair;
    const stairP1 = g2w(s.gx, s.gzStart);
    const stairP2 = g2w(s.gx, s.gzEnd);

    const xL = stairP1.x - CFG.CELL / 2;
    const xR = g2w(b.x + b.w - 1, 0).x - CFG.WALL_T / 2;
    const zMin = g2w(0, b.z).z + CFG.WALL_T / 2;
    const zMax = stairP2.z + CFG.CELL / 2;
    const totalDepth = zMax - zMin;

    const FLOOR_THICK = 0.5;
    const FLOOR_TOP_OFFSET = -0.125;
    const floorTopY = CFG.WALL_H + FLOOR_TOP_OFFSET + FLOOR_THICK / 2;

    const N = 8;
    const stepH = floorTopY / N;
    const stepD = totalDepth / N;

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let vc = 0;

    function addV(x, y, z, nx, ny, nz) {
        positions.push(x, y, z);
        normals.push(nx, ny, nz);
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ax > ay && ax > az)      uvs.push(z, y);
        else if (ay > ax && ay > az) uvs.push(x, z);
        else                         uvs.push(x, y);
        return vc++;
    }

    function addQuad(i0, i1, i2, i3, nx, ny, nz) {
        const p0x = positions[i0*3], p0y = positions[i0*3+1], p0z = positions[i0*3+2];
        const p1x = positions[i1*3], p1y = positions[i1*3+1], p1z = positions[i1*3+2];
        const p2x = positions[i2*3], p2y = positions[i2*3+1], p2z = positions[i2*3+2];
        const ex = p1x-p0x, ey = p1y-p0y, ez = p1z-p0z;
        const fx = p2x-p0x, fy = p2y-p0y, fz = p2z-p0z;
        const cx = ey*fz - ez*fy, cy = ez*fx - ex*fz, cz = ex*fy - ey*fx;
        if (cx*nx + cy*ny + cz*nz >= 0) {
            indices.push(i0, i3, i2, i0, i2, i1);
        } else {
            indices.push(i0, i1, i2, i0, i2, i3);
        }
    }

    // ── Treads (horizontal, +Y) ──
    for (let i = 0; i < N; i++) {
        const y = (i + 1) * stepH;
        const zF = zMax - i * stepD;
        const zB = zMax - (i + 1) * stepD;
        addQuad(
            addV(xL, y, zF, 0, 1, 0), addV(xR, y, zF, 0, 1, 0),
            addV(xR, y, zB, 0, 1, 0), addV(xL, y, zB, 0, 1, 0),
            0, 1, 0);
    }

    // ── Risers (vertical, +Z — facing front of stairs) ──
    for (let i = 0; i < N; i++) {
        const yB = i * stepH;
        const yT = (i + 1) * stepH;
        const z = zMax - i * stepD;
        addQuad(
            addV(xL, yB, z, 0, 0, 1), addV(xR, yB, z, 0, 0, 1),
            addV(xR, yT, z, 0, 0, 1), addV(xL, yT, z, 0, 0, 1),
            0, 0, 1);
    }

    // ── Back wall (-Z) ──
    addQuad(
        addV(xL, 0, zMin, 0, 0, -1), addV(xR, 0, zMin, 0, 0, -1),
        addV(xR, floorTopY, zMin, 0, 0, -1), addV(xL, floorTopY, zMin, 0, 0, -1),
        0, 0, -1);

    // ── Bottom face (-Y) ──
    addQuad(
        addV(xL, 0, zMin, 0, -1, 0), addV(xR, 0, zMin, 0, -1, 0),
        addV(xR, 0, zMax, 0, -1, 0), addV(xL, 0, zMax, 0, -1, 0),
        0, -1, 0);

    // ── Left side profile (-X) — N horizontal strips ──
    for (let i = 0; i < N; i++) {
        const yB = i * stepH;
        const yT = (i + 1) * stepH;
        const zF = zMax - i * stepD;
        addQuad(
            addV(xL, yB, zMin, -1, 0, 0), addV(xL, yB, zF, -1, 0, 0),
            addV(xL, yT, zF, -1, 0, 0), addV(xL, yT, zMin, -1, 0, 0),
            -1, 0, 0);
    }

    // ── Right side profile (+X) — N horizontal strips ──
    for (let i = 0; i < N; i++) {
        const yB = i * stepH;
        const yT = (i + 1) * stepH;
        const zF = zMax - i * stepD;
        addQuad(
            addV(xR, yB, zMin, 1, 0, 0), addV(xR, yB, zF, 1, 0, 0),
            addV(xR, yT, zF, 1, 0, 0), addV(xR, yT, zMin, 1, 0, 0),
            1, 0, 0);
    }

    return { positions, normals, uvs, indices };
}
