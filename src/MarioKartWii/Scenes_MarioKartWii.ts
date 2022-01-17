
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from '../rres/brres';
import * as U8 from '../rres/u8';
import * as Yaz0 from '../Common/Compression/Yaz0';

import { assert, readString, hexzero, assertExists } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4 } from 'gl-matrix';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from '../rres/render';
import AnimationController from '../AnimationController';
import { fillSceneParamsDataOnTemplate, GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { computeModelMatrixSRT, computeModelMatrixS, MathConstants, scaleMatrix } from '../MathHelpers';
import { SceneContext, GraphObjBase } from '../SceneBase';
import { EggLightManager, parseBLIGHT } from '../rres/Egg';
import { GfxRendererLayer, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { CameraController } from '../Camera';
import { makeBackbufferDescSimple, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxrAttachmentSlot } from '../gfx/render/GfxRenderGraph';
import { EggDrawPathBloom, EggDrawPathDOF, parseBBLM, parseBDOF } from './PostEffect';
import { BTI, BTIData } from '../Common/JSYSTEM/JUTTexture';

interface ObjFlowObj {
    name: string;
    resources: string;
}

class ObjFlow {
    public objects: ObjFlowObj[] = [];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        const count = view.getUint16(0x00);
        let idx = 0x02;
        for (let i = 0; i < count; i++, idx += 0x74) {
            const objectId = view.getUint16(idx + 0x00);
            const name = readString(buffer, idx + 0x02, 0x20);
            const resources = readString(buffer, idx + 0x22, 0x40);
            this.objects[objectId] = { name, resources };
        }
    }
}

class CommonCache {
    public objFlow: ObjFlow;

    constructor(public commonArc: U8.U8Archive) {
        // Parse ObjFlow.bin
        this.objFlow = new ObjFlow(assertExists(this.commonArc.findFileData(`./ObjFlow.bin`)));
    }

    public destroy(device: GfxDevice) {
    }
}

class ModelCache {
    public rresCache = new Map<string, BRRES.RRES>();
    public modelCache = new Map<string, MDL0Model>();

    public ensureRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, path: string): BRRES.RRES {
        if (!this.rresCache.has(path)) {
            const rres = BRRES.parse(arc.findFileData(path)!);
            renderer.textureHolder.addRRESTextures(device, rres);
            this.rresCache.set(path, rres);

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            for (let i = 0; i < rres.mdl0.length; i++) {
                const mdl0Model = new MDL0Model(device, cache, rres.mdl0[i]);
                this.modelCache.set(rres.mdl0[i].name, mdl0Model);
            }
        }

        return this.rresCache.get(path)!;
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.modelCache.values())
            v.destroy(device);
    }
}

interface BaseObject extends GraphObjBase {
    visible: boolean;
    modelMatrix: mat4;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    bindLightSetting(lightSetting: BRRES.LightSetting): void;
}

function getModelInstance(baseObj: BaseObject): MDL0ModelInstance {
    if (baseObj instanceof SimpleObjectRenderer)
        return baseObj.modelInstance;
    else if (baseObj instanceof CourseBGRenderer)
        return baseObj.modelInstance;
    else if (baseObj instanceof MDL0ModelInstance)
        return baseObj;
    else
        throw "Object's class does not have a known model instance.";
}

class MarioKartWiiRenderer {
    public renderHelper: GXRenderHelperGfx;
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;
    public enablePostProcessing = true;

    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController();

    public eggBloom: EggDrawPathBloom | null = null;
    public eggDOF: EggDrawPathDOF | null = null;
    public eggLightManager: EggLightManager | null = null;
    public baseObjects: BaseObject[] = [];
    public modelCache = new ModelCache();

    constructor(context: SceneContext, public commonCache: CommonCache) {
        this.renderHelper = new GXRenderHelperGfx(context.device, context);
    }

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);
        for (let i = 0; i < this.baseObjects.length; i++) {
            mat4.mul(this.baseObjects[i].modelMatrix, negScaleMatrix, this.baseObjects[i].modelMatrix);
            const modelInstance = getModelInstance(this.baseObjects[i]);
            for (let j = 0; j < modelInstance.materialInstances.length; j++)
                modelInstance.materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(24/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Courses');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enablePostProcessing = new UI.Checkbox('Enable Post-Processing', true);
        enablePostProcessing.onchanged = () => {
            const v = enablePostProcessing.checked;
            this.enablePostProcessing = v;
        };
        renderHacksPanel.contents.appendChild(enablePostProcessing.elem);
        const showDebugThumbnails = new UI.Checkbox('Show Debug Thumbnails', false);
        showDebugThumbnails.onchanged = () => {
            const v = showDebugThumbnails.checked;
            this.renderHelper.debugThumbnails.enabled = v;
        };
        renderHacksPanel.contents.appendChild(showDebugThumbnails.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.eggDOF !== null)
            this.eggDOF.updateScroll(this.animationController.getTimeInFrames() * 2.0);
        if (this.eggLightManager !== null)
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].bindLightSetting(this.eggLightManager.lightSetting);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.baseObjects.length; i++)
            this.baseObjects[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.renderHelper.pushTemplateRenderInst();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(passRenderer);
            });
        });

        if (this.enablePostProcessing && (this.eggDOF !== null || this.eggBloom !== null)) {
            const mainResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);

            if (this.eggDOF !== null)
                this.eggDOF.pushPassesDOF(builder, renderInstManager, viewerInput.camera, mainColorTargetID, mainDepthTargetID, mainResolveTextureID);
            if (this.eggBloom !== null)
                this.eggBloom.pushPassesBloom(builder, renderInstManager, mainColorTargetID, mainResolveTextureID);
        }

        this.renderHelper.debugThumbnails.pushPasses(builder, renderInstManager, mainColorTargetID, viewerInput.mouseLocation);

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        renderInstManager.popTemplateRenderInst();

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.baseObjects.length; i++)
            this.baseObjects[i].destroy(device);
    }
}

interface GOBJ {
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    objectArg4: number;
    objectArg5: number;
    objectArg6: number;
    objectArg7: number;
    presenceFlags: number;
    translationX: number;
    translationY: number;
    translationZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

interface KMP {
    gobj: GOBJ[];
}

function parseKMP(buffer: ArrayBufferSlice): KMP {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RKMD');
    const headerSize = view.getUint16(0x0A);
    const gobjOffs_ = view.getUint32(0x2C);

    const gobjOffs = headerSize + gobjOffs_;
    assert(readString(buffer, gobjOffs + 0x00, 0x04) === 'GOBJ');
    const gobjTableCount = view.getUint16(gobjOffs + 0x04);
    let gobjTableIdx = gobjOffs + 0x08;

    const gobj: GOBJ[] = [];
    for (let i = 0; i < gobjTableCount; i++) {
        const objectId = view.getUint16(gobjTableIdx + 0x00);
        const translationX = view.getFloat32(gobjTableIdx + 0x04);
        const translationY = view.getFloat32(gobjTableIdx + 0x08);
        const translationZ = view.getFloat32(gobjTableIdx + 0x0C);
        const rotationX = view.getFloat32(gobjTableIdx + 0x10) * MathConstants.DEG_TO_RAD;
        const rotationY = view.getFloat32(gobjTableIdx + 0x14) * MathConstants.DEG_TO_RAD;
        const rotationZ = view.getFloat32(gobjTableIdx + 0x18) * MathConstants.DEG_TO_RAD;
        const scaleX = view.getFloat32(gobjTableIdx + 0x1C);
        const scaleY = view.getFloat32(gobjTableIdx + 0x20);
        const scaleZ = view.getFloat32(gobjTableIdx + 0x24);
        const routeId = view.getUint16(gobjTableIdx + 0x28);
        const objectArg0 = view.getUint16(gobjTableIdx + 0x2A);
        const objectArg1 = view.getUint32(gobjTableIdx + 0x2C);
        const objectArg2 = view.getUint32(gobjTableIdx + 0x3E);
        const objectArg3 = view.getUint32(gobjTableIdx + 0x30);
        const objectArg4 = view.getUint16(gobjTableIdx + 0x32);
        const objectArg5 = view.getUint32(gobjTableIdx + 0x34);
        const objectArg6 = view.getUint32(gobjTableIdx + 0x36);
        const objectArg7 = view.getUint32(gobjTableIdx + 0x38);

        const presenceFlags = view.getUint32(gobjTableIdx + 0x3A);
        gobj.push({
            objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, objectArg4, objectArg5, objectArg6, objectArg7, presenceFlags,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        gobjTableIdx += 0x3C;
    }

    return { gobj };
}

const scaleFactor = 0.1;
const posMtx = mat4.fromScaling(mat4.create(), [scaleFactor, scaleFactor, scaleFactor]);

const FIdx2Rad = MathConstants.TAU / 0xFF;

class CourseBGRenderer implements BaseObject {
    public visible = true;
    public modelMatrix = mat4.create();

    constructor(public modelInstance: MDL0ModelInstance) {
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.modelInstance.bindLightSetting(lightSetting);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
    }
}

class SimpleObjectRenderer implements BaseObject {
    public visible = true;
    public modelMatrix = mat4.create();

    constructor(public modelInstance: MDL0ModelInstance, public gobj: GOBJ) {
        computeModelMatrixSRT(this.modelMatrix, gobj.scaleX, gobj.scaleY, gobj.scaleZ, gobj.rotationX, gobj.rotationY, gobj.rotationZ, gobj.translationX, gobj.translationY, gobj.translationZ);
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.modelInstance.bindLightSetting(lightSetting);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
    }
}

class Aurora extends SimpleObjectRenderer {
    private nodeIndices: number[] = [];

    constructor(modelInstance: MDL0ModelInstance, gobj: GOBJ) {
        super(modelInstance, gobj);

        // Nintendo is really cool lol
        for (let i = 0; i < 37; i++) {
            const nodeName = 'joint' + (i + 2);
            this.nodeIndices.push(this.modelInstance.mdl0Model.mdl0.nodes.findIndex((node) => node.name === nodeName)!);
        }
    }

    public override prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        // Update joints.
        // TODO(jstpierre): Do in a less ugly way lol

        const timeInFrames = (viewerInput.time / 1000) * 60;
        const jointDist = 416.66000366;
        const freq = 40.74366379;

        for (let i = 0; i < this.nodeIndices.length; i++) {
            const nodeIndex = this.nodeIndices[i];
            const node = this.modelInstance.mdl0Model.mdl0.nodes[nodeIndex];
            const dst = node.modelMatrix;

            const thetaA = (((timeInFrames / 60) - 30) / 60);
            const theta = Math.min(1.0 + (thetaA * thetaA), 4);
            const waveFade = (MathConstants.TAU * jointDist * i) / 15000;
            const wave2 = Math.sin(FIdx2Rad * (freq * ((waveFade * theta) + ((Math.PI * timeInFrames) / 50.0))));

            dst[12] = (i + 2) * jointDist;
            dst[13] = waveFade * wave2 * 80;
            dst[14] = 0;
        }

        super.prepareToRender(device, renderInstManager, viewerInput);
    }
}

async function loadSZS(buffer: ArrayBufferSlice): Promise<U8.U8Archive> {
    return U8.parse(await Yaz0.decompress(buffer));
}

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private static createModelInstanceFromRRES(renderer: MarioKartWiiRenderer, rres: BRRES.RRES, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        const mdl0Model = assertExists(modelCache.modelCache.get(objectName));
        const mdl0Instance = new MDL0ModelInstance(renderer.textureHolder, mdl0Model, objectName);
        mdl0Instance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres, null);
        return mdl0Instance;
    }

    private static spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ): void {
        const getRRES = (objectName: string): BRRES.RRES => {
            const arcPath = `./${objectName}.brres`;
            renderer.modelCache.ensureRRES(device, renderer, arc, arcPath);
            return assertExists(renderer.modelCache.rresCache.get(arcPath));
        };

        const createModelInstance = (rresName: string, mdl0Name: string = rresName): MDL0ModelInstance => {
            return this.createModelInstanceFromRRES(renderer, getRRES(rresName), mdl0Name);
        };

        const spawnSimpleObject = (rresName: string, mdl0Name: string = rresName): SimpleObjectRenderer => {
            const b = createModelInstance(rresName, mdl0Name);
            const obj = new SimpleObjectRenderer(b, gobj);
            renderer.baseObjects.push(obj);
            return obj;
        };

        const obj = renderer.commonCache.objFlow.objects[gobj.objectId];
        const objName = obj.name;

        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

        if (objName === `Psea`) {
            const b1 = spawnSimpleObject(`Psea`, `Psea1sand`);
            const b2 = spawnSimpleObject(`Psea`, `Psea2dark`);
            const b3 = spawnSimpleObject(`Psea`, `Psea3nami`);
            const b4 = spawnSimpleObject(`Psea`, `Psea4tex`);
            const b5 = spawnSimpleObject(`Psea`, `Psea5spc`);
        } else if (objName === `lensFX`) {
            // Lens flare effect -- runtime determined, not a BRRES.
        } else if (objName === `sound_Mii`) {
            // sound generator
        } else if (objName === `skyship`) {
            spawnSimpleObject(`skyship`);
        } else if (objName === `itembox`) {
            const b = spawnSimpleObject(`itembox`);
            b.modelMatrix[13] += 20;
        } else if (objName === `sun`) {
            // TODO(jstpierre): Sun doesn't show up? Need to figure out what this is...
            spawnSimpleObject(`sun`);
        } else if (objName === `KmoonZ`) {
            spawnSimpleObject(`KmoonZ`);
        } else if (objName === `sunDS`) {
            spawnSimpleObject(`sunDS`);
        } else if (objName === `coin`) {
            const b = spawnSimpleObject(`coin`);
            b.modelMatrix[13] += 15;
            // pull it out the ground, doesn't spin still
        } else if (objName === `MashBalloonGC`) {
            spawnSimpleObject(`MashBalloonGC`);
        } else if (objName === `WLwallGC`) {
            spawnSimpleObject(`WLwallGC`);
        } else if (objName === `CarA1`) {
            spawnSimpleObject(`CarA1`);
        } else if (objName === `basabasa`) {
            spawnSimpleObject(`basabasa`);
        } else if (objName === `HeyhoShipGBA`) {
            spawnSimpleObject(`HeyhoShipGBA`);
        //} else if (objName === `kart_truck`) {
        //    spawnObject(`K_truck`);
        //} else if (objName === `car_body`) {
        //    spawnObject(`K_car_body`);
        } else if (objName === `skyship`) {
            spawnSimpleObject(`skyship`);
        } else if (objName === `penguin_s`) {
            spawnSimpleObject(`penguin_s`);
            // wiki says they should be creating a mirrored one below it, for the fake reflection but it isnt
        } else if (objName === `penguin_m`) {
            spawnSimpleObject(`penguin_m`);
        } else if (objName === `penguin_l`) {
            spawnSimpleObject(`penguin_l`);
        } else if (objName === `castleballoon1`) {
            spawnSimpleObject(`castleballoon1`);
        } else if (objName === `dossunc`) {
            spawnSimpleObject(`dossun`);
        } else if (objName === `boble`) {
            spawnSimpleObject(`boble`);
        } else if (objName === `K_bomb_car`) {
            spawnSimpleObject(`K_bomb_car`);
        //} else if (objName === `hanachan`) {
        //    spawnObject(`hanachan`);
            // only shows up as his head
        } else if (objName === `seagull`) {
            spawnSimpleObject(`seagull`);
        } else if (objName === `moray`) {
            spawnSimpleObject(`moray`);
        } else if (objName === `crab`) {
            spawnSimpleObject(`crab`);
        } else if (objName === `CarA2`) {
            spawnSimpleObject(`CarA2`);
        } else if (objName === `CarA3`) {
            spawnSimpleObject(`CarA3`);
        } else if (objName === `Hwanwan`) {
            const b = spawnSimpleObject(`wanwan`);
            scaleMatrix(b.modelMatrix, b.modelMatrix, 4);
            b.modelMatrix[13] += 125;
            // scales up and out of the ground to look closer to ingame
        } else if (objName === `Twanwan`) {
            const b = spawnSimpleObject(`Twanwan`);
            b.modelMatrix[13] += 150;
            // offset a bit so he fits into the pipe nicer.
        } else if (objName === `cruiserR`) {
            spawnSimpleObject(`cruiser`);
        } else if (objName === `bird`) {
            spawnSimpleObject(`bird`);
        } else if (objName === `dokan_sfc`) {
            spawnSimpleObject(`dokan_sfc`);
        } else if (objName === `castletree1`) {
            spawnSimpleObject(`castletree1`);
        } else if (objName === `castletree1c`) {
            spawnSimpleObject(`castletree1`);
        } else if (objName === `castletree2`) {
            spawnSimpleObject(`castletree2`);
        } else if (objName === `castleflower1`) {
            spawnSimpleObject(`castleflower1`);
        } else if (objName === `mariotreeGC`) {
            spawnSimpleObject(`mariotreeGC`);
        } else if (objName === `mariotreeGCc`) {
            spawnSimpleObject(`mariotreeGC`);
        } else if (objName === `donkytree1GC`) {
            spawnSimpleObject(`donkytree1GC`);
        } else if (objName === `donkytree2GC`) {
            spawnSimpleObject(`donkytree2GC`);
        } else if (objName === `peachtreeGC`) {
            spawnSimpleObject(`peachtreeGC`);
        } else if (objName === `peachtreeGCc`) {
            spawnSimpleObject(`peachtreeGC`);
        } else if (objName === `obakeblockSFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `WLarrowGC`) {
            spawnSimpleObject(`WLarrowGC`);
        } else if (objName === `WLscreenGC`) {
            spawnSimpleObject(`WLscreenGC`);
        } else if (objName === `WLdokanGC`) {
            spawnSimpleObject(`WLdokanGC`);
        } else if (objName === `MarioGo64c`) {
            spawnSimpleObject(`MarioGo64`);
        } else if (objName === `PeachHunsuiGC`) {
            spawnSimpleObject(`PeachHunsuiGC`);
        } else if (objName === `kinokoT1`) {
            spawnSimpleObject(`kinokoT1`);
        } else if (objName === `pylon01`) {
            const b = spawnSimpleObject(`pylon01`);
            const rres = getRRES(`pylon01`);
            b.modelInstance.bindCLR0(animFrame(gobj.objectArg0), assertExists(rres.clr0.find((clr0) => clr0.name === `pylon01`)));
        } else if (objName === `PalmTree`) {
            spawnSimpleObject(`PalmTree`);
        } else if (objName === `parasol`) {
            spawnSimpleObject(`parasol`);
        } else if (objName === `cruiser`) {
            spawnSimpleObject(`cruiser`);
        } else if (objName === `K_sticklift00`) {
            spawnSimpleObject(`K_sticklift00`);
        } else if (objName === `heyho2`) {
            spawnSimpleObject(`heyho2`);
        } else if (objName === `HeyhoTreeGBAc`) {
            spawnSimpleObject(`HeyhoTreeGBA`);
        } else if (objName === `truckChimSmk`) {
            spawnSimpleObject(`truckChimSmk`);
        } else if (objName === `MiiObj01`) {
            // Don't spawn the MiiObj's as they have placeholder textures for faces that don't look good.
            // spawnObject(`MiiObj01`);
        } else if (objName === `MiiObj02`) {
            // spawnObject(`MiiObj02`);
        } else if (objName === `MiiObj03`) {
            // spawnObject(`MiiObj03`);
        } else if (objName === `gardentreeDS`) {
            spawnSimpleObject(`gardentreeDS`);
        } else if (objName === `gardentreeDSc`) {
            spawnSimpleObject(`gardentreeDS`);
        } else if (objName === `FlagA1`) {
            spawnSimpleObject(`FlagA1`);
        } else if (objName === `FlagA2`) {
            spawnSimpleObject(`FlagA2`);
        } else if (objName === `FlagB1`) {
            spawnSimpleObject(`FlagB1`);
        } else if (objName === `FlagB2`) {
            spawnSimpleObject(`FlagB2`);
        } else if (objName === `FlagA3`) {
            spawnSimpleObject(`FlagA3`);
        } else if (objName === `DKtreeA64`) {
            spawnSimpleObject(`DKtreeA64`);
        } else if (objName === `DKtreeA64c`) {
            spawnSimpleObject(`DKtreeA64`);
        } else if (objName === `DKtreeB64`) {
            spawnSimpleObject(`DKtreeB64`);
        } else if (objName === `DKtreeB64c`) {
            spawnSimpleObject(`DKtreeB64`);
        } else if (objName === `TownTreeDSc`) {
            spawnSimpleObject(`TownTreeDS`);
        } else if (objName === `Piston`) {
            spawnSimpleObject(`Piston`);
        } else if (objName === `oilSFC`) {
            spawnSimpleObject(`oilSFC`);
        } else if (objName === `mii_balloon`) {
            spawnSimpleObject(`mii_balloon`);
        } else if (objName === `windmill`) {
            spawnSimpleObject(`windmill`);
        } else if (objName === `dossun`) {
            spawnSimpleObject(`dossun`);
        } else if (objName === `TownTreeDS`) {
            spawnSimpleObject(`TownTreeDS`);
        } else if (objName === `Ksticketc`) {
            spawnSimpleObject(`Ksticketc`);
        } else if (objName === `monte_a`) {
            spawnSimpleObject(`monte_a`);
        } else if (objName === `MiiStatueM1`) {
            spawnSimpleObject(`MiiStatueM1`);
        } else if (objName === `ShMiiObj01`) {
            spawnSimpleObject(`ShMiiObj01`);
        } else if (objName === `ShMiiObj02`) {
            spawnSimpleObject(`ShMiiObj02`);
        } else if (objName === `ShMiiObj03`) {
            spawnSimpleObject(`ShMiiObj03`);
        } else if (objName === `miiposter`) {
            spawnSimpleObject(`miiposter`);
        } else if (objName === `dk_miiobj00`) {
            spawnSimpleObject(`dk_miiobj00`);
        } else if (objName === `light_house`) {
            spawnSimpleObject(`light_house`);
        } else if (objName === `r_parasol`) {
            spawnSimpleObject(`r_parasol`);
        } else if (objName === `obakeblock2SFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `obakeblock3SFCc`) {
            spawnSimpleObject(`obakeblockSFC`);
        } else if (objName === `koopaFigure`) {
            spawnSimpleObject(`koopaFigure`);
        } else if (objName === `pukupuku`) {
            spawnSimpleObject(`pukupuku`);
        } else if (objName === `karehayama`) {
            spawnSimpleObject(`karehayama`);
        } else if (objName === `EarthRing`) {
            spawnSimpleObject(`EarthRing`);
        } else if (objName === `SpaceSun`) {
            spawnSimpleObject(`SpaceSun`);
        } else if (objName === `StarRing`) {
            spawnSimpleObject(`StarRing`);
        } else if (objName === `M_obj_kanban`) {
            spawnSimpleObject(`M_obj_kanban`);
        } else if (objName === `MiiStatueL1`) {
            spawnSimpleObject(`MiiStatueL1`);
        } else if (objName === `MiiStatueD1`) {
            spawnSimpleObject(`MiiStatueD1`);
        } else if (objName === `MiiSphinxY1`) {
            spawnSimpleObject(`MiiSphinxY1`);
        } else if (objName === `MiiSphinxY2`) {
            spawnSimpleObject(`MiiSphinxY2`);
        } else if (objName === `FlagA5`) {
            spawnSimpleObject(`FlagA5`);
        } else if (objName === `CarB`) {
            spawnSimpleObject(`CarB`);
        } else if (objName === `group_monte_a`) {
            spawnSimpleObject(`group_monte_a`);
        } else if (objName === `MiiStatueL2`) {
            spawnSimpleObject(`MiiStatueL2`);
        } else if (objName === `MiiStatueD2`) {
            spawnSimpleObject(`MiiStatueD2`);
        } else if (objName === `MiiStatueP1`) {
            spawnSimpleObject(`MiiStatueP1`);
        } else if (objName === `SentakuDS`) {
            spawnSimpleObject(`SentakuDS`);
        } else if (objName === `fks_screen_wii`) {
            spawnSimpleObject(`fks_screen_wii`);
        } else if (objName === `KoopaFigure64`) {
            spawnSimpleObject(`KoopaFigure64`);
        } else if (objName === `b_teresa`) {
            spawnSimpleObject(`b_teresa`);
        } else if (objName === `MiiKanban`) {
            spawnSimpleObject(`MiiKanban`);
        } else if (objName === `BGteresaSFC`) {
            spawnSimpleObject(`BGteresaSFC`);
        } else if (objName === `kuribo`) {
            const b = spawnSimpleObject(`kuribo`);
            const rres = getRRES(`kuribo`);
            b.modelInstance.bindCHR0(renderer.animationController, assertExists(rres.chr0.find((chr0) => chr0.name === 'walk_l')));
        } else if (objName === `choropu`) {
            spawnSimpleObject(`choropu`);
        } else if (objName === `cow`) {
            spawnSimpleObject(`cow`);
        } else if (objName === `pakkun_f`) {
            spawnSimpleObject(`pakkun_f`);
        } else if (objName === `WLfirebarGC`) {
            spawnSimpleObject(`WLfirebarGC`);
        } else if (objName === `wanwan`) {
            spawnSimpleObject(`wanwan`);
        } else if (objName === `poihana`) {
            const b = spawnSimpleObject(`poihana`);
            b.modelMatrix[13] += 25; // pull him out of the ground
        } else if (objName === `DKrockGC`) {
            spawnSimpleObject(`DKrockGC`);
        } else if (objName === `sanbo`) {
            spawnSimpleObject(`sanbo`);
        } else if (objName === `choropu2`) {
            spawnSimpleObject(`choropu`);
        } else if (objName === `TruckWagon`) {
            spawnSimpleObject(`TruckWagon`);
        } else if (objName === `heyho`) {
            spawnSimpleObject(`heyho`);
        } else if (objName === `Press`) {
            spawnSimpleObject(`Press`);
        } else if (objName === `WLfireringGC`) {
            spawnSimpleObject(`WLfirebarGC`);
        } else if (objName === `pakkun_dokan`) {
            spawnSimpleObject(`pakkun_dokan`);
        //} else if (objName === `begoman_spike`) {
        //    spawnSimpleObject(`begoman_spike`);
        } else if (objName === `FireSnake`) {
            spawnSimpleObject(`FireSnake`);
        } else if (objName === `koopaFirebar`) {
            spawnSimpleObject(`koopaFirebar`);
        } else if (objName === `Epropeller`) {
            spawnSimpleObject(`Epropeller`);
        } else if (objName === `FireSnake_v`) {
            spawnSimpleObject(`FireSnake`);
        } else if (objName === `puchi_pakkun`) {
            spawnSimpleObject(`puchi_pakkun`);
        //} else if (objName === `kinoko_ud`) {
        //    spawnObject(`kinoko`);
        } else if (objName === `kinoko_bend`) {
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_r`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_r`);
            } else {
                throw "whoops";
            }
        } else if (objName === `VolcanoRock1`) {
            spawnSimpleObject(`VolcanoRock1`);
        } else if (objName === `bulldozer_left`) {
            spawnSimpleObject(`bulldozer_left`);
        } else if (objName === `bulldozer_right`) {
            spawnSimpleObject(`bulldozer_right`);
        } else if (objName === `kinoko_nm`) {
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_g`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_g`);
            } else {
                throw "whoops";
            }
        } else if (objName === `Crane`) {
            spawnSimpleObject(`Crane`);
        } else if (objName === `VolcanoPiece`) {
            spawnSimpleObject(`VolcanoPiece1`, `VolcanoPiece${gobj.objectArg0}`);
        } else if (objName === `FlamePole`) {
            spawnSimpleObject(`FlamePole`);
        } else if (objName === `TwistedWay`) {
            spawnSimpleObject(`TwistedWay`);
        } else if (objName === `TownBridgeDSc`) {
            spawnSimpleObject(`TownBridgeDS`);
        } else if (objName === `DKship64`) {
            spawnSimpleObject(`DKship64`);
        } else if (objName === `DKturibashiGCc`) {
            spawnSimpleObject(`DKturibashiGC`);
        } else if (objName === `aurora`) {
            const aurora = new Aurora(createModelInstance(`aurora`), gobj);
            renderer.baseObjects.push(aurora);
        } else if (objName === `venice_saku`) {
            spawnSimpleObject(`venice_saku`);
        } else if (objName === `casino_roulette`) {
            spawnSimpleObject(`casino_roulette`);
        } else if (objName === `dc_sandcone`) {
            spawnSimpleObject(`dc_sandcone`);
        } else if (objName === `venice_hasi `) {
            spawnSimpleObject(`venice_hasi`);
        } else if (objName === `bblock`) {
            spawnSimpleObject(`bblock1`);
        } else if (objName === `ami`) {
            spawnSimpleObject(`ami`);
        } else if (objName === `RM_ring1`) {
            const ringNames = ['RM_ring1', 'RM_ring2', 'RM_ring3'];
            const ringName = ringNames[gobj.objectArg0 - 1];
            const b = spawnSimpleObject(`RM_ring1`, ringName);
            const rres = getRRES(`RM_ring1`);
            b.modelInstance.bindRRESAnimations(renderer.animationController, rres, ringName);
            b.modelInstance.bindCLR0(null, null);
        //} else if (objName === `FlamePole_v`) {
        //    spawnObject(`FlamePole_v`);
        } else if (objName === `InsekiA`) {
            spawnSimpleObject(`InsekiA`);
        } else if (objName === `InsekiB`) {
            spawnSimpleObject(`InsekiB`);
        //} else if (objName === `FlamePole_v_big`) {
        //    spawnObject(`FlamePole_v_big`);
        } else if (objName === `Mdush`) {
            spawnSimpleObject(`Mdush`);
        } else if (objName === `DonkyCannonGC`) {
            spawnSimpleObject(`DonkyCannonGC`);
        } else if (objName === `BeltEasy`) {
            spawnSimpleObject(`BeltEasy`);
        } else if (objName === `BeltCrossing`) {
            spawnSimpleObject(`BeltCrossing`);
        } else if (objName === `BeltCurveA`) {
            spawnSimpleObject(`BeltCurveA`);
        } else if (objName === `escalator`) {
            spawnSimpleObject(`escalator`);
        } else if (objName === `DonkyCannon_wii`) {
            spawnSimpleObject(`DonkyCannon_wii`);
        } else if (objName === `escalator_group`) {
            const left = spawnSimpleObject(`escalator`);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-1450, 250, -600]);
            const right = spawnSimpleObject(`escalator`);
            mat4.translate(right.modelMatrix, right.modelMatrix, [1450, 250, -600]);
        } else if (objName === `tree_cannon`) {
            spawnSimpleObject(`tree_cannon`);
        } else if (objName === `group_enemy_b`) {
            spawnSimpleObject(`group_enemy_b`);
        } else if (objName === `group_enemy_c`) {
            spawnSimpleObject(`group_enemy_c`);
        //} else if (objName === `taimatsu`) {
        //    spawnObject(`taimatsu`);
        } else if (objName === `truckChimSmkW`) {
            spawnSimpleObject(`truckChimSmkW`);
        } else if (objName === `dkmonitor`) {
            spawnSimpleObject(`dkmonitor`);
        } else if (objName === `group_enemy_a`) {
            spawnSimpleObject(`group_enemy_a`);
        } else if (objName === `FlagB3`) {
            spawnSimpleObject(`FlagB3`);
        } else if (objName === `spot`) {
            spawnSimpleObject(`spot`);
        } else if (objName === `FlagB4`) {
            spawnSimpleObject(`FlagB4`);
        } else if (objName === `group_enemy_e`) {
            spawnSimpleObject(`group_enemy_e`);
        } else if (objName === `group_monte_L`) {
            spawnSimpleObject(`group_monte_a`);
        } else if (objName === `group_enemy_f`) {
            spawnSimpleObject(`group_enemy_f`);
        //} else if (objName === `FallBsB`) {
        //    spawnObject(`FallBsB`);
        //} else if (objName === `volsmk`) {
        //    spawnObject(`volsmk`);
        } else if (objName === `ridgemii00`) {
            spawnSimpleObject(`ridgemii00`);
        } else if (objName === `Flash_L`) {
            // particle effect; unsupported
        } else if (objName === `MiiSignNoko`) {
            const b = spawnSimpleObject(`MiiSignNoko`);
            const rres = getRRES(`MiiSignNoko`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (objName === `UtsuboDokan`) {
            spawnSimpleObject(`UtsuboDokan`);
        } else if (objName === `Spot64`) {
            spawnSimpleObject(`Spot64`);
        //} else if (objName === `Fall_MH`) {
        //    spawnObject(`Fall_MH`);
        //} else if (objName === `Fall_Y`) {
        //    spawnObject(`Fall_Y`);
        } else if (objName === `MiiStatueM2`) {
            spawnSimpleObject(`MiiStatueM2`);
        } else if (objName === `RhMiiKanban`) {
            spawnSimpleObject(`RhMiiKanban`);
        } else if (objName === `MiiStatueL3`) {
            spawnSimpleObject(`MiiStatueL3`);
        } else if (objName === `MiiSignWario`) {
            spawnSimpleObject(`MiiSignWario`);
        } else if (objName === `MiiStatueBL1`) {
            spawnSimpleObject(`MiiStatueBL1`);
        } else if (objName === `MiiStatueBD1`) {
            spawnSimpleObject(`MiiStatueBD1`);
        //} else if (objName === `Kamifubuki`) {
        //    spawnSimpleObject(`Kamifubuki`);
        } else if (objName === `Crescent64`) {
            spawnSimpleObject(`Crescent64`);
        } else if (objName === `MiiSighKino`) {
            const b = spawnSimpleObject(`MiiSighKino`);
            const rres = getRRES(`MiiSighKino`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (objName === `MiiObjD01`) {
            spawnSimpleObject(`MiiObjD01`);
        } else if (objName === `MiiObjD02`) {
            spawnSimpleObject(`MiiObjD02`);
        } else if (objName === `MiiObjD03`) {
            spawnSimpleObject(`MiiObjD03`);
        } else if (objName === `mare_a`) {
            spawnSimpleObject(`mare_a`);
        } else if (objName === `mare_b`) {
            spawnSimpleObject(`mare_b`);
        //} else if (objName === `DKfalls`) {
        //    spawnObject(`DKfalls`);
        } else {
            console.warn(`Unimplemented object ${hexzero(gobj.objectId, 4)}`);
        }
    }

    public static async createSceneFromU8Archive(context: SceneContext, arc: U8.U8Archive): Promise<MarioKartWiiRenderer> {
        const commonCache = await context.dataShare.ensureObject(`MarioKartWii/CommonCache`, async () => {
            const buffer = await context.dataFetcher.fetchData(`MarioKartWii/Race/Common.szs`);
            return new CommonCache(await loadSZS(buffer));
        });

        const device = context.device;
        const kmp = parseKMP(assertExists(arc.findFileData(`./course.kmp`)));
        console.log(arc, kmp);
        const renderer = new MarioKartWiiRenderer(context, commonCache);
        const modelCache = renderer.modelCache, cache = renderer.renderHelper.renderCache;

        const courseRRES = modelCache.ensureRRES(device, renderer, arc, `./course_model.brres`);
        const courseInstance = new CourseBGRenderer(this.createModelInstanceFromRRES(renderer, courseRRES, 'course'));
        courseInstance.modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
        renderer.baseObjects.push(courseInstance);
        mat4.copy(courseInstance.modelMatrix, posMtx);

        const skyboxRRES = modelCache.ensureRRES(device, renderer, arc, `./vrcorn_model.brres`);
        const skyboxInstance = new CourseBGRenderer(this.createModelInstanceFromRRES(renderer, skyboxRRES, 'vrcorn'));
        skyboxInstance.modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
        renderer.baseObjects.push(skyboxInstance);
        mat4.copy(skyboxInstance.modelMatrix, posMtx);

        for (let i = 0; i < kmp.gobj.length; i++)
            this.spawnObjectFromKMP(device, renderer, arc, kmp.gobj[i]);

        const blightData = arc.findFileData(`./posteffect/posteffect.blight`);
        if (blightData !== null) {
            const blightRes = parseBLIGHT(blightData);
            const eggLightManager = new EggLightManager(blightRes);
            renderer.eggLightManager = eggLightManager;
        }

        const bblmData = arc.findFileData(`./posteffect/posteffect.bblm`);
        if (bblmData !== null) {
            const bblmRes = parseBBLM(bblmData);
            const eggBloom = new EggDrawPathBloom(device, cache, bblmRes);
            renderer.eggBloom = eggBloom;
        }

        const bdofData = arc.findFileData(`./posteffect/posteffect.bdof`);
        if (bdofData !== null) {
            const bdofRes = parseBDOF(bdofData);
            const eggDOF = new EggDrawPathDOF(device, cache, bdofRes);
            renderer.eggDOF = eggDOF;

            const warpTex = arc.findFileData(`./posteffect/posteffect.bti`);
            if (warpTex !== null) {
                const warpTexBTIData = new BTIData(device, cache, BTI.parse(warpTex, `posteffect.bti`).texture);
                context.destroyablePool.push(warpTexBTIData);
                warpTexBTIData.fillTextureMapping(eggDOF.getIndTextureMapping());
            }
        }

        return renderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const courseSZS = await context.dataFetcher.fetchData(`MarioKartWii/Race/Course/${this.id}.szs`);
        return MarioKartWiiSceneDesc.createSceneFromU8Archive(context, await loadSZS(courseSZS));
    }
}

export async function createMarioKartWiiSceneFromU8Archive(context: SceneContext, arc: U8.U8Archive) {
    return MarioKartWiiSceneDesc.createSceneFromU8Archive(context, arc);
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
// Courses named and organized by Starschulz
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartWiiSceneDesc('beginner_course', "Luigi Circuit"),
    new MarioKartWiiSceneDesc('farm_course', "Moo Moo Meadows"),
    new MarioKartWiiSceneDesc('kinoko_course', "Mushroom Gorge"),
    new MarioKartWiiSceneDesc('factory_course', "Toad's Factory"),
    "Flower Cup",
    new MarioKartWiiSceneDesc('castle_course', "Mario Circuit"),
    new MarioKartWiiSceneDesc('shopping_course', "Coconut Mall"),
    new MarioKartWiiSceneDesc('boardcross_course', "DK Summit"),
    new MarioKartWiiSceneDesc('truck_course', "Wario's Gold Mine"),
    "Star Cup",
    new MarioKartWiiSceneDesc('senior_course', "Daisy Circuit"),
    new MarioKartWiiSceneDesc('water_course', "Koopa Cape"),
    new MarioKartWiiSceneDesc('treehouse_course', "Maple Treeway"),
    new MarioKartWiiSceneDesc('volcano_course', "Grumble Volcano"),
    "Special Cup",
    new MarioKartWiiSceneDesc('desert_course', "Dry Dry Ruins"),
    new MarioKartWiiSceneDesc('ridgehighway_course', "Moonview Highway"),
    new MarioKartWiiSceneDesc('koopa_course', "Bowser's Castle"),
    new MarioKartWiiSceneDesc('rainbow_course', "Rainbow Road"),
    "Shell Cup",
    new MarioKartWiiSceneDesc('old_peach_gc', "GCN Peach Beach"),
    new MarioKartWiiSceneDesc('old_falls_ds', "DS Yoshi Falls"),
    new MarioKartWiiSceneDesc('old_obake_sfc', "SNES Ghost Valley 2"),
    new MarioKartWiiSceneDesc('old_mario_64', "N64 Mario Raceway"),
    "Banana Cup",
    new MarioKartWiiSceneDesc('old_sherbet_64', "N64 Sherbet Land"),
    new MarioKartWiiSceneDesc('old_heyho_gba', "GBA Shy Guy Beach"),
    new MarioKartWiiSceneDesc('old_town_ds', "DS Delfino Square"),
    new MarioKartWiiSceneDesc('old_waluigi_gc', "GCN Waluigi Stadium"),
    "Leaf Cup",
    new MarioKartWiiSceneDesc('old_desert_ds', "DS Desert Hills"),
    new MarioKartWiiSceneDesc('old_koopa_gba', "GBA Bowser's Castle 3"),
    new MarioKartWiiSceneDesc('old_donkey_64', "N64 DK's Jungle Parkway"),
    new MarioKartWiiSceneDesc('old_mario_gc', "GCN Mario Circuit"),
    "Lightning Cup",
    new MarioKartWiiSceneDesc('old_mario_sfc', "SNES Mario Circuit 3"),
    new MarioKartWiiSceneDesc('old_garden_ds', "DS Peach Gardens"),
    new MarioKartWiiSceneDesc('old_donkey_gc', "GCN DK Mountain"),
    new MarioKartWiiSceneDesc('old_koopa_64', "N64 Bowser's Castle"),
    "Battle Courses",
    new MarioKartWiiSceneDesc('block_battle', "Block Plaza"),
    new MarioKartWiiSceneDesc('venice_battle', "Delfino Pier"),
    new MarioKartWiiSceneDesc('skate_battle', "Funky Stadium"),
    new MarioKartWiiSceneDesc('casino_battle', "Chain Chomp Wheel"),
    new MarioKartWiiSceneDesc('sand_battle', "Thwomp Desert"),
    new MarioKartWiiSceneDesc('old_battle4_sfc', "SNES Battle Course 4"),
    new MarioKartWiiSceneDesc('old_battle3_gba', "GBA Battle Course 3"),
    new MarioKartWiiSceneDesc('old_matenro_64', "N64 Skyscraper"),
    new MarioKartWiiSceneDesc('old_CookieLand_gc', "GCN Cookie Land"),
    new MarioKartWiiSceneDesc('old_House_ds', "DS Twilight House"),
    "Extra",
    new MarioKartWiiSceneDesc('ring_mission', "Galaxy Colosseum"),
    new MarioKartWiiSceneDesc('ending_demo', "Luigi Circuit (Credits)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
