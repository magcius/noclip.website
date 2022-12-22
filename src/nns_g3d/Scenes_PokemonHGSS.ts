
// Pokemon HeartGold SoulSilver

import * as Viewer from '../viewer';
import * as NARC from './narc';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer } from './render';
import { assert, assertExists } from '../util';
import { mat4 } from 'gl-matrix';
import { SceneContext } from '../SceneBase';
import { parseNSBMD, BTX0, parseNSBTX, fx32 } from './NNS_G3D';
import { AABB } from '../Geometry';
import { PlatinumMapRenderer, tryMDL0 } from './Scenes_PokemonPlatinum';

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

class PokemonHGSSSceneDesc implements Viewer.SceneDesc {
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

        const renderer = new PlatinumMapRenderer(device);
        const cache = renderer.getCache();

        //Spacecats: TODO - General cleaning and organization. Fix issues with a few map chunks.

        const tilesets = new Map<number, BTX0>();
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
                    mapRenderer = tryMDL0(device, cache, embeddedModelBMD.models[0], assertExists(tilesets.get(tilesetIndex)!.tex0));
                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, cache, embeddedModelBMD.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                if (mapRenderer === null)
                    continue;

                mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);

                const bbox = new AABB(-256, -256, -256, 256, 256, 256);
                bbox.transform(bbox, mapRenderer.modelMatrix);
                mapRenderer.bbox = bbox;
                renderer.objectRenderers.push(mapRenderer);

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
                    let obj: MDL0Renderer | null = null;
                    if(obj === null)
                        obj = tryMDL0(device, cache, objBmd.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                    if (obj === null)
                        obj = tryMDL0(device, cache, objBmd.models[0], assertExists(objBmd.tex0));
                    if (obj === null)
                        continue;

                    obj.bbox = bbox;
                    mat4.translate(obj.modelMatrix, obj.modelMatrix, [(posX + (x * 512)), posY, (posZ + (y * 512))]);
                    renderer.objectRenderers.push(obj);
                }
            }
        }

        return renderer;
    }
}

const id = 'pkmnsslvr';
const name = 'Pokémon HeartGold & SoulSilver';
const sceneDescs = [
    new PokemonHGSSSceneDesc("0", "Johto & Kanto Region", false),
    new PokemonHGSSSceneDesc("69", "Pokemon Center"),
    new PokemonHGSSSceneDesc("359", "Pokemon Center Basement"),
    new PokemonHGSSSceneDesc("369", "Pokemon Center Basement (Dupe?)"),
    new PokemonHGSSSceneDesc("367", "Pokemon Center Basement (Dupe?)"),
    new PokemonHGSSSceneDesc("368", "Pokemon Center Basement (Dupe?)"),
    new PokemonHGSSSceneDesc("68", "Poke Mart"),
    new PokemonHGSSSceneDesc("360", "Poke Mart (Dupe?)"),
    new PokemonHGSSSceneDesc("2", "Union Room"),
    new PokemonHGSSSceneDesc("5", "Battle Room", false),
    new PokemonHGSSSceneDesc("62", "New Bark House 1"),
    new PokemonHGSSSceneDesc("6", "Bellchime Trail", false),
    new PokemonHGSSSceneDesc("7", "Burned Tower Floor 1", false),
    new PokemonHGSSSceneDesc("411", "Frontier Access", false),
    new PokemonHGSSSceneDesc("272", "Battle Frontier Hub", false),
    new PokemonHGSSSceneDesc("273", "Battle Frontier Entrance Hall"),
    new PokemonHGSSSceneDesc("274", "Battle Frontier Battle Tower"),
    new PokemonHGSSSceneDesc("275", "Battle Frontier Battle Factory"),
    new PokemonHGSSSceneDesc("276", "Battle Frontier Battle Hall"),
    new PokemonHGSSSceneDesc("277", "Battle Frontier Battle Castle"),
    new PokemonHGSSSceneDesc("278", "Battle Frontier Battle Arcade"), // Room is supposed to be dark
    new PokemonHGSSSceneDesc("279", "Cliff Edge Gate", false),
    new PokemonHGSSSceneDesc("280", "Pokeathlon Dome", false),
    new PokemonHGSSSceneDesc("281", "Pokeathlon Dome Interior"),
    new PokemonHGSSSceneDesc("282", "Pokeathlon Track"),
    new PokemonHGSSSceneDesc("283", "Pokeathlon 2F Entrance"),
    new PokemonHGSSSceneDesc("284", "Pokeathlon B1F Solidarity Room"),
    new PokemonHGSSSceneDesc("285", "Pokeathlon B1F Trust Room"),
    new PokemonHGSSSceneDesc("286", "Pokeathlon B1F Potential Room"),
    new PokemonHGSSSceneDesc("287", "Pokeathlon B1F Friendship Room"),
    new PokemonHGSSSceneDesc("288", "Dragon's Den Dragon Shrine"),
    new PokemonHGSSSceneDesc("299", "Pokemon League Reception Gate"),
    new PokemonHGSSSceneDesc("301", "Elite Four Psychic Room"),
    new PokemonHGSSSceneDesc("302", "Elite Four Poison Room"),
    new PokemonHGSSSceneDesc("303", "Elite Four Fighting Room"),
    new PokemonHGSSSceneDesc("304", "Elite Four Dark Room"),
    new PokemonHGSSSceneDesc("305", "Champion's Room"),
    new PokemonHGSSSceneDesc("318", "Ruins of Alph"),
    new PokemonHGSSSceneDesc("307", "Boat 1F"),
    new PokemonHGSSSceneDesc("328", "Boat Rooms Set 1"),
    new PokemonHGSSSceneDesc("309", "Boat Rooms Set 2"),
    new PokemonHGSSSceneDesc("310", "Boat Rooms Set 3"),
    new PokemonHGSSSceneDesc("311", "Boat Rooms Set 4"),
    new PokemonHGSSSceneDesc("329", "Boat B1F"),
    new PokemonHGSSSceneDesc("330", "Boat Exterior", false),
    new PokemonHGSSSceneDesc("331", "Day Care Interior"),
    new PokemonHGSSSceneDesc("332", "Bell Tower 1F", false),
    new PokemonHGSSSceneDesc("333", "Bell Tower 2F", false),
    new PokemonHGSSSceneDesc("334", "Bell Tower 3F", false),
    new PokemonHGSSSceneDesc("335", "Bell Tower 4F", false),
    new PokemonHGSSSceneDesc("336", "Bell Tower 5F", false),
    new PokemonHGSSSceneDesc("337", "Bell Tower 6F", false),
    new PokemonHGSSSceneDesc("338", "Bell Tower 7F", false),
    new PokemonHGSSSceneDesc("339", "Bell Tower 8F", false),
    new PokemonHGSSSceneDesc("341", "Bell Tower 9F", false),
    new PokemonHGSSSceneDesc("340", "Bell Tower Roof", false),
    new PokemonHGSSSceneDesc("342", "Cliff Cave", false),
    new PokemonHGSSSceneDesc("343", "Safari Zone Plains Area", false),
    new PokemonHGSSSceneDesc("344", "Safari Zone Meadow Area", false),
    new PokemonHGSSSceneDesc("345", "Safari Zone Savannah Area", false),
    new PokemonHGSSSceneDesc("346", "Safari Zone Peak Area", false),
    new PokemonHGSSSceneDesc("347", "Safari Zone Rocky Beach Area", false),
    new PokemonHGSSSceneDesc("348", "Safari Zone Wetland Area", false),
    new PokemonHGSSSceneDesc("349", "Safari Zone Forest Area", false),
    new PokemonHGSSSceneDesc("350", "Safari Zone Swamp Area", false),
    new PokemonHGSSSceneDesc("351", "Safari Zone Marshland Area", false),
    new PokemonHGSSSceneDesc("352", "Safari Zone Wasteland Area", false),
    new PokemonHGSSSceneDesc("353", "Safari Zone Mountain Area", false),
    new PokemonHGSSSceneDesc("354", "Safari Zone Desert Area", false),
    new PokemonHGSSSceneDesc("361", "???"),
    new PokemonHGSSSceneDesc("362", "Pokemon Fan Club"),
    new PokemonHGSSSceneDesc("364", "???"),
    new PokemonHGSSSceneDesc("365", "Vermilion City Gym"),
    new PokemonHGSSSceneDesc("366", "Vertical Checkpoint"),
    new PokemonHGSSSceneDesc("370", "Celadon Department Store 1F"),
    new PokemonHGSSSceneDesc("371", "Celadon Department Store 2F"),
    new PokemonHGSSSceneDesc("372", "Celadon Department Store 3F"),
    new PokemonHGSSSceneDesc("373", "Celadon Department Store 4F"),
    new PokemonHGSSSceneDesc("374", "Celadon Department Store 5F"),
    new PokemonHGSSSceneDesc("375", "Celadon Department Store 6F"),
    new PokemonHGSSSceneDesc("376", "Celadon Condominiums 1F"),
    new PokemonHGSSSceneDesc("377", "Celadon Condominiums 2F"),
    new PokemonHGSSSceneDesc("378", "Celadon Condominiums 3F"),
    new PokemonHGSSSceneDesc("379", "Celadon Condominiums Roof", false),
    new PokemonHGSSSceneDesc("380", "Celadon Condominiums Roof Room"),
    new PokemonHGSSSceneDesc("412", "Global Terminal 2F"),
    new PokemonHGSSSceneDesc("413", "Global Terminal 3F"),
    new PokemonHGSSSceneDesc("381", "Goldenrod Game Corner (JP Version)"),
    new PokemonHGSSSceneDesc("382", "Goldenrod Prize Corner"),
    new PokemonHGSSSceneDesc("383", "???", false),
    new PokemonHGSSSceneDesc("384", "Player's House 2F"),
    new PokemonHGSSSceneDesc("385", "???"),
    new PokemonHGSSSceneDesc("386", "Vermilion Port Entrance"),
    new PokemonHGSSSceneDesc("387", "S.S. Aqua", false),
    new PokemonHGSSSceneDesc("395", "???"),
    new PokemonHGSSSceneDesc("396", "Mahogany Gym Room 1"),
    new PokemonHGSSSceneDesc("397", "Mahogany Gym Entrance"),
    new PokemonHGSSSceneDesc("398", "Fighting Dojo"),
    new PokemonHGSSSceneDesc("399", "???"),
    new PokemonHGSSSceneDesc("400", "Saffron Train Station"),
    new PokemonHGSSSceneDesc("401", "Saffron Train Platform"),
    new PokemonHGSSSceneDesc("402", "???"),
    new PokemonHGSSSceneDesc("403", "Rotom's Room"),
    new PokemonHGSSSceneDesc("406", "???"),
    new PokemonHGSSSceneDesc("414", "???"),
    new PokemonHGSSSceneDesc("415", "???"),
    new PokemonHGSSSceneDesc("416", "???"),
    new PokemonHGSSSceneDesc("545", "???", false),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "Pokemon HeartGold SoulSilver HGSS" };
