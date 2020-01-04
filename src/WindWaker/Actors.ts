
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

export interface fopAcM_prm_class {
    parameter: number;
    pos: vec3;
    rot: vec3;
    enemyNo: number;
    scale: vec3;
    gbaName: number;
    parentPcId: number;
    subtype: number;
    roomNo: number;

    // NOTE(jstpierre): This is normally passed separately.
    name: string;
    // NOTE(jstpierre): This isn't part of the original struct, it simply doesn't
    // load inactive layers...
    layer: number;
    // TODO(jstpierre): Remove
    rotationY: number;
};

// TODO(jstpierre): Remove this.
export interface PlacedActor extends fopAcM_prm_class {
    roomRenderer: WindWakerRoomRenderer;
};

// Special-case actors

const scratchMat4a = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

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

function computeActorModelMatrix(m: mat4, actor: fopAcM_prm_class): void {
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

export const enum ObjPName {
    d_a_grass = 0x01B8,
    d_a_ep    = 0x00BA,
    d_a_tbox  = 0x0126,
};

// -------------------------------------------------------
// Generic Torch
// -------------------------------------------------------
class d_a_ep implements fopAc_ac_c {
    public static pname = ObjPName.d_a_ep;

    constructor(globals: dGlobals, actor: PlacedActor) {
        const ga = !!((actor.parameter >>> 6) & 0x01);
        const obm = !!((actor.parameter >>> 7) & 0x01);
        let type = (actor.parameter & 0x3F);
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

class d_a_tbox implements fopAc_ac_c {
    public static pname = ObjPName.d_a_tbox;

    constructor(globals: dGlobals, actor: PlacedActor) {
        const type = (actor.parameter >>> 20) & 0x0F;
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
            console.warn(`Unknown chest type: ${actor.name} / ${actor.roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.parameter, 8)}`);
        }
    }

    public static requestArchives(globals: dGlobals, actor: fopAcM_prm_class): void {
        globals.modelCache.fetchObjectData(`Dalways`);
    }
}

// -------------------------------------------------------
// Grass/Flowers/Trees managed by their respective packets
// -------------------------------------------------------
class d_a_grass implements fopAc_ac_c {
    public static pname = ObjPName.d_a_grass;

    static kSpawnPatterns = [
        { group: 0, count: 1 },
        { group: 0, count: 7 },
        { group: 1, count: 15 },
        { group: 2, count: 3 },
        { group: 3, count: 7 },
        { group: 4, count: 11 },
        { group: 5, count: 7 },
        { group: 6, count: 5 },
    ];
    
    static kSpawnOffsets = [
        [
            [0, 0, 0],
            [3, 0, -50],
            [-2, 0, 50],
            [50, 0, 27],
            [52, 0, -25],
            [-50, 0, 22],
            [-50, 0, -29],
        ],
        [
            [-18, 0, 76],
            [-15, 0, 26],
            [133, 0, 0],
            [80, 0, 23],
            [86, 0, -83],
            [33, 0, -56],
            [83, 0, -27],
            [-120, 0, -26],
            [-18, 0, -65],
            [-20, 0, -21],
            [-73, 0, 1],
            [-67, 0, -102],
            [-21, 0, 126],
            [-120, 0, -78],
            [-70, 0, -49],
            [32, 0, 103],
            [34, 0, 51],
            [-72, 0, 98],
            [-68, 0, 47],
            [33, 0, -5],
            [135, 0, -53],
        ],
        [
            [-75, 0, -50],
            [75, 0, -25],
            [14, 0, 106],
        ],
        [
            [-24, 0, -28],
            [27, 0, -28],
            [-21, 0, 33],
            [-18, 0, -34],
            [44, 0, -4],
            [41, 0, 10],
            [24, 0, 39],
        ],
        [
            [-55, 0, -22],
            [-28, 0, -50],
            [-77, 0, 11],
            [55, 0, -44],
            [83, 0, -71],
            [11, 0, -48],
            [97, 0, -34],
            [-74, 0, -57],
            [31, 0, 58],
            [59, 0, 30],
            [13, 0, 23],
            [-12, 0, 54],
            [55, 0, 97],
            [10, 0, 92],
            [33, 0, -10],
            [-99, 0, -27],
            [40, 0, -87],
        ],
        [
            [0, 0, 3],
            [-26, 0, -29],
            [7, 0, -25],
            [31, 0, -5],
            [-7, 0, 40],
            [-35, 0, 15],
            [23, 0, 32],
        ],
        [
            [-40, 0, 0],
            [0, 0, 0],
            [80, 0, 0],
            [-80, 0, 0],
            [40, 0, 0],
        ]
    ];

    constructor(globals: dGlobals, actor: fopAcM_prm_class) {
        const enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (actor.parameter & 0x00F) >> 0;
        const type: FoliageType = (actor.parameter & 0x030) >> 4;
        const itemIdx = (actor.parameter >> 6) & 0x3f; // Determines which item spawns when this is cut down

        const pattern = d_a_grass.kSpawnPatterns[spawnPatternId];
        const offsets = d_a_grass.kSpawnOffsets[pattern.group];
        const count = pattern.count;

        const context = globals.renderer;

        switch (type) {
            case FoliageType.Grass:
                for (let j = 0; j < count; j++) {
                    // @NOTE: Grass does not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos);
                    context.grassPacket.newData(pos, actor.roomNo, itemIdx);
                }
            break;

            case FoliageType.Tree:
                const rotation = mat4.fromYRotation(scratchMat4a, actor.rotationY);

                for (let j = 0; j < count; j++) {
                    const offset = vec3.transformMat4(scratchVec3a, offsets[j], rotation);
                    const pos = vec3.add(scratchVec3b, offset, actor.pos);
                    context.treePacket.newData(pos, 0, actor.roomNo);
                }
            break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                for (let j = 0; j < count; j++) {
                    const isPink = (type === FoliageType.PinkFlower);

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos);
                    context.flowerPacket.newData(pos, isPink, actor.roomNo, itemIdx);
                }
            break;
            default:
                console.warn('Unknown grass actor type');
        }

        return this;
    }
}

// The REL table maps .rel names to our implementations
// @NOTE: Let's just keep this down here for now, for navigability
interface fopAc_ac_c {
    // @TODO: Most actors have draw and update functions
}

interface fpc_pc__Profile {
    pname: ObjPName;

    new(globals: dGlobals, actor: PlacedActor): fopAc_ac_c;
    requestArchives?(globals: dGlobals, actor: fopAcM_prm_class): void;
}

const g_fpcPf_ProfileList_p: fpc_pc__Profile[] = [
    d_a_ep,
    d_a_tbox,
    d_a_grass,
];

function fpcPf_Get(pname: number): fpc_pc__Profile | null {
    const pf = g_fpcPf_ProfileList_p.find((pf) => pf.pname === pname);
    if (pf !== undefined)
        return pf;
    else
        return null;
}

export function requestArchiveForActor(globals: dGlobals, actor: fopAcM_prm_class): void {
    const objName = globals.dStage_searchName(actor.name);

    const pf = fpcPf_Get(objName.pname);
    if (pf !== null && pf.requestArchives !== undefined)
        pf.requestArchives(globals, actor);
}

export async function loadActor(globals: dGlobals, roomRenderer: WindWakerRoomRenderer, actor: PlacedActor): Promise<void> {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(actor.name);

    const pf = fpcPf_Get(objName.pname);
    if (pf !== null) {
        const actorObj = new pf(globals, actor);
    } else {
        const loaded = spawnLegacyActor(globals.renderer, roomRenderer, actor);
        if (loaded) {
            // Warn about legacy actors?
            // console.warn(`Legacy actor: ${actor.name} / ${roomRenderer.name} Layer ${actor.layer} / ${hexzero(actor.arg, 8)}`);
        } else {
            const dbgName = globals.objNameGetDbgName(objName);
            // console.warn(`Unknown obj: ${actor.name} / ${dbgName} / ${roomRenderer.name} Layer ${actor.layer}`);
        }
    }
}
