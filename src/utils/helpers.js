import { CFG } from '../config.js';

export function g2w(gx, gz) {
  return {
    x: gx * CFG.CELL - CFG.HALF + CFG.CELL / 2,
    z: gz * CFG.CELL - CFG.HALF + CFG.CELL / 2,
  };
}

export function w2g(wx, wz) {
  return {
    x: Math.floor((wx + CFG.HALF) / CFG.CELL),
    z: Math.floor((wz + CFG.HALF) / CFG.CELL),
  };
}

export function rng(a, b) {
  return a + Math.random() * (b - a);
}

export function rngInt(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

export function padTime(n) {
  return String(n).padStart(2, '0');
}
