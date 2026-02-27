// Entry point for esbuild bundling — selective re-exports for tree-shaking
// Only export what the game actually uses from @babylonjs/core
export { Engine } from '@babylonjs/core/Engines/engine';
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
export { Scene } from '@babylonjs/core/scene';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
export { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
export { Effect } from '@babylonjs/core/Materials/effect';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
export { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
export { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
export { LensFlareSystem } from '@babylonjs/core/LensFlares/lensFlareSystem';
export { LensFlare } from '@babylonjs/core/LensFlares/lensFlare';
export { Ray } from '@babylonjs/core/Culling/ray';
export { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
export { Viewport } from '@babylonjs/core/Maths/math.viewport';
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
export { ParticleHelper } from '@babylonjs/core/Particles/particleHelper';
export { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem';
export { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
// Physics (Havok)
export { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
export { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
export { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
export { PhysicsShapeBox, PhysicsShapeSphere, PhysicsShapeCapsule,
         PhysicsShapeCylinder, PhysicsShapeHeightField } from '@babylonjs/core/Physics/v2/physicsShape';
export { PhysicsRaycastResult } from '@babylonjs/core/Physics/physicsRaycastResult';
export { PhysicsMaterialCombineMode } from '@babylonjs/core/Physics/v2/physicsMaterial';
// Side-effects: feature registrations
import '@babylonjs/core/Helpers/sceneHelpers';          // scene.createDefaultEnvironment()
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';  // ShadowGenerator
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';         // scene.enablePhysics()
import '@babylonjs/core/LensFlares/lensFlareSystemSceneComponent';     // LensFlareSystem
import '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent'; // ClusteredLighting
import '@babylonjs/core/Particles/particleSystemComponent';            // ParticleSystem
export { NoiseProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/noiseProceduralTexture';
// Post-processing pipeline
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
import '@babylonjs/loaders/glTF';                       // GLTF loader
// WebGPU engine extensions — patch prototype methods (DynamicTexture, etc.) onto WebGPUEngine
import '@babylonjs/core/Engines/WebGPU/Extensions/index.js';
// Materials extension
export { TriPlanarMaterial } from '@babylonjs/materials/triPlanar';
