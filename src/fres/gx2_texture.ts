
import { GX2SurfaceFormat } from './gx2_enum';
import { GX2Surface, DeswizzledSurface } from './gx2_surface';
import ArrayBufferSlice from '../ArrayBufferSlice';

import WorkerPool from '../WorkerPool';
import { DeswizzleRequest } from './gx2_swizzle';
import { DecodedSurface, DecodedSurfaceSW, decompressBC } from './bc_texture';

class Deswizzler {
    private pool: WorkerPool<DeswizzleRequest, DeswizzledSurface>;

    constructor() {
        this.pool = new WorkerPool<DeswizzleRequest, DeswizzledSurface>(() => new Worker('./worker/gx2_swizzle_worker.ts'));
    }

    public deswizzle(surface: GX2Surface, buffer: ArrayBuffer, mipLevel: number): Promise<DeswizzledSurface> {
        // return Promise.resolve<DeswizzledSurface>(deswizzle(surface, buffer, mipLevel));
        const req: DeswizzleRequest = { surface, buffer, mipLevel, priority: mipLevel };
        return this.pool.execute(req);
    }

    public terminate() {
        this.pool.terminate();
    }

    public build() {
        this.pool.build();
    }
}

export const deswizzler: Deswizzler = new Deswizzler();

export function deswizzleSurface(surface: GX2Surface, texData: ArrayBufferSlice, mipLevel: number): Promise<DeswizzledSurface> {
    return deswizzler.deswizzle(surface, texData.castToBuffer(), mipLevel);
}

export function decodeSurface(surface: GX2Surface, texData: ArrayBufferSlice, mipData: ArrayBufferSlice, mipLevel: number): Promise<DecodedSurface> {
    let levelData;
    if (mipLevel === 0) {
        levelData = texData.slice(0, surface.texDataSize);
    } else if (mipLevel === 1) {
        levelData = mipData; // .slice(0, surface.mipDataOffsets[0]);
    } else {
        levelData = mipData.slice(surface.mipDataOffsets[mipLevel - 1], surface.mipDataOffsets[mipLevel]);
    }

    return deswizzleSurface(surface, levelData, mipLevel).then((deswizzledSurface: DeswizzledSurface): DecodedSurface => {
        switch (surface.format) {
        case GX2SurfaceFormat.BC1_UNORM:
            return { type: 'BC1', flag: 'UNORM', ...deswizzledSurface };
        case GX2SurfaceFormat.BC1_SRGB:
            return { type: 'BC1', flag: 'SRGB', ...deswizzledSurface };
        case GX2SurfaceFormat.BC3_UNORM:
            return { type: 'BC3', flag: 'UNORM', ...deswizzledSurface };
        case GX2SurfaceFormat.BC3_SRGB:
            return { type: 'BC3', flag: 'SRGB', ...deswizzledSurface };
        case GX2SurfaceFormat.BC4_UNORM:
            return { type: 'BC4', flag: 'UNORM', ...deswizzledSurface };
        case GX2SurfaceFormat.BC4_SNORM:
            return { type: 'BC4', flag: 'SNORM', ...deswizzledSurface, pixels: new Int8Array(deswizzledSurface.pixels.buffer) };
        case GX2SurfaceFormat.BC5_UNORM:
            return { type: 'BC5', flag: 'UNORM', ...deswizzledSurface };
        case GX2SurfaceFormat.BC5_SNORM:
            return { type: 'BC5', flag: 'SNORM', ...deswizzledSurface, pixels: new Int8Array(deswizzledSurface.pixels.buffer) };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_UNORM:
            return { type: 'RGBA', flag: 'UNORM', ...deswizzledSurface };
        case GX2SurfaceFormat.TCS_R8_G8_B8_A8_SRGB:
            return { type: 'RGBA', flag: 'SRGB', ...deswizzledSurface };
        default:
            throw new Error(`Bad format in decodeSurface: ${surface.format.toString(16)}`);
        }
    });
}

export function decompressSurface(texture: DecodedSurface): DecodedSurfaceSW {
    switch(texture.type) {
    case 'RGBA':
        return texture;
    case 'BC1':
    case 'BC3':
    case 'BC4':
    case 'BC5':
        return decompressBC(texture);
    }
}
// #endregion
