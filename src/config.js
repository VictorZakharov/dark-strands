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
  TREES: 140,
  ROCKS: 50,
  BUSHES: 100,           // walk-through shrubs (thin-instanced ez-tree bushes)

  // ez-tree generated vegetation (trees + bushes). Each variant is generated
  // ONCE at world-gen (template mesh pair: branches + leaves) and placed via
  // thin instances — 2 draw calls per variant regardless of count.
  EZTREE: {
    // Per-category tessellation budget, applied to each preset BEFORE
    // generate() (Math.min against the preset's own branch.sections /
    // branch.segments arrays, indexed by recursion level 0-3).
    // Raw ez-tree 1.1.0 presets total ~2.31M visible tris for 80 trees +
    // 90 bushes (branch TUBES dominate — raw Bush 3 is 13.7k branch tris
    // for a 1u shrub), and thin instances have no per-instance culling, so
    // the whole batch also re-runs in the sun shadow map (every frame on
    // WebGPU), the fog depth RTT and the water mirror. These caps bring
    // the main pass to ~1.18M tris measured.
    // leafMult scales leaves-per-terminal-branch; the factory compensates
    // leaf size by 1/sqrt(leafMult) so canopy coverage holds. Lower the
    // caps/leafMult further for weaker GPUs.
    DETAIL: {
      leafy: { sections: [8, 5, 3, 2], segments: [8, 5, 3, 3], leafMult: 0.7 },
      pine:  { sections: [8, 5, 3, 2], segments: [8, 4, 3, 3], leafMult: 0.8 },
      bush:  { sections: [3, 3, 2, 2], segments: [4, 3, 3, 3], leafMult: 0.8 },
    },
    SINK: 0.6,             // trunk-base sink below the LOWEST sampled nearby
                           // ground — ez-tree trunks are open-bottomed tubes,
                           // so a rim above the rendered surface reads as a
                           // floating hollow notched trunk. 0.1→0.35 still left
                           // rims exposed where the coarse ground lattice dips
                           // hard on slopes; 0.6 buries the open bottom.
    // Placement zoning (see vegetation.js placeTrees): single-species forest
    // stands away from the roads + ornamental roadside trees + lone scatter
    ZONING: {
      PINE_FORESTS: 2,       // pine-only stands
      LEAFY_FORESTS: 2,      // deciduous-only stands
      FOREST_R: [8, 11],     // zone radius range, grid cells
      FOREST_ROAD_DIST: 12,  // min BFS cells from any road to a zone CENTER
      FOREST_SEPARATION: 22, // min cells between zone centers
      ROADSIDE_SHARE: 0.15,  // fraction of CFG.TREES lining the road verges
      SCATTERED_SHARE: 0.15, // fraction placed as lone trees; rest = forests
    },
    // Per-instance leaf tints (thin-instance 'color' buffer on the leaves
    // mesh; multiplies the leaf texture on top of the preset tint). Channels
    // >1 are legal in the shader — that's what pushes the green-leaning leaf
    // textures into vivid autumn yellow/orange. Verified live on WebGPU.
    // { c: [r,g,b], w: pick weight }; every pick also gets 0.85-1.1
    // uniform brightness jitter so same-tint neighbors don't twin.
    TINTS: {
      leafy: [
        { c: [1, 1, 1],          w: 5 },   // preset green
        { c: [1.25, 1.05, 0.55], w: 2 },   // late-summer yellow-green
        { c: [2.1, 1.0, 0.28],   w: 2 },   // golden yellow
        { c: [2.4, 0.65, 0.16],  w: 1.5 }, // orange
      ],
      pine: [
        { c: [1, 1, 1],          w: 3 },   // preset green
        { c: [0.82, 0.9, 0.85],  w: 1 },   // cool blue-green
        { c: [1.12, 1.08, 0.9],  w: 1 },   // warm light green
      ],
      bush: [
        { c: [1, 1, 1],          w: 4 },   // preset green
        { c: [1.3, 1.05, 0.5],   w: 1 },   // yellowing shrub
      ],
    },
    // Snow-biome palettes (used instead of TINTS when SNOW_MODE). Same
    // multiply-the-green-texture mechanics, so "frosted" means desaturating:
    // lift red+blue relative to green, then push toward white for rime.
    // Snow picks get a tighter 0.9-1.05 jitter — bloom blows out near-white
    // tints that the autumn palette's 1.1 top end tolerates.
    TINTS_SNOW: {
      pine: [
        { c: [1, 1, 1],          w: 1 },   // a few stay deep green for contrast
        { c: [0.8, 0.95, 1.18],  w: 2 },   // cold blue-green
        { c: [1.5, 1.45, 1.8],   w: 2 },   // frosted pale (red≈green whitens, not limes)
        { c: [1.85, 1.8, 2.3],   w: 1.5 }, // heavy rime
      ],
      // Bush presets carry warm material-level tints UNDER the instance color,
      // so frosting needs red damped relative to blue or it reads yellow
      bush: [
        { c: [0.95, 1.05, 1.35], w: 2 },   // cold dull green
        { c: [1.45, 1.6, 2.0],   w: 2 },   // frosted
        { c: [1.9, 2.05, 2.5],   w: 1 },   // rimed white-blue
      ],
      leafy: [
        { c: [1.2, 1.05, 1.15],  w: 1 },   // cold pale (snow forces pine today — future-proofing)
      ],
    },
    // { preset (ez-tree name), category, h: [minH, maxH] world-unit target
    //   height range, weight: rng pick weight within its category }
    VARIANTS: [
      { id: 'oakMedium',   preset: 'Oak Medium',   category: 'leafy', h: [7, 10],    weight: 3 },
      { id: 'oakLarge',    preset: 'Oak Large',    category: 'leafy', h: [9, 12],    weight: 1 },
      { id: 'ashMedium',   preset: 'Ash Medium',   category: 'leafy', h: [7, 10],    weight: 2 },
      { id: 'aspenMedium', preset: 'Aspen Medium', category: 'leafy', h: [8, 11],    weight: 2 },
      { id: 'pineSmall',   preset: 'Pine Small',   category: 'pine',  h: [6, 8],     weight: 2 },
      { id: 'pineMedium',  preset: 'Pine Medium',  category: 'pine',  h: [8, 11],    weight: 2 },
      { id: 'pineLarge',   preset: 'Pine Large',   category: 'pine',  h: [10, 13],   weight: 1 },
      { id: 'bush1',       preset: 'Bush 1',       category: 'bush',  h: [1.0, 1.6], weight: 2 },
      { id: 'bush2',       preset: 'Bush 2',       category: 'bush',  h: [1.0, 1.6], weight: 2 },
      { id: 'bush3',       preset: 'Bush 3',       category: 'bush',  h: [0.9, 1.4], weight: 1 },
    ],
  },

  // Wind sway (windSway.js material plugin on vegetation). AMP_* = world-unit
  // displacement at full sway weight × full wind strength. Leaves/bushes are
  // in the fog depth pass whose silhouette does NOT sway — keep tree amps
  // ≤~0.3 or windward canopy edges grow fog-colored fringes in storms.
  WIND: {
    AMP_LEAFY: 0.25,
    AMP_PINE: 0.12,      // needles barely flex
    AMP_BUSH: 0.16,
    AMP_GRASS: 0.45,     // not in the fog depth pass — free to be lively
    AMP_FLOWER: 0.18,
    FREQ_TREE: 1.0,      // per-material multiplier on the global wind clock
    FREQ_GRASS: 1.7,     // light plants flutter faster
    FREQ_FLOWER: 1.5,
  },

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

  // Wall style variety & timber trim (visual only — no physics/grid impact)
  WALL_STYLE: {
    BASE_COURSE_H: 0.8,    // stone base band height on plaster buildings (world u)
    PLASTER_PROUD: 0.015,  // plaster skin offset off the stone wall face
    PLASTER_UV: 0.25,      // plaster texture tiling (uv per world unit → tiles every 4u)
    TRIM_T: 0.15,          // horizontal beam cross-section height
    TRIM_PROUD: 0.03,      // beams/braces proud of the wall face
    SURROUND_PROUD: 0.07,  // door/window surrounds + corner posts proud of the face
    CORNER_W: 0.24,        // corner post plan width
    BRACE_MIN_SEG: 1.3,    // min clear wall run (u) to host a diagonal brace
  },

  // Buildings
  MIN_BUILDINGS: 9,
  MAX_BUILDINGS: 14,
  MIN_ROOM: 4,
  MAX_ROOM: 9,
  PLAYER_CLEAR: 3,

  // Roads (village layout) — curve-first: splines are the source of truth,
  // grid cells are a rasterization of them (see roadNetwork.js)
  ROAD_EDGE_MARGIN: 6,       // min distance (cells) from world edge
  ROAD_WIDTH: 1.7,           // ribbon width in world units (cell = 2.0)
  ROAD_Y_OFFSET: 0.05,       // interior lift above terrain (edges are pinned)
  ROAD_WIDTH_JITTER: 0.15,   // per-control-point width wobble (±u), interpolated
  ROAD_CONTROL_OFFSET: 10,   // max perpendicular offset of spline control points (u)
  ROAD_MIN_RADIUS: 6,        // roads never bend tighter than this (u); spurs 3
  ROAD_MIN_BRANCHES: 2,      // branch roads off the main road
  ROAD_MAX_BRANCHES: 3,
  ROAD_SPUR_MAX: 5,          // door spur reach toward the road (cells)
  ROAD_TORCH_SPACING: 9,     // arc length between torch posts (cells ≈ ×CELL u)
  ROAD_TORCH_MAX: 14,        // hard cap on road torches (PointLight budget)
  ROAD_TORCH_POST_H: 1.7,    // standing torch post height (world units)

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
    WIND_SWAY: true,       // vegetation vertex sway (CFG.WIND tunables)
  },
};
