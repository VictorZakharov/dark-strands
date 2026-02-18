# Resources

## AI 3D Model Generation — Service Research (Feb 2026)

Services for generating 3D models from images or text prompts. All must export GLB/GLTF for use in this Three.js project.

### Top Picks

| Service | Type | GLB | Free Tier | Commercial (Free) | Low-Poly Mode |
|---------|------|-----|-----------|-------------------|---------------|
| **[Meshy AI](https://www.meshy.ai/)** | Image+Text→3D | Yes | 100 credits/mo | No (CC BY 4.0) | Yes |
| **[Tripo3D](https://www.tripo3d.ai/)** | Image+Text→3D | Yes | 300-600 credits/mo | No (CC BY 4.0) | Yes |
| **[Rodin (Hyper3D)](https://hyper3d.ai/)** | Image+Text→3D | Yes | 40 one-time credits | **Yes (all tiers)** | No |
| **[Sloyd AI](https://www.sloyd.ai/)** | Text→3D (procedural) | Yes | Preview access | Check ToS | Yes |
| **[TRELLIS.2](https://github.com/microsoft/TRELLIS.2)** | Image→3D (open source) | Yes | Fully free | **Yes (MIT)** | No |

### Meshy AI — Best all-rounder
- **URL:** https://www.meshy.ai/
- Image-to-3D and text-to-3D with dedicated **Low Poly Mode** for game devs
- Exports: GLB, FBX, OBJ, STL, USDZ, BLEND
- Free: 100 credits/month (~10 models), no credit card needed
- Paid: Pro $20-30/month for 1,000 credits + commercial rights + private models
- **Gotcha:** Free tier models are public (CC BY 4.0, attribution required). Need Pro for commercial use.

### Tripo3D — Best for characters
- **URL:** https://www.tripo3d.ai/
- Strongest character topology — clean quads, **auto-rigging**, animation-ready output
- Smart Low Poly mode, retopology, and LOD generation built in
- Exports: GLB, FBX, OBJ, USD, STL
- Free: 300-600 credits/month (~10 models)
- Paid: Creator $30/month
- **Gotcha:** Same CC BY 4.0 restriction on free tier as Meshy.

### Rodin AI (Hyper3D) — Best free commercial license
- **URL:** https://hyper3d.ai/
- Image-to-3D and text-to-3D with quad-mesh output
- Exports: GLB, FBX, OBJ
- Free: 40 one-time credits (not recurring)
- **Commercial rights on ALL tiers including free** — unique advantage
- Paid: Education $15/month, Creator $30/month
- **Gotcha:** 40 free credits are one-time only, not monthly.

### Sloyd AI — Best for game props
- **URL:** https://www.sloyd.ai/
- Procedural + AI hybrid, built specifically for game assets
- Clean topology, auto UV unwrapping, LOD generation
- Template library for common game objects (crates, barrels, weapons, furniture)
- Exports: GLB, OBJ, STL
- Free: Preview text-to-3D and image-to-3D with exports
- Paid: Plus $15/month, Pro $50/month
- **Gotcha:** Image-to-3D is still in preview/beta. Better for hard-surface props than organic shapes.

### Microsoft TRELLIS.2 — Best fully free option
- **URL:** https://github.com/microsoft/TRELLIS.2
- **Free demo:** https://huggingface.co/spaces/trellis-community/TRELLIS (no signup)
- Open-source image-to-3D (MIT license, CVPR 2025 Spotlight)
- Full PBR materials (base color, roughness, metallic, opacity)
- Exports: GLB, OBJ, PLY, GLTF, STL, USDZ
- **100% free, commercial use, no attribution required**
- **Gotcha:** Output is high-poly — needs decimation in Blender for real-time use in Three.js. Self-hosting requires NVIDIA GPU.
- **Local requirements:** Linux only, NVIDIA GPU with 24GB+ VRAM, Python 3.8+, CUDA 12.4. ~17s per model at 1024³ on H100.

### Other Options

| Service | Notes |
|---------|-------|
| **[CSM AI](https://csm.ai/)** | Research-grade, multi-view input, 10 free credits only |
| **[Fast3D](https://fast3d.io/)** | Speed-focused (~10s generation), GLB export, free tier with limits |
| **[Polycam](https://poly.cam/)** | Photogrammetry from photos/LiDAR, free GLTF export, real objects only |
| **[KIRI Engine](https://www.kiriengine.app/)** | Mobile photogrammetry, GLB export, real objects only |
| **[Shap-E](https://github.com/openai/shap-e)** | OpenAI open-source, MIT license, but dated quality (2023), no native GLB |

### Recommendations for This Project

- **Quick asset prototyping:** Meshy AI or Tripo3D (free tier, direct GLB export, low-poly modes)
- **Characters with animation:** Tripo3D (auto-rigging + clean quad topology)
- **Hard-surface props:** Sloyd AI (game-optimized output, UV + LOD built in)
- **Free with commercial rights:** TRELLIS.2 via HuggingFace (MIT, but needs Blender decimation)
- **Scanning real objects:** Polycam (free GLTF)
- **Avoid:** Shap-E (quality too low for 2026 standards)

### Workflow: AI Model → Three.js

1. Generate model on chosen service (image or text prompt)
2. Export as GLB
3. *(If high-poly)* Open in Blender → Decimate modifier → re-export as GLB
4. Place in `assets/models/`
5. Add entry to `MODEL_REGISTRY` in `src/entities/models.js`
6. Models auto-scale to `targetHeight` on load

## Free 3D Model Libraries

From `CLAUDE.md` — hand-curated, free-to-use model sources:

| Source | License | Notes |
|--------|---------|-------|
| **[Kenney.nl](https://kenney.nl/assets?t=gltf)** | CC0 | Hundreds of low-poly packs (nature, castle, medieval, furniture) |
| **[Quaternius](https://quaternius.com/)** | CC0 | 1400+ low-poly models (Medieval Village, Stylized Nature, animated characters) |
| **[Poly Pizza](https://poly.pizza/)** | Varies | Searchable low-poly models, has API |
| **[Poly Haven](https://polyhaven.com)** | CC0 | Textures, HDRIs, and some models |
| **[Khronos glTF-Sample-Models](https://github.com/KhronosGroup/glTF-Sample-Models)** | Varies | Reference models (Duck, Lantern, Box, CesiumMan) |
| **[pmndrs Market](https://market.pmnd.rs/)** | CC0 | React Three Fiber community models |
| **[Three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf)** | MIT | Soldier, Horse, Flower, and more |
