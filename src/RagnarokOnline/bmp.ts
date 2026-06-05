import ArrayBufferSlice from "../ArrayBufferSlice.js";

export interface DecodedImage {
    width: number;
    height: number;
    rgba: Uint8Array;
}

function isMagicPink(r: number, g: number, b: number): boolean {
    return r >= 248 && g <= 4 && b >= 248;
}

export function decodeBMP(buffer: ArrayBufferSlice): DecodedImage {
    const view = buffer.createDataView();
    if (view.byteLength < 54)
        throw new Error(`BMP: too small (${view.byteLength} bytes)`);
    if (view.getUint8(0) !== 0x42 || view.getUint8(1) !== 0x4d)
        throw new Error(`BMP: bad magic`);

    const dataOffset = view.getUint32(10, true);
    const headerSize = view.getUint32(14, true);
    if (headerSize < 40)
        throw new Error(`BMP: unsupported header size ${headerSize}`);

    const w = view.getInt32(18, true);
    const h = view.getInt32(22, true);
    const bpp = view.getUint16(28, true);
    const compression = view.getUint32(30, true);
    if (compression !== 0)
        throw new Error(`BMP: unsupported compression ${compression}`);
    if (w <= 0 || h === 0)
        throw new Error(`BMP: bad dimensions ${w}x${h}`);

    const topDown = h < 0;
    const absH = topDown ? -h : h;

    const bytes = buffer.createTypedArray(Uint8Array, 0, view.byteLength);

    let palette: Uint8Array | null = null;
    let clrUsed = 256;
    if (bpp === 8) {
        clrUsed = view.getUint32(46, true);
        if (clrUsed === 0)
            clrUsed = 256;
        const palOff = 14 + headerSize;
        if (palOff + clrUsed * 4 > view.byteLength)
            throw new Error(`BMP: palette out of range`);
        palette = bytes.subarray(palOff, palOff + clrUsed * 4);
    } else if (bpp !== 24) {
        throw new Error(`BMP: unsupported bit depth ${bpp}`);
    }

    const rowSize = (((bpp * w + 31) / 32) | 0) * 4;
    if (dataOffset + rowSize * absH > view.byteLength)
        throw new Error(`BMP: pixel data out of range`);

    const rgba = new Uint8Array(w * absH * 4);
    for (let y = 0; y < absH; y++) {
        const srcRow = topDown ? y : (absH - 1 - y);
        const rowOff = dataOffset + rowSize * srcRow;
        for (let x = 0; x < w; x++) {
            let r: number, g: number, b: number;
            if (bpp === 8) {
                let idx = bytes[rowOff + x];
                if (idx >= clrUsed)
                    idx = 0;
                const pe = idx * 4;
                b = palette![pe + 0];
                g = palette![pe + 1];
                r = palette![pe + 2];
            } else {
                const px = rowOff + x * 3;
                b = bytes[px + 0];
                g = bytes[px + 1];
                r = bytes[px + 2];
            }

            const pink = isMagicPink(r, g, b);
            const out = (y * w + x) * 4;
            rgba[out + 0] = pink ? 0 : r;
            rgba[out + 1] = pink ? 0 : g;
            rgba[out + 2] = pink ? 0 : b;
            rgba[out + 3] = pink ? 0 : 255;
        }
    }

    return { width: w, height: absH, rgba };
}

export function decodeTGA(buffer: ArrayBufferSlice): DecodedImage {
    const view = buffer.createDataView();
    if (view.byteLength < 18)
        throw new Error(`TGA: too small (${view.byteLength} bytes)`);
    const idLength = view.getUint8(0);
    const colorMapType = view.getUint8(1);
    const imageType = view.getUint8(2);
    const w = view.getUint16(12, true);
    const h = view.getUint16(14, true);
    const bpp = view.getUint8(16);
    const descriptor = view.getUint8(17);
    if ((imageType !== 2 && imageType !== 10) || colorMapType !== 0 || (bpp !== 24 && bpp !== 32))
        throw new Error(`TGA: unsupported variant (type ${imageType}, cmap ${colorMapType}, ${bpp}bpp)`);
    const topDown = (descriptor & 0x20) !== 0;
    const rightToLeft = (descriptor & 0x10) !== 0;
    const pixelOffs = 18 + idLength;
    const bytesPerPixel = bpp >>> 3;
    if (imageType === 2 && view.byteLength < pixelOffs + w * h * bytesPerPixel)
        throw new Error(`TGA: truncated pixel data`);

    const fileRgba = new Uint8Array(w * h * 4);
    const writePixel = (dstPixel: number, src: number): void => {
        if (src + bytesPerPixel > view.byteLength)
            throw new Error(`TGA: truncated pixel data`);
        const dst = dstPixel * 4;
        fileRgba[dst + 0] = view.getUint8(src + 2);
        fileRgba[dst + 1] = view.getUint8(src + 1);
        fileRgba[dst + 2] = view.getUint8(src + 0);
        fileRgba[dst + 3] = bpp === 32 ? view.getUint8(src + 3) : 255;
    };

    const pixelCount = w * h;
    if (imageType === 2) {
        for (let i = 0; i < pixelCount; i++)
            writePixel(i, pixelOffs + i * bytesPerPixel);
    } else {
        let src = pixelOffs;
        let dstPixel = 0;
        while (dstPixel < pixelCount) {
            if (src >= view.byteLength)
                throw new Error(`TGA: truncated RLE data`);
            const packet = view.getUint8(src++);
            const count = (packet & 0x7f) + 1;
            if ((packet & 0x80) !== 0) {
                for (let i = 0; i < count && dstPixel < pixelCount; i++)
                    writePixel(dstPixel++, src);
                src += bytesPerPixel;
            } else {
                for (let i = 0; i < count && dstPixel < pixelCount; i++) {
                    writePixel(dstPixel++, src);
                    src += bytesPerPixel;
                }
            }
        }
    }

    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const srcRow = topDown ? y : (h - 1 - y);
        for (let x = 0; x < w; x++) {
            const srcX = rightToLeft ? (w - 1 - x) : x;
            const src = (srcRow * w + srcX) * 4;
            const out = (y * w + x) * 4;
            rgba[out + 0] = fileRgba[src + 0];
            rgba[out + 1] = fileRgba[src + 1];
            rgba[out + 2] = fileRgba[src + 2];
            rgba[out + 3] = fileRgba[src + 3];
        }
    }
    return { width: w, height: h, rgba };
}
