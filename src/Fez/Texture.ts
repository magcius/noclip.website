
import { GfxTexture, GfxDevice, makeTextureDescriptor2D, GfxFormat } from "../gfx/platform/GfxPlatform";

export function makeTextureFromImageData(device: GfxDevice, imageData: ImageData): GfxTexture {
    const hostAccessPass = device.createHostAccessPass();
    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA, imageData.width, imageData.height, 1));
    hostAccessPass.uploadTextureData(texture, 0, [new Uint8Array(imageData.data.buffer)]);
    device.submitPass(hostAccessPass);
    return texture;
}
