
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, hexzero, assertExists } from "../util";
import { Color, colorNew, colorFromRGBA } from "../Color";

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

function getVifUnpackVNComponentCount(vn: VifUnpackVN): number {
    return vn + 1;
}

const enum GSRegister {
    TEX0_1  = 0x06,
    CLAMP_1 = 0x08,
    TEX1_1  = 0x14,
    ALPHA_1 = 0x42,
    TEST_1  = 0x47,
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

export interface TextureSettings {
    psm: number;
    width: number;
    height: number;
    name: string;
}

export interface BINModel {
    vertexData: Float32Array;
    indexData: Uint16Array;
    textureSettings: TextureSettings;
}

export interface BINTexture {
    name: string;
    width: number;
    height: number;
    pixels: Uint8Array;
}

export interface BIN {
    models: BINModel[];
    textureData: BINTexture | null;
}

function combineSlices(buffers: ArrayBufferSlice[]): ArrayBuffer {
    let totalSize = 0;
    for (let i = 0; i < buffers.length; i++)
        totalSize += buffers[i].byteLength;

    const dstBuffer = new Uint8Array(totalSize);
    let offset = 0;
    for (let i = 0; i < buffers.length; i++) {
        dstBuffer.set(buffers[i].createTypedArray(Uint8Array), offset);
        offset += buffers[i].byteLength;
    }

    return dstBuffer.buffer;
}

function parseImageData(buffer: ArrayBufferSlice, texDataOffs: number): ArrayBuffer {
    const view = buffer.createDataView();

    const tag = view.getUint8(texDataOffs + 0x03);
    assert(tag === 0x60); // DIRECT
    const texDataSize = view.getUint16(texDataOffs + 0x00) * 0x10;
    const texDataEnd = texDataOffs + texDataSize;
    let texDataIdx = texDataOffs + 0x10;

    const imageDatas: ArrayBufferSlice[] = [];
    while (texDataIdx < texDataEnd) {
        // These should all be GIFtags here.
        const w0 = view.getUint32(texDataIdx + 0x00, true);
        const w1 = view.getUint32(texDataIdx + 0x04, true);
        const w2 = view.getUint32(texDataIdx + 0x08, true);
        const w3 = view.getUint32(texDataIdx + 0x0C, true);
        texDataIdx += 0x10;

        // NLOOP is the repeat count.
        const nloop = w0 & 0x7FFF;

        // FLG determines the format for the upcoming data. We only support IMAGE data.
        const flg = (w1 >>> 26) & 0x03;
        if (flg === 0x02)
            imageDatas.push(buffer.subarray(texDataIdx, nloop * 0x10));

        texDataIdx += nloop * 0x10;
    }

    // Combine all the slices into one.
    return combineSlices(imageDatas);
}

const PAGE_WIDTH = 0x80;
const PAGE_HEIGHT = 0x80;
const BLOCK_WIDTH = 0x20;
const BLOCK_HEIGHT = 0x10;
const NUM_COLUMNS = 0x04;
function deswizzleIndexed4(texView: DataView, offs: number, width: number, height: number): Uint8Array {
    const byteLength = width * height / 2;
    const dst = new Uint8Array(byteLength);

    const numPagesX = ((width + PAGE_WIDTH - 1) / PAGE_WIDTH) | 0;
    const numPagesY = ((height + PAGE_HEIGHT - 1) / PAGE_HEIGHT) | 0;
    const numBlocksX = Math.min(((width + BLOCK_WIDTH - 1) / BLOCK_WIDTH) | 0, 4);
    const numBlocksY = Math.min(((height + BLOCK_HEIGHT - 1) / BLOCK_HEIGHT) | 0, 8);

    for (let i = 0; i < byteLength * 2; i++) {
        const src_ = texView.getUint8(offs + (i >>> 1));
        const src = ((i & 1) ? (src_ >>> 4) : src_) & 0x0F;

        const blockY = ((i / 0x40) | 0) % numBlocksY;
        const pageX = ((i / (0x40 * numBlocksY)) | 0) % numPagesX;
        const rowIndex = ((i % 2) * 2 + (i / (0x40 * numBlocksY * numPagesX) % 2) | 0);
        const column = ((i / (0x80 * numBlocksY * numPagesX)) | 0) % NUM_COLUMNS;
        const blockX = ((i / (0x200 * numBlocksY * numPagesX)) | 0) % numBlocksX;
        const pageY = ((i / (0x200 * numBlocksY * numPagesX * numBlocksX)) | 0) % numPagesY;
        const tile = (((i >>> 1) * 2) % 8) + (((column % 2) ^ ((i / 0x20) | 0) % 2) ? (1 - (i % 2)) : (i % 2));
        const j = ((i / 0x08) | 0) % 4;
        const index = j + (tile * 4) + (pageY * width * PAGE_HEIGHT) + pageX * PAGE_WIDTH + blockY * width * BLOCK_HEIGHT + blockX * BLOCK_WIDTH + column * width * 4 + rowIndex * width;

        dst[index >>> 1] |= ((index % 2) === 0) ? src : src << 4;
    }

    return dst;
}

function decodeIndexed4(texDataView: DataView, texClutView: DataView, width: number, height: number): Uint8Array {
    const pixels = new Uint8Array(width * height * 4);

    let srcOffs = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x += 2) {
            let p = texDataView.getUint8(srcOffs++);

            const p0 = (p >>> 0) & 0x0F;
            const p1 = (p >>> 4) & 0x0F;
            const dstOffs = (y*width + x) * 4;

            pixels[dstOffs + 0] = texClutView.getUint8(p0 * 4 + 0);
            pixels[dstOffs + 1] = texClutView.getUint8(p0 * 4 + 1);
            pixels[dstOffs + 2] = texClutView.getUint8(p0 * 4 + 2);
            pixels[dstOffs + 3] = Math.min(0xFF, texClutView.getUint8(p0 * 4 + 3) * 2);

            pixels[dstOffs + 4] = texClutView.getUint8(p1 * 4 + 0);
            pixels[dstOffs + 5] = texClutView.getUint8(p1 * 4 + 1);
            pixels[dstOffs + 6] = texClutView.getUint8(p1 * 4 + 2);
            pixels[dstOffs + 7] = Math.min(0xFF, texClutView.getUint8(p1 * 4 + 3) * 2);
        }
    }

    return pixels;
}

export function parse(buffer: ArrayBufferSlice): BIN {
    const view = buffer.createDataView();

    const numSectors = view.getUint32(0x00, true);

    // For now, always use LOD 0.
    let lodOffs = view.getUint32(0x04, true);

    const modelObjCount = view.getUint16(lodOffs + 0x00, true);
    const modelObjType = view.getUint16(lodOffs + 0x02, true);
    assert(modelObjType === 0x05);

    // 4 positions, 3 normals, 2 UV coordinates.
    const WORKING_VERTEX_STRIDE = 4+3+2;
    // 3 positions, 3 normals, 2 UV coordinates, 4 color (RGBA).
    // TODO(jstpierre): Put the color into U8 instead of F32.
    const VERTEX_STRIDE = 3+3+2+4;

    let modelObjTableIdx = lodOffs + 0x04;
    const models: BINModel[] = [];
    for (let i = 0; i < modelObjCount; i++) {
        const objOffs = lodOffs + view.getUint32(modelObjTableIdx + 0x00, true);

        const packetsBegin = objOffs + 0x20;
        const packetsSize = view.getUint16(objOffs + 0x0C, true) * 0x10;
        const packetsEnd = packetsBegin + packetsSize;

        interface BINModelPart {
            vertexRunData: Float32Array;
            vertexRunCount: number;
            indexRunData: Uint16Array;
            vertexRunColor: Color;
        }
        const modelVertexRuns: BINModelPart[] = [];
        
        // Parse VIF packets.
        let packetsIdx = packetsBegin;

        // State of current "vertex run".
        let vertexRunFlags0 = 0;
        let vertexRunFlags1 = 0;
        let vertexRunFlags2 = 0;
        let vertexRunCount = 0;
        let vertexRunData: Float32Array | null = null;
        let vertexRunColor = colorNew(1, 1, 1, 1);
        let modelTextureSettings: TextureSettings | null = null;

        const newVertexRun = () => {
            // Parse out the header.
            vertexRunFlags0 = view.getUint32(packetsIdx + 0x00, true);
            vertexRunFlags1 = view.getUint32(packetsIdx + 0x04, true);
            vertexRunFlags2 = view.getUint32(packetsIdx + 0x08, true);
            vertexRunCount = vertexRunFlags0 & 0x000000FF;
            vertexRunData = new Float32Array(vertexRunCount * WORKING_VERTEX_STRIDE);
        };

        while (packetsIdx < packetsEnd) {
            const imm = view.getUint16(packetsIdx + 0x00, true);
            const qwd = view.getUint8(packetsIdx + 0x02);
            const cmd = view.getUint8(packetsIdx + 0x03);
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

                const isVertexData = (imm >= 0x8000);
                const isPositions = (imm === 0x8000);

                // If this is not vertex data (not writing to address 0x8000 or higher), then we skip
                // for now. Perhaps we'll have a use for this in the future.
                if (!isVertexData) {
                    packetsIdx += qwd * getVifUnpackFormatByteSize(format);
                    continue;
                }

                if (format === 0x0C) { // V4-32
                    // V4-32 is either positions... or some sort of color?
                    if (isPositions) {
                        assert(vertexRunData === null);

                        newVertexRun();
                        packetsIdx += 0x10;

                        for (let j = 0; j < qwd - 1; j++) {
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 0] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 1] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 2] = view.getFloat32(packetsIdx + 0x08, true);
                            // W is special. It's a bunch of flag bits for misc. use by the VU1 program.
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 3] = view.getUint32(packetsIdx + 0x0C, true);
                            packetsIdx += 0x10;
                        }
                    } else {
                        // It should be some sort of diffuse color.
                        const expectedOffs = 0x8000 + 1 + vertexRunCount * 3;
                        assert(imm === expectedOffs);
                        assert(qwd === 0x01);

                        const diffuseColorR = view.getFloat32(packetsIdx + 0x00, true) / 128;
                        const diffuseColorG = view.getFloat32(packetsIdx + 0x04, true) / 128;
                        const diffuseColorB = view.getFloat32(packetsIdx + 0x08, true) / 128;
                        const diffuseColorA = view.getFloat32(packetsIdx + 0x0C, true) / 128;
                        colorFromRGBA(vertexRunColor, diffuseColorR, diffuseColorG, diffuseColorB, diffuseColorA);
                        packetsIdx += 0x10;
                    }
                } else if (format === 0x04) { // V2-32
                    // It should be texture coordinates.
                    const expectedOffs = 0x8000 + 1 + vertexRunCount * 1;
                    assert(imm === expectedOffs);

                    for (let j = 0; j < qwd; j++) {
                        vertexRunData[j * WORKING_VERTEX_STRIDE + 7] = view.getFloat32(packetsIdx + 0x00, true);
                        vertexRunData[j * WORKING_VERTEX_STRIDE + 8] = view.getFloat32(packetsIdx + 0x04, true);
                        packetsIdx += 0x08;
                    }
                } else if (format === 0x08) { // V3-32
                    // It might be either positions or vertex normals.
                    if (isPositions) {
                        assert(vertexRunData === null);

                        newVertexRun();
                        packetsIdx += 0x0C;

                        for (let j = 0; j < qwd - 1; j++) {
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 0] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 1] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 2] = view.getFloat32(packetsIdx + 0x08, true);
                            // W is special. It's a bunch of flag bits for misc. use by the VU1 program.
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 3] = 0;
                            packetsIdx += 0x0C;
                        }
                    } else {
                        // If it's not positions, it should be vertex normals.
                        const expectedOffs = 0x8000 + 1 + vertexRunCount * 2;
                        assert(imm === expectedOffs);

                        for (let j = 0; j < qwd; j++) {
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 4] = view.getFloat32(packetsIdx + 0x00, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 5] = view.getFloat32(packetsIdx + 0x04, true);
                            vertexRunData[j * WORKING_VERTEX_STRIDE + 6] = view.getFloat32(packetsIdx + 0x04, true);
                            packetsIdx += 0x0C;
                        }
                    }
                } else {
                    console.error(`Unsupported format ${hexzero(format, 2)}`);
                    throw "whoops";
                }
            } else if ((cmd & 0x7F) === 0x50) { // DIRECT
                // This transfers a GIFtag through GIF.
                assert(modelTextureSettings === null);

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

                    // addr contains the register to set. Unpack these registers.
                    if (addr === GSRegister.TEX0_1) {
                        const psm = (data0 >>> 20) & 0x3F;
                        const tw = (data0 >>> 26) & 0x0F;
                        const th = ((data0 >>> 30) & 0x03) | (((data1 >>> 0) & 0x03) << 2);
                        const width = 1 << tw;
                        const height = 1 << th;
                        modelTextureSettings = { psm, width, height, name: '' };
                    }
                    // TODO(jstpierre): Other register settings.

                    packetsIdx += 0x10;
                }

                // Make sure that we actually created something here.
                assertExists(modelTextureSettings);
            } else if ((cmd & 0x7F) === 0x17) { // MSCNT
                // Run an HLE form of the VU1 program.

                assert(vertexRunData !== null);

                const isStrip = (vertexRunFlags1 & 0x000000F0) === 0;

                // Go through and build an index buffer for it.
                const indexData = new Uint16Array(isStrip ? vertexRunCount * 3 - 2 : vertexRunCount);
                let indexDataIdx = 0;

                for (let j = 0; j < vertexRunCount; j++) {
                    const w = vertexRunData[j * WORKING_VERTEX_STRIDE + 3];

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
                modelVertexRuns.push({ vertexRunData, vertexRunCount, indexRunData, vertexRunColor });

                vertexRunFlags0 = 0;
                vertexRunFlags1 = 0;
                vertexRunFlags2 = 0;
                vertexRunCount = 0;
                vertexRunData = null;
            } else if ((cmd & 0x7F) === 0x00) { // NOP
                // Don't need to do anything.
            } else if ((cmd & 0x7F) === 0x11) { // FLUSH
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

        let vertexDataDst = 0;
        let indexOffset = 0;
        let indexDst = 0;
        const vertexData = new Float32Array(totalVertexCount * VERTEX_STRIDE);
        const indexData = new Uint16Array(totalIndexCount);
        for (let j = 0; j < modelVertexRuns.length; j++) {
            const vertexRun = modelVertexRuns[j];
            const vertexRunData = vertexRun.vertexRunData;
            const vertexRunColor = vertexRun.vertexRunColor;
            for (let k = 0; k < vertexRunData.length; k += WORKING_VERTEX_STRIDE) {
                // Position.
                vertexData[vertexDataDst++] = vertexRunData[k + 0] * -1;
                vertexData[vertexDataDst++] = vertexRunData[k + 1] * -1;
                vertexData[vertexDataDst++] = vertexRunData[k + 2];
                // Skip W, it was for internal use only.
                // Normal.
                vertexData[vertexDataDst++] = vertexRunData[k + 4];
                vertexData[vertexDataDst++] = vertexRunData[k + 5];
                vertexData[vertexDataDst++] = vertexRunData[k + 6];
                // Texture coord.
                vertexData[vertexDataDst++] = vertexRunData[k + 7];
                vertexData[vertexDataDst++] = vertexRunData[k + 8];
                console.log(k / WORKING_VERTEX_STRIDE, vertexRunData[k + 0], vertexRunData[k + 1], vertexRunData[k + 2], vertexRunData[k + 7], vertexRunData[k + 8]);
                // Color.
                vertexData[vertexDataDst++] = vertexRunColor.r;
                vertexData[vertexDataDst++] = vertexRunColor.g;
                vertexData[vertexDataDst++] = vertexRunColor.b;
                vertexData[vertexDataDst++] = vertexRunColor.a;
            }

            const indexRunData = vertexRun.indexRunData;
            for (let k = 0; k < indexRunData.length; k++)
                indexData[indexDst++] = indexOffset + indexRunData[k];

            indexOffset += vertexRun.vertexRunCount;
        }

        const textureSettings = assertExists(modelTextureSettings);
        models.push({ vertexData, indexData, textureSettings });

        modelObjTableIdx += 0x04;
    }

    // TODO(jstpierre): Are there multiple textures, one per LOD?
    let textureData: BINTexture | null = null;
    if (numSectors >= 7) {
        const lodModel = assertExists(models[0]);
        const textureSettings = lodModel.textureSettings;

        assert(textureSettings.width > 0 && textureSettings.height > 0);
        assert(textureSettings.width <= 0x400 && textureSettings.height <= 0x400);

        // PSMT4
        if (textureSettings.psm === 0x14) {
            const texDataOffs = view.getUint32(0x10, true);
            const texData = parseImageData(buffer, texDataOffs);
            assert(texData.byteLength > 0);
            const texDataView = new DataView(texData);
            const deswizzled = deswizzleIndexed4(texDataView, 0, textureSettings.width, textureSettings.height);

            const clutDataOffsA = view.getUint32(0x1C, true);
            const clutDataOffsB = view.getUint32(0x18, true);
            // TODO(jstpierre): Which CLUT do I want?
            const clutDataOffs = clutDataOffsB;
            const clutData = parseImageData(buffer, clutDataOffs);
            const clutDataView = new DataView(clutData);
            const deswizzledView = new DataView(deswizzled.buffer);
            const pixels = decodeIndexed4(deswizzledView, clutDataView, textureSettings.width, textureSettings.height);
            const name = `${hexzero(texDataOffs, 4)}/${hexzero(clutDataOffs, 4)}`;

            textureData = { name, width: textureSettings.width, height: textureSettings.height, pixels };

            // Fill in the texture name.
            for (let i = 0; i < models.length; i++)
                models[i].textureSettings.name = name;
        }
    }

    return { models, textureData };
}
