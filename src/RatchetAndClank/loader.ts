import { ChunkPlane, readClassPositionBlock, readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readLevelSettings, readMobyInstance, readPathBlock, readPointLightInstance, readShrubInstance, readTieAmbientRgbaBlock, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_MOBY_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieAmbientRgbaBlock, TieInstance } from "./bin-gameplay";
import { DataViewExt } from "./DataViewExt";
import { GsRamTableEntry, MobyClass, readCollision, readGsRamTableEntry, readMobyClass, readShrubClass, readSky, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, ShrubClass, SIZEOF_GS_RAM_TABLE_ENTRY, SIZEOF_TFRAG_HEADER, TieClass } from "./bin-core";
import { filterInstancesByChunkPlane, filterMobyInstancesByChunkPlane, GN, makeClassOClassMap, makeInstanceOClassMap, makeTextureIndicesByOClassMap, noclipSpaceFromRatchetSpace } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readPalette8TextureSky, readPalette8TextureWithPaletteInGsRam } from "./textures";
import { ClassEntry, readClassEntry, readLevelCoreHeader, readTextureEntry, SIZEOF_MOBY_CLASS_ENTRY, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TIE_CLASS_ENTRY, TextureEntry } from "./bin-index";
import { DirectionLightInstance, GameplayHeader, LevelSettings, MobyInstance, PointLightInstance, Spline } from "./bin-gameplay";
import { PaletteTexture } from "./textures";
import { Collision, Sky, Tfrag } from "./bin-core";
import { LevelCoreHeader } from "./bin-index";
import { DataFetcher } from "../DataFetcher";
import { WadDecompressor } from "./decompress";
import { mat4, vec3 } from "gl-matrix";

export interface LevelResources {
    levelCoreHeader: LevelCoreHeader | null,
    gameplayHeader: GameplayHeader | null,

    gsTable: GsRamTableEntry[] | null,
    levelSettings: LevelSettings | null,
    paths: Spline[] | null,
    grindPaths: Spline[] | null,
    directionLights: DirectionLightInstance[] | null,
    pointLights: PointLightInstance[] | null,
    collisionGetter: (() => Collision) | null,

    tfrags: Tfrag[] | null,
    tfragTextures: PaletteTexture[] | null,

    tieTextures: PaletteTexture[] | null,
    tieOClasses: number[] | null,
    tieClasses: Map<number, TieClass> | null,
    tieClassTextureIndices: Map<number, number[]> | null,
    tieInstances: TieInstance[] | null,
    tieInstancesByOClass: Map<number, TieInstance[]> | null,
    tieAmbientRgbas: TieAmbientRgbaBlock | null,

    mobyTextures: PaletteTexture[] | null,
    mobyGsStashList: number[] | null,
    mobyOClasses: number[] | null,
    mobyClasses: Map<number, MobyClass | null> | null,
    mobyClassTextureIndices: Map<number, number[]> | null,
    mobyInstances: MobyInstance[] | null,
    mobyInstancesByOClass: Map<number, MobyInstance[]> | null,

    shrubTextures: PaletteTexture[] | null,
    shrubOClasses: number[] | null,
    shrubClasses: Map<number, ShrubClass> | null,
    shrubClassTextureIndices: Map<number, number[]> | null,
    shrubInstances: ShrubInstance[] | null,
    shrubInstancesByOClass: Map<number, ShrubInstance[]> | null,

    sky: Sky | null,
    skyTextures: PaletteTexture[] | null,
};

async function toDataViewExt(slicePromise: Promise<ArrayBufferSlice>): Promise<DataViewExt> {
    const slice = await slicePromise;
    return new DataViewExt(slice.arrayBuffer, { littleEndian: true }, slice.byteOffset, slice.byteLength);
}

async function checkNotEmpty(slicePromise: Promise<DataViewExt>): Promise<DataViewExt> {
    const slice = await slicePromise;
    if (slice.byteLength === 0) {
        throw new Error("Request aborted")
    }
    return slice;
}

async function decompressWadPromise(dataViewPromise: Promise<DataViewExt>): Promise<DataViewExt> {
    const dataView = await dataViewPromise;
    // I'd really like to do streaming decompression but it requires pretty big changes to dataFetcher
    const decompressedBuffer = (new WadDecompressor(dataView)).decompress();
    return new DataViewExt(decompressedBuffer, { littleEndian: true });
}

type BinaryFilePromises = {
    coreDataFilePromise: Promise<DataViewExt>,
    gameplayFilePromise: Promise<DataViewExt>,
    coreIndexFilePromise: Promise<DataViewExt>,
    gsRamFilePromise: Promise<DataViewExt>,
    chunkTfragFilePromise: Promise<DataViewExt> | null,
    chunkCollisionFilePromise: Promise<DataViewExt> | null,
}
export function loadFilesFromNetwork(dataFetcher: DataFetcher, basePath: string, chunkNumber: number | null): BinaryFilePromises {
    // load binary files
    return {
        coreDataFilePromise: decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_core.wad`)))),
        gameplayFilePromise: decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_gameplay.wad`)))),
        coreIndexFilePromise: checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_index.bin`))),
        gsRamFilePromise: checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_gs.bin`))),
        chunkTfragFilePromise: chunkNumber !== null ? decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_${chunkNumber}_tfrag.wad`)))) : null,
        chunkCollisionFilePromise: chunkNumber !== null ? decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_${chunkNumber}_collision.wad`)))) : null,
    }
}

export function load(gn: GN, filterChunk: number | null, out: LevelResources, filePromises: BinaryFilePromises) {
    const { coreDataFilePromise, gameplayFilePromise, coreIndexFilePromise, gsRamFilePromise, chunkTfragFilePromise, chunkCollisionFilePromise } = filePromises;

    // load metadata
    const gameplayHeaderPromise = loadGameplayHeader(gn, out, gameplayFilePromise);
    const indexDataPromise = loadIndexData(gn, out, coreIndexFilePromise);
    const levelSettingsPromise = loadLevelSettings(gn, out, gameplayFilePromise, gameplayHeaderPromise);

    // load assets
    const miscGameplayDataPromise = loadMiscGameplayData(gn, out, gameplayFilePromise, gameplayHeaderPromise);
    const instanceDataPromise = loadInstanceData(gn, out, filterChunk, gameplayFilePromise, gameplayHeaderPromise, levelSettingsPromise);
    let tfragDataPromise: Promise<void>;
    if (chunkTfragFilePromise) {
        tfragDataPromise = loadChunkTfragData(gn, out, chunkTfragFilePromise);
    } else {
        tfragDataPromise = loadTfragData(gn, out, coreDataFilePromise, indexDataPromise);
    }
    const tieDataPromise = loadTieData(gn, out, coreDataFilePromise, indexDataPromise);
    const mobyDataPromise = loadMobyData(gn, out, coreDataFilePromise, indexDataPromise);
    const shrubDataPromise = loadShrubData(gn, out, coreDataFilePromise, indexDataPromise);
    const textureDataPromise = loadTextureData(gn, out, coreDataFilePromise, gsRamFilePromise, indexDataPromise);
    let collisionDataPromise = Promise.resolve();
    if (chunkCollisionFilePromise) {
        collisionDataPromise = loadChunkCollisionData(gn, out, chunkCollisionFilePromise);
    } else {
        collisionDataPromise = loadCollisionData(gn, out, coreDataFilePromise, indexDataPromise);
    }
    const skyDataPromise = loadSkyData(gn, out, coreDataFilePromise, indexDataPromise);
    const tieAmbientRgbasPromise = loadTieAmbientRgbas(gn, out, gameplayFilePromise, gameplayHeaderPromise);

    return Promise.all([
        miscGameplayDataPromise,
        instanceDataPromise,
        tfragDataPromise,
        tieDataPromise,
        mobyDataPromise,
        shrubDataPromise,
        textureDataPromise,
        collisionDataPromise,
        skyDataPromise,
        tieAmbientRgbasPromise,
    ]);
}

type LoadIndexDataResult = {
    levelCoreHeader: LevelCoreHeader,
    tieClassEntries: ClassEntry[],
    mobyClassEntries: ClassEntry[],
    shrubClassEntries: ClassEntry[],
    tfragTextureEntries: TextureEntry[],
    tieTextureEntries: TextureEntry[],
    mobyTextureEntries: TextureEntry[],
    shrubTextureEntries: TextureEntry[],
};
export async function loadIndexData(gn: GN, out: LevelResources, coreIndexFilePromise: Promise<DataViewExt>): Promise<LoadIndexDataResult> {
    const coreIndexFile = await coreIndexFilePromise;

    const levelCoreHeader = readLevelCoreHeader(coreIndexFile);
    out.levelCoreHeader = levelCoreHeader;

    const tieClassEntries = coreIndexFile.subdivide(levelCoreHeader.tieClasses.offset, levelCoreHeader.tieClasses.count, SIZEOF_TIE_CLASS_ENTRY).map(readClassEntry);
    const mobyClassEntries = coreIndexFile.subdivide(levelCoreHeader.mobyClasses.offset, levelCoreHeader.mobyClasses.count, SIZEOF_MOBY_CLASS_ENTRY).map(readClassEntry);
    const shrubClassEntries = coreIndexFile.subdivide(levelCoreHeader.shrubClasses.offset, levelCoreHeader.shrubClasses.count, SIZEOF_SHRUB_CLASS_ENTRY).map(readClassEntry);

    const tfragTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tfragTextures.offset, levelCoreHeader.tfragTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tieTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tieTextures.offset, levelCoreHeader.tieTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const mobyTextureEntries = coreIndexFile.subdivide(levelCoreHeader.mobyTextures.offset, levelCoreHeader.mobyTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const shrubTextureEntries = coreIndexFile.subdivide(levelCoreHeader.shrubTextures.offset, levelCoreHeader.shrubTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);

    const mobyStashCount = gn === 1 ? 0 : levelCoreHeader.gadgetOffsetOrMobyStashCount;
    out.gsTable = coreIndexFile.subdivide(levelCoreHeader.gsRam.offset, levelCoreHeader.gsRam.count + mobyStashCount, SIZEOF_GS_RAM_TABLE_ENTRY).map(view => readGsRamTableEntry(view));
    out.mobyGsStashList = coreIndexFile.subdivide(levelCoreHeader.mobyGsStashList, mobyStashCount, 2).map(view => view.getUint16(0)).filter(oClass => !(oClass & 0x8000));

    out.tieClassTextureIndices = makeTextureIndicesByOClassMap(tieClassEntries);
    out.mobyClassTextureIndices = makeTextureIndicesByOClassMap(mobyClassEntries);
    out.shrubClassTextureIndices = makeTextureIndicesByOClassMap(shrubClassEntries);

    return {
        levelCoreHeader,
        tieClassEntries,
        mobyClassEntries,
        shrubClassEntries,
        tfragTextureEntries,
        tieTextureEntries,
        mobyTextureEntries,
        shrubTextureEntries,
    };
}

async function loadGameplayHeader(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>) {
    const gameplayFile = await gameplayFilePromise;
    const gameplayHeader = readGameplayHeader(gn, gameplayFile);
    out.gameplayHeader = gameplayHeader;
    return gameplayHeader;
}

async function loadInstanceData(gn: GN, out: LevelResources, filterChunk: number | null, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>, levelSettingsPromise: Promise<LevelSettings>) {
    const [gameplayFile, gameplayHeader, levelSettings] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise, levelSettingsPromise]);

    const chunkPlanes = levelSettings.chunkPlanes;

    out.tieOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.tieClasses));
    let tieInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.tieInstances), SIZEOF_TIE_INSTANCE(gn), (view, i) => readTieInstance(gn, view, i)).instances;
    tieInstances = filterInstancesByChunkPlane(filterChunk, tieInstances, chunkPlanes);
    out.tieInstances = tieInstances;
    out.tieInstancesByOClass = makeInstanceOClassMap(tieInstances);

    out.mobyOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.mobyClasses));
    const mobyInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE(gn), (view, i) => readMobyInstance(gn, view)).instances;
    out.mobyInstances = filterMobyInstancesByChunkPlane(filterChunk, mobyInstances, chunkPlanes);
    out.mobyInstancesByOClass = makeInstanceOClassMap(out.mobyInstances);

    out.shrubOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.shrubClasses));
    let shrubInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.shrubInstances), SIZEOF_SHRUB_INSTANCE, readShrubInstance).instances;
    shrubInstances = filterInstancesByChunkPlane(filterChunk, shrubInstances, chunkPlanes);
    out.shrubInstances = shrubInstances;
    out.shrubInstancesByOClass = makeInstanceOClassMap(shrubInstances);
}

async function loadTieData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.tieClassEntries;
    out.tieClasses = makeClassOClassMap(entries, entries.map(tieEntry => readTieClass(gn, coreDataFile.subview(tieEntry.offsetInCoreData), tieEntry.oClass)));
}

async function loadMobyData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.mobyClassEntries;
    out.mobyClasses = makeClassOClassMap(entries, entries.map(mobyEntry => {
        if (mobyEntry.offsetInCoreData === 0) return null; // ?
        return readMobyClass(gn, coreDataFile.subview(mobyEntry.offsetInCoreData), mobyEntry.oClass);
    }));
}

async function loadShrubData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.shrubClassEntries;
    out.shrubClasses = makeClassOClassMap(entries, entries.map(shrubEntry => readShrubClass(coreDataFile.subview(shrubEntry.offsetInCoreData))));
}

async function loadTfragData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const tfragBlockHeader = readTfragBlockHeader(coreDataFile.subview(indexData.levelCoreHeader.tfrags));
    const tfragHeaders = coreDataFile.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    out.tfrags = tfragHeaders.map(tfragHeader => readTfrag(coreDataFile.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader));
}

async function loadChunkTfragData(gn: GN, out: LevelResources, chunkTfragFilePromise: Promise<DataViewExt | null>) {
    const [chunkTfragFile] = await Promise.all([chunkTfragFilePromise]);
    if (!chunkTfragFile) return;

    const tfragBlockHeader = readTfragBlockHeader(chunkTfragFile);
    const tfragHeaders = chunkTfragFile.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    out.tfrags = tfragHeaders.map(tfragHeader => readTfrag(chunkTfragFile.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader));
}

async function loadTextureData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, gsRamFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, gsRamFile, indexData] = await Promise.all([coreDataFilePromise, gsRamFilePromise, indexDataPromise]);

    const textureData = coreDataFile.subview(indexData.levelCoreHeader.texturesBaseOffset);
    out.tfragTextures = indexData.tfragTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Tfrag", i));
    out.tieTextures = indexData.tieTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Tie", i));
    out.mobyTextures = indexData.mobyTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Moby", i));
    out.shrubTextures = indexData.shrubTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Shrub", i));
}

async function loadLevelSettings(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);
    const levelSettings = readLevelSettings(gn, gameplayFile.subview(gameplayHeader.levelSettings));
    out.levelSettings = levelSettings;
    return levelSettings;
}

async function loadMiscGameplayData(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.grindPaths = readGrindPathBlock(gameplayFile.subview(gameplayHeader.grindPaths));
    out.paths = readPathBlock(gameplayFile.subview(gameplayHeader.paths));

    out.directionLights = readInstanceBlock(gameplayFile.subview(gameplayHeader.directionLightInstances), SIZEOF_DIRECTION_LIGHT_INSTANCE, readDirectionLightInstance).instances;
    out.pointLights = readInstanceBlock(gameplayFile.subview(gameplayHeader.pointLightInstances), SIZEOF_POINT_LIGHT_INSTANCE, readPointLightInstance).instances;
}

export async function loadSkyData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const sky = readSky(coreDataFile.subview(indexData.levelCoreHeader.sky));
    out.sky = sky;
    out.skyTextures = sky.textureEntries.map((textureEntry, i) => readPalette8TextureSky(coreDataFile.subview(indexData.levelCoreHeader.sky), sky.header, textureEntry, i));
}

export async function loadCollisionData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    out.collisionGetter = () => {
        return readCollision(coreDataFile.subview(indexData.levelCoreHeader.collision));
    };
}

export async function loadChunkCollisionData(gn: GN, out: LevelResources, chunkCollisionFilePromise: Promise<DataViewExt | null>) {
    const [chunkCollisionFile] = await Promise.all([chunkCollisionFilePromise]);
    if (!chunkCollisionFile) return;

    out.collisionGetter = () => {
        return readCollision(chunkCollisionFile);
    };
}

export async function loadTieAmbientRgbas(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    if (gn <= 1) return;

    out.tieAmbientRgbas = readTieAmbientRgbaBlock(gameplayFile.subview(gameplayHeader.tieAmbientRgbas));
}
