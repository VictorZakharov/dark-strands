import { CFG } from '../config.js';

// Weather state machine. Owns no scene properties — publishes a modifier
// object that daynight.js (fog/sun/hemi/sky), skyDome.js (clouds/flash),
// postfx.js (god rays) and rainFX.js (rain rate) consume each frame.

const STATES = {
  CLEAR:    { dwell: [90, 240], cover: [0.05, 0.30], cloudDark: 0.0, fogMul: 1.00, sunMul: 1.00, hemiMul: 1.00, envMul: 1.00, rainRate: 0,    wind: 1.5,  lightning: false },
  OVERCAST: { dwell: [60, 180], cover: [0.55, 0.85], cloudDark: 0.4, fogMul: 0.80, sunMul: 0.45, hemiMul: 0.80, envMul: 0.60, rainRate: 0,    wind: 4.0,  lightning: false },
  RAIN:     { dwell: [45, 120], cover: [0.85, 0.95], cloudDark: 0.7, fogMul: 0.55, sunMul: 0.25, hemiMul: 0.60, envMul: 0.40, rainRate: 700,  wind: 6.0,  lightning: false },
  STORM:    { dwell: [30, 90],  cover: [1.00, 1.00], cloudDark: 1.0, fogMul: 0.40, sunMul: 0.12, hemiMul: 0.45, envMul: 0.25, rainRate: 1800, wind: 10.0, lightning: true },
};

const TRANSITIONS = {
  CLEAR:    [['OVERCAST', 1.0]],
  OVERCAST: [['CLEAR', 0.5], ['RAIN', 0.4], ['STORM', 0.1]],
  RAIN:     [['OVERCAST', 0.7], ['STORM', 0.3]],
  STORM:    [['RAIN', 1.0]],
};

// Lightning double-flash envelope: [time s, intensity] keyframes
const FLASH_KEYS = [[0, 0], [0.04, 1], [0.16, 0.15], [0.20, 0.7], [0.55, 0]];
const FLASH_KEYS_TRIPLE = [[0, 0], [0.04, 1], [0.16, 0.15], [0.20, 0.7], [0.55, 0.1], [0.62, 0.5], [0.9, 0]];

let _state = 'CLEAR';
let _dwell = 120;
let _tau = 4;             // lerp time constant (transition duration / 3)
let _windAzimuth = 0.7;
let _windTime = 0;

// Continuous values (lerped toward per-state targets)
const _cur = { cover: 0.15, cloudDark: 0, fogMul: 1, sunMul: 1, hemiMul: 1, envMul: 1, rainRate: 0, wind: 1.5 };
const _target = { cover: 0.15, cloudDark: 0, fogMul: 1, sunMul: 1, hemiMul: 1, envMul: 1, rainRate: 0, wind: 1.5 };

// Lightning
let _nextStrike = Infinity;
let _flashClock = -1;     // -1 = idle, else elapsed seconds into envelope
let _flashKeys = FLASH_KEYS;
let _onStrike = null;     // optional callback(strength) — audio hook for later

// Published modifiers (single cached object — no per-frame allocs)
const _mods = {
  state: 'CLEAR',
  cloudCover: 0.15, cloudDark: 0,
  sunMul: 1, hemiMul: 1, fogMul: 1, envMul: 1,
  skyDesat: 0,
  rainRate: 0,
  windX: 1.5, windZ: 0,
  flash: 0,
};

// Every field must be a true identity so WEATHER=false restores pre-PR visuals
// exactly (cloudCover 0 keeps the sun disc, stars and god rays at full strength)
const NEUTRAL = { state: 'CLEAR', cloudCover: 0, cloudDark: 0, sunMul: 1, hemiMul: 1, fogMul: 1, envMul: 1, skyDesat: 0, rainRate: 0, windX: 1, windZ: 0, flash: 0 };

export function getWeatherModifiers() { return CFG.GFX.WEATHER ? _mods : NEUTRAL; }
export function getWeatherState() { return _state; }
export function onLightningStrike(cb) { _onStrike = cb; }

function rand(min, max) { return min + Math.random() * (max - min); }

function pickNext(from) {
  const options = TRANSITIONS[from];
  let r = Math.random();
  for (const [name, p] of options) {
    if (r < p) return name;
    r -= p;
  }
  return options[options.length - 1][0];
}

function enterState(name) {
  _state = name;
  const s = STATES[name];
  _dwell = rand(s.dwell[0], s.dwell[1]);
  _tau = rand(8, 20) / 3; // 8–20 s cross-fade, exponential lerp tau
  _target.cover = rand(s.cover[0], s.cover[1]);
  _target.cloudDark = s.cloudDark;
  _target.fogMul = s.fogMul;
  _target.sunMul = s.sunMul;
  _target.hemiMul = s.hemiMul;
  _target.envMul = s.envMul;
  _target.rainRate = s.rainRate;
  _target.wind = s.wind;

  // Snow-biome blizzard: heavier fog and wind, no lightning
  if (CFG.SNOW_MODE && name === 'STORM') {
    _target.fogMul = 0.30;
    _target.wind = 12;
  }
  if (s.lightning && !CFG.SNOW_MODE) {
    _nextStrike = rand(2, 8);
  } else {
    _nextStrike = Infinity;
  }
}

function evalFlash(e) {
  const keys = _flashKeys;
  if (e <= 0) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (e < keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ((e - t0) / (t1 - t0));
    }
  }
  return -1; // envelope finished
}

export function initWeather() {
  enterState('CLEAR');
  // start settled — no visible transition at spawn
  Object.assign(_cur, _target);

  // Debug/testing hook: window._weather.set('STORM'), window._weather.get()
  if (typeof window !== 'undefined') {
    window._weather = {
      set: (name) => { if (STATES[name]) { enterState(name); return name; } return 'unknown state'; },
      get: () => ({ state: _state, ..._mods }),
    };
  }
}

export function updateWeather(gdt) {
  if (!CFG.GFX.WEATHER) return;

  // State machine
  _dwell -= gdt;
  if (_dwell <= 0) enterState(pickNext(_state));

  // Frame-rate independent exponential lerp toward targets
  const a = Math.min(1, gdt / _tau);
  for (const k of Object.keys(_cur)) {
    _cur[k] += (_target[k] - _cur[k]) * a;
  }

  // Wind: wandering azimuth + storm gusts
  _windTime += gdt;
  _windAzimuth += (Math.random() - 0.5) * 0.05 * gdt;
  let wind = _cur.wind;
  if (_state === 'STORM') {
    wind *= 1 + 0.4 * Math.sin(_windTime * 0.7) + 0.25 * Math.sin(_windTime * 1.9);
  }

  // Lightning scheduler + envelope
  let flash = 0;
  if (_flashClock >= 0) {
    _flashClock += gdt;
    const v = evalFlash(_flashClock);
    if (v < 0) _flashClock = -1;
    else flash = v;
  } else if (_state === 'STORM' && !CFG.SNOW_MODE) {
    _nextStrike -= gdt;
    if (_nextStrike <= 0) {
      _flashClock = 0;
      _flashKeys = Math.random() < 0.2 ? FLASH_KEYS_TRIPLE : FLASH_KEYS;
      _nextStrike = rand(4, 14);
      if (_onStrike) _onStrike(1);
    }
  }

  // Publish
  _mods.state = _state;
  _mods.cloudCover = _cur.cover;
  _mods.cloudDark = _cur.cloudDark;
  _mods.sunMul = _cur.sunMul;
  _mods.hemiMul = _cur.hemiMul;
  _mods.fogMul = _cur.fogMul;
  _mods.envMul = _cur.envMul;
  _mods.skyDesat = Math.min(0.85, _cur.cover * 0.85);
  _mods.rainRate = _cur.rainRate;
  _mods.windX = Math.cos(_windAzimuth) * wind;
  _mods.windZ = Math.sin(_windAzimuth) * wind;
  _mods.flash = flash;
}
