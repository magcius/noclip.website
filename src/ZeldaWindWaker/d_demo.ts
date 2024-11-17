import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TParse, JStage, TSystem, TControl, TCamera, TActor } from "../Common/JSYSTEM/JStudio.js";
import { getMatrixAxisY, MathConstants } from "../MathHelpers.js";
import { dGlobals } from "./Main";
import { fopAc_ac_c, fopAcM_searchFromName } from "./framework.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { mDoExt_McaMorf } from "./m_do_ext";
import { assert } from "../util.js";
import { ResType } from "./d_resorce.js";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { cM_deg2s, cM_sht2d } from "./SComponent.js";

export enum EDemoMode {
    None,
    Playing,
    Ended
}

export enum EDemoCamFlags {
    HasNearZ = 1 << 0,
    HasFarZ = 1 << 1,
    HasFovY = 1 << 2,
    HasAspect = 1 << 3,
    HasEyePos = 1 << 4,
    HasUpVec = 1 << 5,
    HasTargetPos = 1 << 6,
    HasRoll = 1 << 7,
}

class dDemo_camera_c extends TCamera {
    flags: number = 0;
    projNear: number = 0;
    projFar: number = 0;
    fovY: number = 0;
    aspect: number = 0;
    viewPosition: vec3 = vec3.create();
    upVector: vec3 = vec3.create();
    targetPosition: vec3 = vec3.create();
    roll: number = 0;

    constructor(
        private globals: dGlobals
    ) { super() }

    override JSGGetName() { return 'Cam'; }

    override JSGGetProjectionNear(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return camera.near;
    }

    override JSGSetProjectionNear(v: number) {
        this.projNear = v;
        this.flags |= EDemoCamFlags.HasNearZ;
    }

    override JSGGetProjectionFar(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 1.0;
        return camera.far;
    }


    override JSGSetProjectionFar(v: number): void {
        this.projFar = v;
        this.flags |= EDemoCamFlags.HasFarZ;
    }


    override JSGGetProjectionFovy(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 60.0;
        return camera.fovY;
    }


    override JSGSetProjectionFovy(v: number): void {
        this.fovY = v;
        this.flags |= EDemoCamFlags.HasFovY;
    }


    override JSGGetProjectionAspect() {
        const camera = this.globals.camera;
        if (!camera)
            return 1.3333;
        return camera.aspect;
    }


    override JSGSetProjectionAspect(v: number) {
        this.aspect = v;
        this.flags |= EDemoCamFlags.HasAspect;
    }


    override JSGGetViewPosition(dst: vec3) {
        vec3.copy(dst, this.globals.cameraPosition);
    }


    override JSGSetViewPosition(v: ReadonlyVec3) {
        vec3.copy(this.viewPosition, v);
        this.flags |= EDemoCamFlags.HasEyePos;
    }


    override JSGGetViewUpVector(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 1, 0);
        getMatrixAxisY(dst, camera.viewMatrix); // @TODO: Double check that this is correct
    }


    override JSGSetViewUpVector(v: ReadonlyVec3) {
        vec3.copy(this.upVector, v);
        this.flags |= EDemoCamFlags.HasUpVec;
    }


    override JSGGetViewTargetPosition(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 0, 0);
        vec3.add(dst, this.globals.cameraPosition, this.globals.cameraFwd);
    }


    override JSGSetViewTargetPosition(v: ReadonlyVec3) {
        vec3.copy(this.targetPosition, v);
        this.flags |= EDemoCamFlags.HasTargetPos;
    }


    override JSGGetViewRoll() {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return this.roll; // HACK: Instead of actually computing roll (complicated), just assume no one else is modifying it
    }


    override JSGSetViewRoll(v: number) {
        this.roll = v;
        this.flags |= EDemoCamFlags.HasRoll;
    }
}

export const enum EDemoActorFlags {
    HasData = 1 << 0,
    HasPos = 1 << 1,
    HasScale = 1 << 2,
    HasRot = 1 << 3,
    HasShape = 1 << 4,
    HasAnim = 1 << 5,
    HasFrame = 1 << 6,
    HasTexAnim = 1 << 7,
    HasTexFrame = 1 << 8,
} 

export class dDemo_actor_c extends TActor {
    name: string;
    flags: number;
    translation = vec3.create();
    scaling = vec3.create();
    rotation = vec3.create();
    shapeId: number;
    nextBckId: number;
    animFrame: number;
    animTransition: number;
    animFrameMax: number;
    texAnim: number;
    texAnimFrame: number;
    textAnimFrameMax: number;
    model: J3DModelInstance;
    stbDataId: number;
    stbData: DataView;
    bckId: number;
    btpId: number;
    btkId: number;
    brkId: number;

    constructor(public actor: fopAc_ac_c) { super(); }

    checkEnable(mask: number) {
        return this.flags & mask;
    }

    getMorfParam() {
        // Doesn't have anim properties
        if ((this.flags & 0x40) == 0) {
            // Has STB data
            if ((this.flags & 1) == 0) {
                return 0.0;
            } else {
                switch (this.stbDataId) {
                    // @TODO: Double check this, somehow
                    case 6: return this.stbData.getInt8(15);
                    case 5: return this.stbData.getInt8(11);
                    case 4: return this.stbData.getInt8(6);
                    case 2: return this.stbData.getInt8(7);
                    case 1: return this.stbData.getInt8(2);
                    default: return 0.0;
                }
            }
        } else {
            return this.animTransition;
        }
    }

    override JSGGetName() { return this.name; }

    override JSGGetNodeTransformation(nodeId: number, mtx: mat4): number {
        debugger; // I think this may be one of the shapeInstanceState matrices instead
        mat4.copy(mtx, this.model.modelMatrix);
        return 1;
    }

    override JSGGetAnimationFrameMax() { return this.animFrameMax; }
    override JSGGetTextureAnimationFrameMax() { return this.textAnimFrameMax; }

    override JSGGetTranslation(dst: vec3) { vec3.copy(dst, this.translation); }
    override JSGGetScaling(dst: vec3) { vec3.copy(dst, this.scaling); }
    override JSGGetRotation(dst: vec3) {
        dst[0] = cM_sht2d(this.rotation[0]);
        dst[1] = cM_sht2d(this.rotation[1]);
        dst[2] = cM_sht2d(this.rotation[2]);
    }

    override JSGSetData(id: number, data: DataView): void {
        this.stbDataId = id;
        this.stbData = data; // @TODO: Check that data makes sense
        this.flags |= EDemoActorFlags.HasData;
    }

    override JSGSetTranslation(src: ReadonlyVec3) {
        vec3.copy(this.translation, src);
        this.flags |= EDemoActorFlags.HasPos;
    }

    override JSGSetScaling(src: ReadonlyVec3) {
        vec3.copy(this.scaling, src);
        this.flags |= EDemoActorFlags.HasScale;
    }

    override JSGSetRotation(src: ReadonlyVec3) {
        this.rotation[0] = cM_deg2s(src[0]);
        this.rotation[1] = cM_deg2s(src[1]);
        this.rotation[2] = cM_deg2s(src[2]);
        this.flags |= EDemoActorFlags.HasRot;
    }

    override JSGSetShape(id: number): void {
        this.shapeId = id;
        this.flags |= EDemoActorFlags.HasShape
    }

    override JSGSetAnimation(id: number): void {
        this.nextBckId = id;
        this.animFrameMax = 3.402823e+38;
        this.flags |= EDemoActorFlags.HasAnim;
    }

    override JSGSetAnimationFrame(x: number): void {
        this.animFrame = x;
        this.flags |= EDemoActorFlags.HasFrame;
    }

    override JSGSetAnimationTransition(x: number): void {
        this.animTransition = x;
        this.flags |= EDemoActorFlags.HasFrame;
    }

    override JSGSetTextureAnimation(id: number): void {
        this.texAnim = id;
        this.flags |= EDemoActorFlags.HasTexAnim;
    }

    override JSGSetTextureAnimationFrame(x: number): void {
        this.texAnimFrame = x;
        this.flags |= EDemoActorFlags.HasTexFrame;
    }
}

class dDemo_system_c implements TSystem {
    private activeCamera?: dDemo_camera_c;
    private actors: dDemo_actor_c[] = [];
    // private ambient: dDemo_ambient_c;
    // private lights: dDemo_light_c[];
    // private fog: dDemo_fog_c;

    constructor(
        private globals: dGlobals
    ) { }

    public JSGFindObject(objName: string, objType: JStage.EObject): JStage.TObject | undefined {
        switch (objType) {
            case JStage.EObject.Camera:
                if (this.activeCamera) return this.activeCamera;
                else return this.activeCamera = new dDemo_camera_c(this.globals);

            case JStage.EObject.Actor:
            case JStage.EObject.PreExistingActor:
                let actor = fopAcM_searchFromName(this.globals, objName, 0, 0);
                if (!actor) {
                    if (objType == JStage.EObject.Actor && objName == "d_act") {
                        debugger; // Untested. Unimplemented
                        actor = {} as fopAc_ac_c;
                    } else {
                        console.warn('Demo failed to find actor', objName);
                        return undefined;
                    }
                }
                if (!this.actors[actor.demoActorID]) {
                    actor.demoActorID = this.actors.length;
                    this.actors[actor.demoActorID] = new dDemo_actor_c(actor);
                    this.actors[actor.demoActorID].name = objName;
                };
                return this.actors[actor.demoActorID];

            case JStage.EObject.Ambient:
            case JStage.EObject.Light:
            case JStage.EObject.Fog:
            default:
                console.debug('[JSGFindObject] Unhandled type: ', objType);
                return undefined;
        }
    }

    public getCamera() { return this.activeCamera; }
    public getActor(actorID: number) { return this.actors[actorID]; }

    public remove() {
        this.activeCamera = undefined;

        for (let demoActor of this.actors) { demoActor.actor.demoActorID = -1; }
        this.actors = [];
    }
}

export class dDemo_manager_c {
    private frame: number;
    private frameNoMsg: number;
    private mode = EDemoMode.None;
    private curFile?: ArrayBufferSlice;

    private parser: TParse;
    private system = new dDemo_system_c(this.globals);
    private control: TControl = new TControl(this.system);

    constructor(
        private globals: dGlobals
    ) { }

    getFrame() { return this.frame; }
    getFrameNoMsg() { return this.frameNoMsg; }
    getMode() { return this.mode; }
    getSystem() { return this.system; }

    public create(data: ArrayBufferSlice, originPos?: vec3, rotY?: number, startFrame?: number): boolean {
        this.parser = new TParse(this.control);

        if (!this.parser.parse(data, 0)) {
            console.error('Failed to parse demo data');
            return false;
        }

        this.control.forward(startFrame || 0);
        if (originPos) {
            this.control.transformSetOrigin(originPos, rotY || 0);
        }

        this.frame = 0;
        this.frameNoMsg = 0;
        this.curFile = data;
        this.mode = EDemoMode.Playing;

        return true;
    }

    public remove() {
        this.control.destroyObject_all();
        this.system.remove();
        this.curFile = undefined;
        this.mode = 0;
    }

    public update(): boolean {
        if (!this.curFile) {
            return false;
        }

        const dtFrames = this.globals.context.viewerInput.deltaTime / 1000.0 * 30;

        // noclip modification: If a demo is suspended (waiting for the user to interact with a message), just resume
        if (this.control.isSuspended()) { this.control.setSuspend(0); }

        if (this.control.forward(dtFrames)) {
            this.frame += dtFrames;
            if (!this.control.isSuspended()) {
                this.frameNoMsg += dtFrames;
            }
        } else {
            this.mode = EDemoMode.Ended;
        }
        return true;
    }
}

/**
 * Called by Actor update functions to update their data from the demo version of the actor. 
 */
export function dDemo_setDemoData(globals: dGlobals, dtFrames: number, actor: fopAc_ac_c, flagMask: number,
    morf?: mDoExt_McaMorf, arcName?: string, soundCount?: number, soundIdxs?: number[], soundMaterialID?: number, reverb?: number) {
    const demoActor = globals.scnPlay.demo.getSystem().getActor(actor.demoActorID);
    if (!demoActor)
        return false;

    const enable = demoActor.checkEnable(flagMask);
    if (enable & 2) {
        // actor.current.pos = demoActor.mTranslation;
        // actor.old.pos = actor.current.pos;
        vec3.copy(actor.pos, demoActor.translation);
    }
    if (enable & 8) {
        // actor.shape_angle = demoActor.mRotation;
        // actor.current.angle = actor.shape_angle;
        vec3.copy(actor.rot, demoActor.rotation);
    }
    if (enable & 4) {
        actor.scale = demoActor.scaling;
    }

    if (!morf)
        return true;

    demoActor.model = morf.model;

    if ((enable & 0x20) && (demoActor.nextBckId != demoActor.bckId)) {
        const bckID = demoActor.nextBckId;
        if (bckID & 0x10000)
            arcName = globals.roomCtrl.demoArcName;
        assert(!!arcName);
        demoActor.bckId = bckID;

        const i_key = globals.resCtrl.getObjectIDRes(ResType.Bck, arcName, bckID);
        assert(!!i_key);

        // void* i_sound = dDemo_getJaiPointer(a_name, bck, soundCount, soundIdxs);
        morf.setAnm(i_key, -1 as LoopMode, demoActor.getMorfParam(), 1.0, 0.0, -1.0);
        demoActor.animFrameMax = morf.frameCtrl.endFrame;
    }

    if (enable & 0x40) {
        if (demoActor.animFrame > dtFrames) {
            morf.frameCtrl.setFrame(demoActor.animFrame - dtFrames);
            morf.play(dtFrames);
        } else {
            morf.frameCtrl.setFrame(demoActor.animFrame);
        }
    } else {
        morf.play(dtFrames);
    }

    return true;
}