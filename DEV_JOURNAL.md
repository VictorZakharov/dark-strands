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
- **Ceiling raycast clamp** (`player.js`): added upward raycast in `syncPlayerFromPhysics()` as a safety net for floor/roof pass-through. Casts from near feet to above head; if a ceiling is detected within PLAYER_H, clamps player position down and zeroes upward velocity. Works regardless of cannon-es collision detection behavior.
- **Slope sliding fix v2** (`player.js`): when grounded and not moving, now zeroes ALL velocity AND applies upward force equal to gravity (`mass * GRAV`). This fully counteracts gravity during the physics step, preventing any sliding on slopes. Skipped when Space is pressed (for jump).
- **Rock-on-rock knockback** (`projectiles.js`, `vegetation.js`): fast-moving projectiles (speed > 2) check proximity to pickable pebbles via `getPickableRockNear()`. On hit: deactivates the static rock, removes its physics body, spawns a new dynamic projectile at the rock's position with 60% of the impacting projectile's horizontal velocity + upward pop. Original projectile slowed to 30%. `deactivateRock()` exported from vegetation.js.
- **Tree foliage damping** (`projectiles.js`, `vegetation.js`): tree positions + scale stored in `treePosData[]` during `placeTrees()`. New `getTreeFoliageDamping(wx, wy, wz)` returns a per-frame velocity multiplier (0.3 at center to 0.8 at edge) when a projectile is inside foliage. Foliage zone: above scaled trunk top, within radius `scale * 1.3`, up to `scale * 5.0` height. Vertical damping slightly less so rocks fall through leaves naturally.
- **Pickable rocks on minimap** (`hud.js`, `vegetation.js`, `projectiles.js`): pickable rocks and in-flight projectiles shown as orange dots on the minimap. `getPickableRocks()` exported from vegetation.js (filters active rocks ≤ ROCK_PICK_MAX_SIZE). `getActiveProjectilePositions()` exported from projectiles.js.
- **Player kicks pebbles** (`projectiles.js`, `main.js`): `kickNearbyRock(scene)` called after physics sync. When the player is moving (hSpeed > 1) and overlaps a pickable pebble within PLAYER_R, the pebble is converted to a dynamic projectile kicked away from the player at 70% of player speed (capped at 8) with a small upward pop.
- **3rd person throw accuracy** (`projectiles.js`): replaced fixed 50-unit convergence target with a proper THREE.Raycaster from the camera. Finds the exact world point the crosshair is aiming at (layer 0 only — skips player model on layer 1). Eliminates parallax error when throwing at close-range targets in 3rd person.
- **Map boundary for projectiles** (`projectiles.js`): rocks reaching the world edge (±HALF - 1) are clamped inside and their horizontal velocity zeroed. Prevents rocks from flying off the map and falling into the void.
- **Sci-fi boundary shield effect** (`boundary.js` NEW, `physics.js`, `projectiles.js`, `player.js`, `main.js`): when a projectile or player hits the world boundary, a semi-transparent hex-grid shield ripple spawns at the impact point and expands outward while fading. Uses pooled PlaneGeometry meshes (8) with a canvas-generated texture (concentric rings + hex grid pattern), additive blending, ~1s expand+fade animation. Projectiles deflect at 40% speed on bounce. Player gets a 0.5s cooldown between shield spawns to avoid spam. Four invisible cannon-es wall bodies added at world edges in `createTerrainBody()` for physics-based boundary collision.

### Camera, torch, and light fixes
- **3rd person camera fix** (`player.js`, `boundary.js`): camera was stuck at 0.5 units from player near spawn point. Root cause: 8 boundary shield PlaneGeometry meshes at (0,0,0) with `visible: false` were still hit by camera clip raycast at distance 0.00 (Three.js Raycaster tests invisible meshes). Fixed by overriding `mesh.raycast = function() {}` on all boundary shield meshes. Also added `userData.isGround = true` to ground/water meshes in geometry.js and filtered them from camera clip raycasts in player.js.
- **Convergence distance minimum** (`player.js`): raised minimum convergenceDist from 3 to 15 for 3→1 camera transitions, reducing shoulder-offset parallax.
- **Player spawn height** (`player.js`): removed +1.0 offset from spawn Y — player starts exactly on terrain instead of dropping.
- **Torch flame position** (`torches.js`): TIP_OUT and TIP_UP were using `STICK_LEN / 2` (stick center) instead of `STICK_LEN` (actual tip). Fixed both to use full stick length projection. Light offset reduced from +0.12 to +0.06, flame offset removed (sits at tip).
- **Torch placement ghost fix** (`torches.js`): wall-mounted preview flame was at 1.5x correct offset after TIP_OUT/TIP_UP fix. Changed from `(TIP_OUT, TIP_UP)` to `(TIP_OUT/2, TIP_UP/2)` to match group's half-offset positioning. Ground preview stale +0.08 Y offset removed.
- **Torch light range reduced** (`torches.js`): PointLight distance reduced from 8 to 6, decay increased from 1.5 to 2.0. Faster falloff reduces light bleeding through doors and adjacent geometry without losing local illumination quality.
- **Door-stone collision** (`doors.js`): panelR reduced from 0.6 to 0.12 for flush door-rock contact. Added 3/4-point sample along panel in `panelHitsRock()` for better coverage.
- **Build batching** (`main.js`): split monolithic Batch 2 into Batch 2a (visual world) and Batch 2b (physics bodies) with yieldFrame between them for smoother loading progress.
- **CLAUDE.md updated**: architecture tree now includes `physics.js`, `boundary.js`. Collision section rewritten for cannon-es. Known Quirks updated (removed CDN mention, added shadow budget note).
