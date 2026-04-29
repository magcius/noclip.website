
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
import { GfxDevice, GfxFrontFaceMode, GfxTexture, } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { EFB_HEIGHT, EFB_WIDTH, GXMaterialHacks } from '../gx/gx_material.js';
import { ColorKind, GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render.js';
import { assert, assertExists, readString } from '../util.js';
import { EggLightManager } from '../rres/Egg.js';
import { MDL0Model, MDL0ModelInstance, RRESTextureHolder } from '../rres/render.js';
import { AABB } from '../Geometry.js';

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
    sx: number;
    sy: number;
    sz: number;
    id : number;
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
    id: number; // 0x1B. Object ID perhaps? Counts up...
    name: string; // 0x1C. Object name. Matched with a table in main.dol, which points to a .rel (DLL), and *that* loads the model.
    sx: number;
    sy: number;
    sz: number;
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
    id: number; // 0x27. Object ID perhaps? Counts up...
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

enum ZSSPass {
    SKYBOX = 1 << 0,
    STAGE = 1 << 1,
    MAIN = 1 << 2,
    INDIRECT = 1 << 3,
}

class ZSSTextureHolder extends RRESTextureHolder {
    public override findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = super.findTextureEntryIndex(name);
        if (i >= 0) return i;

        // HACK(jstpierre): Thrill Digger (F211) seems to have a missing texture. Where is it???
        if (name === 'F211_Wood01')
            return super.findTextureEntryIndex('F211_Wood02');

        return -1;
    }
}

interface ModelToModelNodeBind_Info {
    model : MDL0ModelInstance;
    modelToBindTo : MDL0ModelInstance;
    nodeName : string;
};
interface RoomNodeSearchParameters {
    roomIdx : number;
    name : string;
};

class SkywardSwordRenderer implements Viewer.SceneGfx {
    public textureHolder: RRESTextureHolder;
    public animationController: AnimationController;
    private stageRRES: BRRES.RRES;
    private stageBZS: BZS | null = null;
    private roomBZSes: BZS[] = [];
    private commonRRES: BRRES.RRES;
    private resourceSystem = new ResourceSystem();
    private modelCache = new ModelCache();
    private renderHelper: GXRenderHelperGfx;
    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListStage = new GfxRenderInstList();
    private renderInstListInd = new GfxRenderInstList();
    private blackTexture: GfxTexture;
    private whiteTexture: GfxTexture;
    public currentLayer : number = 0;
    public layerModels : MDL0ModelInstance[][] = [];
    public roomModels:  MDL0ModelInstance[][] = [];
    public modelInstances: MDL0ModelInstance[] = [];

    // Past/Present Control
    public presentModels : MDL0ModelInstance[] = [];
    public pastModels : MDL0ModelInstance[] = [];
    public presentNodes : BRRES.MDL0_NodeEntry[] = [];
    public pastNodes : BRRES.MDL0_NodeEntry[] = [];
    public pastPresentNodeParameters : RoomNodeSearchParameters[] = [];

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
                for (let roomIdx = 0; roomIdx < roomArchivesDir.files.length; roomIdx++) {
                    this.roomModels.push([]);
                    
                    const roomArchiveFile = roomArchivesDir.files[roomIdx];
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
                        modelInstance.passMask = ZSSPass.STAGE;
                        this.roomModels[roomIdx].push(modelInstance);
                        this.modelInstances.push(modelInstance);
                        if (mdl0.name.startsWith('model_obj')) {
                            modelInstance.passMask = ZSSPass.MAIN;
                            this.pastModels.push(modelInstance);
                        }

                        

                        // Lanayru Sand Sea has a "present" decal on top of a past zone.
                        if (this.stageId === 'F301_1') {
                            if (mdl0.name === 'model1_s' || mdl0.name === 'model1' || mdl0.name === 'model2')
                                this.pastModels.push(modelInstance);
                        } else if (this.stageId === 'F302' && roomIdx === 7) {
                            if (mdl0.name === 'model0') {
                                this.presentModels.push(modelInstance);
                            }
                        } else if (this.stageId === 'D300') {
                            if (roomIdx === 2 || roomIdx === 3 || roomIdx === 6) {
                                if (mdl0.name.startsWith('model0')) {
                                    this.presentModels.push(modelInstance);
                                }
                            }
                        } else if (this.stageId === 'D300_1') {
                            if (roomIdx === 8 || roomIdx === 6) {
                                if (mdl0.name.startsWith('model0')) {
                                    this.presentModels.push(modelInstance);
                                }
                            }
                         } else if (this.stageId === 'F300_5') {
                            if (roomIdx === 0) {
                                if (mdl0.name.startsWith('model0')) {
                                    this.presentModels.push(modelInstance);
                                }
                            }
                        } else if (this.stageId === 'F301_2') { 
                            if (mdl0.name.startsWith('model0')) {
                                this.presentModels.push(modelInstance);
                            } 
                        } else if (this.stageId === 'F300_2') { 
                            if (mdl0.name.startsWith('model0')) {
                                this.presentModels.push(modelInstance);
                            } 
                        } else if (this.stageId === 'F300_3') { 
                            if (mdl0.name.startsWith('model0')) {
                                this.presentModels.push(modelInstance);
                            } 
                        } else if (this.stageId === 'D003_3') { 
                            if (mdl0.name.startsWith('model0')) {
                                this.presentModels.push(modelInstance);
                            } 
                        } else if (this.stageId === 'D003_4') { 
                            if (mdl0.name.startsWith('model0')) {
                                this.presentModels.push(modelInstance);
                            } 
                        }

                        // Detail / transparent meshes end with '_s'. Typical depth sorting won't work, we have to explicitly bias.
                        if (mdl0.name.endsWith('_s') && this.stageId !== 'F301_1')
                            modelInstance.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);
                    }

                    const roomBZS = this.parseBZS(roomArchive.findFileData('dat/room.bzs')!);
                    this.roomBZSes.push(roomBZS);
                    const layout = roomBZS.layouts[t];
                    if (this.layerNums.includes(t))
                        this.spawnLayout(device, layout, roomIdx);

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
        for (let i = 0; i < this.pastPresentNodeParameters.length; i++) {
            const param = this.pastPresentNodeParameters[i];
            const roomMdls = this.roomModels[param.roomIdx];
            for (let j = 0; j < roomMdls.length; j++) {
                const node = roomMdls[j].mdl0Model.mdl0.nodes.find((node) => {
                    return node.name === param.name;
                });
                if (node) {
                    this.presentNodes.push(node);
                }
            }
        }

        const pastPresentSelectionChange = (index: number) => {
            const isPresent = (index === 1);
            for (let i = 0; i < this.presentModels.length; i++)
                this.presentModels[i].setVisible(isPresent);
            for (let i = 0; i < this.presentNodes.length; i++)
                this.presentNodes[i].visible = isPresent;
            for (let i = 0; i < this.pastModels.length; i++)
                this.pastModels[i].setVisible(!isPresent);
            for (let i = 0; i < this.pastNodes.length; i++)
                this.pastNodes[i].visible = !isPresent;
            modelsPanel.syncLayerVisibility();
        };

        if (this.presentModels.length || this.pastModels.length) {
            const presentPanel = new UI.Panel();
            presentPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            presentPanel.setTitle(UI.SAND_CLOCK_ICON, "Time Stones");

            const selector = new UI.SingleSelect();
            selector.setStrings([ 'Past', 'Present' ]);
            selector.onselectionchange = pastPresentSelectionChange;
            selector.selectItem(0); // Present
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
        if (layerNames.length != 0){
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
                        this.layerModels[i].forEach((mdl)=>mdl.setVisible((i === layerIndecies[index]) || (i === 0)));
                }
                modelsPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Always select the first layer
            layerPanel.contents.appendChild(selector.elem);
            panels.push(layerPanel);
        }

        pastPresentSelectionChange(0);

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
        this.preparePass(device, this.renderInstListStage, ZSSPass.STAGE, viewerInput);
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
                this.renderInstListStage.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
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
                    this.renderInstListInd.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null });
                    this.renderInstListInd.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                });
            });
        }
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstListSky.reset();
        this.renderInstListMain.reset();
        this.renderInstListInd.reset();
    }

    private findNode(m: MDL0ModelInstance, name: string): BRRES.MDL0_NodeEntry | undefined {
        return m.mdl0Model.mdl0.nodes.find(node=>node.name===name);
    }
    private spawnObj(device: GfxDevice, obj: BaseObj, modelMatrix: mat4, roomIdx : number | undefined): void {
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
        'CBomSld', 'CamTag' , 'SwAreaT', 'CharD', 'CharE', 'WoodTag', 'BtlTgC', 'FencePe', 'HeatRst', 'SpkTg2', 'SparkTg',
        'EvfTag', 'TgClay'];

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

        const setModelBBox = (mdl : MDL0ModelInstance, bbox : AABB | null) => {
            if (mdl.mdl0Model.mdl0.bbox === null && bbox !== null) {
                mdl.mdl0Model.mdl0.bbox = bbox;
            }
        }
        const calcModelBounds = (mdl : MDL0ModelInstance) => {
            // TODO(Zeldex72) This should walk through the models
            //                shapes and min/max verticies
            console.info(name, 'does not have bbox');
            return null;
        }

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
                if (animNode.scaleX === null) {
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
            const bbox = new AABB(-200, -0, -100, 200, 500, 100);
            // Outside Model
            const m = spawnModelFromNames('Tansu', 'Tansu' + ['A','B','C','D','A'][outsideType]);
            setModelBBox(m,  bbox);
            if (insideType !== 0xF) {
                const m = spawnModelFromNames('TansuInside', 'TansuInside' + ['A','B','C','D','A'][outsideType]);
                setModelBBox(m, bbox);
            }
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
                    setModelBBox(spawnOArcModel('TBoxSmallT'), new AABB(-38, 0, -70, 38, 110, 35));
                else if (boxBossItems.includes(itemId))
                    setModelBBox(spawnOArcModel('TBoxBossT'), new AABB(-90, 0, -140, 90, 170, 60));
                else if (boxGoddessItems.includes(itemId))
                    setModelBBox(spawnOArcModel('GoddessTBox'), new AABB(-65, 0, -100, 65, 150, 50));
                else
                    setModelBBox(spawnOArcModel('TBoxNormalT'), new AABB(-65, 0, -100, 65, 150, 45));
            }
        }
        // Freestanding Items
        else if (name === 'Item'){
            let m : MDL0ModelInstance | null = null;
            // TODO(Zeldex72): Adjust bbox per item type.
            // Is not static in game, but calculated based on a complex structure/scale
            // Default will probably be fine
            const bbox = new AABB(-100, -100, -100, 100, 100, 100);
            // due to complexity, leaving here
            const itemId = params1 & 0xFF;
            const RUPEE_ITEMS = [2,3,4,32,33]; // gree, blue, red, silver, gold
            //Rupees
            if (RUPEE_ITEMS.includes(itemId)) {
                m = spawnOArcModel('PutRupee');
                mat4.scale(m.modelMatrix, m.modelMatrix, [1.5, 1.5, 1.5]);
                let rupeePat = findPAT0(getOArcRRES('PutRupee'), 'Rupee');
                switch(itemId){
                    case 2:  m.bindPAT0(staticFrame(0), rupeePat); break;
                    case 3:  m.bindPAT0(staticFrame(1), rupeePat); break;
                    case 4:  m.bindPAT0(staticFrame(2), rupeePat); break;
                    case 32: m.bindPAT0(staticFrame(3), rupeePat); break;
                    case 33: m.bindPAT0(staticFrame(4), rupeePat); break;
                }
            }
            // Small Key
            else if (itemId === 1) {
                m = spawnModelFromNames('PutKeySmall', 'PutKeySmallNormal');
                mat4.scale(m.modelMatrix, m.modelMatrix, [1.1, 1.1, 1.1]);
            }
             // stamina fruit
            else if (itemId === 42) {
                const gutsRRES = getOArcRRES('PutGuts');
                const m = spawnModel(gutsRRES, 'PutGuts');
                spawnModel(gutsRRES, 'PutGutsLeaf');
                m.bindSRT0(this.animationController, findSRT0(gutsRRES, 'GutsLight'));
            }
             // Babies Rattle
            else if (itemId === 160) {
                spawnOArcModel('PutGaragara');
            }
            // heart piece
            else if (itemId === 94) {
                m = spawnOArcModel('PutHeartKakera');
                scaleModelConstant(m, 1.375);
            }
            // Gratitude Crystal
            else if (itemId === 48) {
                m = spawnOArcModel('GetGenki');
                scaleModelConstant(m, 1.7);
                translateModel(m, [0,30,0]);
            }
            // Normal Heart Item
            else if (itemId === 6) {
                m = spawnOArcModel('PutHeart');
            }
            else {
                console.log(`unknown item id: ${itemId}`);
            }

            if (m !== null) {
                setModelBBox(m, bbox);
            }
        }
        // Air Vents
        else if (name === 'Wind'){
            const windType = (params1 >>> 3) & 1; // determines the big wind or not
            const windArc = ['FXTornado', 'FXTornadoBoss'][windType];
            const m = spawnOArcModel(windArc);
            setModelBBox(m, new AABB(-180, -50, -180, 180, 180, 180));
        }
        // Water Vents
        else if (name === 'Wind03'){
            const waterSpoutRRES = getOArcRRES('WindSc00');
            let m = spawnModel(waterSpoutRRES, 'FX_WaterShaft');
            m.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaft_in'));
            m.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaft'));

            m = spawnModel(waterSpoutRRES, 'FX_WaterShaftTop');
            m.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaftTop_in'));
            m.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaftTop'));
            mat4.translate(m.modelMatrix, m.modelMatrix, [0, 100, 0]);
            mat4.scale(m.modelMatrix, m.modelMatrix, [1, 0.08, 1]);

            setModelBBox(m, new AABB(-180, -50, -180, 180, 180, 180));
        }
        // Lava Vents
        else if (name === 'Wind02'){
            const waterSpoutRRES = getOArcRRES('FXLava');
            const m = spawnModel(waterSpoutRRES, 'FX_LavaShaft');
            m.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_LavaShaft_Loop'));
            m.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_LavaShaft_Loop'));

            // const m = spawnModel(waterSpoutRRES, 'FX_WaterShaftTop');
            // m.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaftTop_in'));
            // m.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaftTop'));
            mat4.translate(m.modelMatrix, m.modelMatrix, [0, -200, 0]);
            // mat4.scale(m.modelMatrix, m.modelMatrix, [1, 0.08, 1]);

            setModelBBox(m, new AABB(-180, -200, -180, 180, 1600, 180));
        }
        // Moldroms
        else if (name === 'ESpark'){
            const bbox = new AABB(-100, -100, -100, 100, 100, 100);
            const sparkRRES = getOArcRRES('MoldWorm');
            const sparkMdl = spawnModel(sparkRRES, 'MoldWormHead');
            sparkMdl.bindCHR0(this.animationController, findCHR0(sparkRRES, "HeadWait"));
            setModelBBox(sparkMdl, bbox);
            
            let shift : number = -50;
            let start = shift;
            for (let i = 0; i < 3; i++){
                const bodySeg = spawnModel(sparkRRES, 'MoldWormBody');
                mat4.translate(bodySeg.modelMatrix, bodySeg.modelMatrix, [0, 0, start]);
                bodySeg.bindCHR0(this.animationController, findCHR0(sparkRRES, "BodyWalk"));
                start+=shift;
                setModelBBox(bodySeg, bbox);
            }
            const tailSeg = spawnModel(sparkRRES, 'MoldWormTail');
            mat4.translate(tailSeg.modelMatrix, tailSeg.modelMatrix, [0, 0, start]);
            tailSeg.bindCHR0(this.animationController, findCHR0(sparkRRES, 'TailWait'));
            setModelBBox(tailSeg, bbox);
        }
        // Vines, Ropes, and TightRopes
        else if (name === 'IvyRope'){
            // TODO(Zeldex72): Rope bbox is calculate based on its length
            //                 Setting to 100 as default for now
            const bbox = new AABB();
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
                const distance = 100;
                bbox.set(-distance, -distance, -distance, distance, 100, distance);

                const m = spawnOArcModel('RopeTerry');
                setModelBBox(m, bbox);

            } else if (ropeSubtype === 4) {
                const distance = 100;
                bbox.set(-distance, -distance, -distance, distance, 100, distance);

                const m = spawnModelFromNames('GrassCoil', 'GrassCoilCut'); // Can be switched to cut variant
                setModelBBox(m, bbox);
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
  
            setModelBBox(stopperMdl, calcModelBounds(stopperMdl));
        }
        // Main Isle of Song mechanism, spawns the pusher, and rotating islands
        else if (name === 'UtaMain'){
            const mainMechaMdl = spawnOArcModel('IslSonCenterDevice');
            translateModel(mainMechaMdl, [0,230,0]);
            rotateModel(mainMechaMdl, [0,Math.PI,0]);
            for (let i = 0; i < 3; i++)
            {
                // const ringRotation = [0,0,0][i] * -5461;
                const ringRotation = [8,9,1][i]* -5461;
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
                rotateModel(mdl2, [0, rotateY+Math.PI/2, 0]);

                setModelBBox(mdl, calcModelBounds(mdl));
                setModelBBox(mdl2, calcModelBounds(mdl2));
            }

            setModelBBox(mainMechaMdl, calcModelBounds(mainMechaMdl));
        }
        // Dungeon Doors
        else if (name === 'TstShtr'){
            const bbox = new AABB(240, -40, -50, 240, 440, 50);
            const doorType = (params1 >>> 4) & 0x3f;
            let isLocked  = ((rotx & 0x00FF) !== 0xFF);
            let isLocked2 = ((rotx & 0xFF00) !== 0xFF);
            const isLockedWithKey = (params1&0xF);
            const doorModelArcName   = 'ShutterFenced0' + [doorType];
            let   doorModelName      = 'ShutterFenced0' + [doorType];
            let   lockedModelName  = 'ShutterFencedFence0' + [doorType];
            const doorRRES = getOArcRRES(doorModelArcName);
           if (doorType === 2){ // Time Variants
                setModelBBox(spawnModel(doorRRES, doorModelName+'N'), bbox);
                setModelBBox(spawnModel(doorRRES, doorModelName+'T'), bbox);
                if ((isLocked || isLocked2) && isLockedWithKey !== 2) {
                    setModelBBox(spawnModel(doorRRES, lockedModelName+'N'), bbox);
                    setModelBBox(spawnModel(doorRRES, lockedModelName+'T'), bbox);
                }
           } else {
               setModelBBox(spawnModel(doorRRES, doorModelName), bbox);
                if ((isLocked || isLocked2) && ![2,5].includes(isLockedWithKey)) {
                    setModelBBox(spawnModel(doorRRES, lockedModelName), bbox);
                }
           }
           if ((isLocked || isLocked2) && [2].includes(isLockedWithKey)){
                const mdl = spawnOArcModel('LockSmall');
                mat4.translate(mdl.modelMatrix, mdl.modelMatrix, [0,150,0]);
                mat4.rotateX(mdl.modelMatrix, mdl.modelMatrix, Math.PI/2);
                setModelBBox(mdl, bbox);
           }
        } else if (name === 'DoorBs'){
            const bbox = new AABB(-400, -0, -70, 400, 800, 160);
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
            setModelBBox(bossDoorAnim, bbox);
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
                setModelBBox(doorL, bbox);
                setModelBBox(doorR, bbox);
                setModelBBox(lockL, bbox);
                setModelBBox(lockR, bbox);
                setModelBBox(holeL, bbox);
                setModelBBox(holeR, bbox);
                if (dungeonNum === 2) {
                    this.pastModels.push(doorL, doorR, lockL, lockR, holeL, holeR);
                }
            }
            else {
                // Cistern is *Special*
                const m = spawnModelFromNames('BossLockD101', 'BossLockD101');
                setModelBBox(m, bbox);
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
                this.presentModels.push(doorL, doorR, lockL, lockR, holeL, holeR);
                this.modelBinds.push({model: doorL, modelToBindTo: bossDoorAnim, nodeName: "DoorBossL"})
                this.modelBinds.push({model: doorR, modelToBindTo: bossDoorAnim, nodeName: "DoorBossR"})
                this.modelBinds.push({model: lockL, modelToBindTo: bossDoorAnim, nodeName: "LockL"})
                this.modelBinds.push({model: lockR, modelToBindTo: bossDoorAnim, nodeName: "LockR"})
                this.modelBinds.push({model: holeL, modelToBindTo: bossDoorAnim, nodeName: "KeyholeL"})
                this.modelBinds.push({model: holeR, modelToBindTo: bossDoorAnim, nodeName: "KeyholeR"})
                setModelBBox(doorL, bbox);
                setModelBBox(doorR, bbox);
                setModelBBox(lockL, bbox);
                setModelBBox(lockR, bbox);
                setModelBBox(holeL, bbox);
                setModelBBox(holeR, bbox);
            }
        // The Big Lily Pads
        } else if (name === 'Lotus'){
            const lilyPadSubtype = (params1>>>10)&0xF;
            const isUpsideDown = !((params1>>>8)&0x3);
            const lilyPadOarc = ['WhipLeaf00', 'WhipLeaf01', 'WhipLeafStop', 'LotusStep'][lilyPadSubtype];
            const padModel = spawnOArcModel(lilyPadOarc);
            if (isUpsideDown)
                rotateModel(padModel, [0,0,Math.PI]);
            setModelBBox(padModel, calcModelBounds(padModel));
        // Chu Chus -> need texture overriding for the different kinds
        } else if (name === 'ESm'){
            const smRRES = getOArcRRES('Sm');
            const variant = params1 & 0xF;
            const frame = [0,3,2,0,3,2,1][variant];
            const m = spawnModel(smRRES, 'sm');
            m.bindPAT0(staticFrame(frame), findPAT0(smRRES, 'sm'));
            m.bindCHR0(this.animationController, findCHR0(smRRES, 'awa'));

            const min = -200 / obj.sx;
            const max = 200 / obj.sx;

            setModelBBox(m, new AABB(min, min, min, max, 250 / obj.sx, max));
        // Bocoblins
        } else if (name === 'EBc'){
            const bbox = new AABB(-150, -200, -150, 150, 200, 150);
            const bcRRES = getOArcRRES('Bc');
            const variant = (params1>>>0)&3;
            const bokoConfig = (params1>>24)&0xF;
            let color = [1,0,2][variant];
            if (variant === 1 && (['D200', 'D301'].includes(this.stageId) || ![1,2].includes(this.stageBZS!.areaType))) color = 1;
            let bcName = ['BocoburinG', 'BocoburinM', 'BocoburinB'][color];
            if (bokoConfig === 9)
                bcName = ['BocoburinG', 'Bocoburin_A', 'BocoburinB'][color];
            if (bokoConfig === 2) {
                bbox.set(-350, -200, -350, 350, 200, 350);
            }
            const mdl = spawnModel(bcRRES, bcName);
            mdl.bindPAT0(this.animationController, findPAT0(bcRRES, `Bocoburin${['G','A','B'][color]}Wink`));
            mdl.bindCHR0(this.animationController, findCHR0(bcRRES, 'wait'));
            scaleModelConstant(mdl, 1.1);
            setModelBBox(mdl, bbox);
            let weaponIdx = -1;
            // Weapon
            if (bokoConfig === 9) {
                // Bow
                const bowMdl = spawnModel(bcRRES, color === 0 ? 'BocoburinGBow' : 'bow');
                this.modelBinds.push({model: bowMdl, modelToBindTo: mdl, nodeName: 'hand_L'})
                setModelBBox(bowMdl, bbox);
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
                setModelBBox(weaponMdl, bbox);
            }
            if (weaponIdx !== -1)
            {
                const weaponName = `Bocoburin${['SwordA', 'Stick', 'BSword','GSword'][weaponIdx-1]}`;
                const weaponMdl = spawnModel(bcRRES, weaponName);
                this.modelBinds.push({model: weaponMdl, modelToBindTo: mdl, nodeName: 'hand_R'})
                setModelBBox(weaponMdl, bbox);
            }
            // Headpiece
            if (variant !== 0 && color !== 0)
            {
                const headcloth = spawnModel(bcRRES, `Bocoburin${['M','M','B'][color]}Headcloth`);
                this.modelBinds.push({model: headcloth, modelToBindTo: mdl, nodeName: 'head'})
                setModelBBox(headcloth, bbox);
            }
            // Belt item
            const beltItem = ["None", 'Horn', 'Key'][(params1 >>> 2) & 3];
            if (beltItem !== "None")
            {
                if (beltItem === 'Key') {
                    const keyMdl = spawnModel(bcRRES, "KeySmall");
                    this.modelBinds.push({model: keyMdl, modelToBindTo: mdl, nodeName: 'pipe_loc'})
                    setModelBBox(keyMdl, bbox);
                }
                else {
                    const pipemdl = spawnModel(bcRRES, "BocoburinPipe");
                    this.modelBinds.push({model: pipemdl, modelToBindTo: mdl, nodeName: 'pipe_loc'})
                    setModelBBox(pipemdl, bbox);
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
            setModelBBox(mdl, new AABB(-300, 500, -2600, 300, 1100, -2200));
        }
        // Bushes
        else if (name === 'OcGrs') {
            const bbox = new AABB(-50, -10, -50, 50, 100, 50);
            const type = (params1 >>> 0) & 0xF;
            const arc = ['GrassOcta', 'GrassRollGrow', 'GrassGerm', 'GrassMain'][type];
            const mdl2 = ['GrassOctaCut', 'GrassRollCut', 'GrassGermCut', 'GrassMainCut'][type];
            const bushMdl = spawnOArcModel(arc); // main Bush
            const stemMdl = spawnModelFromNames(arc, mdl2); // The stem
            setModelBBox(bushMdl, bbox);
            setModelBBox(stemMdl, bbox);
        }
        //  Grass things in faron
        else if (name === 'Gcoil') {
            const m = spawnOArcModel('GrassCoilNormal');
            setModelBBox(m, new AABB(-100, -50, -100, 100, 200, 200));
        }
        // Big Flags around skyloft (like hanging from bazaar)
        else if (name === 'Flag') {
            const type = (params1 >>> 0) & 0xF;
            const model = ['FlagA', 'FlagA', 'FlagB', 'FlagB', 'BigSail', 'BigSail'][type];
            
            const rres = getOArcRRES(model)
            const m = spawnOArcModel(model);

            if (type === 1) {
                rotateModel(m, [0, 0, Math.PI / 2]);
            }
            else if (type === 2 || type === 3) {
                const srt = findSRT0(rres, 'FlagB');

                if (type === 2) {
                    m.bindSRT0(staticFrame(0), srt);
                } else {
                    m.bindSRT0(staticFrame(1), srt);
                }
            }
            setModelBBox(m, new AABB(-800, -500, -250, 250, 500, 250));
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
            const m = spawnOArcModel(model);
            setModelBBox(m, calcModelBounds(m));
        }
        // Low Poly Loftwings flying around skyloft
        // else if (name === 'BrdMob') {
        //     const arcMdl = getOArcRRES('BirdLOD');
        //     const chr = findCHR0(arcMdl, 'BirdLOD_Glide');
        //     console.info('Revisit BrdMob Later');
        // }
        // Wood Signs
        else if (name === 'Kanban') {
            const m = spawnModelFromNames('Kanban', 'KanbanA');
            translateModel(m, [0,100,0]);
            setModelBBox(m, new AABB(-220, -100, -220, 220, 160, 220));
        }
        // Practice Slash Logs
        else if (name === 'SliceLg') {
            const bbox = new AABB(-300, -50, -300, 300, 350, 300);
            const type = params1  & 0xF;
            const logName = 'PracticeWood'+['A','B','C','D','CR','F'][type];
            setModelBBox(spawnModelFromNames('PracticeWood', logName+'1'), bbox);
            setModelBBox(spawnModelFromNames('PracticeWood', logName+'2'), bbox);
        }
        // Cloud Barrier for each pillar - Temporarily using Some other effect untily JPA support
        else if (name === 'LightLi') {
            // const m = spawnOArcModel('FXLightShaft');
            // scaleModel(m, [5,1,5]);
            // console.info('Add Effect for LightLi')
        }
        // Player Bird (Crimson Loftwing)
        else if (name === 'PyBird') {
            const m = spawnModelFromNames('Bird_Link', 'BirdLink');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Glide'));
            setModelBBox(m, new AABB(-1800, -1500, -1500, 1800, 1500, 1500));
        }
        // Item Shop (Rupin) Owner mother
        else if (name === 'NpcDoMo') {
            const rres = getOArcRRES('DouguyaMother');
            const m = spawnModel(rres, 'DouguyaMother');
            m.bindCHR0(this.animationController, findCHR0(rres, 'DouguyaMother_wait'));
            setModelBBox(m, new AABB(-100, -100, -100, 100, 200, 100));
        }
        // The shield bash practice log
        else if (name === 'GuardLg') {
            const bbox = new AABB(-100, -100, -100, 100, 500, 100);
            const m = spawnModelFromNames('PracticeWood', 'PracticeWoodE'); // Log
            scaleModelConstant(m, 1.2);
            translateModel(m, [100,200,40]);
            const m2 = spawnModelFromNames('PracticeWood', 'RopeBase'); // Rope on Top
            m2.modelMatrix = mat4.create();
            setModelBBox(m, bbox);
            setModelBBox(m2, bbox);

            console.warn('Incomplete:', name, 'connecting rope not implemented');
        }
        // Water on Skyloft
        else if (name === 'CityWtr') {
            const bbox = new AABB(3000, -8600, -10500, 12300, 4300, 3400);
            const wtr0 = spawnModelFromNames('Stage', 'StageF000Water0');
            const wtr1 = spawnModelFromNames('Stage', 'StageF000Water1');
            const wtr2 = spawnModelFromNames('Stage', 'StageF000Water2');
            setModelBBox(wtr0, bbox);
            setModelBBox(wtr1, bbox);
            setModelBBox(wtr2, bbox);
        }
        // Gravestones
        else if (name === 'Grave') {
            const m = spawnModelFromNames('Stage', 'StageF000Grave')
            setModelBBox(m, new AABB(-100, -0, -100, 100, 200, 100));
        }
        //Shed Door to demon
        else if (name === 'Shed') {
            const m = spawnModelFromNames('Stage', 'StageF000Shed')
            setModelBBox(m, new AABB(-115, -0, -10, 115, 260, 10));
        }
        // Windmills for the light Tower
        else if (name === 'Windmil') {
            const m = spawnModelFromNames('Stage', 'StageF000Windmill')
            setModelBBox(m, new AABB(-150, -150, -100, 150, 150, 100));
        }
        // Ropes with pinwheels and such
        else if (name === 'Blade') {
            const m = spawnModelFromNames('Stage', 'StageF000Blade')
            // Purposely ignored... Game sets to -0, 0 but that cant be right
            // setModelBBox(m, new AABB(-0, -0, -0, 0, 0, 0));
        }
        // Harp area for the Thuderhead opening
        else if (name === 'LHHarp') {
            const m = spawnModelFromNames('Stage', 'StageF000Harp');
            rotateModel(m, [0, -9.5/12*Math.PI, 0]);
            if (this.stageId === 'S000') {
                translateModel(m, [0, -600, 0]);
            } else {
                // rotateModel(m, [0, 0.8 * Math.PI, 0])
            }
            setModelBBox(m, new AABB(-460, -60, -460, 460, 610, 460));
        }
        // Sunlight in harp area
        else if (name === 'LHLight'){
            // Skipping due to duplicate with SnLight showing twice in two directions
            // spawnModelFromNames('Stage', 'StageF000Light');
        }
        else if (name === 'SnLight'){
            const m = spawnModelFromNames('Stage', 'StageF000Light');
            setModelBBox(m, new AABB(-200, -100, -200, 200, 600, 500));
        }
        // Gates on Skyloft that block doors
        else if (name === 'DmtGate'){ 
            const bbox = new AABB();
            const type = (params1>>> 8) & 0xF;
            const typeName = ['StageF000Gate', 'StageF000GodDoor', 'StageF000Shutter', 'StageF400Gate'][type & 0x3];
            
            // Gate Variants
            if (type === 0 || type === 3) {
                bbox.set(-400, -0, -50, 400, 600, 250);
                const m0 = spawnModelFromNames('Stage', typeName);
                const m1 = spawnModelFromNames('Stage', typeName);

                translateModel(m0, [-217, 0, 0])
                rotateModel(m0, [0,  -Math.PI/2, 0])

                translateModel(m1, [217, 0, 0])
                rotateModel(m1, [0, -Math.PI/2, 0])

                setModelBBox(m0, bbox);
                setModelBBox(m1, bbox);
            } else {
                if (type === 1) {
                    bbox.set(-50, -0, -100, 500, 500, 100);
                } else {
                    bbox.set(-250, -0, -50, 250, 400, 50);
                }
                const m = spawnModelFromNames('Stage', typeName);
                setModelBBox(m, bbox);
            }
        }
        // Pumpkins
        // Pumpkins for Pumpkin Archery Minigame
        else if (name === 'Pumpkin' || name === 'PmpknDe'){
            const bbox = new AABB(-50, -50, -50, 50, 50, 50);
            const pumpkin = spawnModelFromNames('Pumpkin', 'Pumpkin');
            const leaves = spawnModelFromNames('Pumpkin', 'Turu');
            setModelBBox(pumpkin, bbox);
            setModelBBox(leaves, bbox);
        }
        // Heart Flowers
        else if (name === 'Heartf'){
            const m = spawnModelFromNames('FlowerHeart', 'FlowerHeart');
            setModelBBox(m, new AABB(-50, -0, -50, 50, 100, 50));
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
            const m = spawnOArcModel(typeName);
            setModelBBox(m, calcModelBounds(m));
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
            const bbox = new AABB(-10000, -10000, -23000, 13000, 10000, 8000);
            const m0 = spawnModelFromNames('IslF000', 'IslF000');
            const m1 = spawnModelFromNames('IslF000', 'IslF000_s');
            const m2 = spawnModelFromNames('IslF000', 'IslF000Water0');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
            setModelBBox(m2, bbox);
        }
        // Island with Bamboo minigame
        else if (name === 'IslBamb') {
            const bbox = new AABB(-2400, -1600, -2300, 2400, 3900, 2400);
            const m0 = spawnModelFromNames('IslBamb', 'IslBamb');
            const m1 = spawnModelFromNames('IslBamb', 'IslBamb_s');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Beetles sky island
        else if (name === 'IslTery') {
            const bbox = new AABB(-1600, -1500, -1600, 1700, 1500, 1600);
            setModelBBox(spawnModelFromNames('IslTerry', 'IslTerry'), bbox);
        }
        // LumpPumpkin
        else if (name === 'PumpBar') {
            const bbox = new AABB(-2790, -1450, -8270, 2880, 2120, 1370);
            setModelBBox(spawnModelFromNames('IslBar', 'IslBar'), bbox);
        }
        // THe ring on Fun Fun Island
        else if (name === 'RouletR') {
            const m = spawnModelFromNames('IslRouRot', 'IslRouRot');
            setModelBBox(m, calcModelBounds(m));
        }
        // Main Fun Fun island
        else if (name === 'RouletC') {
            const m0 = spawnModelFromNames('IslRouMain', 'IslRouMain');
            const m1 = spawnModelFromNames('IslRouMain', 'IslRouMain_s');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, calcModelBounds(m0));
            setModelBBox(m1, calcModelBounds(m1));
        }
        // dig spots
        else if (name === 'FrmLand') {
            const bbox = new AABB(-100, -0, -100, 100, 100, 100);
            const m = spawnModelFromNames('MoundShovelD', 'MoundShovelD00');
            setModelBBox(m, bbox);
        }
        // Boss Koloktos Pillars
        else if (name === 'AsuraP') {
            const bbox = new AABB(-150, -0, -150, 150, 1200, 150);
            for (let i = 0; i < 6; i++){
                const type = 'BreakPillar'+['A','B','C','D','E','F'][i];
                const m = spawnModelFromNames('BreakPillar', type);
                translateModel(m, [0, i*200, 0]);
                setModelBBox(m, bbox);
            }
        }
        // Boss Koloktos
        else if (name === 'BAsura') {
            const m = spawnOArcModel('Asura');
            const rres = getOArcRRES('Asura');
            const baseAnm = findCHR0(rres, 'DodaiAWait00');
            const waitAnm = findCHR0(rres, 'BWait00');
            m.bindCHR0(this.animationController, findCHR0(rres, 'BWait00'));
            m.bindSRT0(this.animationController, findSRT0(rres, 'Wait00'));
            console.warn('Fix', name, '- Weird with the arm segments');
        }
        // Bomb Flower
        else if (name === 'Bombf') {
            const bbox = new AABB(-80, -50, -80, 80, 60, 80);
            const m = spawnModelFromNames('FlowerBomb', 'LeafBomb');
            setModelBBox(m, bbox);

            // Not adding BBox for now. Unsure if it has one lol
            spawnModelFromNames('Alink', 'EquipBomb'); 
        }
        // Spikes in ancient cistern
        else if (name === 'Spike') {
            const bbox = new AABB(-10, -250, -480, 80, 260, 490);
            const m = spawnModelFromNames('SpikeD101', 'SpikeD101');
            setModelBBox(m, bbox);
        }
        // Whirlpool cork
        else if (name === 'PlCock') {
            const bbox = new AABB(-300, -100, -300, 300, 100, 300);
            const m = spawnModelFromNames('WaterD101', 'PoolCockD101');
            setModelBBox(m, bbox);
        }
        // Whirlpool
        else if (name === 'Vortex') {
            // const bbox = new AABB(-1000, -50, -1000, 1000, 200, 1000);
            const m = spawnModelFromNames('WaterD101', 'SpiralWaterD101');
            // setModelBBox(m, bbox);
            console.warn(name, 'does not have bbox');
        }
        // Shutter for water
        else if (name === 'ShtrWtr') {
            const bbox = new AABB(-100, -400, -400, 100, 400, 400);
            const m = spawnModelFromNames('ShutterWaterD101', 'ShutterWaterD101');
            setModelBBox(m, bbox);
        }
        // Birdge from Whip Lever
        else if (name === 'BridgeS') {
            const bbox = new AABB(-5600, 550, 100, -4000, 1000, 1950);
            const m = spawnModelFromNames('BridgeD101', 'BridgeD101');
            setModelBBox(m, bbox);
        }
        // Roll pillars for vines TODO: add rotation
        else if (name === 'rpiller'){
            const type = (params1 >>> 28) & 0xF;
            const typeName = 'SpinPillarD101'+['A','A','B','C','A','B','C'][type];
            const m = spawnModelFromNames('SpinPillarD101', typeName);
            if (type === 1 || type === 4) {
                setModelBBox(m, new AABB(-450, -100, -450, 450, 2000, 450));
            } else if (type === 2 || type === 5) {
                setModelBBox(m, new AABB(-850, -100, -850, 850, 2000, 850));
            } else if (type === 3 || type === 6) {
                setModelBBox(m, new AABB(-1300, -100, -1300, 1300, 2000, 1300));
            } else {
                console.warn(name, "Invalid BBOX for type", type);
            }
        }
        // DoorsF300
        else if (name === 'Door') {
            const bbox = new AABB(-1300, -50, -1000, 1300, 100, 1000);
            const type = params1&0x3f;
            const arcName = 'Door'+['A00','A01','C00','C01','B00','E','A02','F','H'][type];
            if (type === 5) {
                const m0 = spawnModelFromNames(arcName, 'DoorE_N');
                const m1 = spawnModelFromNames(arcName, 'DoorE_T');
                this.pastModels.push(m1);
                this.presentModels.push(m0);
                setModelBBox(m0, bbox);
                setModelBBox(m1, bbox);
            } else {
                const m = spawnOArcModel(arcName);
                setModelBBox(m, bbox);
            }
        }
        // Bombable Rocks
        else if (name === 'BlsRock'){
            const type = (params1 >>> 8) & 0xFF;
            const arcName = ['TeniCrystalRockSc','BRockHole00','BRockWall','BRockDoor00','BRockR01','BrokenRockWallD200','LavaBRock','BRockWall','BRockCrystal','BRockF202','BRockRail','F300BrokenRockWall','F300BrokenRockWall','BWallAF200','BWallBF200','BWallF210','BRockStopA','BRockHole00','BWallD201','BRockWall',][type];
            const modelName = ['TeniCrystalRockScA','BRockHole00A','BRockWall00A','BRockDoor00A','BRockR01A','BrokenRockWallD200','LavaBRockA','BRockWall00A','BRockCrystalA','BRockF202A','BRockRailA','F300BrokenRockWall_00','F300BrokenRockWall_01','BWallAF200','BWallBF200','BWallF210','BRockStopAA','BRockHole01A','BWallD201','BRockWall00A',][type];
            const m = spawnModelFromNames(arcName, modelName);
            setModelBBox(m, calcModelBounds(m));
        }
        // Island with spiral charge rocks
        else if (name === 'IslTreB') {
            const bbox = new AABB(-1200, -1200, -1100, 1200, 1600, 1200);
            const m0 = spawnOArcModel('IslTreI');
            const m1 = spawnOArcModel('IslTreIRock');
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Islands in the Sky
        else if (name === 'IslTrea') {
            const bbox = new AABB(-1850, -2050, -1900, 1950, 2500, 1850);
            const type = params1 & 0xF;
            const typeName = 'IslTre'+['A','B','C','D','E','F','G','H'][type];
            const m = spawnOArcModel(typeName);
            setModelBBox(m, bbox);
            if (type === 2){
                const w0 = spawnModelFromNames(typeName, typeName+'Water00');
                const w1 = spawnModelFromNames(typeName, typeName+'Water01');
                setModelBBox(w0, bbox);
                setModelBBox(w1, bbox);
            }
        }
        // Rocks in the Sky
        else if (name === 'RockSky') {
            const type = params1 & 0xF;
            const typeName = 'RockSky'+['A','B','C','D',][type];
            const m = spawnOArcModel(typeName);
            setModelBBox(m, calcModelBounds(m));
        }
        // Digging holes for mitts
        else if (name === 'InHole') {
            const bbox = new AABB(-100, -300, -100, 100, 300, 100);
            const m0 = spawnModelFromNames('MoundShovelB', 'MoundShovelB');
            const m1 = spawnModelFromNames('MoundShovelB', 'HoleShovelB');
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Walltulas
        else if (name === 'EWs') {
            const bbox = new AABB(-150, -0, -150, 150, 150, 150);
            const m = spawnOArcModel('StalWall');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('StalWall'), 'wait00'));
            scaleModelConstant(m, 0.5);
            rotateModel(m, [Math.PI/2, 0, 0]);
            setModelBBox(m, bbox);
        }
        // Scrapper
        else if (name === 'NpcSlFl') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const m = spawnOArcModel('DesertRobot');
            m.bindCHR0(this.animationController,
            findCHR0(getOArcRRES('DesertRobot_Sal'), 'DesertRobot_Sal_Fly'));
            setModelBBox(m, bbox);
        }
        // Musasabi Tag spawns the little circle animals when diving
        // else if (name === 'MssbTag') {
        //     const m = spawnOArcModel('DesertMusasabi');
        //     const rres = getOArcRRES('DesertMusasabi');
        //     m.bindCHR0(this.animationController, findCHR0(rres, 'DesertMusasabi_dive_loop'));
        //     m.bindPAT0(staticFrame(0), findPAT0(rres, 'DesertMusasabi'));
        //     scaleModelConstant(m, 0.0001);
        // }
        // Gossip Stones (Harp Hints)
        else if (name === 'HrpHint') {
            const bbox = new AABB(-120, -0, -100, 120, 200, 100);
            const type = (params1>>>0x18) & 0x1;
            const m = spawnOArcModel(['GossipStone', 'ShiekahStone'][type]);
            setModelBBox(m, bbox);
        }
        // Little Pots
        else if (name === 'Tubo') {
            const bbox = new AABB(-100, -40, -100, 100, 180, 100);
            const m = spawnModelFromNames('Tubo', 'Tubo0'+['0','1'][params1&1]);
            setModelBBox(m, bbox);
        }
        // Big Pots
        else if (name === 'BigTubo') {
            const bbox = new AABB(-70, -10, -70, 70, 140, 70)
            const m = spawnOArcModel('TuboBig');
            setModelBBox(m, bbox);
        }
        // Barrels
        else if (name === 'Barrel') {
            const bbox = new AABB(-55, -10, -55, 55, 150, 55);
            const type = (params1>>>0)&0xF;
            const modelName = type === 1 ? 'BarrelBomb' : 'Barrel';
            const m = spawnOArcModel(modelName);
            setModelBBox(m, bbox);
            if (type === 1) {
                this.pastModels.push(m);
            }
        }
        // Loftwing Trap
        else if (name === 'TrpBrdW') {
            console.log("Revist TrpBrdW");
            // Should Spawn 4 boards and do some maths to set them
            spawnModelFromNames('BirdTrap', "BirdTrapBoard");
        }
        // Bird Statues
        else if (name === 'saveObj') {
            const m = spawnOArcModel('SaveObject'+['B','A','C'][(params1>>>8)&0xF]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Knight Leader
        else if (name === 'NpcKnld') {
            const bbox = new AABB(-280, -10, -280, 280, 390, 180);
            const rres = getOArcRRES('Lord');
            const m = spawnOArcModel('Lord');
            const swordMdl = spawnModel(rres, "SwordLord");
            this.modelBinds.push({ model: swordMdl, modelToBindTo: m, nodeName: "SwordH"});
            m.bindRRESAnimations(this.animationController, rres, 'Lord_wait');
            m.bindCHR0(this.animationController, mergeCHR0(rres, 'Lord_wait', 'Lord_F_wait'));
            translateModel(m, [0,18,0]);
            setModelBBox(m, bbox);
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
            // No bbox, usually always loaded I guess.
        }
        // Goddess Cubes
        else if (name === 'GodCube') {
            const bbox = new AABB(-100, 0, -100, 100, 200, 100);
            const doDisplay = (params1>>>24) & 0x1;
            if (doDisplay === 0) {
                const m = spawnOArcModel('GoddessCube');
                setModelBBox(m, bbox);
            }
        }
        // Thunderhead Cloud Dome
        else if (name === 'CmCloud') {
            const type = params1&0x1;
            const typeName = 'F020Cloud'+['','Inside'][type];
            const m0 = spawnModelFromNames(typeName,typeName);
            const m1 = spawnModelFromNames(typeName,typeName+'_s');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, calcModelBounds(m0));
            setModelBBox(m1, calcModelBounds(m1));
        }
        // Paintings of Groose And Batreaux
        else if (name === 'Paint') {
            const m = spawnModelFromNames('Paint', 'Paint'+['A','B'][params1&1]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Groose's sandbag
        else if (name === 'Sandbag') {
            const bbox = new AABB(-50, -400, -50, 50, 50, 50);
            const m = spawnOArcModel('DecoC');
            setModelBBox(m, bbox);
        }
        // Clawshot Targets
        else if (name === 'ClawSTg') {
            const bbox = new AABB(-100, -100, -50, 100, 100, 50);
            const m = spawnOArcModel('ShotMark');
            setModelBBox(m, bbox);
        }
        // Under Cloud stuff
        else if (name === 'UdCloud') {
            const bbox = new AABB(-550000, -30000, -500000, 500000, -10000, 500000);
            const m = spawnOArcModel('F020UnderCloud');
            setModelBBox(m, bbox);
        }
        // Viewing Platform in Faron
        else if (name === 'ObjBld') {
            const m = spawnOArcModel('DowsingZoneE300');
            setModelBBox(m, calcModelBounds(m));
        }
        // Faron water
        else if (name === 'WtrF100') {
            const bbox = new AABB(-1400, -100, 6300, 12500, 1800, 17300);
            const rres = getOArcRRES('WaterF100');
            const m0 = spawnModel(rres, 'model0');
            const m1 = spawnModel(rres, 'model1');
            const m2 = spawnModel(rres, 'model2');
            const m3 = spawnModel(rres, 'model3');
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
            setModelBBox(m2, bbox);
            setModelBBox(m3, bbox);
        }
        // Eldins lava
        else if (name === 'LavF200') {
            const m0 = spawnModelFromNames('LavaF200', 'LavaF200');
            const m1 = spawnModelFromNames('LavaF200', 'LavaF200_s');
            m1.passMask = ZSSPass.INDIRECT;
            // No bbox, Always loaded
        }
        // bug island
        else if (name === 'IslIns') {
            const bbox = new AABB(-4700, -2500, -3000, 3300, 1800, 2400);
            const m0 = spawnModelFromNames('IslIns', 'IslIns');
            const m1 = spawnModelFromNames('IslIns', 'IslInsWater00');
            const m2 = spawnModelFromNames('IslIns', 'IslInsWater01');
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
            setModelBBox(m2, bbox);
        }
        // Mogma left over ground spec
        else if (name === 'MoSoil') {
            const bbox = new AABB(-100, -0, -100, 100, 100, 100);
            const m = spawnModelFromNames('MogumaMud', 'MogumaMud');
            setModelBBox(m, bbox);
        }
        // farmland
        else if (name === 'Soil') {
            const bbox = new AABB(-100, -10, -100, 100, 50, 100);
            const m = spawnModelFromNames('MoundShovel', 'MoundShovel');
            setModelBBox(m, bbox);
        }
        // Main platform for isle of songs puzzle
        else if (name === 'PzlLand') {
            const m = spawnModelFromNames('IslPuz', 'IslPuz');
            setModelBBox(m, calcModelBounds(m));
        }
        // Island for Pumpkin soup (Has rainbow)
        else if (name === 'IslNusi') {
            const bbox = new AABB(-4000, -1200, -2700, 4800, 3400, 1700);
            const m0 = spawnModelFromNames('IslNusi', 'IslNusi');
            const m1 = spawnModelFromNames('IslNusi', 'IslNusi_s');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Stone tablets with Text
        else if (name === 'KanbanS') {
            const m = spawnOArcModel('KanbanStone');
            setModelBBox(m, calcModelBounds(m));
        }
        // Wooden logs in Faron
        else if (name === 'Log') {
            const m = spawnOArcModel('Log');
            setModelBBox(m, calcModelBounds(m));
        }
        // Beehives and bees
        else if (name === 'Bee') {
            const m = spawnModelFromNames('Bee', 'home');
            translateModel(m, [0,-100,0]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Isle of Songs puzzle switch
        else if (name === 'SwDir') {
            const bbox = new AABB(-150, -0, -75, 150, 200, 75);
            const m = spawnModelFromNames('SwichThree', 'SwitchThree');
            setModelBBox(m, bbox);
        }
        // Isle of songs main building
        else if (name === 'Utajima') {
            const m0 = spawnModelFromNames('IslSon', 'IslSon');
            const m1 = spawnModelFromNames('IslSon', 'IslSon_s');
            m1.passMask = ZSSPass.INDIRECT;
            setModelBBox(m0, calcModelBounds(m0));
            setModelBBox(m1, calcModelBounds(m1));
        }
        // Sand piles
        else if (name === 'vmSand') {
            const bbox = new AABB(-60 * obj.sx, -50, -60 * obj.sz, 60 * obj.sx, 60 * obj.sy, 60 * obj.sz);
            const m = spawnOArcModel('SandHill');
            setModelBBox(m, bbox);
            this.presentModels.push(m);
        }
        // Wooden Boxes
        else if (name === 'Kibako') {
            const hanging = (params1&0xF) === 1;
            const m = spawnOArcModel('KibakoHang');
            if (hanging) {
                setModelBBox(m, new AABB(-750, -800, -250, 100, 200, 1000));
            } else {
                setModelBBox(m, new AABB(-250, -100, -250, 250, 200, 250));
            }
        }
        // The Stones to use to go to Skywkeep
        else if (name === 'ToD3Stn') {
            const m = spawnModelFromNames('BirdObjD3', 'BirdObjD3A');
            setModelBBox(m, calcModelBounds(m));
        }
        // The lever in beetles shop
        else if (name === 'TerrSw') {
            const m = spawnModelFromNames('TerrySwitch', 'TerrySwitchi');
            setModelBBox(m, calcModelBounds(m));
        }
        // The trapdoor in Beetles shop
        else if (name === 'TerrHol') {
            const m = spawnOArcModel('TerryOtoshiana');
            setModelBBox(m, calcModelBounds(m));
        }
        // The mechanism in beetles shop
        else if (name === 'TerrGmk') {
            const rres = getOArcRRES('TerryGimmick');
            rres.vis0 = []; // Hack as Vis0 seems broken
            const m = spawnModel(rres, 'TerryGimmick');
            setModelBBox(m, calcModelBounds(m));
        }
        // Beedles Shop
        else if (name === 'Tshop') {
            const rres = getOArcRRES('TerryShop');
            if (this.stageId === 'F020') // turns it off at night
                rres.chr0 = [];
            const m0 = spawnModel(rres, 'TerryShop');
            const m1 = spawnModel(rres, 'TerryBell');
            const m2 = spawnModel(rres, 'TerryHaguruma_g');
            setModelBBox(m0, calcModelBounds(m0));
            setModelBBox(m1, calcModelBounds(m1));
            setModelBBox(m2, calcModelBounds(m2));
        }
        else if (name === 'ShpSmpl') {
            const bbox = new AABB(-20, -0, -20, 20, 90, 20);
            const type = params1&0x7F;
            let m : MDL0ModelInstance | null;
            if (![9,10,11,12,13,14,15,16,17,18,19,28,29,30,31,32,33,34].includes(type)){
                let arcModelPair : string[] | null;
                let translateY = 37.0;
                switch(type) {
                    case  0: arcModelPair = ['GetArrow',            'GetArrowBundle'    ]; translateY = 34; break;
                    case  1: arcModelPair = ['GetBombSet',          'GetBombSet'        ]; translateY = 22; break;
                    case  2: arcModelPair = ['GetShieldWood',       'GetShieldWood'     ]; translateY = 40; break;
                    case  3: arcModelPair = ['GetShieldIron',       'GetShieldIron'     ]; translateY = 36; break;
                    case  4: arcModelPair = ['GetShieldHoly',       'GetShieldHoly'     ]; translateY = 40; break;
                    case  5: arcModelPair = ['GetSeedSet',          'GetSeedSet'        ]; translateY = 22; break;
                    case  6: arcModelPair = ['GetSpareSeedA',       'GetSpareSeedA'     ]; translateY = 23; break;
                    case  7: arcModelPair = ['GetSpareQuiverA',     'GetSpareQuiverA'   ]; translateY = 30; break;
                    case  8: arcModelPair = ['GetSpareBombBagA',    'GetSpareBombBagA'  ]; translateY = 27; break;
                    case 20: arcModelPair = ['GetPouchB',           'GetPorchB'         ]; break;
                    case 21: arcModelPair = ['GetPouchB',           'GetPorchB'         ]; break;
                    case 22: arcModelPair = ['GetPouchB',           'GetPorchB'         ]; break;
                    case 23: arcModelPair = ['GetHeartKakera',      'GetHeartKakera'    ]; break;
                    case 24: arcModelPair = ['GetSparePurse',       'GetSparePurse'     ]; break;
                    case 25: arcModelPair = ['GetNetA',             'GetNetA'           ]; break;
                    case 26: arcModelPair = ['GetMedal',            'GetMedalLife'      ]; break;
                    case 27: arcModelPair = ['GetMedal',            'GetMedalReturn'    ]; break;
                }
                const m = spawnModelFromNames(arcModelPair![0], arcModelPair![1]);
                translateModel(m, [0, translateY, 0]);
                scaleModelConstant(m, 1.7);
                setModelBBox(m, bbox);
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
            // no bbox set
        }
        // Fire TODO -> put fire effect in when JPA is implemented
        else if (name === 'Fire') {
            const bbox = new AABB(-70, -50, -70, 70, 200, 70);
            const type = params1 & 0xF;
            if (type !== 1) {
                const arcName = 'Candle0'+['0','0','1','2'][type];
                const modelName = 'Candle'+['','','01','02'][type];
                const m = spawnModelFromNames(arcName, modelName);
                setModelBBox(m, bbox);
            }
            console.info('Revist Fire Later');
        }
        // Gondos Repair object, theres also a B variant
        else if (name === 'JunkRep') {
            const bbox = new AABB(-30, -0, -20, 30, 120, 20);
            const m = spawnModelFromNames('Junk', 'JunkRepairobject');
            setModelBBox(m, bbox);
        }
        // Chef NPC in bazaar
        else if (name === 'NpcChef'){
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('Chef');
            const chr = mergeCHR0(rres, 'Chef_wait', 'Chef_F_wait');
            spawnModel(rres, 'ChefPot');
            const m = spawnModel(rres, 'Chef');
            m.bindCHR0(this.animationController, chr);
            m.bindSRT0(this.animationController, findSRT0(rres, 'Chef_wait'));
            setModelBBox(m, bbox);
        }
        // Place for stone tablets in goddess statue
        else if (name === 'SndStn') {
            const bbox = new AABB(-75, -15, -75, 75, 105, 75);
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
            setModelBBox(stand, bbox);
            setModelBBox(emerald, bbox);
            setModelBBox(ruby, bbox);
            setModelBBox(amber, bbox);
            setModelBBox(crest, bbox);
        }
        // Batreaux Human
        else if (name === 'NpcAkuH') {
            const bbox = new AABB(-150, -50, -150, 150, 300, 150);
            const m = spawnOArcModel('DevilB');
            const chr = mergeCHR0(getOArcRRES('Devil'), 'Devil_wait', 'Devil_F_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // bigger dude chilling in bazaar... Called SoManD what other way to describe
        else if (name === 'NpcSMnD') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('SoManD');
            const m = spawnOArcModel('SoManD');
            const chr = mergeCHR0(rres, 'SoManD_wait', 'SoManD_F_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Other older dude sitting in bazaar
        else if (name === 'NpcSMnE') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('SoManE');
            const m = spawnOArcModel('SoManE');
            const chr = mergeCHR0(rres, 'SoManE_wait', 'SoManE_F_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Broken Robot in bazaar
        else if (name === 'NpcSlRp') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const m = spawnOArcModel('DesertRobotN');
            setModelBBox(m, bbox);
        }
        // Keese
        else if (name === 'EKs') {
            const bbox = new AABB(-250, -800, -250, 250, 250, 250);
            const type = params1&0x7;
            const arcName = ['Kiesu','Kiesu_fire','Kiesu_electric','KiesuDevil'][type];
            const mdlName = ['kiesu','F_kiesu','EKiesu','DKiesu'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            m.bindPAT0(this.animationController, findPAT0(getOArcRRES(arcName), 'blink_1'));
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Kiesu_anime'), 'fly'));
            translateModel(m, [0,-30,0]);
            setModelBBox(m, bbox);
        }
        // Sword Pedestal
        else if (name === 'SwrdSt') {
            const bbox = new AABB(-75, -10, -75, 75, 200, 75);
            const m = spawnOArcModel(['SwordSeal','SwordGrd'][params1&1]);
            setModelBBox(m, bbox);
        }
        // Goddess Crest (Switch Sword Beam)
        else if (name === 'SwSB') {
            const bbox = new AABB(-100, -50, -50, 100, 55, 50);
            const m = spawnOArcModel('GoddessSymbolSc');
            translateModel(m, [0,90,0]);
            setModelBBox(m, bbox);
        }
        // Chandelier
        else if (name === 'Chandel') {
            const bbox = new AABB(-400, -1500, -400, 400, 100, 400);
            const m = spawnModelFromNames('Stage', 'StageF011rChanAft');
            setModelBBox(m, bbox);
        }
        // Pumpkin Master (Pumm)
        else if (name === 'NpcPma') {
            const bbox = new AABB(-200, -100, -200, 200, 300, 200);
            const rres = getOArcRRES('PumpkinMaster');
            const m = spawnModel(rres, 'PumpkinMaster');
            const chr = mergeCHR0(rres, 'PumpkinMaster_wait', 'PumpkinMaster_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'PumpkinMaster');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Fledge - Pumpkin Archery Minigame
        else if (name === 'NpcPcs') {
            const bbox = new AABB(-100, -10, -100, 100, 200, 100);
            const rres = getOArcRRES('FriendA');
            const m = spawnModel(rres, 'FriendA');
            const chr = mergeCHR0(rres, 'FriendA_wait', 'FriendA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'FriendA');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // NPCs on Skyloft Bridge during layer 10
        else if (name === 'NpcDoML') {
            const bbox = new AABB(-250, -100, -300, 200, 200, 200);
            const rres = getOArcRRES('DouguyaMotherLOD');
            const m = spawnModel(rres, 'DouguyaMotherLOD');
            const chr = mergeCHR0(rres, 'DouguyaMotherLOD_wait', 'DouguyaMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'DouguyaMotherLOD');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        else if (name === 'NpcJkML') {
            const bbox = new AABB(-200, -100, -200, 200, 200, 200);
            const rres = getOArcRRES('JunkMotherLOD');
            const m = spawnModel(rres, 'JunkMotherLOD');
            const chr = mergeCHR0(rres, 'JunkMotherLOD_wait', 'JunkMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'JunkMotherLOD');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        else if (name === 'NpcSAML') {
            const bbox = new AABB(-200, -100, -200, 200, 200, 200);
            const rres = getOArcRRES('SenpaiAMotherLOD');
            const m = spawnModel(rres, 'SenpaiAMotherLOD');
            const chr = mergeCHR0(rres, 'SenpaiAMotherLOD_wait', 'SenpaiAMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SenpaiAMotherLOD');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Boy who bonks into tree for Bug
        else if (name === 'NpcSoBo') {
            const bbox = new AABB(-100, -50, -100, 100, 200, 100);
            const rres = getOArcRRES('SoBoyA');
            const m = spawnModel(rres, 'SoBoyA');
            const chr = mergeCHR0(rres, 'SoBoyA_wait', 'SoBoyA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SoBoyA');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Orielle
        else if (name === 'NpcSowo') {
            const bbox = new AABB(-185, -10, -185, 185, 260, 185);
            const rres = getOArcRRES('SoWoManA');
            const m = spawnModel(rres, 'SoWomanA');
            const chr = mergeCHR0(rres, 'SoWomanA_wait', 'SoWomanA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SoWoManA');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Zelda
        else if (name === 'NpcZld') {
            const bbox = new AABB(-200, -100, -200, 200, 300, 200);
            const body_rres = getOArcRRES('Zelda');
            const body_mdl = spawnModel(body_rres, 'Zelda_body'); 
            
            const face_rres = getOArcRRES('Zelda_face');
            const face_mdl = spawnModel(face_rres, 'Zelda_face'); 
            
            const hair_rres = getOArcRRES('Zelda_hair');
            const hair_mdl = spawnModel(hair_rres, 'Zelda_hair'); 

            const handl_rres = getOArcRRES('Zelda_handL');
            const handl_mdl = spawnModel(handl_rres, 'Zelda_handL'); 

            const handr_rres = getOArcRRES('Zelda_handR');
            const handr_mdl = spawnModel(handr_rres, 'Zelda_handR'); 

            setModelBBox(face_mdl, bbox);
            setModelBBox(body_mdl, bbox);
            setModelBBox(hair_mdl, bbox);
            setModelBBox(handl_mdl, bbox);
            setModelBBox(handr_mdl, bbox);

            this.modelBinds.push({ model: face_mdl, modelToBindTo: body_mdl, nodeName: "Head"});
            this.modelBinds.push({ model: hair_mdl, modelToBindTo: body_mdl, nodeName: "Head"});
            this.modelBinds.push({ model: handl_mdl, modelToBindTo: body_mdl, nodeName: "HandL"});
            this.modelBinds.push({ model: handr_mdl, modelToBindTo: body_mdl, nodeName: "HandR"});
            
            // Bind All default Anms
            body_mdl.bindRRESAnimations(this.animationController, body_rres, 'Zelda');
            face_mdl.bindRRESAnimations(this.animationController, face_rres, 'Zelda');
            hair_mdl.bindRRESAnimations(this.animationController, hair_rres, 'Zelda');
            handl_mdl.bindRRESAnimations(this.animationController, handl_rres, 'Zelda');
            handr_mdl.bindRRESAnimations(this.animationController, handr_rres, 'Zelda'); 
            
            // Zelda Caring for Loftwing
            if (this.stageId === 'F000' && this.currentLayer === 1 && obj.id === 0xFDC5) {
                body_mdl.bindRRESAnimations(this.animationController, body_rres, 'Zelda_care');
                face_mdl.bindRRESAnimations(this.animationController, face_rres, 'Zelda_face_F_care');
                hair_mdl.bindRRESAnimations(this.animationController, hair_rres, 'Zelda_care_Hair');
                handl_mdl.bindRRESAnimations(this.animationController, handl_rres, 'Zelda_care_HandL');
                handr_mdl.bindRRESAnimations(this.animationController, handr_rres, 'Zelda_care_HandR');
            }
            // Default to override on Wait
            else {
                body_mdl.bindRRESAnimations(this.animationController, body_rres, 'Zelda_wait');
                face_mdl.bindRRESAnimations(this.animationController, face_rres, 'Zelda_face_F_wait');
                hair_mdl.bindRRESAnimations(this.animationController, hair_rres, 'Zelda_wait_Hair');
                handl_mdl.bindRRESAnimations(this.animationController, handl_rres, 'Zelda_wait_HandL');
                handr_mdl.bindRRESAnimations(this.animationController, handr_rres, 'Zelda_wait_HandR');
            }
        }
        // Zelda's Loftiwng
        else if (name === 'NpcBdz') {
            const bbox = new AABB(-300, -0, -300, 300, 200, 300);
            const m = spawnModelFromNames('BirdZelda', 'BirdZelda');
            setModelBBox(m, bbox);
            if (this.stageId === 'F000') {
                if (this.currentLayer === 10) {
                    m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Glide'));
                } else if (this.currentLayer === 1) {
                    m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Down'));
                }
            }
        }
        // Pipit
        else if (name === 'NpcSenp') {
            const bbox = new AABB(-260, -10, -260, 260, 350, 260);
            const rres = getOArcRRES('SenpaiA');
            const m = spawnModel(rres, 'SenpaiA');
            const chr = mergeCHR0(rres, 'SenpaiA_wait', 'SenpaiA_F_wait');

            const sword_mdl = spawnModel(rres, 'SwordSenpaiA');
            this.modelBinds.push({ model: sword_mdl, modelToBindTo: m, nodeName: "SwordW"});

            m.bindRRESAnimations(this.animationController, rres, 'SenpaiA');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
            setModelBBox(sword_mdl, bbox);
        }
        // Knight on Loftwing to rescue link when falling off island
        // else if (name === 'NpcResc') {
        //      console.log("Revisit NpcResc");
        // }
        // // Birds
        // else if (name === 'NpcBird') {
        //     console.log("Revisit NpcBird");
        // }
        // Random Npcs
        else if (name === 'NpcSma2') {
            const bbox = new AABB(-150, -100, -150, 150, 300, 150);
            const m = spawnOArcModel('SoManB');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManB_sit'),'SoManB_sit_wait'));
            setModelBBox(m, bbox);
        }
        else if (name === 'NpcSma3') {
            const bbox = new AABB(-150, -100, -150, 150, 300, 150);
            const m = spawnOArcModel('SoManC');
            if (this.stageId !== 'F000')
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_sit'),'SoManC_sit_wait'));
            else
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_stand'),'SoManC_stand_wait'));
            setModelBBox(m, bbox);
        }
        // Little Girl
        else if (name === 'NpcSoG') {
            const bbox = new AABB(-100, -10, -100, 100, 150, 100);
            const rres = getOArcRRES('SoGirl');
            const m = spawnOArcModel('SoGirl');
            const chr = mergeCHR0(rres, 'SoGirl_wait', 'SoGirl_F_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Eye Dude
        else if (name === 'NpcSha') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('Uranaiya');
            const m = spawnOArcModel('Uranaiya');
            const chr = mergeCHR0(rres, 'Uranaiya_wait', 'Uranaiya_F_wait');
            const pat = findPAT0(rres, 'Uranaiya');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
            setModelBBox(m, bbox);
        }
        // Crystal Ball
        else if (name === 'DivCrst') {
            const bbox = new AABB(-50, -50, -50, 50, 50, 50);
            const type = params1&0xF;
            if (!(this.stageId === 'F013r' && this.currentLayer === 0)) {
                const m = spawnOArcModel('F004rCrystalWell');
                if (this.stageId === 'F200') {
                    scaleModel(m, [2, 2, 2]);
                }
                setModelBBox(m, bbox);
            }
        }
        // Pipets mom
        else if (name === 'NpcSAMo') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('SenpaiAMother');
            const m = spawnOArcModel('SenpaiAMother');
            const chr = mergeCHR0(rres, 'SenpaiAMother_wait', 'SenpaiAMother_F_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Dust Piles
        else if (name === 'VacuDst') {
            const m = spawnModelFromNames('Stage', 'VacuumDust')
            translateModel(m, [0, 1, 0]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Dust Piles
        else if (name === 'VacuDsP') {
            const type = params1&0xF;
            const m = spawnModelFromNames('Stage', 'StageVacDusParts'+['A','B','C','D','E'][type]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Pink Key Parella
        else if (name === 'NpcSui') {
            const bbox = new AABB(-50, -10, -50, 50, 150, 50);
            const m = spawnOArcModel('SuiseiBoss');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
            setModelBBox(m, bbox);
        }
        // Parallela
        else if (name === 'NpcSuiS' || name === 'NpcSuiN') {
            const bbox = new AABB(-50, -10, -50, 50, 150, 50);
            const m = spawnOArcModel('Suisei');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
            setModelBBox(m, bbox);
        }
        // Water nuts
        else if (name === 'WatrIga'){
            const bbox = new AABB(-80, -560, -60, 80, 60, 60);
            const m = spawnOArcModel('NeedleBallWater');
            setModelBBox(m, bbox);
        }
        // Whip Swing things
        else if (name === 'TPole'){
            const bbox = new AABB(-0, -120, -110, 500, 140, 110);
            const m = spawnOArcModel('WhipBar');
            setModelBBox(m, bbox);
        }
        // The horizontal spin switches for the whip
        else if (name === 'BulbSW'){
            const bbox = new AABB(-100, -170, -100, 100, 100, 100);
            const m = spawnOArcModel('SwitchValve');
            setModelBBox(m, bbox);
        }
        // Vertixal whip levers
        else if (name === 'sw_whip'){
            const bbox = new AABB(-300, -0, -100, 300, 400, 100);
            const m = spawnOArcModel('SwitchWhip');
            setModelBBox(m, bbox);
        }
        // StalMaster (jannon :D )
        else if (name === 'ESf4') {
            const bbox = new AABB(-200, -75, -200, 200, 250, 200);
            const rres = getOArcRRES('Sf4');
            const m = spawnModel(rres, 'Stalfos4');
            const mA = spawnModel(rres, 'Sf4SwordA');
            const mB = spawnModel(rres, 'Sf4SwordB');
            const mC = spawnModel(rres, 'Sf4SwordC');
            const mD = spawnModel(rres, 'Sf4SwordD');

            this.modelBinds.push({ model: mA, modelToBindTo: m, nodeName: "loc_SwordA"});
            this.modelBinds.push({ model: mB, modelToBindTo: m, nodeName: "loc_SwordB"});
            this.modelBinds.push({ model: mC, modelToBindTo: m, nodeName: "loc_SwordC"});
            this.modelBinds.push({ model: mD, modelToBindTo: m, nodeName: "loc_SwordD"});

            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
            scaleModelConstant(m, 1.3);
            setModelBBox(m, bbox);
            setModelBBox(mA, bbox);
            setModelBBox(mB, bbox);
            setModelBBox(mC, bbox);
            setModelBBox(mD, bbox);
        }
        // Direction Switches
        else if (name === 'SwDir2') {
            const bbox = new AABB(-100, -10, -100, 100, 250, 100);
            const m = spawnOArcModel('SwitchDirect');
            rotateModel(m, [Math.PI/2, 0,0]);
            translateModel(m, [0,150,-100]);
            setModelBBox(m, bbox);
        }
        // Wall Switches (the bar where you can usually run up the wall)
        else if (name === 'SwWall') {
            const bbox = new AABB(-100, -50, -50, 100, 50, 50);
            const m = spawnOArcModel('SwitchWall');
            setModelBBox(m, bbox);
        }
        // Cursed Bokos
        else if (name === 'EBcZ') {
            const bbox = new AABB(-150, -150, -150, 150, 250, 230);
            const rres = getOArcRRES('Bocoburin_Z');
            const m = spawnModel(rres, 'bocoburin_Z');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait0'));
            setModelBBox(m, bbox);
        }
        // Tower Hands
        else if (name === 'TowerHa') {
            const bbox = new AABB(-1000, 0, -600, 1000, 1000, 1000);
            const m = spawnOArcModel('TowerHandD101');
            if (params1&1) {
                // Need to mirror the hand
                scaleModel(m, [-1, 1, 1]);
                m.shapeInstances.forEach((shp) => {
                    shp.materialInstance.materialHelper.megaStateFlags.frontFace = GfxFrontFaceMode.CCW;
                });
            }
            setModelBBox(m, bbox);
        }
        // Tower Gears
        else if (name === 'TGrD101') {
            const m = spawnOArcModel('TowerGearD101');
            setModelBBox(m, calcModelBounds(m));
        }
        // Furnix
        else if (name === 'EHidory') {
            const bbox = new AABB(-270, -1000, -600, 270, 200, 1000);
            const rres = getOArcRRES('Hidory');
            const m = spawnModel(rres, 'Hidory');
            m.bindCHR0(this.animationController, findCHR0(rres, 'hovering'));
            setModelBBox(m, bbox);
        }
        // Staltula
        else if (name === 'Est') {
            const bbox = new AABB(-100, -100, -100, 100, 200, 100);
            const rres = getOArcRRES('Staltula');
            const m = spawnModel(rres, 'Stalchula');
            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
            setModelBBox(m, bbox);
        }
        // Remlits
        else if (name === 'ERemly') {
            const bbox = new AABB(-150, -700, -150, 150, 150, 150);
            const rres = getOArcRRES('Remly');
            const m = spawnModel(rres, 'Remly'); 
            m.bindCHR0(this.animationController, findCHR0(rres, 'RemlySleep'));
            m.bindPAT0(this.animationController, findPAT0(rres, 'RemlyWink'));
            setModelBBox(m, bbox);
        }
        // Waterfalls in Ancient Cistern
        else if (name === 'wfall') {
            let bbox = new AABB();
            const type = (params1 >>> 28) & 0xF
            if (type !== 0){
                if (type === 1) {
                    bbox.set(-500, -1700, -1200, 500, 1700, 1200);
                } else if (type === 2) {   
                    bbox.set(-500, -1000, -2200, 500, 1000, 2200);
                } else if (type === 3) {   
                    bbox.set(-600, -700, -400, 600, 600, 1000);
                }
                const rres = getOArcRRES('WaterfallD101');
                const m = spawnModel(rres, 'WaterfallD101'+['A','B','C'][type-1]);
                if (type === 1) {
                    m.bindCLR0(staticFrame(0), findCLR0(rres, "WaterfallD101A"));
                }
                else if (type === 3) {
                    m.bindSRT0(this.animationController, findSRT0(rres, "WaterfallD101C_Out"));
                }
                setModelBBox(m, bbox);
            }
        }
        else if (name === "FrtTree") {
            const type = params1 & 0xFF;
            if (type === 0) {
                const bbox = new AABB(-400, -0, -400, 400, 800, 400);
                const m = spawnModelFromNames('Stage', 'StageF302Wood');
                this.presentModels.push(m);
                setModelBBox(m, bbox)
            } else {
                const bbox = new AABB(-700, -0, -700, 700, 1200, 700);
                const m = spawnModelFromNames('Stage', 'StageF402Wood');
                setModelBBox(m, bbox)
            };
        }
        // Fruit
        else if (name === 'fruit') {
            let bbox = new AABB();
            const type = params1 & 0xFF;
            if (type === 0) {
                bbox.set(-400, -0, -400, 400, 800, 400);
            } else {
                bbox.set(-700, -0, -700, 700, 1200, 700);
            }
            const m = spawnOArcModel('FruitA');
            setModelBBox(m, bbox);
        }
        // Sunlight beams in Faron
        else if (name === 'Light00') {
            // This actor is technically supported for DowsingZoneE300, 
            // but that variant doesnt exist ever.
            const m = spawnOArcModel('Light00');
            setModelBBox(m, calcModelBounds(m));
        }
        // End Boss Doors to Springs
        else if (name === 'SldDoor') {
            const rres = getOArcRRES('SB'+['Din','Ferore','Nayru','Goodess'][params1&0xF]);
            const m = spawnModel(rres, 'ShutterBoss');
            const animRres = getOArcRRES('SBAnm');
            m.bindCLR0(this.animationController, findCLR0(animRres, 'ShutterBossSealWink'));
            setModelBBox(m, calcModelBounds(m));
        }
        // Skulls that can spawn drops
        else if (name === 'skull') {
            const bbox = new AABB(-50, -10, -50, 50, 70, 50);
            const m = spawnModelFromNames('Skull', 'BocoBone02');
            setModelBBox(m, bbox);
        }
        // Lotus Flowers
        else if (name === 'LtsFlwr') {
            const bbox = new AABB(-150, -50, -150, 200, 100, 150);
            const type = params1&1;
            const arc = ['LotusFlower','LotusSeed'][type];
            const mdl = ['LotusFlower', 'LotusSeedCut'][type];
            const m = spawnModelFromNames(arc, mdl);
            setModelBBox(m, bbox);
        }
        // Water Logs
        else if (name === 'LogWtr') {
            const type = params1 & 1;
            const m = spawnOArcModel(['LogFloat','LogStep'][type]);
            if (type === 1)
                translateModel(m, [0,500,0]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Cistern Boss Door
        else if (name === 'BDrD101') {
            const bbox = new AABB(-1300, -50, -1000, 1300, 100, 1000);
            const m0 = spawnOArcModel('DoorBossD101');
            const m1 = spawnOArcModel('DoorBossD101');
            rotateModel(m1, [Math.PI, 0, Math.PI]);
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Cistern Tower
        else if (name === 'ftower') {
            const bbox = new AABB(-1500, -2500, -1400, 1500, 6000, 1800);
            const m = spawnOArcModel('TowerD101');
            setModelBBox(m, bbox);
        }
        // Crystal Switches
        else if (name === 'Swhit') {
            const bbox = new AABB(-150, -90, -65, 150, 300, 65);
            const rres = getOArcRRES('SwitchHit');
            const m0 = spawnModel(rres, 'SwitchHitBase');
            const m1 = spawnModel(rres, 'SwitchHit');
            m1.bindSRT0(this.animationController, findSRT0(rres, 'SwitchHit_kirari'));
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
        }
        // Wooden Boards to break
        else if (name === 'WdBoard') {
            const bbox = new AABB(-210, -10, -40, 210, 410, 40);
            const m0 = spawnModelFromNames('BreakBoard', 'BreakBoardA');
            const m1 = spawnModelFromNames('BreakBoard', 'BreakBoardB');
            setModelBBox(m0, bbox);
            setModelBBox(m1, bbox);
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
            setModelBBox(m, calcModelBounds(m));
        }
        // Small Goddess Statues
        else if (name === 'SngGS') {
            const statue = spawnOArcModel('GoddessStatue');
            const crest = spawnOArcModel('GoddessSymbolSc');
            const node = this.findNode(statue, 'SetGS')!;
            mat4.translate(node.modelMatrix, node.modelMatrix, [0, 90, 0]);
            this.modelBinds.push({model: crest, modelToBindTo: statue, nodeName: 'SetGS'});
            setModelBBox(statue, calcModelBounds(statue));
            setModelBBox(crest, calcModelBounds(crest));
        }
        // Ancient Jwls (Treasure)
        else if (name === 'AncJwls'){
            const bbox = new AABB(-50, -50, -50, 50, 50, 50);
            const type = params1 & 0xF;
            const arcName = 'GetSozai'+['H','G','P'][type];
            const m = spawnOArcModel(arcName);
            const scale = [2,2,1.365][type];
            scaleModelConstant(m, scale);
            setModelBBox(m, bbox);
        }
        // Iron Fences
        else if (name === 'FenceIr') {
            const type = (params1>>>16)&1;
            const m = spawnOArcModel('FenceIron'+['','Small'][type]);
            setModelBBox(m, calcModelBounds(m));
        }
        // Octarock
        else if (name === 'EOr') {
            const bbox = new AABB(-80, -80, -80, 80, 80, 80);
            const rres = getOArcRRES('Or');
            spawnModel(rres, 'octarock_hole');
            const m = spawnModel(rres, 'octarock');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait'));
            setModelBBox(m, bbox);
        }
        // Dungeon Doors Entrances
        else if (name === 'DoorDun') {
            const bbox = new AABB(-600, -0, -300, 600, 600, 300);
            const type = params1 & 0xF;
            const arcName = ['Entrance1B', 'DoorGate', 'Entrance1A', 'DoorWater'][type];
            const mdlName = ['Entrance1B', 'DoorGate_Open', 'Entrance1A', 'DoorWater'][type];
            const chrName = ['LockOpen', 'OpenDoor', 'OpenDoor', 'OpenDoor'][type]
            const rres = getOArcRRES(arcName);
            const m = spawnModel(rres, mdlName);
            m.bindCHR0(this.animationController, findCHR0(rres, chrName));
            setModelBBox(m, bbox);
        }
        // Carryable Stones
        else if (name === 'CyStone') {
            const bbox = new AABB(-30, -30, -30, 30, 30, 30);
            const type = params1 & 0xF;
            const arcName = ['RockCarrySmall','RockCarryMiddle','RockCarryMiddle','Syako_egg'][type];
            const mdlName = ['RockSmall','RockMiddle','RockMiddle','SyakoEgg'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            if (type === 1 || type === 2)
                translateModel(m, [0,75,0]);

            if (type === 1) {
                bbox.set(-70, -70, -70, 70, 70, 70);
            } else if (type === 2) {
                bbox.set(-95, -95, -95, 95, 95, 95);
            }
            setModelBBox(m, bbox);
        }
        // Little spikey balls
        else if (name === 'RopeIga'){
            const bbox = new AABB(-50, -50, -50, 50, 50, 50);
            const m = spawnOArcModel('NeedleBall');
            translateModel(m, [0,15,0]);
            setModelBBox(m, bbox);
        }
        // Froaks
        else if (name === 'EGeko'){
            const bbox = new AABB(-50, -50, -50, 50, 50, 50);
            const rres = getOArcRRES('Geko');
            const m = spawnModel(rres, 'Geko');
            const chr = findCHR0(rres,'run');
            const pat = findPAT0(rres, 'GekoWink');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
            setModelBBox(m, bbox);
        }
        // Deku Baba
        else if (name === 'Ehb') {
            const bbox0 = new AABB(-100, -100, -100, 100, 100, 100);
            const bbox1 = new AABB(-200, -200, -200, 200, 200, 200);
            const type = (params1 >> 3) & 0x3;
            const rres = getOArcRRES('Degubaba');
            const m0 = spawnModel(rres, 'degubaba_leaf');
            const newAnim = staticFrame([0, 0, 1, 1][type]);
            const m1 = spawnModel(rres, 'degubaba_head');
            m0.bindPAT0(newAnim, findPAT0(rres, 'degubaba_leaf'));
            m1.bindPAT0(newAnim, findPAT0(rres, 'degubaba_head'));
            rotateModel(m0, [-Math.PI/2, 0, 0]);
            m0.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
            rotateModel(m1, [-Math.PI/2, 0, 0]);
            m1.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
            setModelBBox(m0, bbox0);
            setModelBBox(m1, bbox1);
        }
        // The Wall of water to keep you in bounds in Flooded Faron
        // Water Shield
        else if (name === 'WtrShld'){
            const bbox = new AABB(-12000, -2000, -14000, 12000, 11000, 12000);
            const m = spawnOArcModel('WaterWallF103');
            console.info('Look Into WtrShld rendering (cuts off on angles)');
            setModelBBox(m, bbox);
        }
        // Various Kikwis
        // Bucha
        else if (name === 'NpcKyuE') {
            const bbox = new AABB(-300, -60, -250, 300, 400, 500);
            const rres = getOArcRRES('ForestManOld');
            const m = spawnModel(rres, 'ForestManOld');
            const chr = findCHR0(rres, 'ForestManOld_wait');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeafOld_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            this.modelBinds.push({model: leaf, modelToBindTo: m, nodeName: "Tail"});
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
            setModelBBox(leaf, bbox);
        }
        // Machi
        else if (name === 'Npckyu1') {
            const bbox = new AABB(-510, -10, -510, 510, 730, 510);
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
            setModelBBox(body, bbox);
            setModelBBox(eyes, bbox);
            setModelBBox(hair, bbox);
            setModelBBox(leaf, bbox);
        }
        // Yerbal
        else if (name === 'NpcKyuW') {
            const bbox = new AABB(-230, -10, -230, 230, 315, 230);
            const rres = getOArcRRES('ForestManWiz');
            const m = spawnModel(rres, 'ForestManWiz');
            const chr = findCHR0(rres, 'ForestManWiz_wait');
            m.bindCHR0(this.animationController, chr);
            setModelBBox(m, bbox);
        }
        // Oolo
        else if (name === 'NpcOKyu') {
            const bbox = new AABB(-510, -10, -510, 510, 730, 510);
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
            setModelBBox(body, bbox);
            setModelBBox(eyes, bbox);
            setModelBBox(hair, bbox);
            setModelBBox(leaf, bbox);
        }
        // Lopsa
        else if (name === 'Npckyu3') {
            const bbox = new AABB(-510, -10, -510, 510, 730, 510);
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
            setModelBBox(body, bbox);
            setModelBBox(eyes, bbox);
            setModelBBox(hair, bbox);
            setModelBBox(leaf, bbox);
        }
        // Erla
        else if (name === 'Npckyu4') {
            const bbox = new AABB(-510, -10, -510, 510, 730, 510);
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
            setModelBBox(body, bbox);
            setModelBBox(eyes, bbox);
            // setModelBBox(hair, bbox);
            setModelBBox(leaf, bbox);
        }
        // Eldin Volcano Eruption Smoke
        else if (name === 'Smoke') {
            const type = params1&0x3;
            spawnOArcModel(['SmokeF200', 'SmokeF202'][type]);
            // no bbox
        }
        // Raise And Lowerable floors (magma rocks?)
        else if (name === 'SnkFlrF') {
            const type = params1 & 0xF;
            const arcName = (type !== 3) ? 'SinkRock' : 'FWRockA';
            const mdlName = ['SinkRockC', 'SinkRockB', 'SinkRockA', 'FWRockA'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            setModelBBox(m, calcModelBounds(m));
        }
        // Eldin Wooden Towers
        else if (name === 'TowerB') {
            const bbox = new AABB(-800, -1000, -1500, 800, 1700, 750);
            const type = (params1 >>> 16) & 0xF;
            const arcName = ['TowerBomb', 'TowerLight'][type];
            const mdlName = ['TowerBomb01', 'TowerLight'][type];
            const rres = getOArcRRES(arcName);
            const legs = spawnModel(rres, 'TowerBomb00'); // Little Legs
            const m = spawnModel(rres, mdlName); // Main Tower
            const chr = findCHR0(rres, 'Falldown');
            if ((params1&0xFF) === 0xFF)
                m.bindCHR0(this.animationController, chr);
            if (type === 1){
                const m2 = spawnModel(rres, 'FX_TowerLight');
                m2.bindCLR0(this.animationController, findCLR0(rres, 'FX_TowerLight'));
                setModelBBox(m2, bbox);
            }
            setModelBBox(legs, bbox);
            setModelBBox(m, bbox);
        }
        // Propeller
        else if (name === 'Propera') {
            const bbox = new AABB(-150, 150, -150, 150, -150, 150);
            const m = spawnOArcModel('Pinwheel');
            rotateModel(m, [-Math.PI/2, 0, 0]);
            setModelBBox(m, bbox);
        }
        // Pyrup Shells
        else if (name === 'EHidoS') {
            const bbox = new AABB(-200, -100, -200, 200, 200, 200);
            const type = ((params1&0xF) !== 0x0) ? 'BoneA' : 'BoneB';
            const m = spawnModelFromNames('HidokariS', type);
            setModelBBox(m, bbox);
        }
        // Boulders
        else if (name === 'RolRock') {
            const decideType = (params1 >>> 12) & 0xF;
            let type = decideType;
            let m;
            if (decideType === 0xb) type = 6;
            if ([9,10].includes(type)) type = 4;
            if ([0,4].includes(type)) m = spawnOArcModel('RockRollA');
            else m = spawnOArcModel('RockRollB');
            setModelBBox(m, calcModelBounds(m));
        }
        // Bone Bridges
        else if (name === 'BrgBn') {
            const m = spawnOArcModel('BoneBridge');
            setModelBBox(m, new AABB(-1000, -100, -400, 0, 150, 320));
        }
        // Extendable Bridges
        else if (name === 'BridgeB') {
            const m = spawnOArcModel('BridgeSwitch');
            translateModel(m, [0, 0, 800]);
            setModelBBox(m, new AABB(-210, -110, -10, 210, 10, 1080));
        }
        // Floor Switches
        else if (name === 'Sw') {
            const type = params1&0xF;
            const arcName = 'SwitchStep'+['A','B','B'][type];
            const m = spawnOArcModel(arcName);
            scaleModel(m, [1 ,0.8, 1]);
            setModelBBox(m, new AABB(-90, -10, -90, 90, 70, 90));
        }
        // Fences in Eldin
        else if (name === 'FenceBk') {
            const m = spawnOArcModel('FenceBoko');
            setModelBBox(m, new AABB(-210, -10, -20, 210, 340, 20));
        }
        // Closed Bazaar entrances
        else if (name === 'MoleCvr') {
            const bbox = new AABB(-1900, -1100, -5500, 100, 1700, -1800);
            const m = spawnModelFromNames('Stage', "StageF000MallCover");
            setModelBBox(m, bbox);
        }
        // Skyloft Bell
        else if (name === 'Bell') {
            const bbox = new AABB(-160, -320, -160, 160, 10, 160);
            const m = spawnModelFromNames('Stage', "StageF000Bell");
            setModelBBox(m, bbox);
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
            setModelBBox(m, new AABB(-100, -10, -100, 100, 250, 100));
            setModelBBox(hair, new AABB(-100, -10, -100, 100, 250, 100));
        }
        // Mogmas
        else if (name === 'NpcMoT2') {
            const bbox = new AABB(-100, -10, -100, 100, 200, 100);
            const rres = getOArcRRES('MogumaDungeonB');
            const m = spawnModel(rres, 'MogumaDungeonB');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translateModel(m, [0,-75,0]);
            setModelBBox(m, bbox);
        }
        else if (name === 'NpcMoT') {
            const bbox = new AABB(-100, -10, -100, 100, 200, 100);
            const rres = getOArcRRES('MogumaDungeonA');
            const m = spawnModel(rres, 'MogumaDungeonA');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translateModel(m, [0,-75,0]);
            setModelBBox(m, bbox);
        }
        // Old Mogma
        else if (name === 'NpcMoEl') {
            const bbox = new AABB(-100, -0, -100, 100, 200, 100);
            const rres = getOArcRRES('MogumaOld');
            const m = spawnModel(rres, 'MogumaOld');
            // const chr = mergeCHR0(getOArcRRES('Moguma'), 'Moguma_wait', 'Moguma_F_wait');
            // m.bindCHR0(this.animationController, chr);
            translateModel(m, [0,-75,0]);
            setModelBBox(m, bbox);
        }
        else if (name === 'EHidoK') {
            const bbox = new AABB(-200, -100, -200, 200, 200, 200);
            const rres = getOArcRRES('Hidokari');
            const m = spawnModel(rres, 'Hidokari');
            m.bindRRESAnimations(this.animationController, rres, 'WaitA');
            setModelBBox(m, bbox);
        }
        // Beedle
        else if (name === 'NpcTer') {
            // on skyloft night layer
            const rres = getOArcRRES('Terry');
            const m = spawnModel(rres, 'Terry');
            if (params1&1){
                const chr = mergeCHR0(rres, 'Terry_waitA', 'Terry_F_default');
                m.bindCHR0(this.animationController, chr);
                setModelBBox(m, new AABB(-140, -0, -120, 1400, 205, 130)); 
                setModelBBox(spawnModel(rres, 'Terry_Log'), new AABB(-140, -0, -120, 1400, 205, 130));
            }
            // In Shop
            else {
                const chr = mergeCHR0(rres, 'Terry_cycleB', 'Terry_F_default');
                m.bindCHR0(this.animationController, chr);
                setModelBBox(m, new AABB(-80, -0, -30, 80, 200, 80));
                const m2 = spawnModel(rres, 'TerryBicycle');
                m2.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));
                setModelBBox(m2, new AABB(-20, -0, -70, 20, 90, 80));
            }
        }
        // Beedles Bike
        else if (name === 'TerBike') {
            const rres = getOArcRRES('Terry');
            const m = spawnModel(rres, 'TerryBicycle');
            m.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));
            setModelBBox(m, new AABB(-20, -0, -70, 20, 90, 80));
        }
        // Goddess Statue
        else if (name === "IslMegm") {
            const bbox = new AABB(-5000, -5000, -23000, 5000, 10000, -9000);
            const rres = getOArcRRES(['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m = spawnModel(rres, ['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m2 = spawnModel(rres, ['F000Megami_s', 'F000LastDungeon_s'][params1 & 0x3]);
            setModelBBox(m, bbox);
            setModelBBox(m2, bbox);
            m2.passMask = ZSSPass.INDIRECT;
        }
        // Mushrooms
        else if (name === 'Kinoko' || name === 'SKinoko'){
            const type = params1 & 0x3;
            const arcName = 'Mushroom' + ['A','B','C','D'][type];
            const m = spawnOArcModel(arcName);
            switch (type) {
                case 0: setModelBBox(m, new AABB(-150, -30, -150, 150, 250, 150)); break;
                case 1: setModelBBox(m, new AABB(-100, -30, -100, 100, 250, 100)); break;
                case 2: setModelBBox(m, new AABB(-100, -30, -100, 100, 350, 100)); break;
                case 3: setModelBBox(m, new AABB(-100, -30, -100, 100, 250, 100)); break;
            }
        }
        else if (name === 'KinokoA') {
            const m = spawnOArcModel('MushroomA');
            setModelBBox(m, new AABB(-150, -30, -150, 150, 250, 150));
        }
        else if (name === 'KinokoB') {
            const m = spawnOArcModel('MushroomB');
            setModelBBox(m, new AABB(-100, -30, -100, 100, 250, 100));
        }
        else if (name === 'KinokoC') {
            const m = spawnOArcModel('MushroomC');
            setModelBBox(m, new AABB(-100, -30, -100, 100, 350, 100));
        }
        else if (name === 'KinokoD') {
            const m = spawnOArcModel('MushroomD');
            setModelBBox(m, new AABB(-100, -30, -100, 100, 250, 100));
        }
        // Various Chairs
        else if (['CharA', 'CharB', 'CharC'].includes(name)) { 
            setModelBBox(spawnOArcModel(name), new AABB(-60, 0, -60, 60, 160, 60));
        }
        // Various Plants
        else if (
            ['PltA00','PltA01','PltA02','PltB00','PltB01','PltB02',
             'PlntB','PlntA01','PlntA00','PlntC01','PlntC00'].includes(name)
        ) {
            setModelBBox(spawnOArcModel(name), new AABB(-50, -10, -50, 50, 100, 50));
        }
        // Various Cups
        else if (['CupA00','CupA01','CupA02','CupB00','CupB01','CupB02'].includes(name)) {
            setModelBBox(spawnOArcModel(name), new AABB(-50, -10, -50, 50, 100, 50));
        }
        // Flower Vases
        else if (['FlvsA','FlvsB','FlvsC'].includes(name)) {
            setModelBBox(spawnOArcModel(name), new AABB(-50, -10, -50, 50, 100, 50));
        }
        // Various Lamps
        else if (name === 'RoLight') { spawnOArcModel('F004rRotationLight'); }
        else if (['LampA','LampB','LampC','LampD'].includes(name)) {
            setModelBBox(spawnOArcModel(name), new AABB(-100, -400, -100, 100, 50, 100));
        }
        else if (['LampE','LampF'].includes(name)) {
            const bbox = new AABB(-100, -400, -100, 100, 50, 100);
            setModelBBox(spawnModelFromNames(name, name+'Glass'), bbox);
            setModelBBox(spawnModelFromNames(name, name+'Hook'), bbox);
        }
        // Various Decorations
        else if (name === 'DecoA')  { spawnOArcModel(name); }
        else if (name === 'DecoB')  { spawnOArcModel(name); }
        else if (name === 'ObjBg') {
            const objId = (params1>>>4) & 0x7F;
            if (roomIdx !== undefined){
                this.pastPresentNodeParameters.push(
                    {roomIdx, name: `obj${objId}`}
                )
            } else {
                console.warn(name, 'Not within Room');
            }
        }
        // No models
        else if (!NO_MODEL_LIST.includes(name)) {
            console.warn("Unknown object" , name, "Layer:", this.currentLayer);
        }
    }

    // TODO(Zeldex) : Move the matrix (scaling, rotation, translation) operations to spawn object
    //              Reason: The game sometimes opts to ignore them and will reuse the fields for parameters
    private spawnLayout(device: GfxDevice, layout: RoomLayout, roomIdx : number | undefined = undefined): void {
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

            this.spawnObj(device, obj, modelMatrix, roomIdx);
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

                if (1 === ((obj.unk1>>>4) & 0xF)) {
                    rotationX = 180;
                }
                rotationZ = 0;
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

            this.spawnObj(device, obj, modelMatrix, roomIdx);
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
            const id = view.getUint16(offs + 0x1A);
            const name = readString(buffer, offs + 0x1C, 0x08, true);
            return { unk1, unk2, tx, ty, tz, rotX, rotY, rotZ, id, name, sx: 1, sy: 1, sz: 1 };
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
            const rotZ = view.getUint16(offs + 0x22)
            const id = view.getUint16(offs + 0x26);
            const name = readString(buffer, offs + 0x28, 0x08, true);
            return { unk1, unk2, tx, ty, tz, sx, sy, sz, rotX, rotY, rotZ, id, name };
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
