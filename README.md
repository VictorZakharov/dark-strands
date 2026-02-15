# Dark Strands

A 3D first/third-person survival roguelite prototype built with Three.js. Explore a procedurally generated world of stone buildings, rolling hills, and wandering NPCs.

## Features

- **Procedural world** — Stone buildings (1- and 2-story), terrain with rolling hills, scattered trees and boulders
- **Interactive doors** — Open/close with E key, smooth swing animation, physics collision in both states
- **Glass windows** — Semi-transparent panes on building walls
- **Roofs** — Mix of flat and slanted gable styles
- **Stairs** — Climbable staircases in 2-story buildings
- **NPC AI** — Soldiers wander idly, foxes flee from the player with smart pathfinding and wall sliding
- **Day/night cycle** — Optional toggle; sun orbits, sky shifts, stars appear, torches glow at night
- **Dual camera** — First-person or over-the-shoulder third-person with animated player model
- **Minimap** — Top-right corner overview of the grid
- **Terrain** — Gentle hills with automatic flat zones under buildings

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
| E | Open/close doors |
| ESC | Release mouse |

## Tech Stack

- **Three.js 0.162.0** via ES module importmap (CDN, no bundler)
- Pure ES modules — `<script type="module" src="src/main.js">`
- Zero npm dependencies (only `npx serve` for local HTTP)

## Project Structure

```
src/
  main.js              Entry point, game loop
  config.js            Tunable constants (grid size, speeds, etc.)
  core/
    scene.js           Renderer, scene, camera
    lighting.js        Sun, hemisphere light, stars
  world/
    grid.js            2D collision grid, floor height, stair zones
    generator.js       Procedural building placement
    geometry.js        Walls, ground, floors, windows, roofs
    terrain.js         Sine wave elevation with flat zones
    vegetation.js      Trees and rocks with textures
    torches.js         Wall-mounted point lights
    doors.js           Door meshes, interaction, swing collision
  entities/
    models.js          Model registry (URLs, heights, counts)
    modelLoader.js     GLTF loading, cloning, animation setup
    player.js          Movement, collision, camera modes
  systems/
    controls.js        Pointer lock, keyboard, mouse input
    daynight.js        Day/night cycle, sky color, fog
    hud.js             FPS, minimap, camera mode label
    npcAI.js           NPC wander/flee AI with wall sliding
  utils/
    helpers.js         Grid/world coordinate conversion, RNG
assets/
  models/              Soldier.glb, Fox.glb, Flower.glb, Horse.glb
  textures/            grass.jpg, stone_wall.jpg, bark.jpg
```

## Asset Credits

**Models**
- Soldier.glb, Horse.glb, Flower.glb — [Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf) (MIT)
- Fox.glb — [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC-BY 4.0)

**Textures**
- grass.jpg, stone_wall.jpg, bark.jpg — [Poly Haven](https://polyhaven.com) (CC0)

## License

Prototype / personal project. See individual asset licenses above.
