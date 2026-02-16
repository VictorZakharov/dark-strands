import * as THREE from 'three';
import { canMoveToR } from '../world/grid.js';
import { getPlayerState } from '../entities/player.js';
import { getBuildings } from '../world/generator.js';
import { CFG } from '../config.js';
import { getTerrainHeight } from '../world/terrain.js';
import { collidesWithRock } from '../world/vegetation.js';
import { collidesWithDoorPanel } from '../world/doors.js';
import { getCamera } from '../core/scene.js';

const npcs = [];
const NPC_RADIUS = 0.5;
const TALK_DIST = 3.5;
const _projNpc = new THREE.Vector3();

const SOLDIER_LINES = [
  // Original 20
  "Quiet day... for now.",
  "Stay alert out there.",
  "These walls won't hold forever.",
  "I've seen things in the fog...",
  "Watch your step near the water.",
  "Another day, another patrol.",
  "You look like you've been through worse.",
  "The foxes have been acting strange lately.",
  "Keep your weapon close.",
  "I once saw a shadow move on its own.",
  "Don't wander too far at night.",
  "The stones whisper if you listen.",
  "Someone left the door open again.",
  "I could use a warm fire right about now.",
  "Ever wonder what's beyond the fog?",
  "My feet are killing me.",
  "I swear that rock moved.",
  "You remind me of someone... never mind.",
  "If I had a coin for every patrol...",
  "The dark strands are spreading.",
  // Atmospheric / lore
  "The ground feels wrong here.",
  "There's something beneath these stones.",
  "I heard singing last night. No one was there.",
  "The old watchtower collapsed years ago.",
  "They say this place was a kingdom once.",
  "The fog rolls in thicker every evening.",
  "I found strange markings on the walls.",
  "The crows have stopped coming.",
  "Something stirs when the wind dies down.",
  "The river used to flow clear. Not anymore.",
  "I don't trust the silence.",
  "The trees are closer than yesterday.",
  "No stars last night. Not a single one.",
  "There's a hum in the air. You hear it?",
  "The old well dried up overnight.",
  "I keep finding footprints that aren't mine.",
  "The moss grows too fast on these walls.",
  "A cold spot near the north wall. Always.",
  "The shadows don't match the light sometimes.",
  "This place has a memory.",
  // Guard duty / military
  "Shift change isn't for another hour.",
  "The captain hasn't returned yet.",
  "We lost contact with the east outpost.",
  "Supplies are running low.",
  "I've been on watch since dawn.",
  "The perimeter looks clear. For now.",
  "We should reinforce the south wall.",
  "I haven't slept properly in days.",
  "Three patrols today. My legs are done.",
  "The new recruits don't last long out here.",
  "I miss the old garrison. Proper beds.",
  "Orders are orders, I suppose.",
  "Someone needs to fix that gate.",
  "The armory could use restocking.",
  "I've counted every stone in this wall.",
  // Casual / humorous
  "Got any food? I'm starving.",
  "I used to be an adventurer, you know.",
  "Do you think the foxes judge us?",
  "I named that rock over there. Gerald.",
  "If I stand still long enough, do I become a statue?",
  "My boots have more holes than leather.",
  "I tried talking to a fox once. It didn't go well.",
  "Whoever built these stairs was not thinking straight.",
  "I bet the horses have it easy.",
  "Want to trade shifts? Didn't think so.",
  "At least the view is... foggy.",
  "I've been walking in circles. Literally.",
  "The food here tastes like the walls look.",
  "I had a dream about cheese last night.",
  "Is it always this cold, or is it just me?",
  "My sword is duller than my conversation.",
  "I've forgotten what a warm bed feels like.",
  "They don't pay me enough for this.",
  "I think a fox stole my lunch.",
  "I'd kill for a mug of ale right now.",
  // Philosophical / melancholy
  "Do you ever wonder why we're here?",
  "Some doors are better left closed.",
  "We all end up as stories eventually.",
  "The world was different before the strands.",
  "I used to know what courage meant.",
  "Hope is a strange thing to carry.",
  "Every path leads somewhere. Even the wrong ones.",
  "I've forgotten more than I remember.",
  "The past is just fog with memories in it.",
  "We build walls, but nothing stays out forever.",
  // Warnings / advice
  "Don't drink the water downstream.",
  "Stay close to the torches after dark.",
  "If you see something move, don't follow it.",
  "The rooftops aren't as sturdy as they look.",
  "Watch the treeline. Always watch the treeline.",
  "Trust your instincts. They'll keep you alive.",
  "Never turn your back on an open door.",
  "The high ground is your friend.",
  "Keep moving. Standing still invites trouble.",
  "If the fog thickens, find shelter. Fast.",
];

let speechTimer = 0;
let speechTarget = null;

export function getNpcs() { return npcs; }

/**
 * Check if player collides with any NPC. Returns push-back vector or null.
 */
export function getNpcCollision(px, pz, playerRadius) {
  for (const npc of npcs) {
    const dx = px - npc.model.position.x;
    const dz = pz - npc.model.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = playerRadius + NPC_RADIUS;
    if (dist < minDist && dist > 0) {
      return { x: (dx / dist) * (minDist - dist), z: (dz / dist) * (minDist - dist) };
    }
  }
  return null;
}

/**
 * Register a soldier NPC with wandering behavior.
 */
export function registerSoldier(model, mixer, clips) {
  const idleAction = mixer.clipAction(clips.idle);
  const walkAction = mixer.clipAction(clips.walk);

  walkAction.timeScale = 0.9;
  idleAction.play();

  npcs.push({
    type: 'soldier',
    model,
    mixer,
    idleAction,
    walkAction,
    runAction: null,
    state: 'idle',
    timer: 1 + Math.random() * 3,
    fleeTimer: 0,
    dirX: 0,
    dirZ: 0,
    speed: 2.0,
    radius: NPC_RADIUS,
    fleeRange: 0,
    fleeSpeed: 0,
    facingOffset: Math.PI,
  });
}

/**
 * Register a fox NPC that flees from the player.
 */
export function registerFox(model, mixer, clips) {
  const idleAction = mixer.clipAction(clips.idle);
  const walkAction = mixer.clipAction(clips.walk);
  const runAction = clips.run ? mixer.clipAction(clips.run) : walkAction;

  idleAction.play();

  npcs.push({
    type: 'fox',
    model,
    mixer,
    idleAction,
    walkAction,
    runAction,
    state: 'idle',
    timer: 1 + Math.random() * 3,
    fleeTimer: 0,
    dirX: 0,
    dirZ: 0,
    speed: 2.5,
    radius: NPC_RADIUS,
    fleeRange: 15,
    fleeSpeed: 5.0,
    facingOffset: 0,
  });
}

function pickDirection(npc) {
  const angle = Math.random() * Math.PI * 2;
  npc.dirX = Math.sin(angle);
  npc.dirZ = Math.cos(angle);
}

function crossfade(from, to, duration = 0.3) {
  if (from === to) return;
  to.reset().setEffectiveWeight(1).fadeIn(duration).play();
  from.fadeOut(duration);
}

function distToPlayer(npc) {
  const p = getPlayerState();
  const dx = npc.model.position.x - p.x;
  const dz = npc.model.position.z - p.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Check if a position is inside any building.
 */
function isInsideBuilding(x, z) {
  const buildings = getBuildings();
  for (const b of buildings) {
    const bx1 = b.x * 2 - 80 + 1;
    const bz1 = b.z * 2 - 80 + 1;
    const bx2 = (b.x + b.w) * 2 - 80 - 1;
    const bz2 = (b.z + b.h) * 2 - 80 - 1;
    if (x > bx1 && x < bx2 && z > bz1 && z < bz2) return true;
  }
  return false;
}

/**
 * Smart flee: sample multiple directions, pick the best walkable one
 * that moves away from player. Inside buildings, bias toward directions
 * that lead outside.
 */
function smartFleeDirection(npc) {
  const p = getPlayerState();
  const pos = npc.model.position;
  const dx = pos.x - p.x;
  const dz = pos.z - p.z;
  const awayAngle = Math.atan2(dx, dz);
  const inBuilding = isInsideBuilding(pos.x, pos.z);

  let bestAngle = awayAngle;
  let bestScore = -Infinity;
  const step = 2.0;

  for (let i = 0; i < 12; i++) {
    const angle = awayAngle + ((i * Math.PI * 2) / 12);
    const testX = pos.x + Math.sin(angle) * step;
    const testZ = pos.z + Math.cos(angle) * step;

    if (!canNpcMove(testX, testZ, npc.radius)) continue;

    const newDx = testX - p.x;
    const newDz = testZ - p.z;
    let score = Math.sqrt(newDx * newDx + newDz * newDz);

    if (inBuilding && !isInsideBuilding(testX, testZ)) {
      score += 20;
    }

    const angleDiff = Math.abs(angle - awayAngle);
    score -= angleDiff * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }

  npc.dirX = Math.sin(bestAngle);
  npc.dirZ = Math.cos(bestAngle);
}

function canNpcMove(x, z, r) {
  if (!canMoveToR(x, z, r) || collidesWithRock(x, z, r) || collidesWithDoorPanel(x, z, r)) return false;
  // NPCs avoid water (unless snow mode where water is ice)
  if (!CFG.SNOW_MODE && getTerrainHeight(x, z) < CFG.WATER_Y) return false;
  return true;
}

/**
 * Move NPC with per-axis wall sliding (split X and Z).
 */
function moveNpc(npc, mx, mz) {
  const pos = npc.model.position;
  const r = npc.radius;
  if (canNpcMove(pos.x + mx, pos.z, r)) pos.x += mx;
  if (canNpcMove(pos.x, pos.z + mz, r)) pos.z += mz;
}

export function updateNpcs(dt) {
  for (const npc of npcs) {
    const pos = npc.model.position;

    // Follow terrain height (clamped to ice level in snow mode)
    pos.y = getTerrainHeight(pos.x, pos.z);
    if (CFG.SNOW_MODE) pos.y = Math.max(pos.y, CFG.WATER_Y);

    // Flee behavior (foxes)
    if (npc.fleeRange > 0) {
      const dist = distToPlayer(npc);

      if (dist < npc.fleeRange) {
        if (npc.state !== 'fleeing') {
          const prev = npc.state === 'walking' ? npc.walkAction : npc.idleAction;
          crossfade(prev, npc.runAction);
          npc.state = 'fleeing';
          npc.fleeTimer = 0; // recalc immediately on enter
        }

        // Only recalculate direction periodically or when blocked
        npc.fleeTimer -= dt;
        const mx = npc.dirX * npc.fleeSpeed * dt;
        const mz = npc.dirZ * npc.fleeSpeed * dt;
        const blocked = !canNpcMove(pos.x + mx, pos.z + mz, npc.radius);

        if (npc.fleeTimer <= 0 || blocked) {
          smartFleeDirection(npc);
          npc.fleeTimer = 0.4;
        }

        moveNpc(npc, npc.dirX * npc.fleeSpeed * dt, npc.dirZ * npc.fleeSpeed * dt);
        npc.model.rotation.y = Math.atan2(npc.dirX, npc.dirZ) + npc.facingOffset;
        npc.timer = 1 + Math.random() * 2;
        continue;
      } else if (npc.state === 'fleeing') {
        npc.state = 'idle';
        npc.timer = 1 + Math.random() * 2;
        crossfade(npc.runAction, npc.idleAction);
      }
    }

    // Normal wander behavior
    npc.timer -= dt;

    if (npc.timer <= 0) {
      if (npc.state === 'idle') {
        npc.state = 'walking';
        npc.timer = 2 + Math.random() * 4;
        pickDirection(npc);
        crossfade(npc.idleAction, npc.walkAction);
      } else {
        npc.state = 'idle';
        npc.timer = 1 + Math.random() * 3;
        crossfade(npc.walkAction, npc.idleAction);
      }
    }

    if (npc.state === 'walking') {
      const mx = npc.dirX * npc.speed * dt;
      const mz = npc.dirZ * npc.speed * dt;

      let moved = false;
      if (canNpcMove(pos.x + mx, pos.z + mz, npc.radius)) {
        pos.x += mx;
        pos.z += mz;
        moved = true;
      } else if (canNpcMove(pos.x + mx, pos.z, npc.radius)) {
        pos.x += mx;
        moved = true;
      } else if (canNpcMove(pos.x, pos.z + mz, npc.radius)) {
        pos.z += mz;
        moved = true;
      }

      if (!moved) {
        // Blocked — stop and idle briefly, then pick new direction
        npc.state = 'idle';
        npc.timer = 0.5 + Math.random() * 1.0;
        crossfade(npc.walkAction, npc.idleAction);
      } else {
        npc.model.rotation.y = Math.atan2(npc.dirX, npc.dirZ) + npc.facingOffset;
      }
    }
  }

  // Update speech bubble timer
  if (speechTimer > 0) {
    speechTimer -= dt;
    if (speechTimer <= 0) {
      speechTarget = null;
      const el = document.getElementById('npc-speech');
      if (el) el.style.display = 'none';
    }
  }
}

/**
 * Get the nearest soldier NPC within talk range, or null.
 */
export function getNearestSoldier() {
  const p = getPlayerState();
  let best = null;
  let bestDist = TALK_DIST;

  for (const npc of npcs) {
    if (npc.type !== 'soldier') continue;
    const dx = p.x - npc.model.position.x;
    const dz = p.z - npc.model.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = npc;
    }
  }
  return best;
}

/**
 * Talk to nearest soldier — shows a random speech line.
 */
export function talkToNearestSoldier() {
  const npc = getNearestSoldier();
  if (!npc) return false;

  const line = SOLDIER_LINES[Math.floor(Math.random() * SOLDIER_LINES.length)];
  speechTarget = npc;
  speechTimer = 3.5;

  const el = document.getElementById('npc-speech');
  if (el) {
    el.textContent = line;
    el.style.display = 'block';
  }
  return true;
}

/**
 * Update the soldier [E] hint and speech bubble screen positions.
 */
export function updateSoldierHint() {
  const camera = getCamera();

  // Speech bubble follows the speaking soldier
  if (speechTarget && speechTimer > 0) {
    const pos = speechTarget.model.position;
    _projNpc.set(pos.x, pos.y + 1.8, pos.z);
    _projNpc.project(camera);

    const el = document.getElementById('npc-speech');
    if (el && _projNpc.z < 1) {
      const hw = window.innerWidth / 2;
      const hh = window.innerHeight / 2;
      const margin = 80;
      const bx = Math.max(margin, Math.min(window.innerWidth - margin, _projNpc.x * hw + hw));
      const by = Math.max(margin, Math.min(window.innerHeight - margin, -_projNpc.y * hh + hh));
      el.style.left = bx + 'px';
      el.style.top = by + 'px';
    }
  }

  // [E] Talk hint
  const hintEl = document.getElementById('interact-hint');
  if (!hintEl) return;

  // Don't show soldier hint if a door hint is already active
  if (hintEl.style.display === 'block' && hintEl.dataset.source === 'door') return;

  const soldier = getNearestSoldier();
  if (!soldier) {
    // Only hide if we were showing a soldier hint
    if (hintEl.dataset.source === 'soldier') {
      hintEl.style.display = 'none';
      hintEl.dataset.source = '';
    }
    return;
  }

  // Soldier hint positioning is handled by updateInteractHint() in main.js
}
