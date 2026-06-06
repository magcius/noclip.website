import { readClassPositionBlock, readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readLevelSettings, readMobyInstance, readPathBlock, readPointLightInstance, readShrubInstance, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_MOBY_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieInstance } from "./bin-gameplay";
import { DataViewExt } from "./DataViewExt";
import { readCollision, readShrubClass, readSky, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, ShrubClass, SIZEOF_TFRAG_HEADER, TieClass } from "./bin-core";
import { makeClassOClassMap, makeInstanceOClassMap, makeTextureIndicesByOClassMap } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readPalette8TextureSky, readPalette8TextureWithPaletteInGsRam } from "./textures";
import { ClassEntry, readClassEntry, readLevelCoreHeader, readTextureEntry, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TIE_CLASS_ENTRY, TextureEntry } from "./bin-index";
import { DirectionLightInstance, GameplayHeader, LevelSettings, MobyInstance, PointLightInstance, Spline } from "./bin-gameplay";
import { PaletteTexture } from "./textures";
import { Collision, Sky, Tfrag } from "./bin-core";
import { LevelCoreHeader } from "./bin-index";
import { DataFetcher } from "../DataFetcher";
import { WadDecompressor } from "./decompress";

export interface LevelResources {
    levelCoreHeader: LevelCoreHeader | null,
    gameplayHeader: GameplayHeader | null,

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

    shrubTextures: PaletteTexture[] | null,
    shrubOClasses: number[] | null,
    shrubClasses: Map<number, ShrubClass> | null,
    shrubClassTextureIndices: Map<number, number[]> | null,
    shrubInstances: ShrubInstance[] | null,
    shrubInstancesByOClass: Map<number, ShrubInstance[]> | null,

    sky: Sky | null,
    skyTextures: PaletteTexture[] | null,

    mobyInstances: MobyInstance[] | null,
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
}
export function loadFilesFromNetwork(dataFetcher: DataFetcher, basePath: string): BinaryFilePromises {
    // load binary files
    return {
        coreDataFilePromise: decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_core.wad`)))),
        gameplayFilePromise: decompressWadPromise(checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_gameplay.wad`)))),
        coreIndexFilePromise: checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_index.bin`))),
        gsRamFilePromise: checkNotEmpty(toDataViewExt(dataFetcher.fetchData(`${basePath}_gs.bin`))),
    }
}

export function load(out: LevelResources, filePromises: BinaryFilePromises) {
    const { coreDataFilePromise, gameplayFilePromise, coreIndexFilePromise, gsRamFilePromise } = filePromises;

    // load metadata
    const gameplayHeaderPromise = loadGameplayHeader(out, gameplayFilePromise);
    const indexDataPromise = loadIndexData(out, coreIndexFilePromise);

    // load assets
    const miscGameplayDataPromise = loadMiscGameplayData(out, gameplayFilePromise, gameplayHeaderPromise);
    const instanceDataPromise = loadInstanceData(out, gameplayFilePromise, gameplayHeaderPromise);
    const tfragDataPromise = loadTfragData(out, coreDataFilePromise, indexDataPromise);
    const tieDataPromise = loadTieData(out, coreDataFilePromise, indexDataPromise);
    const shrubDataPromise = loadShrubData(out, coreDataFilePromise, indexDataPromise);
    const textureDataPromise = loadTextureData(out, coreDataFilePromise, gsRamFilePromise, indexDataPromise);
    const collisionDataPromise = loadCollisionData(out, coreDataFilePromise, indexDataPromise);
    const skyDataPromise = loadSkyData(out, coreDataFilePromise, indexDataPromise);

    return Promise.all([
        miscGameplayDataPromise,
        instanceDataPromise,
        tfragDataPromise,
        tieDataPromise,
        shrubDataPromise,
        textureDataPromise,
        collisionDataPromise,
        skyDataPromise,
    ]);
}

type LoadIndexDataResult = {
    levelCoreHeader: LevelCoreHeader,
    tieClassEntries: ClassEntry[],
    shrubClassEntries: ClassEntry[],
    tfragTextureEntries: TextureEntry[],
    tieTextureEntries: TextureEntry[],
    shrubTextureEntries: TextureEntry[],
};
export async function loadIndexData(out: LevelResources, coreIndexFilePromise: Promise<DataViewExt>): Promise<LoadIndexDataResult> {
    const coreIndexFile = await coreIndexFilePromise;

    const levelCoreHeader = readLevelCoreHeader(coreIndexFile);
    out.levelCoreHeader = levelCoreHeader;

    const tieClassEntries = coreIndexFile.subdivide(levelCoreHeader.tieClasses.offset, levelCoreHeader.tieClasses.count, SIZEOF_TIE_CLASS_ENTRY).map(readClassEntry);
    const shrubClassEntries = coreIndexFile.subdivide(levelCoreHeader.shrubClasses.offset, levelCoreHeader.shrubClasses.count, SIZEOF_SHRUB_CLASS_ENTRY).map(readClassEntry);

    const tfragTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tfragTextures.offset, levelCoreHeader.tfragTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tieTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tieTextures.offset, levelCoreHeader.tieTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const shrubTextureEntries = coreIndexFile.subdivide(levelCoreHeader.shrubTextures.offset, levelCoreHeader.shrubTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);

    out.tieClassTextureIndices = makeTextureIndicesByOClassMap(tieClassEntries);
    out.shrubClassTextureIndices = makeTextureIndicesByOClassMap(shrubClassEntries);

    return {
        levelCoreHeader,
        tieClassEntries,
        shrubClassEntries,
        tfragTextureEntries,
        tieTextureEntries,
        shrubTextureEntries,
    };
}

async function loadGameplayHeader(out: LevelResources, gameplayFilePromise: Promise<DataViewExt>) {
    const gameplayFile = await gameplayFilePromise;
    const gameplayHeader = readGameplayHeader(gameplayFile);
    out.gameplayHeader = gameplayHeader;
    return gameplayHeader;
}

async function loadInstanceData(out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.tieOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.tieClasses));
    const tieInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.tieInstances), SIZEOF_TIE_INSTANCE, readTieInstance).instances;
    out.tieInstances = tieInstances;
    out.tieInstancesByOClass = makeInstanceOClassMap(tieInstances);

    const mobyInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE, readMobyInstance).instances;
    out.mobyInstances = mobyInstances;

    out.shrubOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.shrubClasses));
    const shrubInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.shrubInstances), SIZEOF_SHRUB_INSTANCE, readShrubInstance).instances;
    out.shrubInstances = shrubInstances;
    out.shrubInstancesByOClass = makeInstanceOClassMap(shrubInstances);
}

async function loadTieData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.tieClassEntries;
    out.tieClasses = makeClassOClassMap(entries, entries.map(tieEntry => readTieClass(coreDataFile.subview(tieEntry.offsetInCoreData), tieEntry.oClass)));
}

async function loadShrubData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.shrubClassEntries;
    out.shrubClasses = makeClassOClassMap(entries, entries.map(shrubEntry => readShrubClass(coreDataFile.subview(shrubEntry.offsetInCoreData))));
}

async function loadTfragData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const tfragBlockHeader = readTfragBlockHeader(coreDataFile.subview(indexData.levelCoreHeader.tfrags));
    const tfragHeaders = coreDataFile.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    out.tfrags = tfragHeaders.map(tfragHeader => readTfrag(coreDataFile.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader));
}

async function loadTextureData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, gsRamFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, gsRamFile, indexData] = await Promise.all([coreDataFilePromise, gsRamFilePromise, indexDataPromise]);

    const textureData = coreDataFile.subview(indexData.levelCoreHeader.texturesBaseOffset);
    out.tfragTextures = indexData.tfragTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Tfrag", i));
    out.tieTextures = indexData.tieTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Tie", i));
    out.shrubTextures = indexData.shrubTextureEntries.map((entry, i) => readPalette8TextureWithPaletteInGsRam(entry, textureData, gsRamFile, "Shrub", i));
}

async function loadMiscGameplayData(out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.levelSettings = readLevelSettings(gameplayFile.subview(gameplayHeader.levelSettings));

    out.grindPaths = readGrindPathBlock(gameplayFile.subview(gameplayHeader.grindPaths));
    out.paths = readPathBlock(gameplayFile.subview(gameplayHeader.paths));

    out.directionLights = readInstanceBlock(gameplayFile.subview(gameplayHeader.directionLightInstances), SIZEOF_DIRECTION_LIGHT_INSTANCE, readDirectionLightInstance).instances;
    out.pointLights = readInstanceBlock(gameplayFile.subview(gameplayHeader.pointLightInstances), SIZEOF_POINT_LIGHT_INSTANCE, readPointLightInstance).instances;
}

export async function loadSkyData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const sky = readSky(coreDataFile.subview(indexData.levelCoreHeader.sky));
    out.sky = sky;
    out.skyTextures = sky.textureEntries.map((textureEntry, i) => readPalette8TextureSky(coreDataFile.subview(indexData.levelCoreHeader.sky), sky.header, textureEntry, i));
}

export async function loadCollisionData(out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    out.collisionGetter = () => {
        return readCollision(coreDataFile.subview(indexData.levelCoreHeader.collision));
    };
}

