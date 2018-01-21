
import { GX2SurfaceFormat, GX2TileMode, GX2AAMode } from './gx2_enum';

export interface GX2Surface {
    format: GX2SurfaceFormat;
    tileMode: GX2TileMode;
    aaMode: GX2AAMode;
    swizzle: number;
    width: number;
    height: number;
    depth: number;
    pitch: number;

    texDataSize: number;
    mipDataSize: number;
}
