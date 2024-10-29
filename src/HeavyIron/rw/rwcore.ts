import { mat4, ReadonlyVec3, vec2, vec3, vec4 } from "gl-matrix";
import { Color, OpaqueBlack } from "../../Color.js";
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxWrapMode } from "../../gfx/platform/GfxPlatform.js";
import { SceneContext } from "../../SceneBase.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { readXboxTexture } from "./xbox.js";
import { RpWorld } from "./rpworld.js";
import { AtomicAllInOnePipeline } from "./pipelines/AtomicAllInOne.js";
import { RwGfx, RwGfxRaster } from "./rwgfx.js";

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
        return this.readUint8() !== 0;
    }

    public readBool32(): boolean {
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

function convertRasterFormat(format: RwRasterFormat): GfxFormat {
    switch (format & RwRasterFormat.PIXELFORMATMASK) {
    case RwRasterFormat._8888:
    case RwRasterFormat._888:
        return GfxFormat.U8_RGBA_NORM;
    default: // TODO
        return GfxFormat.U8_RGBA_NORM;
    }
}

export class RwRaster {
    private pixels: Uint8Array;
    
    public texture?: RwTexture;
    public gfxRaster: RwGfxRaster;

    constructor(rw: RwEngine, public width: number, public height: number, public depth: number, public format: RwRasterFormat) {
        this.gfxRaster = rw.gfx.createRaster(width, height, format);
        this.pixels = new Uint8Array(4 * width * height);
    }

    public lock(rw: RwEngine) {
        rw.gfx.lockRaster(this.gfxRaster);
        return this.pixels;
    }

    public unlock(rw: RwEngine) {
        rw.gfx.unlockRaster(this.gfxRaster, this.pixels);
    }

    public destroy(rw: RwEngine) {
        rw.gfx.destroyRaster(this.gfxRaster);
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
        rw.gfx.cameraBegin(this);
    }

    public end(rw: RwEngine) {
        rw.gfx.cameraEnd(this);
    }

    public frustumContainsSphere(center: ReadonlyVec3, radius: number, rw: RwEngine) {
        return rw.gfx.cameraFrustumContainsSphere(center, radius);
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
    private textureRaster: RwRaster | null = null;
    private textureFilter = RwTextureFilterMode.LINEAR;
    private textureAddressU = RwTextureAddressMode.WRAP;
    private textureAddressV = RwTextureAddressMode.WRAP;
    private shadeMode = RwShadeMode.GOURAUD;
    private vertexAlphaEnable = false; // currently unsupported

    constructor(private gfx: RwGfx) {
        gfx.enableDepthTest();
        gfx.enableDepthWrite();
        gfx.setSrcBlend(RwBlendFunction.SRCALPHA);
        gfx.setDstBlend(RwBlendFunction.INVSRCALPHA);
        gfx.disableFog();
        gfx.setFogColor(OpaqueBlack);
        gfx.setCullMode(RwCullMode.BACK);
        gfx.enableAlphaTest();
        gfx.setAlphaFunc(RwAlphaTestFunction.GREATER);
        gfx.setAlphaRef(0);
    }

    public getTextureRaster(): RwRaster | null {
        return this.textureRaster;
    }

    public setTextureRaster(raster: RwRaster | null) {
        this.textureRaster = raster;
    }

    public getTextureFilter(): RwTextureFilterMode {
        return this.textureFilter;
    }

    public setTextureFilter(filter: RwTextureFilterMode) {
        this.textureFilter = filter;
    }

    public getTextureAddressU(): RwTextureAddressMode {
        return this.textureAddressU;
    }

    public setTextureAddressU(address: RwTextureAddressMode) {
        this.textureAddressU = address;
    }

    public getTextureAddressV(): RwTextureAddressMode {
        return this.textureAddressV;
    }

    public setTextureAddressV(address: RwTextureAddressMode) {
        this.textureAddressV = address;
    }

    public isZTestEnabled(): boolean {
        return this.gfx.getDepthTest();
    }

    public setZTestEnabled(enabled: boolean) {
        if (enabled) {
            this.gfx.enableDepthTest();
        } else {
            this.gfx.disableDepthTest();
        }
    }

    public isZWriteEnabled(): boolean {
        return this.gfx.getDepthWrite();
    }

    public setZWriteEnabled(enabled: boolean) {
        if (enabled) {
            this.gfx.enableDepthWrite();
        } else {
            this.gfx.disableDepthWrite();
        }
    }

    public getShadeMode(): RwShadeMode {
        return this.shadeMode;
    }

    public setShadeMode(shade: RwShadeMode) {
        this.shadeMode = shade;
    }

    public getSrcBlend(): RwBlendFunction {
        return this.gfx.getSrcBlend();
    }

    public setSrcBlend(blend: RwBlendFunction) {
        this.gfx.setSrcBlend(blend);
    }

    public getDstBlend(): RwBlendFunction {
        return this.gfx.getDstBlend();
    }

    public setDstBlend(blend: RwBlendFunction) {
        this.gfx.setDstBlend(blend);
    }

    public getVertexAlphaEnabled(): boolean {
        return this.vertexAlphaEnable;
    }

    public setVertexAlphaEnabled(enabled: boolean) {
        this.vertexAlphaEnable = enabled;
    }

    public isFogEnabled(): boolean {
        return this.gfx.isFogEnabled();
    }

    public setFogEnabled(enabled: boolean) {
        if (enabled) {
            this.gfx.enableFog();
        } else {
            this.gfx.disableFog();
        }
    }

    public getFogColor(): Color {
        return this.gfx.getFogColor();
    }

    public setFogColor(color: Color) {
        this.gfx.setFogColor(color);
    }

    public getCullMode(): RwCullMode {
        return this.gfx.getCullMode();
    }

    public setCullMode(cull: RwCullMode) {
        this.gfx.setCullMode(cull);
    }

    public getAlphaTestFunction(): RwAlphaTestFunction {
        return this.gfx.getAlphaFunc();
    }

    public setAlphaTestFunction(alphaTest: RwAlphaTestFunction) {
        this.gfx.setAlphaFunc(alphaTest);
    }

    // 0 to 255
    public getAlphaTestFunctionRef(): number {
        return this.gfx.getAlphaRef() * 255.0;
    }

    // 0 to 255
    public setAlphaTestFunctionRef(ref: number) {
        this.gfx.setAlphaRef(ref / 255.0);
    }
}

export class RwEngine {
    public gfx: RwGfx;

    public textureFindCallback?: (name: string, maskName: string) => RwTexture | null = () => null;

    public world = new RpWorld();
    public camera = new RwCamera();
    public renderState: RwRenderState;
    public defaultAtomicPipeline = new AtomicAllInOnePipeline();

    constructor(device: GfxDevice, context: SceneContext) {
        this.gfx = new RwGfx(device, context);
        this.renderState = new RwRenderState(this.gfx);
    }

    public destroy() {
        this.gfx.destroy();
    }

    public render() {
        this.gfx.render(this.camera);
    }
}