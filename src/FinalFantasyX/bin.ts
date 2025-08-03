import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { align, assert, assertExists, hexzero, readString } from "../util.js";
import { AABB } from "../Geometry.js";
import { GSRegister, GSMemoryMap, GSRegisterTEX0, GSRegisterCLAMP, getGSRegisterTEX0, getGSRegisterCLAMP, gsMemoryMapNew, gsMemoryMapUploadImage, GSPixelStorageFormat, gsMemoryMapReadImagePSMT4_PSMCT32, gsMemoryMapReadImagePSMT8_PSMCT32, gsMemoryMapReadImagePSMT4HL_PSMCT32, gsMemoryMapReadImagePSMT4HH_PSMCT32, gsMemoryMapReadImagePSMT8H_PSMCT32, GSWrapMode, gsMemoryMapReadImagePSMCT16, GSCLUTPixelStorageFormat } from "../Common/PS2/GS.js";
import { mat4, vec3, vec4 } from "gl-matrix";
import { Color, colorFromRGBA, colorNewFromRGBA } from "../Color.js";
import { angleDist, MathConstants } from "../MathHelpers.js";
import { parseParticleData, LevelParticles, parseFlipbook, parseGeometry } from "./particle.js";
import { MagicLayout, sniffMagic } from "./magic.js";
import { parseActorMagicCommands } from "./actor.js";

const enum VifUnpackVN {
    S = 0x00,
    V2 = 0x01,
    V3 = 0x02,
    V4 = 0x03,
}

const enum VifUnpackVL {
    VL_32 = 0x00,
    VL_16 = 0x01,
    VL_8 = 0x02,
    VL_5 = 0x03,
}

const enum VifUnpackFormat {
    S_32 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_32),
    S_16 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_16),
    S_8 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
}

function getVifUnpackVNComponentCount(vn: VifUnpackVN): number {
    return vn + 1;
}

function getVifUnpackFormatByteSize(format: number): number {
    const vn: VifUnpackVN = (format >>> 2) & 0x03;
    const vl: VifUnpackVL = (format >>> 0) & 0x03;
    const compCount = getVifUnpackVNComponentCount(vn);
    if (vl === VifUnpackVL.VL_8) {
        return 1 * compCount;
    } else if (vl === VifUnpackVL.VL_16) {
        return 2 * compCount;
    } else if (vl === VifUnpackVL.VL_32) {
        return 4 * compCount;
    } else if (vl === VifUnpackVL.VL_5) {
        // V4-5. Special case: 16 bits for the whole format.
        assert(vn === 0x03);
        return 2;
    } else {
        throw "whoops";
    }
}

export interface LevelDrawCall {
    indexOffset: number;
    indexCount: number;
    textureIndex: number;
    gsConfiguration: GSConfiguration;
    effectType: LevelEffectType;
    isTranslucent: boolean;
    flags: number;
    center: vec3;
}

export interface LevelModel {
    vertexData: Float32Array;
    indexData: Uint32Array;
    drawCalls: LevelDrawCall[];
}

export interface Texture {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    pixels: Uint8Array;
    name: string;
    width: number;
    height: number;
}

export interface AnimatedTexture {
    effect: PartEffect | null;
    active: boolean;
    explicitIndex: number;
    textureIndices: number[];
}

export interface LevelPart {
    isSkybox: boolean;
    layer: number;
    position: vec3;
    euler: vec3;
    eulerOrder: number;
    model?: LevelModel;
    effectIndices: number[];
}

interface LevelGeoData {
    parts: LevelPart[];
    effects: PartEffect[];
    animatedTextures: AnimatedTexture[];
    clearColor: Color;
    fog?: FogParams;
    envMapDirection: mat4;
}

export interface LevelData {
    textures: Texture[];
    geo: LevelGeoData;
    particles: LevelParticles;
    map?: HeightMap;
}

export interface GSConfiguration {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    tex1_1_data0: number;
    tex1_1_data1: number;
    alpha_data0: number;
    alpha_data1: number;
    test_1_data0: number;
    test_1_data1: number;
    depthWrite: boolean;
    cullingEnabled: boolean;
    prim: number;
}

function structsEqual(a: any, b: any): boolean {
    for (let field in a)
        if ((a as any)[field] !== (b as any)[field])
            return false;
    return true;
}

function gsConfigurationEqual(a: GSConfiguration, b: GSConfiguration) {
    if (!structsEqual(a.tex0, b.tex0)) return false;
    if (!structsEqual(a.clamp, b.clamp)) return false;
    if (a.tex1_1_data0 !== b.tex1_1_data0 || a.tex1_1_data1 !== b.tex1_1_data1) return false;
    if (a.alpha_data0 !== b.alpha_data0 || a.alpha_data1 !== b.alpha_data1) return false;
    if (a.test_1_data0 !== b.test_1_data0 || a.test_1_data1 !== b.test_1_data1) return false;
    if (a.depthWrite !== b.depthWrite) return false;
    if (a.cullingEnabled !== b.cullingEnabled) return false;
    if (a.prim !== b.prim) return false;
    return true;
}

const enum MapSectionType {
    LEVEL_PART,
    MODEL,
    TEXTURE,
    PALETTES,
    LIGHTING,
    EFFECT,
    ANIMATED_TEXTURE,
    UNUSED,
    COMBINED_EFFECT,
}

export const enum LevelEffectType {
    NONE,
    POSITIONS,
    UNUSED,
    UV_LERP,
    COLORS,
    UV_SCROLL,
    ENV_MAP, // actually a different VU program, not an effect
}

function paletteAddress(format: number, index: number): number {
    let blockLength = 0, dest = 0;
    let blockOffs = 0x04, blockStep = 0x08;
    switch (format) {
        case 2: {
            blockLength = 0x20;
            dest = 0x2D00;
            blockOffs = 0x10;
            blockStep = 0x04;
        } break;
        case 3: {
            blockLength = 0x20;
            dest = 0x600;
        } break;
        case 4: {
            blockLength = 0x10;
            dest = 0x2080;
        } break;
        default:
            throw `bad palette type ${format}`
    }
    // the first blockLength palettes are arranged in groups of four with weird packing,
    // while subsequent ones are stored consecutively at a different address
    if (index >= blockLength)
        return 0x2E00 + (index - blockLength) * 0x4;

    return dest + (index >>> 2) * 0x20 + blockOffs + (index % 4) * blockStep;
}

interface LevelTextures {
    gsMap: GSMemoryMap;
    particleMap: GSMemoryMap;
    paletteType: number;
}

export function parseLevelTextures(buffer: ArrayBufferSlice, commonBuffer: ArrayBufferSlice): LevelTextures {
    assert(readString(buffer, 0, 4) === "MAP1")
    const view = buffer.createDataView();
    let offs = view.getUint32(0x14, true);

    const gsMap = gsMemoryMapNew();
    let paletteType = -1;

    if (offs !== 0) {
        assert(view.getUint32(offs) === 0x65432100)
        const sectionCount = view.getUint32(offs + 0x0C, true);
        offs += 0x40;

        for (let i = 0; i < sectionCount; i++) {
            const sectionType: MapSectionType = view.getUint32(offs + 0x00, true);
            const sectionLength = view.getUint32(offs + 0x04, true);
            offs += 0x40;

            if (sectionType === MapSectionType.TEXTURE) {
                const address = view.getUint32(offs + 0x04, true);
                const format = view.getUint32(offs + 0x0C, true);
                const isPSMT4 = format === GSPixelStorageFormat.PSMT4;
                const bufferWidth = view.getUint32(offs + 0x08, true) >>> (isPSMT4 ? 1 : 0);
                const width = view.getUint32(offs + 0x10, true) >>> (isPSMT4 ? 1 : 0);
                const height = view.getUint32(offs + 0x14, true) >>> (isPSMT4 ? 2 : 0);
                gsMemoryMapUploadImage(gsMap, isPSMT4 ? GSPixelStorageFormat.PSMCT32 : format, address, bufferWidth, 0, 0, width, height, buffer.slice(offs + 0x40));
            } else if (sectionType === MapSectionType.PALETTES) {
                assert(paletteType === -1, "multiple palette lists");
                paletteType = view.getUint32(offs - 0x40 + 0x24, true); // actually in the header, not the data block
                {
                // if (paletteType === 0)
                //     debugger
                // else {
                    let paletteOffs = offs;
                    for (let j = 0; j < 0x48; j++) {
                        gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteAddress(paletteType || 4, j), 1, 0, 0, 16, 16, buffer.slice(paletteOffs));
                        paletteOffs += 0x400;
                    }
                }
            } else
                throw `bad map section type ${sectionType} in textures`;

            offs += sectionLength;
        }
    }

    const particleMap = gsMemoryMapNew();
    const particleOffs = view.getUint32(0x18, true);
    uploadSpriteTextures(commonBuffer, 0, particleMap);
    if (particleOffs !== 0)
        uploadSpriteTextures(buffer, particleOffs, particleMap);

    return { gsMap, paletteType, particleMap };
}

export function parseMagicFile(id: number, buffer: ArrayBufferSlice, common: ArrayBufferSlice | null, textures: Texture[]): LevelParticles {
    const layout = sniffMagic(id, buffer);
    if (!layout)
        return {
            emitters: [],
            flipbooks: [],
            behaviors: [],
            geometry: [],
            patterns: [],
            maxBufferSize: 0,
            waterTextures: [],
        }

    const gs = gsMemoryMapNew();
    for (let h of layout.headers)
        uploadSpriteTextures(buffer, h, gs);
    if (common)
        uploadSpriteTextures(common, 0, gs);
    // uploadSpriteTextures(buffer, layout.headers[0], gs);

    const view = buffer.createDataView();
    const dataStart = view.getUint32(layout.headers[0] + 0x3C, true) + layout.headers[0];
    assert(view.getUint32(layout.headers[0] + 0x3C, true) !== view.getUint32(layout.headers[0] + 0x40, true))
    const magicStart = view.getUint32(dataStart + 0x20, true);
    assert(magicStart !== 0 && view.getUint16(dataStart + 0x50, true) > layout.particleIndex);
    const particleStart = view.getUint32(dataStart + magicStart + 4*layout.particleIndex, true) + dataStart;

    const data = parseParticleData(buffer, particleStart, gs, textures, [], layout);
    // if (data.behaviors.length > 1)
    //     console.log("******************** BEHAVIOR COUNT", data.behaviors.length, " ***************")

    const extraFlipbookCount = view.getUint16(dataStart + 0x52, true);
    const extraFlipbookOffset = view.getUint32(dataStart + 0x24, true);
    if (extraFlipbookCount > 0 && extraFlipbookOffset !== 0) {
        data.extraFlipbookIndex = data.flipbooks.length;
        let offs = dataStart + extraFlipbookOffset;
        for (let i = 0; i < extraFlipbookCount; i++, offs += 4) {
            data.flipbooks.push(parseFlipbook(buffer, view.getUint32(offs, true) + dataStart, gs, textures, true));
        }
    }
    return data;
}

interface SpriteDesc {
    tex0: GSRegisterTEX0;
    width: number;
    height: number;
    format: number;
}

function uploadSpriteTextures(buffer: ArrayBufferSlice, start: number, gsMap: GSMemoryMap): SpriteDesc[] {
    const view = buffer.createDataView(start);

    const spriteSpecsOffset = view.getUint32(0x08, true);
    const clutSpecsOffset = view.getUint32(0x0C, true);
    const dataOffset = view.getUint32(0x3C, true);

    const spriteCount = view.getUint16(dataOffset + 0x44, true);
    let imageOffs = view.getUint32(dataOffset + 0x08, true);
    let specOffs = spriteSpecsOffset;
    const descs: SpriteDesc[] = [];
    for (let i = 0; i < spriteCount; i++, specOffs += 0x20, imageOffs += 4) {
        const imageStart = view.getUint32(dataOffset + imageOffs, true);
        if (imageStart === 0)
            continue
        assert(imageStart !== 0);
        const tex0Low = view.getUint32(specOffs + 0x0, true);
        const tex0Hi = view.getUint32(specOffs + 0x4, true);
        const addr = tex0Low & 0x3FFF;
        const x = view.getInt8(specOffs + 0x08) << 4;
        const y = view.getInt8(specOffs + 0x09) << 4;
        const bufWidth = view.getInt8(specOffs + 0x0A) >>> 2;
        const width = view.getUint16(specOffs + 0x0C, true);
        const height = view.getUint16(specOffs + 0x0E, true);
        const format = view.getInt8(specOffs + 0x18);
        descs.push({width, height, tex0: getGSRegisterTEX0(tex0Low, tex0Hi), format});
        // console.log("sprite", i, format, hexzero(addr, 4), width, height, bufWidth);
        gsMemoryMapUploadImage(gsMap, format, addr, bufWidth, x, y, width, height, buffer.slice(start + dataOffset + imageStart));
    }

    // palettes
    const clutCount = view.getUint16(dataOffset + 0x46, true);
    imageOffs = view.getUint32(dataOffset + 0x0C, true);
    specOffs = clutSpecsOffset;
    for (let i = 0; i < clutCount; i++, specOffs += 0x10, imageOffs += 4) {
        const imageStart = view.getUint32(dataOffset + imageOffs, true);
        if (imageStart === 0)
            continue;
        const addr = view.getUint16(specOffs, true) & 0x3FFF;
        assert(view.getUint8(specOffs + 0x9) === 1);
        // console.log("palette", i, hexzero(addr, 4))
        gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, addr, 1, 0, 0, 0x10, 0x10, buffer.slice(start + dataOffset + imageStart));
    }

    return descs;
}

function vec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
    )
}

function effectiveTexel(x: number, min: number, max: number, mode: GSWrapMode): number {
    if (mode === GSWrapMode.CLAMP || mode === GSWrapMode.REPEAT)
        return x;
    if (mode === GSWrapMode.REGION_CLAMP)
        return min + x;
    return max | (x & min);
}

function cropTexture(texture: Texture, clamp: GSRegisterCLAMP): void {
    let width = texture.width, height = texture.height;
    if (clamp.wms === GSWrapMode.REGION_REPEAT) {
        let i = 0;
        let mask = clamp.minu;
        while (mask !== 0) {
            i++;
            mask = mask >>> 1;
        }
        width = 1 << i;
    } else if (clamp.wms === GSWrapMode.REGION_CLAMP) {
        width = clamp.maxu - clamp.minu + 1;
    }
    if (clamp.wmt === GSWrapMode.REGION_REPEAT) {
        let i = 0;
        let mask = clamp.minv;
        while (mask !== 0) {
            i++;
            mask = mask >>> 1;
        }
        height = 1 << i;
    } else if (clamp.wmt === GSWrapMode.REGION_CLAMP) {
        height = clamp.maxv - clamp.minv + 1;
    }

    const newPixels = new Uint8Array(height * width * 4);
    let dst = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const origX = effectiveTexel(x, clamp.minu, clamp.maxu, clamp.wms);
            const origY = effectiveTexel(y, clamp.minv, clamp.maxv, clamp.wmt);
            const src = (texture.width * origY + origX) * 4;

            newPixels[dst + 0] = texture.pixels[src + 0];
            newPixels[dst + 1] = texture.pixels[src + 1];
            newPixels[dst + 2] = texture.pixels[src + 2];
            newPixels[dst + 3] = texture.pixels[src + 3];
            dst += 4;
        }
    }

    texture.pixels = newPixels;
    texture.width = width;
    texture.height = height;
}

function decodeTexture(gsMap: GSMemoryMap, textures: Texture[], tex0: GSRegisterTEX0, clamp: GSRegisterCLAMP, suffix = ''): number {
    const width = 1 << tex0.tw;
    const height = 1 << tex0.th;

    const pixels = new Uint8Array(width * height * 4);

    assert(tex0.cpsm === GSCLUTPixelStorageFormat.PSMCT32);
    if (tex0.psm === GSPixelStorageFormat.PSMT4)
        gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT8)
        gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT8H)
        gsMemoryMapReadImagePSMT8H_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT4HH)
        gsMemoryMapReadImagePSMT4HH_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT4HL)
        gsMemoryMapReadImagePSMT4HL_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMCT16)
        gsMemoryMapReadImagePSMCT16(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height);
    else
        return -1
    // console.log("missing format", hexzero(tex0.psm, 2))

    const newTexture: Texture = {
        tex0,
        clamp,
        pixels,
        name: `${hexzero(tex0.tbp0, 4)}_${hexzero(tex0.cbp, 4)}${suffix}`,
        width,
        height,
    };
    textures.push(newTexture);

    // crude handling of region wrap modes
    if (clamp.wms >= GSWrapMode.REGION_CLAMP || clamp.wmt >= GSWrapMode.REGION_CLAMP)
        cropTexture(newTexture, clamp);
    return textures.length - 1;
}

const LEVEL_MODEL_SCALE = 10;
// 3 positions, 4 colors, 2 UV coordinates, (up to) 4 extra values for effects.
const VERTEX_STRIDE = 3 + 4 + 2 + 4;

interface PartVertexRun {
    vertexRunData: Float32Array[];
    vertexCount: number;
    textureIndex: number;
    gsConfiguration: GSConfiguration;
    effectType: LevelEffectType;
    isTranslucent: boolean;
    modelFlags: number;
}

function parseLevelModel(id: number, view: DataView, offs: number, gsMap: GSMemoryMap, textures: Texture[], vertexRuns: PartVertexRun[]): void {
    const flags = view.getUint16(offs + 0x00, true);
    const isTranslucent = view.getUint16(offs + 0x04, true) === 1;
    const float_08 = view.getFloat32(offs + 0x08, true);
    const modelQWC = view.getUint32(offs + 0x0C, true);
    const center = vec3FromView(view, offs + 0x10, true);
    const bboxMin = vec3FromView(view, offs + 0x20, true);
    const bboxMax = vec3FromView(view, offs + 0x30, true);
    vec3.scale(bboxMin, bboxMin, LEVEL_MODEL_SCALE);
    vec3.scale(bboxMax, bboxMax, LEVEL_MODEL_SCALE);
    const radius = view.getFloat32(offs + 0x3C, true);
    const bbox = new AABB(bboxMin[0], bboxMin[1], bboxMin[2], bboxMax[0], bboxMax[1], bboxMax[2]);

    const packetsBegin = offs + 0x40;
    const packetsSize = modelQWC * 0x10;
    const packetsEnd = packetsBegin + packetsSize;

    // Parse VIF packets.
    let packetsIdx = packetsBegin;

    // State of current "vertex run".
    let vertexCount = 0;
    let vertexRunData: Float32Array | null = null;
    let currentTextureIndex = -1;
    let currentGSConfiguration: GSConfiguration = {
        tex0: getGSRegisterTEX0(0, 0),
        clamp: getGSRegisterCLAMP(0, 0),
        tex1_1_data0: 0x60, tex1_1_data1: 0,
        alpha_data0: 0x44, alpha_data1: -1,
        test_1_data0: 0x5000D, test_1_data1: -1,
        // the game sorts more granularly than we can, need to decide what to do here
        depthWrite: true,
        cullingEnabled: true,
        prim: 0,
    };

    let expectedColorOffs = -1;
    let expectedTexCoordOffs = -1;
    let expectedPositionOffs = -1;
    let expectedExtraOffs = -1;
    let currentEffect = LevelEffectType.NONE as LevelEffectType;

    const newVertexRun = () => {
        // set expected buffer offsets (relative to ITOP)
        const triCount = view.getUint32(packetsIdx + 0x00, true);
        vertexCount = 3 * triCount;
        const newData = new Float32Array(vertexCount * VERTEX_STRIDE);
        expectedColorOffs = view.getUint32(packetsIdx + 0x04, true);
        expectedTexCoordOffs = expectedColorOffs + vertexCount;
        expectedPositionOffs = expectedTexCoordOffs + vertexCount;
        expectedExtraOffs = expectedPositionOffs + vertexCount;

        const effect: LevelEffectType = view.getUint32(packetsIdx + 0x10, true);
        assert(effect !== LevelEffectType.UNUSED && effect < LevelEffectType.ENV_MAP);
        if (currentEffect === LevelEffectType.ENV_MAP)
            assert(effect === LevelEffectType.NONE)
        else
            currentEffect = effect;

        // check for texture settings
        const maybeGIFStart = view.getUint32(packetsIdx + 0x20, true);
        if (maybeGIFStart === 0) {
            // make sure there's nothing else hiding
            for (let blockOffs = 0x30; blockOffs < 0x70; blockOffs += 4)
                assert(view.getUint32(packetsIdx + blockOffs, true) === 0);
        } else {
            assert(maybeGIFStart <= 4);
            assert(view.getUint32(packetsIdx + 0x24, true) === 0x10000000); // 1 register, packed mode
            assert(view.getUint32(packetsIdx + 0x28, true) === 0xE); // address + value
            assert(view.getUint32(packetsIdx + 0x2C, true) === 0x0); // address + value

            // many models have two tex0 registers in a row for some reason
            // just assume the second one gets used
            for (let reg = 0, offs = packetsIdx + 0x30; reg < maybeGIFStart; reg++, offs += 0x10) {
                const lo = view.getUint32(offs + 0x0, true);
                const hi = view.getUint32(offs + 0x4, true);
                const addr = view.getUint32(offs + 0x8, true);
                if (addr === 0)
                    continue;
                if (addr === GSRegister.TEX0_2) {
                    currentGSConfiguration.tex0 = getGSRegisterTEX0(lo, hi);
                }
                else if (addr === GSRegister.CLAMP_2)
                    currentGSConfiguration.clamp = getGSRegisterCLAMP(lo, hi);
                else if (addr === GSRegister.ALPHA_2) {
                    currentGSConfiguration.alpha_data0 = lo;
                    currentGSConfiguration.alpha_data1 = hi;
                } else
                    throw `bad model gs register ${hexzero(addr, 2)}`;
            }
            currentTextureIndex = textures.findIndex((t) =>
                structsEqual(t.tex0, currentGSConfiguration.tex0) &&
                structsEqual(t.clamp, currentGSConfiguration.clamp)
            );
            if (currentTextureIndex === -1)
                currentTextureIndex = decodeTexture(gsMap, textures, currentGSConfiguration.tex0, currentGSConfiguration.clamp);
        }

        // read the giftag for vertex data
        const vtxCycles = view.getUint32(packetsIdx + 0x80, true);
        const vtxPrim = view.getUint32(packetsIdx + 0x84, true);
        const regsLow = view.getUint32(packetsIdx + 0x88, true);
        const regsHigh = view.getUint32(packetsIdx + 0x8C, true);

        assert(vtxCycles === (0x8000 | triCount));
        const primMask = 0xFF87C000; // allow aa, fog, alpha blending, and texturing to vary
        // require 9 PACKED regs, ctxt 2, STQ, shaded triangles
        const primTarget = 0x9105C000 | 0; // annoyingly the & below gives a negative value
        assert((vtxPrim & primMask) === primTarget && regsLow === 0x12412412 && regsHigh === 0x4);
        currentGSConfiguration.prim = (vtxPrim >>> 15) & 0x7FF;
        return newData;
    };

    while (packetsIdx < packetsEnd) {
        const imm = view.getUint16(packetsIdx + 0x00, true);
        const qwc = view.getUint8(packetsIdx + 0x02);
        const cmd = view.getUint8(packetsIdx + 0x03) & 0x7F;

        const atITOP = !!(imm & 0x8000);
        const signExtend = !(imm & 0x4000);
        const unpackDest = imm & 0x3FFF;
        packetsIdx += 0x04;

        if ((cmd & 0x60) === 0x60) { // UNPACK
            const format = (cmd & 0x0F);

            // TODO: figure out this constant-offset data, used to mask some flag?
            if (!atITOP) {
                assert(unpackDest === 4 && format === VifUnpackFormat.S_32);
                currentGSConfiguration.cullingEnabled = !!(view.getUint32(packetsIdx, true) & 0x8000);
                packetsIdx += qwc * getVifUnpackFormatByteSize(format);
                continue;
            }

            if (format === VifUnpackFormat.V4_32) {
                assert(vertexRunData === null && unpackDest === 0);

                vertexRunData = newVertexRun();
                packetsIdx += qwc * getVifUnpackFormatByteSize(format);

            } else if (format === VifUnpackFormat.V2_16) {
                let runOffs = 7;
                assert(vertexRunData !== null);
                assert(currentEffect !== LevelEffectType.ENV_MAP);
                if (unpackDest !== expectedTexCoordOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.UV_LERP);
                    runOffs = 9;
                }
                assert(signExtend);
                for (let j = 0; j < qwc; j++) {
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 0] = view.getInt16(packetsIdx + 0x00, true) / 0x1000;
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 1] = view.getInt16(packetsIdx + 0x02, true) / 0x1000;
                    packetsIdx += 0x04;
                }
            } else if (format === VifUnpackFormat.V3_32) {
                let runOffs = 0;
                assert(vertexRunData !== null);
                if (unpackDest === expectedTexCoordOffs) {
                    // actually normals
                    assert(currentEffect === LevelEffectType.ENV_MAP);
                    runOffs = 9;
                } else if (unpackDest !== expectedPositionOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.POSITIONS);
                    runOffs = 9;
                }
                for (let j = 0; j < qwc; j++) {
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 0] = view.getFloat32(packetsIdx + 0x00, true);
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 1] = view.getFloat32(packetsIdx + 0x04, true);
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 2] = view.getFloat32(packetsIdx + 0x08, true);
                    packetsIdx += 0x0C;
                }

            } else if (format === VifUnpackFormat.V4_8) {
                let runOffs = 3;
                assert(vertexRunData !== null);
                if (unpackDest !== expectedColorOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.COLORS);
                    runOffs = 9;
                }
                for (let j = 0; j < qwc; j++) {
                    const diffuseColorR = view.getUint8(packetsIdx + 0x00) / 0x80;
                    const diffuseColorG = view.getUint8(packetsIdx + 0x01) / 0x80;
                    const diffuseColorB = view.getUint8(packetsIdx + 0x02) / 0x80;
                    const diffuseColorA = view.getUint8(packetsIdx + 0x03) / 0x80;

                    const signExtend = (imm & 0x4000) === 0;
                    if (signExtend)
                        assert(diffuseColorR < 1 && diffuseColorG < 1 && diffuseColorB < 1 && diffuseColorA < 1)
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 0] = diffuseColorR;
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 1] = diffuseColorG;
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 2] = diffuseColorB;
                    vertexRunData[j * VERTEX_STRIDE + runOffs + 3] = diffuseColorA;
                    packetsIdx += 0x04;
                }
            } else {
                console.error(`Unsupported format ${hexzero(format, 2)}`);
                throw "whoops";
            }
        } else if ((cmd & 0x7F) === 0x50 || (cmd & 0x7F) === 0x51) { // DIRECT
            // We need to be at the start of a vertex run.
            assert(vertexRunData === null);

            // This transfers a GIFtag through GIF.
            // only the z buffer is set here, other settings are per vertex run

            const w0 = view.getUint32(packetsIdx + 0x00, true);
            const w1 = view.getUint32(packetsIdx + 0x04, true);
            const w2 = view.getUint32(packetsIdx + 0x08, true);
            const w3 = view.getUint32(packetsIdx + 0x0C, true);
            packetsIdx += 0x10;

            // NLOOP is the repeat count.
            const nloop = w0 & 0x7FFF;

            // FLG determines the format for the upcoming data. We only support PACKED data.
            const flg = (w1 >>> 26) & 0x03;
            assert(flg === 0x00);

            // How many GIF registers to write? The game should only write one, which is A+D.
            // A+D lets you set an arbitrary GS register through GIF.
            const nreg = (w1 >>> 28) & 0x07;
            assert(nreg === 0x01);
            const reg = (w2 & 0x000F);
            assert(reg === 0x0E);

            for (let j = 0; j < nloop; j++) {
                const data0 = view.getUint32(packetsIdx + 0x00, true);
                const data1 = view.getUint32(packetsIdx + 0x04, true);
                const addr = view.getUint8(packetsIdx + 0x08) & 0x7F;

                // addr contains the register to set.
                if (addr === GSRegister.ZBUF_2) {
                    assert(data0 === 0x1000108);
                    currentGSConfiguration.depthWrite = (data1 & 1) === 0;
                } else {
                    console.warn(`Unknown GS Register ${hexzero(addr, 2)}`);
                    throw "whoops";
                }

                packetsIdx += 0x10;
            }
        } else if (cmd === 0x17) { // MSCNT
            // Run an HLE form of the VU1 program.
            assert(vertexRunData !== null);

            let matched = false;
            // prevent combining draws that need depth sorting?
            // ugh, the primitive splits often seem ugly, and I'm not sure I'm interpreting this flag reasonably
            const shouldSplit = id === 76;
            if (!shouldSplit || !isTranslucent || (flags & 0x10)) {
                for (let r of vertexRuns) {
                    if (r.textureIndex === currentTextureIndex &&
                        r.effectType === currentEffect &&
                        gsConfigurationEqual(r.gsConfiguration, currentGSConfiguration) &&
                        r.isTranslucent === isTranslucent &&
                        r.modelFlags === flags
                    ) {
                        r.vertexRunData.push(vertexRunData);
                        r.vertexCount += vertexCount;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) {
                // this will be a new draw call
                const gsConfiguration: GSConfiguration = Object.assign({}, currentGSConfiguration);
                vertexRuns.push({
                    vertexRunData: [vertexRunData],
                    vertexCount,
                    gsConfiguration,
                    effectType: currentEffect,
                    textureIndex: currentTextureIndex,
                    isTranslucent,
                    modelFlags: flags,
                });
            }

            vertexCount = 0;
            vertexRunData = null;
            // Texture does not get reset; it carries over between runs.
        } else if (cmd === 0x14) { // MSCAL
            // check if this calls the env map program
            assert(imm <= 2);
            if (imm === 2)
                currentEffect = LevelEffectType.ENV_MAP;
            else
                currentEffect = LevelEffectType.NONE;
        } else if (cmd === 0x00 || cmd === 0x10 || cmd === 0x11) {
            // NOP and FLUSH commands can be ignored
        } else if (cmd === 0x01) { // CYCLE
            assert(imm === 0x0101); // equal CL and WL, can ignore
        } else if (cmd === 0x05) { // STMOD
            assert(imm === 0); // normal, no addition
        } else if (cmd === 0x30) { // STROW
            packetsIdx += 0x10; // ignore fill data for now
        } else if (cmd === 0x20) { // STMASK
            packetsIdx += 0x04;
        } else {
            console.error(`Unknown VIF command ${hexzero(cmd, 2)} at ${hexzero(packetsIdx, 4)}`);
            throw "whoops";
        }
    }
}

function condenseLevelPart(vertexRuns: PartVertexRun[]): LevelModel {
    // Coalesce all the model parts into one model.
    let totalCount = 0;
    for (let j = 0; j < vertexRuns.length; j++) {
        totalCount += vertexRuns[j].vertexCount;
    }
    assert(totalCount <= 0xFFFFFFFF);
    const drawCalls: LevelDrawCall[] = [];

    let vertexDataDst = 0;
    let indexOffset = 0;
    const vertexData = new Float32Array(totalCount * VERTEX_STRIDE);
    const indexData = new Uint32Array(totalCount);
    for (let run of vertexRuns) {
        const extraScale = run.effectType === LevelEffectType.POSITIONS ? LEVEL_MODEL_SCALE : 1;
        const dc: LevelDrawCall = {
            indexOffset,
            textureIndex: run.textureIndex,
            gsConfiguration: run.gsConfiguration,
            indexCount: run.vertexCount,
            effectType: run.effectType,
            isTranslucent: run.isTranslucent,
            flags: run.modelFlags,
            center: vec3.create(),
        };
        drawCalls.push(dc);
        indexOffset += run.vertexCount;
        for (let data of run.vertexRunData) {
            for (let k = 0; k < data.length; k += VERTEX_STRIDE) {
                vertexData[vertexDataDst++] = data[k + 0] * LEVEL_MODEL_SCALE;
                vertexData[vertexDataDst++] = data[k + 1] * LEVEL_MODEL_SCALE;
                vertexData[vertexDataDst++] = data[k + 2] * LEVEL_MODEL_SCALE;
                dc.center[0] += data[k + 0];
                dc.center[1] += data[k + 1];
                dc.center[2] += data[k + 2];
                // Color.
                vertexData[vertexDataDst++] = data[k + 3]
                vertexData[vertexDataDst++] = data[k + 4];
                vertexData[vertexDataDst++] = data[k + 5];
                vertexData[vertexDataDst++] = data[k + 6];
                // Texture coord.
                vertexData[vertexDataDst++] = data[k + 7];
                vertexData[vertexDataDst++] = data[k + 8];
                // Extra data
                vertexData[vertexDataDst++] = data[k + 9] * extraScale;
                vertexData[vertexDataDst++] = data[k + 10] * extraScale;
                vertexData[vertexDataDst++] = data[k + 11] * extraScale;
                vertexData[vertexDataDst++] = data[k + 12] * extraScale;
            }
        }
        vec3.scale(dc.center, dc.center, LEVEL_MODEL_SCALE / run.vertexCount);
    }
    for (let i = 0; i < totalCount; i++)
        indexData[i] = i;
    return { vertexData, indexData, drawCalls };
}

export interface MapTri {
    vertices: number[];
    edges: number[]; // indices of tris adjecent to 01, 12, 20
    location: number;
    surfaceType: number;
    passability: number;
    encounter: number;
    light: number[];
    data: number;
}

export interface HeightMap {
    scale: number;
    vertices: Int16Array;
    tris: MapTri[];
    hasBattle: boolean;
    hasCollision: boolean;
    hasLight: boolean;
}

export function parseMapFile(id: number, buffer: ArrayBufferSlice, textureData: LevelTextures): LevelData {
    assert(readString(buffer, 0, 4) === "MAP1");

    const view = buffer.createDataView();


    const geoOffs = view.getUint32(0x14, true);
    const heightmapOffs = view.getUint32(0x18, true);
    const particleDataOffs = view.getUint32(0x38, true);
    // "guidemap" at 0x3C, presumably the minimap
    const waterTextureOffs = view.getUint32(0x40, true);

    const textures : Texture[] = [];
    const geo = parseLevelGeometry(id, buffer, geoOffs, textureData, textures);
    let waterTextures: number[][] = [];
    if (waterTextureOffs > 0) {
        waterTextures = parseParticleWaterTex(buffer, waterTextureOffs, textures);
    }
    const particles = parseParticleData(buffer, particleDataOffs, textureData.particleMap, textures, waterTextures);

    let map: HeightMap | undefined;
    if (heightmapOffs !== 0) {
        let hasLight = view.getUint16(heightmapOffs + 0x4, true) > 0x1202; // ????
        let nontrivialLight = false;
        const vertexCount = view.getUint16(heightmapOffs + 0xA, true);
        const scale = view.getFloat32(heightmapOffs + 0xC, true) / LEVEL_MODEL_SCALE;
        const vertexOffs = view.getUint32(heightmapOffs + 0x18, true) + heightmapOffs;
        const triOffs = view.getUint32(heightmapOffs + 0x1C, true) + heightmapOffs;
        const triCount = view.getUint16(triOffs + 0x8, true);
        let offs = view.getUint32(triOffs + 0xC, true) + heightmapOffs;
        const tris: MapTri[] = [];
        let hasCollision = false;
        let hasBattle = false;
        for (let i = 0; i < triCount; i++) {
            const data = view.getUint32(offs + 0xC, true);
            const light = [
                (data >>> 0x11) & 0x1F,
                (data >>> 0x16) & 0x1F,
                (data >>> 0x1B) & 0x1F,
            ];
            if (light[0] < 31 || light[1] < 31 || light[2] < 31)
                nontrivialLight = true;
            const t = {
                vertices: [
                    view.getUint16(offs + 0x0, true),
                    view.getUint16(offs + 0x2, true),
                    view.getUint16(offs + 0x4, true),
                ],
                edges: [
                    view.getInt16(offs + 0x6, true),
                    view.getInt16(offs + 0x8, true),
                    view.getInt16(offs + 0xA, true),
                ],
                data,
                passability: data & 0x7F,
                encounter: (data >>> 7) & 3,
                // 9 ??
                location: (data >>> 0xB) & 3,
                // 13 ??
                surfaceType: (data >>> 0xF) & 3,
                light,
            };
            if (t.passability)
                hasCollision = true;
            if (t.encounter)
                hasBattle = true;
            tris.push(t);
            offs += 0x10;
        }
        const vertices = buffer.createTypedArray(Int16Array, vertexOffs, vertexCount*4);
        hasLight = hasLight && nontrivialLight;
        map = {scale, tris, vertices, hasCollision, hasBattle, hasLight};
    }

    return {geo, particles, textures, map};
}

export interface FogParams {
    color: vec3;
    near: number;
    far: number;
    opacity: number;
}

function parseLevelGeometry(id: number, buffer: ArrayBufferSlice, offs: number, textureData: LevelTextures, textures: Texture[]): LevelGeoData {
    assert(readString(buffer, 0, 4) === "MAP1");

    const gsMap = textureData.gsMap;
    const paletteType = textureData.paletteType;
    const view = buffer.createDataView();

    let regularTextureCount = 0;
    const parts: LevelPart[] = [];
    const effects: PartEffect[] = [];
    let currPart: LevelPart | null = null;
    const clearColor = colorNewFromRGBA(0, 0, 0, 1);
    const envMapDirection = mat4.create();
    const animatedTextures: AnimatedTexture[] = [];
    let fog: FogParams | undefined = undefined;

    if (offs === 0)
        return {parts, effects, animatedTextures, clearColor, envMapDirection};

    assert(view.getUint32(offs) === 0x65432100)
    const sectionCount = view.getUint32(offs + 0x0C, true);
    offs += 0x40;

    let pendingRuns: PartVertexRun[] = [];

    for (let i = 0; i < sectionCount; i++) {
        const sectionType: MapSectionType = view.getUint32(offs + 0x00, true);
        const sectionLength = view.getUint32(offs + 0x04, true);
        offs += 0x40; // skip common (unused?) header

        if (sectionType === MapSectionType.LEVEL_PART) {
            const flags = view.getUint16(offs + 0x00, true);
            const isSkybox = view.getUint16(offs + 0x02, true) === 1;
            const layer = view.getUint16(offs + 0x04, true);
            const euler = vec3FromView(view, offs + 0x10, true);
            const position = vec3FromView(view, offs + 0x20, true);
            const eulerOrder = view.getUint16(offs + 0x30, true);
            assert(eulerOrder === 0 || eulerOrder === 5)
            const effectCount = view.getUint32(offs + 0x34, true);
            assert(effectCount <= 4);
            const effectIndices: number[] = [];
            for (let j = 0; j < effectCount; j++)
                effectIndices.push(view.getUint16(offs + 0x38 + 2 * j, true));
            if (currPart) {
                assert(pendingRuns.length > 0);
                currPart.model = condenseLevelPart(pendingRuns);
            }
            pendingRuns = [];
            currPart = {
                isSkybox,
                layer,
                position,
                euler,
                effectIndices,
                eulerOrder,
            }
            parts.push(currPart);
        } else if (sectionType === MapSectionType.MODEL) {
            parseLevelModel(id, view, offs, gsMap, textures, pendingRuns);
            regularTextureCount = textures.length;
        } else if (sectionType === MapSectionType.LIGHTING) {
            const clearColorR = view.getUint8(offs + 0x00) / 0xFF;
            const clearColorG = view.getUint8(offs + 0x01) / 0xFF;
            const clearColorB = view.getUint8(offs + 0x02) / 0xFF;
            const clearColorA = view.getUint8(offs + 0x03) / 0x80;
            colorFromRGBA(clearColor, clearColorR, clearColorG, clearColorB, clearColorA);
            const fogR = view.getUint8(offs + 0x0C) / 0xFF;
            const fogG = view.getUint8(offs + 0x0D) / 0xFF;
            const fogB = view.getUint8(offs + 0x0E) / 0xFF;
            const color = vec3.fromValues(fogR, fogG, fogB);
            const opacity = view.getFloat32(offs + 0x10, true);
            const near = view.getFloat32(offs + 0x14, true);
            const far = view.getFloat32(offs + 0x18, true);
            fog = {color, near, far, opacity};

            // only two levels have a different env map direction
            const azimuthal = view.getFloat32(offs + 0x1C, true);
            const polar = view.getFloat32(offs + 0x20, true);
            mat4.fromXRotation(envMapDirection, azimuthal * MathConstants.DEG_TO_RAD);
            mat4.rotateY(envMapDirection, envMapDirection, polar * MathConstants.DEG_TO_RAD);
        } else if (sectionType === MapSectionType.EFFECT
            // only in Zanarkand overpass
            || sectionType === MapSectionType.COMBINED_EFFECT) {
            const isCombined = sectionType === MapSectionType.COMBINED_EFFECT;
            const justAppend = view.getUint32(offs - 0x20, true) === 0;
            if (justAppend) {
                const shift = isCombined ? 5 : 7;
                effects.push(parseEffect(view, offs, sectionLength >>> shift, isCombined));
            } else {
                const index = view.getUint32(offs - 0x1C, true);
                const effectCount = view.getUint32(offs - 0x18, true);
                assert(effects[index] === undefined);

                effects[index] = parseEffect(view, offs, effectCount, isCombined);
            }
        } else if (sectionType === MapSectionType.ANIMATED_TEXTURE) {
            const index = view.getUint32(offs + 0x00, true);
            const qwc = view.getUint32(offs + 0x18, true);
            const paletteOffset = view.getUint16(offs + 0x20, true);
            const paletteSize = view.getUint32(offs + 0x24, true);
            const paletteIndex = view.getUint16(offs + 0x28, true);

            const effectCount = view.getUint32(offs + 0x04, true);
            const effectIndex = view.getUint32(offs + 0x08, true);

            // read the texture upload
            assert(view.getUint32(offs + 0x40, true) === 0x11000000);
            assert((view.getUint32(offs + 0x4C, true) >>> 28) === 0x5); // DIRECT
            // giftag with four A+D registers
            assert(view.getUint32(offs + 0x50, true) === 0x04);
            assert((view.getUint32(offs + 0x54, true) >>> 24) === 0x10);
            assert(view.getUint32(offs + 0x58, true) === 0x0E);

            assert(view.getUint32(offs + 0x68, true) === GSRegister.BITBLTBUF);
            const dpsm: GSPixelStorageFormat = view.getUint8(offs + 0x67) & 0x3F;
            const dbw = view.getUint8(offs + 0x66) & 0x3F;
            const dbp = view.getUint16(offs + 0x64, true) & 0x3FFF;
            assert(view.getUint32(offs + 0x78, true) === GSRegister.TRXPOS);
            const dsax = view.getUint16(offs + 0x74, true) & 0x7FF;
            const dsay = view.getUint16(offs + 0x76, true) & 0x7FF;
            assert(view.getUint32(offs + 0x88, true) === GSRegister.TRXREG);
            const rrw = view.getUint16(offs + 0x80, true) & 0xFFF;
            const rrh = view.getUint16(offs + 0x84, true) & 0xFFF;
            assert(view.getUint32(offs + 0x98, true) === GSRegister.TRXDIR);
            // image gif tag for actual texture data
            assert((view.getUint32(offs + 0xA4, true) >>> 24) === 0x08);


            if (animatedTextures[index] === undefined) {
                const textureIndices: number[] = [];
                const cbp = paletteAddress(paletteType, paletteIndex);
                // find matching texture(s)
                for (let j = 0; j < regularTextureCount; j++) {
                    if (textures[j].tex0.tbp0 === dbp && textures[j].tex0.cbp === cbp && textures[j].tex0.csa === paletteOffset) {
                        textureIndices.push(j);
                        textures[j].name += "_00"
                        break;
                    }
                }
                if (textureIndices.length > 0) {
                    // TODO: what's going on here? (sea of sorrow, )
                    animatedTextures[index] = {
                        textureIndices,
                        effect: null,
                        active: false,
                        explicitIndex: -1,
                    };
                }
                // assume base texture is identical to frame 0 of animation and skip the upload
            } else {
                gsMemoryMapUploadImage(gsMap, dpsm, dbp, dbw, dsax, dsay, rrw, rrh, buffer.slice(offs + 0xB0));
                const anim = animatedTextures[index];
                const paletteBase = paletteAddress(paletteType, paletteIndex);
                const paletteData = buffer.slice(offs + 0x40 + qwc * 0x10);
                if (paletteSize === 0x04) {
                    const xStart = (paletteOffset & 1) * 8;
                    const yStart = paletteOffset & (~1);
                    gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteBase, 1, xStart, yStart, 8, 2, paletteData)
                } else if (paletteSize === 0x40) {
                    gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteBase, 1, 0, 0, 16, 16, paletteData);
                } else
                    assert(paletteSize === 0);
                const baseTexture = textures[anim.textureIndices[0]];
                const frameSuffix = `_${hexzero(anim.textureIndices.length, 2)}`;
                const idx = decodeTexture(gsMap, textures, baseTexture.tex0, baseTexture.clamp, frameSuffix);
                anim.textureIndices.push(idx);
            }
            if (effectCount !== 0 && animatedTextures[index]) {
                assert(animatedTextures[index].effect === null);
                const animEffect = assertExists(effects[effectIndex]);
                animatedTextures[index].effect = animEffect;
                animatedTextures[index].active = true;
                assert(effectCount === 1 && animEffect.type === EffectType.TEXTURE);
            }
        } else
            throw `unfamiliar map section type ${sectionType}`;

        offs += sectionLength;
    }
    // finish the last part
    if (currPart) {
        assert(pendingRuns.length > 0);
        currPart.model = condenseLevelPart(pendingRuns);
    }
    return { parts, effects, envMapDirection, clearColor, fog, animatedTextures };
}

function parseParticleWaterTex(buffer: ArrayBufferSlice, offs: number, textures: Texture[]): number[][] {
    // this is a list of tagged sections, actually the same format as the "guidemap" data
    // but we'll only see a subset of commands here
    assert(readString(buffer, offs, 4) === "YNDT");
    offs += 0x10;
    const view = buffer.createDataView();
    let overallCount = 0;
    const indices: number[][] = [];
    while (true) {
        const tag = readString(buffer, offs, 4);
        if (tag === "YNED")
            break;
        assert(tag === "YNFT");
        const chunkLength = view.getUint32(offs + 4, true);
        offs += 0x10;
        const next = offs + 0x10 * chunkLength;
        const width = view.getUint16(offs + 0, true);
        const height = view.getUint16(offs + 2, true);
        assert(width === 0x80 && height === 0x80);
        offs += 0x10;
        for (let i = 0; i < 6; i++, offs += 4)
            assert(view.getUint32(offs, true) === 0); // transfer registers, filled later
        const count = view.getUint32(offs + 0, true);
        const texStride = view.getUint32(offs + 4, true);
        offs += 0x8;
        const texStart = offs + 0x10; // skip header
        offs += count * texStride;
        for (let i = 0; i < 6; i++, offs += 4)
            assert(view.getUint32(offs, true) === 0); // transfer registers, filled later
        // palettes
        assert(count === view.getUint32(offs + 0, true));
        const clutStride = view.getUint32(offs + 4, true);
        offs += 0x8;
        const clutStart = offs + 0x10; // skip header
        offs += count * clutStride;
        const list: number[] = [];
        for (let i = 0; i < count; i++) {
            const pixels = new Uint8Array(width * height * 4);
            decodePaletteTexture(pixels, buffer, clutStart + i*clutStride, texStart + i*texStride, width, height);
            list.push(textures.length);
            textures.push({
                pixels,
                clamp: getGSRegisterCLAMP(0, 0),
                name: `particle_water_${overallCount}_${hexzero(i, 2)}`,
                width,
                height,
                tex0: getGSRegisterTEX0(0, 0),
            })
        }
        indices.push(list);
        overallCount++;
        offs = next;
    }
    return indices;
}

export const enum SkinningMode {
    BASIC,
    SCALED,
    PERTURB,
}

interface SkinningList {
    indexBase: number;
    count: number;
    data: Int16Array;
    mode: SkinningMode;
}

interface Skinning {
    part: number;
    bone: number;
    relBone: number;
    longform: boolean;
    lists: SkinningList[];
}

interface Bone {
    parent: number;
    euler: vec3;
    offset: vec3;
    scale: vec3;
}

interface RefPoint {
    id: number;
    flags: number;
    bone: number;
    pos?: vec3;
}

export interface ScaleData {
    base: number;
    actor: number;
    offset: number;
    height: number;
    envMap: number;
    deflection: number;
    specular: vec4;
    shadowRadius: number;
    collisionRadius: number;
}

interface ActorTextureFrame {
    duration: number;
    index: number;
    range: number;
}

interface ActorTexturePatch {
    op: number;
    x: number;
    y: number;
    target: number;
    sequences: Map<number, ActorTextureFrame[]>;
}
interface ActorTextureAnimationData {
    textureIndices: number[][];
    patches: ActorTexturePatch[];
}

export interface ActorDrawCall {
    indexOffset: number;
    indexCount: number;
    textureIndex: number;
    cullingEnabled: boolean;
    blendMode: number;
    effectType: number;
}

export interface ActorPart {
    bone: number;
    baseVertexCount: number;
    attrData: Float32Array;
    vertexData: Float32Array;
    texWidth: number;
    indexData: Uint16Array;
    drawCalls: ActorDrawCall[];
}

interface TexturePair {
    texture: number;
    palette: number;
}

export interface ActorModel {
    parts: ActorPart[];
    skinning: Skinning[];
    bones: Bone[];
    defaultAnimations: number[][];
    scales: ScaleData;
    boneMappings: Map<number, Uint16Array>;
    refPoints: (RefPoint | undefined)[];
    texturePairs: TexturePair[];
    particles?: LevelParticles;
    texAnim?: ActorTextureAnimationData;
}

function decodePaletteTexture(pixels: Uint8Array, buffer: ArrayBufferSlice, paletteOffs: number, indexOffs: number, w: number, h: number) {
    const indices = buffer.createTypedArray(Uint8Array, indexOffs);
    const palette = buffer.createTypedArray(Uint8Array, paletteOffs);
    let dstIdx = 0, srcIdx = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const clutIndex = indices[srcIdx++];

            let cy = (clutIndex & 0xE0) >>> 4;
            if (clutIndex & 0x08)
                cy++;
            let cx = clutIndex & 0x07;
            if (clutIndex & 0x10)
                cx += 0x08;
            const p = 4*(cx + cy*0x10);
            pixels[dstIdx + 0] = palette[p + 0x00];
            pixels[dstIdx + 1] = palette[p + 0x01];
            pixels[dstIdx + 2] = palette[p + 0x02];
            pixels[dstIdx + 3] = Math.min(0xFF, palette[p + 0x03] * 2);
            dstIdx += 0x04;
        }
    }
}

interface ParsedTextures {
    textureCount: number;
    blendValues: number[];
    texturePairs: TexturePair[];
    texAnim?: ActorTextureAnimationData;
}

export function parseActorTextures(name: string, buffer: ArrayBufferSlice, texDataOffset: number, textures: Texture[]): ParsedTextures {
    const view = buffer.createDataView();
    const textureCount = view.getUint16(texDataOffset + 0x4, true);
    const palCount = view.getUint16(texDataOffset + 0x8, true);
    const pixCount = view.getUint16(texDataOffset + 0xC, true);
    const texOffset = view.getUint32(texDataOffset + 0x14, true);
    const paletteOffset = view.getUint32(texDataOffset + 0x18, true);
    const pixelOffset = view.getUint32(texDataOffset + 0x1C, true);
    const animationOffset = view.getUint32(texDataOffset + 0x20, true);

    const blendValues: number[] = [];
    const texturePairs: TexturePair[] = [];
    let texAnim: ActorTextureAnimationData | undefined;
    const palStarts: number[] = [];
    const pixInfo: {
        start: number,
        width: number,
        height: number,
    }[] = [];

    let offs = texDataOffset + paletteOffset;
    for (let i = 0; i < palCount; i++) {
        const paletteSize = view.getUint32(offs + 0x0, true)
        assert(paletteSize === 0x400 || paletteSize === 0x100); // 1024 bytes (256 colors), env map uses fewer
        palStarts.push(view.getUint32(offs + 0x4, true) + texDataOffset);
        offs += 8;
    }
    offs = texDataOffset + pixelOffset;
    for (let i = 0; i < pixCount; i++) {
        assert(view.getUint16(offs + 0x0, true) === GSPixelStorageFormat.PSMT8, `got format ${view.getUint16(offs + 0x0, true)}`);
        assert(view.getUint16(offs + 0x4, true) === 0); // x & y shift
        assert(view.getUint16(offs + 0x6, true) === 0);
        const width = view.getUint16(offs + 0x8, true);
        const height = view.getUint16(offs + 0xA, true);
        pixInfo.push({
            start: view.getUint32(offs + 0xC, true) + texDataOffset,
            width,
            height,
        });
        offs += 0x10;
    }
    offs = texDataOffset + texOffset;
    for (let i = 0; i < textureCount; i++) {
        const texture = view.getUint8(offs + 0x0);
        const palette = view.getUint8(offs + 0x1);
        assert(texture >= 0 && texture < pixCount);
        assert(palette >= 0 && palette < palCount);
        texturePairs.push({ texture, palette });
        // assert(view.getUint16(offs + 0x2, true) === GSPixelStorageFormat.PSMT8);
        const width = view.getUint16(offs + 0x4, true);
        const height = view.getUint16(offs + 0x6, true);
        const blend = view.getUint16(offs + 0x8, true);
        blendValues.push(blend);

        assert(width === pixInfo[texture].width && height === pixInfo[texture].height);
        const pixels = new Uint8Array(width * height * 4);
        decodePaletteTexture(pixels, buffer, palStarts[palette], pixInfo[texture].start, width, height);
        textures.push({
            pixels,
            width,
            height,
            tex0: getGSRegisterTEX0(0, 0),
            clamp: getGSRegisterCLAMP(0, 0),
            name: `${name}_${i}`,
        });
        offs += 0x10;
    }
    if (animationOffset !== 0) {
        const animationStart = texDataOffset + animationOffset;
        offs = animationStart;
        const type = view.getUint8(offs);
        assert(type === 2);
        const count = view.getUint8(offs + 1);
        const size = view.getUint8(offs + 2);
        const toDims = view.getUint32(offs + 4, true);
        const toFrames = view.getUint32(offs + 8, true);
        assert(size === 1);
        let opOffs = offs + 0xC;
        const textureIndices: number[][] = [];
        offs = animationStart + toDims;
        for (let idx = 0; offs <= animationStart + toFrames - 0xC; offs += 0xC, idx++) {
            const destWidth = view.getUint16(offs + 0, true);
            const width = view.getUint16(offs + 4, true);
            const height = view.getUint16(offs + 6, true);
            // 32 blank bytes for VIF unpack + GIFTag
            const toData = view.getUint32(offs + 8, true) + animationStart + 0x20;
            const indices: number[] = [];
            // most patches probably only get used for a single palette,
            // but let's just create all of them to avoid the bookkeeping
            for (let i = 0; i < palStarts.length; i++) {
                const pixels = new Uint8Array(width * height * 4);
                if (width === 0 || height === 0) {
                    indices.push(textures.length);
                    continue;
                }
                decodePaletteTexture(pixels, buffer, palStarts[i], toData, width, height);
                indices.push(textures.length);
                textures.push({
                    pixels,
                    width,
                    height,
                    tex0: getGSRegisterTEX0(0, 0),
                    clamp: getGSRegisterCLAMP(0, 0),
                    name: `${name}_anim_${idx}_${i}`,
                });
            }
            textureIndices.push(indices);
        }
        offs = animationStart + toFrames;
        const patches: ActorTexturePatch[] = [];
        for (let i = 0; i < count; i++) {
            const op = view.getUint8(opOffs++);
            assert(op !== 0xFF);
            const x = view.getUint16(offs + 0x8, true);
            const y = view.getUint16(offs + 0xA, true);
            const target = view.getUint16(offs + 0xC, true);
            const sequences = new Map<number, ActorTextureFrame[]>();
            offs += 0x10;
            for (let j = 0; j < 0x20; j++) {
                const toData = view.getInt32(offs + 0, true) + animationStart;
                const count = view.getUint16(offs + 4, true);
                offs += 8;
                if (count === 0)
                    continue;
                const frames: ActorTextureFrame[] = [];
                sequences.set(j, frames);
                for (let k = 0; k < count; k++) {
                    frames.push({
                        duration: view.getInt16(toData + k * 4 + 0, true),
                        index: view.getUint8(toData + k * 4 + 2),
                        range: view.getUint8(toData + k * 4 + 3),
                    });
                }
            }
            patches.push({ op, x, y, target, sequences });
        }
        texAnim = { textureIndices, patches };
    }
    return { textureCount, texturePairs, blendValues, texAnim };
}

export function parseActorGeometry(name: string, buffer: ArrayBufferSlice, textures: Texture[], gsMap: GSMemoryMap): ActorModel {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x4, true);
    const modelOffset = view.getUint32(0x10, true);
    const texDataOffset = view.getUint32(0x18, true);
    const refPointOffset = view.getUint32(0x20, true);
    const refPointCount = view.getUint32(0x24, true);
    const mappingsStart = view.getUint32(0x30, true);
    const mappingsCount = view.getUint32(0x34, true);
    const scaleStart = view.getUint32(0x58, true);
    const particleOffset = view.getUint32(0x60, true);

    let offs = 0;
    let parsedTextures: ParsedTextures = { textureCount: 0, blendValues: [], texturePairs: [] };
    if (texDataOffset > 0)
        parsedTextures = parseActorTextures(name, buffer, texDataOffset, textures);

    const parts: ActorPart[] = [];
    const VERTEX_STRIDE = 2 + 2;

    interface Primitive {
        runs?: Uint8Array;
        vertexStart: number;
        vertexCount: number;
        texIndex: number;
        effect: number;
    }

    const partType = view.getUint16(modelOffset + 0x4, true);
    const partCount = view.getUint16(modelOffset + 0x6, true);
    const skinningCount = view.getUint16(modelOffset + 0x8, true);
    const boneCount = view.getUint16(modelOffset + 0xA, true);

    offs = view.getUint32(modelOffset + 0x10, true) + modelOffset;
    let maxTex = -1;
    for (let i = 0; i < partCount; i++) {
        const bone = view.getUint16(offs + 0x0, true);
        const baseVertexCount = view.getUint16(offs + 0x4, true);
        const primitiveCount = view.getUint16(offs + 0x6, true);
        const vertexOffset = view.getUint32(offs + 0x8, true) + modelOffset;
        const normalOffset = view.getUint32(offs + 0xC, true) + modelOffset;
        let primOffset = view.getUint32(offs + 0x10, true) + modelOffset;
        const normalCount = view.getUint16(offs + 0x16, true);

        let totalVertices = 0, totalIndices = 0;

        const texWidth = Math.max(baseVertexCount, normalCount);
        const vertexData = new Float32Array(texWidth * 8);
        for (let i = 0; i < baseVertexCount; i++) {
            for (let j = 0; j < 3; j++)
                vertexData[4*i + j] = view.getInt16(vertexOffset + 2*(3*i+j), true);
        }
        for (let i = 0; i < normalCount; i++) {
            for (let j = 0; j < 3; j++)
                vertexData[4*(texWidth + i) + j] = view.getInt16(normalOffset + 2*(3*i + j), true)/0x7FFF;
        }

        const prims: Primitive[] = [];
        for (let j = 0; j < primitiveCount; j++) {
            const flags = view.getUint8(primOffset + 0x0);
            const triStrip = (flags & 1) !== 0;
            const effect = flags >>> 1;
            const colorIndex = view.getUint8(primOffset + 0x1);
            const texIndex = view.getInt8(primOffset + 0x2);
            maxTex = Math.max(maxTex, texIndex);
            const count = view.getUint16(primOffset + 0x4, true);
            const dataStart = view.getUint32(primOffset + 0x8, true) + modelOffset;
            primOffset += 0xC;
            if (triStrip) {
                let stripOffs = dataStart;
                for (let k = 0; k < count; k++) {
                    const toNext = view.getUint8(stripOffs + 0)*0x10;
                    const toVtxs = view.getUint8(stripOffs + 1);
                    const runCount = view.getUint8(stripOffs + 2);
                    const vertexCount = view.getUint8(stripOffs + 3);
                    let total = 0;
                    for (let r = 0; r < runCount; r++)
                        total += view.getUint8(stripOffs + 4 + r);
                    assert(total === vertexCount);
                    assert(toVtxs === align(4 + runCount, 8));
                    assert(toNext === align(toVtxs + 8*vertexCount, 0x10));
                    prims.push({ texIndex, vertexCount, vertexStart: toVtxs + stripOffs, runs: buffer.createTypedArray(Uint8Array, stripOffs + 4, runCount) , effect});
                    totalVertices += vertexCount;
                    totalIndices += 3*(vertexCount - 2*runCount);
                    stripOffs += toNext;
                }
            } else {
                assert((count % 3) === 0);
                prims.push({ texIndex, vertexCount: count, vertexStart: dataStart, effect });
                totalVertices += count;
                totalIndices += count;
            }
        }
        assert(maxTex <= parsedTextures.textureCount - 1);

        const attrData = new Float32Array(totalVertices*VERTEX_STRIDE);
        const indexData = new Uint16Array(totalIndices);
        const getVec = (dstIndex: number, srcIndex: number, isNormal: boolean, currIdx: number): void => {
            if (srcIndex & 0x8000) {
                const offset = srcIndex & 0x7FFF;
                let neg = 0;
                if (isNormal) {
                    assert((offset % 3 === 2) && offset > 0);
                    neg = (offset + 1)/3;
                } else {
                    assert((offset % 3 === 0) && offset > 0);
                    neg = offset/3;
                }
                const prevOffs = dstIndex - VERTEX_STRIDE*neg;
                attrData[dstIndex] = attrData[prevOffs];
                // make sure we aren't looking back into a previous primitive
                assert(neg <= currIdx);
            } else {
                if (isNormal)
                    assert(srcIndex < normalCount)
                else
                    assert(srcIndex < baseVertexCount);
                attrData[dstIndex] = srcIndex;
            }
        };

        let vtxIdx = 0, indexIdx = 0;
        const newDrawCall = (textureIndex: number, blendData: number, effectType: number): ActorDrawCall => {
            return {
                indexOffset: indexIdx,
                indexCount: 0,
                textureIndex,
                cullingEnabled: (effectType & 2) === 0,
                blendMode: blendData,
                effectType,
        }};

        prims.sort((a,b) => {
            if (a.texIndex !== b.texIndex)
                return a.texIndex - b.texIndex;
            return a.effect - b.effect;
        })

        const drawCalls: ActorDrawCall[] = [];
        let currDC: ActorDrawCall | null = null;
        for (let p of prims) {
            let textureIndex = -1, alpha_data0 = 0, texW = 0x10, texH = 0x10;
            if (p.texIndex >= 0) {
                textureIndex = p.texIndex;
                alpha_data0 = parsedTextures.blendValues[p.texIndex];
                texW *= textures[p.texIndex].width;
                texH *= textures[p.texIndex].height;
            }

            if (!currDC || currDC.textureIndex !== textureIndex || currDC.effectType !== p.effect) {
                currDC = newDrawCall(textureIndex, alpha_data0, p.effect);
                drawCalls.push(currDC);
            }

            let readOffs = p.vertexStart;
            let perRun = 0, runIdx = 0;
            for (let j = 0; j < p.vertexCount; j++) {
                const srcVtx = view.getUint16(readOffs + 0, true);
                const srcNorm = view.getUint16(readOffs + 2, true);
                getVec(vtxIdx*VERTEX_STRIDE + 0, srcVtx, false, j);
                getVec(vtxIdx*VERTEX_STRIDE + 1, srcNorm, true, j);

                attrData[vtxIdx*VERTEX_STRIDE + 2] = view.getUint16(readOffs + 4, true) / texW;
                attrData[vtxIdx*VERTEX_STRIDE + 3] = view.getUint16(readOffs + 6, true) / texH;

                if (p.runs) {
                    if (perRun == p.runs[runIdx]) {
                        runIdx++;
                        perRun = 0;
                    }
                    if (perRun >= 2) {
                        indexData[indexIdx++] = vtxIdx - 1 - (perRun % 2);
                        indexData[indexIdx++] = vtxIdx - 2 + (perRun % 2);
                        indexData[indexIdx++] = vtxIdx;
                        currDC.indexCount += 3;
                    }
                    perRun++;
                } else {
                    indexData[indexIdx++] = vtxIdx;
                    currDC.indexCount++;
                }
                vtxIdx++;
                readOffs += 8;
            }
        }

        parts.push({ bone, drawCalls, vertexData, attrData, indexData, baseVertexCount, texWidth });
        if (0x830 < partType && partType < 0x1314)
            offs += 0x18;
        else
            offs += 0x28;
    }
    const bones: Bone[] = [];
    offs = view.getUint32(modelOffset + 0x1C, true) + modelOffset;
    for (let i = 0; i < boneCount; i++) {
        const parentIndex = view.getUint16(offs + 0x0, true);
        // for (let j = 0; j < 9; j++)
        //     assert(view.getInt16(offs + 2 + 2*j, true) === 0);
        const euler = vec3.fromValues(
            view.getInt16(offs + 0x2, true),
            view.getInt16(offs + 0x4, true),
            view.getInt16(offs + 0x6, true),
        );
        vec3.scale(euler, euler, MathConstants.DEG_TO_RAD / 100);
        const offset = vec3.fromValues(
            view.getInt16(offs + 0x8, true),
            view.getInt16(offs + 0xA, true),
            view.getInt16(offs + 0xC, true),
        );
        const scale = vec3.fromValues(
            view.getInt16(offs + 0xE, true),
            view.getInt16(offs + 0x10, true),
            view.getInt16(offs + 0x12, true),
        );
        vec3.scale(scale, scale, 1 / 0x1000); // actually just truncates the low bits?
        offs += 0x14;
        bones.push({
            parent: parentIndex == i ? -1 : parentIndex,
            euler, offset, scale
        });
    }

    const skinning: Skinning[] = [];
    offs = view.getUint32(modelOffset + 0x14, true) + modelOffset;
    for (let i = 0; i < skinningCount; i++) {
        const bone = view.getUint16(offs + 0, true);
        const part = view.getUint16(offs + 2, true);
        const relBone = view.getUint16(offs + 4, true);
        const longform = view.getUint16(offs + 6, true) !== 0;
        let vertexOffset = view.getUint32(offs + 8, true) + modelOffset;
        const count = view.getUint32(vertexOffset, true);
        const data = buffer.createTypedArray(Int16Array, vertexOffset + 4, count*4);
        const lists: SkinningList[] = [{data, count, indexBase: 0, mode: SkinningMode.BASIC}];
        vertexOffset += 4 + 8*count;
        let mode = SkinningMode.SCALED;
        if (longform ) {
            const scaledCount = view.getUint16(vertexOffset, true);
            lists.push({
                indexBase: 0,
                data: buffer.createTypedArray(Int16Array, vertexOffset + 2, scaledCount*5),
                count: scaledCount,
                mode: SkinningMode.SCALED,
            });
            vertexOffset += 2 + 10*scaledCount;

            const perturbCount = view.getUint16(vertexOffset, true);
            lists.push({
                indexBase: 0,
                data: buffer.createTypedArray(Int16Array, vertexOffset + 2, perturbCount*5),
                count: perturbCount,
                mode: SkinningMode.PERTURB,
            });
        } else {
            while (true) {
                const count = view.getUint16(vertexOffset, true);
                if (count === 0xFFFF) {
                    if (mode === SkinningMode.SCALED) {
                        mode = SkinningMode.PERTURB;
                        vertexOffset += 4;
                        continue;
                    } else
                        break;
                }
                lists.push({
                    indexBase: view.getUint16(vertexOffset + 2, true) * 0x100,
                    data: buffer.createTypedArray(Int16Array, vertexOffset + 4, count*4),
                    count: count,
                    mode: mode,
                });
                vertexOffset += 4 + 8*count;
            }
        }
        skinning.push({bone, part, relBone, longform, lists});
        offs += 0xc;
    }

    const refPoints: RefPoint[] = [];
    offs = refPointOffset;
    for (let i = 0; i < refPointCount; i++) {
        const raw = view.getUint16(offs + 0, true);
        const pt: RefPoint = {
            id: raw & 0xFF,
            flags: raw >>> 14,
            bone: view.getUint16(offs + 2, true),
        };
        const pos = vec3.fromValues(
            view.getFloat32(offs + 4, true),
            view.getFloat32(offs + 8, true),
            view.getFloat32(offs + 12, true),
        );

        if (pt.flags === 1)
            pt.pos = pos;
        else
            assert(vec3.len(pos) === 0);
        refPoints[pt.id] = pt;
        offs += 0x10;
    }

    const boneMappings: Map<number, Uint16Array> = new Map();
    for (let i = 0; i < mappingsCount; i++) {
        const offset = view.getUint32(mappingsStart + 4*i, true);
        const id = view.getUint16(offset + 0, true);
        const count = view.getUint16(offset + 2, true);
        boneMappings.set(id, buffer.createTypedArray(Uint16Array, offset + 8, count));
    }

    const defaultAnimations: number[][] = [];
    for (let i = 0; i < 4; i++) {
        const offset = view.getUint32(0x38 + 8*i, true);
        const count = view.getUint32(0x38 + 8*i + 4, true);
        const entries: number[] = [];
        defaultAnimations.push(entries);
        if (offset === 0)
            continue;
        for (let j = 0; j < count; j++) {
            entries.push(view.getUint32(offset + 4*j, true));
        }
    }

    const scales: ScaleData = {
        base: 1, actor: 1, offset: 1, height: 1,
        envMap: 1, deflection: 2, specular: vec4.fromValues(1, 1, 1, 1),
        shadowRadius: 1, collisionRadius: 1,
    };
    if (chunkCount >= 9) {
        assert(scaleStart !== 0);
        const info = view.getUint32(scaleStart + 0, true);
        scales.shadowRadius = view.getFloat32(scaleStart + 0x4, true);
        scales.base = view.getFloat32(scaleStart + 0xC, true);
        scales.collisionRadius = view.getFloat32(scaleStart + 0x10, true);
        scales.height = view.getFloat32(scaleStart + 0x14, true);
        scales.actor = view.getFloat32(scaleStart + 0x1C, true);
        scales.offset = view.getFloat32(scaleStart + 0x20, true);
        if (info > 5667) {
            scales.envMap = view.getFloat32(scaleStart + 0x38, true);
            scales.deflection = view.getFloat32(scaleStart + 0x3C, true);
            vec4.set(scales.specular,
                view.getUint8(scaleStart + 0x40) / 0x80,
                view.getUint8(scaleStart + 0x41) / 0x80,
                view.getUint8(scaleStart + 0x42) / 0x80,
                view.getUint8(scaleStart + 0x43) / 0x7f, // not used anyway...
            );
        }
    }

    const out: ActorModel = { parts, skinning, bones, defaultAnimations, scales, boneMappings, refPoints, texturePairs: parsedTextures.texturePairs };
    if (particleOffset > 0) {
        out.particles = parseActorParticles(name, buffer, particleOffset, textures, gsMap);
    }
    if (parsedTextures.texAnim)
        out.texAnim = parsedTextures.texAnim;
    return out;
}

export function parseStandaloneActorParticles(name: string, buffer: ArrayBufferSlice, common: ArrayBufferSlice, textures: Texture[]): LevelParticles {
    const gs = gsMemoryMapNew();
    uploadSpriteTextures(common, 0, gs);
    return parseActorParticles(name, buffer, 0, textures, gs);
}

function parseActorParticles(name: string, buffer: ArrayBufferSlice, offset: number, textures: Texture[], gs: GSMemoryMap, magic?: MagicLayout): LevelParticles {
    const view = buffer.createDataView();
    const dataStart = view.getUint32(offset + 0x3c, true) + offset;
    assert(dataStart > offset);
    const seqOffset = view.getUint32(dataStart + 0x4, true);
    const particleOffset = view.getUint32(dataStart + 0x20, true);

    const offsetList: number[] = [];
    for (let i = 0; i < 9; i++)
        offsetList.push(view.getUint32(dataStart + 4*i + 4, true));
    const sprites = uploadSpriteTextures(buffer, offset, gs);
    let data: LevelParticles = {
        emitters: [],
        flipbooks: [],
        geometry: [],
        behaviors: [],
        patterns: [],
        maxBufferSize: 0,
        waterTextures: [],
    };
    if (particleOffset > 0) {
        assert(view.getUint32(seqOffset + dataStart, true) === seqOffset + 0x10);
        assert(view.getUint32(particleOffset + dataStart, true) === particleOffset + 0x10);
        const particleStart = dataStart + particleOffset + 0x10;
        if (!magic)
            magic = {
                id: -1,
                headers: [],
                funcMap: null!,
                particleIndex: 0,
            };
        data = parseParticleData(buffer, particleStart, gs, textures, [], magic);
    }
    let extraGeoOffset = view.getUint32(dataStart + 0x10, true);
    let extraFlipbookOffset = view.getUint32(dataStart + 0x24, true);
    let extraGeoCount = view.getUint16(dataStart + 0x48, true);
    let extraFlipbookCount = view.getUint16(dataStart + 0x52, true);
    // hopefully no monsters have geometry particles, or we'd have to look at the commands
    if (name !== "shatter") {
        extraFlipbookCount = extraGeoCount;
        extraFlipbookOffset = extraGeoOffset;
        extraGeoCount = 0;
        extraGeoOffset = 0;
    }
    if (extraFlipbookCount > 0 && extraFlipbookOffset !== 0) {
        data.extraFlipbookIndex = data.flipbooks.length;
        let offs = dataStart + extraFlipbookOffset;
        for (let i = 0; i < extraFlipbookCount; i++, offs += 4) {
            const toFlipbook = view.getUint32(offs, true);
            data.flipbooks.push(toFlipbook ? parseFlipbook(buffer, toFlipbook + dataStart, gs, textures, true) : null);
        }
    }
    if (extraGeoCount > 0) {
        data.extraGeometryIndex = data.geometry.length;
        let offs = dataStart + extraGeoOffset;
        for (let i = 0; i < extraGeoCount; i++, offs += 4) {
            const toGeo = view.getUint32(offs, true);
            if (toGeo >= 0x10000)
                debugger
            if (toGeo > 0) {
                data.geometry.push(parseGeometry(view, dataStart+toGeo, [], false, textures, gs, true));
            } else {
                data.geometry.push({flags: 0, blendSettings: 0, points: []});
            }
        }
    }

    if (sprites.length > 0) {
        data.spriteStartIndex = textures.length;
        for (let s of sprites) {
            decodeTexture(gs, textures, s.tex0, getGSRegisterCLAMP(0, 0), "magic");
        }
    }
    parseActorMagicCommands(buffer, data, dataStart + seqOffset + 0x10, dataStart + Math.min(...offsetList.filter(x => x>seqOffset)));
    return data;
}

export type AnimationCurve = number | Int16Array;

export interface BoneCurve {
    eulerX?: AnimationCurve;
    eulerY?: AnimationCurve;
    eulerZ?: AnimationCurve;
    posX?: AnimationCurve;
    posY?: AnimationCurve;
    posZ?: AnimationCurve;
    scaleX?: AnimationCurve;
    scaleY?: AnimationCurve;
    scaleZ?: AnimationCurve;
}

interface AnimationSegment {
    track?: AnimationTrack;
    start: number;
    end: number;
    loops: number;
}

export interface Animation {
    id: number;
    segments: AnimationSegment[];
}

interface AnimationTrack {
    curves: BoneCurve[];
    times: Uint16Array;
}

interface AnimationGroup {
    id: number;
    animations: Animation[];
}

const enum SeqOp {
    END,
    LOAD,
    WAIT_FLAG,
    SLEEP,
    JUMP,
    END_2,
    WAIT_COUNT,
}

const enum CurveType {
    Zero,
    One,
    Const,
    Curve,
}

function fixupAngles(xs?: AnimationCurve, ys?: AnimationCurve, zs?: AnimationCurve): void {
    if (!((xs instanceof Int16Array) && (ys instanceof Int16Array) && (zs instanceof Int16Array)))
        return;
    assert(xs.length === ys.length && xs.length === zs.length);
    let doFlip = false;
    let px = xs[0], py = ys[0], pz = zs[0];
    for (let i = 1; i < xs.length; i++) {
        const x = xs[i];
        const y = ys[i];
        const z = zs[i];
        const main = Math.hypot(angleDist(x,px,0x1000), angleDist(y,py,0x1000), angleDist(z,pz,0x1000));
        const alt = Math.hypot(angleDist(x+0x800,px,0x1000), angleDist(0x800-y,py,0x1000), angleDist(z+0x800,pz,0x1000));
        if (alt < main) {
            doFlip = !doFlip;
        }
        px = x;
        py = y;
        pz = z;
        if (doFlip) {
            xs[i] = x + 0x800;
            ys[i] = 0x800 - y;
            zs[i] = z + 0x800;
        }

    }
}

interface CurveState {
    view: DataView;
    typeStart: number;
    streamOffs: number;
}

function parseCurve(state: CurveState, duration: number, index: number): AnimationCurve | undefined {
    const shift = 2*(index & 3);
    const type: CurveType = (state.view.getUint8(state.typeStart + (index >>> 2)) >>> shift) & 3;
    switch (type) {
        case CurveType.Zero: {
            if ((index % 9) < 6)
                return undefined;
            return 0;
        }
        case CurveType.One: {
            if ((index % 9) < 6)
                return 0x1000;
            return undefined;
        }
        case CurveType.Const: {
            state.streamOffs += 2;
            return state.view.getInt16(state.streamOffs - 2, true);
        }
        case CurveType.Curve: {
            const end = state.view.getUint16(state.streamOffs, true) + state.streamOffs;
            state.streamOffs += 2;
            const curve = new Int16Array(duration);
            let idx = 0;
            let value = 0;
            let inc = 0;
            let wait = 0;
            while (state.streamOffs < end || wait > 0) {
                if (wait > 0) {
                    wait--;
                } else {
                    const op = state.view.getUint8(state.streamOffs++);
                    if ((op & 0x80) === 0) {
                        inc = (op << 0x19) >> 0x19;
                    } else if ((op & 0x40) === 0) {
                        wait = op & 0x3F;
                    } else {
                        const extra = state.view.getInt8(state.streamOffs++);
                        inc = (op & 0x3F) | (extra << 6);
                    }
                }
                value += inc;
                if (idx >= duration) {
                    assert(state.streamOffs === end && inc === 0);
                    break;
                }
                curve[idx++] = value;
            }
            assert(idx === duration);
            return curve;
        }
    };
};


export function parseAnimation(buffer: ArrayBufferSlice, simple: Boolean): AnimationGroup[] {
    const view = buffer.createDataView();
    const groupCount = view.getUint32(4, true);
    let groupOffs = view.getUint32(0xc, true);
    if (simple)
        assert(groupCount === 1);

    const state: CurveState = {
        view,
        typeStart: -1,
        streamOffs: -1,
    };

    const groups: AnimationGroup[] = [];
    for (let g = 0; g < groupCount; g++) {
        const gid = view.getUint32(groupOffs + 0x4, true);
        const seqCount = view.getUint16(groupOffs + 0x8, true);
        const trackCount = view.getUint16(groupOffs + 0xA, true);
        const seqStart = view.getUint32(groupOffs + 0x0C, true);
        const trackStart = view.getUint32(groupOffs + 0x10, true);
        groupOffs += 0x14;
        const animations: Animation[] = [];
        const tracks: AnimationTrack[] = [];
        let seqOffs = seqStart;
        let trackOffs = trackStart;
        for (let i = 0; i < trackCount; i++) {
            // load and simulate tracks
            const timeCount = view.getUint16(trackOffs + 0x4, true);
            if (simple)
                assert(timeCount === 2);
            const timeStart = view.getUint32(trackOffs + 0x8, true);
            const times = buffer.createTypedArray(Uint16Array, timeStart, timeCount);
            const inner = view.getUint32(trackOffs + 0xC, true);
            // assert(view.getUint16(timeStart, true) === 0);
            const duration = view.getUint16(timeStart + 2, true);
            trackOffs += 0x10;

            const entryCount = view.getUint16(inner + 0x2, true);
            const frameRate = view.getUint16(inner + 0x4, true) >>> 8;
            if (frameRate !== 30)
                console.log("framerate", frameRate)
            // assert(view.getUint16(inner + 0x4, true) === 0x1E00); // frame rate 30?
            const footStepCount = view.getUint16(inner + 0x6, true);
            state.typeStart = view.getUint32(inner + 0x8, true) + inner;
            state.streamOffs = view.getUint32(inner + 0xC, true) + inner;
            const footstepStart = view.getUint32(inner + 0x10, true) + inner;

            const curves: BoneCurve[] = [];
            for (let j = 0; j < entryCount; j++) {
                const c: BoneCurve = {};
                const eulerX = parseCurve(state, duration, 9*j + 0);
                const eulerY = parseCurve(state, duration, 9*j + 1);
                const eulerZ = parseCurve(state, duration, 9*j + 2);
                if (eulerX)
                    c.eulerX = eulerX;
                if (eulerY)
                    c.eulerY = eulerY;
                if (eulerZ)
                    c.eulerZ = eulerZ;
                const posX = parseCurve(state, duration, 9*j + 3);
                const posY = parseCurve(state, duration, 9*j + 4);
                const posZ = parseCurve(state, duration, 9*j + 5);
                if (posX)
                    c.posX = posX;
                if (posY)
                    c.posY = posY;
                if (posZ)
                    c.posZ = posZ;
                const scaleX = parseCurve(state, duration, 9*j + 6);
                const scaleY = parseCurve(state, duration, 9*j + 7);
                const scaleZ = parseCurve(state, duration, 9*j + 8);
                if (scaleX)
                    c.scaleX = scaleX;
                if (scaleY)
                    c.scaleY = scaleY;
                if (scaleZ)
                    c.scaleZ = scaleZ;
                curves.push(c);
            }
            tracks.push({ curves, times });
        }

        for (let i = 0; i < seqCount; i++) {
            const id = view.getUint16(seqOffs + 0x0, true);
            const segments: AnimationSegment[] = [];
            const labelCount = view.getUint16(seqOffs + 0x4, true); // one label
            const byteCodeLength = view.getUint16(seqOffs + 0x6, true); // bytecode length: load + end
            const codeStart = view.getUint32(seqOffs + 0xC, true);
            let codeOffs = codeStart;
            let lastLoopCount = -1;
            while (codeStart !== 0 && codeOffs < codeStart + byteCodeLength) {
                const op = view.getUint8(codeOffs++);
                switch (op) {
                    case SeqOp.LOAD: {
                        const track = view.getUint16(codeOffs, true);
                        const loops = view.getUint16(codeOffs + 2, true);
                        const start = tracks[track].times[view.getUint16(codeOffs + 4, true)];
                        const end = tracks[track].times[view.getUint16(codeOffs + 6, true)];
                        assert(lastLoopCount === -1);
                        lastLoopCount = loops;
                        codeOffs += 8;
                        const prev = segments[segments.length - 1];
                        // just combine simple segments, not sure this matters for us
                        if (loops === 1 && prev && prev.loops === 1 && tracks[track] === prev.track && prev.end === start - 1) {
                            prev.end = end;
                        } else {
                            segments.push({track: tracks[track], loops, start, end});
                        }
                    } break;
                    case SeqOp.SLEEP: {
                        const sleepFrames = view.getUint16(codeOffs, true);
                        codeOffs += 2;
                        segments.push({loops: 1, start: 0, end: sleepFrames});
                    } break;
                    case SeqOp.END: case SeqOp.END_2: break; //assert(codeOffs === codeStart + byteCodeLength); break;
                    case SeqOp.WAIT_FLAG: {
                        assert(lastLoopCount === 1);
                        lastLoopCount = -1;
                    } break;
                    case SeqOp.WAIT_COUNT: {
                        assert(lastLoopCount !== -1);
                        lastLoopCount = -1;
                        const next = view.getUint8(codeOffs);
                        const nextVal = view.getUint16(codeOffs + 1, true);
                        if (next === SeqOp.LOAD && nextVal < tracks.length && tracks[nextVal] === segments[segments.length - 1].track) {
                            console.warn("found likely bad animation data");
                        } else {
                            codeOffs += 2;
                        }
                    } break;
                    default:
                        debugger;
                }
            }
            animations.push({id, segments})
            if (segments.length === 1) {
                const cc = segments[0].track!.curves;
                for (let i = 0; i < cc.length; i++) {
                    const c = cc[i];
                    fixupAngles(c.eulerX, c.eulerY, c.eulerZ)
                }
            }
            seqOffs += 0x10;
        }

        groups.push({ id: gid, animations });
    }
    return groups;
}

export const enum KeyframeFormat {
    LINEAR,
    SPLINE,
    CONSTANT,
    COMBINED,
}

interface Keyframe {
    start: number;
    duration: number;
    format: KeyframeFormat;
    data: vec3[];
}

export const enum EffectType {
    MOTION,
    ROTATION,
    PARAMETER,
    TEXTURE,
    COMBINED = 5,
}

export interface PartEffect {
    type: EffectType;
    length: number;
    keyframes: Keyframe[];
}

export interface ActiveEffect {
    active: boolean;
    runOnce: boolean;
    partIndex: number;
    effectIndex: number;
    startFrame: number;
}

export function parseEffect(view: DataView, offset: number, length: number, isCombined: boolean): PartEffect {
    const type: EffectType = isCombined ? EffectType.COMBINED : view.getUint32(offset + 0x08, true);

    const keyframes: Keyframe[] = [];

    let start = 0;

    for (let i = 0; i < length; i++) {
        const format: KeyframeFormat = isCombined ? KeyframeFormat.COMBINED : view.getUint16(offset + 0x02, true);
        const duration = Math.max(view.getUint32(offset + 0x04, true), 1);
        const data: vec3[] = [];

        switch (format) {
            case KeyframeFormat.CONSTANT: {
                data.push(vec3FromView(view, offset + 0x40, true));
            } break;
            case KeyframeFormat.LINEAR: {
                data.push(
                    vec3FromView(view, offset + 0x30, true),
                    vec3FromView(view, offset + 0x40, true),
                );
            } break;
            case KeyframeFormat.SPLINE: {
                data.push(
                    vec3FromView(view, offset + 0x10, true),
                    vec3FromView(view, offset + 0x20, true),
                    vec3FromView(view, offset + 0x30, true),
                    vec3FromView(view, offset + 0x40, true),
                );
            } break;
            case KeyframeFormat.COMBINED: {
                data.push(
                    vec3FromView(view, offset + 0x08, true),
                    vec3FromView(view, offset + 0x14, true),
                );
            } break;
        }

        keyframes.push({ format, data, start, duration });
        start += duration;
        offset += isCombined ? 0x20 : 0x80;
    }

    return { type, keyframes, length: start };
}

interface MapPoint {
    pos: vec3;
    heading: number;
    entrypoint: number;
}

export const enum WorkerType {
    NONE,
    MOTION,
    PLAYER_EDGE,
    PLAYER_ZONE,
    UNKNOWN,
    EDGE,
    ZONE,
}

export interface WorkerSpec {
    type: WorkerType;
    entrypoints: Uint32Array;
    labels: Uint32Array;
}

export interface ScriptData {
    name: string;
    intConsts: Int32Array;
    floatConsts: Float32Array;
    code: DataView;
    shared: DataView;
    arrays: ScriptArray[];
    workers: WorkerSpec[];
}

export interface EventData {
    script: ScriptData;
    mapPoints: MapPoint[];
    strings: StringInfo[];
    modelList: number[];
}

interface BattlePositions {
    monsters: vec3[];
    party: vec3[];
    other: vec3[];
}

export interface EncounterData {
    script: ScriptData;
    battlePositions: BattlePositions[];
    monsters: number[];
    baseModels: number[];
}

export enum ArraySource {
    GLOBAL,
    UNK,
    UNUSED,
    PRIVATE,
    SHARED,
    OBJECT,
    EVENT,
}

export const enum DataFormat {
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    FLOAT,
}
interface ScriptArray {
    rawDesc: number;
    source: ArraySource;
    offset: number;
    elementType: DataFormat;
    count: number;
    values?: number[];
}

function readValue(view: DataView, offset: number, format: DataFormat): number {
    switch (format) {
        case DataFormat.U8: return view.getUint8(offset);
        case DataFormat.I8: return view.getInt8(offset);
        case DataFormat.U16: return view.getUint16(offset, true);
        case DataFormat.I16: return view.getInt16(offset, true);
        case DataFormat.U32: return view.getUint32(offset, true);
        case DataFormat.I32: return view.getInt32(offset, true);
        case DataFormat.FLOAT: return view.getFloat32(offset, true);
    }
    throw `bad format ${format}`;
}

export function byteSize(format: DataFormat): number {
    switch (format) {
        case DataFormat.U8: case DataFormat.I8: return 1;
        case DataFormat.U16: case DataFormat.I16: return 2;
        case DataFormat.U32: case DataFormat.I32: case DataFormat.FLOAT: return 4;
    }
    throw `bad format ${format}`;
}

function parseScript(buffer: ArrayBufferSlice, start: number): ScriptData {
    const view = buffer.createDataView();
    const mapStart = view.getUint32( + 0x04, true);
    const mapEnd = view.getUint32(start + 0x08, true);
    const nameStart = view.getUint32(start + 0x0C, true);
    // numbers indicating which controllers are of which sizes?
    // these can correspond to different pause menu location names
    const zoneCount = view.getUint16(start + 0x1E, true);
    const eventVarStart = view.getUint32(start + 0x20, true);
    const zoneStart = view.getUint32(start + 0x28, true);
    const moreDataStart = view.getUint32(start + 0x2C, true);
    const instructionStart = view.getUint32(start + 0x30, true);
    const workerCount = view.getUint16(start + 0x34, true);
    const controllerStart = view.getUint32(start + 0x38, true);

    const name = readString(buffer, start + nameStart);

    let arrayDescriptionStart = -1;
    let arrayDescriptionCount = -1;
    let intConstStart = -1;
    let intConstCount = -1;
    let floatConstStart = -1;
    let floatConstCount = -1;
    let sharedDataStart = -1;

    const match = function (a: number, b: number): number {
        if (a >= 0)
            assert(a === b);
        return b;
    }

    const workers: WorkerSpec[] = [];
    let offset = controllerStart + start;
    const seenPrivateOffsets = new Set<number>();
    for (let i = 0; i < workerCount; i++, offset += 0x34) {
        // offsets are given as if the structre were variable length, but it isn't
        assert(view.getUint32(start + 0x38 + 4 * i, true) === offset - start);

        const type: WorkerType = view.getUint8(offset + 0x00);
        const arrayCount = view.getUint16(offset + 0x02, true);
        const intCount = view.getUint16(offset + 0x04, true);
        const floatCount = view.getUint16(offset + 0x06, true);
        const entryCount = view.getUint16(offset + 0x08, true);
        const labelCount = view.getUint16(offset + 0x0A, true);
        const unusedLength = view.getUint32(offset + 0x0C, true);
        const privateLength = view.getUint32(offset + 0x10, true);

        const arrayStart = view.getUint32(offset + 0x14, true);
        const intStart = view.getUint32(offset + 0x18, true);
        const floatStart = view.getUint32(offset + 0x1C, true);
        const entryStart = view.getUint32(offset + 0x20, true);
        const labelStart = view.getUint32(offset + 0x24, true);
        const unusedDataStart = view.getUint32(offset + 0x28, true);
        const privateDataStart = view.getUint32(offset + 0x2C, true);
        const sharedStart = view.getUint32(offset + 0x30, true);

        assert(unusedDataStart === 0);
        assert(privateLength === 0 || !seenPrivateOffsets.has(privateDataStart) || privateDataStart === 0)
        seenPrivateOffsets.add(privateDataStart)

        arrayDescriptionStart = match(arrayDescriptionStart, arrayStart);
        arrayDescriptionCount = match(arrayDescriptionCount, arrayCount);
        intConstStart = match(intConstStart, intStart);
        floatConstStart = match(floatConstStart, floatStart);
        intConstCount = match(intConstCount, intCount);
        floatConstCount = match(floatConstCount, floatCount);
        sharedDataStart = match(sharedDataStart, sharedStart);

        const entrypoints = new Uint32Array(buffer.arrayBuffer, entryStart + start, entryCount);
        const labels = new Uint32Array(buffer.arrayBuffer, labelStart + start, labelCount);

        // private data starts empty
        if (privateDataStart !== 0) {
            for (let j = 0; j < privateLength; j++)
                assert(view.getUint8(start + privateDataStart + j) === 0)
        }

        workers.push({ type, entrypoints, labels })
    }
    // console.log(seenPrivateOffsets)

    const intConsts = intConstCount > 0 ? new Int32Array(buffer.arrayBuffer, start + intConstStart, intConstCount) : new Int32Array();
    const floatConsts = floatConstCount > 0 ? new Float32Array(buffer.arrayBuffer, start + floatConstStart, floatConstCount) : new Float32Array();
    const instructionEnd = sharedDataStart < 0 ? moreDataStart : sharedDataStart;
    const code = buffer.createDataView(instructionStart + start, instructionEnd - instructionStart);
    const shared = buffer.createDataView(start + sharedDataStart);
    const arrays: ScriptArray[] = [];
    for (let i = 0, offs = start + arrayDescriptionStart; i < arrayDescriptionCount; i++, offs += 8) {
        const info = view.getUint32(offs, true);
        const offset = info & 0xFFFFFF;
        const elementType : DataFormat = info >>> 28;
        const source = (info >>> 25) & 7;
        const count = view.getUint16(offs + 4, true);

        const arr: ScriptArray = {rawDesc: info, count, offset, elementType, source};
        if (source === ArraySource.SHARED || source === ArraySource.EVENT) {
            const values: number[] = [];
            let offs = start + offset + (source === ArraySource.SHARED ? sharedDataStart : eventVarStart);
            for (let j = 0; j < count; j++) {
                values.push(readValue(view, offs, elementType));
                offs += byteSize(elementType);
            }
            arr.values = values;
        }
        arrays.push(arr);
    }
    return {intConsts, floatConsts, code, shared, workers, name, arrays};
}

export function parseEvent(buffer: ArrayBufferSlice, mapID: number): EventData {
    assert(readString(buffer, 0, 4) === "EV01");
    const view = buffer.createDataView();

    const scriptStart = view.getUint32(0x04, true);
    const stringsStart = view.getUint32(0x08, true);

    // part of script but only matter for events
    const mapStart = view.getUint32(scriptStart + 0x04, true);
    const mapEnd = view.getUint32(scriptStart + 0x08, true);
    const moreDataStart = view.getUint32(scriptStart + 0x2C, true);
    const modelListStart = view.getUint32(scriptStart + moreDataStart + 0x28, true);
    let offs = modelListStart + scriptStart;
    const modelCount = view.getUint16(offs, true);
    offs += 2;
    const modelList: number[] = [];
    for (let i = 0; i < modelCount; i++) {
        modelList.push(view.getUint16(offs, true));
        offs += 2;
    }

    const mapPoints: MapPoint[] = [];
    for (let mapOffs = mapStart + scriptStart; mapOffs < mapEnd + scriptStart; mapOffs += 0x20) {
        const id = view.getUint16(mapOffs + 0x00, true); // should probably check these are all the same
        assert(id === mapID);
        const entrypoint = view.getUint16(mapOffs + 0x06, true);
        const heading = view.getFloat32(mapOffs + 0x08, true);
        const x = view.getFloat32(mapOffs + 0x0C, true);
        const y = view.getFloat32(mapOffs + 0x10, true);
        const z = view.getFloat32(mapOffs + 0x14, true);

        mapPoints.push({ entrypoint, heading, pos: vec3.fromValues(x, y, z) });
    }

    const strings: StringInfo[] = [];
    if (stringsStart > 0) {
        const stringCount = view.getUint16(stringsStart, true) >> 3;
        let prev = 0;
        for (let i = 0; i < stringCount; i++) {
            let offs = view.getUint16(stringsStart + 8*i, true);
            if (offs === prev) {
                strings.push({raw: "", seq: []});
                continue;
            }
            strings.push(readStringFromView(view, offs + stringsStart));
            prev = offs;
        }
    }

    const script = parseScript(buffer, scriptStart);
    return { mapPoints, strings, modelList, script};
}

export function parseEncounter(buffer: ArrayBufferSlice): EncounterData {
    const view = buffer.createDataView();
    const scriptStart = view.getUint32(0x4, true);
    const monsterStart = view.getUint32(0xC, true);
    const positionStart = view.getUint32(0x10, true);

    const script = parseScript(buffer, scriptStart);
    const monsters: number[] = [];
    for (let i = 0; i < 8; i++) {
        const id = view.getInt16(monsterStart + 0xC + 2*i, true);
        if (id < 0)
            continue;
        monsters.push(id);
    }

    const getPosList = (start: number, count: number): vec3[] => {
        if (count === 0)
            return [];
        const pts: vec3[] = [];
        for (let i = 0; i < count; i++) {
            pts.push(vec3.fromValues(
                view.getFloat32(start + 0x10*i + 0, true),
                view.getFloat32(start + 0x10*i + 4, true),
                view.getFloat32(start + 0x10*i + 8, true),
            ));
        }
        return(pts);
    }
    let offs = positionStart;
    const battlePositions: BattlePositions[] = [];
    for (let i = 0;; i++) {
        const isBig = view.getUint8(offs) === 0;
        if (view.getUint32(offs) !== view.getUint32(positionStart))
            break;
        // if (isBig)
        //     getPosList(offs + 0x30, 3, `misc_${i}`);
        let party: vec3[] = [], other: vec3[] = [], monsters: vec3[] = [];
        for (let j = 0; j < 3; j ++) {
            const start = view.getUint32(offs + 0x10 + 8*j, true);
            const pts = start === 0 ? [] : getPosList(start + positionStart, view.getUint8(offs + 4 + j));
            if (j === 0)
                party = pts;
            else if (j === 1)
                other = pts;
            else
                monsters = pts;
        }
        battlePositions.push({ party, other, monsters });
        offs += isBig ? 0x60 : 0x40;
    }

    return { script, monsters, battlePositions, baseModels: [] };
}

export enum ControlChar {
    SPACE = 0x07,
    TIMER = 0x09,
    COLOR = 0x0A,
    VAR = 0x12,
    CHAR = 0x13,
    NAME = 0x19,
    BLITZBALL_PLAYER = 0x1A,
    BLITZBALL_MOVE = 0x1B,
    PLACE = 0x1E,
    KEYWORD = 0x20,
}

interface ControlSequence {
    type: number,
    argument: number,
}

interface StringInfo {
    raw: string,
    seq: ControlSequence[],
}

function readStringFromView(view: DataView, offset: number): StringInfo {
    let parts: string[] = [];
    const seq: ControlSequence[] = []
    while (true) {
        const c = view.getUint8(offset++);
        // codes are slightly shifted relative to ascii
        if (c === 0)
            break;
        if (c >= 0x50) // letters shifted forward
            parts.push(String.fromCharCode(c - 0xF));
        else if (c >= 0x4A) // punctuation is a contiguous block, straddling digits
            parts.push(String.fromCharCode(c - 0x10))
        else if (c >= 0x3A)
            parts.push(String.fromCharCode(c - 0x1A));
        else if (c >= 0x30) // numbers are the same as ascii
            parts.push(String.fromCharCode(c));
        else if (c === 3) {
            if (parts.length > 0)
                parts.push("\n");
        } else if (c === 1)
            continue;
        else if (c === 0x10)
            parts.push("CHOICE:");
        else {
            parts.push(`{${seq.length}}`);
            seq.push({
                type: c,
                argument: view.getUint8(offset++) - 0x30,
            });
        }
    }
    return {raw: ''.concat(...parts), seq};
}

interface EncounterRecord {
    id: number;
    file: number;
    weight: number;
}

interface BattlePool {
    map: number,
    files: EncounterRecord[],
}

export interface BattleList {
    name: string,
    pools: BattlePool[],
}

export function parseBattleLists(buffer: ArrayBufferSlice): Map<number, BattleList> {
    const lists = new Map<number, BattleList>();
    const view = buffer.createDataView();
    let offs = view.getUint32(0x4, true);
    let dataStart = view.getUint32(0x8, true);
    while (offs < dataStart) {
        const id = view.getUint16(offs + 0, true);
        const dataOffset = view.getUint16(offs + 2, true);
        let currFile = view.getUint16(offs + 4, true);
        const name = readString(buffer, offs + 6, 6);

        // what is the first byte?
        let subOffs = dataStart + dataOffset + 1;
        const poolCount = view.getUint8(subOffs++);
        const pools: BattlePool[] = [];
        for (let i = 0; i < poolCount; i++) {
            const encCount = view.getUint8(subOffs);
            const map = view.getUint16(subOffs + 1, true);
            // next gets overwritten later, unclear if this value matters
            subOffs += 5;
            const files: EncounterRecord[] = [];
            for (let j = 0; j < encCount; j++) {
                const encID = view.getUint8(subOffs++);
                const weight = view.getUint8(subOffs++);
                files.push({ id: encID, file: currFile++, weight });
            }
            pools.push({map, files})
        }
        lists.set(id, { name, pools });
        assert(view.getUint16(offs + 0xC, true) === 0);
        offs += 0xE;
    }

    return lists;
}