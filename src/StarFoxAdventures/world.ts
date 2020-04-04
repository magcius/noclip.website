import { mat4, vec3 } from 'gl-matrix';
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
import { getMatrixAxisZ } from '../MathHelpers';

import { SFA_GAME_INFO, SFADEMO_GAME_INFO, GameInfo } from './scenes';
import { loadRes } from './resource';
import { ObjectManager, SFAObject } from './objects';
import { EnvfxManager } from './envfx';
import { SFATextureCollection } from './textures';
import { SFARenderer } from './render';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { MapInstance, loadMap } from './maps';
import { createDownloadLink, dataSubarray, interpS16, angle16ToRads } from './util';
import { Model, ModelVersion } from './models';
import { MaterialFactory } from './shaders';
import { SFAAnimationController, AnimFile, Anim, AnimLoader } from './animation';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();
const atmosTextureNum = 1;

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

interface ObjectInstance {
    name: string;
    obj: SFAObject;
    pos: vec3;
    radius: number;
    model?: Model;
}

async function testLoadingAModel(device: GfxDevice, animController: SFAAnimationController, dataFetcher: DataFetcher, gameInfo: GameInfo, subdir: string, modelNum: number, modelVersion?: ModelVersion): Promise<Model | null> {
    const pathBase = gameInfo.pathBase;
    const texColl = new SFATextureCollection(gameInfo, modelVersion === ModelVersion.Beta);
    const [modelsTabData, modelsBin, _] = await Promise.all([
        dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.tab`),
        dataFetcher.fetchData(`${pathBase}/${subdir}/MODELS.bin`),
        texColl.create(dataFetcher, subdir),
    ]);
    const modelsTab = modelsTabData.createDataView();

    const modelTabValue = modelsTab.getUint32(modelNum * 4);
    if (modelTabValue === 0) {
        throw Error(`Model #${modelNum} not found`);
    }

    const modelOffs = modelTabValue & 0xffffff;
    const modelData = loadRes(modelsBin.subarray(modelOffs + 0x24));
    
    window.main.downloadModel = () => {
        const aEl = createDownloadLink(modelData, `model_${subdir}_${modelNum}.bin`);
        aEl.click();
    };
    
    try {
        return new Model(device, new MaterialFactory(device), modelData, texColl, animController, modelVersion);
    } catch (e) {
        console.warn(`Failed to load model due to exception:`);
        console.error(e);
        return null;
    }
}

class WorldRenderer extends SFARenderer {
    private ddraw = new TDDraw();
    private materialHelperSky: GXMaterialHelperGfx;

    constructor(device: GfxDevice, animController: SFAAnimationController, private materialFactory: MaterialFactory, private envfxMan: EnvfxManager, private mapInstance: MapInstance | null, private objectInstances: ObjectInstance[], private models: (Model | null)[], private anim: Anim) {
        super(device, animController);

        packetParams.clear();

        const atmos = this.envfxMan.atmosphere;
        const tex = atmos.textures[atmosTextureNum]!;
        materialParams.m_TextureMapping[0].gfxTexture = tex.gfxTexture;
        materialParams.m_TextureMapping[0].gfxSampler = tex.gfxSampler;
        materialParams.m_TextureMapping[0].width = tex.width;
        materialParams.m_TextureMapping[0].height = tex.height;
        materialParams.m_TextureMapping[0].lodBias = 0.0;
        mat4.identity(materialParams.u_TexMtx[0]);

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

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);
        this.materialFactory.update(this.animController);
    }

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        this.beginPass(viewerInput, true);

        const atmos = this.envfxMan.atmosphere;
        const atmosTexture = atmos.textures[atmosTextureNum]!;

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
        const fovRollFactor = 3.0 * (atmosTexture.height * 0.5 * viewerInput.camera.fovY / Math.PI) * Math.sin(-camRoll);
        const pitchFactor = (0.5 * atmosTexture.height - 6.0) - (3.0 * atmosTexture.height * camPitch / Math.PI);
        const t0 = (pitchFactor + fovRollFactor) / atmosTexture.height;
        const t1 = t0 - (fovRollFactor * 2.0) / atmosTexture.height;

        this.ddraw.beginDraw();
        this.ddraw.begin(GX.Command.DRAW_QUADS);
        this.ddraw.position3f32(-1, -1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.ddraw.position3f32(-1, 1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.ddraw.position3f32(1, 1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t0);
        this.ddraw.position3f32(1, -1, -1);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, t1);
        this.ddraw.end();

        const renderInst = this.ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelperSky, renderInst, viewerInput, true);

        this.ddraw.endAndUpload(device, renderInstManager);
        
        this.endPass(device);
    }

    private renderTestModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, matrix: mat4, model: Model) {
        model.prepareToRender(device, renderInstManager, viewerInput, matrix, this.sceneTexture, 0);

        // Draw bones
        const drawBones = true;
        if (drawBones) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 1; i < model.joints.length; i++) {
                const joint = model.joints[i];
                const jointMtx = mat4.clone(model.boneMatrices[i]);
                mat4.mul(jointMtx, jointMtx, matrix);
                const jointPt = vec3.create();
                mat4.getTranslation(jointPt, jointMtx);
                if (joint.parent != 0xff) {
                    const parentMtx = mat4.clone(model.boneMatrices[joint.parent]);
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
        // Give Fox a pose
        const animateFox = true;
        if (animateFox && this.models[0] !== undefined) {
            const model = this.models[0]!;
            const keyframeNum = Math.floor((this.animController.animController.getTimeInSeconds() * 8) % this.anim.keyframes.length);
            const keyframe = this.anim.keyframes[keyframeNum];
            for (let i = 0; i < keyframe.poses.length && i < model.joints.length; i++) {
                const pose = keyframe.poses[i];
                const poseMtx = mat4.create();
                // mat4.rotateY(poseMtx, poseMtx, Math.sin(this.animController.animController.getTimeInSeconds()) / 2);
                mat4.fromTranslation(poseMtx, [pose.axes[0].translation, pose.axes[1].translation, pose.axes[2].translation]);
                mat4.scale(poseMtx, poseMtx, [pose.axes[0].scale, pose.axes[1].scale, pose.axes[2].scale]);
                mat4.rotateY(poseMtx, poseMtx, pose.axes[1].rotation);
                mat4.rotateX(poseMtx, poseMtx, pose.axes[0].rotation);
                mat4.rotateZ(poseMtx, poseMtx, pose.axes[2].rotation);

                const jointNum = this.anim.amap.getInt8(i);
                model.setJointPose(jointNum, poseMtx);
            }
            model.updateBoneMatrices();
        }

        // Render opaques
        this.beginPass(viewerInput);
        if (this.mapInstance !== null) {
            this.mapInstance.prepareToRender(device, renderInstManager, viewerInput, this.sceneTexture, 0);
        }
        
        const mtx = mat4.create();
        const ctx = getDebugOverlayCanvas2D();
        for (let i = 0; i < this.objectInstances.length; i++) {
            const obj = this.objectInstances[i];
            if (obj.model) {
                mat4.fromTranslation(mtx, obj.pos);
                mat4.scale(mtx, mtx, [obj.obj.scale, obj.obj.scale, obj.obj.scale]);
                mat4.rotateY(mtx, mtx, obj.obj.yaw);
                mat4.rotateX(mtx, mtx, obj.obj.pitch);
                mat4.rotateZ(mtx, mtx, obj.obj.roll);
                this.renderTestModel(device, renderInstManager, viewerInput, mtx, obj.model);
            }

            const drawLabels = false;
            if (drawLabels) {
                drawWorldSpaceText(ctx, viewerInput.camera, obj.pos, obj.name, undefined, undefined, {outline: 2});
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
        const texColl = new SFATextureCollection(this.gameInfo, false);
        await texColl.create(dataFetcher, this.subdir); // TODO: subdirectory depends on map
        const objectMan = new ObjectManager(this.gameInfo, texColl, animController, false);
        const earlyObjectMan = new ObjectManager(SFADEMO_GAME_INFO, texColl, animController, true);
        const envfxMan = new EnvfxManager(this.gameInfo, texColl);
        const animLoader = new AnimLoader(this.gameInfo);
        const [_1, _2, _3, _4, romlistFile, tablesTab_, tablesBin_] = await Promise.all([
            objectMan.create(dataFetcher, this.subdir),
            earlyObjectMan.create(dataFetcher, this.subdir),
            envfxMan.create(dataFetcher),
            animLoader.create(dataFetcher, this.subdir),
            dataFetcher.fetchData(`${pathBase}/${this.id}.romlist.zlb`),
            dataFetcher.fetchData(`${pathBase}/TABLES.tab`),
            dataFetcher.fetchData(`${pathBase}/TABLES.bin`),
        ]);
        const romlist = loadRes(romlistFile).createDataView();
        const tablesTab = tablesTab_.createDataView();
        const tablesBin = tablesBin_.createDataView();

        const objectInstances: ObjectInstance[] = [];
        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const fields = {
                objType: romlist.getUint16(offs + 0x0),
                entrySize: romlist.getUint8(offs + 0x2),
                radius: 8 * romlist.getUint8(offs + 0x6),
                pos: vec3.fromValues(
                    romlist.getFloat32(offs + 0x8),
                    romlist.getFloat32(offs + 0xc),
                    romlist.getFloat32(offs + 0x10)
                ),
            };

            const posInMap = vec3.clone(fields.pos);
            vec3.add(posInMap, posInMap, objectOrigin);

            const objParams = dataSubarray(romlist, offs, fields.entrySize * 4);

            const obj = await objectMan.loadObject(device, materialFactory, fields.objType);

            if (obj.objClass === 201) {
                // e.g. sharpclawGr
                obj.yaw = (objParams.getInt8(0x2a) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 222 ||
                obj.objClass === 227 ||
                obj.objClass === 233 ||
                obj.objClass === 234 ||
                obj.objClass === 235 ||
                obj.objClass === 280 ||
                obj.objClass === 283 ||
                obj.objClass === 291 ||
                obj.objClass === 304 ||
                obj.objClass === 312 ||
                obj.objClass === 313 ||
                obj.objClass === 316 ||
                obj.objClass === 319 ||
                obj.objClass === 343 ||
                obj.objClass === 344 ||
                obj.objClass === 387 ||
                obj.objClass === 389 ||
                obj.objClass === 423 ||
                obj.objClass === 424 ||
                obj.objClass === 437 ||
                obj.objClass === 442 ||
                obj.objClass === 487 ||
                obj.objClass === 509 ||
                obj.objClass === 533 ||
                obj.objClass === 576 ||
                obj.objClass === 642 ||
                obj.objClass === 666 ||
                obj.objClass === 691
            ) {
                // e.g. setuppoint
                // Do nothing
            } else if (obj.objClass === 207) {
                // e.g. CannonClawO
                obj.yaw = angle16ToRads(objParams.getInt8(0x28) << 8);
            } else if (obj.objClass === 213) {
                // e.g. Kaldachom
                obj.scale = 0.5 + objParams.getInt8(0x28) / 15;
            } else if (obj.objClass === 231) {
                // e.g. BurnableVin
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
                obj.scale = 5 * objParams.getInt16(0x1a) / 32767;
                if (obj.scale < 0.05) {
                    obj.scale = 0.05;
                }
            } else if (obj.objClass === 237) {
                // e.g. SH_LargeSca
                obj.yaw = (objParams.getInt8(0x1b) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x22) << 8) * Math.PI / 32768;
                obj.roll = (objParams.getInt8(0x23) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 239) {
                // e.g. CCboulder
                obj.yaw = angle16ToRads(objParams.getUint8(0x22) << 8);
                fields.pos[1] += 0.5;
            } else if (obj.objClass === 249) {
                // e.g. ProjectileS
                obj.yaw = (objParams.getInt8(0x1f) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x1c) << 8) * Math.PI / 32768;
                const objScale = objParams.getUint8(0x1d);
                if (objScale !== 0) {
                    obj.scale *= objScale / 64;
                }
            } else if (obj.objClass === 250) {
                // e.g. InvisibleHi
                const scaleParam = objParams.getUint8(0x1d);
                if (scaleParam !== 0) {
                    obj.scale *= scaleParam / 64;
                }
            } else if (obj.objClass === 251 ||
                obj.objClass === 393 ||
                obj.objClass === 445 ||
                obj.objClass === 579 ||
                obj.objClass === 510 ||
                obj.objClass === 513 ||
                obj.objClass === 525 ||
                obj.objClass === 609 ||
                obj.objClass === 617 ||
                obj.objClass === 650
            ) {
                // e.g. SC_Pressure
                obj.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
            } else if (obj.objClass === 254) {
                // e.g. MagicPlant
                obj.yaw = (objParams.getInt8(0x1d) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 256 ||
                obj.objClass === 391 ||
                obj.objClass === 392 ||
                obj.objClass === 394
            ) {
                // e.g. TrickyWarp
                obj.yaw = angle16ToRads(objParams.getInt8(0x1a) << 8);
            } else if (obj.objClass === 259) {
                // e.g. CurveFish
                obj.scale *= objParams.getUint8(0x18) / 100;
            } else if (obj.objClass === 240 ||
                obj.objClass === 260 ||
                obj.objClass === 261
            ) {
                // e.g. WarpPoint, SmallBasket, LargeCrate
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            } else if (obj.objClass === 269) {
                // e.g. PortalSpell
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
                obj.pitch = angle16ToRads(objParams.getInt16(0x1c) << 8); // Yes, getInt16 is correct.
                obj.scale = 3.15;
            } else if (obj.objClass === 272) {
                // e.g. SH_Portcull
                obj.yaw = (objParams.getInt8(0x1f) << 8) * Math.PI / 32768;
                const objScale = objParams.getUint8(0x21) / 64;
                if (objScale === 0) {
                    obj.scale = 1.0;
                } else {
                    obj.scale *= objScale;
                }
            } else if (obj.objClass === 274 ||
                obj.objClass === 275
            ) {
                // e.g. SH_newseqob
                obj.yaw = angle16ToRads(objParams.getInt8(0x1c) << 8);
            } else if (obj.objClass === 284 ||
                obj.objClass === 289 ||
                obj.objClass === 300
            ) {
                // e.g. StaffBoulde
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
                // TODO: scale depends on subtype param
            } else if (obj.objClass === 287) {
                // e.g. MagicCaveTo
                obj.yaw = angle16ToRads(objParams.getUint8(0x23) << 8);
            } else if (obj.objClass === 288) {
                // e.g. TrickyGuard
                obj.yaw = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 293) {
                // e.g. curve
                obj.yaw = (objParams.getInt8(0x2c) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x2d) << 8) * Math.PI / 32768;
                // FIXME: mode 8 and 0x1a also have roll at 0x38
            } else if (obj.objClass === 294 && obj.objType === 77) {
                obj.yaw = (objParams.getInt8(0x3d) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x3e) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 298 && [888, 889].includes(obj.objType)) {
                // e.g. WM_krazoast
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
            } else if (obj.objClass === 299) {
                // e.g. FXEmit
                obj.scale = 0.1;
                obj.yaw = angle16ToRads(objParams.getInt8(0x24) << 8);
                obj.pitch = angle16ToRads(objParams.getInt8(0x23) << 8);
                obj.roll = angle16ToRads(objParams.getInt8(0x22) << 8);
            } else if (obj.objClass === 306) {
                // e.g. WaterFallSp
                obj.roll = (objParams.getInt8(0x1a) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x1b) << 8) * Math.PI / 32768;
                obj.yaw = (objParams.getInt8(0x1c) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 308) {
                // e.g. texscroll2
                const block = mapInstance.getBlockAtPosition(posInMap[0], posInMap[2]);
                if (block === null) {
                    console.warn(`couldn't find block for texscroll object`);
                } else {
                    const scrollableIndex = objParams.getInt16(0x18);
                    const speedX = objParams.getInt8(0x1e);
                    const speedY = objParams.getInt8(0x1f);

                    const tabValue = tablesTab.getUint32(0xe * 4);
                    const targetTexId = tablesBin.getUint32(tabValue * 4 + scrollableIndex * 4) & 0x7fff;
                    // Note: & 0x7fff above is an artifact of how the game stores tex id's.
                    // Bit 15 set means the texture comes directly from TEX1 and does not go through TEXTABLE.

                    const materials = block.getMaterials();
                    for (let i = 0; i < materials.length; i++) {
                        if (materials[i] !== undefined) {
                            const mat = materials[i]!;
                            for (let j = 0; j < mat.shader.layers.length; j++) {
                                const layer = mat.shader.layers[j];
                                if (layer.texId === targetTexId) {
                                    // Found the texture! Make it scroll now.
                                    const theTexture = texColl.getTexture(device, targetTexId, true)!;
                                    const dxPerFrame = (speedX << 16) / theTexture.width;
                                    const dyPerFrame = (speedY << 16) / theTexture.height;
                                    layer.scrollingTexMtx = mat.factory.setupScrollingTexMtx(dxPerFrame, dyPerFrame);
                                    mat.rebuild();
                                }
                            }
                        }
                    }
                }
            } else if (obj.objClass === 329) {
                // e.g. CFTreasWind
                const scaleParam = objParams.getInt8(0x19);
                let objScale;
                if (scaleParam === 0) {
                    objScale = 90;
                } else {
                    objScale = 4 * scaleParam;
                }
                obj.scale *= objScale / 90;
            } else if (obj.objClass === 346) {
                // e.g. SH_BombWall
                obj.yaw = objParams.getInt16(0x1a) * Math.PI / 32768;
                obj.pitch = objParams.getInt16(0x1c) * Math.PI / 32768;
                obj.roll = objParams.getInt16(0x1e) * Math.PI / 32768;
                let objScale = objParams.getInt8(0x2d);
                if (objScale === 0) {
                    objScale = 20;
                }
                obj.scale *= objScale / 20;
            } else if (obj.objClass === 372) {
                // e.g. CCriverflow
                obj.yaw = angle16ToRads(objParams.getUint8(0x18) << 8);
                obj.scale += objParams.getUint8(0x19) / 512;
            } else if (obj.objClass === 383) {
                // e.g. MSVine
                obj.yaw = angle16ToRads(objParams.getUint8(0x1f) << 8);
                const scaleParam = objParams.getUint8(0x21);
                if (scaleParam !== 0) {
                    obj.scale *= scaleParam / 64;
                }
            } else if (obj.objClass === 385) {
                // e.g. MMP_trenchF
                obj.roll = angle16ToRads(objParams.getInt8(0x19) << 8);
                obj.pitch = angle16ToRads(objParams.getInt8(0x1a) << 8);
                obj.yaw = angle16ToRads(objParams.getInt8(0x1b) << 8);
                obj.scale = 0.1;
            } else if (obj.objClass === 390) {
                // e.g. CCgasvent
                obj.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            } else if (obj.objClass === 429) {
                // e.g. ThornTail
                obj.yaw = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
                obj.scale *= objParams.getUint16(0x1c) / 1000;
            } else if (obj.objClass === 439) {
                // e.g. SC_MusicTre
                obj.roll = angle16ToRads((objParams.getUint8(0x18) - 127) * 128);
                obj.pitch = angle16ToRads((objParams.getUint8(0x19) - 127) * 128);
                obj.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
                obj.scale = 3.6 * objParams.getFloat32(0x1c);
            } else if (obj.objClass === 440) {
                // e.g. SC_totempol
                obj.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            } else if (obj.objClass === 454 && obj.objType !== 0x1d6) {
                // e.g. DIMCannon
                obj.yaw = angle16ToRads(objParams.getInt8(0x28) << 8);
            } else if (obj.objClass === 518) {
                // e.g. PoleFlame
                obj.yaw = angle16ToRads((objParams.getUint8(0x18) & 0x3f) << 10);
                const objScale = objParams.getInt16(0x1a);
                if (objScale < 1) {
                    obj.scale = 0.1;
                } else {
                    obj.scale = objScale / 8192;
                }
            } else if (obj.objClass === 524) {
                // e.g. WM_spiritpl
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
                obj.pitch = angle16ToRads(objParams.getInt16(0x1a) << 8); // Yes, getInt16 is correct.
            } else if (obj.objClass === 538) {
                // e.g. VFP_statueb
                const scaleParam = objParams.getInt16(0x1c);
                if (scaleParam > 1) {
                    obj.scale *= scaleParam;
                }
            } else if (obj.objClass === 602) {
                // e.g. StaticCamer
                obj.yaw = angle16ToRads(-objParams.getInt16(0x1c));
                obj.pitch = angle16ToRads(-objParams.getInt16(0x1e));
                obj.roll = angle16ToRads(-objParams.getInt16(0x20));
            } else if (obj.objClass === 425 ||
                obj.objClass === 603
            ) {
                // e.g. MSPlantingS
                obj.yaw = angle16ToRads(objParams.getUint8(0x1f) << 8);
            } else if (obj.objClass === 627) {
                // e.g. FlameMuzzle
                const scaleParam = objParams.getInt16(0x1c);
                if (scaleParam != 0) {
                    obj.scale *= 0.1 * scaleParam;
                }
                obj.roll = 0;
                obj.yaw = angle16ToRads(objParams.getInt8(0x18) << 8);
                obj.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
            } else if (obj.objClass === 683) {
                // e.g. LGTProjecte
                obj.yaw = (objParams.getInt8(0x18) << 8) * Math.PI / 32768;
                obj.pitch = (objParams.getInt8(0x19) << 8) * Math.PI / 32768;
                obj.roll = (objParams.getInt8(0x34) << 8) * Math.PI / 32768;
            } else if (obj.objClass === 214 ||
                obj.objClass === 273 ||
                obj.objClass === 689 ||
                obj.objClass === 690
            ) {
                // e.g. CmbSrc
                obj.roll = angle16ToRads(objParams.getUint8(0x18) << 8);
                obj.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
                obj.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
            } else if (obj.objClass === 282 ||
                obj.objClass === 302 ||
                obj.objClass === 685 ||
                obj.objClass === 686 ||
                obj.objClass === 687 ||
                obj.objClass === 688
            ) {
                // e.g. Boulder, LongGrassCl
                obj.roll = angle16ToRads(objParams.getUint8(0x18) << 8);
                obj.pitch = angle16ToRads(objParams.getUint8(0x19) << 8);
                obj.yaw = angle16ToRads(objParams.getUint8(0x1a) << 8);
                const scaleParam = objParams.getUint8(0x1b);
                if (scaleParam !== 0) {
                    obj.scale *= scaleParam / 255;
                }
            } else if (obj.objClass === 694) {
                // e.g. CNThitObjec
                if (objParams.getInt8(0x19) === 2) {
                    obj.yaw = angle16ToRads(objParams.getInt16(0x1c));
                }
            } else {
                console.log(`Don't know how to setup object class ${obj.objClass} objType ${obj.objType}`);
            }

            objectInstances.push({
                name: obj.name,
                obj: obj,
                pos: fields.pos,
                radius: fields.radius,
                model: obj.models[0],
            });

            console.log(`Object #${i}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);

            offs += fields.entrySize * 4;
            i++;
        }

        window.main.lookupObject = (objType: number, skipObjindex: boolean = false) => async function() {
            const obj = await objectMan.loadObject(device, materialFactory, objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);
        };

        window.main.lookupEarlyObject = (objType: number, skipObjindex: boolean = false) => async function() {
            const obj = await earlyObjectMan.loadObject(device, materialFactory, objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);
        };

        const envfx = envfxMan.loadEnvfx(device, 60);
        console.log(`Envfx ${envfx.index}: ${JSON.stringify(envfx, null, '\t')}`);

        const testModels = [];
        console.log(`Loading Fox....`);
        testModels.push(await testLoadingAModel(device, animController, dataFetcher, this.gameInfo, this.subdir, 1)); // Fox
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

        const anim = animLoader.getAnim(1);

        const enableMap = true;
        const enableObjects = true;
        const renderer = new WorldRenderer(device, animController, materialFactory, envfxMan, enableMap ? mapInstance : null, enableObjects ? objectInstances : [], testModels, anim);
        return renderer;
    }
}