
import * as rw from 'librw';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { DataFetcher } from '../DataFetcher';
import { initializeBasis } from '../vendor/basis_universal';

import { ModelCache, BFBBRenderer, TextureCache, TextureData, EntRenderer, ModelData, Fog, JSP, JSPRenderer, PlayerRenderer, NPC, textureNameRW3 } from './render';
import { Ent, Button, Platform, Player, SimpleObj } from './render';
import { parseHIP, Asset } from './hip';
import * as Assets from './assets';
import { DataStream, parseRWChunks, createRWStreamFromChunk, DataCacheIDName } from './util';
import { assert } from '../util';
import { colorNew } from '../Color';

const dataPath = 'bfbb/xbox';

enum AssetType {
    ALST = 0x414C5354, // Anim List
    ANIM = 0x414E494D, // Anim
    ATBL = 0x4154424C, // Anim Table
    BOUL = 0x424F554C, // Boulder
    BUTN = 0x4255544E, // Button
    CAM  = 0x43414D20, // Camera
    CNTR = 0x434E5452, // Counter
    COLL = 0x434F4C4C, // Collision Table
    COND = 0x434F4E44, // Conditional
    CRDT = 0x43524454, // Credits
    CSN  = 0x43534E20, // Cutscene
    CSNM = 0x43534E4D, // Cutscene Mgr
    CTOC = 0x43544F43, // Cutscene TOC
    DPAT = 0x44504154, // Dispatcher
    DSCO = 0x4453434F, // Disco Floor
    DSTR = 0x44535452, // Destructible Object
    DYNA = 0x44594E41, // Dynamic
    EGEN = 0x4547454E, // Electric Arc Generator
    ENV  = 0x454E5620, // Environment
    FLY  = 0x464C5920, // Flythrough
    FOG  = 0x464F4720, // Fog
    GRUP = 0x47525550, // Group
    JAW  = 0x4A415720, // Jaw Data
    JSP  = 0x4A535020, // JSP
    LKIT = 0x4C4B4954, // Light Kit
    LODT = 0x4C4F4454, // LOD Table
    MAPR = 0x4D415052, // Surface Mapper
    MINF = 0x4D494E46, // Model Info
    MODL = 0x4D4F444C, // Model
    MRKR = 0x4D524B52, // Marker
    MVPT = 0x4D565054, // Move Point
    PARE = 0x50415245, // Particle Emitter
    PARP = 0x50415250, // Particle Emitter Props
    PARS = 0x50415253, // Particle System
    PICK = 0x5049434B, // Pickup Table
    PIPT = 0x50495054, // Pipe Info Table
    PKUP = 0x504B5550, // Pickup
    PLAT = 0x504C4154, // Platform
    PLYR = 0x504C5952, // Player
    PORT = 0x504F5254, // Portal
    RAW  = 0x52415720, // Raw
    RWTX = 0x52575458, // RenderWare Texture
    SFX  = 0x53465820, // SFX
    SHDW = 0x53484457, // Simple Shadow Table
    SHRP = 0x53485250, // Shrapnel
    SIMP = 0x53494D50, // Simple Object
    SND  = 0x534E4420, // Sound
    SNDI = 0x534E4449, // Sound Info
    SNDS = 0x534E4453, // Streaming Sound
    SURF = 0x53555246, // Surface
    TEXT = 0x54455854, // Text
    TIMR = 0x54494D52, // Timer
    TRIG = 0x54524947, // Trigger
    UI   = 0x55492020, // UI
    UIFT = 0x55494654, // UI Font
    VIL  = 0x56494C20, // Villain
    VILP = 0x56494C50  // Villain Props
}

class AssetCache extends DataCacheIDName<Asset> {
    public addAsset(asset: Asset, lock: boolean = false) {
        this.add(asset, asset.name, asset.id, lock);
    }
}

class ButtonCache extends DataCacheIDName<Button> {}
class NPCCache extends DataCacheIDName<NPC> {}
class PlatformCache extends DataCacheIDName<Platform> {}
class PlayerCache extends DataCacheIDName<Player> {}
class SimpleObjCache extends DataCacheIDName<SimpleObj> {}
class LightKitCache extends DataCacheIDName<Assets.LightKit> {}
class ModelInfoCache extends DataCacheIDName<Assets.ModelAssetInfo> {}

class DataHolder {
    public assetCache = new AssetCache();
    public modelCache = new ModelCache();
    public textureCache = new TextureCache();

    public buttonCache = new ButtonCache();
    public npcCache = new NPCCache();
    public platformCache = new PlatformCache();
    public playerCache = new PlayerCache();
    public simpleObjCache = new SimpleObjCache();
    public lightKitCache = new LightKitCache();
    public modelInfoCache = new ModelInfoCache();

    public jsps: JSP[] = [];
    public env?: Assets.EnvAsset;
    public fog?: Assets.FogAsset;
}

const dataHolder = new DataHolder();

function getTexturesForClump(clump: rw.Clump): TextureData[] {
    let textures: TextureData[] = [];
    for (let lnk = clump.atomics.begin; !lnk.is(clump.atomics.end); lnk = lnk.next) {
        const atomic = rw.Atomic.fromClump(lnk);
        for (let i = 0; i < atomic.geometry.meshHeader.numMeshes; i++) {
            const texture = atomic.geometry.meshHeader.mesh(i).material.texture;
            if (texture) {
                const textureData = dataHolder.textureCache.getByName(textureNameRW3(texture.name));
                if (textureData)
                    textures.push(textureData);
            }
        }
    }
    
    return textures;
}

async function loadHIP(dataFetcher: DataFetcher, path: string, beta: boolean, global: boolean = false) {
    const data = await dataFetcher.fetchData(`${dataPath}/${path}`);
    const hip = parseHIP(data);

    function loadAssets(callbacks: {[type: number]: (asset: Asset) => void}) {
        for (const layer of hip.layers) {
            for (const asset of layer.assets) {
                if (asset.data.byteLength === 0)
                    continue;
                
                dataHolder.assetCache.addAsset(asset, global);
                
                if (callbacks[asset.type])
                    callbacks[asset.type](asset);
            }
        }
    }

    function loadClump(asset: Asset) {
        const chunks = parseRWChunks(asset.data);
        const clumpChunk = chunks[0];

        assert(clumpChunk.header.type === rw.PluginID.ID_CLUMP);

        const stream = createRWStreamFromChunk(clumpChunk);
        const clump = rw.Clump.streamRead(stream);

        const textures = getTexturesForClump(clump);
        dataHolder.modelCache.addClump(clumpChunk, clump, asset.name, asset.id, textures, global);
    }

    function loadTexture(asset: Asset) {
        const stream = new rw.StreamMemory(asset.data.createTypedArray(Uint8Array));
        const chunk = new rw.ChunkHeaderInfo(stream);

        assert(chunk.type === rw.PluginID.ID_TEXDICTIONARY);

        const texdic = new rw.TexDictionary(stream);
        dataHolder.textureCache.addTexDictionary(texdic, asset.name, asset.id, global);

        stream.delete();
        chunk.delete();
        texdic.delete();
    }

    function loadEnt(asset: Assets.EntAsset): Ent {
        const models: ModelData[] = [];

        function recurseModelInfo(id: number) {
            let model = dataHolder.modelCache.getByID(id);

            if (model) {
                models.push(model);
            } else {
                const modelInfo = dataHolder.modelInfoCache.getByID(id);

                if (modelInfo) {
                    for (let i = 0; i < modelInfo.NumModelInst; i++) {
                        recurseModelInfo(modelInfo.modelInst[i].ModelID);
                    }
                }
            }
        }

        recurseModelInfo(asset.modelInfoID);
        return { asset, models };
    }

    loadAssets({
        [AssetType.BUTN]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readButtonAsset(stream, beta);
            const ent = loadEnt(asset.ent);

            dataHolder.buttonCache.add({ ent, asset }, a.name, a.id, global);
        },
        [AssetType.ENV]: (a) => {
            const stream = new DataStream(a.data, true);
            dataHolder.env = Assets.readEnvAsset(stream);
        },
        [AssetType.FOG]: (a) => {
            if (dataHolder.fog) return;
            const stream = new DataStream(a.data, true);
            dataHolder.fog = Assets.readFogAsset(stream);
        },
        [AssetType.LKIT]: (a) => {
            const stream = new DataStream(a.data, true);
            dataHolder.lightKitCache.add(Assets.readLightKit(stream), a.name, a.id, global);
        },
        [AssetType.MINF]: (a) => {
            const stream = new DataStream(a.data, true);
            dataHolder.modelInfoCache.add(Assets.readModelInfo(stream), a.name, a.id, global);
        },
        [AssetType.MODL]: (a) => {
            loadClump(a);
        },
        [AssetType.JSP]: (a) => {
            const id = a.id;
            const firstChunkType = a.data.createDataView(0, 4).getUint32(0, true);

            if (firstChunkType === 0xBEEF01) {
                // JSP Info (todo)
            } else {
                loadClump(a);
                const model = dataHolder.modelCache.getByID(a.id);
                if (model)
                    dataHolder.jsps.push({ id, model });
            }
        },
        [AssetType.PIPT]: (a) => {
            const stream = new DataStream(a.data, true);
            const pipeInfoTable = Assets.readPipeInfoTable(stream);

            for (const entry of pipeInfoTable) {
                const model = dataHolder.modelCache.getByID(entry.ModelHashID);
                if (model)
                    model.pipeInfo = entry;
            }
        },
        [AssetType.PLAT]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readPlatformAsset(stream, beta);
            const ent = loadEnt(asset.ent);

            dataHolder.platformCache.add({ ent, asset }, a.name, a.id, global);
        },
        [AssetType.PLYR]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readPlayerAsset(stream, beta);
            const ent = loadEnt(asset.ent);
            
            dataHolder.playerCache.add({ ent, asset }, a.name, a.id, global);
        },
        [AssetType.RWTX]: (a) => {
            loadTexture(a);
        },
        [AssetType.SIMP]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readSimpleObjAsset(stream, beta);
            const ent = loadEnt(asset.ent);

            dataHolder.simpleObjCache.add({ ent, asset }, a.name, a.id, global);
        },
        [AssetType.VIL]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readNPCAsset(stream, beta);
            const ent = loadEnt(asset.ent);

            dataHolder.npcCache.add({ ent, asset }, a.name, a.id, global);
        }
    });
}

class BFBBSceneDesc implements Viewer.SceneDesc {
    private static initialised = false;

    constructor(public id: string, public name: string, public beta: boolean = false) {
        this.id = this.id.toLowerCase();
    }

    private static async initialize(dataFetcher: DataFetcher) {
        if (this.initialised)
            return;

        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);
        await initializeBasis();

        await loadHIP(dataFetcher, 'boot.HIP', false, true);

        this.initialised = true;
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        await BFBBSceneDesc.initialize(context.dataFetcher);

        const hipPath = `${this.id.substr(0, 2)}/${this.id}`;

        await loadHIP(context.dataFetcher, `${hipPath}.HOP`, this.beta);
        await loadHIP(context.dataFetcher, `${hipPath}.HIP`, this.beta);

        const renderer = new BFBBRenderer(gfxDevice);
        const cache = renderer.renderHelper.getCache();

        while (dataHolder.jsps.length) {
            const jsp = dataHolder.jsps.pop()!;
            renderer.renderers.push(new JSPRenderer(gfxDevice, cache, jsp));
        }

        for (const butn of dataHolder.buttonCache.data())
            renderer.renderers.push(new EntRenderer(undefined, gfxDevice, cache, butn.ent));
        
        for (const npc of dataHolder.npcCache.data())
            renderer.renderers.push(new EntRenderer(undefined, gfxDevice, cache, npc.ent));

        for (const plat of dataHolder.platformCache.data())
            renderer.renderers.push(new EntRenderer(undefined, gfxDevice, cache, plat.ent));

        for (const simp of dataHolder.simpleObjCache.data())
            renderer.renderers.push(new EntRenderer(undefined, gfxDevice, cache, simp.ent));

        for (const plyrID of dataHolder.playerCache.ids()) {
            if (!dataHolder.playerCache.isIDLocked(plyrID)) {
                const plyr = dataHolder.playerCache.getByID(plyrID)!;
                renderer.renderers.push(new PlayerRenderer(gfxDevice, cache, plyr));
                renderer.playerLightKit = dataHolder.lightKitCache.getByID(plyr.asset.lightKitID);
            }
        }

        if (dataHolder.env) {
            renderer.objectLightKit = dataHolder.lightKitCache.getByID(dataHolder.env.objectLightKit);
            dataHolder.env = undefined;
        }

        if (dataHolder.fog) {
            renderer.fog = dataHolder.fog;
            dataHolder.fog = undefined;
        }

        dataHolder.buttonCache.clear();
        dataHolder.npcCache.clear();
        dataHolder.platformCache.clear();
        dataHolder.playerCache.clear();
        dataHolder.simpleObjCache.clear();
        dataHolder.lightKitCache.clear();
        dataHolder.modelInfoCache.clear();

        dataHolder.assetCache.clear();
        dataHolder.modelCache.clear();
        dataHolder.textureCache.clear();

        return renderer;
    }
}

const sceneDescs = [
    'Main Menu',
    new BFBBSceneDesc('MNU3', 'Main Menu'),
    'Bikini Bottom',
    new BFBBSceneDesc('HB00', 'Prologue Cutscene'),
    new BFBBSceneDesc('HB01', 'Bikini Bottom'),
    new BFBBSceneDesc('HB02', 'SpongeBob\'s Pineapple'),
    new BFBBSceneDesc('HB03', 'Squidward\'s Tiki'),
    new BFBBSceneDesc('HB04', 'Patrick\'s Rock'),
    new BFBBSceneDesc('HB05', 'Sandy\'s Treedome'),
    new BFBBSceneDesc('HB06', 'Shady Shoals'),
    new BFBBSceneDesc('HB07', 'Krusty Krab'),
    new BFBBSceneDesc('HB08', 'Chum Bucket'),
    new BFBBSceneDesc('HB09', 'Police Station'),
    new BFBBSceneDesc('HB10', 'Theater'),
    'Jellyfish Fields',
    new BFBBSceneDesc('JF01', 'Jellyfish Rock'),
    new BFBBSceneDesc('JF02', 'Jellyfish Caves'),
    new BFBBSceneDesc('JF03', 'Jellyfish Lake'),
    new BFBBSceneDesc('JF04', 'Spork Mountain'),
    'Downtown Bikini Bottom',
    new BFBBSceneDesc('BB01', 'Downtown Streets'),
    new BFBBSceneDesc('BB02', 'Downtown Rooftops'),
    new BFBBSceneDesc('BB03', 'Lighthouse'),
    new BFBBSceneDesc('BB04', 'Sea Needle'),
    'Goo Lagoon',
    new BFBBSceneDesc('GL01', 'Goo Lagoon Beach'),
    new BFBBSceneDesc('GL02', 'Goo Lagoon Sea Caves'),
    new BFBBSceneDesc('GL03', 'Goo Lagoon Pier'),
    'Poseidome',
    new BFBBSceneDesc('B101', 'Poseidome'),
    'Rock Bottom',
    new BFBBSceneDesc('RB01', 'Downtown Rock Bottom'),
    new BFBBSceneDesc('RB02', 'Rock Bottom Museum'),
    new BFBBSceneDesc('RB03', 'Trench of Advanced Darkness'),
    'Mermalair',
    new BFBBSceneDesc('BC01', 'Mermalair Lobby'),
    new BFBBSceneDesc('BC02', 'Mermalair Main Chamber'),
    new BFBBSceneDesc('BC03', 'Mermalair Security Tunnel'),
    new BFBBSceneDesc('BC04', 'Rolling Ball Area'),
    new BFBBSceneDesc('BC05', 'Villain Containment Area'),
    'Sand Mountain',
    new BFBBSceneDesc('SM01', 'Ski Lodge'),
    new BFBBSceneDesc('SM02', 'Guppy Mound'),
    new BFBBSceneDesc('SM03', 'Flounder Hill'),
    new BFBBSceneDesc('SM04', 'Sand Mountain'),
    'Industrial Park',
    new BFBBSceneDesc('B201', 'Industrial Park'),
    'Kelp Forest',
    new BFBBSceneDesc('KF01', 'Kelp Forest'),
    new BFBBSceneDesc('KF02', 'Kelp Swamp'),
    new BFBBSceneDesc('KF04', 'Kelp Caves'),
    new BFBBSceneDesc('KF05', 'Kelp Vines'),
    'Flying Dutchman\'s Graveyard',
    new BFBBSceneDesc('GY01', 'Graveyard Lake'),
    new BFBBSceneDesc('GY02', 'Graveyard of Ships'),
    new BFBBSceneDesc('GY03', 'Dutchman\'s Ship'),
    new BFBBSceneDesc('GY04', 'Flying Dutchman Battle'),
    'SpongeBob\'s Dream',
    new BFBBSceneDesc('DB01', 'SpongeBob\'s Dream'),
    new BFBBSceneDesc('DB02', 'Sandy\'s Dream'),
    new BFBBSceneDesc('DB03', 'Squidward\'s Dream'),
    new BFBBSceneDesc('DB04', 'Mr. Krabs\' Dream'),
    new BFBBSceneDesc('DB05', 'Patrick\'s Dream (unused)', true),
    new BFBBSceneDesc('DB06', 'Patrick\'s Dream'),
    'Chum Bucket Lab',
    new BFBBSceneDesc('B301', 'MuscleBob Fight (unused)'),
    new BFBBSceneDesc('B302', 'Kah-Rah-Tae!'),
    new BFBBSceneDesc('B303', 'The Small Shall Rule... Or Not'),
    'SpongeBall Arena',
    new BFBBSceneDesc('PG12', 'SpongeBall Arena')
];

const id = 'bfbb';
const name = "SpongeBob SquarePants: Battle for Bikini Bottom";
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};
