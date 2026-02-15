import * as THREE from 'three';
import { CFG } from '../config.js';
import { getSunLight, getHemiLight, getStars } from '../core/lighting.js';
import { getTorchLights } from '../world/torches.js';
import { padTime } from '../utils/helpers.js';

let dayTime = 0.30;
let cycleEnabled = false;

export function getDayTime() { return dayTime; }

export function setCycleEnabled(enabled) {
  cycleEnabled = enabled;
}

export function updateDayNight(dt, scene) {
  if (cycleEnabled) {
    dayTime = (dayTime + dt / CFG.DAY_SEC) % 1;
  }

  const angle = dayTime * Math.PI * 2;
  const sunH = Math.sin(angle);

  const sunLight = getSunLight();
  const hemiLight = getHemiLight();
  const stars = getStars();
  const torchLights = getTorchLights();

  // Sun intensity & color
  sunLight.intensity = Math.max(0, sunH) * 2.2;
  sunLight.color.setHSL(0.08, 0.6, 0.5 + Math.max(0, sunH) * 0.5);

  // Hemisphere
  hemiLight.intensity = 0.08 + Math.max(0, sunH) * 0.45;

  // Sky color
  const day = new THREE.Color(0x6cb4ee);
  const night = new THREE.Color(0x0a0a1e);
  const sunset = new THREE.Color(0xcc5522);

  let sky;
  if (sunH > 0.15) {
    sky = day.clone();
  } else if (sunH > -0.05) {
    const t = (sunH + 0.05) / 0.2;
    sky = night.clone().lerp(sunset, Math.min(1, t * 2));
    sky.lerp(day, Math.max(0, (t - 0.3) / 0.7));
  } else {
    sky = night.clone();
  }

  scene.background = sky;
  scene.fog.color.copy(sky);
  // Linear fog: near/far distance (shorter at night for atmosphere)
  scene.fog.near = sunH > 0 ? 10 : 5;
  scene.fog.far = sunH > 0 ? 55 : 30;

  // Stars
  stars.material.opacity = Math.max(0, -sunH) * 1.2;
  stars.material.transparent = true;
  stars.visible = sunH < 0.1;

  // Torches brighter at night
  const torchIntensity = 1.0 + Math.max(0, -sunH) * 2.5;
  for (const t of torchLights) t.intensity = torchIntensity;

  // HUD
  const hours = Math.floor(dayTime * 24);
  const mins = Math.floor((dayTime * 24 - hours) * 60);
  const el = document.getElementById('time-display');
  if (el) el.textContent = `${padTime(hours)}:${padTime(mins)} ${sunH > 0 ? 'DAY' : 'NIGHT'}`;
}
