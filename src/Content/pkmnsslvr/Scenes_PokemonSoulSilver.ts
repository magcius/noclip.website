
// Pokemon Platinum

import * as Viewer from '../../viewer';
import * as NARC from '../../nns_g3d/narc';

import { DataFetcher } from '../../DataFetcher';
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { MDL0Renderer } from '../../nns_g3d/render';
import { assert, assertExists } from '../../util';
import { mat4 } from 'gl-matrix';
import { SceneContext } from '../../SceneBase';
import { parseNSBMD, BTX0, parseNSBTX, fx32 } from '../../nns_g3d/NNS_G3D';
import { AABB } from '../../Geometry';
import { PlatinumMapRenderer, tryMDL0 } from '../pkmnpl/Scenes_PokemonPlatinum';

const pathBase = `PokemonSoulSilver`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    public fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountNARC(narc: NARC.NitroFS, root: string): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(`${root}/${i}.bin`, file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchNARC(path: string, root: string) {
        const fileData = await this.fetchFile(path);
        const narc = NARC.parse(fileData);
        this.mountNARC(narc, root);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

class PokemonSoulSilverSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private isRoom: boolean = true) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const modelCache = new ModelCache(dataFetcher);
        modelCache.fetchNARC(`land_data.narc`, 'land_data');
        modelCache.fetchNARC(`map_tex_set.narc`, 'map_tex_set');
        modelCache.fetchNARC(`build_model.narc`, 'build_model');
        modelCache.fetchNARC(`map_matrix.narc`, 'map_matrix');
        modelCache.fetchNARC(`bm_room.narc`, 'bm_room');
        await modelCache.waitForLoad();

        //Spacecats: TODO - General cleaning and organization. Fix issues with a few map chunks.

        const tilesets = new Map<number, BTX0>();
        const renderers: MDL0Renderer[] = [];
        const map_matrix_headers: number[][] = []
        const map_matrix_height: number[][] = [];
        const map_matrix_files: number[][] = [];
        const tileset_indices: number[] = [];

        const objectRoot = (this.isRoom ? 'bm_room' : 'build_model');

        const mapHeaders = (await dataFetcher.fetchData(`${pathBase}/maps.bin`)).createDataView();
        
        const mapHeaderIndex = parseInt(this.id);
        const mapFallbackTileset = mapHeaders.getUint8(mapHeaderIndex*24 + 0x01);
        const matrixIndex = mapHeaders.getUint8(mapHeaderIndex*24 + 0x04);

        for (let i = 0; i < 700; i++) {
            tileset_indices[i] = mapHeaders.getUint8((24 * i)+1);
        }

        const mapMatrixData = assertExists(modelCache.getFileData(`map_matrix/${matrixIndex}.bin`)).createDataView();
        const width = mapMatrixData.getUint8(0x00);
        const height = mapMatrixData.getUint8(0x01);
        const hasHeightLayer = mapMatrixData.getUint8(0x02) == 1;
        const hasHeaderLayer = mapMatrixData.getUint8(0x03) == 1;
        
        //Read header or file layer and set default height, if the header layer is included this is header, if its not its file
        let currentMatrixOffset = 0x05 + mapMatrixData.getUint8(0x04);
        for (let y = 0; y < height; y++) {
            map_matrix_files[y] = [];
            map_matrix_height[y] = [];
            map_matrix_headers[y] = [];
            for (let x = 0; x < width; x++) {
                const idx = mapMatrixData.getUint16(currentMatrixOffset, true);
                
                map_matrix_height[y][x] = 0;
                map_matrix_files[y][x] = idx;
                map_matrix_headers[y][x] = idx;
                currentMatrixOffset += 2;
            }   
        }
        
        if(hasHeightLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_height[y][x] = mapMatrixData.getUint8(currentMatrixOffset);
                    currentMatrixOffset += 1;
                }   
            }
        }

        //If the header data is included, the file indices will be after the height layer
        if(hasHeaderLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_files[y][x] = mapMatrixData.getUint16(currentMatrixOffset, true);
                    currentMatrixOffset += 2;
                }   
            }
        }

        //SpaceCats: This is a hack, but it works.
        let set_index = 0;
        while (modelCache.getFileData(`map_tex_set/${set_index}.bin`) !== null){
            tilesets.set(set_index, parseNSBTX(assertExists(modelCache.getFileData(`map_tex_set/${set_index}.bin`))));
            set_index++;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (map_matrix_files[y][x] === 0xFFFF)
                    continue;

                const mapDataFile = assertExists(modelCache.getFileData(`land_data/${map_matrix_files[y][x]}.bin`));
                const mapData = assertExists(mapDataFile).createDataView();

                const objectOffset = mapData.getUint32(0x00, true) + mapData.getUint16(0x12, true) + 0x14;
                const modelOffset = mapData.getUint32(0x04, true) + objectOffset;
                const modelSize = mapData.getUint32(0x08, true);
                const embeddedModelBMD = parseNSBMD(mapDataFile.slice(modelOffset, modelOffset + modelSize));

                const tilesetIndex = tileset_indices[map_matrix_headers[y][x]];

                let mapRenderer: MDL0Renderer | null = null;

                if (mapRenderer === null && tilesets.has(tilesetIndex))
                    mapRenderer = tryMDL0(device, embeddedModelBMD.models[0], assertExists(tilesets.get(tilesetIndex)!.tex0));
                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, embeddedModelBMD.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                if (mapRenderer === null)
                    continue;

                mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);

                const bbox = new AABB(-256, -256, -256, 256, 256, 256);
                bbox.transform(bbox, mapRenderer.modelMatrix);
                mapRenderer.bbox = bbox;
                renderers.push(mapRenderer);

                const objectCount = (modelOffset - objectOffset) / 0x30;
                for (let objIndex = 0; objIndex <  objectCount; objIndex++) {
                    const currentObjOffset = objectOffset + (objIndex * 0x30);
                    const modelID = mapData.getUint32(currentObjOffset, true);
                    if (modelID > 338) // just a quick check to make sure the model exists.
                        continue;
                    
                    const posX = fx32(mapData.getInt32(currentObjOffset + 0x04, true));
                    const posY = fx32(mapData.getInt32(currentObjOffset + 0x08, true));
                    const posZ = fx32(mapData.getInt32(currentObjOffset + 0x0C, true));

                    let modelFile: ArrayBufferSlice | null = null;
                    try {
                        modelFile = assertExists(modelCache.getFileData(`${objectRoot}/${modelID}.bin`));
                    } catch{
                        continue;
                    }

                    const objBmd = parseNSBMD(modelFile);
                    let renderer: MDL0Renderer | null = null;
                    if(renderer === null)
                        renderer = tryMDL0(device, objBmd.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                    if (renderer === null)
                        renderer = tryMDL0(device, objBmd.models[0], assertExists(objBmd.tex0));
                    if (renderer === null)
                        continue;

                    renderer.bbox = bbox;
                    mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [(posX + (x * 512)), posY, (posZ + (y * 512))]);
                    renderers.push(renderer);
                }
            }
        }

        return new PlatinumMapRenderer(device, renderers);
    }
    
}

const id = 'pkmnsslvr';
const name = 'Pokemon Soul Silver';
const sceneDescs = [
    new PokemonSoulSilverSceneDesc("0", "Johto & Kanto Region", false),
    new PokemonSoulSilverSceneDesc("69", "Pokemon Center"),
    new PokemonSoulSilverSceneDesc("359", "Pokemon Center Basement"),
    new PokemonSoulSilverSceneDesc("68", "Pokemart"),
    new PokemonSoulSilverSceneDesc("2", "Union Room"),
    new PokemonSoulSilverSceneDesc("5", "Battle Room", false),
    new PokemonSoulSilverSceneDesc("62", "New Bark House 1"),
    new PokemonSoulSilverSceneDesc("6", "Burned Tower Exterior", false),
    new PokemonSoulSilverSceneDesc("7", "Burned Tower Floor 1", false),
    new PokemonSoulSilverSceneDesc("411", "Battle Frontier Entrance", false),
    new PokemonSoulSilverSceneDesc("272", "Battle Frontier Hub", false),
    new PokemonSoulSilverSceneDesc("273", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("274", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("275", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("276", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("277", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("278", "Battle Frontier Room ?"),
    new PokemonSoulSilverSceneDesc("279", "Safari Zone??", false),
    new PokemonSoulSilverSceneDesc("280", "Pokeathlon Dome", false),
    new PokemonSoulSilverSceneDesc("281", "Pokeathlon Dome Interior"),
    new PokemonSoulSilverSceneDesc("282", "Pokeathlon Track"),
    new PokemonSoulSilverSceneDesc("283", "Pokeathlon ???"),
    new PokemonSoulSilverSceneDesc("284", "Pokeathlon ???"),
    new PokemonSoulSilverSceneDesc("285", "Pokeathlon ???"),
    new PokemonSoulSilverSceneDesc("286", "Pokeathlon ???"),
    new PokemonSoulSilverSceneDesc("287", "Pokeathlon ???"),
    new PokemonSoulSilverSceneDesc("288", "Dojo?"),
    new PokemonSoulSilverSceneDesc("299", "???"),
    new PokemonSoulSilverSceneDesc("301", "Elite Four Room ?"),
    new PokemonSoulSilverSceneDesc("302", "Elite Four Room ?"),
    new PokemonSoulSilverSceneDesc("303", "Elite Four Room ?"),
    new PokemonSoulSilverSceneDesc("304", "Elite Four Room ?"),
    new PokemonSoulSilverSceneDesc("305", "Champions Room"),
    new PokemonSoulSilverSceneDesc("318", "Ruins of Alph"),
    new PokemonSoulSilverSceneDesc("307", "Boat F1"),
    new PokemonSoulSilverSceneDesc("328", "Boat Rooms Set 1"),
    new PokemonSoulSilverSceneDesc("309", "Boat Rooms Set 2"),
    new PokemonSoulSilverSceneDesc("310", "Boat Rooms Set 3"),
    new PokemonSoulSilverSceneDesc("311", "Boat Rooms Set 4"),
    new PokemonSoulSilverSceneDesc("329", "Boat B1"),
    new PokemonSoulSilverSceneDesc("330", "Boat Exterior", false),
    new PokemonSoulSilverSceneDesc("331", "Day Care Interior"),
    new PokemonSoulSilverSceneDesc("332", "Bellsprout Tower F1", false),
    new PokemonSoulSilverSceneDesc("333", "Bellsprout Tower F2", false),
    new PokemonSoulSilverSceneDesc("334", "Bellsprout Tower F3", false),
    new PokemonSoulSilverSceneDesc("335", "Bellsprout Tower F4", false),
    new PokemonSoulSilverSceneDesc("336", "Bellsprout Tower F5", false),
    new PokemonSoulSilverSceneDesc("337", "Bellsprout Tower F6", false),
    new PokemonSoulSilverSceneDesc("338", "Bellsprout Tower F7", false),
    new PokemonSoulSilverSceneDesc("339", "Bellsprout Tower F8", false),
    new PokemonSoulSilverSceneDesc("341", "Bellsprout Tower F9", false),
    new PokemonSoulSilverSceneDesc("340", "Bellsprout Tower Roof", false),
    new PokemonSoulSilverSceneDesc("342", "???", false),
    new PokemonSoulSilverSceneDesc("343", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("344", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("345", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("346", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("347", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("348", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("349", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("350", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("351", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("352", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("353", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("354", "Safari Zone Area", false),
    new PokemonSoulSilverSceneDesc("360", "???"),
    new PokemonSoulSilverSceneDesc("361", "???"),
    new PokemonSoulSilverSceneDesc("362", "Pokemon Club"),
    new PokemonSoulSilverSceneDesc("364", "???"),
    new PokemonSoulSilverSceneDesc("365", "Vermillion City Gym"),
    new PokemonSoulSilverSceneDesc("366", "???"),
    new PokemonSoulSilverSceneDesc("367", "???"),
    new PokemonSoulSilverSceneDesc("368", "???"),
    new PokemonSoulSilverSceneDesc("369", "???"),
    new PokemonSoulSilverSceneDesc("370", "Celadon Department Store F1"),
    new PokemonSoulSilverSceneDesc("371", "Celadon Department Store F2"),
    new PokemonSoulSilverSceneDesc("372", "Celadon Department Store F3"),
    new PokemonSoulSilverSceneDesc("373", "Celadon Department Store F4"),
    new PokemonSoulSilverSceneDesc("374", "Celadon Department Store F5"),
    new PokemonSoulSilverSceneDesc("375", "Celadon Department Store F6"),
    new PokemonSoulSilverSceneDesc("379", "Celadon Department Store Roof", false),
    new PokemonSoulSilverSceneDesc("376", "???"),
    new PokemonSoulSilverSceneDesc("377", "???"),
    new PokemonSoulSilverSceneDesc("378", "???"),
    new PokemonSoulSilverSceneDesc("380", "???"),
    new PokemonSoulSilverSceneDesc("381", "???"),
    new PokemonSoulSilverSceneDesc("382", "???"),
    new PokemonSoulSilverSceneDesc("383", "???", false),
    new PokemonSoulSilverSceneDesc("384", "???"),
    new PokemonSoulSilverSceneDesc("385", "???"),
    new PokemonSoulSilverSceneDesc("386", "???"),
    new PokemonSoulSilverSceneDesc("387", "???", false),
    new PokemonSoulSilverSceneDesc("395", "???"),
    new PokemonSoulSilverSceneDesc("396", "???"),
    new PokemonSoulSilverSceneDesc("397", "???"),
    new PokemonSoulSilverSceneDesc("398", "???"),
    new PokemonSoulSilverSceneDesc("399", "???"),
    new PokemonSoulSilverSceneDesc("400", "Saffron Train Station"),
    new PokemonSoulSilverSceneDesc("401", "Saffron Train Platform"),
    new PokemonSoulSilverSceneDesc("402", "???"),
    new PokemonSoulSilverSceneDesc("403", "Bills Lab"),
    new PokemonSoulSilverSceneDesc("406", "???"),
    new PokemonSoulSilverSceneDesc("412", "???"),
    new PokemonSoulSilverSceneDesc("413", "???"),
    new PokemonSoulSilverSceneDesc("414", "???"),
    new PokemonSoulSilverSceneDesc("415", "???"),
    new PokemonSoulSilverSceneDesc("416", "???"),
    new PokemonSoulSilverSceneDesc("545", "???", false),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
