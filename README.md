# Dark Strands

A 3D first/third-person survival roguelite prototype built with Babylon.js 9 (WebGPU/WebGL2). Explore a procedurally generated village of stone buildings connected by dirt roads, rolling hills, forests, and wandering NPCs — with a full volumetric-fog/weather/water visual pipeline.

## Features

### World
- **Procedural village** — A main dirt road with branches winds past the spawn; stone buildings (1- and 2-story) line the roads with their doors facing them; standing torches light the roadsides at night
- **Procedural buildings** — Doorways, glass windows of varied shapes/sizes, flat/gable roofs, climbable stairs, 2nd floors, beds (sleep to morning)
- **Terrain** — Gentle rolling hills with automatic flat zones under buildings; roads conform to the terrain
- **Ocean & lakes** — Gerstner wave animated water with planar reflections, shoreline foam, rain ripples, Fresnel/specular/subsurface shading
- **Forests** — Procedurally generated trees via [ez-tree](https://github.com/dgreenheck/ez-tree): oak/ash/aspen deciduous trees, pine groves (conifers cluster in stands), bush thickets — real branching geometry with alpha-tested leaf textures, thin-instanced (2 draw calls per species variant); plus ~7,000 instanced grass tufts in meadow clumps

### Visual Effects (all toggleable from the main menu)
- **Volumetric height fog + god rays** — analytic exponential fog post-process with screen-space sun shafts; building interiors stay fog-free from any viewpoint (the shader subtracts in-building ray segments)
- **Procedural sky dome** — atmosphere gradient, domain-warped clouds driven by weather, twinkling stars, moon, sunset scatter
- **Weather system** — CLEAR/OVERCAST/RAIN/STORM state machine with cross-fades; player-following rain with per-particle roof/ground kill, flat splash rings on impact, rain ripple rings on water, lightning in storms
- **Water reflections** — half-res planar mirror sampled projectively by the ocean shader, blurred for softness
- **Post pipeline** — bloom, FXAA, torch GlowLayer (line-of-sight occluded so halos never bleed through walls)

### Lighting
- **Clustered lighting** — GPU-tiled `ClusteredLightContainer` manages all torch PointLights; lights fade out when the camera has no line of sight (no light through walls/floors)
- **Interior torches** — Angled wall-mounted torches with billboarded glow halos, teardrop flames, and ember particles
- **Door & road torches** — Exterior torches beside doors and along roads; off during day, light up at dusk
- **Shadow-casting torches** — 3 nearest torches get PointLight shadow cube maps with near-torch caster lists
- **Sun shadows** — fixed-frustum 2048 PCF map following the player on a texel-stable lattice

### Snow Biome
- Toggle from main menu before entering the world
- White snow ground, off-white tree leaves, frozen walkable ice replacing water
- 50% chance of snow in menu scene

### NPCs
- **Soldiers** — Wander randomly with idle/walk animations, green tint for identification
- **Foxes** — Flee from the player with smart pathfinding and wall sliding
- **Soldier dialogue** — Press E near a soldier to hear one of 100 lines (neutral, humorous, atmospheric, philosophical, warnings)
- **Speech bubbles** — Float above the soldier's head in world-space for 3.5 seconds
- NPCs avoid water, obstacles, and each other; soldiers stop and idle when blocked

### Interaction
- **Doors** — Open/close with E key, smooth swing animation, collision in both states
- **Flower picking** — Press E near flowers to collect them; they respawn far away after 15-30s (out of sight)
- **Torch placement** — Pick up and place torches on walls, doors, and floors
- **World-space hints** — `[E] Open/Close`, `[E] Talk`, `[E] Pick` labels track objects in 3D space
- **Right-click zoom** — 3x zoom over 0.5 seconds with smooth animation
- **Underwater** — Blue tint overlay, 40% movement speed, floaty jump/gravity

### Inventory
- **Hotbar** — 5-slot hotbar at bottom center of screen
- **Flower counter** — Slot 0 shows flower icon + collected count
- **Drag-and-drop** — Hold ALT for virtual cursor to rearrange hotbar slots

### Camera
- **First-person** — Eye-height view with full pitch/yaw; player model hidden (shadow still casts)
- **Third-person** — Over-the-shoulder with pitch orbit, robust 5-ray dynamic cone sweep for wall collision, smooth 1-second toggle
- **Seamless transitions** — Locked crosshair target raycast convergence keeps aim locked during V toggle
- **Game start** — Cinematic transition from 3rd to 1st person
- **Player model** — Blue-tinted soldier with idle/walk/run animations (visible in 3rd person)

### Day/Night Cycle
- Optional toggle in main menu (default: day only)
- **Realistic 24-hour clock** — starts at 08:00, HUD shows current time
- **Biome-aware** — Summer: sunrise 05:00, sunset 21:00. Winter (snow): sunrise 08:00, sunset 16:00
- Sun arcs across the sky during daytime, dips below horizon at night
- Gradual dusk/dawn — sky, fog, stars, and torches all transition smoothly
- **Sleeping** — interact with a bed to fast-forward time to 08:00 the next morning
- **Q key fast-forward** — hold Q to run the entire game at 3x speed

### Menu System
- **Campfire scene** — Procedural 3D campfire with ParticleHelper fire preset, stone ring, teepee log stack
- **Random variation** — Randomized character (fox or soldier), tree/rock placement, summer/winter biome
- **WASD-controllable character** — Walk around the menu scene within camera bounds
- **Bloom + ACES tone mapping** — Fire glow effect via DefaultRenderingPipeline
- **Frosted glass UI** — Gold typography, key hint badges, hover/active button states
- **Full-width progress bar** — Animated world-building progress on "Enter World" click
- **Pause overlay** — Tab/Pause key pauses with virtual cursor; ESC frees cursor without pausing

### HUD
- Crosshair (always visible in both camera modes)
- FPS counter, camera mode label, time display
- Minimap — flowers shown in cyan, 2-story buildings in lighter brown
- 5-slot hotbar with item icons and count badges
- **In-game help overlay** — Shift+? opens a themed survival guide with 5 sections; freezes game while open

## Getting Started

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser and click to play.

> Requires Node.js. `npm start` runs `npx serve . -p 3000`. No build step for game code — runs directly from source via ES modules.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| V | Toggle first/third person |
| E | Interact (doors, soldiers, flowers, rocks, torches, beds) |
| 1-5 | Select hotbar slot |
| Left-click | Use selected item (throw stone, place flower/torch) |
| Right-click (hold) | Zoom (3x) |
| ALT (hold) | Virtual cursor for hotbar drag-and-drop |
| Q (hold) | Fast-forward (3x game speed) |
| Shift+? | Help overlay (survival guide) |
| Tab / Pause | Pause (mouse stays trapped, virtual cursor) |
| ESC | Free cursor + freeze the world (click to resume) |

### Mobile Touch Controls
- Left side drag — Virtual joystick for movement
- Right side swipe — Camera look
- Right side long-press (1s) — Interact (with progress ring)
- JUMP / USE / CAM buttons — Bottom-right action buttons
- Hotbar tap — Select slot
- Pause (||) and Help (?) buttons — Top-left

## Tech Stack

- **Babylon.js 9.x** (`@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/materials`) pre-bundled via esbuild into `lib/babylon.bundle.js`
- **WebGPU** engine with automatic WebGL2 fallback (`?webgl` URL param forces WebGL2)
- **Babylon.js Havok** (`@babylonjs/havok`) — Havok WASM physics engine via Babylon.js v2 physics plugin
- **ez-tree** (`@dgreenheck/ez-tree` + `three` peer dep) pre-bundled via esbuild into `lib/eztree.bundle.js` with bark/leaf textures embedded as data URIs — generates tree/bush geometry at world-gen time; three.js never renders (Babylon consumes the raw vertex arrays)
- Pure ES modules for game code — `<script type="module" src="src/main.js">`
- `npm install` required; `npm run bundle:babylon` / `npm run bundle:eztree` to rebuild the bundles

## Project Structure

```
src/
  main.js              Entry point, game loop, world build orchestration
  config.js            Tunable constants (grid size, speeds, snow mode, etc.)
  core/
    scene.js           WebGPU/WebGL2 engine, Scene, FreeCamera setup
    lighting.js        Sun shadow map (texel-stable fixed frustum), hemi light, sun glow
    physics.js         Havok WASM physics world, body helpers, step, raycast
    postfx.js          Volumetric fog + god rays, interior fog exclusion, bloom/FXAA, GlowLayer
    skyDome.js         Procedural sky: atmosphere, weather clouds, stars, moon
  world/
    grid.js            2D collision grid, floor height, stair/road cells, walkability
    generator.js       Building placement along roads, road-facing doors, stairs, windows
    roads.js           Village road network, dirt ribbon mesh, roadside torches
    terrainMeshes.js   Ground plane (displaced mesh) and Gerstner wave ocean shader
    walls.js           Building walls (VertexData, triplanar UV) and roofs
    floors.js          Ground floor slabs, mid-floor pieces, stair steps
    windows.js         Glass panes (breakable) and wooden window frames
    staticPhysics.js   Havok static bodies for walls, floors, roofs, stairs
    vegetation.js      Tree/bush/rock/grass placement (grid, groves, exclusions), rocks, grass
    ezTreeFactory.js   ez-tree template generation + thin-instance spawning of trees/bushes
    terrain.js         Perlin noise terrain heightmap
    boundary.js        World-edge hex-grid shield effect
    torches.js         Torch core: mesh creation, materials, world placement, pickup
    torchLighting.js   Clustered light container, shadow slot generators
    torchParticles.js  Ember/smoke/spark particles, flicker, shadow slot management
    torchPlacement.js  Player torch placement: preview, ray-march, door panel hits
    torchHeld.js       First-person held torch rendering
    doors.js           Door meshes with pivot rotation, open/close, kinematic bodies
    flowers.js         Flower pickup, planting, preview system
    furniture.js       Procedural furniture (beds) geometry generation
  entities/
    models.js          Model registry (URLs, heights, counts, licenses)
    modelLoader.js     GLTF loading (SceneLoader), cloning, animation mixer
    player.js          Movement, physics capsule, camera modes, zoom
  systems/
    controls.js        Pointer lock, keyboard, mouse input, pause states
    touch.js           Mobile touch input (joystick, look, long-press interact)
    hotbar.js          Hotbar slots, ALT cursor drag-and-drop
    daynight.js        Day/night cycle, sky color, fog distances, star visibility
    weather.js         CLEAR/OVERCAST/RAIN/STORM state machine + modifiers
    rainFX.js          Rain streaks, surface kill map, flat splash rings
    sleep.js           Time-skip mechanics when interacting with beds
    hud.js             FPS counter, minimap canvas (cached base layer), camera mode label
    npcAI.js           NPC wandering behavior, soldier dialogue (100 lines)
    projectiles.js     Stone throwing with Havok dynamic bodies
    menu.js            Procedural campfire menu scene with ParticleHelper fire
  utils/
    helpers.js         Grid/world coordinate conversion, RNG
assets/
  models/              Soldier.glb, Fox.glb, Flower.glb, Horse.glb
  textures/            grass.jpg, stone_wall.jpg, bark.jpg, wood_planks.jpg
```

## Asset Credits

**Models**
- Soldier.glb, Horse.glb, Flower.glb — [Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) (MIT)
- Fox.glb — [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC-BY 4.0)

**Textures**
- grass.jpg, stone_wall.jpg, bark.jpg, wood_planks.jpg — [Poly Haven](https://polyhaven.com) (CC0)
- Tree bark/leaf textures — embedded in `lib/eztree.bundle.js` from [ez-tree](https://github.com/dgreenheck/ez-tree) (MIT; bark textures sourced from Poly Haven / texturecan per the ez-tree README)

## License

Prototype / personal project. See individual asset licenses above.
