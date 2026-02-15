import * as THREE from 'three';

let sunLight, hemiLight, stars;

export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }
export function getStars() { return stars; }

export function initLighting(scene) {
  hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3a5a2a, 0.7);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xffeedd, 1.5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -50;
  sunLight.shadow.camera.right = 50;
  sunLight.shadow.camera.top = 50;
  sunLight.shadow.camera.bottom = -50;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 150;
  sunLight.shadow.bias = -0.001;
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Stars
  const sGeo = new THREE.BufferGeometry();
  const positions = [];
  for (let i = 0; i < 800; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const R = 180;
    positions.push(
      R * Math.sin(phi) * Math.cos(theta),
      R * Math.cos(phi),
      R * Math.sin(phi) * Math.sin(theta)
    );
  }
  sGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const sMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.6,
    transparent: true,
    opacity: 0,
  });
  stars = new THREE.Points(sGeo, sMat);
  scene.add(stars);
}
