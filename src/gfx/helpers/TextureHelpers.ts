
import { GfxColor, GfxDevice, GfxFormat, GfxTexture, makeTextureDescriptor2D } from "../platform/GfxPlatform";

export function makeSolidColorTexture2D(device: GfxDevice, color: GfxColor): GfxTexture {
    const tex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
    const data = new Uint8Array(4);
    data[0] = color.r * 0xFF;
    data[1] = color.g * 0xFF;
    data[2] = color.b * 0xFF;
    data[3] = color.a * 0xFF;
    device.uploadTextureData(tex, 0, [data]);
    return tex;
}
