import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin, PhysicsBody, PhysicsMotionType,
         PhysicsShapeBox, PhysicsShapeSphere, PhysicsShapeCapsule,
         PhysicsShapeCylinder, PhysicsShapeHeightField,
         PhysicsRaycastResult, PhysicsMaterialCombineMode,
         TransformNode, Vector3, Quaternion } from 'babylonjs';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';
import { getScene } from './scene.js';

let physicsEngine;
let scene;

/* ── Collision group bits ─────────────────────────────────── */
const GRP_DEFAULT    = 0x0001;
const GRP_PLAYER     = 0x0002;
const GRP_WINDOW     = 0x0004;
const GRP_PROJECTILE = 0x0008;
const GRP_DOOR       = 0x0010;
const GRP_CEILING    = 0x0020;
const GRP_ALL        = 0xFFFF;

/** Window collision group: blocks player/doors but projectiles pass through */
export const WINDOW_COLLISION_GROUP = { membership: GRP_WINDOW, filter: GRP_ALL & ~GRP_PROJECTILE };

/** Ceiling collision group: blocks player but excluded from camera raycasts */
export const CEILING_COLLISION_GROUP = { membership: GRP_CEILING, filter: GRP_ALL };

/* ── PhysicsBodyWrapper ───────────────────────────────────── */
// Thin proxy so consumer code can keep using body.position.x, body.velocity.y, etc.

class Vec3Proxy {
  constructor(getter, setter) {
    this._get = getter;
    this._set = setter;
  }
  get x()  { return this._get().x; }
  set x(v) { const c = this._get(); this._set(c.x, c.y, c.z, v, 'x'); }
  get y()  { return this._get().y; }
  set y(v) { const c = this._get(); this._set(c.x, c.y, c.z, v, 'y'); }
  get z()  { return this._get().z; }
  set z(v) { const c = this._get(); this._set(c.x, c.y, c.z, v, 'z'); }
  set(x, y, z) { this._set(x, y, z); }
  distanceTo(other) {
    const a = this._get();
    const dx = a.x - other.x, dy = a.y - other.y, dz = a.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}

class PhysicsBodyWrapper {
  /**
   * @param {PhysicsBody} havokBody
   * @param {TransformNode} node
   * @param {PhysicsShape} shape
   * @param {boolean} isKinematic
   */
  constructor(havokBody, node, shape, isKinematic = false) {
    this.havokBody = havokBody;
    this._node = node;
    this._shape = shape;
    this._kinematic = isKinematic;

    // Position proxy — reads/writes the TransformNode position
    this.position = new Vec3Proxy(
      () => node.position,
      (x, y, z, v, axis) => {
        if (axis) {
          // Single-axis set
          node.position[axis] = v;
        } else {
          node.position.set(x, y, z);
        }
      }
    );

    // Velocity proxy — reads/writes via PhysicsBody API
    const _tmpVel = new Vector3();
    this.velocity = new Vec3Proxy(
      () => havokBody.getLinearVelocity() || Vector3.Zero(),
      (x, y, z, v, axis) => {
        if (axis) {
          const cur = havokBody.getLinearVelocity() || Vector3.Zero();
          cur[axis] = v;
          havokBody.setLinearVelocity(cur);
        } else {
          _tmpVel.set(x, y, z);
          havokBody.setLinearVelocity(_tmpVel);
        }
      }
    );

    // Quaternion proxy
    this.quaternion = new QuatProxy(havokBody, node, isKinematic);
  }

  get mass() { return this.havokBody.getMassProperties().mass; }

  get linearDamping() { return this.havokBody.getLinearDamping(); }
  set linearDamping(v) { this.havokBody.setLinearDamping(v); }

  get angularDamping() { return this.havokBody.getAngularDamping(); }
  set angularDamping(v) { this.havokBody.setAngularDamping(v); }

  applyForce(f) {
    _tmpForce.set(f.x || 0, f.y || 0, f.z || 0);
    this.havokBody.applyForce(_tmpForce, this._node.position);
  }

  wakeUp() {
    // Havok doesn't have explicit wakeUp; setting velocity to itself wakes the body
    const v = this.havokBody.getLinearVelocity();
    if (v) this.havokBody.setLinearVelocity(v);
  }
}
const _tmpForce = new Vector3();

class QuatProxy {
  constructor(body, node, isKinematic) {
    this._body = body;
    this._node = node;
    this._kinematic = isKinematic;
  }
  get x() { return this._node.rotationQuaternion ? this._node.rotationQuaternion.x : 0; }
  get y() { return this._node.rotationQuaternion ? this._node.rotationQuaternion.y : 0; }
  get z() { return this._node.rotationQuaternion ? this._node.rotationQuaternion.z : 0; }
  get w() { return this._node.rotationQuaternion ? this._node.rotationQuaternion.w : 1; }
  setFromEuler(x, y, z) {
    // Euler (XYZ intrinsic) → quaternion, then set on the node
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2);
    const cy = Math.cos(y / 2), sy = Math.sin(y / 2);
    const cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    if (!this._node.rotationQuaternion) {
      this._node.rotationQuaternion = new Quaternion();
    }
    this._node.rotationQuaternion.set(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz + sx * sy * cz,
      cx * cy * cz - sx * sy * sz,
    );
  }
  setFromAxisAngle(axis, angle) {
    const ha = angle / 2, s = Math.sin(ha);
    if (!this._node.rotationQuaternion) {
      this._node.rotationQuaternion = new Quaternion();
    }
    this._node.rotationQuaternion.set(
      axis.x * s, axis.y * s, axis.z * s, Math.cos(ha),
    );
  }
}

/* ── Init ─────────────────────────────────────────────────── */

export async function initPhysics() {
  scene = getScene();

  const havokInstance = await HavokPhysics();
  const plugin = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -CFG.GRAV, 0), plugin);

  physicsEngine = scene.getPhysicsEngine();

  // Disable auto-stepping — we step manually via stepPhysics() accumulator
  scene.physicsEnabled = false;
}

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 10;
let accumulator = 0;

export function stepPhysics(dt) {
  if (!physicsEngine) return;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
    physicsEngine._step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps++;
  }
  if (steps >= MAX_STEPS) accumulator = 0; // prevent spiral of death
}

export function getPhysicsWorld() { return physicsEngine; }

/* ── Material helpers (friction / restitution presets) ───── */
const MAT = {
  ground:     { friction: 0.5,  restitution: 0.0  },
  ceiling:    { friction: 0.0,  restitution: 0.5  },
  player:     { friction: 0.0,  restitution: 0.0,  frictionCombine: PhysicsMaterialCombineMode.MINIMUM },
  projectile: { friction: 1.0,  restitution: 0.15 },
  door:       { friction: 0.0,  restitution: 0.0  },
  roof:       { friction: 0.1,  restitution: 0.3  },
};

export function getGroundMaterial()     { return 'ground'; }
export function getPlayerMaterial()     { return 'player'; }
export function getProjectileMaterial() { return 'projectile'; }
export function getDoorMaterial()       { return 'door'; }
export function getRoofMaterial()       { return 'roof'; }

function applyMat(shape, matKey) {
  const m = MAT[matKey] || MAT.ground;
  shape.material = {
    friction: m.friction,
    restitution: m.restitution,
    frictionCombine: m.frictionCombine,
    restitutionCombine: m.restitutionCombine,
  };
}

function matKeyFromArg(material) {
  if (!material) return 'ground';
  if (typeof material === 'string') return material;
  if (material.name) return material.name;
  return 'ground';
}

/* ── Shared helpers ───────────────────────────────────────── */

let _nodeCounter = 0;

function makeNode(name) {
  const node = new TransformNode(`phys_${name}_${_nodeCounter++}`, scene);
  node.rotationQuaternion = Quaternion.Identity();
  return node;
}

function applyCollisionGroups(shape, collisionGroup) {
  if (collisionGroup) {
    shape.filterMembershipMask = collisionGroup.membership;
    shape.filterCollideMask = collisionGroup.filter;
  } else {
    shape.filterMembershipMask = GRP_DEFAULT;
    shape.filterCollideMask = GRP_ALL;
  }
}

/* ── Body creation helpers ────────────────────────────────── */

export function createStaticBox(hx, hy, hz, px, py, pz, material, collisionGroup) {
  const node = makeNode('sbox');
  node.position.set(px, py, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  const shape = new PhysicsShapeBox(
    Vector3.Zero(), Quaternion.Identity(),
    new Vector3(hx * 2, hy * 2, hz * 2), scene
  );
  applyMat(shape, matKeyFromArg(material));
  applyCollisionGroups(shape, collisionGroup);
  body.shape = shape;
  body.disablePreStep = true;
  return new PhysicsBodyWrapper(body, node, shape);
}

export function createRotatedStaticBox(hx, hy, hz, px, py, pz, ax, ay, az, angle, material, collisionGroup) {
  const node = makeNode('rsbox');
  node.position.set(px, py, pz);
  // Axis-angle → quaternion
  const ha = angle / 2, s = Math.sin(ha);
  node.rotationQuaternion = new Quaternion(ax * s, ay * s, az * s, Math.cos(ha));

  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  const shape = new PhysicsShapeBox(
    Vector3.Zero(), Quaternion.Identity(),
    new Vector3(hx * 2, hy * 2, hz * 2), scene
  );
  applyMat(shape, matKeyFromArg(material));
  applyCollisionGroups(shape, collisionGroup);
  body.shape = shape;
  body.disablePreStep = true;
  return new PhysicsBodyWrapper(body, node, shape);
}

export function createStaticCylinder(radius, halfHeight, px, py, pz, material) {
  const node = makeNode('scyl');
  node.position.set(px, py, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  const shape = new PhysicsShapeCylinder(
    new Vector3(0, -halfHeight, 0),
    new Vector3(0, halfHeight, 0),
    radius, scene
  );
  applyMat(shape, matKeyFromArg(material));
  applyCollisionGroups(shape, undefined);
  body.shape = shape;
  body.disablePreStep = true;
  return new PhysicsBodyWrapper(body, node, shape);
}

export function createStaticSphere(radius, px, py, pz, material) {
  const node = makeNode('ssph');
  node.position.set(px, py, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  const shape = new PhysicsShapeSphere(Vector3.Zero(), radius, scene);
  applyMat(shape, matKeyFromArg(material));
  applyCollisionGroups(shape, undefined);
  body.shape = shape;
  body.disablePreStep = true;
  return new PhysicsBodyWrapper(body, node, shape);
}

/** Create terrain heightfield from getTerrainHeight */
export function createTerrainBody() {
  const size = CFG.GRID * CFG.CELL;
  const segments = CFG.GRID * 2;
  const numX = segments + 1;
  const numZ = segments + 1;
  const cellSize = size / segments;
  const halfSize = size / 2;

  // Havok heightfield swaps X↔Z: plugin's x-loop maps to world Z, z-loop maps to world X
  // So we swap the terrain sampling coordinates to compensate
  const heights = new Float32Array(numX * numZ);
  for (let x = 0; x < numX; x++) {
    for (let z = 0; z < numZ; z++) {
      const wx = -halfSize + x * cellSize;
      const wz = -halfSize + z * cellSize;
      heights[(numX - 1 - x) * numZ + z] = getTerrainHeight(wz, wx);
    }
  }

  const node = makeNode('terrain');
  const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, scene);
  const shape = new PhysicsShapeHeightField(
    size, size,   // sizeX, sizeZ (total physical extent)
    numX, numZ,   // samplesX, samplesZ
    heights,
    scene
  );
  applyMat(shape, 'ground');
  applyCollisionGroups(shape, undefined);
  body.shape = shape;
  body.disablePreStep = true;

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

  return new PhysicsBodyWrapper(body, node, shape);
}

/** Create a kinematic box body (for doors) */
export function createKinematicBox(hx, hy, hz, px, py, pz) {
  const node = makeNode('kbox');
  node.position.set(px, py, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.ANIMATED, false, scene);
  const shape = new PhysicsShapeBox(
    Vector3.Zero(), Quaternion.Identity(),
    new Vector3(hx * 2, hy * 2, hz * 2), scene
  );
  applyMat(shape, 'door');
  shape.filterMembershipMask = GRP_DOOR;
  shape.filterCollideMask = GRP_ALL;
  body.shape = shape;
  // disablePreStep = false so moving the node auto-syncs to physics
  body.disablePreStep = false;
  return new PhysicsBodyWrapper(body, node, shape, true);
}

/** Create a dynamic sphere for projectiles */
export function createProjectileSphere(radius, px, py, pz, vx, vy, vz) {
  const node = makeNode('proj');
  node.position.set(px, py, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, scene);
  const shape = new PhysicsShapeSphere(Vector3.Zero(), radius, scene);
  applyMat(shape, 'projectile');
  // Projectile group: membership=PROJECTILE, filter=everything except WINDOW
  shape.filterMembershipMask = GRP_PROJECTILE;
  shape.filterCollideMask = GRP_ALL & ~GRP_WINDOW;
  body.shape = shape;

  body.setMassProperties({ mass: 0.5 });
  body.setLinearDamping(0.1);
  body.setAngularDamping(0.95);
  // Havok handles CCD automatically for fast-moving bodies
  body.setLinearVelocity(new Vector3(vx, vy, vz));

  // disablePreStep = false so position teleports (terrain/boundary clamp) work
  body.disablePreStep = false;

  return new PhysicsBodyWrapper(body, node, shape);
}

/** Create a player capsule body */
export function createPlayerBody(px, py, pz) {
  const R = CFG.PLAYER_R;
  const halfH = (CFG.PLAYER_H - 2 * R) / 2; // half-height of cylindrical part

  const node = makeNode('player');
  node.position.set(px, py + CFG.PLAYER_H / 2, pz);

  const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, scene);

  // Capsule: pointA = bottom hemisphere center, pointB = top hemisphere center
  const shape = new PhysicsShapeCapsule(
    new Vector3(0, -halfH, 0),
    new Vector3(0, halfH, 0),
    R, scene
  );
  applyMat(shape, 'player');
  shape.filterMembershipMask = GRP_PLAYER;
  shape.filterCollideMask = GRP_ALL;
  body.shape = shape;

  // Mass 80, lock all rotations (zero inertia)
  body.setMassProperties({
    mass: 80,
    inertia: Vector3.ZeroReadOnly,
  });
  body.setLinearDamping(0.0);
  body.setAngularDamping(1.0);
  // Havok handles CCD automatically for fast-moving bodies

  // disablePreStep = false so position teleports (floor clamp) work
  body.disablePreStep = false;

  _playerBody = body;

  // Wrap with position proxy that reports foot position (subtract PLAYER_H/2)
  return new PlayerBodyWrapper(body, node, shape);
}

// Special wrapper for player — position reports foot Y, not capsule center
class PlayerBodyWrapper extends PhysicsBodyWrapper {
  constructor(havokBody, node, shape) {
    super(havokBody, node, shape, false);
    const halfH = CFG.PLAYER_H / 2;
    // Override position proxy to offset by half-height so consumer sees foot position
    this.position = new Vec3Proxy(
      () => ({
        x: node.position.x,
        y: node.position.y - halfH,
        z: node.position.z,
      }),
      (x, y, z, v, axis) => {
        if (axis === 'y') {
          node.position.y = v + halfH;
        } else if (axis === 'x') {
          node.position.x = v;
        } else if (axis === 'z') {
          node.position.z = v;
        } else {
          node.position.set(x, y + halfH, z);
        }
      }
    );
  }
}

/** Remove a body from the physics world */
export function removeBody(body) {
  if (!body) return;
  if (body.havokBody && !body.havokBody.isDisposed) {
    body.havokBody.dispose();
  }
  if (body._shape) {
    body._shape.dispose();
  }
  if (body._node) {
    body._node.dispose();
  }
}

/* ── Raycast helper ───────────────────────────────────────── */

let _playerBody = null;
let _rayResult = null;

/**
 * Cast a ray from `from` to `to`, excluding the player capsule.
 * Returns { hasHit, hitPointWorld: {x,y,z} }
 */
export function raycastClosest(from, to, excludePlayer = true, filterGroups) {
  if (!physicsEngine) return { hasHit: false };
  if (!_rayResult) _rayResult = new PhysicsRaycastResult();

  const _from = new Vector3(from.x, from.y, from.z);
  const _to = new Vector3(to.x, to.y, to.z);

  _rayResult.reset();
  if (excludePlayer) {
    physicsEngine.raycastToRef(_from, _to, _rayResult, { collideWith: GRP_ALL & ~GRP_PLAYER });
  } else {
    physicsEngine.raycastToRef(_from, _to, _rayResult);
  }

  if (!_rayResult.hasHit) return { hasHit: false };

  const hp = _rayResult.hitPointWorld;
  return {
    hasHit: true,
    hitPointWorld: { x: hp.x, y: hp.y, z: hp.z },
  };
}

/** Collision filter that excludes ceiling slabs from camera raycasts */
export const CAM_RAY_GROUPS = { membership: GRP_DEFAULT, filter: GRP_ALL & ~GRP_CEILING };
