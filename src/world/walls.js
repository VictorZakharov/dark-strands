import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3, VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

let _wallMesh = null;
export function getWallMesh() { return _wallMesh; }

function loadTex(path, uScale, vScale, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = uScale;
    tex.vScale = vScale;
    return tex;
}

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

/* ─────────────────────────────────────────────────────────────────────
 * Band-decompose a rectangle [runMin,runMax]×[vMin,vMax] with rectangular
 * openings.  Returns filled quads: {x1, x2, y1, y2}.
 * ─────────────────────────────────────────────────────────────────── */
function bandDecompose(runMin, runMax, vMin, vMax, openings) {
    const EPS = 0.0001;
    const ySet = new Set();
    ySet.add(vMin); ySet.add(vMax);
    for (const op of openings) {
        if (op.vMin > vMin) ySet.add(op.vMin);
        if (op.vMax < vMax) ySet.add(op.vMax);
    }
    const ys = [...ySet].sort((a, b) => a - b);
    const quads = [];

    for (let i = 0; i < ys.length - 1; i++) {
        const y1 = ys[i], y2 = ys[i + 1];
        if (y2 - y1 < EPS) continue;
        const yMid = (y1 + y2) / 2;

        // Openings overlapping this band
        const active = openings.filter(
            op => op.vMin < y2 - EPS && op.vMax > y1 + EPS);

        const xSet = new Set();
        xSet.add(runMin); xSet.add(runMax);
        for (const op of active) {
            xSet.add(Math.max(op.runMin, runMin));
            xSet.add(Math.min(op.runMax, runMax));
        }
        const xs = [...xSet].sort((a, b) => a - b);

        for (let j = 0; j < xs.length - 1; j++) {
            const x1 = xs[j], x2 = xs[j + 1];
            if (x2 - x1 < EPS) continue;
            const xMid = (x1 + x2) / 2;

            const isOpen = active.some(op =>
                xMid > op.runMin + EPS && xMid < op.runMax - EPS &&
                yMid > op.vMin + EPS && yMid < op.vMax - EPS);

            if (!isOpen) quads.push({ x1, x2, y1, y2 });
        }
    }
    return quads;
}

/* ─────────────────────────────────────────────────────────────────────
 * Build VertexData for one wall side of a building.
 *
 *   axis      – 'x' (NS walls, run along X) or 'z' (EW walls, run along Z)
 *   perpPos   – fixed world coord on the perpendicular axis (wall center)
 *   perpDir   – +1 / -1 : outward direction on the perp axis
 *   runMin/Max – extent along the run axis
 *   vMin/vMax – vertical extent (Y)
 *   T         – wall thickness
 *   openings  – [{runMin, runMax, vMin, vMax}]
 * ─────────────────────────────────────────────────────────────────── */
function buildSideGeometry(axis, perpPos, perpDir, runMin, runMax, vMin, vMax, T, openings) {
    const quads = bandDecompose(runMin, runMax, vMin, vMax, openings);

    const positions = [];
    const normals   = [];
    const uvs       = [];
    const indices   = [];
    let vc = 0;

    const halfT  = T / 2;
    const frontD = perpDir * halfT;   // outward offset
    const backD  = -perpDir * halfT;  // inward offset

    // Normal vectors for main faces
    const fn = axis === 'x' ? [0, 0, perpDir] : [perpDir, 0, 0];
    const bn = axis === 'x' ? [0, 0, -perpDir] : [-perpDir, 0, 0];

    // (run, v, depthOffset) → world [x, y, z]
    function toWorld(run, v, d) {
        return axis === 'x'
            ? [run, v, perpPos + d]
            : [perpPos + d, v, run];
    }

    // Add a vertex, return its index.  UV uses triplanar projection.
    function addV(run, v, d, nx, ny, nz) {
        const [wx, wy, wz] = toWorld(run, v, d);
        positions.push(wx, wy, wz);
        normals.push(nx, ny, nz);
        // Triplanar UV from world pos + normal
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        if (ax > ay && ax > az)      uvs.push(wz, wy);  // X-facing
        else if (ay > ax && ay > az) uvs.push(wx, wz);  // Y-facing
        else                         uvs.push(wx, wy);  // Z-facing
        return vc++;
    }

    // ── Shared-vertex maps for front / back faces ──
    const fMap = new Map();
    const bMap = new Map();

    function vkey(run, v) {
        return ((run * 10000) | 0) + ',' + ((v * 10000) | 0);
    }
    function fv(run, v) {
        const k = vkey(run, v);
        let idx = fMap.get(k);
        if (idx !== undefined) return idx;
        idx = addV(run, v, frontD, ...fn);
        fMap.set(k, idx);
        return idx;
    }
    function bv(run, v) {
        const k = vkey(run, v);
        let idx = bMap.get(k);
        if (idx !== undefined) return idx;
        idx = addV(run, v, backD, ...bn);
        bMap.set(k, idx);
        return idx;
    }

    // Add a quad with correct winding for the given intended normal.
    // Babylon.js RHS uses CW as front face, so we need the cross product
    // of triangle edges to point OPPOSITE to the intended outward normal.
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

    // ── Front face ──
    for (const q of quads) {
        addQuad(
            fv(q.x1, q.y1), fv(q.x2, q.y1),
            fv(q.x2, q.y2), fv(q.x1, q.y2),
            ...fn);
    }

    // ── Back face ──
    for (const q of quads) {
        addQuad(
            bv(q.x1, q.y1), bv(q.x2, q.y1),
            bv(q.x2, q.y2), bv(q.x1, q.y2),
            ...bn);
    }

    // ── Edge faces around openings (jambs + lintels) ──
    const EPS = 0.001;
    for (const op of openings) {
        const oL = Math.max(op.runMin, runMin);
        const oR = Math.min(op.runMax, runMax);
        const oB = Math.max(op.vMin, vMin);
        const oT = Math.min(op.vMax, vMax);
        if (oR - oL < EPS || oT - oB < EPS) continue;

        // Left jamb – faces +run into opening
        const lN = axis === 'x' ? [1, 0, 0] : [0, 0, 1];
        addQuad(
            addV(oL, oB, frontD, ...lN), addV(oL, oB, backD, ...lN),
            addV(oL, oT, backD, ...lN),  addV(oL, oT, frontD, ...lN),
            ...lN);

        // Right jamb – faces -run into opening
        const rN = axis === 'x' ? [-1, 0, 0] : [0, 0, -1];
        addQuad(
            addV(oR, oB, frontD, ...rN), addV(oR, oB, backD, ...rN),
            addV(oR, oT, backD, ...rN),  addV(oR, oT, frontD, ...rN),
            ...rN);

        // Bottom threshold – faces up (+Y) into opening
        if (oB > vMin + EPS) {
            const bN = [0, 1, 0];
            addQuad(
                addV(oL, oB, frontD, ...bN), addV(oR, oB, frontD, ...bN),
                addV(oR, oB, backD, ...bN),  addV(oL, oB, backD, ...bN),
                ...bN);
        }

        // Top lintel – faces down (-Y) into opening
        if (oT < vMax - EPS) {
            const tN = [0, -1, 0];
            addQuad(
                addV(oL, oT, frontD, ...tN), addV(oR, oT, frontD, ...tN),
                addV(oR, oT, backD, ...tN),  addV(oL, oT, backD, ...tN),
                ...tN);
        }
    }

    // ── Top cap of the wall (faces up) ──
    {
        const tN = [0, 1, 0];
        addQuad(
            addV(runMin, vMax, frontD, ...tN), addV(runMax, vMax, frontD, ...tN),
            addV(runMax, vMax, backD, ...tN),  addV(runMin, vMax, backD, ...tN),
            ...tN);
    }

    return { positions, normals, uvs, indices };
}

/* ═══════════════════════════════════════════════════════════════════
 * buildWalls  —  all 4 walls per building as unified geometry
 * ═══════════════════════════════════════════════════════════════════ */
export function buildWalls(scene) {
    const buildings = getBuildings();

    const wallMat = new StandardMaterial('wallMat', scene);
    wallMat.diffuseTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
    wallMat.specularColor = new Color3(0.02, 0.02, 0.02);

    // Accumulate wall geometry into one big buffer
    const allPos = [];
    const allNorm = [];
    const allUv = [];
    const allIdx = [];
    let totalVerts = 0;

    function append(geom) {
        const off = totalVerts;
        for (let i = 0; i < geom.positions.length; i++) allPos.push(geom.positions[i]);
        for (let i = 0; i < geom.normals.length; i++)   allNorm.push(geom.normals[i]);
        for (let i = 0; i < geom.uvs.length; i++)       allUv.push(geom.uvs[i]);
        for (let i = 0; i < geom.indices.length; i++)    allIdx.push(geom.indices[i] + off);
        totalVerts += geom.positions.length / 3;
    }

    const T = CFG.WALL_T;
    const doorTopY = CFG.WALL_H * 0.88;
    const vMin = -0.5;                     // walls extend below ground

    for (const b of buildings) {
        const wallH = b.stories * CFG.WALL_H;
        const vMax  = wallH;

        // World coords of building corner cell centres
        const nwP = g2w(b.x, b.z);
        const neP = g2w(b.x + b.w - 1, b.z);
        const swP = g2w(b.x, b.z + b.h - 1);

        // All walls span full extent including corners — perpendicular
        // walls share edges at corners (no overlap, no gap)
        const hT = T / 2;
        const nsRunMin = nwP.x - hT;
        const nsRunMax = neP.x + hT;
        const ewRunMin = nwP.z - hT;
        const ewRunMax = swP.z + hT;

        const sides = [
            { side: 'north', axis: 'x', perpPos: nwP.z, perpDir: -1, runMin: nsRunMin, runMax: nsRunMax },
            { side: 'south', axis: 'x', perpPos: swP.z, perpDir:  1, runMin: nsRunMin, runMax: nsRunMax },
        ];

        // EW walls only exist when building has >2 rows (MIN_ROOM=4, so always true)
        if (b.h > 2) {
            sides.push(
                { side: 'west',  axis: 'z', perpPos: nwP.x, perpDir: -1, runMin: ewRunMin, runMax: ewRunMax },
                { side: 'east',  axis: 'z', perpPos: neP.x, perpDir:  1, runMin: ewRunMin, runMax: ewRunMax },
            );
        }

        for (const s of sides) {
            const isNS = s.axis === 'x';
            const openings = [];

            // Doors → opening from wall bottom to doorTopY
            for (const d of b.doors) {
                if (d.wall !== s.side) continue;
                const dCenter = isNS ? g2w(d.gx, d.gz).x : g2w(d.gx, d.gz).z;
                openings.push({
                    runMin: dCenter - CFG.CELL / 2,
                    runMax: dCenter + CFG.CELL / 2,
                    vMin,
                    vMax: doorTopY,
                });
            }

            // Windows → rectangular opening per floor
            for (const w of b.windows) {
                if (w.wall !== s.side) continue;
                const wCenter = isNS ? g2w(w.gx, w.gz).x : g2w(w.gx, w.gz).z;
                const winW = CFG.CELL * (w.wFrac || 0.6);
                const winH = CFG.WALL_H * (w.hFrac || 0.4);
                const winVCenter = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
                openings.push({
                    runMin: wCenter - winW / 2,
                    runMax: wCenter + winW / 2,
                    vMin: winVCenter - winH / 2,
                    vMax: winVCenter + winH / 2,
                });
            }

            append(buildSideGeometry(
                s.axis, s.perpPos, s.perpDir,
                s.runMin, s.runMax, vMin, vMax, T, openings));
        }

    }

    if (allPos.length > 0) {
        const mesh = new Mesh('walls', scene);
        const vd = new VertexData();
        vd.positions = new Float32Array(allPos);
        vd.normals   = new Float32Array(allNorm);
        vd.uvs       = new Float32Array(allUv);
        vd.indices   = new Uint32Array(allIdx);
        vd.applyToMesh(mesh);

        mesh.material = wallMat;
        addShadowCaster(mesh);
        enableShadowReceiving(mesh);
        _wallMesh = mesh;
    }

}

/* ═══════════════════════════════════════════════════════════════════
 * buildRoofs
 * ═══════════════════════════════════════════════════════════════════ */
export function buildRoofs(scene) {
    const buildings = getBuildings();

    const flatMat = new StandardMaterial('flatRoofMat', scene);
    flatMat.diffuseTexture = loadTex('./assets/textures/stone_wall.jpg', 1, 1, scene);
    flatMat.diffuseColor = new Color3(0.4, 0.4, 0.4);
    flatMat.specularColor = new Color3(0.02, 0.02, 0.02);
    flatMat.backFaceCulling = false;

    const slantMat = new StandardMaterial('slantRoofMat', scene);
    slantMat.diffuseTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
    slantMat.diffuseColor = new Color3(0.545, 0.271, 0.075);
    slantMat.specularColor = new Color3(0.02, 0.02, 0.02);
    slantMat.backFaceCulling = false;

    const overhang = 0.4;
    const ridgeHeight = 1.8;
    const flatMeshes = [];
    const slantMeshes = [];

    for (const b of buildings) {
        const topY = b.stories * CFG.WALL_H;
        const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
        const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
        const c = getBuildingCenter(b);
        const ROOF_OVERLAP = 0.15;

        if (b.roofType === 'flat') {
            const rw = bw + overhang, rh = 0.25 + ROOF_OVERLAP, rd = bh + overhang;
            const box = MeshBuilder.CreateBox('rf', { width: rw, height: rh, depth: rd }, scene);
            box.position = new Vector3(c.x, topY + 0.125 - ROOF_OVERLAP / 2, c.z);
            // World-space UVs for flat roof
            const pos = box.getVerticesData('position');
            const nrm = box.getVerticesData('normal');
            const uv  = new Float32Array(pos.length / 3 * 2);
            for (let i = 0; i < pos.length / 3; i++) {
                const wx = pos[i*3] + box.position.x;
                const wy = pos[i*3+1] + box.position.y;
                const wz = pos[i*3+2] + box.position.z;
                const ax = Math.abs(nrm[i*3]), ay = Math.abs(nrm[i*3+1]), az = Math.abs(nrm[i*3+2]);
                if (ax > ay && ax > az)      { uv[i*2] = wz; uv[i*2+1] = wy; }
                else if (ay > ax && ay > az) { uv[i*2] = wx; uv[i*2+1] = wz; }
                else                         { uv[i*2] = wx; uv[i*2+1] = wy; }
            }
            box.setVerticesData('uv', uv);
            flatMeshes.push(box);
        } else {
            const longAxis = bw >= bh;
            const roofLen  = (longAxis ? bw : bh) + overhang * 2;
            const roofSpan = (longAxis ? bh : bw) + overhang * 2;
            const halfSpan = roofSpan / 2;
            const halfLen  = roofLen / 2;
            const slopeLen = Math.sqrt(halfSpan * halfSpan + ridgeHeight * ridgeHeight);

            const positions = [
                -halfSpan, 0, -halfLen,  halfSpan, 0, -halfLen,  0, ridgeHeight, -halfLen,
                -halfSpan, 0,  halfLen,  0, ridgeHeight,  halfLen,  halfSpan, 0,  halfLen,
                -halfSpan, 0, -halfLen,  0, ridgeHeight, -halfLen,
                 0, ridgeHeight,  halfLen, -halfSpan, 0,  halfLen,
                 halfSpan, 0, -halfLen,  halfSpan, 0,  halfLen,
                 0, ridgeHeight,  halfLen,  0, ridgeHeight, -halfLen,
                -halfSpan, 0, -halfLen, -halfSpan, 0,  halfLen,
                 halfSpan, 0,  halfLen,  halfSpan, 0, -halfLen,
            ];
            const roofUvs = [
                0, 0, roofSpan, 0, halfSpan, ridgeHeight,
                0, 0, halfSpan, ridgeHeight, roofSpan, 0,
                0, 0, slopeLen, 0, slopeLen, roofLen, 0, roofLen,
                0, 0, 0, roofLen, slopeLen, roofLen, slopeLen, 0,
                0, 0, 0, roofLen, roofSpan, roofLen, roofSpan, 0,
            ];
            const roofIndices = [
                0, 1, 2,  3, 4, 5,
                6, 7, 8,  6, 8, 9,
                10,11,12, 10,12,13,
                14,15,16, 14,16,17,
            ];

            const mesh = new Mesh('rs', scene);
            const vd = new VertexData();
            vd.positions = positions;
            vd.indices   = roofIndices;
            vd.uvs       = roofUvs;
            VertexData.ComputeNormals(positions, roofIndices, vd.normals = []);
            vd.applyToMesh(mesh);

            if (longAxis) mesh.rotation.y = Math.PI / 2;
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
