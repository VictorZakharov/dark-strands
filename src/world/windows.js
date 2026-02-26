import { MeshBuilder, Mesh, StandardMaterial, Texture, Color3, Color4, Vector3, ParticleSystem } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';

let _scene = null;

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
        if (_scene) spawnGlassShards(wx, wy, wz, w.wall);
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

    // Thin-post detection — needed to compute glass/frame offset matching wall openings
    const grid = getGrid();
    const winCornerCells = new Set();
    for (const b of getBuildings()) {
        winCornerCells.add(`${b.x},${b.z}`);
        winCornerCells.add(`${b.x + b.w - 1},${b.z}`);
        winCornerCells.add(`${b.x},${b.z + b.h - 1}`);
        winCornerCells.add(`${b.x + b.w - 1},${b.z + b.h - 1}`);
    }
    function isWinThinPost(gx, gz) {
        if (gx < 0 || gz < 0 || gx >= CFG.GRID || gz >= CFG.GRID) return false;
        if (grid[gx][gz] || isDoorCell(gx, gz) || isWindowCell(gx, gz) || isStairCell(gx, gz)) return false;
        if (winCornerCells.has(`${gx},${gz}`)) return true;
        const oN = gz > 0 && grid[gx][gz - 1];
        const oS = gz < CFG.GRID - 1 && grid[gx][gz + 1];
        const oW = gx > 0 && grid[gx - 1][gz];
        const oE = gx < CFG.GRID - 1 && grid[gx + 1][gz];
        const facesNS = oN || oS;
        const facesEW = oW || oE;
        return (facesNS && facesEW) || (!facesNS && !facesEW);
    }
    const winExt = CFG.CELL / 2 + CFG.WALL_T / 2;

    const frameMeshes = [];
    const glassMeshes = [];
    let glassVertCount = 0; // running vertex offset for pane registry

    for (const [, cw] of cellWindows) {
        const p = g2w(cw.gx, cw.gz);
        const isNS = cw.wall === 'south' || cw.wall === 'north';

        // Compute offset so glass/frame align with wall openings
        let extLeft = 0, extRight = 0;
        if (isNS) {
            extLeft = isWinThinPost(cw.gx - 1, cw.gz) ? winExt : 0;
            extRight = isWinThinPost(cw.gx + 1, cw.gz) ? winExt : 0;
        } else {
            extLeft = isWinThinPost(cw.gx, cw.gz - 1) ? winExt : 0;
            extRight = isWinThinPost(cw.gx, cw.gz + 1) ? winExt : 0;
        }

        const offsetCenter = (extRight - extLeft) / 2;
        const ocX = isNS ? offsetCenter : 0;
        const ocZ = isNS ? 0 : offsetCenter;

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

            const cx = p.x + ocX;
            const cz = p.z + ocZ;

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

/** Spawn a burst of glass shard particles at the break point */
function spawnGlassShards(wx, wy, wz, wall) {
    const isNS = wall === 'south' || wall === 'north';
    const outSign = (wall === 'south' || wall === 'east') ? 1 : -1;

    const ps = new ParticleSystem('glassShards', 200, _scene);
    ps.createPointEmitter(new Vector3(-0.4, -0.3, -0.4), new Vector3(0.4, 0.6, 0.4));
    ps.emitter = new Vector3(wx, wy, wz);
    ps.minSize = 0.04;
    ps.maxSize = 0.18;
    ps.minLifeTime = 1.0;
    ps.maxLifeTime = 2.5;
    ps.emitRate = 0;       // burst only
    ps.manualEmitCount = 120;
    ps.gravity = new Vector3(0, -6, 0);

    // Outward velocity along wall normal
    const outX = isNS ? 0 : outSign * 3;
    const outZ = isNS ? outSign * 3 : 0;
    ps.direction1 = new Vector3(outX - 2, 0.5, outZ - 2);
    ps.direction2 = new Vector3(outX + 2, 4.0, outZ + 2);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 6;

    // Glass colors: bright, high alpha for visibility
    ps.color1 = new Color4(0.8, 0.95, 1.0, 1.0);
    ps.color2 = new Color4(0.6, 0.8, 1.0, 0.9);
    ps.colorDead = new Color4(0.5, 0.6, 0.7, 0.0);

    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.addSizeGradient(0, 0.15);
    ps.addSizeGradient(0.5, 0.10);
    ps.addSizeGradient(1.0, 0.03);

    ps.start();
    // Auto-dispose after particles die
    setTimeout(() => { ps.stop(); ps.dispose(); }, 3500);
}
