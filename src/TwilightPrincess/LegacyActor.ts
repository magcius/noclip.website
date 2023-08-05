
import * as Viewer from '../viewer.js';
import * as RARC from '../Common/JSYSTEM/JKRArchive.js';

import { TwilightPrincessRenderer, ZTPExtraTextures, dGlobals } from "./ztp_scenes.js";
import { mat4, vec3 } from "gl-matrix";
import { J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase.js';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple.js';
import { GfxRendererLayer } from '../gfx/render/GfxRenderInstManager.js';
import { LoopMode, ANK1, TTK1, TRK1, TPT1 } from '../Common/JSYSTEM/J3D/J3DLoader.js';
import { assertExists, hexzero, leftPad } from '../util.js';
import { ResType, ResEntry, ResAssetType } from './d_resorce.js';
import AnimationController from '../AnimationController.js';
import { AABB } from '../Geometry.js';
import { computeModelMatrixSRT, scaleMatrix } from '../MathHelpers.js';
import { LightType, dKy_tevstr_init, dKy_tevstr_c, settingTevStruct, setLightTevColorType } from './d_kankyo.js';
import { JPABaseEmitter } from '../Common/JSYSTEM/JPA.js';
import { fpc__ProcessName, fopAcM_prm_class, fopAc_ac_c, cPhs__Status, fGlobals, fpcPf__RegisterFallback } from './framework.js';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera.js';
import { GfxCullMode, GfxDevice } from '../gfx/platform/GfxPlatform.js';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager.js';
import { cBgS_GndChk } from './d_bg.js';

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();

function animFrame(frame: number): AnimationController {
    const a = new AnimationController();
    a.setTimeInFrames(frame);
    return a;
}

function computeActorModelMatrix(m: mat4, actor: fopAcM_prm_class): void {
    const rotationY = actor.rot![1] / 0x7FFF * Math.PI;
    computeModelMatrixSRT(m,
        actor.scale![0], actor.scale![1], actor.scale![2],
        0, rotationY, 0,
        actor.pos![0], actor.pos![1], actor.pos![2]);
}

const chk = new cBgS_GndChk();

// "Legacy actor" for noclip
class d_a_noclip_legacy extends fopAc_ac_c {
    private phase = cPhs__Status.Started;
    public objectRenderers: BMDObjectRenderer[] = [];

    public override subload(globals: dGlobals, prm: fopAcM_prm_class): cPhs__Status {
        if (this.phase === cPhs__Status.Started) {
            this.phase = cPhs__Status.Loading;

            spawnLegacyActor(globals, this, prm).then(() => {
                this.phase = cPhs__Status.Next;
            });
        }

        return this.phase;
    }

    public override draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const device = globals.modelCache.device;

        renderInstManager.setCurrentRenderInstList(globals.dlst.main[0]);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public override delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

function spawnLegacyActor(globals: dGlobals, legacy: d_a_noclip_legacy, actor: fopAcM_prm_class): Promise<void> {
    const modelCache = globals.modelCache;
    const renderer = globals.renderer;
    const resCtrl = modelCache.resCtrl;

    const actorName = globals.dStage__searchNameRev(legacy.processName, legacy.subtype);
    if (actorName === null) {
        throw new Error('wtf! could not find actor name');
    }

    const promises: Promise<any>[] = [];

    function fetchArchive(objArcName: string): Promise<RARC.JKRArchive> {
        const p = modelCache.fetchObjectData(objArcName);
        promises.push(p);
        return p;
    }

    function fetchStageArchive(): Promise<RARC.JKRArchive> {
        const p = modelCache.fetchStageData(`STG_00`);
        promises.push(p);
        return p;
    }

    function getResData<T extends ResType>(resType: T, archive: RARC.JKRArchive, modelPath: string) {

        // console.log(`getResData:: isStage = ${archive.root.name === "stg_00"}, ${archive.root.name}`);

        if (archive.root.name === "stg_00") {
            const resInfo = assertExists(resCtrl.findResInfoByArchive(archive, resCtrl.resStg));
            const resEntry = assertExists(resInfo.res.find((g) => modelPath.endsWith(g.file.name))) as ResEntry<ResAssetType<T>>;
            return resEntry.res;
        } else {
            const resInfo = assertExists(resCtrl.findResInfoByArchive(archive, resCtrl.resObj));
            const resEntry = assertExists(resInfo.res.find((g) => modelPath.endsWith(g.file.name))) as ResEntry<ResAssetType<T>>;
            return resEntry.res;
        }
    }

    function buildChildModelRes(model: J3DModelData): BMDObjectRenderer {
        const modelInstance = new J3DModelInstanceSimple(model);
       //  renderer.extraTextures.fillExtraTextures(modelInstance);
        modelInstance.name = actorName!;
        modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        const objectRenderer = new BMDObjectRenderer(modelInstance);
        dKy_tevstr_init(objectRenderer.tevstr, actor.roomNo);
        objectRenderer.layer = actor.layer;
        return objectRenderer;
    }

    function buildChildModel(rarc: RARC.JKRArchive, modelPath: string): BMDObjectRenderer {
        const model = getResData(ResType.Model, rarc, modelPath);
        return buildChildModelRes(model);
    }

    function setModelMatrix(m: mat4): void {
        computeActorModelMatrix(m, actor);
    }

    function buildModel(rarc: RARC.JKRArchive, modelPath: string): BMDObjectRenderer {
        const objectRenderer = buildChildModel(rarc, modelPath);
        setModelMatrix(objectRenderer.modelMatrix);
        legacy.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelRes(modelData: J3DModelData): BMDObjectRenderer {
        const objectRenderer = buildChildModelRes(modelData);
        setModelMatrix(objectRenderer.modelMatrix);
        legacy.objectRenderers.push(objectRenderer);
        return objectRenderer;
    }

    function buildModelBMT(rarc: RARC.JKRArchive, modelPath: string, bmtPath: string): BMDObjectRenderer {
        const objectRenderer = buildModel(rarc, modelPath);
        objectRenderer.modelInstance.setModelMaterialData(getResData(ResType.Bmt, rarc, bmtPath));
       //  renderer.extraTextures.fillExtraTextures(objectRenderer.modelInstance);
        return objectRenderer;
    }

    function setToNearestFloor(dstMatrix: mat4, localModelMatrix: mat4): void {
        chk.Reset();
        mat4.getTranslation(chk.pos, localModelMatrix);
        chk.pos[1] += 10.0;
        const y = globals.scnPlay.bgS.GroundCross(chk);
        // if (y === -Infinity)
        //     debugger;
        dstMatrix[13] = y;
    }

    function parseBCK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        const g = resInfo.lazyLoadResource(ResType.Bck, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
        g.loopMode = LoopMode.REPEAT;
        return g;
    }

    function parseBRK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Brk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTK(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btk, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function parseBTP(rarc: RARC.JKRArchive, path: string) {
        const resInfo = assertExists(resCtrl.findResInfoByArchive(rarc, resCtrl.resObj));
        return resInfo.lazyLoadResource(ResType.Btp, assertExists(resInfo.res.find((res) => path.endsWith(res.file.name))));
    }

    function createEmitter(context: TwilightPrincessRenderer, resourceId: number): JPABaseEmitter {
        return globals.particleCtrl.set(globals, 0, resourceId, null)!;
    }

    const objName = assertExists(globals.dStage_searchName(actorName));
    const pcName = objName.pcName;

    // console.log(`spawnLegacyActor: ${actorName}`)

    if (actorName === 'item') {
        // Item table provided with the help of the incredible LagoLunatic <3.
        const itemId = (actor.parameters & 0x000000FF);

        // Heart
        //if (itemId === 0x00) fetchArchive(`Always`).then((rarc) => buildModel(rarc, `bdl/vhrtl.bdl`));
        // Rupee (Green)
        /* else  */if (itemId === 0x01) fetchArchive(`F_gD_rupy`).then((rarc) => {
            const m = buildModel(rarc, `bmde/f_gd_rupy.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/f_gd_rupy.brk`), animFrame(0));
            m.lightTevColorType = LightType.UNK_0;
        });
        // Rupee (Blue)
        else if (itemId === 0x02) fetchArchive(`F_gD_rupy`).then((rarc) => {
            const m = buildModel(rarc, `bmde/f_gd_rupy.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/f_gd_rupy.brk`), animFrame(0));
            m.lightTevColorType = LightType.UNK_0;
        });
        // Rupee (Yellow)
        else if (itemId === 0x03) fetchArchive(`F_gD_rupy`).then((rarc) => {
            const m = buildModel(rarc, `bmde/f_gd_rupy.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/f_gd_rupy.brk`), animFrame(0));
            m.lightTevColorType = LightType.UNK_0;
        });
        // Rupee (Red)
        else if (itemId === 0x04) fetchArchive(`F_gD_rupy`).then((rarc) => {
            const m = buildModel(rarc, `bmde/f_gd_rupy.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/f_gd_rupy.brk`), animFrame(0));
            m.lightTevColorType = LightType.UNK_0;
        });
        // Rupee (Purple)
        else if (itemId === 0x05) fetchArchive(`F_gD_rupy`).then((rarc) => {
            const m = buildModel(rarc, `bmde/f_gd_rupy.bmd`);
            m.bindTRK1(parseBRK(rarc, `brk/f_gd_rupy.brk`), animFrame(0));
            m.lightTevColorType = LightType.UNK_0;
        });
    }
    else if (actorName === 'kdoor') {
        const door_type = ((actor.parameters >> 5) & 7);
        const res_name = `door-knob_0${door_type}`;

        fetchStageArchive().then((rarc) => {
            const m = buildModel(rarc, `bmdp/${res_name}.bmd`);
            m.lightTevColorType = LightType.UNK_16;

            mat4.translate(m.modelMatrix, m.modelMatrix, [-75, 0, 0]);  // adjust door to frame
        });
    }
    else if (actorName === 'Obj_kn2') {
        const sign_type = (actor.parameters & 0x3FFFF);

        if (sign_type === 0x3FFFF) {
            fetchArchive(`Obj_kn2`).then((rarc) => {
                const m = buildModel(rarc, `bmdr/j_kanban00.bmd`);
                m.lightTevColorType = LightType.UNK_20;
            });
        }
    }
    /* else if (actorName === 'Obj_sui') fetchArchive(`Obj_sui`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_suisya.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    }); */
    else if (actorName === 'Obj_nmp') fetchArchive(`J_Hyosatu`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_hyousatu.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'Obj_Tie') fetchArchive(`J_Necktie`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_necktie.bmd`);
        m.bindTTK1(parseBTK(rarc, `btk/j_necktie.btk`));
        m.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'Pumpkin') fetchArchive(`pumpkin`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/pumpkin.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Pleaf') fetchArchive(`J_Hatake`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/j_hatake00.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'E_nest') fetchArchive(`E_nest`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/o_hachinosu_01.bmd`);
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Obj_knk') fetchArchive(`J_Kazami`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/arm.bmd`);
        m.lightTevColorType = LightType.UNK_16;

        const m2 = buildModel(rarc, `bmdr/pole.bmd`);
        m2.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'Obj_nd') fetchArchive(`Obj_ndoor`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/m_nekodoor.bmd`);
        m.lightTevColorType = LightType.UNK_16;
    });
    else if (actorName === 'stone') fetchArchive(`D_Srock`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/d_srock.bmd`);
        m.lightTevColorType = LightType.UNK_8;
    });
    else if (actorName === 'Horse') fetchArchive(`Horse`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/hs.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/hs_wait_01.bck`));
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Bou') fetchArchive(`Bou`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/bou.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/bou_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/bou.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/bou.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Uri') fetchArchive(`Uri`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/uri.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/uri_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/uri.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/uri.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Hanjo') fetchArchive(`Hanjo`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/hanjo.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/hanjo_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/hanjo.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/hanjo.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Jagar') fetchArchive(`Jagar`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/jagar.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/jagar_wait_a.bck`));
        m.bindTTK1(parseBTK(rarc, `btk/jaga.btk`));
        m.bindTPT1(parseBTP(rarc, `btp/jaga.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    else if (actorName === 'Npc_ks') fetchArchive(`Npc_ks`).then((rarc) => {
        const m = buildModel(rarc, `bmdr/saru.bmd`);
        m.bindANK1(parseBCK(rarc, `bck/saru_kago_jump.bck`));
        m.bindTPT1(parseBTP(rarc, `btp/saru.btp`), animFrame(0));
        m.lightTevColorType = LightType.UNK_0;
    });
    else {
        const dbgName = globals.objNameGetDbgName(objName);
        console.warn(`Unknown obj: ${actorName} / ${dbgName} / Room ${actor.roomNo} Layer ${actor.layer}`);
    }

    const p = Promise.all(promises);
    return p as unknown as Promise<void>;
}

// Special-case actors

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
export class BMDObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();
    public lightTevColorType = LightType.UNK_16;
    public layer: number;
    public tevstr = new dKy_tevstr_c();

    private childObjects: BMDObjectRenderer[] = [];
    private parentJointMatrix: mat4 | null = null;

    constructor(public modelInstance: J3DModelInstanceSimple) {
    }

    public bindANK1(ank1: ANK1, animationController?: AnimationController): void {
        this.modelInstance.bindANK1(ank1, animationController);
    }

    public bindTTK1(ttk1: TTK1, animationController?: AnimationController): void {
        this.modelInstance.bindTTK1(ttk1, animationController);
    }

    public bindTRK1(trk1: TRK1, animationController?: AnimationController): void {
        this.modelInstance.bindTRK1(trk1, animationController);
    }

    public bindTPT1(tpt1: TPT1, animationController?: AnimationController): void {
        this.modelInstance.bindTPT1(tpt1, animationController);
    }

    public setParentJoint(o: BMDObjectRenderer, jointName: string): void {
        this.parentJointMatrix = o.modelInstance.getJointToWorldMatrixReference(jointName);
        o.childObjects.push(this);
    }

    public setMaterialColorWriteEnabled(materialName: string, v: boolean): void {
        this.modelInstance.setMaterialColorWriteEnabled(materialName, v);
    }

    private setExtraTextures(extraTextures: ZTPExtraTextures): void {
        // extraTextures.fillExtraTextures(this.modelInstance);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setExtraTextures(extraTextures);
    }

    public prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (globals.renderHacks.renderHacksChanged) {
            this.modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
            this.modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
        }

        if (this.parentJointMatrix !== null) {
            mat4.mul(this.modelInstance.modelMatrix, this.parentJointMatrix, this.modelMatrix);
        } else {
            mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

            // Don't compute screen area culling on child meshes (don't want heads to disappear before bodies.)
            bboxScratch.transform(this.modelInstance.modelData.bbox, this.modelInstance.modelMatrix);
            computeScreenSpaceProjectionFromWorldSpaceAABB(screenProjection, viewerInput.camera, bboxScratch);

            if (screenProjection.getScreenArea() <= 0.0002)
                return;
        }

        mat4.getTranslation(scratchVec3a, this.modelMatrix);
        settingTevStruct(globals, this.lightTevColorType, scratchVec3a, this.tevstr);
        setLightTevColorType(globals, this.modelInstance, this.tevstr, viewerInput.camera);

        this.setExtraTextures(globals.renderer.extraTextures);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export function LegacyActor__RegisterFallbackConstructor(globals: fGlobals): void {
    fpcPf__RegisterFallback(globals, d_a_noclip_legacy);
}
