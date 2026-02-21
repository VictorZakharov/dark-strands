import * as THREE from 'three';
import { CFG } from '../config.js';
import { getGrid, isStairCell, isDoorCell, isWindowCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { createStaticBox } from '../core/physics.js';

let barkTex, woodTex, blanketTex;

const beds = [];

export function getNearestBed(playerState, maxDist = 2.5) {
    let nearest = null;
    let mindSq = maxDist * maxDist;
    const px = playerState.x, pz = playerState.z;
    for (const b of beds) {
        const dSq = (b.x - px) ** 2 + (b.z - pz) ** 2;
        if (dSq < mindSq) {
            mindSq = dSq;
            nearest = b;
        }
    }
    return nearest;
}

function loadTextures() {
    const loader = new THREE.TextureLoader();
    if (!barkTex) {
        barkTex = loader.load('./assets/textures/bark.jpg');
        barkTex.wrapS = THREE.RepeatWrapping;
        barkTex.wrapT = THREE.RepeatWrapping;
        barkTex.repeat.set(1, 1);
        barkTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (!woodTex) {
        woodTex = loader.load('./assets/textures/wood_planks.jpg');
        woodTex.wrapS = THREE.RepeatWrapping;
        woodTex.wrapT = THREE.RepeatWrapping;
        woodTex.repeat.set(2, 2);
        woodTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (!blanketTex) {
        blanketTex = loader.load('./assets/textures/fabric.png');
        blanketTex.wrapS = THREE.RepeatWrapping;
        blanketTex.wrapT = THREE.RepeatWrapping;
        blanketTex.repeat.set(4, 4);
        blanketTex.colorSpace = THREE.SRGBColorSpace;
    }
}

function createPillowGeometry(w, h, d) {
    // Start with a heavily subdivided flat box
    const geo = new THREE.BoxGeometry(w, h, d, 24, 8, 24);
    const pos = geo.attributes.position;

    // Deform into a soft cushion
    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let y = pos.getY(i);
        let z = pos.getZ(i);

        // Normalized coordinates from -1 to 1 based on dimensions
        const nx = (x / (w / 2));
        const nz = (z / (d / 2));

        // Plump up the center by pushing Y outwards, tapering to the edges
        const bulge = Math.cos(nx * Math.PI / 2) * Math.cos(nz * Math.PI / 2);

        // Squeeze the edges in slightly for a softer profile
        x *= 1.0 - (0.1 * Math.abs(nz));
        z *= 1.0 - (0.1 * Math.abs(nx));

        y += Math.sign(y) * (bulge * h * 0.8);

        pos.setXYZ(i, x, y, z);
    }

    geo.computeVertexNormals();
    return geo;
}

function buildFancyBed(isSingle = false) {
    const group = new THREE.Group();

    // Dimensions
    const bedW = isSingle ? 1.0 : 1.8;
    const bedL = isSingle ? 2.0 : 2.5;
    const frameThick = 0.15;
    const legH = 0.3;
    const mattressH = 0.3;

    const darkWood = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9, color: 0x4a2e15 });
    const lightWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8, color: 0x8b5a2b });
    const fabricWhite = new THREE.MeshStandardMaterial({
        map: blanketTex, color: 0xefefef, roughness: 0.95 // very light grey/white linen for pillows/mattress
    });
    const fabricBlanket = new THREE.MeshStandardMaterial({
        map: blanketTex, color: 0xffffff, roughness: 1.0 // light beige linen for blanket
    });

    // Base Frame Side Rails
    // Length is bedL minus the thickness of the headboard and footboard to prevent Z-fighting overlap
    const railGeo = new THREE.BoxGeometry(frameThick, 0.2, bedL - frameThick * 2);
    const railL = new THREE.Mesh(railGeo, lightWood);
    railL.position.set(-bedW / 2 + frameThick / 2, legH + 0.15, 0); // raised 0.05 for z-fight
    railL.castShadow = true;
    group.add(railL);

    const railR = new THREE.Mesh(railGeo, lightWood);
    railR.position.set(bedW / 2 - frameThick / 2, legH + 0.15, 0);
    railR.castShadow = true;
    group.add(railR);

    // Headboard - Fancier Curved Frame
    const headH = 1.0;
    const headGeo = new THREE.BoxGeometry(bedW, headH, frameThick);
    const headboard = new THREE.Mesh(headGeo, darkWood);
    headboard.position.set(0, headH / 2 + 0.25, -bedL / 2 + frameThick / 2);
    headboard.castShadow = true;
    group.add(headboard);

    // Tufted Fabric Inner Panel
    const innerGeo = new THREE.BoxGeometry(bedW - 0.2, headH - 0.2, frameThick * 0.6);
    const innerPanel = new THREE.Mesh(innerGeo, fabricWhite);
    // Position it slightly protruding from the front of the headboard
    innerPanel.position.set(0, headH / 2 + 0.25, -bedL / 2 + frameThick / 2 + frameThick * 0.3);
    innerPanel.castShadow = true;
    group.add(innerPanel);

    // Curved top crest
    const crestGeo = new THREE.CylinderGeometry(frameThick * 1.5, frameThick * 1.5, bedW + 0.1, 8);
    const crest = new THREE.Mesh(crestGeo, darkWood); // Match the dark wood frame
    crest.rotation.z = Math.PI / 2;
    crest.position.set(0, headH + 0.25, -bedL / 2 + frameThick / 2);
    crest.castShadow = true;
    group.add(crest);

    // Footboard
    const footH = 0.6;
    const footGeo = new THREE.BoxGeometry(bedW, footH, frameThick);
    const footboard = new THREE.Mesh(footGeo, darkWood);
    footboard.position.set(0, footH / 2 + 0.05, bedL / 2 - frameThick / 2);
    footboard.castShadow = true;
    group.add(footboard);

    // Legs x4
    const legGeo = new THREE.BoxGeometry(0.12, legH, 0.12);
    const legPositions = [
        [-bedW / 2 + 0.1, legH / 2, -bedL / 2 + 0.1], // Head Left
        [bedW / 2 - 0.1, legH / 2, -bedL / 2 + 0.1],  // Head Right
        [-bedW / 2 + 0.1, legH / 2, bedL / 2 - 0.1],  // Foot Left
        [bedW / 2 - 0.1, legH / 2, bedL / 2 - 0.1]    // Foot Right
    ];
    legPositions.forEach(p => {
        const leg = new THREE.Mesh(legGeo, darkWood);
        leg.position.set(p[0], p[1], p[2]);
        leg.castShadow = true;
        group.add(leg);
    });

    // Mattress
    const matY = legH + 0.05 + mattressH / 2;
    // Shorten mattress length to ensure it does not clip into the footboard thickness
    const matGeo = new THREE.BoxGeometry(bedW - frameThick * 1.5, mattressH, bedL - frameThick * 2.05);
    const mattress = new THREE.Mesh(matGeo, fabricWhite);
    mattress.position.set(0, matY, 0);
    mattress.receiveShadow = true;
    mattress.castShadow = true;
    group.add(mattress);

    // Blanket (covers foot half)
    const blankH = mattressH + 0.04;
    // Shorten the length by double the frame thickness to ensure it doesn't clip into the footboard
    const blankL = (bedL * 0.6) - (frameThick * 2.5);
    const blankGeo = new THREE.BoxGeometry(bedW - frameThick * 1.2, blankH, blankL);
    const blanket = new THREE.Mesh(blankGeo, fabricBlanket);
    // Bias the Z position slightly towards the head to ensure the foot clears the footboard frame
    blanket.position.set(0, matY, bedL / 2 - blankL / 2 - frameThick * 1.5);
    blanket.castShadow = true;
    blanket.receiveShadow = true;
    group.add(blanket);

    const pillW = 0.55;
    const pillL = 0.35;
    const pillH = 0.08;
    // Generate an organically plumped pillow mesh using vertex displacement
    const pillGeo = createPillowGeometry(pillW, pillH, pillL);

    if (isSingle) {
        const pill1 = new THREE.Mesh(pillGeo, fabricWhite);
        pill1.position.set(0, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill1.rotation.x = Math.PI / 18; // slightly propped up
        pill1.castShadow = true;
        group.add(pill1);
    } else {
        const pill1 = new THREE.Mesh(pillGeo, fabricWhite);
        pill1.position.set(-bedW / 4, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill1.rotation.x = Math.PI / 18; // slightly propped up
        pill1.castShadow = true;
        group.add(pill1);

        const pill2 = new THREE.Mesh(pillGeo, fabricWhite);
        pill2.position.set(bedW / 4, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill2.rotation.x = Math.PI / 18;
        pill2.castShadow = true;
        group.add(pill2);
    }

    return { group, width: bedW, length: bedL, height: matY + mattressH / 2 };
}

function buildChair() {
    const group = new THREE.Group();
    const darkWood = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9, color: 0x4a2e15 });

    // Seat
    const seatW = 0.5, seatD = 0.5, seatH = 0.05, legH = 0.5;
    const seatGeo = new THREE.BoxGeometry(seatW, seatH, seatD);
    const seat = new THREE.Mesh(seatGeo, darkWood);
    seat.position.set(0, legH + seatH / 2, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.06, legH, 0.06);
    const legOffsets = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
    legOffsets.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, darkWood);
        leg.position.set(pos[0], legH / 2, pos[1]);
        leg.castShadow = true;
        group.add(leg);
    });

    // Backrest (2 vertical posts + 1 horizontal top rail)
    const postGeo = new THREE.BoxGeometry(0.06, 0.5, 0.06);
    const backL = new THREE.Mesh(postGeo, darkWood);
    backL.position.set(-0.2, legH + seatH + 0.25, -0.2);
    backL.castShadow = true;
    group.add(backL);

    const backR = new THREE.Mesh(postGeo, darkWood);
    backR.position.set(0.2, legH + seatH + 0.25, -0.2);
    backR.castShadow = true;
    group.add(backR);

    const railGeo = new THREE.BoxGeometry(0.46, 0.1, 0.04);
    const topRail = new THREE.Mesh(railGeo, darkWood);
    topRail.position.set(0, legH + seatH + 0.45, -0.2);
    topRail.castShadow = true;
    group.add(topRail);

    return group;
}

function buildTable() {
    const group = new THREE.Group();
    const lightWood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8, color: 0x8b5a2b });
    const darkWood = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.9, color: 0x4a2e15 });

    // Choose shape randomly: 0=square, 1=round, 2=oval/rectangle
    const shapeType = Math.floor(Math.random() * 3);
    const tableH = 0.8;
    const topThick = 0.08;

    let tableW = 1.2, tableD = 1.2;
    let topGeo;

    if (shapeType === 0) {
        // Square
        topGeo = new THREE.BoxGeometry(tableW, topThick, tableD);
    } else if (shapeType === 1) {
        // Round
        topGeo = new THREE.CylinderGeometry(tableW / 2, tableW / 2, topThick, 16);
    } else {
        // Oval / Rectangle
        tableW = 1.6; tableD = 1.0;
        // Approximation of oval using a scaled cylinder
        topGeo = new THREE.CylinderGeometry(tableW / 2, tableW / 2, topThick, 16);
        // Will scale it non-uniformly on Z axis later
    }

    const tableTop = new THREE.Mesh(topGeo, lightWood);
    tableTop.position.set(0, tableH, 0);
    if (shapeType === 2) tableTop.scale.set(1, 1, tableD / tableW);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    group.add(tableTop);

    // Single central pedestal leg with base
    const legGeo = new THREE.CylinderGeometry(0.1, 0.15, tableH - topThick, 8);
    const leg = new THREE.Mesh(legGeo, darkWood);
    leg.position.set(0, tableH / 2, 0);
    leg.castShadow = true;
    group.add(leg);

    const baseGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.1, 8);
    const base = new THREE.Mesh(baseGeo, darkWood);
    base.position.set(0, 0.05, 0);
    base.castShadow = true;
    group.add(base);

    // The physics block must be generated by the caller when the absolute world coordinates are known.

    return { group, width: tableW, depth: tableD, height: tableH };
}

export function placeFurniture(scene) {
    loadTextures();
    // Ensure physics collisions block player movement
    const physBodies = [];

    beds.length = 0; // Reset
    for (const b of getBuildings()) {
        const isSmall = b.w < 5 || b.h < 5; // e.g., 3x4 or 4x4

        let chosenBedCell = null;
        let bedFloor = 1;
        let stairZ = -1;

        if (b.stories === 2) {
            bedFloor = 2;
            stairZ = b.stair ? b.stair.gzStart : -1;

            // Prefer opposite stairs
            if (b.stair) {
                const isStairFront = b.stair.gzStart > b.z + b.h / 2;
                const backZ = isStairFront ? b.z + 1 : b.z + b.h - 2;
                const midX = Math.floor(b.x + b.w / 2);
                for (let x = midX - 1; x <= midX + 1; x++) {
                    if (x <= b.x || x >= b.x + b.w - 1) continue;
                    const hasWin = b.windows.some(w => w.floor === 2 && w.wall === (isStairFront ? 'north' : 'south') && w.gx === x);
                    if (!hasWin) {
                        chosenBedCell = { gx: x, gz: backZ, isNorth: isStairFront, isSouth: !isStairFront, isEast: false, isWest: false };
                        break;
                    }
                }
            }
        } else {
            // 1-story house: place bed on floor 1, typically near back wall
            const backZ = b.z + 1; // Assume back wall is north for simplicity
            const midX = Math.floor(b.x + b.w / 2);
            for (let x = midX - 1; x <= midX + 1; x++) {
                if (x <= b.x || x >= b.x + b.w - 1) continue;
                const hasWin = b.windows.some(w => w.floor === 1 && w.wall === 'north' && w.gx === x);
                // Also don't place in front of the door
                const hasDoor = b.doors.some(d => d.gx === x && d.gz === backZ);
                if (!hasWin && !hasDoor) {
                    chosenBedCell = { gx: x, gz: backZ, isNorth: true, isSouth: false, isEast: false, isWest: false };
                    break;
                }
            }
        }

        // Fallback to side walls if back wall logic didn't find a spot
        if (!chosenBedCell) {
            const midZ = Math.floor(b.z + b.h / 2);
            for (let z = midZ - 1; z <= midZ + 1; z++) {
                if (z <= b.z || z >= b.z + b.h - 1) continue;
                // Don't place on stair
                if (b.stories === 2 && Math.abs(z - stairZ) <= 1) continue;

                const hasWestWin = b.windows.some(w => w.floor === bedFloor && w.wall === 'west' && w.gz === z);
                const hasWestDoor = bedFloor === 1 && b.doors.some(d => d.wall === 'west' && d.gz === z);
                if (!hasWestWin && !hasWestDoor) {
                    chosenBedCell = { gx: b.x + 1, gz: z, isWest: true, isNorth: false, isSouth: false, isEast: false };
                    break;
                }
                const hasEastWin = b.windows.some(w => w.floor === bedFloor && w.wall === 'east' && w.gz === z);
                const hasEastDoor = bedFloor === 1 && b.doors.some(d => d.wall === 'east' && d.gz === z);
                if (!hasEastWin && !hasEastDoor) {
                    chosenBedCell = { gx: b.x + b.w - 2, gz: z, isEast: true, isNorth: false, isSouth: false, isWest: false };
                    break;
                }
            }
        }

        if (chosenBedCell) {
            const p = g2w(chosenBedCell.gx, chosenBedCell.gz);
            const yPos = bedFloor === 2 ? CFG.WALL_H + 0.125 : 0.05;

            // Only use single beds on 1-story small houses
            const isSingle = b.stories === 1 && isSmall;
            const bed = buildFancyBed(isSingle);

            let dx = 0, dz = 0, rot = 0;
            const wallOffset = CFG.CELL / 2 - bed.length / 2 - 0.15; // 0.15 gap

            if (chosenBedCell.isWest) {
                rot = -Math.PI / 2; dx = -wallOffset;
            } else if (chosenBedCell.isNorth) {
                rot = 0; dz = -wallOffset;
            } else if (chosenBedCell.isEast) {
                rot = Math.PI / 2; dx = wallOffset;
            } else if (chosenBedCell.isSouth) {
                rot = Math.PI; dz = wallOffset;
            }

            bed.group.position.set(p.x + dx, yPos, p.z + dz);
            bed.group.rotation.y = rot;

            scene.add(bed.group);
            createStaticBox(bed.length / 2, bed.height / 2, bed.width / 2, bed.group.position.x, yPos + bed.height / 2, bed.group.position.z);

            beds.push({ x: p.x + dx, y: yPos + bed.height, z: p.z + dz });
            if (bedFloor === 1) chosenBedCell = p; // Mark the 1st floor bed coordinate so the table can avoid it
        }

        // --- First Floor Table (if space permits) ---
        // Need at least a 3x3 open interior space to fit a central table comfortably
        // Interior is (w-2) x (h-2). So we need w>=5, h>=5
        if (b.w >= 5 && b.h >= 5) {
            const tableX = Math.floor(b.x + b.w / 2);
            const tableZ = Math.floor(b.z + b.h / 2);
            const c = g2w(tableX, tableZ);

            let blocked = false;
            // Check if stairs are occupying the center or too close
            if (stairZ !== -1 && Math.abs(stairZ - tableZ) <= 2) blocked = true;
            // Check if a 1st floor bed is occupying the center or too close
            if (chosenBedCell && Math.abs(chosenBedCell.gridX - tableX) <= 2 && Math.abs(chosenBedCell.gridZ - tableZ) <= 2) blocked = true;

            if (!blocked) {
                const yPos = 0.05; // Ground floor + slight slab offset

                const { group: tableGrp, width: tw, depth: td, height: th } = buildTable();
                tableGrp.position.set(c.x, yPos, c.z);
                scene.add(tableGrp);

                // Generate physics box using absolute world coordinates
                createStaticBox(tw / 2, th / 2, td / 2, c.x, yPos + th / 2, c.z);

                // Add 2 chairs
                const chair1 = buildChair();
                chair1.position.set(c.x - tw / 2 - 0.4, yPos, c.z);
                chair1.rotation.y = Math.PI / 2; // Facing east towards table
                scene.add(chair1);
                createStaticBox(0.25, 0.5, 0.25, chair1.position.x, yPos + 0.5, chair1.position.z);

                const chair2 = buildChair();
                chair2.position.set(c.x + tw / 2 + 0.4, yPos, c.z);
                chair2.rotation.y = -Math.PI / 2; // Facing west towards table
                scene.add(chair2);
                createStaticBox(0.25, 0.5, 0.25, chair2.position.x, yPos + 0.5, chair2.position.z);
            }
        }
    }

    // Mark beds in grid so NPCs avoid them
    const g = getGrid();
    for (const b of beds) {
        // Beds are often larger than 1 cell, so mark a 2x2 area centered on the bed just to be safe
        const gx = Math.floor(b.x / CFG.CELL);
        const gz = Math.floor(b.z / CFG.CELL);
        if (gx >= 0 && gx < CFG.GRID && gz >= 0 && gz < CFG.GRID) g[gx][gz] = 1;
        if (gx + 1 >= 0 && gx + 1 < CFG.GRID && gz >= 0 && gz < CFG.GRID) g[gx + 1][gz] = 1;
        if (gx >= 0 && gx < CFG.GRID && gz + 1 >= 0 && gz + 1 < CFG.GRID) g[gx][gz + 1] = 1;
        if (gx + 1 >= 0 && gx + 1 < CFG.GRID && gz + 1 >= 0 && gz + 1 < CFG.GRID) g[gx + 1][gz + 1] = 1;
        if (gx - 1 >= 0 && gx - 1 < CFG.GRID && gz >= 0 && gz < CFG.GRID) g[gx - 1][gz] = 1;
        if (gx >= 0 && gx < CFG.GRID && gz - 1 >= 0 && gz - 1 < CFG.GRID) g[gx][gz - 1] = 1;
    }
}
