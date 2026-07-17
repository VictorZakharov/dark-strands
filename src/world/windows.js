import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Vector3,
         SolidParticleSystem } from 'babylonjs';
import { CFG } from '../config.js';
// grid imports removed — wall openings now centred at cell coords
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { getTerrainHeight } from './terrain.js';

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
        // Glass shard particle burst — pass pane orientation + true pane size
        // (the shard sheet must span the pane, not the wall thickness)
        if (_scene) spawnGlassShards(wx, wy, wz, vx || 0, vy || 0, vz || 0, isNS, winW, winH);
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
            // Mark the merged mesh as updatable so we can zero vertices for breakage
            merged.markVerticesDataAsUpdatable('position', true);
            glassMergedMesh = merged;
        }
    }
}

/**
 * Spawn a burst of thin-box glass shards at the break point.
 * (wx,wy,wz) = impact point (SPS mesh origin), (vx,vy,vz) = rock velocity,
 * isNS = pane faces ±z (else ±x), winW/winH = the actual pane dimensions.
 * Shards scatter across the pane sheet and fly with the rock's carry
 * direction plus a radial burst away from the impact point. All speeds are
 * world units per SECOND (dt-scaled — the old version moved per frame, so
 * shard speed depended on refresh rate).
 */
function spawnGlassShards(wx, wy, wz, vx, vy, vz, isNS, winW, winH) {
    if (!_glassMat) {
        _glassMat = new StandardMaterial('glassShardMat', _scene);
        _glassMat.diffuseColor = new Color3(0.7, 0.85, 0.95);
        _glassMat.alpha = 0.5;
        _glassMat.specularPower = 128;
        _glassMat.backFaceCulling = false;
        _glassMat.freeze();
    }

    const N_SHARDS = 40;
    const CARRY = 4.0;    // u/s along the rock's direction
    const RADIAL = 1.7;   // u/s outward from the impact point, in the pane plane
    const GRAVITY = -9.5; // u/s²

    // Thin box = real glass sliver with visible thickness (the old digest of
    // an unsubdivided plane yielded just 4 pane-sized triangles — CreatePlane
    // has no subdivisions option, that parameter was silently ignored)
    const shard = MeshBuilder.CreateBox('glassShardModel',
        { width: 0.17, height: 0.22, depth: 0.02 }, _scene);
    const sps = new SolidParticleSystem('glassSPS', _scene, { updatable: true });
    sps.addShape(shard, N_SHARDS);
    shard.dispose();

    const mesh = sps.buildMesh();
    mesh.material = _glassMat;
    mesh.position.set(wx, wy, wz);        // position SPS mesh at impact point
    mesh.alwaysSelectAsActiveMesh = true;  // never frustum-cull (particles fly far)
    mesh.isPickable = false;               // camera raycasts pay per triangle

    // Normalize rock velocity for the carry direction
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const dx = vx / speed, dy = vy / speed, dz = vz / speed;

    sps.initParticles = function () {
        for (let i = 0; i < sps.nbParticles; i++) {
            const p = sps.particles[i];
            // Scatter across the pane sheet (addShape spawns all at origin).
            // The pane spans x for north/south walls, z for east/west.
            const u = (Math.random() - 0.5) * winW;
            const v = (Math.random() - 0.5) * winH;
            if (isNS) p.position.set(u, v, 0);
            else p.position.set(0, v, u);
            // Radial burst away from the impact point, in the pane plane
            const rl = Math.sqrt(u * u + v * v) || 1;
            const rs = RADIAL * (0.4 + Math.random());
            const ru = (u / rl) * rs, rv = (v / rl) * rs;
            const cs = CARRY * (0.5 + Math.random() * 0.6);
            p.velocity.x = dx * cs + (isNS ? ru : 0);
            p.velocity.y = dy * cs + rv + 0.6 + Math.random() * 0.6;
            p.velocity.z = dz * cs + (isNS ? 0 : ru);
            // Random initial orientation + per-shard tumble rate (rad/s)
            p.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
            p.rvx = (Math.random() - 0.5) * 12;
            p.rvy = (Math.random() - 0.5) * 12;
            p.rvz = (Math.random() - 0.5) * 12;
            const sc = 0.5 + Math.random() * 0.9;
            p.scaling.set(sc, sc * (0.6 + Math.random() * 0.8), 1);
            p.landed = false;
        }
    };

    let dtS = 0; // seconds, set by the per-frame driver below
    sps.updateParticle = function (p) {
        if (p.landed) return p; // settled — skip physics + the terrain sample
        p.velocity.y += GRAVITY * dtS;
        p.position.x += p.velocity.x * dtS;
        p.position.y += p.velocity.y * dtS;
        p.position.z += p.velocity.z * dtS;
        p.rotation.x += p.rvx * dtS;
        p.rotation.y += p.rvy * dtS;
        p.rotation.z += p.rvz * dtS;
        // Freeze where the shard lands (sample the terrain under it — a fixed
        // world plane sank shards into raised ground / floated them in dips)
        const floorY = getTerrainHeight(wx + p.position.x, wz + p.position.z) + 0.04 - wy;
        if (p.position.y <= floorY) {
            p.position.y = floorY;
            p.velocity.setAll(0);
            p.landed = true;
        }
        return p;
    };

    sps.initParticles();
    sps.setParticles();
    sps.refreshVisibleSize();

    const obs = _scene.onBeforeRenderObservable.add(() => {
        if (!_scene.animationsEnabled) return; // sim frozen — shards hold too
        dtS = Math.min(_scene.getEngine().getDeltaTime() / 1000, 0.1);
        sps.setParticles();
    });

    setTimeout(() => {
        _scene.onBeforeRenderObservable.remove(obs);
        sps.dispose(); // disposes its own buildMesh() output too — no separate mesh.dispose()
    }, 3000);
}
