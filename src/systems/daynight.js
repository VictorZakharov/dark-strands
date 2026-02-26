import { Color3, Color4 } from 'babylonjs';
import { CFG } from '../config.js';
import { getSunLight, getHemiLight, getStars } from '../core/lighting.js';
import { getTorchLights, getDoorTorchLights, getDoorTorchFlames } from '../world/torches.js';
import { padTime } from '../utils/helpers.js';
import { getScene } from '../core/scene.js';

let dayTime = 8 / 24; // Start at 08:00 (overridden to 10:00 for snow biome)
let cycleEnabled = false;
let _sunH = 1; // current sun height (-1 to +1)

// Sun offset from target — used by player.js shadow follow
let _sunOff = { x: 40, y: 50, z: 20 };

export function getDayTime() { return dayTime; }
export function getSunOffset() { return _sunOff; }
export function getSunH() { return _sunH; }
export function isCycleEnabled() { return cycleEnabled; }

export function getHoursUntilDawn() {
  const rise = CFG.SNOW_MODE ? 8 / 24 : 5 / 24;
  let remaining = rise - dayTime;
  if (remaining <= 0) remaining += 1.0;
  return remaining * 24;
}

export function setCycleEnabled(enabled) {
  cycleEnabled = enabled;
}

export function setStartTime(t) {
  dayTime = t;
}

/**
 * Calculate sun height using biome-aware sunrise/sunset.
 * Returns -1 (midnight) to +1 (noon), 0 at sunrise/sunset.
 */
function calcSunH(t, rise, set) {
  if (t >= rise && t <= set) {
    return Math.sin((t - rise) / (set - rise) * Math.PI);
  }
  const nightLen = 1 - (set - rise);
  const np = t > set ? (t - set) / nightLen : (t + 1 - set) / nightLen;
  return -Math.sin(np * Math.PI);
}

/** Lerp two Color3 values and return a new Color3 */
function lerpColor(a, b, t) {
  return new Color3(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}

export function updateDayNight(dt, scene) {
  if (cycleEnabled) {
    dayTime = (dayTime + dt / CFG.DAY_SEC) % 1;
  }

  // Summer (normal): long days 05:00–21:00. Winter (snow): short days 08:00–16:00.
  const rise = CFG.SNOW_MODE ? 8 / 24 : 5 / 24;
  const set = CFG.SNOW_MODE ? 16 / 24 : 21 / 24;
  const sunH = Math.max(-1, Math.min(1, calcSunH(dayTime, rise, set)));
  _sunH = sunH;

  const sunLight = getSunLight();
  const hemiLight = getHemiLight();
  const stars = getStars();
  const torchLights = getTorchLights();

  // Sun direction offset — player.js positions the light for shadow follow
  if (sunH > 0) {
    const dayFrac = (dayTime - rise) / (set - rise);
    const arcAngle = dayFrac * Math.PI;
    _sunOff = {
      x: Math.cos(arcAngle) * 80,
      y: sunH * 70 + 10,
      z: Math.sin(arcAngle) * 30,
    };
  } else {
    _sunOff = { x: 0, y: -50, z: 0 };
  }

  // Sun intensity & color
  sunLight.intensity = Math.min(2.2, Math.max(0, sunH) * 2.2);
  // Babylon.js uses Color3 for diffuse — approximate HSL(0.08, 0.6, variable)
  const sunLum = 0.5 + Math.max(0, sunH) * 0.5;
  sunLight.diffuse = new Color3(
    sunLum + 0.15,
    sunLum * 0.93,
    sunLum * 0.75
  );

  // Hemisphere
  hemiLight.intensity = Math.min(0.53, 0.08 + Math.max(0, sunH) * 0.45);

  // Sky color — wide gradual transition (sunH 0.4 → -0.2)
  const day = new Color3(0.424, 0.706, 0.933);     // #6cb4ee
  const night = new Color3(0.039, 0.039, 0.118);   // #0a0a1e
  const sunset = new Color3(0.8, 0.333, 0.133);     // #cc5522

  let sky;
  if (sunH > 0.4) {
    sky = day.clone();
  } else if (sunH > -0.2) {
    const t = (sunH + 0.2) / 0.6;
    const s = t * t * (3 - 2 * t); // smoothstep
    if (s > 0.5) {
      sky = lerpColor(sunset, day, (s - 0.5) * 2);
    } else {
      sky = lerpColor(night, sunset, s * 2);
    }
  } else {
    sky = night.clone();
  }

  // Babylon.js: clearColor is Color4, fogColor is Color3
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
  scene.fogColor = sky;

  // IBL environment intensity — very subtle so building interiors stay dark
  // and torch lights remain visible. PBR materials still respond to direct lights.
  scene.environmentIntensity = Math.max(0.01, Math.min(0.15, sunH * 0.2));

  // Gradual fog transition
  const fogBlend = Math.max(0, Math.min(1, (sunH + 0.1) / 0.3));
  scene.fogStart = 15 + fogBlend * 15;  // 15 (night) → 30 (day)
  scene.fogEnd = 50 + fogBlend * 40;   // 50 (night) → 90 (day)

  // Stars — fade in gradually (Phase 8: actual star mesh, for now just null check)
  if (stars) {
    const starAlpha = Math.max(0, Math.min(1, (0.15 - sunH) / 0.35));
    stars.visibility = starAlpha * 1.2;
    stars.setEnabled(starAlpha > 0.01);
  }

  // Interior torches (always on, brighter at night)
  const torchIntensity = Math.min(3.5, 1.0 + Math.max(0, -sunH) * 2.5);
  for (const t of torchLights) {
    if (t.metadata && t.metadata.picked) continue;
    if (!t.metadata) t.metadata = {};
    t.metadata.baseIntensity = torchIntensity;
  }

  // Door torches — on 1h before sunset, off 1h after sunrise, 30min fade
  const doorLights = getDoorTorchLights();
  const doorFlames = getDoorTorchFlames();
  const h = dayTime * 24;
  const onH = set * 24 - 1;
  const offH = rise * 24 + 1;
  const fadeH = 0.5;
  let doorFade = 0;
  if (onH > offH) {
    if (h >= onH || h <= offH) {
      if (h >= onH && h < onH + fadeH) doorFade = (h - onH) / fadeH;
      else if (h > offH - fadeH && h <= offH) doorFade = (offH - h) / fadeH;
      else doorFade = 1;
    }
  } else if (h >= onH && h <= offH) {
    if (h < onH + fadeH) doorFade = (h - onH) / fadeH;
    else if (h > offH - fadeH) doorFade = (offH - h) / fadeH;
    else doorFade = 1;
  }

  doorFade = Math.max(0, Math.min(1, doorFade));

  const doorIntensity = Math.min(3.5, doorFade * (1.5 + Math.max(0, -sunH) * 2.0));
  for (const dl of doorLights) {
    if (dl.metadata && dl.metadata.picked) continue;
    if (!dl.metadata) dl.metadata = {};
    dl.metadata.baseIntensity = doorIntensity;
  }
  for (const df of doorFlames) df.setEnabled(doorFade > 0.01);

  // HUD time display
  const hours = Math.floor(dayTime * 24);
  const mins = Math.floor((dayTime * 24 - hours) * 60);
  const el = document.getElementById('time-display');
  if (el) el.textContent = `${padTime(hours)}:${padTime(mins)} ${sunH > 0 ? 'DAY' : 'NIGHT'}`;
}
