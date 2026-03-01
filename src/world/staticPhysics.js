import { CFG } from '../config.js';
import { getGrid, isDoorCell, isWindowCell, isStairCell, isTreeCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { createStaticBox, createRotatedStaticBox, createStaticCylinder, getRoofMaterial, WINDOW_COLLISION_GROUP, CEILING_COLLISION_GROUP } from '../core/physics.js';

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

    // Building corner cells — always treated as thin posts (mirrors buildWalls)
    const cornerCells = new Set();
    for (const b of buildings) {
        cornerCells.add(`${b.x},${b.z}`);
        cornerCells.add(`${b.x + b.w - 1},${b.z}`);
        cornerCells.add(`${b.x},${b.z + b.h - 1}`);
        cornerCells.add(`${b.x + b.w - 1},${b.z + b.h - 1}`);
    }

    // Helper: thin post detection (same as buildWalls)
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

            const isCorner = cornerCells.has(`${x},${z}`);
            let sx, sz, px = p.x, pz = p.z;
            if (isCorner) {
                const totalH = h - (-0.5);
                createStaticBox(CFG.WALL_T / 2, totalH / 2, CFG.WALL_T / 2, p.x, -0.5 + totalH / 2, p.z);
                continue;
            } else if (isWin) {
                // Window cells: cell-width in wall direction, wall thickness in other.
                // Extend toward thin posts (corners) like straight walls.
                const isNSWin = facesNS || (!facesNS && !facesEW);
                sx = isNSWin ? CFG.CELL : CFG.WALL_T;
                sz = isNSWin ? CFG.WALL_T : CFG.CELL;
                if (isNSWin) {
                    const extW = isThinPost(x - 1, z) ? ext : 0;
                    const extE = isThinPost(x + 1, z) ? ext : 0;
                    sx += extW + extE;
                    px += (extE - extW) / 2;
                } else {
                    const extN = isThinPost(x, z - 1) ? ext : 0;
                    const extS = isThinPost(x, z + 1) ? ext : 0;
                    sz += extN + extS;
                    pz += (extS - extN) / 2;
                }
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
                // Corner / thin post — small box to seal diagonal gap between
                // perpendicular wall extensions.  WALL_T × WALL_T is small enough
                // not to protrude into the building interior (only 0.35 from center).
                const totalH = h - (-0.5);
                createStaticBox(CFG.WALL_T / 2, totalH / 2, CFG.WALL_T / 2, p.x, -0.5 + totalH / 2, p.z);
                continue;
            }

            const bottom = -0.5;
            const totalH = h - bottom;
            // Window walls: projectiles pass through (WINDOW group, exclude PROJECTILE)
            createStaticBox(sx / 2, totalH / 2, sz / 2, px, bottom + totalH / 2, pz,
                undefined, isWin ? WINDOW_COLLISION_GROUP : undefined);
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

    // --- Door-side fill physics bodies ---
    // Fill gaps between door openings and adjacent thin posts/corners.
    // Without these, the player can walk through the wall next to a door
    // when the door is near a building corner.
    const physFillW = ext + CFG.WALL_T / 2;
    for (const b of buildings) {
        for (const d of b.doors) {
            const p = g2w(d.gx, d.gz);
            const isNS = d.wall === 'south' || d.wall === 'north';

            const neighbors = isNS
                ? [{ check: isThinPost(d.gx - 1, d.gz), gx: d.gx - 1, gz: d.gz, sign: -1 },
                   { check: isThinPost(d.gx + 1, d.gz), gx: d.gx + 1, gz: d.gz, sign: +1 }]
                : [{ check: isThinPost(d.gx, d.gz - 1), gx: d.gx, gz: d.gz - 1, sign: -1 },
                   { check: isThinPost(d.gx, d.gz + 1), gx: d.gx, gz: d.gz + 1, sign: +1 }];

            for (const n of neighbors) {
                if (!n.check) continue;
                const fw = cornerCells.has(`${n.gx},${n.gz}`) ? ext : physFillW;
                const bottom = -0.5;
                const fillH = doorTopY - bottom;

                if (isNS) {
                    const fx = p.x + n.sign * (CFG.CELL / 2 + fw / 2);
                    createStaticBox(fw / 2, fillH / 2, CFG.WALL_T / 2, fx, bottom + fillH / 2, p.z);
                } else {
                    const fz = p.z + n.sign * (CFG.CELL / 2 + fw / 2);
                    createStaticBox(CFG.WALL_T / 2, fillH / 2, fw / 2, p.x, bottom + fillH / 2, fz);
                }
            }
        }
    }

    // --- Mid-floor slabs (2-story buildings) ---
    // Physics slab — thick enough to prevent phase-through but leaves headroom for player capsule (2.15)
    const PHYS_FLOOR_THICK = 1.0;
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
            const stairRight = g2w(b.x + b.w - 1, 0).x - CFG.WALL_T / 2;
            const stairFront = g2w(0, s.gzEnd).z + CFG.CELL / 2;
            const floorY = CFG.WALL_H;

            // Piece 1: left of stairwell
            const p1w = stairLeft - intLeft;
            const p1d = intFront - intBack;
            if (p1w > 0.1 && p1d > 0.1) {
                createStaticBox(p1w / 2, PHYS_FLOOR_THICK / 2, p1d / 2, intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2, 'ceiling');
            }
            // Piece 2: above stairwell
            const p2w = stairRight - stairLeft;
            const p2d = intFront - stairFront;
            if (p2w > 0.1 && p2d > 0.1) {
                createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p2d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2, 'ceiling');
            }
            // Piece 3: right of stairwell
            const p3w = intRight - stairRight;
            const p3d = intFront - intBack;
            if (p3w > 0.1 && p3d > 0.1) {
                createStaticBox(p3w / 2, PHYS_FLOOR_THICK / 2, p3d / 2, stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2, 'ceiling');
            }
            // Piece 4: behind stairwell
            const stairBack = g2w(0, b.z).z + CFG.WALL_T / 2;
            const p4d = stairBack - intBack;
            if (p2w > 0.1 && p4d > 0.1) {
                createStaticBox(p2w / 2, PHYS_FLOOR_THICK / 2, p4d / 2, stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2, 'ceiling');
            }

            // --- Stair steps ---
            const stairP2 = g2w(s.gx, s.gzEnd);
            // Extend stair physics flush with adjacent perimeter walls
            const eastWallInner = g2w(b.x + b.w - 1, 0).x - CFG.WALL_T / 2;
            const stairLeftEdge = stairP.x - CFG.CELL / 2;
            const stairWidth = eastWallInner - stairLeftEdge;
            const stairX = (stairLeftEdge + eastWallInner) / 2;
            const northWallInner = g2w(0, b.z).z + CFG.WALL_T / 2;
            const zMin = northWallInner;
            const zMax = stairP2.z + CFG.CELL / 2;
            const totalDepth = zMax - zMin;
            // Use 16 steps so step height (0.23) < player sphere radius (0.35)
            // Stairs reach floor top surface (WALL_H + 0.125) so last step is flush
            const numSteps = 16;
            const stairTopY = CFG.WALL_H + 0.125;
            const stepH = stairTopY / numSteps;
            const stepD = totalDepth / numSteps;

            for (let i = 0; i < numSteps; i++) {
                const sh = (i + 1) * stepH;
                createStaticBox(stairWidth / 2, sh / 2, stepD / 2, stairX, sh / 2, zMax - (i + 0.5) * stepD);
            }

            // Solid wall behind stairwell — spans from stair right edge through
            // the east perimeter wall outer face, making a seamless wall from outside
            const eastWallP = g2w(b.x + b.w - 1, s.gzStart);
            const stairRightEdge = stairX + stairWidth / 2;
            const wallOuterX = eastWallP.x + CFG.WALL_T / 2;
            const spanWidth = wallOuterX - stairRightEdge;
            if (spanWidth > 0.05) {
                const spanCX = stairRightEdge + spanWidth / 2;
                const fullH = b.stories * CFG.WALL_H;
                createStaticBox(
                    spanWidth / 2,
                    fullH / 2,
                    totalDepth / 2,
                    spanCX, fullH / 2, (zMin + zMax) / 2
                );
            }
        } else {
            // Full floor, no stairwell
            const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            createStaticBox(fullW / 2, PHYS_FLOOR_THICK / 2, fullH / 2, c.x, CFG.WALL_H + FLOOR_TOP_OFFSET, c.z, 'ceiling');
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

    // --- Roof bodies ---
    const RIDGE_H = 1.8; // must match walls.js buildRoofs()
    const roofMat = getRoofMaterial();

    for (const b of buildings) {
        const topY = b.stories * CFG.WALL_H;
        const c = getBuildingCenter(b);
        const bw = (b.w - 1) * CFG.CELL + CFG.WALL_T;
        const bh = (b.h - 1) * CFG.CELL + CFG.WALL_T;
        const overhang = 0.4;

        if (b.roofType === 'slanted') {
            // Ceiling slab at wall tops — prevents jumping into attic.
            // Uses CEILING group so camera raycasts ignore it (prevents camera snap-in).
            const CEIL_THICK = 0.15;
            createStaticBox(bw / 2, CEIL_THICK / 2, bh / 2, c.x, topY + CEIL_THICK / 2, c.z,
                'ceiling', CEILING_COLLISION_GROUP);

            // Two tilted boxes matching the visual gable roof slopes
            const longAxis = bw >= bh;
            const roofLen = (longAxis ? bw : bh) + overhang * 2;
            const roofSpan = (longAxis ? bh : bw) + overhang * 2;

            const slopeAngle = Math.atan2(RIDGE_H, roofSpan / 2);
            const slopeLen = Math.sqrt((roofSpan / 2) ** 2 + RIDGE_H ** 2);
            const SLOPE_THICK = 0.3;

            for (const side of [-1, 1]) {
                if (longAxis) {
                    // Ridge along X — slopes tilt in Z
                    createRotatedStaticBox(
                        roofLen / 2, SLOPE_THICK / 2, slopeLen / 2,
                        c.x, topY + RIDGE_H / 2, c.z + side * roofSpan / 4,
                        1, 0, 0, side * slopeAngle, roofMat, CEILING_COLLISION_GROUP
                    );
                } else {
                    // Ridge along Z — slopes tilt in X
                    createRotatedStaticBox(
                        slopeLen / 2, SLOPE_THICK / 2, roofLen / 2,
                        c.x + side * roofSpan / 4, topY + RIDGE_H / 2, c.z,
                        0, 0, 1, -side * slopeAngle, roofMat, CEILING_COLLISION_GROUP
                    );
                }
            }

            // Ridge cap — seals the V-shaped gap between the two slope bodies at the peak.
            // Prevents player from jumping through the roof from a bed below.
            if (longAxis) {
                createStaticBox(roofLen / 2, 0.6, 0.5, c.x, topY + RIDGE_H - 0.6, c.z,
                    'ceiling', CEILING_COLLISION_GROUP);
            } else {
                createStaticBox(0.5, 0.6, roofLen / 2, c.x, topY + RIDGE_H - 0.6, c.z,
                    'ceiling', CEILING_COLLISION_GROUP);
            }
        } else {
            // Flat roof — thin slab aligned with visual roof bottom
            const CEIL_THICK = 0.3;
            const roofTopY = topY + 0.25;
            createStaticBox((bw + overhang) / 2, CEIL_THICK / 2, (bh + overhang) / 2, c.x, roofTopY - CEIL_THICK / 2, c.z, 'ceiling');
        }
    }
}
