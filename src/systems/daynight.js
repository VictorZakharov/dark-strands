import * as THREE from 'three';
import { CFG } from '../config.js';
import { getSunLight, getHemiLight, getStars } from '../core/lighting.js';
import { getTorchLights, getDoorTorchLights, getDoorTorchFlames } from '../world/torches.js';
import { padTime } from '../utils/helpers.js';

let dayTime = 8 / 24; // Start at 08:00
let cycleEnabled = false;

export function getDayTime() { return dayTime; }

export function setCycleEnabled(enabled) {
  cycleEnabled = enabled;
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

export function updateDayNight(dt, scene) {
  if (cycleEnabled) {
    dayTime = (dayTime + dt / CFG.DAY_SEC) % 1;
  }

  // Summer (normal): long days 05:00–21:00. Winter (snow): short days 08:00–16:00.
  const rise = CFG.SNOW_MODE ? 8 / 24 : 5 / 24;
  const set  = CFG.SNOW_MODE ? 16 / 24 : 21 / 24;
  const sunH = calcSunH(dayTime, rise, set);

  const sunLight = getSunLight();
  const hemiLight = getHemiLight();
  const stars = getStars();
  const torchLights = getTorchLights();

  // Sun orbit — arc across sky during daytime
  if (sunH > 0) {
    const dayFrac = (dayTime - rise) / (set - rise);
    const arcAngle = dayFrac * Math.PI;
    sunLight.position.set(
      Math.cos(arcAngle) * 80,
      sunH * 70 + 10,
      Math.sin(arcAngle) * 30
    );
  } else {
    sunLight.position.set(0, -50, 0);
  }

  // Sun intensity & color
  sunLight.intensity = Math.max(0, sunH) * 2.2;
  sunLight.color.setHSL(0.08, 0.6, 0.5 + Math.max(0, sunH) * 0.5);

  // Hemisphere
  hemiLight.intensity = 0.08 + Math.max(0, sunH) * 0.45;

  // Sky color — wide gradual transition (sunH 0.4 → -0.2)
  const day = new THREE.Color(0x6cb4ee);
  const night = new THREE.Color(0x0a0a1e);
  const sunset = new THREE.Color(0xcc5522);

  let sky;
  if (sunH > 0.4) {
    sky = day.clone();
  } else if (sunH > -0.2) {
    // Normalize to 0..1 over the transition band
    const t = (sunH + 0.2) / 0.6;
    const s = t * t * (3 - 2 * t); // smoothstep
    if (s > 0.5) {
      sky = sunset.clone().lerp(day, (s - 0.5) * 2);
    } else {
      sky = night.clone().lerp(sunset, s * 2);
    }
  } else {
    sky = night.clone();
  }

  scene.background = sky;
  scene.fog.color.copy(sky);

  // Gradual fog transition (not a hard switch)
  const fogBlend = Math.max(0, Math.min(1, (sunH + 0.1) / 0.3));
  scene.fog.near = 5 + fogBlend * 5;   // 5 (night) → 10 (day)
  scene.fog.far  = 30 + fogBlend * 25;  // 30 (night) → 55 (day)

  // Stars — fade in gradually
  const starAlpha = Math.max(0, Math.min(1, (0.15 - sunH) / 0.35));
  stars.material.opacity = starAlpha * 1.2;
  stars.material.transparent = true;
  stars.visible = starAlpha > 0.01;

  // Interior torches (always on, brighter at night)
  const torchIntensity = 1.0 + Math.max(0, -sunH) * 2.5;
  for (const t of torchLights) t.intensity = torchIntensity;

  // Door torches — on 1h before sunset, off 1h after sunrise, 30min fade
  const doorLights = getDoorTorchLights();
  const doorFlames = getDoorTorchFlames();
  const h = dayTime * 24;
  const onH = set * 24 - 1;   // 1 hour before sunset
  const offH = rise * 24 + 1; // 1 hour after sunrise
  const fadeH = 0.5;           // 30 min fade in/out
  let doorFade = 0;
  if (onH > offH) {
    // Wraps through midnight (always the case for realistic day lengths)
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
  const doorIntensity = doorFade * (1.5 + Math.max(0, -sunH) * 2.0);
  for (const dl of doorLights) dl.intensity = doorIntensity;
  for (const df of doorFlames) df.visible = doorFade > 0.01;

  // HUD time display (24-hour clock)
  const hours = Math.floor(dayTime * 24);
  const mins = Math.floor((dayTime * 24 - hours) * 60);
  const el = document.getElementById('time-display');
  if (el) el.textContent = `${padTime(hours)}:${padTime(mins)} ${sunH > 0 ? 'DAY' : 'NIGHT'}`;
}
