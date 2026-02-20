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

  // Player
  PLAYER_H: 1.7,
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
};
