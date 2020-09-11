import * as BinTex from './bin_tex'

import { AABB } from "../../Geometry";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { vec2, vec3, vec4 } from "gl-matrix";

export interface BIN {
    mapMeshes: Mesh[];
    mapTextureBlocks: BinTex.TextureBlock[];
    mapTextureAtlas: BinTex.TextureAtlas;

    sky0Meshes: Mesh[];
    sky0TextureBlocks: BinTex.TextureBlock[];

    sky1Meshes: Mesh[];
    sky1TextureBlocks: BinTex.TextureBlock[];

    uvAnimInfo: UVAnimInfo;
}

interface UVAnimInfo {
    uvScrollTable: Float32Array;
    sky1RotYFactor: number;
}

export class Submesh {
    public textureBlock: BinTex.TextureBlock | null = null;
    public textureIndex = -1;
    public vtx: vec3[] = [];
    public ind: number[] = [];
    public vcol: vec4[] = [];
    public uv: vec2[] = [];
    public uvScrollIndex: vec2[] = [];
}

export class Mesh {
    public submeshes: Submesh[] = [];
    public layer: number = 0;
    public boundingBox: AABB;
    public translucent: boolean;
}

function initMesh(view: DataView, boundingBoxOffs: number, meshOut: Mesh) {
    const bx = [];
    const by = [];
    const bz = [];
    for (let i = 0; i < 8; i++) {
        bx.push(view.getFloat32(boundingBoxOffs + i * 0x10, true));
        by.push(view.getFloat32(boundingBoxOffs + i * 0x10 + 0x4, true));
        bz.push(view.getFloat32(boundingBoxOffs + i * 0x10 + 0x8, true));
    }
    meshOut.boundingBox = new AABB(
        Math.min.apply(null, bx), Math.min.apply(null, by), Math.min.apply(null, bz),
        Math.max.apply(null, bx), Math.max.apply(null, by), Math.max.apply(null, bz));
    meshOut.layer = Math.floor(view.getFloat32(boundingBoxOffs + 0x4C, true));
}

function processTriangleStrips(view: DataView, offs: number, submeshOut: Submesh): number {
    if (!submeshOut) {
        return 0;
    }
    const qwc = view.getUint8(offs);
    offs += 2;
    for (let i = 0; i < qwc; i++) {
        submeshOut.vtx.push(vec3.fromValues(
            view.getFloat32(offs, true),
            view.getFloat32(offs + 0x4, true),
            view.getFloat32(offs + 0x8, true)
        ));
        const w = view.getFloat32(offs + 0xC, true);
        if (i > 0 && Math.abs(w) > 1e-6) {
            const doubleSided = view.getUint8(offs + 0xC) == 0x2;
            if (w < 0 || doubleSided) {
                submeshOut.ind.push(i);
                submeshOut.ind.push(i - 1);
                submeshOut.ind.push(i - 2);
            }
            if (w > 0 || doubleSided) {
                submeshOut.ind.push(i - 2);
                submeshOut.ind.push(i - 1);
                submeshOut.ind.push(i);
            }
        }
        offs += 0x10;
    }
    return offs;
}

function processVertexColors(view: DataView, offs: number, submeshOut: Submesh): number {
    if (!submeshOut) {
        return 0;
    }
    const qwc = view.getUint8(offs);
    offs += 2;
    for (let i = 0; i < qwc; i++) {
        submeshOut.vcol.push(vec4.fromValues(
            view.getUint8(offs + i * 0x4) / 256,
            view.getUint8(offs + i * 0x4 + 0x1) / 256,
            view.getUint8(offs + i * 0x4 + 0x2) / 256,
            view.getUint8(offs + i * 0x4 + 0x3) / 128
        ));
    }
    return offs + qwc * 0x4;
}

function processUVs(view: DataView, offs: number, submeshOut: Submesh): number {
    if (!submeshOut) {
        return 0;
    }
    const qwc = view.getUint8(offs);
    const cmd = view.getUint8(offs + 0x1);
    const anim = (cmd & 0x8) > 0;
    const width = anim ? 8 : 4;
    offs += 2;
    for (let i = 0; i < qwc; i++) {
        submeshOut.uv.push(vec2.fromValues(
            view.getInt16(offs + i * width, true) / 4096,
            view.getInt16(offs + i * width + 0x2, true) / 4096
        ));
        submeshOut.uvScrollIndex.push(vec2.fromValues(
            anim ? view.getUint16(offs + i * width + 0x4, true) : 0,
            anim ? view.getUint16(offs + i * width + 0x6, true) : 0
        ));
    }
    return offs + qwc * width;
}

function processTextureTag(view: DataView, offs: number, mesh: Mesh, submeshOut: Submesh, textureBlocksOut: BinTex.TextureBlock[]): number {
    if (view.getUint8(offs) == 0x5) {
        // Indexed data and color table are unpacked directly, not from a texture bank.
        return processTextureUnpack(view, offs, mesh, submeshOut, textureBlocksOut);
    }
    let propertiesOffs = offs + 0x14;
    let boundsOffs = offs + 0x24;
    // Quick hack to handle cases where these two blocks are occasionally stored out of order.
    if (view.getUint8(offs + 0x1C) > view.getUint8(offs + 0x2C)) {
        propertiesOffs = offs + 0x24;
        boundsOffs = offs + 0x14;
    }
    const bank = (view.getUint8(propertiesOffs + 0x2) & 0x80) > 0 ? 1 : 0;
    const dataOffsBase = view.getUint16(propertiesOffs, true) * 0x100;
    const dataOffs = (bank == 0) ? dataOffsBase - 0x260000 : dataOffsBase / 4;
    const colorTableOffs = ((view.getUint16(propertiesOffs + 0x4, true) & 0x3FF0) >> 4) * 0x80;

    let textureBlock: BinTex.TextureBlock | null = null;
    for (let i = 0; i < textureBlocksOut.length; i++) {
        if (textureBlocksOut[i].bank == bank && textureBlocksOut[i].dataOffs == dataOffs) {
            textureBlock = textureBlocksOut[i];
            break;
        }
    }
    if (!textureBlock) {
        const bitDepth = (view.getUint8(propertiesOffs + 0x2) & 0x40) > 0 ? 4 : 8;
        const deswizzle = bank === 0 && dataOffs >= 0x100000;
        textureBlock = new BinTex.TextureBlock(/*width=*/bitDepth == 8 ? 256 : 512, /*height=*/256, bitDepth, bank, dataOffs, deswizzle);
        textureBlocksOut.push(textureBlock);
    }
    let textureIndex = 0;
    for (let i = 0; i < textureBlock.textures.length; i++) {
        if (textureBlock.textures[i].colorTableOffs == colorTableOffs) {
            break;
        }
        textureIndex++;
    }
    if (textureIndex == textureBlock.textures.length) {
        const texture = new BinTex.Texture(textureIndex, textureBlock, colorTableOffs, mesh.translucent);
        parseTextureBounds(view, boundsOffs, texture);
        textureBlock.textures.push(texture);
    }
    submeshOut.textureBlock = textureBlock;
    submeshOut.textureIndex = textureIndex;
    return offs + 0x34;
}

function processTextureUnpack(view: DataView, offs: number, mesh: Mesh, submeshOut: Submesh, textureBlocksOut: BinTex.TextureBlock[]): number {
    let texDataOffs = 0;
    let texClutOffs = 0;
    let texWidth = 0;
    let texSize = 0;
    let texBitDepth = 0;
    let deswizzle: boolean = true;
    for (let i = 0; i < 3; i++) {
        let blockId = view.getUint8(offs);
        if (blockId === 0x5) {
            let blockType = view.getUint8(offs + 0x15);
            if (blockType === 0x36) {
                texDataOffs = offs + 0x68;
                texWidth = view.getUint8(offs + 0x34) * 2;
                texSize = texWidth * view.getUint8(offs + 0x38) * 2;
                if ((view.getUint8(offs + 0x17) & 0x10) > 0) {
                    deswizzle = false;
                    texWidth /= 2;
                    texSize = Math.floor(texSize / ((view.getUint8(offs + 0x17) & 0x4) > 0 ? 8 : 4));
                }
            } else if (blockType === 0x3A) {
                texClutOffs = offs + 0x68;
            }
            const dataSize = (view.getUint16(offs + 0x54, true) & 0xFFFE) * 0x10;
            offs += dataSize + 0x68;
        } else if (blockId == 0x4) {
            let propertiesOffs = offs + 0x24;
            let boundsOffs = offs + 0x34;
            // Quick hack to handle cases where these two blocks are occasionally stored out of order.
            if (view.getUint8(offs + 0x2C) > view.getUint8(offs + 0x3C)) {
                propertiesOffs = offs + 0x34;
                boundsOffs = offs + 0x24;
            }
            texBitDepth = (view.getUint8(propertiesOffs + 0x2) & 0x40) > 0 ? 4 : 8;
            const texHeight = Math.floor(texSize / texWidth) * (texBitDepth == 4 ? 2 : 1);

            const textureBlock = new BinTex.TextureBlock(texWidth, texHeight, texBitDepth, /*bank=*/-1, texDataOffs, deswizzle);
            textureBlocksOut.push(textureBlock);

            const texture = new BinTex.Texture(/*index=*/0, textureBlock, texClutOffs, mesh.translucent);
            parseTextureBounds(view, boundsOffs, texture);
            textureBlock.textures.push(texture);
            submeshOut.textureBlock = textureBlock;
            submeshOut.textureIndex = 0;

            offs += 0x44;
        }
    }
    return offs;
}

function parseTextureBounds(view: DataView, offs: number, textureOut: BinTex.Texture) {
    textureOut.tiledU = (view.getUint8(offs) & 0xF0) == 0xF0;
    textureOut.tiledV = (view.getUint8(offs + 0x3) & 0xF) == 0xF;
    if (textureOut.tiledU) {
        textureOut.clipRight = ((view.getUint8(offs + 0x1) & 0xF) + 1) * 0x10 - 1;
    } else {
        textureOut.clipLeft = (view.getUint8(offs + 0x1) & 0x3F) * 0x10;
        textureOut.clipRight = (view.getUint8(offs + 0x2) + 1) * 4 - 1;
    }
    if (textureOut.tiledV) {
        textureOut.clipBottom = (((view.getUint8(offs + 0x3) & 0xF0) >> 4) + 1) * 0x10 - 1;
    } else {
        textureOut.clipTop = ((view.getUint8(offs + 0x3) >> 4) & 0xF) * 0x10;
        textureOut.clipBottom = ((view.getUint16(offs + 0x4, true) >> 4) + 1) * 4 - 1;
    }
}

function parseVifPackets(view: DataView, offs: number, endOffs: number, first: boolean, meshOut: Mesh, textureBlocksOut: BinTex.TextureBlock[]) {
    let submesh: Submesh | null = null;
    let lastTextureBlock: BinTex.TextureBlock | null = null;
    let lastTextureIndex = -1;
    while (offs < endOffs) {
        let cmd = view.getUint16(offs, true);
        offs += 2;
        switch(cmd) {
            case 0x0101: {  // STCYCLE (write)
                offs += 2;
                break;
            }
            case 0x8000: {  // Begin unpack
                submesh = new Submesh();
                meshOut.submeshes.push(submesh);
                offs += first ? 0x12 : 0x16;
                break;
            }
            case 0x8001:  {  // Triangle strips
                offs = processTriangleStrips(view, offs, submesh!);
                break;
            }
            case 0xC002: {  // Vertex colors
                offs = processVertexColors(view, offs, submesh!);
                break;
            }
            case 0x8003: {  // UVs
                offs = processUVs(view, offs, submesh!);
                break;
            }
            case 0x1100: {  // FLUSH (texture tag)
                offs = processTextureTag(view, offs, meshOut, submesh!, textureBlocksOut);
                lastTextureBlock = submesh!.textureBlock;
                lastTextureIndex = submesh!.textureIndex;
                break;
            }
            case 0x0: {
                break;
            }
            case 0x1700: {  // MSCNT (End submesh)
                if (!submesh!.textureBlock) {
                    submesh!.textureBlock = lastTextureBlock;
                    submesh!.textureIndex = lastTextureIndex;
                }
                break;
            }
            default: {
                console.error(`VIF parse error: Unknown command ${cmd.toString(16)} at offset ${offs.toString(16)}`);
                return;
            }
        }
    }
}

function parseGeometrySector(view: DataView, geomSectorOffs: number, isSkybox: boolean, meshesOut: Mesh[], textureBlocksOut: BinTex.TextureBlock[]) {
    const vifTableCount = isSkybox ? 4 : view.getUint16(geomSectorOffs, true) * 2 + 2;
    const vifTableOffs = geomSectorOffs + (isSkybox ? 0x80 : view.getUint32(geomSectorOffs + 0x4, true));
    const boundingBoxTableOffs = geomSectorOffs + (isSkybox ? 0 : 0x10);

    const columnCount = vifTableCount / 2;
    for (let i = 0; i < vifTableCount; i++) {
        const index = i >= columnCount ? (i - columnCount) * 2 + 1 : i * 2;
        const size = (view.getUint32(vifTableOffs + index * 8, true) & 0xFFFFFFF) * 0x10;
        if (size == 0) {
            continue;
        }
        const offs = geomSectorOffs + view.getUint32(vifTableOffs + index * 8 + 0x4, true);
        const endOffs = offs + size;

        const mesh = new Mesh;
        mesh.translucent = (index % 2) == 1;
        if (index > 1) {
            const boundingBoxOffs = boundingBoxTableOffs + (Math.floor(index / 2) - 1) * 0x80;
            initMesh(view, boundingBoxOffs, mesh);
        }
        parseVifPackets(view, offs, endOffs, /*first=*/index == 0, mesh, textureBlocksOut);
        meshesOut.push(mesh);
    }
}

function buildTextures(binBuffer: ArrayBufferSlice, imgBuffer: ArrayBufferSlice, mapTextureBlocks: BinTex.TextureBlock[], sky0TextureBlocks: BinTex.TextureBlock[], sky1TextureBlocks: BinTex.TextureBlock[]) {
    const binView = binBuffer.createDataView();
    const imgView = imgBuffer.createDataView();

    const texDataOffs = imgView.getUint32(0x18, true);
    const texDataSize = imgView.getUint32(0x1C, true);
    const texClutOffs = imgView.getUint32(0x10, true);
    const texClutSize = imgView.getUint32(0x14, true);

    const texDataOvfSize = Math.max(0, texDataSize - (imgBuffer.byteLength - texDataOffs));
    const mapSectorOffs = binView.getUint32(0x18, true);
    const mapSectorSize = binView.getUint32(0x1C, true);

    const texDataView = imgBuffer.createDataView(texDataOffs, texDataSize - texDataOvfSize);
    const texClutView = imgBuffer.createDataView(texClutOffs, texClutSize);
    const texDataOvfView = binBuffer.createDataView(mapSectorOffs + mapSectorSize - texDataOvfSize, texDataOvfSize);
    mapTextureBlocks.forEach(function(textureBlock) {
        if (textureBlock.isOvf()) {
            textureBlock.build(texDataOvfView, texClutView);
        } else {
            textureBlock.build(texDataView, texClutView);
        }
    })
    sky0TextureBlocks.forEach(function(textureBlock) {
        textureBlock.build(binView, binView);
    });
    sky1TextureBlocks.forEach(function(textureBlock) {
        textureBlock.build(binView, binView);
    });
}

function parseUVAnimSectors(view: DataView, mapTextureBlocks: BinTex.TextureBlock[]): UVAnimInfo {
    const uvAnimTableSectorOffs = view.getUint32(0x08, true);

    const sky1RotYFactor = view.getFloat32(uvAnimTableSectorOffs + 0x34, true);
    const uvScrollTable = new Float32Array(0x22);
    for (let i = 0; i < 0x20; ++i) {
        uvScrollTable[i + 2] = view.getFloat32(uvAnimTableSectorOffs + 0x40 + i * 4, true);
    }

    const uvSpriteSectorOffs = view.getUint32(0, true);
    const uvSpriteSectorSize = view.getUint32(0x04, true);
    const spriteCount = uvSpriteSectorSize / 0xA0;
    for (let i = 0; i < spriteCount; ++i) {
        const offs = uvSpriteSectorOffs + i * 0xA0;
        const numFrames = Math.min(0x20, view.getUint32(offs, true));
        if (numFrames == 0) {
            continue;
        }
        const spriteLeft = view.getUint16(offs + 0x4, true);
        const spriteTop = view.getUint16(offs + 0x6, true);
        const dataOffsetU = view.getUint16(offs + 0x10, true);
        const dataWidthU = view.getUint16(offs + 0x12, true);
        const bank = (dataWidthU & 0x800) > 0 ? 1 : 0;
        const texDataOffs = bank == 0 ? dataOffsetU * 0x100 - 0x260000 : dataOffsetU * 0x100 / 4;
        // Locate texture for this sprite sheet.
        let textureBlock = null;
        let texture = null;
        for (let j = 0; j < mapTextureBlocks.length && !texture; j++) {
            if (mapTextureBlocks[j].bank != bank || mapTextureBlocks[j].dataOffs != texDataOffs) {
                continue;
            }
            for (let k = 0; k < mapTextureBlocks[j].textures.length; k++) {
                const curTex = mapTextureBlocks[j].textures[k];
                if (curTex.clipLeft == spriteLeft && curTex.clipTop == spriteTop) {
                    textureBlock = mapTextureBlocks[j];
                    texture = curTex;
                    break;
                }
            }
        }
        if (!textureBlock || !texture) {
            continue;
        }
        const spriteWidth = view.getUint32(offs + 0x18, true);
        const spriteHeight = view.getUint32(offs + 0x1C, true);
        const speed = view.getUint32(offs + 0x8, true);
        const spriteLeftAnim = new Uint16Array(numFrames);
        const spriteTopAnim = new Uint16Array(numFrames);
        for (let j = 0; j < numFrames; j++) {
            spriteLeftAnim[j] = view.getUint16(offs + 0x20 + j * 4, true);
            spriteTopAnim[j] = view.getUint16(offs + 0x22 + j * 4, true);
        }
        texture.spriteAnim = new BinTex.TextureSpriteAnim(textureBlock, texture, spriteLeftAnim, spriteTopAnim, numFrames, spriteWidth, spriteHeight, speed);
    }

    return { uvScrollTable, sky1RotYFactor };
}

export function parse(binBuffer: ArrayBufferSlice, imgBuffer: ArrayBufferSlice): BIN {
    const binView = binBuffer.createDataView();
    const imgView = imgBuffer.createDataView();

    const mapSectorOffs = binView.getUint32(0x18, true);
    const sky0SectorOffs = binView.getUint32(0x20, true);
    const sky1SectorOffs = binView.getUint32(0x28, true);
    
    const mapMeshes: Mesh[] = [];
    const mapTextureBlocks: BinTex.TextureBlock[] = [];
    parseGeometrySector(binView, mapSectorOffs, /*isSkybox=*/false, mapMeshes, mapTextureBlocks);

    const sky0Meshes: Mesh[] = [];
    const sky0TextureBlocks: BinTex.TextureBlock[] = [];
    parseGeometrySector(binView, sky0SectorOffs, /*isSkybox=*/true, sky0Meshes, sky0TextureBlocks);

    const sky1Meshes: Mesh[] = [];
    const sky1TextureBlocks: BinTex.TextureBlock[] = [];
    parseGeometrySector(binView, sky1SectorOffs, /*isSkybox=*/true, sky1Meshes, sky1TextureBlocks);

    buildTextures(binBuffer, imgBuffer, mapTextureBlocks, sky0TextureBlocks, sky1TextureBlocks);
    const mapTextureAtlas = new BinTex.TextureAtlas(mapTextureBlocks);

    const uvAnimInfo = parseUVAnimSectors(imgView, mapTextureBlocks);

    return { mapMeshes, mapTextureBlocks, mapTextureAtlas, sky0Meshes, sky0TextureBlocks, sky1Meshes, sky1TextureBlocks, uvAnimInfo };
}