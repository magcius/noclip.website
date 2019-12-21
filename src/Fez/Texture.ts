
import { GfxTexture, GfxDevice, makeTextureDescriptor2D, GfxFormat } from "../gfx/platform/GfxPlatform";
import { XNA_Texture2D, XNA_SurfaceFormat } from "./XNB";
import { assert } from "../util";

export function makeTextureFromImageData(device: GfxDevice, imageData: ImageData): GfxTexture {
    const hostAccessPass = device.createHostAccessPass();
    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, imageData.width, imageData.height, 1));
    hostAccessPass.uploadTextureData(texture, 0, [new Uint8Array(imageData.data.buffer)]);
    device.submitPass(hostAccessPass);
    return texture;
}

export function makeTextureFromXNA_Texture2D(device: GfxDevice, texture2D: XNA_Texture2D): GfxTexture {
    const hostAccessPass = device.createHostAccessPass();
    assert(texture2D.format === XNA_SurfaceFormat.Color);
    assert(texture2D.levelData.length === 1);
    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture2D.width, texture2D.height, 1));
    hostAccessPass.uploadTextureData(texture, 0, [texture2D.levelData[0].createTypedArray(Uint8Array)]);
    device.submitPass(hostAccessPass);
    return texture;
}
