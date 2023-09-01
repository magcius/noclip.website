import AnimationController from '../AnimationController.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxSampler, GfxTexture } from '../gfx/platform/GfxPlatformImpl.js';
import { assert, assertExists, decodeString, readString } from "../util.js";

export class TexAnimData {
    public srcTex: string;
    public srcWOffset: number;
    public srcHOffset: number;
    public srcWSize: number;
    public srcHSize: number;
    public dstTex: string;
    public dstWOffset: number;
    public dstHOffset: number;
    public waitTime: number;
}

export class TexAnim {
    public texAnimDatas: TexAnimData[] = [];
    public name: string = "";
    public currentIndex: number = 0;
    public frameCount: number = 0;
    public frameTimings: number[] = [];
}

export interface Texture {
    width: number;
    height: number;
    name: string;
    pixels: Uint8Array;
}

export interface TextureData {
    texture: GfxTexture;
    sampler: GfxSampler;
}

export class IMG {
    public name: string;
    public textures: Texture[] = [];
    public texnameToAnimTexture: Map<string, Texture> = new Map<string, Texture>();
    public texAnimNameToTexAnim: Map<string, TexAnim> = new Map<string, TexAnim>();

}

//https://forum.xentax.com/viewtopic.php?t=2640#p110753
function Unswizzle8(pixelData: Uint8Array, width: number, height: number) {
    const swizzledData: Uint8Array = new Uint8Array(pixelData);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const block_location = (y & (~0xf)) * width + (x & (~0xf)) * 2;
            const swap_selector = (((y + 2) >> 2) & 0x1) * 4;
            const posY = (((y & (~3)) >> 1) + (y & 1)) & 0x7;
            const column_location = posY * width * 2 + ((x + swap_selector) & 0x7) * 4;
            const byte_num = ((y >> 1) & 1) + ((x >> 2) & 2);
            pixelData[x + (y * width)] = swizzledData[block_location + column_location + byte_num];
        }
    }
}

function processTexAnimeData(img: IMG, buffer: ArrayBufferSlice, animatedTexNames: string[]) {
    const lines = decodeString(buffer, 0, buffer.byteLength, "Shift_JIS").split('\n');
    let bTexAnimeParse = false;
    let bTexAnimeDataParse = false;
    const texAnims = [];
    const nameSeen: Map<string, boolean> = new Map<string, boolean>();
    let texAnimDataLength = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.split(" ").length)
            continue;
        const keyword = line.split(" ")[0];

        if (bTexAnimeParse) {
            if (keyword === "TEX_ANIME_END;\r") {
                bTexAnimeParse = false;
                for (let j = 0; j < texAnimDataLength; j++) {
                    texAnims[texAnims.length - 1].frameCount += texAnims[texAnims.length - 1].texAnimDatas[j].waitTime;
                    if (j)
                        texAnims[texAnims.length - 1].frameTimings.push((texAnims[texAnims.length - 1].texAnimDatas[j - 1].waitTime + texAnims[texAnims.length - 1].frameTimings[j - 1]));
                    else
                        texAnims[texAnims.length - 1].frameTimings.push(0);
                }
                texAnimDataLength = -1;
            }
            else if (bTexAnimeDataParse) {
                if (keyword === "TEX_ANIME_DATA_END;\r") {
                    bTexAnimeDataParse = false;
                }
                else {
                    if (keyword === "SRC_TEX") {
                        const name = line.split("\"")[1];
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].srcTex = name;
                        if (!nameSeen.has(name)) {
                            nameSeen.set(name, true);
                            animatedTexNames.push(name);
                        }
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].srcWOffset = parseInt(line.split(",")[1]);
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].srcHOffset = parseInt(line.split(",")[2]);
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].srcWSize = parseInt(line.split(",")[3]);
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].srcHSize = parseInt(line.split(",")[4].split(";")[0]);
                    }
                    else if (keyword === "DEST_TEX") {
                        const name = line.split("\"")[1];
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].dstTex = name;
                        if (!nameSeen.has(name)) {
                            nameSeen.set(name, true);
                            animatedTexNames.push(name);
                        }
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].dstWOffset = parseInt(line.split(",")[1]);
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].dstHOffset = parseInt(line.split(",")[2].split(";")[0]);
                    }
                    else if (keyword === "WAIT") {
                        texAnims[texAnims.length - 1].texAnimDatas[texAnimDataLength].waitTime = parseInt(line.split(" ")[1].split(",")[0]);
                    }
                    continue;
                }
            }
            else if (keyword === "TEX_ANIME_DATA") {
                bTexAnimeDataParse = true;
                texAnims[texAnims.length - 1].texAnimDatas.push(new TexAnimData());
                texAnimDataLength += 1;
            }
            continue;
        }

        if (keyword === "TEX_ANIME") {
            bTexAnimeParse = true;
            texAnims.push(new TexAnim());
            texAnims[texAnims.length - 1].name = line.split("\"")[1];
            //texAnims[texAnims.length - 1].bLoop = parseInt(line.split(",")[1].split(";")[0]) > 0 ? true : false; Assumption proven wrong, auto trigger boolean ?
        }
    }
    for (let j = 0; j < texAnims.length; j++) {
        img.texAnimNameToTexAnim.set(texAnims[j].name, texAnims[j]);
    }
}


function processTIM2Texture(img: IMG, buffer: ArrayBufferSlice, name: string, bIsSwizzled: number, size: number) {
    const view = buffer.createDataView();
    let offs = 0;
    const magic = readString(buffer, 0x00, 0x04);
    assert(magic === 'TIM2');
    const version = view.getUint8(offs + 0x4);
    const entryCount = view.getUint16(offs + 0x6, true);
    assert(entryCount === 1); //Make sure we only have TIM2 files with one texture, which seems to always be the case

    const palSize = view.getUint32(offs + 0x14, true);
    const dataSize = view.getUint32(offs + 0x18, true);
    const headerSize = view.getUint16(offs + 0x1C, true);
    const palEntryCount = view.getUint16(offs + 0x1E, true);
    const palFormat = view.getUint8(offs + 0x22);
    const dataFormat = view.getUint8(offs + 0x23);
    const width = view.getUint16(offs + 0x24, true);
    const height = view.getUint16(offs + 0x26, true);
    offs = 0x10 + headerSize;

    const pixelData = new Uint8Array(dataSize);
    const palData = new Uint8Array(palSize);
    const finalPixelData = new Uint8Array(width * height * 4);

    if (size === 0x40) {
        //Placeholder tex used for uv scroll, copies etc. Usually datatype 2 and 3 used as placeholders with no data.
        for (let i = 0; i < pixelData.length; i++) {
            finalPixelData[i] = 0;
        }
        img.textures.push({ name: name, width: width, height: height, pixels: finalPixelData });
        return;
    }

    pixelData.set(buffer.createTypedArray(Uint8Array, offs, dataSize));
    offs += dataSize;

    if (dataFormat === 5) {
        //Palette swizzle
        for (let i = 0; i < 8; i++) {
            const tempOffs = 128 * i;
            palData.set(buffer.createTypedArray(Uint8Array, offs, 32), tempOffs);
            offs += 32;
            palData.set(buffer.createTypedArray(Uint8Array, offs, 32), tempOffs + 64);
            offs += 32;
            palData.set(buffer.createTypedArray(Uint8Array, offs, 32), tempOffs + 32);
            offs += 32;
            palData.set(buffer.createTypedArray(Uint8Array, offs, 32), tempOffs + 96);
            offs += 32;
        }

        if (bIsSwizzled)
            Unswizzle8(pixelData, width, height);
        for (let i = 0; i < pixelData.length; i++) {
            finalPixelData.set(palData.slice(pixelData[i] * 4, pixelData[i] * 4 + 4), 4 * i);
            finalPixelData[4 * i + 3] = Math.min(finalPixelData[4 * i + 3] * 2, 255);
        }
    }
    else if (dataFormat === 4) {
        palData.set(buffer.createTypedArray(Uint8Array, offs, palSize));
        for (let i = 0; i < pixelData.length * 2; i++) {
            const val = i & 1 ? pixelData[(i - 1) / 2] >> 4 : pixelData[i / 2] & 0xF;
            finalPixelData.set(palData.slice(val * 4, val * 4 + 4), 4 * i);
            finalPixelData[4 * i + 3] = Math.min(finalPixelData[4 * i + 3] * 2, 255);
        }
    }
    else if (dataFormat === 3) {
        for (let i = 0; i < pixelData.length; i++) {
            finalPixelData[i] = pixelData[i];
        }
    }
    else if (dataFormat === 2) { //r8g8b8
        for (let i = 0; i < pixelData.length / 3; i++) {
            finalPixelData[4 * i] = pixelData[3 * i];
            finalPixelData[4 * i + 1] = pixelData[3 * i + 1];
            finalPixelData[4 * i + 2] = pixelData[3 * i + 2];
            finalPixelData[4 * i + 3] = 255;
        }
    }
    else
        throw "Unimplemented format";
    img.textures.push({ name: name, width: width, height: height, pixels: finalPixelData });
}

function getTextureAnimFrame(frameCount: number, frame: number) {
    if (frameCount === 0)
        return 0;
    while (frame > frameCount)
        frame -= frameCount;
    return frame;
}

export function animateTexture(texAnim: TexAnim, animationController: AnimationController, img: IMG | null, device: GfxDevice, texDataMap: Map<string, TextureData>) {
    if (img === null)
        return;
    const frame = assertExists(animationController).getTimeInFrames();
    const animFrame = getTextureAnimFrame(texAnim.frameCount, frame);
    let texAnimDataIndex = 0;
    if (texAnim.frameCount) {
        texAnimDataIndex = texAnim.frameTimings.findIndex((frameTiming) => (animFrame < frameTiming));
        if (texAnimDataIndex === -1)
            texAnimDataIndex = texAnim.frameTimings.length;
        texAnimDataIndex -= 1;
        if (texAnimDataIndex !== texAnim.currentIndex && texAnimDataIndex > texAnim.currentIndex)
            texAnimDataIndex = texAnim.currentIndex + 1;
    }
    else
        texAnim.currentIndex = 1; //Force the update when only one frame
    if (texAnimDataIndex !== texAnim.currentIndex) {
        const texAnimData: TexAnimData = texAnim.texAnimDatas[texAnimDataIndex];
        const srcTexName: string = texAnimData.srcTex;
        const dstTexName: string = texAnimData.dstTex;
        if (!img.texnameToAnimTexture.has(srcTexName) || !img.texnameToAnimTexture.get(dstTexName))
            throw "srcTex or dstTex not found";

        const srcTex: Texture = img.texnameToAnimTexture.get(srcTexName)!;
        const dstTex: Texture = img.texnameToAnimTexture.get(dstTexName)!;
        const srcPixels = srcTex!.pixels;
        const dstPixels = dstTex!.pixels;

        if (srcTexName === "fire_01") {
            let sliceOffset = 0;
            for (let j = 0; j < texAnimData.srcHSize; j++) {
                sliceOffset = texAnimData.srcWOffset * 4 + srcTex.width * (texAnimData.srcHOffset + j) * 4;
                dstPixels.set(srcPixels.slice(sliceOffset - texAnimData.srcWSize * 4, sliceOffset), j * dstTex.width * 4);
            }
        }
        else //Upside down (character face textures)
        {
            const sliceSize = texAnimData.srcWSize * texAnimData.srcHSize * 4;
            const sliceOffset = texAnimData.srcWOffset * 4 + srcTex.width * (srcTex.height - texAnimData.srcHOffset) * 4;
            const dstOffset = texAnimData.dstWOffset * 4 + dstTex.width * (dstTex.height - texAnimData.dstHOffset) * 4;
            dstPixels.set(srcPixels.slice(sliceOffset - sliceSize, sliceOffset), dstOffset - sliceSize);
        }

        device.uploadTextureData(texDataMap.get(dstTexName)!.texture, 0, [dstPixels]);
        texAnim.currentIndex = texAnimDataIndex;
    }
}

export function parse(buffer: ArrayBufferSlice, name: string): IMG {
    const view = buffer.createDataView();
    const img = new IMG();
    img.name = name.split('/').pop()!;

    const magic = readString(buffer, 0x00, 0x03);
    assert(magic === 'IM3');
    //version at 0x4 ? Maybe header size
    const entryCount = view.getUint32(0x08, true);
    //reserved/padding at 0xC

    let offs = 0x10;
    const animatedTexNames: string[] = [];
    for (let i = 0; i < entryCount; i++) {
        const name = readString(buffer, offs);
        const texOffset = view.getUint32(offs + 0x24, true);
        const bIsSwizzled = view.getUint32(offs + 0x28, true);
        const size = view.getUint32(offs + 0x34, true);
        if (name === "#texanime") {
            if (size > 0x40) //Size constraint for "Neos destroyed", duplicate texanime block with cut data
                processTexAnimeData(img, buffer.slice(texOffset, texOffset + size), animatedTexNames);
        }
        else
            processTIM2Texture(img, buffer.slice(texOffset, texOffset + size), name, bIsSwizzled, size);
        offs += 0x40;
    }

    for (let i = 0; i < animatedTexNames.length; i++) {
        const name = animatedTexNames[i];
        for (let j = 0; j < img.textures.length; j++) {
            if (name === img.textures[j].name)
                img.texnameToAnimTexture.set(name, img.textures[j]);
        }
    }

    return img;
}