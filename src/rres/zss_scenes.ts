
// Skyward Sword

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as LZ77 from '../lz77';
import * as BRRES from './brres';
import * as U8 from './u8';

import { fetch, assert } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState } from '../render';
import { RRESTextureHolder, ModelRenderer } from './render';

function collectTextures(scenes: Viewer.Scene[]): Viewer.Texture[] {
    const textures: Viewer.Texture[] = [];
    for (const scene of scenes)
        if (scene)
            textures.push.apply(textures, scene.textures);
    return textures;
}

class SkywardSwordScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    public textureHolder: RRESTextureHolder;
    public models: ModelRenderer[] = [];
    public animationController: BRRES.AnimationController;

    constructor(gl: WebGL2RenderingContext, public textureRRESes: BRRES.RRES[], public stageArchive: U8.U8Archive) {
        this.textureHolder = new RRESTextureHolder();
        this.animationController = new BRRES.AnimationController();

        this.textures = this.textureHolder.viewerTextures;

        // First, load in the system and common textures.
        for (const textureRRES of textureRRESes)
            this.textureHolder.addTextures(gl, textureRRES.textures);

        // Load stage.
        const stageRRES = BRRES.parse(stageArchive.findFile('g3d/stage.brres').buffer);
        this.textureHolder.addTextures(gl, stageRRES.textures);

        // Load rooms.
        const roomArchivesDir = stageArchive.findDir('rarc');
        if (roomArchivesDir) {
            for (const roomArchiveFile of roomArchivesDir.files) {
                const roomArchive = U8.parse(roomArchiveFile.buffer);
                const roomRRES = BRRES.parse(roomArchive.findFile('g3d/room.brres').buffer);

                this.textureHolder.addTextures(gl, roomRRES.textures);

                for (const mdl0 of roomRRES.models) {
                    this.spawnModel(gl, mdl0, roomRRES, roomArchiveFile.name);
                }
            }
        }

        // Sort models based on type.
        function sortKey(modelRenderer: ModelRenderer) {
            const modelSorts = [
                'model0',   // Main geometry
                'model0_s', // Main geometry decals.
                'model1',   // Indirect water.
                'model2',   // Other transparent objects.
            ];
            const idx = modelSorts.indexOf(modelRenderer.mdl0.name);

            if (idx < 0) {
                console.error(`Unknown model name ${modelRenderer.mdl0.name}`);
                return 9999;
            }

            return idx;
        }

        this.models.sort((a, b) => {
            return sortKey(a) - sortKey(b);
        });

        // Instantiate known-good stage objects. In the engine, this would be done through room.bzs.
        // I haven't finished reverse engineering that file though...
        const oarcDir = stageArchive.findDir('oarc');
        if (oarcDir) {
            for (const oarcFile of oarcDir.files) {
                let whitelisted = false;

                // Sometimes water appears as an object.
                if (oarcFile.name.includes('Water'))
                    whitelisted = true;

                if (oarcFile.name.includes('LavaF200'))
                    whitelisted = true;

                if (oarcFile.name.includes('DowsingZone'))
                    whitelisted = true;

                if (whitelisted) {
                    const oarcArchive = U8.parse(oarcFile.buffer);
                    const oarcBRRES = BRRES.parse(oarcArchive.findFile('g3d/model.brres').buffer);
                    this.textureHolder.addTextures(gl, oarcBRRES.textures);

                    for (const mdl0 of oarcBRRES.models) {
                        this.spawnModel(gl, mdl0, oarcBRRES, oarcFile.name);
                    }
                }
            }
        }

        // Now create models for any water that might spawn.
        for (const mdl0 of stageRRES.models) {
            if (!mdl0.name.includes('Water'))
                continue;

            this.spawnModel(gl, mdl0, stageRRES, 'stage');
        }

        outer:
        for (const modelRenderer of this.models) {
            // Hide IndTex until we get that working.
            for (const material of modelRenderer.mdl0.materials) {
                for (const sampler of material.samplers) {
                    if (sampler.name === 'DummyWater') {
                        modelRenderer.setVisible(false);
                        continue outer;
                    }
                }
            }

            // Hide future variations by default.
            if (modelRenderer.mdl0.name.startsWith('model_obj')) {
                modelRenderer.setVisible(false);
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.models);
        return [layers];
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.models.forEach((model) => model.destroy(gl));
    }

    public render(state: RenderState): void {
        this.animationController.updateTime(state.time);

        this.models.forEach((model) => {
            model.render(state);
        });
    }

    private spawnModel(gl: WebGL2RenderingContext, mdl0: BRRES.MDL0, rres: BRRES.RRES, namePrefix: string): ModelRenderer {
        const modelRenderer = new ModelRenderer(gl, this.textureHolder, mdl0, namePrefix);
        this.models.push(modelRenderer);

        // Bind animations.
        for (const srt0 of rres.texSrtAnimations) {
            modelRenderer.bindSRT0(this.animationController, srt0);
        }

        return modelRenderer;
    }
}

class SkywardSwordSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const basePath = `data/zss`;
        const systemPath = `${basePath}/System.arc`;
        const objPackPath = `${basePath}/ObjectPack.arc.LZ`;
        const stagePath = `${basePath}/${this.id}_stg_l0.arc.LZ`;
        return Progressable.all([fetch(systemPath), fetch(objPackPath), fetch(stagePath)]).then((buffers: ArrayBufferSlice[]) => {
            const [systemBuffer, objPackBuffer, stageBuffer] = buffers;

            const textureRRESes: BRRES.RRES[] = [];

            const systemArchive = U8.parse(systemBuffer);
            const systemRRES = BRRES.parse(systemArchive.findFile('g3d/model.brres').buffer);
            textureRRESes.push(systemRRES);

            const objPackArchive = U8.parse(LZ77.decompress(objPackBuffer));
            const skyCmnArchive = U8.parse(objPackArchive.findFile('oarc/SkyCmn.arc').buffer);
            const skyCmnRRES = BRRES.parse(skyCmnArchive.findFile('g3d/model.brres').buffer);
            textureRRESes.push(skyCmnRRES);

            const stageArchive = U8.parse(LZ77.decompress(stageBuffer));

            return new SkywardSwordScene(gl, textureRRESes, stageArchive);
        });
    }
}

const id = "zss";
const name = "Skyward Sword";
const sceneDescs: Viewer.SceneDesc[] = [
    new SkywardSwordSceneDesc("F000",   "Skyloft"),
    new SkywardSwordSceneDesc("F001r",  "Skyloft - Knight's Academy"),
    new SkywardSwordSceneDesc("F100",   "Faron Woods"),
    new SkywardSwordSceneDesc("F100_1", "Faron Woods - Inside the Great Tree"),
    new SkywardSwordSceneDesc("F101",   "Faron Woods - Deep Woods"),
    new SkywardSwordSceneDesc("F102",   "Faron Woods - Lake Floria"),
    new SkywardSwordSceneDesc("F102_1", "Faron Woods - Outside Skyview Temple"),
    new SkywardSwordSceneDesc("F102_2", "Faron Woods - Faron's Lair"),
    new SkywardSwordSceneDesc("F103",   "Faron Woods (Flooded)"),
    new SkywardSwordSceneDesc("F200",   "Eldon Volcano"),
    new SkywardSwordSceneDesc("F201_1", "Eldon Volcano - Outside Earth Temple"),
    new SkywardSwordSceneDesc("F201_3", "Eldon Volcano - Despacito 201_3"),
    new SkywardSwordSceneDesc("F201_4", "Eldon Volcano - Despacito 201_4"),
    new SkywardSwordSceneDesc("F202_1", "Eldon Volcano - Despacito 202_1"),
    new SkywardSwordSceneDesc("F210",   "Eldon Volcano - Despacito 210"),
    new SkywardSwordSceneDesc("F211",   "Eldon Volcano - Despacito 211"),
    new SkywardSwordSceneDesc("F221",   "Eldon Volcano - Despacito 221"),
    new SkywardSwordSceneDesc("F300",   "Lanayru Desert - Despacito 300"),
    new SkywardSwordSceneDesc("F301",   "Lanayru Desert - Despacito 301"),
    new SkywardSwordSceneDesc("F300_1", "Lanayru Desert - Despacito 300_1"),
    new SkywardSwordSceneDesc("F300_2", "Lanayru Desert - Despacito 300_2"),
    new SkywardSwordSceneDesc("F300_3", "Lanayru Desert - Despacito 300_3"),
    new SkywardSwordSceneDesc("F300_4", "Lanayru Desert - Despacito 300_4"),
    new SkywardSwordSceneDesc("F300_5", "Lanayru Desert - Despacito 300_5"),
    new SkywardSwordSceneDesc("F301_1", "Lanayru Desert - Despacito 301_1"),
    new SkywardSwordSceneDesc("F301_2", "Lanayru Desert - Despacito 301_2"),
    new SkywardSwordSceneDesc("F301_3", "Lanayru Desert - Despacito 301_3"),
    new SkywardSwordSceneDesc("F301_4", "Lanayru Desert - Despacito 301_4"),
    new SkywardSwordSceneDesc("F301_5", "Lanayru Desert - Despacito 301_5"),
    new SkywardSwordSceneDesc("F301_6", "Lanayru Desert - Despacito 301_6"),
    new SkywardSwordSceneDesc("F301_7", "Lanayru Desert - Despacito 301_7"),
    new SkywardSwordSceneDesc("F302",   "Lanayru Desert - Despacito 302"),
    new SkywardSwordSceneDesc("F303",   "Lanayru Desert - Despacito 303"),
    new SkywardSwordSceneDesc("F400",   "Sacred Grounds - Despacito 400"),
    new SkywardSwordSceneDesc("F401",   "Sacred Grounds - Despacito 401"),
    new SkywardSwordSceneDesc("F402",   "Sacred Grounds - Despacito 402"),
    new SkywardSwordSceneDesc("F403",   "Sacred Grounds - Despacito 403"),
    new SkywardSwordSceneDesc("F404",   "Sacred Grounds - Despacito 404"),
    new SkywardSwordSceneDesc("F405",   "Sacred Grounds - Despacito 405"),
    new SkywardSwordSceneDesc("F406",   "Sacred Grounds - Despacito 406"),
    new SkywardSwordSceneDesc("F407",   "Sacred Grounds - Despacito 407"),
];


export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
