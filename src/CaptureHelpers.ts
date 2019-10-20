
import { assertExists, leftPad } from "./util";
import { Viewer, resizeCanvas } from "./viewer";
import { ZipFileEntry } from "./ZipFile";

type Callback = (viewer: Viewer, t: number, f: number) => void;

interface CaptureOptions {
    width: number;
    height: number;
    frameCount: number;
    filenamePrefix: string;
    setupCallback: Callback;
}

function convertCanvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(assertExists(b)), 'image/png'));
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    // In the future, just use blob.arrayBuffer()
    return await new Response(blob).arrayBuffer();
}

export async function captureScene(viewer: Viewer, options: CaptureOptions): Promise<ZipFileEntry[]> {
    const fileEntries: ZipFileEntry[] = [];

    // This is some ugliness to take over the main code... in an ideal world we'd do this offscreen...
    window.main.setPaused(true);
    for (let i = 0; i < options.frameCount; i++) {
        const t = i / (options.frameCount - 1);
        resizeCanvas(viewer.canvas, options.width, options.height, 1);
        viewer.sceneTime = 0;
        viewer.rafTime = 0;
        options.setupCallback(viewer, t, i);
        viewer.update(0);
        const canvas = viewer.takeScreenshotToCanvas();
        const blob = await convertCanvasToPNG(canvas);
        const data = await blobToArrayBuffer(blob);
        const filename = `${options.filenamePrefix}_${leftPad('' + i, 4)}.png`;
        fileEntries.push({ filename, data });
    }
    window.main.setPaused(false);

    return fileEntries;
}
