
// Skyward Sword

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as LZ77 from '../lz77';
import * as BRRES from './brres';
import * as U8 from './u8';

import { fetch, assert } from '../util';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState, ColorTarget } from '../render';
import { RRESTextureHolder, ModelRenderer } from './render';
import { TextureOverride } from '../gx/gx_render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';

const SAND_CLOCK_ICON = '<svg viewBox="0 0 100 100" height="20" fill="white"><g><path d="M79.3,83.3h-6.2H24.9h-6.2c-1.7,0-3,1.3-3,3s1.3,3,3,3h60.6c1.7,0,3-1.3,3-3S81,83.3,79.3,83.3z"/><path d="M18.7,14.7h6.2h48.2h6.2c1.7,0,3-1.3,3-3s-1.3-3-3-3H18.7c-1.7,0-3,1.3-3,3S17,14.7,18.7,14.7z"/><path d="M73.1,66c0-0.9-0.4-1.8-1.1-2.4L52.8,48.5L72,33.4c0.7-0.6,1.1-1.4,1.1-2.4V20.7H24.9V31c0,0.9,0.4,1.8,1.1,2.4l19.1,15.1   L26,63.6c-0.7,0.6-1.1,1.4-1.1,2.4v11.3h48.2V66z"/></g></svg>';

const materialHacks: GXMaterialHacks = {
    colorLightingFudge: (p) => `0.5 * ${p.matSource}`,
    alphaLightingFudge: (p) => `1.0`,
};

class SkywardSwordScene implements Viewer.MainScene {
    public textures: Viewer.Texture[];
    public textureHolder: RRESTextureHolder;
    public models: ModelRenderer[] = [];
    public animationController: BRRES.AnimationController;
    private mainColorTarget: ColorTarget = new ColorTarget();

    // Uses WaterDummy. Have to render after everything else. TODO(jstpierre): How does engine know this?
    private indirectModels: ModelRenderer[] = [];

    constructor(gl: WebGL2RenderingContext, public stageId: string, public textureRRESes: BRRES.RRES[], public stageArchive: U8.U8Archive) {
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
                'model1_s', // Lanayru Sand Sea "past" decal. Only seen there so far.
                'model2',   // Other transparent objects.

                // Future variations in Lanayru.
                'model_obj0',
                'model_obj0_s',
                'model_obj1',
                'model_obj1_s',
                'model_obj2',
                'model_obj2_s',
                'model_obj3',
                'model_obj3_s',
                'model_obj4',
                'model_obj4_s',
                'model_obj5',
                'model_obj5_s',
                'model_obj6',
                'model_obj6_s',
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
                if (oarcFile.name.includes('WaterF100'))
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
        // Find any indirect scenes.
        for (const modelRenderer of this.models) {
            for (const material of modelRenderer.mdl0.materials) {
                for (const sampler of material.samplers) {
                    if (sampler.name === 'DummyWater') {
                        this.indirectModels.push(modelRenderer);
                        continue outer;
                    }
                }
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.models);
        panels.push(layersPanel);

        // Construct a list of past/future models.
        const futureModels: ModelRenderer[] = [];
        const pastModels: ModelRenderer[] = [];
        for (const modelRenderer of this.models) {
            if (modelRenderer.mdl0.name.startsWith('model_obj'))
                futureModels.push(modelRenderer);

            // Lanayru Sand Sea has a "past" decal on top of a future zone.
            if (this.stageId === 'F301_1' && modelRenderer.mdl0.name === 'model1_s')
                pastModels.push(modelRenderer);
        }

        if (futureModels.length || pastModels.length) {
            const futurePanel = new UI.Panel();
            futurePanel.setTitle(SAND_CLOCK_ICON, "Time Stones");
    
            const selector = new UI.SimpleSingleSelect();
            selector.setStrings([ 'Past', 'Future' ]);
            selector.onselectionchange = (index: number) => {
                const isFuture = (index === 1);
                for (const modelRenderer of futureModels)
                    modelRenderer.setVisible(isFuture);
                for (const modelRenderer of pastModels)
                    modelRenderer.setVisible(!isFuture);
                layersPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Past
            futurePanel.contents.appendChild(selector.elem);
    
            panels.push(futurePanel);
        }

        return panels;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.models.forEach((model) => model.destroy(gl));
    }

    public render(state: RenderState): void {
        const gl = state.gl;
        this.animationController.updateTime(state.time);

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        this.models.forEach((model) => {
            if (this.indirectModels.includes(model))
                return;
            model.render(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        if (this.indirectModels.length) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT };
            this.textureHolder.setTextureOverride("DummyWater", textureOverride);
        }

        this.indirectModels.forEach((modelRenderer) => {
            modelRenderer.render(state);
        });
    }

    private spawnModel(gl: WebGL2RenderingContext, mdl0: BRRES.MDL0, rres: BRRES.RRES, namePrefix: string): ModelRenderer {
        const modelRenderer = new ModelRenderer(gl, this.textureHolder, mdl0, namePrefix, materialHacks);
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
            const needsSkyCmn = this.id.startsWith('F0');
            if (needsSkyCmn) {
                const skyCmnArchive = U8.parse(objPackArchive.findFile('oarc/SkyCmn.arc').buffer);
                const skyCmnRRES = BRRES.parse(skyCmnArchive.findFile('g3d/model.brres').buffer);
                textureRRESes.push(skyCmnRRES);
            }

            const stageArchive = U8.parse(LZ77.decompress(stageBuffer));

            return new SkywardSwordScene(gl, this.id, textureRRESes, stageArchive);
        });
    }
}

const id = "zss";
const name = "The Legend of Zelda: Skyward Sword";
const sceneDescs: Viewer.SceneDesc[] = [
    new SkywardSwordSceneDesc("D100",   "Skyview Temple"),
    new SkywardSwordSceneDesc("D101",   "Ancient Cistern"),
    new SkywardSwordSceneDesc("D200",   "Earth Temple"),
    new SkywardSwordSceneDesc("D201",   "Fire Sanctuary (A)"),
    new SkywardSwordSceneDesc("D201_1", "Fire Sanctuary (B)"),
    new SkywardSwordSceneDesc("D300",   "Lanayru Mining Facility (A)"),
    new SkywardSwordSceneDesc("D300_1", "Lanayru Mining Facility (B)"),
    new SkywardSwordSceneDesc("D301",   "Sandship"),

    new SkywardSwordSceneDesc("F000",   "Skyloft"),
    new SkywardSwordSceneDesc("F001r",  "Skyloft - Knight's Academy"),
    new SkywardSwordSceneDesc("D000",   "Skyloft - Waterfall Cave"),
    new SkywardSwordSceneDesc("F100",   "Faron Woods"),
    new SkywardSwordSceneDesc("F100_1", "Faron Woods - Inside the Great Tree"),
    new SkywardSwordSceneDesc("F101",   "Faron Woods - Deep Woods"),
    new SkywardSwordSceneDesc("F102",   "Faron Woods - Lake Floria"),
    new SkywardSwordSceneDesc("F102_1", "Faron Woods - Outside Skyview Temple"),
    new SkywardSwordSceneDesc("F102_2", "Faron Woods - Faron's Lair"),
    new SkywardSwordSceneDesc("F103",   "Faron Woods (Flooded)"),
    new SkywardSwordSceneDesc("F200",   "Eldin Volcano"),
    new SkywardSwordSceneDesc("F201_1", "Eldin Volcano - Inside Volcano"),
    new SkywardSwordSceneDesc("F201_3", "Eldin Volcano - Fire Sanctuary Entrance"),
    new SkywardSwordSceneDesc("F201_4", "Eldin Volcano - Volcano Summit - Waterfall"),
    new SkywardSwordSceneDesc("F202_1", "Eldin Volcano - Despacito 202_1"),
    new SkywardSwordSceneDesc("F210",   "Eldin Volcano - Caves"),
    new SkywardSwordSceneDesc("F211",   "Eldin Volcano - Thrill Digger"),
    new SkywardSwordSceneDesc("F221",   "Eldin Volcano - Despacito 221"),
    new SkywardSwordSceneDesc("F300",   "Lanayru Desert"),
    new SkywardSwordSceneDesc("F300_1", "Lanayru Desert - Ancient Harbor"),
    new SkywardSwordSceneDesc("F300_2", "Lanayru Desert - Lanayru Mine"),
    new SkywardSwordSceneDesc("F300_3", "Lanayru Desert - Power Generator #1"),
    new SkywardSwordSceneDesc("F300_4", "Lanayru Desert - Power Generator #2"),
    new SkywardSwordSceneDesc("F300_5", "Lanayru Desert - Temple of Time"),
    new SkywardSwordSceneDesc("F301",   "Lanayru Sand Sea - Docks"),
    new SkywardSwordSceneDesc("F301_1", "Lanayru Sand Sea - The Sea"),
    new SkywardSwordSceneDesc("F301_2", "Lanayru Desert - Pirate Stronghold"),
    new SkywardSwordSceneDesc("F301_3", "Lanayru Desert - Skipper's Retreat"),
    new SkywardSwordSceneDesc("F301_4", "Lanayru Desert - Shipyard"),
    new SkywardSwordSceneDesc("F301_5", "Lanayru Desert - Skipper's Retreat Shack"),
    new SkywardSwordSceneDesc("F301_7", "Lanayru Desert - Shipyard Construction Bay"),
    new SkywardSwordSceneDesc("F302",   "Lanayru Desert - Lanayru Gorge"),
    new SkywardSwordSceneDesc("F303",   "Lanayru Desert - Lanayru Caves"),
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
