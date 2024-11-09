import { ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TParse, JStage, TSystem, TControl, TCamera, TActor } from "../Common/JSYSTEM/JStudio.js";
import { getMatrixAxisY } from "../MathHelpers.js";
import { dGlobals } from "./Main";
import { fopAc_ac_c, fopAcM_searchFromName } from "./framework.js";

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
    constructor(actor: fopAc_ac_c) {
        super();
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

    public create(data: ArrayBufferSlice, originPos?: vec3, rotY?: number): boolean {
        this.mParser = new TParse(this.mControl);

        if (!this.mParser.parse(data, 0)) {
            console.error('Failed to parse demo data');
            return false;
        }

        this.mControl.forward(0);
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
            this.mFrame++;
            if (!this.mControl.isSuspended()) {
                this.mFrameNoMsg++;
            }
        } else {
            this.mMode = EDemoMode.Ended;
        }
        return true;
    }
}