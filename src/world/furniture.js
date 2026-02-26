import { MeshBuilder, Mesh, PBRMaterial, Texture, Color3, Vector3, VertexData, Matrix } from 'babylonjs';
import { CFG } from '../config.js';
import { getGrid, isStairCell, isDoorCell, isWindowCell } from './grid.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';
import { createStaticBox } from '../core/physics.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

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

function loadTextures(scene) {
    if (!barkTex) {
        barkTex = new Texture('./assets/textures/bark.jpg', scene);
        barkTex.uScale = 1;
        barkTex.vScale = 1;
    }
    if (!woodTex) {
        woodTex = new Texture('./assets/textures/wood_planks.jpg', scene);
        woodTex.uScale = 2;
        woodTex.vScale = 2;
    }
    if (!blanketTex) {
        blanketTex = new Texture('./assets/textures/fabric.png', scene);
        blanketTex.uScale = 4;
        blanketTex.vScale = 4;
    }
}

function createPillowGeometry(w, h, d, scene) {
    // Start with a heavily subdivided flat box
    const pill = MeshBuilder.CreateBox('pillow', {
        width: w, height: h, depth: d,
        widthSegments: 24, heightSegments: 8, depthSegments: 24
    }, scene);

    const positions = pill.getVerticesData('position');

    // Deform into a soft cushion
    for (let i = 0; i < positions.length; i += 3) {
        let x = positions[i];
        let y = positions[i + 1];
        let z = positions[i + 2];

        // Normalized coordinates from -1 to 1 based on dimensions
        const nx = (x / (w / 2));
        const nz = (z / (d / 2));

        // Plump up the center by pushing Y outwards, tapering to the edges
        const bulge = Math.cos(nx * Math.PI / 2) * Math.cos(nz * Math.PI / 2);

        // Squeeze the edges in slightly for a softer profile
        x *= 1.0 - (0.1 * Math.abs(nz));
        z *= 1.0 - (0.1 * Math.abs(nx));

        y += Math.sign(y) * (bulge * h * 0.8);

        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
    }

    pill.updateVerticesData('position', positions);

    // Recompute normals after deformation
    const normals = [];
    VertexData.ComputeNormals(positions, pill.getIndices(), normals);
    pill.updateVerticesData('normal', normals);

    return pill;
}

function buildFancyBed(scene, isSingle = false) {
    const tempMeshes = [];

    // Dimensions
    const bedW = isSingle ? 1.0 : 1.8;
    const bedL = isSingle ? 2.0 : 2.5;
    const frameThick = 0.15;
    const legH = 0.3;
    const mattressH = 0.3;

    // --- Materials ---
    const darkWood = new PBRMaterial('bedDarkWood', scene);
    darkWood.albedoTexture = barkTex;
    darkWood.albedoColor = Color3.FromHexString('#4a2e15');
    darkWood.roughness = 0.9;
    darkWood.metallic = 0;

    const lightWood = new PBRMaterial('bedLightWood', scene);
    lightWood.albedoTexture = woodTex;
    lightWood.albedoColor = Color3.FromHexString('#8b5a2b');
    lightWood.roughness = 0.8;
    lightWood.metallic = 0;

    const fabricWhite = new PBRMaterial('bedFabricWhite', scene);
    fabricWhite.albedoTexture = blanketTex;
    fabricWhite.albedoColor = Color3.FromHexString('#efefef');
    fabricWhite.roughness = 0.95;
    fabricWhite.metallic = 0;

    const fabricBlanket = new PBRMaterial('bedFabricBlanket', scene);
    fabricBlanket.albedoTexture = blanketTex;
    fabricBlanket.albedoColor = Color3.FromHexString('#ffffff');
    fabricBlanket.roughness = 1.0;
    fabricBlanket.metallic = 0;

    // Base Frame Side Rails
    const railGeo = MeshBuilder.CreateBox('rail', {
        width: frameThick, height: 0.2, depth: bedL - frameThick * 2
    }, scene);

    const railL = railGeo.clone('railL');
    railL.position = new Vector3(-bedW / 2 + frameThick / 2, legH + 0.15, 0);
    railL.material = lightWood;
    tempMeshes.push(railL);

    const railR = railGeo.clone('railR');
    railR.position = new Vector3(bedW / 2 - frameThick / 2, legH + 0.15, 0);
    railR.material = lightWood;
    tempMeshes.push(railR);

    railGeo.dispose();

    // Headboard
    const headH = 1.0;
    const headboard = MeshBuilder.CreateBox('headboard', {
        width: bedW, height: headH, depth: frameThick
    }, scene);
    headboard.position = new Vector3(0, headH / 2 + 0.25, -bedL / 2 + frameThick / 2);
    headboard.material = darkWood;
    tempMeshes.push(headboard);

    // Tufted Fabric Inner Panel
    const innerPanel = MeshBuilder.CreateBox('innerPanel', {
        width: bedW - 0.2, height: headH - 0.2, depth: frameThick * 0.6
    }, scene);
    innerPanel.position = new Vector3(0, headH / 2 + 0.25, -bedL / 2 + frameThick / 2 + frameThick * 0.3);
    innerPanel.material = fabricWhite;
    tempMeshes.push(innerPanel);

    // Curved top crest
    const crest = MeshBuilder.CreateCylinder('crest', {
        diameter: frameThick * 3, height: bedW + 0.1, tessellation: 8
    }, scene);
    crest.rotation = new Vector3(0, 0, Math.PI / 2);
    crest.position = new Vector3(0, headH + 0.25, -bedL / 2 + frameThick / 2);
    crest.material = darkWood;
    tempMeshes.push(crest);

    // Footboard
    const footH = 0.6;
    const footboard = MeshBuilder.CreateBox('footboard', {
        width: bedW, height: footH, depth: frameThick
    }, scene);
    footboard.position = new Vector3(0, footH / 2 + 0.05, bedL / 2 - frameThick / 2);
    footboard.material = darkWood;
    tempMeshes.push(footboard);

    // Legs x4
    const legGeo = MeshBuilder.CreateBox('leg', {
        width: 0.12, height: legH, depth: 0.12
    }, scene);
    const legPositions = [
        [-bedW / 2 + 0.1, legH / 2, -bedL / 2 + 0.1],
        [bedW / 2 - 0.1, legH / 2, -bedL / 2 + 0.1],
        [-bedW / 2 + 0.1, legH / 2, bedL / 2 - 0.1],
        [bedW / 2 - 0.1, legH / 2, bedL / 2 - 0.1]
    ];
    legPositions.forEach((p, idx) => {
        const leg = idx === 0 ? legGeo : legGeo.clone('leg' + idx);
        leg.position = new Vector3(p[0], p[1], p[2]);
        leg.material = darkWood;
        tempMeshes.push(leg);
    });

    // Mattress
    const matY = legH + 0.05 + mattressH / 2;
    const mattress = MeshBuilder.CreateBox('mattress', {
        width: bedW - frameThick * 1.5, height: mattressH, depth: bedL - frameThick * 2.05
    }, scene);
    mattress.position = new Vector3(0, matY, 0);
    mattress.material = fabricWhite;
    tempMeshes.push(mattress);

    // Blanket (covers foot half)
    const blankH = mattressH + 0.04;
    const blankL = (bedL * 0.6) - (frameThick * 2.5);
    const blanket = MeshBuilder.CreateBox('blanket', {
        width: bedW - frameThick * 1.2, height: blankH, depth: blankL
    }, scene);
    blanket.position = new Vector3(0, matY, bedL / 2 - blankL / 2 - frameThick * 1.5);
    blanket.material = fabricBlanket;
    tempMeshes.push(blanket);

    // Pillows
    const pillW = 0.55;
    const pillL = 0.35;
    const pillH = 0.08;

    if (isSingle) {
        const pill1 = createPillowGeometry(pillW, pillH, pillL, scene);
        pill1.position = new Vector3(0, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill1.rotation.x = Math.PI / 18;
        pill1.material = fabricWhite;
        tempMeshes.push(pill1);
    } else {
        const pill1 = createPillowGeometry(pillW, pillH, pillL, scene);
        pill1.position = new Vector3(-bedW / 4, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill1.rotation.x = Math.PI / 18;
        pill1.material = fabricWhite;
        tempMeshes.push(pill1);

        const pill2 = createPillowGeometry(pillW, pillH, pillL, scene);
        pill2.position = new Vector3(bedW / 4, matY + mattressH / 2 + pillH * 1.5 - 0.02, -bedL / 2 + pillL + 0.1);
        pill2.rotation.x = Math.PI / 18;
        pill2.material = fabricWhite;
        tempMeshes.push(pill2);
    }

    // Create a parent transform node to group, then merge
    const parent = new Mesh('bedParent', scene);
    tempMeshes.forEach(m => m.parent = parent);

    return { parent, tempMeshes, width: bedW, length: bedL, height: matY + mattressH / 2 };
}

function buildChair(scene) {
    const tempMeshes = [];

    const darkWood = new PBRMaterial('chairDarkWood', scene);
    darkWood.albedoTexture = barkTex;
    darkWood.albedoColor = Color3.FromHexString('#4a2e15');
    darkWood.roughness = 0.9;
    darkWood.metallic = 0;

    // Seat
    const seatW = 0.5, seatD = 0.5, seatH = 0.05, legH = 0.5;
    const seat = MeshBuilder.CreateBox('chairSeat', {
        width: seatW, height: seatH, depth: seatD
    }, scene);
    seat.position = new Vector3(0, legH + seatH / 2, 0);
    seat.material = darkWood;
    tempMeshes.push(seat);

    // Legs
    const legGeo = MeshBuilder.CreateBox('chairLeg', {
        width: 0.06, height: legH, depth: 0.06
    }, scene);
    const legOffsets = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
    legOffsets.forEach((pos, idx) => {
        const leg = idx === 0 ? legGeo : legGeo.clone('chairLeg' + idx);
        leg.position = new Vector3(pos[0], legH / 2, pos[1]);
        leg.material = darkWood;
        tempMeshes.push(leg);
    });

    // Backrest (2 vertical posts + 1 horizontal top rail)
    const postGeo = MeshBuilder.CreateBox('chairPost', {
        width: 0.06, height: 0.5, depth: 0.06
    }, scene);

    const backL = postGeo;
    backL.position = new Vector3(-0.2, legH + seatH + 0.25, -0.2);
    backL.material = darkWood;
    tempMeshes.push(backL);

    const backR = postGeo.clone('chairPostR');
    backR.position = new Vector3(0.2, legH + seatH + 0.25, -0.2);
    backR.material = darkWood;
    tempMeshes.push(backR);

    const topRail = MeshBuilder.CreateBox('chairTopRail', {
        width: 0.46, height: 0.1, depth: 0.04
    }, scene);
    topRail.position = new Vector3(0, legH + seatH + 0.45, -0.2);
    topRail.material = darkWood;
    tempMeshes.push(topRail);

    const parent = new Mesh('chairParent', scene);
    tempMeshes.forEach(m => m.parent = parent);
    parent.scaling.setAll(1.4);

    return { parent, tempMeshes };
}

function buildTable(scene) {
    const tempMeshes = [];

    const lightWood = new PBRMaterial('tableLightWood', scene);
    lightWood.albedoTexture = woodTex;
    lightWood.albedoColor = Color3.FromHexString('#8b5a2b');
    lightWood.roughness = 0.8;
    lightWood.metallic = 0;

    const darkWood = new PBRMaterial('tableDarkWood', scene);
    darkWood.albedoTexture = barkTex;
    darkWood.albedoColor = Color3.FromHexString('#4a2e15');
    darkWood.roughness = 0.9;
    darkWood.metallic = 0;

    // Choose shape randomly: 0=square, 1=round, 2=oval/rectangle
    const shapeType = Math.floor(Math.random() * 3);
    const tableH = 0.8;
    const topThick = 0.08;

    let tableW = 1.2, tableD = 1.2;
    let tableTop;

    if (shapeType === 0) {
        // Square
        tableTop = MeshBuilder.CreateBox('tableTop', {
            width: tableW, height: topThick, depth: tableD
        }, scene);
    } else if (shapeType === 1) {
        // Round
        tableTop = MeshBuilder.CreateCylinder('tableTop', {
            diameter: tableW, height: topThick, tessellation: 16
        }, scene);
    } else {
        // Oval / Rectangle
        tableW = 1.6; tableD = 1.0;
        // Approximation of oval using a scaled cylinder
        tableTop = MeshBuilder.CreateCylinder('tableTop', {
            diameter: tableW, height: topThick, tessellation: 16
        }, scene);
        // Will scale it non-uniformly on Z axis later
    }

    tableTop.position = new Vector3(0, tableH, 0);
    if (shapeType === 2) tableTop.scaling = new Vector3(1, 1, tableD / tableW);
    tableTop.material = lightWood;
    tempMeshes.push(tableTop);

    // Single central pedestal leg with base
    const leg = MeshBuilder.CreateCylinder('tableLeg', {
        diameterTop: 0.2, diameterBottom: 0.3, height: tableH - topThick, tessellation: 8
    }, scene);
    leg.position = new Vector3(0, tableH / 2, 0);
    leg.material = darkWood;
    tempMeshes.push(leg);

    const base = MeshBuilder.CreateCylinder('tableBase', {
        diameter: 0.8, height: 0.1, tessellation: 8
    }, scene);
    base.position = new Vector3(0, 0.05, 0);
    base.material = darkWood;
    tempMeshes.push(base);

    const parent = new Mesh('tableParent', scene);
    tempMeshes.forEach(m => m.parent = parent);
    parent.scaling.setAll(1.4);

    return { parent, tempMeshes, width: tableW * 1.4, depth: tableD * 1.4, height: tableH * 1.4 };
}

// Bake all child meshes from a parent into final merged meshes, applying world transforms
function mergeAndAddToScene(parent, tempMeshes, scene) {
    // Compute world matrices
    parent.computeWorldMatrix(true);
    tempMeshes.forEach(m => m.computeWorldMatrix(true));

    // Group meshes by material for batched merging
    const meshesByMat = new Map();
    for (const m of tempMeshes) {
        const matId = m.material ? m.material.uniqueId : 'none';
        if (!meshesByMat.has(matId)) meshesByMat.set(matId, []);
        meshesByMat.get(matId).push(m);
    }

    const finalMeshes = [];
    for (const [matId, meshes] of meshesByMat) {
        if (meshes.length === 0) continue;
        // Do NOT call bakeCurrentTransformIntoVertices — MergeMeshes already
        // applies each mesh's world matrix (including parent) to its vertices.
        // Baking first would double-apply the parent transform.
        const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
        if (!merged) continue;
        merged.parent = null; // ensure merged mesh is at scene root
        addShadowCaster(merged);
        enableShadowReceiving(merged);
        finalMeshes.push(merged);
    }

    // Dispose the parent container
    parent.dispose();

    return finalMeshes;
}

export function placeFurniture(scene) {
    loadTextures(scene);

    beds.length = 0; // Reset
    for (const b of getBuildings()) {
        const isSmall = b.w < 5 || b.h < 5;

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
                    const hasDoor = b.doors.some(d => Math.abs(d.gx - x) <= 2 && Math.abs(d.gz - backZ) <= 2);
                    if (!hasWin && !hasDoor) {
                        chosenBedCell = { gx: x, gz: backZ, isNorth: isStairFront, isSouth: !isStairFront, isEast: false, isWest: false };
                        break;
                    }
                }
            }
        } else {
            // 1-story house: place bed on floor 1, typically near back wall
            const backZ = b.z + 1;
            const midX = Math.floor(b.x + b.w / 2);
            for (let x = midX - 1; x <= midX + 1; x++) {
                if (x <= b.x || x >= b.x + b.w - 1) continue;
                const hasWin = b.windows.some(w => w.floor === 1 && w.wall === 'north' && w.gx === x);
                const hasDoor = b.doors.some(d => Math.abs(d.gx - x) <= 2 && Math.abs(d.gz - backZ) <= 2);
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
                if (isStairCell(b.x + 1, z) || isStairCell(b.x + 1, z - 1) || isStairCell(b.x + 1, z + 1) ||
                    isStairCell(b.x + b.w - 2, z) || isStairCell(b.x + b.w - 2, z - 1) || isStairCell(b.x + b.w - 2, z + 1)) continue;

                let nearDoor = false;
                for (const d of b.doors) {
                    if (bedFloor === 1 && Math.abs(b.x + 1 - d.gx) <= 2 && Math.abs(z - d.gz) <= 2) nearDoor = true;
                }

                const hasWestWin = b.windows.some(w => w.floor === bedFloor && w.wall === 'west' && w.gz === z);
                if (!hasWestWin && !nearDoor) {
                    chosenBedCell = { gx: b.x + 1, gz: z, isWest: true, isNorth: false, isSouth: false, isEast: false };
                    break;
                }

                nearDoor = false;
                for (const d of b.doors) {
                    if (bedFloor === 1 && Math.abs(b.x + b.w - 2 - d.gx) <= 2 && Math.abs(z - d.gz) <= 2) nearDoor = true;
                }

                const hasEastWin = b.windows.some(w => w.floor === bedFloor && w.wall === 'east' && w.gz === z);
                if (!hasEastWin && !nearDoor) {
                    chosenBedCell = { gx: b.x + b.w - 2, gz: z, isEast: true, isNorth: false, isSouth: false, isWest: false };
                    break;
                }
            }
        }

        if (chosenBedCell) {
            const p = g2w(chosenBedCell.gx, chosenBedCell.gz);
            const yPos = bedFloor === 2 ? CFG.WALL_H + 0.125 : 0.05;

            const isSingle = b.stories === 1 && isSmall;
            const bed = buildFancyBed(scene, isSingle);

            let dx = 0, dz = 0, rot = 0;
            const wallOffset = CFG.CELL / 2 - bed.length / 2 - 0.15;

            if (chosenBedCell.isWest) {
                rot = -Math.PI / 2; dx = -wallOffset;
            } else if (chosenBedCell.isNorth) {
                rot = 0; dz = -wallOffset;
            } else if (chosenBedCell.isEast) {
                rot = Math.PI / 2; dx = wallOffset;
            } else if (chosenBedCell.isSouth) {
                rot = Math.PI; dz = wallOffset;
            }

            bed.parent.position = new Vector3(p.x + dx, yPos, p.z + dz);
            bed.parent.rotation.y = rot;

            mergeAndAddToScene(bed.parent, bed.tempMeshes, scene);

            // Mattress physics — swap X/Z based on rotation
            const isRot90 = Math.abs(Math.abs(rot) - Math.PI / 2) < 0.01;
            const bedHX = isRot90 ? bed.length / 2 : bed.width / 2;
            const bedHZ = isRot90 ? bed.width / 2 : bed.length / 2;
            createStaticBox(bedHX, bed.height / 2, bedHZ, p.x + dx, yPos + bed.height / 2, p.z + dz);

            // Headboard physics — tall panel at the head end of the bed
            const headboardH = 1.0;
            const headboardCenterY = yPos + 0.75;
            const headLocalZ = -bed.length / 2 + 0.075;
            const headWX = -Math.sin(rot) * headLocalZ;
            const headWZ = Math.cos(rot) * headLocalZ;
            const hbHX = isRot90 ? 0.1 : bed.width / 2;
            const hbHZ = isRot90 ? bed.width / 2 : 0.1;
            createStaticBox(hbHX, headboardH / 2, hbHZ,
                p.x + dx + headWX, headboardCenterY, p.z + dz + headWZ);

            beds.push({ x: p.x + dx, y: yPos + bed.height, z: p.z + dz });
            if (bedFloor === 1) chosenBedCell = { gx: chosenBedCell.gx, gz: chosenBedCell.gz };
        }

        // --- First Floor Table ---
        if (b.w >= 4 && b.h >= 4) {
            let tableCell = null;
            const candidates = [];

            // Try side walls (West, East) then back wall (North)
            for (let z = b.z + 1; z < b.z + b.h - 1; z++) candidates.push({ gx: b.x + 1, gz: z, wall: 'west' });
            for (let z = b.z + 1; z < b.z + b.h - 1; z++) candidates.push({ gx: b.x + b.w - 2, gz: z, wall: 'east' });
            for (let x = b.x + 2; x < b.x + b.w - 2; x++) candidates.push({ gx: x, gz: b.z + 1, wall: 'north' });

            for (const cand of candidates) {
                if (isStairCell(cand.gx, cand.gz) ||
                    isStairCell(cand.gx, cand.gz - 1) || isStairCell(cand.gx, cand.gz + 1) ||
                    isStairCell(cand.gx - 1, cand.gz) || isStairCell(cand.gx + 1, cand.gz)) continue;

                if (bedFloor === 1 && chosenBedCell && Math.abs(cand.gx - chosenBedCell.gx) <= 1 && Math.abs(cand.gz - chosenBedCell.gz) <= 1) continue;

                let doorOverlap = false;
                for (const d of b.doors) {
                    if (Math.abs(d.gx - cand.gx) <= 1 && Math.abs(d.gz - cand.gz) <= 1) doorOverlap = true;
                }
                if (doorOverlap) continue;

                tableCell = cand;
                break;
            }

            if (tableCell) {
                const c = g2w(tableCell.gx, tableCell.gz);
                const yPos = 0.05;

                const { parent: tableParent, tempMeshes: tableMeshes, width: tw, depth: td, height: th } = buildTable(scene);

                // Flush offset against the wall
                const wallOffset = CFG.CELL / 2 - td / 2 - 0.15;
                let dx = 0, dz = 0, rot = 0;
                let hx = tw / 2, hz = td / 2;

                if (tableCell.wall === 'west') { rot = -Math.PI / 2; dx = -wallOffset; hx = td / 2; hz = tw / 2; }
                else if (tableCell.wall === 'east') { rot = Math.PI / 2; dx = wallOffset; hx = td / 2; hz = tw / 2; }
                else if (tableCell.wall === 'north') { rot = 0; dz = -wallOffset; }

                tableParent.position = new Vector3(c.x + dx, yPos, c.z + dz);
                tableParent.rotation.y = rot;
                mergeAndAddToScene(tableParent, tableMeshes, scene);
                createStaticBox(hx, th / 2, hz, c.x + dx, yPos + th / 2, c.z + dz);

                // Place 2 chairs at the ends of the table facing inward
                let c1x = 0, c1z = 0, c1rot = 0;
                let c2x = 0, c2z = 0, c2rot = 0;

                const chairDistX = rot !== 0 ? 0 : tw / 2 + 0.21;
                const chairDistZ = rot !== 0 ? tw / 2 + 0.21 : 0;

                if (tableCell.wall === 'west') {
                    c1x = c.x + dx; c1z = c.z + dz - chairDistZ; c1rot = 0;
                    c2x = c.x + dx; c2z = c.z + dz + chairDistZ; c2rot = Math.PI;
                } else if (tableCell.wall === 'east') {
                    c1x = c.x + dx; c1z = c.z + dz - chairDistZ; c1rot = 0;
                    c2x = c.x + dx; c2z = c.z + dz + chairDistZ; c2rot = Math.PI;
                } else if (tableCell.wall === 'north') {
                    c1x = c.x + dx - chairDistX; c1z = c.z + dz; c1rot = Math.PI / 2;
                    c2x = c.x + dx + chairDistX; c2z = c.z + dz; c2rot = -Math.PI / 2;
                }

                const chair1 = buildChair(scene);
                chair1.parent.position = new Vector3(c1x, yPos, c1z);
                chair1.parent.rotation.y = c1rot;
                mergeAndAddToScene(chair1.parent, chair1.tempMeshes, scene);
                createStaticBox(0.35, 0.7, 0.35, c1x, yPos + 0.7, c1z);

                const chair2 = buildChair(scene);
                chair2.parent.position = new Vector3(c2x, yPos, c2z);
                chair2.parent.rotation.y = c2rot;
                mergeAndAddToScene(chair2.parent, chair2.tempMeshes, scene);
                createStaticBox(0.35, 0.7, 0.35, c2x, yPos + 0.7, c2z);
            }
        }
    }

    // Mark beds in grid so NPCs avoid them
    const g = getGrid();
    for (const b of beds) {
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
