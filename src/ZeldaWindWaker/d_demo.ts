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
    mFlags: number = 0;
    mProjNear: number = 0;
    mProjFar: number = 0;
    mFovy: number = 0;
    mAspect: number = 0;
    mViewPosition: vec3 = vec3.create();
    mUpVector: vec3 = vec3.create();
    mTargetPosition: vec3 = vec3.create();
    mRoll: number = 0;

    constructor(
        private globals: dGlobals
    ) { super() }

    override JSGGetProjectionNear(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return camera.near;
    }

    override JSGSetProjectionNear(v: number) {
        this.mProjNear = v;
        this.mFlags |= EDemoCamFlags.HasNearZ;
    }

    override JSGGetProjectionFar(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 1.0;
        return camera.far;
    }


    override JSGSetProjectionFar(v: number): void {
        this.mProjFar = v;
        this.mFlags |= EDemoCamFlags.HasFarZ;
    }


    override JSGGetProjectionFovy(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 60.0;
        return camera.fovY;
    }


    override JSGSetProjectionFovy(v: number): void {
        this.mFovy = v;
        this.mFlags |= EDemoCamFlags.HasFovY;
    }


    override JSGGetProjectionAspect() {
        const camera = this.globals.camera;
        if (!camera)
            return 1.3333;
        return camera.aspect;
    }


    override JSGSetProjectionAspect(v: number) {
        this.mAspect = v;
        this.mFlags |= EDemoCamFlags.HasAspect;
    }


    override JSGGetViewPosition(dst: vec3) {
        vec3.copy(dst, this.globals.cameraPosition);
    }


    override JSGSetViewPosition(v: ReadonlyVec3) {
        vec3.copy(this.mViewPosition, v);
        this.mFlags |= EDemoCamFlags.HasEyePos;
    }


    override JSGGetViewUpVector(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 1, 0);
        getMatrixAxisY(dst, camera.viewMatrix); // @TODO: Double check that this is correct
    }


    override JSGSetViewUpVector(v: ReadonlyVec3) {
        vec3.copy(this.mUpVector, v);
        this.mFlags |= EDemoCamFlags.HasUpVec;
    }


    override JSGGetViewTargetPosition(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 0, 0);
        console.debug('JSGGetViewTargetPosition called. This is not yet working');
        vec3.set(dst, 0, 0, 0);
    }


    override JSGSetViewTargetPosition(v: ReadonlyVec3) {
        vec3.copy(this.mTargetPosition, v);
        this.mFlags |= EDemoCamFlags.HasTargetPos;
    }


    override JSGGetViewRoll() {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return 0.0; // @TODO
    }


    override JSGSetViewRoll(v: number) {
        this.mRoll = v;
        this.mFlags |= EDemoCamFlags.HasRoll;
    }
}

class dDemo_actor_c extends TActor {
    mFlags: number;
    mTranslation = vec3.create();
    mScaling = vec3.create();
    mRotation = vec3.create();
    mShapeId: number;
    mNextBckId: number;
    mAnimationFrame: number;
    mAnimationTransition: number;
    mAnimationFrameMax: number;
    mTexAnimation: number;
    mTexAnimationFrame: number;
    mTexAnimationFrameMax: number;
    mModel: J3DModelInstance;
    stbDataId: number;
    stbData: DataView;
    mActorPcId: number;
    mBckId: number;
    mBtpId: number;
    mBtkId: number;
    mBrkId: number;

    constructor(actor: fopAc_ac_c) {
        super();
    }

    checkEnable(mask: number) {
        return this.mFlags & mask;
    }

    getMorfParam() {
        // Doesn't have anim properties
        if ((this.mFlags & 0x40) == 0) {
            // Has STB data
            if ((this.mFlags & 1) == 0) {
                return 0.0;
            } else {
                switch(this.stbDataId) {
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
            return this.mAnimationTransition;
        }
    }

    override JSGGetNodeTransformation(nodeId: number, mtx: mat4): number {
        debugger; // I think this may be one of the shapeInstanceState matrices instead
        mat4.copy(mtx, this.mModel.modelMatrix);
        return 1;
    }

    override JSGGetAnimationFrameMax() { return this.mAnimationFrameMax; }
    override JSGGetTextureAnimationFrameMax() { return this.mTexAnimationFrameMax; }

    override JSGGetTranslation(dst: vec3) { vec3.copy(dst, this.mTranslation); }
    override JSGGetScaling(dst: vec3) { vec3.copy(dst, this.mScaling); }
    override JSGGetRotation(dst: vec3) { vec3.scale(dst, this.mRotation, MathConstants.RAD_TO_DEG); }

    override JSGSetData(id: number, data: DataView): void {
        this.stbDataId = id;
        this.stbData = data; // @TODO: Check that data makes sense
        this.mFlags |= 0x01;
    }

    override JSGSetTranslation(src: ReadonlyVec3) {
        vec3.copy(this.mTranslation, src);
        this.mFlags |= 0x02;
    }

    override JSGSetScaling(src: ReadonlyVec3) {
        vec3.copy(this.mScaling, src);
        this.mFlags |= 0x04;
    }

    override JSGSetRotation(src: ReadonlyVec3) {
        vec3.scale(this.mRotation, src, MathConstants.DEG_TO_RAD);
        this.mFlags |= 0x08;
    }

    override JSGSetShape(id: number): void {
        this.mShapeId = id;
        this.mFlags |= 0x10;
    }

    override JSGSetAnimation(id: number): void {
        this.mNextBckId = id;
        this.mAnimationFrameMax = 3.402823e+38;
        this.mFlags |= 0x20;
    }

    override JSGSetAnimationFrame(x: number): void {
        this.mAnimationFrame = x;
        this.mFlags |= 0x40;
    }

    override JSGSetAnimationTransition(x: number): void {
        this.mAnimationTransition = x;
        this.mFlags |= 0x40;
    }

    override JSGSetTextureAnimation(id: number): void {
        this.mTexAnimation = id;
        this.mFlags |= 0x80;
    }

    override JSGSetTextureAnimationFrame(x: number): void {
        this.mTexAnimationFrame = x;
        this.mFlags |= 0x100;
    }
}

class dDemo_system_c implements TSystem {
    private mpActiveCamera?: dDemo_camera_c;
    private mpActors: dDemo_actor_c[] = [];
    // private mpAmbient: dDemo_ambient_c;
    // private mpLight: dDemo_light_c[];
    // private mpFog: dDemo_fog_c;

    constructor(
        private globals: dGlobals
    ) { }

    public JSGFindObject(objName: string, objType: JStage.TEObject): JStage.TObject | undefined {
        switch (objType) {
            case JStage.TEObject.CAMERA:
                if (this.mpActiveCamera) return this.mpActiveCamera;
                else return this.mpActiveCamera = new dDemo_camera_c(this.globals);

            case JStage.TEObject.ACTOR:
            case JStage.TEObject.PREEXISTING_ACTOR:
                let actor = fopAcM_searchFromName(this.globals, objName, 0, 0);
                if (!actor) {
                    if (objType == JStage.TEObject.ACTOR && objName == "d_act") {
                        debugger; // Untested. Unimplemented
                        actor = {} as fopAc_ac_c;
                    } else {
                        console.warn('Demo failed to find actor', objName);
                        return undefined;
                    }
                }
                if (!this.mpActors[actor.demoActorID]) {
                    actor.demoActorID = this.mpActors.length;
                    this.mpActors[actor.demoActorID] = new dDemo_actor_c(actor);
                };
                return this.mpActors[actor.demoActorID];

            case JStage.TEObject.AMBIENT:
            case JStage.TEObject.LIGHT:
            case JStage.TEObject.FOG:
            default:
                console.debug('[JSGFindObject] Unhandled type: ', objType);
                return undefined;
        }
    }

    public getCamera() { return this.mpActiveCamera; }
    public getActor(actorID: number) { return this.mpActors[actorID]; }

    public remove() {
        this.mpActiveCamera = undefined;
        this.mpActors = [];
    }
}

export class dDemo_manager_c {
    private mFrame: number;
    private mFrameNoMsg: number;
    private mMode = EDemoMode.None;
    private mCurFile?: ArrayBufferSlice;

    private mParser: TParse;
    private mSystem = new dDemo_system_c(this.globals);
    private mControl: TControl = new TControl(this.mSystem);

    constructor(
        private globals: dGlobals
    ) { }

    getFrame() { return this.mFrame; }
    getFrameNoMsg() { return this.mFrameNoMsg; }
    getMode() { return this.mMode; }
    getSystem() { return this.mSystem; }

    public create(data: ArrayBufferSlice, originPos?: vec3, rotY?: number, startFrame?: number): boolean {
        this.mParser = new TParse(this.mControl);

        if (!this.mParser.parse(data, 0)) {
            console.error('Failed to parse demo data');
            return false;
        }

        this.mControl.forward(startFrame || 0);
        if (originPos) {
            this.mControl.transformSetOrigin(originPos, rotY || 0);
        }

        this.mFrame = 0;
        this.mFrameNoMsg = 0;
        this.mCurFile = data;
        this.mMode = EDemoMode.Playing;

        return true;
    }

    public remove() {
        this.mControl.destroyObject_all();
        this.mSystem.remove();
        this.mCurFile = undefined;
        this.mMode = 0;
    }

    public update(): boolean {
        if (!this.mCurFile) {
            return false;
        }

        const dtFrames = this.globals.context.viewerInput.deltaTime / 1000.0 * 30;

        // noclip modification: If a demo is suspended (waiting for the user to interact with a message), just resume
        if (this.mControl.isSuspended()) { this.mControl.setSuspend(0); }

        if (this.mControl.forward(dtFrames)) {
            this.mFrame += dtFrames;
            if (!this.mControl.isSuspended()) {
                this.mFrameNoMsg += dtFrames;
            }
        } else {
            this.mMode = EDemoMode.Ended;
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
        vec3.copy(actor.pos, demoActor.mTranslation);
    }
    if (enable & 8) {
        // actor.shape_angle = demoActor.mRotation;
        // actor.current.angle = actor.shape_angle;
        vec3.copy(actor.rot, demoActor.mRotation);
    }
    if (enable & 4) {
        actor.scale = demoActor.mScaling;
    }

    if (!morf)
        return true;

    demoActor.mModel = morf.model;

    if ((enable & 0x20)) {
        const bckID = demoActor.mNextBckId;
        if (bckID & 0x10000)
            arcName = globals.roomCtrl.demoArcName;
        assert(!!arcName);
        demoActor.mBckId = bckID;

        const i_key = globals.resCtrl.getObjectIDRes(ResType.Bck, arcName, bckID);
        assert(!!i_key);

        // void* i_sound = dDemo_getJaiPointer(a_name, bck, soundCount, soundIdxs);
        morf.setAnm(i_key, -1 as LoopMode, demoActor.getMorfParam(), 1.0, 0.0, -1.0);
        demoActor.mAnimationFrameMax = morf.frameCtrl.endFrame;

        if (enable & 0x40) {
            debugger;
            if (demoActor.mAnimationFrame > 1.0) {
                morf.frameCtrl.setFrame(demoActor.mAnimationFrame - 1.0);
                morf.play(dtFrames);
            } else {
                morf.frameCtrl.setFrame(demoActor.mAnimationFrame);
            }
        } else {
            morf.play(dtFrames);
            console.log(morf.frameCtrl.currentTimeInFrames);
        }
    }

    return true;
}