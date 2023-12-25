
// Can take screenshots of a framebuffer (or the onscreen buffer) to a canvas.

function readPixelsCommon(gl: WebGL2RenderingContext, width: number, height: number, canvas: HTMLCanvasElement, opaque: boolean): void {
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    if (opaque) {
        // Since HTML5 canvas is premultiplied, even though PNG is not, we have to do this
        // step here or we risk it being lost forever...
        for (let i = 3; i < pixels.length; i += 4)
            pixels[i] = 0xFF;
    }

    canvas.width = gl.drawingBufferWidth;
    canvas.height = gl.drawingBufferHeight;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(width, height);
    img.data.set(pixels);
    ctx.putImageData(img, 0, 0);

    // Flip upside-down.
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.setTransform(1, 0, 0, -1, 0, height);
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
}

export function downloadFrontBufferToCanvas(gl: WebGL2RenderingContext, width: number, height: number, canvas: HTMLCanvasElement, opaque: boolean): void {
    readPixelsCommon(gl, width, height, canvas, opaque);
}
