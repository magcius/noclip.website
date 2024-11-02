import { ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TParse, JStage, TSystem, TControl, TCamera } from "../Common/JSYSTEM/JStudio.js";
import { getMatrixAxisY } from "../MathHelpers.js";
import { dGlobals } from "./Main";

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

    globals: dGlobals;

    override JSGGetProjectionNear(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return camera.near;
    }

    override JSGSetProjectionNear(v: number) {
        this.mProjNear = v;
        this.mFlags |= 0x01;
    }

    override JSGGetProjectionFar(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 1.0;
        return camera.far;
    }


    override JSGSetProjectionFar(v: number): void {
        this.mProjFar = v;
        this.mFlags |= 0x02;
    }


    override JSGGetProjectionFovy(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 60.0;
        return camera.fovY;
    }


    override JSGSetProjectionFovy(v: number): void {
        this.mFovy = v;
        this.mFlags |= 0x04;
    }


    override JSGGetProjectionAspect() {
        const camera = this.globals.camera;
        if (!camera)
            return 1.3333;
        return camera.aspect;
    }


    override JSGSetProjectionAspect(v: number) {
        this.mAspect = v;
        this.mFlags |= 0x08;
    }


    override JSGGetViewPosition(dst: vec3) {
        vec3.copy(dst, this.globals.cameraPosition);
    }


    override JSGSetViewPosition(v: ReadonlyVec3) {
        vec3.copy(this.mViewPosition, v);
        this.mFlags |= 0x10;
    }


    override JSGGetViewUpVector(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 1, 0);
        getMatrixAxisY(dst, camera.viewMatrix); // @TODO: Double check that this is correct
    }


    override JSGSetViewUpVector(v: ReadonlyVec3) {
        vec3.copy(this.mUpVector, v);
        this.mFlags |= 0x20;
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
        this.mFlags |= 0x40;
    }


    override JSGGetViewRoll() {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return 0.0; // @TODO
    }


    override JSGSetViewRoll(v: number) {
        this.mRoll = v;
        this.mFlags |= 0x80;
    }
}

class dDemo_system_c implements TSystem {
    private mpActiveCamera?: dDemo_camera_c;
    // private mpActors: dDemo_actor_c[];
    // private mpAmbient: dDemo_ambient_c;
    // private mpLight: dDemo_light_c[];
    // private mpFog: dDemo_fog_c;

    public JSGFindObject(objId: string, objType: JStage.TEObject): JStage.TObject | undefined {
        switch (objType) {
            case JStage.TEObject.CAMERA:
                if (this.mpActiveCamera) return this.mpActiveCamera;
                else return this.mpActiveCamera = new dDemo_camera_c();
            case JStage.TEObject.ACTOR:
            case JStage.TEObject.ACTOR_UNK:
            case JStage.TEObject.AMBIENT:
            case JStage.TEObject.LIGHT:
            case JStage.TEObject.FOG:
            default:
                console.debug('[JSGFindObject] Unhandled type: ', objType);
                return undefined;
        }
    }

    public remove() {
        this.mpActiveCamera = undefined;
    }
}

export class dDemo_manager_c {
    private mFrame: number;
    private mFrameNoMsg: number;
    private mMode: number;
    private mCurFile?: ArrayBufferSlice;

    private mParser: TParse;
    private mSystem = new dDemo_system_c();
    private mControl: TControl = new TControl(this.mSystem);

    public create(data: ArrayBufferSlice, originPos: vec3, rotY: number): boolean {
        this.mParser = new TParse(this.mControl);

        if(!this.mParser.parse(data, 0)) {
            console.error('Failed to parse demo data');
            return false;
        }

        this.mControl.forward(0);
        // @TODO:
        // if (originPos == NULL) {
        //     mControl->transform_enable(false);
        // } else {
        //     mControl->transform_enable(true);
        //     mControl->transform_setOrigin(*originPos, rotY);
        // }

        this.mFrame = 0;
        this.mFrameNoMsg = 0;
        this.mCurFile = data;
        this.mMode = 1;

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
        if (this.mControl.forward(1)) {
            this.mFrame++;
            if (!this.mControl.isSuspended()) {
                this.mFrameNoMsg++;
            }
        } else {
            this.mMode = 2;
        }
        return true;
    }
}