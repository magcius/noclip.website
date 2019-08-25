import { vec2, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert } from "../util";
import { psmToString, gsMemoryMapReadImagePSMT8_PSMCT32, gsMemoryMapReadImagePSMT4_PSMCT32, gsMemoryMapUploadImage, GSRegisterBITBLTBUF, getGSRegisterBITBLTBUF, getGSRegisterTRXPOS, getGSRegisterTRXREG, GSRegister, GSMemoryMap, gsMemoryMapNew, GSRegisterTRXPOS, GSRegisterTRXREG, GSRegisterTEX0, GSRegisterCLAMP, getGSRegisterTEX0, getGSRegisterCLAMP, GSPixelStorageFormat, GSWrapMode, GSTextureColorComponent } from "../ps2/gs";

export interface KingdomHeartsIIMap {
    mapGroup: MapGroup;
    sky0Group: MapGroup;
    sky1Group: MapGroup;

    // textureAnims : TextureAnim[];
}

export class MapGroup {
    public meshes: MapMesh[] = [];
    public textureBlocks: TextureBlock[] = [];
    public uvScrollArray: Float32Array = new Float32Array(32);
    // Texture index -> (TextureBlock, Texture)
    public textureIndexMap: Map<number, [TextureBlock, Texture]> = new Map;
}

export class MapMesh {
    public textureBlock: TextureBlock | null = null;
    public texture: Texture | null = null;
    public vtx: vec3[] = [];
    public ind: number[] = [];
    public vcol: vec4[] = [];
    public uv: vec2[] = [];
    public normal: vec3[] = [];
    public layer = 0;
    public translucent: boolean = false;
    public uvScroll = vec2.fromValues(0, 0);
}

export class TextureBlock {
    public textures: Texture[] = [];
    public format: string;
    public width = 0;
    public height = 0;
    public atlasX = 0;  // Set by renderer
    public atlasY = 0;  // Set by renderer
    public pixels: Uint8Array;
}

export class Texture {
    public clipLeft = 0;
    public clipRight = 0;
    public clipTop = 0;
    public clipBottom = 0;
    public tiledU: boolean = false;
    public tiledV: boolean = false;
    public tex0: GSRegisterTEX0;
    public textureAnim: TextureAnimation | null = null;

    constructor(public index: number, public parent: TextureBlock) {}

    public width(): number {
        return this.clipRight - this.clipLeft + 1;
    }

    public height(): number {
        return this.clipBottom - this.clipTop + 1;
    }

    public pixels(): Uint8Array {
        if (!this.parent || !this.parent.pixels || this.parent.pixels.length === 0) {
            return null;
        }
        const width = this.clipRight - this.clipLeft + 1;
        const height = this.clipBottom - this.clipTop + 1;
        if (width === this.parent.width && height === this.parent.height) {
            return new Uint8Array(this.parent.pixels);
        }
        let clipped = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            const src = ((y + this.clipTop) * this.parent.width + this.clipLeft) * 4;
            const dst = y * width * 4;
            clipped.set(this.parent.pixels.slice(src, src + width * 4), dst);
        }
        return clipped;
    }
}

interface TextureAnimationFrame {
    spriteIndex: number;
    minLength: number;
    maxLength: number;
}

export class TextureAnimation {
    public sheetWidth: number;
    public sheetHeight: number;
    public pixels: Uint8Array;
    public frames: TextureAnimationFrame[] = [];
    public index: number = 0;  // Set by renderer

    private spritesPerRow: number;
    private spriteIndex = 0;

    private frameIndex = 0;
    private frameTimer = 0;

    constructor(public spriteWidth: number, public spriteHeight: number, public spriteOffsetX: number, public spriteOffsetY: number, public numSprites: number) {
        this.spritesPerRow = Math.ceil(Math.sqrt(numSprites));
        this.sheetWidth = this.spritesPerRow * spriteWidth;
        this.sheetHeight = Math.ceil(numSprites / this.spritesPerRow) * spriteHeight;
        this.pixels = new Uint8Array(this.sheetWidth * this.sheetHeight * 4);
    }

    public addSprite(srcPixels: Uint8Array, srcX: number, srcY: number, srcWidth: number) {
        assert(this.spriteIndex < this.numSprites, `Unexpected number of sprites added to TEXA: ${this.spriteIndex}`);
        const dstX = (this.spriteIndex % this.spritesPerRow) * this.spriteWidth;
        const dstY = Math.floor(this.spriteIndex / this.spritesPerRow) * this.spriteHeight;
        for (let y = 0; y < this.spriteHeight; y++) {
            for (let x = 0; x < this.spriteWidth; x++) {
                const dstOffs = ((y + dstY) * this.sheetWidth + x + dstX) * 4;
                const srcOffs = ((y + srcY) * srcWidth + x + srcX) * 4;
                this.pixels[dstOffs] = srcPixels[srcOffs];
                this.pixels[dstOffs + 1] = srcPixels[srcOffs + 1];
                this.pixels[dstOffs + 2] = srcPixels[srcOffs + 2];
                this.pixels[dstOffs + 3] = srcPixels[srcOffs + 3];
            }
        }
        this.spriteIndex++;
    }

    public advanceTime(deltaTime: number) {
        if (this.frames.length === 0) {
            return;
        }
        this.frameTimer -= deltaTime / 1000;
        if (this.frameTimer > 0) {
            return;
        }
        this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        const minTime = this.frames[this.frameIndex].minLength / 60;
        const maxTime = this.frames[this.frameIndex].maxLength / 60;
        this.frameTimer += Math.random() * (maxTime - minTime) + minTime;
    }

    public fillUVOffset(uvOffset: vec2) {
        if (this.frames.length === 0) {
            return;
        }
        uvOffset[0] = (this.frames[this.frameIndex].spriteIndex % this.spritesPerRow) / this.spritesPerRow;
        uvOffset[1] = Math.floor(this.frames[this.frameIndex].spriteIndex / this.spritesPerRow) * this.spriteHeight / this.sheetHeight;
    }
}

class BarFileset {
    public mapGeometry: BarFile;
    public mapTextures: BarFile;
    public sky0Geometry: BarFile;
    public sky0Textures: BarFile;
    public sky1Geometry: BarFile;
    public sky1Textures: BarFile;
    public mapDoct: BarFile;

    public addFile(barFile: BarFile) {
        if (barFile.filename === 0x50414D) {  // MAP
            if (barFile.type === 0x4) {
                this.mapGeometry = barFile;
            } else if (barFile.type === 0x7) {
                this.mapTextures = barFile;
            }
        } else if (barFile.filename === 0x304B53) {  // SK0
            if (barFile.type === 0x4) {
                this.sky0Geometry = barFile;
            } else if (barFile.type === 0x7) {
                this.sky0Textures = barFile;
            }
        } else if (barFile.filename === 0x314B53) {  // SK1
            if (barFile.type === 0x4) {
                this.sky1Geometry = barFile;
            } else if (barFile.type === 0x7) {
                this.sky1Textures = barFile;
            }
        } else if (barFile.type === 0x5) {
            this.mapDoct = barFile;
        }
    }
}

interface BarFile {
    type: number,
    filename: number,
    offset: number,
    bytesize: number
}

export function parseMap(buffer: ArrayBufferSlice): KingdomHeartsIIMap {
    if (buffer.byteLength < 0x80) {
        return null;
    }
    const view = buffer.createDataView();

    // Parse files in BAR header.
    const numFiles = view.getUint32(0x4, true);
    const barFileset = new BarFileset;
    for (let i = 0; i < numFiles; i++) {
        barFileset.addFile({
            type: view.getUint32(i * 0x10 + 0x10, true),
            filename: view.getUint32(i * 0x10 + 0x14, true),
            offset: view.getUint32(i * 0x10 + 0x18, true),
            bytesize: view.getUint32(i * 0x10 + 0x1C, true)
        })
    }

    const gsMemoryMap: GSMemoryMap = gsMemoryMapNew();
    let mapGroup = new MapGroup;
    let sky0Group = new MapGroup;
    let sky1Group = new MapGroup;
    if (barFileset.mapGeometry && barFileset.mapTextures) {
        parseMapGroup(buffer, barFileset.mapGeometry, barFileset.mapTextures, gsMemoryMap, mapGroup);
        if (barFileset.mapDoct) {
            parseDOCT(buffer, barFileset.mapDoct, barFileset.mapGeometry, mapGroup);
        }
    }
    if (barFileset.sky0Geometry && barFileset.sky0Textures) {
        parseMapGroup(buffer, barFileset.sky0Geometry, barFileset.sky0Textures, gsMemoryMap,sky0Group);
    }
    if (barFileset.sky1Geometry && barFileset.sky1Textures) {
        parseMapGroup(buffer, barFileset.sky1Geometry, barFileset.sky1Textures, gsMemoryMap, sky1Group);
    }
    return {mapGroup, sky0Group, sky1Group};
}

function parseMapGroup(buffer: ArrayBufferSlice, geometryFile: BarFile, textureFile: BarFile, gsMemoryMap: GSMemoryMap, mapGroup: MapGroup) {
    parseTextures(buffer, textureFile, gsMemoryMap, mapGroup);
    parseTextureAnimTags(buffer, textureFile, gsMemoryMap, mapGroup);
    parseGeometry(buffer, geometryFile, mapGroup);
}

function parseTextures(buffer: ArrayBufferSlice, textureFile: BarFile, gsMemoryMap: GSMemoryMap, mapGroup: MapGroup) {
    const view = buffer.createDataView(textureFile.offset);

    // Texture Block index -> [Texture index]
    const textureBlockMap: Map<number, Array<number>> = new Map;
    const numTextureBlocks = view.getUint32(0x08, true);
    const numTextures = view.getUint32(0x0C, true);
    const textureToBlockTableOffset = view.getUint32(0x10, true);

    // Reserve first entry in block map for CLUT (first image transfer).
    for (let i = 0; i < numTextureBlocks + 1; i++) {
        textureBlockMap.set(i, []);
    }
    for (let i = 0; i < numTextures; i++) {
        const blockIndex = view.getUint8(textureToBlockTableOffset + i) + 1;
        textureBlockMap.get(blockIndex).push(i);
    }

    const gsWriteTableOffs = view.getUint32(0x14, true);
    const gsReadTableOffs = view.getUint32(0x18, true);
    for (const kv of textureBlockMap.entries()) {
        const blockIndex = kv[0];
        const blockOffs = gsWriteTableOffs + blockIndex * 0x90;
        processTextureUpload(buffer, blockOffs, gsMemoryMap, textureFile);

        let textureBlock: TextureBlock = null;
        for (const textureIndex of kv[1]) {
            const textureOffs = gsReadTableOffs + textureIndex * 0xA0;
            // Parse GIFtag and GS data minimally for image read.
            const nloop = view.getUint32(textureOffs + 0x10, true) & 0x3FFF;
            const reg = view.getUint8(textureOffs + 0x18);
            assert(nloop === 0x7, "Expected GIFtag with nloop 7 for texture read");
            assert(reg === 0xE, "Expected A+E register in GIFtag for texture read");
            let tex0: GSRegisterTEX0;
            let clamp: GSRegisterCLAMP;
            for (let i = 0; i < nloop; i++) {
                const dataLower = view.getUint32(textureOffs + 0x10 * i + 0x20, true);
                const dataUpper = view.getUint32(textureOffs + 0x10 * i + 0x24, true);
                const gsReg = view.getUint8(textureOffs + 0x10 * i + 0x28);
                if (gsReg === GSRegister.TEX0_1) {
                    tex0 = getGSRegisterTEX0(dataLower, dataUpper);
                } else if (gsReg === GSRegister.CLAMP_1) {
                    clamp = getGSRegisterCLAMP(dataLower, dataUpper);
                }
            }
            if (!textureBlock) {
                textureBlock = new TextureBlock;
                textureBlock.format = psmToString(tex0.psm);
                textureBlock.width = 1 << tex0.tw;
                textureBlock.height = 1 << tex0.th;
                textureBlock.pixels = new Uint8Array(textureBlock.width * textureBlock.height * 4);
                mapGroup.textureBlocks.push(textureBlock);
            }
            const texture = new Texture(textureIndex, textureBlock);
            if (clamp.wms === GSWrapMode.REGION_REPEAT) {
                texture.tiledU = true;
                texture.clipLeft = clamp.maxu;
                texture.clipRight = clamp.minu;
            } else {
                texture.clipLeft = clamp.minu;
                texture.clipRight = clamp.maxu;
            }
            if (clamp.wmt === GSWrapMode.REGION_REPEAT) {
                texture.tiledV = true;
                texture.clipTop = clamp.maxv;
                texture.clipBottom = clamp.minv;
            } else {
                texture.clipTop = clamp.minv;
                texture.clipBottom = clamp.maxv;
            }
            textureBlock.textures.push(texture);
            const pixels = new Uint8Array(textureBlock.pixels.length);
            const alphaReg = tex0.tcc === GSTextureColorComponent.RGBA ? -1 : 0x80;
            if (tex0.psm === GSPixelStorageFormat.PSMT8) {
                gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMemoryMap, tex0.tbp0, tex0.tbw, textureBlock.width, textureBlock.height, tex0.cbp, alphaReg);
            } else if (tex0.psm === GSPixelStorageFormat.PSMT4) {
                gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMemoryMap, tex0.tbp0, tex0.tbw, textureBlock.width, textureBlock.height, tex0.cbp, tex0.csa, alphaReg);
            }
            texture.tex0 = tex0;
            for (let y = texture.clipTop; y <= texture.clipBottom; y++) {
                for (let x = texture.clipLeft; x <= texture.clipRight; x++) {
                    const offs = (y * textureBlock.width + x) * 4;
                    textureBlock.pixels[offs] = pixels[offs];
                    textureBlock.pixels[offs + 1] = pixels[offs + 1];
                    textureBlock.pixels[offs + 2] = pixels[offs + 2];
                    textureBlock.pixels[offs + 3] = pixels[offs + 3];
                }
            }
            mapGroup.textureIndexMap.set(textureIndex, [textureBlock, texture]);
        }
    }
}

function processTextureUpload(buffer: ArrayBufferSlice, offs: number, gsMemoryMap: GSMemoryMap, textureFile: BarFile) {
    const view = buffer.createDataView(textureFile.offset);

    // Parse GIFtags and GS data minimally for image upload.
    const nloop = view.getUint32(offs + 0x10, true) & 0x3FFF;
    const reg = view.getUint8(offs + 0x18);
    assert(nloop === 0x4, "Expected GIFtag with nloop 4 for texture upload");
    assert(reg === 0xE, "Expected A+E register in GIFtag for texture upload");
    let bitbltbuf: GSRegisterBITBLTBUF;
    let trxpos: GSRegisterTRXPOS;
    let trxreg: GSRegisterTRXREG;
    for (let i = 0; i < nloop; i++) {
        const dataLower = view.getUint32(offs + 0x10 * i + 0x20, true);
        const dataUpper = view.getUint32(offs + 0x10 * i + 0x24, true);
        const gsReg = view.getUint8(offs + 0x10 * i + 0x28);
        if (gsReg === GSRegister.BITBLTBUF) {
            bitbltbuf = getGSRegisterBITBLTBUF(dataLower, dataUpper);
        } else if (gsReg === GSRegister.TRXPOS) {
            trxpos = getGSRegisterTRXPOS(dataLower, dataUpper);
        } else if (gsReg === GSRegister.TRXREG) {
            trxreg = getGSRegisterTRXREG(dataLower, dataUpper);
        }
    }
    const imageOffs = textureFile.offset + view.getUint32(offs + 0x74, true);
    let imageBytesize = (view.getUint32(offs + 0x70, true) & 0xFFFFFFF) * 0x10;
    if (imageOffs + imageBytesize > buffer.byteLength) {
        // Maps gm03.map, gm05.map, and gm08.map specify IMAGE transfers that overflow the map file.
        const fillBuffer: Uint8Array = new Uint8Array(imageBytesize);
        fillBuffer.set(buffer.createTypedArray(Uint8Array, imageOffs));
        gsMemoryMapUploadImage(gsMemoryMap, bitbltbuf.dpsm, bitbltbuf.dbp, bitbltbuf.dbw, trxpos.dsax, trxpos.dsay, trxreg.rrw, trxreg.rrh, new ArrayBufferSlice(fillBuffer.buffer));
        return;
    }
    gsMemoryMapUploadImage(gsMemoryMap, bitbltbuf.dpsm, bitbltbuf.dbp, bitbltbuf.dbw, trxpos.dsax, trxpos.dsay, trxreg.rrw, trxreg.rrh, buffer.subarray(imageOffs, imageBytesize));
}

function parseTextureAnimTags(buffer: ArrayBufferSlice, textureFile: BarFile, gsMemoryMap: GSMemoryMap, mapGroup: MapGroup) {
    const view = buffer.createDataView(textureFile.offset);

    let offs = view.getUint32(0x4, true) * 4 + view.getUint32(0x20, true);
    while (offs < textureFile.bytesize) {
        const tag = view.getUint32(offs, true);
        const size = view.getUint32(offs + 4, true);
        switch (tag) {
            case 0x43535655: {  // UVSC
                const index = view.getUint32(offs + 0x8, true);
                mapGroup.uvScrollArray[index * 2] = view.getFloat32(offs + 0xC, true);
                mapGroup.uvScrollArray[index * 2 + 1] = view.getFloat32(offs + 0x10, true);
                break;
            }
            case 0x41584554: {  // TEXA
                parseTextureAnimation(buffer, textureFile.offset + offs + 0x8, gsMemoryMap, mapGroup);
                break;
            }
            case 0x594D445F:  // _DMY
                break;
            case 0x354E4B5F:  // _KN5
                break;  // Done
            default:
                console.error(`Unknown texture data tag ${tag.toString(16)} at offset ${textureFile.offset + offs.toString(16)}`);
                return;
        }
        offs += size + 0x8;
    }
}

function parseTextureAnimation(buffer: ArrayBufferSlice, offs: number, gsMemoryMap: GSMemoryMap, mapGroup: MapGroup) {
    const view = buffer.createDataView(offs);

    const textureIndex = view.getUint16(0x2, true);
    assert(mapGroup.textureIndexMap.has(textureIndex), `Failed to parse TEXA block due to missing texture index ${textureIndex}`);
    const textureBlock = mapGroup.textureIndexMap.get(textureIndex)[0];
    const texture = mapGroup.textureIndexMap.get(textureIndex)[1];
    const numSprites = view.getUint16(0xE, true);
    const dsax = view.getUint16(0x10, true);
    const dsay = view.getUint16(0x12, true);
    const rrw = view.getUint16(0x14, true);
    const rrh = view.getUint16(0x16, true);
    const unk = view.getUint16(0x0, true) * 0x100;
    texture.textureAnim = new TextureAnimation(texture.width(), texture.height(), dsax, dsay, numSprites + 1);

    // First sprite in the sheet is the original clipped texture.
    texture.textureAnim.addSprite(textureBlock.pixels, texture.clipLeft, texture.clipTop, textureBlock.width);

    const tex0: GSRegisterTEX0 = texture.tex0;
    const spriteDataOffset = view.getUint32(0x20, true);
    let spriteBytesize = rrw * rrh;
    if (tex0.psm === GSPixelStorageFormat.PSMT4) {
        spriteBytesize /= 2;
    }
    const alphaReg = tex0.tcc === GSTextureColorComponent.RGBA ? -1 : 0x80;
    for (let i = 0; i < numSprites; i++) {
        gsMemoryMapUploadImage(gsMemoryMap, tex0.psm, tex0.tbp0, tex0.tbw, dsax, dsay, rrw, rrh, buffer.subarray(offs + spriteDataOffset + i * spriteBytesize, spriteBytesize));
        const pixels = new Uint8Array(textureBlock.width * textureBlock.height * 4);
        if (tex0.psm === GSPixelStorageFormat.PSMT8) {
            gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMemoryMap, tex0.tbp0, tex0.tbw, textureBlock.width, textureBlock.height, tex0.cbp, alphaReg);
        } else if (tex0.psm === GSPixelStorageFormat.PSMT4) {
            gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMemoryMap, tex0.tbp0, tex0.tbw, textureBlock.width, textureBlock.height, tex0.cbp, tex0.csa, alphaReg);
        }
        texture.textureAnim.addSprite(pixels, texture.clipLeft, texture.clipTop, textureBlock.width);
    }

    let frameOffs = view.getUint32(0x1C, true) + 0x4;
    while (frameOffs < spriteDataOffset) {
        const control = view.getInt16(frameOffs, true);
        if (control < 0) {
            break;
        }
        const minLength = view.getUint16(frameOffs + 0x2, true);
        const maxLength = view.getUint16(frameOffs + 0x4, true);
        const spriteIndex = view.getUint16(frameOffs + 0x6, true);
        texture.textureAnim.frames.push({minLength, maxLength, spriteIndex: control > 0 ? 0 : spriteIndex + 1});
        frameOffs += 0x8;
    }
}

function parseGeometry(buffer: ArrayBufferSlice, geometryFile: BarFile, mapGroup: MapGroup) {
    const view = buffer.createDataView(geometryFile.offset + 0x90);
    const meshCount = view.getUint32(0x10, true);
    for (let i = 0; i < meshCount; i++) {
        const mesh = new MapMesh;
        const offs = view.getUint32(i * 0x10 + 0x20, true);
        const textureIndex = view.getUint16(i * 0x10 + 0x24, true);
        if (mapGroup.textureIndexMap.has(textureIndex)) {
            mesh.textureBlock = mapGroup.textureIndexMap.get(textureIndex)[0];
            mesh.texture = mapGroup.textureIndexMap.get(textureIndex)[1];
        }
        mesh.translucent = view.getUint16(i * 0x10 + 0x2A, true) === 0x1;
        const uvScrollIndex = (view.getUint16(i * 0x10 + 0x2C, true) >> 1) & 0xF;
        if (uvScrollIndex > 0 && (mesh.texture.tiledU || mesh.texture.tiledV)) {
            mesh.uvScroll = vec2.fromValues(
                mapGroup.uvScrollArray[(uvScrollIndex - 1) * 2],
                mapGroup.uvScrollArray[(uvScrollIndex - 1) * 2 + 1]
            );
        }
        parseGeometryMesh(view, offs, mesh);
        mapGroup.meshes.push(mesh);
    }
}

class VUState {
    public static a_modelType = 0x0;
    public static a_uvIndFlagsCount = 0x4;
    public static a_uvIndFlagsAddr = 0x5;
    public static a_vertexColorCount = 0x8;
    public static a_vertexColorAddr = 0x9;
    public static a_vertexCount = 0xC;
    public static a_vertexAddr = 0xD;
    public static a_vertexNormalCount = 0x10;
    public static a_vertexNormalAddr = 0x11;

    public mask = 0;
    public header: Uint32Array = new Uint32Array(20);

    public flg: Uint8Array | null = null;
    public ind: Uint8Array | null = null;

    public reset() {
        this.mask = 0;
        this.header.fill(0);
        this.flg = null;
        this.ind = null;
    }
}

function parseGeometryMesh(view: DataView, startOffset: number, mesh: MapMesh) {
    // Parse VIF commands at a high level, extracting only the required vertex data
    // directly from UNPACK commands. This reduces overall complexity of the parser
    // since there is no need to accurately simulate VU memory to obtain this data.
    let offs = startOffset;
    let vuState = new VUState;
    while (offs < view.byteLength) {
        const imm = view.getUint16(offs, true);
        const qwd = view.getUint8(offs + 0x2);
        const cmd = view.getUint8(offs + 0x3) & 0x7F;
        offs += 0x4;

        if (cmd >> 5 === 0b11) {  // UNPACK
            if (cmd === 0x60) {
                break;  // Done
            }
            offs += handleVifUnpack(view, offs, imm, qwd, cmd, vuState, mesh);
            continue;
        }
        switch (cmd) {
            case 0b00100000:  // STMASK
                vuState.mask = view.getUint32(offs, true);
                offs += 0x4;
                break;
            case 0b00010111:  // MSCNT
                vuState.reset();
                break;
            case 0b00110001:  // STCOL
                // Used only to fill w = 1.0 for each vertex position
                offs += 0x10;
                break;
            case 0b00000000:  // NOP
            case 0b00000001:  // STCYCLE
            case 0b00010000:  // FLUSHE
            case 0b00010001:  // FLUSH
            case 0b00010011:  // FLUSHA
                break;
            default:
                console.error(`VIF parse error: Unhandled command ${cmd.toString(16)} at offset ${offs.toString(16)}`);
                return;
        }
    }
}

function handleVifUnpack(view: DataView, offs: number, imm: number, qwd: number, cmd: number, vuState: VUState, mesh: MapMesh): number {
    const m: boolean = (cmd & 0x10) > 0;
    const addr = imm & 0x1FF;
    const vnvl = cmd & 0xF;
    switch (vnvl) {
        case 0b1100: {  // V4-32
            if (addr === 0 && !m) {
                // Header
                for (let i = 0; i < qwd * 0x4; i++) {
                    vuState.header[i] = view.getUint32(offs + i * 0x4, true);
                }
            }
            return qwd * 0x10;
        }
        case 0b1000: {  // V3-32
            if (addr === vuState.header[VUState.a_vertexAddr] && m) {
                handleVifUnpackVertexData(view, offs, vuState, mesh);
            } else if (addr === vuState.header[VUState.a_vertexNormalAddr] && m) {
                for (let i = 0; i < vuState.header[VUState.a_vertexNormalCount]; i++) {
                    mesh.normal.push(vec3.fromValues(
                        view.getFloat32(offs + i * 0xC, true),        // nx
                        view.getFloat32(offs + i * 0xC + 0x4, true),  // ny
                        view.getFloat32(offs + i * 0xC + 0x8, true)   // nz
                    ));
                }
            }
            return qwd * 0xC;
        }
        case 0b0010: {  // S-8
            if (addr === vuState.header[VUState.a_uvIndFlagsAddr] && m) {
                if (vuState.mask === 0xCFCFCFCF) {
                    vuState.ind = new Uint8Array(qwd);
                    for (let i = 0; i < qwd; i++) {
                        vuState.ind[i] = view.getUint8(offs + i);
                    }
                } else if (vuState.mask === 0x3F3F3F3F) {
                    vuState.flg = new Uint8Array(qwd);
                    for (let i = 0; i < qwd; i++) {
                        vuState.flg[i] = view.getUint8(offs + i);
                    }
                }
            }
            return Math.ceil(qwd / 4) * 0x4;
        }
        case 0b0101: {  // V2-16
            if (addr === vuState.header[VUState.a_uvIndFlagsAddr] && !m) {
                for (let i = 0; i < vuState.header[VUState.a_uvIndFlagsCount]; i++) {
                    mesh.uv.push(vec2.fromValues(
                        view.getInt16(offs + i * 0x4, true) / 4096,       // tu
                        view.getInt16(offs + i * 0x4 + 0x2, true) / 4096  // tv
                    ));
                }
            }
            return qwd * 0x4;
        }
        case 0b1110: {  // V4-8
            if (addr === vuState.header[VUState.a_vertexColorAddr]) {
                for (let i = 0; i < vuState.header[VUState.a_vertexColorCount]; i++) {
                    mesh.vcol.push(vec4.fromValues(
                        view.getUint8(offs + i * 0x4) / 256,        // cr
                        view.getUint8(offs + i * 0x4 + 0x1) / 256,  // cg
                        view.getUint8(offs + i * 0x4 + 0x2) / 256,  // cb
                        view.getUint8(offs + i * 0x4 + 0x3) / 128   // ca
                    ));
                }
            }
            return qwd * 0x4;
        }
        case 0b000:
            break;
        default:
            console.error(`VIF parse error: Unhandled UNPACK vn/vl ${vnvl.toString(16)} at offset ${offs.toString(16)}`);
    }
    return qwd * 0x10;
}

function handleVifUnpackVertexData(view: DataView, offs: number, vuState: VUState, mesh: MapMesh) {
    if (!vuState.ind || !vuState.flg) {
        return;
    }
    const indStart = mesh.vtx.length;
    for (let i = 0; i < vuState.header[VUState.a_uvIndFlagsCount]; i++) {
        mesh.vtx.push(vec3.fromValues(
            view.getFloat32(offs + vuState.ind[i] * 0xC, true),          // vx
            view.getFloat32(offs + vuState.ind[i] * 0xC + 0x4, true),    // vy
            view.getFloat32(offs + vuState.ind[i] * 0xC + 0x8, true)));  // vz
        const f = vuState.flg[i] & 0x30;
        if (f != 0x10) {
            if (f === 0x20 || f === 0x0) {
                mesh.ind.push(indStart + i - 2);  // t0
                mesh.ind.push(indStart + i - 1);  // t1
                mesh.ind.push(indStart + i);      // t2
            }
            if (f === 0x30 || f === 0x0) {
                mesh.ind.push(indStart + i);      // t0
                mesh.ind.push(indStart + i - 1);  // t1
                mesh.ind.push(indStart + i - 2);  // t2
            }
        }
    }
}

function parseDOCT(buffer: ArrayBufferSlice, doctFile: BarFile, geometryFile: BarFile, mapGroup: MapGroup) {
    const geometryView = buffer.createDataView(geometryFile.offset + 0x90);
    const doctView = buffer.createDataView(doctFile.offset);

    const groupCount = geometryView.getUint16(0x16, true);
    const groupTableOffset = geometryView.getUint32(0x18, true);
    const metadataTableOffset = doctView.getUint32(0x1C, true);
    for (let group = 0; group < groupCount; group++) {
        const layer = doctView.getUint32(metadataTableOffset + group * 0x1C, true);
        const groupOffset = geometryView.getUint32(groupTableOffset + group * 0x4, true);
        let groupIndex = 0;
        while (true) {
            const meshIndex = geometryView.getUint16(groupOffset + groupIndex * 2, true);
            if (meshIndex === 0xFFFF) {
                break;
            }
            if (meshIndex < mapGroup.meshes.length) {
                mapGroup.meshes[meshIndex].layer = layer;
            }
            groupIndex++;
        }
    }
}
