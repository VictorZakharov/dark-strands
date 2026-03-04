import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3,
         SolidParticleSystem } from 'babylonjs';
import { CFG } from '../config.js';
// grid imports removed — wall openings now centred at cell coords
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';

let _scene = null;
let _glassMat = null; // shared material for glass shards

function loadTex(path, uScale, vScale, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = uScale;
    tex.vScale = vScale;
    return tex;
}

// Window registry for breakable glass — keyed by "gx,gz"
const windowPanes = new Map();
let glassMergedMesh = null; // merged mesh for all glass panes

/** Try to break a window at cell (gx,gz) at world position (wx,wz,wy). Returns true if glass broke. */
export function tryBreakWindow(gx, gz, wx, wz, wy, vx, vy, vz) {
    const key = `${gx},${gz}`;
    const wins = windowPanes.get(key);
    if (!wins) return false;
    const p = g2w(gx, gz);
    const MARGIN_Y = 0.3;
    const MARGIN_H = 0.3;
    for (const w of wins) {
        if (w.broken) continue;
        const baseY = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
        const winH = CFG.WALL_H * w.hFrac;
        const winW = CFG.CELL * w.wFrac;
        if (wy < baseY - winH / 2 - MARGIN_Y || wy > baseY + winH / 2 + MARGIN_Y) continue;
        const isNS = w.wall === 'south' || w.wall === 'north';
        if (isNS) { if (Math.abs(wx - p.x) > winW / 2 + MARGIN_H) continue; }
        else { if (Math.abs(wz - p.z) > winW / 2 + MARGIN_H) continue; }
        w.broken = true;
        // Zero out this pane's vertices in the merged mesh (degenerate triangles = invisible)
        if (glassMergedMesh) {
            const positions = glassMergedMesh.getVerticesData('position');
            for (let i = w.vertStart; i < w.vertEnd; i++) {
                positions[i * 3] = 0;
                positions[i * 3 + 1] = 0;
                positions[i * 3 + 2] = 0;
            }
            glassMergedMesh.updateVerticesData('position', positions);
        }
        // Glass shard particle burst
        if (_scene) spawnGlassShards(wx, wy, wz, vx || 0, vy || 0, vz || 0);
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
    const MARGIN_Y = 0.3;
    const MARGIN_H = 0.3;
    for (const w of wins) {
        if (!w.broken) continue;
        const baseY = (w.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;
        const winH = CFG.WALL_H * w.hFrac;
        const winW = CFG.CELL * w.wFrac;
        if (wy < baseY - winH / 2 - MARGIN_Y || wy > baseY + winH / 2 + MARGIN_Y) continue;
        const isNS = w.wall === 'south' || w.wall === 'north';
        if (isNS) { if (Math.abs(wx - p.x) > winW / 2 + MARGIN_H) continue; }
        else { if (Math.abs(wz - p.z) > winW / 2 + MARGIN_H) continue; }
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

/**
 * Build glass panes and wooden frames for windows.
 * Wall geometry with window holes is now handled by buildWalls() in walls.js.
 */
export function buildWindows(scene) {
    _scene = scene;
    // --- Materials ---

    // Wooden frame material (bark texture, same as doors)
    const frameMat = new StandardMaterial('windowFrameMat', scene);
    frameMat.diffuseTexture = loadTex('./assets/textures/bark.jpg', 1, 1, scene);
    frameMat.diffuseColor = new Color3(0x8b / 255, 0x5a / 255, 0x2b / 255);
    frameMat.specularColor = new Color3(0.02, 0.02, 0.02);
    frameMat.zOffset = -1;
    const FRAME_T = 0.07;  // frame bar cross-section thickness
    const FRAME_D = CFG.WALL_T + 0.1; // extends slightly past wall on both sides

    // Glass material
    const glassMat = new StandardMaterial('windowGlassMat', scene);
    glassMat.diffuseColor = new Color3(0x88 / 255, 0xcc / 255, 0xee / 255);
    glassMat.alpha = 0.25;
    glassMat.specularPower = 128;
    glassMat.backFaceCulling = false;
    glassMat.disableDepthWrite = true;

    // --- Group windows by cell ---
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

    const frameMeshes = [];
    const glassMeshes = [];
    let glassVertCount = 0; // running vertex offset for pane registry

    for (const [, cw] of cellWindows) {
        const p = g2w(cw.gx, cw.gz);
        const isNS = cw.wall === 'south' || cw.wall === 'north';

        // Deduplicate windows per floor
        const floorMap = new Map();
        for (const win of cw.wins) {
            if (!floorMap.has(win.floor)) floorMap.set(win.floor, win);
        }
        const uniqueWins = [...floorMap.values()];

        // Glass panes and frame bars for each window
        for (const win of uniqueWins) {
            const winW = CFG.CELL * win.wFrac;
            const winH = CFG.WALL_H * win.hFrac;
            const baseY = (win.floor - 1) * CFG.WALL_H + CFG.WALL_H * 0.5;

            const cx = p.x;
            const cz = p.z;

            // --- Glass pane ---
            const pane = MeshBuilder.CreatePlane('winGlass', {
                width: winW,
                height: winH,
            }, scene);
            const paneVerts = pane.getTotalVertices();

            pane.position = new Vector3(cx, baseY, cz);
            if (!isNS) pane.rotation.y = Math.PI / 2;

            // Bake transforms into vertices for merging
            pane.bakeCurrentTransformIntoVertices();
            glassMeshes.push(pane);

            // Register with vertex range for break-by-zeroing
            const regKey = `${cw.gx},${cw.gz}`;
            if (!windowPanes.has(regKey)) windowPanes.set(regKey, []);
            windowPanes.get(regKey).push({
                wall: cw.wall, floor: win.floor,
                wFrac: win.wFrac, hFrac: win.hFrac, broken: false,
                vertStart: glassVertCount, vertEnd: glassVertCount + paneVerts,
            });
            glassVertCount += paneVerts;

            // --- Frame bars ---
            const outerW = winW + FRAME_T * 2;
            const outerH = winH + FRAME_T * 2;

            // Top bar
            const topBar = isNS
                ? MeshBuilder.CreateBox('frameTop', { width: outerW, height: FRAME_T, depth: FRAME_D }, scene)
                : MeshBuilder.CreateBox('frameTop', { width: FRAME_D, height: FRAME_T, depth: outerW }, scene);
            topBar.position = new Vector3(cx, baseY + winH / 2 + FRAME_T / 2, cz);
            topBar.bakeCurrentTransformIntoVertices();
            frameMeshes.push(topBar);

            // Bottom bar
            const botBar = isNS
                ? MeshBuilder.CreateBox('frameBot', { width: outerW, height: FRAME_T, depth: FRAME_D }, scene)
                : MeshBuilder.CreateBox('frameBot', { width: FRAME_D, height: FRAME_T, depth: outerW }, scene);
            botBar.position = new Vector3(cx, baseY - winH / 2 - FRAME_T / 2, cz);
            botBar.bakeCurrentTransformIntoVertices();
            frameMeshes.push(botBar);

            // Left bar
            const leftBar = isNS
                ? MeshBuilder.CreateBox('frameL', { width: FRAME_T, height: outerH, depth: FRAME_D }, scene)
                : MeshBuilder.CreateBox('frameL', { width: FRAME_D, height: outerH, depth: FRAME_T }, scene);
            if (isNS) {
                leftBar.position = new Vector3(cx - winW / 2 - FRAME_T / 2, baseY, cz);
            } else {
                leftBar.position = new Vector3(cx, baseY, cz - winW / 2 - FRAME_T / 2);
            }
            leftBar.bakeCurrentTransformIntoVertices();
            frameMeshes.push(leftBar);

            // Right bar
            const rightBar = isNS
                ? MeshBuilder.CreateBox('frameR', { width: FRAME_T, height: outerH, depth: FRAME_D }, scene)
                : MeshBuilder.CreateBox('frameR', { width: FRAME_D, height: outerH, depth: FRAME_T }, scene);
            if (isNS) {
                rightBar.position = new Vector3(cx + winW / 2 + FRAME_T / 2, baseY, cz);
            } else {
                rightBar.position = new Vector3(cx, baseY, cz + winW / 2 + FRAME_T / 2);
            }
            rightBar.bakeCurrentTransformIntoVertices();
            frameMeshes.push(rightBar);
        }
    }

    // --- Merge all frame bars into one mesh ---
    if (frameMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(frameMeshes, true, true, undefined, false, false);
        if (merged) {
            merged.name = 'windowFrames';
            merged.material = frameMat;
            // Thin bars (0.07u) alias into stripes at shadow map resolution — skip shadow casting
        }
    }

    // --- Merge all glass panes into one mesh (break by zeroing vertices) ---
    if (glassMeshes.length > 0) {
        const merged = Mesh.MergeMeshes(glassMeshes, true, true, undefined, false, false);
        if (merged) {
            merged.name = 'windowGlass';
            merged.material = glassMat;
            merged.isPickable = false;
            // Mark the merged mesh as updatable so we can zero vertices for breakage
            merged.markVerticesDataAsUpdatable('position', true);
            glassMergedMesh = merged;
        }
    }
}

/** Spawn SPS-digested glass shards at the break point */
function spawnGlassShards(wx, wy, wz, vx, vy, vz) {
    if (!_glassMat) {
        _glassMat = new StandardMaterial('glassShardMat', _scene);
        _glassMat.diffuseColor = new Color3(0.7, 0.85, 0.95);
        _glassMat.alpha = 0.5;
        _glassMat.specularPower = 128;
        _glassMat.backFaceCulling = false;
        _glassMat.freeze();
    }

    // Create a subdivided plane at origin, then digest into triangular shards
    const winW = CFG.CELL * 0.6;
    const winH = CFG.WALL_H * 0.4;
    const model = MeshBuilder.CreatePlane('glassModel', {
        width: winW, height: winH,
        sideOrientation: Mesh.DOUBLESIDE,
        subdivisions: 6, // 6×6 = 36 quads = 72 triangles
    }, _scene);

    const sps = new SolidParticleSystem('glassSPS', _scene, { updatable: true });
    sps.digest(model, { facetNb: 1 });
    model.dispose();

    const mesh = sps.buildMesh();
    mesh.material = _glassMat;
    mesh.position.set(wx, wy, wz);        // position SPS mesh at window
    mesh.alwaysSelectAsActiveMesh = true;  // never frustum-cull (particles fly far)

    // Normalize rock velocity for direction
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const dx = vx / speed, dy = vy / speed, dz = vz / speed;

    const GRAVITY = -0.015;
    const FLOOR_Y = -wy - 0.5; // ground level in local space (mesh is at wy)
    const SPEED = 0.15;

    // Initialize particle velocities
    sps.initParticles = function () {
        for (let i = 0; i < sps.nbParticles; i++) {
            const p = sps.particles[i];
            p.velocity.x = dx * SPEED + (Math.random() - 0.5) * SPEED * 0.6;
            p.velocity.y = dy * SPEED + (Math.random() - 0.3) * SPEED * 0.4;
            p.velocity.z = dz * SPEED + (Math.random() - 0.5) * SPEED * 0.6;
            p.rand = Math.random() / 50;
        }
    };

    sps.updateParticle = function (p) {
        if (p.position.y < FLOOR_Y) {
            p.velocity.x = 0;
            p.velocity.y = 0;
            p.velocity.z = 0;
        } else {
            p.velocity.y += GRAVITY;
            p.position.x += p.velocity.x;
            p.position.y += p.velocity.y;
            p.position.z += p.velocity.z;
            p.rotation.x += p.velocity.z * p.rand;
            p.rotation.y += p.velocity.x * p.rand;
            p.rotation.z += p.velocity.y * p.rand;
        }
        return p;
    };

    sps.initParticles();
    sps.setParticles();
    sps.refreshVisibleSize();

    const obs = _scene.onBeforeRenderObservable.add(() => {
        sps.setParticles();
    });

    setTimeout(() => {
        _scene.onBeforeRenderObservable.remove(obs);
        mesh.dispose();
        sps.dispose();
    }, 3000);
}
