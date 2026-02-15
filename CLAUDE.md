# Dark Strands

3D first-person survival roguelite prototype built with Three.js. Switchable to third person.

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
- ESC - Release mouse

## Tech Stack
- **Three.js 0.162.0** installed locally via npm, loaded via importmap from `node_modules/`
- Pure ES modules, no bundler — `<script type="module" src="src/main.js">`
- `npm install` required (installs three.js); `npx serve` for local HTTP server

## Architecture

Enterprise-style modular structure. All game code in `src/`, split by concern:

```
src/
  main.js                  # Entry point, game loop, init orchestration
  config.js                # All tunable constants (CFG object)
  core/
    scene.js               # Renderer, scene, camera setup
    lighting.js            # Sun, hemisphere light, stars
  world/
    grid.js                # 2D collision grid, walkability checks
    generator.js           # Procedural building placement
    geometry.js            # 3D walls, ground plane, building floors
    vegetation.js          # Low-poly trees and rocks
    torches.js             # Wall-mounted point lights inside buildings
  entities/
    models.js              # Model registry (data only — URLs, heights, counts, licenses)
    modelLoader.js         # GLTF loading, cloning, animation setup, places models in scene
    player.js              # Player state, movement, collision, camera modes
  systems/
    controls.js            # Pointer lock, keyboard, mouse input
    daynight.js            # Day/night cycle, sky color, fog, star visibility
    hud.js                 # FPS counter, minimap canvas, camera mode label
    npcAI.js               # NPC wandering behavior (idle/walk state machine)
  utils/
    helpers.js             # Grid↔world coordinate conversion, rng utilities
```

## Key Design Decisions

### World Generation
- 80×80 grid, each cell = 2 world units → 160×160 unit outdoor world
- Outdoor ground everywhere, with procedurally placed rectangular stone **buildings**
- Buildings have walls on perimeter with 1–3 doorways
- Mix of 1-story and 2-story buildings (~35% chance of 2-story for large buildings)
- Flat roofs (grey slab) or slanted gable roofs (brown triangular prism), 50/50 split
- 2-story buildings have taller walls and a mid-level floor plane
- Trees and rocks scattered in outdoor areas (mark grid cells as blocked)
- Player spawns at center; buildings avoid the center area

### Collision
- 2D boolean grid: `true` = walkable, `false` = blocked
- Player checked with radius (4-corner test in `canMoveTo`)
- NPCs use same collision system

### Models
- All `.glb` files stored locally in `assets/models/`
- Registry in `src/entities/models.js` — add new models there
- Models are auto-scaled to `targetHeight` on load (bounding box normalization)
- Animated models use `SkeletonUtils.clone()` for proper skeleton duplication

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

### Camera
- First person: camera at player eye height (1.7 units)
- Third person: over-the-shoulder view, player offset ~35% left of screen, Soldier model with direction-aware facing and smooth rotation lerp
- Toggle with V key

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
     animated: true,       // use SkeletonUtils.clone if true
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

## Known Quirks
- Three.js loaded from CDN — requires internet for first load (browser caches it after)
- No bundler means no tree-shaking; full Three.js module is fetched
- Pointer lock requires HTTPS or localhost
- The blocker overlay handles click-to-play (not the canvas)
