# Dark Strands — Architecture Overview

## General Architecture

Dark Strands is an enterprise-style, modular 3D sandbox survival prototype built using
**Three.js** and the **cannon-es** physics engine. The project eschews traditional
JavaScript bundlers (like Webpack or Vite) in favor of pure, native ES Modules
(`<script type="module">`).

The architecture is heavily decoupled by concern, following a Manager/System pattern
where possible:

- **Core Orchestration**: `main.js` handles the game loop, initialization, loading
  screens, and global state orchestration (calling `updateX()` on all subsystems).
- **Procedural Generation**: Building placement is tracked on a 2D integer grid
  (`grid.js`), which informs 3D mesh building (`geometry.js`). Terrain is a
  mathematical Heightfield with smoothstep blending.
- **Instanced Rendering**: Almost all static environment objects (walls, floor tiles,
  trees, distant rocks) use `THREE.InstancedMesh` with texture instancing to massively
  reduce WebGL draw calls, allowing a large visual scale.
- **Physics**: All critical movement, gravity, jumping, boundary containment, throwing,
  and door collision uses `cannon-es`. Static scenery is converted mathematically from
  the visual grid into physical bodies during load and then effectively divorced from
  visual coordinates.
- **Decoupled UI**: HTML/CSS overlays (menus, hints, hotbars) sit on top of the WebGL
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
├── core/                    # Engine-level Three.js and Physics wrappers
│   ├── scene.js             # Initializes the WebGLRenderer, Scene, Scene Background, and main
│   │                        # PerspectiveCamera. Sets up global fog.
│   ├── lighting.js          # Sets up ambient illumination (Hemisphere) and dynamic atmospheric
│   │                        # lights (Directional sun, sun disc, stars, celestial flare).
│   └── physics.js           # Initializes the `cannon-es` physical World. Defines physics
│                            # materials, contact algorithms, and helper functions to
│                            # construct bodies (Terrain Heightfields, dynamic spheres, boxes).
│
├── world/                   # Procedural generation and static/kinematic environment processing
│   ├── grid.js              # Manages the 2D boolean grid (80x80) used for placement logic,
│   │                        # indoor/outdoor detection, stair tracking, and walkability.
│   ├── generator.js         # The algorithm that determines *where* buildings, doors, and
│   │                        # stairs go on the grid. Avoids the spawn area and path-to-NPC.
│   ├── terrainMeshes.js         # Generates the InstancedMesh for the ground and the water plane.
│   ├── floors.js                # Constructs inner building floors, mid-level slabs, and staircases.
│   ├── walls.js                 # Constructs InstancedMesh structural walls, thin-posts, and roofs.
│   ├── windows.js               # Generates extruded window walls, breakable glass logic, and panes.
│   ├── staticPhysics.js         # Translates grid architecture into cannon-es static/kinematic bodies.
│   ├── terrain.js               # Generates the Perlin-noise-like undulating ground surface using
│   │                            # sine waves/octaves, creating flat circular pedestals for spawns.
│   ├── boundary.js          # Handles the sci-fi visual "shield" effect that ripples when a
│   │                        # player or projectile forcibly hits the playable map boundary.
│   ├── doors.js             # Manages the door entities: their physical rotation math,
│   │                        # kinematic physics bodies, swinging animations, and collision.
│   ├── torches.js           # Spawns structural point lights. Manages wall-mounted torches
│   │                        # inside buildings, door-side torches, and the pool of items.
│   ├── furniture.js         # Procedurally generates interactive wooden beds inside buildings,
│   │                        # complete with frames, mattresses, and pillows.
│   ├── flowers.js           # Handles the spawning, picking up (`E`), rendering, and inventory
│   │                        # management of blue consumable flowers.
│   └── vegetation.js        # Distributes fir/pine trees and various-sized boulders. Manages
│                            # "standing" collision logic for tree foliage and pickable stones.
│
├── entities/                # Active dynamic characters
│   ├── models.js            # A data registry of external assets (`.glb` files) with expected
│   │                        # licensing, heights, and spawn counts.
│   ├── modelLoader.js       # Asynchronously loads GLTF assets, clones them cleanly (inkl
│   │                        # Skeletons), normalizes base heights, and tints materials.
│   └── player.js            # The complex Player controller. Maps WASD inputs into Cannon-es
│                            # velocity, handles jump buffer (coyote time), tracks the compound
│                            # capsule body, and manages the 1st/3rd person collision cameras.
│
├── systems/                 # Gameplay loops and interaction UI controllers
│   ├── controls.js          # Manages PointerLock API interactions, keyboard listeners, mouse
│   │                        # movement, pause un-pausing, ESC capture, and interact (`E`).
│   ├── touch.js             # Translates mobile actions into equivalent keyboard signals.
│   │                        # Creates the virtual left-joystick, right-screen look-drag,
│   │                        # and long-press interaction rings for phones.
│   ├── daylight.js          # Drives the 24-hour game clock. Lerps sky colors, toggles star
│   │                        # visibility, and synchronizes directional sun angle/intensity.
│   ├── sleep.js             # Tracks time-skipping. When a bed is interacted with, fades
│   │                        # the screen, instantly advances time to 08:00, and restores.
│   ├── projectiles.js       # Controls the physics and visual integration of thrown rocks.
│   │                        # Computes accurate crosshair throw vectors, tracks mid-air
│   │                        # bounces, and registers rocks that stop as pickable loot.
│   ├── hotbar.js            # Handles the 5-slot bottom inventory UI. Manages drag-and-drop
│   │                        # ALT-mode cursor logic, slot selection keys (1-5), and icons.
│   ├── hud.js               # Synchronizes internal code state to HTML DOM overlays. Pushes
│   │                        # dynamic data to the minimal Minimap canvas and FPS counter.
│   ├── npcAI.js             # State machine for wandering Soldiers and fleeing Foxes.
│   │                        # Decides heading, idle vs walk, and serves the 100+ dialogues.
│   └── menu.js              # The procedural Main Menu background generator. Picks from 5
│                            # visual themes (Campfire, Lakeside, etc) and builds a 3D diorama.
│
└── utils/
    └── helpers.js           # Generic pure math utilities: converting grid coordinates (0-80)
                             # to world coordinates (XYZ arrays), random bounds, distance checks.
```

## File Statistics

This table details the file size, total number of lines, and the logical line count (excluding newlines, pure whitespace, `{` `}` punctuation blocks, and comment blocks) for all JavaScript logic in the `src/` directory. 

| File | Size (Bytes) | Total Lines | Logical Lines |
|---|---|---|---|
| `src/systems/menu.js` | 31201 | 905 | 633 |
| `src/world/torches.js` | 27398 | 789 | 529 |
| `src/entities/player.js` | 25554 | 669 | 433 |
| `src/world/furniture.js` | 19560 | 463 | 313 |
| `src/main.js` | 18935 | 539 | 376 |
| `src/world/doors.js` | 15067 | 500 | 341 |
| `src/world/vegetation.js` | 14612 | 487 | 318 |
| `src/systems/projectiles.js` | 14487 | 465 | 319 |
| `src/systems/npcAI.js` | 14393 | 477 | 336 |
| `src/systems/controls.js` | 14262 | 402 | 280 |
| `src/world/walls.js` | 12484 | 317 | 217 |
| `src/world/windows.js` | 12030 | 309 | 221 |
| `src/world/staticPhysics.js` | 10354 | 233 | 158 |
| `src/systems/touch.js` | 9385 | 275 | 191 |
| `src/world/generator.js` | 7346 | 208 | 128 |
| `src/core/physics.js` | 6925 | 212 | 136 |
| `src/world/flowers.js` | 6882 | 255 | 176 |
| `src/world/floors.js` | 6578 | 164 | 119 |
| `src/systems/hotbar.js` | 6498 | 202 | 135 |
| `src/systems/daynight.js` | 5640 | 161 | 105 |
| `src/world/grid.js` | 5540 | 197 | 112 |
| `src/core/lighting.js` | 5217 | 149 | 115 |
| `src/entities/modelLoader.js` | 4967 | 159 | 107 |
| `src/systems/hud.js` | 4802 | 144 | 96 |
| `src/world/boundary.js` | 3838 | 139 | 91 |
| `src/systems/sleep.js` | 2623 | 84 | 54 |
| `src/world/terrainMeshes.js` | 2385 | 75 | 58 |
| `src/core/scene.js` | 1084 | 36 | 26 |
| `src/config.js` | 778 | 57 | 32 |
| `src/world/terrain.js` | 730 | 25 | 15 |
| `src/entities/models.js` | 595 | 30 | 22 |
| `src/utils/helpers.js` | 550 | 28 | 15 |
| **Total (32 files)** | **312700** | **9155** | **6207** |
