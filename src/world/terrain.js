const flatZones = [];

export function addFlatZone(xMin, zMin, xMax, zMax) {
  flatZones.push({ xMin, zMin, xMax, zMax });
}

export function getTerrainHeight(wx, wz) {
  let h = Math.sin(wx * 0.03) * Math.cos(wz * 0.04) * 3.0
         + Math.sin(wx * 0.08 + 2.1) * Math.cos(wz * 0.06 + 0.5) * 1.5
         + Math.sin(wx * 0.15 + 0.7) * Math.cos(wz * 0.12 + 1.3) * 0.5;

  // Smooth flatten near building zones and spawn
  for (const zone of flatZones) {
    const dx = Math.max(0, zone.xMin - wx, wx - zone.xMax);
    const dz = Math.max(0, zone.zMin - wz, wz - zone.zMax);
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 6) {
      const t = d / 6;
      h *= t * t * (3 - 2 * t); // smoothstep
    }
  }

  return h;
}
