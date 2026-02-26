import { MeshBuilder, Mesh, VertexData, StandardMaterial,
         Texture, Color3, Vector3 } from 'babylonjs';
import { CFG } from '../config.js';
import { getTerrainHeight } from './terrain.js';
import { addShadowCaster, enableShadowReceiving } from '../core/lighting.js';

function loadTex(path, uScale, vScale, scene) {
    const tex = new Texture(path, scene);
    tex.uScale = uScale;
    tex.vScale = vScale;
    // Babylon.js defaults to WRAP (repeat) addressing
    return tex;
}

export function buildGround(scene) {
    const size = CFG.GRID * CFG.CELL + 20;
    const segments = 64;

    // Create a ground mesh with subdivisions
    const ground = MeshBuilder.CreateGround('ground', {
        width: size,
        height: size,
        subdivisions: segments,
        updatable: true,
    }, scene);

    // Displace vertices for terrain elevation
    const positions = ground.getVerticesData('position');
    for (let i = 0; i < positions.length; i += 3) {
        const wx = positions[i];     // x
        const wz = positions[i + 2]; // z
        const h = getTerrainHeight(wx, wz);
        positions[i + 1] = h;        // y = height
    }

    ground.updateVerticesData('position', positions);
    ground.createNormals(true); // recompute normals after displacement

    // Fix normals if flipped (useRightHandedSystem + createNormals may invert winding)
    const normals = ground.getVerticesData('normal');
    if (normals && normals[1] < 0) {
        console.warn('[GROUND] Flipping normals — were pointing DOWN (Y=' + normals[1].toFixed(3) + ')');
        for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
        ground.updateVerticesData('normal', normals);
    } else {
        console.warn('[GROUND] Normals OK — pointing UP (Y=' + (normals ? normals[1].toFixed(3) : 'null') + ')');
    }

    ground.refreshBoundingInfo();  // update bounding box after vertex displacement

    // StandardMaterial for shadow compatibility (PBR shadows broken with useRightHandedSystem)
    let mat;
    if (CFG.SNOW_MODE) {
        mat = new StandardMaterial('groundMat', scene);
        mat.diffuseColor = new Color3(0.867, 0.894, 0.910);
        mat.specularColor = new Color3(0.02, 0.02, 0.02);
    } else {
        mat = new StandardMaterial('groundMat', scene);
        mat.diffuseTexture = loadTex('./assets/textures/grass.jpg', size / 4, size / 4, scene);
        mat.diffuseColor = new Color3(1.2, 1.2, 1.0);
        mat.ambientColor = new Color3(0.6, 0.6, 0.5);
        mat.specularColor = new Color3(0.02, 0.02, 0.02);
        mat.emissiveColor = new Color3(0.02, 0.03, 0.01);
    }
    ground.material = mat;
    ground.metadata = { isGround: true };
    enableShadowReceiving(ground);
}

export function buildWater(scene) {
    const size = CFG.GRID * CFG.CELL + 20;

    const water = MeshBuilder.CreateGround('water', {
        width: size,
        height: size,
    }, scene);
    water.position.y = CFG.WATER_Y;

    let mat;
    if (CFG.SNOW_MODE) {
        // Frozen ice — slightly shiny, no transparency
        mat = new StandardMaterial('iceMat', scene);
        mat.diffuseColor = new Color3(0.722, 0.831, 0.890); // #b8d4e3
        mat.specularColor = new Color3(0.3, 0.3, 0.3);
        mat.specularPower = 64;
    } else {
        // StandardMaterial for reliable alpha transparency
        mat = new StandardMaterial('waterMat', scene);
        mat.diffuseColor = new Color3(0.133, 0.4, 0.667); // #2266aa
        mat.specularColor = new Color3(0.3, 0.4, 0.5);
        mat.specularPower = 32;
        mat.alpha = 0.45;
        mat.transparencyMode = 2; // ALPHABLEND — force alpha blending pipeline
        mat.backFaceCulling = false; // DoubleSide equivalent
    }
    water.material = mat;
    water.metadata = { isGround: true };
    enableShadowReceiving(water);
}
