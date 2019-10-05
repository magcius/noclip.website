
import * as Viewer from '../viewer';
import * as rw from 'librw';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { GTA3Renderer, SceneRenderer } from './render';
import { SceneContext } from '../SceneBase';
import { getTextDecoder, assert } from '../util';
import { parseItemPlacement, ItemPlacement, parseItemDefinition, ItemDefinition, ObjectDefinition } from './item';
import { quat, vec3 } from 'gl-matrix';

const pathBase = `GrandTheftAuto3`;

class GTA3SceneDesc implements Viewer.SceneDesc {
    private static initialised = false;

    constructor(public id: string, public name: string) {
    }

    private static async initialise() {
        if (this.initialised)
            return;

        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);
        this.initialised = true;
    }

    private async fetchIDE(name: string, dataFetcher: DataFetcher): Promise<ItemDefinition> {
        const buffer = await dataFetcher.fetchData(`${pathBase}/data/maps/${name}`);
        const text = getTextDecoder('utf8')!.decode(buffer.arrayBuffer);
        return parseItemDefinition(text);
    }

    private async fetchIPL(id: string, dataFetcher: DataFetcher): Promise<ItemPlacement> {
        if (id === 'test') return {
            instances: [{
                id: 0,
                modelName: 'billboard01',
                rotation: quat.fromValues(0,0,0,1),
                translation: vec3.fromValues(0,0,0),
                scale: vec3.fromValues(10,10,10),
            }]
        };
        const buffer = await dataFetcher.fetchData(`${pathBase}/data/maps/${id}.ipl`);
        const text = getTextDecoder('utf8')!.decode(buffer.arrayBuffer);
        return parseItemPlacement(text);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        await GTA3SceneDesc.initialise();
        const dataFetcher = context.dataFetcher;
        const objects = new Map<String, ObjectDefinition>();

        const gta3IDE = await this.fetchIDE('gta3.IDE', dataFetcher);
        for (const obj of gta3IDE.objects) objects.set(obj.modelName, obj);
        if (this.id.match(/\//)) {
            const ide = await this.fetchIDE(this.id.toLowerCase() + '.ide', dataFetcher);
            for (const obj of ide.objects) objects.set(obj.modelName, obj);
        }

        const renderer = new GTA3Renderer(device);
        const sceneRenderer = new SceneRenderer();
        const ipl = await this.fetchIPL(this.id, dataFetcher);
        const loaded = new Map<String, Promise<void>>();
        for (const item of ipl.instances) {
            const name = item.modelName;
            if (name.startsWith('lod')) continue; // ignore LOD objects

            const obj = objects.get(name);
            if (!obj) {
                console.warn('No definition for object', name);
                continue;
            }
            const txdName = obj.txdName;
            if (!txdName) {
                console.warn('Cannot find textures for model', name);
                continue;
            }

            if (!loaded.has(name + '.dff')) {
                let txdLoaded = loaded.get(txdName + '.txd');
                if (!txdLoaded) {
                    const txdPath = (txdName === 'generic') ? `${pathBase}/models/generic.txd` : `${pathBase}/models/gta3/${txdName}.txd`;
                    txdLoaded = dataFetcher.fetchData(txdPath).then(buffer => {
                        const stream = new rw.StreamMemory(buffer.arrayBuffer);
                        const header = new rw.ChunkHeaderInfo(stream);
                        assert(header.type === rw.PluginID.ID_TEXDICTIONARY);
                        const txd = new rw.TexDictionary(stream);
                        header.delete();
                        stream.delete();
                        renderer.textureHolder.addTXD(device, txd);
                        txd.delete();
                    });
                    loaded.set(txdName + '.txd', txdLoaded);
                }
                const dffPath = `${pathBase}/models/gta3/${name}.dff`;
                loaded.set(name + '.dff', dataFetcher.fetchData(dffPath).then(async buffer => {
                    await txdLoaded;
                    const stream = new rw.StreamMemory(buffer.arrayBuffer);
                    const header = new rw.ChunkHeaderInfo(stream);
                    assert(header.type === rw.PluginID.ID_CLUMP);
                    const clump = rw.Clump.streamRead(stream);
                    header.delete();
                    stream.delete();
                    sceneRenderer.addModel(device, renderer.textureHolder, name, clump, obj);
                    clump.delete();
                }));
            }
        }

        for (const item of ipl.instances) {
            const dffLoaded = loaded.get(item.modelName + '.dff');
            if (dffLoaded) dffLoaded.then(() => sceneRenderer.addItem(item));
        }
        renderer.sceneRenderers.push(sceneRenderer);
        return renderer;
    }
}

const id = `GrandTheftAuto3`;
const name = "Grand Theft Auto III";
const sceneDescs = [
    //new GTA3SceneDesc("test", "Test"),
    new GTA3SceneDesc("overview", "Overview"),
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
