import { convertToCanvas } from "../../gfx/helpers/TextureConversionHelpers.js";
import * as Viewer from "../../viewer.js";
import { DescentGfxTexture } from "../Common/AssetCache.js";

export function descentGfxTextureToCanvas(
    texture?: DescentGfxTexture,
): Viewer.Texture | null {
    if (texture == null) return null;
    const canvas = convertToCanvas(
        texture.pixels,
        texture.bitmap.width,
        texture.bitmap.height,
    );
    const name = texture.bitmap.filename;
    canvas.title = name;
    return { name, surfaces: [canvas] };
}
