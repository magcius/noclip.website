
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
import { SceneContext } from '../SceneBase.js';
import { gfxDeviceNeedsFlipY } from '../gfx/helpers/GfxDeviceHelpers.js';
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { makeSolidColorTexture2D } from '../gfx/helpers/TextureHelpers.js';
import { GfxDevice, GfxFrontFaceMode, GfxTexture, } from '../gfx/platform/GfxPlatform.js';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph.js';
import { GfxRenderInstList, GfxRenderInstManager, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { EFB_HEIGHT, EFB_WIDTH, GXMaterialHacks } from '../gx/gx_material.js';
import { ColorKind, GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render.js';
import { assert, assertExists, readString } from '../util.js';
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
    constructor(public name: string) { super(); }

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

enum ZSSTime {
    ALWAYS = 0,
    PAST = 1,
    PRESENT = 2,
};
interface ZSSNodeTime {
    node: BRRES.MDL0_NodeEntry;
    time: ZSSTime;
};
class ZSSGlobals {
    public currentLayer: number = 0;
    public currentTime: ZSSTime = ZSSTime.ALWAYS;

    private renderInstListSky = new GfxRenderInstList();
    private renderInstListStage = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private renderInstListInd = new GfxRenderInstList();

    public getList(pass: ZSSPass): GfxRenderInstList {
        switch (pass) {
            case ZSSPass.SKYBOX: return this.renderInstListSky;
            case ZSSPass.STAGE: return this.renderInstListStage;
            case ZSSPass.MAIN: return this.renderInstListMain;
            case ZSSPass.INDIRECT: return this.renderInstListInd;
        }
    }
};


const bboxScratch = new AABB();
class ZSSModelInstance {
    public visible: boolean = true;
    public layer: number = 0;
    public room: number = -1;
    public time: ZSSTime = ZSSTime.ALWAYS;
    public nodeTimes: ZSSNodeTime[] = [];

    // public drawPriority : number = -1;
    public bbox: AABB | null = null;

    public isChild: boolean = false;
    public children: ZSSModelInstance[] = [];

    // TODO(Zeldex): I want to remove this eventually, first step was to just remove it from MDL0ModelInstance
    public pass: ZSSPass = ZSSPass.MAIN;

    // used in children, will bind a child object onto the parents node
    public parentNodeMtxBindIdx: number = -1;

    constructor(public modelInstance : MDL0ModelInstance, public name: string = '') {
        this.name =  this.modelInstance.name;
    }

    public scale(scale: ReadonlyVec3) {
        mat4.scale(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, scale);
    }
    public scaleConstant(scale: number) {
        this.scale([scale, scale, scale]);
    }
    public translate(translation: ReadonlyVec3) {
        mat4.translate(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, translation);
    }
    public rotateXYZ(rotation: ReadonlyVec3) {
        mat4.rotateX(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, rotation[0]);
        mat4.rotateY(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, rotation[1]);
        mat4.rotateZ(this.modelInstance.modelMatrix, this.modelInstance.modelMatrix, rotation[2]);
    }
    public setLayer(layer: number) { this.layer = layer; }
    public setRoom(room: number) { this.room = room; }
    public setTime(time: ZSSTime) { this.time = time; }
    public setVisible(vis: boolean) { this.visible = vis; } // used by Layer UI Panel
    public setVisibility(globals: ZSSGlobals) {
        const layerVis = this.layer === globals.currentLayer || this.layer === 0;
        const timeVis = this.time === globals.currentTime || this.time === ZSSTime.ALWAYS;

        this.setVisible(layerVis && timeVis);

        // Sync node vis control
        for (const nodeTime of this.nodeTimes) {
            const timeVis = nodeTime.time === globals.currentTime;

            nodeTime.node.visible = layerVis && timeVis;
        }

    }
    public calcBounds(bbox : AABB) {
        // TODO
    }
    public setBounds(min: ReadonlyVec3, max: ReadonlyVec3) {
        if (this.bbox) {
            this.bbox.set(
                min[0], min[1], min[2],
                max[0], max[1], max[2],
            );
        }
        else {
            this.bbox = new AABB(
                min[0], min[1], min[2],
                max[0], max[1], max[2],
            );
        }
    }
    public addChild(child: ZSSModelInstance, parentBind : string | null = null) {
        child.isChild = true;
        this.children.push(child);
        if (parentBind) {
            const nodes = this.modelInstance.mdl0Model.mdl0.nodes;
            for (let i = 0; i < nodes.length; i++)
                if (nodes[i].name === parentBind) {
                    child.parentNodeMtxBindIdx = nodes[i].mtxId;
                    return
                }
            throw new Error("could not find node");
        }
    }
    public findNode(name: string): BRRES.MDL0_NodeEntry | undefined {
        return this.modelInstance.mdl0Model.mdl0.nodes.find(node=>node.name === name);
    }
    // Note: The node added can belong to another actor
    public addNodeTime(node: BRRES.MDL0_NodeEntry, time: ZSSTime) {
        this.nodeTimes.push({node, time});
    }

    /// Utilities
    public bindCHR0(animationController: AnimationController, chr0: BRRES.CHR0) {
        this.modelInstance.bindCHR0(animationController, chr0);
    }
    public bindVIS0(animationController: AnimationController, vis0: BRRES.VIS0) {
        this.modelInstance.bindVIS0(animationController, vis0);
    }
    public bindSRT0(animationController: AnimationController, srt0: BRRES.SRT0) {
        this.modelInstance.bindSRT0(animationController, srt0);
    }
    public bindPAT0(animationController: AnimationController, pat0: BRRES.PAT0) {
        this.modelInstance.bindPAT0(animationController, pat0);
    }
    public bindCLR0(animationController: AnimationController, clr0: BRRES.CLR0) {
        this.modelInstance.bindCLR0(animationController, clr0);
    }
    public bindRRESAnimations(animationController: AnimationController, brres: BRRES.RRES, name: string | null) {
        this.modelInstance.bindRRESAnimations(animationController, brres, name);
    }

    public prepareToRender(globals: ZSSGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isChild) {
            // Child drawing is handled by parent
            return;
        }


        let visibility = this.visible;
        if (this.visible && this.bbox !== null) {
            bboxScratch.transform(this.bbox, this.modelInstance.modelMatrix);
            visibility = viewerInput.camera.frustum.contains(bboxScratch);
        }
        if (visibility) {
            for (const child of this.children) {
                if (child.parentNodeMtxBindIdx !== -1) {
                    child.modelInstance.modelMatrix = this.modelInstance.getNodeToWorldMatrixReference(child.parentNodeMtxBindIdx);
                }
            }

            const list = globals.getList(this.pass);
            if (renderInstManager.currentList !== list) {
                renderInstManager.setCurrentList(list);
            }
            this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
            
            for (const child of this.children) {
                if (child.visible) {
                    const list = globals.getList(child.pass);
                    if (renderInstManager.currentList !== list) {
                        renderInstManager.setCurrentList(list);
                    }
                    child.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
                }
            }
        }
    }
};

class SkywardSwordRenderer implements Viewer.SceneGfx {
    public globals: ZSSGlobals = new ZSSGlobals();
    public textureHolder: ZSSTextureHolder;
    public otherTextureHolders: ZSSTextureHolder[] = [];

    public animationController: AnimationController;
    private stageRRES: BRRES.RRES;
    private stageBZS: BZS | null = null;
    private roomBZSes: BZS[] = [];
    private commonRRES: BRRES.RRES;
    private resourceSystem = new ResourceSystem();
    private modelCache = new ModelCache();
    private renderHelper: GXRenderHelperGfx;
    private blackTexture: GfxTexture;
    private whiteTexture: GfxTexture;

    public layerMap = new Map<number, number>();

    public modelInstances: ZSSModelInstance[] = [];
    public roomModelInstances: ZSSModelInstance[] = [];

    constructor(device: GfxDevice, public stageId: string, public systemArchive: U8.U8Archive, public objPackArchive: U8.U8Archive, public stageArchive: U8.U8Archive, public layerArchives: (U8.U8Archive)[] = [], public layerNums: number[]) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.textureHolder = new ZSSTextureHolder('Default');
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

        for (let layerNum = 0; layerNum < 29; layerNum++) {
            this.globals.currentLayer = layerNum;
            const stageLayout = this.stageBZS.layouts[layerNum];

            // if (this.layerNums.includes(t))
                this.spawnLayout(device, stageLayout);

            // Load rooms.
            const roomArchivesDir = stageArchive.findDir('rarc');
            if (roomArchivesDir) {
                for (let roomIdx = 0; roomIdx < roomArchivesDir.files.length; roomIdx++) {
                    
                    const roomArchiveFile = roomArchivesDir.files[roomIdx];
                    const roomArchive = U8.parse(roomArchiveFile.buffer);
                    const roomRRES = BRRES.parse(roomArchive.findFileData('g3d/room.brres')!);
                    
                    this.textureHolder.addRRESTextures(device, roomRRES);
                    
                    for (let i = 0; i < roomRRES.mdl0.length && this.globals.currentLayer === 0; i++) {
                        const mdl0 = roomRRES.mdl0[i];
                        if (mdl0.name.startsWith('model_obj')) {
                            continue;
                        }
                        if (mdl0.name.endsWith('_s')) {
                            continue;
                        }
                        const model = this.modelCache.getModel(device, this.renderHelper, mdl0, materialHacks);
                        const mdl0Model = new MDL0ModelInstance(this.textureHolder, model, roomArchiveFile.name);
                        const m = new ZSSModelInstance(mdl0Model);

                        // modelInstance.materialInstances.find((mat) => mat.materialData.material.)
                        m.bindRRESAnimations(this.animationController, roomRRES, null);
                        m.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
                        m.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
                        m.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);
                        m.pass = ZSSPass.STAGE;
                        this.modelInstances.push(m);
                        this.roomModelInstances.push(m);


                        // Lanayru Sand Sea has a "present" decal on top of a past zone.
                        if (this.stageId === 'F301_1') {
                            if (mdl0.name === 'model1' || mdl0.name === 'model2')
                                m.setTime(ZSSTime.PAST);
                        } else if (this.stageId === 'F302' && roomIdx === 7) {
                            if (mdl0.name === 'model0') {
                                m.setTime(ZSSTime.PRESENT);
                            }
                        } else if (this.stageId === 'D300') {
                            if (roomIdx === 2 || roomIdx === 3 || roomIdx === 6) {
                                if (mdl0.name.startsWith('model0')) { 
                                    m.setTime(ZSSTime.PRESENT);
                                }
                            }
                        } else if (this.stageId === 'D300_1') {
                            if (roomIdx === 8 || roomIdx === 6) {
                                if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                                }
                            }
                         } else if (this.stageId === 'F300_5') {
                            if (roomIdx === 0) {
                                if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                                }
                            }
                        } else if (this.stageId === 'F301_2') { 
                            if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                            } 
                        } else if (this.stageId === 'F300_2') { 
                            if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                            } 
                        } else if (this.stageId === 'F300_3') { 
                            if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                            } 
                        } else if (this.stageId === 'D003_3') { 
                            if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                            } 
                        } else if (this.stageId === 'D003_4') { 
                            if (mdl0.name.startsWith('model0')) {
                                    m.setTime(ZSSTime.PRESENT);
                            } 
                        }

                        // Try and find the paied _s model
                        for (const mdl of roomRRES.mdl0) {
                            if (mdl.name === (mdl0.name+'_s')) {
                                const model = this.modelCache.getModel(device, this.renderHelper, mdl, materialHacks);
                                const mdl0Model = new MDL0ModelInstance(this.textureHolder, model, roomArchiveFile.name);
                                const m1 = new ZSSModelInstance(mdl0Model);
                                // modelInstance.materialInstances.find((mat) => mat.materialData.material.)
                                m1.bindRRESAnimations(this.animationController, roomRRES, null);
                                m1.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
                                m1.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
                                m1.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);
                                m1.pass = ZSSPass.STAGE;
                                this.modelInstances.push(m1);
                                m.addChild(m1);
                                
                                // Detail / transparent meshes end with '_s'. Typical depth sorting won't work, we have to explicitly bias.
                                m1.modelInstance.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);
                            }
                        }
                    }

                    const roomBZS = this.parseBZS(roomArchive.findFileData('dat/room.bzs')!);
                    this.roomBZSes.push(roomBZS);
                    const layout = roomBZS.layouts[layerNum];
                    if (this.layerNums.includes(layerNum))
                        this.spawnLayout(device, layout, roomIdx);
                }
            }
        }

        outer:
        // Mark any indirect models. I think this is traditionally done at the actor level.
        for (let i = 0; i < this.modelInstances.length; i++) {
            const modelInstance = this.modelInstances[i];
            for (let j = 0; j < modelInstance.modelInstance.mdl0Model.mdl0.materials.length; j++) {
                const material = modelInstance.modelInstance.mdl0Model.mdl0.materials[j];
                for (let k = 0; k < material.samplers.length; k++) {
                    if (material.samplers[k].name === 'DummyWater') {
                        modelInstance.pass = ZSSPass.INDIRECT;
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

        if (this.modelInstances.find(m => m.time !== ZSSTime.ALWAYS || m.nodeTimes.length !== 0)) {
            const presentPanel = new UI.Panel();
            presentPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            presentPanel.setTitle(UI.SAND_CLOCK_ICON, "Time Stones");

            const selector = new UI.SingleSelect();
            selector.setStrings([ 'Past', 'Present' ]);
            selector.onselectionchange = (index: number) => {
                const isPresent = (index === 1);
                this.globals.currentTime = isPresent ? ZSSTime.PRESENT : ZSSTime.PAST;
                this.modelInstances.forEach((m) => {
                    m.setVisibility(this.globals);
                });
                modelsPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Present
            presentPanel.contents.appendChild(selector.elem);

            panels.push(presentPanel);
        }

        const layerIndecies : number[] = [];
        const layerNames : string[] = [];
        this.modelInstances.forEach((m) => {
            if (!layerIndecies.includes(m.layer)) {
                this.layerMap.set(layerIndecies.length, m.layer);
                layerIndecies.push(m.layer);
                layerNames.push('Layer ' + m.layer);
            }
        });

        if (layerNames.length !== 0){
            const layerPanel = new UI.Panel();
            layerPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            layerPanel.setTitle(UI.LAYER_ICON, 'Layer Select');
            const selector = new UI.SingleSelect();
            selector.setStrings(layerNames);
            selector.onselectionchange = (index:number) => {
                this.globals.currentLayer = this.layerMap.get(index)!;
                this.modelInstances.forEach((m) => {
                    m.setVisibility(this.globals);
                });
                modelsPanel.syncLayerVisibility();
            };
            selector.selectItem(0);
            layerPanel.contents.appendChild(selector.elem);
            panels.push(layerPanel);
        }

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].modelInstance.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].modelInstance.setTexturesEnabled(enableTextures.checked);
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

    private preparePass(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        for (const m of this.modelInstances) {
            m.prepareToRender(this.globals, device, renderInstManager, viewerInput);
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

        this.preparePass(device, viewerInput);

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
                this.globals.getList(ZSSPass.SKYBOX).drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.globals.getList(ZSSPass.STAGE).drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                this.globals.getList(ZSSPass.MAIN).drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        if (this.globals.getList(ZSSPass.INDIRECT).renderInsts.length > 0) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    this.globals.getList(ZSSPass.INDIRECT).resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null });
                    this.globals.getList(ZSSPass.INDIRECT).drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
                });
            });
        }
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender();
        builder.execute();
        this.globals.getList(ZSSPass.SKYBOX).reset();
        this.globals.getList(ZSSPass.STAGE).reset();
        this.globals.getList(ZSSPass.MAIN).reset();
        this.globals.getList(ZSSPass.INDIRECT).reset();
    }

    private getObjectArcRRES(device: GfxDevice, name: string) {
        return this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
    }
    private getStageArcRRES() {
        return this.stageRRES;
    }
    private getRoomArcRRES(roomIdx: number) {
        const arcDir = this.stageArchive.findDir('rarc')!;
        assert(roomIdx < arcDir.files.length && roomIdx >= 0);

        const roomArchiveFile = arcDir.files[roomIdx];
        const roomArchive = U8.parse(roomArchiveFile.buffer);
        const roomRRES = BRRES.parse(roomArchive.findFileData('g3d/room.brres')!);

        // Arc textures should already be added to texture holder
        // this.textureHolder.addRRESTextures(device, roomRRES);

        return roomRRES;
    }


    private spawnObj(device: GfxDevice, obj: BaseObj, modelMatrix: mat4, roomIdx : number | undefined): void {
        // In the actual engine, each obj is handled by a separate .rel (runtime module)
        // which knows the actual layout. The mapping of obj name to .rel is stored in main.dol.
        // We emulate that here.

        const name = obj.name, params1 = obj.unk1, params2 = obj.unk2, rotx = obj.rotX, rotz = obj.rotZ;
        const renderHelper = this.renderHelper;

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

        const doesModelContainRepeatTexture = (mdl : MDL0Model) => {
            return mdl.materialData.find( (material) => {
                material.material.samplers.find((sampler) => {
                    // These will often be named the same across models but be different
                    return ['Body', 'Eye.0', 'Eye.1', 'Eye.2', 'Eye.3', 'Eye.4', 'Eyeball', 'Face',].includes(sampler.name);
                }) !== undefined;
            }) !== undefined;
        }
        const spawnModel = (rres: BRRES.RRES, modelName: string, bindDefaultAnm: boolean = true) => {
            const mdl0 = assertExists(rres.mdl0.find((model) => model.name === modelName));

            const model = this.modelCache.getModel(device, renderHelper, mdl0, materialHacks);
            let textureHolder = this.textureHolder;
            if (doesModelContainRepeatTexture(model)) {
                const holder = this.otherTextureHolders.find(value => value.name === modelName);
                if (holder) {
                    textureHolder = holder;
                } else {
                    textureHolder = new ZSSTextureHolder(modelName);
                }
            }
            textureHolder.addRRESTextures(device, rres);
            this.otherTextureHolders.push(textureHolder);

            // Defaults to MAIN pass
            const modelRenderer = new ZSSModelInstance(new MDL0ModelInstance(textureHolder, model, obj.name));
        
            mat4.copy(modelRenderer.modelInstance.modelMatrix, modelMatrix);
            this.modelInstances.push(modelRenderer);

            if (mdl0.name.endsWith('_s') || ['FXLightShaft', 'StageF000Light','MoundShovelD00', 'HoleShovelB', 'MoundShovel'].includes(mdl0.name))
                modelRenderer.modelInstance.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);

            if (bindDefaultAnm)
                modelRenderer.modelInstance.bindRRESAnimations(this.animationController, rres);

            // TODO(jstpierre): Figure out how these MA animations work.
            modelRenderer.modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
            modelRenderer.modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
            modelRenderer.modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);

            modelRenderer.setLayer(this.globals.currentLayer);
            if (roomIdx !== undefined)
                modelRenderer.setRoom(roomIdx);

            return modelRenderer;
        };
        const calcModelBounds = (mdl : ZSSModelInstance) => {
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

        const getOArcRRES = (name: string) => {
            return this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
        };

        const spawnOArcModel = (name: string, bindDefaultAnm: boolean = true) => {
            const rres = this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
            return spawnModel(rres, name, bindDefaultAnm);
        };

        const stageRRES = this.stageRRES;
        const spawnModelFromNames = (arc:string, model:string, bindDefaultAnm: boolean = true) => {
            if (arc === 'Stage'){
                return spawnModel(stageRRES, model, bindDefaultAnm);
            } else {
                return spawnModel(getOArcRRES(arc), model, bindDefaultAnm);
            }
        };

        const mergeCHR0 = (rres: BRRES.RRES, main: string, add: string) : BRRES.CHR0 => {
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

        // Start object by object
        // Wardrobes
        if (name === 'chest'){
            const outsideType = (params1 >>> 28) & 0xF;
            const insideType  =  (params1 >>> 16) & 0xF;

            // Outside Model
            const mdlName = 'Tansu' + ['A','B','C','D','A'][outsideType];
            const m = spawnModelFromNames('Tansu', mdlName);

            if (insideType !== 0xF) {
                const mdlName = 'TansuInside' + ['A','B','C','D','A'][insideType];
                const child = spawnModelFromNames('TansuInside', mdlName);
                m.addChild(child);
            }

            m.setBounds([-200, -0, -100], [200, 500, 100]);
        }
        //
        else if (name === 'Vrbox') {
            // First parameter appears to contain the Vrbox to load.
            const boxId = params1 & 0x0F;
            const boxName = [ 'Vrbox00', 'Vrbox01', 'Vrbox02', 'Vrbox03' ][boxId];
            
            const m = spawnOArcModel(boxName);
            m.pass = ZSSPass.SKYBOX;
            m.modelInstance.isSkybox = true;
            
            // This color is probably set by the day/night system...
            m.modelInstance.setColorOverride(ColorKind.C2, colorNewCopy(White));
            m.modelInstance.setColorOverride(ColorKind.K3, colorNewCopy(White));

            m.scaleConstant(0.1);
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
                if (boxSmallItems.includes(itemId)){
                    const m = spawnOArcModel('TBoxSmallT', false);
                    m.setBounds([-38, 0, -70], [38, 110, 35]);
                }
                else if (boxBossItems.includes(itemId)) {
                    const m = spawnOArcModel('TBoxBossT', false);
                    m.setBounds([-90, 0, -140], [90, 170, 60]);
                } else if (boxGoddessItems.includes(itemId)) {
                    const m = spawnOArcModel('GoddessTBox', true);
                    m.setBounds([-65, 0, -100], [65, 150, 50]);
                } else {
                    const m = spawnOArcModel('TBoxNormalT', false);
                    m.setBounds([-65, 0, -100], [65, 150, 45]);
                }
            }
        }
        // Freestanding Items
        else if (name === 'Item'){
            let m : ZSSModelInstance | null = null;
            // TODO(Zeldex72): Adjust bbox per item type.
            // Is not static in game, but calculated based on a complex structure/scale
            // Default will probably be fine
            const bboxMin : ReadonlyVec3 = [-100, -100, -100];
            const bboxMax : ReadonlyVec3 = [ 100,  100,  100];

            // due to complexity, leaving here
            const itemId = params1 & 0xFF;
            const RUPEE_ITEMS = [2,3,4,32,33]; // gree, blue, red, silver, gold
            //Rupees
            if (RUPEE_ITEMS.includes(itemId)) {
                m = spawnOArcModel('PutRupee');
                m.scaleConstant(1.5);
                let rupeePat = findPAT0(getOArcRRES('PutRupee'), 'Rupee');
                switch(itemId){
                    case  2: m.bindPAT0(staticFrame(0), rupeePat); break;
                    case  3: m.bindPAT0(staticFrame(1), rupeePat); break;
                    case  4: m.bindPAT0(staticFrame(2), rupeePat); break;
                    case 32: m.bindPAT0(staticFrame(3), rupeePat); break;
                    case 33: m.bindPAT0(staticFrame(4), rupeePat); break;
                }
            }
            // Small Key
            else if (itemId === 1) {
                m = spawnModelFromNames('PutKeySmall', 'PutKeySmallNormal');
                m.scaleConstant(1.1);
            }
             // stamina fruit
            else if (itemId === 42) {
                const gutsRRES = getOArcRRES('PutGuts');
                const m = spawnModel(gutsRRES, 'PutGuts');
                spawnModel(gutsRRES, 'PutGutsLeaf');
                m.modelInstance.bindSRT0(this.animationController, findSRT0(gutsRRES, 'GutsLight'));
            }
             // Babies Rattle
            else if (itemId === 160) {
                m = spawnOArcModel('PutGaragara');
            }
            // heart piece
            else if (itemId === 94) {
                m = spawnOArcModel('PutHeartKakera');
                m.scaleConstant(1.375);
            }
            // Gratitude Crystal
            else if (itemId === 48) {
                m = spawnOArcModel('GetGenki');
                m.scaleConstant(1.7);
                m.translate([0, 30, 0]);
            }
            // Normal Heart Item
            else if (itemId === 6) {
                m = spawnOArcModel('PutHeart');
            }
            else {
                console.log(`unknown item id: ${itemId}`);
            }

            if (m !== null) {
                m.setBounds(bboxMin, bboxMax);
            }
        }
        // Air Vents
        else if (name === 'Wind'){
            const windType = (params1 >>> 3) & 1; // determines the big wind or not
            const windArc = ['FXTornado', 'FXTornadoBoss'][windType];
            const m = spawnOArcModel(windArc);
            m.setBounds([-180, -50, -180], [180, 180, 180]);
        }
        // Water Vents
        else if (name === 'Wind03'){
            const waterSpoutRRES = getOArcRRES('WindSc00');
            const m = spawnModel(waterSpoutRRES, 'FX_WaterShaft');
            m.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaft_in'));
            m.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaft'));
            m.setBounds([-180, -50, -180], [180, 180, 180]);

            const m0 = spawnModel(waterSpoutRRES, 'FX_WaterShaftTop');
            m0.bindCHR0(this.animationController, findCHR0(waterSpoutRRES, 'FX_WaterShaftTop_in'));
            m0.bindSRT0(this.animationController, findSRT0(waterSpoutRRES, 'FX_WaterShaftTop'));
            m0.translate([0, 100, 0]);
            m0.scale([1, 0.08, 1]);

            m.addChild(m0);
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
            m.translate([0, -200, 0]);
            // mat4.scale(m.modelMatrix, m.modelMatrix, [1, 0.08, 1]);

            m.setBounds([-180, -200, -180], [180, 1600, 180]);
        }
        // Moldroms
        else if (name === 'ESpark'){ 
            const sparkRRES = getOArcRRES('MoldWorm');
            const head = spawnModel(sparkRRES, 'MoldWormHead');
            head.bindCHR0(this.animationController, findCHR0(sparkRRES, "HeadWait"));
            head.setBounds([-100, -100, -100], [100, 100, 100]);
            
            let shift : number = -50;
            let start = shift;
            for (let i = 0; i < 3; i++){
                const bodySeg = spawnModel(sparkRRES, 'MoldWormBody');
                bodySeg.translate([0, 0, start]);
                bodySeg.bindCHR0(this.animationController, findCHR0(sparkRRES, "BodyWalk"));
                start += shift;
                head.addChild(bodySeg);
            }
            const tailSeg = spawnModel(sparkRRES, 'MoldWormTail');
            tailSeg.translate([0, 0, start]);
            tailSeg.bindCHR0(this.animationController, findCHR0(sparkRRES, 'TailWait'));
            head.addChild(tailSeg);
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
                // TODO(Zeldex72): Rope bbox is calculate based on its length
                const distance = 100;
                const m = spawnOArcModel('RopeTerry');
                m.setBounds([-distance, -distance, -distance], [distance, 100, distance]);

            } else if (ropeSubtype === 4) {
                // TODO(Zeldex72): Rope bbox is calculate based on its length
                const distance = 100;
                const m = spawnModelFromNames('GrassCoil', 'GrassCoilCut'); // Can be switched to cut variant
                m.setBounds([-distance, -distance, -distance], [distance, 100, distance]);
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
            stopperMdl.translate([tx, 0, tz]);
            stopperMdl.rotateXYZ([0, rotateY, 0]);

            calcModelBounds(stopperMdl)
            // stopperMdl.calcBounds();
            // stopperMdl.setBounds( );
        }
        // Main Isle of Song mechanism, spawns the pusher, and rotating islands
        else if (name === 'UtaMain'){
            const mainMechaMdl = spawnOArcModel('IslSonCenterDevice');
            mainMechaMdl.translate([0, 230, 0]);
            mainMechaMdl.rotateXYZ([0, Math.PI, 0]);
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

                mdl.translate([ringDist*xDir, 0, ringDist*zDir]);
                mdl2.translate([isletDist*xDir, 0, isletDist*zDir]);
                mdl.rotateXYZ([0, rotateY, 0]);
                mdl2.rotateXYZ([0, rotateY+Math.PI/2, 0]);

                calcModelBounds(mdl);
                calcModelBounds(mdl2);
            }

            calcModelBounds(mainMechaMdl);
        }
        // Dungeon Doors
        else if (name === 'TstShtr'){
            const bboxMin: ReadonlyVec3 = [240, -40, -50];
            const bboxMax: ReadonlyVec3 = [240, 440,  50];
            const doorType = (params1 >>> 4) & 0x3f;
            const isLocked  = ((rotx & 0x00FF) !== 0xFF);
            const isLocked2 = ((rotx & 0xFF00) !== 0xFF);
            const isLockedWithKey = (params1&0xF);
            const doorModelArcName   = 'ShutterFenced0' + [doorType];
            const doorModelName      = 'ShutterFenced0' + [doorType];
            const lockedModelName    = 'ShutterFencedFence0' + [doorType];
            const doorRRES = getOArcRRES(doorModelArcName);

            // Time Variants
           if (doorType === 2) { 
                const m0 = spawnModel(doorRRES, doorModelName+'N'); 
                m0.setTime(ZSSTime.PRESENT);
                m0.setBounds(bboxMin, bboxMax);

                const m1 = spawnModel(doorRRES, doorModelName+'T'); 
                m1.setTime(ZSSTime.PAST);
                m1.setBounds(bboxMin, bboxMax);

                if ((isLocked || isLocked2) && isLockedWithKey !== 2) {
                    const key0 = spawnModel(doorRRES, lockedModelName+'N');
                    const key1 = spawnModel(doorRRES, lockedModelName+'T');

                    m0.addChild(key0);
                    m0.addChild(key1);
                }
           } else {
                const m = spawnModel(doorRRES, doorModelName);
                m.setBounds(bboxMin, bboxMax);

                if ((isLocked || isLocked2) && ![2,5].includes(isLockedWithKey)) {
                    const key = spawnModel(doorRRES, lockedModelName);
                    m.addChild(key);
                }
           }
           if ((isLocked || isLocked2) && [2].includes(isLockedWithKey)){
                const lockedMdl = spawnOArcModel('LockSmall');
                lockedMdl.translate([0, 150, 0]);
                lockedMdl.rotateXYZ([Math.PI/2, 0, 0]);
                lockedMdl.setBounds([-250, -0, -100], [250, 400, 100]);
           }
        } else if (name === 'DoorBs'){
            const dungeonNum = params1 & 0x3F;
            const dungeonIdx = [0,1,2,0,1,2][dungeonNum];
            const bossDoorModel = ['DoorBossA', 'DoorBossB', 'DoorBossC'][dungeonIdx]; // has LR
            const bossLockIdx = [0,1,2,5,3,4][dungeonNum];
            const bossLockOarc  = ['BossLock1A', 'BossLock1B', 'BossLock1C', 'BossLock2B', 'BossLock2C'][bossLockIdx];
            const bossLockModel = ['BossLockLv1', 'BossLockLv2', 'BossLock1C', 'BossLock2B', 'BossLock2C'][bossLockIdx]; // has LR
            const keyHoleModel = ['BossKeyhole1A', 'BossKeyhole1B', 'BossKeyhole1C', '-', 'BossKeyhole2B', 'BossKeyhole2C' ][dungeonNum]; // has LR

            // Spawn Keyhole
            if (dungeonNum !== 3) // Ancient Cistern
            {
                const doorBase = spawnOArcModel('DoorBoss', false);
                doorBase.bindRRESAnimations(this.animationController, getOArcRRES('DoorBoss'), 'DoorBoss_Open');
                doorBase.setBounds([-400, -0, -70], [400, 800, 160]);

                // Spawn Door
                const doorL = spawnModelFromNames(bossDoorModel, bossDoorModel+'L');
                const doorR = spawnModelFromNames(bossDoorModel, bossDoorModel+'R');
                // Spawn Lock
                const lockL = spawnModelFromNames(bossLockOarc, bossLockModel+'L');
                const lockR = spawnModelFromNames(bossLockOarc, bossLockModel+'R');
                // Spawn Keyhole
                const holeL = spawnModelFromNames(keyHoleModel, keyHoleModel+'L');
                const holeR = spawnModelFromNames(keyHoleModel, keyHoleModel+'R');

                doorBase.addChild(doorL, 'DoorBossL');
                doorBase.addChild(doorR, 'DoorBossR');
                doorBase.addChild(lockL, 'LockL');
                doorBase.addChild(lockR, 'LockR');
                doorBase.addChild(holeL, 'KeyholeL');
                doorBase.addChild(holeR, 'KeyholeR');

                if (dungeonNum === 2) {
                    doorBase.time = ZSSTime.PAST;
                }
            }
            else {
                // Cistern is *Special*
                // const doorBase = spawnOArcModel('DoorBoss', false);
                // doorBase.setBounds([-400, -0, -70], [400, 800, 160]);

                const m = spawnModelFromNames('BossLockD101', 'BossLockD101');
                m.setBounds([-400, -0, -70], [400, 800, 160]);
                m.translate([0,300,0]);
            }
            if (dungeonNum === 2) { // LMF present doors....   
                const doorBase = spawnOArcModel('DoorBoss', false);
                doorBase.bindRRESAnimations(this.animationController, getOArcRRES('DoorBoss'), 'DoorBoss_Open');
                doorBase.setBounds([-400, -0, -70], [400, 800, 160]);

                // Spawn Door
                const doorL = spawnModelFromNames(bossDoorModel, bossDoorModel+'NL');
                const doorR = spawnModelFromNames(bossDoorModel, bossDoorModel+'NR');
                // Spawn Lock
                const lockL = spawnModelFromNames(bossLockOarc, bossLockModel+'LN');
                const lockR = spawnModelFromNames(bossLockOarc, bossLockModel+'RN');
                // Spawn Keyhole
                const holeL = spawnModelFromNames(keyHoleModel, keyHoleModel+'LN');
                const holeR = spawnModelFromNames(keyHoleModel, keyHoleModel+'RN');

                doorBase.addChild(doorL, 'DoorBossL');
                doorBase.addChild(doorR, 'DoorBossR');
                doorBase.addChild(lockL, 'LockL');
                doorBase.addChild(lockR, 'LockR');
                doorBase.addChild(holeL, 'KeyholeL');
                doorBase.addChild(holeR, 'KeyholeR');

                doorBase.setTime(ZSSTime.PRESENT);
            }
        // The Big Lily Pads
        } else if (name === 'Lotus'){
            const lilyPadSubtype = (params1>>>10)&0xF;
            const isUpsideDown = !((params1>>>8)&0x3);
            const lilyPadOarc = ['WhipLeaf00', 'WhipLeaf01', 'WhipLeafStop', 'LotusStep'][lilyPadSubtype];
            const m = spawnOArcModel(lilyPadOarc);
            if (isUpsideDown)
                m.rotateXYZ([0,0,Math.PI]);
            calcModelBounds(m);
            // m.setBounds();
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

            m.setBounds([min, min, min], [max, 250 / obj.sx, max]);
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
            const m = spawnModel(bcRRES, bcName);
            m.bindPAT0(this.animationController, findPAT0(bcRRES, `Bocoburin${['G','A','B'][color]}Wink`));
            m.bindCHR0(this.animationController, findCHR0(bcRRES, 'wait'));
            m.scaleConstant(1.1);
            
            if (bokoConfig === 2) {
                m.setBounds([-350, -200, -350], [350, 200, 350]);
            } else {
                m.setBounds([-150, -200, -150], [150, 200, 150]);
            }

            let weaponIdx = -1;
            // Weapon
            if (bokoConfig === 9) {
                // Bow
                const bowMdl = spawnModel(bcRRES, color === 0 ? 'BocoburinGBow' : 'bow');
                m.addChild(bowMdl, 'hand_L');
            } else if (color === 0) {
                weaponIdx = 4;
            } else if (color === 2) {
                weaponIdx = 3;
            } else if (bokoConfig === 2 || bokoConfig === 8) {
                weaponIdx = 2;
            } else if (bokoConfig !== 4) {
                weaponIdx = 1;
            } else {
                const weaponMdl = spawnModel(bcRRES, 'BocoburinRantan');
                m.bindCHR0(this.animationController, findCHR0(bcRRES, 'Rwait'));
                m.addChild(weaponMdl, 'hand_R');
            }
            if (weaponIdx !== -1)
            {
                const weaponName = `Bocoburin${['SwordA', 'Stick', 'BSword','GSword'][weaponIdx-1]}`;
                const weaponMdl = spawnModel(bcRRES, weaponName);
                m.addChild(weaponMdl, 'hand_R');
            }
            // Headpiece
            if (variant !== 0 && color !== 0)
            {
                const headcloth = spawnModel(bcRRES, `Bocoburin${['M','M','B'][color]}Headcloth`);
                m.addChild(headcloth, 'head');
            }
            // Belt item
            const beltItem = ["None", 'Horn', 'Key'][(params1 >>> 2) & 3];
            if (beltItem !== "None")
            {
                const beltMdl = beltItem === 'Key' ? spawnModel(bcRRES, "KeySmall") : spawnModel(bcRRES, "BocoburinPipe");
                m.addChild(beltMdl, 'pipe_loc');
            }
        }
        // Mark for Farores and Dins Flame
        else if (name === 'GodMark'){
            const godMarkRRES = getOArcRRES('GodsMark');
            const type = params1&0x1;
            const clrType = findCLR0(godMarkRRES, ['GodsMark_F', 'GodsMark_D', 'GodsMark_N'][type]);
            const m = spawnModel(godMarkRRES, 'GodsMark');
            m.bindSRT0(staticFrame([0,1,2][type]), findSRT0(godMarkRRES, 'GodsMark'));
            m.bindCLR0(this.animationController, clrType);

            m.setBounds([-300, 500, -2600], [300, 1100, -2200]);
        }
        // Bushes
        else if (name === 'OcGrs') {
            const type = (params1 >>> 0) & 0xF;
            const arc = ['GrassOcta', 'GrassRollGrow', 'GrassGerm', 'GrassMain'][type];
            const mdl2 = ['GrassOctaCut', 'GrassRollCut', 'GrassGermCut', 'GrassMainCut'][type];
            const bushMdl = spawnOArcModel(arc); // main Bush
            const stemMdl = spawnModelFromNames(arc, mdl2); // The stem
            
            bushMdl.setBounds([-100, -50, -100], [100, 100, 100]);
            stemMdl.setBounds([-50, -10, -50], [50, 100, 50]);
        }
        //  Grass things in faron
        else if (name === 'Gcoil') {
            const m = spawnOArcModel('GrassCoilNormal');
            m.setBounds([-100, -50, -100], [100, 200, 200]);
        }
        // Big Flags around skyloft (like hanging from bazaar)
        else if (name === 'Flag') {
            const type = (params1 >>> 0) & 0xF;
            const model = ['FlagA', 'FlagA', 'FlagB', 'FlagB', 'BigSail', 'BigSail'][type];
            
            const rres = getOArcRRES(model)
            const m = spawnOArcModel(model);

            if (type === 1) {
                m.rotateXYZ([0, 0, Math.PI / 2]);
            }
            else if (type === 2 || type === 3) {
                const srt = findSRT0(rres, 'FlagB');

                if (type === 2) {
                    m.bindSRT0(staticFrame(0), srt);
                } else {
                    m.bindSRT0(staticFrame(1), srt);
                }
            }
            m.setBounds([-800, -500, -250], [250, 500, 250]);
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
            //         translate(m, [0, 100, 0]);
            //     }
            //     const m2 = spawnModel(rres, "TreeLongSkySpike");
            //     translate(m2, [0, 50, 0]);
            //     spawnModelFromNames('TreeLongSky', 'TreeLongSkyCutmark');
            // }
        }
        // Low Poly Islands
        else if (name === 'IslLOD') {
            const type = params1&0xF;
            const model = name+['A','B','C','D','E'][type];
            const m = spawnOArcModel(model);
            calcModelBounds(m);
            // m.setBounds();
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
            m.translate([0, 100, 0]);
            m.setBounds([-220, -100, -220], [220, 160, 220]);
        }
        // Practice Slash Logs
        else if (name === 'SliceLg') {
            const type = params1  & 0xF;
            const logName = 'PracticeWood'+['A','B','C','D','CR','F'][type];
            const m0 = spawnModelFromNames('PracticeWood', logName+'1');
            const m1 = spawnModelFromNames('PracticeWood', logName+'2');
            m0.addChild(m1);
            m0.setBounds([-300, -50, -300], [300, 350, 300]);
        }
        // Cloud Barrier for each pillar - Temporarily using Some other effect untily JPA support
        // else if (name === 'LightLi') {
        //     // const m = spawnOArcModel('FXLightShaft');
        //     // scaleModel(m, [5,1,5]);
        //     // console.info('Add Effect for LightLi')
        // }
        // Player Bird (Crimson Loftwing)
        else if (name === 'PyBird') {
            const m = spawnModelFromNames('Bird_Link', 'BirdLink');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Glide'));
            m.setBounds([-1800, -1500, -1500], [1800, 1500, 1500]);
        }
        // Item Shop (Rupin) Owner mother
        else if (name === 'NpcDoMo') {
            const rres = getOArcRRES('DouguyaMother');
            const m = spawnModel(rres, 'DouguyaMother');
            m.bindCHR0(this.animationController, findCHR0(rres, 'DouguyaMother_wait'));
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // The shield bash practice log
        else if (name === 'GuardLg') {
            const m0 = spawnModelFromNames('PracticeWood', 'PracticeWoodE'); // Log
            m0.scaleConstant(1.2);
            m0.translate([100, 200, 40]);
            m0.setBounds([-100, -100, -100], [100, 500, 100])
            
            const m1 = spawnModelFromNames('PracticeWood', 'RopeBase'); // Rope on Top
            m1.modelInstance.modelMatrix = mat4.create();
            m0.addChild(m1);

            console.warn('Incomplete:', name, 'connecting rope not implemented');
        }
        // Water on Skyloft
        else if (name === 'CityWtr') {
            const wtr0 = spawnModelFromNames('Stage', 'StageF000Water0');
            const wtr1 = spawnModelFromNames('Stage', 'StageF000Water1');
            const wtr2 = spawnModelFromNames('Stage', 'StageF000Water2');
            wtr0.setBounds([3000, -8600, -10500], [12300, 4300, 3400]);
            wtr0.addChild(wtr1);
            wtr0.addChild(wtr2);
        }
        // Gravestones
        else if (name === 'Grave') {
            const m = spawnModelFromNames('Stage', 'StageF000Grave')
            m.setBounds([-100, -0, -100], [100, 200, 100]);
        }
        //Shed Door to demon
        else if (name === 'Shed') {
            const m = spawnModelFromNames('Stage', 'StageF000Shed')
            m.setBounds([-115, -0, -10], [115, 260, 10]);
        }
        // Windmills for the light Tower
        else if (name === 'Windmil') {
            const m = spawnModelFromNames('Stage', 'StageF000Windmill')
            m.setBounds([-150, -150, -100], [150, 150, 100]);
        }
        // Ropes with pinwheels and such
        else if (name === 'Blade') {
            const m = spawnModelFromNames('Stage', 'StageF000Blade')
            // Purposely ignored... Game sets to -0, 0 but that cant be right
            // m.setBound([-0, -0, -0], [0, 0, 0]);
        }
        // Harp area for the Thuderhead opening
        else if (name === 'LHHarp') {
            const m = spawnModelFromNames('Stage', 'StageF000Harp');
            m.rotateXYZ([0, -9.5/12*Math.PI, 0]);
            if (this.stageId === 'S000') {
                m.translate([0, -600, 0]);
            } else {
                // rotateModel(m, [0, 0.8 * Math.PI, 0])
            }
            m.setBounds([-460, -60, -460], [460, 610, 460]);
        }
        // Sunlight in harp area
        else if (name === 'LHLight'){
            // Skipping due to duplicate with SnLight showing twice in two directions
            // spawnModelFromNames('Stage', 'StageF000Light');
        }
        else if (name === 'SnLight'){
            const m = spawnModelFromNames('Stage', 'StageF000Light');
            m.setBounds([-200, -100, -200], [200, 600, 500]);
        }
        // Gates on Skyloft that block doors
        else if (name === 'DmtGate'){
            const type = (params1>>> 8) & 0xF;
            const typeName = ['StageF000Gate', 'StageF000GodDoor', 'StageF000Shutter', 'StageF400Gate'][type & 0x3];
            
            // Gate Variants
            if (type === 0 || type === 3) {
                const m0 = spawnModelFromNames('Stage', typeName);
                const m1 = spawnModelFromNames('Stage', typeName);

                m0.translate([-217, 0, 0]);
                m0.rotateXYZ([0, -Math.PI/2, 0]);

                m1.translate([217, 0, 0]);
                m1.rotateXYZ([0, -Math.PI/2, 0]);

                m0.setBounds([-400, -0, -50], [400, 600, 250]);
                m0.addChild(m1);
            } else {
                const m = spawnModelFromNames('Stage', typeName);
                if (type === 1) {
                    m.setBounds([-50, -0, -100], [500, 500, 100]);
                } else {
                    m.setBounds([-250, -0, -50], [250, 400, 50]);
                }
            }
        }
        // Pumpkins
        // Pumpkins for Pumpkin Archery Minigame
        else if (name === 'Pumpkin' || name === 'PmpknDe'){
            const pumpkin = spawnModelFromNames('Pumpkin', 'Pumpkin');
            const leaves = spawnModelFromNames('Pumpkin', 'Turu');
            pumpkin.setBounds([-50, -50, -50], [50, 50, 50]);
            pumpkin.addChild(leaves);
        }
        // Heart Flowers
        else if (name === 'Heartf'){
            const m = spawnModelFromNames('FlowerHeart', 'FlowerHeart');
            m.setBounds([-50, -0, -50], [50, 100, 50]);
        }
        // Chairs -> some are invisible for some reason...
        else if (name === 'Char'){
            const type = (params1>>> 0) & 0xF;
            const typeName = 'Char'+['A','D','I','F','G','H'][type];
            if (![1,2].includes(type)){
                const m = spawnOArcModel(typeName);
                m.setBounds([-60, -0, -60], [60, 160, 60]);
            }
        }
        // Main Underground stage layouts
        else if (name === 'Uground'){
            const type = params1&0xFF;
            const typeName = 'MoleGround'+['S','M','L','Sn','Sl','Sr','Mn','Ml','Mr','Ln'][type];
            const m = spawnOArcModel(typeName);
            calcModelBounds(m);
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
            const m0 = spawnModelFromNames('IslF000', 'IslF000');
            m0.setBounds([-10000, -10000, -23000], [13000, 10000, 8000]);
            const m1 = spawnModelFromNames('IslF000', 'IslF000_s');
            const m2 = spawnModelFromNames('IslF000', 'IslF000Water0');
            m0.addChild(m1);
            m0.addChild(m2);
        }
        // Island with Bamboo minigame
        else if (name === 'IslBamb') {
            const m0 = spawnModelFromNames('IslBamb', 'IslBamb');
            const m1 = spawnModelFromNames('IslBamb', 'IslBamb_s');
            m0.setBounds([-2400, -1600, -2300], [2400, 3900, 2400]);
            m0.addChild(m1);
        }
        // Beetles sky island
        else if (name === 'IslTery') {
            const m0 = spawnModelFromNames('IslTerry', 'IslTerry');
            m0.setBounds([-1600, -1500, -1600], [1700, 1500, 1600]);
        }
        // LumpPumpkin
        else if (name === 'PumpBar') {
            const m = spawnModelFromNames('IslBar', 'IslBar');
            m.setBounds([-2790, -1450, -8270], [2880, 2120, 1370]);
        }
        // The ring on Fun Fun Island
        else if (name === 'RouletR') {
            const m = spawnModelFromNames('IslRouRot', 'IslRouRot');
            calcModelBounds(m);
        }
        // Main Fun Fun island
        else if (name === 'RouletC') {
            const m0 = spawnModelFromNames('IslRouMain', 'IslRouMain');
            const m1 = spawnModelFromNames('IslRouMain', 'IslRouMain_s');
            calcModelBounds(m0);
            m0.addChild(m1);
        }
        // dig spots
        else if (name === 'FrmLand') {
            const m = spawnModelFromNames('MoundShovelD', 'MoundShovelD00');
            m.setBounds([-100, -0, -100], [100, 100, 100]);
        }
        // Boss Koloktos Pillars
        else if (name === 'AsuraP') {
            for (let i = 0; i < 6; i++){
                const type = 'BreakPillar'+['A','B','C','D','E','F'][i];
                const m = spawnModelFromNames('BreakPillar', type);
                m.translate([0, i*200, 0]);
                m.setBounds([-150, -0, -150], [150, 1200, 150]);
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
            const m = spawnModelFromNames('FlowerBomb', 'LeafBomb');
            m.setBounds([-80, -50, -80], [80, 60, 80]);
            const m1 = spawnModelFromNames('Alink', 'EquipBomb'); 
            m.addChild(m1);
        }
        // Spikes in ancient cistern
        else if (name === 'Spike') {
            const m = spawnModelFromNames('SpikeD101', 'SpikeD101');
            m.setBounds([-10, -250, -480], [80, 260, 490]);
        }
        // Whirlpool cork
        else if (name === 'PlCock') {
            const m = spawnModelFromNames('WaterD101', 'PoolCockD101');
            m.setBounds([-300, -100, -300], [300, 100, 300]);
        }
        // Whirlpool
        else if (name === 'Vortex') {
            const m = spawnModelFromNames('WaterD101', 'SpiralWaterD101');
            // m.setBounds([-1000, -50, -1000], [1000, 200, 1000]);
            console.warn(name, 'does not have bbox');
        }
        // Shutter for water
        else if (name === 'ShtrWtr') {
            const m = spawnModelFromNames('ShutterWaterD101', 'ShutterWaterD101');
            m.setBounds([-100, -400, -400], [100, 400, 400]);
        }
        // Birdge from Whip Lever
        else if (name === 'BridgeS') {
            const m = spawnModelFromNames('BridgeD101', 'BridgeD101');
            m.setBounds([-5600, 550, 100], [-4000, 1000, 1950]);
        }
        // Roll pillars for vines TODO: add rotation
        else if (name === 'rpiller'){
            const type = (params1 >>> 28) & 0xF;
            const typeName = 'SpinPillarD101'+['A','A','B','C','A','B','C'][type];
            const m = spawnModelFromNames('SpinPillarD101', typeName);
            if (type === 1 || type === 4) {
                m.setBounds([-450, -100, -450], [450, 2000, 450]);
            } else if (type === 2 || type === 5) {
                m.setBounds([-850, -100, -850], [850, 2000, 850]);
            } else if (type === 3 || type === 6) {
                m.setBounds([-1300, -100, -1300], [1300, 2000, 1300]);
            } else {
                console.warn(name, "Invalid BBOX for type", type);
            }
        }
        // Doors
        else if (name === 'Door') {
            const type = params1&0x3f;
            const arcName = 'Door'+['A00','A01','C00','C01','B00','E','A02','F','H'][type];
            if (type === 5) {
                const m0 = spawnModelFromNames(arcName, 'DoorE_N');
                const m1 = spawnModelFromNames(arcName, 'DoorE_T');
                m0.setTime(ZSSTime.PRESENT);
                m1.setTime(ZSSTime.PAST);
                m0.setBounds([-1300, -50, -1000], [1300, 100, 1000]);
                m1.setBounds([-1300, -50, -1000], [1300, 100, 1000]);
            } else {
                const m = spawnOArcModel(arcName);
                m.setBounds([-1300, -50, -1000], [1300, 100, 1000]);
            }
        }
        // Bombable Rocks
        else if (name === 'BlsRock'){
            const type = (params1 >>> 8) & 0xFF;
            const arcName = ['TeniCrystalRockSc','BRockHole00','BRockWall','BRockDoor00','BRockR01','BrokenRockWallD200','LavaBRock','BRockWall','BRockCrystal','BRockF202','BRockRail','F300BrokenRockWall','F300BrokenRockWall','BWallAF200','BWallBF200','BWallF210','BRockStopA','BRockHole00','BWallD201','BRockWall',][type];
            const modelName = ['TeniCrystalRockScA','BRockHole00A','BRockWall00A','BRockDoor00A','BRockR01A','BrokenRockWallD200','LavaBRockA','BRockWall00A','BRockCrystalA','BRockF202A','BRockRailA','F300BrokenRockWall_00','F300BrokenRockWall_01','BWallAF200','BWallBF200','BWallF210','BRockStopAA','BRockHole01A','BWallD201','BRockWall00A',][type];
            const m = spawnModelFromNames(arcName, modelName);
            calcModelBounds(m);
        }
        // Island with spiral charge rocks
        else if (name === 'IslTreB') {
            const m0 = spawnOArcModel('IslTreI');
            const m1 = spawnOArcModel('IslTreIRock');
            m0.setBounds([-1200, -1200, -1100], [1200, 1600, 1200]);
            m0.addChild(m1);
        }
        // Islands in the Sky
        else if (name === 'IslTrea') {
            const type = params1 & 0xF;
            const typeName = 'IslTre'+['A','B','C','D','E','F','G','H'][type];
            const m = spawnOArcModel(typeName);
            m.setBounds([-1850, -2050, -1900], [1950, 2500, 1850]);
            if (type === 2){
                const w0 = spawnModelFromNames(typeName, typeName+'Water00');
                const w1 = spawnModelFromNames(typeName, typeName+'Water01');
                m.addChild(w0);
                m.addChild(w1);
            }
        }
        // Rocks in the Sky
        else if (name === 'RockSky') {
            const type = params1 & 0xF;
            const typeName = 'RockSky'+['A','B','C','D',][type];
            const m = spawnOArcModel(typeName);
            calcModelBounds(m);
        }
        // Digging holes for mitts
        else if (name === 'InHole') {
            const m0 = spawnModelFromNames('MoundShovelB', 'MoundShovelB');
            const m1 = spawnModelFromNames('MoundShovelB', 'HoleShovelB');
            m0.setBounds([-100, -300, -100], [100, 300, 100]);
            m0.addChild(m1);
        }
        // Walltulas
        else if (name === 'EWs') {
            const m = spawnOArcModel('StalWall');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('StalWall'), 'wait00'));
            m.scaleConstant(0.5);
            m.rotateXYZ([Math.PI/2, 0, 0]);
            m.setBounds([-150, -0, -150], [150, 150, 150]);
        }
        // Scrapper
        else if (name === 'NpcSlFl') {
            const m = spawnOArcModel('DesertRobot');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('DesertRobot_Sal'), 'DesertRobot_Sal_Fly'));
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Musasabi Tag spawns the little circle animals when diving
        // else if (name === 'MssbTag') {
        //     const m = spawnOArcModel('DesertMusasabi');
        //     const rres = getOArcRRES('DesertMusasabi');
        //     m.bindCHR0(this.animationController, findCHR0(rres, 'DesertMusasabi_dive_loop'));
        //     m.bindPAT0(staticFrame(0), findPAT0(rres, 'DesertMusasabi'));
        //     scaleConstant(m, 0.0001);
        // }
        // Gossip Stones (Harp Hints)
        else if (name === 'HrpHint') {
            const type = (params1>>>0x18) & 0x1;
            const m = spawnOArcModel(['GossipStone', 'ShiekahStone'][type]);
            m.setBounds([-120, -0, -100], [120, 200, 100]);
        }
        // Little Pots
        else if (name === 'Tubo') {
            const m = spawnModelFromNames('Tubo', 'Tubo0'+['0','1'][params1&1]);
            m.setBounds([-100, -40, -100], [100, 180, 100]);
        }
        // Big Pots
        else if (name === 'BigTubo') {
            const m = spawnOArcModel('TuboBig');
            m.setBounds([-70, -10, -70], [70, 140, 70]);
        }
        // Barrels
        else if (name === 'Barrel') {
            const type = (params1>>>0)&0xF;
            const modelName = type === 1 ? 'BarrelBomb' : 'Barrel';
            const m = spawnOArcModel(modelName);
            m.setBounds([-55, -10, -55], [55, 150, 55]);
            if (type === 1) {
                m.setTime(ZSSTime.PAST);
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
            const type = (params1 >>> 8) & 0xF;
            const mdlName = 'SaveObject'+['B','A','C'][type];
            const m = spawnOArcModel(mdlName);
            calcModelBounds(m);
        }
        // Knight Leader
        else if (name === 'NpcKnld') {
            const rres = getOArcRRES('Lord');
            const m = spawnOArcModel('Lord');
            m.bindRRESAnimations(this.animationController, rres, 'Lord_wait');
            m.bindCHR0(this.animationController, mergeCHR0(rres, 'Lord_wait', 'Lord_F_wait'));
            m.translate([0, 18, 0]);
            m.setBounds([-280, -10, -280], [280, 390, 180]);
            
            const swordMdl = spawnModel(rres, 'SwordLord');
            m.addChild(swordMdl, 'SwordH')
        }
        // moveable lava in Eldin
        else if (name === 'UDLava') {
            const type = params1&0x3;
            const arcName = 'UpdwnLava';
            const mdlName = arcName+['A','B','C'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            m.bindRRESAnimations(this.animationController, getOArcRRES(arcName), 'UpdwnLava');
            if (type === 0) {
                m.translate([0, 175, 0]);
            }
            // No bbox, usually always loaded I guess.
        }
        // Goddess Cubes
        else if (name === 'GodCube') {
            const doDisplay = (params1>>>24) & 0x1;
            if (doDisplay === 0) {
                const m = spawnOArcModel('GoddessCube', false);
                m.setBounds([-100, 0, -100], [100, 200, 100]);
            }
        }
        // Thunderhead Cloud Dome
        else if (name === 'CmCloud') {
            const type = params1&0x1;
            const typeName = 'F020Cloud'+['','Inside'][type];
            const m0 = spawnModelFromNames(typeName,typeName);
            const m1 = spawnModelFromNames(typeName,typeName+'_s');
            calcModelBounds(m0);
            m0.addChild(m1);
        }
        // Paintings of Groose And Batreaux
        else if (name === 'Paint') {
            const m = spawnModelFromNames('Paint', 'Paint'+['A','B'][params1&1]);
            calcModelBounds(m);
        }
        // Groose's sandbag
        else if (name === 'Sandbag') {
            const m = spawnOArcModel('DecoC');
            m.setBounds([-50, -400, -50], [50, 50, 50]);
        }
        // Clawshot Targets
        else if (name === 'ClawSTg') {
            const m = spawnOArcModel('ShotMark');
            m.setBounds([-100, -100, -50], [100, 100, 50]);
        }
        // Under Cloud stuff
        else if (name === 'UdCloud') {
            const m = spawnOArcModel('F020UnderCloud');
            m.setBounds([-550000, -30000, -500000], [500000, -10000, 500000]);
        }
        // Viewing Platform in Faron
        else if (name === 'ObjBld') {
            const m = spawnOArcModel('DowsingZoneE300');
            calcModelBounds(m);
        }
        // Faron water
        else if (name === 'WtrF100') {
            const rres = getOArcRRES('WaterF100');
            const m0 = spawnModel(rres, 'model0');
            const m1 = spawnModel(rres, 'model1');
            const m2 = spawnModel(rres, 'model2');
            const m3 = spawnModel(rres, 'model3');
            m0.setBounds([-1400, -100, 6300], [12500, 1800, 17300]);
            m0.addChild(m1);
            m0.addChild(m2);
            m0.addChild(m3);
        }
        // Eldins lava
        else if (name === 'LavF200') {
            const m0 = spawnModelFromNames('LavaF200', 'LavaF200');
            const m1 = spawnModelFromNames('LavaF200', 'LavaF200_s');
            // No bbox, Always loaded
            m0.addChild(m1);
        }
        // bug island
        else if (name === 'IslIns') {
            const m0 = spawnModelFromNames('IslIns', 'IslIns');
            const m1 = spawnModelFromNames('IslIns', 'IslInsWater00');
            const m2 = spawnModelFromNames('IslIns', 'IslInsWater01');
            m0.setBounds([-4700, -2500, -3000], [3300, 1800, 2400]);
            m0.addChild(m1);
            m0.addChild(m2);
        }
        // Mogma left over ground spec
        else if (name === 'MoSoil') {
            const m = spawnModelFromNames('MogumaMud', 'MogumaMud');
            m.setBounds([-100, -0, -100], [100, 100, 100]);
        }
        // farmland
        else if (name === 'Soil') {
            const m = spawnModelFromNames('MoundShovel', 'MoundShovel');
            m.setBounds([-100, -10, -100], [100, 50, 100]);
        }
        // Main platform for isle of songs puzzle
        else if (name === 'PzlLand') {
            const m = spawnModelFromNames('IslPuz', 'IslPuz');
            calcModelBounds(m);
        }
        // Island for Pumpkin soup (Has rainbow)
        else if (name === 'IslNusi') {
            const m0 = spawnModelFromNames('IslNusi', 'IslNusi');
            const m1 = spawnModelFromNames('IslNusi', 'IslNusi_s');
            m0.setBounds([-4000, -1200, -2700], [4800, 3400, 1700]);
            m0.addChild(m1);
        }
        // Stone tablets with Text
        else if (name === 'KanbanS') {
            const m = spawnOArcModel('KanbanStone');
            calcModelBounds(m);
        }
        // Wooden logs in Faron
        else if (name === 'Log') {
            const m = spawnOArcModel('Log');
            calcModelBounds(m);
        }
        // Beehives and bees
        else if (name === 'Bee') {
            const m = spawnModelFromNames('Bee', 'home');
            m.translate([0, -100, 0]);
            calcModelBounds(m);
        }
        // Isle of Songs puzzle switch
        else if (name === 'SwDir') {
            const m = spawnModelFromNames('SwichThree', 'SwitchThree');
            m.setBounds([-150, -0, -75], [150, 200, 75]);
        }
        // Isle of songs main building
        else if (name === 'Utajima') {
            const m0 = spawnModelFromNames('IslSon', 'IslSon');
            const m1 = spawnModelFromNames('IslSon', 'IslSon_s');
            m0.addChild(m1);

            calcModelBounds(m0);
        }
        // Sand piles
        else if (name === 'vmSand') {
            const m = spawnOArcModel('SandHill');
            m.setTime(ZSSTime.PRESENT);
            m.setBounds([-60 * obj.sx, -50         , -60 * obj.sz],
                        [ 60 * obj.sx,  60 * obj.sy,  60 * obj.sz]);
        }
        // Wooden Boxes
        else if (name === 'Kibako') {
            const hanging = (params1&0xF) === 1;
            const m = spawnOArcModel('KibakoHang');
            if (hanging) {
                m.setBounds([-750, -800, -250], [100, 200, 1000]);
            } else {
                m.setBounds([-250, -100, -250], [250, 200, 250]);
            }
        }
        // The Stones to use to go to Skywkeep
        else if (name === 'ToD3Stn') {
            const m = spawnModelFromNames('BirdObjD3', 'BirdObjD3A');
            calcModelBounds(m);
        }
        // The lever in beetles shop
        else if (name === 'TerrSw') {
            const m = spawnModelFromNames('TerrySwitch', 'TerrySwitchi');
            calcModelBounds(m);
        }
        // The trapdoor in Beetles shop
        else if (name === 'TerrHol') {
            const m = spawnOArcModel('TerryOtoshiana');
            calcModelBounds(m);
        }
        // The mechanism in beetles shop
        else if (name === 'TerrGmk') {
            const rres = getOArcRRES('TerryGimmick');
            rres.vis0 = []; // Hack as Vis0 seems broken
            const m = spawnModel(rres, 'TerryGimmick');
            calcModelBounds(m);
        }
        // Beedles Shop
        else if (name === 'Tshop') {
            const rres = getOArcRRES('TerryShop');
            if (this.stageId === 'F020') // turns it off at night
                rres.chr0 = [];
            const m0 = spawnModel(rres, 'TerryShop');
            const m1 = spawnModel(rres, 'TerryBell');
            const m2 = spawnModel(rres, 'TerryHaguruma_g');
            calcModelBounds(m0);
        }
        else if (name === 'ShpSmpl') {
            const type = params1&0x7F;
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
                m.translate([0, translateY, 0]);
                m.scaleConstant(1.7);
                m.setBounds([-20, -0, -20], [20, 90, 20]);
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
                m.addChild(driver, 'HandR');
                m.addChild(chair);
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
            const type = params1 & 0xF;
            if (type !== 1) {
                const arcName = 'Candle0'+['0','0','1','2'][type];
                const modelName = 'Candle'+['','','01','02'][type];
                const m = spawnModelFromNames(arcName, modelName);
                m.setBounds([-70, -50, -70], [70, 200, 70]);
            }
            console.info('Revist Fire Later');
        }
        // Gondos Repair object, theres also a B variant
        else if (name === 'JunkRep') {
            const m = spawnModelFromNames('Junk', 'JunkRepairobject');
            m.setBounds([-30, -0, -20], [30, 120, 20]);
        }
        // Chef NPC in bazaar
        else if (name === 'NpcChef'){
            const rres = getOArcRRES('Chef');
            const chr = mergeCHR0(rres, 'Chef_wait', 'Chef_F_wait');
            spawnModel(rres, 'ChefPot');
            const m = spawnModel(rres, 'Chef');
            m.bindCHR0(this.animationController, chr);
            m.bindSRT0(this.animationController, findSRT0(rres, 'Chef_wait'));
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Place for stone tablets in goddess statue
        else if (name === 'SndStn') {
            const rres = getOArcRRES('LithographyStand');
            const stand = spawnModel(rres, 'LithographyStand');
            stand.setBounds([-75, -15, -75], [75, 105, 75]);
            const node = stand.findNode('SetGS')!;
            mat4.translate(node.modelMatrix, node.modelMatrix, [0, 90, 0]);
            
            const emerald = spawnModel(rres, 'SekibanMapADemo');
            const ruby = spawnModel(rres, 'SekibanMapBDemo');
            const amber = spawnModel(rres, 'SekibanMapCDemo');
            const crest = spawnOArcModel('GoddessSymbolSc');

            stand.addChild(emerald, 'locator_A');
            stand.addChild(   ruby, 'locator_B');
            stand.addChild(  amber, 'locator_C');
            stand.addChild(  crest, 'SetGS');
        }
        // Batreaux Human
        else if (name === 'NpcAkuH') {
            const m = spawnOArcModel('DevilB');
            const chr = mergeCHR0(getOArcRRES('Devil'), 'Devil_wait', 'Devil_F_wait');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-150, -50, -150], [150, 300, 150]);
        }
        // bigger dude chilling in bazaar... Called SoManD what other way to describe
        else if (name === 'NpcSMnD') {
            const rres = getOArcRRES('SoManD');
            const m = spawnOArcModel('SoManD');
            const chr = mergeCHR0(rres, 'SoManD_wait', 'SoManD_F_wait');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Other older dude sitting in bazaar
        else if (name === 'NpcSMnE') {
            const rres = getOArcRRES('SoManE');
            const m = spawnOArcModel('SoManE');
            const chr = mergeCHR0(rres, 'SoManE_wait', 'SoManE_F_wait');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Broken Robot in bazaar
        else if (name === 'NpcSlRp') {
            const m = spawnOArcModel('DesertRobotN');
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Keese
        else if (name === 'EKs') {
            const type = params1&0x7;
            const arcName = ['Kiesu','Kiesu_fire','Kiesu_electric','KiesuDevil'][type];
            const mdlName = ['kiesu','F_kiesu','EKiesu','DKiesu'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            m.bindPAT0(this.animationController, findPAT0(getOArcRRES(arcName), 'blink_1'));
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Kiesu_anime'), 'fly'));
            m.translate([0,-30,0]);
            m.setBounds([-250, -800, -250], [250, 250, 250]);
        }
        // Sword Pedestal
        else if (name === 'SwrdSt') {
            const m = spawnOArcModel(['SwordSeal','SwordGrd'][params1&1]);
            m.setBounds([-75, -10, -75], [75, 200, 75]);
        }
        // Goddess Crest (Switch Sword Beam)
        else if (name === 'SwSB') {
            const m = spawnOArcModel('GoddessSymbolSc');
            m.setBounds([-100, -50, -50], [100, 55, 50]);
        }
        // Chandelier
        else if (name === 'Chandel') {
            const m = spawnModelFromNames('Stage', 'StageF011rChanAft');
            m.setBounds([-400, -1500, -400], [400, 100, 400]);
        }
        // Pumpkin Master (Pumm)
        else if (name === 'NpcPma') {
            const rres = getOArcRRES('PumpkinMaster');
            const m = spawnModel(rres, 'PumpkinMaster');
            const chr = mergeCHR0(rres, 'PumpkinMaster_wait', 'PumpkinMaster_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'PumpkinMaster');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-200, -100, -200], [200, 300, 200]);
        }
        // Fledge - Pumpkin Archery Minigame
        else if (name === 'NpcPcs') {
            const rres = getOArcRRES('FriendA');
            const m = spawnModel(rres, 'FriendA');
            const chr = mergeCHR0(rres, 'FriendA_wait', 'FriendA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'FriendA');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-100, -10, -100], [100, 200, 100]);
        }
        // NPCs on Skyloft Bridge during layer 10
        else if (name === 'NpcDoML') {
            const rres = getOArcRRES('DouguyaMotherLOD');
            const m = spawnModel(rres, 'DouguyaMotherLOD');
            const chr = mergeCHR0(rres, 'DouguyaMotherLOD_wait', 'DouguyaMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'DouguyaMotherLOD');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-250, -100, -300], [200, 200, 200]);
        }
        else if (name === 'NpcJkML') {
            const rres = getOArcRRES('JunkMotherLOD');
            const m = spawnModel(rres, 'JunkMotherLOD');
            const chr = mergeCHR0(rres, 'JunkMotherLOD_wait', 'JunkMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'JunkMotherLOD');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-200, -100, -200], [200, 200, 200]);
        }
        else if (name === 'NpcSAML') {
            const rres = getOArcRRES('SenpaiAMotherLOD');
            const m = spawnModel(rres, 'SenpaiAMotherLOD');
            const chr = mergeCHR0(rres, 'SenpaiAMotherLOD_wait', 'SenpaiAMotherLOD_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SenpaiAMotherLOD');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-200, -100, -200], [200, 200, 200]);
        }
        // Boy who bonks into tree for Bug
        else if (name === 'NpcSoBo') {
            const rres = getOArcRRES('SoBoyA');
            const m = spawnModel(rres, 'SoBoyA');
            const chr = mergeCHR0(rres, 'SoBoyA_wait', 'SoBoyA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SoBoyA');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-100, -50, -100], [100, 200, 100]);
        }
        // Orielle
        else if (name === 'NpcSowo') {
            const rres = getOArcRRES('SoWoManA');
            const m = spawnModel(rres, 'SoWomanA');
            const chr = mergeCHR0(rres, 'SoWomanA_wait', 'SoWomanA_F_wait');
            m.bindRRESAnimations(this.animationController, rres, 'SoWoManA');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-185, -10, -185], [185, 260, 185]);
        }
        // Zelda
        else if (name === 'NpcZld') {
            const body_rres = getOArcRRES('Zelda');
            const face_rres = getOArcRRES('Zelda_face');
            const hair_rres = getOArcRRES('Zelda_hair');
            const handl_rres = getOArcRRES('Zelda_handL');
            const handr_rres = getOArcRRES('Zelda_handR');

            const body_mdl = spawnModel(body_rres, 'Zelda_body'); 
            const face_mdl = spawnModel(face_rres, 'Zelda_face'); 
            const hair_mdl = spawnModel(hair_rres, 'Zelda_hair'); 
            const handl_mdl = spawnModel(handl_rres, 'Zelda_handL'); 
            const handr_mdl = spawnModel(handr_rres, 'Zelda_handR'); 

            body_mdl.setBounds([-200, -100, -200], [200, 300, 200]);
            body_mdl.addChild(face_mdl, 'Head')
            body_mdl.addChild(hair_mdl, 'Head')
            body_mdl.addChild(handl_mdl, 'HandL')
            body_mdl.addChild(handr_mdl, 'HandR')

            // Bind All default Anms
            body_mdl.bindRRESAnimations(this.animationController, body_rres, 'Zelda');
            face_mdl.bindRRESAnimations(this.animationController, face_rres, 'Zelda');
            hair_mdl.bindRRESAnimations(this.animationController, hair_rres, 'Zelda');
            handl_mdl.bindRRESAnimations(this.animationController, handl_rres, 'Zelda');
            handr_mdl.bindRRESAnimations(this.animationController, handr_rres, 'Zelda'); 
            
            // Zelda Caring for Loftwing
            if (this.stageId === 'F000' && this.globals.currentLayer === 1 && obj.id === 0xFDC5) {
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
            const m = spawnModelFromNames('BirdZelda', 'BirdZelda');
            m.setBounds([-300, -0, -300], [300, 200, 300]);
            if (this.stageId === 'F000') {
                if (this.globals.currentLayer === 10) {
                    m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Glide'));
                } else if (this.globals.currentLayer === 1) {
                    m.bindCHR0(this.animationController, findCHR0(getOArcRRES('BirdAnm'), 'Down'));
                }
            }
        }
        // Pipit
        else if (name === 'NpcSenp') {
            const rres = getOArcRRES('SenpaiA');
            const m0 = spawnModel(rres, 'SenpaiA');
            const chr = mergeCHR0(rres, 'SenpaiA_wait', 'SenpaiA_F_wait');

            m0.bindRRESAnimations(this.animationController, rres, 'SenpaiA');
            m0.bindCHR0(this.animationController, chr);
            m0.setBounds( [-260, -10, -260], [260, 350, 260]);

            const m1 = spawnModel(rres, 'SwordSenpaiA');
            m0.addChild(m1, 'SwordW');
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
            const m = spawnOArcModel('SoManB');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManB_sit'),'SoManB_sit_wait'));
            m.setBounds([-150, -100, -150], [150, 300, 150]);
        }
        else if (name === 'NpcSma3') {
            const m = spawnOArcModel('SoManC');
            if (this.stageId !== 'F000')
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_sit'),'SoManC_sit_wait'));
            else
                m.bindCHR0(this.animationController, findCHR0(getOArcRRES('SoManC_stand'),'SoManC_stand_wait'));
            m.setBounds([-150, -100, -150], [150, 300, 150]);
        }
        // Little Girl
        else if (name === 'NpcSoG') {
            const rres = getOArcRRES('SoGirl');
            const m = spawnOArcModel('SoGirl');
            const chr = mergeCHR0(rres, 'SoGirl_wait', 'SoGirl_F_wait');
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-100, -10, -100], [100, 150, 100]);
        }
        // Eye Dude
        else if (name === 'NpcSha') {
            const rres = getOArcRRES('Uranaiya');
            const m = spawnOArcModel('Uranaiya');
            const chr = mergeCHR0(rres, 'Uranaiya_wait', 'Uranaiya_F_wait');
            const pat = findPAT0(rres, 'Uranaiya');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Crystal Ball
        else if (name === 'DivCrst') {
            const type = params1&0xF;
            if (!(this.stageId === 'F013r' && this.globals.currentLayer === 0)) {
                const m = spawnOArcModel('F004rCrystalWell');
                if (this.stageId === 'F200') {
                    m.scaleConstant(2);
                }
                m.setBounds([-50, -50, -50], [50, 50, 50]);
            }
        }
        // Pipets mom
        else if (name === 'NpcSAMo') {
            const rres = getOArcRRES('SenpaiAMother');
            const m = spawnOArcModel('SenpaiAMother');
            const chr = mergeCHR0(rres, 'SenpaiAMother_wait', 'SenpaiAMother_F_wait');
            m.bindCHR0(this.animationController, chr);
            m.setBounds( [-100, -100, -100], [100, 200, 100]);
        }
        // Dust Piles
        else if (name === 'VacuDst') {
            const m = spawnModelFromNames('Stage', 'VacuumDust')
            m.translate([0, 1, 0]);
            calcModelBounds(m);
        }
        // Dust Piles
        else if (name === 'VacuDsP') {
            const type = params1&0xF;
            const m = spawnModelFromNames('Stage', 'StageVacDusParts'+['A','B','C','D','E'][type]);
            calcModelBounds(m);
        }
        // Pink Key Parella
        else if (name === 'NpcSui') {
            const m = spawnOArcModel('SuiseiBoss');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
            m.setBounds([-50, -10, -50], [50, 150, 50]);
        }
        // Parallela
        else if (name === 'NpcSuiS' || name === 'NpcSuiN') {
            const m = spawnOArcModel('Suisei');
            m.bindCHR0(this.animationController, findCHR0(getOArcRRES('Suisei_motion'), 'Suisei_motion_wait'));
            m.setBounds([-50, -10, -50], [50, 150, 50]);
        }
        // Water nuts
        else if (name === 'WatrIga') {
            const m = spawnOArcModel('NeedleBallWater');
            m.setBounds([-80, -560, -60], [80, 60, 60]);
        }
        // Whip Swing things
        else if (name === 'TPole'){
            const m = spawnOArcModel('WhipBar');
            m.setBounds([-0, -120, -110], [500, 140, 110]);
        }
        // The horizontal spin switches for the whip
        else if (name === 'BulbSW'){
            const m = spawnOArcModel('SwitchValve');
            m.setBounds([-100, -170, -100], [100, 100, 100]);
        }
        // Vertixal whip levers
        else if (name === 'sw_whip'){
            const m = spawnOArcModel('SwitchWhip');
            m.setBounds([-300, -0, -100], [300, 400, 100]);
        }
        // StalMaster (jannon :D )
        else if (name === 'ESf4') {
            const rres = getOArcRRES('Sf4');

            const m = spawnModel(rres, 'Stalfos4');
            const mA = spawnModel(rres, 'Sf4SwordA');
            const mB = spawnModel(rres, 'Sf4SwordB');
            const mC = spawnModel(rres, 'Sf4SwordC');
            const mD = spawnModel(rres, 'Sf4SwordD');
            m.addChild(mA, 'loc_SwordA');
            m.addChild(mB, 'loc_SwordB');
            m.addChild(mC, 'loc_SwordC');
            m.addChild(mD, 'loc_SwordD');

            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
            m.scaleConstant(1.3);
            m.setBounds([-200, -75, -200], [200, 250, 200]);
        }
        // Direction Switches
        else if (name === 'SwDir2') {
            const m = spawnOArcModel('SwitchDirect');
            m.rotateXYZ([Math.PI/2, 0, 0]);
            m.translate([0, 150, -100]);
            m.setBounds([-100, -10, -100], [100, 250, 100]);
        }
        // Wall Switches (the bar where you can usually run up the wall)
        else if (name === 'SwWall') {
            const m = spawnOArcModel('SwitchWall');
            m.setBounds([-100, -50, -50], [100, 50, 50]);
        }
        // Cursed Bokos
        else if (name === 'EBcZ') {
            const rres = getOArcRRES('Bocoburin_Z');
            const m = spawnModel(rres, 'bocoburin_Z');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait0'));
            m.setBounds([-150, -150, -150], [150, 250, 230]);
        }
        // Tower Hands
        else if (name === 'TowerHa') {
            const m = spawnOArcModel('TowerHandD101');
            if (params1&1) {
                // Need to mirror the hand
               m.scale([-1, 1, 1]);
                m.modelInstance.shapeInstances.forEach((shp) => {
                    shp.materialInstance.materialHelper.megaStateFlags.frontFace = GfxFrontFaceMode.CCW;
                });
            }
            m.setBounds([-1000, 0, -600], [1000, 1000, 1000]);
        }
        // Tower Gears
        else if (name === 'TGrD101') {
            const m = spawnOArcModel('TowerGearD101');
            calcModelBounds(m);
        }
        // Furnix
        else if (name === 'EHidory') {
            const rres = getOArcRRES('Hidory');
            const m = spawnModel(rres, 'Hidory');
            m.bindCHR0(this.animationController, findCHR0(rres, 'hovering'));
            m.setBounds([-270, -1000, -600], [270, 200, 1000]);
        }
        // Staltula
        else if (name === 'Est') {
            const rres = getOArcRRES('Staltula');
            const m = spawnModel(rres, 'Stalchula');
            m.bindCHR0(this.animationController, findCHR0(rres, 'Wait'));
            m.setBounds([-100, -100, -100], [100, 200, 100]);
        }
        // Remlits
        else if (name === 'ERemly') {
            const rres = getOArcRRES('Remly');
            const m = spawnModel(rres, 'Remly'); 
            m.bindCHR0(this.animationController, findCHR0(rres, 'RemlySleep'));
            m.bindPAT0(this.animationController, findPAT0(rres, 'RemlyWink'));
            m.setBounds([-150, -700, -150], [150, 150, 150]);
        }
        // Waterfalls in Ancient Cistern
        else if (name === 'wfall') {
            const type = (params1 >>> 28) & 0xF
            if (type !== 0){
                const rres = getOArcRRES('WaterfallD101');
                const m = spawnModel(rres, 'WaterfallD101'+['A','B','C'][type-1]);
                if (type === 1) {
                    m.bindCLR0(staticFrame(0), findCLR0(rres, "WaterfallD101A"));
                }
                else if (type === 3) {
                    m.bindSRT0(this.animationController, findSRT0(rres, "WaterfallD101C_Out"));
                }
                if (type === 1) {
                    m.setBounds([-500, -1700, -1200], [500, 1700, 1200]);
                } else if (type === 2) {   
                    m.setBounds([-500, -1000, -2200], [500, 1000, 2200]);
                } else if (type === 3) {
                    m.setBounds([-600, -700, -400], [600, 600, 1000]);
                }
            }
        }
        else if (name === "FrtTree") {
            const type = params1 & 0xFF;
            if (type === 0) {
                const m = spawnModelFromNames('Stage', 'StageF302Wood');
                m.setTime(ZSSTime.PAST);
                m.setBounds([-400, -0, -400], [400, 800, 400]);
            } else {
                const m = spawnModelFromNames('Stage', 'StageF402Wood');
                m.setBounds( [-700, -0, -700], [700, 1200, 700]);
            };
        }
        // Fruit
        else if (name === 'fruit') {
            const type = params1 & 0xFF;
            const m = spawnOArcModel('FruitA');
            if (type === 0) {
                m.setBounds([-400, -0, -400], [400, 800, 400]);
            } else {
                m.setBounds([-700, -0, -700], [700, 1200, 700]);
            }
        }
        // Sunlight beams in Faron
        else if (name === 'Light00') {
            // This actor is technically supported for DowsingZoneE300, 
            // but that variant doesnt exist ever.
            const m = spawnOArcModel('Light00');
            calcModelBounds(m);
        }
        // End Boss Doors to Springs
        else if (name === 'SldDoor') {
            const rres = getOArcRRES('SB'+['Din','Ferore','Nayru','Goodess'][params1&0xF]);
            const m = spawnModel(rres, 'ShutterBoss');
            const animRres = getOArcRRES('SBAnm');
            m.bindCLR0(this.animationController, findCLR0(animRres, 'ShutterBossSealWink'));
            calcModelBounds(m);
        }
        // Skulls that can spawn drops
        else if (name === 'skull') {
            const m = spawnModelFromNames('Skull', 'BocoBone02');
            m.setBounds([-50, -10, -50], [50, 70, 50]);
        }
        // Lotus Flowers
        else if (name === 'LtsFlwr') {
            const type = params1&1;
            const arc = ['LotusFlower','LotusSeed'][type];
            const mdl = ['LotusFlower', 'LotusSeedCut'][type];
            const m = spawnModelFromNames(arc, mdl);
            m.setBounds([-150, -50, -150], [200, 100, 150]);
        }
        // Water Logs
        else if (name === 'LogWtr') {
            const type = params1 & 1;
            const m = spawnOArcModel(['LogFloat','LogStep'][type]);
            if (type === 1)
                m.translate([0, 500, 0]);
            calcModelBounds(m);
        }
        // Cistern Boss Door
        else if (name === 'BDrD101') {
            const m0 = spawnOArcModel('DoorBossD101');
            const m1 = spawnOArcModel('DoorBossD101');
            m1.rotateXYZ([Math.PI, 0, Math.PI]);
            m0.setBounds([-1300, -50, -1000], [1300, 100, 1000]);
            m0.addChild(m1);
        }
        // Cistern Tower
        else if (name === 'ftower') {
            const m = spawnOArcModel('TowerD101');
            m.setBounds([-1500, -2500, -1400], [1500, 6000, 1800]);
        }
        // Crystal Switches
        else if (name === 'Swhit') {
            const rres = getOArcRRES('SwitchHit');
            const m0 = spawnModel(rres, 'SwitchHitBase');
            const m1 = spawnModel(rres, 'SwitchHit');
            m1.bindSRT0(this.animationController, findSRT0(rres, 'SwitchHit_kirari'));
            m0.addChild(m1);

            m0.setBounds([-150, -90, -65], [150, 300, 65]);
        }
        // Wooden Boards to break
        else if (name === 'WdBoard') {
            const m0 = spawnModelFromNames('BreakBoard', 'BreakBoardA');
            const m1 = spawnModelFromNames('BreakBoard', 'BreakBoardB');
            m0.setBounds([-210, -10, -40], [210, 410, 40]);
            m1.setBounds([-210, -10, -40], [210, 410, 40]);
        }
        // Water Surface
        else if (name === 'WaterSf'){
            const type = (params1 >>> 16) & 0xF;
            const rres = 'Water'+['D100_r02','D100_r03','D100_r04','D100_r06','F103','F100_b','F104A','F104B','F104C','F104D'][type];
            const m0  = spawnModelFromNames(rres, 'model0');
            const m1 = spawnModelFromNames(rres, 'model1');
            if (this.stageId === 'D100'){
                m0.translate([0,500,0]);
                m1.translate([0,500,0]);
            }
            calcModelBounds(m0);
        }
        // Small Goddess Statues
        else if (name === 'SngGS') {
            const statue = spawnOArcModel('GoddessStatue');
            const crest = spawnOArcModel('GoddessSymbolSc');
            const node = statue.findNode('SetGS')!;
            mat4.translate(node.modelMatrix, node.modelMatrix, [0, 90, 0]);
            calcModelBounds(statue);
            statue.addChild(crest, 'SetGS');
        }
        // Ancient Jwls (Treasure)
        else if (name === 'AncJwls'){
            const type = params1 & 0xF;
            const arcName = 'GetSozai'+['H','G','P'][type];
            const m = spawnOArcModel(arcName);
            m.scaleConstant([2,2,1.365][type]);
            m.setBounds([-50, -50, -50], [50, 50, 50]);
        }
        // Iron Fences
        else if (name === 'FenceIr') {
            const type = (params1>>>16)&1;
            const m = spawnOArcModel('FenceIron'+['','Small'][type]);
            calcModelBounds(m);
        }
        // Octarock
        else if (name === 'EOr') {
            const rres = getOArcRRES('Or');
            spawnModel(rres, 'octarock_hole');
            const m = spawnModel(rres, 'octarock');
            m.bindCHR0(this.animationController, findCHR0(rres, 'wait'));
            m.setBounds([-80, -80, -80], [80, 80, 80]);
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
            m.setBounds([-600, -0, -300], [600, 600, 300]);
        }
        // Carryable Stones
        else if (name === 'CyStone') {
            const type = params1 & 0xF;
            const arcName = ['RockCarrySmall','RockCarryMiddle','RockCarryMiddle','Syako_egg'][type];
            const mdlName = ['RockSmall','RockMiddle','RockMiddle','SyakoEgg'][type];
            const m = spawnModelFromNames(arcName, mdlName);
            if (type === 1 || type === 2)
                m.translate([0,75,0]);
            if (type === 1) {
                m.setBounds([-70, -70, -70], [70, 70, 70]);
            } else if (type === 2) {
                m.setBounds([-95, -95, -95], [95, 95, 95]);
            } else {
                m.setBounds([-30, -30, -30], [30, 30, 30]);
            }
        }
        // Little spikey balls
        else if (name === 'RopeIga'){
            const m = spawnOArcModel('NeedleBall');
            m.translate([0,15,0]);
            m.setBounds([-50, -50, -50], [50, 50, 50]);
        }
        // Froaks
        else if (name === 'EGeko'){
            const rres = getOArcRRES('Geko');
            const m = spawnModel(rres, 'Geko');
            const chr = findCHR0(rres,'run');
            const pat = findPAT0(rres, 'GekoWink');
            m.bindCHR0(this.animationController, chr);
            m.bindPAT0(this.animationController, pat);
            m.setBounds([-50, -50, -50], [50, 50, 50]);
        }
        // Deku Baba
        else if (name === 'Ehb') {
            const type = (params1 >> 3) & 0x3;
            const rres = getOArcRRES('Degubaba');
            const m0 = spawnModel(rres, 'degubaba_leaf');
            const newAnim = staticFrame([0, 0, 1, 1][type]);
            const m1 = spawnModel(rres, 'degubaba_head');
            m0.bindPAT0(newAnim, findPAT0(rres, 'degubaba_leaf'));
            m1.bindPAT0(newAnim, findPAT0(rres, 'degubaba_head'));
            m0.rotateXYZ([-Math.PI/2, 0, 0]);
            m0.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
            m1.rotateXYZ([-Math.PI/2, 0, 0]);
            m1.bindCHR0(this.animationController, findCHR0(rres, 'defaultpose'));
            m0.setBounds([-100, -100, -100], [100, 100, 100]);
            m1.setBounds( [-200, -200, -200], [200, 200, 200]);
        }
        // The Wall of water to keep you in bounds in Flooded Faron
        // Water Shield
        else if (name === 'WtrShld'){
            const m = spawnOArcModel('WaterWallF103');
            console.info('Look Into WtrShld rendering (cuts off on angles)');
            m.setBounds([-12000, -2000, -14000], [12000, 11000, 12000]);
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
            m.bindCHR0(this.animationController, chr);
            m.setBounds([-300, -60, -250], [300, 400, 500]);
            m.addChild(leaf, 'Tail');
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
            body.bindCHR0(this.animationController, findCHR0(rres, 'ForestMan_wait'));
            body.setBounds([-510, -10, -510], [510, 730, 510]);
            body.addChild(eyes, 'Head');
            body.addChild(leaf, 'Tail');
            body.addChild(hair, 'Hair');
        }
        // Yerbal
        else if (name === 'NpcKyuW') {
            const rres = getOArcRRES('ForestManWiz');
            const m = spawnModel(rres, 'ForestManWiz');
            m.bindCHR0(this.animationController, findCHR0(rres, 'ForestManWiz_wait'));
            m.setBounds([-230, -10, -230], [230, 315, 230]);
        }
        // Oolo
        else if (name === 'NpcOKyu') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeC');
            const hair = spawnModel(rres, 'ForestManHairC');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            body.bindCHR0(this.animationController, findCHR0(rres, 'ForestMan_wait'));
            body.setBounds([-510, -10, -510], [510, 730, 510]);
            body.addChild(eyes, 'Head');
            body.addChild(leaf, 'Tail');
            body.addChild(hair, 'Hair');
        }
        // Lopsa
        else if (name === 'Npckyu3') {
            const rres = getOArcRRES('ForestMan');
            const body = spawnModel(rres, 'ForestMan');
            const eyes = spawnModel(rres, 'ForestManEyeB');
            const hair = spawnModel(rres, 'ForestManHairB');
            const leafrres = getOArcRRES('ForestManLeaf');
            const leaf = spawnModel(leafrres, 'ForestManLeaf');
            leaf.bindRRESAnimations(this.animationController, leafrres, 'ForestManLeaf_Close');
            leaf.bindPAT0(staticFrame(0), findPAT0(leafrres, 'ForestManLeaf'));
            body.bindCHR0(this.animationController, findCHR0(rres, 'ForestMan_wait'));
            body.setBounds([-510, -10, -510], [510, 730, 510]);
            body.addChild(eyes, 'Head');
            body.addChild(leaf, 'Tail');
            body.addChild(hair, 'Hair');
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
            body.bindCHR0(this.animationController, chr);
            // this.modelBinds.push({model: hair, modelToBindTo: body, nodeName: "Hair"});
            // console.log('Fix Npckyu4 Anim');
            if (this.stageId === 'F103'){
                body.translate([0,58,0]);
            }
            body.setBounds([-510, -10, -510], [510, 730, 510]);
            body.addChild(eyes, 'Head');
            body.addChild(leaf, 'Tail');
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
            calcModelBounds(m);
        }
        // Eldin Wooden Towers
        else if (name === 'TowerB') {
            const type = (params1 >>> 16) & 0xF;
            const arcName = ['TowerBomb', 'TowerLight'][type];
            const mdlName = ['TowerBomb01', 'TowerLight'][type];
            const rres = getOArcRRES(arcName);
            const m = spawnModel(rres, mdlName); // Main Tower
            const legs = spawnModel(rres, 'TowerBomb00'); // Little Legs
            if ((params1&0xFF) === 0xFF)
                m.bindCHR0(this.animationController, findCHR0(rres, 'Falldown'));
            if (type === 1){
                const m2 = spawnModel(rres, 'FX_TowerLight');
                m2.bindCLR0(this.animationController, findCLR0(rres, 'FX_TowerLight'));
                m.addChild(m2);
            }
            m.setBounds([-800, -1000, -1500], [800, 1700, 750]);
            m.addChild(legs);
        }
        // Propeller
        else if (name === 'Propera') {
            const m = spawnOArcModel('Pinwheel');
            m.rotateXYZ([-Math.PI/2, 0, 0]);
            m.setBounds([-150, 150, -150], [150, -150, 150]);
        }
        // Pyrup Shells
        else if (name === 'EHidoS') {
            const type = ((params1&0xF) !== 0x0) ? 'BoneA' : 'BoneB';
            const m = spawnModelFromNames('HidokariS', type);
            m.setBounds([-200, -100, -200], [200, 200, 200]);
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
            calcModelBounds(m);
        }
        // Bone Bridges
        else if (name === 'BrgBn') {
            const m = spawnOArcModel('BoneBridge');
            m.setBounds([-1000, -100, -400], [0, 150, 320]);
        }
        // Extendable Bridges
        else if (name === 'BridgeB') {
            const m = spawnOArcModel('BridgeSwitch');
            m.translate([0, 0, 800]);
            m.setBounds([-210, -110, -10], [210, 10, 1080]);
        }
        // Floor Switches
        else if (name === 'Sw') {
            const type = params1&0xF;
            const arcName = 'SwitchStep'+['A','B','B'][type];
            const m = spawnOArcModel(arcName);
            m.scale([1 ,0.8, 1]);
            m.setBounds([-90, -10, -90], [90, 70, 90]);
        }
        // Fences in Eldin
        else if (name === 'FenceBk') {
            const m = spawnOArcModel('FenceBoko');
            m.setBounds([-210, -10, -20], [210, 340, 20]);
        }
        // Closed Bazaar entrances
        else if (name === 'MoleCvr') {
            const m = spawnModelFromNames('Stage', "StageF000MallCover");
            m.setBounds([-1900, -1100, -5500], [100, 1700, -1800]);
        }
        // Skyloft Bell
        else if (name === 'Bell') {
            const m = spawnModelFromNames('Stage', "StageF000Bell");
            m.setBounds([-160, -320, -160], [160, 10, 160]);
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
            m.setBounds([-100, -10, -100], [100, 250, 100]);

            const hair = spawnModel(rres, 'Moguma_hair'+['A','B','C','D','E','F','G'][type]);
            m.addChild(hair, 'Head');
        }
        // Mogmas
        else if (name === 'NpcMoT2') {
            const rres = getOArcRRES('MogumaDungeonB');
            const m = spawnModel(rres, 'MogumaDungeonB');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translate(m, [0,-75,0]);
            m.setBounds([-100, -10, -100], [100, 200, 100]);
        }
        else if (name === 'NpcMoT') {
            const rres = getOArcRRES('MogumaDungeonA');
            const m = spawnModel(rres, 'MogumaDungeonA');
            const chr = mergeCHR0(getOArcRRES('MogumaDungeon_motion'), 'MogumaDungeon_motion_wait', 'MogumaDungeon_motion_F_wait');
            m.bindCHR0(this.animationController, chr);
            // translate(m, [0,-75,0]);
            m.setBounds([-100, -10, -100], [100, 200, 100]);
        }
        // Old Mogma
        else if (name === 'NpcMoEl') {
            const rres = getOArcRRES('MogumaOld');
            const m = spawnModel(rres, 'MogumaOld');
            // const chr = mergeCHR0(getOArcRRES('Moguma'), 'Moguma_wait', 'Moguma_F_wait');
            // m.bindCHR0(this.animationController, chr);
            m.translate([0, -75, 0]);
            m.setBounds([-100, -0, -100], [100, 200, 100]);
        }
        else if (name === 'EHidoK') {
            const rres = getOArcRRES('Hidokari');
            const m = spawnModel(rres, 'Hidokari');
            m.bindRRESAnimations(this.animationController, rres, 'WaitA');
            m.setBounds([-200, -100, -200], [200, 200, 200]);
        }
        // Beedle
        else if (name === 'NpcTer') {
            // on skyloft night layer
            const rres = getOArcRRES('Terry');
            const m0 = spawnModel(rres, 'Terry');
            if (params1 & 1){
                const chr = mergeCHR0(rres, 'Terry_waitA', 'Terry_F_default');
                m0.bindCHR0(this.animationController, chr);
                m0.setBounds([-140, -0, -120], [1400, 205, 130]); 

                const m1 = spawnModel(rres, 'Terry_Log');
                m0.addChild(m1);
            }
            // In Shop
            else {
                const chr = mergeCHR0(rres, 'Terry_cycleB', 'Terry_F_default');
                m0.bindCHR0(this.animationController, chr);
                m0.setBounds([-80, -0, -30], [80, 200, 80]);

                const m1 = spawnModel(rres, 'TerryBicycle');
                m1.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));
                m1.setBounds([-20, -0, -70], [20, 90, 80]);
            }
        }
        // Beedles Bike
        else if (name === 'TerBike') {
            const rres = getOArcRRES('Terry');
            const m = spawnModel(rres, 'TerryBicycle');
            m.bindCHR0(this.animationController, findCHR0(rres, 'TerryBicycle_cycle'));
            m.setBounds([-20, -0, -70], [20, 90, 80]);
        }
        // Goddess Statue
        else if (name === "IslMegm") {
            const rres = getOArcRRES(['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m0 = spawnModel(rres, ['F000Megami', 'F000LastDungeon'][params1 & 0x3]);
            const m1 = spawnModel(rres, ['F000Megami_s', 'F000LastDungeon_s'][params1 & 0x3]);

            m0.setBounds([-5000, -5000, -23000], [5000, 10000, -9000]);
            m0.addChild(m1);
        }
        // Mushrooms
        else if (name === 'Kinoko' || name === 'SKinoko'){
            const type = params1 & 0x3;
            const arcName = 'Mushroom' + ['A','B','C','D'][type];
            const m = spawnOArcModel(arcName);
            switch (type) {
                case 0: m.setBounds([-150, -30, -150], [150, 250, 150]); break;
                case 1: m.setBounds([-100, -30, -100], [100, 250, 100]); break;
                case 2: m.setBounds([-100, -30, -100], [100, 350, 100]); break;
                case 3: m.setBounds([-100, -30, -100], [100, 250, 100]); break;
            }
        }
        else if (name === 'KinokoA') {
            const m = spawnOArcModel('MushroomA');
            m.setBounds([-150, -30, -150], [150, 250, 150]);
        }
        else if (name === 'KinokoB') {
            const m = spawnOArcModel('MushroomB');
            m.setBounds([-100, -30, -100], [100, 250, 100]);
        }
        else if (name === 'KinokoC') {
            const m = spawnOArcModel('MushroomC');
            m.setBounds([-100, -30, -100], [100, 350, 100]);
        }
        else if (name === 'KinokoD') {
            const m = spawnOArcModel('MushroomD');
            m.setBounds([-100, -30, -100], [100, 250, 100]);
        }
        // Various Chairs
        else if (['CharA', 'CharB', 'CharC'].includes(name)) { 
            spawnOArcModel(name).setBounds([-60, 0, -60], [60, 160, 60]);
        }
        // Various Plants
        else if (
            ['PltA00','PltA01','PltA02','PltB00','PltB01','PltB02',
             'PlntB','PlntA01','PlntA00','PlntC01','PlntC00'].includes(name)
        ) {
            spawnOArcModel(name).setBounds([-50, -10, -50], [50, 100, 50]);
        }
        // Various Cups
        else if (['CupA00','CupA01','CupA02','CupB00','CupB01','CupB02'].includes(name)) {
            spawnOArcModel(name).setBounds([-50, -10, -50], [50, 100, 50]);
        }
        // Flower Vases
        else if (['FlvsA','FlvsB','FlvsC'].includes(name)) {
            spawnOArcModel(name).setBounds([-50, -10, -50], [50, 100, 50]);
        }
        // Various Lamps
        else if (name === 'RoLight') { spawnOArcModel('F004rRotationLight'); }
        else if (['LampA','LampB','LampC','LampD'].includes(name)) {
            spawnOArcModel(name).setBounds([-100, -400, -100], [100, 50, 100]);
        }
        else if (['LampE','LampF'].includes(name)) {
            const m = spawnModelFromNames(name, name+'Glass');
            m.setBounds([-100, -400, -100], [100, 50, 100]);
            m.addChild(spawnModelFromNames(name, name+'Hook'));
        }
        // Various Decorations
        else if (name === 'DecoA')  { spawnOArcModel(name); }
        else if (name === 'DecoB')  { spawnOArcModel(name); }
        else if (name === 'ObjBg') {
            const objId = (params1 >>> 4) & 0x7F;
            const roomRRES = this.getRoomArcRRES(roomIdx!);

            for (const roomMdl of this.roomModelInstances) {
                const roomNodeName =  `obj${objId}`;
                const node = roomMdl.modelInstance.mdl0Model.mdl0.nodes.find(node => node.name === roomNodeName);
                if (node) {
                    roomMdl.addNodeTime(node, ZSSTime.PRESENT);
                }
            }
            const mainObjName = `model_obj${objId}`;
            if (roomRRES.mdl0.find((model) => model.name === mainObjName)) {
                const m0 = spawnModel(roomRRES, mainObjName);
                const detailObjName = mainObjName+'_s';
                if (roomRRES.mdl0.find((model) => model.name === detailObjName)) {
                    const m1 = spawnModel(roomRRES, detailObjName);
                    m0.addChild(m1);
                }
                m0.setTime(ZSSTime.PAST);
            }
        }
        // No models
        else if (!NO_MODEL_LIST.includes(name)) {
            console.warn("Unknown object" , name, "Layer:", this.globals.currentLayer);
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
