import RAPIER from '@dimforge/rapier3d-compat';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';

let world;

/* ── Collision group bits ─────────────────────────────────── */
const GRP_DEFAULT    = 0x0001;
const GRP_PLAYER     = 0x0002;
const GRP_WINDOW     = 0x0004;
const GRP_PROJECTILE = 0x0008;
const GRP_DOOR       = 0x0010;
const GRP_CEILING    = 0x0020;
const GRP_ALL        = 0xFFFF;

function cg(membership, filter) {
  return (membership << 16) | filter;
}

/** Window collision group: blocks player/doors but projectiles pass through */
export const WINDOW_COLLISION_GROUP = cg(GRP_WINDOW, GRP_ALL & ~GRP_PROJECTILE);

/** Ceiling collision group: blocks player but excluded from camera raycasts */
export const CEILING_COLLISION_GROUP = cg(GRP_CEILING, GRP_ALL);

/* ── PhysicsBodyWrapper ───────────────────────────────────── */
// Thin proxy so consumer code can keep using body.position.x, body.velocity.y, etc.

class Vec3Proxy {
  constructor(getter, setter) {
    this._get = getter;
    this._set = setter;
  }
  get x()  { return this._get().x; }
  set x(v) { const c = this._get(); this._set({ x: v, y: c.y, z: c.z }); }
  get y()  { return this._get().y; }
  set y(v) { const c = this._get(); this._set({ x: c.x, y: v, z: c.z }); }
  get z()  { return this._get().z; }
  set z(v) { const c = this._get(); this._set({ x: c.x, y: c.y, z: v }); }
  set(x, y, z) { this._set({ x, y, z }); }
  distanceTo(other) {
    const a = this._get();
    const dx = a.x - other.x, dy = a.y - other.y, dz = a.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

class QuatProxy {
  constructor(rb) { this._rb = rb; }
  get x() { return this._rb.rotation().x; }
  get y() { return this._rb.rotation().y; }
  get z() { return this._rb.rotation().z; }
  get w() { return this._rb.rotation().w; }
  setFromEuler(x, y, z) {
    // Euler (XYZ intrinsic) → quaternion
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    this._rb.setNextKinematicRotation({
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz + sx * sy * cz,
      w: cx * cy * cz - sx * sy * sz,
    });
  }
  setFromAxisAngle(axis, angle) {
    const ha = angle / 2, s = Math.sin(ha);
    this._rb.setRotation({
      x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(ha),
    }, false);
  }
}

class PhysicsBodyWrapper {
  constructor(rb, isKinematic = false) {
    this.rapierBody = rb;
    this._kinematic = isKinematic;

    this.position = new Vec3Proxy(
      () => rb.translation(),
      (v) => {
        if (isKinematic) rb.setNextKinematicTranslation(v);
        else rb.setTranslation(v, true);
      }
    );

    this.velocity = new Vec3Proxy(
      () => rb.linvel(),
      (v) => rb.setLinvel(v, true)
    );

    this.quaternion = new QuatProxy(rb);
  }

  get mass() { return this.rapierBody.mass(); }

  get linearDamping() { return this.rapierBody.linearDamping(); }
  set linearDamping(v) { this.rapierBody.setLinearDamping(v); }

  get angularDamping() { return this.rapierBody.angularDamping(); }
  set angularDamping(v) { this.rapierBody.setAngularDamping(v); }

  applyForce(f) {
    this.rapierBody.addForce(
      { x: f.x || 0, y: f.y || 0, z: f.z || 0 },
      true
    );
  }
  wakeUp() { this.rapierBody.wakeUp(); }
}

/* ── Init ─────────────────────────────────────────────────── */

export async function initPhysics() {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -CFG.GRAV, z: 0 });
}

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 10;
let accumulator = 0;

export function stepPhysics(dt) {
  if (!world) return;
  accumulator += dt;
  world.timestep = FIXED_STEP;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
    world.step();
    accumulator -= FIXED_STEP;
    steps++;
  }
  if (steps >= MAX_STEPS) accumulator = 0; // prevent spiral of death
}

export function getPhysicsWorld() { return world; }

/* ── Material helpers (friction / restitution presets) ───── */
// cannon-es used ContactMaterial pairs; Rapier sets per-collider.
// These are kept for backward-compat imports but now return string tags
// used internally by the create* helpers.
const MAT = {
  ground:     { friction: 0.5,  restitution: 0.0  },
  player:     { friction: 0.0,  restitution: 0.0  },
  projectile: { friction: 1.0,  restitution: 0.15 },
  door:       { friction: 0.0,  restitution: 0.0  },
  roof:       { friction: 0.1,  restitution: 0.3  },
};

export function getGroundMaterial()     { return 'ground'; }
export function getPlayerMaterial()     { return 'player'; }
export function getProjectileMaterial() { return 'projectile'; }
export function getDoorMaterial()       { return 'door'; }
export function getRoofMaterial()       { return 'roof'; }

function applyMat(colliderDesc, matKey) {
  const m = MAT[matKey] || MAT.ground;
  colliderDesc.setFriction(m.friction);
  colliderDesc.setRestitution(m.restitution);
  return colliderDesc;
}

function matKeyFromArg(material) {
  if (!material) return 'ground';
  if (typeof material === 'string') return material;
  // legacy: cannon-es Material object had .name
  if (material.name) return material.name;
  return 'ground';
}

/* ── Body creation helpers ────────────────────────────────── */

export function createStaticBox(hx, hy, hz, px, py, pz, material, collisionGroup) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(px, py, pz);
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  applyMat(cd, matKeyFromArg(material));
  if (collisionGroup !== undefined) {
    cd.setCollisionGroups(collisionGroup);
  } else {
    cd.setCollisionGroups(cg(GRP_DEFAULT, GRP_ALL));
  }
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb);
}

export function createRotatedStaticBox(hx, hy, hz, px, py, pz, ax, ay, az, angle, material, collisionGroup) {
  const ha = angle / 2, s = Math.sin(ha);
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(px, py, pz)
    .setRotation({
      x: ax * s, y: ay * s, z: az * s, w: Math.cos(ha),
    });
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  applyMat(cd, matKeyFromArg(material));
  if (collisionGroup !== undefined) {
    cd.setCollisionGroups(collisionGroup);
  } else {
    cd.setCollisionGroups(cg(GRP_DEFAULT, GRP_ALL));
  }
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb);
}

export function createStaticCylinder(radius, halfHeight, px, py, pz, material) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(px, py, pz);
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.cylinder(halfHeight, radius);
  applyMat(cd, matKeyFromArg(material));
  cd.setCollisionGroups(cg(GRP_DEFAULT, GRP_ALL));
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb);
}

export function createStaticSphere(radius, px, py, pz, material) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(px, py, pz);
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.ball(radius);
  applyMat(cd, matKeyFromArg(material));
  cd.setCollisionGroups(cg(GRP_DEFAULT, GRP_ALL));
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb);
}

/** Create terrain heightfield from getTerrainHeight */
export function createTerrainBody() {
  const size = CFG.GRID * CFG.CELL;
  const segments = CFG.GRID * 2;
  const elementSize = size / segments;

  // Rapier heightfield: column-major Float32Array, Y-up native
  // In Rapier: nrows → Z axis, ncols → X axis
  // scale = total extent (NOT per-cell), heightfield is centered at collider origin
  const nrows = segments + 1;  // Z samples
  const ncols = segments + 1;  // X samples
  const heights = new Float32Array(nrows * ncols);

  for (let col = 0; col < ncols; col++) {
    for (let row = 0; row < nrows; row++) {
      const wx = -size / 2 + col * elementSize;  // col → X
      const wz = -size / 2 + row * elementSize;  // row → Z
      // Column-major: index = col * nrows + row
      heights[col * nrows + row] = getTerrainHeight(wx, wz);
    }
  }

  const scale = { x: size, y: 1.0, z: size };  // total extent, NOT per-cell
  const cd = RAPIER.ColliderDesc.heightfield(nrows - 1, ncols - 1, heights, scale);
  applyMat(cd, 'ground');
  cd.setCollisionGroups(cg(GRP_DEFAULT, GRP_ALL));
  // Heightfield is centered at its collider position — no translation needed
  const bodyDesc = RAPIER.RigidBodyDesc.fixed();
  const rb = world.createRigidBody(bodyDesc);
  world.createCollider(cd, rb);


  // Boundary walls
  const wallH = 30;
  const wallT = 0.5;
  const wallCY = wallH - 10;
  const half = size / 2;
  createStaticBox(wallT / 2, wallH, half, half + wallT / 2, wallCY, 0);
  createStaticBox(wallT / 2, wallH, half, -half - wallT / 2, wallCY, 0);
  createStaticBox(half, wallH, wallT / 2, 0, wallCY, half + wallT / 2);
  createStaticBox(half, wallH, wallT / 2, 0, wallCY, -half - wallT / 2);

  // Snow mode: invisible ice floor at water level
  if (CFG.SNOW_MODE) {
    createStaticBox(size / 2, 0.1, size / 2, 0, CFG.WATER_Y - 0.1, 0);
  }

  return new PhysicsBodyWrapper(rb);
}

/** Create a kinematic box body (for doors) */
export function createKinematicBox(hx, hy, hz, px, py, pz) {
  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(px, py, pz);
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.cuboid(hx, hy, hz);
  applyMat(cd, 'door');
  cd.setCollisionGroups(cg(GRP_DOOR, GRP_ALL));
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb, true);
}

/** Create a dynamic sphere for projectiles */
export function createProjectileSphere(radius, px, py, pz, vx, vy, vz) {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(px, py, pz)
    .setLinvel(vx, vy, vz)
    .setLinearDamping(0.1)
    .setAngularDamping(0.95)
    .setCcdEnabled(true);
  const rb = world.createRigidBody(bodyDesc);
  const cd = RAPIER.ColliderDesc.ball(radius);
  cd.setMass(0.5); // match cannon-es projectile mass
  applyMat(cd, 'projectile');
  // Projectile group: membership=PROJECTILE, filter=everything except WINDOW
  cd.setCollisionGroups(cg(GRP_PROJECTILE, GRP_ALL & ~GRP_WINDOW));
  world.createCollider(cd, rb);
  return new PhysicsBodyWrapper(rb);
}

/** Create a player capsule body */
export function createPlayerBody(px, py, pz) {
  const R = CFG.PLAYER_R;
  const halfH = (CFG.PLAYER_H - 2 * R) / 2; // half-height of cylindrical part

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(px, py + CFG.PLAYER_H / 2, pz)
    .setLinearDamping(0.0)
    .setAngularDamping(1.0)
    .setCcdEnabled(true)
    .lockRotations();
  const rb = world.createRigidBody(bodyDesc);

  // Native capsule — halfH is half the cylinder length, R is radius
  const cd = RAPIER.ColliderDesc.capsule(halfH, R);
  cd.setMass(80); // match cannon-es player mass
  applyMat(cd, 'player');
  // Use Min combine rule so player's 0-friction always wins against walls
  cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
  cd.setCollisionGroups(cg(GRP_PLAYER, GRP_ALL));
  const col = world.createCollider(cd, rb);
  _playerCollider = col;

  // Wrap with position proxy that reports foot position (subtract PLAYER_H/2)
  return new PlayerBodyWrapper(rb);
}

// Special wrapper for player — position reports foot Y, not capsule center
class PlayerBodyWrapper extends PhysicsBodyWrapper {
  constructor(rb) {
    super(rb, false);
    const halfH = CFG.PLAYER_H / 2;
    // Override position proxy to offset by half-height so consumer sees foot position
    this.position = new Vec3Proxy(
      () => {
        const t = rb.translation();
        return { x: t.x, y: t.y - halfH, z: t.z };
      },
      (v) => {
        rb.setTranslation({ x: v.x, y: v.y + halfH, z: v.z }, true);
      }
    );
  }
}

/** Remove a body from the physics world */
export function removeBody(body) {
  if (body && world && body.rapierBody) {
    world.removeRigidBody(body.rapierBody);
  }
}

/* ── Raycast helper ───────────────────────────────────────── */

let _playerCollider = null;

/**
 * Cast a ray from `from` to `to`, excluding the player capsule.
 * @param {boolean} [excludePlayer=true] - if true, skip the player collider
 * Returns { hasHit, hitPointWorld: {x,y,z} }
 */
export function raycastClosest(from, to, excludePlayer = true, filterGroups) {
  if (!world) return { hasHit: false };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return { hasHit: false };

  const dir = { x: dx / len, y: dy / len, z: dz / len };
  const ray = new RAPIER.Ray(from, dir);

  // Use filterExcludeCollider to skip the player capsule
  const exCol = (excludePlayer && _playerCollider) ? _playerCollider : undefined;
  const hit = world.castRay(ray, len, true, undefined, filterGroups, exCol);
  if (!hit) return { hasHit: false };

  const t = hit.timeOfImpact;
  return {
    hasHit: true,
    hitPointWorld: { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t },
  };
}

/** Collision filter that excludes ceiling slabs from camera raycasts */
export const CAM_RAY_GROUPS = cg(GRP_DEFAULT, GRP_ALL & ~GRP_CEILING);
