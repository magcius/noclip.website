
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero, assertExists, readString } from "../util";
import { Color, colorNewFromRGBA, colorFromRGBA, colorEqual } from "../Color";
import { AABB } from "../Geometry";
import { mat4, quat, vec3 } from "gl-matrix";
import { GSRegister, GSMemoryMap, gsMemoryMapUploadImage, gsMemoryMapReadImagePSMT4_PSMCT32, gsMemoryMapReadImagePSMT8_PSMCT32, GSPixelStorageFormat, GSTextureColorComponent, GSTextureFunction, GSCLUTStorageFormat, psmToString } from "../Common/PS2/GS";
import { computeModelMatrixPosRot } from "../SourceEngine/Main";

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
    name: string;
    width: number;
    height: number;
    pixels: Uint8Array;
}

export interface BINModelPart {
    diffuseColor: Color;
    indexOffset: number;
    indexCount: number;
    textureName: string | null;
    gsConfiguration: GSConfiguration;
}

export interface BINModel {
    bbox: AABB;
    vertexData: Float32Array;
    indexData: Uint16Array;
    modelParts: BINModelPart[];
}

export interface BINModelSector {
    models: BINModel[];
    textures: BINTexture[];
}

export interface ObjectModel {
    sector: BINModelSector;
    transforms: mat4[];
    bbox: AABB;
}

export interface LevelModelBIN {
    sectors: BINModelSector[];
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

    const texDataOffs = 0;

    // Not sure what the first three words are. Sometimes they're FLUSH (level textures),
    // sometimes it appears like a dummy UNPACK (0x60, seen in model object binaries) ?

    const tag2 = view.getUint8(texDataOffs + 0x0F);
    assert(tag2 === 0x50, "TAG"); // DIRECT
    const texDataSize = view.getUint16(texDataOffs + 0x0C, true) * 0x10;
    const texDataEnd = texDataOffs + texDataSize;
    let texDataIdx = texDataOffs + 0x10;

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

    return texDataIdx;
}

// TODO(jstpierre): Do we need a texture cache?
function decodeTexture(gsMemoryMap: GSMemoryMap, tex0_data0: number, tex0_data1: number, namePrefix: string = ''): BINTexture {
    // Unpack TEX0 register.
    const tbp0 = (tex0_data0 >>> 0) & 0x3FFF;
    const tbw = (tex0_data0 >>> 14) & 0x3F;
    const psm: GSPixelStorageFormat = (tex0_data0 >>> 20) & 0x3F;
    const tw = (tex0_data0 >>> 26) & 0x0F;
    const th = ((tex0_data0 >>> 30) & 0x03) | (((tex0_data1 >>> 0) & 0x03) << 2);
    const tcc: GSTextureColorComponent = (tex0_data1 >>> 2) & 0x03;
    const tfx: GSTextureFunction = (tex0_data1 >>> 3) & 0x03;
    const cbp = (tex0_data1 >>> 5) & 0x3FFF;
    const cpsm: GSCLUTStorageFormat = (tex0_data1 >>> 19) & 0x0F;
    const csm = (tex0_data1 >>> 23) & 0x1;
    const csa = (tex0_data1 >>> 24) & 0x1F;
    const cld = (tex0_data1 >>> 29) & 0x03;

    const name = `${namePrefix}/${hexzero(tbp0, 4)}/${hexzero(cbp, 4)}`;

    const width = 1 << tw;
    const height = 1 << th;

    // TODO(jstpierre): Handle other formats
    // assert(psm === GSPixelStorageFormat.PSMT4, `Unknown PSM ${psm}`);
    assert(cpsm === GSCLUTStorageFormat.PSMCT32, `Unknown CPSM ${cpsm}`);

    // TODO(jstpierre): Read the TEXALPHA register.
    const alphaReg = tcc === GSTextureColorComponent.RGBA ? -1 : 0x80;

    let pixels: Uint8Array = new Uint8Array(width * height * 4);
    if (psm === GSPixelStorageFormat.PSMT4)
        gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMemoryMap, tbp0, tbw, width, height, cbp, csa, alphaReg);
    else if (psm === GSPixelStorageFormat.PSMT8)
        gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMemoryMap, tbp0, tbw, width, height, cbp, alphaReg);
    else
        console.warn(`Unsupported PSM ${psmToString(psm)} in texture ${name}`);

    return { name, width, height, pixels, tex0_data0, tex0_data1 };
}

export function parseStageTextureBIN(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap): void {
    const view = buffer.createDataView();

    const numSectors = view.getUint32(0x00, true);
    // Number of sectors seems to be inconsistent. Make a Star 1 (135049) has one sector defined
    // but two uploads, but Make a Star 3 (135231) has two... Just run until the end of the file...

    const firstSectorOffs = view.getUint32(0x04, true);
    let offs = firstSectorOffs;
    while (offs < buffer.byteLength)
        offs += parseDIRECT(gsMemoryMap, buffer.slice(offs));
    assert(offs === buffer.byteLength);
}

function parseModelSector(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap, namePrefix: string, sectorOffs: number): BINModelSector | null {
    const view = buffer.createDataView();

    const modelObjCount = view.getUint16(sectorOffs + 0x00, true);
    const modelObjType = view.getUint16(sectorOffs + 0x02, true);
    if (modelObjType !== 0x05)
        return null;

    const textures: BINTexture[] = [];
    function findOrDecodeTexture(tex0_data0: number, tex0_data1: number): string {
        let texture = textures.find((texture) => {
            return texture.tex0_data0 === tex0_data0 && texture.tex0_data1 === tex0_data1;
        });
        if (texture === undefined) {
            texture = decodeTexture(gsMemoryMap, tex0_data0, tex0_data1, namePrefix);
            textures.push(texture);
        }
        return texture.name;
    }

    // 4 positions, 3 normals, 2 UV coordinates.
    const WORKING_VERTEX_STRIDE = 4+3+2;
    // 3 positions, 3 normals, 2 UV coordinates.
    const VERTEX_STRIDE = 3+3+2;

    let modelObjTableIdx = sectorOffs + 0x04;
    const models: BINModel[] = [];
    for (let i = 0; i < modelObjCount; i++) {
        const objOffs = sectorOffs + view.getUint32(modelObjTableIdx + 0x00, true);

        const minX = view.getFloat32(objOffs + 0x00, true);
        const minY = view.getFloat32(objOffs + 0x04, true);
        const minZ = view.getFloat32(objOffs + 0x08, true);
        // Not sure what 0x0C is.
        const maxX = view.getFloat32(objOffs + 0x10, true);
        const maxY = view.getFloat32(objOffs + 0x14, true);
        const maxZ = view.getFloat32(objOffs + 0x18, true);
        assert(view.getUint32(objOffs + 0x1C, true) === 0x00);
        const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

        const packetsBegin = objOffs + 0x20;
        const packetsSize = view.getUint16(objOffs + 0x0C, true) * 0x10;
        const packetsEnd = packetsBegin + packetsSize;

        interface BINModelRun {
            vertexRunData: Float32Array;
            vertexRunCount: number;
            indexRunData: Uint16Array;
            vertexRunColor: Color;
            textureName: string | null;
            gsConfiguration: GSConfiguration;
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
        let currentTextureName: string | null = null;
        let currentGSConfiguration: GSConfiguration = {
            tex0_1_data0: -1, tex0_1_data1: -1,
            tex1_1_data0: -1, tex1_1_data1: -1,
            clamp_1_data0: -1, clamp_1_data1: -1,
            alpha_1_data0: -1, alpha_1_data1: -1,
            test_1_data0: -1, test_1_data1: -1,
        };

        const expectedPositionsOffs = 0x8000;
        let expectedTexCoordOffs = -1;
        let expectedNormalsOffs = -1;
        let expectedDiffuseColorOffs = -1;
        let skipVertices = false;

        const newVertexRun = () => {
            // Parse out the header.
            vertexRunFlags0 = view.getUint32(packetsIdx + 0x00, true);
            vertexRunFlags1 = view.getUint32(packetsIdx + 0x04, true);
            vertexRunFlags2 = view.getUint32(packetsIdx + 0x08, true);
            vertexRunCount = vertexRunFlags0 & 0x000000FF;
            vertexRunData = new Float32Array(vertexRunCount * WORKING_VERTEX_STRIDE);
            skipVertices = false;

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
                        assert(imm === expectedDiffuseColorOffs);
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
                        assert(imm === expectedNormalsOffs);

                        for (let j = 0; j < qwd; j++) {
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 4] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 5] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData![j * WORKING_VERTEX_STRIDE + 6] = view.getFloat32(packetsIdx + 0x08, true);
                            packetsIdx += 0x0C;
                        }
                    }
                } else if (format === VifUnpackFormat.V4_8) {
                    // TODO(jstpierre): An unknown color?
                    assert(qwd === 0x01);
                    packetsIdx += 0x04;

                    /*
                    const expectedOffs = 0x8000 + 1 + vertexRunCount * 3;
                    assert(imm === expectedOffs);
                    assert(qwd === 0x01);

                    const diffuseColorR = view.getUint8(packetsIdx + 0x00) / 0x80;
                    const diffuseColorG = view.getUint8(packetsIdx + 0x01) / 0x80;
                    const diffuseColorB = view.getUint8(packetsIdx + 0x02) / 0x80;
                    const diffuseColorA = view.getUint8(packetsIdx + 0x03) / 0x80;
                    colorFromRGBA(vertexRunColor, diffuseColorR, diffuseColorG, diffuseColorB, diffuseColorA);
                    packetsIdx += 0x04;
                    */
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
                        currentTextureName = findOrDecodeTexture(data0, data1);
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
                assertExists(currentTextureName !== null);
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
                    const textureName = currentTextureName;
                    const gsConfiguration: GSConfiguration = Object.assign({}, currentGSConfiguration);
                    modelVertexRuns.push({ vertexRunData: vertexRunData!, vertexRunCount, indexRunData, vertexRunColor: vertexRunColor!, textureName: textureName!, gsConfiguration });
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
            let modelPartsCompatible = currentModelPart !== null;
            if (modelPartsCompatible && !colorEqual(vertexRun.vertexRunColor, currentModelPart!.diffuseColor))
                modelPartsCompatible = false;
            if (modelPartsCompatible && vertexRun.textureName !== currentModelPart!.textureName)
                modelPartsCompatible = false;
            if (modelPartsCompatible && !gsConfigurationEqual(vertexRun.gsConfiguration, currentModelPart!.gsConfiguration))
                modelPartsCompatible = false;

            // TODO(jstpierre): Texture settings
            if (!modelPartsCompatible) {
                currentModelPart = { diffuseColor: vertexRun.vertexRunColor, indexOffset: indexDst, indexCount: 0, textureName: vertexRun.textureName, gsConfiguration: vertexRun.gsConfiguration };
                modelParts.push(currentModelPart);
            }

            for (let k = 0; k < vertexRunData.length; k += WORKING_VERTEX_STRIDE) {
                // Position.
                vertexData[vertexDataDst++] = vertexRunData[k + 0];
                vertexData[vertexDataDst++] = vertexRunData[k + 1];
                vertexData[vertexDataDst++] = vertexRunData[k + 2];
                // Skip W, it was for internal use only.
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

        models.push({ bbox, vertexData, indexData, modelParts });

        modelObjTableIdx += 0x04;
    }

    return { models, textures };
}

function sectorIsNIL(buffer: ArrayBufferSlice, sectorOffs: number): boolean {
    return readString(buffer, sectorOffs, 0x04) === 'NIL ';
}

export function parseLevelModelBIN(buffer: ArrayBufferSlice, gsMemoryMap: GSMemoryMap, namePrefix: string = ''): LevelModelBIN {
    const view = buffer.createDataView();

    const numSectors = view.getUint32(0x00, true);
    assert(numSectors === 0x08);

    const sectors: BINModelSector[] = [];

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
        const sectorModel = assertExists(parseModelSector(buffer, gsMemoryMap, namePrefix, sectorOffs));
        sectors.push(sectorModel);
    }

    return { sectors };
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

function getPartTransforms(data: ArrayBufferSlice, objectID: number, partCount: number): mat4[] {
    const addressOffset = 0x210260; // start address in RAM
    const indexTable = 0x211290; // ram address of table 
    const transformTable = 0x2111A0; // ram address of table 

    const view = data.createDataView();
    if (indexTable + 2 * objectID - addressOffset > data.byteLength)
        console.log(hexzero(indexTable, 8), hexzero(objectID, 8), hexzero(addressOffset, 8), hexzero(data.byteLength, 8))
    // only very few objects have transforms, so first use the index table to find the right entry
    const index = view.getInt16(indexTable + 2 * objectID - addressOffset, true);
    if (index === -1)
        return [];

    const firstTransform = view.getUint32(transformTable + 4 * index - addressOffset, true);
    if (firstTransform === 0)
        return []; // even the condensed table has empty entries

    const out: mat4[] = [];
    for (let i = 0; i < partCount; i++) {
        const x = view.getFloat32(firstTransform + 0x20 * i + 0x00 - addressOffset, true);
        const y = view.getFloat32(firstTransform + 0x20 * i + 0x04 - addressOffset, true);
        const z = view.getFloat32(firstTransform + 0x20 * i + 0x08 - addressOffset, true);
        const rx = view.getFloat32(firstTransform + 0x20 * i + 0x10 - addressOffset, true);
        const ry = view.getFloat32(firstTransform + 0x20 * i + 0x14 - addressOffset, true);
        const rz = view.getFloat32(firstTransform + 0x20 * i + 0x18 - addressOffset, true);
        const xform = mat4.create();
        computeModelMatrixPosRot(xform, vec3.fromValues(x, y, z), vec3.fromValues(rx, ry, rz));
        out.push(xform);
    }
    return out;
}

const scratchObjectAABB = new AABB();
const scratchAABBTransform = mat4.create();
function computeObjectAABB(sector: BINModelSector, transforms: mat4[]): AABB {
    const out = new AABB();
    mat4.identity(scratchAABBTransform);
    out.transform(sector.models[0].bbox, transforms.length > 0 ? transforms[0] : scratchAABBTransform);
    for (let i = 1; i < transforms.length; i++) {
        scratchObjectAABB.transform(sector.models[i].bbox, transforms.length > 0 ? transforms[i] : scratchAABBTransform);
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
}

export interface LevelSetupBIN {
    activeStageAreas: number[];
    objectModels: ObjectModel[];
    objectSpawns: MissionSetupObjectSpawn[];
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

export function parseMissionSetupBIN(buffers: ArrayBufferSlice[], gsMemoryMap: GSMemoryMap, randomGroups: RandomGroup[], transformBuffer: ArrayBufferSlice): LevelSetupBIN {
    // Contains object data inside it.
    const buffer = combineSlices(buffers);
    const view = buffer.createDataView();
    const numSectors = view.getUint32(0x00, true);

    function parseObject(objectId: number): ObjectModel | null {
        const firstSectorIndex = 0x09 + objectId * 0x0B;
        assert(firstSectorIndex + 0x0B <= numSectors);

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
            parseDIRECT(gsMemoryMap, buffer.slice(texDataOffs));
            // TODO(jstpierre): Which CLUT do I want?
            parseDIRECT(gsMemoryMap, buffer.slice(clutAOffs));
        }

        // Load in LOD 0.
        const sector = parseModelSector(buffer, gsMemoryMap, hexzero(objectId, 4), lod0Offs);
        if (sector === null)
            return null;
        const transforms = getPartTransforms(transformBuffer, objectId, sector.models.length);
        return {sector, transforms, bbox: computeObjectAABB(sector, transforms)};
    }

    const objectModels: ObjectModel[] = [];
    const objectSpawns: MissionSetupObjectSpawn[] = [];

    function findOrParseObject(objectId: number): number {
        const existingSpawn = objectSpawns.find((spawn) => spawn.objectId === objectId);
        if (existingSpawn !== undefined) {
            return existingSpawn.modelIndex;
        } else {
            const newObject = parseObject(objectId);
            if (newObject === null)
                return -1;
            objectModels.push(newObject);
            return objectModels.length - 1;
        }
    }

    const q = quat.create();
    const activeStageAreas: number[] = [];
    let setupSpawnTableIdx = 0x14;
    for (let i = 0; i < 5; i++, setupSpawnTableIdx += 0x04) {
        let setupSpawnsIdx = view.getUint32(setupSpawnTableIdx, true);

        if (readString(buffer, setupSpawnsIdx, 0x04) === 'NIL ')
            continue;

        activeStageAreas.push(i);

        // each stage uses groups separately
        resetRandomGroups(randomGroups);
        // initial loop to set random group counts
        for (let randomSpawnsIdx = setupSpawnsIdx; ; randomSpawnsIdx += 0x40) {
            // Flag names come from Katamari Damacy REROLL, on "AttachableProp"
            const u16NameIdx = view.getUint16(randomSpawnsIdx + 0x00, true);
            const u8LocPosType = view.getUint8(randomSpawnsIdx + 0x02);
            const s8RandomLocGroupNo = view.getInt8(randomSpawnsIdx + 0x03);
            if (u16NameIdx == 0xFFFF)
                break;
            if (u8LocPosType !== 0)
                assertExists(randomGroups[s8RandomLocGroupNo]).objectCount++;
        }

        let j = 0;
        for (; ; setupSpawnsIdx += 0x40) {
            // Flag names come from Katamari Damacy REROLL, on "AttachableProp"
            const u16NameIdx = view.getUint16(setupSpawnsIdx + 0x00, true);
            const u8LocPosType = view.getUint8(setupSpawnsIdx + 0x02);
            const s8RandomLocGroupNo = view.getInt8(setupSpawnsIdx + 0x03);
            const s8HitAreaNo = view.getInt16(setupSpawnsIdx + 0x04, true);
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

            // Skip "weird" objects (missing models, descriptions)
            switch (objectId) {
            case 0x0089:
            case 0x0122:
            case 0x017D:
            case 0x01F3:
            case 0x026B:
            case 0x0277:
            case 0x0364:
            case 0x059E:
            case 0x05A8:
            case 0x05A9:
                continue;
            }

            const modelIndex = findOrParseObject(objectId);
            if (modelIndex === -1) {
                console.log(`Missing object ${hexzero(objectId, 4)}; layer ${i} object index ${j}`);
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
                modelMatrix[13] = scratchObjectAABB.minY;
            }

            const dispOnAreaNo = i;
            const objectSpawn: MissionSetupObjectSpawn = { objectId, modelIndex, dispOnAreaNo, dispOffAreaNo: s8DispOffAreaNo, modelMatrix };
            objectSpawns.push(objectSpawn);
            j++;
        }
    }

    return { objectModels, objectSpawns, activeStageAreas };
}
