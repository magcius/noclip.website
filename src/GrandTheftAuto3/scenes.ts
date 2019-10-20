
import * as Viewer from '../viewer';
import * as rw from 'librw';
import { GfxDevice, GfxFormat } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { GTA3Renderer, SceneRenderer, DrawKey, Texture, TextureArray, MeshInstance, ModelCache, SkyRenderer } from './render';
import { SceneContext } from '../SceneBase';
import { getTextDecoder, assert } from '../util';
import { parseItemPlacement, ItemPlacement, parseItemDefinition, ItemDefinition, ObjectDefinition, ItemInstance, parseZones } from './item';
import { parseTimeCycle, ColorSet } from './time';
import { parseWaterPro, waterMeshFragData, waterDefinition } from './water';
import { quat, vec3 } from 'gl-matrix';
import { AABB } from '../Geometry';
import { GfxRendererLayer } from '../gfx/render/GfxRenderer';
import ArrayBufferSlice from '../ArrayBufferSlice';

const assetCache = new Map<string, ArrayBufferSlice>();

function UTF8ToString(array: Uint8Array) {
    let length = 0; while (length < array.length && array[length]) length++;
    return getTextDecoder('utf8')!.decode(array.subarray(0, length));
}

export class GTA3SceneDesc implements Viewer.SceneDesc {
    private static initialised = false;

    protected pathBase: string;
    protected complete: boolean;
    protected water = {
        origin: vec3.create(),
        texture: 'water_old',
    };
    protected weatherTypes = ['Sunny', 'Cloudy', 'Rainy', 'Foggy'];
    protected paths = {
        zon: 'data/gta3.zon',
        dat: {
            timecyc: 'data/timecyc.dat',
            waterpro: 'data/waterpro.dat',
        },
        ide: [] as string[],
        ipl: [] as string[],
    };

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
        if (assetCache.has(`${this.pathBase}/models/gta3.dir`)) return;
        const [bufferDIR, bufferIMG] = await Promise.all([
            this.fetch(dataFetcher, 'models/gta3.dir'),
            this.fetch(dataFetcher, 'models/gta3.img'),
        ]);
        const view = bufferDIR.createDataView();
        for (let i = 0; i < view.byteLength; i += 32) {
            const offset = view.getUint32(i + 0, true);
            const size = view.getUint32(i + 4, true);
            const name = UTF8ToString(bufferDIR.subarray(i + 8, 24).createTypedArray(Uint8Array)).toLowerCase();
            const data = bufferIMG.subarray(2048 * offset, 2048 * size);
            assetCache.set(`${this.pathBase}/models/gta3/${name}`, data);
        }
        assetCache.delete(`${this.pathBase}/models/gta3.img`);
    }

    private async fetch(dataFetcher: DataFetcher, path: string): Promise<ArrayBufferSlice> {
        path = `${this.pathBase}/${path}`;
        let buffer = assetCache.get(path);
        if (buffer === undefined) {
            buffer = await dataFetcher.fetchData(path);
            assetCache.set(path, buffer);
        }
        return buffer;
    }

    private async fetchIDE(dataFetcher: DataFetcher, id: string): Promise<ItemDefinition> {
        const buffer = await this.fetch(dataFetcher, `data/maps/${id}.ide`);
        const text = getTextDecoder('utf8')!.decode(buffer.createDataView());
        return parseItemDefinition(text);
    }

    private async fetchIPL(dataFetcher: DataFetcher, id: string): Promise<ItemPlacement> {
        if (id === 'test') return {
            instances: [{
                id: 0,
                modelName: 'billboard01',
                rotation: quat.fromValues(0,0,0,1),
                translation: vec3.fromValues(0,0,0),
                scale: vec3.fromValues(10,10,10),
            }]
        };
        const buffer = await this.fetch(dataFetcher, (id === 'props') ? `data/maps/props.IPL` : `data/maps/${id}.ipl`);
        const text = getTextDecoder('utf8')!.decode(buffer.createDataView());
        return parseItemPlacement(text);
    }

    private async fetchTimeCycle(dataFetcher: DataFetcher): Promise<ColorSet[]> {
        const buffer = await this.fetch(dataFetcher, this.paths.dat.timecyc);
        const text = getTextDecoder('utf8')!.decode(buffer.createDataView());
        return parseTimeCycle(text);
    }

    private async fetchZones(dataFetcher: DataFetcher): Promise<Map<string, AABB>> {
        const buffer = await this.fetch(dataFetcher, this.paths.zon);
        const text = getTextDecoder('utf8')!.decode(buffer.createDataView());
        return parseZones(text);
    }

    private async fetchWater(dataFetcher: DataFetcher): Promise<ItemPlacement> {
        const buffer = await this.fetch(dataFetcher, this.paths.dat.waterpro);
        return parseWaterPro(buffer.createDataView(), this.water.origin);
    }

    private async fetchTXD(device: GfxDevice, dataFetcher: DataFetcher, txdName: string, cb: (texture: Texture) => void): Promise<void> {
        const txdPath = (txdName === 'generic' || txdName === 'particle')
                      ? `models/${txdName}.txd`
                      : `models/gta3/${txdName}.txd`;
        const useDXT = device.queryTextureFormatSupported(GfxFormat.BC1) && !(txdName === 'generic' || txdName === 'particle');
        const buffer = await this.fetch(dataFetcher, txdPath);
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        const header = new rw.ChunkHeaderInfo(stream);
        assert(header.type === rw.PluginID.ID_TEXDICTIONARY);
        const txd = new rw.TexDictionary(stream);
        header.delete();
        stream.delete();
        for (let lnk = txd.textures.begin; !lnk.is(txd.textures.end); lnk = lnk.next) {
            const texture = new Texture(rw.Texture.fromDict(lnk), txdName, useDXT);
            cb(texture);
        }
        txd.delete();
    }

    private async fetchDFF(dataFetcher: DataFetcher, modelName: string, cb: (clump: rw.Clump) => void): Promise<void> {
        const dffPath = `models/gta3/${modelName}.dff`;
        const buffer = await this.fetch(dataFetcher, dffPath);
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        const header = new rw.ChunkHeaderInfo(stream);
        assert(header.type === rw.PluginID.ID_CLUMP);
        const clump = rw.Clump.streamRead(stream);
        header.delete();
        stream.delete();
        cb(clump);
        clump.delete();
    }

    protected filter(item: ItemInstance, obj: ObjectDefinition, zone: string) {
        return true;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        await GTA3SceneDesc.initialise();
        const dataFetcher = context.dataFetcher;
        const objects = new Map<string, ObjectDefinition>();
        const lodnames = new Set<string>();

        if (this.complete)
            await this.fetchIMG(dataFetcher);

        const ides = await Promise.all(this.paths.ide.map(id => this.fetchIDE(dataFetcher, id)));
        for (const ide of ides) for (const obj of ide.objects) {
            objects.set(obj.modelName, obj);
            if (obj.modelName.startsWith('lod')) lodnames.add(obj.modelName.substr(3));
        }
        objects.set('water', waterDefinition);

        const ipls = await Promise.all(this.paths.ipl.map(id => this.fetchIPL(dataFetcher, id)));
        const [colorSets, zones, water] = await Promise.all([this.fetchTimeCycle(dataFetcher), this.fetchZones(dataFetcher), await this.fetchWater(dataFetcher)]);
        ipls.push(water);

        const renderer = new GTA3Renderer(device, colorSets, this.weatherTypes, this.water.origin);
        const loadedTXD = new Map<string, Promise<void>>();
        const loadedDFF = new Map<string, Promise<void>>();
        const textures  = new Map<string, Texture>();
        const modelCache = new ModelCache();
        const textureSets = new Map<string, Set<Texture>>();
        const drawKeys = new Map<string, DrawKey>();
        const layers = new Map<DrawKey, MeshInstance[]>();

        loadedDFF.set('water', (async () => { })());
        modelCache.meshData.set('water', [waterMeshFragData(this.water.texture)]);

        for (const ipl of ipls) for (const item of ipl.instances) {
            const name = item.modelName;
            const haslod = lodnames.has(name.substr(3));
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

            if (!loadedTXD.has(obj.txdName))
                loadedTXD.set(obj.txdName, this.fetchTXD(device, dataFetcher, obj.txdName, texture => textures.set(texture.name, texture)));
            if (!loadedDFF.has(obj.modelName))
                loadedDFF.set(obj.modelName, this.fetchDFF(dataFetcher, obj.modelName, clump => modelCache.addModel(clump, obj)));
            await Promise.all([loadedTXD.get(obj.txdName)!, loadedDFF.get(obj.modelName)!])

            const model = modelCache.meshData.get(item.modelName);
            if (model === undefined) {
                console.warn('Missing model', item.modelName);
                continue;
            }

            for (const frag of model) {
                if (frag.texName === undefined) continue;
                const texture = textures.get(frag.texName);
                if (texture === undefined) {
                    console.warn('Missing texture', frag.texName, 'for', item.modelName);
                    continue;
                }

                let res = '';
                res += texture.width + 'x' + texture.height + '.' + texture.pixelFormat;
                if (!textureSets.has(res)) textureSets.set(res, new Set());
                textureSets.get(res)!.add(texture);
            }

            let drawKey = new DrawKey(obj, zone);
            if (haslod) delete drawKey.drawDistance;
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
        for (const [res, textureSet] of textureSets) {
            const textures = Array.from(textureSet);
            for (let i = 0; i < textures.length; i += 0x100)
                textureArrays.push(new TextureArray(device, textures.slice(i, i + 0x100)));
        }

        const sealevel = this.water.origin[2];
        for (const [key, layerMeshes] of layers) {
            if (SceneRenderer.applicable(layerMeshes))
                renderer.sceneRenderers.push(new SceneRenderer(device, key, layerMeshes, sealevel));
            for (const atlas of textureArrays) {
                if (!SceneRenderer.applicable(layerMeshes, atlas)) continue;
                renderer.sceneRenderers.push(new SceneRenderer(device, key, layerMeshes, sealevel, atlas));
                if (key.renderLayer === GfxRendererLayer.TRANSLUCENT)
                    renderer.sceneRenderers.push(new SceneRenderer(device, key, layerMeshes, sealevel, atlas, true));
            }
        }

        await loadedTXD.get('particle')!;
        const waterTex = textures.get(`particle/${this.water.texture}`)!;
        const waterAtlas = new TextureArray(device, [waterTex]);
        renderer.sceneRenderers.push(new SkyRenderer(device, waterAtlas));

        return renderer;
    }
}

const id = `GrandTheftAuto3`;
const name = "Grand Theft Auto III";
const sceneDescs = [
    //new GTA3SceneDesc("test", "Test"),
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
