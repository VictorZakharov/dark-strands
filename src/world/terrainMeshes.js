import * as THREE from 'three';
import { CFG } from '../config.js';
import { getTerrainHeight } from './terrain.js';

const loader = new THREE.TextureLoader();

function loadTex(path, repeatX, repeatY) {
    const tex = loader.load(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function buildGround(scene) {
    const size = CFG.GRID * CFG.CELL + 20;
    const segments = 128;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);

    // Displace vertices for terrain elevation
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
        const lx = positions.getX(i);
        const ly = positions.getY(i);
        // After -PI/2 rotation: world X = lx, world Z = -ly
        const h = getTerrainHeight(lx, -ly);
        positions.setZ(i, h);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();

    let mat;
    if (CFG.SNOW_MODE) {
        mat = new THREE.MeshStandardMaterial({ color: 0xdde4e8, roughness: 0.85 });
    } else {
        const grassTex = loadTex('./assets/textures/grass.jpg', size / 4, size / 4);
        mat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.userData.isGround = true;
    scene.add(mesh);
}

export function buildWater(scene) {
    const size = CFG.GRID * CFG.CELL + 20;
    const geo = new THREE.PlaneGeometry(size, size);
    let mat;
    if (CFG.SNOW_MODE) {
        mat = new THREE.MeshStandardMaterial({
            color: 0xb8d4e3,
            roughness: 0.15,
            metalness: 0.1,
        });
    } else {
        mat = new THREE.MeshStandardMaterial({
            color: 0x2266aa,
            transparent: true,
            opacity: 0.55,
            roughness: 0.1,
            metalness: 0.3,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = CFG.WATER_Y;
    water.receiveShadow = true;
    water.userData.isGround = true;
    scene.add(water);
}
