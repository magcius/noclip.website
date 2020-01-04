
import * as Viewer from '../viewer';
import * as JPA from '../Common/JSYSTEM/JPA';

import { mat4, vec3 } from "gl-matrix";
import { hexzero } from '../util';
import { J3DModelInstanceSimple, J3DModelData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { ANK1, TTK1, TRK1, TPT1, LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import AnimationController from "../AnimationController";
import { ZWWExtraTextures, WindWakerRenderer, WindWakerRoomRenderer, WindWakerPass, dGlobals } from "./zww_scenes";
import { AABB } from '../Geometry';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { computeModelMatrixSRT } from '../MathHelpers';
import { ResType } from './d_resorce';
import { LightType, dKy_tevstr_c, settingTevStruct, setLightTevColorType, dKy_tevstr_init } from './d_kankyo';
import { spawnLegacyActor } from './LegacyActor';
import { fpc__ProcessName, fopAcM_create } from './framework';

export interface fopAcM_prm_class {
    parameters: number;
    pos: vec3;
    rot: vec3;
    enemyNo: number;
    scale: vec3;
    gbaName: number;
    parentPcId: number;
    subtype: number;
    roomNo: number;
    // NOTE(jstpierre): This isn't part of the original struct, it simply doesn't
    // load inactive layers...
    layer: number;
};

// TODO(jstpierre): Remove this.
export interface PlacedActor extends fopAcM_prm_class {
    // NOTE(jstpierre): This is normally passed separately.
    name: string;
    // TODO(jstpierre): Remove
    rotationY: number;
    roomRenderer: WindWakerRoomRenderer;
};

// Special-case actors

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();

export interface ObjectRenderer {
    prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
    setExtraTextures(v: ZWWExtraTextures): void;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    visible: boolean;
    layer: number;
}

const bboxScratch = new AABB();
const screenProjection = new ScreenSpaceProjection();
export class BMDObjectRenderer implements ObjectRenderer {
    public visible = true;
    public modelMatrix: mat4 = mat4.create();
    public lightTevColorType = LightType.Actor;
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
    
    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
        this.childObjects.forEach((child)=> child.setVertexColorsEnabled(v));
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
        this.childObjects.forEach((child)=> child.setTexturesEnabled(v));
    }

    public setExtraTextures(extraTextures: ZWWExtraTextures): void {
        extraTextures.fillExtraTextures(this.modelInstance);

        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].setExtraTextures(extraTextures);
    }

    public prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

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

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

function computeActorModelMatrix(m: mat4, actor: PlacedActor): void {
    computeModelMatrixSRT(m,
        actor.scale[0], actor.scale[1], actor.scale[2],
        0, actor.rotationY, 0,
        actor.pos[0], actor.pos[1], actor.pos[2]);
}

function setModelMatrix(actor: PlacedActor, m: mat4): void {
    computeActorModelMatrix(m, actor);
}

function buildModel(context: WindWakerRenderer, modelData: J3DModelData, actor: PlacedActor): BMDObjectRenderer {
    const modelInstance = new J3DModelInstanceSimple(modelData);
    modelInstance.passMask = WindWakerPass.MAIN;
    context.extraTextures.fillExtraTextures(modelInstance);
    modelInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
    const objectRenderer = new BMDObjectRenderer(modelInstance);
    dKy_tevstr_init(objectRenderer.tevstr, actor.roomNo);
    objectRenderer.layer = actor.layer;
    setModelMatrix(actor, objectRenderer.modelMatrix);
    actor.roomRenderer.objectRenderers.push(objectRenderer);
    return objectRenderer;
}

export function createEmitter(context: WindWakerRenderer, resourceId: number): JPA.JPABaseEmitter {
    const emitter = context.effectSystem!.createBaseEmitter(context.device, context.renderCache, resourceId);
    // TODO(jstpierre): Scale, Rotation
    return emitter;
}

// -------------------------------------------------------
// Generic Torch
// -------------------------------------------------------
class d_a_ep implements fopAc_ac_c_L2 {
    public static pname = fpc__ProcessName.d_a_ep;

    constructor(globals: dGlobals, actor: PlacedActor) {
        const ga = !!((actor.parameters >>> 6) & 0x01);
        const obm = !!((actor.parameters >>> 7) & 0x01);
        let type = (actor.parameters & 0x3F);
        if (type === 0x3F)
            type = 0;

        setModelMatrix(actor, scratchMat4a);
        vec3.set(scratchVec3a, 0, 0, 0);
        if (type === 0 || type === 3) {
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Ep`, obm ? 0x04 : 0x05);
            const m = buildModel(globals.renderer, res, actor);
            scratchVec3a[1] += 140;
        }
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMat4a);

        // Create particle systems.
        const pa = createEmitter(globals.renderer, 0x0001);
        vec3.copy(pa.globalTranslation, scratchVec3a);
        pa.globalTranslation[1] += -240 + 235 + 15;
        if (type !== 2) {
            const pb = createEmitter(globals.renderer, 0x4004);
            vec3.copy(pb.globalTranslation, pa.globalTranslation);
            pb.globalTranslation[1] += 20;
        }
        const pc = createEmitter(globals.renderer, 0x01EA);
        vec3.copy(pc.globalTranslation, scratchVec3a);
        pc.globalTranslation[1] += -240 + 235 + 8;
        // TODO(jstpierre): ga
    }

    public static requestArchives(globals: dGlobals, actor: fopAcM_prm_class): void {
        globals.modelCache.fetchObjectData(`Ep`);
    }
}

class d_a_tbox implements fopAc_ac_c_L2 {
    public static pname = fpc__ProcessName.d_a_tbox;

    constructor(globals: dGlobals, actor: PlacedActor) {
        const type = (actor.parameters >>> 20) & 0x0F;
        if (type === 0) {
            // Light Wood
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x0E);
            const m = buildModel(globals.renderer, res, actor);
        } else if (type === 1) {
            // Dark Wood
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x0F);
            const m = buildModel(globals.renderer, res, actor);
        } else if (type === 2) {
            // Metal
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x10);
            const m = buildModel(globals.renderer, res, actor);
            const b = globals.resCtrl.getObjectRes(ResType.Brk, `Dalways`, 0x1D);
            b.loopMode = LoopMode.ONCE;
            m.bindTRK1(b);
        } else if (type === 3) {
            // Big Key
            const res = globals.resCtrl.getObjectRes(ResType.Model, `Dalways`, 0x14);
            const m = buildModel(globals.renderer, res, actor);
        } else {
            // Might be something else, not sure.
            console.warn(`Unknown chest type: ${actor.name} / ${actor.roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameters, 8)}`);
        }
    }

    public static requestArchives(globals: dGlobals, actor: fopAcM_prm_class): void {
        globals.modelCache.fetchObjectData(`Dalways`);
    }
}

// -------------------------------------------------------
// Grass/Flowers/Trees managed by their respective packets
// -------------------------------------------------------

// The REL table maps .rel names to our implementations
// @NOTE: Let's just keep this down here for now, for navigability
interface fopAc_ac_c_L2 {
}

interface fpc_pc__Profile {
    pname: fpc__ProcessName;
    new(globals: dGlobals, actor: PlacedActor): fopAc_ac_c_L2;
    requestArchives?(globals: dGlobals, actor: fopAcM_prm_class): void;
}

const g_fpcPf_ProfileList_p: fpc_pc__Profile[] = [
    d_a_ep,
    d_a_tbox,
];

function fpcPf_Get__Constructor(globals: dGlobals, pcName: number): fpc_pc__Profile | null {
    const pf = g_fpcPf_ProfileList_p.find((pf) => pf.pname === pcName);
    if (pf !== undefined)
        return pf;
    else
        return null;
}

export function requestArchiveForActor(globals: dGlobals, processName: string, actor: fopAcM_prm_class): void {
    const objName = globals.dStage_searchName(processName);

    const pf = fpcPf_Get__Constructor(globals, objName.pcName);
    if (pf !== null && pf.requestArchives !== undefined)
        pf.requestArchives(globals, actor);
}

export async function loadActor(globals: dGlobals, roomRenderer: WindWakerRoomRenderer, processName: string, actor: PlacedActor): Promise<void> {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(processName);

    // New-style system.
    if (fopAcM_create(globals.frameworkGlobals, objName.pcName, actor.parameters, actor.pos, actor.roomNo, actor.rot, actor.scale, actor.subtype, actor.parentPcId))
        return;

    // Legacy system 1.
    // TODO(jstpierre): Remove this guy first.
    const pf = fpcPf_Get__Constructor(globals, objName.pcName);
    if (pf !== null) {
        const actorObj = new pf(globals, actor);
        return;
    }

    // Legacy system 2.
    const loaded = spawnLegacyActor(globals.renderer, roomRenderer, actor);
    if (loaded) {
        // Warn about legacy actors?
        // console.warn(`Legacy actor: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.arg, 8)}`);
    } else {
        const dbgName = globals.objNameGetDbgName(objName);
        // console.warn(`Unknown obj: ${actor.name} / ${dbgName} / ${roomRenderer.name} Layer ${actor.layer}`);
    }
}
