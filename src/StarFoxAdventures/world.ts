import { mat4, vec3 } from 'gl-matrix';
import * as UI from '../ui';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderer";
import { SceneContext } from '../SceneBase';
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import { ub_PacketParams, u_PacketParamsBufferSize, fillPacketParamsData } from "../gx/gx_render";
import { ViewerRenderInput } from "../viewer";
import { fillSceneParamsDataOnTemplate, PacketParams, GXMaterialHelperGfx, MaterialParams } from '../gx/gx_render';
import { getDebugOverlayCanvas2D, drawWorldSpaceText, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";
import { getMatrixAxisZ, getMatrixTranslation, matrixHasUniformScale } from '../MathHelpers';

import { SFA_GAME_INFO, SFADEMO_GAME_INFO, GameInfo } from './scenes';
import { loadRes, ResourceCollection } from './resource';
import { ObjectManager, ObjectInstance } from './objects';
import { EnvfxManager } from './envfx';
import { SFATextureCollection } from './textures';
import { SFARenderer } from './render';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { MapInstance, loadMap } from './maps';
import { createDownloadLink, dataSubarray, interpS16, angle16ToRads, readVec3 } from './util';
import { ModelVersion, ModelInstance, ModelCollection } from './models';
import { MaterialFactory } from './shaders';
import { SFAAnimationController, AnimCollection, AmapCollection, ModanimCollection } from './animation';
import { Camera } from '../Camera';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

function submitScratchRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, renderInst: GfxRenderInst, viewerInput: ViewerRenderInput, noViewMatrix: boolean = false, materialParams_ = materialParams, packetParams_ = packetParams): void {
    materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams_.m_TextureMapping);
    const offs = materialHelper.allocateMaterialParams(renderInst);
    materialHelper.fillMaterialParamsDataOnInst(renderInst, offs, materialParams_);
    renderInst.allocateUniformBuffer(ub_PacketParams, u_PacketParamsBufferSize);
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

function getCamPos(v: vec3, camera: Camera): void {
    getMatrixTranslation(v, camera.worldMatrix);
}

class World {
    public animCtrl: SFAAnimationController;
    public envfxMan: EnvfxManager;
    public materialFactory: MaterialFactory;
    public objectMan: ObjectManager;
    public resColl: ResourceCollection;

    // TODO: we might have to support worlds that are comprised of multiple subdirectories
    private constructor(private device: GfxDevice, public gameInfo: GameInfo, public subdir: string) {
    }

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, subdir: string): Promise<World> {
        const self = new World(device, gameInfo, subdir);
        
        self.animCtrl = new SFAAnimationController();
        // TODO
        self.objectMan = await ObjectManager.create();
        self.envfxMan = new EnvfxManager(gameInfo, self.texColl);
        self.materialFactory = new MaterialFactory(this.device);

        return self;
    }
}

class WorldRenderer extends SFARenderer {
    private ddraw = new TDDraw();
    private materialHelperSky: GXMaterialHelperGfx;
    private timeSelect: UI.Slider;

    constructor(private device: GfxDevice, animController: SFAAnimationController, private materialFactory: MaterialFactory, private envfxMan: EnvfxManager, private mapInstance: MapInstance | null, private objectInstances: ObjectInstance[], private models: (ModelInstance | null)[], private resColl: ResourceCollection) {
        super(device, animController);

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
        const panel = new UI.Panel();
        panel.setTitle(UI.TIME_OF_DAY_ICON, 'Time');

        this.timeSelect = new UI.Slider();
        this.timeSelect.setLabel('Time');
        this.timeSelect.setRange(0, 7, 1);
        this.timeSelect.setValue(4);
        panel.contents.append(this.timeSelect.elem);

        return [panel];
    }

    public setEnvfx(envfxactNum: number) {
        this.envfxMan.loadEnvfx(this.device, envfxactNum);
    }

    // XXX: for testing
    public enableFineAnims(enable: boolean = true) {
        this.animController.enableFineSkinAnims = enable;
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);
        this.materialFactory.update(this.animController);
    }

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        this.beginPass(viewerInput, true);

        const atmos = this.envfxMan.atmosphere;
        let texNum = this.timeSelect.getValue()|0;
        if (texNum < 0) {
            texNum = 0;
        } else if (texNum >= atmos.textures.length) {
            texNum = atmos.textures.length - 1;
        }
        const tex = atmos.textures[texNum]!;
        materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
        materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
        materialParams.m_TextureMapping[0].width = tex.width;
        materialParams.m_TextureMapping[0].height = tex.height;
        materialParams.m_TextureMapping[0].lodBias = 0.0;
        mat4.identity(materialParams.u_TexMtx[0]);

        // Extract pitch
        const cameraFwd = vec3.create();
        getMatrixAxisZ(cameraFwd, viewerInput.camera.worldMatrix);
        vec3.negate(cameraFwd, cameraFwd);
        const camPitch = vecPitch(cameraFwd);
        const camRoll = Math.PI / 2;

        // Draw atmosphere
        // FIXME: This implementation is adapted from the game, but correctness is not verified.
        // We should probably use a different technique, since this one works poorly in VR.
        // TODO: Implement time of day, which the game implements by blending gradient textures on the CPU.
        const fovRollFactor = 3.0 * (tex.height * 0.5 * viewerInput.camera.fovY / Math.PI) * Math.sin(-camRoll);
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
        submitScratchRenderInst(device, renderInstManager, this.materialHelperSky, renderInst, viewerInput, true);

        this.ddraw.endAndUpload(device, renderInstManager);
        
        this.endPass(device);
        
        // Draw skyscape
        this.beginPass(viewerInput);

        const eyePos = vec3.create();
        getCamPos(eyePos, viewerInput.camera);
        for (let i = 0; i < this.envfxMan.skyscape.objects.length; i++) {
            const obj = this.envfxMan.skyscape.objects[i];
            obj.setPosition(eyePos);
            obj.render(device, renderInstManager, viewerInput, this.sceneTexture, 0); // TODO: additional draw steps?
        }

        this.endPass(device);
    }

    private renderTestModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, modelInst: ModelInstance) {
        modelInst.prepareToRender(device, renderInstManager, viewerInput, matrix, this.sceneTexture, 0);

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
                    drawWorldSpaceLine(ctx, viewerInput.camera, parentPt, jointPt);
                } else {
                    drawWorldSpacePoint(ctx, viewerInput.camera, jointPt);
                }
            }
        }
    }

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        // Render opaques
        this.beginPass(viewerInput);
        if (this.mapInstance !== null) {
            this.mapInstance.prepareToRender(device, renderInstManager, viewerInput, this.sceneTexture, 0);
        }
        
        const mtx = mat4.create();
        const ctx = getDebugOverlayCanvas2D();
        for (let i = 0; i < this.objectInstances.length; i++) {
            const obj = this.objectInstances[i];

            obj.render(device, renderInstManager, viewerInput, this.sceneTexture, 0);
            // TODO: additional draw steps; object furs and translucents

            const drawLabels = false;
            if (drawLabels) {
                drawWorldSpaceText(ctx, viewerInput.camera, obj.getPosition(), obj.getName(), undefined, undefined, {outline: 2});
            }
        }
        
        const testCols = Math.ceil(Math.sqrt(this.models.length));
        let col = 0;
        let row = 0;
        for (let i = 0; i < this.models.length; i++) {
            if (this.models[i] !== null) {
                mat4.fromTranslation(mtx, [col * 60, row * 60, 0]);
                this.renderTestModel(device, renderInstManager, viewerInput, mtx, this.models[i]!);
                col++;
                if (col >= testCols) {
                    col = 0;
                    row++;
                }
            }
        }
        
        this.endPass(device);

        // Render waters, furs and translucents
        this.beginPass(viewerInput);
        if (this.mapInstance !== null) {
            this.mapInstance.prepareToRenderWaters(device, renderInstManager, viewerInput, this.sceneTexture);
            this.mapInstance.prepareToRenderFurs(device, renderInstManager, viewerInput, this.sceneTexture);
        }
        this.endPass(device);

        const NUM_DRAW_STEPS = 3;
        for (let drawStep = 1; drawStep < NUM_DRAW_STEPS; drawStep++) {
            this.beginPass(viewerInput);
            if (this.mapInstance !== null) {
                this.mapInstance.prepareToRender(device, renderInstManager, viewerInput, this.sceneTexture, drawStep);
            }
            this.endPass(device);
        }    
    }
}

export class SFAWorldSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, private subdir: string, private mapNum: number, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const materialFactory = new MaterialFactory(device);
        const animController = new SFAAnimationController();
        const mapSceneInfo = await loadMap(device, materialFactory, animController, context, this.mapNum, this.gameInfo);
        const mapInstance = new MapInstance(mapSceneInfo);
        await mapInstance.reloadBlocks();

        // Translate map for SFA world coordinates
        const objectOrigin = vec3.fromValues(640 * mapSceneInfo.getOrigin()[0], 0, 640 * mapSceneInfo.getOrigin()[1]);
        const mapMatrix = mat4.create();
        const mapTrans = vec3.clone(objectOrigin);
        vec3.negate(mapTrans, mapTrans);
        mat4.fromTranslation(mapMatrix, mapTrans);
        mapInstance.setMatrix(mapMatrix);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const resColl = await ResourceCollection.create(this.gameInfo, context.dataFetcher, this.subdir, animController);
        const objectMan = await ObjectManager.create(resColl, animController, materialFactory, this.gameInfo, dataFetcher, false);
        const earlyObjectMan = await ObjectManager.create(resColl, animController, materialFactory, SFADEMO_GAME_INFO, dataFetcher, true);
        //const envfxMan = new EnvfxManager(this.gameInfo, resColl.texColl, objectMan);
        const envfxMan = await EnvfxManager.create(this.gameInfo, dataFetcher, resColl.texColl, objectMan);
        const [romlistFile] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${this.id}.romlist.zlb`),
        ]);
        const romlist = loadRes(romlistFile).createDataView();

        // Set default atmosphere: "InstallShield Blue"
        envfxMan.loadEnvfx(device, 0x3c);

        const objectInstances: ObjectInstance[] = [];

        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const fields = {
                objType: romlist.getUint16(offs + 0x0),
                entrySize: romlist.getUint8(offs + 0x2),
                radius: 8 * romlist.getUint8(offs + 0x6),
                pos: readVec3(romlist, 0x8),
            };

            const posInMap = vec3.clone(fields.pos);
            vec3.add(posInMap, posInMap, objectOrigin);

            const objParams = dataSubarray(romlist, offs, fields.entrySize * 4);

            const obj = objectMan.createObjectInstance(device, fields.objType, objParams, posInMap, mapInstance, envfxMan);
            objectInstances.push(obj);

            console.log(`Object #${i}: ${obj.getName()} (type ${obj.getType().typeNum} class ${obj.getType().objClass})`);

            offs += fields.entrySize * 4;
            i++;
        }
        
        window.main.lookupObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = objectMan.getObjectType(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.typeNum} class ${obj.objClass})`);
        };

        window.main.lookupEarlyObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = earlyObjectMan.getObjectType(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.typeNum} class ${obj.objClass})`);
        };

        const testModels: (ModelInstance | null)[] = [];
        // console.log(`Loading Fox....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, this.gameInfo, this.subdir, 1)); // Fox
        // console.log(`Loading SharpClaw....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, this.gameInfo, this.subdir, 23)); // Sharpclaw
        // console.log(`Loading General Scales....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, this.gameInfo, 'shipbattle', 0x140 / 4)); // General Scales
        // console.log(`Loading SharpClaw (demo version)....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFADEMO_GAME_INFO, 'warlock', 0x1394 / 4, ModelVersion.Demo)); // SharpClaw (beta version)
        // console.log(`Loading General Scales (demo version)....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFADEMO_GAME_INFO, 'shipbattle', 0x138 / 4, ModelVersion.Demo)); // General Scales (beta version)
        // console.log(`Loading Beta Fox....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFADEMO_GAME_INFO, 'swapcircle', 0x0 / 4, ModelVersion.Beta, true)); // Fox (beta version)
        // console.log(`Loading a model (really old version)....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFADEMO_GAME_INFO, 'swapcircle', 0x28 / 4, ModelVersion.Beta));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'warlock', 11, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'warlock', 14, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'warlock', 23, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'capeclaw', 26, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'capeclaw', 29, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'capeclaw', 148, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'swaphol', 212, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'swaphol', 220, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'capeclaw', 472, ModelVersion.Final));
        // console.log(`Loading a model with PNMTX 9 stuff....`);
        // testModels.push(await testLoadingAModel(device, animController, dataFetcher, SFA_GAME_INFO, 'warlock', 606, ModelVersion.Final));

        const enableMap = true;
        const enableObjects = true;
        const renderer = new WorldRenderer(device, animController, materialFactory, envfxMan, enableMap ? mapInstance : null,
            enableObjects ? objectInstances : [],
            testModels,
            resColl
        );
        console.info(`Enter main.scene.enableFineAnims() to enable more animations. However, this will be very slow.`);
        return renderer;
    }
}