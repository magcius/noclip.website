import { InstanceGroupBlock, MissionGameplayHeader, OcclusionMappings, Pvar, readClassPositionBlock, readDirectionLightInstance, readGameplayHeader, readGrindPathBlock, readInstanceBlock, readInstanceGroupBlock, readLevelSettings, readMissionGameplayHeader, readMobyInstance, readOcclusionMappings, readPathBlock, readPointLightBlock, readPointLightInstance, readPvars, readShapeArray, readShrubInstance, readTieAmbientRgbaBlock, readTieInstance, ShrubInstance, SIZEOF_DIRECTION_LIGHT_INSTANCE, SIZEOF_MOBY_INSTANCE, SIZEOF_POINT_LIGHT_INSTANCE, SIZEOF_SHRUB_INSTANCE, SIZEOF_TIE_INSTANCE, TieAmbientRgbaBlock, TieInstance } from "./bin-gameplay";
import { DataViewExt } from "./DataViewExt";
import { GsRamTableEntry, MobyClass, Occlusion, readCollision, readGsRamTableEntry, readMobyClass, readOcclusion, readShrubClass, readSky, readTfrag, readTfragBlockHeader, readTfragHeader, readTieClass, ShrubClass, SIZEOF_GS_RAM_TABLE_ENTRY, SIZEOF_TFRAG_HEADER, TieClass } from "./bin-core";
import { filterInstancesByChunkPlane, filterMobyInstancesByChunkPlane, GN, makeClassOClassMap, makeInstanceOClassMap as makeInstancesByOClass, makeTextureIndicesByOClassMap, populateMobyOcclusionBits, populateTieOcclusionBits } from "./utils";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readTexture_Sky, readTexture_Regular, readTexture_Fx } from "./textures";
import { ClassEntry, FxTextureEntry, readClassEntry, readFxTextureEntry, readLevelCoreHeader, readTextureEntry, readTitleHeader, SIZEOF_MOBY_CLASS_ENTRY, SIZEOF_SHRUB_CLASS_ENTRY, SIZEOF_TEXTURE_ENTRY, SIZEOF_TIE_CLASS_ENTRY, TextureEntry } from "./bin-index";
import { DirectionLightInstance, GameplayHeader, GameplayShape, LevelSettings, MobyInstance, PointLightInstance, Spline } from "./bin-gameplay";
import { PaletteTexture } from "./textures";
import { Collision, Sky, Tfrag } from "./bin-core";
import { LevelCoreHeader } from "./bin-index";
import { DataFetcher } from "../DataFetcher";
import { WadDecompressor } from "./decompress";
import { assert } from "../util";
import { LevelDataHeader, LevelDescriptor } from "./bin-toc";
import { OverlaySection, readOverlaySections } from "./bin-overlay";
import { MobyImpl } from "./moby-impl/moby";

export interface LevelResources {
    gn: GN,
    levelNumber: number,
    metadata: MetaFile | null,
    levelCoreHeader: LevelCoreHeader | null,
    gameplayHeader: GameplayHeader | null,
    missionGameplayHeader: MissionGameplayHeader | null,

    overlaySections: OverlaySection[] | null,
    gsTable: GsRamTableEntry[] | null,
    levelSettings: LevelSettings | null,
    occlusion: Occlusion | null,
    occlusionMappings: OcclusionMappings | null;
    paths: Spline[] | null,
    grindPaths: Spline[] | null,
    shapesCuboids: GameplayShape[] | null,
    shapesSpheres: GameplayShape[] | null,
    shapesCylinders: GameplayShape[] | null,
    shapesPills: GameplayShape[] | null,
    directionLights: DirectionLightInstance[] | null,
    pointLights: PointLightInstance[] | null,
    collisionGetter: (() => Collision) | null,

    tfrags: Tfrag[] | null,
    tfragTextures: PaletteTexture[] | null,

    tieTextures: PaletteTexture[] | null,
    tieOClasses: number[] | null,
    tieClasses: Map<number, TieClass> | null,
    tieClassTextureIndices: Map<number, number[]> | null,
    tieInstances: (TieInstance | null)[] | null, // null means filtered out by the chunk filter
    tieInstancesByOClass: TieInstance[][] | null,
    tieGroups: InstanceGroupBlock | null,
    tieAmbientRgbas: TieAmbientRgbaBlock | null,

    mobyTextures: PaletteTexture[] | null,
    mobyGsStashList: number[] | null,
    mobyOClasses: number[] | null,
    mobyClasses: Map<number, MobyClass | null> | null,
    mobyClassTextureIndices: Map<number, number[]> | null,
    mobyInstances: MobyInstance[] | null,
    mobyInstancesByOClass: MobyInstance[][] | null,
    mobyGroups: InstanceGroupBlock | null,
    mobyUniqueMissionIds: Set<number> | null,
    mobyImpls: MobyImpl[] | null,
    mobyImplShared: Record<string, number> | null,
    pvars: Pvar[] | null,

    missionMobyOClasses: number[] | null,
    missionMobyInstances: MobyInstance[] | null,
    missionMobyInstancesByOClass: MobyInstance[][] | null,
    missionMobyGroups: InstanceGroupBlock | null,


    shrubTextures: PaletteTexture[] | null,
    shrubOClasses: number[] | null,
    shrubClasses: Map<number, ShrubClass> | null,
    shrubClassTextureIndices: Map<number, number[]> | null,
    shrubInstances: (ShrubInstance | null)[] | null,
    shrubInstancesByOClass: ShrubInstance[][] | null,
    shrubGroups: InstanceGroupBlock | null,

    sky: Sky | null,
    skyTextures: PaletteTexture[] | null,

    fxTextures: PaletteTexture[] | null,
};

async function toDataViewExt(slicePromise: Promise<ArrayBufferSlice>): Promise<DataViewExt> {
    const slice = await slicePromise;
    const view = new DataViewExt(slice.arrayBuffer, { littleEndian: true }, slice.byteOffset, slice.byteLength);
    if (slice.byteLength === 0) {
        throw new Error("Request aborted")
    }
    return view;
}

async function jsonParse<T>(slicePromise: Promise<ArrayBufferSlice>): Promise<T> {
    const slice = await slicePromise;
    const textDecoder = new TextDecoder("utf-8");
    const str = textDecoder.decode(slice.arrayBuffer);
    return JSON.parse(str) as T;
}

// decompress a promisified buffer
async function decompress(dataViewPromise: Promise<DataViewExt>): Promise<DataViewExt> {
    const dataView = await dataViewPromise;
    // I'd really like to do streaming decompression but it requires pretty big changes to dataFetcher
    const decompressedBuffer = (new WadDecompressor(dataView)).decompress();
    return new DataViewExt(decompressedBuffer, { littleEndian: true });
}

interface MetaFile {
    files: {
        name: string;
        compressed: boolean;
        size: number;
        decompressedSize: number;
    }[];
    levelDataHeader: LevelDataHeader;
    levelDescriptor: LevelDescriptor;
}

export interface FilePromises {
    metadataFilePromise: Promise<MetaFile>,
    coreDataFilePromise: Promise<DataViewExt>,
    gameplayFilePromise: Promise<DataViewExt>,
    gameplayArtFilePromise: Promise<DataViewExt> | null,
    gameplayMissionFilePromise: Promise<DataViewExt> | null,
    coreIndexFilePromise: Promise<DataViewExt>,
    gsRamFilePromise: Promise<DataViewExt>,
    overlayFilePromise: Promise<DataViewExt>,
    chunkTfragFilePromise: Promise<DataViewExt> | null,
    chunkCollisionFilePromise: Promise<DataViewExt> | null,
}
export function loadFilesFromNetwork(dataFetcher: DataFetcher, basePath: string, gn: GN, chunkNumber: number | null, missionNumber: number | null): FilePromises {
    // load binary files
    return {
        metadataFilePromise: gn === 4 ? jsonParse<MetaFile>(dataFetcher.fetchData(`${basePath}.json`)) : (Promise.resolve({}) as Promise<MetaFile>), // metafile only used in rac4
        coreDataFilePromise: decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}_core.wad`))),
        gameplayFilePromise: decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}_gameplay.wad`))),
        gameplayArtFilePromise: gn === 4 ? decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}_gameplay_art.wad`))) : null,
        gameplayMissionFilePromise: missionNumber !== null ? toDataViewExt(dataFetcher.fetchData(`${basePath}_mission_${missionNumber}_gameplay.bin`)) : null,
        coreIndexFilePromise: toDataViewExt(dataFetcher.fetchData(`${basePath}_index.bin`)),
        gsRamFilePromise: toDataViewExt(dataFetcher.fetchData(`${basePath}_gs.bin`)),
        overlayFilePromise: toDataViewExt(dataFetcher.fetchData(`${basePath}_overlay.bin`)),
        chunkTfragFilePromise: chunkNumber !== null ? decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}_${chunkNumber}_tfrag.wad`))) : null,
        chunkCollisionFilePromise: chunkNumber !== null ? decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}_${chunkNumber}_collision.wad`))) : null,
    }
}
export function loadMissionFileFromNetworkOnly(dataFetcher: DataFetcher, basePath: string, gn: GN, missionNumber: number | null): Pick<FilePromises, "gameplayMissionFilePromise"> {
    return {
        gameplayMissionFilePromise: missionNumber !== null ? toDataViewExt(dataFetcher.fetchData(`${basePath}_mission_${missionNumber}_gameplay.bin`)) : null,
    }
}
export function loadTitleFileFromNetwork(dataFetcher: DataFetcher, basePath: string): { titleFilePromise: Promise<DataViewExt> } {
    return {
        titleFilePromise: decompress(toDataViewExt(dataFetcher.fetchData(`${basePath}.wad`))),
    };
}

export function load(gn: GN, levelNumber: number, filterChunk: number | null, out: LevelResources, filePromises: FilePromises) {
    const { metadataFilePromise, coreDataFilePromise, gameplayFilePromise, gameplayArtFilePromise, gameplayMissionFilePromise, coreIndexFilePromise, gsRamFilePromise, chunkTfragFilePromise, chunkCollisionFilePromise, overlayFilePromise } = filePromises;

    const gameplayHeaderPromise = loadGameplayHeader(gn, out, gameplayFilePromise, gameplayArtFilePromise);
    const indexDataPromise = loadIndexData(gn, out, coreIndexFilePromise);
    const levelSettingsPromise = loadLevelSettings(gn, out, gameplayFilePromise, gameplayHeaderPromise);
    const occlusionPromise = loadOcclusionData(gn, out, coreDataFilePromise, indexDataPromise);
    const occlusionMappingsPromise = loadOcclusionMappings(gn, out, gameplayFilePromise, gameplayArtFilePromise, gameplayHeaderPromise, occlusionPromise);
    const mobyInstanceDataMainPromise = loadMobyInstanceData_Gameplay(gn, out, filterChunk, gameplayFilePromise, gameplayHeaderPromise, levelSettingsPromise, occlusionMappingsPromise);

    let tfragDataPromise: Promise<void>;
    if (chunkTfragFilePromise) {
        tfragDataPromise = loadChunkTfragData(gn, out, chunkTfragFilePromise);
    } else {
        tfragDataPromise = loadTfragData(gn, out, coreDataFilePromise, indexDataPromise);
    }

    let collisionDataPromise: Promise<void>;
    if (chunkCollisionFilePromise) {
        collisionDataPromise = loadChunkCollisionData(gn, out, chunkCollisionFilePromise);
    } else {
        collisionDataPromise = loadCollisionData(gn, out, coreDataFilePromise, indexDataPromise);
    }

    return Promise.all([
        loadMetadata(gn, out, metadataFilePromise),
        loadShapeData(out, gameplayFilePromise, gameplayHeaderPromise),
        loadPathData(gn, out, gameplayFilePromise, gameplayHeaderPromise),
        loadDirectionLights(gn, out, gameplayFilePromise, gameplayArtFilePromise, gameplayHeaderPromise),
        loadPointLights(gn, out, gameplayFilePromise, gameplayHeaderPromise),
        occlusionPromise,
        loadTieAndShrubInstanceData(gn, out, filterChunk, gameplayFilePromise, gameplayArtFilePromise, gameplayHeaderPromise, levelSettingsPromise, occlusionMappingsPromise),
        mobyInstanceDataMainPromise,
        loadMobyInstanceData_Mission(gn, out, filterChunk, gameplayMissionFilePromise, levelSettingsPromise, mobyInstanceDataMainPromise, occlusionMappingsPromise),
        occlusionMappingsPromise,
        tfragDataPromise,
        loadTieData(gn, out, coreDataFilePromise, indexDataPromise),
        loadMobyData(gn, out, coreDataFilePromise, indexDataPromise),
        loadShrubData(gn, out, coreDataFilePromise, indexDataPromise),
        loadTextureData(gn, out, coreDataFilePromise, gsRamFilePromise, indexDataPromise),
        collisionDataPromise,
        loadSkyData(gn, levelNumber, out, coreDataFilePromise, indexDataPromise),
        loadTieAmbientRgbas(gn, out, gameplayFilePromise, gameplayArtFilePromise, gameplayHeaderPromise),
        loadOverlaySections(gn, out, overlayFilePromise),
        loadPvars(gn, out, gameplayFilePromise, gameplayHeaderPromise),
    ]);
}

export async function load_Rac1TitleLevel(out: LevelResources, titleFilePromise: Promise<DataViewExt>): Promise<void> {
    // the title screen is pretty similar to a regular level, but everything is smashed into a single file
    const gn: GN = 1;
    const file = await titleFilePromise;
    const header = readTitleHeader(file);
    assert(header.titleLevelData_Rac1 !== null);

    const { gsRam: gsRamOffset, coreData: coreDataOffset, coreDataSize } = header.titleLevelData_Rac1;
    const titleGsRam = file.subview(gsRamOffset);
    const titleCoreData = file.subview(coreDataOffset);
    const gameplayFile = file.subview(coreDataOffset + coreDataSize); // from end of core data to end of file

    const indexData = loadIndexDataFromHeader(gn, out, file, header);

    const coreDataFilePromise = Promise.resolve(titleCoreData);
    const gsRamFilePromise = Promise.resolve(titleGsRam);
    const gameplayFilePromise = Promise.resolve(gameplayFile);
    const indexDataPromise = Promise.resolve(indexData);
    const gameplayHeaderPromise = loadGameplayHeader(gn, out, gameplayFilePromise, null);
    const levelSettingsPromise = loadLevelSettings(gn, out, gameplayFilePromise, gameplayHeaderPromise);
    const noOcclusionMappingsPromise = Promise.resolve(null);

    await Promise.all([
        loadTieData(gn, out, coreDataFilePromise, indexDataPromise),
        loadMobyData(gn, out, coreDataFilePromise, indexDataPromise),
        loadShrubData(gn, out, coreDataFilePromise, indexDataPromise),
        loadTfragData(gn, out, coreDataFilePromise, indexDataPromise),
        loadTextureData(gn, out, coreDataFilePromise, gsRamFilePromise, indexDataPromise),
        loadSkyData(gn, -1, out, coreDataFilePromise, indexDataPromise),
        loadDirectionLights(gn, out, gameplayFilePromise, null, gameplayHeaderPromise),
        loadPointLights(gn, out, gameplayFilePromise, gameplayHeaderPromise),
        loadTieAndShrubInstanceData(gn, out, null, gameplayFilePromise, null, gameplayHeaderPromise, levelSettingsPromise, noOcclusionMappingsPromise),
        loadMobyInstanceData_Gameplay(gn, out, null, gameplayFilePromise, gameplayHeaderPromise, levelSettingsPromise, noOcclusionMappingsPromise),
    ]);
}

// clears then reloads mission-related resources
export async function reloadMissionMobys(gn: GN, filterChunk: number | null, out: LevelResources, filePromises: FilePromises) {
    out.missionGameplayHeader = null;
    out.missionMobyInstances = null;
    out.missionMobyOClasses = null;
    out.missionMobyInstancesByOClass = null;
    out.missionMobyGroups = null;

    const { gameplayFilePromise, gameplayArtFilePromise, gameplayMissionFilePromise } = filePromises;
    const gameplayHeaderPromise = loadGameplayHeader(gn, out, gameplayFilePromise, gameplayArtFilePromise);
    const levelSettingsPromise = loadLevelSettings(gn, out, gameplayFilePromise, gameplayHeaderPromise);
    // TODO: occlusion mappings?
    const mobyInstanceDataMissionPromise = loadMobyInstanceData_Mission(gn, out, filterChunk, gameplayMissionFilePromise, levelSettingsPromise, Promise.resolve(), Promise.resolve(null));

    await mobyInstanceDataMissionPromise;
}

async function loadMetadata(gn: GN, out: LevelResources, metadataPromise: Promise<MetaFile>) {
    out.metadata = await metadataPromise;
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
    fxTextureEntries: FxTextureEntry[],
    gsTable: GsRamTableEntry[],
    mobyGsStashList: number[],
    tieClassTextureIndices: Map<number, number[]>,
    mobyClassTextureIndices: Map<number, number[]>,
    shrubClassTextureIndices: Map<number, number[]>,
};
export async function loadIndexData(gn: GN, out: LevelResources, coreIndexFilePromise: Promise<DataViewExt>): Promise<LoadIndexDataResult> {
    const coreIndexFile = await coreIndexFilePromise;
    const levelCoreHeader = readLevelCoreHeader(coreIndexFile);
    return loadIndexDataFromHeader(gn, out, coreIndexFile, levelCoreHeader);
}

function loadIndexDataFromHeader(gn: GN, out: LevelResources, coreIndexFile: DataViewExt, levelCoreHeader: LevelCoreHeader): LoadIndexDataResult {
    out.levelCoreHeader = levelCoreHeader;

    const indexData = readIndexData(gn, coreIndexFile, levelCoreHeader);
    out.gsTable = indexData.gsTable;
    out.mobyGsStashList = indexData.mobyGsStashList;
    out.tieClassTextureIndices = indexData.tieClassTextureIndices;
    out.mobyClassTextureIndices = indexData.mobyClassTextureIndices;
    out.shrubClassTextureIndices = indexData.shrubClassTextureIndices;
    return indexData;
}

function readIndexData(gn: GN, coreIndexFile: DataViewExt, levelCoreHeader: LevelCoreHeader): LoadIndexDataResult {

    const tieClassEntries = coreIndexFile.subdivide(levelCoreHeader.tieClasses.offset, levelCoreHeader.tieClasses.count, SIZEOF_TIE_CLASS_ENTRY).map(readClassEntry);
    const mobyClassEntries = coreIndexFile.subdivide(levelCoreHeader.mobyClasses.offset, levelCoreHeader.mobyClasses.count, SIZEOF_MOBY_CLASS_ENTRY).map(readClassEntry);
    const shrubClassEntries = coreIndexFile.subdivide(levelCoreHeader.shrubClasses.offset, levelCoreHeader.shrubClasses.count, SIZEOF_SHRUB_CLASS_ENTRY).map(readClassEntry);

    const tfragTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tfragTextures.offset, levelCoreHeader.tfragTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const tieTextureEntries = coreIndexFile.subdivide(levelCoreHeader.tieTextures.offset, levelCoreHeader.tieTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const mobyTextureEntries = coreIndexFile.subdivide(levelCoreHeader.mobyTextures.offset, levelCoreHeader.mobyTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const shrubTextureEntries = coreIndexFile.subdivide(levelCoreHeader.shrubTextures.offset, levelCoreHeader.shrubTextures.count, SIZEOF_TEXTURE_ENTRY).map(readTextureEntry);
    const fxTextureEntries = coreIndexFile.subdivide(levelCoreHeader.fxTextures.offset, levelCoreHeader.fxTextures.count, SIZEOF_TEXTURE_ENTRY).map(readFxTextureEntry);

    const mobyStashCount = gn === 1 ? 0 : levelCoreHeader.gadgetOffsetOrMobyStashCount;
    const gsTable = coreIndexFile.subdivide(levelCoreHeader.gsRam.offset, levelCoreHeader.gsRam.count + mobyStashCount, SIZEOF_GS_RAM_TABLE_ENTRY).map(readGsRamTableEntry);
    const mobyGsStashList = coreIndexFile.subdivide(levelCoreHeader.mobyGsStashList, mobyStashCount, 2).map(view => view.getUint16(0)).filter(oClass => !(oClass & 0x8000));

    const tieClassTextureIndices = makeTextureIndicesByOClassMap(tieClassEntries);
    const mobyClassTextureIndices = makeTextureIndicesByOClassMap(mobyClassEntries);
    const shrubClassTextureIndices = makeTextureIndicesByOClassMap(shrubClassEntries);

    return {
        levelCoreHeader,
        tieClassEntries,
        mobyClassEntries,
        shrubClassEntries,
        tfragTextureEntries,
        tieTextureEntries,
        mobyTextureEntries,
        shrubTextureEntries,
        fxTextureEntries,
        gsTable,
        mobyGsStashList,
        tieClassTextureIndices,
        mobyClassTextureIndices,
        shrubClassTextureIndices,
    };
}

async function loadGameplayHeader(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayArtFilePromise: Promise<DataViewExt> | null) {
    const [gameplayFile, artFile] = await Promise.all([gameplayFilePromise, gameplayArtFilePromise]);
    const gameplayHeader = readGameplayHeader(gn, gameplayFile, artFile);
    out.gameplayHeader = gameplayHeader;
    return gameplayHeader;
}

async function loadTieAndShrubInstanceData(gn: GN, out: LevelResources, filterChunk: number | null, gameplayFilePromise: Promise<DataViewExt>, artFilePromise: Promise<DataViewExt> | null, gameplayHeaderPromise: Promise<GameplayHeader>, levelSettingsPromise: Promise<LevelSettings>, occlusionMappingsPromise: Promise<OcclusionMappings | null>) {
    const [gameplayHeader, levelSettings, occlusionMappings] = await Promise.all([gameplayHeaderPromise, levelSettingsPromise, occlusionMappingsPromise]);

    let srcFile: DataViewExt;
    switch (gn) {
        case 1:
        case 2:
        case 3: {
            srcFile = await gameplayFilePromise;
            break;
        }
        case 4: {
            assert(artFilePromise !== null);
            srcFile = await artFilePromise;
            break;
        }
    }

    out.tieOClasses = readClassPositionBlock(srcFile.subview(gameplayHeader.tieClasses));
    if (gameplayHeader.tieGroups) {
        out.tieGroups = readInstanceGroupBlock(srcFile.subview(gameplayHeader.tieGroups));
    }
    const tieInstances = readInstanceBlock(srcFile.subview(gameplayHeader.tieInstances), SIZEOF_TIE_INSTANCE(gn), (view, i) => readTieInstance(gn, view, i));
    populateTieOcclusionBits(tieInstances, occlusionMappings);
    const tieInstancesFiltered = filterInstancesByChunkPlane(filterChunk, tieInstances, levelSettings.chunkPlanes);
    out.tieInstances = tieInstancesFiltered;
    out.tieInstancesByOClass = makeInstancesByOClass(tieInstancesFiltered);

    out.shrubOClasses = readClassPositionBlock(srcFile.subview(gameplayHeader.shrubClasses));
    if (gameplayHeader.shrubGroups) {
        out.shrubGroups = readInstanceGroupBlock(srcFile.subview(gameplayHeader.shrubGroups));
    }
    const shrubInstances = readInstanceBlock(srcFile.subview(gameplayHeader.shrubInstances), SIZEOF_SHRUB_INSTANCE, readShrubInstance);
    const shrubInstancesFiltered = filterInstancesByChunkPlane(filterChunk, shrubInstances, levelSettings.chunkPlanes);
    out.shrubInstances = shrubInstancesFiltered;
    out.shrubInstancesByOClass = makeInstancesByOClass(shrubInstancesFiltered);
}

async function loadMobyInstanceData_Gameplay(gn: GN, out: LevelResources, filterChunk: number | null, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>, levelSettingsPromise: Promise<LevelSettings>, occlusionMappingsPromise: Promise<OcclusionMappings | null>) {
    const [gameplayHeader, levelSettings, gameplayFile, occlusionMappings] = await Promise.all([gameplayHeaderPromise, levelSettingsPromise, gameplayFilePromise, occlusionMappingsPromise]);

    out.mobyOClasses = readClassPositionBlock(gameplayFile.subview(gameplayHeader.mobyClasses));
    if (gameplayHeader.mobyGroups) {
        out.mobyGroups = readInstanceGroupBlock(gameplayFile.subview(gameplayHeader.mobyGroups));
    }
    const mobyInstances = readInstanceBlock(gameplayFile.subview(gameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE(gn), (view, i) => readMobyInstance(gn, view, i));
    populateMobyOcclusionBits(mobyInstances, occlusionMappings);
    out.mobyUniqueMissionIds = new Set();
    for (let i = 0; i < mobyInstances.length; i++) out.mobyUniqueMissionIds.add(mobyInstances[i].mission);
    out.mobyInstances = filterMobyInstancesByChunkPlane(filterChunk, mobyInstances, levelSettings.chunkPlanes);
    out.mobyInstancesByOClass = makeInstancesByOClass(out.mobyInstances);
}

async function loadMobyInstanceData_Mission(gn: GN, out: LevelResources, filterChunk: number | null, missionGameplayFilePromise: Promise<DataViewExt> | null, levelSettingsPromise: Promise<LevelSettings>, mainMobyPromise: Promise<void>, occlusionMappingsPromise: Promise<OcclusionMappings | null>) {
    const [missionGameplayFile, levelSettings, occlusionMappings] = await Promise.all([missionGameplayFilePromise, levelSettingsPromise, occlusionMappingsPromise]);

    // no mission file
    if (!missionGameplayFile) return;

    // ensure the main mobys are done to ensure deterministic ordering
    await mainMobyPromise;

    const missionGameplayHeader = readMissionGameplayHeader(missionGameplayFile);
    out.missionGameplayHeader = missionGameplayHeader;
    if (missionGameplayHeader.mobyGroups) {
        out.missionMobyGroups = readInstanceGroupBlock(missionGameplayFile.subview(missionGameplayHeader.mobyGroups));
    }

    out.missionMobyOClasses = readClassPositionBlock(missionGameplayFile.subview(missionGameplayHeader.mobyClasses));
    const mobyInstances = readInstanceBlock(missionGameplayFile.subview(missionGameplayHeader.mobyInstances), SIZEOF_MOBY_INSTANCE(gn), (view, i) => readMobyInstance(gn, view, i));
    populateMobyOcclusionBits(mobyInstances, occlusionMappings);
    out.missionMobyInstances = filterMobyInstancesByChunkPlane(filterChunk, mobyInstances, levelSettings.chunkPlanes);
    out.missionMobyInstancesByOClass = makeInstancesByOClass(out.missionMobyInstances);

    // TODO: load mission moby class files
}

async function loadTieData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    const entries = indexData.tieClassEntries;
    out.tieClasses = makeClassOClassMap(entries, entries.map((tieEntry, classIndex) => readTieClass(gn, coreDataFile.subview(tieEntry.offsetInCoreData), tieEntry.oClass, classIndex)));
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
    out.tfrags = tfragHeaders.map((tfragHeader, i) => readTfrag(coreDataFile.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader, i));
}

async function loadChunkTfragData(gn: GN, out: LevelResources, chunkTfragFilePromise: Promise<DataViewExt> | null) {
    const [chunkTfragFile] = await Promise.all([chunkTfragFilePromise]);
    if (!chunkTfragFile) return;

    const tfragBlockHeader = readTfragBlockHeader(chunkTfragFile);
    const tfragHeaders = chunkTfragFile.subdivide(tfragBlockHeader.tableOffset, tfragBlockHeader.tfragCount, SIZEOF_TFRAG_HEADER).map(view => readTfragHeader(view));
    out.tfrags = tfragHeaders.map((tfragHeader, i) => readTfrag(chunkTfragFile.subview(tfragBlockHeader.tableOffset + tfragHeader.data), tfragHeader, i));
}

async function loadTextureData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, gsRamFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, gsRamFile, indexData] = await Promise.all([coreDataFilePromise, gsRamFilePromise, indexDataPromise]);

    const textureData = coreDataFile.subview(indexData.levelCoreHeader.texturesBaseOffset);
    const fxBank = coreDataFile.subview(indexData.levelCoreHeader.fxBankOffset);
    out.tfragTextures = indexData.tfragTextureEntries.map((entry, i) => readTexture_Regular(gn, entry, textureData, gsRamFile, "Tfrag", i));
    out.tieTextures = indexData.tieTextureEntries.map((entry, i) => readTexture_Regular(gn, entry, textureData, gsRamFile, "Tie", i));
    out.mobyTextures = indexData.mobyTextureEntries.map((entry, i) => readTexture_Regular(gn, entry, textureData, gsRamFile, "Moby", i));
    out.shrubTextures = indexData.shrubTextureEntries.map((entry, i) => readTexture_Regular(gn, entry, textureData, gsRamFile, "Shrub", i));
    out.fxTextures = indexData.fxTextureEntries.map((entry, i) => readTexture_Fx(gn, entry, fxBank, i));
}

async function loadLevelSettings(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    const levelSettings = readLevelSettings(gn, gameplayFile.subview(gameplayHeader.levelSettings));
    out.levelSettings = levelSettings;
    return levelSettings;
}

async function loadPathData(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.grindPaths = readGrindPathBlock(gameplayFile.subview(gameplayHeader.grindPaths));
    out.paths = readPathBlock(gameplayFile.subview(gameplayHeader.paths));
}

async function loadShapeData(out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.shapesCuboids = readShapeArray(gameplayFile.subview(gameplayHeader.shapesCuboids));
    out.shapesSpheres = readShapeArray(gameplayFile.subview(gameplayHeader.shapesSpheres));
    out.shapesCylinders = readShapeArray(gameplayFile.subview(gameplayHeader.shapesCylinders));
    out.shapesPills = readShapeArray(gameplayFile.subview(gameplayHeader.shapesPills));
}

async function loadDirectionLights(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, artFilePromise: Promise<DataViewExt> | null, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const gameplayHeader = await gameplayHeaderPromise;

    let srcFile: DataViewExt;
    switch (gn) {
        case 1:
        case 2:
        case 3: {
            srcFile = await gameplayFilePromise;
            break;
        }
        case 4: {
            assert(artFilePromise !== null);
            srcFile = await artFilePromise;
            break;
        }
    }

    out.directionLights = readInstanceBlock(srcFile.subview(gameplayHeader.directionLightInstances), SIZEOF_DIRECTION_LIGHT_INSTANCE, readDirectionLightInstance);
}

async function loadPointLights(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);

    out.pointLights = readPointLightBlock(gn, gameplayFile.subview(gameplayHeader.pointLightInstances));
}

export async function loadSkyData(gn: GN, levelNumber: number, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    if (!indexData.levelCoreHeader.sky) {
        out.sky = {
            header: null,
            shells: [],
            textureEntries: []
        }
        out.skyTextures = [];
        return;
    }

    const sky = readSky(gn, levelNumber, coreDataFile.subview(indexData.levelCoreHeader.sky));
    out.sky = sky;
    out.skyTextures = sky.textureEntries.map((textureEntry, i) => readTexture_Sky(gn, coreDataFile.subview(indexData.levelCoreHeader.sky), sky.header!, textureEntry, i));
}

async function loadOcclusionMappings(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, artFilePromise: Promise<DataViewExt> | null, gameplayHeaderPromise: Promise<GameplayHeader>, occlusionPromise: Promise<Occlusion | null>) {
    const [gameplayHeader, occlusion] = await Promise.all([gameplayHeaderPromise, occlusionPromise]);

    let srcFile: DataViewExt;
    switch (gn) {
        case 1:
        case 2:
        case 3: {
            srcFile = await gameplayFilePromise;
            break;
        }
        case 4: {
            assert(artFilePromise !== null);
            srcFile = await artFilePromise;
            break;
        }
    }

    if (gameplayHeader.occlusionMappings === 0) return null;

    // you think if there's no occlusion grid there'd be no occlusion mappings?
    // wrong. you get garbage data.
    if (occlusion === null) return null;

    out.occlusionMappings = readOcclusionMappings(srcFile.subview(gameplayHeader.occlusionMappings));
    return out.occlusionMappings;
}

export async function loadOcclusionData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);

    if (indexData.levelCoreHeader.occlusion === 0) return null;
    out.occlusion = readOcclusion(coreDataFile.subview(indexData.levelCoreHeader.occlusion));
    return out.occlusion;
}

export async function loadCollisionData(gn: GN, out: LevelResources, coreDataFilePromise: Promise<DataViewExt>, indexDataPromise: Promise<LoadIndexDataResult>) {
    const [coreDataFile, indexData] = await Promise.all([coreDataFilePromise, indexDataPromise]);
    const collisionOffset = indexData.levelCoreHeader.collision;
    if (collisionOffset === 0) return;

    out.collisionGetter = () => {
        return readCollision(coreDataFile.subview(collisionOffset));
    };
}

export async function loadChunkCollisionData(gn: GN, out: LevelResources, chunkCollisionFilePromise: Promise<DataViewExt> | null) {
    const [chunkCollisionFile] = await Promise.all([chunkCollisionFilePromise]);
    if (!chunkCollisionFile) return;

    out.collisionGetter = () => {
        return readCollision(chunkCollisionFile);
    };
}

export async function loadTieAmbientRgbas(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, artFilePromise: Promise<DataViewExt> | null, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const gameplayHeader = await gameplayHeaderPromise;

    let srcFile: DataViewExt;
    switch (gn) {
        case 1: {
            // not present
            return;
        }
        case 2:
        case 3: {
            srcFile = await gameplayFilePromise;
            break;
        }
        case 4: {
            assert(artFilePromise !== null);
            srcFile = await artFilePromise;
            break;
        }
    }

    out.tieAmbientRgbas = readTieAmbientRgbaBlock(srcFile.subview(gameplayHeader.tieAmbientRgbas));
}

export async function loadOverlaySections(gn: GN, out: LevelResources, overlayFilePromise: Promise<DataViewExt> | null) {
    const overlayFile = await overlayFilePromise;
    if (!overlayFile) return;

    out.overlaySections = readOverlaySections(overlayFile);
}

export async function loadPvars(gn: GN, out: LevelResources, gameplayFilePromise: Promise<DataViewExt>, gameplayHeaderPromise: Promise<GameplayHeader>) {
    const [gameplayFile, gameplayHeader] = await Promise.all([gameplayFilePromise, gameplayHeaderPromise]);
    out.pvars = readPvars(gameplayFile, gameplayHeader.pvarTable, gameplayHeader.pvarData);
}
