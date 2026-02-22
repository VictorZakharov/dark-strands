import * as THREE from 'three';
import { CFG } from '../config.js';
import { getBuildings } from './generator.js';
import { g2w } from '../utils/helpers.js';

const loader = new THREE.TextureLoader();

function loadTex(path, repeatX, repeatY) {
    const tex = loader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function getBuildingCenter(b) {
    const p1 = g2w(b.x, b.z);
    const p2 = g2w(b.x + b.w - 1, b.z + b.h - 1);
    return { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
}

export function buildFloors(scene) {
    const woodTex = loadTex('./assets/textures/wood_planks.jpg', 3, 3);
    const floorMat = new THREE.MeshStandardMaterial({
        map: woodTex,
        roughness: 0.75,
        side: THREE.DoubleSide,
    });

    const stairWoodTex = loadTex('./assets/textures/wood_planks.jpg', 1, 2);
    const stairMat = new THREE.MeshStandardMaterial({
        map: stairWoodTex,
        roughness: 0.75,
    });

    const stoneTex = loadTex('./assets/textures/stone_wall.jpg', 4, 4);
    const midFloorMat = new THREE.MeshStandardMaterial({
        map: stoneTex,
        roughness: 0.85,
    });

    for (const b of getBuildings()) {
        const c = getBuildingCenter(b);

        // Ground floor — inset slightly inside walls to avoid z-fighting at edges
        const fw = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const fh = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
        const GROUND_SLAB = 0.6;
        const fg = new THREE.BoxGeometry(fw, GROUND_SLAB, fh);
        const fm = new THREE.Mesh(fg, floorMat);
        fm.position.set(c.x, 0.02 - GROUND_SLAB / 2, c.z);
        fm.receiveShadow = true;
        scene.add(fm);

        // Mid-level floor for 2-story buildings (with stairwell gap)
        const FLOOR_THICK = 0.5;
        const FLOOR_TOP_OFFSET = -0.125; // shift down so top surface stays at original visual position
        if (b.stories === 2 && b.stair) {
            const s = b.stair;
            const stairP = g2w(s.gx, s.gzStart);

            // Extend floor into walls for seamless coverage
            const intLeft = g2w(b.x, 0).x;
            const intRight = g2w(b.x + b.w - 1, 0).x;
            const intBack = g2w(0, b.z).z;
            const intFront = g2w(0, b.z + b.h - 1).z;

            const stairLeft = stairP.x - CFG.CELL / 2;
            const stairRight = stairP.x + CFG.CELL / 2;
            const stairFront = g2w(0, s.gzEnd).z + CFG.CELL / 2;

            const floorY = CFG.WALL_H;

            // Piece 1: left of stairwell, full depth
            const p1w = stairLeft - intLeft;
            const p1d = intFront - intBack;
            if (p1w > 0.1 && p1d > 0.1) {
                const geo = new THREE.BoxGeometry(p1w, FLOOR_THICK, p1d);
                const mesh = new THREE.Mesh(geo, floorMat);
                mesh.position.set(intLeft + p1w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p1d / 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
            }

            // Piece 2: above stairwell (front of stair to front of interior)
            const p2w = stairRight - stairLeft;
            const p2d = intFront - stairFront;
            if (p2w > 0.1 && p2d > 0.1) {
                const geo = new THREE.BoxGeometry(p2w, FLOOR_THICK, p2d);
                const mesh = new THREE.Mesh(geo, floorMat);
                mesh.position.set(stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, stairFront + p2d / 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
            }

            // Piece 3: right of stairwell, full depth
            const p3w = intRight - stairRight;
            const p3d = intFront - intBack;
            if (p3w > 0.1 && p3d > 0.1) {
                const geo = new THREE.BoxGeometry(p3w, FLOOR_THICK, p3d);
                const mesh = new THREE.Mesh(geo, floorMat);
                mesh.position.set(stairRight + p3w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p3d / 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
            }

            // Piece 4: behind stairwell (north of first stair cell), stair column width
            const stairBack = stairP.z - CFG.CELL / 2;
            const p4d = stairBack - intBack;
            if (p2w > 0.1 && p4d > 0.1) {
                const geo = new THREE.BoxGeometry(p2w, FLOOR_THICK, p4d);
                const mesh = new THREE.Mesh(geo, floorMat);
                mesh.position.set(stairLeft + p2w / 2, floorY + FLOOR_TOP_OFFSET, intBack + p4d / 2);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                scene.add(mesh);
            }

            buildStairSteps(scene, b, stairMat);
        } else if (b.stories === 2) {
            // Full floor, no stairwell — inset slightly inside walls
            const fullW = (b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const fullH = (b.h - 1) * CFG.CELL + CFG.WALL_T - 0.06;
            const mg = new THREE.BoxGeometry(fullW, FLOOR_THICK, fullH);
            const mm = new THREE.Mesh(mg, floorMat);
            mm.position.set(c.x, CFG.WALL_H - 0.125, c.z);
            mm.castShadow = true;
            mm.receiveShadow = true;
            scene.add(mm);
        }
    }
}

function buildStairSteps(scene, b, mat) {
    const s = b.stair;
    const stairP1 = g2w(s.gx, s.gzStart);
    const stairP2 = g2w(s.gx, s.gzEnd);

    const stairWidth = CFG.CELL * 0.95;
    // Flush against the right wall (shift right so right edge meets wall inner face)
    const stairX = stairP1.x + (CFG.CELL - stairWidth) / 2;
    const zMin = stairP1.z - CFG.CELL / 2;
    const zMax = stairP2.z + CFG.CELL / 2;
    const totalDepth = zMax - zMin;

    const numSteps = 8;
    const stepH = CFG.WALL_H / numSteps;
    const stepD = totalDepth / numSteps;

    for (let i = 0; i < numSteps; i++) {
        const h = (i + 1) * stepH;
        const geo = new THREE.BoxGeometry(stairWidth, h, stepD);
        const step = new THREE.Mesh(geo, mat);
        step.position.set(stairX, h / 2, zMax - (i + 0.5) * stepD);
        step.castShadow = true;
        step.receiveShadow = true;
        scene.add(step);
    }
}
