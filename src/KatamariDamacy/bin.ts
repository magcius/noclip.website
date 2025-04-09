
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, hexzero, assertExists, readString, nArray } from "../util.js";
import { Color, colorNewFromRGBA, colorFromRGBA, colorEqual } from "../Color.js";
import { AABB } from "../Geometry.js";
import { mat4, quat, vec3 } from "gl-matrix";
import { GSRegister, GSRegisterTEX0, GSMemoryMap, getGSRegisterTEX0, gsMemoryMapUploadImage, gsMemoryMapReadImagePSMT4_PSMCT32, gsMemoryMapReadImagePSMT8_PSMCT32, GSPixelStorageFormat, GSTextureColorComponent, GSTextureFunction, GSCLUTPixelStorageFormat, psmToString, gsMemoryMapNew } from "../Common/PS2/GS.js";
import { Endianness } from "../endian.js";
import { MathConstants, computeModelMatrixSRT } from "../MathHelpers.js";

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
    S_32  = (VifUnpackVN.S  << 2 | VifUnpackVL.VL_32),
    S_16  = (VifUnpackVN.S  << 2 | VifUnpackVL.VL_16),
    S_8   = (VifUnpackVN.S  << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8  = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8  = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8  = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5  = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
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

export interface BINTexture {
    tex0_data0: number;
    tex0_data1: number;
    pixels: (Uint8Array | 'framebuffer')[];
    name: string;
    width: number;
    height: number;
}

export interface BINModelPart {
    diffuseColor: Color;
    indexOffset: number;
    indexCount: number;
    textureIndex: number | null;
    gsConfiguration: GSConfiguration;
    lit: boolean;
}

export interface BINModel {
    bbox: AABB;
    vertexData: Float32Array;
    indexData: Uint16Array;
    modelParts: BINModelPart[];
    animationIndex: number;
}

export interface BINModelSector {
    models: BINModel[];
    textures: BINTexture[];
}

export interface SkinningMatrix {
    index: number;
    weight: number;
}

export interface ObjectModel {
    id: number;
    sector: BINModelSector;
    transforms: PartTransform[];
    bbox: AABB;
    skinning: SkinningMatrix[][];
}

export interface LevelModelBIN {
    sectors: BINModelSector[];
    collision: CollisionList[][];
}

export interface GSConfiguration {
    tex0_1_data0: number;
    tex0_1_data1: number;
    tex1_1_data0: number;
    tex1_1_data1: number;
    clamp_1_data0: number;
    clamp_1_data1: number;
    alpha_1_data0: number;
    alpha_1_data1: number;
    test_1_data0: number;
    test_1_data1: number;
}

function gsConfigurationEqual(a: GSConfiguration, b: GSConfiguration) {
    if (a.tex0_1_data0 !== b.tex0_1_data0 || a.tex0_1_data1 !== b.tex0_1_data1) return false;
    if (a.tex1_1_data0 !== b.tex1_1_data0 || a.tex1_1_data1 !== b.tex1_1_data1) return false;
    if (a.clamp_1_data0 !== b.clamp_1_data0 || a.clamp_1_data1 !== b.clamp_1_data1) return false;
    if (a.alpha_1_data0 !== b.alpha_1_data0 || a.alpha_1_data1 !== b.alpha_1_data1) return false;
    if (a.test_1_data0 !== b.test_1_data0 || a.test_1_data1 !== b.test_1_data1) return false;
    return true;
}

function parseDIRECT(map: GSMemoryMap, buffer: ArrayBufferSlice): number {
    const view = buffer.createDataView();

    let texDataIdx = 0;
    let lastPacket = false;
    // the buffer holds a series of packets to send via GIF
    // the first quadword of each packet is a DMAtag followed by an UNPACK VIFcode command
    // the ID field of the DMAtag determines whether we should continue

    while (!lastPacket) {
        const id = view.getUint8(texDataIdx + 0x03) >>> 4;
        if (id === 1) // cnt
            lastPacket = false;
        else if (id === 6) // ret
            lastPacket = true;
        else
            throw `unknown DMAtag ID ${id}`;
        const tag2 = view.getUint8(texDataIdx + 0x0F);
        assert(tag2 === 0x50, "TAG"); // DIRECT
        const texDataSize = view.getUint16(texDataIdx + 0x0C, true) * 0x10;
        texDataIdx += 0x10;
        const texDataEnd = texDataIdx + texDataSize;

        let dpsm = -1;
        let dbw = -1;
        let dbp = -1;
        let rrw = -1;
        let rrh = -1;
        let dsax = -1;
        let dsay = -1;

        while (texDataIdx < texDataEnd) {
            // These should all be GIFtags here.
            const w0 = view.getUint32(texDataIdx + 0x00, true);
            const w1 = view.getUint32(texDataIdx + 0x04, true);
            const w2 = view.getUint32(texDataIdx + 0x08, true);
            const w3 = view.getUint32(texDataIdx + 0x0C, true);
            texDataIdx += 0x10;

            // NLOOP is the repeat count.
            const nloop = w0 & 0x7FFF;
            if (nloop === 0)
                continue;

            // FLG determines the format for the upcoming data.
            const flg = (w1 >>> 26) & 0x03;
            if (flg === 0x00) {
                // DIRECT. We should have one A+D register set.

                const nreg = (w1 >>> 28) & 0x07;
                assert(nreg === 0x01, "nreg");
                const reg = (w2 & 0x000F);
                assert(reg === 0x0E, "reg");

                for (let j = 0; j < nloop; j++) {
                    const data0 = view.getUint32(texDataIdx + 0x00, true);
                    const data1 = view.getUint32(texDataIdx + 0x04, true);
                    const addr = view.getUint8(texDataIdx + 0x08) & 0x7F;

                    // addr contains the register to set. Unpack these registers.
                    if (addr === 0x50) {
                        // BITBLTBUF
                        dbp = (data1 >>> 0) & 0x3FFF;
                        dbw = (data1 >>> 16) & 0x3F;
                        dpsm = (data1 >>> 24) & 0x3F;
                        // TODO(jstpierre): Support upload modes other than PSCMT32
                        assert(dpsm === GSPixelStorageFormat.PSMCT32, "dpsm");
                    } else if (addr === 0x51) {
                        // TRXPOS
                        dsax = (data1 >>> 0) & 0x7FF;
                        dsay = (data1 >>> 16) & 0x7FF;
                    } else if (addr === 0x52) {
                        // TRXREG
                        rrw = (data0 >>> 0) & 0xFFF;
                        rrh = (data1 >>> 0) & 0xFFF;
                    }

                    texDataIdx += 0x10;
                }
            } else if (flg === 0x02) {
                // IMAGE. Followed by data to upload.
                gsMemoryMapUploadImage(map, dpsm, dbp, dbw, dsax, dsay, rrw, rrh, buffer.subarray(texDataIdx, nloop * 0x10));
                texDataIdx += nloop * 0x10;
            }
        }
    }

    return texDataIdx;
}

function decodeTexture(gsMemoryMap: GSMemoryMap[], tex0_data0: number, tex0_data1: number, namePrefix: string = ''): BINTexture {
    const tex0: GSRegisterTEX0 = getGSRegisterTEX0(tex0_data0, tex0_data1);

    const name = `${namePrefix}/${hexzero(tex0.tbp0, 4)}/${hexzero(tex0.cbp, 4)}`;

    const width = 1 << tex0.tw;
    const height = 1 << tex0.th;

    // TODO(jstpierre): Handle other formats
    // assert(psm === GSPixelStorageFormat.PSMT4, `Unknown PSM ${psm}`);
    assert(tex0.cpsm === GSCLUTPixelStorageFormat.PSMCT32, `Unknown CPSM ${tex0.cpsm}`);

    // TODO(jstpierre): Read the TEXALPHA register.
    const alphaReg = tex0.tcc === GSTextureColorComponent.RGBA ? -1 : 0x80;

    const pixels: (Uint8Array | 'framebuffer')[] = [];
    for (let i = 0; i < gsMemoryMap.length; i++) {
        if (tex0.tbp0 === 0x0000 && tex0.cbp === 0x0000) {
            // Framebuffer texture; dynamic.
            pixels.push('framebuffer');
        } else {
            const p = new Uint8Array(width * height * 4);
            if (tex0.psm === GSPixelStorageFormat.PSMT4)
                gsMemoryMapReadImagePSMT4_PSMCT32(p, gsMemoryMap[i], tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, alphaReg);
            else if (tex0.psm === GSPixelStorageFormat.PSMT8)
                gsMemoryMapReadImagePSMT8_PSMCT32(p, gsMemoryMap[i], tex0.tbp0, tex0.tbw, width, height, tex0.cbp, alphaReg);
            else
                console.warn(`Unsupported PSM ${psmToString(tex0.psm)} in texture ${name}`);
            pixels.push(p);
        }
    }

    return { name, width, height, pixels, tex0_data0, tex0_data1 };
}

export function parseStageTextureBIN(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap): void {
    const view = buffer.createDataView();

    const numSectors = view.getUint32(0x00, true);
    let prevEnd = view.getUint32(0x04, true);;
    for (let i = 0; i < numSectors; i++) {
        const sectorOffs = view.getUint32(0x04 + 0x04 * i, true);
        assert(prevEnd === sectorOffs);
        prevEnd = sectorOffs + parseDIRECT(gsMemoryMap, buffer.slice(sectorOffs));
    }
    assert(prevEnd === buffer.byteLength);
}

function parseModelSector(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap[], namePrefix: string, sectorOffs: number, initialAlphaBlend = 0x44): BINModelSector | null {
    const view = buffer.createDataView();

    const modelObjCount = view.getUint16(sectorOffs + 0x00, true);
    const modelObjType = view.getUint16(sectorOffs + 0x02, true);

    const textures: BINTexture[] = [];
    function findOrDecodeTexture(tex0_data0: number, tex0_data1: number): number {
        let texture = textures.find((texture) => {
            return texture.tex0_data0 === tex0_data0 && texture.tex0_data1 === tex0_data1;
        });
        if (texture === undefined) {
            texture = decodeTexture(gsMemoryMap, tex0_data0, tex0_data1, namePrefix);
            textures.push(texture);
        }
        return textures.indexOf(texture);
    }

    // 4 positions, 3 normals, 2 UV coordinates.
    const WORKING_VERTEX_STRIDE = 4+3+2;
    // 3 positions, 1 index, 3 normals, 2 UV coordinates.
    const VERTEX_STRIDE = 4+3+2;

    let modelObjTableIdx = sectorOffs + 0x04;
    const models: BINModel[] = [];
    for (let i = 0; i < modelObjCount; i++) {
        const objOffs = sectorOffs + view.getUint32(modelObjTableIdx + 0x00, true);

        const minX = view.getFloat32(objOffs + 0x00, true);
        const minY = view.getFloat32(objOffs + 0x04, true);
        const minZ = view.getFloat32(objOffs + 0x08, true);
        const modelQuadwordCount = view.getUint16(objOffs + 0x0C, true);
        const maxX = view.getFloat32(objOffs + 0x10, true);
        const maxY = view.getFloat32(objOffs + 0x14, true);
        const maxZ = view.getFloat32(objOffs + 0x18, true);
        const animationIndex = view.getUint8(objOffs + 0x1C);
        const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

        const packetsBegin = objOffs + 0x20;
        const packetsSize = view.getUint16(objOffs + 0x0C, true) * 0x10;
        const packetsEnd = packetsBegin + packetsSize;

        interface BINModelRun {
            vertexRunData: Float32Array;
            vertexRunCount: number;
            indexRunData: Uint16Array;
            vertexRunColor: Color;
            textureIndex: number | null;
            gsConfiguration: GSConfiguration;
            lit: boolean;
        }
        const modelVertexRuns: BINModelRun[] = [];

        // Parse VIF packets.
        let packetsIdx = packetsBegin;

        // State of current "vertex run".
        let vertexRunFlags0 = 0;
        let vertexRunFlags1 = 0;
        let vertexRunFlags2 = 0;
        let vertexRunCount = 0;
        let vertexRunData: Float32Array | null = null;
        let vertexRunColor = colorNewFromRGBA(1, 1, 1, 1);
        let currentTextureIndex: number | null = null;
        let currentGSConfiguration: GSConfiguration = {
            tex0_1_data0: -1, tex0_1_data1: -1,
            tex1_1_data0: -1, tex1_1_data1: -1,
            clamp_1_data0: -1, clamp_1_data1: -1,
            alpha_1_data0: initialAlphaBlend, alpha_1_data1: -1,
            test_1_data0: 0x5000F, test_1_data1: -1,
        };

        const expectedPositionsOffs = 0x8000;
        let expectedTexCoordOffs = -1;
        let expectedNormalsOffs = -1;
        let expectedDiffuseColorOffs = -1;
        let skipVertices = false;
        let lit = false;
        let vertexColored = false;

        const newVertexRun = () => {
            // Parse out the header.
            vertexRunFlags0 = view.getUint32(packetsIdx + 0x00, true);
            vertexRunFlags1 = view.getUint32(packetsIdx + 0x04, true);
            vertexRunFlags2 = view.getUint32(packetsIdx + 0x08, true);
            vertexRunCount = vertexRunFlags0 & 0x000000FF;
            vertexRunData = new Float32Array(vertexRunCount * WORKING_VERTEX_STRIDE);
            skipVertices = false;

            lit = (vertexRunFlags1 & 2) === 0;
            vertexColored = (vertexRunFlags1 & 1) !== 0;
            if (vertexColored)
                assert(!lit);

            // Seems to be some sort of format code.
            if (vertexRunFlags2 === 0x0412) {
                expectedTexCoordOffs = expectedPositionsOffs + 1 + vertexRunCount * 1;
                expectedNormalsOffs = expectedPositionsOffs + 1 + vertexRunCount * 2;
                expectedDiffuseColorOffs = expectedPositionsOffs + 1 + vertexRunCount * 3;
            } else if (vertexRunFlags2 === 0x0041) {
                // TODO(jstpierre): Mousetrap uses this to define a large... trigger box? Not sure why.
                // Killing it for now.
                expectedTexCoordOffs = -1;
                expectedNormalsOffs = expectedPositionsOffs + 1 + vertexRunCount * 1;
                expectedDiffuseColorOffs = expectedPositionsOffs + 1 + vertexRunCount * 2;
                skipVertices = true;
            } else {
                console.warn(`Unknown vertex run flags format code ${vertexRunFlags2}`);
                throw "whoops";
            }
        };

        while (packetsIdx < packetsEnd) {
            const imm = view.getUint16(packetsIdx + 0x00, true);
            const qwd = view.getUint8(packetsIdx + 0x02);
            const cmd = view.getUint8(packetsIdx + 0x03) & 0x7F;
            packetsIdx += 0x04;

            // To be clear how things *should* work, these VIF commands are commands to
            // the interface between the CPU and the actual VU1 device.
            //
            //  - UNPACK does a DMA memory write to VU1Mem at the specified address
            //  - MSCNT runs the game's preprogrammed VU1 with the memory.
            //
            // Since we don't have an LLE VU1 emulator, we use a high-level emulation
            // of the Katamari Damacy program VU1 here.
            //
            // Katamari will always issue, in-order, UNPACK for vertex positions + 16-byte header,
            // UNPACK for vertex texcoords, then UNPACK for vertex normals, then MSCNT to run the
            // VU1 program. The address of the destination data is relative to 0x8000.
            if ((cmd & 0x60) === 0x60) { // UNPACK
                const format = (cmd & 0x0F);

                const isVertexData = (imm >= expectedPositionsOffs);
                const isPositions = (imm === expectedPositionsOffs);

                // If this is not vertex data (not writing to address 0x8000 or higher), then we skip
                // for now. Perhaps we'll have a use for this in the future.
                if (!isVertexData) {
                    packetsIdx += qwd * getVifUnpackFormatByteSize(format);
                    continue;
                }

                if (format === VifUnpackFormat.V4_32) {
                    // V4-32 is either positions or diffuse color.
                    if (isPositions) {
                        assert(vertexRunData === null);

                        newVertexRun();
                        packetsIdx += 0x10;

                        for (let j = 0; j < qwd - 1; j++) {
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 0] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 1] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 2] = view.getFloat32(packetsIdx + 0x08, true);
                            // W is special. It's a bunch of flag bits for misc. use by the VU1 program.
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 3] = view.getUint32(packetsIdx + 0x0C, true);
                            packetsIdx += 0x10;
                        }
                    } else {
                        // It should be diffuse color.
                        assert(imm === expectedDiffuseColorOffs && lit);
                        assert(qwd === 0x01);

                        const diffuseColorR = view.getFloat32(packetsIdx + 0x00, true) / 128;
                        const diffuseColorG = view.getFloat32(packetsIdx + 0x04, true) / 128;
                        const diffuseColorB = view.getFloat32(packetsIdx + 0x08, true) / 128;
                        const diffuseColorA = view.getFloat32(packetsIdx + 0x0C, true) / 128;
                        colorFromRGBA(vertexRunColor, diffuseColorR, diffuseColorG, diffuseColorB, diffuseColorA);
                        packetsIdx += 0x10;
                    }
                } else if (format === VifUnpackFormat.V2_32) { // V2-32
                    // It should be texture coordinates.
                    assert(imm === expectedTexCoordOffs);

                    for (let j = 0; j < qwd; j++) {
                        vertexRunData![j * WORKING_VERTEX_STRIDE + 8] = view.getFloat32(packetsIdx + 0x04, true);
                        vertexRunData![j * WORKING_VERTEX_STRIDE + 7] = view.getFloat32(packetsIdx + 0x00, true);
                        packetsIdx += 0x08;
                    }
                } else if (format === VifUnpackFormat.V3_32) { // V3-32
                    // It might be either positions or vertex normals.
                    if (isPositions) {
                        assert(vertexRunData === null);

                        newVertexRun();
                        packetsIdx += 0x0C;

                        for (let j = 0; j < qwd - 1; j++) {
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 0] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 1] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 2] = view.getFloat32(packetsIdx + 0x08, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 3] = 0;
                            packetsIdx += 0x0C;
                        }
                    } else {
                        // If it's not positions, it should be vertex normals.
                        assert(imm === expectedNormalsOffs && lit);

                        for (let j = 0; j < qwd; j++) {
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 4] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 5] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 6] = view.getFloat32(packetsIdx + 0x08, true);
                            packetsIdx += 0x0C;
                        }
                    }
                } else if (format === VifUnpackFormat.V4_8) {
                    // unlit color
                    assert((imm & (~0x4000)) === expectedNormalsOffs && !lit);
                    assert(qwd === 0x01 || vertexColored);

                    for (let j = 0; j < qwd; j++) {
                        const diffuseColorR = view.getUint8(packetsIdx + 0x00) / 0x80;
                        const diffuseColorG = view.getUint8(packetsIdx + 0x01) / 0x80;
                        const diffuseColorB = view.getUint8(packetsIdx + 0x02) / 0x80;
                        const diffuseColorA = view.getUint8(packetsIdx + 0x03) / 0x80;

                        const signExtend = (imm & 0x4000) === 0;
                        if (signExtend)
                            assert(diffuseColorR < 1 && diffuseColorG < 1 && diffuseColorB < 1 && diffuseColorA < 1)
                        if (vertexColored) {
                            // the format supports actual vertex colors, but doesn't really seem to be used
                            assert(diffuseColorR === 1 && diffuseColorB === 1 && diffuseColorG === 1 && diffuseColorA > .95);
                            colorFromRGBA(vertexRunColor, 1, 1, 1, 1);
                        } else
                            colorFromRGBA(vertexRunColor, diffuseColorR, diffuseColorG, diffuseColorB, diffuseColorA);
                        packetsIdx += 0x04;
                    }
                } else {
                    console.error(`Unsupported format ${hexzero(format, 2)}`);
                    throw "whoops";
                }
            } else if ((cmd & 0x7F) === 0x50) { // DIRECT
                // We need to be at the start of a vertex run.
                assert(vertexRunData === null);

                // This transfers a GIFtag through GIF.

                // Pull out the TEX0 register, which provides format, width and height.
                // GIFtag is 128 bits long, so pull out our four words.

                // The low 64 bytes (w0 & w1) contain fixed fields, the high 64 bits are
                // a meta-format describing the data to come, but Katamari uses a very
                // specific format.

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
                    if (addr === GSRegister.PRIM) {
                        // TODO(jstpierre): PRIM is sometimes set in here. A bug in our parsing logic?
                    } else if (addr === GSRegister.TEX0_1) {
                        // TEX0_1 contains the texture configuration.
                        currentTextureIndex = findOrDecodeTexture(data0, data1);
                        currentGSConfiguration.tex0_1_data0 = data0;
                        currentGSConfiguration.tex0_1_data1 = data1;
                    } else if (addr === GSRegister.TEX1_1) {
                        currentGSConfiguration.tex1_1_data0 = data0;
                        currentGSConfiguration.tex1_1_data1 = data1;
                    } else if (addr === GSRegister.TEX2_1) {
                        // We don't need this.
                    } else if (addr === GSRegister.CLAMP_1) {
                        currentGSConfiguration.clamp_1_data0 = data0;
                        currentGSConfiguration.clamp_1_data1 = data1;
                    } else if (addr === GSRegister.ALPHA_1) {
                        currentGSConfiguration.alpha_1_data0 = data0;
                        currentGSConfiguration.alpha_1_data1 = data1;
                    } else if (addr === GSRegister.TEST_1) {
                        currentGSConfiguration.test_1_data0 = data0;
                        currentGSConfiguration.test_1_data1 = data1;
                    } else {
                        console.warn(`Unknown GS Register ${hexzero(addr, 2)}`);
                        throw "whoops";
                    }
                    // TODO(jstpierre): Other register settings.

                    packetsIdx += 0x10;
                }

                // Make sure that we actually created something here.
                assertExists(currentTextureIndex !== null);
            } else if (cmd === 0x17) { // MSCNT
                // Run an HLE form of the VU1 program.
                assert(vertexRunData !== null);

                if (!skipVertices) {
                    const isStrip = (vertexRunFlags1 & 0x000000F0) === 0;

                    // Go through and build an index buffer for it.
                    const indexData = new Uint16Array(isStrip ? vertexRunCount * 3 - 2 : vertexRunCount);
                    let indexDataIdx = 0;

                    for (let j = 0; j < vertexRunCount; j++) {
                        const w = vertexRunData![j * WORKING_VERTEX_STRIDE + 3];

                        if (isStrip) {
                            if (j < 2)
                                continue;
                            if ((w & 0xC000) !== 0x0000)
                                continue;
                            if ((j % 2) === 0) {
                                indexData[indexDataIdx++] = j - 2;
                                indexData[indexDataIdx++] = j - 1;
                                indexData[indexDataIdx++] = j;
                            } else {
                                indexData[indexDataIdx++] = j - 1;
                                indexData[indexDataIdx++] = j - 2;
                                indexData[indexDataIdx++] = j;
                            }
                        } else {
                            indexData[indexDataIdx++] = j;
                        }
                    }

                    const indexRunData = indexData.slice(0, indexDataIdx);
                    const textureIndex = currentTextureIndex;
                    const gsConfiguration: GSConfiguration = Object.assign({}, currentGSConfiguration);
                    modelVertexRuns.push({ vertexRunData: vertexRunData!, vertexRunCount, indexRunData, vertexRunColor: vertexRunColor!, textureIndex: textureIndex!, gsConfiguration, lit });
                }

                vertexRunFlags0 = 0;
                vertexRunFlags1 = 0;
                vertexRunFlags2 = 0;
                vertexRunCount = 0;
                vertexRunData = null;
                // Texture does not get reset; it carries over between runs.
            } else if (cmd === 0x00) { // NOP
                // Don't need to do anything.
            } else if (cmd === 0x10) { // FLUSHE
                // Don't need to do anything.
            } else if (cmd === 0x11) { // FLUSH
                // Don't need to do anything.
            } else {
                console.error(`Unknown VIF command ${hexzero(cmd, 2)}`);
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

        const modelParts: BINModelPart[] = [];

        let vertexDataDst = 0;
        let indexOffset = 0;
        let indexDst = 0;
        const vertexData = new Float32Array(totalVertexCount * VERTEX_STRIDE);
        const indexData = new Uint16Array(totalIndexCount);
        let currentModelPart: BINModelPart | null = null;

        for (let j = 0; j < modelVertexRuns.length; j++) {
            const vertexRun = modelVertexRuns[j];
            const vertexRunData = vertexRun.vertexRunData;

            // Check if we can coalesce this into the existing model part.
            let modelPartsCompatible = currentModelPart !== null
                && colorEqual(vertexRun.vertexRunColor, currentModelPart!.diffuseColor)
                && vertexRun.textureIndex === currentModelPart!.textureIndex
                && gsConfigurationEqual(vertexRun.gsConfiguration, currentModelPart!.gsConfiguration)
                && vertexRun.lit === currentModelPart.lit;

            // TODO(jstpierre): Texture settings
            if (!modelPartsCompatible) {
                currentModelPart = { diffuseColor: vertexRun.vertexRunColor, indexOffset: indexDst, indexCount: 0, textureIndex: vertexRun.textureIndex, gsConfiguration: vertexRun.gsConfiguration, lit: vertexRun.lit };
                modelParts.push(currentModelPart);
            }

            for (let k = 0; k < vertexRunData.length; k += WORKING_VERTEX_STRIDE) {
                // Position.
                vertexData[vertexDataDst++] = vertexRunData[k + 0];
                vertexData[vertexDataDst++] = vertexRunData[k + 1];
                vertexData[vertexDataDst++] = vertexRunData[k + 2];
                // take lower bits to use as skinning matrix index
                vertexData[vertexDataDst++] = (vertexRunData[k + 3] >>> 2) & 0xFF;
                // Normal.
                vertexData[vertexDataDst++] = vertexRunData[k + 4];
                vertexData[vertexDataDst++] = vertexRunData[k + 5];
                vertexData[vertexDataDst++] = vertexRunData[k + 6];
                // Texture coord.
                vertexData[vertexDataDst++] = vertexRunData[k + 7];
                vertexData[vertexDataDst++] = vertexRunData[k + 8];
            }

            const indexRunData = vertexRun.indexRunData;
            for (let k = 0; k < indexRunData.length; k++) {
                indexData[indexDst++] = indexOffset + indexRunData[k];
                currentModelPart!.indexCount++;
            }

            indexOffset += vertexRun.vertexRunCount;
        }

        models.push({ bbox, vertexData, indexData, modelParts, animationIndex });

        modelObjTableIdx += 0x04;
    }

    return { models, textures };
}

function sectorIsNIL(buffer: ArrayBufferSlice, sectorOffs: number): boolean {
    return readString(buffer, sectorOffs, 0x04) === 'NIL ';
}

export function parseLevelModelBIN(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap, isTutorial: boolean, namePrefix: string = ''): LevelModelBIN {
    const view = buffer.createDataView();

    const numSectors = view.getUint32(0x00, true);
    assert(numSectors === 0x08);

    const sectors: BINModelSector[] = [];
    const collision: CollisionList[][] = [];

    // There appear to be up to four graphical sectors.
    // 1. Main Level Graphics
    // 2. Skybox (unused in World, built-into Main Level)
    // 3. Transparent Objects (used only in House for Windows)
    // 4. Partially-Transparent Objects (used only in House for the blanket when you get near)
    let sectorTableIdx = 0x04;
    for (let i = 0; i < 4; i++) {
        const sectorOffs = view.getUint32(sectorTableIdx + 0x00, true);
        sectorTableIdx += 0x04;
        if (sectorIsNIL(buffer, sectorOffs))
            continue;
        const blend = isTutorial && i === 1 ? 0x48 : 0x44;
        const sectorModel = assertExists(parseModelSector(buffer, [gsMemoryMap], namePrefix, sectorOffs, blend));
        assert(sectors.length === i); // no skipped sectors
        sectors.push(sectorModel);
    }

    for (let i = 0; i < 4; i++) {
        const sectorOffs = view.getUint32(sectorTableIdx + 0x00, true);
        sectorTableIdx += 0x04;
        if (sectorIsNIL(buffer, sectorOffs))
            collision.push([]);
        else
            collision.push(parseCollisionLists(buffer, sectorOffs));
    }

    return { sectors, collision };
}

export interface LevelParameters {
    lightingIndex: number;
    startArea: number;
    stageAreaIndex: number;
    missionSetupFiles: string[];
}

export function parseLevelParameters(index: number, parameters: ArrayBufferSlice, files: ArrayBufferSlice): LevelParameters {
    const addressOffset = 0x1BE1A0; // start address in RAM
    const levelTable = 0x1BEF80; // ram address of table
    const paramView = parameters.createDataView();

    const missionSetupFiles: string[] = [];
    const fileView = files.createDataView();
    for (let i = 4 * index + 1; i < 4 * index + 5; i++)
        missionSetupFiles.push(fileView.getUint32(0x10 * i + 0x08, true).toString(16));

    if (index > 31 && index < 39)
        index = 31; // TODO: figure out what's going on with versus stages

    const levelPointer = paramView.getUint32(levelTable + 4 * index - addressOffset, true) - addressOffset;

    const lightingIndex = paramView.getUint8(levelPointer + 0x00);
    const startArea = paramView.getUint8(levelPointer + 0x01);
    let stageAreaIndex = paramView.getUint16(levelPointer + 0x04, true);
    if (index === 41) // this stage seems to want the crazy test map
        stageAreaIndex++;

    return { lightingIndex, startArea, stageAreaIndex, missionSetupFiles };
}

export interface CollisionList {
    bbox: AABB;
    groups: CollisionTriangleGroup[];
}

interface CollisionTriangleGroup {
    vertices: Float32Array;
    isTriStrip: boolean;
}

function parseCollisionLists(data: ArrayBufferSlice, start: number): CollisionList[] {
    const lists: CollisionList[] = [];

    const view = data.createDataView();
    const collisionCount = view.getUint8(start);
    const aabbOffset = start + view.getUint32(start + 4, true);
    const aabbCount = view.getUint16(aabbOffset, true) & 0x3FF;
    assert(view.getUint8(aabbOffset + 0x07) === 0x68); // unpack v3-32
    assert(aabbCount === collisionCount);

    for (let i = 0; i < collisionCount; i++) {
        const bbox = new AABB(
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x00, true),
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x04, true),
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x08, true),
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x0C, true),
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x10, true),
            view.getFloat32(aabbOffset + 8 + 0x18 * i + 0x14, true),
        );

        let vertexOffset = start + view.getUint32(start + 8 + 4 * i, true);
        const groups: CollisionTriangleGroup[] = [];
        while (true) {
            assert(view.getUint8(vertexOffset + 0x07) === 0x6c); // unpack v4-32, though not sure this is actually executed as vifcode
            const lowByte = view.getUint8(vertexOffset);
            const isTriStrip = (lowByte & 0x80) !== 0;
            const vertexCount = isTriStrip ? ((lowByte & 0x7F) + 2) : (lowByte & 0x7F) * 3;
            const vertices = data.createTypedArray(Float32Array, vertexOffset + 8, 4 * vertexCount, Endianness.LITTLE_ENDIAN);
            groups.push({vertices, isTriStrip});

            vertexOffset += 0x10*vertexCount + 0x0C;
            const vifcode = view.getUint8(vertexOffset - 1);
            if (vifcode >= 0x80) {
                assert(vifcode === 0x97); //MSCNT with interrupt
                break;
            }
        }
        lists.push({ bbox, groups });
    }
    return lists;
}

interface RandomIDOption {
    id: number;
    maxUses: number;
    chance: number;

    usesLeft: number;
}

interface RandomGroup {
    objectCount: number;
    useCount: number;
    options: RandomIDOption[];
}

export function initRandomGroups(index: number, data: ArrayBufferSlice): RandomGroup[] {
    const addressOffset = 0x215980; // start address in RAM
    const levelTable = 0x216188; // ram address of table

    const view = data.createDataView();
    let nextGroup = view.getUint32(levelTable - addressOffset + 4 * index, true);
    if (nextGroup === 0)
        return [];

    const groups: RandomGroup[] = [];
    while (true) {
        const groupStart = view.getUint32(nextGroup - addressOffset, true);
        // stage 6 seems to use the first group from the next level, others are null-terminated
        if (index === 6) {
            if (groupStart === 0) {
                groups.push({objectCount: 0, useCount: 0, options: []});
                nextGroup += 4;
                continue;
            }
            if (groups.length === 17)
                break;
        } else if (groupStart === 0)
            break;

        const options: RandomIDOption[] = [];

        let nextOption = groupStart - addressOffset;
        const count = view.getUint16(nextOption, true);
        for (let i = 0; i < count; i++, nextOption += 8) {
            const maxUses = view.getUint8(nextOption + 2);
            const id = view.getUint16(nextOption + 4, true);
            const chance = view.getUint16(nextOption + 6, true) / 0x100;

            options.push({ id, maxUses, chance, usesLeft: 0});
        }
        groups.push({ objectCount: 0, useCount: 0, options });
        nextGroup += 4;
    }
    return groups;
}

function resetRandomGroups(groups: RandomGroup[]): void {
    for (let g of groups) {
        g.objectCount = 0;
        g.useCount = 0;
        for (let opt of g.options) {
            if (Math.random() < opt.chance) {
                opt.usesLeft = opt.maxUses;
                g.useCount += opt.maxUses;
            } else
                opt.usesLeft = 0;
        }
    }
}

function getPartTransforms(data: ArrayBufferSlice, objectID: number, partCount: number): PartTransform[] {
    const addressOffset = 0x210260; // start address in RAM
    const indexTable = 0x211290; // ram address of table
    const transformTable = 0x2111A0; // ram address of table

    const view = data.createDataView();
    // only very few objects have transforms, so first use the index table to find the right entry
    const index = view.getInt16(indexTable + 2 * objectID - addressOffset, true);
    if (index === -1)
        return [];

    const firstTransform = view.getUint32(transformTable + 4 * index - addressOffset, true);
    if (firstTransform === 0)
        return []; // even the condensed table has empty entries

    const out: PartTransform[] = [];
    for (let i = 0; i < partCount; i++) {
        const x = view.getFloat32(firstTransform + 0x20 * i + 0x00 - addressOffset, true);
        const y = view.getFloat32(firstTransform + 0x20 * i + 0x04 - addressOffset, true);
        const z = view.getFloat32(firstTransform + 0x20 * i + 0x08 - addressOffset, true);
        const rx = view.getFloat32(firstTransform + 0x20 * i + 0x10 - addressOffset, true) * MathConstants.DEG_TO_RAD;
        const ry = view.getFloat32(firstTransform + 0x20 * i + 0x14 - addressOffset, true) * MathConstants.DEG_TO_RAD;
        const rz = view.getFloat32(firstTransform + 0x20 * i + 0x18 - addressOffset, true) * MathConstants.DEG_TO_RAD;
        const translation = vec3.fromValues(x, y, z);
        const rotation = vec3.fromValues(rx, ry, rz);
        out.push({ translation, rotation });
    }
    return out;
}

export interface MotionParameters {
    motionID: MotionID;
    motionActionID: MotionActionID;
    altMotionActionID: MotionActionID;
    pathPoints: Float32Array;
    speed: number;
}

export const enum MotionID {
    ChasePlayer       = 0x03,
    PathTowardsPlayer = 0x05,
    ScaredBird        = 0x06,
    HouseDoors        = 0x0D,
    OneTimePath       = 0x10,
    PathThenDie       = 0x11,
    AltStageAreaPath  = 0x12,
    PathSpin          = 0x13,
    PathRoll          = 0x14,
    Spin              = 0x15,
    Bob               = 0x16,
    Hop               = 0x19,
    BackAndForth      = 0x1C,
    BackAndForthNoYaw = 0x1D,
    Flip              = 0x1E,
    ScatterFromParent = 0x1F,
    Sway              = 0x20,
    RepeatablePath    = 0x21,
    WhackAMole        = 0x22,
    DraggedAlong      = 0x25,
}

export const enum MotionActionID {
    None          = 0x00,
    SetZone       = 0x01,
    PathCollision = 0x02,
    RandomWalk    = 0x03,
    WaitForPlayer = 0x04,
    Unk0x05       = 0x05,
    Unk0x06       = 0x06,
    Unk0x07       = 0x07,
    Unk0x08       = 0x08,
    ZonePath      = 0x09,
    Unk0x0A       = 0x0A,
    Unk0x0B       = 0x0B,
    TriggeredPath = 0x0C,
    FlyInCircles  = 0x0D,
    Unk0x0E       = 0x0E,
    SporadicWalk  = 0x0F,
    StageAreaPath = 0x10,
    TriggeredMove = 0x11,
    Unk0x12       = 0x12,
    ZonePathSetup = 0x13,
    PathSpin      = 0x14,
    PathRoll      = 0x15,
    Misc          = 0x16,
    BrokenPath    = 0x17, // all but the init function are stubs
    ZoneHop       = 0x18,
    PathSetup     = 0x19,
    BackAndForth  = 0x1A,
    Clouds        = 0x1B,
    SimplePath    = 0x1C,
    SlopingPath   = 0x1D,
}

interface MotionActionTableEntry {
    main: MotionActionID;
    alt: MotionActionID;
}

const motionActionTable: MotionActionTableEntry[] = [
    /* 0x00 */ { main: MotionActionID.WaitForPlayer, alt: 0x05 },
    /* 0x01 */ { main: MotionActionID.RandomWalk,    alt: 0x05 },
    /* 0x02 */ { main: MotionActionID.PathCollision, alt: 0x06 },
    /* 0x03 */ { main: MotionActionID.RandomWalk,    alt: 0x07 },
    /* 0x04 */ { main: MotionActionID.WaitForPlayer, alt: 0x08 },
    /* 0x05 */ { main: MotionActionID.TriggeredPath, alt: MotionActionID.ZonePath },
    /* 0x06 */ { main: MotionActionID.WaitForPlayer, alt: MotionActionID.FlyInCircles },
    /* 0x07 */ { main: MotionActionID.WaitForPlayer, alt: 0x0A },
    /* 0x08 */ { main: MotionActionID.PathCollision, alt: 0x0B },
    /* 0x09 */ { main: MotionActionID.RandomWalk,    alt: 0x0A },
    /* 0x0A */ { main: MotionActionID.SetZone,       alt: 0x0E },
    /* 0x0B */ { main: MotionActionID.SporadicWalk,  alt: MotionActionID.None },
    /* 0x0C */ { main: MotionActionID.SporadicWalk,  alt: 0x05 },
    /* 0x0D */ { main: MotionActionID.TriggeredPath, alt: MotionActionID.StageAreaPath },
    /* 0x0E */ { main: MotionActionID.TriggeredMove, alt: 0x12 },
    /* 0x0F */ { main: MotionActionID.WaitForPlayer, alt: 0x12 },
    /* 0x10 */ { main: MotionActionID.ZonePathSetup, alt: MotionActionID.ZonePath },
    /* 0x11 */ { main: MotionActionID.ZonePathSetup, alt: MotionActionID.ZonePath },
    /* 0x12 */ { main: MotionActionID.TriggeredPath, alt: MotionActionID.ZonePath },
    /* 0x13 */ { main: MotionActionID.PathSetup,     alt: MotionActionID.PathSpin },
    /* 0x14 */ { main: MotionActionID.PathSetup,     alt: MotionActionID.PathRoll },
    /* 0x15 */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x16 */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x17 */ { main: MotionActionID.PathSetup,     alt: MotionActionID.BrokenPath },
    /* 0x18 */ { main: MotionActionID.ZoneHop,       alt: MotionActionID.None },
    /* 0x19 */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x1A */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x1B */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x1C */ { main: MotionActionID.PathSetup,     alt: MotionActionID.BackAndForth },
    /* 0x1D */ { main: MotionActionID.PathSetup,     alt: MotionActionID.BackAndForth },
    /* 0x1E */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x1F */ { main: MotionActionID.WaitForPlayer, alt: MotionActionID.RandomWalk },
    /* 0x20 */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x21 */ { main: MotionActionID.TriggeredPath, alt: MotionActionID.ZonePath },
    /* 0x22 */ { main: MotionActionID.Misc,          alt: MotionActionID.None },
    /* 0x23 */ { main: MotionActionID.Clouds,        alt: MotionActionID.None },
    /* 0x24 */ { main: MotionActionID.SimplePath,    alt: MotionActionID.None },
    /* 0x25 */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x26 */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x27 */ { main: MotionActionID.SlopingPath,   alt: MotionActionID.None },
    /* 0x28 */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x29 */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x2A */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x2B */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
    /* 0x2C */ { main: MotionActionID.SetZone,       alt: MotionActionID.None },
];

export function parseMotion(pathData: ArrayBufferSlice, motionData: ArrayBufferSlice, levelIndex: number, moveType: number): MotionParameters | null {
    const motionOffset = 0x260D90;
    const levelMotions = 0x261B88;

    const motionView = motionData.createDataView();
    const motionList = motionView.getUint32(levelMotions + 4 * levelIndex - motionOffset, true);
    if (motionList === 0) {
        console.warn("missing motion", levelIndex, moveType);
        return null;
    }
    const entryStart = motionList + 6 * moveType - motionOffset;

    const backupIndex = motionView.getInt16(entryStart + 0x00, true);
    const pathIndex = motionView.getInt16(entryStart + 0x02, true);
    const motionID = motionView.getInt16(entryStart + 0x04, true);

    let motionActionID = 0, altMotionActionID = 0;
    if (motionID < 0) {
        assert(backupIndex >= 0 && backupIndex < 3);
        motionActionID = backupIndex + 1;
    } else {
        assert(motionID < motionActionTable.length);
        const motionAction = motionActionTable[motionID];
        motionActionID = motionAction.main;
        altMotionActionID = motionAction.alt;
    }

    const pathOffset = 0x216290;
    const levelPaths = 0x25F6F0;

    if (levelIndex === 41)
        levelIndex = 42; // test 1 has motion, test 2 has paths ???

    const pathView = pathData.createDataView();
    const pathList = pathView.getUint32(levelPaths + 4 * levelIndex - pathOffset, true);
    assert(pathList !== 0);
    const pathStart = pathList + 8 * pathIndex - pathOffset;
    const pointStart = pathView.getUint32(pathStart + 0x00, true);
    const speed = pathView.getFloat32(pathStart + 0x04, true);
    // find last path point
    let pointCount = 0;
    while (pathView.getFloat32(pointStart - pathOffset + 0x10 * (pointCount++) + 0x0C, true) !== 255) { }
    pointCount -= 1; // the 255 point isn't part of the path
    const pathPoints = pathData.createTypedArray(Float32Array, pointStart - pathOffset, 4 * pointCount, Endianness.LITTLE_ENDIAN);

    return { motionActionID, altMotionActionID, pathPoints, speed, motionID };
}

export interface ObjectDefinition {
    stayLevel: boolean;
    speedIndex: number;
    altUpdate: number;
    animated: boolean;
    dummyParent: boolean;

    map: number;
    mapRegion: number;
    size: number;
    category: number;
    sortKey: number;
    isRare: boolean;
}

export function parseObjectDefinition(object: ArrayBufferSlice, collection: ArrayBufferSlice, id: number): ObjectDefinition {
    const objView = object.createDataView();
    const objOffs = id * 0x24;
    const collView = collection.createDataView();
    const collOffs = id * 0x08;

    // internal name pointer
    // two volume-related floats
    const stayLevel = objView.getUint8(objOffs + 0x0C) !== 0;
    const speedIndex = objView.getInt8(objOffs + 0x13);
    const altUpdate = objView.getInt8(objOffs + 0x14);
    const animated = objView.getUint8(objOffs + 0x1A) !== 0;
    const dummyParent = objView.getUint8(objOffs + 0x21) !== 0;

    const map = collView.getInt8(collOffs + 0x00);
    const mapRegion = collView.getInt8(collOffs + 0x01);
    const size = collView.getInt8(collOffs + 0x02);
    const category = collView.getInt8(collOffs + 0x03);
    const sortKey = collView.getInt16(collOffs + 0x04, true);
    const isRare = collView.getInt8(collOffs + 0x06) !== 0;

    return { stayLevel, speedIndex, altUpdate, animated, dummyParent, map, mapRegion, size, category, sortKey, isRare };
}

export function getParentList(data: ArrayBufferSlice, levelIndex: number, areaIndex: number): Int16Array | null {
    const view = data.createDataView();
    const offset = 0x261EC0;
    const tableStart = 0x267798;

    const entryStart = view.getUint32(tableStart + 4*levelIndex - offset, true);
    if (entryStart === 0)
        return null;

    const pairStart = view.getUint32(entryStart + 4*areaIndex - offset, true);
    if (pairStart === 0)
        return null;

    if (pairStart > 0xf0000000) // accidentally reading pair info? MAS7 area 2
        return null;

    return data.createTypedArray(Int16Array, pairStart - offset, undefined, Endianness.LITTLE_ENDIAN);
}

function computePartTransformMatrix(dst: mat4, xform: Readonly<PartTransform>): void {
    computeModelMatrixSRT(dst, 1, 1, 1, xform.rotation[0], xform.rotation[1], xform.rotation[2], xform.translation[0], xform.translation[1], xform.translation[2]);
}

const scratchObjectAABB = new AABB();
const scratchMatrix = mat4.create();
function computeObjectAABB(sector: BINModelSector, transforms: PartTransform[]): AABB {
    const out = new AABB();
    for (let i = 0; i < sector.models.length; i++) {
        if (transforms.length > 0) {
            computePartTransformMatrix(scratchMatrix, transforms[i]);
            scratchObjectAABB.transform(sector.models[i].bbox, scratchMatrix);
            out.union(out, scratchObjectAABB);
        } else {
            out.union(out, sector.models[i].bbox);
        }
    }
    return out;
}

function computeObjectAABBFromRawSector(buffer: ArrayBufferSlice, offset: number, transforms: PartTransform[]): AABB {
    const out = new AABB();
    const view = buffer.createDataView();
    const modelObjCount = view.getUint16(offset + 0x00, true);

    const modelObjTableIdx = offset + 0x04;
    for (let i = 0; i < modelObjCount; i++) {
        const objOffs = offset + view.getUint32(modelObjTableIdx + 4 * i, true);

        const minX = view.getFloat32(objOffs + 0x00, true);
        const minY = view.getFloat32(objOffs + 0x04, true);
        const minZ = view.getFloat32(objOffs + 0x08, true);
        const maxX = view.getFloat32(objOffs + 0x10, true);
        const maxY = view.getFloat32(objOffs + 0x14, true);
        const maxZ = view.getFloat32(objOffs + 0x18, true);
        scratchObjectAABB.set(minX, minY, minZ, maxX, maxY, maxZ);

        if (transforms.length > 0) {
            computePartTransformMatrix(scratchMatrix, transforms[i]);
            scratchObjectAABB.transform(scratchObjectAABB, scratchMatrix);
        }

        out.union(out, scratchObjectAABB);
    }
    return out;
}

export interface MissionSetupObjectSpawn {
    // The original in-game object ID.
    objectId: number;

    // The index in our collapsed objectModels list.
    modelIndex: number;

    // The area where this object should appear.
    dispOnAreaNo: number;

    // The area where this object should disappear. If never, -1.
    dispOffAreaNo: number;

    // Object transformation.
    modelMatrix: mat4;

    // per-level motion specifier, including path and logic
    moveType: number;

    // determines relationship to parent object, if any
    linkAction: number;

    // index in the master object table in the game
    tableIndex: number;
}

export interface LevelSetupBIN {
    activeStageAreas: number[];
    objectModels: ObjectModel[];
    objectDefs: ObjectDefinition[];
    objectSpawns: MissionSetupObjectSpawn[][];
    zones: CollisionList[];
}

function combineSlices(buffers: ArrayBufferSlice[]): ArrayBufferSlice {
    if (buffers.length === 1)
        return buffers[0];

    let totalSize = 0;
    for (let i = 0; i < buffers.length; i++)
        totalSize += buffers[i].byteLength;

    const dstBuffer = new Uint8Array(totalSize);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
        dstBuffer.set(buffers[i].createTypedArray(Uint8Array), offset);
        offset += buffers[i].byteLength;
    }

    return new ArrayBufferSlice(dstBuffer.buffer);
}

export interface PartTransform {
    translation: vec3;
    rotation: vec3;
}

export function parseObjectModel(gsMemoryMap: GSMemoryMap[], buffer: ArrayBufferSlice, firstSectorIndex: number, transformBuffer: ArrayBufferSlice, objectId: number, def?: ObjectDefinition): ObjectModel | null {
    const view = buffer.createDataView();

    const isAnimated = def !== undefined && def.animated;
    const noModel = def !== undefined && def.dummyParent;

    const firstSectorOffs = 0x04 + firstSectorIndex * 0x04;
    const lod0Offs = view.getUint32(firstSectorOffs + 0x00, true);
    const lod1Offs = view.getUint32(firstSectorOffs + 0x04, true);
    const lod2Offs = view.getUint32(firstSectorOffs + 0x08, true);
    const texDataOffs = view.getUint32(firstSectorOffs + 0x0C, true);
    const unk10Offs = view.getUint32(firstSectorOffs + 0x10, true);
    const clutAOffs = view.getUint32(firstSectorOffs + 0x14, true);
    const clutBOffs = view.getUint32(firstSectorOffs + 0x18, true);
    const collisionOffs = view.getUint32(firstSectorOffs + 0x1C, true);
    const unk20Offs = view.getUint32(firstSectorOffs + 0x20, true);
    const descriptionOffs = view.getUint32(firstSectorOffs + 0x24, true);
    const audioOffs = view.getUint32(firstSectorOffs + 0x28, true);

    // Missing object?
    if (sectorIsNIL(buffer, lod0Offs))
        return null;

    if (!sectorIsNIL(buffer, texDataOffs)) {
        // Parse texture data.
        parseDIRECT(gsMemoryMap[0], buffer.slice(texDataOffs));
        parseDIRECT(gsMemoryMap[1], buffer.slice(texDataOffs));

        if (!sectorIsNIL(buffer, clutAOffs))
            parseDIRECT(gsMemoryMap[0], buffer.slice(clutAOffs));
        if (!sectorIsNIL(buffer, clutBOffs))
            parseDIRECT(gsMemoryMap[1], buffer.slice(clutBOffs));
    }

    // currently isn't needed
    // let collision: CollisionList[] = [];
    // if (!sectorIsNIL(buffer, collisionOffs))
    //     collision = parseCollisionLists(buffer, collisionOffs);

    // Load in LOD 0 for normal objects, but use LOD 1 for animated objects; their LOD 0
    // is a single part used for low-cost rendering, while LOD 1 holds actual part data
    let sectorOffs = lod0Offs;
    let skinning: SkinningMatrix[][] = [];
    if (isAnimated) {
        assert(!sectorIsNIL(buffer, lod1Offs));
        sectorOffs = lod1Offs + view.getUint32(lod1Offs, true);
        // weights/joint indices for skinning come first

        for (let skinningOffs = lod1Offs + 0x10; skinningOffs < sectorOffs; skinningOffs += 0x20) {
            const pairCount = view.getUint8(skinningOffs + 0x0D);
            const weights: SkinningMatrix[] = [];
            const jointIndices = buffer.createTypedArray(Int8Array, skinningOffs, 4);

            for (let i = 0; i < pairCount; i++) {
                const matrixIndex = view.getInt8(skinningOffs + 0x04 + i);
                assert(matrixIndex >= 0 && matrixIndex < 4 && jointIndices[matrixIndex] >= 0);
                const weight = view.getUint16(skinningOffs + 0x0E + 2 * i, true) / (1 << 15);
                assert(0 < weight && weight <= 1)
                weights.push({ index: jointIndices[matrixIndex], weight });
            }
            skinning.push(weights);
        }
    }

    const sector = parseModelSector(buffer, gsMemoryMap, hexzero(objectId, 4), sectorOffs);
    if (sector === null)
        return null;
    const transforms = getPartTransforms(transformBuffer, objectId, sector.models.length);

    if (isAnimated)
        assert(skinning.length === sector.models.length);

    // animated objects don't have proper part transforms, so we need to use the unified model from LOD 0
    let bbox: AABB;
    if (noModel) { // construct explicitly from collision
        if (sectorIsNIL(buffer, collisionOffs))
            bbox = new AABB(); // level 27 is missing some of these
        else {
            const bboxOffs = collisionOffs + view.getUint32(collisionOffs + 0x04, true) + 0x08;
            bbox = new AABB(
                view.getFloat32(bboxOffs + 0x00, true),
                view.getFloat32(bboxOffs + 0x04, true),
                view.getFloat32(bboxOffs + 0x08, true),
                view.getFloat32(bboxOffs + 0x0C, true),
                view.getFloat32(bboxOffs + 0x10, true),
                view.getFloat32(bboxOffs + 0x14, true),
            );
        }
    } else if (isAnimated)
        bbox = computeObjectAABBFromRawSector(buffer, lod0Offs, transforms);
    else
        bbox = computeObjectAABB(sector, transforms);
    return { id: objectId, sector, transforms, bbox, skinning };
}

const missingTestLevelAnimations = [0x235, 0x1EA, 0x1EB, 0x200, 0x2E4, 0x3FF, 0x400];

export function parseMissionSetupBIN(buffers: ArrayBufferSlice[], defs: ArrayBufferSlice, collection: ArrayBufferSlice,
    firstArea: number, randomGroups: RandomGroup[], transformBuffer: ArrayBufferSlice, levelIndex: number): LevelSetupBIN {
    // Contains object data inside it.
    const buffer = combineSlices(buffers);
    const view = buffer.createDataView();
    const numSectors = view.getUint32(0x00, true);

    const collisionOffset = view.getUint32(0x04, true);
    const zones = parseCollisionLists(buffer, collisionOffset);

    const gsMemoryMap = nArray(2, () => gsMemoryMapNew());

    function parseObject(objectId: number, def: ObjectDefinition): ObjectModel | null {
        const firstSectorIndex = 0x09 + objectId * 0x0B;
        assert(firstSectorIndex + 0x0B <= numSectors);

        return parseObjectModel(gsMemoryMap, buffer, firstSectorIndex, transformBuffer, objectId, def);
    }

    const objectModels: ObjectModel[] = [];
    const objectSpawns: MissionSetupObjectSpawn[][] = [];
    const objectDefs: ObjectDefinition[] = [];

    function findOrParseObjectModel(objectId: number): number {
        const existingIndex = objectModels.findIndex((model) => model.id === objectId);
        if (existingIndex >= 0) {
            return existingIndex;
        } else {
            const newDef = parseObjectDefinition(defs, collection, objectId);
            // some animated objects in level 27 are missing skinning data
            // for now, just pretend they aren't animated (we don't even display them)
            if (levelIndex === 27 && missingTestLevelAnimations.includes(objectId))
                newDef.animated = false;
            const newObject = parseObject(objectId, newDef);
            if (newObject === null)
                return -1;
            objectModels.push(newObject);
            objectDefs.push(newDef);
            return objectModels.length - 1;
        }
    }

    const q = quat.create();
    const activeStageAreas: number[] = [];
    let setupSpawnTableIdx = 0x14;
    for (let i = 0; i < 5; i++, setupSpawnTableIdx += 0x04) {
        const areaObjectSpawns: MissionSetupObjectSpawn[] = [];
        objectSpawns.push(areaObjectSpawns);
        let setupSpawnsIdx = view.getUint32(setupSpawnTableIdx, true);
        if (readString(buffer, setupSpawnsIdx, 0x04) === 'NIL ') {
            if (i >= firstArea)
                break;
            else
                continue;
        }

        // until we know better, merge early stages in with the first one
        if (i >= firstArea)
            activeStageAreas.push(i);

        // each stage uses groups separately
        resetRandomGroups(randomGroups);
        // initial loop to set random group counts
        for (let randomSpawnsIdx = setupSpawnsIdx; ; randomSpawnsIdx += 0x40) {
            // Flag names come from Katamari Damacy REROLL, on "AttachableProp"
            const u16NameIdx = view.getUint16(randomSpawnsIdx + 0x00, true);
            const u8LocPosType = view.getUint8(randomSpawnsIdx + 0x02);
            const s8RandomLocGroupNo = view.getInt8(randomSpawnsIdx + 0x03);
            if (u16NameIdx === 0xFFFF)
                break;
            if (u8LocPosType !== 0)
                assertExists(randomGroups[s8RandomLocGroupNo]).objectCount++;
        }

        let j = 0;
        for (let tableIndex = 0; ; setupSpawnsIdx += 0x40, tableIndex++) {
            // Flag names come from Katamari Damacy REROLL, on "AttachableProp"
            const u16NameIdx = view.getUint16(setupSpawnsIdx + 0x00, true);
            const u8LocPosType = view.getUint8(setupSpawnsIdx + 0x02);
            const s8RandomLocGroupNo = view.getInt8(setupSpawnsIdx + 0x03);
            const s16MoveTypeNo = view.getInt16(setupSpawnsIdx + 0x04, true);
            const s8HitOnAreaNo = view.getInt8(setupSpawnsIdx + 0x06);
            const u8LinkActNo = view.getUint8(setupSpawnsIdx + 0x07);
            const u8ExActTypeNo = view.getUint8(setupSpawnsIdx + 0x08);
            const u8IdNameNo = view.getUint8(setupSpawnsIdx + 0x09);
            const s8DispOffAreaNo = view.getInt8(setupSpawnsIdx + 0x0A);
            const u8VsDropFlag = view.getUint8(setupSpawnsIdx + 0x0B);
            const s8CommentNo = view.getInt8(setupSpawnsIdx + 0x0C);
            const s8CommentGroupNo = view.getInt8(setupSpawnsIdx + 0x0D);
            const s8TwinsNo = view.getInt8(setupSpawnsIdx + 0x0E);
            const u8ShakeOffFlag = view.getUint8(setupSpawnsIdx + 0x0F);

            // We're done.
            if (u16NameIdx === 0xFFFF)
                break;

            let objectId = u16NameIdx;
            // This flag means that the object spawned is random. The table
            // of which objects get spawned for which group is stored in the ELF.
            if (u8LocPosType !== 0) {
                const group = randomGroups[s8RandomLocGroupNo];
                let optionIndex = (Math.random() * group.options.length) | 0;
                const shouldUse = group.useCount >= group.objectCount || (group.options[optionIndex].usesLeft > 0 && Math.random() < .5);
                group.objectCount--;
                if (shouldUse) {
                    while (group.options[optionIndex].usesLeft === 0)
                        optionIndex = (optionIndex + 1) % group.options.length;
                    objectId = group.options[optionIndex].id;
                    group.options[optionIndex].usesLeft--;
                    group.useCount--;
                } else
                    continue;
            }

            const modelIndex = findOrParseObjectModel(objectId);
            if (modelIndex === -1) {
                // It's possible (and normal!) for object models to be missing if they're just parent objects.
                continue;
            }

            const translationX = view.getFloat32(setupSpawnsIdx + 0x10, true);
            const translationY = view.getFloat32(setupSpawnsIdx + 0x14, true);
            const translationZ = view.getFloat32(setupSpawnsIdx + 0x18, true);
            assert(view.getFloat32(setupSpawnsIdx + 0x1C, true) === 1);
            const rotationX = view.getFloat32(setupSpawnsIdx + 0x20, true);
            const rotationY = view.getFloat32(setupSpawnsIdx + 0x24, true);
            const rotationZ = view.getFloat32(setupSpawnsIdx + 0x28, true);
            const angle = -view.getFloat32(setupSpawnsIdx + 0x2C, true);
            // These scales are unused according to Murugo?
            const scaleX = view.getFloat32(setupSpawnsIdx + 0x30, true);
            const scaleY = view.getFloat32(setupSpawnsIdx + 0x34, true);
            const scaleZ = view.getFloat32(setupSpawnsIdx + 0x38, true);
            assert(view.getUint32(setupSpawnsIdx + 0x3C, true) === 0);

            const modelMatrix = mat4.create();
            quat.setAxisAngle(q, [rotationX, rotationY, rotationZ], angle);
            mat4.fromRotationTranslation(modelMatrix, q, [translationX, translationY, translationZ]);

            // random spawn positions give the ground height, so need to be adjusted based on the object
            // there's an alternative path that I don't understand yet, just the simple stuff for now
            if (u8LocPosType !== 0) {
                scratchObjectAABB.transform(objectModels[modelIndex].bbox, modelMatrix);
                modelMatrix[13] -= scratchObjectAABB.max[1] - modelMatrix[13];
            }

            const dispOnAreaNo = Math.max(i, firstArea);
            areaObjectSpawns.push({ objectId, modelIndex, dispOnAreaNo, dispOffAreaNo: s8DispOffAreaNo, modelMatrix, moveType: s16MoveTypeNo, tableIndex, linkAction: u8LinkActNo });
            j++;
        }
    }

    return { objectModels, objectDefs, objectSpawns, activeStageAreas, zones };
}

interface TutorialModel {
    pos: vec3;
    sector: BINModelSector;
}

export function parseTutorialModels(map: GSMemoryMap, data: ArrayBufferSlice, spawns: ArrayBufferSlice): TutorialModel[] {
    const models: TutorialModel[] = [];
    const dataView = data.createDataView();
    const spawnView = spawns.createDataView();

    for (let offs = 0; offs < spawnView.byteLength; offs += 0x20) {
        const index = spawnView.getUint16(offs + 0x00, true);
        const pos = vec3.fromValues(
            spawnView.getFloat32(offs + 0x10, true),
            spawnView.getFloat32(offs + 0x14, true),
            spawnView.getFloat32(offs + 0x18, true),
        );
        const dataOffs = dataView.getUint32(4 + 4 * index, true);
        const model = assertExists(parseModelSector(data, [map], `planet`, dataOffs));
        models.push({ pos, sector: model });
    }

    // special jupiter orbs
    const pos = vec3.fromValues(0, -106, 207);
    const dataOffs = dataView.getUint32(4 + 4 * 0x25, true);
    const model = assertExists(parseModelSector(data, [map], `planet`, dataOffs, 0x48));
    models.push({ pos, sector: model });

    return models;
}
