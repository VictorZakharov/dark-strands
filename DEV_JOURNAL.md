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

## 2026-02-15

- **In-game help overlay**: added SHIFT+? toggle for a comprehensive "Survival Guide" overlay with 5 themed sections (Movement & Combat, Exploration, Interaction, Day & Night, Camera & HUD) presented as hoverable cards with gold/dark aesthetic matching the game's frosted-glass UI
- Help overlay freezes game loop and mouse look while open; auto-closes on ESC (pointer lock loss)
- Added `SHIFT+?` shortcut to bottom HUD hint bar and right-side menu key hints
- Styled with fade-in animation, scrollable content area, key badges matching existing `.key` style, section icons, and hover effects on cards
- Help overlay releases pointer lock for visible mouse cursor; re-locks on close
- **Camera toggle jerk fix**: pressing V mid-transition no longer snaps the blend back to start. `toggleCamera()` now uses `inverseSmoothstep()` to compute the correct starting time from the current blend position, so rapid V presses produce smooth reversals
- **ESC closes help overlay**: ESC no longer calls `requestPointerLock()` (browser blocks it from ESC key — caused SecurityError). Instead closes help and sets `pendingLockEl` so the next click or keypress re-enters the game seamlessly. No pause screen.
- **Crosshair fully fixed across camera modes**: TP camera now converges on the same world point as FP (`_tpLookAt = _fpLookAt`) — both cameras aim at the same target from different positions (like over-the-shoulder shooters). Eliminates vertical drop AND horizontal drift during blend. Wall collision raycast origin moved from `_tpLookAt` to `_fpPos` (player eye).
- **Look direction preserved on 3→1 toggle**: removed forced `pitch = 0` / `yaw = facingAngle` reset from `toggleCamera()`. View direction now carries over seamlessly between camera modes.
- **SecurityError fix**: browsers block `requestPointerLock()` from ESC keydown. Added `e.code !== 'Escape'` guard to the "any key while paused" handler so ESC never triggers a doomed requestPointerLock call.
- **Wooden house floors**: ground floors now use `wood_planks.jpg` texture instead of stone. Floor dimensions expanded from `(w-2)*CELL` to `(w-1)*CELL - WALL_T` to fill wall-to-wall (inner face of thin walls), eliminating visible gaps at edges.
- **Interior torches repositioned**: `wallOffset` changed from hardcoded `0.85` to `CFG.CELL - CFG.WALL_T/2 - 0.1` (= 1.55) so torches sit flush against actual wall surface instead of floating in air.
- **Crosshair distant-object drift**: pushed convergence point from 10 to 200 units in `_fpLookAt` calculation. Both cameras now aim at a point far enough that parallax from the shoulder offset is negligible at any gameplay distance.
- **Light under walls sealed**: walls now extend 0.5 units below terrain height (`ty - ext`) to eliminate gap between wall bottom and floor. Prevents sun/ambient light leaking underneath.
- **SecurityError fully eliminated**: added `tryLock()` wrapper that catches rejected `requestPointerLock()` promises. All 6 call sites in controls.js + 1 in main.js now use the wrapper or inline `.catch()`. No more console errors on ESC→click resume.
- **Angled interior torches**: sticks now tilt 30 degrees away from the wall (π/6 radians). Flame and light repositioned at the angled tip. Rotation axis chosen based on wall direction (Z for E/W walls, X for N/S walls). More realistic mounting and better room illumination spread.
- **Wall/roof light leaks fully fixed**: walls now use a fixed Y baseline (bottom=-0.5, top=h) instead of per-cell terrain height. All wall segments in a building have identical top height → no gaps between segments. Wall tops match roof `topY = stories * WALL_H` exactly → no gaps at roof junction. Window walls and doors also use fixed Y=0 baseline.
- **Zero crosshair drift**: replaced lookAt lerp with direct computation `lookAt = cameraPos + fpFwd * 10`. Camera always looks in exactly the `fpFwd` direction regardless of blend position. Mathematically zero parallax — no drift on near or far objects.
- **Crosshair convergence fix**: changed lookAt target from `cameraPos + fpFwd*10` (zero angular drift but visible parallax) to `_fpPos + fpFwd*50` (fixed convergence point from FP eye). The camera now aims at the same world point throughout the transition, eliminating perceived parallax drift at typical gameplay distances.
- **Player model always visible**: removed `playerModel.visible = camBlend > 0.15` condition. Model now always renders (even in first person) so it casts shadows and is visible when looking at own feet.
- **Window wall light leak sealed**: extended window wall ExtrudeGeometry shape from y=0 down to y=-0.5, matching the -0.5 baseline of regular InstancedMesh walls. Eliminates light leaking between window wall segments and adjacent regular walls.
- **Ground floor solid slab**: replaced paper-thin PlaneGeometry floor with a 0.6-unit thick BoxGeometry slab (top at 0.02, bottom at -0.58). Slab extends into perimeter walls to physically seal all light paths at the base. Floor width expanded to `(b.w-1)*CELL` to overlap wall geometry.
- **Player model scaled to PLAYER_H**: model now matches camera eye height (1.7 units) instead of the old 0.6 scale. Camera sits at the model's crown; near clip plane (0.1) clips the head geometry. Looking down shows body and feet.
- **FP model orientation**: in first person (camBlend < 0.05), model faces camera direction (`state.yaw`) instead of movement direction, so looking down shows the body's front instead of back/side.
- **Player model scale reverted** to 0.6 (original) — scaled-up model looked wrong.
- **Camera corner clipping fix**: replaced single-ray wall collision with 3-ray probe system (center + left/right at 0.6 offset). Lateral rays catch perpendicular walls at building corners that the center ray misses. Hit distances projected onto main ray direction for accurate pullback. PULL_BACK increased from 0.25 to 0.4.
- **Light under walls root cause found**: floor slab at `(b.w-1)*CELL` only reached perimeter wall cell centers, leaving exposed grass at corners where walls are full CELL×CELL blocks. Changed to `b.w*CELL` — slab now covers the entire building footprint including under all walls, sealing every light path at the base.
- **FP model visibility via layers**: player model on layer 1 only. Main camera enables/disables layer 1 based on camBlend (hidden in FP, visible in TP). Shadow map always renders it for shadow casting. Eliminates "mech simulator" view of model internals in first person while preserving player shadow.
- **Crosshair raycast convergence**: on V toggle, casts ray to find what the crosshair is pointing at and uses that hit distance as the convergence point. Camera rotates during transition to keep the crosshair locked on the exact object being looked at. Replaces fixed 50-unit convergence. Falls back to 30 units if nothing is hit.
- **Unified convergence for both toggle directions**: removed slerp branch for 3→1 transitions. Both 1→3 and 3→1 now use the same `lookAt = _fpPos + fpFwd * convergenceDist` formula. For 1→3: convergenceDist from raycast hit. For 3→1: convergenceDist from closest-point-on-two-rays formula (finds D where the convergence point seen from TP position matches the camera's current aim direction). Eliminates crosshair drift in both directions.
- **Dynamic per-frame convergence for 3→1**: fixed shoulder-offset parallax causing ~4.5° lateral crosshair drift during 3P→1P transitions. Root cause: the convergence point `_fpPos + fpFwd * D` is viewed at different angles from the TP camera (offset right+up+back) vs FP camera. Fix: on 3→1 toggle, raycast from actual TP camera to find the world point the crosshair was on (`_crosshairTarget`). During each transition frame, dynamically recompute D using closest-point-on-two-rays between the fpFwd ray and the direction from current camera position to `_crosshairTarget`. This adjusts D per-frame so the lookAt point tracks the actual world target as the camera moves. Falls back to static convergenceDist when camBlend < 0.05 (direction ≈ fpFwd regardless of D).
- **World-target lookAt for 3→1**: replaced dynamic-D per-frame convergence (numerically unstable for near-parallel rays) with direct `camera.lookAt(_crosshairTarget)` during transition. Camera tracks the exact world point throughout, naturally absorbing parallax. At transition end, yaw/pitch corrected to match final direction. Mid-transition V toggle applies correction immediately.
- **Mouse rotation during 3→1 transition**: fixed camera orbiting around fixed world target when moving mouse during 3→1 transition. Root cause: `lookAt(_crosshairTarget)` ignored yaw/pitch changes from mouse input while camera position still followed them. Fix: decompose target offset into player-local coordinates (right, up, fwd) at toggle time using `_targetLocal`. Each transition frame, reconstruct `_crosshairTarget` from local coords using current yaw/pitch basis vectors. Target now rotates naturally with mouse movement while still absorbing shoulder-offset parallax. End-of-transition correction uses direct `state.yaw = yawToH` assignment instead of delta (avoids double-counting mouse deltas). Mid-transition toggle preserves view via `_lastCamFwd`. Removed diagnostic console.log statements.
- **Snow biome dark morning fix**: winter sunrise is 08:00 but game also started at 08:00, so `calcSunH()` returned 0 (horizon) — sky was dark. Added `setStartTime()` to daynight.js; snow biome now starts at 10:00 (sunH ≈ 0.71, bright daylight).
- **Rock pickup system** (`vegetation.js`): small rocks (size ≤ 0.7) can be picked up with E key. `getNearestPickableRock()` finds closest small rock within 2.5 units. Picked rocks hide mesh and set `active=false` (removed from collision). `[E] Pick up` hint shown in world-space near pickable rocks (lowest priority after door/soldier/flower hints). Added `active` guard to `collidesWithRock()`, `getRockPushback()`, `getRockSurfaceHeight()` so picked rocks are fully inert.
- **Stone inventory**: `inventory` object in flowers.js extended with `stones: 0` counter. Picking a rock increments `inventory.stones`.
- **Hotbar slot selection** (`src/systems/hotbar.js` — new file): 5-slot hotbar with slot-to-item mapping (`slotItems = ['flower', 'stone', null, null, null]`). Number keys 1-5 select slots. `ITEM_META` maps item types to inventory keys and emoji icons. Selected slot highlighted with gold border and glow CSS.
- **Stone throwing** (`src/systems/projectiles.js` — new file): left-click with stone slot selected spawns a DodecahedronGeometry projectile with rock texture. Euler integration physics with gravity (15 m/s²), spin for visual flair. Stones arc forward from camera direction, land on terrain and stay as static decoration. Out-of-bounds cleanup.
- **Flower planting** (`flowers.js`): left-click with flower slot toggles placement mode. Preview is a real flower model clone with transparent materials (opacity 0.6) tinted green (valid) or red (invalid). Iterative ground-plane intersection (3 iterations for terrain curvature). Validates: not inside building, not underwater, walkable cell, no rock overlap, within 15 units. Planted flowers become real pickable flowers registered on minimap.
- **Flower template system** (`modelLoader.js`): after normalizing flower model, calls `setFlowerTemplate(model)` to store a reference for planting clones. `initFlowerPreview(scene)` creates the transparent preview mesh from this template.
- **ALT+drag hotbar reordering** (`hotbar.js`, `controls.js`): holding ALT releases pointer lock and enables mouse cursor over hotbar. Drag items between slots — occupied slots swap on mouseup. Visual feedback: dragging slot dims (opacity 0.5), hover target gets blue glow. Releasing ALT re-locks pointer and resumes gameplay. `pointerlockchange` handler skips pause overlay during ALT mode.
- **Dynamic HUD inventory** (`hud.js`): `updateInventory()` uses `getSlotItem(i)` and `ITEM_META` for fully dynamic slot rendering — shows emoji icon + count for occupied slots, number label for empty slots. Adapts automatically when slots are reordered via drag-and-drop.
- **Config constants** (`config.js`): added `ROCK_PICK_DIST` (2.5), `ROCK_PICK_MAX_SIZE` (0.7), `THROW_SPEED` (18), `THROW_GRAV` (15), `THROWN_STONE_SIZE` (0.25), `PLANT_MAX_DIST` (15).

### Session 13 — Item system refinements, shadow fix, rock physics, shader precompile
- **Shadow direction fix** (`daynight.js`, `player.js`): shadows no longer change angle when player moves. Daynight.js now exports `getSunOffset()` (sun direction vector) instead of directly setting `sunLight.position`. Player.js positions both `sunLight.position` and `sunLight.target` using the offset + player position — direction stays constant relative to the sun.
- **Thrown stone size** increased from 0.25 to 0.35, added +4 upward velocity bias for a more visible arc.
- **Thrown rocks become pickable**: landed stones register as pickable rocks via `registerPickableRock()` — thrown rocks can be picked up and re-thrown.
- **Dynamic inventory slots** (`hotbar.js`): `slotItems` starts empty `[null, null, null, null, null]`. Items assigned to active slot on first pickup via `addItemToSlot(itemType)`. If active slot occupied, wraps around to find next empty. `clearItemSlot(itemType)` removes mapping when count hits 0.
- **Rock collision and bounce** (`projectiles.js`): stones bounce off walls/buildings/trees (grid-based per-axis reflection) and rock colliders (pushback-normal reflection). Coefficient of restitution = 0.5. Saves old position for revert on collision.
- **Rock icon fix**: replaced 🪨 (U+1FAA8, Emoji 13.0 — not rendered on Windows 10) with ◆ (U+25C6, universally supported). Added `color: #c0a878` to `.slot-icon` CSS.
- **Placement mode state machine refined**: key press enters/toggles placement, left-click also enters (second left-click plants), pickup always clears, slot switch clears, pointer lock loss clears. `selectSlot()` has 3 branches: same slot + active → toggle off, same slot + flower → enter, different slot → switch + clear.
- **Shader precompile** (`main.js`): added `renderer.compile(scene, camera)` after `initFlowerPreview()` during world build. Pre-compiles all material shaders (including transparent flower preview) to eliminate 1-second stutter on first placement mode activation.

### Session 14 — Torch system, sun disc, crosshair hints, window frames
- **Torch pickup** (`torches.js`, `controls.js`): both interior and door torches can be picked up with E key. `pickableTorches` array tracks all torches. Picked torches hide mesh and use `light.visible = false` (overrides daynight intensity updates). Added `TORCH_PICK_DIST: 3` to config.
- **Held torch** (`torches.js`): equipping torch slot + left-click shows a torch in hand with PointLight (intensity 2, range 15). Upright orientation with subtle tilt. Light at flame tip. 3rd person view positions torch relative to player model instead of camera.
- **Torch placement** (`torches.js`): left-click while torch equipped places torch on walls or ground. Ray-march from camera detects wall hits (walkable→non-walkable transition with per-axis normal detection) and ground hits. Wall torches angle 30° from surface, ground torches stand vertical. Placed torches register as pickable (re-pickable).
- **Torch preview** (`torches.js`): transparent green ghost torch shows where placement will happen. Always visible while torch is equipped. Shows at walls and ground within 6 units. Torch count decremented on place, slot cleared when empty.
- **Crosshair-based interact hints** (`main.js`): replaced fixed-priority hint system (door > soldier > flower > rock) with unified `updateInteractHint(camera)`. Projects all nearby interactables to screen space, picks closest to crosshair center. E key reads `interact-hint.dataset.source` for consistent behavior.
- **Shader precompile enhanced** (`main.js`): temporarily shows all hidden meshes during `renderer.compile()` so torch preview and held torch materials get compiled too. Eliminates stutter on first equip.
- **Rock throwing fix** (`projectiles.js`): stones aimed at buildings were instantly removed. Root cause: out-of-bounds check used world center (CFG.HALF=80) as reference, but player could be far from center. Fixed to use spawn position + 200 unit radius. Also spawn at camera position (guaranteed walkable) instead of offset forward.
- **Sun disc in sky** (`lighting.js`, `daynight.js`): added visible sun sphere (MeshBasicMaterial, radius 6) that tracks the directional light direction at R=170 from player. Color shifts warm near horizon. Fades out at night. Matches water reflection.
- **Wooden window frames** (`geometry.js`): 4 wooden bars (bark texture, brown tint) around each window opening. Frame extends slightly past wall surface on both sides for visibility from inside and outside. Uses BoxGeometry bars at window edges.
- **Window frame z-fighting fix** (`geometry.js`): added `polygonOffset` to frame material to prevent flickering against co-planar wall geometry.
- **Torch pickup freeze fix** (`torches.js`, `daynight.js`): toggling `light.visible` changed PointLight count, triggering full shader recompile (~5 seconds). Fix: keep all lights always visible, toggle via `intensity = 0`. Picked lights marked with `userData.picked` so daynight.js skips them. Held torch light created with `intensity: 0` (always counted in light total).
- **Sun glow and lensflare** (`lighting.js`): replaced plain sphere with layered glowing sun — bright core sphere + inner additive glow sprite (30 units) + outer corona sprite (60 units). Added Three.js Lensflare addon with 6 procedurally-generated flare elements (glow textures + ring textures via canvas radial gradients). Solar flare visible when looking at sun.
- **Torch wall placement gap fix** (`torches.js`): mount point now uses midpoint between last walkable and first non-walkable ray-march position, placing torch flush against wall surface instead of leaving a gap.
- **Three.js localized**: installed `three@0.162.0` via npm. Importmap updated from CDN URLs to local `./node_modules/three/` paths. No internet dependency.

### Session 15 — Enhanced campfire, torch particles, light pool, fixes
- **Procedural campfire overhaul** (`menu.js`): replaced minimal single-sphere campfire with rich multi-element scene. Now includes: 10-rock ring (varied sizes), 3 crossed bark-textured logs, charred ground disc, 5 layered fire sprites (additive blending, canvas-generated gradient textures), glowing ember core mesh, 12 floating ember particles, warm ground glow disc, dual lights (main + fill uplight).
- **Campfire animation** (`menu.js`): fire sprites flicker, sway, and pulse per-frame using sine waves with varied phase/speed. Ember particles float upward with random wind wobble, fade out, and respawn at fire base. Main light intensity flickers with layered sine waves for realistic firelight. All animation driven by `dt` in `renderMenu()`.
- **Torch placement freeze fix** (`torches.js`): placing torches created new PointLights, changing light count and triggering full shader recompile (~5 seconds). Fix: pre-allocate a pool of 20 PointLights at init (all intensity 0). Placed torches acquire from pool; picked-up pooled torches release back. World-gen torches still use direct lights (count stable after init).
- **Torch ember particles** (`torches.js`, `main.js`): 3 ember sprites per torch — float upward with wind wobble, fade out, respawn at flame. Distance-culled at 30 units from player. Canvas-generated gradient texture with additive blending. New torches from placement also get embers via `addTorchEmbers()`.
- **Ground torch hint position** (`main.js`): hint now uses actual flame Y position + 0.35 offset instead of fixed y=2.8, so ground torch hints appear above the flame rather than floating too high.
- **Pause resume camera jerk fix** (`controls.js`): first `mousemove` after pointer lock re-acquisition often has large junk delta values from the click. Added `skipNextMove` flag — set true on lock, clears and skips the first move event.

### Session 16 — Building geometry, door knobs, torch placement, interact hints
- **Flush building corners** (`geometry.js`): corner wall cells changed from CELL×CELL to WALL_T×WALL_T with `isThinPost()` helper detecting both inner corners (facesNS && facesEW) and outer corners (!facesNS && !facesEW). Adjacent wall segments extend toward thin posts by `(CELL - WALL_T)/2` to fill gaps without protrusion.
- **Outer corner gap fix** (`geometry.js`): thin post cells extend toward non-walkable neighbors to fill gaps at building corners near doorways.
- **Foundation inset** (`geometry.js`): floor sizing changed from `b.w * CFG.CELL` to `(b.w - 1) * CFG.CELL + CFG.WALL_T - 0.06`, insetting 0.03 per side inside walls. Eliminates foundation protrusion and z-fighting flicker.
- **Above-door wall blocks** (`geometry.js`): added wall fill between door top (WALL_H × 0.88) and ceiling/second floor for all buildings, not just 2-story. Eliminates gap above doors.
- **Door knobs** (`doors.js`): added metallic spheres (SphereGeometry r=0.12) on both sides of each door at 50% height, 85% toward opening edge. MeshStandardMaterial with metalness 0.8, roughness 0.3.
- **Torch wall snap fix** (`torches.js`): placed torch mount point now snaps to wall cell center via `g2w` + `CFG.CELL/2 - CFG.WALL_T/2 - 0.1` instead of ray midpoint, eliminating air gap between torch and wall.
- **Corner torch rejection** (`torches.js`): torch placement returns null when both hitX and hitZ are true (corner cell), preventing torches from appearing inside walls.
- **Door torch wall mount** (`torches.js`): rewrote door torch placement to use proper wall-mount geometry with TILT angle (π/6), flush with adjacent wall surface using `sideOff = CFG.CELL - CFG.WALL_T/2 - 0.1`. Fixed inverted normals for all four wall directions.
- **Door torch window avoidance** (`torches.js`): added `isWindowCell()` checks to door torch side selection so torches prefer the side without a window.
- **Unified interact hint clamping** (`main.js`): all interact hints (door, soldier, flower, rock, torch) now clamp to viewport bounds, staying above the hotbar (bottom 110px). When clamped, hint positions at midpoint between crosshair and clamp line.
- **Smooth hint interpolation** (`main.js`): hint position lerps toward target each frame (18% per frame) instead of snapping, eliminating jerky transitions when crossing the clamp boundary.
- **Soldier hint cleanup** (`npcAI.js`): removed redundant soldier hint positioning from `updateSoldierHint()` — now handled entirely by unified `updateInteractHint()` in main.js. Speech bubble clamping retained.
- **Virtual cursor ALT mode** (`hotbar.js`, `controls.js`, `main.js`): rewrote ALT mode to keep pointer lock active. Hold ALT to show a virtual cursor (gold circle) driven by `movementX/Y`. Cursor interacts with hotbar slots via `getBoundingClientRect()` hit-testing. Release ALT to resume game. All game inputs (WASD, E, V, number keys, left-click actions) blocked during ALT mode.
- **Greyscale transition** (`main.js`): game canvas desaturates to 85% greyscale during ALT mode via CSS `saturate()` filter. Smooth 0.5s transition in both directions using `altBlend` lerp.
- **Hotbar glow in ALT mode** (`styles.css`, `hotbar.js`): hotbar slots pulsate with golden glow (1.2s cycle, `hotbar-pulse` keyframe animation) when ALT mode is active. `alt-active` class toggled on `#hotbar`.
- **Drag placeholder with virtual cursor** (`hotbar.js`): drag-and-drop uses virtual cursor — mousedown on occupied slot starts drag, shows a semi-transparent placeholder icon following the cursor, mouseup on different slot swaps items. Virtual cursor hides during drag, reappears on release.
- **Rock SVG icon** (`hotbar.js`, `hud.js`): replaced ◆ (U+25C6) with inline SVG rock icon — irregular polygon with two-tone fill and crack lines. HUD renders SVG icons via `svg:` prefix in `ITEM_META`. Drag placeholder also uses SVG version (36px).
- **In-game guide updated** (`index.html`): added cards for rocks, torches, and flower planting. Updated hotbar card with virtual cursor ALT mode description.

## 2026-02-16

- **Mobile touch controls** (`touch.js`, `controls.js`, `main.js`, `index.html`, `styles.css`): full touch input system for mobile devices. Detects touch via `'ontouchstart' in window`. Virtual joystick on left 40% of screen for WASD movement (threshold-based, 50px radius, shows ring + knob at touch point). Camera look-drag on right 60% (delta-based with sensitivity 0.004, multi-touch ID tracking). Three action buttons (Jump, E, Use) positioned bottom-right. Hotbar slot tap-to-select via `closest('.hotbar-slot')`.
- **Mobile game flow** (`controls.js`, `main.js`): bypasses pointer lock on touch devices. "Enter World" button calls `setMobileGameActive(true)` instead of `requestPointerLock()`. `isGameActive()` export gates game loop (returns `pointerLocked || isMobileGameActive()`). Blocker tap-to-resume for pause screen on mobile.
- **Extracted interact/use logic** (`controls.js`): `doInteract()` and `doUseItem()` extracted as exported functions from inline E-key and left-click handlers. Called from both keyboard events (desktop) and touch consume checks (mobile) in game loop.
- **Mobile CSS** (`styles.css`): touch joystick ring (120px) and knob (50px), action buttons (56px circles, semi-transparent), active state glow. `@media (hover: none) and (pointer: coarse)` hides keyboard hint bar and menu key panel, adjusts hotbar sizing. `touch-action: none` on body prevents browser gestures. Help content retains `touch-action: pan-y` for scrolling.
- **Mobile UI responsive** (`styles.css`, `index.html`): comprehensive mobile media query overrides. Menu panel centered with smaller padding/fonts (32px title, 340px max-width). Larger tap targets — checkboxes 20px, "Enter World" button 48px min-height. Minimap shrunk to 100x100px. Interact hint font reduced to 24px. Hotbar slots 46px with pointer-events enabled. NPC speech constrained to 240px. Loading screen text scaled. Extra-small (< 400px) breakpoint for very narrow phones.
- **Mobile pause and help buttons** (`touch.js`, `index.html`, `styles.css`): pause button (||) and help button (?) in top-left corner of touch controls. Pause sets `gameActive = false`, shows blocker with mobile-friendly "Tap to Resume" text. Help toggles the survival guide overlay. HUD top-left info shifted down to avoid overlap with buttons.
- **Mobile survival guide** (`index.html`, `styles.css`): separate touch-specific in-game guide shown on mobile devices (`.help-mobile` / `.help-desktop` CSS toggle). Describes virtual joystick, look-swipe, long-press interaction, hotbar tap-to-select, pause and help buttons. Desktop guide unchanged. Full-screen layout on mobile with tap-to-close button. Crosshair hidden on mobile.
- **Long-press interaction** (`touch.js`, `main.js`, `index.html`, `styles.css`): replaced E button on mobile with long-press mechanic. When near an interactable, hold still on the right side for 1 second to interact. SVG progress ring (r=34, conic stroke-dashoffset animation) fills over the hold duration with action word inside ("Open", "Talk", "Pick", etc.). Cancels if finger moves >12px. Mobile hint text changed from `[E] Action` to `Hold to Action`. Progress ring centered on screen, updated each frame via `updateTouchProgress()`.
- **Flowers blocked from buildings** (`grid.js`, `generator.js`): added `indoorCells` set in grid.js. `markIndoor()` called for all cells within building bounds during generation. `randomWalkablePos()` skips indoor cells, preventing flowers, rocks, and NPCs from spawning inside buildings.
- **Held torch transition fix** (`torches.js`, `player.js`): torch no longer jumps to camera during 3→1 person transition. Uses `getCamBlend() > 0.01` instead of boolean `firstPerson` check — torch stays on soldier model until camera blend completes. Added `getCamBlend()` export from player.js.
- **Crosshair-accurate placement in 3rd person** (`torches.js`, `flowers.js`): torch and flower placement now cast rays from camera world position (matches crosshair exactly) but measure distances from player position for consistent range limits. Loop extends to t=12/20 to account for camera-to-player distance in 3rd person.
- **Rock throwing 3rd person fix** (`projectiles.js`): stones now spawn from player eye position instead of camera position. Throw direction computed from player eye toward crosshair target (50 units along camera ray). Prevents visual "switch to 1st person" artifact when throwing in 3rd person.
- **Camera toggle button** (`touch.js`, `index.html`, `styles.css`): added CAM button to mobile touch controls for toggling 1st/3rd person view.
- **Simulated cursor pause** (`controls.js`, `styles.css`): ESC now enters "sim-pause" with virtual cursor instead of full pause. Game freezes with dark overlay, simulated cursor follows mouse (OS cursor hidden via CSS). Click or any key to resume instantly — game starts before pointer lock is reacquired, using `movementX/Y` for camera control in the interim. Eliminates the 1.5s Windows pointer lock cooldown delay. Press ESC again during sim-pause for real mouse cursor (full pause with blocker). Three states: simPause (frozen, virtual cursor), resuming (game active, hidden cursor, waiting for pointer lock), full pause (real cursor, blocker visible).
- **Stone/rock visual distinction** (`vegetation.js`, `config.js`): split rocks into throwable pebbles (fixed size 0.2, 15 spawned) and environment rocks (0.6–2.5, 50 spawned). Pebbles match thrown stone size exactly. Env rocks are clearly bigger (3x+ diameter minimum). `ROCK_PICK_MAX_SIZE` reduced to 0.3 so only pebbles can be picked up. `THROWN_STONE_SIZE` reduced to 0.2 to match pebbles.

## 2026-02-17

- **Tab pause replaces ESC** (`controls.js`): pause key changed from ESC to Tab. Tab keeps pointer lock active so the mouse is fully trapped — no browser-forced release, no re-lock dance, no camera jerk. Virtual cursor driven by `movementX/Y` while pointer lock remains active. ESC during Tab-pause releases pointer lock for real (enter `released` state with OS cursor visible). ESC during gameplay also enters released state (browser forces lock release). Click or any key from either pause state resumes game.
- **Simplified pause state machine** (`controls.js`): removed `startRelock()`/`stopRelock()` timer, `resuming` state, and `released` flag. ESC during gameplay just frees the cursor — game keeps running, no pause screen. Only Tab pauses (pointer lock active, virtual cursor, game frozen). ESC during Tab-pause releases pointer lock and shows "Click to resume" overlay. `gameStarted` flag tracks whether game has begun. `isGameActive()` = `gameStarted && !simPause`.
- **Timestamp-based mousemove ignore** (`controls.js`): replaced `skipNextMove` boolean with `moveIgnoreUntil` timestamp. `ignoreMovesFor(150)` called on ESC release and pointer lock changes. Skips ALL mousemove events for 150ms — prevents camera jerk from junk deltas.
- **Loading bar proportional** (`main.js`): batched 16 yieldFrame calls into 5 groups. Percentages match actual time: fast steps 0-18%, GPU render 18-100%. After GPU render, bar animates to 100% with 0.35s ease-out, then waits 400ms so user sees completion before entering game.
- **Removed loading console.logs** (`main.js`): cleaned up all `[flow]` and `[load]` timing logs. Removed `firstRender` flag.
- **Updated UI for Tab pause** (`index.html`, `CLAUDE.md`): menu key hints, HUD bottom bar, and in-game survival guide all updated from ESC to Tab for pause. Desktop guide gets new "Pause" card explaining Tab/ESC behavior.
- **Pause key added** (`controls.js`): keyboard Pause key works as alternative to Tab for pausing.
- **Removed camera save/restore** (`controls.js`, `main.js`): the savedYaw/savedPitch mechanism was causing the camera jerk on ESC — it snapped the camera back to the last frame's orientation, losing recent mouse movement. Removed entirely. `ignoreMovesFor(150)` alone handles post-transition junk deltas.
- **ESC frees cursor without pause** (`controls.js`): ESC during gameplay releases pointer lock but game keeps running. No pause overlay, no camera snap. Click canvas to re-lock.

## 2026-02-18

- **Mid-floor gap fix** (`geometry.js`): added Piece 3 (right of stairwell, full depth) and Piece 4 (behind stairwell, stair column width) to `buildFloors()` for 2-story buildings. Floor no longer has visible holes near stairs.
- **Torch placement on rocks blocked** (`torches.js`): `findPlacementTarget()` now checks `collidesWithRock()` for ground placement — torches can't be placed inside rock geometry.
- **Torch placement on doors blocked** (`torches.js`): `findPlacementTarget()` rejects door cells (`isDoorCell` check) so torches can't be placed on doors that would float when opened.
- **Torch placement above roof blocked** (`torches.js`, `generator.js`): added `getWallHeightAt()` to generator.js. Wall torch placement rejects positions where Y exceeds the building's wall height, preventing torches from disappearing above rooflines.
- **Torch stacking prevention** (`torches.js`): added `isTooCloseToTorch()` proximity check (0.6 unit min spacing). Both wall and ground torch placement reject positions too close to existing active torches.
- **Door blocked by rocks** (`doors.js`): `toggleNearestDoor()` now checks if the door panel at its fully open position would collide with a rock. If so, the door refuses to open.
- **Rock placement mode** (`projectiles.js`, `controls.js`, `hotbar.js`, `main.js`): stones now support two modes — throw (default, left-click throws) and place (left-click places). E key toggles between modes when nothing to interact with. Placement shows a green transparent preview rock. Placed rocks fall via gravity and can stack on other rocks. New `initRockPreview()`, `updateRockPreview()`, `isRockPreviewValid()`, `placeRockAtPreview()` in projectiles.js.
- **Rock stacking physics** (`projectiles.js`, `vegetation.js`): placed rocks use `spawnDroppingRock()` with zero velocity, falling via gravity. `getRockStackHeight()` and `findRockSurface()` added to vegetation.js for finding rock surfaces to land on. Dropped rocks register as pickable when they come to rest.
- **Thicker mid-floor** (`geometry.js`): increased 2-story building mid-floor thickness from 0.25 to 0.5 units, offset down so top surface stays at the same position. Prevents camera clipping through from stairs.
- **Partial door opening** (`doors.js`): doors no longer fully blocked by rocks. `findMaxDoorRotation()` sweep-tests 20 incremental rotation steps, checking both panel center and tip for rock collision. Door opens to maximum safe angle. If stone is later removed, door stays at its current position; press E again to close and reopen fully.
- **Door torches move with door** (`torches.js`, `doors.js`, `main.js`): door torch elements (stick, flame, light) now parented to door THREE.Group instead of scene. When door opens, torches rotate with it. `getDoorByCell()` exported from doors.js. `updateDoorTorchPositions()` syncs world-space wx/wz each frame for distance checks and ember positioning. Build order changed: `placeDoors()` now runs before `placeDoorTorches()`.
- **Rock placement in air** (`projectiles.js`): rock placement preview no longer snaps to ground/rock surfaces. Preview follows the crosshair ray freely, allowing placement in mid-air. Rock falls from placement point via gravity (existing `spawnDroppingRock` physics).
- **E toggle requires active stone** (`controls.js`): E key only toggles between throw/place mode when the selected hotbar slot has 'stone' AND inventory has stones > 0.
- **Breakable windows** (`geometry.js`, `projectiles.js`): window panes tracked in `windowPanes` registry with cell coordinates, floor, and dimensions. Thrown rocks that hit glass within the window opening break it (pane mesh removed). Rocks pass through broken windows instead of bouncing. `tryBreakWindow()`, `isWindowBrokenAt()`, `isInsideWindowOpening()` exported.
- **Torch placement above/below windows** (`torches.js`): window cell rejection in `findPlacementTarget()` now checks `isInsideWindowOpening()` for Y position. Torches can be placed on wall sections above or below window openings, only the opening itself is blocked.
- **Rocks pass through trees** (`projectiles.js`, `vegetation.js`, `grid.js`): tree cells tracked via `markTreeCell()`/`isTreeCell()` in grid.js. When a thrown rock hits a tree cell, horizontal velocity zeroes out and the rock falls straight down instead of bouncing. Simulates rocks entering through leaves and dropping.
- **Rock trunk vs foliage** (`projectiles.js`): tree collision now differentiates by height. Below foliage level (terrain + 3 units), rocks bounce off the trunk normally. Above that, rocks pass through leaves and fall straight down.
- **Throw cooldown** (`controls.js`): stone throwing has a 500ms cooldown between throws. Placement mode is not affected by cooldown.
- **Rock placement closer + rock-on-rock snap** (`projectiles.js`): `ROCK_PLACE_MAX_DIST` reduced from 5 to 3 for tighter control. Ray-march now checks `findRockSurface()` — when pointing at an existing rock, placement snaps on top of it. Air placement still works for non-rock positions.
- **Glass breaking visual effect** (`projectiles.js`): breaking a window now spawns 8 glass shard particles (small translucent blue planes) that fall with gravity, spin, and fade out over 2 seconds.
- **Revert door torch parenting** (`torches.js`, `main.js`): door companion torches no longer parented to door group — they stay fixed on the adjacent wall. Removed `updateDoorTorchPositions()` and `getDoorByCell` import.
- **Torch window frame margin** (`geometry.js`): `isInsideWindowOpening()` now includes 0.15-unit margin above and below the opening, preventing torch placement on window frame bars.
- **Floor noclip fix** (`grid.js`): stair zone height checks in both `isWalkable()` and `getFloorHeight()` now include an upper bound (`currentY < stairY + 1.0`). Prevents players on the upper floor from being pulled down into the stair zone when walking sideways across it.
- **Door closing blocked by rocks** (`doors.js`): added `findClosingTarget()` sweep test. Doors can no longer close through rocks — they stop at the angle where the panel exactly touches the blocking rock. Both opening and closing now use 60 sweep steps for precise contact.
- **Door edge interaction** (`doors.js`): `getNearestDoor()` now computes distance from the player to the nearest point on the door panel segment (hinge to tip), instead of just the cell center. Players can interact with doors from the panel edge.
- **Floor noclip fix v2** (`grid.js`): stair cells are NOT in `upperFloorCells`, so when player on upper floor walks into stair zone X/Z bounds but is above the ramp surface, `getFloorHeight` fell to terrain (Y≈0). Added upper floor fallback: if player at upper floor height AND in stair zone X/Z but rejected by ramp Y check, return `terrain + WALL_H`.
- **Door toggle after partial close** (`doors.js`): pressing E on a door partially closed against a rock now re-opens it to max angle. Binary search refinement (8 iterations) added for sub-degree precision on door-rock contact. `panelR` reduced from `CELL*0.2` to `CELL*0.12` for tighter flush contact.
- **Rock fall speed from tree foliage** (`projectiles.js`): rocks entering tree foliage now get minimum downward velocity of -4 (was whatever the projectile had, which could be near zero). Prevents "melted butter" slow fall.
- **More throwable stones** (`config.js`): `THROWABLE_STONES` increased from 15 to 30.
- **Throw cooldown visual ring** (`main.js`, `controls.js`): canvas overlay at crosshair draws an orange arc showing remaining cooldown. `getThrowCooldownFrac()` exported from controls.js.
- **Uniform window torch margin** (`geometry.js`, `torches.js`): `isInsideWindowOpening()` now accepts optional `wx, wz` params and checks horizontal bounds with same 0.15 margin as vertical. Call site in torches.js passes horizontal coordinates.
- **Mid-floor projectile collision** (`projectiles.js`): stones now bounce off the underside of upper floor slabs in 2-story buildings. Uses `isUpperFloorCell()` from grid.js to detect cells with mid-floor above.
- **Torch on door placement** (`torches.js`, `main.js`): players can place torches directly on closed door panels. Torch meshes (flame, stick) parented to door group so they rotate with the door. `playerDoorTorches` list tracks these for wx/wz updates via `updateDoorTorchPositions()`.
- **Torch above door placement** (`torches.js`): torches can be placed on the lintel wall above the door gap (between door top at 0.88*WALL_H and ceiling).

### cannon-es Physics Engine Integration

- **cannon-es installed** (`package.json`, `index.html`): added cannon-es dependency via npm, added to importmap. ~150KB pure JS physics engine replaces manual grid-based collision for player, projectiles, and doors.
- **Physics world** (`src/core/physics.js`): new module with CANNON.World (gravity=-20, SAPBroadphase, 10 solver iterations, sleep enabled). Materials: ground, player (0 bounce), projectile (0.5 bounce), door. Contact material tuning for all pairs. Helpers: createStaticBox, createStaticSphere, createTerrainBody (heightfield), createKinematicBox (doors), createProjectileSphere, createPlayerBody (compound capsule), removeBody. Terrain heightfield sampled at 80×80 grid with Z-direction fix for correct rotation mapping. Snow mode adds invisible ice floor at WATER_Y.
- **Static world bodies** (`geometry.js`): `createWorldPhysicsBodies()` creates cannon bodies matching visual geometry: wall boxes (incl. window cells with collision group 4 to skip projectiles), tree trunk boxes (3-unit height), above-door lintels, 2nd floor door walls, mid-floor slabs (4 pieces around stairwell), stair steps (16 per staircase for capsule climbing), ground floor slabs.
- **Rock physics bodies** (`vegetation.js`): rocks with size > 0.5 get static sphere bodies in placeRocks(). registerPickableRock() also creates static sphere for landed stones.
- **Player capsule body** (`player.js`): compound capsule (2 spheres + cylinder, mass 80, fixedRotation). Collision group 2 for raycast filtering. New `updatePlayerMovement()` sets body velocity from WASD input before physics step. New `syncPlayerFromPhysics()` reads body position back into state after step. Grounded detection via downward raycast (filters out player group). Removed manual canMoveTo, getRockPushback, getDoorPanelPushback, getFloorHeight, getRockSurfaceHeight. NPC pushback kept as post-physics nudge. Underwater handling via applyForce counteracting 70% of gravity.
- **Projectile physics** (`projectiles.js`): thrown stones and placed rocks now use cannon dynamic sphere bodies (group 8, skip window group 4). Sync mesh from body position/quaternion each frame. Rest detection: velocity < 0.5 for 0.3s → register as pickable rock, remove body. Window breaking via post-step grid check (projectiles pass through window physics bodies). Removed manual gravity, wall bounce, rock bounce, mid-floor bounce, ground landing — all handled by cannon.
- **Kinematic door bodies** (`doors.js`): each door gets a kinematic CANNON.Box. updateDoors() syncs body position/rotation from door panel center computed via hinge-point rotation math. Door-rock sweep test panelR increased from CELL*0.12 to CELL*0.3 for proper rock blocking.
- **Game loop integration** (`main.js`): initPhysics() in batch 1, createTerrainBody() + createWorldPhysicsBodies() after world geometry in batch 2. Game loop: updatePlayerMovement → stepPhysics → syncPlayerFromPhysics → updatePlayer (camera/animation only).
- **In-flight rock pickup** (`projectiles.js`, `controls.js`, `main.js`): added `getNearestInFlightRock()` and `pickNearestInFlightRock(inventory)` to allow catching active projectile rocks mid-flight. Wired into doInteract() and "[E] Catch" hint for nearby in-flight rocks.
- **Player-ground friction fix** (`physics.js`): set player-ground and player-door friction to 0.0 (was causing extremely slow movement because cannon solver fought against directly-set velocity).

## 2026-02-18

### Physics tuning and bug fixes
- **Roof physics bodies** (`geometry.js`): added static box bodies for all building roofs in `createWorldPhysicsBodies()`. Prevents jumping through ceilings on 2nd floor and through roofs. Matches visual overhang (0.4 units).
- **Torch light position fix** (`torches.js`): flame and PointLight were positioned at `TIP_OUT` from mount instead of actual stick tip at `1.5*TIP_OUT`. Fixed `createWallTorch()` tip calculation and `updateTorchPreview()` flame offset. Glow now appears at the visible tip of the torch stick.
- **Water damping for projectiles** (`projectiles.js`): rocks below WATER_Y (non-snow mode) now get `linearDamping = 0.85` (vs 0.01 in air), causing them to slow down significantly in water.
- **Grass surface friction** (`physics.js`): projectile-ground friction increased from 0.3 to 0.7 and restitution decreased from 0.5 to 0.3. Rocks now roll and bounce less, as if on grass rather than stone.
- **Slope anti-slide** (`player.js`): when grounded and not pressing any movement keys, player velocity.y is zeroed. Prevents gravity-induced sliding on gentle terrain slopes.
- **Rock collision radius** (`vegetation.js`): physics sphere radius for rocks increased from `size * 0.85` to `size * 0.95` (both in `placeRocks()` and `registerPickableRock()`). Fixes being able to walk inside large rocks.

## 2026-02-19

### Backlog implementation — physics fixes and features
- **Ceiling raycast clamp** (`player.js`): added upward raycast in `syncPlayerFromPhysics()` as a safety net for floor/roof pass-through. Casts from near feet to above head; if a ceiling is detected within `PLAYER_H`, clamps player position down and zeroes upward velocity. Works regardless of cannon-es collision detection behavior.
- **Slope sliding fix v2** (`player.js`): when grounded and not moving, now zeroes ALL velocity AND applies upward force equal to gravity (`mass * GRAV`). This fully counteracts gravity during the physics step, preventing any sliding on slopes. Skipped when Space is pressed (for jump).
- **Rock-on-rock knockback** (`projectiles.js`, `vegetation.js`): fast-moving projectiles (speed > 2) check proximity to pickable pebbles via `getPickableRockNear()`. On hit: deactivates the static rock, removes its physics body, spawns a new dynamic projectile at the rock's position with 60% of the impacting projectile's horizontal velocity + upward pop. Original projectile slowed to 30%. `deactivateRock()` exported from vegetation.js.
- **Tree foliage damping** (`projectiles.js`, `vegetation.js`): tree positions + scale stored in `treePosData[]` during `placeTrees()`. New `getTreeFoliageDamping(wx, wy, wz)` returns a per-frame velocity multiplier (0.3 at center to 0.8 at edge) when a projectile is inside foliage. Foliage zone: above scaled trunk top, within radius `scale * 1.3`, up to `scale * 5.0` height. Vertical damping slightly less so rocks fall through leaves naturally.
- **Pickable rocks on minimap** (`hud.js`, `vegetation.js`, `projectiles.js`): pickable rocks and in-flight projectiles shown as orange dots on the minimap. `getPickableRocks()` exported from vegetation.js (filters active rocks ≤ `ROCK_PICK_MAX_SIZE`). `getActiveProjectilePositions()` exported from projectiles.js.
- **Player kicks pebbles** (`projectiles.js`, `main.js`): `kickNearbyRock(scene)` called after physics sync. When the player is moving (hSpeed > 1) and overlaps a pickable pebble within `PLAYER_R`, the pebble is converted to a dynamic projectile kicked away from the player at 70% of player speed (capped at 8) with a small upward pop.
- **3rd person throw accuracy** (`projectiles.js`): replaced fixed 50-unit convergence target with a proper `THREE.Raycaster` from the camera. Finds the exact world point the crosshair is aiming at (layer 0 only — skips player model on layer 1). Eliminates parallax error when throwing at close-range targets in 3rd person.
- **Map boundary for projectiles** (`projectiles.js`): rocks reaching the world edge (±HALF - 1) are clamped inside and their horizontal velocity zeroed. Prevents rocks from flying off the map and falling into the void.
- **Sci-fi boundary shield effect** (`boundary.js` NEW, `physics.js`, `projectiles.js`, `player.js`, `main.js`): when a projectile or player hits the world boundary, a semi-transparent hex-grid shield ripple spawns at the impact point and expands outward while fading. Uses pooled PlaneGeometry meshes (8) with a canvas-generated texture (concentric rings + hex grid pattern), additive blending, ~1s expand+fade animation. Projectiles deflect at 40% speed on bounce. Player gets a 0.5s cooldown between shield spawns to avoid spam. Four invisible cannon-es wall bodies added at world edges in `createTerrainBody()` for physics-based boundary collision.

### Camera, torch, and light fixes
- **3rd person camera fix** (`player.js`, `boundary.js`): camera was stuck at 0.5 units from player near spawn point. Root cause: 8 boundary shield PlaneGeometry meshes at (0,0,0) with `visible: false` were still hit by camera clip raycast at distance 0.00 (Three.js Raycaster tests invisible meshes). Fixed by overriding `mesh.raycast = function() {}` on all boundary shield meshes. Also added `userData.isGround = true` to ground/water meshes in geometry.js and filtered them from camera clip raycasts in player.js.
- **Convergence distance minimum** (`player.js`): raised minimum convergenceDist from 3 to 15 for 3→1 camera transitions, reducing shoulder-offset parallax.
- **Player spawn height** (`player.js`): removed +1.0 offset from spawn Y — player starts exactly on terrain instead of dropping.
- **Torch flame position** (`torches.js`): `TIP_OUT` and `TIP_UP` were using `STICK_LEN / 2` (stick center) instead of `STICK_LEN` (actual tip). Fixed both to use full stick length projection. Light offset reduced from +0.12 to +0.06, flame offset removed (sits at tip).
- **Torch placement ghost fix** (`torches.js`): wall-mounted preview flame was at 1.5x correct offset after `TIP_OUT`/`TIP_UP` fix. Changed from `(TIP_OUT, TIP_UP)` to `(TIP_OUT/2, TIP_UP/2)` to match group's half-offset positioning. Ground preview stale +0.08 Y offset removed.
- **Torch light range reduced** (`torches.js`): PointLight distance reduced from 8 to 6, decay increased from 1.5 to 2.0. Faster falloff reduces light bleeding through doors and adjacent geometry without losing local illumination quality.
- **Door-stone collision** (`doors.js`): `panelR` reduced from 0.6 to 0.12 for flush door-rock contact. Added 3/4-point sample along panel in `panelHitsRock()` for better coverage.
- **Build batching** (`main.js`): split monolithic Batch 2 into Batch 2a (visual world) and Batch 2b (physics bodies) with yieldFrame between them for smoother loading progress.
- **CLAUDE.md updated**: architecture tree now includes `physics.js`, `boundary.js`. Collision section rewritten for cannon-es. Known Quirks updated (removed CDN mention, added shadow budget note).

## 2026-02-22

### Interactive Beds & Sleep Mechanics
- **Furniture Generation** (`furniture.js` NEW, `generator.js`, `main.js`): procedurally generates basic wooden beds inside buildings (one per building max). Places against a wall far from doorways.
- **Sleep System** (`sleep.js` NEW, `controls.js`): allows player to interact (`E`) with a bed to instantly fast-forward the day/night cycle to 08:00 the next morning.
- **Time-Skip Visuals** (`sleep.js`, `styles.css`): screen fades to black (1.5s), holds (1s) displaying "Sleeping...", then fades back in (1.5s). Triggers ambient audio logic if implemented in the future.
- **HUD Updates** (`hud.js`): the time clock on the HUD jumps accurately to the next morning after a sleep action without breaking the internal timeline.

### AAA Camera Collision & Crosshair Fixes
- **Dynamic Frustum Cone Sweep** (`player.js`, `geometry.js`): replaced buggy multi-ray and center-ray approaches with a 5-ray dynamic sweep acting as a frustum proxy. Mathematically impossible for camera near-plane corners to clip through walls, even at sharp oblique angles.
- **Near-Plane Compression** (`player.js`): geometrically shrinks the camera `near` plane proportionally as it moves closer to an obstructed wall to eliminate viewport penetration.
- **Redundant Hacks Removed** (`geometry.js`): deleted the DoubleSide / BackSide visual window-void-filler hacks because the math in the new collision implementation prevents the camera from ever entering interior wall voids.
- **Locked Crosshair Target** (`player.js`): during a 1st-to-3rd person camera transition (`V`), the look-target now samples a single static physical point in the world instead of continuously sliding relative to the eye. Drift completely eliminated.

### Complex Physics Refinement
- **Coyote Time** (`player.js`): implemented a 150ms jump buffer. `isPlayerGrounded()` records `_lastGroundedTime`. Pressing space just after falling off a ledge correctly issues a full-strength jump, easing platforming latency.
- **Hard Ground Overlap Clamp** (`player.js`): removed JS code that nullified positive upward `velocity.y` pulses to handle jitter. Fixed a game-breaking bug where the player would instantly fall entirely through the terrain on high-impact drops. Added a continuous check against `getTerrainHeight` that snaps the player to the surface if they punch through the physics shell between ticks.

### Breaking Down `geometry.js`
- **Modularization** (`geometry.js` DELETED): the monolithic 1000+ line visual and physics builder has been split by architectural feature into 5 highly-focused files within `src/world/`.
- **Terrain** (`terrainMeshes.js` NEW): handles `buildGround()` (displaced planes) and `buildWater()` (translucent depths).
- **Floors & Stairs** (`floors.js` NEW): manages `buildFloors()` (including complex stairway gap-filling logic for 2-story buildings) and `buildStairSteps()`.
- **Walls & Roofs** (`walls.js` NEW): contains `buildWalls()` with its triplanar shader injection and thin-post corner extensions, as well as `buildRoofs()`.
- **Windows** (`windows.js` NEW): houses the window extrusions with triplanar UVs, glass panes, wooden frames, and the `windowPanes` breakable state registry (`tryBreakWindow`, etc).
- **Static Physics** (`staticPhysics.js` NEW): extracted `createWorldPhysicsBodies()` out of the visual pipeline. Translates the 2D grid into cannon-es bodies (heightfields, walls, lintels, roofs, slabs, steps).
- **Kinematic Mask Fix** (`physics.js`, `doors.js`): updated `createKinematicBox()` to explicitly set `collisionFilterGroup = 1` and `collisionFilterMask = -1`. Previously, doors had no explicit filters, which caused projectiles (Group 8) to ghost through them even when closed. Rocks now bounce cleanly off swinging door panels.
- **Documentation**: updated `ARCHITECTURE.md` file tree and file statistics to reflect the 5 new files and the removal of `geometry.js`.

## 2026-02-23

### Batch Bug Fixes — 10 gameplay issues from playtesting

- **Rock re-catch prevention** (`projectiles.js`): added 0.5s minimum flight time before in-flight rocks can be picked up, preventing instant re-catch after throwing.
- **Rock terrain tunneling** (`projectiles.js`): added per-frame terrain floor clamp for projectiles to prevent rocks from falling through the heightfield at high velocities.
- **Ceiling clipping from furniture** (`player.js`): added ceiling proximity check when jumping (caps upward velocity near ceilings) and extended ceiling raycast origin lower to catch already-clipped-through ceilings.
- **Backward hill hop** (`player.js`): increased velocity.y freeze threshold from 0.1 to 2.0 to catch slope-induced upward velocities when stopping on hills.
- **Roof physics matches visuals** (`staticPhysics.js`, `physics.js`): replaced flat ceiling slab with proper angled physics for slanted gable roofs — two tilted boxes matching the visual slope angle. Added `roofMaterial` with low friction (0.1) so stones roll off. Flat roofs keep their thick slab. Players can climb roofs if they find a way up.
- **Door handle position** (`doors.js`): negated knobX to move door handles to the hinge side of the door leaf.
- **Table-on-stairs fix** (`furniture.js`): replaced distance-based stair avoidance with proper `isStairCell()` checks for both table and bed fallback placement.
- **Stairs-wall gap** (`staticPhysics.js`): added filler wall physics body between stairwell east edge and east perimeter wall to seal the walkthrough gap.
- **Building corner clipping** (`staticPhysics.js`): removed separate corner/thin-post physics bodies entirely — adjacent straight walls already extend into corners via isThinPost() extensions, providing full coverage without invisible interior pillars.
- **Fox stuck in buildings** (`npcAI.js`): improved `smartFleeDirection()` with multi-distance sampling (2.0, 1.0, 0.5) and added stuck detection with emergency teleport — foxes stuck inside a building for 3+ seconds are relocated to the nearest outdoor walkable position.

### Follow-up Fixes — roof, ceiling, placement, hints
- **Flat roof physics alignment** (`staticPhysics.js`): physics slab top now matches visual roof surface at topY+0.25 (was topY+1.0), fixing player/rocks floating above flat roofs.
- **Ceiling jump from bed** (`player.js`): replaced fixed headroom<0.5 threshold with physics-based velocity cap (v = sqrt(2*g*h)*0.85), preventing ceiling clips when jumping from elevated surfaces like beds.
- **Rock placement through roof** (`projectiles.js`): added player-feet Y check in `findRockPlacementTarget()` — breaks ray march if target is >0.5 below player feet, preventing placement through roof/floor surfaces.
- **Interaction hints through roof** (`main.js`): added Y-distance filter in `updateInteractHint()` — skips objects >1.5 below player, hiding hints for interior objects when standing on roof.
- **Corner physics: cylinder** (`staticPhysics.js`, `physics.js`): replaced + shape with a vertical cylinder (radius=CELL/2) at corner cells. Circular cross-section prevents player capsule from getting stuck on sharp 90° edges while still sealing window-near-corner gaps. Added `createStaticCylinder()` helper to physics.js.
- **Bed headboard collision** (`furniture.js`): fixed swapped X/Z bed physics dimensions (now rotation-aware) and added dedicated headboard physics body (1.0 tall panel at the head end).
- **Rock placement clamps to roof** (`projectiles.js`): instead of breaking ray march below player feet, Y is clamped to player surface level + stone radius — preview sticks to the roof surface, rocks don't pop up after placement.
- **Corner reverted to no-body** (`staticPhysics.js`): reverted cylinder corners back to `continue` (no corner body) for smooth exterior sliding. Added isThinPost extensions to window cells instead, sealing the window-near-corner gap.
- **Ceiling clamp fix** (`player.js`): changed ceiling safety raycast to start from feet+0.1 (was feet-0.5), removed 0.3 guard threshold. Fixes jumping from 2nd floor bed into slanted/flat roof.
- **Door knobs reverted** (`doors.js`): knobX back to positive (handle side, opposite hinge). Previous negation incorrectly placed knobs on hinge side.
- **Survival guide rewrite** (`index.html`, `styles.css`, `controls.js`): replaced scrolling sections with tabbed layout (Controls / Touch / World). Touch tab only visible on mobile. Updated content: double jump, rock placement mode, bed sleeping, roof climbing, breakable windows.

### Additional Fixes — corners, doors, rock placement, guide
- **Corner gap sealed** (`staticPhysics.js`): added WALL_T x WALL_T physics box at corner cells to fill the diagonal gap between perpendicular wall extensions. Small enough (0.35 from center) not to protrude into building interiors.
- **Door opening direction** (`doors.js`): stored wall direction per door. South/west wall doors now open with +PI/2 rotation (inward) instead of -PI/2 (which was outward). North/east walls keep -PI/2. All doors now open into the building interior.
- **Rock placement on angled roof** (`projectiles.js`): detect when player is elevated above terrain (on roof/building) and clamp preview Y to player feet level instead of allowing 0.3 units below. Prevents preview from going below angled roof surface near the peak. Also fixes flat roof pop-up by using sz*0.4 offset instead of full sz.
- **Survival guide: Rocks & Physics section** (`index.html`): added new section to World tab covering throwing, placement mode, rock splitting/knockback, and window breaking.

### More Fixes — door knobs, roof ridge, rock collision, menu bounds
- **Door knob position** (`doors.js`): rewrote door leaf builder to always place knobs at +X (free edge). Changed E-W door leaf rotation from +PI/2 to -PI/2 so leaf +X maps to +Z (free end) in parent space. No more per-side special-casing — single code path handles all wall directions. Also stored `wall` property per door and set opening rotation based on wall direction (south/west = +PI/2 inward, north/east = -PI/2 inward).
- **Slanted roof ridge cap** (`staticPhysics.js`): added horizontal box along the ridge peak of gable roofs to seal the V-shaped gap between the two tilted slope bodies. Prevents jumping through the roof from beds below.
- **Rock physics radius** (`vegetation.js`): increased physics sphere radius from `s * 0.65` to `s * 0.85` (matching 2D collision radius) for both environment rocks and placed rocks. Player no longer clips knee-deep into rock geometry.
- **Menu wander boundary** (`menu.js`): added hard distance limit (5 units from scene center) preventing the character from walking behind scenery or into the fog on the main menu screen.

### Physics Hardening — roofs, rocks, trees, menu
- **Slanted roof thickness** (`staticPhysics.js`): increased SLOPE_THICK from 0.5 to 1.2 and widened ridge cap (1.0 wide, 1.2 tall). Prevents jumping through angled roof from 1st or 2nd floor beds.
- **Jump velocity cap** (`player.js`): reduced safety factor from 0.85 to 0.7 — player reaches only 70% of theoretical ceiling height, adding more headroom margin.
- **Rock physics radius** (`vegetation.js`): increased from `s * 0.85` to full `s` (matching visual dodecahedron radius). Player no longer clips ankle-deep into rocks or sinks a leg into large boulders.
- **Per-tree trunk physics** (`vegetation.js`): added `createStaticCylinder` body for each tree trunk at its exact visual position and scale. Projectiles now collide with trunks instead of passing through.
- **Menu shelter boundary** (`menu.js`): added invisible outer boundary colliders behind and beside the shelter walls, preventing the character from walking behind the shed and disappearing.

### Physics Engine Migration — cannon-es → Rapier3D
- **Replaced cannon-es with @dimforge/rapier3d-compat** (Rust/WASM physics engine). Motivation: cannon-es had no CCD causing player/rocks to fall through terrain, jump through ceilings/roofs, and required 10+ manual workaround hacks. Also degraded to 45 FPS with ~3,150 pure JS physics bodies.
- **Full rewrite of `src/core/physics.js`**: RAPIER.init() (async), World creation, PhysicsBodyWrapper class with Vec3Proxy/QuatProxy to preserve existing `body.position.x`, `body.velocity.y`, `body.quaternion.setFromEuler()` access patterns. All body creation functions maintain same signatures.
- **Native capsule** for player (replaces compound 2-sphere+cylinder). PlayerBodyWrapper subclass offsets position to report foot Y instead of capsule center.
- **CCD enabled** on player and projectile bodies via `setCcdEnabled(true)`.
- **Collision groups** migrated from cannon-es number flags to Rapier packed 32-bit format (membership << 16 | filter). Groups: DEFAULT(0x0001), PLAYER(0x0002), WINDOW(0x0004), PROJECTILE(0x0008), DOOR(0x0010).
- **Material system** converted from ContactMaterial pairs to per-collider friction/restitution with applyMat() helper.
- **Heightfield** now uses Rapier's Y-up native format (no rotation hack needed). Column-major Float32Array with scale vector.
- **Raycast API**: new `raycastClosest(from, to, filterMask)` helper replaces `world.raycastClosest()` with CANNON.Vec3/RaycastResult.
- **Fixed timestep accumulator** (1/60s, max 10 steps) replaces cannon-es's built-in sub-stepping.
- **Player.js**: removed CANNON import, replaced all raycast calls with new API, replaced `new CANNON.Vec3(...)` force vectors with plain objects.
- **Doors.js**: removed unused CANNON import, kinematic body sync works through wrapper's setNextKinematicTranslation/Rotation.
- **StaticPhysics.js**: window collision groups passed at creation time via WINDOW_COLLISION_GROUP constant instead of post-creation property assignment.
- **No changes needed** in projectiles.js, vegetation.js, furniture.js — all body access works through PhysicsBodyWrapper proxies.

## 2026-02-24

### Three.js 0.172.0 Upgrade & WebGPU Revert
- **Three.js upgraded** from 0.162.0 to 0.172.0 via npm.
- **WebGPU attempted and reverted**: WebGPURenderer tested but caused 3 issues — slower FPS (42 vs 48-62), broken `onBeforeCompile` (wall textures lost triplanar UVs), window frame flickering. Reverted to WebGLRenderer.
- **Model scaling fix** (`modelLoader.js`, `player.js`, `menu.js`): Three.js 0.172.0 changed `Box3.setFromObject()` to include bone transforms for skinned meshes, inflating bounding boxes. Fixed by using raw `geometry.computeBoundingBox()` without any transforms to get true mesh dimensions.
- **Window z-fighting fix** (`windows.js`): added `polygonOffset: true` with `polygonOffsetFactor: 1` to window wall material to resolve flickering with frame bars.
- **Boundary shader simplified** (`boundary.js`): switched from ShaderMaterial to MeshBasicMaterial (retained from WebGPU compat attempt).
- **Lensflare removed** (`lighting.js`): Lensflare addon had compatibility issues with 0.172.0; sun glow retained via sprites.

### Static Geometry Batching (~1000+ draw calls → ~20-25)
- **Vegetation batched** (`vegetation.js`): tree trunks merged into 1 mesh, canopy cones into 1 mesh, non-pickable rocks into 1 mesh. Pickable rocks remain individual. Used `mergeGeometries()` with transforms baked into geometry via `translate()`/`applyMatrix4()`.
- **Furniture batched** (`furniture.js`): all bed, table, chair components collected by material via `collectGroupGeos()` helper, merged into ~4-6 meshes (one per shared material). Bed registry kept for interact detection.
- **Floors batched** (`floors.js`): all ground floor slabs and mid-floor pieces merged into 1 mesh with floorMat. All stair steps merged into 1 mesh with stairMat.
- **Roofs batched** (`walls.js`): flat roofs merged into 1 mesh, slant roofs merged into 1 mesh. Rotation+position baked via Matrix4.
- **Window walls and frames batched** (`windows.js`): all ExtrudeGeometry wall segments merged into 1 mesh, all frame bars merged into 1 mesh. Glass panes kept individual for breakable window system.
- **Not batched**: walls (already InstancedMesh), torches (all pickable with individual light references), doors (animated), animated models, terrain/water (already 1-2 meshes).

### Three.js → Babylon.js Full Engine Migration
- **Motivation**: Three.js shadow system had unresolvable shadow acne on walls after 15+ fix attempts. Every known Three.js technique was exhausted (bias, normalBias, VSM, BackSide, customDepthMaterial, polygon offset, frustum tightening, texel snapping, 4096 maps). Babylon.js's built-in CascadedShadowGenerator (CSM) handles shadows correctly out of the box.
- **Babylon.js bundling**: installed `@babylonjs/core`, `@babylonjs/loaders`, `@babylonjs/materials` via npm. Pre-bundled via esbuild (`scripts/bundle-babylon.js`) into `lib/babylon.bundle.js`. Importmap maps `'babylonjs'` to the bundle. Game source stays as unbundled ES modules.
- **Phase 1 — Core** (`scene.js`, `lighting.js`): `WebGLRenderer` → `Engine`, `PerspectiveCamera` → `FreeCamera` (inputs cleared), `PCFSoftShadowMap` → `CascadedShadowGenerator` with 4 cascades + PCF filtering + stabilizeCascades. `scene.useRightHandedSystem = true` to match Three.js conventions.
- **Phase 2 — Terrain** (`terrainMeshes.js`): `PlaneGeometry` vertex displacement → `MeshBuilder.CreateGround` + `VertexData` manipulation. `MeshStandardMaterial` → `PBRMaterial`.
- **Phase 3 — Walls** (`walls.js`): `InstancedMesh` → thin instances (`thinInstanceSetBuffer`). `onBeforeCompile` triplanar UV → `TriPlanarMaterial` from `@babylonjs/materials`. `mergeGeometries` → `Mesh.MergeMeshes`. Deleted all `customDepthMaterial`, `shadowSide`, polygon offset shadow hacks.
- **Phase 4 — Floors/Windows/Furniture** (`floors.js`, `windows.js`, `furniture.js`): all `mergeGeometries` → `Mesh.MergeMeshes`. Window breaking uses direct VertexData position buffer modification.
- **Phase 5 — Vegetation/Doors/Torches** (`vegetation.js`, `doors.js`, `torches.js`): merged geometry → `Mesh.MergeMeshes`. `THREE.Group` → `TransformNode` for doors. Torch `PointLight` pool pattern preserved. Leaf shadow dapple via `opacityTexture`.
- **Phase 6 — Models/Player** (`modelLoader.js`, `player.js`): `GLTFLoader` → `SceneLoader.LoadAssetContainerAsync`. `SkeletonUtils.clone` → `container.instantiateModelsToScene()`. Created `createAnimMixer()` wrapper mimicking Three.js AnimationMixer API using Babylon AnimationGroup weight blending. Player camera: `FreeCamera` with `setTarget()`. Layer visibility: `mesh.layerMask` bitmask.
- **Phase 7 — Game Systems** (`daynight.js`, `npcAI.js`, `projectiles.js`, `flowers.js`): `THREE.Color` → `Color3`. `THREE.Raycaster` → `scene.pickWithRay()` / `scene.multiPickWithRay()`. `Vector3.project()` → `Vector3.Project(pos, Matrix.Identity(), scene.getTransformMatrix(), viewport)`.
- **Phase 8 — Effects/Menu** (`boundary.js`, `menu.js`): boundary hex shader → `Effect.ShadersStore` + `ShaderMaterial`. Menu: separate `new Scene(engine)` with own camera. Campfire sprites → billboard planes with `Mesh.BILLBOARDMODE_ALL`.
- **Phase 9 — Cleanup**: removed `three` from `package.json` and `index.html` importmap. Updated `CLAUDE.md` tech stack, architecture tree, collision docs, model docs, known quirks.
- **Key patterns**: all imports from `'babylonjs'`, `MeshBuilder.Create*()` for geometry, `PBRMaterial` for PBR, `StandardMaterial` for simple materials, `addShadowCaster()`/`enableShadowReceiving()` for shadows, `mesh.setEnabled()` for visibility, `mesh.dispose()` for removal, `mesh.metadata` instead of `userData`.
- **What stayed unchanged**: Rapier 3D physics (`physics.js`), grid/terrain logic, all DOM/UI code, controls, touch, hotbar, hud, sleep, config, helpers.

## 2026-02-25

### Building Geometry Fixes
- **Wall seam elimination** (`walls.js`, `windows.js`): merged all wall geometry (regular walls + window wall holes) into a single mesh with one material per building. Previously, window walls and regular walls were separate merged meshes with different materials — `zOffset` on the window wall material caused visible step/seam at cell boundaries. Moved `buildWallWithHoles()` from windows.js into walls.js. Stripped windows.js to only glass panes and wooden frames.
- **Walk-through gap fix** (`staticPhysics.js`): added door-side fill physics bodies that seal the gap between door openings and adjacent thin-post corners. Without these, player could walk through walls next to doors near building corners.
- **Corner physics bodies restored** (`staticPhysics.js`): re-added WALL_T × WALL_T physics boxes at corner cells to fill diagonal gaps between perpendicular wall extensions.

### Ceiling & Roof Physics
- **Ceiling slab for slanted roofs** (`staticPhysics.js`): added thin physics slab (0.15 thick) at wall tops for slanted-roof buildings using CEILING_COLLISION_GROUP. Prevents player from jumping through ceiling into attic.
- **Slanted roof slope bodies** (`staticPhysics.js`): two tilted boxes + ridge cap tagged with CEILING_COLLISION_GROUP to fully seal the attic.
- **Flat roof slab thinned** (`staticPhysics.js`): reduced from 1.0 to 0.3 thickness. Old 1.0-thick slab extended too far downward (bottom at Y=2.75 for 1-story), preventing jumping on beds.
- **Collision group system** (`physics.js`): added GRP_CEILING (0x0020) and CEILING_COLLISION_GROUP export. Fixed Rapier `world.castRay` parameter order — `filterGroups` was being passed as `filterFlags` (position 4 instead of 5).

### 3rd-Person Camera Indoor Fixes
- **Switched camera collision to Babylon scene raycasts** (`player.js`): replaced Rapier `raycastClosest` with Babylon `scene.multiPickWithRay` for camera collision. Scene raycasts naturally ignore physics-only bodies (ceiling slabs), eliminating false snap-in from invisible ceiling colliders.
- **Roof mesh skip in camera collision** (`player.js`): camera collision raycasts skip `slantRoofs` and `flatRoofs` meshes. The ceiling Y-clamp already prevents the camera from entering the attic, so roof meshes don't need to block the camera.
- **Camera ceiling Y-clamp** (`player.js`): upward Rapier raycast from player finds ceiling height; camera desired Y clamped to `ceilingY - 0.5` to prevent FOV from seeing above wall tops. Margin of 0.5 accounts for wide 75° FOV.
- **Temporal smoothing on camera fraction** (`player.js`): added `_camFracSmooth` state variable. Camera collision fraction snaps in instantly but eases out slowly (`dt * 5`), eliminating oscillation where the camera would snap to first-person during one jump frame then snap back the next.

### Physics Engine Migration: Rapier 3D → Babylon.js Havok
- **Complete rewrite of `physics.js`**: replaced `@dimforge/rapier3d-compat` (Rust/WASM) with `@babylonjs/havok` (Havok WASM). Same `PhysicsBodyWrapper` proxy API — zero changes needed in consumer files (`player.js`, `staticPhysics.js`, `doors.js`, `projectiles.js`, `vegetation.js`, `furniture.js`, `main.js`).
- **Dependencies**: installed `@babylonjs/havok`, uninstalled `@dimforge/rapier3d-compat`. Updated importmap in `index.html` to point to Havok ESM entry. Havok WASM served from `node_modules/` alongside JS.
- **Init**: `HavokPhysics()` → `HavokPlugin` → `scene.enablePhysics()`. Auto-stepping disabled (`scene.physicsEnabled = false`), manual accumulator calls `physicsEngine._step(FIXED_STEP)` to preserve fast-forward (Q key) mechanics.
- **Body types**: `RAPIER.RigidBodyDesc.fixed()` → `PhysicsMotionType.STATIC`, `.dynamic()` → `DYNAMIC`, `.kinematicPositionBased()` → `ANIMATED`. Each body gets a lightweight `TransformNode` (no mesh/draw calls).
- **Shape mapping**: Rapier half-extents → Havok full-extents (`hx*2, hy*2, hz*2` for boxes). Capsule uses `pointA/pointB` endpoints instead of `halfHeight`. Cylinder uses endpoints too. Heightfield uses `{width, height}` size object.
- **Collision groups**: changed from packed u32 `(membership << 16) | filter` to separate `shape.filterMembershipMask` / `shape.filterCollideMask` bitmasks. Exported constants changed from numbers to `{membership, filter}` objects.
- **Raycasting**: `RAPIER.Ray` + `world.castRay` → `physicsEngine.raycastToRef()` with `PhysicsRaycastResult`. Player exclusion via `collideWith` mask instead of explicit collider exclude.
- **Player capsule**: locked rotations via `setMassProperties({ mass: 80, inertia: Vector3.ZeroReadOnly })`. Friction combine mode `MINIMUM` via `PhysicsMaterialCombineMode.MINIMUM`.
- **Dynamic bodies** (`disablePreStep = false`): player and projectiles can be teleported by writing to `TransformNode.position`; pre-step sync pushes changes to physics engine. Static bodies use `disablePreStep = true` for zero per-frame overhead.
- **Kinematic doors** (`disablePreStep = false`): ANIMATED bodies auto-sync from node position/rotation. Consumer code sets `body.position.set()` and `body.quaternion.setFromEuler()` as before; now writes go directly to the TransformNode.

## 2026-02-26

### Window Breaking — SolidParticleSystem Glass Shards
- **SPS digest approach** (`windows.js`): replaced ParticleSystem with `SolidParticleSystem.digest()`. Creates a subdivided plane (6×6 = 72 triangles) at the window, digests into solid triangular shards that fly in the rock's direction with gravity and tumble rotation. Single draw call for all shards, auto-cleanup after 3s.
- **Rock velocity pass-through** (`projectiles.js` → `windows.js`): `tryBreakWindow()` now accepts `vx,vy,vz` velocity params so shards fly in the correct direction.
- **Hit detection margins** (`windows.js`): added 0.3 margin to both Y and horizontal bounds in `tryBreakWindow` and `isWindowBrokenAt` — stones no longer fly through windows without breaking.
- **TODO**: Glass shard flight direction/spread needs tuning — shards don't look fully natural yet.
- Added `SolidParticleSystem` export to babylon bundle (`lib/babylon-entry.js`).

### Torch Shadows — Player & Doors
- **Player torch shadows** (`player.js`): added `addTorchShadowCaster(mesh)` in player model loading callback so the player casts shadows from the 3 nearest torch shadow slot lights.
- **Door torch shadows** (`doors.js`): added `addTorchShadowCaster(merged)` after door mesh merging so doors cast torch shadows.

### Corner Z-Fighting Fix
- **Skip corner posts entirely** (`walls.js`): removed corner post geometry — adjacent wall extensions (ext = CELL/2 + WALL_T/2 = 1.35) fully cover the corner area visually. Physics corner boxes in `staticPhysics.js` kept since physics extensions are smaller (CELL/2 = 1.0).

### Cleanup
- Removed unused `createShardBody` from `physics.js` (was for Havok-based glass shards, replaced by SPS approach).
- Removed `particle.png` texture (no longer needed).

### Fix Torch Light Bleeding Through 2nd Floor
- **Bug**: `main.js` registered ground floor slabs (`getMergedFloors()`) as torch shadow casters but NOT the mid-floor slabs between stories. Torch PointLight shadows couldn't block light from 1st-floor torches reaching the 2nd floor.
- **Fix** (`floors.js`): exported `mergedMidFloors` mesh via new `getMergedMidFloors()` getter.
- **Fix** (`main.js`): registered `mergedMidFloors` as torch shadow caster alongside the existing ground floor slab. The 2 shadow-slot torch lights now properly cast shadows from mid-floor slabs, blocking light between stories.
- **Note**: walls were initially added as torch shadow casters too but reverted — the merged wall mesh is too large and caused ~6700+ draw calls (6 cube faces × 2 shadow lights × all wall geometry).

### WebGPU Engine
- Switched from `Engine` (WebGL2) to `WebGPUEngine` with async init and automatic WebGL2 fallback (`scene.js`).
- **Workarounds for Babylon.js 8.x WebGPU issues**: strip unused UV channels (uv2–uv6) from GLTF models to stay within 8 vertex buffer limit; skip `LensFlareSystem` on WebGPU (null texture binding crash); defer menu scene cleanup instead of explicit dispose (prevents "destroyed texture" swap chain errors).
- `engine.compatibilityMode = false` enables full WebGPU pipeline optimizations.
- `powerPreference: 'high-performance'` requested (currently ignored on Windows Chrome).

### Performance Optimizations
- **Draw call reduction** (~4000→~2500): removed small meshes from shadow caster lists — torch sticks, flowers, pickable rocks, thrown stones no longer register as sun shadow casters; NPC/flower models removed from torch shadow casters; inactive torch shadow slots set `shadowEnabled = false` to skip 6-face cube map rendering.
- **Torch embers** (`torches.js`): replaced ~150 individual sphere meshes (each with a cloned material and per-frame JS position/alpha updates) with Babylon.js `ParticleSystem` per torch. Each system emits 3 particles/sec with GPU-driven lifetime, color fade, and additive blending. Ember texture generated at runtime via `DynamicTexture` (32×32 radial gradient). Distance-based start/stop within 30 units.
- **Torch pickup freeze fix**: no longer removes lights from clustered container (was triggering WebGPU pipeline recompilation). Parks picked torch lights at y=-200 with intensity 0 instead.
- **Stone material caching** (`projectiles.js`): reuse single PBR material across all thrown stones (was creating new material per throw, causing WebGPU pipeline stall).
- **Pre-warm meshes**: held torch and stone material pipelines compiled during loading screen, not on first use.
- **Static mesh freeze**: `freezeWorldMatrix()` on 12 merged static meshes (ground, walls, floors, roofs, vegetation).
- **Pointer-move picking disabled**: `scene.skipPointerMovePicking = true` — game uses custom raycasting.
- Added `t._lit` flag to track torch visibility before shadow slot zeroing — fixes old bug where embers were hidden for the nearest torches (shadow slot assignment zeroed their clustered light intensity).
- **Shadow torches reduced from 3 to 1** — each point light shadow = 6 cube face passes. 1 shadow torch is sufficient for indoor atmosphere.

## 2026-02-26

### Enhance torch visuals
- **Billboarded glow halos** (`torches.js`): added soft radial-gradient `DynamicTexture` (128px) for a camera-facing halo plane behind each torch flame. Uses additive blending for a warm glow aura.
- **Teardrop flame shape** (`torches.js`): torch flame spheres scaled to 0.8x1.4x0.8 for a taller, more natural teardrop silhouette.
- **Flashy embers/sparks** (`torches.js`): overhauled ember `ParticleSystem` — brighter white-hot→orange→red color gradient, wider angular speed (±6 rad/s swirl), velocity damping over lifetime, and size gradient from 0.02→0.05→0.01 for spark-like appearance.
- **Robust particle management** (`torches.js`): timer-based distance check (every 0.5s) for starting/stopping ember systems within 30 units. Ensures particles don't accumulate on distant torches.
- **Day/night torch sync** (`daynight.js`): torch halo and flame visibility tied to day/night cycle brightness.

### Full-screen loading sequence
- **Robust loading screen** (`main.js`, `styles.css`): redesigned loading sequence with full-screen overlay, progress bar, and warm-up rendering phase. Scene renders several frames before hiding the loading screen to prevent flash of unrendered content.

### Gerstner wave ocean shader
- **Animated ocean** (`terrainMeshes.js` or shader): replaced flat transparent water plane with custom `ShaderMaterial` using Gerstner wave vertex displacement on a 128x128 subdivided mesh with 4 overlapping wave patterns.
- **Fragment shader effects**: Fresnel reflection, Blinn-Phong sun specular, fake subsurface scattering (SSS), and manual linear fog matching the scene.
- **Game time sync**: wave animation syncs with game time including fast-forward (Q key).
- **Y-clamp**: prevents wave peaks from poking through terrain at shoreline edges.

### Fix stuck state on pointer lock failure
- **Pointer lock resilience** (`main.js`, `controls.js`): async `buildWorld()` could cause the click gesture to expire, making `requestPointerLock()` fail silently — leaving the user stuck on a blank 3D scene with no UI.
- Set `gameStarted=true` immediately after `buildWorld` so the game loop activates regardless of pointer lock (clicking canvas re-locks later).
- Export `setGameStarted()` from `controls.js` for `main.js` to call.
- Wrapped `buildWorld()` in try/catch to restore menu UI on build failure.

### Torch floor-cull and lighting fixes
- **Floor-cull keeps embers/flames visible** (`torches.js`): floor-cull now only zeros PointLight intensity for torches on a different floor than the player. `_lit` flag stays true (based on `baseIntensity`) so ember particles and emissive flame meshes remain visually active even when the light is culled. Previously embers stopped and torches looked "dead" on floor transitions.
- **Robust floor-cull trigger** (`torches.js`): changed condition from `if (isInside)` to `if (isInside || _stablePlayerFloor > 0)` — ensures floor-cull always activates when player is on any upper floor, even if the grid cell check fails near wall edges.
- **Shadow slot warm-keeping** (`torches.js`): inactive shadow slots now keep `shadowEnabled=true` with `intensity=0.001` instead of toggling `shadowEnabled=false`. Prevents ~1 second WebGPU pipeline recompilation freeze when transitioning between floors.
- **Sun shadow bias tightened** (`lighting.js`): reduced `normalBias` from 0.02 to 0.01 and `bias` from 0.005 to 0.003. Reduces light strips at wall-ceiling junctions caused by shadow sampling pushed along surface normals at 90° corners.
- **Roof-wall overlap** (`walls.js`): both flat and slant roofs now extend 0.15 units below the wall top. Eliminates the visible light strip at the interior wall-ceiling junction where sun shadow bias created a gap.

### Clustered lighting fix and torch placement improvements
- **Fix clustered lighting** (`torches.js`): removed redundant `scene.removeLight(light)` before `_container.addLight(light)`. The `ClusteredLightContainer.addLight()` already handles removing lights from the scene's standard list — our extra call was stripping `mesh._lightSources` references, causing non-shadow-slot torches to produce no visible light. Torches no longer "turn off" when the player walks away.
- **Removed floor-cull** (`torches.js`): with clustered lighting working properly, floor-cull logic (`_stablePlayerFloor`, `_floorChangeTimer`, `isInside` check) removed entirely. Clustered lighting handles unlimited lights efficiently.
- **MAX_SHADOW_TORCHES increased to 2** (`torches.js`): two nearest torches get shadow-casting PointLights for proper wall occlusion.
- **Indoor floor torch placement** (`torches.js`): added `isInsideBuilding` check — when player is inside a building, uses building floor level (`playerFloorY`) instead of terrain height for ground placement. Enables placing torches on 2nd floor surfaces.
- **Ceiling height check** (`torches.js`): wall and door torch placement now rejects positions where the torch tip (`y + TIP_UP`) would clip through the per-floor ceiling. Prevents placing torches that emit no visible light because they're above the ceiling plane.
- **Flat roof backface culling** (`walls.js`): set `flatMat.backFaceCulling = false` so flat roof bottom face is visible from inside buildings (looking up at ceiling no longer shows sky).
- **Camera eye clamp** (`player.js`): increased first-person ceiling margin from 0.15 to 0.35 to prevent camera clipping into attic space.
- **Double-click guard** (`main.js`): added `building` flag to prevent Play button double-click from building the world twice (was causing 800+ meshes and 9000+ draw calls).

### Menu campfire overhaul
- **Locked menu to campfire scene** (`menu.js`): removed 4 unused templates (shelter, lakeside, forest, rocky) and TEMPLATES array/localStorage random selection. Menu always shows campfire; randomizes character (fox/soldier), tree placement, and summer/winter biome.
- **ParticleHelper fire preset** (`menu.js`): replaced 5 billboard flame planes + 12 manual ember meshes with `ParticleHelper.CreateAsync("fire")` from Babylon.js CDN, scaled to 0.25x. Added `NoiseProceduralTexture` export to `babylon-entry.js` (required by fire preset).
- **Bloom + ACES tone mapping** (`menu.js`): added `DefaultRenderingPipeline` with bloom (threshold 0.8, weight 1, kernel 64) and ACES tone mapping (exposure 1.2) for fire glow effect.
- **Upgraded campfire geometry** (`menu.js`): 12 evenly-spaced flattened stones in ring, 2 flat crossed base logs + 3 leaning teepee-style logs, subtle charred base disc.
- **Fire particle delay** (`menu.js`): fire particles load from CDN but don't start until 10+ frames rendered, preventing floating fire on dark background before geometry is visible.
- **Campfire collision** (`menu.js`): collision radius 1.2 blocks character from walking into fire circle. Trees avoid >2 units from center, rocks >1.5 units. Character spawns 2.0–2.5 units away.
- **Enhanced light flicker** (`menu.js`): layered sine waves + random chaos + occasional bright flash spikes + color temperature shift on main light.
- **Removed unused code** (`menu.js`): `buildShelter`, `setupShadows`, `wallMat`/`roofMat`, `StandardMaterial`/`DynamicTexture`/`DirectionalLight`/`ShadowGenerator` imports, ember core mesh.
- **Saved custom fire backup** (`campfire-custom-particles.bak.js`): custom 4-layer ParticleSystem fire effect (fire core, flame tips, embers/sparks, smoke) with procedural DynamicTextures and enhanced flicker, in case we want to revisit it later.


## 2026-02-27

- **Door torch placement overhaul** (`torches.js`, `doors.js`): Replaced grid-based door detection with ray-plane intersection against actual door panel geometry. Torches can now be placed flush on either side of a door regardless of whether it's open or closed. The torch moves with the door when it opens/closes.
  - Added `findDoorPanelHit()` — tests both faces of every door panel using ray-plane intersection, with bounds checking along the panel and vertical limits
  - Added `getAllDoors()` export to `doors.js` for iterating door panels
  - Modified `findPlacementTarget()` to compute door panel hit first, then ray-march for walls/ground; door hit returned if no closer surface found
  - Simplified grid-based `isDoorCell` handler to only handle lintel (above-door-gap) placement; door panel case now handled by `findDoorPanelHit`
  - Fixed stick rotation on door re-parenting: world normal is now converted to door-local space via `Vector3.TransformNormal` with the inverse world matrix, so the tilt stays correct as the door rotates
  - Added `doorGroup.computeWorldMatrix(true)` before re-parenting to ensure fresh matrix when door is mid-rotation

## 2026-02-28

- **Fix z-fighting at building corners** (`walls.js`): eliminated wall geometry overlap at corner posts to remove flickering artifacts
- **Clamp torch particle systems at ceiling** (`torches.js`): ember, spark, and smoke particles now killed at the per-floor ceiling Y to prevent visual leaking from 1st floor torches into the 2nd floor

## 2026-03-01

- **Make 2-story stairs flush with walls and floor** (`floors.js`, `staticPhysics.js`): stairs now extend to adjacent perimeter walls with no gaps; fixed mid-floor z-fighting between overlapping slab and stair geometry
- **Fix player character stuck in walk/run animation** (`modelLoader.js`): resolved animation state not resetting when player stops moving
- **Line-of-sight checks for all interact targets** (`physics.js`, `torches.js`, `flowers.js`, `vegetation.js`, `furniture.js`, `npcAI.js`, `projectiles.js`): Fixed bug where items could be picked up or interacted with through solid walls/floors (e.g. grabbing torches inside a building from outside, sleeping in a bed on the 2nd floor from the 1st floor)
  - Added generic `hasLineOfSight(from, to)` to `physics.js` — casts a Havok physics raycast between two points and returns false if any solid body (wall, floor, roof, door, stairs) blocks the path
  - Applied LOS check to all 6 `getNearest*` functions: `getNearestPickableTorch`, `getNearestFlower`, `getNearestPickableRock`, `getNearestInFlightRock`, `getNearestSoldier`, `getNearestBed`
  - No indoor/outdoor heuristics — purely physics-based obstacle detection
- **Fix torch light bleeding from 1st floor into 2nd floor** (`torches.js`): torch PointLights on one floor no longer illuminate geometry on adjacent floors

## 2026-03-03

- **Per-building-side wall meshes** (`walls.js`, `windows.js`): Replaced per-cell box wall geometry with per-building-side continuous meshes using horizontal band decomposition. Each wall side (N/S/E/W) is now a single flat slab with rectangular cutouts for doors/windows, built directly in world space with triplanar UVs. Eliminates all texture stitching seams between adjacent wall sections. EW walls span the full Z range including corners so perpendicular walls mutually seal each other. Walls are 0.01 thicker than nominal to cover sub-pixel cracks at corner edges. Window glass/frame positioning simplified to cell centres.
- **Single-mesh stair geometry** (`floors.js`): Replaced 8 overlapping CreateBox calls per staircase with single-mesh VertexData geometry (treads, risers, side profiles, back wall, bottom face). Eliminates z-fighting between coplanar internal stair faces.
- **Stair torch shadow casters** (`floors.js`, `main.js`): Registered merged stair mesh with `addTorchShadowCaster` so indoor torch light casts proper stair-shaped silhouettes on nearby walls.
- **Fix torch pickup in 2-story buildings** (`staticPhysics.js`, `physics.js`): Mid-floor physics slabs now use `CEILING_COLLISION_GROUP` (previously defaulted to `GRP_DEFAULT` because the collision group parameter was omitted). The `hasLineOfSight` raycast excludes `GRP_CEILING`, so torches inside 2-story buildings are now reachable.
- **Fix torch glow halo not following door rotation** (`torches.js`): Billboard-mode glow meshes don't correctly inherit parent rotation for positioning in Babylon.js. Glow is no longer parented to the door group; instead its world position is synced from the flame's absolute position every frame in `updateDoorTorchPositions`.

## 2026-03-05

- **Refactor torches.js** into 5 focused modules: `torchLighting.js` (clustered lights, shadow generators), `torchParticles.js` (embers/smoke/sparks, flicker, shadow slot management), `torchPlacement.js` (preview, ray-march, door panel placement), `torchHeld.js` (first-person held torch), and `torches.js` (core: mesh creation, materials, world placement, pickup). All external imports unchanged via re-exports from `torches.js`.
- **Fix torch placement on nearby walls**: invalid ground hit no longer aborts the entire placement search; ray continues to find wall targets behind it.
- **Fix torch placement on ambiguous walls**: corner-hit rejection (`return null` when both X and Z axes hit non-walkable) replaced with dominant ray-direction normal selection, allowing torch placement on walls in small buildings.

## 2026-07-16

- **AAA visual effects overhaul** (`feat/aaa-visuals`): volumetric fog, procedural sky, weather, water reflections, post pipeline — all individually toggleable via new `CFG.GFX` block, verified on WebGPU and WebGL2.
  - **Procedural sky dome** (`src/core/skyDome.js`): camera-following inverted sphere with atmosphere gradient, 3-octave domain-warped fbm clouds (coverage/darkness driven by weather), hash-based twinkling stars, moon, sunset scatter wedge, lightning flash tint, horizon fog merge. Replaces the flat `clearColor` sky.
  - **Volumetric height fog + god rays** (`src/core/postfx.js`): custom PostProcess sampling a DepthRenderer (camera-space Z) — analytic exponential height fog integrated from a fog-start offset (interiors stay clear), Schlick-phase sun in-scatter, 24-tap screen-space god rays over the depth sky mask. Fog density/color still driven by `daynight.js` fogStart/fogEnd so weather and day/night modulate it. Scene linear fog disabled while active; `CFG.GFX.VOL_FOG=false` restores the legacy path (ocean shader keeps a `uUseShaderFog` fallback).
  - **Weather system** (`src/systems/weather.js`, `src/systems/rainFX.js`): CLEAR/OVERCAST/RAIN/STORM state machine with weighted transitions and 8–20 s cross-fades, publishing a modifier object consumed by `daynight.js` (sun/hemi/fog/sky desaturation), the sky dome, and rain FX — weather never writes scene properties directly. Player-following rain (stretched-billboard streaks) with per-particle roof/ground kill via a baked grid surface map, splash rings driven by `manualEmitCount` queue, snow variant with noise drift in snow biome (STORM = blizzard), lightning double/triple-flash envelope riding the hemi light + sky/cloud tint. Debug: `window._weather.set('STORM')`.
  - **Water upgrade** (`src/world/terrainMeshes.js`): half-res planar `MirrorTexture` reflections (projective UV in the ocean shader, alpha-coverage sky fallback, refresh every 2nd frame), baked 512² R8 terrain-height texture for animated shoreline foam + soft shore alpha + shallow tint, Gerstner-Jacobian crest foam, procedural fbm detail normals with distance fade, cell-jittered sun glitter.
  - **Post pipeline** (`src/core/postfx.js`): DefaultRenderingPipeline with bloom, FXAA, MSAA 2, sharpen; GlowLayer (512, includeOnly) on torch flames with night-scaled intensity. Image processing deliberately stays INLINE on materials — running ACES as a post-process operates on linear values and crushes mids (empirically verified), so the pipeline's IP pass is disabled. SSAO2 and 3-cascade CSM are implemented but OFF by default (SSAO: invisible on flat-shaded low-poly for a real cost; CSM: re-renders every caster per cascade, +~2600 draws — same reason it was removed once before).
  - **Event-driven shadow refresh** (`src/core/lighting.js`, `src/world/torchLighting.js`, `src/world/torchParticles.js`): sun shadow map now re-renders only when the player crosses a 2-unit snap cell, the sun direction changes, or an 8-frame heartbeat fires (moving NPCs); torch shadow cubes refresh on slot reassignment + staggered heartbeat. Cuts steady-state draw calls from ~2700 (main) to ~1400 with all effects on.
  - **Doors switched PBR → StandardMaterial** (`src/world/doors.js`): PBR doors rendered desaturated blue-grey (looked transparent against fog at distance) — pre-existing issue on main, same family as the documented PBR/right-handed problems.
  - **Misc**: `?webgl` URL param forces the WebGL2 engine for testing; `window._cfg`/`window._gfx`/`window._dbg` debug hooks (GFX toggles, setTime/look/pos); grain rejected during review (noise), vignette dropped with the IP pass.
  - **WebGPU gotcha discovered**: the GLSL→WGSL preprocessor splits declaration lines on `;` even inside `//` comments — a comment like `// 1 = on; 0 = off` after a uniform produces "syntax error, unexpected INTCONSTANT". Never put semicolons in comments on GLSL declaration lines.

## 2026-07-16 (later — visual fixes, Babylon 9, FPS work)

- **Post-review visual fixes** (uncommitted follow-ups to the AAA PR): removed the cell-quantized water sun glitter (read as pixelated squares at grazing sun angles — the pow-256 specular + detail normals shimmer enough); wrapped hash inputs (`mod(p, 289)`) in the water and sky shaders to stop float-precision checkerboarding; softened sky cloud domain-warp and faded fair-weather wisps; MSAA 2→1 + bloom/sharpen off by default (MSAA'd scene edges vs single-sampled fog depth produced crawling fringes on tree silhouettes); GlowLayer off by default (additive screen-space glow has no depth occlusion — bled through walls); mirror refreshRate back to 1 (frame-old planar reflection jerks while moving); fog depth pass switched from a static renderList to a layerMask-aware predicate (kills the player-model ghost in first person).
- **Menu GFX toggles** (`index.html`, `styles.css`, `main.js`): 8 checkboxes on the main menu map to `CFG.GFX` flags (sky, fog, god rays, weather, water reflections, glow, pipeline, bloom), read once at Play.
- **Nicer procedural trees** (`vegetation.js`): jagged lobed canopy tiers with angle-deterministic edge jitter + droop, per-tree hue and per-tier shade via vertex colors (single merged mesh kept), slight trunk lean, randomized tier rotation.
- **Perf instrumentation upgrade** (`main.js`, `lib/babylon-entry.js`): PERF log now attributes draw calls per render target (sunShadow/torch cubes/waterRefl/glow/fogDepth/main) by sampling `engine._drawCalls` inside each RTT's onBefore/AfterRender observables, plus particles/animations/interFrame counters and (attempted) GPU frame time via `EngineInstrumentation`.
- **Babylon.js 8.52.1 → 9.17.0** (`package.json`, `lib/babylon-entry.js`): clean upgrade, zero code changes required beyond dropping the now self-registering `shadowGeneratorSceneComponent` side-effect import. Fixes the half-res water mirror rendering ~558 draws per frame on 8.x (now the expected 7 — renderList only). Effects verified working on WebGPU (fog, sky, weather, reflections, post pipeline).
- **WebGPU throttled-shadow-map bug found and characterized** (upstream Babylon bug, NOT fixed by 9.17): a shadow map with ANY skipped frames between renders (refreshRate=0 + resetRefreshCounter re-arm, or refreshRate 2/8) intermittently re-renders as a bit-exact replay of an earlier pass state, ignoring current uniforms — visible as trees/houses strobing between lit and self-shadowed at the refresh cadence, even standing still. Established via a playwriter screenshot pixel-diff harness (force re-render → capture → pairwise diff): corrupt frames are pixel-identical to each other across bias/cull-mode changes and sessions, proving stale-state replay rather than value noise. NOT fixed by: Babylon 8.56.2/9.17.0, compatibilityMode=true from startup, `_features.checkUbosContentBeforeUpload=false`, drawContext.reset() before re-render, double-rendering per refresh, removing skinned/torch/all-but-static casters. Only every-frame rendering is deterministic on WebGPU.
- **Shadow scheme reworked accordingly** (`lighting.js`, `torchLighting.js`, `torchParticles.js`, `scene.js`):
  - Sun: fixed-size shadow frustum (`shadowFrustumSize` 120, minZ 1, maxZ 200) centered on the player, recentered only when crossing a 2-unit snap cell and texel-aligned in the light's LookAt basis (whole-texel map shifts — no edge crawl or facet strobing while walking). Fixed frustum also frustum-culls casters: full sun pass dropped ~872 → ~120-190 draws.
  - WebGPU: sun + torch cube maps render every frame (correctness). WebGL2: event-driven refresh retained (snap/direction/heartbeat re-arms) — gated on `isWebGPU()`.
  - Torch cubes: per-slot near-torch caster subsets rebuilt on slot reassignment (bounding-sphere distance filter, master list in `torchLighting.js`) — Babylon's per-face culling wasn't dropping the world's 28 door meshes from every 6-face pass; 528 → ~90-276 draws per cube. Parked slots get an empty render list.
  - `?compat` URL param forces engine compatibilityMode for GPU-state debugging.
- **Measured** (no-effects baseline, before → after, same session): 2,455 → ~750-1,100 draws; frame 11.5-13.5 ms → 5.9-6.8 ms mid-investigation with full throttling (60-70 → 100-110 FPS); final every-frame-on-WebGPU scheme lands between those pending Victor's re-measure. 144 Hz target likely needs the WebGL2 throttled path or an upstream fix.

## 2026-07-16 (later still — effects polish round 2 + vegetation)

- **Torch glow through-wall fix** (`postfx.js`, `torchParticles.js`): the GlowLayer composites additively in screen space with no depth occlusion, so flames behind walls bled their halo through. Each flame's glow-layer inclusion is now gated per frame on a physics `hasLineOfSight(camera, flame)` test (plus a 40-unit distance cut). Verified: 35 flames in scene → only the ~6 visible ones stay included.
- **All GFX menu toggles default ON** (`index.html`, `config.js`): glow + bloom were opt-in; glow's through-wall bug is fixed, bloom stays watch-listed for silhouette pulsing.
- **Day/night shadow flicker fix** (`lighting.js`): texel-rounding the frustum center against a ROTATING light basis (cycle on) disagreed between frames by up to a whole texel — the map lurched sideways each frame and shadow bands on walls flickered while standing still. Rounding now applies only while the sun direction is static. Also PCF quality MEDIUM→HIGH and normalBias 0.01→0.025 for the grazing-band acne under roof eaves.
- **Water reflection softening** (`terrainMeshes.js`): `mirror.blurKernel = 24` — the half-res mirror sampled with raw bilinear shimmered during camera motion; blur suits the wave-distorted water and kills the shimmer. Runtime A/B: set `blurKernel = 0` on the `waterRefl` RTT.
- **Vegetation pass** (`vegetation.js`, `terrainMeshes.js`, `config.js`, `main.js`): world no longer reads as bare dirt.
  - Grass tufts: single 5-blade fan mesh drawn ~7,000× via thin instances (1 draw call), clumped into meadows by a smooth sine field, per-tuft earthy olive tint + scale/rotation via instance buffers, up-facing normals so blades take the ground's lighting, no shadows/physics/fog-depth.
  - Bushes (`CFG.BUSHES` 90): 1-3 squashed angle-jagged spheres per bush, per-bush hue + base-to-top shading via vertex colors, merged into one flat-shaded mesh, casts/receives shadows, walk-through (no grid block).
  - Ground tint green-shifted (the sparse-grass texture read as dirt with the old neutral tint); snow biome unaffected (grass skipped, bushes get snow tints).
- **Open**: rotation FPS drop 50→35 with effects on (needs a [PERF] capture while rotating); blank minimap seen in automated runs (unconfirmed on a real session); reflection flicker fix pending visual confirmation.

## 2026-07-16 (evening — live-testing fix batch)

- **Torch glow/light through floors AND walls** (`physics.js`, `torchParticles.js`): root cause — `hasLineOfSight` deliberately excludes the CEILING collision group (mid-floor slabs) for interactions, so torch gating rays passed between floors of 2-story buildings. Added `hasLineOfSightMask(from, to, mask)`; torch light/glow gating now uses a mask that keeps ceilings blocking (and ignores window glass). Also: clustered (shadowless) torch lights now FADE OUT when the camera has no line of sight to them — shadow-slot torches keep unfaded intensity (their cubes occlude properly). LOS raycasts staggered (each torch every 4th frame, cached, 0.25s fade hides staleness).
- **Pause now freezes the simulation** (`controls.js`, `main.js`): `simPause` never zeroed the sim speed — day/night clock, physics, and NPCs kept running behind the pause overlay. Added `isSimPaused()` and gated the loop's speed.
- **ESC camera jerk fix** (`controls.js`): pointer-lock exit delivers one huge synthetic mousemove BEFORE `pointerlockchange` fires (so the existing ignore window wasn't armed) — single-event deltas >200px are now discarded.
- **Grass no longer grows inside buildings** (`vegetation.js`): interior floor cells are walkable in the grid, so grid checks alone let tufts spawn through floor slabs; building footprints now excluded.
- **Pine proportions** (`vegetation.js`): tiers chain upward with spacing < tier height (no more gaps/detached floating tops), canopy starts partway down a taller thicker trunk.
- **Leafy trees v3 — leaf cards** (`vegetation.js`): ~18 alpha-tested textured quads per canopy lobe (procedural leaf-cluster DynamicTexture), radial normals for soft sphere-like shading, merged into one draw call (`mergedLeafCards`, no shadow casting — the solid lobes underneath cast). First step toward the "realistic tech demo" look; next iteration wants a real leaf-atlas texture.
- **Open issues** (tasks): water reflection flicker while walking persists (blur didn't fix); rotation FPS drop; water shore film + hard shadow polygon; bed overhanging stairwell; torch light ring banding; rain surface impacts + water ripples; 20 FPS report pending PERF attribution.

## 2026-07-16 (night — fix round 3)

- **Pause freeze v2** (`controls.js`, `main.js`): the "Click to resume" ESC overlay is the `gameStarted && !pointerLocked && !simPause` state, which by original design KEPT THE GAME RUNNING — reads as broken pause. New `isWorldFrozen()` freezes the sim whenever the desktop pointer is free (any pause overlay); sleep fast-forward takes precedence; mobile unaffected.
- **Objects flickering in water reflections while moving** (`terrainMeshes.js`): meshes were being intermittently frustum-culled from the mirror pass against the REFLECTED camera. The mirror render list (a handful of world-sized merged meshes) now sets `alwaysSelectAsActiveMesh = true` — no culling, no popping. Also added mergedBushes/mergedLeafCards to the reflection list.
- **Leaf cards render fix** (`vegetation.js`): cards facing away from the sun rendered black (no two-sided lighting) and received speckly canopy shadows — they read as a swarm of dark bats. Now `twoSidedLighting`, no shadow receive, slight emissive for foliage translucency, tighter placement radius.
- **`_dbg.tp` partial fix attempt** (`main.js`): low-level `HP_Body_SetQTransform` moves the Havok body (verified via HP_Body_GetPosition) but the node→state sync still doesn't pick it up under manual stepping — needs physics.js surgery, deferred.
- **FPS 22 report**: draws are fine (~700); the regression lives in interFrame (26-33ms, was 8-12 at the 50 FPS reading). Suspects: bloom+glow newly default-ON (weren't in the 50 FPS run), GPU backpressure from added vegetation. Pending A/B from menu toggles.

## 2026-07-16 (late night — quota-sprint batch)

- **Perf regression fixed** (`lighting.js`, `vegetation.js`): PCF QUALITY_HIGH (added earlier today) doubles per-pixel shadow cost scene-wide and, with grass shadow-receive, produced a ~34ms GPU floor (23 FPS). Reverted to MEDIUM (the day/night flicker is handled by rotation-aware texel rounding, not filter width); grass no longer receives shadows.
- **Pause v3** (`main.js`): NPC walk cycles kept playing while frozen (skeletal animations advance on the scene's animatable timeline, not gdt) — `scene.animationsEnabled` now follows the sim speed.
- **Reflection flicker — real cause found** (`terrainMeshes.js`): NOT frustum culling — Babylon 9's RTT renderList path (objectRenderer.js) performs NO frustum culling at all, so the earlier alwaysSelectAsActiveMesh fix was a no-op. Same-pose screenshot diffing proved the mirror renders deterministically; the flicker is the reflection UV distortion using the fbm DETAIL normal, which aliases per-pixel at distance — reflected object silhouettes flip between object and sky every frame. Distortion now uses the smooth geometric wave normal (+ small detail term faded by distance).
- **Torch halo ring banding** (`torches.js`): 128px radial gradient quantized into visible concentric bands under additive blending — now 256px, 16 exponential-falloff stops, per-pixel alpha dither.
- **Shore water film** (`terrainMeshes.js`): height bake 512→1024, foam gate starts AT the waterline, alpha window starts slightly above it — no translucent film or foam band over dry land, and shadows can no longer draw on a film that isn't there.
- **Rain ripples on water** (`terrainMeshes.js`, `main.js`): new `uRainRipple` uniform (rainRate/700 from weather modifiers) drives expanding phase-offset rain rings (two overlapping cell scales) perturbing the water normal. Splash-on-surface visual tuning for rain streaks still open.
- **Trees v4** (`vegetation.js`): leaf cards are now the canopy surface — 40 per lobe over the full sphere, denser leaf-cluster texture (170 leaves), inner lobes darkened to read as the canopy's shadowed core.
- **Bed placement** (`furniture.js`, via subagent): the mid-floor stairwell hole is implicit (reconstructed from `b.stair` mirroring floors.js's 4-slab math) and LARGER than the stair cells; the primary 2-story bed path had no stair check at all. New `getStairOpeningRect`/`overlapsStairOpening` helpers gate all three upper-floor bed paths with a half-cell margin.
- **`_dbg.tp` works now** (`main.js`): teleports via the Havok plugin's `HP_Body_SetQTransform` (manual stepping skips the node→body pre-step sync that the old node-position write relied on).

## 2026-07-17 (early — GPU floor + majors round)

- **THE FPS FLOOR FOUND** (`postfx.js`, `skyDome.js`): interFrame sat at a constant ~26ms even in near-empty views and even while paused — a view-independent full-screen GPU pipeline cost. The 50 FPS reference run had volumetric fog OFF; every 23 FPS run had it ON. Fixes: fog+god-ray post-process now renders at HALF RES (quarter the ray-march pixels, composites identically); sky dome clouds (9 fbm evals/pixel) now early-out below the horizon and in clear skies; stars skip entirely by day.
- **Pause: rain kept falling / water "abstract effects" kept animating** (`main.js`): particles self-animate — pause now zeroes every particle system's updateSpeed (and restores on resume), freezing rain streaks/splashes/embers in place without hiding them.
- **ESC camera jerk (2nd fix)** (`controls.js`): junk deltas can arrive as several MODERATE events before pointerlockchange — the mousemove ignore window is now armed on the ESC/Tab/Pause keydown itself, plus the existing >200px single-event filter.
- **Torch halo near windows** (`torchParticles.js`): the glow gate ignored window glass (correct for light, wrong for the screen-space halo — the ray threads the glass while the flame is screen-occluded, blooming onto the wall). Glow now requires strict LOS; the light fade keeps passing glass.
- **Objects flicker in water reflections (3rd attempt)** (`terrainMeshes.js`): shore-level houses/rocks straddle the mirror clip plane at WATER_Y-0.05 — walking head-bob clipped them in/out of the reflected pass per frame. Plane lowered to WATER_Y-0.4.
- **Trees v5** (`vegetation.js`): visible canopy blobs REMOVED per Victor's direction — lobes became invisible shadow proxies on a hidden layer (0x20000000, same trick as the 1st-person player model; shadow maps ignore camera layer masks), cards fill the crown volumetrically (70/lobe, radius 0.35-0.95). Distant density may need another pass.

## 2026-07-17 (round 5 — fog-ghost trees, flat splash rings, res regression)

- **"Half-transparent giant trees" / "big tree in the background"** (`vegetation.js`): both were the same bug — leaf cards were never in the volumetric fog DEPTH pass, so the fog sampled the SKY behind them and fogged entire crowns into huge translucent ghosts. The old opaque lobes had been providing that depth; hiding them exposed it. `addFogDepthMesh(mergedLeafCards)` fixes both.
- **Resolution regression reverted** (`postfx.js`): the fog PP is the FIRST post-process, and the first PP's ratio defines the render target the whole scene draws into — my 0.5 "optimization" rendered the entire game at half res. Ratio back to 1.0. Critically: FPS did NOT improve at quarter pixel count → the ~26ms floor is NOT pixel-bound.
- **GPU adapter verified** (in-page): NVIDIA Lovelace (the 4070 Ti) — wrong-adapter theory ruled out. The decisive FPS A/B (fog checkbox off) still pending from Victor.
- **Rain splash rings lie flat now** (`rainFX.js`): they were default camera-facing billboards — circles floating in the air ("screen effect"). Non-billboard particle quads lie perpendicular to the particle direction (verified in the particle vertex shader), so direction (0,1,0) + isBillboardBased=false + epsilon emit power = rings on the ground.
- **Torch glow near windows** (`torchParticles.js`): halo gate now requires strict LOS (glass blocks the ray for the halo, still passes it for light).
- **`window._noFreeze` escape hatch** (`controls.js`): the new pause-freeze made every automated (pointer-lock-less) session freeze — the flag re-enables simulation for testing.
- Reflection object-flicker: still unresolved (clip-plane lowered to WATER_Y-0.4 this round; fixed-pose repro under per-frame position writes is the next experiment via the new hatch).

## 2026-07-17 (round 6 — the fog depth pass, measured)

- **In-tab automated FPS bisect** (playwriter, focused tab, phased subsystem kills with rAF sampling): glow/pipeline/fog-PP each ~0ms; **fog DEPTH pre-pass ~13ms/frame** (19.6→26.2 FPS on disable); mirror/shadows/sky/water/vegetation ~1ms combined. Caveat: ran during an active STORM, which itself caps ~27 FPS — weather is the next bisect axis.
- **Fog depth pass slimmed** (`postfx.js`): interior geometry (floors/mid-floors/stairs) and all 28 door meshes removed from the list (fog starts past interior distances by design — they contributed nothing), and the pass now uses `getCustomRenderList` with per-frame frustum culling + layerMask check (Babylon 9 RTTs do no culling of their own; the old renderListPredicate also scanned every scene mesh per frame). Measured: 269 → 64 draws.
- **ESC camera jerk (3rd fix — rewind)** (`controls.js`): Chrome's native ESC unlock can skip the page keydown entirely and spray moderate junk deltas no pre-filter reliably catches. New approach: a yaw/pitch history ring; on any pointer unlock the camera REWINDS to its pose 150ms before the unlock, retroactively erasing the jerk.

## 2026-07-17 (round 7 — THE performance fixes, fully attributed)

- **Loop instrumentation** (`main.js`): [PERF2] per-section ms/frame buckets (phys/move/step/sync/kick/player/env/misc/world/render/hud). This attributed the entire mystery floor in two iterations.
- **Static-body sync waste** (`physics.js`): HavokPlugin.executeStep calls `sync()` on EVERY body without `disableSync` after every substep — 614 static bodies were getting body→node transform syncs up to 10× per frame (30-60ms measured). All five static-body helpers now set `body.disableSync = true`. MAX_STEPS 10→3 (substep death-spiral guard: more substeps → lower FPS → more dt → more substeps).
- **Camera raycast triangle explosion** (`vegetation.js`, root cause of the 50→23 regression): `updatePlayer`'s camera-collision `multiPickWithRay` tests every triangle of every pickable mesh — today's vegetation (leaf cards ~40k tris, lobe cores ~57k, bushes ~30k) shipped pickable. Measured 34.4ms/frame in updatePlayer; `isPickable = false` on all vegetation merges (incl. pine canopy) → 7.3ms.
- **Minimap static layer cached** (`hud.js`): 6,400 grid fillRects + water + buildings now draw once to an offscreen canvas; per-update work is a drawImage + dots. (Was already outer-throttled to every 10th frame — real but secondary.)
- Combined with round 6's fog-depth fix, the attributed reclaims: ~30-60ms statics sync + ~27ms raycasts + ~13ms fog depth per frame. Victor to re-measure; expect a multiple of the 22-26 FPS baseline.
- Victor's console also showed WebGPU "Destroyed texture ... SwapBufferProvider" validation errors on frames 27-38 (menu→game transition) — teardown noise, benign so far, watch.

## 2026-07-17 (round 8 — cards-only foliage everywhere, commit prep)

- **Pines + bushes are cards-only now** (`vegetation.js`, per Victor's direction): cones/blobs demoted to hidden shadow+fog-depth proxies like the leafy trees; needle cards cover the whole tier surface (15/tier, needle-cluster texture), bush cards 16/bush. Pine cones keep writing fog depth via a `__fogDepthAlways` flag (the depth pass's layerMask check would otherwise ghost pines into the sky).
- **Proxy layer bit collision fixed**: proxies were on 0x20000000 — the 3rd-person player-model bit that CAMERAS INCLUDE (0x2FFFFFFF) — so all "hidden" proxies rendered. Proxies now use 0x40000000, which no camera mask ever contains.
- **Mirror render list** swapped to card meshes (RTT renderLists ignore camera layer masks — proxies would reflect as phantom blobs).
- **Doors restored to the fog depth pass** (closed doors in doorways silhouette against outdoor sky — they fogged half-transparent without a depth entry). Cheap now that the pass is frustum-culled.
- **Sun shadow: continuous texel-lattice follow on WebGPU** (`lighting.js`): the 2-unit snap re-framed the map in 34-texel jumps and the eave-shadow band flickered at every crossing while walking; the lattice keeps the map's world-space texel grid stationary. Bias dropped (0.002/0.012) — the higher values opened a lit "shadow gap" strip under eaves (peter-panning) and their acne-flicker rationale is fixed structurally.
- **Module cache gotcha (testing)**: `page.reload()` can serve stale ES modules; refresh via `fetch(url, {cache:'reload'})` over performance resource entries before reloading.

## 2026-07-17 (round 9 — pine anatomy, fog-in-houses, village kickoff)

- **Semitransparent cone ghost on firs** (`postfx.js`, `vegetation.js`): the hidden pine-cone proxy wrote fog depth (`mergedCanopy` in DEPTH_PASS_MESHES + `__fogDepthAlways`) beyond the needle cards' coverage — the fog shaded a translucent cone against the sky. Cones removed from the fog depth pass entirely; the needle cards (already in the pass) match the visible foliage exactly.
- **Fog inside houses during storms** (`postfx.js`): storm fogMul shrank fogStart below room depth, so the ray integral accumulated fog indoors. Integration start now clamped to >= 13 units (rooms are < 12 across) — interiors stay clear in any weather, outdoor storm fog unchanged past that range.
- **Pine anatomy** (`vegetation.js`): branch whorls (3 bark branches per tier, drooping like real firs), upper trunk segment through the crown (the base trunk ended mid-canopy and the tip floated), darker blue-green fir palette, and a rewritten needle texture — sprigs (central twig + 22 alternating side needles that sweep toward the tip) instead of asterisk starbursts.
- **Bush anatomy**: 3-5 bark twigs fanning up out of the ground under the leaf cards (mergedBushTwigs).
- **Village layout feature started** (subagent): road network + road-facing doors + standing road torches, in src/world/roads.js + generator/grid changes.

## 2026-07-17 (round 10 — fir proportions, real interior fog fix)

- **Broken firs** (`vegetation.js`): branch poles scaled with the tree (up to ~4u bare horizontal sticks) and taller pine scales blew crowns to 3x house height — branch length hard-capped at 0.8u pre-scale and thinner, pine scale/trunk ranges reduced, tier stack tightened (0.36-0.46 spacing), needle cards denser (20/tier) and larger.
- **Interior fog, the REAL fix** (`postfx.js`, `main.js`): the fogStart clamp only helped the room the CAMERA was in — looking into a room from outside still fogged it. The fog shader now takes up to 16 building-interior AABBs (uBoxMin/uBoxMax/uBoxCount, packed from getBuildings() after world gen) and analytically SUBTRACTS in-building ray segments from the height-fog integral (ray-AABB slab tests + the same closed-form segment integral). Interiors are fog-free from any viewpoint in any weather; the fogStart clamp is reverted so outdoor storm fog hugs the player again.

## 2026-07-17 (round 11 — village layout landed, fir sprays, docs)

- **Village layout** (subagent, `roads.js` new + `generator.js`/`grid.js`/`main.js`/`config.js`): main road carved outward from near-center in both directions + 2-3 branches, greedy axis walker with lateral detours around lakes; buildings seeded FROM road cells with primary doors forced onto the road-facing wall (validated 40/40 generated worlds in Node); merged dirt-ribbon mesh (procedural seamless dirt texture, terrain-conforming); standing road torches via the existing ground-torch path (clustered light, embers, pickup). Verified in-browser: road winds past houses with lit torches — reads like a village. Vegetation/rocks/grass exclude road cells (isRoadCell/isNearRoad).
- **Fir sprays on branches** (`vegetation.js`): needle cards now attach ALONG the 5 branch whorls per tier (2 per branch, nearly flat, rolled so the DIRECTIONAL spray texture points away from the trunk) — free-floating random-facing cards read as debris. Needle texture rewritten as one long twig with 34 alternating side needles. Fir trunks perfectly straight (lean is leafy-only — it broke the base/upper trunk joint). Fir GROVES: pines cluster around ~3 grove centers instead of scattering (conifers grow in stands).
- **Ceiling fog ghosts** (`postfx.js`): mergedMidFloors restored to the fog depth pass — 1st-floor ceiling pixels whose ray exits through a 2nd-floor window read sky depth and fog painted ghost windows + diagonal fog lines on the ceiling.
- **Torch-through-slab**: 3rd shadow slot (cubes are ~70 draws each with subset lists) — covers multi-torch buildings where the ceiling-mounted torch missed the 2-slot budget.
- **Leafy card overdraw trimmed** (70→50/lobe, smaller) after the sub-50 FPS report.
- **`_dbg.tp` actually fixed**: getPlayerBody() returns the wrapper — the raw body is `wrapper.havokBody`. Also requires `window._noFreeze = true` in automated sessions (the new pause-freeze stops the body→state sync).
- **README + CLAUDE.md updated**: Babylon 9, village layout, card foliage system, visual-effects feature list, and a new "Rendering & Performance Rules" section in CLAUDE.md encoding every hard-won landmine from this session (disableSync, isPickable, WebGPU shadow every-frame, fog depth rules, proxy layer bit, first-PP ratio, interior fog boxes).

## 2026-07-17 (round 12 — cobblestone village, fir v5, roof fascia)

- **Road system v2** (subagent, `roadNetwork.js` new + `roads.js` rewritten + `generator.js`/`config.js`; harness `tools/validate-roads.mjs`, 60/60 worlds pass): smoothed centerlines (Chaikin x2 + 0.45u arc-length resample) extruded as crowned ribbons (7cm drainage crown) with per-vertex terrain heights (roads visibly climb 3-5u), procedural seamless wrapped-Voronoi COBBLESTONE texture, door spurs curving to each road-facing door, 2-3 grass cells clearance from walls, branch/spur Y-lift dedup at junctions, half-disc end caps. Root cause of the old road hole: the RENDERED ground (64-subdiv lattice) over/undershoots the analytic heightmap by cm — road verts now conform to max(analytic, both lattice triangulations) + adaptive clearance probing. Old per-cell quads (stepped seams, square corners) gone by construction.
- **Standing torch posts**: tapered bark posts (merged 'roadPosts', shadow + fog-depth casters) with a standard wall-sconce torch mounted at the top — full house-torch behavior (pickable, embers, LOS gating, shadow slots) and registered with the door-torch day/night lists (off by day, lit at dusk).
- **Fir v5**: crown cones VISIBLE again (dense solid tiered silhouette per the user's real-fir reference — sprays alone read as whorls on a pole), crown starts at 35% trunk height, wider base (r 1.05-1.35), 5-7 tiers; needle sprays kept as edge fringe; needle texture given solid mip-surviving backing wedges (thin alpha-tested lines vanish at distance — the "bare pole" cause). mergedCanopy back in fog depth + mirror lists.
- **Roof eave stripe fixed** (`walls.js`): slope plane grazed the wall top corner exposing a lit stone strip — roof raised 6cm above the wall top with new fascia boards (0.45u) sealing eaves and gable ends.
- **Torch placement blocked on road cells** (`torchPlacement.js`).

## 2026-07-17 (wrap-up — round 13 fixes committed; two agent workstreams in flight)

- Committed: cobblestone road system v2 + validation harness (tools/validate-roads.mjs), fir needle-mass crown texture (fir look overall TABLED — user unsatisfied, task noted), road torch posts reject boulder collisions, rocks/bushes keep a full cell from roads, stair-top north-wall window guard (see-through stairs), roof fascia + raised slant roofs (eave stripe), torch placement blocked on roads, torch-in-boulder fix.
- IN PROGRESS at wrap-up (not committed): (1) road generation inversion to curve-first splines with bounded curvature + edge pinning + downward skirts (grid-carve-then-smooth produces snake wiggle; ribbon floats on convex slopes), (2) fancier per-building wall styles (stone/plaster/timber) + trim mesh (corner posts, beams, lintels, sills). Both were being built by subagents when the session hit quota.

## 2026-07-17 (round 14 — curve-first roads + wall styles landed)

- **Road generation inverted to curve-first** (subagent, `roadNetwork.js` full rewrite + `roads.js`/`generator.js`/`config.js`; harness rewritten, 50/50 + 40/40 worlds pass): the road IS a Catmull-Rom spline now — grid cells are derived from it, not the other way around. Main road spans two map-edge anchors (offset so it passes near but not through spawn) with 3-5 perpendicular-jittered controls; a constraint solver pushes controls off water/margins/spawn and relaxes any bend under the 6u minimum radius. Branches start exactly ON main-curve samples heading perpendicular; door spurs curve from the nearest road sample to 1.5u under each road-facing door (building-crossing rejection + straight-chord fallback). Cells within ROAD_WIDTH/2+0.6 of any sample are rasterized for all existing gameplay integrations (walkability, vegetation/torch exclusion, building seeding — untouched). Building wall clearance now measured from the true curve (`roadDistanceToRect` ≥ 4u).
- **Road float/underside fixed**: ribbon outer edges pinned BELOW the visible ground (min of analytic + lower lattice triangulation − 3cm) so only interior rows carry the crown — bedded-road cross-section; each edge extrudes a 0.3u vertical cobble skirt (own normals + vertical UVs, rings under end caps). Measured worst edge-to-ground gap across 50 worlds: 0.186u — undersides can no longer be exposed.
- **Torch posts on splines**: `computeTorchSites` walks the curves by arc length (~18u spacing, alternating sides at ROAD_WIDTH/2+0.8) with geometric clearance from every centerline — the old cell-based rejection sat inside the raster band and starved sites to 3-4/world; now 6-10. Boulder-collision rejection kept.
- **Fancier walls** (subagent, `walls.js` + `config.js`): per-building style via styleFor(index) — stone (unchanged) / plaster (0.015u-proud skin mesh `wallsPlaster` over the stone, stone base course below y=0.8) / timber (braces + beams). One merged `wallTrims` mesh adds door surrounds, window sills + lintels, corner posts, story beams. +2 draw calls, 3 wall materials; 35,698 piece checks passed in its Node harness. Known limit: wallsPlaster not yet in the water-mirror render list.
- Boot-verified in browser: zero pageerrors, roads/roadPosts/wallsPlaster/wallTrims all live, sweeping cobble bend beds into the grass with no floating edge.
