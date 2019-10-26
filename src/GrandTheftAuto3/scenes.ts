
import * as Viewer from '../viewer';
import * as rw from 'librw';
import { GfxDevice, GfxFormat } from '../gfx/platform/GfxPlatform';
import { DataFetcher, DataFetcherFlags } from '../DataFetcher';
import { GTA3Renderer, SceneRenderer, DrawKey, Texture, TextureArray, MeshInstance, ModelCache, SkyRenderer, rwTexture, MeshFragData } from './render';
import { SceneContext, Destroyable } from '../SceneBase';
import { getTextDecoder, assert } from '../util';
import { parseItemPlacement, ItemPlacement, parseItemDefinition, ItemDefinition, ObjectDefinition, ItemInstance, parseZones, parseItemPlacementBinary, createItemInstance } from './item';
import { parseTimeCycle, ColorSet } from './time';
import { parseWaterPro, waterMeshFragData, waterDefinition, parseWater } from './water';
import { vec4 } from 'gl-matrix';
import { AABB } from '../Geometry';
import { GfxRendererLayer } from '../gfx/render/GfxRenderer';
import ArrayBufferSlice from '../ArrayBufferSlice';

function UTF8ToString(array: Uint8Array) {
    let length = 0; while (length < array.length && array[length]) length++;
    return getTextDecoder('utf8')!.decode(array.subarray(0, length));
}

class AssetCache extends Map<string, ArrayBufferSlice> implements Destroyable {
    destroy(device: GfxDevice) {
        console.log('Deleting', this.size, 'assets from cache');
        this.clear();
    }
}

export class GTA3SceneDesc implements Viewer.SceneDesc {
    private static initialised = false;
    private assetCache: AssetCache;

    protected pathBase: string;
    protected complete: boolean;
    protected water = {
        origin: vec4.fromValues(0, 0, 0, 2048),
        texture: 'water_old',
    };
    protected weatherTypes = ['Sunny', 'Cloudy', 'Rainy', 'Foggy'];
    protected weatherPeriods = 24;
    protected paths = {
        zon: 'data/gta3.zon',
        dat: {
            timecyc: 'data/timecyc.dat',
            water: 'data/waterpro.dat',
        },
        ide: [] as string[],
        ipl: [] as string[],
        ipl_stream: [] as string[],
    };
    protected versionIMG = 1;
    protected drawDistanceLimit = 100;

    constructor(public id: string, public name: string) {
        this.pathBase = 'GrandTheftAuto3';
        this.complete = (this.id === 'all');
        if (this.complete) {
            this.paths.ipl = [
                "comntop/comNtop",
                "comnbtm/comNbtm",
                "comse/comSE",
                "comsw/comSW",
                "industne/industNE",
                "industnw/industNW",
                "industse/industSE",
                "industsw/industSW",
                "landne/landne",
                "landsw/landsw",
                "overview",
                "props"
            ];
        } else {
            this.paths.ipl = [this.id];
        }
        this.paths.ide = ['generic', 'temppart/temppart', 'comroad/comroad', 'indroads/indroads', 'making/making', 'subroads/subroads'];
        for (const id of this.paths.ipl)
            if (id.match(/\//)) this.paths.ide.push(id.toLowerCase());
    }

    private static async initialise() {
        if (this.initialised)
            return;

        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);
        this.initialised = true;
    }

    private async fetchIMG(dataFetcher: DataFetcher): Promise<void> {
        if (this.assetCache.has(`${this.pathBase}/models/gta3.img`)) return;
        const v1 = (this.versionIMG === 1);
        const bufferIMG = await this.fetch(dataFetcher, 'models/gta3.img');
        const bufferDIR = v1 ? await this.fetch(dataFetcher, 'models/gta3.dir') : bufferIMG;
        const view = bufferDIR!.createDataView();
        const start = v1 ? 0 : 8;
        const dirLength = v1 ? view.byteLength : 32 * view.getUint32(4, true);
        for (let i = start; i < start + dirLength; i += 32) {
            const offset = view.getUint32(i + 0, true);
            const size = v1 ? view.getUint32(i + 4, true) : view.getUint16(i + 4, true);
            const name = UTF8ToString(bufferDIR!.subarray(i + 8, 24).createTypedArray(Uint8Array)).toLowerCase();
            const data = bufferIMG!.subarray(2048 * offset, 2048 * size);
            this.assetCache.set(`${this.pathBase}/models/gta3/${name}`, data);
        }
    }

    private async fetch(dataFetcher: DataFetcher, path: string): Promise<ArrayBufferSlice | null> {
        path = `${this.pathBase}/${path}`;
        let buffer = this.assetCache.get(path);
        if (buffer === undefined) {
            buffer = await dataFetcher.fetchData(path, DataFetcherFlags.ALLOW_404);
            if (buffer.byteLength === 0) {
                console.error('Not found', path);
                return null;
            }
            this.assetCache.set(path, buffer);
        }
        return buffer;
    }

    private async fetchIDE(dataFetcher: DataFetcher, id: string): Promise<ItemDefinition> {
        const buffer = await this.fetch(dataFetcher, `data/maps/${id}.ide`);
        const text = getTextDecoder('utf8')!.decode(buffer!.createDataView());
        return parseItemDefinition(text);
    }

    private async fetchIPL(dataFetcher: DataFetcher, id: string, binary = false): Promise<ItemPlacement> {
        if (binary) {
            const buffer = await this.fetch(dataFetcher, `models/gta3/${id}.ipl`);
            return parseItemPlacementBinary(buffer!.createDataView());
        } else {
            const buffer = await this.fetch(dataFetcher, (id === 'props') ? `data/maps/props.IPL` : `data/maps/${id}.ipl`);
            const text = getTextDecoder('utf8')!.decode(buffer!.createDataView());
            return parseItemPlacement(text);
        }
    }

    private async fetchTimeCycle(dataFetcher: DataFetcher): Promise<ColorSet[]> {
        const buffer = await this.fetch(dataFetcher, this.paths.dat.timecyc);
        const text = getTextDecoder('utf8')!.decode(buffer!.createDataView());
        return parseTimeCycle(text, this.paths.dat.timecyc);
    }

    private async fetchZones(dataFetcher: DataFetcher): Promise<Map<string, AABB>> {
        const buffer = await this.fetch(dataFetcher, this.paths.zon);
        const text = getTextDecoder('utf8')!.decode(buffer!.createDataView());
        return parseZones(text);
    }

    private async fetchWater(dataFetcher: DataFetcher): Promise<[ItemPlacement, MeshFragData[]]> {
        const buffer = await this.fetch(dataFetcher, this.paths.dat.water);
        if (this.paths.dat.water.endsWith('water.dat')) {
            const text = getTextDecoder('utf8')!.decode(buffer!.createDataView());
            return [{ instances: [createItemInstance('water')] }, parseWater(text, this.water.texture)];
        } else {
            return [parseWaterPro(buffer!.createDataView(), this.water.origin), [waterMeshFragData(this.water.texture)]];
        }
    }

    private async fetchTXD(device: GfxDevice, dataFetcher: DataFetcher, txdName: string, cb: (texture: Texture) => void): Promise<void> {
        const txdPath = (txdName === 'generic' || txdName === 'particle')
                      ? `models/${txdName}.txd`
                      : `models/gta3/${txdName}.txd`;
        const useDXT = device.queryTextureFormatSupported(GfxFormat.BC1) && !(txdName === 'generic' || txdName === 'particle');
        const buffer = await this.fetch(dataFetcher, txdPath);
        if (buffer === null) return;
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        const header = new rw.ChunkHeaderInfo(stream);
        assert(header.type === rw.PluginID.ID_TEXDICTIONARY);
        const txd = new rw.TexDictionary(stream);
        for (let lnk = txd.textures.begin; !lnk.is(txd.textures.end); lnk = lnk.next) {
            const texture = rwTexture(rw.Texture.fromDict(lnk), txdName, useDXT);
            cb(texture);
        }
        txd.delete();
        header.delete();
        stream.delete();
    }

    private async fetchDFF(dataFetcher: DataFetcher, modelName: string, cb: (clump: rw.Clump) => void): Promise<void> {
        const dffPath = `models/gta3/${modelName}.dff`;
        const buffer = await this.fetch(dataFetcher, dffPath);
        if (buffer === null) return;
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        let header = new rw.ChunkHeaderInfo(stream);
        if (header.type === rw.PluginID.ID_UVANIMDICT) {
            console.log('Found UV animation for', modelName);
            rw.UVAnimDictionary.current = rw.UVAnimDictionary.streamRead(stream);
            header.delete();
            header = new rw.ChunkHeaderInfo(stream);
        }
        assert(header.type === rw.PluginID.ID_CLUMP);
        const clump = rw.Clump.streamRead(stream);
        cb(clump);
        clump.delete();
        header.delete();
        stream.delete();
        rw.UVAnimDictionary.current = null;
    }

    protected filter(item: ItemInstance, obj: ObjectDefinition, zone: string) {
        return true;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        await GTA3SceneDesc.initialise();
        const dataFetcher = context.dataFetcher;
        const objects = new Map<string, ObjectDefinition>();
        const objectIDs = new Map<number, string>();
        const lodnames = new Set<string>();

        this.assetCache = await context.dataShare.ensureObject<AssetCache>(this.pathBase, async () => new AssetCache());
        if (this.complete)
            await this.fetchIMG(dataFetcher);

        const ides = await Promise.all(this.paths.ide.map(id => this.fetchIDE(dataFetcher, id)));
        for (const ide of ides) for (const obj of ide.objects) {
            objects.set(obj.modelName, obj);
            if (obj.id !== undefined) objectIDs.set(obj.id, obj.modelName);
            if (obj.modelName.startsWith('lod')) lodnames.add(obj.modelName.substr(3));
        }
        objects.set('water', waterDefinition);

        const ipls = await Promise.all(
            this.paths.ipl.map(id => this.fetchIPL(dataFetcher, id)).concat(
            this.paths.ipl_stream.map(id => this.fetchIPL(dataFetcher, id, true))));
        const [colorSets, zones] = await Promise.all([this.fetchTimeCycle(dataFetcher), this.fetchZones(dataFetcher)]);
        const [waterIPL, waterMesh] = await this.fetchWater(dataFetcher);
        ipls.push(waterIPL);

        const renderer = new GTA3Renderer(device, colorSets, this.weatherTypes, this.weatherPeriods, this.water.origin);
        const loadedDFF = new Map<string, Promise<void>>();
        const modelCache = new ModelCache();
        const texturesUsed = new Map<string, Set<string>>();
        const textureSets = new Map<string, Set<Texture>>();
        const drawKeys = new Map<string, DrawKey>();
        const layers = new Map<DrawKey, MeshInstance[]>();

        loadedDFF.set('water', (async () => { })());
        modelCache.meshData.set('water', waterMesh);

        for (const ipl of ipls) for (const item of ipl.instances) {
            if (item.modelName === undefined && item.id !== undefined) {
                item.modelName = objectIDs.get(item.id);
            }
            if (item.modelName === undefined) {
                console.error('Missing model name for ID', item.id);
                continue;
            }
            const name = item.modelName;
            const haslod = lodnames.has(name.substr(3)) || (item.lod !== undefined && item.lod >= 0);
            const obj = objects.get(name);
            if (!obj) {
                console.warn('No definition for object', name);
                continue;
            }
            if ((name.startsWith('lod') && name !== 'lodistancoast01') || name.startsWith('islandlod')) continue; // ignore LOD objects

            let zone = 'cityzon';
            for (const [name, bb] of zones) {
                if (bb.containsPoint(item.translation)) {
                    zone = name;
                    break;
                }
            }
            if (!this.filter(item, obj, zone)) continue;

            if (!loadedDFF.has(obj.modelName))
                loadedDFF.set(obj.modelName, this.fetchDFF(dataFetcher, obj.modelName, clump => modelCache.addModel(clump, obj)));
            await loadedDFF.get(obj.modelName)!;

            const model = modelCache.meshData.get(name);
            if (model === undefined) {
                console.warn('Missing model', name);
                continue;
            }

            let transparent = false;
            for (const frag of model) {
                if (frag.texName === undefined) continue;
                const txdName = frag.texName.split('/')[0];
                if (!texturesUsed.has(txdName)) texturesUsed.set(txdName, new Set());
                texturesUsed.get(txdName)!.add(frag.texName);
                for (let i = 0; i < frag.vertices; i++) {
                    if (frag.color(i).a < 1) {
                        transparent = true;
                        break;
                    }
                }
            }

            let drawKey = new DrawKey(obj, zone);
            if (drawKey.drawDistance !== undefined && (haslod || drawKey.drawDistance > this.drawDistanceLimit))
                delete drawKey.drawDistance;
            if (transparent) drawKey.renderLayer = GfxRendererLayer.TRANSLUCENT;
            const drawKeyStr = JSON.stringify(drawKey);
            if (drawKeys.has(drawKeyStr)) {
                drawKey = drawKeys.get(drawKeyStr)!;
            } else {
                drawKeys.set(drawKeyStr, drawKey);
            }
            if (!layers.has(drawKey)) layers.set(drawKey, []);
            const mesh = new MeshInstance(model, item);
            layers.get(drawKey)!.push(mesh);
        }

        const textureArrays = [] as TextureArray[];
        for (const [txdName, texNames] of texturesUsed) {
            await this.fetchTXD(device, dataFetcher, txdName, texture => {
                const texName = texture.name;
                if (!texNames.has(texName)) return;
                texNames.delete(texName);

                const key = [texture.width, texture.height, texture.pixelFormat, texture.transparent, texture.levels.length].join();
                if (!textureSets.has(key)) textureSets.set(key, new Set());
                const textureSet = textureSets.get(key)!;
                textureSet.add(texture);
                if (textureSet.size >= 0x100) {
                    textureArrays.push(new TextureArray(device, Array.from(textureSet)));
                    textureSet.clear();
                }
            });
            if (texNames.size > 0) console.warn('Missing textures', Array.from(texNames).join());
        }
        for (const textureSet of textureSets.values()) {
            textureArrays.push(new TextureArray(device, Array.from(textureSet)));
        }

        const sealevel = this.water.origin[2];
        const cache = renderer.renderHelper.getCache();
        for (const [key, layerMeshes] of layers) {
            if (SceneRenderer.applicable(layerMeshes))
                renderer.sceneRenderers.push(new SceneRenderer(device, cache, key, layerMeshes, sealevel));
            for (const atlas of textureArrays) {
                if (!SceneRenderer.applicable(layerMeshes, atlas)) continue;
                renderer.sceneRenderers.push(new SceneRenderer(device, cache, key, layerMeshes, sealevel, atlas));
                if (key.renderLayer === GfxRendererLayer.TRANSLUCENT && !key.water)
                    renderer.sceneRenderers.push(new SceneRenderer(device, cache, key, layerMeshes, sealevel, atlas, true));
            }
        }

        await this.fetchTXD(device, dataFetcher, 'particle', texture => {
            if (texture.name === `particle/${this.water.texture}`) {
                const atlas = new TextureArray(device, [texture]);
                renderer.sceneRenderers.push(new SkyRenderer(device, cache, atlas));
            }
        });

        return renderer;
    }
}

const id = `GrandTheftAuto3`;
const name = "Grand Theft Auto III";
const sceneDescs = [
    new GTA3SceneDesc("all", "Liberty City"),
    "Portland",
    new GTA3SceneDesc("industne/industNE", "North-east"),
    new GTA3SceneDesc("industnw/industNW", "North-west"),
    new GTA3SceneDesc("industse/industSE", "South-east"),
    new GTA3SceneDesc("industsw/industSW", "South-west"),
    "Staunton Island",
    new GTA3SceneDesc("comntop/comNtop", "North"),
    new GTA3SceneDesc("comnbtm/comNbtm", "Central"),
    new GTA3SceneDesc("comse/comSE", "South-east"),
    new GTA3SceneDesc("comsw/comSW", "South-west"),
    "Shoreside Vale",
    new GTA3SceneDesc("landne/landne", "North-east"),
    new GTA3SceneDesc("landsw/landsw", "South-west"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
