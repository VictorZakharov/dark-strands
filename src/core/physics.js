import * as CANNON from 'cannon-es';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';

let world;
const FIXED_STEP = 1 / 60;
const MAX_SUB_STEPS = 10;

let groundMaterial, playerMaterial, projectileMaterial, doorMaterial;

export function initPhysics() {
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -CFG.GRAV, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 10;
  world.allowSleep = true;

  groundMaterial = new CANNON.Material('ground');
  playerMaterial = new CANNON.Material('player');
  projectileMaterial = new CANNON.Material('projectile');
  doorMaterial = new CANNON.Material('door');

  // Player-ground: no bounce, zero friction (we set velocity directly each frame)
  world.addContactMaterial(new CANNON.ContactMaterial(
    playerMaterial, groundMaterial,
    { friction: 0.0, restitution: 0.0 }
  ));
  // Projectile-ground: grass-like surface (very high friction, low bounce)
  world.addContactMaterial(new CANNON.ContactMaterial(
    projectileMaterial, groundMaterial,
    { friction: 1.0, restitution: 0.15 }
  ));
  // Projectile-door: bouncy
  world.addContactMaterial(new CANNON.ContactMaterial(
    projectileMaterial, doorMaterial,
    { friction: 0.3, restitution: 0.5 }
  ));
  // Projectile-projectile
  world.addContactMaterial(new CANNON.ContactMaterial(
    projectileMaterial, projectileMaterial,
    { friction: 0.3, restitution: 0.3 }
  ));
  // Player-door: no bounce, zero friction (we set velocity directly)
  world.addContactMaterial(new CANNON.ContactMaterial(
    playerMaterial, doorMaterial,
    { friction: 0.0, restitution: 0.0 }
  ));
}

export function stepPhysics(dt) {
  if (!world) return;
  world.step(FIXED_STEP, dt, MAX_SUB_STEPS);
}

export function getPhysicsWorld() { return world; }
export function getGroundMaterial() { return groundMaterial; }
export function getPlayerMaterial() { return playerMaterial; }
export function getProjectileMaterial() { return projectileMaterial; }
export function getDoorMaterial() { return doorMaterial; }

/** Create a static box body */
export function createStaticBox(hx, hy, hz, px, py, pz, material) {
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    position: new CANNON.Vec3(px, py, pz),
    material: material || groundMaterial,
  });
  world.addBody(body);
  return body;
}

/** Create a static sphere body */
export function createStaticSphere(radius, px, py, pz, material) {
  const body = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Sphere(radius),
    position: new CANNON.Vec3(px, py, pz),
    material: material || groundMaterial,
  });
  world.addBody(body);
  return body;
}

/** Create terrain heightfield from getTerrainHeight */
export function createTerrainBody() {
  const size = CFG.GRID * CFG.CELL;
  const segments = CFG.GRID * 2; // two samples per grid cell for smoother terrain
  const elementSize = size / segments;

  // Build height data matrix — cannon-es Heightfield: data[xi][zi]
  // After -PI/2 X rotation, local +Y maps to world -Z, so j=0 → world Z=+size/2
  const data = [];
  for (let i = 0; i <= segments; i++) {
    data.push([]);
    for (let j = 0; j <= segments; j++) {
      const wx = -size / 2 + i * elementSize;
      const wz = size / 2 - j * elementSize;
      data[i].push(getTerrainHeight(wx, wz));
    }
  }

  const shape = new CANNON.Heightfield(data, { elementSize });
  const body = new CANNON.Body({
    mass: 0,
    shape,
    material: groundMaterial,
  });

  // Heightfield default: XY plane, Z=up. Rotate so Y is up.
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  body.position.set(-size / 2, 0, size / 2);

  world.addBody(body);

  // --- Invisible boundary walls (4 tall boxes at world edges) ---
  const wallH = 30;   // half-height of wall
  const wallT = 0.5;  // thickness
  const wallCY = wallH - 10; // center at y=20, spans y=-10 to y=50 (covers underwater)
  const half = size / 2;
  // +X wall
  createStaticBox(wallT / 2, wallH, half, half + wallT / 2, wallCY, 0);
  // -X wall
  createStaticBox(wallT / 2, wallH, half, -half - wallT / 2, wallCY, 0);
  // +Z wall
  createStaticBox(half, wallH, wallT / 2, 0, wallCY, half + wallT / 2);
  // -Z wall
  createStaticBox(half, wallH, wallT / 2, 0, wallCY, -half - wallT / 2);

  // Snow mode: add invisible ice floor at water level
  if (CFG.SNOW_MODE) {
    const iceBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(size / 2, 0.1, size / 2)),
      position: new CANNON.Vec3(0, CFG.WATER_Y - 0.1, 0),
      material: groundMaterial,
    });
    world.addBody(iceBody);
  }

  return body;
}

/** Create a kinematic box body (for doors) */
export function createKinematicBox(hx, hy, hz, px, py, pz) {
  const body = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.KINEMATIC,
    shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)),
    position: new CANNON.Vec3(px, py, pz),
    material: doorMaterial,
  });
  world.addBody(body);
  return body;
}

/** Create a dynamic sphere for projectiles (group 8, skips window bodies group 4) */
export function createProjectileSphere(radius, px, py, pz, vx, vy, vz) {
  const body = new CANNON.Body({
    mass: 0.5,
    shape: new CANNON.Sphere(radius),
    position: new CANNON.Vec3(px, py, pz),
    velocity: new CANNON.Vec3(vx, vy, vz),
    material: projectileMaterial,
    linearDamping: 0.1,
    angularDamping: 0.95,
    collisionFilterGroup: 8,
    collisionFilterMask: ~4,
  });
  world.addBody(body);
  return body;
}

/** Create a player capsule body (compound: cylinder + two spheres) */
export function createPlayerBody(px, py, pz) {
  const R = CFG.PLAYER_R;
  const cylH = CFG.PLAYER_H - 2 * R;
  const totalH = CFG.PLAYER_H;

  const body = new CANNON.Body({
    mass: 80,
    material: playerMaterial,
    fixedRotation: true,
    linearDamping: 0.0,
    angularDamping: 1.0,
    collisionFilterGroup: 2,
    collisionFilterMask: -1,
  });

  // Cylinder for torso (centered at mid-height)
  const cylinder = new CANNON.Cylinder(R, R, cylH, 8);
  body.addShape(cylinder, new CANNON.Vec3(0, totalH / 2, 0));

  // Bottom sphere (at feet level)
  body.addShape(new CANNON.Sphere(R), new CANNON.Vec3(0, R, 0));

  // Top sphere (at head level)
  body.addShape(new CANNON.Sphere(R), new CANNON.Vec3(0, totalH - R, 0));

  body.position.set(px, py, pz);
  world.addBody(body);
  return body;
}

/** Remove a body from the physics world */
export function removeBody(body) {
  if (body && world) world.removeBody(body);
}
