# Dark Strands — Architecture Overview

## General Architecture

Dark Strands is an enterprise-style, modular 3D sandbox survival prototype built using
**Babylon.js 8.x** (WebGPU with WebGL2 fallback) and the **Havok** WASM physics engine.
The project uses pure, native ES Modules (`<script type="module">`) for game code, with
Babylon.js pre-bundled via esbuild into a single importmap-aliased bundle.

The architecture is heavily decoupled by concern, following a Manager/System pattern:

- **Core Orchestration**: `main.js` handles the game loop, initialization, loading
  screens, and global state orchestration (calling `updateX()` on all subsystems).
- **Procedural Generation**: Building placement is tracked on a 2D integer grid
  (`grid.js`), which informs 3D mesh building across multiple modules (`walls.js`,
  `floors.js`, `windows.js`, `staticPhysics.js`). Terrain is a Perlin-noise heightfield
  with flat pedestals under spawn points and buildings.
- **Merged Geometry**: Static environment meshes (walls, floors, stairs, roofs, windows) use
  direct VertexData construction or per-material mesh merging to minimize draw calls.
- **Physics**: All critical movement, gravity, jumping, boundary containment, throwing,
  and door collision uses **Havok WASM** via Babylon.js v2 physics plugin. Manual stepping
  preserves fast-forward mechanics. Static bodies use lightweight `TransformNode` (no mesh).
- **Clustered Lighting**: Torch PointLights are managed by `ClusteredLightContainer` for
  GPU-tiled rendering of unlimited lights. 2 nearest torches get shadow-casting slots.
- **Decoupled UI**: HTML/CSS overlays (menus, hints, hotbars) sit on top of the WebGPU
  canvas and read from exported global state functions (e.g., `getCamBlend()`,
  `getPlayerState()`) rather than tightly coupling UI logic into 3D rendering loops.

---

## File / Folder Tree

```text
src/
├── main.js                  # Global entry point. Handles the `requestAnimationFrame` loop,
│                            # coordinates staged asset loading, and dispatches per-frame
│                            # updates to all systems.
├── config.js                # Centralized tunable constants (CFG object) for game pacing,
│                            # physics constants, generation limits, and biome toggles.
│
├── core/                    # Engine-level Babylon.js and Physics wrappers
│   ├── scene.js             # Initializes WebGPUEngine (with WebGL2 fallback), Scene, and
│   │                        # main FreeCamera. Sets up global fog and right-handed coords.
│   ├── lighting.js          # Sets up ambient illumination (HemisphericLight) and dynamic
│   │                        # atmospheric lights (DirectionalLight sun with CSM shadows,
│   │                        # sun disc, stars, celestial flare).
│   └── physics.js           # Initializes Havok WASM physics world. Defines collision groups,
│                            # contact materials, and helper functions to construct bodies
│                            # (terrain heightfields, dynamic spheres, static boxes, capsules).
│
├── world/                   # Procedural generation and static/kinematic environment
│   ├── grid.js              # Manages the 2D boolean grid (80x80) used for placement logic,
│   │                        # indoor/outdoor detection, stair tracking, and walkability.
│   ├── generator.js         # The algorithm that determines *where* buildings, doors, and
│   │                        # stairs go on the grid. Avoids the spawn area.
│   ├── terrainMeshes.js     # Generates ground mesh (displaced) and Gerstner wave ocean
│   │                        # (custom ShaderMaterial with Fresnel, specular, SSS, fog).
│   ├── walls.js             # Per-building-side VertexData wall meshes (band decomposition with
│   │                        # door/window cutouts, triplanar UV) and roofs (flat / gable).
│   ├── floors.js            # Building floors, mid-level slabs, and single-mesh VertexData stairs.
│   ├── windows.js           # Generates extruded window walls, breakable glass panes (SPS shards).
│   ├── staticPhysics.js     # Translates grid architecture into Havok static bodies (walls,
│   │                        # floors, roofs, ceiling/mid-floor slabs, stairs, terrain heightfield).
│   ├── terrain.js           # Generates the Perlin-noise-like undulating ground surface using
│   │                        # sine waves/octaves, creating flat circular pedestals for spawns.
│   ├── boundary.js          # Handles the sci-fi visual "shield" effect that ripples when a
│   │                        # player or projectile hits the playable map boundary.
│   ├── doors.js             # Manages door entities: kinematic Havok bodies, swing animations,
│   │                        # collision, open/close interaction.
│   ├── torches.js           # Wall-mounted torches with PointLights (clustered), billboarded
│   │                        # glow halos, teardrop flames, GPU-driven ember ParticleSystems.
│   │                        # Torch pickup, placement, shadow slots, door torch position sync.
│   ├── furniture.js         # Procedurally generates interactive wooden beds inside buildings,
│   │                        # complete with frames, mattresses, and pillows.
│   ├── flowers.js           # Handles spawning, picking up (`E`), planting, and inventory
│   │                        # management of flowers with world-space preview system.
│   └── vegetation.js        # Distributes fir/pine trees and various-sized boulders. Manages
│                            # physics bodies and pickable stone collision.
│
├── entities/                # Active dynamic characters
│   ├── models.js            # A data registry of external assets (`.glb` files) with expected
│   │                        # licensing, heights, and spawn counts.
│   ├── modelLoader.js       # Asynchronously loads GLTF assets via SceneLoader, clones them
│   │                        # (instantiateModelsToScene for skeletons), normalizes heights,
│   │                        # and tints materials. Animation crossfade via createAnimMixer().
│   └── player.js            # The Player controller. Maps WASD inputs into Havok capsule body
│                            # velocity, handles jump buffer (coyote time), and manages the
│                            # 1st/3rd person camera modes with collision.
│
├── systems/                 # Gameplay loops and interaction UI controllers
│   ├── controls.js          # Manages PointerLock API, keyboard listeners, mouse movement,
│   │                        # pause/unpause, ESC capture, and interact (`E`).
│   ├── touch.js             # Translates mobile actions into equivalent keyboard signals.
│   │                        # Creates virtual left-joystick, right-screen look-drag,
│   │                        # and long-press interaction rings.
│   ├── daynight.js          # Drives the 24-hour game clock. Lerps sky colors, toggles star
│   │                        # visibility, and synchronizes directional sun angle/intensity.
│   ├── sleep.js             # Tracks time-skipping. When a bed is interacted with, fades
│   │                        # the screen, advances time to 08:00, and restores.
│   ├── projectiles.js       # Controls physics and visual integration of thrown rocks.
│   │                        # Accurate crosshair throw vectors, mid-air bounces, pickable loot.
│   ├── hotbar.js            # Handles the 5-slot bottom inventory UI. Manages drag-and-drop
│   │                        # ALT-mode cursor logic, slot selection keys (1-5), and icons.
│   ├── hud.js               # Synchronizes internal state to HTML DOM overlays. Pushes
│   │                        # dynamic data to the Minimap canvas and FPS counter.
│   ├── npcAI.js             # State machine for wandering Soldiers and fleeing Foxes.
│   │                        # Decides heading, idle vs walk, and serves the 100+ dialogues.
│   └── menu.js              # Procedural campfire menu scene. ParticleHelper.CreateAsync("fire")
│                            # with bloom + ACES tone mapping. Randomized character (fox/soldier),
│                            # tree placement, and summer/winter biome. WASD-controllable character.
│
└── utils/
    └── helpers.js           # Generic pure math utilities: converting grid coordinates (0-80)
                             # to world coordinates (XYZ arrays), random bounds, distance checks.

Backup files:
  src/systems/campfire-custom-particles.bak.js
                             # Custom 4-layer ParticleSystem fire effect (fire core, flame tips,
                             # embers, smoke) with procedural DynamicTextures. Saved before
                             # switching to ParticleHelper.CreateAsync("fire") approach.
```

## File Statistics

| File | Size (Bytes) | Total Lines | Logical Lines |
|---|---|---|---|
| `src/world/torches.js` | 44923 | 1202 | 915 |
| `src/world/furniture.js` | 25487 | 623 | 479 |
| `src/entities/player.js` | 25810 | 699 | 528 |
| `src/main.js` | 23980 | 659 | 528 |
| `src/systems/menu.js` | 22643 | 627 | 492 |
| `src/core/physics.js` | 19425 | 544 | 407 |
| `src/world/walls.js` | 19190 | 455 | 353 |
| `src/world/doors.js` | 17706 | 526 | 399 |
| `src/world/staticPhysics.js` | 17206 | 363 | 286 |
| `src/systems/npcAI.js` | 16850 | 539 | 440 |
| `src/systems/controls.js` | 16629 | 453 | 381 |
| `src/world/vegetation.js` | 16122 | 502 | 396 |
| `src/systems/projectiles.js` | 15388 | 477 | 386 |
| `src/world/windows.js` | 13876 | 341 | 269 |
| `src/world/floors.js` | 12987 | 314 | 255 |
| `src/systems/campfire-custom-particles.bak.js` | 11152 | 273 | 221 |
| `src/entities/modelLoader.js` | 11131 | 317 | 236 |
| `src/systems/touch.js` | 9385 | 274 | 226 |
| `src/world/terrainMeshes.js` | 9008 | 262 | 192 |
| `src/world/flowers.js` | 8597 | 285 | 226 |
| `src/core/lighting.js` | 7804 | 210 | 160 |
| `src/world/generator.js` | 7738 | 219 | 169 |
| `src/systems/hotbar.js` | 6498 | 201 | 169 |
| `src/systems/daynight.js` | 6471 | 196 | 150 |
| `src/world/grid.js` | 5736 | 196 | 150 |
| `src/systems/hud.js` | 4802 | 143 | 117 |
| `src/world/boundary.js` | 4713 | 157 | 116 |
| `src/core/scene.js` | 3555 | 97 | 72 |
| `src/systems/sleep.js` | 2623 | 83 | 62 |
| `src/config.js` | 1214 | 66 | 42 |
| `src/world/terrain.js` | 754 | 24 | 19 |
| `src/entities/models.js` | 648 | 31 | 30 |
| `src/utils/helpers.js` | 550 | 27 | 22 |
| **Total (33 files)** | **410601** | **11385** | **8893** |
