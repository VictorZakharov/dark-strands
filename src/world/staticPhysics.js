import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell, isTreeCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { createStaticBox } from '../core/physics.js';

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

/** Create static physics bodies for walls, floors, stairs, doors-above */
export function createWorldPhysicsBodies() {
    const grid = getGrid();
    const buildings = getBuildings();

    // Wall heights per cell (same logic as buildWalls)
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

    // Helper: thin post detection (same as buildWalls)
    function isThinPost(gx, gz) {
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

    const ext = CFG.CELL / 2; // match buildWalls — extend to corner center

    // --- Wall + window cell bodies ---
    for (let x = 0; x < CFG.GRID; x++) {
        for (let z = 0; z < CFG.GRID; z++) {
            // Include window cells (full box — window breaking handled elsewhere)
            // Exclude doors (kinematic bodies) and stairs
            if (grid[x][z] || isDoorCell(x, z) || isStairCell(x, z)) continue;
            const isWin = isWindowCell(x, z);
            if (!isWin && grid[x][z]) continue; // walkable non-window — skip

            const p = g2w(x, z);
            let h = wallH[x][z];

            // Tree cells: only trunk height (3 units), not full wall
            if (isTreeCell(x, z)) h = Math.min(h, 3);

            const openN = z > 0 && grid[x][z - 1];
            const openS = z < CFG.GRID - 1 && grid[x][z + 1];
            const openW = x > 0 && grid[x - 1][z];
            const openE = x < CFG.GRID - 1 && grid[x + 1][z];
            const facesNS = openN || openS;
            const facesEW = openW || openE;

            let sx, sz, px = p.x, pz = p.z;
            if (isWin) {
                // Window cells: use cell-width in wall direction, wall thickness in other
                // Determine wall direction from the window data
                const isNSWin = facesNS || (!facesNS && !facesEW);
                sx = isNSWin ? CFG.CELL : CFG.WALL_T;
                sz = isNSWin ? CFG.WALL_T : CFG.CELL;
            } else if (facesNS && !facesEW) {
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
                // Corner / thin post — keep as WALL_T × WALL_T (straight walls extend to cover)
                sx = CFG.WALL_T; sz = CFG.WALL_T;
            }

            const bottom = -0.5;
            const totalH = h - bottom;
            const body = createStaticBox(sx / 2, totalH / 2, sz / 2, px, bottom + totalH / 2, pz);

            // Window walls: group 4, don't collide with projectiles (group 8)
            if (isWin) {
                body.collisionFilterGroup = 4;
                body.collisionFilterMask = ~8;
            }
        }
    }

    // --- Above-door lintel + 2nd floor door wall bodies ---
    const doorTopY = CFG.WALL_H * 0.88;
    for (const b of buildings) {
        for (const d of b.doors) {
            const p = g2w(d.gx, d.gz);
            const isNS = d.wall === 'south' || d.wall === 'north';
            let sx = isNS ? CFG.CELL : CFG.WALL_T;
            let sz = isNS ? CFG.WALL_T : CFG.CELL;
            let px = p.x, pz = p.z;

            // Extend toward thin posts (corners) — same as visual walls
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
                createStaticBox(sx / 2, gapH / 2, sz / 2, px, doorTopY + gapH / 2, pz);
            }
            if (b.stories === 2) {
                createStaticBox(sx / 2, CFG.WALL_H / 2, sz / 2, px, CFG.WALL_H + CFG.WALL_H / 2, pz);
            }
        }
    }

    // --- Mid-floor slabs (2-story buildings) ---
    // Physics slab is thicker than visual to prevent fast-moving capsules phasing through
    const PHYS_FLOOR_THICK = 1.5;
    // Center Y so top matches the visual floor top (WALL_H + 0.125)
    const FLOOR_TOP_OFFSET = 0.125 - PHYS_FLOOR_THICK / 2;
    for (const b of buildings) {
        if (b.stories !== 2) continue;
        const c = getBuildingCenter(b);

        if (b.stair) {
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

            // Piece 1: left of stairwell
            const p1w = stairLeft - intLeft;
            const p1d = intFront - intBack;
            if (p1w > 0.1 && p1d > 0.1) {
                createStaticBox(p1w / 2, PHYS_FLOOR_THICK / 2, p1d / 2, intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2);
            }
            // Piece 2: above stairwell
            const p2w = stairRight - stairLeft;
            const p2d = intFront - stairFront;
            if (p2w > 0.1 && p2d > 0.1) {
                createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p2d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2);
            }
            // Piece 3: right of stairwell
            const p3w = intRight - stairRight;
            const p3d = intFront - intBack;
            if (p3w > 0.1 && p3d > 0.1) {
                createStaticBox(p3w / 2, PHYS_FLOOR_THICK / 2, p3d / 2, stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2);
            }
            // Piece 4: behind stairwell
            const stairBack = stairP.z - CFG.CELL / 2;
            const p4d = stairBack - intBack;
            if (p2w > 0.1 && p4d > 0.1) {
                createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p4d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2);
            }

            // --- Stair steps ---
            const stairP2 = g2w(s.gx, s.gzEnd);
            const stairWidth = CFG.CELL * 0.95;
            const stairX = stairP.x + (CFG.CELL - stairWidth) / 2;
            const zMin = stairP.z - CFG.CELL / 2;
            const zMax = stairP2.z + CFG.CELL / 2;
            const totalDepth = zMax - zMin;
            // Use 16 steps so step height (0.22) < player sphere radius (0.35)
            const numSteps = 16;
            const stepH = CFG.WALL_H / numSteps;
            const stepD = totalDepth / numSteps;

            for (let i = 0; i < numSteps; i++) {
                const sh = (i + 1) * stepH;
                createStaticBox(stairWidth / 2, sh / 2, stepD / 2, stairX, sh / 2, zMax - (i + 0.5) * stepD);
            }
        } else {
            // Full floor, no stairwell
            const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            createStaticBox(fullW / 2, PHYS_FLOOR_THICK / 2, fullH / 2, c.x, CFG.WALL_H + FLOOR_TOP_OFFSET, c.z);
        }
    }

    // --- Ground floor slabs ---
    for (const b of buildings) {
        const c2 = getBuildingCenter(b);
        const fw = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const fh = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const GROUND_SLAB = 0.6;
        createStaticBox(fw / 2, GROUND_SLAB / 2, fh / 2, c2.x, 0.02 - GROUND_SLAB / 2, c2.z);
    }

    // --- Roof bodies (prevent jumping through ceilings) ---
    for (const b of buildings) {
        const topY = b.stories * CFG.WALL_H;
        const c = getBuildingCenter(b);
        const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
        const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
        const overhang = 0.4;
        // Make the ceiling block very thick to prevent high-velocity jumping tunneling through it
        const CEIL_THICK = 1.0;
        // Set the bottom of the ceiling block exactly flush with the top of the walls
        createStaticBox((bw + overhang) / 2, CEIL_THICK / 2, (bh + overhang) / 2, c.x, topY + CEIL_THICK / 2, c.z);
    }
}
