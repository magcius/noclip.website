
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { GfxFormat } from "../platform/GfxPlatform.js";

function setImageDataS8(dst: ImageData, src: Int8Array): void {
    for (let i = 0; i < src.length; i++)
        dst.data[i] = src[i] + 128;
}

function convertToImageData(dst: ImageData, buffer: ArrayBufferSlice, format: GfxFormat): void {
    if (format === GfxFormat.U8_RGBA_NORM)
        dst.data.set(buffer.createTypedArray(Uint8Array));
    else if (format === GfxFormat.S8_RGBA_NORM)
        setImageDataS8(dst, buffer.createTypedArray(Int8Array));
    else
        throw "whoops";
}

export function convertToCanvasData(canvas: HTMLCanvasElement, buffer: ArrayBufferSlice, format: GfxFormat = GfxFormat.U8_RGBA_NORM): void {
    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    convertToImageData(imgData, buffer, format);
    ctx.putImageData(imgData, 0, 0);
}

export function convertToCanvas(buffer: ArrayBufferSlice, width: number, height: number, format: GfxFormat = GfxFormat.U8_RGBA_NORM): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    convertToCanvasData(canvas, buffer, format);
    return canvas;
}
