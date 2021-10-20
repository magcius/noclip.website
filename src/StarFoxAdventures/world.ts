import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot, GfxrGraphBuilder } from '../gfx/render/GfxRenderGraph';
import { SceneContext } from '../SceneBase';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { PacketParams, GXMaterialHelperGfx, MaterialParams, fillSceneParamsDataOnTemplate, SceneParams, fillSceneParams, fillSceneParamsData } from '../gx/gx_render';
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";
import { getMatrixAxisZ } from '../MathHelpers';
import { colorNewFromRGBA, Color, colorCopy } from '../Color';
import { computeViewMatrix } from '../Camera';

import { SFA_GAME_INFO, GameInfo } from './scenes';
import { loadRes, ResourceCollection } from './resource';
import { ObjectManager, ObjectInstance, ObjectRenderContext, ObjectUpdateContext } from './objects';
import { EnvfxManager } from './envfx';
import { SFARenderer, SceneRenderContext, SFARenderLists, submitScratchRenderInst, setGXMaterialOnRenderInst } from './render';
import { MapInstance, loadMap } from './maps';
import { dataSubarray, readVec3, vecPitch } from './util';
import { ModelRenderContext } from './models';
import { MaterialFactory } from './materials';
import { SFAAnimationController } from './animation';
import { SFABlockFetcher } from './blocks';
import { getCamPos } from './util';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

interface Light {
    position: vec3;
    color: Color;
    distAtten: vec3;
    // TODO: flags and other parameters...
}

export class World {
    public animController: SFAAnimationController;
    public envfxMan: EnvfxManager;
    public blockFetcher: SFABlockFetcher;
    public mapInstance: MapInstance | null = null;
    public objectMan: ObjectManager;
    public resColl: ResourceCollection;
    public objectInstances: ObjectInstance[] = [];
    public lights: Set<Light> = new Set();

    private constructor(public device: GfxDevice, public gameInfo: GameInfo, public subdirs: string[], private materialFactory: MaterialFactory) {
    }

    private async init(dataFetcher: DataFetcher) {
        this.animController = new SFAAnimationController();
        this.envfxMan = await EnvfxManager.create(this, dataFetcher);
        
        const resCollPromise = ResourceCollection.create(this.device, this.gameInfo, dataFetcher, this.subdirs, this.materialFactory, this.animController);
        const texFetcherPromise = async () => {
            return (await resCollPromise).texFetcher;
        };

        const [resColl, blockFetcher, objectMan] = await Promise.all([
            resCollPromise,
            SFABlockFetcher.create(this.gameInfo, dataFetcher, this.device, this.materialFactory, this.animController, texFetcherPromise()),
            ObjectManager.create(this, dataFetcher, false),
        ]);
        this.resColl = resColl;
        this.blockFetcher = blockFetcher;
        this.objectMan = objectMan;
    }

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, subdirs: string[], materialFactory: MaterialFactory): Promise<World> {
        const self = new World(device, gameInfo, subdirs, materialFactory);
        await self.init(dataFetcher);
        return self;
    }

    public setMapInstance(mapInstance: MapInstance | null) {
        this.mapInstance = mapInstance;
    }

    public spawnObject(objParams: DataView, parent: ObjectInstance | null = null, mapObjectOrigin: vec3): ObjectInstance | null {
        const typeNum = objParams.getUint16(0x0);
        const pos = readVec3(objParams, 0x8);

        const posInMap = vec3.clone(pos);
        vec3.add(posInMap, posInMap, mapObjectOrigin);

        const obj = this.objectMan.createObjectInstance(typeNum, objParams, posInMap);
        obj.setParent(parent);
        this.objectInstances.push(obj);

        try {
            obj.mount();
        } catch (e) {
            console.warn("Mounting object failed with exception:");
            console.error(e);
            this.objectInstances.pop();
            return null;
        }

        return obj;
    }

    public spawnObjectsFromRomlist(romlist: DataView, parent: ObjectInstance | null = null) {
        const mapObjectOrigin = vec3.create();
        if (this.mapInstance !== null)
            vec3.set(mapObjectOrigin, 640 * this.mapInstance.info.getOrigin()[0], 0, 640 * this.mapInstance.info.getOrigin()[1]);

        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const entrySize = 4 * romlist.getUint8(offs + 0x2);
            const objParams = dataSubarray(romlist, offs, entrySize);

            const obj = this.spawnObject(objParams, parent, mapObjectOrigin);
            if (obj !== null)
                console.log(`Object #${i}: ${obj.getName()} (type ${obj.getType().typeNum} romlist-type 0x${obj.commonObjectParams.objType.toString(16)} class ${obj.getType().objClass} id 0x${obj.commonObjectParams.id.toString(16)})`);

            offs += entrySize;
            i++;
        }
    }

    public destroy(device: GfxDevice) {
        for (let obj of this.objectInstances)
            obj.destroy(device);
        this.envfxMan.destroy(device);
        this.mapInstance?.destroy(device);
        this.resColl.destroy(device);
        this.blockFetcher.destroy(device);
    }
}

const scratchMtx0 = mat4.create();
const scratchVec0 = vec3.create();
const scratchColor0 = colorNewFromRGBA(1, 1, 1, 1);
const scratchSceneParams = new SceneParams();

class WorldRenderer extends SFARenderer {
    private timeSelect: UI.Slider;
    private enableAmbient: boolean = true;
    private layerSelect: UI.Slider;
    private showObjects: boolean = true;
    private showDevGeometry: boolean = false;
    private showDevObjects: boolean = false;
    private enableLights: boolean = true;

    private materialHelperSky: GXMaterialHelperGfx;
    private skyddraw = new TDDraw();

    constructor(private world: World, materialFactory: MaterialFactory) {
        super(world.device, world.animController, materialFactory);

        packetParams.clear();

        this.skyddraw.setVtxDesc(GX.Attr.POS, true);
        this.skyddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.skyddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.skyddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        let mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevDirect(0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelperSky = new GXMaterialHelperGfx(mb.finish('atmosphere'));
    }

    public createPanels(): UI.Panel[] {
        const timePanel = new UI.Panel();
        timePanel.setTitle(UI.TIME_OF_DAY_ICON, 'Time');

        this.timeSelect = new UI.Slider();
        this.timeSelect.setLabel('Time');
        this.timeSelect.setRange(0, 7, 1);
        this.timeSelect.setValue(4);
        timePanel.contents.append(this.timeSelect.elem);

        const disableAmbient = new UI.Checkbox("Disable ambient lighting", false);
        disableAmbient.onchanged = () => {
            this.enableAmbient = !disableAmbient.checked;
        };
        timePanel.contents.append(disableAmbient.elem);

        const layerPanel = new UI.Panel();
        layerPanel.setTitle(UI.LAYER_ICON, 'Layers');

        const hideObjects = new UI.Checkbox("Hide objects", false);
        hideObjects.onchanged = () => {
            this.showObjects = !hideObjects.checked;
        };
        layerPanel.contents.append(hideObjects.elem);

        this.layerSelect = new UI.Slider();
        this.layerSelect.setLabel('Layer');
        this.layerSelect.setRange(0, 16, 1);
        this.layerSelect.setValue(1);
        layerPanel.contents.append(this.layerSelect.elem);

        const showDevObjects = new UI.Checkbox("Show developer objects", false);
        showDevObjects.onchanged = () => {
            this.showDevObjects = showDevObjects.checked;
        };
        layerPanel.contents.append(showDevObjects.elem);

        const showDevGeometry = new UI.Checkbox("Show developer map shapes", false);
        showDevGeometry.onchanged = () => {
            this.showDevGeometry = showDevGeometry.checked;
        };
        layerPanel.contents.append(showDevGeometry.elem);

        const disableLights = new UI.Checkbox("Disable lights", false);
        disableLights.onchanged = () => {
            this.enableLights = !disableLights.checked;
        }
        layerPanel.contents.append(disableLights.elem);

        return [timePanel, layerPanel];
    }

    public setEnvfx(envfxactNum: number) {
        this.world.envfxMan.loadEnvfx(envfxactNum);
    }

    // XXX: for testing
    public enableFineAnims(enable: boolean = true) {
        this.animController.enableFineSkinAnims = enable;
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);

        this.materialFactory.update(this.animController);

        this.world.envfxMan.setTimeOfDay(this.timeSelect.getValue()|0);
        if (!this.enableAmbient)
            this.world.envfxMan.setOverrideOutdoorAmbientColor(colorNewFromRGBA(1.0, 1.0, 1.0, 1.0));
        else
            this.world.envfxMan.setOverrideOutdoorAmbientColor(null);
            
        const updateCtx: ObjectUpdateContext = {
            viewerInput,
        };

        for (let i = 0; i < this.world.objectInstances.length; i++) {
            const obj = this.world.objectInstances[i];

            // FIXME: Is it really true that objects are updated regardless of layer?
            // This is required for TrigPlns to work.
            obj.update(updateCtx);
        }
    }

    private renderAtmosphere(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, mainColorTargetID: number, sceneCtx: SceneRenderContext) {
        // Draw atmosphere
        const tex = this.world.envfxMan.getAtmosphereTexture();
        if (tex === null || tex === undefined)
            return;

        // Call renderHelper.pushTemplateRenderInst (not renderInstManager.pushTemplateRenderInst)
        // to obtain a local SceneParams buffer
        const template = this.renderHelper.pushTemplateRenderInst();

        // Setup to draw in clip space
        fillSceneParams(scratchSceneParams, mat4.create(), sceneCtx.viewerInput.backbufferWidth, sceneCtx.viewerInput.backbufferHeight);
        let offs = template.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
        const d = template.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
        fillSceneParamsData(d, offs, scratchSceneParams);

        materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
        materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
        materialParams.m_TextureMapping[0].width = tex.width;
        materialParams.m_TextureMapping[0].height = tex.height;
        materialParams.m_TextureMapping[0].lodBias = 0.0;
        mat4.identity(materialParams.u_TexMtx[0]);

        // Extract pitch
        const cameraFwd = scratchVec0;
        getMatrixAxisZ(cameraFwd, sceneCtx.viewerInput.camera.worldMatrix);
        vec3.negate(cameraFwd, cameraFwd);
        const camPitch = vecPitch(cameraFwd);
        const camRoll = Math.PI / 2;

        // FIXME: We should probably use a different technique since this one is poorly suited to VR.
        // TODO: Implement precise time of day. The game blends textures on the CPU to produce
        // an atmosphere texture for a given time of day.
        const fovRollFactor = 3.0 * (tex.height * 0.5 * sceneCtx.viewerInput.camera.fovY / Math.PI) * Math.sin(-camRoll);
        const pitchFactor = (0.5 * tex.height - 6.0) - (3.0 * tex.height * -camPitch / Math.PI);
        const t0 = (pitchFactor + fovRollFactor) / tex.height;
        const t1 = t0 - (fovRollFactor * 2.0) / tex.height;

        this.skyddraw.beginDraw();
        this.skyddraw.begin(GX.Command.DRAW_QUADS);
        this.skyddraw.position3f32(-1, -1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.skyddraw.position3f32(-1, 1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.skyddraw.position3f32(1, 1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.skyddraw.position3f32(1, -1, -1);
        this.skyddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.skyddraw.end();

        const renderInst = this.skyddraw.makeRenderInst(renderInstManager);
        setGXMaterialOnRenderInst(device, renderInstManager, this.materialHelperSky, renderInst, sceneCtx.viewerInput, true, materialParams, packetParams);

        this.skyddraw.endAndUpload(renderInstManager);

        renderInstManager.popTemplateRenderInst();
        
        builder.pushPass((pass) => {
            pass.setDebugName('Atmosphere');
            pass.setViewport(sceneCtx.viewerInput.viewport);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.exec((passRenderer) => {
                renderInst.drawOnPass(renderInstManager.gfxRenderCache, passRenderer);
            });
        });
    }

    protected addSkyRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        // Draw skyscape
        if (this.world.envfxMan.skyscape.objects.length !== 0) {
            renderInstManager.setCurrentRenderInstList(renderLists.skyscape);

            const template = renderInstManager.pushTemplateRenderInst();
            fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

            const objectCtx: ObjectRenderContext = {
                sceneCtx,
                showDevGeometry: this.showDevGeometry,
                setupLights: () => {}, // Lights are not used when rendering skyscape objects (?)
            }

            const eyePos = scratchVec0;
            getCamPos(eyePos, sceneCtx.viewerInput.camera);
            for (let i = 0; i < this.world.envfxMan.skyscape.objects.length; i++) {
                const obj = this.world.envfxMan.skyscape.objects[i];
                obj.setPosition(eyePos);
                obj.addRenderInsts(device, renderInstManager, null, objectCtx);
            }

            renderInstManager.popTemplateRenderInst();
        }
    }

    protected addSkyRenderPasses(device: GfxDevice, builder: GfxrGraphBuilder, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, mainColorTargetID: number, sceneCtx: SceneRenderContext) {
        this.renderAtmosphere(device, builder, renderInstManager, mainColorTargetID, sceneCtx);

        builder.pushPass((pass) => {
            pass.setDebugName('Skyscape');
            pass.setViewport(sceneCtx.viewerInput.viewport);
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Skyscape Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawListOnPassRenderer(renderLists.skyscape, passRenderer);
            });
        });
    }

    private setupLights(lights: GX_Material.Light[], modelCtx: ModelRenderContext) {
        let i = 0;

        if (this.enableLights) {
            const worldView = scratchMtx0;
            computeViewMatrix(worldView, modelCtx.sceneCtx.viewerInput.camera);

            // Global specular ambient
            // (TODO)
            // lights[i].reset();
            // vec3.set(lights[i].Direction, 1, 1, 1);
            // colorCopy(lights[i].Color, modelCtx.outdoorAmbientColor);
            // vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0); // TODO
            // vec3.copy(lights[i].DistAtten, [1000, 1000, 1000]);
            // i++;
    
            // const ctx = getDebugOverlayCanvas2D();
            for (let light of this.world.lights) {
                // TODO: The correct way to setup lights is to use the 8 closest lights to the model. Distance cutoff, material flags, etc. also come into play.
    
                lights[i].reset();
                // Light information is specified in view space.
                vec3.transformMat4(lights[i].Position, light.position, worldView);
                // drawWorldSpacePoint(ctx, modelCtx.viewerInput.camera.clipFromWorldMatrix, light.position);
                // TODO: use correct parameters
                colorCopy(lights[i].Color, light.color);
                vec3.set(lights[i].CosAtten, 1.0, 0.0, 0.0); // TODO
                vec3.copy(lights[i].DistAtten, light.distAtten);
    
                i++;
                if (i >= 8)
                    break;
            }
        }

        for (; i < 8; i++)
            lights[i].reset();
    }

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        renderInstManager.setCurrentRenderInstList(renderLists.world[0]);

        const template = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

        this.world.envfxMan.getAmbientColor(scratchColor0, 0); // Always use ambience #0 when rendering map
        const modelCtx: ModelRenderContext = {
            sceneCtx,
            showDevGeometry: this.showDevGeometry,
            outdoorAmbientColor: scratchColor0,
            setupLights: this.setupLights.bind(this),
        };

        if (this.showObjects) {
            for (let i = 0; i < this.world.objectInstances.length; i++) {
                const obj = this.world.objectInstances[i];
    
                if (obj.getType().isDevObject && !this.showDevObjects)
                    continue;
    
                if (obj.isInLayer(this.layerSelect.getValue())) {
                    obj.addRenderInsts(device, renderInstManager, renderLists, modelCtx);
        
                    const drawLabels = false;
                    if (drawLabels)
                        drawWorldSpaceText(getDebugOverlayCanvas2D(), sceneCtx.viewerInput.camera.clipFromWorldMatrix, obj.getPosition(), obj.getName(), undefined, undefined, {outline: 2});
                }
            }
        }
        
        if (this.world.mapInstance !== null)
            this.world.mapInstance.addRenderInsts(device, renderInstManager, renderLists, modelCtx);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice) {
        super.destroy(device);
        this.world.destroy(device);
        this.skyddraw.destroy(device);
    }
}

export class SFAWorldSceneDesc implements Viewer.SceneDesc {
    public id: string;
    private subdirs: string[];

    constructor(public id_: string | string[], subdir_: string | string[], private mapNum: number | null, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
        if (Array.isArray(id_))
            this.id = id_[0];
        else
            this.id = id_;

        if (Array.isArray(subdir_))
            this.subdirs = subdir_;
        else
            this.subdirs = [subdir_];
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const materialFactory = new MaterialFactory(device);
        const world = await World.create(device, this.gameInfo, dataFetcher, this.subdirs, materialFactory);
        
        let mapInstance: MapInstance | null = null;
        if (this.mapNum !== null) {
            const mapSceneInfo = await loadMap(this.gameInfo, dataFetcher, this.mapNum);
            mapInstance = new MapInstance(mapSceneInfo, world.blockFetcher);
            await mapInstance.reloadBlocks(dataFetcher);

            // Translate map for SFA world coordinates
            const objectOrigin = vec3.fromValues(640 * mapSceneInfo.getOrigin()[0], 0, 640 * mapSceneInfo.getOrigin()[1]);
            const mapMatrix = mat4.create();
            const mapTrans = vec3.clone(objectOrigin);
            vec3.negate(mapTrans, mapTrans);
            mat4.fromTranslation(mapMatrix, mapTrans);
            mapInstance.setMatrix(mapMatrix);

            world.setMapInstance(mapInstance);
        }

        const romlistNames: string[] = Array.isArray(this.id_) ? this.id_ : [this.id_];
        let parentObj: ObjectInstance | null = null;
        for (let name of romlistNames) {
            console.log(`Loading romlist ${name}.romlist.zlb...`);

            const [romlistFile] = await Promise.all([
                dataFetcher.fetchData(`${pathBase}/${name}.romlist.zlb`),
            ]);
            const romlist = loadRes(romlistFile).createDataView();
    
            world.spawnObjectsFromRomlist(romlist, parentObj);

            // XXX: In the Ship Battle scene, attach galleonship objects to the ship.
            if (name === 'frontend') {
                parentObj = world.objectInstances[2];
                console.log(`parentObj is ${parentObj.objType.name}`);
            }
        }
        
        (window.main as any).lookupObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = world.objectMan.getObjectType(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.typeNum} class ${obj.objClass})`);
        };

        const renderer = new WorldRenderer(world, materialFactory);
        return renderer;
    }
}