# Dark Strands

A 3D first/third-person survival roguelite prototype built with Three.js. Explore a procedurally generated world of stone buildings, rolling hills, and wandering NPCs.

## Features

### World
- **Procedural generation** — Stone buildings (1- and 2-story) with doorways, glass windows of varied shapes/sizes, and flat/gable roofs
- **Terrain** — Gentle rolling hills with automatic flat zones under buildings
- **Stairs** — Climbable 8-step wood staircases in 2-story buildings, flush against walls, with proper collision (can't walk under)
- **2nd floors** — Thick floor slabs with full wall-to-wall coverage and stairwell gaps
- **Water** — Semi-transparent blue water plane with underwater effects (blue tint, slow movement)
- **Vegetation** — Randomized fir/pine trees, boulders, and flowers; small rocks are jumpable, large rocks are climbable
- **Wood house floors** — Ground floors use wood plank texture, wall-to-wall coverage sealing all light paths
- **Interior torches** — Angled wall-mounted point lights inside buildings (30° tilt, skip doors/windows/stairs)
- **Door torches** — Exterior torches beside every door; off during day, light up at dusk
- **Fog** — Distance fog (near=10/far=55 day, near=5/far=30 night)

### Snow Biome
- Toggle from main menu before entering the world
- White snow ground, off-white tree leaves, frozen walkable ice replacing water
- 35% chance of snow appearing in menu scenes too

### NPCs
- **Soldiers** — Wander randomly with idle/walk animations, green tint for identification
- **Foxes** — Flee from the player with smart pathfinding and wall sliding
- **Soldier dialogue** — Press E near a soldier to hear one of 100 lines (neutral, humorous, atmospheric, philosophical, warnings)
- **Speech bubbles** — Float above the soldier's head in world-space for 3.5 seconds
- NPCs avoid water, obstacles, and each other; soldiers stop and idle when blocked

### Interaction
- **Doors** — Open/close with E key, smooth swing animation, collision in both states
- **Flower picking** — Press E near flowers to collect them; they respawn far away after 15-30s (out of sight)
- **World-space hints** — `[E] Open/Close`, `[E] Talk`, and `[E] Pick` labels track objects in 3D space
- **Right-click zoom** — 3x zoom over 0.5 seconds with smooth animation
- **Underwater** — Blue tint overlay, 40% movement speed, floaty jump/gravity

### Inventory
- **Hotbar** — 5-slot hotbar at bottom center of screen
- **Flower counter** — Slot 0 shows flower icon + collected count
- Flowers respawn at random positions far from player, outside camera view

### Camera
- **First-person** — Eye-height view with full pitch/yaw; player model hidden via layers (shadow still casts)
- **Third-person** — Over-the-shoulder with pitch orbit, 3-ray wall collision probe, smooth 1-second toggle
- **Seamless transitions** — Crosshair raycast convergence keeps aim locked on the exact world point during V toggle; mouse look works throughout; mid-transition re-toggle reverses smoothly
- **Game start** — Cinematic transition from 3rd to 1st person
- **Player model** — Blue-tinted soldier with idle/walk/run animations (visible in 3rd person)

### Day/Night Cycle
- Optional toggle in main menu (default: day only)
- **Realistic 24-hour clock** — starts at 08:00, HUD shows current time
- **Biome-aware** — Summer (normal): sunrise 05:00, sunset 21:00 (16h day). Winter (snow): sunrise 08:00, sunset 16:00 (8h day)
- Sun arcs across the sky during daytime, dips below horizon at night
- Gradual dusk/dawn — sky, fog, stars, and torches all transition smoothly (smoothstep blending)
- Stars fade in at dusk, interior torches glow brighter, door torches gradually ignite
- **Q key fast-forward** — hold Q to run the entire game at 3× speed

### Menu System
- **5 procedural 3D scene templates** — Shelter Night, Lakeside, Forest Fox, Rocky Day, Campfire
- **Random variation** — Different template each load (no duplicates in a row), random snow, random soldier tint colors
- **WASD-controllable character** — Walk around the menu scene within camera bounds
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
npm start
```

Open http://localhost:3000 in your browser and click to play.

> Requires Node.js (for `npx serve`). No build step — the game runs directly from source via ES modules.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint |
| Space | Jump |
| V | Toggle first/third person |
| E | Interact (doors, soldiers, flowers) |
| Right-click (hold) | Zoom (3x) |
| Q (hold) | Fast-forward (3x game speed) |
| 1-5 | Select hotbar slot |
| Left-click | Use selected item (throw stone, place flower/torch) |
| ALT (hold) | Virtual cursor for hotbar drag-and-drop |
| Shift+? | Help overlay (survival guide) |
| Tab / Pause | Pause (mouse stays trapped, virtual cursor) |
| ESC | Free cursor (game keeps running, click to re-lock) |

## Tech Stack

- **Three.js 0.162.0** via ES module importmap (CDN, no bundler)
- Pure ES modules — `<script type="module" src="src/main.js">`
- Zero npm dependencies (only `npx serve` for local HTTP)

## Project Structure

```
src/
  main.js              Entry point, game loop, world build orchestration
  config.js            Tunable constants (grid size, speeds, snow mode, etc.)
  core/
    scene.js           Renderer, scene, camera, fog
    lighting.js        Sun, hemisphere light, stars
  world/
    grid.js            2D collision grid, floor height, stair zones, upper floors
    generator.js       Procedural building placement with stairs, doors, windows
    geometry.js        Walls, ground, floors, windows, roofs, water, stairs
    terrain.js         Sine wave elevation with flat zones
    vegetation.js      Trees and rocks with collision and standing surfaces
    torches.js         Wall-mounted point lights (skip doors/windows/stairs)
    doors.js           Door meshes, interaction, swing collision, world-space hints
    flowers.js         Flower pickup, respawn, inventory, world-space hints
  entities/
    models.js          Model registry (URLs, heights, counts)
    modelLoader.js     GLTF loading, cloning, animation setup, NPC tinting
    player.js          Movement, collision, camera modes, zoom, underwater
  systems/
    controls.js        Pointer lock, keyboard, mouse input, right-click zoom
    daynight.js        Day/night cycle, sky color, fog intensity
    hud.js             FPS, minimap, camera mode, hotbar inventory
    menu.js            5-template procedural menu scene with WASD character
    npcAI.js           NPC wander/flee AI, soldier dialogue (100 lines)
  utils/
    helpers.js         Grid/world coordinate conversion, RNG
assets/
  models/              Soldier.glb, Fox.glb, Flower.glb
  textures/            grass.jpg, stone_wall.jpg, bark.jpg, wood_planks.jpg
```

## Asset Credits

**Models**
- Soldier.glb, Flower.glb — [Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) (MIT)
- Fox.glb — [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC-BY 4.0)

**Textures**
- grass.jpg, stone_wall.jpg, bark.jpg, wood_planks.jpg — [Poly Haven](https://polyhaven.com) (CC0)

## License

Prototype / personal project. See individual asset licenses above.
