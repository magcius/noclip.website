import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { Color, OpaqueBlack } from "../../Color.js";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from "../../gfx/helpers/RenderGraphHelpers.js";
import { GfxChannelWriteMask, GfxDevice, GfxFormat, GfxMipFilterMode, GfxSampler, GfxTexFilterMode, GfxTexture, GfxWrapMode, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform.js";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper.js";
import { GfxRenderInst, GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager.js";
import { SceneContext } from "../../SceneBase.js";
import { ViewerRenderInput } from "../../viewer.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { TextureMapping } from "../../TextureHolder.js";
import { nArray } from "../../util.js";
import { readXboxTexture } from "./xbox.js";
import { RpWorld } from "./rpworld.js";
import { AtomicAllInOnePipeline } from "./pipelines/AtomicAllInOne.js";

export const enum RwPlatformID {
    NAPLATFORM = 0,
    PCD3D7 = 1,
    PCOGL = 2,
    MAC = 3,
    PS2 = 4,
    XBOX = 5,
    GAMECUBE = 6,
    SOFTRAS = 7,
    PCD3D8 = 8,
    PCD3D9 = 9,
}

export enum RwPluginID {
    NAOBJECT = 0x00,
    STRUCT = 0x01,
    STRING = 0x02,
    EXTENSION = 0x03,
    TEXTURE = 0x06,
    MATERIAL = 0x07,
    MATLIST = 0x08,
    FRAMELIST = 0x0E,
    GEOMETRY = 0x0F,
    CLUMP = 0x10,
    UNICODESTRING = 0x13,
    ATOMIC = 0x14,
    TEXTURENATIVE = 0x15,
    TEXDICTIONARY = 0x16,
    GEOMETRYLIST = 0x1A,
    BINMESHPLUGIN = 0x50E,
}

export interface RwChunkHeader {
    type: number;
    length: number;
    libraryID: number;
    end: number;
}

interface _TypedArrayConstructor<T extends ArrayBufferView> {
    readonly BYTES_PER_ELEMENT: number;
    new(buffer: ArrayBufferLike, byteOffset: number, length?: number): T;
}

export class RwStream {
    public view: DataView;
    public pos = 0;

    constructor(public buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public read(len: number): ArrayBufferSlice {
        const buf = this.buffer.subarray(this.pos, len);
        this.pos += len;
        return buf;
    }

    public readInt8(): number {
        const x = this.view.getInt8(this.pos);
        this.pos += 1;
        return x;
    }

    public readInt16(): number {
        const x = this.view.getInt16(this.pos, true);
        this.pos += 2;
        return x;
    }

    public readInt32(): number {
        const x = this.view.getInt32(this.pos, true);
        this.pos += 4;
        return x;
    }

    public readUint8(): number {
        const x = this.view.getUint8(this.pos);
        this.pos += 1;
        return x;
    }

    public readUint16(): number {
        const x = this.view.getUint16(this.pos, true);
        this.pos += 2;
        return x;
    }

    public readUint32(): number {
        const x = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return x;
    }

    public readFloat(): number {
        const x = this.view.getFloat32(this.pos, true);
        this.pos += 4;
        return x;
    }

    public readBool(): boolean {
        return this.readInt32() !== 0;
    }

    public readVec2(): vec2 {
        const x = this.readFloat();
        const y = this.readFloat();
        return [x, y];
    }

    public readVec3(): vec3 {
        const x = this.readFloat();
        const y = this.readFloat();
        const z = this.readFloat();
        return [x, y, z];
    }

    public readVec4(): vec4 {
        const x = this.readFloat();
        const y = this.readFloat();
        const z = this.readFloat();
        const w = this.readFloat();
        return [x, y, z, w];
    }

    public readRGBA(): Color {
        const r = this.readUint8() / 255.0;
        const g = this.readUint8() / 255.0;
        const b = this.readUint8() / 255.0;
        const a = this.readUint8() / 255.0;
        return { r, g, b, a };
    }

    public readRGBAReal(): Color {
        const r = this.readFloat();
        const g = this.readFloat();
        const b = this.readFloat();
        const a = this.readFloat();
        return { r, g, b, a };
    }

    public readString(size: number): string {
        const end = this.pos + size;
        let s = '';
        for (let i = 0; i < size; i++) {
            const c = this.readUint8();
            if (c === 0) {
                break;
            }
            s += String.fromCharCode(c);
        }
        this.pos = end;
        return s;
    }

    public findAndReadString(): string | null {
        while (this.pos < this.buffer.byteLength) {
            const header = this.readChunkHeader();
            if (header.type === RwPluginID.STRING) {
                return this.readString(header.length);
            } else if (header.type === RwPluginID.UNICODESTRING) {
                console.error("Unicode string not supported");
                return null;
            }
        }
        console.error("String not found");
        return null;
    }

    public readArray<T extends ArrayBufferView>(clazz: _TypedArrayConstructor<T>, count?: number): T {
        const arr = this.buffer.createTypedArray(clazz, this.pos, count);
        this.pos += arr.byteLength;
        return arr;
    }

    public readChunkHeader(): RwChunkHeader {
        const type = this.readUint32();
        const length = this.readUint32();
        const libraryID = this.readUint32();
        const end = this.pos + length;
        return { type, length, libraryID, end };
    }

    public findChunk(type: number): RwChunkHeader | null {
        while (this.pos < this.buffer.byteLength) {
            const header = this.readChunkHeader();
            if (header.type === type) {
                return header;
            }
            this.pos = header.end;
        }
        console.warn(`${RwPluginID[type]} chunk not found`);
        return null;
    }
}

export const enum RwRasterFormat {
    DEFAULT = 0x0000,
    _1555 = 0x0100,
    _565 = 0x0200,
    _4444 = 0x0300,
    LUM8 = 0x0400,
    _8888 = 0x0500,
    _888 = 0x0600,
    _16 = 0x0700,
    _24 = 0x0800,
    _32 = 0x0900,
    _555 = 0x0A00,
    AUTOMIPMAP = 0x1000,
    PAL8 = 0x2000,
    PAL4 = 0x4000,
    MIPMAP = 0x8000,
    PIXELFORMATMASK = 0x0F00,
    MASK = 0xFF00
}

export class RwRaster {
    private pixels: Uint8Array;
    
    public texture?: RwTexture;
    
    public gfxTexture: GfxTexture | null = null;
    public textureMapping = nArray(1, () => new TextureMapping());

    constructor(public width: number, public height: number, public depth: number, public format: RwRasterFormat) {
        this.pixels = new Uint8Array(4 * width * height);
    }

    public lock(rw: RwEngine) {
        if (this.gfxTexture) {
            rw.renderHelper.device.destroyTexture(this.gfxTexture);
            this.gfxTexture = null;
        }

        return this.pixels;
    }

    public unlock(rw: RwEngine) {
        this.gfxTexture = rw.renderHelper.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, 1));
        
        rw.renderHelper.device.uploadTextureData(this.gfxTexture, 0, [this.pixels]);

        const mapping = this.textureMapping[0];
        mapping.width = this.width;
        mapping.height = this.height;
        mapping.flipY = false;
        mapping.gfxTexture = this.gfxTexture;
    }

    public destroy(rw: RwEngine) {
        if (this.gfxTexture) {
            rw.renderHelper.device.destroyTexture(this.gfxTexture);
            this.gfxTexture = null;
        }
    }

    public bind(renderInst: GfxRenderInst, gfxSampler: GfxSampler) {
        if (this.gfxTexture) {
            const mapping = this.textureMapping[0];
            mapping.gfxSampler = gfxSampler;

            renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        }
    }
}

export const enum RwTextureFilterMode {
    NAFILTERMODE = 0,
    NEAREST,
    LINEAR,
    MIPNEAREST,
    MIPLINEAR,
    LINEARMIPNEAREST,
    LINEARMIPLINEAR,
    MASK = 0xFF
}

export const enum RwTextureAddressMode {
    NATEXTUREADDRESS = 0,
    WRAP,
    MIRROR,
    CLAMP,
    BORDER,
    UMASK = 0xF00,
    VMASK = 0xF000,
    MASK = (UMASK | VMASK)
}

export const enum RwTextureStreamFlags {
    NATEXTURESTREAMFLAG = 0x00,
    USERMIPMAPS = 0x01
}

function convertRwTextureFilterMode(filter: RwTextureFilterMode): GfxTexFilterMode {
    switch (filter) {
    case RwTextureFilterMode.NEAREST:          return GfxTexFilterMode.Point;
    case RwTextureFilterMode.LINEAR:           return GfxTexFilterMode.Bilinear;
    case RwTextureFilterMode.MIPNEAREST:       return GfxTexFilterMode.Point;
    case RwTextureFilterMode.MIPLINEAR:        return GfxTexFilterMode.Bilinear;
    case RwTextureFilterMode.LINEARMIPNEAREST: return GfxTexFilterMode.Point;
    case RwTextureFilterMode.LINEARMIPLINEAR:  return GfxTexFilterMode.Bilinear;
    default:                                   return GfxTexFilterMode.Point;
    }
}

function convertRwTextureFilterModeMip(filter: RwTextureFilterMode): GfxMipFilterMode {
    switch (filter) {
    case RwTextureFilterMode.NEAREST:          return GfxMipFilterMode.NoMip;
    case RwTextureFilterMode.LINEAR:           return GfxMipFilterMode.NoMip;
    case RwTextureFilterMode.MIPNEAREST:       return GfxMipFilterMode.Nearest;
    case RwTextureFilterMode.MIPLINEAR:        return GfxMipFilterMode.Nearest;
    case RwTextureFilterMode.LINEARMIPNEAREST: return GfxMipFilterMode.Linear;
    case RwTextureFilterMode.LINEARMIPLINEAR:  return GfxMipFilterMode.Linear;
    default:                                   return GfxMipFilterMode.NoMip;
    }
}

function convertRwTextureAddressMode(address: RwTextureAddressMode): GfxWrapMode {
    switch (address) {
    case RwTextureAddressMode.WRAP:             return GfxWrapMode.Repeat;
    case RwTextureAddressMode.MIRROR:           return GfxWrapMode.Mirror;
    case RwTextureAddressMode.CLAMP:            return GfxWrapMode.Clamp;
    case RwTextureAddressMode.BORDER:           return GfxWrapMode.Clamp; // unsupported
    default:                                    return GfxWrapMode.Repeat;
    }
}

export class RwTexture {
    public name: string;
    public mask: string;
    public raster: RwRaster;
    public filter = RwTextureFilterMode.NEAREST;
    public addressingU = RwTextureAddressMode.WRAP;
    public addressingV = RwTextureAddressMode.WRAP;

    private gfxSampler: GfxSampler | null = null;

    public getGfxSampler(rw: RwEngine) {
        if (!this.gfxSampler) {
            const texFilter = convertRwTextureFilterMode(this.filter);
            const mipFilter = convertRwTextureFilterModeMip(this.filter);
            const wrapS = convertRwTextureAddressMode(this.addressingU);
            const wrapT = convertRwTextureAddressMode(this.addressingV);
            
            this.gfxSampler = rw.renderHelper.renderCache.createSampler({
                magFilter: texFilter,
                minFilter: texFilter,
                mipFilter: mipFilter,
                wrapS: wrapS,
                wrapT: wrapT,
            });
        }

        return this.gfxSampler;
    }

    public destroy(rw: RwEngine) {
        this.raster.destroy(rw);
    }

    public static streamRead(stream: RwStream, rw: RwEngine): RwTexture | null {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find texture struct");
            return null;
        }
        
        const filterAndAddress = stream.readUint32();
        const filtering: RwTextureFilterMode = filterAndAddress & 0xFF;
        const addressingU: RwTextureAddressMode = (filterAndAddress >> 8) & 0xF;
        const addressingV: RwTextureAddressMode = (filterAndAddress >> 12) & 0xF;

        const textureName = stream.findAndReadString();
        if (textureName === null) {
            console.error("Could not find texture name");
            return null;
        }

        const textureMask = stream.findAndReadString();
        if (textureMask === null) {
            console.error("Could not find texture mask");
            return null;
        }
        
        const texture = rw.textureFindCallback?.(textureName, textureMask) || null;

        const extension = stream.findChunk(RwPluginID.EXTENSION);
        if (!extension) {
            console.error("Could not find texture extension");
            return null;
        }
        // Skip extensions
        stream.pos = extension.end;

        if (!texture) {
            console.warn(`Could not find texture ${textureName}`);
            return null;
        }

        texture.filter = filtering;
        texture.addressingU = addressingU;
        texture.addressingV = addressingV;

        return texture;
    }

    public static readNative(stream: RwStream, rw: RwEngine): RwTexture | null {
        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find texture native struct");
            return null;
        }

        const id = stream.readInt32();
        switch (id) {
        case RwPlatformID.XBOX:
            return readXboxTexture(stream, rw);
        default:
            console.error(`Unknown platform id: ${id}`);
            return null;
        }
    }
}

export class RwTexDictionary {
    public textures: RwTexture[] = [];

    public static streamRead(stream: RwStream, rw: RwEngine): RwTexDictionary | null {
        const texDict = new RwTexDictionary();

        if (!stream.findChunk(RwPluginID.STRUCT)) {
            console.error("Could not find tex dictionary struct");
            return null;
        }

        const numTextures = stream.readUint16();
        const deviceId = stream.readUint16();

        for (let i = 0; i < numTextures; i++) {
            if (!stream.findChunk(RwPluginID.TEXTURENATIVE)) {
                console.error("Could not find texture native");
                return null;
            }

            const texture = RwTexture.readNative(stream, rw);
            if (!texture) {
                return null;
            }

            texDict.textures.push(texture);
        }

        return texDict;
    }
}

export class RwFrame {
    public parent?: RwFrame;
    public matrix: mat4;
}

export class RwCamera {
    public viewMatrix = mat4.create();
    public worldMatrix = mat4.create();
    public nearPlane = 0.05;
    public farPlane = 10.0;
    public fogPlane = 5.0;
    public clearColor = OpaqueBlack;

    public begin(rw: RwEngine) {
        mat4.copy(this.viewMatrix, rw.viewerInput.camera.viewMatrix);
        mat4.copy(this.worldMatrix, rw.viewerInput.camera.worldMatrix);
    }

    public end(rw: RwEngine) {
    }
}

export const enum RwBlendFunction {
    NABLEND,
    ZERO,
    ONE,
    SRCCOLOR,
    INVSRCCOLOR,
    SRCALPHA,
    INVSRCALPHA,
    DESTALPHA,
    INVDESTALPHA,
    DESTCOLOR,
    INVDESTCOLOR,
    SRCALPHASAT
}

export const enum RwShadeMode {
    FLAT,
    GOURAUD
}

export const enum RwCullMode {
    NONE,
    BACK,
    FRONT
}

export const enum RwAlphaTestFunction {
    NEVER,
    LESS,
    EQUAL,
    LESSEQUAL,
    GREATER,
    NOTEQUAL,
    GREATEREQUAL,
    ALWAYS
}

export class RwRenderState {
    public textureRaster: RwRaster | null = null;
    public textureFilter = RwTextureFilterMode.LINEAR;
    public textureAddressU = RwTextureAddressMode.WRAP;
    public textureAddressV = RwTextureAddressMode.WRAP;
    public zTestEnable = true;
    public zWriteEnable = true;
    public shadeMode = RwShadeMode.GOURAUD;
    public srcBlend = RwBlendFunction.SRCALPHA;
    public destBlend = RwBlendFunction.INVSRCALPHA;
    public vertexAlphaEnable = false; // currently unsupported
    public fogEnable = false;
    public fogColor = OpaqueBlack;
    public cullMode = RwCullMode.BACK;
    public alphaTestFunction = RwAlphaTestFunction.GREATER; // currently only GREATER is supported
    public alphaTestFunctionRef = 0;

    // platform specific, just shoving this in here for now
    public channelWriteMask = GfxChannelWriteMask.AllChannels;
}

export class RwEngine {
    public textureFindCallback?: (name: string, maskName: string) => RwTexture | null = () => null;

    public world = new RpWorld();
    public camera = new RwCamera();
    public renderState = new RwRenderState();
    public defaultAtomicPipeline = new AtomicAllInOnePipeline();

    public renderHelper: GfxRenderHelper;
    public viewerInput: ViewerRenderInput;
    public renderInstList = new GfxRenderInstList();

    constructor(device: GfxDevice, context: SceneContext) {
        this.renderHelper = new GfxRenderHelper(device, context);
        this.viewerInput = context.viewerInput;
    }

    public destroy() {
        this.renderHelper.destroy();
    }

    public render() {
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, this.viewerInput, makeAttachmentClearDescriptor(this.camera.clearColor));
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, this.viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        
        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, this.viewerInput, mainColorTargetID);

        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.viewerInput.onscreenTexture);
        
        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);

        this.renderInstList.reset();
        this.renderHelper.renderInstManager.resetRenderInsts();
    }
}