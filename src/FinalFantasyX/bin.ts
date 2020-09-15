import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero, assertExists, readString } from "../util";
import { AABB } from "../Geometry";
import { GSRegister, GSMemoryMap, GSRegisterTEX0, GSRegisterCLAMP, getGSRegisterTEX0, getGSRegisterCLAMP } from "../Common/PS2/GS";
import { vec3 } from "gl-matrix";

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

export interface DrawCall {
    indexOffset: number;
    indexCount: number;
    textureIndex: number | null;
    gsConfiguration: GSConfiguration;
    effectType: LevelEffectType;
    shader: ShaderMode;
}

export interface LevelModel {
    vertexData: Float32Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[];
    bbox: AABB;
}

export interface Texture {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    pixels: Uint8Array[];
    name: string;
    width: number;
    height: number;
}

export interface LevelPart {
    isSkybox: boolean;
    layer: number;
    position: vec3;
    euler: vec3;
    models: LevelModel[];
    textures: Texture[];
}

export interface GSConfiguration {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    tex1_1_data0: number;
    tex1_1_data1: number;
    alpha_1_data0: number;
    alpha_1_data1: number;
    test_1_data0: number;
    test_1_data1: number;
    depthWrite: boolean;
}

function gsConfigurationEqual(a: GSConfiguration, b: GSConfiguration) {
    for (let field in a.tex0)
        if ((a.tex0 as any)[field] !== (b.tex0 as any)[field])
            return false;
    for (let field in a.clamp)
        if ((a.clamp as any)[field] !== (b.clamp as any)[field])
            return false;
    if (a.tex1_1_data0 !== b.tex1_1_data0 || a.tex1_1_data1 !== b.tex1_1_data1) return false;
    if (a.alpha_1_data0 !== b.alpha_1_data0 || a.alpha_1_data1 !== b.alpha_1_data1) return false;
    if (a.test_1_data0 !== b.test_1_data0 || a.test_1_data1 !== b.test_1_data1) return false;
    if (a.depthWrite !== b.depthWrite) return false;
    return true;
}

const enum MapSectionType {
    LEVEL_PART,
    MODEL,
    TEXTURE,
    PALETTE,
}

const enum ShaderMode {
    COLOR_AND_TEXTURE,
    COLOR_AND_NORMALS,
}

const enum LevelEffectType {
    NONE,
    POSITIONS,
    UNUSED,
    UV_LERP,
    COLORS,
    UV_SCROLL,
}

function vec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
    )
}

export function parseLevelGeometry(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap, namePrefix: string): LevelPart[] {
    assert(readString(buffer, 0, 4) === "MAP1")

    const view = buffer.createDataView();
    let offs = view.getUint32(0x14, true);

    assert(view.getUint32(offs) === 0x65432100)
    const sectionCount = view.getUint32(offs + 0x0C, true);
    offs += 0x40;

    // 3 positions, 4 colors, 2 UV coordinates, (up to) 4 extra values for effects.
    const VERTEX_STRIDE = 3 + 4 + 2 + 4;

    const parts: LevelPart[] = [];
    let currPart: LevelPart;

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
            // assert(view.getUint16(offs + 0x30, true) === 0)
            currPart = {
                isSkybox,
                layer,
                position,
                euler,
                models: [],
                textures: [],
            }
            parts.push(currPart);
        } else if (sectionType === MapSectionType.MODEL) {
            const flags = view.getUint16(offs + 0x00, true);
            const regSet = view.getUint16(offs + 0x04, true);
            const float_08 = view.getFloat32(offs + 0x08, true);
            const modelQWC = view.getUint32(offs + 0x0C, true);
            const center = vec3FromView(view, offs + 0x10, true);
            const bboxMin = vec3FromView(view, offs + 0x20, true);
            const bboxMax = vec3FromView(view, offs + 0x30, true);
            const bbox = new AABB(bboxMin[0], bboxMin[1], bboxMin[2], bboxMax[0], bboxMax[1], bboxMax[2]);


            const packetsBegin = offs + 0x40;
            const packetsSize = modelQWC * 0x10;
            const packetsEnd = packetsBegin + packetsSize;

            interface ModelRun {
                vertexRunData: Float32Array;
                vertexRunCount: number;
                indexRunData: Uint16Array;
                textureIndex: number | null;
                gsConfiguration: GSConfiguration;
                effectType: LevelEffectType;
                shader: ShaderMode;
            }
            const modelVertexRuns: ModelRun[] = [];

            // Parse VIF packets.
            let packetsIdx = packetsBegin;

            // State of current "vertex run".
            let vertexRunCount = 0;
            let vertexRunData: Float32Array | null = null;
            let currentTextureIndex: number | null = null;
            let currentGSConfiguration: GSConfiguration = {
                tex0: getGSRegisterTEX0(0, 0),
                clamp: getGSRegisterCLAMP(0, 0),
                tex1_1_data0: -1, tex1_1_data1: -1,
                alpha_1_data0: 0x44, alpha_1_data1: -1,
                test_1_data0: 0x5000F, test_1_data1: -1,
                depthWrite: true,
            };

            let expectedColorOffs = -1;
            let expectedTexCoordOffs = -1;
            let expectedPositionOffs = -1;
            let expectedExtraOffs = -1;
            let currentEffect: LevelEffectType = LevelEffectType.NONE;
            let currentShader: ShaderMode = ShaderMode.COLOR_AND_TEXTURE;

            const newVertexRun = () => {
                // set expected buffer offsets (relative to ITOP)
                vertexRunCount = 3 * view.getUint32(packetsIdx + 0x00, true);
                vertexRunData = new Float32Array(vertexRunCount * VERTEX_STRIDE);
                expectedColorOffs = view.getUint32(packetsIdx + 0x04, true);
                expectedTexCoordOffs = expectedColorOffs + vertexRunCount;
                expectedPositionOffs = expectedTexCoordOffs + vertexRunCount;
                expectedExtraOffs = expectedPositionOffs + vertexRunCount;

                currentEffect = view.getUint32(packetsIdx + 0x10, true);
                assert(currentEffect !== LevelEffectType.UNUSED);
            };

            while (packetsIdx < packetsEnd) {
                const imm = view.getUint16(packetsIdx + 0x00, true);
                const qwc = view.getUint8(packetsIdx + 0x02);
                const cmd = view.getUint8(packetsIdx + 0x03) & 0x7F;

                const atITOP = (imm & 0x8000) !== 0;
                const unpackDest = imm & 0x3FFF;
                packetsIdx += 0x04;

                if ((cmd & 0x60) === 0x60) { // UNPACK
                    const format = (cmd & 0x0F);

                    // TODO: figure out this constant-offset data, used to mask some flag?
                    if (!atITOP) {
                        assert(unpackDest === 4);
                        packetsIdx += qwc * getVifUnpackFormatByteSize(format);
                        continue;
                    }

                    if (format === VifUnpackFormat.V4_32) {
                        assert(vertexRunData === null && unpackDest === 0);

                        newVertexRun();
                        packetsIdx += qwc * getVifUnpackFormatByteSize(format);

                    } else if (format === VifUnpackFormat.V2_16) {
                        let runOffs = 7;
                        assert(currentShader === ShaderMode.COLOR_AND_TEXTURE);
                        if (unpackDest !== expectedTexCoordOffs) {
                            assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.UV_LERP);
                            runOffs = 9;
                        }
                        for (let j = 0; j < qwc; j++) {
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = view.getUint16(packetsIdx + 0x00, true) / 0x1000;
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = view.getUint16(packetsIdx + 0x02, true) / 0x1000;
                            packetsIdx += 0x04;
                        }
                    } else if (format === VifUnpackFormat.V3_32) {
                        let runOffs = 0;
                        if (unpackDest === expectedTexCoordOffs) {
                            // actually normals
                            assert(currentShader === ShaderMode.COLOR_AND_NORMALS);
                            runOffs = 9;
                        } else if (unpackDest !== expectedPositionOffs) {
                            assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.POSITIONS);
                            runOffs = 9;
                        }
                        for (let j = 0; j < qwc; j++) {
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 2] = view.getFloat32(packetsIdx + 0x08, true);
                            packetsIdx += 0x0C;
                        }

                    } else if (format === VifUnpackFormat.V4_8) {
                        let runOffs = 3;
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
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = diffuseColorR;
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = diffuseColorG;
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 2] = diffuseColorB;
                            vertexRunData![j * VERTEX_STRIDE + runOffs + 3] = diffuseColorA;
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
                            currentGSConfiguration.depthWrite = (data1 & 1) === 0;
                        } else {
                            console.warn(`Unknown GS Register ${hexzero(addr, 2)}`);
                            throw "whoops";
                        }

                        packetsIdx += 0x10;
                    }

                    // Make sure that we actually created something here.
                    assertExists(currentTextureIndex !== null);
                } else if (cmd === 0x17) { // MSCNT
                    // Run an HLE form of the VU1 program.
                    assert(vertexRunData !== null);

                    // Go through and build an index buffer for it.
                    const indexRunData = new Uint16Array(vertexRunCount);
                    for (let j = 0; j < vertexRunCount; j++) {
                        indexRunData[j] = j;
                    }

                    const textureIndex = currentTextureIndex;
                    const gsConfiguration: GSConfiguration = Object.assign({}, currentGSConfiguration);
                    modelVertexRuns.push({ vertexRunData: vertexRunData!, vertexRunCount, indexRunData, textureIndex: textureIndex!, gsConfiguration, effectType: currentEffect, shader: currentShader });

                    vertexRunCount = 0;
                    vertexRunData = null;
                    // Texture does not get reset; it carries over between runs.
                } else if (cmd === 0x14) { // MSCAL
                    // save which vu program is running
                    currentShader = imm >>> 1;
                    assert(currentShader < 2)
                } else if (cmd === 0x00 || cmd === 0x10 || cmd === 0x11) {
                    // NOP and FLUSH commands can be ignored
                } else if (cmd === 0x01) { // CYCLE
                    assert(imm == 0x0101); // equal CL and WL, can ignore
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

            // Coalesce all the model parts into one model.
            let totalVertexCount = 0;
            let totalIndexCount = 0;
            for (let j = 0; j < modelVertexRuns.length; j++) {
                totalVertexCount += modelVertexRuns[j].vertexRunCount;
                totalIndexCount += modelVertexRuns[j].indexRunData.length;
            }
            assert(totalVertexCount < 0xFFFF);

            const drawCalls: DrawCall[] = [];

            let vertexDataDst = 0;
            let indexOffset = 0;
            let indexDst = 0;
            const vertexData = new Float32Array(totalVertexCount * VERTEX_STRIDE);
            const indexData = new Uint16Array(totalIndexCount);
            let currentDrawCall: DrawCall | null = null;

            for (let j = 0; j < modelVertexRuns.length; j++) {
                const vertexRun = modelVertexRuns[j];
                const vertexRunData = vertexRun.vertexRunData;

                // Check if we can coalesce this into the existing model part.
                let modelPartsCompatible = currentDrawCall !== null
                    && vertexRun.textureIndex === currentDrawCall!.textureIndex
                    && vertexRun.effectType === currentDrawCall.effectType
                    && vertexRun.shader === currentDrawCall.shader
                    && gsConfigurationEqual(vertexRun.gsConfiguration, currentDrawCall!.gsConfiguration);

                if (!modelPartsCompatible) {
                    currentDrawCall = {
                        indexOffset: indexDst, indexCount: 0, textureIndex: vertexRun.textureIndex,
                        gsConfiguration: vertexRun.gsConfiguration, effectType: vertexRun.effectType, shader: vertexRun.shader
                    };
                    drawCalls.push(currentDrawCall);
                }

                for (let k = 0; k < vertexRunData.length; k += VERTEX_STRIDE) {
                    // Position.
                    vertexData[vertexDataDst++] = vertexRunData[k + 0];
                    vertexData[vertexDataDst++] = vertexRunData[k + 1];
                    vertexData[vertexDataDst++] = vertexRunData[k + 2];
                    // Color.
                    vertexData[vertexDataDst++] = vertexRunData[k + 3]
                    vertexData[vertexDataDst++] = vertexRunData[k + 4];
                    vertexData[vertexDataDst++] = vertexRunData[k + 5];
                    vertexData[vertexDataDst++] = vertexRunData[k + 6];
                    // Texture coord.
                    vertexData[vertexDataDst++] = vertexRunData[k + 7];
                    vertexData[vertexDataDst++] = vertexRunData[k + 8];
                    // Extra data
                    vertexData[vertexDataDst++] = vertexRunData[k + 9]
                    vertexData[vertexDataDst++] = vertexRunData[k + 10];
                    vertexData[vertexDataDst++] = vertexRunData[k + 11];
                    vertexData[vertexDataDst++] = vertexRunData[k + 12];
                }

                const indexRunData = vertexRun.indexRunData;
                for (let k = 0; k < indexRunData.length; k++) {
                    indexData[indexDst++] = indexOffset + indexRunData[k];
                    currentDrawCall!.indexCount++;
                }

                indexOffset += vertexRun.vertexRunCount;
            }

            currPart!.models.push({ vertexData, indexData, drawCalls, bbox });

        } else
            console.warn("unfamiliar map section type", sectionType, "length", hexzero(sectionLength, 4))

        offs += sectionLength;
    }

    return parts;
}
