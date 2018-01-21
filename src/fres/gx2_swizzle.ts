
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode } from './gx2_enum';
import { GX2Surface } from './gx2_surface';

import { assert } from 'util';
import { WorkerPool, makeWorkerFromSource } from 'worker_util';

// This is all contained in one function in order to make it easier to Worker-ize.
function _deswizzle(surface: GX2Surface, srcBuffer: ArrayBuffer): ArrayBuffer {
    const numPipes = 2;
    const numBanks = 4;
    const microTileWidth = 8;
    const microTileHeight = 8
    const microTilePixels = microTileWidth * microTileHeight;

    function memcpy(dst: Uint8Array, dstOffs: number, src: ArrayBuffer, srcOffs: number, length: number) {
        dst.set(new Uint8Array(src, srcOffs, length), dstOffs);
    }

    function computePipeFromCoordWoRotation(x: number, y: number) {
        // NumPipes = 2
        const x3 = (x >>> 3) & 1;
        const y3 = (y >>> 3) & 1;
        const pipeBit0 = (y3 ^ x3);
        return (pipeBit0 << 0);
    }
    
    function computeBankFromCoordWoRotation(x: number, y: number) {
        const ty = (y / numPipes) | 0;
    
        const x3 = (x >>> 3) & 1;
        const x4 = (x >>> 4) & 1;
        const ty3 = (ty >>> 3) & 1;
        const ty4 = (ty >>> 4) & 1;
    
        const p0 = ty4 ^ x3;
        const p1 = ty3 ^ x4;
        return (p1 << 1) | (p0 << 0);
    }
    
    function computeSurfaceThickness(tileMode: GX2TileMode) {
        switch (tileMode) {
        case GX2TileMode._1D_TILED_THIN1:
        case GX2TileMode._2D_TILED_THIN1:
            return 1;
        }
    }
    
    function computeSurfaceBlockWidth(format: GX2SurfaceFormat) {
        switch (format & GX2SurfaceFormat.FMT_MASK) {
        case GX2SurfaceFormat.FMT_BC1:
        case GX2SurfaceFormat.FMT_BC3:
        case GX2SurfaceFormat.FMT_BC4:
        case GX2SurfaceFormat.FMT_BC5:
            return 4;
        default:
            return 1;
        }
    }
    
    function computeSurfaceBytesPerBlock(format: GX2SurfaceFormat) {
        switch (format & GX2SurfaceFormat.FMT_MASK) {
        case GX2SurfaceFormat.FMT_BC1:
        case GX2SurfaceFormat.FMT_BC4:
            return 8;
        case GX2SurfaceFormat.FMT_BC3:
        case GX2SurfaceFormat.FMT_BC5:
            return 16;
    
        // For non-block formats, a "block" is a pixel.
        case GX2SurfaceFormat.FMT_TCS_R8_G8_B8_A8:
            return 4;
        default:
            throw new Error(`Unsupported surface format ${format}`);
        }
    }
    
    function computePixelIndexWithinMicroTile(x: number, y: number, bytesPerBlock: number) {
        const x0 = (x >>> 0) & 1;
        const x1 = (x >>> 1) & 1;
        const x2 = (x >>> 2) & 1;
        const y0 = (y >>> 0) & 1;
        const y1 = (y >>> 1) & 1;
        const y2 = (y >>> 2) & 1;
    
        let pixelBits;
        if (bytesPerBlock === 8) {
            pixelBits = [y2, y1, x2, x1, y0, x0];
        } else if (bytesPerBlock === 16) {
            pixelBits = [y2, y1, x2, x1, x0, y0];
        } else if (bytesPerBlock === 4) {
            pixelBits = [y2, y1, y0, x2, x1, x0];
        } else {
            throw new Error("Invalid bpp");
        }
    
        const p5 = pixelBits[0];
        const p4 = pixelBits[1];
        const p3 = pixelBits[2];
        const p2 = pixelBits[3];
        const p1 = pixelBits[4];
        const p0 = pixelBits[5];
        return (p5 << 5) | (p4 << 4) | (p3 << 3) | (p2 << 2) | (p1 << 1) | (p0 << 0);
    }
    
    function computeSurfaceRotationFromTileMode(tileMode: GX2TileMode) {
        switch (tileMode) {
        case GX2TileMode._2D_TILED_THIN1:
            return numPipes * ((numBanks >> 1) - 1);
        default:
            throw new Error(`Unsupported tile mode ${tileMode}`);
        }
    }
    
    function computeTileModeAspectRatio(tileMode: GX2TileMode) {
        switch (tileMode) {
        case GX2TileMode._2D_TILED_THIN1:
            return 1;
        default:
            throw new Error(`Unsupported tile mode ${tileMode}`);
        }
    }
    
    function computeMacroTilePitch(tileMode: GX2TileMode) {
        return (8 * numBanks) / computeTileModeAspectRatio(tileMode);
    }
    
    function computeMacroTileHeight(tileMode: GX2TileMode) {
        return (8 * numPipes) / computeTileModeAspectRatio(tileMode);
    }
    
    function computeSurfaceAddrFromCoordMicroTiled(x: number, y: number, surface: GX2Surface) {
        // XXX(jstpierre): 3D Textures
        const slice = 0;
    
        const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
        const microTileThickness = computeSurfaceThickness(surface.tileMode);
        const microTileBytes = bytesPerBlock * microTileThickness * microTilePixels;
        const microTilesPerRow = surface.pitch / microTileWidth;
        const microTileIndexX = (x / microTileWidth) | 0;
        const microTileIndexY = (y / microTileHeight) | 0;
        const microTileIndexZ = (slice / microTileThickness) | 0;
    
        const microTileOffset = microTileBytes * (microTileIndexX + microTileIndexY * microTilesPerRow);
        const sliceBytes = surface.pitch * surface.height * microTileThickness * bytesPerBlock;
        const sliceOffset = microTileIndexZ * sliceBytes;
        const pixelIndex = computePixelIndexWithinMicroTile(x, y, bytesPerBlock);
        const pixelOffset = bytesPerBlock * pixelIndex;
    
        return pixelOffset + microTileOffset + sliceOffset;
    }
    
    function computeSurfaceAddrFromCoordMacroTiled(x: number, y: number, surface: GX2Surface) {
        // XXX(jstpierre): AA textures
        const sample = 0;
        // XXX(jstpierre): 3D Textures
        const slice = 0;
    
        const numSamples = 1 << surface.aaMode;
        const pipeSwizzle = (surface.swizzle >> 8) & 0x01;
        const bankSwizzle = (surface.swizzle >> 9) & 0x03;
    
        const pipeInterleaveBytes = 256;
        const numPipeBits = 1;
        const numBankBits = 2;
        const numGroupBits = 8;
        const rowSize = 2048;
        const swapSize = 256;
        const splitSize = 2048;
    
        const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
        const microTileThickness = computeSurfaceThickness(surface.tileMode);
        const bytesPerSample = bytesPerBlock * microTileThickness * microTilePixels;
        const microTileBytes = bytesPerSample * numSamples;
        const isSamplesSplit = numSamples > 1 && (microTileBytes > splitSize);
        const samplesPerSlice = Math.max(isSamplesSplit ? (splitSize / bytesPerSample) : numSamples, 1);
        const numSampleSplits = isSamplesSplit ? (numSamples / samplesPerSlice) : 1;
        const numSurfaceSamples = isSamplesSplit ? samplesPerSlice : numSamples;
    
        const rotation = computeSurfaceRotationFromTileMode(surface.tileMode);
        const macroTilePitch = computeMacroTilePitch(surface.tileMode);
        const macroTileHeight = computeMacroTileHeight(surface.tileMode);
        const groupMask = (1 << numGroupBits) - 1;
    
        const pixelIndex = computePixelIndexWithinMicroTile(x, y, bytesPerBlock);
        const pixelOffset = pixelIndex * bytesPerBlock;
        const sampleOffset = sample * (microTileBytes / numSamples);
    
        let elemOffset = pixelOffset + sampleOffset;
        let sampleSlice;
        if (isSamplesSplit) {
            const tileSliceBytes = microTileBytes / numSampleSplits;
            sampleSlice = (elemOffset / tileSliceBytes) | 0;
            elemOffset = elemOffset % tileSliceBytes;
        } else {
            sampleSlice = 0;
        }
    
        const pipe1 = computePipeFromCoordWoRotation(x, y);
        const bank1 = computeBankFromCoordWoRotation(x, y);
        let bankPipe = pipe1 + numPipes * bank1;
        const sliceIn = slice / (microTileThickness > 1 ? 4 : 1);
        const swizzle = pipeSwizzle + numPipes * bankSwizzle;
        bankPipe = bankPipe ^ (numPipes * sampleSlice * ((numBanks >> 1) + 1) ^ (swizzle + sliceIn * rotation));
        bankPipe = bankPipe % (numPipes * numBanks);
        const pipe = (bankPipe % numPipes) | 0;
        const bank = (bankPipe / numPipes) | 0;
    
        const sliceBytes = surface.height * surface.pitch * microTileThickness * bytesPerBlock * numSamples;
        const sliceOffset = sliceBytes * ((sampleSlice / microTileThickness) | 0);
    
        const numSwizzleBits = numBankBits + numPipeBits;
    
        const macroTilesPerRow = (surface.pitch / macroTilePitch) | 0;
        const macroTileBytes = (numSamples * microTileThickness * bytesPerBlock * macroTileHeight * macroTilePitch);
        const macroTileIndexX = (x / macroTilePitch) | 0;
        const macroTileIndexY = (y / macroTileHeight) | 0;
        const macroTileOffset = (macroTileIndexX + macroTilesPerRow * macroTileIndexY) * macroTileBytes;
    
        const totalOffset = (elemOffset + ((macroTileOffset + sliceOffset) >> numSwizzleBits));
    
        const offsetHigh = (totalOffset & ~groupMask) << numSwizzleBits;
        const offsetLow =  (totalOffset & groupMask);
    
        const pipeBits = pipe << (numGroupBits);
        const bankBits = bank << (numPipeBits + numGroupBits);
        const addr = (bankBits | pipeBits | offsetLow | offsetHigh);
    
        return addr;
    }
    
    // For non-BC formats, "block" = 1 pixel.
    const blockSize = computeSurfaceBlockWidth(surface.format);

    let widthBlocks = ((surface.width + blockSize - 1) / blockSize) | 0;
    let heightBlocks = ((surface.height + blockSize - 1) / blockSize) | 0;

    const bytesPerBlock = computeSurfaceBytesPerBlock(surface.format);
    const dst = new Uint8Array(widthBlocks * heightBlocks * bytesPerBlock);

    for (let y = 0; y < heightBlocks; y++) {
        for (let x = 0; x < widthBlocks; x++) {
            let srcIdx;
            switch (surface.tileMode) {
            case GX2TileMode._1D_TILED_THIN1:
                srcIdx = computeSurfaceAddrFromCoordMicroTiled(x, y, surface);
                break;
            case GX2TileMode._2D_TILED_THIN1:
                srcIdx = computeSurfaceAddrFromCoordMacroTiled(x, y, surface);
                break;
            default:
                const tileMode_: GX2TileMode = (<GX2TileMode> surface.tileMode);
                throw new Error(`Unsupported tile mode ${tileMode_.toString(16)}`);
            }

            const dstIdx = (y * widthBlocks + x) * bytesPerBlock;
            memcpy(dst, dstIdx, srcBuffer, srcIdx, bytesPerBlock);
        }
    }

    return dst.buffer;
}

interface DeswizzleMessage {
    surface: GX2Surface;
    buffer: ArrayBuffer;
}

function deswizzleWorker(global: any): void {
    global.onmessage = (e: MessageEvent) => {
        const req: DeswizzleMessage = e.data;
        const surface = req.surface;
        const buffer = _deswizzle(surface, req.buffer);
        const resp: DeswizzleMessage = { surface, buffer };
        global.postMessage(resp, [buffer]);
    };
}

function makeDeswizzleWorker(): Worker {
    return makeWorkerFromSource([
        _deswizzle.toString(),
        deswizzleWorker.toString(),
        'deswizzleWorker(this)',
    ]);
}

class Deswizzler {
    private pool: WorkerPool<DeswizzleMessage, DeswizzleMessage>;

    constructor() {
        this.pool = new WorkerPool<DeswizzleMessage, DeswizzleMessage>(makeDeswizzleWorker);
    }

    public deswizzle(surface: GX2Surface, buffer: ArrayBuffer): Promise<ArrayBuffer> {
        const req: DeswizzleMessage = { surface, buffer };
        return this.pool.execute(req).then((resp: DeswizzleMessage): ArrayBuffer => {
            return resp.buffer;
        });
    }

    public terminate() {
        this.pool.terminate();
    }

    public build() {
        this.pool.build();
    }
}

export const deswizzler: Deswizzler = new Deswizzler();
