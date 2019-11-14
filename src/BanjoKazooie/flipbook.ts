import ArrayBufferSlice from "../ArrayBufferSlice";
import { RSPSharedOutput, TileState, Texture, Vertex } from "./f3dex";
import { align } from "../util";
import { ImageSize, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_CI4, parseTLUT, TextureLUT, decodeTex_IA16 } from "../Common/N64/Image";

const enum Flags {
    CI4 = 0x001,
    CI8 = 0x004,
    IA16 = 0X040,
    RGBA16 = 0x400,
    RGBA32 = 0x800,
}

export function parse(buffer: ArrayBufferSlice): RSPSharedOutput {
    const view = buffer.createDataView();

    const frameCount = view.getUint16(0x00);
    const flags = view.getUint16(0x02);
    const width = view.getInt16(0x08);
    const height = view.getInt16(0x0a);
    // TODO: parse animation modes

    const headerSize = 4 * frameCount + 0x10;
    const sharedOutput = new RSPSharedOutput();
    let firstFrameX = 0, firstFrameY = 0;

    for (let i = 0; i < frameCount; i++) {
        const frameOffset = view.getInt32(0x10 + 4 * i) + headerSize;
        const frameX = view.getInt16(frameOffset + 0x00);
        const frameY = view.getInt16(frameOffset + 0x02);
        const imageWidth = view.getInt16(frameOffset + 0x04);
        const imageHeight = view.getInt16(frameOffset + 0x06);
        const panelCount = view.getUint16(frameOffset + 0x08);
        if (i === 0) {
            // TODO: align frames correctly in space
            firstFrameX = frameX * width/imageWidth;
            firstFrameY = height - (frameY * height/imageHeight); // might be wrong
        }

        let offs = frameOffset + 0x14;
        const paletteStart = align(offs, 8);
        if (flags & Flags.CI4) {
            offs = paletteStart + 0x20;
        } else if (flags & Flags.CI8) {
            offs = paletteStart + 0x200;
        }

        const framePixels = new Uint8Array(imageWidth * imageHeight * 4);
        for (let j = 0; j < panelCount; j++) {
            const panelX = view.getInt16(offs + 0x00);
            const panelY = view.getInt16(offs + 0x02);
            const panelWidth = view.getInt16(offs + 0x04);
            const panelHeight = view.getInt16(offs + 0x06);

            let bytesPerPixel = 0;
            const imageStart = align(offs + 0x08, 8);
            const panelPixels = new Uint8Array(panelWidth * panelHeight * 4);
            if (flags & Flags.RGBA16) {
                bytesPerPixel = 2;
                decodeTex_RGBA16(panelPixels, view, imageStart, panelWidth, panelHeight);
            } else if (flags & Flags.RGBA32) {
                bytesPerPixel = 4;
                decodeTex_RGBA32(panelPixels, view, imageStart, panelWidth, panelHeight);
            } else if (flags & Flags.CI4) {
                bytesPerPixel = .5;
                const palette = new Uint8Array(16 * 4);
                parseTLUT(palette, view, paletteStart, ImageSize.G_IM_SIZ_4b, TextureLUT.G_TT_RGBA16);
                decodeTex_CI4(panelPixels, view, imageStart, panelWidth, panelHeight, palette);
            } else if (flags & Flags.CI8) {
                bytesPerPixel = 1;
                const palette = new Uint8Array(256 * 4);
                parseTLUT(palette, view, paletteStart, ImageSize.G_IM_SIZ_8b, TextureLUT.G_TT_RGBA16);
            } else if (flags & Flags.IA16) {
                bytesPerPixel = 2;
                decodeTex_IA16(panelPixels, view, imageStart, panelWidth, panelHeight);
            } else {
                throw `bad frame format ${flags.toString(16)}`;
            }
            // copy panel into frame texture at proper location
            for (let y = 0; y < panelHeight; y++) {
                framePixels.set(
                    panelPixels.subarray(
                        4 * y * panelWidth,
                        4 * (y * panelWidth + Math.min(panelWidth, imageWidth - panelX)),
                    ),
                    4 * (imageWidth * (panelY + y) + (panelX)),
                )
            }
            offs = imageStart + (panelWidth * panelHeight * bytesPerPixel);
        }

        sharedOutput.textureCache.textures.push(new Texture(new TileState(), frameOffset, paletteStart, imageWidth, imageHeight, framePixels));
    }

    // make triangles
    for (let i = 0; i < 4; i++) {
        const v = new Vertex();
        v.c2 = 0x7f;
        v.a = 0x80;
        if (i % 2) {
            v.x = width;
            v.tx = 1;
        }
        if (i >= 2) {
            v.y = height;
        } else {
            v.ty = 1;
        }
        v.x -= firstFrameX;
        v.y -= firstFrameY;
        sharedOutput.vertices.push(v);
    }
    sharedOutput.indices.push(0, 1, 3);
    sharedOutput.indices.push(0, 3, 2);

    return sharedOutput;
}