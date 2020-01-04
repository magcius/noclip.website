
import * as Viewer from '../viewer';

import { mat4, vec3 } from "gl-matrix";
import { J3DModelInstanceSimple } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { ANK1, TTK1, TRK1, TPT1 } from "../Common/JSYSTEM/J3D/J3DLoader";
import AnimationController from "../AnimationController";
import { ZWWExtraTextures, WindWakerRoomRenderer, dGlobals } from "./zww_scenes";
import { AABB } from '../Geometry';
import { ScreenSpaceProjection, computeScreenSpaceProjectionFromWorldSpaceAABB } from '../Camera';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { LightType, dKy_tevstr_c, settingTevStruct, setLightTevColorType } from './d_kankyo';
import { spawnLegacyActor } from './LegacyActor';
import { fopAcM_create, fpcLy_SetCurrentLayer } from './framework';

export interface fopAcM_prm_class {
    parameters: number;
    pos: vec3 | null;
    rot: vec3 | null;
    enemyNo: number;
    scale: vec3 | null;
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

export interface ObjectRenderer {
    prepareToRender(globals: dGlobals, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void;
    destroy(device: GfxDevice): void;
    setExtraTextures(v: ZWWExtraTextures): void;
    visible: boolean;
    layer: number;
}

const scratchVec3a = vec3.create();

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

    public setExtraTextures(extraTextures: ZWWExtraTextures): void {
        extraTextures.fillExtraTextures(this.modelInstance);

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

        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].prepareToRender(globals, device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.childObjects.length; i++)
            this.childObjects[i].destroy(device);
    }
}

export async function loadActor(globals: dGlobals, roomRenderer: WindWakerRoomRenderer, processName: string, actor: PlacedActor): Promise<void> {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(processName);

    // New-style system.

    // This is supposed to be executing in the context of the stage, I believe.
    fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);
    if (fopAcM_create(globals.frameworkGlobals, objName.pcName, actor.parameters, actor.pos, actor.roomNo, actor.rot, actor.scale, actor.subtype, actor.parentPcId))
        return;

    // Legacy actor system.
    actor.name = processName;
    const loaded = spawnLegacyActor(globals.renderer, roomRenderer, actor);
    if (loaded) {
        // Warn about legacy actors?
        // console.warn(`Legacy actor: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.arg, 8)}`);
    } else {
        const dbgName = globals.objNameGetDbgName(objName);
        // console.warn(`Unknown obj: ${actor.name} / ${dbgName} / ${roomRenderer.name} Layer ${actor.layer}`);
    }
}
