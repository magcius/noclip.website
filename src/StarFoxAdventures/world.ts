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
import ArrayBufferSlice from '../ArrayBufferSlice';

import { SFA_GAME_INFO, SFADEMO_GAME_INFO, GameInfo } from './scenes';
import { loadRes } from './resource';
import { ObjectManager } from './objects';
import { EnvfxManager } from './envfx';
import { SFATextureCollection } from './textures';
import { SFARenderer } from './render';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { MapInstance, loadMap } from './maps';
import { Model } from './models';
import { hexdump } from '../util';
import { HitSensor } from '../SuperMarioGalaxy/HitSensor';

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
}

function vecPitch(v: vec3): number {
    return Math.atan2(v[1], Math.hypot(v[2], v[0]));
}

interface ObjectSphere {
    name: string;
    pos: vec3;
    radius: number;
}

function createDownloadLink(data: ArrayBufferSlice, filename: string, text?: string): HTMLElement {
    const aEl = document.createElement('a')
    aEl.href = URL.createObjectURL(new Blob([data.createDataView()], {type: 'application/octet-stream'}))
    aEl.download = filename
    if (text !== undefined) {
        aEl.append(text)
    }
    return aEl
}

async function testLoadingAModel(device: GfxDevice, dataFetcher: DataFetcher, gameInfo: GameInfo) {
    const pathBase = gameInfo.pathBase;
    const texColl = new SFATextureCollection(gameInfo);
    const [modelsTabData, modelsBin, _] = await Promise.all([
        dataFetcher.fetchData(`${pathBase}/swaphol/MODELS.tab`),
        dataFetcher.fetchData(`${pathBase}/swaphol/MODELS.bin`),
        texColl.create(dataFetcher, 'swaphol'),
    ]);
    const modelsTab = modelsTabData.createDataView();

    const MODEL_NUM = 0x4 / 4

    const modelTabValue = modelsTab.getUint32(MODEL_NUM * 4);
    if (modelTabValue === 0) {
        throw Error(`Model #${MODEL_NUM} not found`);
    }

    const modelOffs = modelTabValue & 0xffffff;
    const modelData = loadRes(modelsBin.subarray(modelOffs + 0x24));
    hexdump(modelData);
    
    window.main.downloadModel = () => {
        const aEl = createDownloadLink(modelData, 'model.bin');
        aEl.click();
    };
    
    return new Model(device, modelData, texColl);
}

class WorldRenderer extends SFARenderer {
    private ddraw = new TDDraw();
    private objddraw = new TDDraw();
    private materialHelperSky: GXMaterialHelperGfx;
    private materialHelperObjectSphere: GXMaterialHelperGfx;

    constructor(device: GfxDevice, private envfxMan: EnvfxManager, private mapInstance: MapInstance, private objectSpheres: ObjectSphere[], private aModel: Model) {
        super(device);

        packetParams.clear();

        const atmos = this.envfxMan.atmosphere;
        for (let i = 0; i < 8; i++) {
            const tex = atmos.textures[i]!;
            materialParams.m_TextureMapping[i].gfxTexture = tex.gfxTexture;
            materialParams.m_TextureMapping[i].gfxSampler = tex.gfxSampler;
            materialParams.m_TextureMapping[i].width = tex.width;
            materialParams.m_TextureMapping[i].height = tex.height;
            materialParams.m_TextureMapping[i].lodBias = 0.0;
            mat4.identity(materialParams.u_TexMtx[i]);
        }

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

        this.objddraw.setVtxDesc(GX.Attr.POS, true);
        this.objddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.objddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.objddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevDirect(0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelperObjectSphere = new GXMaterialHelperGfx(mb.finish('objectsphere'));
    }

    protected renderSky(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        // Prolog
        const skyTemplate = this.renderHelper.pushTemplateRenderInst();
        const oldProjection = mat4.create();
        mat4.copy(oldProjection, viewerInput.camera.projectionMatrix);
        mat4.identity(viewerInput.camera.projectionMatrix);
        fillSceneParamsDataOnTemplate(skyTemplate, viewerInput, false);

        // Body
        const atmos = this.envfxMan.atmosphere;
        const atmosTexture = atmos.textures[0]!;

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
        
        // Epilog
        renderInstManager.popTemplateRenderInst();

        mat4.copy(viewerInput.camera.projectionMatrix, oldProjection);

        let hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        
        renderInstManager.drawOnPassRenderer(device, this.renderPass);
        renderInstManager.resetRenderInsts();
        device.submitPass(this.renderPass);
    }

    private renderTestModel(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        let modeltemplate = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(modeltemplate, viewerInput, false);
        this.aModel.prepareToRender(device, renderInstManager, viewerInput, mat4.create(), this.sceneTexture, 0);
        renderInstManager.popTemplateRenderInst();

        // Draw bones
        const ctx = getDebugOverlayCanvas2D();
        for (let i = 1; i < this.aModel.joints.length; i++) {
            const joint = this.aModel.joints[i];
            const jointMtx = this.aModel.boneMatrices[i];
            const jointPt = vec3.create();
            mat4.getTranslation(jointPt, jointMtx);
            if (joint.parent != 0xff) {
                const parentMtx = this.aModel.boneMatrices[joint.parent];
                const parentPt = vec3.create();
                mat4.getTranslation(parentPt, parentMtx);
                drawWorldSpaceLine(ctx, viewerInput.camera, parentPt, jointPt);
            } else {
                drawWorldSpacePoint(ctx, viewerInput.camera, jointPt);
            }
            // const weight = this.aModel.weights[i];
            // drawWorldSpacePoint(ctx, viewerInput.camera, joint.translation);
            // drawWorldSpaceLine(ctx, viewerInput.camera, this.aModel.joints[weight.joint0].translation, this.aModel.joints[weight.joint1].translation);
        }
    }

    protected renderWorld(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        // Prolog
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput, false);

        // Body
        this.mapInstance.prepareToRender(device, renderInstManager, viewerInput, this.sceneTexture, 0);
        this.copyToSceneTexture(device);
        // for (let i = 0; i < this.mapInstance.getNumDrawSteps(); i++) {
        //     this.mapInstance.prepareToRender(device, renderInstManager, viewerInput, i, this.sceneTexture);
        //     this.copyToSceneTexture(device);
        // }

        const ctx = getDebugOverlayCanvas2D();

        let objtemplate = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(objtemplate, viewerInput, false);
        this.objddraw.beginDraw();
        for (let i = 0; i < this.objectSpheres.length; i++) {
            const obj = this.objectSpheres[i];

            // TODO: draw sphere
            // XXX: radius is too big to be workable. Or sometimes it's 0. Set it to a default.
            obj.radius = 8;

            drawWorldSpaceText(ctx, viewerInput.camera, obj.pos, obj.name, undefined, undefined,
                {font: '8pt sans-serif', outline: 2.0});
            
            this.objddraw.begin(GX.Command.DRAW_QUADS);
            this.objddraw.position3f32(obj.pos[0] - obj.radius, obj.pos[1] - obj.radius, obj.pos[2] - obj.radius);
            this.objddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);
            this.objddraw.position3f32(obj.pos[0] - obj.radius, obj.pos[1] + obj.radius, obj.pos[2] - obj.radius);
            this.objddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
            this.objddraw.position3f32(obj.pos[0] + obj.radius, obj.pos[1] + obj.radius, obj.pos[2] - obj.radius);
            this.objddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);
            this.objddraw.position3f32(obj.pos[0] + obj.radius, obj.pos[1] - obj.radius, obj.pos[2] - obj.radius);
            this.objddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);
            this.objddraw.end();
        }
        const renderInst = this.objddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelperObjectSphere, renderInst, viewerInput);
        this.objddraw.endAndUpload(device, renderInstManager);
        renderInstManager.popTemplateRenderInst();
        
        this.renderTestModel(device, renderInstManager, viewerInput);
        
        // Epilog
        renderInstManager.popTemplateRenderInst();

        let hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);
        
        renderInstManager.drawOnPassRenderer(device, this.renderPass);
        renderInstManager.resetRenderInsts();
        device.submitPass(this.renderPass);
    }
}

export class SFAWorldSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for world ${this.name} (ID ${this.id}) ...`);

        const mapSceneInfo = await loadMap(device, context, 7, this.gameInfo);
        const mapInstance = new MapInstance(mapSceneInfo);
        await mapInstance.reloadBlocks();

        // Translate map for SFA world coordinates
        const mapMatrix = mat4.create();
        mat4.fromTranslation(mapMatrix, vec3.fromValues(0, 0, -640));
        mapInstance.setMatrix(mapMatrix);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const texColl = new SFATextureCollection(this.gameInfo);
        await texColl.create(dataFetcher, 'swaphol'); // TODO: subdirectory depends on map
        const objectMan = new ObjectManager(this.gameInfo, false);
        const earlyObjectMan = new ObjectManager(SFADEMO_GAME_INFO, true);
        const envfxMan = new EnvfxManager(this.gameInfo, texColl);
        const [_1, _2, _3, romlistFile] = await Promise.all([
            objectMan.create(dataFetcher),
            earlyObjectMan.create(dataFetcher),
            envfxMan.create(dataFetcher),
            dataFetcher.fetchData(`${pathBase}/${this.id}.romlist.zlb`),
        ]);
        const romlist = loadRes(romlistFile).createDataView();

        const objectSpheres: ObjectSphere[] = [];
        let offs = 0;
        let i = 0;
        while (offs < romlist.byteLength) {
            const fields = {
                objType: romlist.getUint16(offs + 0x0),
                entrySize: romlist.getUint8(offs + 0x2),
                radius: 8 * romlist.getUint8(offs + 0x6),
                x: romlist.getFloat32(offs + 0x8),
                y: romlist.getFloat32(offs + 0xc),
                z: romlist.getFloat32(offs + 0x10),
            };

            const obj = objectMan.loadObject(fields.objType);

            objectSpheres.push({
                name: obj.name,
                pos: vec3.fromValues(fields.x, fields.y, fields.z),
                radius: fields.radius
            });

            console.log(`Object #${i}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);

            offs += fields.entrySize * 4;
            i++;
        }

        window.main.lookupObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = objectMan.loadObject(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);
        };

        window.main.lookupEarlyObject = (objType: number, skipObjindex: boolean = false) => {
            const obj = earlyObjectMan.loadObject(objType, skipObjindex);
            console.log(`Object ${objType}: ${obj.name} (type ${obj.objType} class ${obj.objClass})`);
        };

        const envfx = envfxMan.loadEnvfx(device, 60);
        console.log(`Envfx ${envfx.index}: ${JSON.stringify(envfx, null, '\t')}`);

        const aModel = await testLoadingAModel(device, dataFetcher, this.gameInfo);

        const renderer = new WorldRenderer(device, envfxMan, mapInstance, objectSpheres, aModel);
        return renderer;
    }
}