import { MeshBuilder, Mesh, StandardMaterial, Texture, DynamicTexture, Color3, Vector3, VertexData } from 'babylonjs';
import { CFG } from '../config.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';
import { addFogDepthMesh } from '../core/postfx.js';

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

// ── PURE-TRIM-MATH-START (plain math, no Babylon — this block is extracted
//    and executed by a Node harness to verify trim placement never overlaps
//    door/window cutouts. Keep it dependency-free.)

/* Per-building visual style, deterministic from the building's index */
function styleFor(bi) {
    return ['stone', 'plaster', 'timber'][bi % 3];
}

/* Open-interval rect overlap in wall-plane coords (used by the harness) */
function rectsOverlap(a, b, eps) {
    const e = eps === undefined ? 0.001 : eps;
    return a.run0 < b.run1 - e && a.run1 > b.run0 + e &&
           a.v0 < b.v1 - e && a.v1 > b.v0 + e;
}

/* Split [r0,r1] into free segments around blockers [{run0,run1}] */
function segmentRun(r0, r1, blockers, minLen) {
    const iv = blockers
        .map(op => [Math.max(op.run0, r0), Math.min(op.run1, r1)])
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0]);
    const segs = [];
    let cur = r0;
    for (const [a, b] of iv) {
        if (a - cur >= minLen) segs.push([cur, a]);
        cur = Math.max(cur, b);
    }
    if (r1 - cur >= minLen) segs.push([cur, r1]);
    return segs;
}

/* ─────────────────────────────────────────────────────────────────────
 * Compute timber-trim pieces for one wall side, in wall-plane coords
 * (run along the wall × v vertical).  side = {style, stories, runMin,
 * runMax, vMax, openings:[{run0,run1,v0,v1,kind:'door'|'window'}]},
 * S = trim constants.  Returns rects {kind, run0, run1, v0, v1, mount:
 * 'through'|'face', proud}; braces additionally carry dir (±1) and are
 * rendered as the rect's diagonal.
 * Invariant (checked by the Node harness): no piece intersects any
 * opening rect, and beams/braces never intersect surround pieces.
 * ─────────────────────────────────────────────────────────────────── */
function computeSideTrims(side, S) {
    const pieces = [];
    const T = S.TRIM_T;

    // ── Door surrounds + window sills/lintels (ALL styles) ──
    for (const op of side.openings) {
        if (op.kind === 'door') {
            const jTop = op.v1 + 0.015; // lintel bottom — clears the door swing
            pieces.push(
                { kind: 'doorJamb',   run0: op.run0 - 0.15, run1: op.run0 - 0.01, v0: -0.05, v1: jTop, mount: 'through', proud: S.SURROUND_PROUD },
                { kind: 'doorJamb',   run0: op.run1 + 0.01, run1: op.run1 + 0.15, v0: -0.05, v1: jTop, mount: 'through', proud: S.SURROUND_PROUD },
                { kind: 'doorLintel', run0: op.run0 - 0.15, run1: op.run1 + 0.15, v0: jTop,  v1: jTop + 0.16, mount: 'through', proud: S.SURROUND_PROUD });
        } else {
            // Window frame bars (windows.js) occupy 0.07 past the opening and
            // stick 0.05 out of the wall — sill/lintel sit beyond them both ways
            pieces.push(
                { kind: 'winSill',   run0: op.run0 - 0.16, run1: op.run1 + 0.16, v0: op.v0 - 0.18, v1: op.v0 - 0.08, mount: 'through', proud: S.SURROUND_PROUD },
                { kind: 'winLintel', run0: op.run0 - 0.16, run1: op.run1 + 0.16, v0: op.v1 + 0.08, v1: op.v1 + 0.20, mount: 'through', proud: S.SURROUND_PROUD });
        }
    }

    // A surround can poke into a NEIGHBOURING opening (widest window sill
    // beside a door cell) — clip every surround back out of any opening
    const surrounds = [];
    for (const p of pieces) {
        let ok = true;
        for (const op of side.openings) {
            if (p.v0 >= op.v1 - 0.001 || p.v1 <= op.v0 + 0.001) continue;
            if (p.run1 > op.run0 - 0.01 && p.run0 < op.run0) p.run1 = op.run0 - 0.01;
            if (p.run0 < op.run1 + 0.01 && p.run1 > op.run1) p.run0 = Math.max(p.run0, op.run1 + 0.01);
            if (p.run1 - p.run0 < 0.05) { ok = false; break; }
        }
        if (ok) surrounds.push(p);
    }

    if (side.style === 'stone') return surrounds;
    const out = surrounds.slice();

    // ── Horizontal beams (plaster + timber): base-course cap, story lines, eaves ──
    // Eave beam sits 0.02 below the wall top: the flat-roof underside is at
    // exactly vMax-0.15 and a beam band of [vMax-0.15, vMax] would z-fight it.
    const eaveY = side.vMax - T / 2 - 0.02;
    const beamYs = [S.BASE_H];
    for (let s = 1; s < side.stories; s++) beamYs.push(s * S.WALL_H);
    beamYs.push(eaveY);
    const CLR = 0.2; // clearance past openings — must exceed the 0.16/0.15 surround reach
    for (const yC of beamYs) {
        const v0 = yC - T / 2, v1 = yC + T / 2;
        const blockers = side.openings
            .filter(op => op.v0 - CLR < v1 && op.v1 + CLR > v0)
            .map(op => ({ run0: op.run0 - CLR, run1: op.run1 + CLR }));
        for (const [a, b] of segmentRun(side.runMin, side.runMax, blockers, 0.3)) {
            out.push({ kind: 'beam', run0: a, run1: b, v0, v1, mount: 'face', proud: S.TRIM_PROUD });
        }
    }

    // ── Diagonal braces (timber only), between the beam lines of each story ──
    if (side.style === 'timber') {
        for (let s = 0; s < side.stories; s++) {
            const loBeam = s === 0 ? S.BASE_H : s * S.WALL_H;
            const hiBeam = (s + 1 === side.stories) ? eaveY : (s + 1) * S.WALL_H;
            const v0 = loBeam + T / 2 + 0.1;
            const v1 = hiBeam - T / 2 - 0.1;
            if (v1 - v0 < 1.2) continue;
            const CLB = 0.25; // extra clearance: braces stay clear of surrounds too
            const blockers = side.openings
                .filter(op => op.v0 - CLB < v1 && op.v1 + CLB > v0)
                .map(op => ({ run0: op.run0 - CLB, run1: op.run1 + CLB }));
            const segs = segmentRun(side.runMin + 0.15, side.runMax - 0.15, blockers, S.BRACE_MIN_SEG);
            for (let k = 0; k < segs.length; k++) {
                if ((S.bi * 31 + s * 13 + k * 7) % 5 >= 3) continue; // ~60% of segments
                const [a, b] = segs[k];
                const reach = Math.min(b - a - 0.2, (v1 - v0) * 0.85, 2.4);
                if (reach < 0.6) continue;
                const c = (a + b) / 2;
                out.push({
                    kind: 'brace', run0: c - reach / 2, run1: c + reach / 2, v0, v1,
                    dir: ((S.bi + s + k) % 2) ? 1 : -1, mount: 'face', proud: S.TRIM_PROUD,
                });
            }
        }
    }
    return out;
}

/* Corner posts wrapping each building corner (plaster + timber styles).
 * bounds = outer wall-face planes {x0,x1,z0,z1} and vMax. Openings sit at
 * interior cells (≥ 1 cell = 2u from a corner) so posts can never hit them. */
function computeCornerPosts(bounds, S) {
    const W = S.CORNER_W, P = S.SURROUND_PROUD;
    const posts = [];
    for (const [cx, sx] of [[bounds.x0, -1], [bounds.x1, 1]]) {
        for (const [cz, sz] of [[bounds.z0, -1], [bounds.z1, 1]]) {
            const xOut = cx + sx * P, xIn = cx - sx * (W - P);
            const zOut = cz + sz * P, zIn = cz - sz * (W - P);
            posts.push({
                kind: 'post',
                x0: Math.min(xOut, xIn), x1: Math.max(xOut, xIn),
                z0: Math.min(zOut, zIn), z1: Math.max(zOut, zIn),
                // top 0.01 below the wall top — avoids coplanar top faces
                v0: -0.1, v1: bounds.vMax - 0.01,
            });
        }
    }
    return posts;
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

// ── PURE-TRIM-MATH-END

/* ─────────────────────────────────────────────────────────────────────
 * Plaster material — procedural lime-wash DynamicTexture with tileable
 * mottling (blotches drawn at 3×3 wrapped offsets so the 4u tiling has
 * no seams).
 * ─────────────────────────────────────────────────────────────────── */
function makePlasterMaterial(scene) {
    const size = 256;
    const dt = new DynamicTexture('plasterTex', size, scene, true);
    dt.wrapU = Texture.WRAP_ADDRESSMODE;
    dt.wrapV = Texture.WRAP_ADDRESSMODE;
    const ctx = dt.getContext();
    ctx.fillStyle = '#d9cfb8';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 130; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        const r = 6 + Math.random() * 24;
        ctx.fillStyle = Math.random() < 0.5
            ? 'rgba(240, 233, 214, 0.10)' : 'rgba(150, 138, 114, 0.08)';
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) {
                ctx.beginPath();
                ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
    // Fine sand-grain speckle
    for (let i = 0; i < 900; i++) {
        ctx.fillStyle = Math.random() < 0.5
            ? 'rgba(120, 110, 88, 0.06)' : 'rgba(255, 250, 236, 0.06)';
        ctx.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
    }
    dt.update();
    const mat = new StandardMaterial('wallPlasterMat', scene);
    mat.diffuseTexture = dt;
    mat.diffuseColor = new Color3(1.0, 0.96, 0.88); // warm lime-wash tint
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    return mat;
}

/* Append one quad (4 pts, shared normal) to a geometry accumulator.
 * Winding rule matches buildSideGeometry.addQuad (RHS front face = CW). */
function pushQuad(out, pts, n, uvs) {
    const base = out.pos.length / 3;
    for (let k = 0; k < 4; k++) {
        out.pos.push(pts[k][0], pts[k][1], pts[k][2]);
        out.norm.push(n[0], n[1], n[2]);
        out.uv.push(uvs[k][0], uvs[k][1]);
    }
    const [p0, p1, p2] = pts;
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2];
    const fx = p2[0] - p0[0], fy = p2[1] - p0[1], fz = p2[2] - p0[2];
    const cx = ey * fz - ez * fy, cy = ez * fx - ex * fz, cz = ex * fy - ey * fx;
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) {
        out.idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
    } else {
        out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
}

/* ─────────────────────────────────────────────────────────────────────
 * Plaster skin for one wall side — flat quads floating PLASTER_PROUD off
 * both stone faces (exterior + interior), from the base-course line up to
 * the wall top, with the same door/window cutouts as the wall itself.
 * The stone wall 0.015u behind keeps handling picking, physics, fog
 * depth, torch shadows and water reflections — the skin is visual only.
 * ─────────────────────────────────────────────────────────────────── */
function emitPlasterSkin(rec, SW, out) {
    const halfT = CFG.WALL_T / 2;
    const quads = bandDecompose(rec.runMin, rec.runMax, SW.BASE_COURSE_H, rec.vMax, rec.openings);
    const isNS = rec.axis === 'x';
    for (const face of [1, -1]) { // 1 = exterior, -1 = interior
        const dirSign = rec.perpDir * face;
        const d = rec.perpPos + dirSign * (halfT + SW.PLASTER_PROUD);
        const n = isNS ? [0, 0, dirSign] : [dirSign, 0, 0];
        for (const q of quads) {
            const corners = [[q.x1, q.y1], [q.x2, q.y1], [q.x2, q.y2], [q.x1, q.y2]];
            const pts = corners.map(([r, v]) => (isNS ? [r, v, d] : [d, v, r]));
            const uvs = corners.map(([r, v]) => [r * SW.PLASTER_UV, v * SW.PLASTER_UV]);
            pushQuad(out, pts, n, uvs);
        }
    }
}

/* Convert a trim piece (wall-plane rect) into a box mesh on the side's face */
function makeTrimBoxMesh(rec, piece, scene) {
    const isNS = rec.axis === 'x';
    const halfT = CFG.WALL_T / 2;
    const runLen = piece.run1 - piece.run0;
    const runC = (piece.run0 + piece.run1) / 2;
    const vLen = piece.v1 - piece.v0;
    const vC = (piece.v0 + piece.v1) / 2;
    let depth, perpC;
    if (piece.mount === 'through') {
        // Spans the whole wall thickness, proud on BOTH faces
        depth = CFG.WALL_T + piece.proud * 2;
        perpC = rec.perpPos;
    } else {
        // Face-mounted: embedded 0.07 into the wall, proud by piece.proud
        depth = 0.1;
        perpC = rec.perpPos + rec.perpDir * (halfT + piece.proud - depth / 2);
    }
    let box;
    if (piece.kind === 'brace') {
        const len = Math.hypot(runLen, vLen); // rect diagonal
        const angle = piece.dir * Math.atan2(runLen, vLen);
        box = isNS
            ? MeshBuilder.CreateBox('trim', { width: 0.14, height: len, depth }, scene)
            : MeshBuilder.CreateBox('trim', { width: depth, height: len, depth: 0.14 }, scene);
        if (isNS) box.rotation.z = angle;
        else box.rotation.x = angle;
    } else {
        box = isNS
            ? MeshBuilder.CreateBox('trim', { width: runLen, height: vLen, depth }, scene)
            : MeshBuilder.CreateBox('trim', { width: depth, height: vLen, depth: runLen }, scene);
    }
    box.position = new Vector3(isNS ? runC : perpC, vC, isNS ? perpC : runC);
    box.bakeCurrentTransformIntoVertices();
    return box;
}

/* Corner post rect (plan-space) → box mesh */
function makePostBoxMesh(post, scene) {
    const box = MeshBuilder.CreateBox('trim', {
        width: post.x1 - post.x0,
        height: post.v1 - post.v0,
        depth: post.z1 - post.z0,
    }, scene);
    box.position = new Vector3(
        (post.x0 + post.x1) / 2, (post.v0 + post.v1) / 2, (post.z0 + post.z1) / 2);
    box.bakeCurrentTransformIntoVertices();
    return box;
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

    // Per-building visual style data (plaster skins + timber trim, visual only)
    const SW = CFG.WALL_STYLE;
    const sideRecs = [];
    const buildingRecs = [];

    for (let bi = 0; bi < buildings.length; bi++) {
        const b = buildings[bi];
        const style = styleFor(bi);
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

        buildingRecs.push({
            style, has4: b.h > 2,
            bounds: { x0: nsRunMin, x1: nsRunMax, z0: ewRunMin, z1: ewRunMax, vMax },
        });

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
            const trimOps = []; // same rects in {run0,run1,v0,v1,kind} form

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
                trimOps.push({
                    run0: dCenter - CFG.CELL / 2, run1: dCenter + CFG.CELL / 2,
                    v0: vMin, v1: doorTopY, kind: 'door',
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
                trimOps.push({
                    run0: wCenter - winW / 2, run1: wCenter + winW / 2,
                    v0: winVCenter - winH / 2, v1: winVCenter + winH / 2, kind: 'window',
                });
            }

            append(buildSideGeometry(
                s.axis, s.perpPos, s.perpDir,
                s.runMin, s.runMax, vMin, vMax, T, openings));

            sideRecs.push({
                bi, style, stories: b.stories,
                axis: s.axis, perpPos: s.perpPos, perpDir: s.perpDir,
                runMin: s.runMin, runMax: s.runMax, vMax,
                openings, trimOps,
            });
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

    /* ── Per-building visual styles (visual only, no physics/grid impact):
     *    plaster skins + one merged timber-trim mesh.
     *    Wall materials stay at 3 total: stone / plaster / wood trim. ── */
    const skin = { pos: [], norm: [], uv: [], idx: [] };
    const trimBoxes = [];
    const S = {
        WALL_H: CFG.WALL_H, BASE_H: SW.BASE_COURSE_H,
        TRIM_T: SW.TRIM_T, TRIM_PROUD: SW.TRIM_PROUD,
        SURROUND_PROUD: SW.SURROUND_PROUD, BRACE_MIN_SEG: SW.BRACE_MIN_SEG,
        bi: 0,
    };

    for (const rec of sideRecs) {
        if (rec.style === 'plaster') emitPlasterSkin(rec, SW, skin);
        S.bi = rec.bi;
        const pieces = computeSideTrims({
            style: rec.style, stories: rec.stories,
            runMin: rec.runMin, runMax: rec.runMax, vMax: rec.vMax,
            openings: rec.trimOps,
        }, S);
        for (const piece of pieces) trimBoxes.push(makeTrimBoxMesh(rec, piece, scene));
    }
    for (const br of buildingRecs) {
        if (br.style === 'stone' || !br.has4) continue;
        for (const post of computeCornerPosts(br.bounds, SW)) {
            trimBoxes.push(makePostBoxMesh(post, scene));
        }
    }

    if (skin.idx.length > 0) {
        const mesh = new Mesh('wallsPlaster', scene);
        const vd = new VertexData();
        vd.positions = new Float32Array(skin.pos);
        vd.normals   = new Float32Array(skin.norm);
        vd.uvs       = new Float32Array(skin.uv);
        vd.indices   = new Uint32Array(skin.idx);
        vd.applyToMesh(mesh);
        mesh.material = makePlasterMaterial(scene);
        mesh.isPickable = false; // rays must reach the stone 'walls' 0.015u behind
        enableShadowReceiving(mesh);
        // NOT a sun/torch shadow caster and NOT in the fog depth pass — the
        // stone wall face right behind the skin already writes both.
        mesh.freezeWorldMatrix();
    }

    if (trimBoxes.length > 0) {
        const trimMat = new StandardMaterial('wallTrimMat', scene);
        trimMat.diffuseTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
        trimMat.diffuseColor = new Color3(0.45, 0.33, 0.21); // aged oak
        trimMat.specularColor = new Color3(0.02, 0.02, 0.02);
        const merged = Mesh.MergeMeshes(trimBoxes, true, true, undefined, false, false);
        if (merged) {
            merged.name = 'wallTrims';
            merged.material = trimMat;
            merged.isPickable = false; // visual only — camera raycasts pay per triangle
            addShadowCaster(merged);
            enableShadowReceiving(merged);
            addFogDepthMesh(merged); // corner posts/eave beams silhouette against sky
            merged.freezeWorldMatrix();
        }
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

            const FASCIA = 0.45; // vertical eave boards — seal the wall-top gap
            const positions = [
                -halfSpan, 0, -halfLen,  halfSpan, 0, -halfLen,  0, ridgeHeight, -halfLen,
                -halfSpan, 0,  halfLen,  0, ridgeHeight,  halfLen,  halfSpan, 0,  halfLen,
                -halfSpan, 0, -halfLen,  0, ridgeHeight, -halfLen,
                 0, ridgeHeight,  halfLen, -halfSpan, 0,  halfLen,
                 halfSpan, 0, -halfLen,  halfSpan, 0,  halfLen,
                 0, ridgeHeight,  halfLen,  0, ridgeHeight, -halfLen,
                -halfSpan, 0, -halfLen, -halfSpan, 0,  halfLen,
                 halfSpan, 0,  halfLen,  halfSpan, 0, -halfLen,
                // fascia boards: eave sides
                 halfSpan, 0, -halfLen,  halfSpan, 0,  halfLen,
                 halfSpan, -FASCIA,  halfLen,  halfSpan, -FASCIA, -halfLen,
                -halfSpan, 0, -halfLen, -halfSpan, 0,  halfLen,
                -halfSpan, -FASCIA,  halfLen, -halfSpan, -FASCIA, -halfLen,
                // fascia boards: gable ends
                -halfSpan, 0, -halfLen,  halfSpan, 0, -halfLen,
                 halfSpan, -FASCIA, -halfLen, -halfSpan, -FASCIA, -halfLen,
                -halfSpan, 0,  halfLen,  halfSpan, 0,  halfLen,
                 halfSpan, -FASCIA,  halfLen, -halfSpan, -FASCIA,  halfLen,
            ];
            const roofUvs = [
                0, 0, roofSpan, 0, halfSpan, ridgeHeight,
                0, 0, halfSpan, ridgeHeight, roofSpan, 0,
                0, 0, slopeLen, 0, slopeLen, roofLen, 0, roofLen,
                0, 0, 0, roofLen, slopeLen, roofLen, slopeLen, 0,
                0, 0, 0, roofLen, roofSpan, roofLen, roofSpan, 0,
                0, 0, roofLen, 0, roofLen, FASCIA, 0, FASCIA,
                0, 0, roofLen, 0, roofLen, FASCIA, 0, FASCIA,
                0, 0, roofSpan, 0, roofSpan, FASCIA, 0, FASCIA,
                0, 0, roofSpan, 0, roofSpan, FASCIA, 0, FASCIA,
            ];
            const roofIndices = [
                0, 1, 2,  3, 4, 5,
                6, 7, 8,  6, 8, 9,
                10,11,12, 10,12,13,
                14,15,16, 14,16,17,
                18,19,20, 18,20,21,
                22,23,24, 22,24,25,
                26,27,28, 26,28,29,
                30,31,32, 30,32,33,
            ];

            const mesh = new Mesh('rs', scene);
            const vd = new VertexData();
            vd.positions = positions;
            vd.indices   = roofIndices;
            vd.uvs       = roofUvs;
            VertexData.ComputeNormals(positions, roofIndices, vd.normals = []);
            vd.applyToMesh(mesh);

            if (longAxis) mesh.rotation.y = Math.PI / 2;
            // Slightly ABOVE the wall top: the old topY - ROOF_OVERLAP put the
            // slope plane exactly grazing the wall's top corner, so a lit
            // stone strip (the wall top face) poked through along the eave.
            // The fascia boards close the resulting eave gap from outside.
            mesh.position = new Vector3(c.x, topY + 0.06, c.z);
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
