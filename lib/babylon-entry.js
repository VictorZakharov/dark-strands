// Entry point for esbuild bundling — re-exports Babylon.js modules
// Run: node scripts/bundle-babylon.js
export * from '@babylonjs/core';
import '@babylonjs/loaders/glTF';  // side-effect: registers GLTF loader
export { TriPlanarMaterial } from '@babylonjs/materials/triPlanar';
