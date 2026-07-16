# Dark Strands

3D first-person survival roguelite prototype built with Babylon.js. Switchable to third person. Supports desktop (keyboard+mouse) and mobile (touch controls).

## Workflow Rules
- **Never commit or push without explicit user approval.** Always present the proposed commit message and wait for confirmation before running `git commit` or `git push`.

## Running

```
npm install
npm start
# or: npx serve . -p 3000
```
Open http://localhost:3000 in browser. Click to capture mouse.

## Controls
- WASD - Move
- SHIFT - Sprint
- SPACE - Jump
- V - Toggle first/third person camera
- E - Interact (doors, soldiers, flowers, rocks, torches, beds)
- 1-5 - Select hotbar slot
- Left-click - Use selected item (throw stone, place flower/torch)
- Right-click (hold) - Zoom
- ALT (hold) - Virtual cursor for hotbar drag-and-drop
- Q (hold) - Fast-forward (3x speed)
- SHIFT+? - In-game survival guide
- TAB / PAUSE - Pause (mouse stays trapped, virtual cursor). ESC during pause releases mouse.
- ESC - Release mouse cursor (game keeps running, click to re-lock)

### Mobile Touch Controls
- Left side drag - Virtual joystick for movement
- Right side swipe - Camera look
- Right side long-press (1s) - Interact (with progress ring)
- JUMP / USE / CAM buttons - Bottom-right action buttons
- Hotbar tap - Select slot
- Pause (||) and Help (?) buttons - Top-left

## Tech Stack
- **Babylon.js 9.x** (`@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/materials`) pre-bundled via esbuild into `lib/babylon.bundle.js`, loaded via importmap as `'babylonjs'`
- **Babylon.js Havok** (`@babylonjs/havok`) — Havok WASM physics engine via Babylon.js v2 physics plugin
- Pure ES modules, no bundler for game code — `<script type="module" src="src/main.js">`
- `npm install` required; `npm run bundle:babylon` to rebuild the Babylon.js bundle; Havok WASM served from `node_modules/` via importmap; `npx serve` for local HTTP server

## Architecture

Enterprise-style modular structure. All game code in `src/`, split by concern:

```
src/
  main.js                  # Entry point, game loop, init orchestration
  config.js                # All tunable constants (CFG object)
  core/
    scene.js               # WebGPU/WebGL2 engine, Scene, FreeCamera setup (?webgl / ?compat params)
    lighting.js            # Sun shadow map (fixed frustum, texel-stable follow), hemi, sun glow
    physics.js             # Havok physics world, body helpers, step, raycast (statics: disableSync!)
    postfx.js              # Volumetric fog + god rays + interior fog-exclusion boxes, DRP, GlowLayer
    skyDome.js             # Procedural sky: atmosphere, weather-driven clouds, stars, moon
  world/
    grid.js                # 2D collision grid, walkability, stair cells, road cells
    generator.js           # Building placement seeded from roads, road-facing primary doors
    roads.js               # Village road network (main + branches), dirt ribbon mesh, road torches
    terrainMeshes.js       # Ground plane (displaced mesh) and Gerstner wave ocean (custom ShaderMaterial)
    walls.js               # Building walls (merged geometry with window holes, triplanar UV) and roofs
    floors.js              # Ground floor slabs, mid-floor pieces, stair steps
    windows.js             # Glass panes (breakable) and wooden window frames
    staticPhysics.js       # Havok static bodies for walls, floors, roofs, ceiling slabs, stairs
    vegetation.js          # Card-based foliage: deciduous trees, fir groves, bushes, grass, rocks
    terrain.js             # Perlin noise terrain heightmap
    boundary.js            # World-edge hex-grid shield effect
    torches.js             # Torch core: mesh creation, materials, world placement, pickup
    torchLighting.js       # Clustered light container, shadow slot generators
    torchParticles.js      # Ember/smoke/spark particles, flicker, shadow slot management
    torchPlacement.js      # Player torch placement: preview, ray-march, door panel hits
    torchHeld.js           # First-person held torch rendering
    doors.js               # Door meshes with pivot rotation, open/close, kinematic bodies
    flowers.js             # Flower pickup, planting, preview system
    furniture.js           # Procedural furniture (beds) geometry generation
  entities/
    models.js              # Model registry (data only — URLs, heights, counts, licenses)
    modelLoader.js         # GLTF loading (SceneLoader), cloning (instantiateModelsToScene), animation mixer wrapper
    player.js              # Player state, physics capsule, camera modes
  systems/
    controls.js            # Pointer lock, keyboard, mouse input, pause states
    touch.js               # Mobile touch input (joystick, look, long-press interact)
    hotbar.js              # Hotbar slots, ALT cursor drag-and-drop
    daynight.js            # Day/night cycle, sky color, fog distances (single writer of scene props)
    weather.js             # CLEAR/OVERCAST/RAIN/STORM FSM publishing modifier object
    rainFX.js              # Rain streaks + surface kill map + flat ground splash rings
    sleep.js               # Time-skip mechanics when interacting with beds
    hud.js                 # FPS counter, minimap canvas, camera mode label
    npcAI.js               # NPC wandering behavior (idle/walk state machine)
    projectiles.js         # Stone throwing with Havok dynamic bodies
    menu.js                # Procedural campfire menu scene
    campfire-custom-particles.bak.js  # BACKUP: Custom 4-layer ParticleSystem fire (fire core, flame tips, embers, smoke) with procedural DynamicTextures — saved before switching to ParticleHelper.CreateAsync("fire")
  utils/
    helpers.js             # Grid↔world coordinate conversion, rng utilities
```

## Key Design Decisions

### World Generation
- 80×80 grid, each cell = 2 world units → 160×160 unit outdoor world
- **Village layout**: `roads.js` carves a main road (through-near-center, both directions) + 2-3 branches as grid-cell polylines that route around lakes; road cells stay walkable and are tracked in `grid.js` (`isRoadCell`/`isNearRoad`). Buildings are seeded FROM road cells (1-2 cell gap) and their primary door is forced onto the road-facing wall. Standing torches line the roads (`CFG.ROAD_*` tunables). Vegetation/rocks/grass exclude road cells.
- Outdoor ground everywhere, with procedurally placed rectangular stone **buildings**
- Buildings have walls on perimeter with 1–3 doorways
- Mix of 1-story and 2-story buildings (~35% chance of 2-story for large buildings)
- Flat roofs (grey slab) or slanted gable roofs (brown triangular prism), 50/50 split
- 2-story buildings have taller walls and a mid-level floor plane
- Trees and rocks scattered in outdoor areas (mark grid cells as blocked)
- Player spawns at center; buildings avoid the center area

### Collision
- **Babylon.js Havok** (WASM) physics engine handles player movement, projectile physics, boundary shields, and door collisions
- Player is a capsule body (mass 80, zero inertia for locked rotation) via `PhysicsShapeCapsule`
- Projectiles are dynamic sphere bodies with per-shape friction/restitution
- Static world bodies: wall boxes, floor slabs, stair steps, ceiling slabs, roof slopes, ridge caps, rock spheres, terrain heightfield, boundary walls — each gets a lightweight `TransformNode` (no mesh)
- Collision groups use `shape.filterMembershipMask` / `shape.filterCollideMask` bitmasks (not packed u32)
- Ceiling slabs and mid-floor slabs use CEILING_COLLISION_GROUP — prevents jumping into attic on slanted-roof buildings, and excluded from `hasLineOfSight` raycasts so interactions work through the thick floor slab
- Doors use ANIMATED (kinematic) box bodies with `disablePreStep = false` — moving the TransformNode auto-syncs to physics
- Dynamic bodies (player, projectiles) use `disablePreStep = false` so position teleports work; static bodies use `disablePreStep = true` for zero overhead
- Manual physics stepping: `scene.physicsEnabled = false` disables auto-step; accumulator calls `physicsEngine._step(1/60)` to preserve fast-forward mechanics
- 2D boolean grid still used for: NPC pathfinding, placement validation, indoor/outdoor detection, torch/flower placement raycasts
- NPCs use grid-based collision (not physics engine)

### Models
- All `.glb` files stored locally in `assets/models/`
- Registry in `src/entities/models.js` — add new models there
- Models are auto-scaled to `targetHeight` on load (bounding box normalization)
- Animated models use `container.instantiateModelsToScene()` for proper skeleton duplication
- Animation crossfade via `createAnimMixer()` wrapper that mimics Three.js AnimationMixer API using Babylon AnimationGroup weight blending

### Available Animations per Model
- **Soldier.glb**: Idle, Walk, Run (3 clips only — no jump, attack, death, etc.)
- **Horse.glb**: Gallop (1 clip)
- **Fox.glb**: Survey, Walk, Run (3 clips)
- **Flower.glb**: none (static)

To add more animations (attack, jump, die, reload, etc.) use **Mixamo** (https://mixamo.com):
- Upload any humanoid model, pick animations, download as GLB/FBX
- Auto-retargets to any skeleton
- Free to use

### NPC System
- Soldiers wander randomly: idle → walk → idle state machine
- Animation crossfade between idle/walk clips (0.3s blend)
- Wall collision causes immediate direction change
- **Model facing note**: Soldier.glb faces -Z, so rotation needs `+ Math.PI` offset when setting facing direction from movement vector

### Day/Night Cycle
- Toggle in main menu (default: day only, cycle disabled)
- Full cycle = 120 seconds (configurable in `CFG.DAY_SEC`)
- Sun orbits, sky color lerps day→sunset→night
- Stars appear at night, torches brighten at night
- Shadow camera follows player position
- **Sleeping**: Player can interact (`E`) with procedural beds spawned inside buildings to skip time to 08:00 the next morning.

### Camera
- First person: camera at player eye height (1.7 units)
- Third person: over-the-shoulder view, player offset ~35% left of screen, Soldier model with direction-aware facing and smooth rotation lerp
- Toggle with V key
- `getCamBlend()` returns 0 (fully 1st person) to 1 (fully 3rd person) — use this instead of `firstPerson` boolean for transition-aware checks
- **3rd person raycasting**: cast ray from camera world position (matches crosshair) but measure distances from player position. This pattern is used in `torches.js`, `flowers.js`, and `projectiles.js`
- **Indoor camera**: camera collision uses Babylon scene raycasts (skips roof meshes). Ceiling Y-clamp prevents camera from seeing above walls. Temporal smoothing on collision fraction prevents snap-in oscillation during jumps

### Virtual Cursor
A simulated mouse cursor rendered as a CSS circle element, used in two contexts:

1. **ALT mode** (`src/systems/hotbar.js`): hold ALT during gameplay. Pointer lock stays active, `movementX/Y` drives the cursor position via `moveCursor(dx, dy)`. Used for hotbar drag-and-drop. Element: `#alt-cursor`, created dynamically. Styled as a golden circle (`border: 2px solid rgba(232, 216, 160, 0.9)`, `border-radius: 50%`).

2. **Pause screen** (`src/systems/controls.js`): Tab or Pause key enters `simPause` state — pointer lock stays active so mouse is fully trapped. Virtual cursor (`#sim-cursor`) driven by `movementX/Y`. Tab/Pause again or any key resumes instantly. ESC during pause releases pointer lock (shows pause overlay with "Click to resume"). ESC during normal gameplay just frees the cursor — game keeps running, click canvas to re-lock. Same golden circle style as ALT cursor.

**Key state machine** (desktop only, mobile uses `gameActive` flag instead):
- `pointerLocked && !simPause` — normal gameplay, pointer lock active
- `simPause && pointerLocked` — Tab/Pause pause, virtual cursor shown, game frozen
- `simPause && !pointerLocked` — Tab/Pause pause + ESC release, OS cursor visible, game frozen, click/key to resume
- `gameStarted && !pointerLocked && !simPause` — ESC during gameplay, cursor free, game keeps running. Click canvas to re-lock.
- `isGameActive()` = `(gameStarted && !simPause) || isMobileGameActive()`

## Adding New Models

1. Place `.glb` file in `assets/models/`
2. Add entry to `MODEL_REGISTRY` in `src/entities/models.js`:
   ```js
   {
     id: 'unique-id',
     name: 'Display Name',
     url: './assets/models/YourModel.glb',
     targetHeight: 1.0,    // desired height in world units
     count: 5,             // how many to spawn
     animated: true,       // use instantiateModelsToScene if true
     license: 'CC0',
   }
   ```
3. If it needs custom behavior (like soldier wandering), handle it in `modelLoader.js` by `def.id` check and create a system in `src/systems/`

## Model Sources

Current models were sourced from these free repositories:

- **Three.js examples** (MIT License): https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf
  - Soldier.glb, Horse.glb, Flower.glb
- **Khronos glTF-Sample-Assets** (CC-BY 4.0): https://github.com/KhronosGroup/glTF-Sample-Assets
  - Fox.glb

## Texture Sources

All textures downloaded from **Poly Haven** (https://polyhaven.com) under **CC0 (public domain)** license:

- `assets/textures/grass.jpg` — from Poly Haven sparse grass texture
- `assets/textures/stone_wall.jpg` — from Poly Haven stone wall texture
- `assets/textures/bark.jpg` — from Poly Haven pine bark texture

### Other free model sources for future use
- **Kenney.nl** (CC0): https://kenney.nl/assets?t=gltf — hundreds of low-poly packs (nature, castle, medieval, furniture). Download zips, self-host.
- **Quaternius** (CC0): https://quaternius.com/ — 1400+ low-poly models (Medieval Village, Stylized Nature, animated characters). Google Drive downloads.
- **Poly Pizza** (varies): https://poly.pizza/ — searchable low-poly models, has API
- **Khronos glTF-Sample-Models**: https://github.com/KhronosGroup/glTF-Sample-Models — reference models (Duck, Lantern, Box, CesiumMan, etc.)
- **pmndrs Market** (CC0): https://market.pmnd.rs/ — React Three Fiber community models

## Dev Journal

A timestamped development journal is maintained in `DEV_JOURNAL.md` at the project root. **Every time changes are made to the codebase, append a new timestamped entry** summarizing what was done. Format:

```
## YYYY-MM-DD

- Bullet points describing changes made
- Group related changes under a single bullet
- Be concise but specific (mention file names, features, fixes)
```

Keep entries append-only — never edit or remove previous entries.

## Rendering & Performance Rules (hard-won — violating any of these has cost 10-60ms/frame or visible artifacts)
- **Havok static bodies MUST set `body.disablePreStep = true` AND `body.disableSync = true`** — the plugin otherwise syncs every body's transform per substep (614 statics × substeps was 30-60ms/frame)
- **Every new mesh MUST set `isPickable = false` unless it's interactable** — camera-collision `multiPickWithRay` pays per TRIANGLE of every pickable mesh (foliage cards being pickable cost 34ms/frame)
- **Shadow maps render EVERY FRAME on WebGPU** — any throttled RTT (refreshRate 0+re-arm, 2, or 8) intermittently replays stale GPU state (bit-exact old passes; verified Babylon 8.52-9.17). WebGL2 (`?webgl`) keeps the event-driven refresh path, gated on `!isWebGPU()`.
- **Sun shadow**: fixed `shadowFrustumSize` (auto-fit reframes per render), light follows the player every frame on a FIXED texel lattice (world-stable sampling — no snap jumps), bias LOW (high bias opens lit gaps under roof eaves)
- **Fog depth pass** (`postfx.js DEPTH_PASS_MESHES` + `addFogDepthMesh`): anything that can silhouette against sky/far geometry MUST write fog depth (leaf/needle/bush cards, doors, mid-floors) or the fog paints ghost silhouettes/transparency over it. Interior-only meshes stay OUT (perf). The list is frustum-culled per frame via getCustomRenderList — Babylon 9 RTT renderLists do NO culling of their own.
- **Building interiors are fog-free via AABB exclusion** (`setFogInteriorBoxes`): the fog shader subtracts in-building ray segments — do not try fogStart clamps (they fail when looking into rooms from outside)
- **Hidden proxy meshes** (shadow/depth-only foliage volumes) use layerMask `0x40000000` — `0x20000000` is the 3rd-person player-model bit and cameras INCLUDE it. RTT renderLists ignore camera layer masks: never put hidden proxies into the water-mirror render list.
- **The first PostProcess's ratio defines the SCENE's render target size** — never set it below 1.0
- **Torch lights**: clustered lights have NO shadows — their intensity is faded by camera line-of-sight (mask keeps ceilings blocking, glass passes light but blocks the screen-space glow halo). 3 nearest torches get shadow cube slots with near-torch caster subsets rebuilt on slot reassignment.
- `[PERF]`/`[PERF2]` logs every 5s (per-RTT draw attribution + per-loop-section ms) — use them before guessing about frame cost

## Known Quirks
- Babylon.js is pre-bundled into `lib/babylon.bundle.js` (~10MB); game source stays unbundled ES modules
- WebGPU engine with automatic WebGL2 fallback; `engine.compatibilityMode = false` for full WebGPU optimizations (`?compat` forces the slow path for GPU-state debugging)
- Pointer lock requires HTTPS or localhost
- The blocker overlay handles click-to-play (not the canvas)
- Pause (`isWorldFrozen`): ANY desktop state with a free pointer freezes the sim, skeletal animations (`scene.animationsEnabled`), and particles (updateSpeed save/restore). `window._noFreeze = true` bypasses it for automated testing (pointer lock can't be acquired without a user gesture).
- `_dbg.tp(x, z)` teleports via the Havok plugin's `HP_Body_SetQTransform` on `wrapper.havokBody._pluginData.hpBodyId` — node-position writes alone never move the capsule under manual stepping
- Automated testing: `page.reload()` can serve stale ES modules — refresh via `fetch(url, {cache:'reload'})` over performance resource entries first
- `scene.useRightHandedSystem = true` to match original Three.js coordinate conventions used throughout the codebase
- WebGPU workarounds: strip unused UV channels (uv2-uv6) from GLTF models; skip LensFlareSystem on WebGPU; defer menu scene cleanup instead of explicit dispose
- Menu fire particles fetched from Babylon.js CDN (`ParticleHelper.CreateAsync("fire")`) — requires internet on first load
- Billboard-mode meshes (`billboardMode = BILLBOARDMODE_ALL`) don't correctly inherit parent node rotation for positioning. Workaround: keep billboard meshes unparented and sync their world position manually each frame (see torch glow on doors)
