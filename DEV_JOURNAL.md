# Dark Strands — Dev Journal

## 2026-02-14

### Session 1 — Initial prototype and core systems
- Created 3D first-person survival roguelite prototype with Three.js (ES modules, no bundler)
- Procedural building generation on 80x80 grid (rectangular stone buildings with walls, doorways)
- Player movement with WASD, sprint, jump, gravity, grid-based collision
- First-person and third-person (over-the-shoulder) camera, toggled with V
- Downloaded models locally: Soldier.glb, Fox.glb, Flower.glb, Horse.glb
- Player uses Soldier model with idle/walk/run animations and smooth facing rotation
- NPC AI: soldiers wander randomly (idle/walk state machine), foxes flee from player with smart pathfinding
- NPC collision pushes player out of NPCs
- Applied textures from Poly Haven (CC0): grass.jpg, stone_wall.jpg, bark.jpg
- Day/night cycle with sun orbit, sky color lerp, stars, fog — toggle in main menu (default: day only)
- Wall-mounted torches inside buildings (point lights positioned against walls, not floating)
- Roofs on all buildings: 50/50 flat (grey slab) or slanted gable (brown triangular prism)
- Some buildings are 2-story (~35% of large buildings) with taller walls and mid-level floor
- Restructured codebase into enterprise-style modules (core/, world/, entities/, systems/, utils/)
- Documented model and texture sources in CLAUDE.md

### Session 2 — Stairs, fox fixes, doors, windows
- Added stair system for 2-story buildings: 8-step visual staircase, stair zone height interpolation in grid.js, upper floor cell tracking
- Mid-level floor split into L-shape with stairwell gap (2 PlaneGeometry pieces)
- Player Y position uses `getFloorHeight()` for stairs and upper floors
- Fixed foxes getting stuck in walls: added `canMoveToR(x, z, radius)` for NPC-radius-aware collision
- Fixed fox direction flickering: added `fleeTimer` (0.4s persistence) to prevent recalculating flee direction every frame
- Fixed fox wall sliding: split X/Z movement in `moveNpc()` helper for per-axis collision
- Added door system (`doors.js`): door meshes with pivot rotation via THREE.Group, E key to open/close, `[E]` hint when near
- Door cells stay blocked in grid, excluded from wall InstancedMesh, tracked separately
- Added glass windows on buildings: MeshPhysicalMaterial with transmission for see-through effect
- Windows placed on 2-4 random non-door non-corner wall cells per building
- Generator tracks doors and windows per building for geometry systems

### Session 3 — Terrain, door polish, vegetation overhaul, rock system
- Created terrain system (`terrain.js`): sine wave elevation with smoothstep flat zones around buildings and spawn
- Ground mesh uses 128x128 segments with vertex displacement for terrain undulation
- Buildings register flat zones so they sit on level ground
- Walls positioned at terrain height (terrain-aware Y)
- 2-story buildings: upper wall blocks above doors (extra InstancedMesh entries)
- Floors use DoubleSide material (visible from below, not transparent)
- Doors: smooth open/close animation via lerp (4 rad/s), bark.jpg texture with brown tint, full cell width (no gaps)
- Doors positioned at terrain height
- Trees: 2x bigger (scale 1.6-3.2), randomized shape (3-5 cone layers, variable trunk/radius), grass.jpg texture on leaves, terrain-aware Y
- Rocks: random sizes (15% big 1.5-2.5, 25% medium 0.7-1.5, 60% small 0.2-0.7), all impassable (grid cells blocked), stone_wall.jpg texture, terrain-aware Y
- NPCs follow terrain height every frame in `updateNpcs()`
- Models (soldiers, foxes, clones) placed at terrain height on spawn
- `updateDoors(dt)` wired into main game loop for smooth animation
- Added Dev Journal (this file) and documented journal workflow in CLAUDE.md

### Session 4 — Rock collision, windows rewrite, terrain, doors, trees, camera
- Rock collision rewritten: switched from grid-cell-only to circle-based collision (`rockColliders` array with `{x, z, r, top}` per rock). Movement checks use actual radius, grid cell still blocked for spawn prevention. Collider radius = `s * 0.85`.
- Small rocks are now jumpable: collision checks accept optional `entityY` parameter, skipping rocks when player Y > rock top. NPCs still collide normally (no Y parameter).
- Door swing cell logic removed (was blocking entry into buildings). Simplified to just toggling doorway cell walkability on open/close.
- Stairs now computed BEFORE doors in generator, allowing door placement to avoid stair column (no more doors leading into stair walls)
- Window system completely rewritten: cells excluded from wall InstancedMesh, replaced with ExtrudeGeometry walls containing rectangular hole cutouts + transparent glass panes (opacity 0.25). Multi-floor windows handled per cell.
- Windows much more common: ~50% of wall candidates on ground floor (min 3), ALL wall candidates on 2nd floor for light
- Added `windowCells` tracking in grid.js (`addWindowCell`, `isWindowCell`)
- Increased terrain elevation: amplitudes 3.0/1.5/0.5 (three octaves), smoothstep blend radius 6
- Trees: fir/pine shape with wider bottom cones, narrower at top (`frac` based scaling). Leaf cones no longer cast shadows (softer look). Trunk still casts shadow.
- Hemisphere light increased from 0.4 to 0.7 for softer shadows. Added shadow normalBias 0.05.
- Camera toggle to first person now resets pitch to 0 (horizontal) and yaw to match model's facing direction
- Rock pushback in player.js passes `state.y` for height-aware collision
- Added `README.md` with features, setup, controls, project structure, and asset credits

### Session 5 — Wall thickness, windows, doors, water, trees, torches
- Walls now orientation-aware: NS walls thin in Z, EW walls thin in X (WALL_T=0.7), corners full size for connectivity. Uses per-instance scaling on unit BoxGeometry.
- Window count reduced: max 1 per wall direction, ~50% chance ground floor, ~60% chance 2nd floor. No more window-heavy buildings.
- Window wall extrusion depth reduced to WALL_T (was full CELL). Fixes z-fighting artifacts at distance.
- Glass pane material: added depthWrite:false to fix transparency sorting artifacts visible at distance.
- Stairs approach space: stairNumCells = min(3, h-3) ensures at least 1 free cell in front of stair entrance.
- Door panel collision: open doors now block the area where the panel sits. Circle collider at panel center (radius ~0.7). Player and NPCs can't walk through open door panels.
- Small rocks truly jumpable: only block grid cells for large rocks (s > 1.2). Small/medium rocks rely on circle collision only, which is Y-aware. Player can now jump over small stones.
- Tree leaves green: removed dark grass texture multiply, using clean green color (0x3a8a3a) with flatShading.
- Trees 2-cell margin from buildings (was 0). No more trees clipping through walls.
- Water system: semi-transparent blue plane at WATER_Y (-1.5). No trees or rocks placed below water level.
- Torches exclude door cells: torch candidates skip wall cells that are doors (isDoorCell check).

### Session 6 — Wall texture tiling, rock standing, leaf shadows
- Wall texture tiling fix: replaced stretched UV mapping on instanced wall BoxGeometry with world-space triplanar UVs via `onBeforeCompile`. Texture now tiles uniformly (0.5 tiles/unit) regardless of wall dimensions. Applied to both instanced walls (`buildWalls`) and ExtrudeGeometry window walls (`buildWindows`).
- Rock standing: player can now land and stand on top of rocks after jumping. Added `getRockSurfaceHeight()` to vegetation.js (checks if player is within rock's standing radius and near its top). Integrated into player.js gravity section. Rock colliders now store `height` field. Collision skip threshold changed from `entityY > top` to `entityY >= top - height * 0.3` so player isn't pushed off when standing on top.
- Tree leaf shadows: re-enabled `castShadow` on leaf cones (was disabled in Session 4). PCFSoftShadowMap handles edge softness, overlapping cone layers create natural shadow variation. Trunk shadows unchanged.
- Fixed tree semitransparency/flickering: removed `alphaHash` + `opacity` that caused visual dithering. Leaves are now fully opaque with soft shadows via PCFSoftShadowMap.
- Door panel collision rewritten: `collidesWithDoorPanel` now uses dynamic panel position based on `currentRotY` (tracks mid-swing), not just hardcoded open position. Added `getDoorPanelCenter()` helper. Now checks all doors where rotation != 0 (not just `door.open`).
- Door pushback system: added `getDoorPanelPushback()` in doors.js — pushes player away from swinging door panels to prevent getting stuck when door opens into player. Integrated into player.js update loop after rock pushback.
- Third-person camera wall collision: added raycast from look target toward desired camera position. If ray hits solid geometry, camera pulls in to 0.25 units before the hit point (min 0.5 from target). Skips transparent objects (glass/water) and the player model. Player always visible in 3rd person.

### Session 7 — Professional menu, softer leaf shadows, camera window fix
- Camera raycast now blocks on windows: removed transparent material skip from 3rd-person camera collision. Glass panes and all solid geometry block the camera.
- Softer leaf shadows: added shared `customDepthMaterial` (MeshDepthMaterial) to leaf cones. Uses `onBeforeCompile` to inject world-position hash that discards ~45% of shadow fragments. Creates dappled/lighter tree shadows without affecting leaf visual appearance. No flicker (world-space hash is stable).
- Professional main menu (`src/systems/menu.js`): procedurally generated 3D scene rendered behind transparent overlay. Randomized each page load.
  - Scene: U-shaped stone shelter with gable roof, doorway, interior torch with point light and emissive flame
  - Trees distributed across 3 zones: background (3-5, large), sides (2-3, medium), foreground (1-2)
  - Rocks scattered across 3 zones: open ground, near shelter, background
  - Soldier model loaded async, placed at shelter doorway with idle animation
  - Lighting: cool ambient + hemisphere fill, moonlight directional, warm torch point light
  - Camera parallax: mouse position shifts 3D camera ±0.5/0.3 units for depth effect
  - Single-surface CSS parallax: `#menu-panel` moves as one unit via translate on mousemove
  - Dark atmospheric fog (`0x060610`), shadow-casting on all geometry
- Menu panel: frosted glass card (`backdrop-filter: blur(12px)`) with gold typography, styled key badges, proper "Enter World" button with hover/active states
- Loading flow overhaul (`main.js`):
  - 3D menu scene renders immediately as undimmed background
  - Progress bar animates over menu scene while world builds (async yield between steps)
  - Menu panel appears after all assets loaded (models included)
  - "Enter World" button click: hides panel, shows brief loading transition, requests pointer lock
  - Pause state (ESC): semi-transparent overlay with "Click to Resume" text
- `controls.js`: blocker tracks `data-mode` ("game" after first play) for pause vs menu display
- `disposeMenu()` cleans up: removes mouse listener, disposes geometry/materials, resets CSS transforms
- Menu panel left-aligned: panel positioned on left side of screen (`justify-content: flex-start`, `padding-left: 5vw`) with vertical controls layout so 3D scene is visible on right
- Title split to two lines: "DARK" / "STRANDS" stacked via flex column spans for narrower panel
- Clear camera-to-soldier path: `isOnPath()` line-segment distance check with 2.5-unit half-width corridor. All trees and rocks retry placement up to 30 times to avoid the path
- Full-width bottom progress bar: `#menu-loading` moved outside blocker as fixed bottom element. Bar spans 100% screen width (20px thick) with gradient fill. Animated 0→100% with forced reflow reset on "Enter World" click. Text changes to "Entering world..." during transition
- Template-based menu scenes (`menu.js`): 5 distinct scene templates randomly chosen each load:
  - Shelter Night: U-shaped stone shelter with torch, soldier at doorway, night lighting
  - Lakeside: water plane, soldier or fox at water's edge, day or dawn lighting
  - Forest Fox: ring of trees around clearing, fox with Survey animation, day lighting
  - Rocky Day: cluster of large rocks, soldier or fox, bright day lighting
  - Campfire: ring of rocks with fire glow, soldier or fox facing fire, dark night
  - Each template defines its own lighting, fog, background color, camera position, and character (soldier/fox with random chance)
  - Shared builders (createTree, createRock, buildShelter) reused across templates
  - Path avoidance via `rndAvoid()` helper per template
- Key hints moved to right side: `#menu-keys` panel positioned fixed right with frosted glass background, separate from main menu panel
- HUD bottom bar hidden during menu: `#hud-bottom` starts hidden (`display:none`), shown only when game enters play mode

### Session 8 — Snow biome, deferred world build, no-duplicate menu scenes
- Snow biome toggle: checkbox in main menu panel, read before world builds. `CFG.SNOW_MODE` flag in config.js.
- Snow ground: `buildGround()` in geometry.js uses white/off-white material (`0xdde4e8`) instead of grass texture when snow mode active.
- Ice water: `buildWater()` in geometry.js uses opaque ice material (`0xb8d4e3`, low roughness) instead of transparent blue water in snow mode.
- Walkable ice: player.js clamps `groundY` to `CFG.WATER_Y` in snow mode — player walks on frozen water instead of falling through.
- Snow tree leaves: vegetation.js leaf color changes to off-white (`0xc8cdd0`) in snow mode instead of green.
- Deferred world building (`main.js`): world no longer builds during `init()`. Menu panel shows immediately. World builds when "Enter World" button clicked — snow toggle value read first, then `buildWorld()` runs with progress bar, then pointer lock requested.
- Snow in menu scenes (`menu.js`): 35% random chance of snow materials in menu 3D scene. `menuSnow` flag swaps `groundMat` to white, `leafMat` to off-white, lakeside water to opaque ice.
- No duplicate menu scenes: `lastTemplateIdx` stored in localStorage, persists across page reloads. `initMenuScene()` rerolls if same index picked.
- Fox campfire facing fixed: Fox uses `dirToFire` directly (faces +Z), Soldier uses `dirToFire + Math.PI` (faces -Z). Was using Soldier offset for both.
- Smooth camera toggle (player.js): V key now smoothly animates between 1st and 3rd person over 1 second using smoothstep. Both FP and TP positions computed every frame, blended via `camBlend` (0=FP, 1=TP). Position lerp + quaternion slerp. Player model fades in/out at blend threshold.
- Game start cinematic: game starts in 3rd person (`camBlend=1`) and smoothly animates to 1st person using the same 1-second transition.
- Progress bar freeze fix: `buildWorld()` now yields via double-`requestAnimationFrame` between each individual build step (was grouping 2-3 steps per yield). Smoother progress updates.
- Shelter template redesigned as interior scene: camera positioned inside shelter near back-left corner, soldier stands near torch on right wall, trees/rocks visible through doorway. Stone floor added inside. Cozy night interior feel with warm torch light.

### Session 9 — World-space door hint, underwater, zoom, stair/floor fixes
- Door `[E]` hint now follows door in world-space: projected via `Vector3.project()` to screen coordinates, moves with door as it swings. Uses `getDoorPanelCenter()` for position tracking. CSS changed from fixed bottom-center to transform-based positioning.
- Underwater effects: when camera submerged below `WATER_Y` (not in snow mode), movement slows to 40%, jump reduced to 50%, gravity reduced to 30% for floaty feel. Blue tint overlay (`#underwater-overlay`) shown over screen.
- Right-click zoom: holding right mouse button smoothly zooms FOV from 75 to 37.5 (2x) over 1 second using smoothstep. Releasing zooms back out. Context menu prevented. `isRightMouseDown()` exported from controls.js.
- Fixed minimap and HUD not showing: CSS `display:none` + `el.style.display = ''` was reverting to CSS default (none). Changed all HUD show logic to use explicit `display: 'block'`.
- Crosshair now always visible in both 1st and 3rd person view.
- Third-person camera pitch: camera now orbits vertically using pitch (clamped -0.6 to 0.8), allowing look up/down in 3rd person. Horizontal distance and height offset adjust with pitch for natural orbit.
- Pause overlay styled: `#menu-pause` now has dark semi-transparent background (`rgba(0,0,0,0.6)`), padding, border-radius, and backdrop blur for contrast.
- Stair walk-under fix: `getFloorHeight()` now checks `currentY` before applying stair ramp. If player is well below the ramp surface (>1.5 units below), stair height is ignored — prevents teleporting to upper floor by walking under stairs.
- 2nd floor thickness: replaced PlaneGeometry with BoxGeometry (0.25 units thick). Floors now cast shadows and have visible depth.
- 2nd floor full coverage: floor pieces extend into wall geometry (wall center to wall center) instead of stopping at interior cell edges. No visible gaps between floor and walls.
- Menu character A/D reversed: fixed `camRight` vector calculation (was negated, causing left/right swap). Changed from `(camFwd.z, 0, -camFwd.x)` to `(-camFwd.z, 0, camFwd.x)`.
- Menu invisible walls: character can't move outside camera visible area. Uses `Vector3.project()` to check if new position is within camera NDC bounds (±0.9 x, ±0.85 y). Works for all templates without hardcoded bounds. Replaces old ±18 ground boundary clamp.

### Session 10 — Soldier talk, wood stairs, camera/fog/NPC fixes
- Soldier `[E] Talk` interaction: 20 pre-written dialogue lines (neutral/humorous), speech bubble appears above soldier for 3.5s, hint tracks soldier in world-space via `Vector3.project()`. Source-tagged hints (`el.dataset.source`) prevent door/soldier hint conflicts. `controls.js` E handler tries doors first, then soldiers.
- `updateSoldierHint()` wired into game loop after `updateDoorHint()`.
- Wood texture for stairs: downloaded `wood_planks.jpg` from Poly Haven (CC0), applied to stair steps via dedicated `stairMat` material instead of stone floor material.
- Fixed indoor fog: removed `indoorFogBlend` system that pushed fog distances to infinity when inside buildings (caused infinite view distance when looking outside from indoors). Linear fog with near=20 is sufficient to avoid noticeable indoor fog.
- Fixed third-person camera ground sliding: clamped desired camera Y to at least `state.y + 0.5` so camera can't go below player feet when looking up.
- Improved soldier obstacle avoidance: soldiers now stop and briefly idle (0.5-1.5s) when blocked instead of continuously trying to slide. Direct position updates instead of double-checking via `moveNpc` for consistent collision.

### Session 11 — Flower pickup, hotbar, minimap, NPC/stair polish
- Soldier dialogue expanded from 20 to 100 lines across 5 categories: atmospheric/lore, guard duty, casual/humorous, philosophical, warnings.
- Soldier `[E] Talk` hint font reduced to 21px (half of door hint 42px). Speech bubble now projects from `pos.y + 1.8` (above head, not mid-body). Speech bubble `white-space: nowrap` removed so long messages wrap within 300px background.
- Player model blue tint strengthened (`0.5, 0.55, 1.0`). NPC soldiers get green tint (`0.7, 1.0, 0.75`). Menu soldiers get random hue tint each load. Foxes untinted.
- Stronger fog: day near=10/far=55, night near=5/far=30 (was 20/90 and 10/50).
- Torch placement skips stair cells (`isStairCell` check) — no more torches floating above staircases.
- Stairs flush against wall: shifted stair X position so right edge meets wall inner face (was centered with gap).
- Fixed model frustum culling: disabled `frustumCulled` on all model clones (soldiers, foxes, flowers). `SkeletonUtils.clone()` doesn't preserve the property from base model.
- Right-click zoom: increased to 3x (FOV 75→25), 2x faster (0.5s instead of 1s).
- Pause/unpause responsiveness: switched blocker from `click` to `mousedown` event for faster pointer lock re-acquisition.
- **Flower pickup system** (`src/world/flowers.js`): E key picks nearby flowers (priority: doors > soldiers > flowers). Picked flowers disappear, increment inventory counter. Respawn after 15-30s at random position far from player (>40 units) and outside camera frustum (NDC check). Total flower count stays constant.
- Flower count doubled from 25 to 50 for easier discovery.
- **Hotbar HUD**: 5-slot hotbar at bottom center of screen. Slot 0 shows flower icon + count when flowers are picked. Empty slots rendered as dark translucent squares with subtle borders.
- Flowers shown as cyan dots on minimap. 2-story buildings shown in lighter brown (`#4a3a2a`) vs 1-story (`#3a2a1a`).

### Session 12 — Day/night cycle overhaul, door torches, pause fix
- **Day/night cycle fixed**: checkbox initial value was never read — only a `change` listener was set up. Added `setCycleEnabled(dnCheckbox.checked)` on world build.
- **Realistic 24-hour cycle**: replaced raw sine curve with biome-aware `calcSunH()` function. Summer (normal): sunrise 05:00, sunset 21:00 (16h day, 8h night). Winter (snow biome): sunrise 08:00, sunset 16:00 (8h day, 16h night). Game starts at 08:00.
- **Sun orbit**: sun now arcs across the sky during daytime using directional light position updates. Moves below horizon at night.
- **Door torches** (`placeDoorTorches` in `torches.js`): exterior torch placed beside every door on the wall outside. Position uses building exterior face (not cell center offset) to avoid spawning inside corner walls. Automatically picks the adjacent solid wall side. Flame/light gradually fade in at dusk, off during day.
- **Gradual dusk/dawn**: widened sky color transition band (sunH 0.4 → -0.2) with smoothstep interpolation. Fog, stars, and door torches all transition gradually instead of hard-switching at sunrise/sunset.
- **Q key fast-forward**: hold Q to run game at 3× speed — affects movement, animations, NPC AI, day/night cycle, timers, everything.
- **Pause/unpause improved**: removed broken `setInterval` retry (timer callbacks aren't user gestures). Added `pendingLockEl` that auto-sets when pointer lock is lost during game. Any mousedown or any key press while paused retries pointer lock. Pause text: "Click or press any key to resume".
