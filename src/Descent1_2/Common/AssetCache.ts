import ArrayBufferSlice from "../../ArrayBufferSlice";
import { GfxTexture } from "../../gfx/platform/GfxPlatformImpl";
import { DescentBitmapSource, DescentGameDataSource } from "./AssetSource";
import { DescentPalette, DescentPigBitmap, DescentVClip } from "./AssetTypes";
import { DescentPolymodel } from "./Polymodel";
import { CacheMap } from "./Util";

/** Represents a bitmap with the metadata and bitmap data. */
type DescentBitmapData = {
    bitmap: DescentPigBitmap;
    data: ArrayBufferSlice;
};

/** Represents a texture uploaded to the GPU, with the metadata, bitmap data (converted to 32bpp) and GPU texture. */
export type DescentGfxTexture = {
    bitmap: DescentPigBitmap;
    pixels: ArrayBufferSlice;
    gfxTexture: GfxTexture;
};

/** Represents animation data (seconds -> frame multiplier) and bitmap IDs for each frame. */
type DescentAnimationData = {
    timeMultiplier: number;
    bitmapIds: number[];
};

/** VClip data; contains animation data and VCLIP metadata. */
type DescentVClipData = DescentAnimationData & {
    vclip: DescentVClip;
};

export class DescentAssetCache {
    private bitmapCache: CacheMap<number, DescentBitmapData> = new CacheMap();
    private objEclipIndexData: Map<number, number> | null = null;

    constructor(
        public palette: DescentPalette,
        private bitmapSource: DescentBitmapSource,
        private gameDataSource: DescentGameDataSource,
    ) {}

    /** Load bitmap data by bitmap ID. Returns `null` if bitmap not found. */
    public getBitmap(bitmapId: number): DescentBitmapData | null {
        return this.bitmapCache.computeIfAbsentOrNull(bitmapId, (_: any) => {
            const pig = this.bitmapSource;
            const bitmap = pig.bitmaps[bitmapId];
            if (bitmap == null) return null;
            const data = pig.loadBitmap(bitmap);
            if (data == null) return null;
            const result = { bitmap, data };
            this.bitmapCache.set(bitmapId, result);
            return result;
        });
    }

    /** Returns the bitmap index for a TMAP index. */
    public getTmapBitmapIndex(tmapIndex: number) {
        return this.gameDataSource.pigTextureIds[tmapIndex] ?? null;
    }

    /** Returns animation data for a TMAP index, or null if there isn't any. */
    public getTmapAnimation(tmapIndex: number): DescentAnimationData | null {
        const tmap = this.gameDataSource.tmaps[tmapIndex];
        if (tmap == null || tmap.eclipNum === -1) return null;
        const eclip = this.gameDataSource.eclips[tmap.eclipNum];
        if (eclip == null) return null;
        return {
            timeMultiplier: 1.0 / eclip.vclip.frameTime,
            bitmapIds: eclip.vclip.bitmapIndex.slice(0, eclip.vclip.numFrames),
        };
    }

    /** Returns light data for a TMAP index, or null if there isn't any. */
    public getTmapLight(tmapIndex: number): number {
        const tmap = this.gameDataSource.tmaps[tmapIndex];
        if (tmap == null) return 0;
        return tmap.lighting;
    }

    /** Returns texture slide data for a TMAP index. */
    public getTmapSlide(tmapIndex: number): [number, number] {
        const tmap = this.gameDataSource.tmaps[tmapIndex];
        if (tmap == null) return [0, 0];
        return [tmap.slideU, tmap.slideV];
    }

    /** Returns animation data for a VCLIP index, or null if not found. */
    public getVClipAnimation(vclipId: number): DescentVClipData | null {
        const vclip = this.gameDataSource.vclips[vclipId];
        if (vclip == null) return null;
        return {
            timeMultiplier: 1.0 / vclip.frameTime,
            bitmapIds: vclip.bitmapIndex.slice(0, vclip.numFrames),
            vclip,
        };
    }

    /** Returns a polymodel by polymodel index, or null if not found. */
    public getPolymodel(polymodelIndex: number) {
        return this.gameDataSource.polymodels[polymodelIndex] ?? null;
    }

    /** Returns a robot by robot index, or null if not found. */
    public getRobotInfo(subtypeId: number) {
        return this.gameDataSource.robots[subtypeId] ?? null;
    }

    private get objEclipIndex() {
        let index = this.objEclipIndexData;
        if (index == null) {
            const dataSource = this.gameDataSource;
            this.objEclipIndexData = index = new Map();
            for (let i = 0; i < dataSource.eclips.length; ++i) {
                const eclip = dataSource.eclips[i];
                const texnum = eclip.changingObjectTexture;
                if (texnum !== -1) index.set(eclip.changingObjectTexture, i);
            }
        }
        return index;
    }

    /** Returns an object bitmap ID for a specific texture in a polymodel. */
    public resolveObjectBitmap(
        polymodel: DescentPolymodel,
        textureIndex: number,
    ) {
        const dataSource = this.gameDataSource;
        const texturePointerOffset =
            polymodel.texturePointerOffset + textureIndex;
        return dataSource.objBitmapPointers[texturePointerOffset];
    }

    /** Returns the bitmap ID for an object bitmap ID. */
    public getObjectBitmapId(resolvedObjectBitmapId: number) {
        return this.gameDataSource.objBitmapIds[resolvedObjectBitmapId];
    }

    /** Returns animation data for an object bitmap ID, or `null` if there isn't any. */
    public getObjectBitmapAnimation(
        resolvedObjectBitmapId: number,
    ): DescentVClipData | null {
        const index = this.objEclipIndex;
        const eclipNum = index.get(resolvedObjectBitmapId);
        if (eclipNum === undefined) return null;
        const eclip = this.gameDataSource.eclips[eclipNum];
        if (eclip == null) return null;
        const vclip = eclip.vclip;
        return {
            timeMultiplier: 1.0 / vclip.frameTime,
            bitmapIds: vclip.bitmapIndex.slice(0, vclip.numFrames),
            vclip,
        };
    }
}
