export const CFG = {
  // Grid
  GRID: 80,
  CELL: 2,
  get HALF() { return this.GRID * this.CELL / 2; },

  // Walls
  WALL_H: 3.5,
  WALL_T: 0.7,

  // Water
  WATER_Y: -1.5,
  WATER_SUBS: 128,
  WATER_WAVES: [
    // [amplitude, frequency, speed, steepness, dirX, dirZ]
    [0.12, 0.8,  0.6, 0.50, 0.70, 0.50],   // primary swell
    [0.08, 1.2,  0.8, 0.40,-0.30, 0.80],   // cross swell
    [0.04, 2.5,  1.2, 0.30, 0.90,-0.20],   // medium ripple
    [0.02, 4.0,  1.8, 0.20,-0.50,-0.60],   // fine ripple
  ],

  // Player
  SOLDIER_H: 2.4,
  FOX_H: 1.2,
  PLAYER_H: 2.15,
  PLAYER_R: 0.35,
  SPEED: 6,
  SPRINT: 11,
  JUMP: 8,
  GRAV: 20,

  // Camera
  TPS_DIST: 5,
  TPS_UP: 2.5,

  // Biome
  SNOW_MODE: false,

  // Day/night
  DAY_SEC: 120,

  // Vegetation
  TREES: 80,
  ROCKS: 50,
  BUSHES: 90,            // walk-through shrubs (merged, 1 draw call)

  // Stone pickup & throwing
  ROCK_PICK_DIST: 2.5,
  ROCK_PICK_MAX_SIZE: 0.3,
  THROWABLE_STONES: 30,
  THROW_SPEED: 18,
  THROW_GRAV: 15,
  THROWN_STONE_SIZE: 0.2,

  // Flower planting
  PLANT_MAX_DIST: 15,

  // Torch
  TORCH_PICK_DIST: 3,

  // Buildings
  MIN_BUILDINGS: 9,
  MAX_BUILDINGS: 14,
  MIN_ROOM: 4,
  MAX_ROOM: 9,
  PLAYER_CLEAR: 3,

  // Roads (village layout)
  ROAD_EDGE_MARGIN: 6,     // min distance (cells) from world edge
  ROAD_WIDTH: 1.7,         // dirt ribbon width in world units (cell = 2.0)
  ROAD_Y_OFFSET: 0.05,     // lift above terrain to avoid z-fighting
  ROAD_MIN_BRANCHES: 2,    // branch roads off the main road
  ROAD_MAX_BRANCHES: 3,
  ROAD_TORCH_SPACING: 9,   // road cells between standing torches
  ROAD_TORCH_MAX: 14,      // hard cap on road torches (PointLight budget)

  // Graphics / AAA visual effects (all individually toggleable)
  GFX: {
    // 'pcf' = single stabilized 2048 PCF map (default). 'csm' = 3-cascade CSM —
    // sharper mid-range shadows but re-renders every caster per cascade
    // (+~2600 draws here); the fog caps visibility at ~90u so pcf wins.
    SHADOWS: 'pcf',
    SHADOW_MAP: 2048,
    CASCADES: 3,
    // SSAO2 (half-res, prepass): barely visible on this flat-shaded low-poly
    // world but costs a partial extra geometry pass — off by default.
    SSAO: false,
    MSAA: 1,               // keep 1: MSAA'd edges vs single-sampled fog depth = edge crawl
    BLOOM: true,           // watch for pulsing around thin tree silhouettes vs bright sky
    PIPELINE: true,        // DefaultRenderingPipeline: bloom/FXAA/grain/vignette/sharpen
    // GlowLayer has no depth occlusion (screen-space additive) — through-wall
    // bleed is prevented by a per-frame camera line-of-sight gate on each
    // flame's inclusion (glowSetVisible in updateTorchEmbers).
    GLOW: true,
    VOL_FOG: true,         // volumetric height fog post-process (replaces linear fog)
    GOD_RAYS: true,        // screen-space sun shafts inside the fog pass
    SKY_DOME: true,        // procedural atmosphere/cloud/star dome
    WEATHER: true,         // weather state machine + rain/snow/lightning
    WATER_REFLECTION: true,// planar mirror reflections on the ocean
  },
};
