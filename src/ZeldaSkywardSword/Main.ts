
// Skyward Sword

import * as CX from '../Common/Compression/CX.js';
import * as UI from '../ui.js';
import * as Viewer from '../viewer.js';
import * as BRRES from '../rres/brres.js';
import * as U8 from '../rres/u8.js';

import { ReadonlyVec3, mat4, quat } from 'gl-matrix';
import AnimationController from '../AnimationController.js';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { TransparentBlack, TransparentWhite, White, colorNewCopy, colorNewFromRGBA } from '../Color.js';
import { EggDrawPathBloom } from '../MarioKartWii/PostEffect.js';
import { Destroyable, SceneContext } from '../SceneBase.js';
import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { makeSolidColorTexture2D } from '../gfx/helpers/TextureHelpers.js';
import { GfxDevice, GfxTexture, } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { EFB_HEIGHT, EFB_WIDTH, GXMaterialHacks } from '../gx/gx_material.js';
import { ColorKind, GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render.js';
import { assert, assertExists, readString } from '../util.js';
import { EggLightManager } from '../rres/Egg.js';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from '../rres/render.js';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.1) * ${p.matSource})`,
};


interface BaseObj {
    name: string;
    unk1: number;
    unk2: number;
    rotX: number;
    rotY: number;
    rotZ: number;
}

interface Obj {
    unk1: number; // 0x00. Appears to be object-specific parameters.
    unk2: number; // 0x04. Appears to be object-specific parameters.
    tx: number;   // 0x08. Translation X.
    ty: number;   // 0x0C. Translation Y.
    tz: number;   // 0x10. Translation Z.
    rotX: number; // 0x14. Rotation around X.
    rotY: number; // 0x16. Rotation around Y (-0x7FFF maps to -180, 0x7FFF maps to 180)
    rotZ: number; // 0x18. Always zero so far (for OBJ. OBJS have it filled in.). Probably padding...
    unk5: number; // 0x1A. Object group perhaps? Tends to be a small number of things...
    unk6: number; // 0x1B. Object ID perhaps? Counts up...
    name: string; // 0x1C. Object name. Matched with a table in main.dol, which points to a .rel (DLL), and *that* loads the model.
}

// "S"calable "OBJ"ect, perhaps?
interface Sobj {
    unk1: number; // 0x00. Appears to be object-specific parameters.
    unk2: number; // 0x04. Appears to be object-specific parameters.
    tx: number;   // 0x08. Translation X.
    ty: number;   // 0x0C. Translation Y.
    tz: number;   // 0x10. Translation Z.
    sx: number;   // 0x14. Scale X.
    sy: number;   // 0x18. Scale Y.
    sz: number;   // 0x1C. Scale Z.
    rotX: number; // 0x20. Another per-object parameter?
    rotY: number; // 0x22. Always zero so far (for OBJ. OBJS have it filled in.). Probably padding...
    rotZ: number; // 0x24
    unk5: number; // 0x26. Object group perhaps? Tends to be a small number of things...
    unk6: number; // 0x27. Object ID perhaps? Counts up...
    name: string; // 0x28. Object name. Matched with a table in main.dol, which points to a .rel (DLL), and *that* loads the model.
}

interface RoomLayout {
    obj: Obj[];
    sobj: Sobj[];
}

interface BZS {
    layouts: RoomLayout[];
    areaType: number;
}

class ResourceSystem {
    public mounts: U8.U8Archive[] = [];
    private brresCache = new Map<string, BRRES.RRES>();

    public mountArchive(archive: U8.U8Archive): void {
        this.mounts.push(archive);
    }

    private findFile(path: string): U8.U8File | null {
        for (let i = 0; i < this.mounts.length; i++) {
            const file = this.mounts[i].findFile(path);
            if (file !== null)
                return file;
        }
        return null;
    }

    public getRRES(device: GfxDevice, textureHolder: RRESTextureHolder, path: string): BRRES.RRES {
        if (this.brresCache.has(path))
            return this.brresCache.get(path)!;
        const file = assertExists(this.findFile(path));
        const arc = U8.parse(file.buffer);
        const rres = BRRES.parse(assertExists(arc.findFileData('g3d/model.brres')));
        textureHolder.addRRESTextures(device, rres);
        this.brresCache.set(path, rres);
        return rres;
    }
}

class ModelCache {
    public cache = new Map<BRRES.MDL0, MDL0Model>();

    public getModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, mdl0: BRRES.MDL0, materialHacks: GXMaterialHacks): MDL0Model {
        if (this.cache.has(mdl0))
            return this.cache.get(mdl0)!;

        const cache = renderHelper.renderInstManager.gfxRenderCache;
        const mdl0Model = new MDL0Model(device, cache, mdl0, materialHacks);
        this.cache.set(mdl0, mdl0Model);
        return mdl0Model;
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.cache.values())
            model.destroy(device);
    }
}

const enum ZSSPass {
    SKYBOX = 1 << 0,
    MAIN = 1 << 1,
    INDIRECT = 1 << 2,
}

class ZSSTextureHolder extends RRESTextureHolder {
    public override findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        // HACK(jstpierre): Thrill Digger (F211) seems to have a missing texture. Where is it???
        if (name === 'F211_Wood01')
            return this.searchTextureEntryIndex('F211_Wood02');

        return -1;
    }
}

interface ModelToModelNodeBind_Info {
    model : MDL0ModelInstance;
    modelToBindTo : MDL0ModelInstance;
    nodeName : string;
};

class SkywardSwordRenderer implements Viewer.SceneGfx {
    public textureHolder: RRESTextureHolder;
    public animationController: AnimationController;
    public pastModelNames : string[] = [];
    public presentModelNames : string[] = [];
    private stageRRES: BRRES.RRES;
    private stageBZS: BZS | null = null;
    private roomBZSes: BZS[] = [];
    private commonRRES: BRRES.RRES;
    private resourceSystem = new ResourceSystem();
    private modelCache = new ModelCache();
    private renderHelper: GXRenderHelperGfx;
    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListInd = new GfxRenderInstList();
    private blackTexture: GfxTexture;
    private whiteTexture: GfxTexture;
    public currentLayer : number = 0;
    public layerModels : MDL0ModelInstance[][] = [];
    public modelInstances: MDL0ModelInstance[] = [];
    public modelBinds: ModelToModelNodeBind_Info[] = [];
    public otherTextureHolders: RRESTextureHolder[] = [];

    constructor(device: GfxDevice, public stageId: string, public systemArchive: U8.U8Archive, public objPackArchive: U8.U8Archive, public stageArchive: U8.U8Archive, public layerArchives: (U8.U8Archive)[] = [], public layerNums: number[]) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.textureHolder = new ZSSTextureHolder();
        this.animationController = new AnimationController();

        this.resourceSystem.mountArchive(this.stageArchive);
        this.resourceSystem.mountArchive(this.objPackArchive);
        for (let i = 0; i < layerArchives.length ; i++){
            this.resourceSystem.mounts.push(this.layerArchives[i]);
        }

        const systemRRES = BRRES.parse(systemArchive.findFileData('g3d/model.brres')!);
        this.textureHolder.addRRESTextures(device, systemRRES);

        // // Bringing over from mkWii
        // const blightData = systemArchive.findFileData(`./dat/default.blight`);
        // if (blightData !== null) {
        //     const blightRes = parseBLIGHT(blightData);
        //     const eggLightManager = new EggLightManager(blightRes);
        //     this.eggLightManager = eggLightManager;
        // }
        // // Bloom Data : CURRENTLY UNUSED
        // const bblmData = systemArchive.findFileData(`./dat/default.bblm`);
        // if (bblmData !== null) {
        //     const bblmRes = parseBBLM(bblmData);
        //     const eggBloom = new EggDrawPathBloom(device, this.renderHelper.renderCache, bblmRes);
        //     this.eggBloom = eggBloom;
        // }

        const flipY = gfxDeviceNeedsFlipY(device);
        this.textureHolder.setTextureOverride('DummyWater', { gfxTexture: null, lateBinding: 'opaque-scene-texture', width: EFB_WIDTH, height: EFB_HEIGHT, flipY });
        // Override the "Add" textures with a black texture to prevent things from being overly bright.
        this.blackTexture = makeSolidColorTexture2D(device, TransparentBlack);
        this.whiteTexture = makeSolidColorTexture2D(device, TransparentWhite);
        this.textureHolder.setTextureOverride('LmChaAdd', { gfxTexture: this.blackTexture, width: 1, height: 1, flipY: false });
        this.textureHolder.setTextureOverride('LmBGAdd', { gfxTexture: this.blackTexture, width: 1, height: 1, flipY: false });
        this.textureHolder.setTextureOverride('LmChaSkin', { gfxTexture: this.blackTexture, width: 1, height: 1, flipY: false });

        // Overriding the gradation textures. This causes some scenes to be overally bright
        this.textureHolder.setTextureOverride('F200_cmn_Gradation', { gfxTexture: this.whiteTexture, width: 1, height: 1, flipY: true });
        this.textureHolder.setTextureOverride('D200_cmn_Gradation', { gfxTexture: this.whiteTexture, width: 1, height: 1, flipY: true });

        this.resourceSystem.getRRES(device, this.textureHolder, 'oarc/SkyCmn.arc');

        // Water animations appear in Common.arc.
        this.commonRRES = this.resourceSystem.getRRES(device, this.textureHolder, 'oarc/Common.arc');
        this.textureHolder.addRRESTextures(device, this.commonRRES);

        // Load stage.
        this.stageRRES = BRRES.parse(stageArchive.findFileData('g3d/stage.brres')!);
        this.textureHolder.addRRESTextures(device, this.stageRRES);
        this.stageBZS = this.parseBZS(stageArchive.findFileData('dat/stage.bzs')!);

        for (let t = 0; t < 29; t++) {
            this.layerModels.push([]);
            this.currentLayer = t;
            const stageLayout = this.stageBZS.layouts[t];

            // if (this.layerNums.includes(t))
                this.spawnLayout(device, stageLayout);

            // Load rooms.
            const roomArchivesDir = stageArchive.findDir('rarc');
            if (roomArchivesDir) {
                for (let j = 0; j < roomArchivesDir.files.length; j++) {
                    const roomArchiveFile = roomArchivesDir.files[j];
                    const roomArchive = U8.parse(roomArchiveFile.buffer);
                    const roomRRES = BRRES.parse(roomArchive.findFileData('g3d/room.brres')!);

                    this.textureHolder.addRRESTextures(device, roomRRES);

                    for (let i = 0; i < roomRRES.mdl0.length && this.currentLayer === 0; i++) {
                        const mdl0 = roomRRES.mdl0[i];

                        const model = this.modelCache.getModel(device, this.renderHelper, mdl0, materialHacks);
                        const modelInstance = new MDL0ModelInstance(this.textureHolder, model, roomArchiveFile.name);
                        // modelInstance.materialInstances.find((mat) => mat.materialData.material.)
                        modelInstance.bindRRESAnimations(this.animationController, roomRRES, null);
                        modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
                        modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
                        modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);
                        modelInstance.passMask = ZSSPass.MAIN;
                        this.modelInstances.push(modelInstance);

                        // Detail / transparent meshes end with '_s'. Typical depth sorting won't work, we have to explicitly bias.
                        if (mdl0.name.endsWith('_s'))
                            modelInstance.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);
                    }


                    const roomBZS = this.parseBZS(roomArchive.findFileData('dat/room.bzs')!);
                    this.roomBZSes.push(roomBZS);
                    const layout = roomBZS.layouts[t];
                    if (this.layerNums.includes(t))
                        this.spawnLayout(device, layout);
                }
            }
        }

        outer:
        // Mark any indirect models. I think this is traditionally done at the actor level.
        for (let i = 0; i < this.modelInstances.length; i++) {
            const modelInstance = this.modelInstances[i];
            for (let j = 0; j < modelInstance.mdl0Model.mdl0.materials.length; j++) {
                const material = modelInstance.mdl0Model.mdl0.materials[j];
                for (let k = 0; k < material.samplers.length; k++) {
                    if (material.samplers[k].name === 'DummyWater') {
                        modelInstance.passMask = ZSSPass.INDIRECT;
                        continue outer;
                    }
                }
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        const modelsPanel = new UI.LayerPanel();
        modelsPanel.setLayers(this.modelInstances);
        modelsPanel.setTitle(UI.LAYER_ICON, 'Models');
        panels.push(modelsPanel);

        // Construct a list of past/present models.
        const presentModels: MDL0ModelInstance[] = [];
        const pastModels: MDL0ModelInstance[] = [];
        for (let i = 0; i < this.modelInstances.length; i++) {
            const modelInstance = this.modelInstances[i];
            if (modelInstance.mdl0Model.mdl0.name.startsWith('model_obj'))
                pastModels.push(modelInstance);
            else if (this.presentModelNames.includes(modelInstance.mdl0Model.mdl0.name))
                presentModels.push(modelInstance);
            else if (this.pastModelNames.includes(modelInstance.mdl0Model.mdl0.name))
                pastModels.push(modelInstance);
            // Lanayru Sand Sea has a "present" decal on top of a past zone.
            if (this.stageId === 'F301_1' && modelInstance.mdl0Model.mdl0.name === 'model1_s')
                presentModels.push(modelInstance);
        }

        if (presentModels.length || pastModels.length) {
            const presentPanel = new UI.Panel();
            presentPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            presentPanel.setTitle(UI.SAND_CLOCK_ICON, "Time Stones");

            const selector = new UI.SingleSelect();
            selector.setStrings([ 'Past', 'Present' ]);
            selector.onselectionchange = (index: number) => {
                const isPresent = (index === 1);
                for (let i = 0; i < presentModels.length; i++)
                    presentModels[i].setVisible(isPresent);
                for (let i = 0; i < pastModels.length; i++)
                    pastModels[i].setVisible(!isPresent);
                modelsPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Past
            presentPanel.contents.appendChild(selector.elem);

            panels.push(presentPanel);
        }

        const layerIndecies : number[] = [];
        const layerNames : string[] = [];
        if (this.layerModels.length > 1){
            for (let i = 0; i < this.layerModels.length; i++) {
                if (this.layerModels[i].length !== 0){
                    layerIndecies.push(i);
                    layerNames.push('Layer '+i);
                }
            }
        }
        if (layerNames.length!=0){
            const layerPanel = new UI.Panel();
            layerPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            layerPanel.setTitle(UI.LAYER_ICON, 'Layer Select');
            const selector = new UI.SingleSelect();
            selector.setStrings(layerNames);
            selector.onselectionchange = (index:number) => {
                // Set current layer visible
                // set other layers non-visible
                for (let i = 0; i < this.layerModels.length; i++){
                    if (this.layerModels[i].length !== 0)
                        this.layerModels[i].forEach((mdl)=>mdl.setVisible((i === layerIndecies[index] ) || (i===0)));
                }
                modelsPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Always select the first layer
            layerPanel.contents.appendChild(selector.elem);
            panels.push(layerPanel);
        }

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        panels.push(renderHacksPanel);

        return panels;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy();
        this.modelCache.destroy(device);
        device.destroyTexture(this.blackTexture);
        device.destroyTexture(this.whiteTexture);
        for (let i = 0; i < this.otherTextureHolders.length; i++)
            this.otherTextureHolders[i].destroy(device);
    }

    private preparePass(device: GfxDevice, list: GfxRenderInstList, passMask: number, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(list);
        for (let i = 0; i < this.modelInstances.length; i++) {
            const m = this.modelInstances[i];
            if (!(m.passMask & passMask))
                continue;
            m.prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        // if (this.eggLightManager !== null)
        //     for (let i = 0; i < this.modelInstances.length; i++)
        //         this.modelInstances[i].bindLightSetting(this.eggLightManager.lightSetting);
        this.modelBinds.forEach( value => {
            value.model.modelMatrix = value.modelToBindTo.getNodeToWorldMatrixRefernce(value.nodeName);
        });

        this.preparePass(device, this.renderInstListSky, ZSSPass.SKYBOX, viewerInput);
        this.preparePass(device, this.renderInstListMain, ZSSPass.MAIN, viewerInput);
        this.preparePass(device, this.renderInstListInd, ZSSPass.INDIRECT, viewerInput);
        this.renderHelper.renderInstManager.popTemplate();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        if (this.renderInstListInd.renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    this.renderInstListInd.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null, lateBinding: null });
                    this.renderInstListInd.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                });
            });
        }
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        this.renderHelper.renderGraph.execute(builder);
        this.renderInstListSky.reset();
        this.renderInstListMain.reset();
        this.renderInstListInd.reset();
    }

    private findNode(m: MDL0ModelInstance, name: string): BRRES.MDL0_NodeEntry | undefined {
        return m.mdl0Model.mdl0.nodes.find(node=>node.name===name);
    }
    private spawnObj(device: GfxDevice, obj: BaseObj, modelMatrix: mat4): void {
        // In the actual engine, each obj is handled by a separate .rel (runtime module)
        // which knows the actual layout. The mapping of obj name to .rel is stored in main.dol.
        // We emulate that here.

        const name = obj.name, params1 = obj.unk1, params2 = obj.unk2, rotx = obj.rotX, rotz = obj.rotZ;

        // TODO look at - EffGnT, SpiderL, V_Clip, Fmaker (fire), 'PltChg', (pallet Change? point light change?), SparkTg and SpkTg2,
        //                 Plight? - Pillar light? point light?
        // TODO add MassTag (Grass)
        const NO_MODEL_LIST = ['ScChang', 'MapArea', 'MapMark', 'Cam2Tag', 'EvntTag', 'CharE', 'CharD', 'Fmaker',
        'TgReact', 'WoodTg2', 'FairyTa', 'TlpTag', 'NpcTke', 'RoAtLog', 'EffGnT', 'SporeTg', 'Kytag',
        'Dowsing', 'ActTag' , 'BtlTg'  , 'V_Clip', 'SpiderL', 'StreamT', 'AutoMes', 'PotSal', 'SwrdPrj', 'GekoTag',
        'GateGnd', 'PlRsTag', 'InsctTg', 'SwTag', 'ColStp', 'NpcStr', 'SnLight', 'LBmaker', 'TgDefea', 'BcZTag', 'TouchTa',
        'AttTag' , 'GkMgTag', 'LtSftS' , 'ClrWall', 'Message', 'DNight', 'NpcInv', 'DieTag', 'Plight', 'TgSound', 'PltChg',
        'CBomSld', 'CamTag' , 'SwAreaT', 'CharD', 'CharE', 'WoodTag', 'BtlTgC', 'FencePe', 'HeatRst', 'SpkTg2', 'SparkTg',];

        const renderHelper = this.renderHelper;
        const doesModelContainRepeatTexture = (mdl : MDL0Model) => {
            let check : boolean = false;
            mdl.materialData.forEach( (material) => {
                material.material.samplers.forEach( (sampler) => {
                    // These will often be named the same across models but be different
                    if (['Body', 'Eye.0', 'Eye.1', 'Eye.2', 'Eye.3', 'Eye.4', 'Eyeball', 'Face',].includes(sampler.name)) {
                        check = true;
                    }
                });
            });
            return check;
        }
        const spawnModel = (rres: BRRES.RRES, modelName: string) => {
            const mdl0 = assertExists(rres.mdl0.find((model) => model.name === modelName));

            const model = this.modelCache.getModel(device, renderHelper, mdl0, materialHacks);
            const textureHolder = doesModelContainRepeatTexture(model) ? new ZSSTextureHolder() : this.textureHolder;
            textureHolder.addRRESTextures(device, rres);
            this.otherTextureHolders.push(textureHolder);
            
            const modelRenderer = new MDL0ModelInstance(textureHolder, model, obj.name);
            modelRenderer.passMask = ZSSPass.MAIN;
            mat4.copy(modelRenderer.modelMatrix, modelMatrix);
            this.modelInstances.push(modelRenderer);

            if (mdl0.name.endsWith('_s') || ['FXLightShaft', 'StageF000Light','MoundShovelD00', 'HoleShovelB', 'MoundShovel'].includes(mdl0.name))
                modelRenderer.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);

            if (!['GoddessCube', 'TBoxNormalT', 'TBoxSmallT', 'TBoxBossT', 'DoorBoss'].includes(mdl0.name)) // prevents some animations from instantly applying
                modelRenderer.bindRRESAnimations(this.animationController, rres);

            // TODO(jstpierre): Figure out how these MA animations work.
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);

            if (!['Door'].includes(name))
                this.layerModels[this.currentLayer].push(modelRenderer);

            return modelRenderer;
        };

        function staticFrame(frame: number): AnimationController {
            const a = new AnimationController();
            a.setTimeInFrames(frame);
            return a;
        }

        const scaleModelConstant = (model : MDL0ModelInstance, scale: number) => {
            mat4.scale(model.modelMatrix, model.modelMatrix, [scale, scale, scale]);
        };

        const scaleModel = (model : MDL0ModelInstance, scale: ReadonlyVec3) => {
            mat4.scale(model.modelMatrix, model.modelMatrix, scale);
        };

        const rotateModel = (model : MDL0ModelInstance, rotation: ReadonlyVec3) => {
            mat4.rotateX(model.modelMatrix, model.modelMatrix, rotation[0]);
            mat4.rotateY(model.modelMatrix, model.modelMatrix, rotation[1]);
            mat4.rotateZ(model.modelMatrix, model.modelMatrix, rotation[2]);
        };

        const translateModel = (model : MDL0ModelInstance, translation: ReadonlyVec3) => {
            mat4.translate(model.modelMatrix, model.modelMatrix, translation);
        };

        const getOArcRRES = (name: string) => {
            return this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
        };

        const spawnOArcModel = (name: string) => {
            const rres = this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
            return spawnModel(rres, name);
        };

        function mergeCHR0(rres: BRRES.RRES, main: string, add: string) : BRRES.CHR0 {
            const chrMain = findCHR0(rres, main);
            const chrAdd = findCHR0(rres, add);
            // Scan add for non-zero nodes
            // if non-zero -> merge into main using the same name
            chrAdd.nodeAnimations.forEach( animNode => {
                if (animNode.scaleX === undefined) {
                    const mainAnimNode = chrMain.nodeAnimations.findIndex((node) => node.nodeName === animNode.nodeName);
                    if (mainAnimNode !== -1)
                        chrMain.nodeAnimations[mainAnimNode] = animNode;
                    else
                        console.log('Unable to find Chr Common Node');
                }
            });
            return chrMain;
        };

        const findCHR0 = (rres: BRRES.RRES, name: string) => {
            return assertExists(rres.chr0.find((chr0) => chr0.name === name));
        };
        const findCLR0 = (rres: BRRES.RRES, name: string) => {
            return assertExists(rres.clr0.find((clr0) => clr0.name === name));
        };
        const findSRT0 = (rres: BRRES.RRES, name: string) => {
            return assertExists(rres.srt0.find((srt0) => srt0.name === name));
        };
        const findPAT0 = (rres: BRRES.RRES, name: string) => {
            return assertExists(rres.pat0.find((pat0) => pat0.name === name));
        };

        const stageRRES = this.stageRRES;
        const spawnModelFromNames = (arc:string, model:string) => {
            if (arc === 'Stage'){
                return spawnModel(stageRRES, model);
            } else {
                return spawnModel(getOArcRRES(arc), model);
            }
        };

        // Start object by object
        // Wardrobes
        if (name === 'chest'){
            const outsideType = (params1 >>> 28) & 0xF;
            const insideType  =  (params1 >>> 16) & 0xF;
            // Outside Model
            spawnModelFromNames('Tansu', 'Tansu' + ['A','B','C','D','A'][outsideType]);
            if (insideType !== 0xF)
                spawnModelFromNames('TansuInside', 'TansuInside' + ['A','B','C','D','A'][outsideType]);
        }
        //
        else if (name === 'Vrbox') {
            // First parameter appears to contain the Vrbox to load.
            const boxId = params1 & 0x0F;
            const boxName = [ 'Vrbox00', 'Vrbox01', 'Vrbox02', 'Vrbox03' ][boxId];
            const modelInstance = spawnOArcModel(boxName);
            modelInstance.passMask = ZSSPass.SKYBOX;
            modelInstance.isSkybox = true;
            // This color is probably set by the day/night system...
            modelInstance.setColorOverride(ColorKind.C2, colorNewCopy(White));
            modelInstance.setColorOverride(ColorKind.K3, colorNewCopy(White));
            mat4.scale(modelInstance.modelMatrix, modelInstance.modelMatrix, [0.1, 0.1, 0.1]);
        }
        // Actual Chests "Treasure Boxes"
        else if (name === 'TBox'){
            // keeping here due to complexity
            const itemId = rotz & 0x1FF;
            const doDisplay = !!(params1&0xF0000000);
            const boxSmallItems = [2,3,4,126];
            const boxBossItems = [25,26,27,29,30,31,95,96,97];
            const boxGoddessItems = [358,377,380,383,397,398,408,409,410,411,417,441,478,479];

            if (doDisplay){
                if (boxSmallItems.includes(itemId))
                    spawnOArcModel('TBoxSmallT');
                else if (boxBossItems.includes(itemId))
                    spawnOArcModel('TBoxBossT');
                else if (boxGoddessItems.includes(itemId))
                    spawnOArcModel('GoddessTBox');
                else
                    spawnOArcModel('TBoxNormalT');
            }
        }
        // Freestanding Items
        else if (name === 'Item'){
            // due to complexity, leaving here
            const itemId = params1 & 0xFF;
            const RUPEE_ITEMS = [2,3,4,32,33]; // gree, blue, red, silver, gold
            //Rupees
            if (RUPEE_ITEMS.includes(itemId)) {
                const rupeeModel = spawnOArcModel('PutRupee');
                mat4.scale(rupeeModel.modelMatrix, rupeeModel.modelMatrix, [1.5, 1.5, 1.5]);
                let rupeePat = findPAT0(getOArcRRES('PutRupee'), 'Rupee');
                switch(itemId){
                    case 2:  rupeeModel.bindPAT0(staticFrame(0), rupeePat); break;
                    case 3:  rupeeModel.bindPAT0(staticFrame(1), rupeePat); break;
                    case 4:  rupeeModel.bindPAT0(staticFrame(2), rupeePat); break;
                    case 32: rupeeModel.bindPAT0(staticFrame(3), rupeePat); break;
                    case 33: rupeeModel.bindPAT0(staticFrame(4), rupeePat); break;
                }
            }
            // Small Key
            else if (itemId === 1) {
                const keyModel = spawnOArcModel('PutKeySmall');
                mat4.scale(keyModel.modelMatrix, keyModel.modelMatrix, [1.1, 1.1, 1.1]);
            }
             // stamina fruit
            else if (itemId === 42) {
                const gutsRRES = getOArcRRES('PutGuts');
                const gutsMdl = spawnModel(gutsRRES, 'PutGuts');
                spawnModel(gutsRRES, 'PutGutsLeaf');
                gutsMdl.bindSRT0(this.animationController, findSRT0(gutsRRES, 'GutsLight'));
            }
             // Babies Rattle
            else if (itemId === 160) {
                spawnOArcModel('PutGaragara');
            }
            // heart piece
            else if (itemId === 94) {
                const m = spawnOArcModel('PutHeartKakera');
                scaleModelConstant(m, 1.375);
            }
            // Gratitude Crystal
            else if (itemId === 48) {
                const m = spawnOArcModel('GetGenki');
                scaleModelConstant(m, 1.7);
                translateModel(m, [0,30,0]);
            }
            // Normal Heart Item
            else if (itemId === 6) {
                const m = spawnOArcModel('PutHeart');
            }
            else {
                console.log(`unknown item id: ${itemId}`);
            }
        }
        // Air Vents
        else if (name === 'Wind'){
            const windType = (params1 >>> 3) & 1; // determines the big wind or not
            const windArc = ['FXTornado', 'FXTornadoBoss'][windType];
            spawnOArcModel(windArc);
        }
        // Water Vents
        else if (name === 'Wind03'){
            const waterSpoutRRES = getOArcRRES('WindSc00');
            let mdl = spawnModel(waterSpoutRRES, 'FX_WaterShaft');
            mdl.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaft_in'));
            mdl.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaft'));

            mdl = spawnModel(waterSpoutRRES, 'FX_WaterShaftTop');
            mdl.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaftTop_in'));
            mdl.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaftTop'));
            mat4.translate(mdl.modelMatrix, mdl.modelMatrix, [0, 100, 0]);
            mat4.scale(mdl.modelMatrix, mdl.modelMatrix, [1, 0.08, 1]);
        }
        // Lava Vents
        else if (name === 'Wind02'){
            const waterSpoutRRES = getOArcRRES('FXLava');
            let mdl = spawnModel(waterSpoutRRES, 'FX_LavaShaft');
            mdl.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_LavaShaft_Loop'));
            mdl.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_LavaShaft_Loop'));

            // mdl = spawnModel(waterSpoutRRES, 'FX_WaterShaftTop');
            // mdl.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaftTop_in'));
            // mdl.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaftTop'));
            mat4.translate(mdl.modelMatrix, mdl.modelMatrix, [0, -200, 0]);
            // mat4.scale(mdl.modelMatrix, mdl.modelMatrix, [1, 0.08, 1]);
        }
        // Moldroms
        else if (name === 'ESpark'){
            const sparkRRES = getOArcRRES('MoldWorm');
            const sparkMdl = spawnModel(sparkRRES, 'MoldWormHead');
            sparkMdl.bindCHR0(this.animationController, findCHR0(sparkRRES, "HeadWait"));
            let shift : number = -50;
            let start = shift;
            for (let i = 0; i < 3; i++){
                const bodySeg = spawnModel(sparkRRES, 'MoldWormBody');
                mat4.translate(bodySeg.modelMatrix, bodySeg.modelMatrix, [0, 0, start]);
                bodySeg.bindCHR0(this.animationController, findCHR0(sparkRRES, "BodyWalk"));
                start+=shift;
            }
            const tailSeg = spawnModel(sparkRRES, 'MoldWormTail');
            mat4.translate(tailSeg.modelMatrix, tailSeg.modelMatrix, [0, 0, start]);
            tailSeg.bindCHR0(this.animationController, findCHR0(sparkRRES, 'TailWait'));
        }
        // Vines, Ropes, and TightRopes
        else if (name === 'IvyRope'){
            // Ropes
            const ropeSubtype = params1 & 0xF;
            if (ropeSubtype < 3 || ropeSubtype === 4){
                // RopeA Bti for a length
            } else if (ropeSubtype === 6) {
                // RopeSpider bti
            } else if (ropeSubtype === 3) {
                // Coil
            } else if (ropeSubtype === 7) {
                // RopeTerry
            } else {
                // Common Dummy bti
            }
            if (ropeSubtype === 7){
                spawnOArcModel('RopeTerry');
            } else if (ropeSubtype === 4) {
                spawnModelFromNames('GrassCoil', 'GrassCoilCut'); // Can be switched to cut variant
            }
        }
        // Puzzle Stoppers on Isle of Songs Puzzle
        else if (name === 'UtaStop'){
            const stopperMdl = spawnOArcModel('IslPuzStopper');
            const ringNum = ((params1>>>8) & 0xF)-1; // Either 1,2,3
            const ringRotation = ((params1 >>> 12) & 0xF); // Either 1,9,3,10,0
            let rotateY : number = (ringRotation*5461);
            let ringDist = ringNum*400 + 700;
            let someAdd = (5461 - 1400000.0/ringDist);
            rotateY = 0x4000 - (rotateY - someAdd);
            rotateY = rotateY/0x7FFF * Math.PI;
            const tx = ringDist * Math.cos(rotateY);
            const tz = ringDist * Math.sin(-rotateY);
            translateModel(stopperMdl, [tx, 0, tz]);
            rotateModel(stopperMdl, [0, rotateY, 0]);
        }
        // Main Isle of Song mechanism, spawns the pusher, and rotating islands
        else if (name === 'UtaMain'){
            const mainMechaMdl = spawnOArcModel('IslSonCenterDevice');
            translateModel(mainMechaMdl, [0,230,0]);
            rotateModel(mainMechaMdl, [0,Math.PI,0]);
            for (let i = 0; i < 3; i++)
            {
                const ringRotation = [0,0,0][i] * -5461;
                // const ringRotation = [8,9,1][i];
                const mdl = spawnOArcModel('IslPuzSmallIslet');
                const mdl2 = spawnOArcModel('IslPuzIslet00');
                const ringDist = i*400 + 700;
                const isletDist = i*1400 + 2500;
                const rotateY = (ringRotation/0x7FFF * Math.PI) + Math.PI/2;
                const xDir = Math.cos(rotateY);
                const zDir = -Math.sin(rotateY)
                translateModel(mdl, [ringDist*xDir, 0, ringDist*zDir]);
                translateModel(mdl2, [isletDist*xDir, 0, isletDist*zDir]);
                rotateModel(mdl, [0, rotateY, 0]);
                rotateModel(mdl, [0, rotateY+Math.PI/2, 0]);
            }
        }
        // Dungeon Doors
        else if (name === 'TstShtr'){
            const doorType = (params1 >>> 4) & 0x3f;
            let isLocked  = ((rotx & 0x00FF) !== 0xFF);
            let isLocked2 = ((rotx & 0xFF00) !== 0xFF);
            const isLockedWithKey = (params1&0xF);
            const doorModelArcName   = 'ShutterFenced0' + [doorType];
            let   doorModelName      = 'ShutterFenced0' + [doorType];
            let   lockedModelName  = 'ShutterFencedFence0' + [doorType];
            const doorRRES = getOArcRRES(doorModelArcName);
           if (doorType === 2){ // Time Variants
                spawnModel(doorRRES, doorModelName+'N');
                spawnModel(doorRRES, doorModelName+'T');
                if ((isLocked || isLocked2) && isLockedWithKey !== 2) {
                    spawnModel(doorRRES, lockedModelName+'N');
                    spawnModel(doorRRES, lockedModelName+'T');
                }
           } else {
                spawnModel(doorRRES, doorModelName);
                if ((isLocked || isLocked2) && ![2,5].includes(isLockedWithKey)) {
                    spawnModel(doorRRES, lockedModelName);
                }
           }
           if ((isLocked || isLocked2) && [2].includes(isLockedWithKey)){
                const mdl = spawnOArcModel('LockSmall');
                mat4.translate(mdl.modelMatrix, mdl.modelMatrix, [0,150,0]);
                mat4.rotateX(mdl.modelMatrix, mdl.modelMatrix, Math.PI/2);
           }
        } else if (name === 'DoorBs'){
            // TODO : The boss door is applied to a base bossdoor model. Simply adding the animation doesnt work
            const dungeonNum = params1 & 0x3F;
            const dungeonIdx = [0,1,2,0,1,2][dungeonNum];
            const bossDoorModel = ['DoorBossA', 'DoorBossB', 'DoorBossC'][dungeonIdx]; // has LR
            const bossLockIdx = [0,1,2,5,3,4][dungeonNum];
            const bossLockOarc  = ['BossLock1A', 'BossLock1B', 'BossLock1C', 'BossLock2B', 'BossLock2C'][bossLockIdx];
            const bossLockModel = ['BossLockLv1', 'BossLockLv2', 'BossLock1C', 'BossLock2B', 'BossLock2C'][bossLockIdx]; // has LR
            const keyHoleModel = ['BossKeyhole1A', 'BossKeyhole1B', 'BossKeyhole1C', '-', 'BossKeyhole2B', 'BossKeyhole2C' ][dungeonNum]; // has LR

            const bossDoorAnim = spawnOArcModel('DoorBoss');
            bossDoorAnim.bindRRESAnimations(this.animationController, getOArcRRES("DoorBoss"), "DoorBoss_Open");
            // Spawn Keyhole
            if (dungeonNum !== 3) // Ancient Cistern
            {
                let doorL, doorR, lockL, lockR, holeL, holeR : MDL0ModelInstance;
                // Spawn Door
                doorL = spawnModelFromNames(bossDoorModel, bossDoorModel+'L');
                doorR = spawnModelFromNames(bossDoorModel, bossDoorModel+'R');
                // Spawn Lock
                lockL = spawnModelFromNames(bossLockOarc, bossLockModel+'L');
                lockR = spawnModelFromNames(bossLockOarc, bossLockModel+'R');
                // Spawn Keyhole
                holeL = spawnModelFromNames(keyHoleModel, keyHoleModel+'L');
                holeR = spawnModelFromNames(keyHoleModel, keyHoleModel+'R');
                this.modelBinds.push({model: doorL, modelToBindTo: bossDoorAnim, nodeName: "DoorBossL"})
                this.modelBinds.push({model: doorR, modelToBindTo: bossDoorAnim, nodeName: "DoorBossR"})
                this.modelBinds.push({model: lockL, modelToBindTo: bossDoorAnim, nodeName: "LockL"})
                this.modelBinds.push({model: lockR, modelToBindTo: bossDoorAnim, nodeName: "LockR"})
                this.modelBinds.push({model: holeL, modelToBindTo: bossDoorAnim, nodeName: "KeyholeL"})
                this.modelBinds.push({model: holeR, modelToBindTo: bossDoorAnim, nodeName: "KeyholeR"})
            }
            else {
                // Cistern is *Special*
                spawnModelFromNames('BossLockD101', 'BossLockD101');

            }
            if (dungeonNum === 2) { // LMF present doors....
                let doorL, doorR, lockL, lockR, holeL, holeR : MDL0ModelInstance;
                // Spawn Door
                doorL = spawnModelFromNames(bossDoorModel, bossDoorModel+'NL');
                doorR = spawnModelFromNames(bossDoorModel, bossDoorModel+'NR');
                // Spawn Lock
                lockL = spawnModelFromNames(bossLockOarc, bossLockModel+'LN');
                lockR = spawnModelFromNames(bossLockOarc, bossLockModel+'RN');
                // Spawn Keyhole
                holeL = spawnModelFromNames(keyHoleModel, keyHoleModel+'LN');
                holeR = spawnModelFromNames(keyHoleModel, keyHoleModel+'RN');
                this.pastModelNames.push(bossDoorModel+'L');
                this.pastModelNames.push(bossDoorModel+'R');
                this.pastModelNames.push(bossLockModel+'L');
                this.pastModelNames.push(bossLockModel+'R');
                this.pastModelNames.push(keyHoleModel+'L');
                this.pastModelNames.push(keyHoleModel+'R');
                this.presentModelNames.push(bossDoorModel+'NL');
                this.presentModelNames.push(bossDoorModel+'NR');
                this.presentModelNames.push(bossLockModel+'LN');
                this.presentModelNames.push(bossLockModel+'RN');
                this.presentModelNames.push(keyHoleModel+'LN');
                this.presentModelNames.push(keyHoleModel+'RN');
                this.modelBinds.push({model: doorL, modelToBindTo: bossDoorAnim, nodeName: "DoorBossL"})
                this.modelBinds.push({model: doorR, modelToBindTo: bossDoorAnim, nodeName: "DoorBossR"})
                this.modelBinds.push({model: lockL, modelToBindTo: bossDoorAnim, nodeName: "LockL"})
                this.modelBinds.push({model: lockR, modelToBindTo: bossDoorAnim, nodeName: "LockR"})
                this.modelBinds.push({model: holeL, modelToBindTo: bossDoorAnim, nodeName: "KeyholeL"})
                this.modelBinds.push({model: holeR, modelToBindTo: bossDoorAnim, nodeName: "KeyholeR"})
            }
        // The Big Lily Pads
        } else if (name === 'Lotus'){
            const lilyPadSubtype = (params1>>>10)&0xF;
            const isUpsideDown = !((params1>>>8)&0x3);
            const lilyPadOarc = ['WhipLeaf00', 'WhipLeaf01', 'WhipLeafStop', 'LotusStep'][lilyPadSubtype];
            const padModel = spawnOArcModel(lilyPadOarc);
            if (isUpsideDown)
                rotateModel(padModel, [0,0,Math.PI]);

        // Chu Chus -> need texture overriding for the different kinds
        } else if (name === 'ESm'){
            const smRRES = getOArcRRES('Sm');
            const variant = params1 & 0xF;
            const frame = [0,3,2,0,3,2,1][variant];
            const chuModel = spawnModel(smRRES, 'sm');
            chuModel.bindPAT0(staticFrame(frame), findPAT0(smRRES, 'sm'));
            chuModel.bindCHR0(this.animationController, findCHR0(smRRES, 'awa'));
        // Bocoblins
        } else if (name === 'EBc'){
            const bcRRES = getOArcRRES('Bc');
            const variant = (params1>>>0)&3;
            const bokoConfig = (params1>>24)&0xF;
            let color = [1,0,2][variant];
            if (variant === 1 && (['D200', 'D301'].includes(this.stageId) || ![1,2].includes(this.stageBZS!.areaType))) color = 1;
            let bcName = ['BocoburinG', 'BocoburinM', 'BocoburinB'][color];
            if (bokoConfig === 9)
                bcName = ['BocoburinG', 'Bocoburin_A', 'BocoburinB'][color];
            const mdl = spawnModel(bcRRES, bcName);
            mdl.bindPAT0(this.animationController, findPAT0(bcRRES, `Bocoburin${['G','A','B'][color]}Wink`));
            mdl.bindCHR0(this.animationController, findCHR0(bcRRES, 'wait'));
            scaleModelConstant(mdl, 1.1);
            let weaponIdx = -1;
            // Weapon
            if (bokoConfig === 9) {
                // Bow
                const bowMdl = spawnModel(bcRRES, color === 0 ? 'BocoburinGBow' : 'bow');
                this.modelBinds.push({model: bowMdl, modelToBindTo: mdl, nodeName: 'hand_L'})
            } else if (color === 0) {
                weaponIdx = 4;
            } else if (color === 2) {
                weaponIdx = 3;
            } else if (bokoConfig === 2 || bokoConfig === 8) {
                weaponIdx = 2;
            } else if (bokoConfig !== 4) {
                weaponIdx = 1;
            }
            else {
                const weaponMdl = spawnModel(bcRRES, 'BocoburinRantan');
                this.modelBinds.push({model: weaponMdl, modelToBindTo: mdl, nodeName: 'hand_R'})
                mdl.bindCHR0(this.animationController, findCHR0(bcRRES, 'Rwait'));
            }
            if (weaponIdx !== -1)
            {
                const weaponName = `Bocoburin${['SwordA', 'Stick', 'BSword','GSword'][weaponIdx-1]}`;
                const weaponMdl = spawnModel(bcRRES, weaponName);
                this.modelBinds.push({model: weaponMdl, modelToBindTo: mdl, nodeName: 'hand_R'})
            }
            // Headpiece
            if (variant !== 0 && color !== 0)
            {
                const headcloth = spawnModel(bcRRES, `Bocoburin${['M','M','B'][color]}Headcloth`);
                this.modelBinds.push({model: headcloth, modelToBindTo: mdl, nodeName: 'head'})
            }
            // Belt item
            const beltItem = ["None", 'Horn', 'Key'][(params1 >>> 2) & 3];
            if (beltItem !== "None")
            {
                if (beltItem === 'Key') {
                    const keyMdl = spawnModel(bcRRES, "KeySmall");
                    this.modelBinds.push({model: keyMdl, modelToBindTo: mdl, nodeName: 'pipe_loc'})
                }
                else {
                    const pipemdl = spawnModel(bcRRES, "BocoburinPipe");
                    this.modelBinds.push({model: pipemdl, modelToBindTo: mdl, nodeName: 'pipe_loc'})
                }
            }
        }
        // Mark for Farores and Dins Flame
        else if (name === 'GodMark'){
            const godMarkRRES = getOArcRRES('GodsMark');
            const type = params1&0x1;
            const clrType = findCLR0(godMarkRRES, ['GodsMark_F', 'GodsMark_D', 'GodsMark_N'][type]);
            const mdl = spawnModel(godMarkRRES, 'GodsMark');
            mdl.bindSRT0(staticFrame([0,1,2][type]), findSRT0(godMarkRRES, 'GodsMark'));
            mdl.bindCLR0(this.animationController, clrType);
        }
        // Bushes
        else if (name === 'OcGrs') {
            const type = (params1 >>> 0) & 0xF;
            const arc = ['GrassOcta', 'GrassRollGrow', 'GrassGerm', 'GrassMain'][type];
            const mdl2 = ['GrassOctaCut', 'GrassRollCut', 'GrassGermCut', 'GrassMainCut'][type];
            spawnOArcModel(arc); // main Bush
            spawnModelFromNames(arc, mdl2); // The stem
        }
        //  Grass things in faron
        else if (name === 'Gcoil') {
            spawnOArcModel('GrassCoilNormal');
        }
        // Big Flags around skyloft (like hanging from bazaar)
        else if (name === 'Flag') {
            console.info('Revist Flag Later'); // There are Purple ones and big ones need rotation
            const type = (params1 >>> 0) & 0xF;
            const model = ['FlagA', 'FlagA', 'FlagB', 'FlagB', 'BigSail', 'BigSail'][type];
            spawnOArcModel(model);
        }
        // Small Trees, requires segments and more scaling weirdness
        else if (name === 'Bamboo') {
            console.info('Revisit Bamboo Later'); // Done show up right
            const type = (params1 >>> 5) & 0xF;
            const arc = ['None','TreeLong00', 'KanbanTree', 'TreeLongBamboo','TreeLong01', 'TreeLongSky'][type];
            const model1 = ['None', 'TreeLong00', 'None', 'None', 'TreeLong01', 'TreeLongSky'][type];
            const model2 = ['None', 'TreeLong00Cutmark', 'None', 'None', 'TreeLong01Cutmark', 'TreeLongSkyCutmark'][type];
            // if (arc !== 'None')
            // {
            //     const rres = getOArcRRES(arc);
            //     if (model1 !== 'None')
            //     {
            //         const m = spawnModel(rres, model1);
            //         translateModel(m, [0, 100, 0]);
            //     }
            //     const m2 = spawnModel(rres, "TreeLongSkySpike");
            //     translateModel(m2, [0, 50, 0]);
            //     spawnModelFromNames('TreeLongSky', 'TreeLongSkyCutmark');
            // }
        }
        // Low Poly Islands
        else if (name === 'IslLOD') {
            const type = params1&0xF;
            const model = name+['A','B','C','D','E'][type];
            spawnOArcModel(model);
        }
        // Low Poly Loftwings flying around skyloft
        else if (name === 'BrdMob' ) {
            const arcMdl = getOArcRRES('BirdLOD');
            const chr = findCHR0(arcMdl, 'BirdLOD_Glide');
            console.info('Revisit BrdMob Later');
        }
        // Wood Signs
        else if (name === 'Kanban' ) {
            const m = spawnModelFromNames('Kanban', 'KanbanA');
            translateModel(m, [0,100,0]);
        }
        // Practice Slash Logs
        else if (name === 'SliceLg') {
            const type = params1  & 0xF;
            const logName = 'PracticeWood'+['A','B','C','D','CR','F'][type];
            spawnModelFromNames('PracticeWood', logName+'1');
            spawnModelFromNames('PracticeWood', logName+'2');
        }
        // Cloud Barrier for each pillar - Temporarily using Some other effect untily JPA support
        else if (name === 'LightLi') {
            const m = spawnOArcModel('FXLightShaft');
            scaleModel(m, [5,1,5]);
            console.info('Add Effect for LightLi')
        }
        // Player Bird (Crimson Loftwing)
        else if (name === 'PyBird') {
            const m = spawnModelFromNames('Bird_Link', 'BirdLink');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Glide'));
        }
        // Item Shop (Rupin) Owner mother
        else if (name === 'NpcDoMo') {
            const rres = getOArcRRES('DouguyaMother');
            const m = spawnModel(rres, 'DouguyaMother');
            m.bindCHR0(this.animationController, findCHR0(rres, 'DouguyaMother_wait'));
        }
        // The shield bash practice log
        else if (name === 'GuardLg' ) {
            const m = spawnModelFromNames('PracticeWood', 'PracticeWoodE'); // Log
            scaleModelConstant(m, 1.2);
            translateModel(m, [100,200,40]);
            const m2 = spawnModelFromNames('PracticeWood', 'RopeBase'); // Rope on Top
            m2.modelMatrix = mat4.create();
            console.info('Create String for GuardLg');
        }
        // Water on Skyloft
        else if (name === 'CityWtr') {
            spawnModelFromNames('Stage', 'StageF000Water0');
            spawnModelFromNames('Stage', 'StageF000Water1');
            spawnModelFromNames('Stage', 'StageF000Water2');
        }
        // Gravestones
        else if (name === 'Grave') {
            spawnModelFromNames('Stage', 'StageF000Grave')
        }
        //Shed Door to demon
        else if (name === 'Shed') {
            spawnModelFromNames('Stage', 'StageF000Shed')
        }
        // Windmills for the light Tower
        else if (name === 'Windmil') {
            spawnModelFromNames('Stage', 'StageF000Windmill')
        }
        // Ropes with pinwheels and such
        else if (name === 'Blade'  ) {
            spawnModelFromNames('Stage', 'StageF000Blade')
        }
        // Harp area for the Thuderhead opening
        else if (name === 'LHHarp' ) {
            const m = spawnModelFromNames('Stage', 'StageF000Harp');
            rotateModel(m, [0, -9.5/12*Math.PI, 0]);
        }
        // Sunlight in harp area
        else if (name === 'LHLight'){
            spawnModelFromNames('Stage', 'StageF000Light');
        }
        else if (name === 'SnLight'){
            spawnModelFromNames('Stage', 'StageF000Light');
        }
        // Gates on Skyloft that block doors
        else if (name === 'DmtGate'){
            const type = (params1>>> 8) & 0xF;
            const typeName = 'StageF000'+['Gate', 'GodDoor', 'Shutter', 'Gate'][type];
            const m = spawnModelFromNames('Stage', typeName);
            console.info('Revist DmtGate');
        }
        // Pumpkins
        else if (name === 'Pumpkin'){
            spawnModelFromNames('Pumpkin', 'Pumpkin');
            spawnModelFromNames('Pumpkin', 'Turu');
        }
        // Heart Flowers
        else if (name === 'Heartf'){
            spawnModelFromNames('FlowerHeart', 'FlowerHeart');
        }
        // Chairs -> some are invisible for some reason...
        else if (name === 'Char'){
            const type = (params1>>> 0) & 0xF;
            const typeName = 'Char'+['A','D','I','F','G','H'][type];
            if (![1,2].includes(type)){
                spawnOArcModel(typeName);
            }
        }
        // Main Underground stage layouts
        else if (name === 'Uground'){
            const type = params1&0xFF;
            const typeName = 'MoleGround'+['S','M','L','Sn','Sl','Sr','Mn','Ml','Mr','Ln'][type];
            spawnOArcModel(typeName);
        }
        // Underground Obstacles
        else if (name === 'BlockUg'){
            const type = params1&0xFF;
            const arcName = 'MoleBlock';
            const typeName = arcName+['','Bomb','Break','Break'][type];
            spawnModelFromNames(arcName, typeName);
        }
        // Skyloft in the sky perspective
        else if (name === 'City') {
            spawnModelFromNames('IslF000', 'IslF000');
            spawnModelFromNames('IslF000', 'IslF000_s');
            spawnModelFromNames('IslF000', 'IslF000Water0');
        }
        // Island with Bamboo minigame
        else if (name === 'IslBamb') {
            spawnModelFromNames('IslBamb', 'IslBamb');
            spawnModelFromNames('IslBamb', 'IslBamb_s');
        }
        // Beetles sky island
        else if (name === 'IslTery') {
            spawnModelFromNames('IslTerry', 'IslTerry');
        }
        // LumpPumpkin
        else if (name === 'PumpBar') {
            spawnModelFromNames('IslBar', 'IslBar');
        }
        // THe ring on Fun Fun Island
        else if (name === 'RouletR') {
            spawnModelFromNames('IslRouRot', 'IslRouRot');
        }
        // Main Fun Fun island
        else if (name === 'RouletC') {
            spawnModelFromNames('IslRouMain', 'IslRouMain');
            spawnModelFromNames('IslRouMain', 'IslRouMain_s');
        }
        // dig spots
        else if (name === 'FrmLand') {
            spawnModelFromNames('MoundShovelD', 'MoundShovelD00');
        }
        // Boss Koloktos Pillars
        else if (name === 'AsuraP') {
            for (let i = 0; i < 6; i++){
                const type = 'BreakPillar'+['A','B','C','D','E','F'][i];
                const m = spawnModelFromNames('BreakPillar', type);
                translateModel(m, [0, i*200, 0]);
            }
        }
        // Boss Koloktos
        else if (name === 'BAsura') {
            const m = spawnOArcModel('Asura');
            const rres = getOArcRRES('Asura');
            m.bindCHR0(this.animationController, findCHR0(rres, 'BWait00'));
            m.bindSRT0(this.animationController, findSRT0(rres, 'Wait00'));
        }
        // Bomb Flower
        else if (name === 'Bombf') {
            spawnModelFromNames('FlowerBomb', 'LeafBomb');
            spawnModelFromNames('Alink', 'EquipBomb');
        }
        // Spikes in ancient cistern
        else if (name === 'Spike') {
            spawnModelFromNames('SpikeD101', 'SpikeD101');
        }
        // Whirlpool cork
        else if (name === 'PlCock') {
            spawnModelFromNames('WaterD101', 'PoolCockD101');
        }
        // Whirlpool
        else if (name === 'Vortex') {
            spawnModelFromNames('WaterD101', 'SpiralWaterD101');
        }
        // Shutter for water
        else if (name === 'ShtrWtr') {
            spawnModelFromNames('ShutterWaterD101', 'ShutterWaterD101');
        }
        // Birdge from Whip Lever
        else if (name === 'BridgeS') {
            spawnModelFromNames('BridgeD101', 'BridgeD101');
        }
        // Roll pillars for vines TODO: add rotation
        else if (name === 'rpiller'){
            const type = (params1 >>> 28) & 0xF;
            const typeName = 'SpinPillarD101'+['A','A','B','C','A','B','C'][type];
            spawnModelFromNames('SpinPillarD101', typeName);
        }
        // DoorsF300
        else if (name === 'Door') {
            const type = params1&0x3f;
            const arcName = 'Door'+['A00','A01','C00','C01','B00','E','A02','F','H'][type];
            if (type === 5) {
                spawnModelFromNames(arcName, 'DoorE_N');
                spawnModelFromNames(arcName, 'DoorE_T');
                this.pastModelNames.push('DoorE_T');
                this.presentModelNames.push('DoorE_N');
            } else {
                spawnOArcModel(arcName);
            }
        }
        // Bombable Rocks
        else if (name === 'BlsRock'){
            const type = (params1 >>> 8) & 0xFF;
            const arcName = ['TeniCrystalRockSc','BRockHole00','BRockWall','BRockDoor00','BRockR01','BrokenRockWallD200','LavaBRock','BRockWall','BRockCrystal','BRockF202','BRockRail','F300BrokenRockWall','F300BrokenRockWall','BWallAF200','BWallBF200','BWallF210','BRockStopA','BRockHole00','BWallD201','BRockWall',][type];
            const modelName = ['TeniCrystalRockScA','BRockHole00A','BRockWall00A','BRockDoor00A','BRockR01A','BrokenRockWallD200','LavaBRockA','BRockWall00A','BRockCrystalA','BRockF202A','BRockRailA','F300BrokenRockWall_00','F300BrokenRockWall_01','BWallAF200','BWallBF200','BWallF210','BRockStopAA','BRockHole01A','BWallD201','BRockWall00A',][type];
            spawnModelFromNames(arcName, modelName);
        }
        // Mushrooms
        else if (name === 'Kinoko' || name === 'SKinoko'){
            const type = params1 & 0x3;
            const arcName = 'Mushroom' + ['A','B','C','D'][type];
            spawnOArcModel(arcName);
        }
        // Island with spiral charge rocks
        else if (name === 'IslTreB') {
            spawnOArcModel('IslTreI');
            spawnOArcModel('IslTreIRock');
        }
        // Islands in the Sky
        else if (name === 'IslTrea') {
            const type = params1 & 0xF;
            const typeName = 'IslTre'+['A','B','C','D','E','F','G','H'][type];
            spawnOArcModel(typeName);
            if (type === 2){
                spawnModelFromNames(typeName, typeName+'Water00');
                spawnModelFromNames(typeName, typeName+'Water01');
            }
        }
        // Rocks in the Sky
        else if (name === 'RockSky') {
            const type = params1 & 0xF;
            const typeName = 'RockSky'+['A','B','C','D',][type];
            spawnOArcModel(typeName);
        }
        // Digging holes for mitts
        else if (name === 'InHole') {
            spawnModelFromNames('MoundShovelB', 'MoundShovelB');
            spawnModelFromNames('MoundShovelB', 'HoleShovelB');
        }
        // Walltulas
        else if (name === 'EWs') {
            const m = spawnOArcModel('StalWall');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('StalWall'), 'wait00'));
            scaleModelConstant(m, 0.5);
            rotateModel(m, [Math.PI/2, 0, 0]);
        }
        // Scrapper
        else if (name === 'NpcSlFl') {
            const m = spawnOArcModel('DesertRobot');
            m.bindCHR0(this.animationController,
                findCHR0(getOArcRRES('DesertRobot_Sal'), 'DesertRobot_Sal_Fly'));
        }
        // Musasabi Tag spawns the little circle animals when diving
        else if (name === 'MssbTag') {
            const m = spawnOArcModel('DesertMusasabi');
            const rres = getOArcRRES('DesertMusasabi');
            m.bindCHR0(this.animationController, findCHR0(rres, 'DesertMusasabi_dive_loop'));
            m.bindPAT0(staticFrame(0), findPAT0(rres, 'DesertMusasabi'));
            scaleModelConstant(m, 0.0001);
        }
        // Gossip Stones (Harp Hints)
        else if (name === 'HrpHint') {
            const type = (params1>>>0x18) & 0x1;
            spawnOArcModel(['GossipStone', 'ShiekahStone'][type]);
        }
        // Little Pots
        else if (name === 'Tubo') {
            spawnModelFromNames('Tubo', 'Tubo0'+['0','1'][params1&1]);
        }
        // Big Pots
        else if (name === 'BigTubo') {
            spawnOArcModel('TuboBig');
        }
        // Bird Statues
        else if (name === 'saveObj') {
            spawnOArcModel('SaveObject'+['B','A','C'][(params1>>>8)&0xF]);
        }
        // Knight Leader
        else if (name === 'NpcKnld') {
            const arcName = 'Lord';
            const rres = getOArcRRES(arcName);
            const m = spawnOArcModel(arcName);
            const swordMdl = spawnModel(rres, "SwordLord");
            this.modelBinds.push({ model: swordMdl, modelToBindTo: m, nodeName: "SwordH"});
            translateModel(m, [0,18,0]);
            const chr = mergeCHR0(rres, 'Lord_wait', 'Lord_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'Lord_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // moveable lava in Eldin
        else if (name === 'UDLava') {
            const type = params1&0x3;
            const arcName = 'UpdwnLava';
            const mdlName = arcName+['A','B','C'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            m.bindRRESAnimations(this.animationController, getOArcRRES(arcName), 'UpdwnLava');
            if (type === 0) {
                translateModel(m, [0, 175, 0]);
            }
        }
        // Goddess Cubes
        else if (name === 'GodCube') {
            const doDisplay = (params1>>>24) & 0x1;
            if (doDisplay === 0)
                spawnOArcModel('GoddessCube');
        }
        // Thunderhead Cloud Dome
        else if (name === 'CmCloud') {
            const type = params1&0x1;
            const typeName = 'F020Cloud'+['','Inside'][type];
            spawnModelFromNames(typeName,typeName);
            spawnModelFromNames(typeName,typeName+'_s');
        }
        // Paintings of Groose And Batreaux
        else if (name === 'Paint') {
            spawnModelFromNames('Paint', 'Paint'+['A','B'][params1&1]);
        }
        // Groose's sandbag
        else if (name === 'Sandbag') {
            spawnOArcModel('DecoC');
        }
        // Clawshot Targets
        else if (name === 'ClawSTg') {
            spawnOArcModel('ShotMark');
        }
        // Under Cloud sTuff
        else if (name === 'UdCloud') {
            spawnOArcModel('F020UnderCloud');
        }
        // Viewing Platform in Faron
        else if (name === 'ObjBld') {
            spawnOArcModel('DowsingZoneE300');
        }
        // Faron water
        else if (name === 'WtrF100') {
            const rres = getOArcRRES('WaterF100');
            spawnModel(rres, 'model0');
            spawnModel(rres, 'model1');
            spawnModel(rres, 'model2');
            spawnModel(rres, 'model3');
        }
        // Eldins lava
        else if (name === 'LavF200') {
            spawnModelFromNames('LavaF200', 'LavaF200');
            spawnModelFromNames('LavaF200', 'LavaF200_s');
        }
        // bug island
        else if (name === 'IslIns') {
            spawnModelFromNames('IslIns', 'IslIns');
            spawnModelFromNames('IslIns', 'IslInsWater00');
            spawnModelFromNames('IslIns', 'IslInsWater01');
        }
        // Mogma left over ground spec
        else if (name === 'MoSoil') {
            spawnModelFromNames('MogumaMud', 'MogumaMud');
        }
        // farmland
        else if (name === 'Soil') {
            spawnModelFromNames('MoundShovel', 'MoundShovel');
        }
        // Main platform for isle of songs puzzle
        else if (name === 'PzlLand') {
            spawnModelFromNames('IslPuz', 'IslPuz');
        }
        // Island for Pumpkin soup (Has rainbow)
        else if (name === 'IslNusi') {
            spawnModelFromNames('IslNusi', 'IslNusi');
            spawnModelFromNames('IslNusi', 'IslNusi_s');
        }
        // Stone tablets with Text
        else if (name === 'KanbanS') {
            spawnModelFromNames('KanbanStone', 'KanbanStone');
        }
        // Wooden logs in Faron
        else if (name === 'Log') {
            spawnModelFromNames('Log', 'Log');
        }
        // Beehives and bees
        else if (name === 'Bee') {
            const m = spawnModelFromNames('Bee', 'home');
            translateModel(m, [0,-100,0]);
        }
        // Isle of Songs puzzle switch
        else if (name === 'SwDir') {
            spawnModelFromNames('SwichThree', 'SwitchThree');
        }
        // Isle of songs main building
        else if (name === 'Utajima') {
            spawnModelFromNames('IslSon', 'IslSon');
            spawnModelFromNames('IslSon', 'IslSon_s');
        }
        // snad piles
        else if (name === 'vmSand') {
            spawnModelFromNames('SandHill', 'SandHill');
        }
        // Wooden Boxes
        else if (name === 'Kibako') {
            spawnModelFromNames('KibakoHang', 'KibakoHang');
        }
        // The Stones to use to go to Skywkeep
        else if (name === 'ToD3Stn') {
            spawnModelFromNames('BirdObjD3', 'BirdObjD3A');
        }
        // The lever in beetles shop
        else if (name === 'TerrSw') {
            spawnModelFromNames('TerrySwitch', 'TerrySwitchi');
        }
        // The trapdoor in Beetles shop
        else if (name === 'TerrHol') {
            spawnModelFromNames('TerryOtoshiana', 'TerryOtoshiana');
        }
        // The mechanism in beetles shop
        else if (name === 'TerrGmk') {
            const rres = getOArcRRES('TerryGimmick');
            rres.vis0 = []; // Hack as Vis0 seems broken
            spawnModel(rres, 'TerryGimmick');
        }
        // Beedles Shop
        else if (name === 'Tshop') {
            const rres = getOArcRRES('TerryShop');
            if (this.stageId === 'F020') // turns it off at night
                rres.chr0 = [];
            const m  = spawnModel(rres, 'TerryShop');
            spawnModel(rres, 'TerryBell');
            spawnModel(rres, 'TerryHaguruma_g');
        }
        else if (name === 'ShpSmpl') {
            const type = params1&0x7F;
            let m : MDL0ModelInstance | null;
            if (![9,10,11,12,13,14,15,16,17,18,19,28,29,30,31,32,33,34].includes(type)){
                let arcModelPair : string[] | null;
                let translateY = 37.0;
                switch(type) {
                    case 0: arcModelPair = ['GetArrow', 'GetArrowBundle']; translateY = 34; break;
                    case 1: arcModelPair = ['GetBombSet', 'GetBombSet']; translateY = 22; break;
                    case 2: arcModelPair = ['GetShieldWood', 'GetShieldWood']; translateY = 40; break;
                    case 3: arcModelPair = ['GetShieldIron', 'GetShieldIron']; translateY = 36; break;
                    case 4: arcModelPair = ['GetShieldHoly', 'GetShieldHoly']; translateY = 40; break;
                    case 5: arcModelPair = ['GetSeedSet', 'GetSeedSet']; translateY = 22; break;
                    case 6: arcModelPair = ['GetSpareSeedA', 'GetSpareSeedA']; translateY = 23; break;
                    case 7: arcModelPair = ['GetSpareQuiverA', 'GetSpareQuiverA']; translateY = 30; break;
                    case 8: arcModelPair = ['GetSpareBombBagA', 'GetSpareBombBagA']; translateY = 27; break;
                    case 20: arcModelPair = ['GetPouchB', 'GetPorchB']; break;
                    case 21: arcModelPair = ['GetPouchB', 'GetPorchB']; break;
                    case 22: arcModelPair = ['GetPouchB', 'GetPorchB']; break;
                    case 23: arcModelPair = ['GetHeartKakera', 'GetHeartKakera']; break;
                    case 24: arcModelPair = ['GetSparePurse', 'GetSparePurse']; break;
                    case 25: arcModelPair = ['GetNetA', 'GetNetA']; break;
                    case 26: arcModelPair = ['GetMedal', 'GetMedalLife']; break;
                    case 27: arcModelPair = ['GetMedal', 'GetMedalReturn']; break;
                }
                const m = spawnModelFromNames(arcModelPair![0], arcModelPair![1]);
                translateModel(m, [0, translateY, 0]);
                scaleModelConstant(m, 1.7);
            }
        }
        // Npc Salesman -> subtypes per
        else if (name === 'NpcSalS'){
            const type = params1 &  0xF;
            // Rupin (main shop)
            if (type === 1){
                const rres = getOArcRRES('Douguya');
                const m = spawnModel(rres, 'Douguya');
                // spawnModel(rres, 'Douguya_chair');
                const chr = mergeCHR0(rres, 'Douguya_talkwait', 'Douguya_F_normal');
                m.bindCHR0(this.animationController, chr);
            }
            // Potion Lady
            else if (type === 2){
                const rres = getOArcRRES('MedicineWife');
                const m = spawnModel(rres, 'MedicineWife');
                const chr = mergeCHR0(rres, 'MedicineWife_wait', 'MedicineWife_F_wait');
                m.bindCHR0(this.animationController, chr);
            }
            // Gondo Scrap Shop
            else if (type === 4){
                const rres = getOArcRRES('Junk');
                const m = spawnModel(rres, 'Junk');
                const driver = spawnModel(rres, 'JunkDriver');
                const chair = spawnModel(rres, 'Junk_chair');
                const chr = mergeCHR0(rres, 'Junk_wait', 'Junk_F_wait');
                m.bindCHR0(this.animationController, chr);
                this.modelBinds.push(
                    {model: driver, modelToBindTo: m, nodeName: "HandR"}
                );
            }
            // Peatrice
            else if (type === 5){
                const rres = getOArcRRES('Azukariya');
                const m = spawnModel(rres, 'Azukariya');
                const chr = mergeCHR0(rres, 'Azukariya_wait', 'Azukariya_F_wait');
                spawnModel(rres, 'Azukariya_chair');
                m.bindCHR0(this.animationController, chr);
            }
            // Potion Husband w/Baby
            else if (type === 8){
                const rres = getOArcRRES('MedicineHusband');
                const m = spawnModel(rres, 'MedicineHusband');
                const chr = mergeCHR0(rres, 'MedicineHusband_wait', 'MedicineHusband_F_wait');
                m.bindCHR0(this.animationController, chr);
            }
        }
        // Fire TODO -> put fire effect in when JPA is implemented
        else if (name === 'Fire') {
            const type = params1 & 0xF;
            if (type !== 1){
                const arcName = 'Candle0'+['0','0','1','2'][type];
                const modelName = 'Candle'+['','','01','02'][type];
                spawnModelFromNames(arcName, modelName);
            }
            console.info('Revist Fire Later');
        }
        // Gondos Repair object, theres also a B variant
        else if (name === 'JunkRep') {
            spawnModelFromNames('Junk', 'JunkRepairobject');
        }
        // Chef NPC in bazaar
        else if (name === 'NpcChef'){
            const rres = getOArcRRES('Chef');
            const chr = mergeCHR0(rres, 'Chef_wait', 'Chef_F_wait');
            spawnModel(rres, 'ChefPot');
            const m = spawnModel(rres, 'Chef');
            m.bindCHR0(this.animationController, chr);
            m.bindSRT0(this.animationController, findSRT0(rres, 'Chef_wait'));
        }
        // Place for stone tablets in goddess statue
        else if (name === 'SndStn') {
            const rres = getOArcRRES('LithographyStand');
            const stand = spawnModel(rres, 'LithographyStand');
            const emerald = spawnModel(rres, 'SekibanMapADemo');
            const ruby = spawnModel(rres, 'SekibanMapBDemo');
            const amber = spawnModel(rres, 'SekibanMapCDemo');
            const crest = spawnOArcModel('GoddessSymbolSc');
            const node = this.findNode(stand, 'SetGS')!;
            mat4.translate(node.modelMatrix, node.modelMatrix, [0, 90, 0]);
            this.modelBinds.push({model: emerald, modelToBindTo: stand, nodeName: "locator_A"});
            this.modelBinds.push({model:    ruby, modelToBindTo: stand, nodeName: "locator_B"});
            this.modelBinds.push({model:   amber, modelToBindTo: stand, nodeName: "locator_C"});
            this.modelBinds.push({model:   crest, modelToBindTo: stand, nodeName: "SetGS"});
        }
        // Batreaux Human
        else if (name === 'NpcAkuH') {
            const m = spawnOArcModel('DevilB');
            const chr = mergeCHR0(getOArcRRES('Devil'), 'Devil_wait', 'Devil_F_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // bigger dude chilling in bazaar... Called SoManD what other way to describe
        else if (name === 'NpcSMnD') {
            const rres = getOArcRRES('SoManD');
            const m = spawnOArcModel('SoManD');
            const chr = mergeCHR0(rres, 'SoManD_wait', 'SoManD_F_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // Other older dude sitting in bazaar
        else if (name === 'NpcSMnE') {
            const rres = getOArcRRES('SoManE');
            const m = spawnOArcModel('SoManE');
            const chr = mergeCHR0(rres, 'SoManE_wait', 'SoManE_F_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // Broken Robot in bazaar
        else if (name === 'NpcSlRp') {
            spawnOArcModel('DesertRobotN');
        }
        // Keese
        else if (name === 'EKs') {
            const type = params1&0x7;
            const arcName = ['Kiesu','Kiesu_fire','Kiesu_electric','KiesuDevil'][type];
            const mdlName = ['kiesu','F_kiesu','EKiesu','DKiesu'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            m.bindPAT0(this.animationController, findPAT0(getOArcRRES(arcName), 'blink_1'));
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Kiesu_anime'), 'fly'));
            translateModel(m, [0,-30,0]);
        }
        // Sword Pedestal
        else if (name === 'SwrdSt') {
            spawnOArcModel(['SwordSeal','SwordGrd'][params1&1]);
        }
        // Goddess Crest (Switch Sword Beam)
        else if (name === 'SwSB') {
            const m = spawnOArcModel('GoddessSymbolSc');
            translateModel(m, [0,90,0]);
        }
        // Chandelier
        else if (name === 'Chandel') {
            spawnModelFromNames('Stage', 'StageF011rChanAft');
        }
        // Pumpkin Master (Pumm)
        else if (name === 'NpcPma') {
            const rres = getOArcRRES('PumpkinMaster');
            const m = spawnModel(rres, 'PumpkinMaster');
            const chr = mergeCHR0(rres, 'PumpkinMaster_wait', 'PumpkinMaster_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'PumpkinMaster');
            m.bindCHR0(this.animationController, chr);
        }
        // Random Npcs
        else if (name === 'NpcSma2') {
            console.log(this.currentLayer);
            const m = spawnOArcModel('SoManB');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManB_sit'),'SoManB_sit_wait'));
        }
        else if (name === 'NpcSma3') {
            console.log(this.currentLayer);
            const m = spawnOArcModel('SoManC');
            if (this.stageId !== 'F000')
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_sit'),'SoManC_sit_wait'));
            else
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_stand'),'SoManC_stand_wait'));
        }
        // Little Girl
        else if (name === 'NpcSoG') {
            const rres = getOArcRRES('SoGirl');
            const m = spawnOArcModel('SoGirl');
            const chr = mergeCHR0(rres, 'SoGirl_wait', 'SoGirl_F_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // Eye Dude
        else if (name === 'NpcSha') {
            const rres = getOArcRRES('Uranaiya');
            const m = spawnOArcModel('Uranaiya');
            const chr = mergeCHR0(rres, 'Uranaiya_wait', 'Uranaiya_F_wait');
            const pat = findPAT0(rres, 'Uranaiya');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
        }
        // Crystal Ball
        else if (name === 'DivCrst') { // This will need to be moved later
            const m = spawnOArcModel('F004rCrystalWell');
        }
        // Pipets mom
        else if (name === 'NpcSAMo') {
            const rres = getOArcRRES('SenpaiAMother');
            const m = spawnOArcModel('SenpaiAMother');
            const chr = mergeCHR0(rres, 'SenpaiAMother_wait', 'SenpaiAMother_F_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // Dust Piles
        else if (name === 'VacuDst') {
            spawnModelFromNames('Stage', 'VacuumDust')
        }
        // Dust Piles
        else if (name === 'VacuDsP') {
            const type = params1&0xF;
            spawnModelFromNames('Stage', 'StageVacDusParts'+['A','B','C','D','E'][type]);
        }
        // Pink Key Parella
        else if (name === 'NpcSui') {
            const m = spawnOArcModel('SuiseiBoss');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
        }
        // Parallela
        else if (name === 'NpcSuiS' || name === 'NpcSuiN') {
            const m = spawnOArcModel('Suisei');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
        }
        // Water nuts
        else if (name === 'WatrIga'){
            spawnOArcModel('NeedleBallWater');
        }
        // Whip Swing things
        else if (name === 'TPole'){
            spawnOArcModel('WhipBar');
        }
        // The horizontal spin switches for the whip
        else if (name === 'BulbSW'){
            spawnOArcModel('SwitchValve');
        }
        // Vertixal whip levers
        else if (name === 'sw_whip'){
            spawnOArcModel('SwitchWhip');
        }
        // StalMaster (jannon :D )
        else if (name === 'ESf4') {
            const rres = getOArcRRES('Sf4');
            const m = spawnModel(rres, 'Stalfos4');
            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
            scaleModelConstant(m, 1.3);
        }
        // Direction Switches
        else if (name === 'SwDir2') {
            const m = spawnOArcModel('SwitchDirect');
            rotateModel(m, [Math.PI/2, 0,0]);
            translateModel(m, [0,150,-100]);
        }
        // Wall Switches (the bar where you can usually run up the wall)
        else if (name === 'SwWall') {
            spawnOArcModel('SwitchWall');
        }
        // Cursed Bokos
        else if (name === 'EBcZ') {
            const rres = getOArcRRES('Bocoburin_Z');
            const m = spawnModel(rres, 'bocoburin_Z');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait0'));
        }
        // Tower Hands
        else if (name === 'TowerHa') {
            const m = spawnOArcModel('TowerHandD101');
            if (params1&1)
                rotateModel(m, [0, Math.PI, 0]);
        }
        // Tower Gears
        else if (name === 'TGrD101') {
            spawnOArcModel('TowerGearD101');
        }
        // Furnix
        else if (name === 'EHidory') {
            const rres = getOArcRRES('Hidory');
            const m = spawnModel(rres, 'Hidory');
            m.bindCHR0(this.animationController, findCHR0(rres, 'hovering'));
        }
        // Staltula
        else if (name === 'Est') {
            const rres = getOArcRRES('Staltula');
            const m = spawnModel(rres, 'Stalchula');
            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
        }
        // Waterfalls in Ancient Cistern
        else if (name === 'wfall') {
            const type = (params1 >>> 28) & 0xF
            if (type !== 0){
                const rres = getOArcRRES('WaterfallD101');
                spawnModel(rres, 'WaterfallD101'+['A','B','C'][type-1]);
            }
        }
        // Rope Maybe
        else if (name === 'SpiderL') {
            console.info('Revisit SpiderL');
        }
        // Fruit
        else if (name === 'fruit') {
            spawnOArcModel('FruitA');
        }
        // Sunlight beams in Faron
        else if (name === 'Light00') {
            spawnOArcModel('Light00');
        }
        else if (name === 'Bubble') {
            const rres = getOArcRRES('BubbleHole');
            console.info('Revisit Bubble');
        }
        // End Boss Doors to Springs
        else if (name === 'SldDoor') {
            const rres = getOArcRRES('SB'+['Din','Ferore','Nayru','Goodess'][params1&0xF]);
            const m = spawnModel(rres, 'ShutterBoss');
            const animRres = getOArcRRES('SBAnm');
            m.bindCLR0(this.animationController, findCLR0(animRres, 'ShutterBossSealWink'));
        }
        // Skulls that can spawn drops
        else if (name === 'skull') {
            spawnModelFromNames('Skull', 'BocoBone02');
        }
        // Lotus Flowers
        else if (name === 'LtsFlwr') {
            const type = params1&1;
            const arc = ['LotusFlower','LotusSeed'][type];
            const mdl = ['LotusFlower', 'LotusSeedCut'][type];
            spawnModelFromNames(arc, mdl);
        }
        // Water Logs
        else if (name === 'LogWtr') {
            const type = params1 & 1;
            const m = spawnOArcModel(['LogFloat','LogStep'][type]);
            if (type === 1)
                translateModel(m, [0,500,0]);
        }
        // Cistern Boss Door
        else if (name === 'BDrD101') {
            spawnOArcModel('DoorBossD101');
            const m = spawnOArcModel('DoorBossD101');
            rotateModel(m, [Math.PI, 0, Math.PI]);
        }
        // Cistern Tower
        else if (name === 'ftower') {
            spawnOArcModel('TowerD101');
        }
        // Crystal Switches
        else if (name === 'Swhit') {
            const rres = getOArcRRES('SwitchHit');
            spawnModel(rres, 'SwitchHitBase');
            const m = spawnModel(rres, 'SwitchHit');
            m.bindSRT0(this.animationController, findSRT0(rres, 'SwitchHit_kirari'));
        }
        // Wooden Boards to break
        else if (name === 'WdBoard') {
            spawnModelFromNames('BreakBoard', 'BreakBoardA');
            spawnModelFromNames('BreakBoard', 'BreakBoardB');
        }
        // Water Surface
        else if (name === 'WaterSf'){
            const type = (params1 >>> 16) & 0xF;
            const rres = 'Water'+['D100_r02','D100_r03','D100_r04','D100_r06','F103','F100_b','F104A','F104B','F104C','F104D'][type];
            const m  = spawnModelFromNames(rres, 'model0');
            const m1 = spawnModelFromNames(rres, 'model1');
            if (this.stageId === 'D100'){
                translateModel(m , [0,500,0]);
                translateModel(m1, [0,500,0]);
            }
        }
        // Small Goddess Statues
        else if (name === 'SngGS') {
            const statue = spawnOArcModel('GoddessStatue');
            const crest = spawnOArcModel('GoddessSymbolSc');
            const node = this.findNode(statue, 'SetGS')!;
            mat4.translate(node.modelMatrix, node.modelMatrix, [0, 90, 0]);
            this.modelBinds.push({model: crest, modelToBindTo: statue, nodeName: 'SetGS'});
        }
        // Ancient Jwls (Treasure)
        else if (name === 'AncJwls'){
            const type = params1 & 0xF;
            const arcName = 'GetSozai'+['H','G','P'][type];
            const m = spawnOArcModel(arcName);
            const scale = [2,2,1.365][type];
            scaleModelConstant(m, scale);
        }
        // Rope for blocks in air
        else if (name === 'BlkRope'){
            console.info('Revisit BlkRope');
        }
        // Iron Fences
        else if (name === 'FenceIr') {
            const type = (params1>>>16)&1;
            spawnOArcModel('FenceIron'+['','Small'][type]);
        }
        // Octarock
        else if (name === 'EOr') {
            const rres = getOArcRRES('Or');
            spawnModel(rres, 'octarock_hole');
            const m = spawnModel(rres, 'octarock');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait'));
        }
        // Dungeon Doors Entrances
        else if (name === 'DoorDun') {
            const type = params1 & 0xF;
            const arcName = ['Entrance1B', 'DoorGate', 'Entrance1A', 'DoorWater'][type];
            const mdlName = ['Entrance1B', 'DoorGate_Open', 'Entrance1A', 'DoorWater'][type];
            const chrName = ['LockOpen', 'OpenDoor', 'OpenDoor', 'OpenDoor'][type]
            const rres = getOArcRRES(arcName);
            const m = spawnModel(rres, mdlName);
            m.bindCHR0(this.animationController, findCHR0(rres, chrName));
        }
        // Carryable Stones
        else if (name === 'CyStone') {
            const type = params1 & 0xF;
            const arcName = ['RockCarrySmall','RockCarryMiddle','RockCarryMiddle','Syako_egg'][type];
            const mdlName = ['RockSmall','RockMiddle','RockMiddle','SyakoEgg'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            if (type === 1 || type === 2)
                translateModel(m, [0,75,0]);
        }
        // Little spikey balls
        else if (name === 'RopeIga'){
            const m = spawnOArcModel('NeedleBall');
            translateModel(m, [0,15,0]);
        }
        // Froaks
        else if (name === 'EGeko'){
            const rres = getOArcRRES('Geko');
            const m = spawnModel(rres, 'Geko');
            const chr = findCHR0(rres,'run');
            const pat = findPAT0(rres, 'GekoWink');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
        }
        // Deku Baba
        else if (name === 'Ehb') {
            const type = (params1 >> 3) & 0x3;
            const rres = getOArcRRES('Degubaba');
            const m0 = spawnModel(rres, 'degubaba_leaf');
            const newAnim = staticFrame([0, 0, 1, 1][type]);
            const m = spawnModel(rres, 'degubaba_head');
            m0.bindPAT0(newAnim, findPAT0(rres, 'degubaba_leaf'));
            m.bindPAT0(newAnim, findPAT0(rres, 'degubaba_head'));
            rotateModel(m0, [-Math.PI/2, 0, 0]);
            m0.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
            rotateModel(m, [-Math.PI/2, 0, 0]);
            m.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
        }
        // The Wall of water to keep you in bounds in Flooded Faron
        // Water Shield
        else if (name === 'WtrShld'){
            spawnOArcModel('WaterWallF103');
            console.info('Look Into WtrShld rendering (cuts off on angles)');
        }
        // Various Kikwis
        // Bucha
        else if (name === 'NpcKyuE') {
            const rres = getOArcRRES('ForestManOld');
            const m = spawnModel(rres, 'ForestManOld');
            const chr = findCHR0(rres, 'ForestManOld_wait');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeafOld_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: m, nodeName: "Tail"});
            m.bindCHR0(this.animationController, chr);
        }
        // Machi
        else if (name === 'Npckyu1') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeA');
            const hair = spawnModel(rres, 'ForestManHairA');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: body, nodeName: "Tail"});
            const chr = findCHR0(rres, 'ForestMan_wait');
            body.bindCHR0(this.animationController, chr);
            this.modelBinds.push({model: eyes, modelToBindTo: body, nodeName: "Head"});
            this.modelBinds.push({model: hair, modelToBindTo: body, nodeName: "Hair"});
        }
        // Yerbal
        else if (name === 'NpcKyuW') {
            const rres = getOArcRRES('ForestManWiz');
            const m = spawnModel(rres, 'ForestManWiz');
            const chr = findCHR0(rres, 'ForestManWiz_wait');
            m.bindCHR0(this.animationController, chr);
        }
        // Oolo
        else if (name === 'NpcOKyu') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeC');
            const hair = spawnModel(rres, 'ForestManHairC');
            const chr = findCHR0(rres, 'ForestMan_wait');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: body, nodeName: "Tail"});
            body.bindCHR0(this.animationController, chr);
            this.modelBinds.push({model: eyes, modelToBindTo: body, nodeName: "Head"});
            this.modelBinds.push({model: hair, modelToBindTo: body, nodeName: "Hair"});
        }
        // Lopsa
        else if (name === 'Npckyu3') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeB');
            const hair = spawnModel(rres, 'ForestManHairB');
            const chr = findCHR0(rres, 'ForestMan_wait');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: body, nodeName: "Tail"});
            body.bindCHR0(this.animationController, chr);
            this.modelBinds.push({model: eyes, modelToBindTo: body, nodeName: "Head"});
            this.modelBinds.push({model: hair, modelToBindTo: body, nodeName: "Hair"});
        }
        // Erla
        else if (name === 'Npckyu4') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeD');
            const chr = findCHR0(rres, 'ForestMan_wait');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: body, nodeName: "Tail"});
            body.bindCHR0(this.animationController, chr);
            this.modelBinds.push({model: eyes, modelToBindTo: body, nodeName: "Head"});
            // this.modelBinds.push({model: hair, modelToBindTo: body, nodeName: "Hair"});
            // console.log('Fix Npckyu4 Anim');
            if (this.stageId === 'F103'){
                translateModel(body, [0,58,0]);
            }
        }
        // Eldin Volcano Eruption Smoke
        else if (name === 'Smoke') {
            const type = params1&0x3;
            spawnOArcModel(['SmokeF200', 'SmokeF202'][type]);
        }
        // Raise And Lowerable floors (magma rocks?)
        else if (name === 'SnkFlrF') {
            const type = params1 & 0xF;
            const arcName = (type !== 3) ? 'SinkRock' : 'FWRockA';
            const mdlName = ['SinkRockC', 'SinkRockB', 'SinkRockA', 'FWRockA'][type];
            spawnModelFromNames(arcName, mdlName);
        }
        // Eldin Wooden Towers
        else if (name === 'TowerB') {
            const type = (params1 >>> 16) & 0xF;
            const arcName = ['TowerBomb', 'TowerLight'][type];
            const mdlName = ['TowerBomb01', 'TowerLight'][type];
            const rres = getOArcRRES(arcName);
            spawnModel(rres, 'TowerBomb00'); // Little Legs
            const  m = spawnModel(rres, mdlName); // Main Tower
            const chr = findCHR0(rres, 'Falldown');
            if ((params1&0xFF) === 0xFF)
                m.bindCHR0(this.animationController, chr);
            if (type === 1){
                const m2 = spawnModel(rres, 'FX_TowerLight');
                m2.bindCLR0(this.animationController, findCLR0(rres, 'FX_TowerLight'));
            }
        }
        // Propeller
        else if (name === 'Propera') {
            const m = spawnOArcModel('Pinwheel');
            rotateModel(m, [-Math.PI/2, 0, 0]);
        }
        // Pyrup Shells
        else if (name === 'EHidoS') {
            const type = ((params1&0xF) !== 0x0) ? 'BoneA' : 'BoneB';
            spawnModelFromNames('HidokariS', type);

        }
        // Boulders
        else if (name === 'RolRock') {
            const decideType = (params1 >>> 12) & 0xF;
            let type = decideType;
            if (decideType === 0xb) type = 6;
            if ([9,10].includes(type)) type = 4;
            if ([0,4].includes(type)) spawnOArcModel('RockRollA');
            else spawnOArcModel('RockRollB');
        }
        // Bone Bridges
        else if (name === 'BrgBn') {
            spawnOArcModel('BoneBridge');
        }
        // Extendable Bridges
        else if (name === 'BridgeB') {
            const m = spawnOArcModel('BridgeSwitch');
            translateModel(m, [0, 0, 800]);
        }
        // Floor Switches
        else if (name === 'Sw') {
            const type = params1&0xF;
            const arcName = 'SwitchStep'+['A','B','B'][type];
            const m = spawnOArcModel(arcName);
            scaleModel(m, [1 ,0.8, 1]);
        }
        // Fences in Eldin
        else if (name === 'FenceBk') {
            spawnOArcModel('FenceBoko');
        }
        // Mogmas
        else if (name === 'NpcMoN') {
            const type = ((params1&0xF) > 6) ? 0 : params1&0xF;
            let val = 2;
            if (type === 0 || type === 4 || type === 6) val = 0;
            else if (type === 1 || type === 3) val = 1;
            const rres = getOArcRRES('Moguma');
            const m = spawnModel(rres, 'Moguma');
            const chr = mergeCHR0(rres, 'Moguma_wait', 'Moguma_F_wait');
            m.bindCHR0(this.animationController, chr);
            const hair = spawnModel(rres, 'Moguma_hair'+['A','B','C','D','E','F','G'][type]);
            this.modelBinds.push({model: hair, modelToBindTo: m, nodeName: 'Head'});
        }
        // Mogmas
        else if (name === 'NpcMoT2') {
            const rres = getOArcRRES('MogumaDungeonB');
            const m = spawnModel(rres, 'MogumaDungeonB');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translateModel(m, [0,-75,0]);
        }
        else if (name === 'NpcMoT') {
            const rres = getOArcRRES('MogumaDungeonA');
            const m = spawnModel(rres, 'MogumaDungeonA');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translateModel(m, [0,-75,0]);
        }
        // Old Mogma
        else if (name === 'NpcMoEl') {
            const rres = getOArcRRES('MogumaOld');
            const m = spawnModel(rres, 'MogumaOld');
            // const chr = mergeCHR0(getOArcRRES('Moguma'), 'Moguma_wait', 'Moguma_F_wait');
            // m.bindCHR0(this.animationController, chr);
            translateModel(m, [0,-75,0]);
        }
        else if (name === 'EHidoK') {
            const rres = getOArcRRES('Hidokari');
            const m = spawnModel(rres, 'Hidokari');
            m.bindRRESAnimations(this.animationController, rres, 'WaitA');
        }
        // Beedle
        else if (name === 'NpcTer') {
            // on skyloft nighat layer
            const rres = getOArcRRES('Terry');
            const m = spawnModel(rres, 'Terry');
            if (params1&1){
                const chr = mergeCHR0(rres, 'Terry_waitA', 'Terry_F_default');
                m.bindCHR0(this.animationController, chr);
                spawnModel(rres, 'Terry_Log');
            }
            // In Shop
            else {
                const chr = mergeCHR0(rres, 'Terry_cycleC', 'Terry_F_default');
                m.bindCHR0(this.animationController, chr);
                const m2 = spawnModel(rres, 'TerryBicycle');
                m2.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));

            }

        }
        // Beedles Bike
        else if (name === 'TerBike') {
            const rres = getOArcRRES('Terry');
            const m2 = spawnModel(rres, 'TerryBicycle');
            // m2.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));
        }
        // Goddess Statue
        else if (name === "IslMegm") {
            const rres = getOArcRRES(['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m = spawnModel(rres, ['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m2 = spawnModel(rres, ['F000Megami_s', 'F000LastDungeon_s'][params1 & 0x3]);
        }
        // Mushrooms
        else if (name === 'KinokoA') { spawnOArcModel('MushroomA'); }
        else if (name === 'KinokoB') { spawnOArcModel('MushroomB'); }
        else if (name === 'KinokoC') { spawnOArcModel('MushroomC'); }
        else if (name === 'KinokoD') { spawnOArcModel('MushroomD'); }
        // Various Chairs
        else if (name === 'CharA') { spawnOArcModel(name); }
        else if (name === 'CharB') { spawnOArcModel(name); }
        else if (name === 'CharC') { spawnOArcModel(name); }
        // Various Plants
        else if (name === 'PltA00' ) { spawnOArcModel(name); }
        else if (name === 'PltA01' ) { spawnOArcModel(name); }
        else if (name === 'PltA02' ) { spawnOArcModel(name); }
        else if (name === 'PltB00' ) { spawnOArcModel(name); }
        else if (name === 'PltB01' ) { spawnOArcModel(name); }
        else if (name === 'PltB02' ) { spawnOArcModel(name); }
        else if (name === 'PlntB'  ) { spawnOArcModel(name); }
        else if (name === 'PlntA01') { spawnOArcModel(name); }
        else if (name === 'PlntA00') { spawnOArcModel(name); }
        else if (name === 'PlntC01') { spawnOArcModel(name); }
        else if (name === 'PlntC00') { spawnOArcModel(name); }
        // Various Cups
        else if (name === 'CupA00')  { spawnOArcModel(name); }
        else if (name === 'CupA01')  { spawnOArcModel(name); }
        else if (name === 'CupA02')  { spawnOArcModel(name); }
        else if (name === 'CupB00')  { spawnOArcModel(name); }
        else if (name === 'CupB01')  { spawnOArcModel(name); }
        else if (name === 'CupB02')  { spawnOArcModel(name); }
        // Flower Vases?
        else if (name === 'FlvsA' )  { spawnOArcModel(name); }
        else if (name === 'FlvsB' )  { spawnOArcModel(name); }
        else if (name === 'FlvsC' )  { spawnOArcModel(name); }
        // Various Lamps
        else if (name === 'RoLight') { spawnOArcModel('F004rRotationLight'); }
        else if (name === 'LampA' )  { spawnOArcModel(name); }
        else if (name === 'LampB' )  { spawnOArcModel(name); }
        else if (name === 'LampC' )  { spawnOArcModel(name); }
        else if (name === 'LampD' )  { spawnOArcModel(name); }
        else if (name === 'LampE' )  { spawnModelFromNames(name, name+'Glass'); spawnModelFromNames(name, name+'Hook'); }
        else if (name === 'LampF' )  { spawnModelFromNames(name, name+'Glass'); spawnModelFromNames(name, name+'Hook'); }
        // Various Decorations
        else if (name === 'DecoA' )  { spawnOArcModel(name); }
        else if (name === 'DecoB' )  { spawnOArcModel(name); }
        // No models
        else if (!NO_MODEL_LIST.includes(name)) {

            console.warn("Unknown object" , name, "Layer:", this.currentLayer);
        }
    }

    // TODO(Zeldex) : Move the matrix (scaling, rotation, translation) operations to spawn object
    //              Reason: The game sometimes opts to ignore them and will reuse the fields for parameters
    private spawnLayout(device: GfxDevice, layout: RoomLayout): void {
        const q = quat.create();

        const modelMatrix = mat4.create();

        for (let i = 0; i < layout.obj.length; i++) {
            const obj = layout.obj[i];

            // Set model matrix.
            let rotationX : number = 0;
            let rotationY : number = 180 * (obj.rotY / 0x7FFF);
            let rotationZ : number = 0;
            if (obj.name === 'Door'){
                rotationY = (rotationY+180) % 360;
            }
            if (['GodCube', 'Kinoko', 'Item',].includes(obj.name)) {
                rotationZ = 180 * (obj.rotZ / 0x7FFF);
            } else if (['sw_whip'].includes(obj.name)) {
                rotationZ = -180 * (obj.rotZ / 0x7FFF);
            }
            if (['ClawSTg', 'GodCube', 'Kinoko', 'Item', ].includes(obj.name)) {
                rotationX = 180 * (obj.rotX / 0x7FFF);
            }
            quat.fromEuler(q, rotationX, rotationY, rotationZ);
            mat4.fromRotationTranslation(modelMatrix, q, [obj.tx, obj.ty, obj.tz]);

            this.spawnObj(device, obj, modelMatrix);
        }

        // Scalable objects...
        for (let i = 0; i < layout.sobj.length; i++) {
            const obj = layout.sobj[i];

            mat4.fromRotationTranslationScale(modelMatrix, q, [obj.tx, obj.ty, obj.tz], [obj.sx, obj.sy, obj.sz]);

            let scaleX = obj.sx;
            let scaleY = obj.sy;
            let scaleZ = obj.sz;
            let rotationX = 180 * (obj.rotX / 0x7FFF);
            let rotationZ = 0;
            let rotationY = 180 * (obj.rotY / 0x7FFF);
            if (!['BlsRock', ].includes(obj.name)){
                rotationX = 0;
            }

            if(['ESm'].includes(obj.name)){
                let rotationZ = 0;
                if (scaleX === 4) {
                    scaleX = 1.2;
                    scaleY = 1.2;
                    scaleZ = 1.2;
                } else if (scaleX === 3) {
                    scaleX = 0.25;
                    scaleY = 0.25;
                    scaleZ = 0.25;
                } else if (scaleX === 2) {
                    scaleX = 0.4;
                    scaleY = 0.4;
                    scaleZ = 0.4;
                } else if (scaleX === 1) {
                    scaleX = 0.8;
                    scaleY = 0.8;
                    scaleZ = 0.8;
                }
                rotationZ = 180;
            }


            if (obj.name === "Bamboo")
            {
                scaleZ = scaleZ * 100.0 * 0.186915;
                scaleX = scaleZ;
                scaleY = scaleZ;
                rotationZ = 0;
                rotationY = 0;
            }
            quat.fromEuler(q, rotationX, rotationY, rotationZ);

            mat4.fromRotationTranslationScale(modelMatrix, q, [obj.tx, obj.ty, obj.tz], [scaleX, scaleY, scaleZ]);

            this.spawnObj(device, obj, modelMatrix);
        }
    }

    private parseBZS(buffer: ArrayBufferSlice): BZS {
        interface Chunk {
            name: string;
            count: number;
            offs: number;
            isParsed: boolean;
        }

        const view = buffer.createDataView();
        function parseChunkTable(tableOffs: number, count: number): Chunk[] {
            const chunks: Chunk[] = [];
            let tableIdx = tableOffs;
            for (let i = 0; i < count; i++) {
                const name = readString(buffer, tableIdx + 0x00, 0x04, false);
                const count = view.getUint16(tableIdx + 0x04);
                // pad
                // offs is relative to this entry.
                const offs = tableIdx + view.getUint32(tableIdx + 0x08);
                chunks.push({ name, count, offs , isParsed:false });
                tableIdx += 0x0C;
            }
            return chunks;
        }

        // Header.
        const headerChunkTable = parseChunkTable(0x00, 0x01);
        assert(headerChunkTable.length === 1);

        const v001 = headerChunkTable[0];
        assert(v001.name === 'V001' && v001.offs === 0x0C);

        const roomChunkTable = parseChunkTable(v001.offs, v001.count);

        function parseObj(offs: number): Obj {
            const unk1 = view.getUint32(offs + 0x00);
            const unk2 = view.getUint32(offs + 0x04);
            const tx = view.getFloat32(offs + 0x08);
            const ty = view.getFloat32(offs + 0x0C);
            const tz = view.getFloat32(offs + 0x10);
            const rotX = view.getInt16(offs + 0x14);
            const rotY = view.getInt16(offs + 0x16);
            const rotZ = view.getInt16(offs + 0x18);
            const unk5 = view.getUint8(offs + 0x1A);
            const unk6 = view.getUint8(offs + 0x1B);
            const name = readString(buffer, offs + 0x1C, 0x08, true);
            return { unk1, unk2, tx, ty, tz, rotX, rotY, rotZ, unk5, unk6, name };
        }

        function parseSobj(offs: number): Sobj {
            const unk1 = view.getUint32(offs + 0x00);
            const unk2 = view.getUint32(offs + 0x04);
            const tx = view.getFloat32(offs + 0x08);
            const ty = view.getFloat32(offs + 0x0C);
            const tz = view.getFloat32(offs + 0x10);
            const sx = view.getFloat32(offs + 0x14);
            const sy = view.getFloat32(offs + 0x18);
            const sz = view.getFloat32(offs + 0x1C);
            const rotX = view.getInt16(offs + 0x20);
            const rotY = view.getUint16(offs + 0x22);
            const rotZ = view.getUint16(offs + 0x22);
            const unk5 = view.getUint8(offs + 0x26);
            const unk6 = view.getUint8(offs + 0x27);
            const name = readString(buffer, offs + 0x28, 0x08, true);
            return { unk1, unk2, tx, ty, tz, sx, sy, sz, rotX, rotY, rotZ, unk5, unk6, name };
        }

        const layoutsChunk = assertExists(roomChunkTable.find((chunk) => chunk.name === 'LAY '));

        // Parse layouts table.
        let areaType = 0;
        function parseObjects(chunkTable: Chunk[]): RoomLayout {
            // Look for STIF
            const stifChunk = chunkTable.find((chunk) => chunk.name === 'STIF');
            if (stifChunk)
                areaType = view.getInt8(stifChunk.offs + 0xe);

            // Look for objects table.
            const obj: Obj[] = [];
            const objChunk = chunkTable.find((chunk) => chunk.name === 'OBJ ');
            if (objChunk)
                for (let i = 0; i < objChunk.count; i++)
                    obj.push(parseObj(objChunk.offs + i * 0x24));

            const objsChunk = chunkTable.find((chunk) => chunk.name === 'OBJS');
            if (objsChunk)
                for (let i = 0; i < objsChunk.count; i++)
                    obj.push(parseObj(objsChunk.offs + i * 0x24));

            const doorChunk = chunkTable.find((chunk) => chunk.name === 'DOOR');
            if (doorChunk)
                for (let i = 0; i < doorChunk.count; i++)
                    obj.push(parseObj(doorChunk.offs + i * 0x24));

            // STAS, SNDT maybe?
            const sobj: Sobj[] = [];
            const sobjChunk = chunkTable.find((chunk) => chunk.name === 'SOBJ');
            if (sobjChunk)
                for (let i = 0; i < sobjChunk.count; i++)
                    sobj.push(parseSobj(sobjChunk.offs + i * 0x30));

            const stagChunk = chunkTable.find((chunk) => chunk.name === 'STAG');
            if (stagChunk)
                for (let i = 0; i < stagChunk.count; i++)
                    sobj.push(parseSobj(stagChunk.offs + i * 0x30));
            const sobsChunk = chunkTable.find((chunk) => chunk.name === 'SOBS');
            if (sobsChunk)
                for (let i = 0; i < sobsChunk.count; i++)
                    sobj.push(parseSobj(sobsChunk.offs + i * 0x30));

            return { obj, sobj };
        }
        const {obj, sobj} = parseObjects(roomChunkTable);

        // Parse layouts table.

        function parseLayout(index: number): RoomLayout {
            const layoutsTableIdx = layoutsChunk.offs + (index * 0x08);
            const layoutChunkTableCount = view.getUint16(layoutsTableIdx + 0x00);
            // pad
            const layoutChunkTableOffs = layoutsTableIdx + view.getUint32(layoutsTableIdx + 0x04);

            const layoutChunkTable = parseChunkTable(layoutChunkTableOffs, layoutChunkTableCount);

            return parseObjects(layoutChunkTable);
        }
        const layouts = [];
        for (let i = 0; i < 29; i++) {
            const layout = parseLayout(i);
            layouts.push({obj: obj.concat(layout.obj),sobj: sobj.concat(layout.sobj)});
        }
        return { layouts, areaType };
    }

}

class SkywardSwordSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public layersNums : number[]) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const basePath = `ZeldaSkywardSword`;
        const systemPath = `${basePath}/Object/System.arc`;
        const objPackPath = `${basePath}/Object/ObjectPack.arc.LZ`;
        const stage0Path = `${basePath}/Stage/${this.id}/${this.id}_stg_l0.arc.LZ`;
        const dataFetcher = context.dataFetcher;
        const temp = [dataFetcher.fetchData(systemPath), dataFetcher.fetchData(objPackPath), dataFetcher.fetchData(stage0Path)];
        for (let i = 1; i < this.layersNums.length; i++){
            temp.push(dataFetcher.fetchData(`${basePath}/Stage/${this.id}/${this.id}_stg_l${this.layersNums[i]}.arc.LZ`));
        };

        return Promise.all(temp).then((buffers: ArrayBufferSlice[]) => {
            const [systemBuffer, objPackBuffer, stageBuffer] = buffers;

            const systemArchive = U8.parse(systemBuffer);
            const objPackArchive = U8.parse(CX.decompress(objPackBuffer));
            const stageArchive = U8.parse(CX.decompress(stageBuffer));
            const layerArchives: U8.U8Archive[] = [];

            for (let i = 3; i < buffers.length; i++) {
                layerArchives.push(U8.parse(CX.decompress(buffers[i])));
            }

            return new SkywardSwordRenderer(device, this.id, systemArchive, objPackArchive, stageArchive, layerArchives, this.layersNums);
        });
    }
}

const id = "zss";
const name = "The Legend of Zelda: Skyward Sword";
// Courses organized by Starschulz (@Starschulz) and James Knight (@JKZMSF)
const sceneDescs = [
    "Skyloft",
    new SkywardSwordSceneDesc("F000", "Skyloft",[0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,17,18,19,20,21,26,27,28]),
    new SkywardSwordSceneDesc("F001r", "Knight's Academy", [0,1,2,3,4,13,14,15]),
    new SkywardSwordSceneDesc("F002r", "Beedle's Airshop",[0,1,2]),
    new SkywardSwordSceneDesc("F004r", "Bazaar", [0,1,3]),
    new SkywardSwordSceneDesc("F005r", "Orielle & Parrow’s House",[0,1,2]),
    new SkywardSwordSceneDesc("F006r", "Kukiel’s House", [0,1,2]),
    new SkywardSwordSceneDesc("F007r", "Piper’s House", [0,1,2]),
    new SkywardSwordSceneDesc("F008r", "Inside the Statue of the Goddess", [0,1,13,14,15,16]),
    new SkywardSwordSceneDesc("F009r", "Sparring Hall", [0]),
    new SkywardSwordSceneDesc("F010r", "Isle of Songs Tower", [0,13,14,15]),
    new SkywardSwordSceneDesc("F011r", "The Lumpy Pumpkin", [0,1,2,12]),
    new SkywardSwordSceneDesc("F012r", "Batreaux’s House", [0,1]),
    new SkywardSwordSceneDesc("F013r", "Fortune-teller Sparrot’s House", [0,1,2]),
    new SkywardSwordSceneDesc("F014r", "Potion Shop Owner Bertie’s House", [0,2]),
    new SkywardSwordSceneDesc("F015r", "Scrap Shop Owner Gondo’s House", [0,1,2]),
    new SkywardSwordSceneDesc("F016r", "Pipet’s House", [0]),
    new SkywardSwordSceneDesc("F017r", "Gear Peddler Rupin’s House", [0,2]),
    new SkywardSwordSceneDesc("F018r", "Item Check Girl Peatrice’s House", [0,1,2]),
    new SkywardSwordSceneDesc("F019r", "Bamboo Island", [0,1,2]),
    new SkywardSwordSceneDesc("F020", "The Sky", [0,1,2,3,4,6,13]),
    new SkywardSwordSceneDesc("S000", "Skyloft Silent Realm", [0,2]),
    new SkywardSwordSceneDesc("F021", "Cutscene Sky", [0,1,13]),
    new SkywardSwordSceneDesc("F023", "Inside the Thunderhead", [0,1,2,13,14]),
    new SkywardSwordSceneDesc("D000", "Waterfall Cave", [0,1]),

    "Faron Woods",
    new SkywardSwordSceneDesc("F100", "Faron Woods", [0,1,2,3,4,5]),
    new SkywardSwordSceneDesc("F100_1", "Inside the Great Tree", [0,1,2,3]),
    new SkywardSwordSceneDesc("F101", "Deep Woods", [0,1,2,3,4,5]),
    new SkywardSwordSceneDesc("D100", "Skyview Temple", [0,1,2,3,4]),
    new SkywardSwordSceneDesc("B100", "Skyview Temple (Boss)", [1,2,3,4,5,13]),
    new SkywardSwordSceneDesc("B100_1", "Skyview Spring", [0,3,4,13,14]),
    new SkywardSwordSceneDesc("F102", "Lake Floria", [0,1]),
    new SkywardSwordSceneDesc("F102_1", "Outside Ancient Cistern", [0,1,3]),
    new SkywardSwordSceneDesc("F102_2", "Faron's Lair", [0,1,3,4]),
    new SkywardSwordSceneDesc("S100", "Faron Silent Realm", [0,2]),
    new SkywardSwordSceneDesc("D101", "Ancient Cistern", [0,1]),
    new SkywardSwordSceneDesc("B101", "Ancient Cistern (Boss)", [0,1,2,3]),
    new SkywardSwordSceneDesc("B101_1", "Farore's Flame", [0,13]),
    new SkywardSwordSceneDesc("F103", "Faron Woods (Flooded)", [0,1,2,13]),
    new SkywardSwordSceneDesc("F103_1", "Inside the Great Tree (Flooded)", [0,1,2,13,14]),

    "Eldin Volcano",
    new SkywardSwordSceneDesc("F200", "Eldin Volcano", [0,1,2,3,4,13]),
    new SkywardSwordSceneDesc("F210", "Caves", [0,1,4]),
    new SkywardSwordSceneDesc("F211", "Thrill Digger", [0,1,2,3,4]),
    new SkywardSwordSceneDesc("F201_1", "Volcano Summit", [0,2,3,4]),
    new SkywardSwordSceneDesc("F201_4", "Volcano Summit - Waterfall", [0,3]),
    new SkywardSwordSceneDesc("D200", "Earth Temple", [0]),
    new SkywardSwordSceneDesc("B200", "Earth Temple (Boss)", [0,1,2,3,13]),
    new SkywardSwordSceneDesc("B210", "Earth Spring", [0,13,14]),
    new SkywardSwordSceneDesc("S200", "Eldin Silent Realm", [0,2]),
    new SkywardSwordSceneDesc("F201_3", "Fire Sanctuary Entrance", [0,3]),
    new SkywardSwordSceneDesc("D201", "Fire Sanctuary (A)", [0]),
    new SkywardSwordSceneDesc("D201_1", "Fire Sanctuary (B)", [0]),
    new SkywardSwordSceneDesc("B201", "Fire Sanctuary (Boss)", [0,1,2,3,13]),
    new SkywardSwordSceneDesc("B201_1", "Din's Flame", [0,13]),
    new SkywardSwordSceneDesc("F202", "Eldin Volcano (Bokoblin Base)", [0,1]),
    new SkywardSwordSceneDesc("F202_1", "Volcano F3 (Fire Dragon Dummy 1)", [0]),
    new SkywardSwordSceneDesc("F202_2", "Volcano F3 (Fire Dragon Dummy 2)", [0]),
    new SkywardSwordSceneDesc("F202_3", "Volcano F3 Completed (Fire Dragon Dummy 1)", [0]),
    new SkywardSwordSceneDesc("F202_4", "Volcano F3 Completed (Fire Dragon Dummy 2)", [0]),
    new SkywardSwordSceneDesc("F201_2", "Volcano Summit (Bokoblin Base)", [0]),
    new SkywardSwordSceneDesc("F221", "Fire Dragon Room", [0,2,13]),

    "Lanayru Desert",
    new SkywardSwordSceneDesc("F300_1", "Lanayru Mines", [0,1,2,3,4]),
    new SkywardSwordSceneDesc("F300", "Lanayru Desert", [0,1,2]),
    new SkywardSwordSceneDesc("F300_2", "Power Generator #1", [0]),
    new SkywardSwordSceneDesc("F300_3", "Power Generator #2", [0]),
    new SkywardSwordSceneDesc("D300", "Lanayru Mining Facility (A)", [0]),
    new SkywardSwordSceneDesc("D300_1", "Lanayru Mining Facility (B)", [0]),
    new SkywardSwordSceneDesc("B300", "Lanayru Mining Facility (Boss)", [0,1,3]),
    new SkywardSwordSceneDesc("F300_5", "Lanayru Mining Facility (Back)", [0]),
    new SkywardSwordSceneDesc("F300_4", "Temple of Time", [0,1,2,13,14]),
    new SkywardSwordSceneDesc("S300", "Lanayru Silent Realm", [0,2]),
    new SkywardSwordSceneDesc("F301", "Sand Sea Docks", [0]),
    new SkywardSwordSceneDesc("F301_1", "Sand Sea", [0,1,2,3,4,5]),
    new SkywardSwordSceneDesc("F301_6", "Shark Head", [0,2]),
    new SkywardSwordSceneDesc("F301_2", "Pirate Stronghold", [0,5]),
    new SkywardSwordSceneDesc("F301_3", "Skipper's Retreat", [0,1,2]),
    new SkywardSwordSceneDesc("F301_5", "Skipper's Retreat Shack", [0]),
    new SkywardSwordSceneDesc("F301_4", "Shipyard", [0,1,2,3,5]),
    new SkywardSwordSceneDesc("F301_7", "Shipyard Construction Bay", [0,1]),
    new SkywardSwordSceneDesc("D301", "Sandship (A)", [0,1,2,3,4,9,10,11,12]),
    new SkywardSwordSceneDesc("D301_1", "Sandship (B)", [0]),
    new SkywardSwordSceneDesc("B301", "Sandship (Boss)", [0,1,2,13]),
    new SkywardSwordSceneDesc("F302", "Lanayru Gorge", [0,1,2,13]),
    new SkywardSwordSceneDesc("F303", "Lanayru Caves", [0,1,2,3,4]),

    "Sky Keep",
    new SkywardSwordSceneDesc("D003_0", "Bokoblin Gaunlet", [0,1,5]),
    new SkywardSwordSceneDesc("D003_1", "Bomb Flower Puzzle", [0]),
    new SkywardSwordSceneDesc("D003_2", "Lava River", [0,1,5]),
    new SkywardSwordSceneDesc("D003_3", "Timeshift Puzzle - Caves", [0,5]),
    new SkywardSwordSceneDesc("D003_4", "Timeshift Puzzle - Conveyor", [0,3]),
    new SkywardSwordSceneDesc("D003_5", "Ancient Cistern Room", [0,4]),
    new SkywardSwordSceneDesc("D003_6", "Pirate Fight", [0,1]),
    new SkywardSwordSceneDesc("D003_7", "Entrance", [0]),
    new SkywardSwordSceneDesc("D003_8", "Triforce Get", [0,1,2,3]),

    "Sealed Grounds",
    new SkywardSwordSceneDesc("F400", "Behind the Temple", [0,1,3,8,13,14,15]),
    new SkywardSwordSceneDesc("F401", "Whirlpool", [0,1,2,3,4,5,6,7,13,14,15]),
    new SkywardSwordSceneDesc("F402", "Sealed Temple", [0,1,2,3,4,5,6,7,13,14,15,16,17,18,19]),
    new SkywardSwordSceneDesc("F403", "Hylia's Realm", [0,1,2,3,4,5,6,7,13,14,15,16]),
    new SkywardSwordSceneDesc("F404", "Temple of Hylia", [0,1,2,3,13,14,15]),
    new SkywardSwordSceneDesc("F405", "Whirlpool (Cutscene)", [0]),
    new SkywardSwordSceneDesc("F406", "Sealed Grounds (With Statue)", [0,1,2,13,14]),
    new SkywardSwordSceneDesc("F407", "Temple (Cutscene)", [0,13,14,15]),
    new SkywardSwordSceneDesc("B400", "Last Boss", [0,1,13,14]),

    "Demo",
    new SkywardSwordSceneDesc("Demo", "Staff Roll", [0,13]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
