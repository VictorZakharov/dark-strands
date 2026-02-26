import { Engine, Scene, FreeCamera, Vector3, Color3, Color4,
         ImageProcessingConfiguration } from 'babylonjs';

let engine, scene, camera;

export function getEngine() { return engine; }
export function getScene() { return scene; }
export function getCamera() { return camera; }

// Compat shim — old code calls getRenderer().domElement for pointer lock / canvas access
export function getRenderer() {
  return {
    domElement: engine.getRenderingCanvas(),
    render() { scene.render(); },
    compile() { /* no-op — Babylon compiles on first render */ },
  };
}

export function initScene() {
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.prepend(canvas);

  engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

  scene = new Scene(engine);
  scene.useRightHandedSystem = true; // match Three.js coordinate conventions
  scene.ambientColor = new Color3(0.5, 0.5, 0.5); // base illumination for StandardMaterials
  // 8 slots = 2 global (hemi + sun) + up to 6 nearby torch PointLights.
  // Torch light culling in torches.js ensures only the closest are enabled.
  scene.maxSimultaneousLights = 8;

  // Fog (linear — starts further out to avoid nearby washout)
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = Color3.FromHexString('#87CEEB');
  scene.fogStart = 30;
  scene.fogEnd = 90;

  // Clear color (sky blue)
  scene.clearColor = new Color4(0.529, 0.808, 0.922, 1);

  // Tone mapping — ACES filmic
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType =
    ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure = 1.0;

  // Camera — no built-in controls (game handles all input via controls.js)
  camera = new FreeCamera('cam', new Vector3(0, 2, 0), scene);
  camera.fov = 75 * Math.PI / 180; // Three.js uses degrees, Babylon uses radians
  camera.minZ = 0.1;
  camera.maxZ = 400;
  camera.inputs.clear(); // detach all built-in camera input handlers

  engine.resize(); // pick up CSS size immediately
  window.addEventListener('resize', () => {
    engine.resize();
  });
}

/** No-op — kept for API compat */
export async function initRenderer() {}
