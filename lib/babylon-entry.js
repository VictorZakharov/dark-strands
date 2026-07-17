// Entry point for esbuild bundling — selective re-exports for tree-shaking
// Only export what the game actually uses from @babylonjs/core
export { Engine } from '@babylonjs/core/Engines/engine';
export { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
export { Scene } from '@babylonjs/core/scene';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { Vector2, Vector3, Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector';
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
export { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
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
// (ShadowGenerator self-registers its scene component since 9.x)
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';         // scene.enablePhysics()
import '@babylonjs/core/LensFlares/lensFlareSystemSceneComponent';     // LensFlareSystem
import '@babylonjs/core/Lights/Clustered/clusteredLightingSceneComponent'; // ClusteredLighting
import '@babylonjs/core/Particles/particleSystemComponent';            // ParticleSystem
export { NoiseProceduralTexture } from '@babylonjs/core/Materials/Textures/Procedurals/noiseProceduralTexture';
// Post-processing pipeline
export { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent';
// AAA visual effects (postfx.js, skyDome.js, weather, water reflections)
export { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
export { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
export { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
export { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
export { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture';
export { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
export { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
export { Plane } from '@babylonjs/core/Maths/math.plane';
export { Constants } from '@babylonjs/core/Engines/constants';
export { DepthRenderer } from '@babylonjs/core/Rendering/depthRenderer';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';      // scene.enableDepthRenderer()
import '@babylonjs/core/Rendering/prePassRendererSceneComponent';    // SSAO2 prepass path
import '@babylonjs/core/Rendering/geometryBufferRendererSceneComponent'; // PrePassRenderer link hooks
import '@babylonjs/core/Layers/effectLayerSceneComponent';           // GlowLayer
import '@babylonjs/loaders/glTF';                       // GLTF loader
// WebGPU engine extensions — patch prototype methods (DynamicTexture, etc.) onto WebGPUEngine
import '@babylonjs/core/Engines/WebGPU/Extensions/index.js';
// Materials extension
export { TriPlanarMaterial } from '@babylonjs/materials/triPlanar';
