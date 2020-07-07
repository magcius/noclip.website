import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { SceneContext } from '../SceneBase';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import { ub_PacketParams, ub_PacketParamsBufferSize, fillPacketParamsData } from "../gx/gx_render";
import { ViewerRenderInput } from "../viewer";
import { PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";
import { getMatrixAxisZ } from '../MathHelpers';
import * as GX_Material from '../gx/gx_material';

import { SFA_GAME_INFO, GameInfo } from './scenes';
import { loadRes, ResourceCollection } from './resource';
import { ObjectManager, ObjectInstance, ObjectRenderContext } from './objects';
import { EnvfxManager } from './envfx';
import { SFARenderer, SceneRenderContext } from './render';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { MapInstance, loadMap } from './maps';
import { dataSubarray, readVec3 } from './util';
import { ModelInstance, ModelRenderContext } from './models';
import { MaterialFactory } from './materials';
import { SFAAnimationController } from './animation';
import { SFABlockFetcher } from './blocks';
import { colorNewFromRGBA, Color, colorCopy } from '../Color';
import { getCamPos } from './util';
import { computeViewMatrix } from '../Camera';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

function submitScratchRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, renderInst: GfxRenderInst, viewerInput: ViewerRenderInput, noViewMatrix: boolean = false, materialParams_ = materialParams, packetParams_ = packetParams): void {
    materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams_.m_TextureMapping);
    const offs = materialHelper.allocateMaterialParams(renderInst);
    materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams_);
    renderInst.allocateUniformBuffer(ub_PacketParams, ub_PacketParamsBufferSize);
    if (noViewMatrix) {
        mat4.identity(packetParams_.u_PosMtx[0]);
    } else {
        mat4.copy(packetParams_.u_PosMtx[0], viewerInput.camera.viewMatrix);
    }
    fillPacketParamsData(renderInst.mapUniformBufferF32(ub_PacketParams), renderInst.getUniformBufferOffset(ub_PacketParams), packetParams_);
    renderInstManager.submitRenderInst(renderInst);
}

function vecPitch(v: vec3): number {
    return Math.atan2(v[1], Math.hypot(v[2], v[0]));
}

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
    public materialFactory: MaterialFactory;
    public objectMan: ObjectManager;
    public resColl: ResourceCollection;
    public objectInstances: ObjectInstance[] = [];
    public lights: Set<Light> = new Set();

    private constructor(public device: GfxDevice, public gameInfo: GameInfo, public subdirs: string[]) {
    }

    private async init(dataFetcher: DataFetcher) {
        this.animController = new SFAAnimationController();
        this.envfxMan = await EnvfxManager.create(this, dataFetcher);
        this.materialFactory = new MaterialFactory(this.device, this.envfxMan);
        
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

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, subdirs: string[]): Promise<World> {
        const self = new World(device, gameInfo, subdirs);
        await self.init(dataFetcher);
        return self;
    }

    public setMapInstance(mapInstance: MapInstance | null) {
        this.mapInstance = mapInstance;
    }

    public spawnObject(objParams: DataView, parent: ObjectInstance | null = null, mapObjectOrigin: vec3): ObjectInstance {
        const typeNum = objParams.getUint16(0x0);
        const pos = readVec3(objParams, 0x8);

        const posInMap = vec3.clone(pos);
        vec3.add(posInMap, posInMap, mapObjectOrigin);

        const obj = this.objectMan.createObjectInstance(typeNum, objParams, posInMap);
        obj.setParent(parent);
        this.objectInstances.push(obj);

        obj.mount();

        return obj;
    }

    public spawnObjectsFromRomlist(romlist: DataView, parent: ObjectInstance | null = null) {
        const mapObjectOrigin = vec3.create();
        if (this.mapInstance !== null) {
            vec3.set(mapObjectOrigin, 640 * this.mapInstance.info.getOrigin()[0], 0, 640 * this.mapInstance.info.getOrigin()[1]);
        }

        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const entrySize = 4 * romlist.getUint8(offs + 0x2);
            const objParams = dataSubarray(romlist, offs, entrySize);

            const obj = this.spawnObject(objParams, parent, mapObjectOrigin);
            console.log(`Object #${i}: ${obj.getName()} (type ${obj.getType().typeNum} class ${obj.getType().objClass})`);

            offs += entrySize;
            i++;
        }
    }
}

class WorldRenderer extends SFARenderer {
    private ddraw = new TDDraw();
    private materialHelperSky: GXMaterialHelperGfx;
    private timeSelect: UI.Slider;
    private enableAmbient: boolean = true;
    private layerSelect: UI.Slider;
    private showObjects: boolean = true;
    private showDevGeometry: boolean = false;
    private showDevObjects: boolean = false;

    constructor(private world: World, private models: (ModelInstance | null)[]) {
        super(world.device, world.animController);

        packetParams.clear();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

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
        this.materialHelperSky = new GXMaterialHelperGfx(mb.finish('sky'));
    }

    public createPanels(): UI.Panel[] {
        const timePanel = new UI.Panel();
        timePanel.setTitle(UI.TIME_OF_DAY_ICON, 'Time');

        this.timeSelect = new UI.Slider();
        this.timeSelect.setLabel('Time');
        this.timeSelect.setRange(0, 7, 1);
        this.timeSelect.setValue(4);
        timePanel.contents.append(this.timeSelect.elem);

        const enableAmbient = new UI.Checkbox("Enable ambient lighting", true);
        enableAmbient.onchanged = () => {
            this.enableAmbient = enableAmbient.checked;
        };
        timePanel.contents.append(enableAmbient.elem);

        const layerPanel = new UI.Panel();
        layerPanel.setTitle(UI.LAYER_ICON, 'Layers');

        const showObjects = new UI.Checkbox("Show objects", true);
        showObjects.onchanged = () => {
            this.showObjects = showObjects.checked;
        };
        layerPanel.contents.append(showObjects.elem);

        this.layerSelect = new UI.Slider();
        this.layerSelect.setLabel('Layer');
        this.layerSelect.setRange(0, 16, 1);
        this.layerSelect.setValue(0);
        layerPanel.contents.append(this.layerSelect.elem);

        const showDevObjects = new UI.Checkbox("Show developer objects", false);
        showDevObjects.onchanged = () => {
            this.showDevObjects = showDevObjects.checked;
        };
        layerPanel.contents.append(showDevObjects.elem);

        const showDevGeometry = new UI.Checkbox("Show developer map geometry", false);
        showDevGeometry.onchanged = () => {
            this.showDevGeometry = showDevGeometry.checked;
        };
        layerPanel.contents.append(showDevGeometry.elem);

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
        this.world.materialFactory.update(this.animController);
        this.world.envfxMan.setTimeOfDay(this.timeSelect.getValue()|0);
        if (!this.enableAmbient) {
            this.world.envfxMan.setOverrideOutdoorAmbientColor(colorNewFromRGBA(1.0, 1.0, 1.0, 1.0));
        } else {
            this.world.envfxMan.setOverrideOutdoorAmbientColor(null);
        }
    }

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        // Draw atmosphere
        const tex = this.world.envfxMan.getAtmosphereTexture();
        if (tex !== null && tex !== undefined) {
            this.beginPass(sceneCtx.viewerInput, true);
            materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
            materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
            materialParams.m_TextureMapping[0].width = tex.width;
            materialParams.m_TextureMapping[0].height = tex.height;
            materialParams.m_TextureMapping[0].lodBias = 0.0;
            mat4.identity(materialParams.u_TexMtx[0]);

            // Extract pitch
            const cameraFwd = vec3.create();
            getMatrixAxisZ(cameraFwd, sceneCtx.viewerInput.camera.worldMatrix);
            vec3.negate(cameraFwd, cameraFwd);
            const camPitch = vecPitch(cameraFwd);
            const camRoll = Math.PI / 2;

            // FIXME: This implementation is adapted from the game, but correctness is not verified.
            // We should probably use a different technique, since this one works poorly in VR.
            // TODO: Implement time of day, which the game implements by blending gradient textures on the CPU.
            const fovRollFactor = 3.0 * (tex.height * 0.5 * sceneCtx.viewerInput.camera.fovY / Math.PI) * Math.sin(-camRoll);
            const pitchFactor = (0.5 * tex.height - 6.0) - (3.0 * tex.height * -camPitch / Math.PI);
            const t0 = (pitchFactor + fovRollFactor) / tex.height;
            const t1 = t0 - (fovRollFactor * 2.0) / tex.height;
            // TODO: Verify to make sure the sky isn't upside-down!

            this.ddraw.beginDraw();
            this.ddraw.begin(GX.Command.DRAW_QUADS);
            this.ddraw.position3f32(-1, -1, -1);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
            this.ddraw.position3f32(-1, 1, -1);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
            this.ddraw.position3f32(1, 1, -1);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
            this.ddraw.position3f32(1, -1, -1);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
            this.ddraw.end();

            const renderInst = this.ddraw.makeRenderInst(device, renderInstManager);
            submitScratchRenderInst(device, renderInstManager, this.materialHelperSky, renderInst, sceneCtx.viewerInput, true);

            this.ddraw.endAndUpload(device, renderInstManager);
            
            this.endPass(device);
        }
        
        // Draw skyscape
        this.beginPass(sceneCtx.viewerInput);

        const objectCtx: ObjectRenderContext = {
            ...sceneCtx,
            showDevGeometry: this.showDevGeometry,
            setupLights: () => {}, // Lights are not used when rendering skyscape objects (?)
        }

        const eyePos = vec3.create();
        getCamPos(eyePos, sceneCtx.viewerInput.camera);
        for (let i = 0; i < this.world.envfxMan.skyscape.objects.length; i++) {
            const obj = this.world.envfxMan.skyscape.objects[i];
            obj.setPosition(eyePos);
            obj.render(device, renderInstManager, objectCtx, 0); // TODO: additional draw steps?
        }

        this.endPass(device);
    }

    private renderTestModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext, matrix: mat4, modelInst: ModelInstance) {
        const modelCtx: ModelRenderContext = {
            ...sceneCtx,
            showDevGeometry: true,
            ambienceNum: 0,
            setupLights: this.setupLights.bind(this),
        };

        modelInst.prepareToRender(device, renderInstManager, modelCtx, matrix, 0);

        // Draw bones
        const drawBones = false;
        if (drawBones) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 1; i < modelInst.model.joints.length; i++) {
                const joint = modelInst.model.joints[i];
                const jointMtx = mat4.clone(modelInst.boneMatrices[i]);
                mat4.mul(jointMtx, jointMtx, matrix);
                const jointPt = vec3.create();
                mat4.getTranslation(jointPt, jointMtx);
                if (joint.parent != 0xff) {
                    const parentMtx = mat4.clone(modelInst.boneMatrices[joint.parent]);
                    mat4.mul(parentMtx, parentMtx, matrix);
                    const parentPt = vec3.create();
                    mat4.getTranslation(parentPt, parentMtx);
                    drawWorldSpaceLine(ctx, sceneCtx.viewerInput.camera, parentPt, jointPt);
                } else {
                    drawWorldSpacePoint(ctx, sceneCtx.viewerInput.camera.clipFromWorldMatrix, jointPt);
                }
            }
        }
    }

    private setupLights(lights: GX_Material.Light[], modelCtx: ModelRenderContext) {
        const worldView = mat4.create();
        computeViewMatrix(worldView, modelCtx.viewerInput.camera);

        // const ctx = getDebugOverlayCanvas2D();
        let i = 0;
        for (let light of this.world.lights) {
            // TODO: The correct way to setup lights is to use the 8 closest lights to the model. Distance cutoff, material flags, etc. also come into play.

            lights[i].reset();
            // Light information is specified in view space.
            vec3.transformMat4(lights[i].Position, light.position, worldView);
            // drawWorldSpacePoint(ctx, modelCtx.viewerInput.camera.clipFromWorldMatrix, light.position);
            // TODO: use correct parameters
            colorCopy(lights[i].Color, light.color);
            lights[i].CosAtten = vec3.fromValues(1.0, 0.0, 0.0); // TODO
            vec3.copy(lights[i].DistAtten, light.distAtten);

            i++;
            if (i >= 8)
                break;
        }

        for (; i < 8; i++) {
            lights[i].reset();
        }
    }

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, sceneCtx: SceneRenderContext) {
        // Render opaques

        const modelCtx: ModelRenderContext = {
            ...sceneCtx,
            showDevGeometry: this.showDevGeometry,
            ambienceNum: 0, // Always use ambience 0 when rendering the map,
            setupLights: this.setupLights.bind(this),
        }

        this.beginPass(sceneCtx.viewerInput);
        if (this.world.mapInstance !== null) {
            this.world.mapInstance.prepareToRender(device, renderInstManager, modelCtx, 0);
        }
        
        const mtx = mat4.create();

        if (this.showObjects) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.world.objectInstances.length; i++) {
                const obj = this.world.objectInstances[i];
    
                if (obj.getType().isDevObject && !this.showDevObjects)
                    continue;
    
                if (obj.isInLayer(this.layerSelect.getValue())) {
                    obj.render(device, renderInstManager, modelCtx, 0);
                    // TODO: additional draw steps; object furs and translucents
        
                    const drawLabels = false;
                    if (drawLabels) {
                        drawWorldSpaceText(ctx, sceneCtx.viewerInput.camera.clipFromWorldMatrix, obj.getPosition(), obj.getName(), undefined, undefined, {outline: 2});
                    }
                }
            }
        }
        
        const testCols = Math.ceil(Math.sqrt(this.models.length));
        let col = 0;
        let row = 0;
        for (let i = 0; i < this.models.length; i++) {
            if (this.models[i] !== null) {
                mat4.fromTranslation(mtx, [col * 60, row * 60, 0]);
                this.renderTestModel(device, renderInstManager, sceneCtx, mtx, this.models[i]!);
                col++;
                if (col >= testCols) {
                    col = 0;
                    row++;
                }
            }
        }
        
        this.endPass(device);

        // Render waters, furs and translucents
        this.beginPass(sceneCtx.viewerInput);
        if (this.world.mapInstance !== null) {
            this.world.mapInstance.prepareToRenderWaters(device, renderInstManager, modelCtx);
            this.world.mapInstance.prepareToRenderFurs(device, renderInstManager, modelCtx);
        }
        this.endPass(device);

        const NUM_DRAW_STEPS = 3;
        for (let drawStep = 1; drawStep < NUM_DRAW_STEPS; drawStep++) {
            this.beginPass(sceneCtx.viewerInput);
            if (this.world.mapInstance !== null) {
                this.world.mapInstance.prepareToRender(device, renderInstManager, modelCtx, drawStep);
            }
            this.endPass(device);
        }    
    }
}

export class SFAWorldSceneDesc implements Viewer.SceneDesc {
    public id: string;
    private subdirs: string[];

    constructor(public id_: string | string[], subdir_: string | string[], private mapNum: number | null, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
        if (Array.isArray(id_)) {
            this.id = id_[0];
        } else {
            this.id = id_;
        }

        if (Array.isArray(subdir_)) {
            this.subdirs = subdir_;
        } else {
            this.subdirs = [subdir_];
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const world = await World.create(device, this.gameInfo, dataFetcher, this.subdirs);
        
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

        // Set default atmosphere: "InstallShield Blue"
        // world.envfxMan.loadEnvfx(0x3c);

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

        const renderer = new WorldRenderer(world, []);
        return renderer;
    }
}