
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DataStream } from "./DataStream";
import { decompressPVRT } from "./pvrt_texture";
import { GfxDevice, GfxTextureDimension, GfxFormat, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform";
import { TextureHolder, LoadedTexture, TextureBase } from "../../TextureHolder";
import * as Viewer from '../../viewer';

// Port from https://github.com/yevgeniy-logachev/spvr2png/blob/master/SegaPVRImage.c

// wrapper for chunked data prefixed with a 4-char magic
interface ChunkData {
    magic: string;
    data: ArrayBufferSlice;
}

function readChunk(stream: DataStream, lengthOverride?: number): ChunkData {
    const magic = stream.readString(4);
    const length = stream.readUint32();
    const data = stream.readSlice((lengthOverride !== undefined) ? lengthOverride : length);
    return {magic, data};
}

export interface PVR_Texture extends TextureBase {
    name: string;
    meta: PVR_TextureMeta;
    data: Uint8Array;
}

export interface PVR_TextureMeta {
    format: PVRTFormat;
    mask: PVRTMask;
}

export interface PVR_GlobalIndex {
    id: number;
}

export interface PPVR {
    textures: PVR_Texture[];
}

export const enum PVRTFormat {
    ARGB1555    = 0x00, // single transparency bit
    RGB565      = 0x01, //
    ARGB4444    = 0x02, //
    YUV442      = 0x03, // <no planned support>
    //Bump        = 0x04, // <no planned support>
    //Ex4b        = 0x05, // <no planned support>
    //Ex8b        = 0x06, // <no planned support>
}

export const enum PVRTMask {

    Twiddled                                = 0x01,
    TwiddledMipMaps                         = 0x02,
    VectorQuantized                         = 0x03,
    VectorQuantizedMipMaps                  = 0x04,
    VectorQuantizedCustomCodeBook           = 0x10,
    VectorQuantizedCustomCodeBookMipMaps    = 0x11,
}

export function getFormatName(fmt: PVRTFormat): string {
    switch (fmt) {
    case PVRTFormat.ARGB1555:   return "ARGB1555";
    case PVRTFormat.RGB565:     return "RGB565";
    case PVRTFormat.ARGB4444:   return "ARGB4444";
    case PVRTFormat.YUV442:     return "YUV442";
    }
}

export function getMaskName(mask: PVRTMask): string {
    switch(mask) {
        case PVRTMask.Twiddled:                             return "Twiddled";
        case PVRTMask.TwiddledMipMaps:                      return "Twiddled (mips)";
        case PVRTMask.VectorQuantized:                      return "Vector Quantized";
        case PVRTMask.VectorQuantizedMipMaps:               return "Vector Quantized (mips)";
        case PVRTMask.VectorQuantizedCustomCodeBook:        return "Vector Quantized (custom)";
        case PVRTMask.VectorQuantizedCustomCodeBookMipMaps: return "Vector Quantized (custom)(mips)";
    }
}

function readGlobalIndexHeader(stream: DataStream): PVR_GlobalIndex {
    
    const chunk = readChunk(stream);
    assert(chunk.magic === "GBIX");

    const index = chunk.data.createDataView().getUint32(0x00, true);
    return {id: index};
}

function readImageDataHeader(stream: DataStream, length?: number): PVR_Texture {
    
    const chunk = readChunk(stream, length);
    assert(chunk.magic === "PVRT");

    const view = chunk.data.createDataView();

    const format = view.getUint8(0x00);
    const mask = view.getUint8(0x01);

    const width = view.getUint16(0x04, true);
    const height = view.getUint16(0x06, true);

    const imageDataView = chunk.data.createDataView(8);

    const meta = {format, mask};


    
    console.log(`${width}x${height}: ${getFormatName(format)}/${getMaskName(mask)}`);

    let result = decompressPVRT(imageDataView, meta, width, height);

    return {name: "", meta, data: result, width: width, height: height};
}

export function canParse(stream: DataStream): boolean {
    // Verify the magic bytes without updating the internal offset
    const magic = stream.readString(4, 0);
    return magic === "GBIX";
}

export function parse(buffer: ArrayBufferSlice, name: string): PVR_Texture {

    const stream = new DataStream(buffer);
 
    return parseFromStream(stream, name);
}

export function parseFromStream(buffer: DataStream, name: string): PVR_Texture {
    const index = readGlobalIndexHeader(buffer);

    switch(index.id)
    {
        case 12009:
        {
            let imageData = readImageDataHeader(buffer, 18440);
            imageData.name = name;
            
            return imageData;
        }

        default:
        {
            let imageData = readImageDataHeader(buffer);
            imageData.name = name;
            
            return imageData;
        }
    }
}

function textureToCanvas(texture: PVR_Texture): Viewer.Texture {

    const canvas = document.createElement("canvas");

    canvas.width = texture.width;
    canvas.height = texture.height;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.data);
    ctx.putImageData(imgData, 0, 0);
        
    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(texture.meta.format));

    return { name: texture.name, surfaces, extraInfo };
}

export class PVRTextureHolder extends TextureHolder<PVR_Texture> {
    public loadTexture(device: GfxDevice, textureEntry: PVR_Texture): LoadedTexture {

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, textureEntry.width, textureEntry.height, 1));
        
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [textureEntry.data]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(textureEntry);

        return { gfxTexture, viewerTexture };
    }
}
