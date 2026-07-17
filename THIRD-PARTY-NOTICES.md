# Third-Party Notices

Dark Strands' own source code is licensed under the MIT License (see `LICENSE`).
This project also depends on and redistributes third-party software libraries
and art/audio assets, each under its own license. Those licenses and the
attributions they require are collected here.

All third-party components below use permissive, MIT-compatible licenses
(Apache-2.0, MIT, CC0-1.0, CC-BY-4.0). None impose copyleft or non-commercial
restrictions. The only components that legally *require* attribution when
redistributed are the Apache-2.0 libraries (NOTICE preservation), the MIT
libraries/assets (license-text preservation), and the CC-BY-4.0 fox model
(credit preservation). Everything from Poly Haven is CC0 (public domain, no
obligation) and is credited here only as a courtesy.

---

## Runtime libraries

Pulled in via `npm install` and bundled with esbuild (`lib/babylon.bundle.js`,
`lib/eztree.bundle.js`) for the deployed build. The bundles are not checked into
this repository (they are `.gitignore`d and produced by `npm run bundle:*`), but
the deployed site redistributes them, so their notices apply.

| Component | Version | License | Copyright / Source |
|-----------|---------|---------|--------------------|
| `@babylonjs/core` | ^9.17.0 | Apache-2.0 | © Microsoft / Babylon.js — https://github.com/BabylonJS/Babylon.js |
| `@babylonjs/loaders` | ^9.17.0 | Apache-2.0 | © Microsoft / Babylon.js — https://github.com/BabylonJS/Babylon.js |
| `@babylonjs/materials` | ^9.17.0 | Apache-2.0 | © Microsoft / Babylon.js — https://github.com/BabylonJS/Babylon.js |
| `@babylonjs/havok` | ^1.3.11 | MIT | © 2023 Babylon.js — https://github.com/BabylonJS/havok |
| `@dgreenheck/ez-tree` | ^1.1.0 | MIT | © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |
| `three` | ^0.185.1 | MIT | © 2010–2026 three.js authors — https://github.com/mrdoob/three.js |
| `esbuild` (dev only) | ^0.27.3 | MIT | © 2020 Evan Wallace — https://github.com/evanw/esbuild |

**Note on Havok:** `@babylonjs/havok` is published by the Babylon.js team under
the MIT License. The WebAssembly binary it ships wraps Havok's physics engine;
Babylon.js distributes it for free web use under the MIT terms above. This
project depends on the published npm package as-is and does not modify it.

Apache-2.0 requires that the license and any NOTICE be retained on
redistribution. The full Apache-2.0 text is available at
https://www.apache.org/licenses/LICENSE-2.0 and ships inside each `@babylonjs/*`
package (`node_modules/@babylonjs/<pkg>/license.md`).

### Runtime-fetched preset

The main-menu campfire loads Babylon.js's built-in **"fire" particle preset**
via `ParticleHelper.CreateAsync('fire')` (`src/systems/menu.js`), which fetches
the preset from Babylon.js's servers at runtime (Apache-2.0, hosted by the
Babylon.js project). It is fetched on demand, not redistributed by this
repository.

---

## Art & audio assets

Checked into this repository under `assets/`.

### Models

| File | License | Attribution / Source |
|------|---------|----------------------|
| `assets/models/Soldier.glb` | MIT | three.js examples — © three.js authors — https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf |
| `assets/models/Flower.glb` | MIT | three.js examples — © three.js authors — https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf |
| `assets/models/Fox.glb` | **CC-BY 4.0** | See required attribution below |
| `assets/models/eztree/grass.glb` | MIT | ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |
| `assets/models/eztree/flower_white.glb` | MIT | ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |
| `assets/models/eztree/flower_blue.glb` | MIT | ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |
| `assets/models/eztree/flower_yellow.glb` | MIT | ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |

**Required attribution for `assets/models/Fox.glb`** (Khronos glTF-Sample-Assets,
https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox):

> - Model by **PixelMannen** — CC0 1.0 Universal — © 2014, Public
> - Rigging & animation by **@tomkranis** — CC BY 4.0 International — © 2014, tomkranis
> - Conversion to glTF by **@AsoboStudio** and **@scurest** — CC BY 4.0 International — © 2017, @AsoboStudio and @scurest

### Textures

| File | License | Source |
|------|---------|--------|
| `assets/textures/grass.jpg` | CC0-1.0 | Poly Haven — https://polyhaven.com |
| `assets/textures/stone_wall.jpg` | CC0-1.0 | Poly Haven — https://polyhaven.com |
| `assets/textures/bark.jpg` | CC0-1.0 | Poly Haven — https://polyhaven.com |
| `assets/textures/wood_planks.jpg` | CC0-1.0 | Poly Haven — https://polyhaven.com |
| `assets/textures/fabric.png` | CC0-1.0 | Poly Haven — https://polyhaven.com |
| `assets/models/eztree/grass.jpg` | MIT | ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |

Tree bark and leaf textures are embedded (as data URIs) in the generated
`lib/eztree.bundle.js` from the ez-tree package. They are distributed as part of
ez-tree and are covered by its MIT license; ez-tree ships no separate texture
attribution.

### Audio

| File | License | Source |
|------|---------|--------|
| `assets/sounds/ambience.mp3` | MIT | Looping outdoor ambience from the ez-tree demo app — © 2024 Daniel Greenheck — https://github.com/dgreenheck/ez-tree |

---

## License texts

- **MIT** — reproduced in `LICENSE`; each MIT dependency also ships its own copy.
- **Apache-2.0** — https://www.apache.org/licenses/LICENSE-2.0
- **CC0-1.0** — https://creativecommons.org/publicdomain/zero/1.0/
- **CC-BY-4.0** — https://creativecommons.org/licenses/by/4.0/
