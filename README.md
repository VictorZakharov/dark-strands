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

## AI 3D Model Generation — Service Research (Feb 2026)

Services for generating 3D models from images or text prompts. All must export GLB/GLTF for use in this Three.js project.

### Top Picks

| Service | Type | GLB | Free Tier | Commercial (Free) | Low-Poly Mode |
|---------|------|-----|-----------|-------------------|---------------|
| **[Meshy AI](https://www.meshy.ai/)** | Image+Text→3D | Yes | 100 credits/mo | No (CC BY 4.0) | Yes |
| **[Tripo3D](https://www.tripo3d.ai/)** | Image+Text→3D | Yes | 300-600 credits/mo | No (CC BY 4.0) | Yes |
| **[Rodin (Hyper3D)](https://hyper3d.ai/)** | Image+Text→3D | Yes | 40 one-time credits | **Yes (all tiers)** | No |
| **[Sloyd AI](https://www.sloyd.ai/)** | Text→3D (procedural) | Yes | Preview access | Check ToS | Yes |
| **[TRELLIS.2](https://github.com/microsoft/TRELLIS.2)** | Image→3D (open source) | Yes | Fully free | **Yes (MIT)** | No |

### Meshy AI — Best all-rounder
- **URL:** https://www.meshy.ai/
- Image-to-3D and text-to-3D with dedicated **Low Poly Mode** for game devs
- Exports: GLB, FBX, OBJ, STL, USDZ, BLEND
- Free: 100 credits/month (~10 models), no credit card needed
- Paid: Pro $20-30/month for 1,000 credits + commercial rights + private models
- **Gotcha:** Free tier models are public (CC BY 4.0, attribution required). Need Pro for commercial use.

### Tripo3D — Best for characters
- **URL:** https://www.tripo3d.ai/
- Strongest character topology — clean quads, **auto-rigging**, animation-ready output
- Smart Low Poly mode, retopology, and LOD generation built in
- Exports: GLB, FBX, OBJ, USD, STL
- Free: 300-600 credits/month (~10 models)
- Paid: Creator $30/month
- **Gotcha:** Same CC BY 4.0 restriction on free tier as Meshy.

### Rodin AI (Hyper3D) — Best free commercial license
- **URL:** https://hyper3d.ai/
- Image-to-3D and text-to-3D with quad-mesh output
- Exports: GLB, FBX, OBJ
- Free: 40 one-time credits (not recurring)
- **Commercial rights on ALL tiers including free** — unique advantage
- Paid: Education $15/month, Creator $30/month
- **Gotcha:** 40 free credits are one-time only, not monthly.

### Sloyd AI — Best for game props
- **URL:** https://www.sloyd.ai/
- Procedural + AI hybrid, built specifically for game assets
- Clean topology, auto UV unwrapping, LOD generation
- Template library for common game objects (crates, barrels, weapons, furniture)
- Exports: GLB, OBJ, STL
- Free: Preview text-to-3D and image-to-3D with exports
- Paid: Plus $15/month, Pro $50/month
- **Gotcha:** Image-to-3D is still in preview/beta. Better for hard-surface props than organic shapes.

### Microsoft TRELLIS.2 — Best fully free option
- **URL:** https://github.com/microsoft/TRELLIS.2
- **Free demo:** https://huggingface.co/spaces/trellis-community/TRELLIS (no signup)
- Open-source image-to-3D (MIT license, CVPR 2025 Spotlight)
- Full PBR materials (base color, roughness, metallic, opacity)
- Exports: GLB, OBJ, PLY, GLTF, STL, USDZ
- **100% free, commercial use, no attribution required**
- **Gotcha:** Output is high-poly — needs decimation in Blender for real-time use in Three.js. Self-hosting requires NVIDIA GPU.

### Other Options

| Service | Notes |
|---------|-------|
| **[CSM AI](https://csm.ai/)** | Research-grade, multi-view input, 10 free credits only |
| **[Fast3D](https://fast3d.io/)** | Speed-focused (~10s generation), GLB export, free tier with limits |
| **[Polycam](https://poly.cam/)** | Photogrammetry from photos/LiDAR, free GLTF export, real objects only |
| **[KIRI Engine](https://www.kiriengine.app/)** | Mobile photogrammetry, GLB export, real objects only |
| **[Shap-E](https://github.com/openai/shap-e)** | OpenAI open-source, MIT license, but dated quality (2023), no native GLB |

### Recommendations for This Project

- **Quick asset prototyping:** Meshy AI or Tripo3D (free tier, direct GLB export, low-poly modes)
- **Characters with animation:** Tripo3D (auto-rigging + clean quad topology)
- **Hard-surface props:** Sloyd AI (game-optimized output, UV + LOD built in)
- **Free with commercial rights:** TRELLIS.2 via HuggingFace (MIT, but needs Blender decimation)
- **Scanning real objects:** Polycam (free GLTF)
- **Avoid:** Shap-E (quality too low for 2026 standards)

### Workflow: AI Model → Three.js

1. Generate model on chosen service (image or text prompt)
2. Export as GLB
3. *(If high-poly)* Open in Blender → Decimate modifier → re-export as GLB
4. Place in `assets/models/`
5. Add entry to `MODEL_REGISTRY` in `src/entities/models.js`
6. Models auto-scale to `targetHeight` on load

## License

Prototype / personal project. See individual asset licenses above.
