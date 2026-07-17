// Entry point for esbuild bundling of @dgreenheck/ez-tree (+ its three.js
// peer dep). Bundled from the package's src/ (not the prebuilt ES module) so
// esbuild embeds each bark/leaf texture exactly once as a data URI and can
// tree-shake three.js. Relative paths bypass the package's exports map, which
// only exposes the root. The game only reads generated GEOMETRY
// (branchesMesh/leavesMesh BufferGeometry attributes) and the embedded
// textures — three.js never renders anything; Babylon consumes the arrays.
export { Tree, TreePreset, BarkType, Billboard, LeafType, TreeType } from '../node_modules/@dgreenheck/ez-tree/src/lib/index.js';
export { getBarkTexture, getLeafTexture } from '../node_modules/@dgreenheck/ez-tree/src/lib/textures.js';

// Raw data-URI strings of the embedded textures, for SYNCHRONOUS consumption
// by Babylon (three's TextureLoader populates .image asynchronously, so the
// three.Texture objects above are useless to Babylon at world-gen time).
// esbuild dedupes: these are the same files textures.js imports, so each
// image is embedded exactly once in the bundle.
import birchColor from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/birch_color_1k.jpg';
import birchNormal from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/birch_normal_1k.jpg';
import oakColor from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/oak_color_1k.jpg';
import oakNormal from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/oak_normal_1k.jpg';
import pineColor from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/pine_color_1k.jpg';
import pineNormal from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/pine_normal_1k.jpg';
import willowColor from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/willow_color_1k.jpg';
import willowNormal from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/bark/willow_normal_1k.jpg';
import ashLeaves from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/ash_color.png';
import aspenLeaves from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/aspen_color.png';
import oakLeaves from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/oak_color.png';
import pineLeaves from '../node_modules/@dgreenheck/ez-tree/src/lib/assets/leaves/pine_color.png';

export const TEXTURE_URIS = {
  bark: {
    birch: { color: birchColor, normal: birchNormal },
    oak: { color: oakColor, normal: oakNormal },
    pine: { color: pineColor, normal: pineNormal },
    willow: { color: willowColor, normal: willowNormal },
  },
  leaves: {
    ash: ashLeaves,
    aspen: aspenLeaves,
    oak: oakLeaves,
    pine: pineLeaves,
  },
};
