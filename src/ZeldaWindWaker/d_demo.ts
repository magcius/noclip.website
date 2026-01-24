
import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase.js";
import { LoopMode, TPT1, TTK1 } from "../Common/JSYSTEM/J3D/J3DLoader.js";
import { JMessage, JStage, TActor, TCamera, TControl, TParse } from "../Common/JSYSTEM/JStudio.js";
import { getMatrixAxisY } from "../MathHelpers.js";
import { assert } from "../util.js";
import { ResType } from "./d_resorce.js";
import { mDoExt_McaMorf } from "./m_do_ext.js";
import { dGlobals } from "./Main.js";
import { cM_deg2s, cM_sht2d } from "./SComponent.js";
import { fopAc_ac_c, fopAcM_fastCreate, fopAcM_searchFromName } from "./f_op_actor.js";

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
    public flags = 0;
    public projNear = 0;
    public projFar = 0;
    public fovY = 0;
    public aspect = 0;
    public viewPosition = vec3.create();
    public upVector = vec3.create();
    public targetPosition = vec3.create();
    public roll = 0;

    constructor(
        private globals: dGlobals
    ) { super() }

    public override JSGGetName() { return 'Cam'; }

    public override JSGGetProjectionNear(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return camera.near;
    }

    public override JSGSetProjectionNear(v: number) {
        this.projNear = v;
        this.flags |= EDemoCamFlags.HasNearZ;
    }

    public override JSGGetProjectionFar(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 1.0;
        return camera.far;
    }


    public override JSGSetProjectionFar(v: number): void {
        this.projFar = v;
        this.flags |= EDemoCamFlags.HasFarZ;
    }


    public override JSGGetProjectionFovy(): number {
        const camera = this.globals.camera;
        if (!camera)
            return 60.0;
        return camera.fovY;
    }


    public override JSGSetProjectionFovy(v: number): void {
        this.fovY = v;
        this.flags |= EDemoCamFlags.HasFovY;
    }


    public override JSGGetProjectionAspect() {
        const camera = this.globals.camera;
        if (!camera)
            return 1.3333;
        return camera.aspect;
    }


    public override JSGSetProjectionAspect(v: number) {
        this.aspect = v;
        this.flags |= EDemoCamFlags.HasAspect;
    }

    public override JSGGetViewPosition(dst: vec3) {
        vec3.copy(dst, this.globals.camera.cameraPos);
    }

    public override JSGSetViewPosition(v: ReadonlyVec3) {
        vec3.copy(this.viewPosition, v);
        this.flags |= EDemoCamFlags.HasEyePos;
    }

    public override JSGGetViewUpVector(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.set(dst, 0, 1, 0);
        getMatrixAxisY(dst, camera.viewFromWorldMatrix); // @TODO: Double check that this is correct
    }

    public override JSGSetViewUpVector(v: ReadonlyVec3) {
        vec3.copy(this.upVector, v);
        this.flags |= EDemoCamFlags.HasUpVec;
    }

    public override JSGGetViewTargetPosition(dst: vec3) {
        const camera = this.globals.camera;
        if (!camera)
            vec3.zero(dst);
        vec3.add(dst, this.globals.camera.cameraPos, this.globals.camera.cameraFwd);
    }


    public override JSGSetViewTargetPosition(v: ReadonlyVec3) {
        vec3.copy(this.targetPosition, v);
        this.flags |= EDemoCamFlags.HasTargetPos;
    }


    public override JSGGetViewRoll() {
        const camera = this.globals.camera;
        if (!camera)
            return 0.0;
        return this.roll; // HACK: Instead of actually computing roll (complicated), just assume no one else is modifying it
    }


    public override JSGSetViewRoll(v: number) {
        this.roll = v;
        this.flags |= EDemoCamFlags.HasRoll;
    }
}

export enum EDemoActorFlags {
    HasData = 1 << 0,
    HasPos = 1 << 1,
    HasScale = 1 << 2,
    HasRot = 1 << 3,
    HasShape = 1 << 4,
    HasAnim = 1 << 5,
    HasAnimFrame = 1 << 6,
    HasTexAnim = 1 << 7,
    HasTexFrame = 1 << 8,
}

export class dDemo_actor_c extends TActor {
    public name: string;
    public flags: number;
    public translation = vec3.create();
    public scaling = vec3.fromValues(1, 1, 1);
    public rotation = vec3.create();
    public shapeId: number;
    public nextBckId: number;
    public animFrame: number;
    public animTransition: number;
    public animFrameMax: number;
    public texAnim: number;
    public texAnimFrame: number;
    public textAnimFrameMax: number;
    public model: J3DModelInstance;
    public stbDataId: number;
    public stbData: DataView;
    public bckId: number;
    public btpId: number;
    public btkId: number;
    public brkId: number;

    debugGetAnimName?: (idx: number) => string;

    constructor(public actor: fopAc_ac_c) { super(); }

    public checkEnable(mask: number) {
        return this.flags & mask;
    }

    public getMorfParam() {
        // Doesn't have anim properties
        if ((this.flags & 0x40) === 0) {
            // Has STB data
            if ((this.flags & 1) === 0) {
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

    public getBtpData(globals: dGlobals, arcName: string): TPT1 | null {
        let btpId = 0;

        if (this.flags & EDemoActorFlags.HasTexAnim) {
            btpId = this.texAnim;
            debugger;
            arcName = ""; // @TODO: How does this work?
        } else {
            if (!(this.flags & EDemoActorFlags.HasData)) {
                return null;
            }

            switch (this.stbDataId) {
                case 1: btpId = this.stbData.getInt16(1); break;
                case 2: btpId = this.stbData.getInt16(2); break;
                case 4: btpId = this.stbData.getInt32(1); break;
                case 5: btpId = this.stbData.getInt32(2); break;
                case 6: btpId = this.stbData.getInt32(2); break;
                default:
                    return null;
            }
        }

        if (btpId === this.btpId) {
            return null;
        } else {
            this.btpId = btpId;
            if ((btpId & 0x10000) !== 0) {
                arcName = globals.roomCtrl.demoArcName!;
            }

            const btp = globals.resCtrl.getObjectIDRes(ResType.Btp, arcName, btpId);
            this.textAnimFrameMax = this.stbData.getInt16(6);
            return btp;
        }
    }

    public getBrkData(globals: dGlobals, arcName: string) {
        debugger;
    }

    public getBtkData(globals: dGlobals, arcName: string): TTK1 | null {
        if (!(this.flags & EDemoActorFlags.HasData)) {
            return null;
        }

        let btkId;
        switch (this.stbDataId) {
            case 2: btkId = this.stbData.getInt16(4); break;
            case 5: btkId = this.stbData.getInt32(6); break;
            case 6: btkId = this.stbData.getInt32(6); break;
            default:
                return null;
        }

        if (btkId === this.btkId) {
            return null;
        }

        this.btkId = btkId;
        if ((btkId & 0x10000) !== 0) {
            arcName = globals.roomCtrl.demoArcName!;
        }

        return globals.resCtrl.getObjectIDRes(ResType.Btk, arcName, btkId);
    }

    public override JSGGetName() { return this.name; }

    public override JSGGetNodeTransformation(nodeId: number, mtx: mat4): number {
        debugger; // I think this may be one of the shapeInstanceState matrices instead
        mat4.copy(mtx, this.model.modelMatrix);
        return 1;
    }

    public override JSGGetAnimationFrameMax() { return this.animFrameMax; }
    public override JSGGetTextureAnimationFrameMax() { return this.textAnimFrameMax; }

    public override JSGGetTranslation(dst: vec3) { vec3.copy(dst, this.translation); }
    public override JSGGetScaling(dst: vec3) { vec3.copy(dst, this.scaling); }
    public override JSGGetRotation(dst: vec3) {
        dst[0] = cM_sht2d(this.rotation[0]);
        dst[1] = cM_sht2d(this.rotation[1]);
        dst[2] = cM_sht2d(this.rotation[2]);
    }

    public override JSGSetData(id: number, data: DataView): void {
        this.stbDataId = id;
        this.stbData = data; // @TODO: Check that data makes sense
        this.flags |= EDemoActorFlags.HasData;
    }

    public override JSGSetTranslation(src: ReadonlyVec3) {
        vec3.copy(this.translation, src);
        this.flags |= EDemoActorFlags.HasPos;
    }

    public override JSGSetScaling(src: ReadonlyVec3) {
        vec3.copy(this.scaling, src);
        this.flags |= EDemoActorFlags.HasScale;
    }

    public override JSGSetRotation(src: ReadonlyVec3) {
        this.rotation[0] = cM_deg2s(src[0]);
        this.rotation[1] = cM_deg2s(src[1]);
        this.rotation[2] = cM_deg2s(src[2]);
        this.flags |= EDemoActorFlags.HasRot;
    }

    public override JSGSetShape(id: number): void {
        this.shapeId = id;
        this.flags |= EDemoActorFlags.HasShape;
    }

    public override JSGSetAnimation(id: number): void {
        this.nextBckId = id;
        this.animFrameMax = 3.402823e+38;
        this.flags |= EDemoActorFlags.HasAnim;
    }

    public override JSGSetAnimationFrame(x: number): void {
        this.animFrame = x;
        this.flags |= EDemoActorFlags.HasAnimFrame;
    }

    public override JSGSetAnimationTransition(x: number): void {
        this.animTransition = x;
        this.flags |= EDemoActorFlags.HasAnimFrame;
    }

    public override JSGSetTextureAnimation(id: number): void {
        this.texAnim = id;
        this.flags |= EDemoActorFlags.HasTexAnim;
    }

    public override JSGSetTextureAnimationFrame(x: number): void {
        this.texAnimFrame = x;
        this.flags |= EDemoActorFlags.HasTexFrame;
    }

    public override JSGFindNodeID(name: string): number {
        const joints = this.model.modelData.bmd.jnt1.joints;
        for (let i = 0; i < joints.length; i++) {
            if (joints[i].name === name)
                return i;
        }
        return -1;
    }

    override JSGDebugGetAnimationName(x: number): string | null {
        if (this.debugGetAnimName) { return this.debugGetAnimName(x); }
        else return null;
    }
}

class dDemo_system_c implements JStage.TSystem {
    private activeCamera: dDemo_camera_c | null;
    private actors: dDemo_actor_c[] = [];
    // private ambient: dDemo_ambient_c;
    // private lights: dDemo_light_c[];
    // private fog: dDemo_fog_c;
    private demoLayer: number = -1;

    constructor(
        private globals: dGlobals
    ) { }

    public JSGFindObject(objName: string, objType: JStage.EObject): JStage.TObject | null {
        switch (objType) {
            case JStage.EObject.Camera:
                if (this.activeCamera) return this.activeCamera;
                else return this.activeCamera = new dDemo_camera_c(this.globals);

            case JStage.EObject.Actor:
            case JStage.EObject.PreExistingActor:
                let actor = fopAcM_searchFromName(this.globals, objName, 0, 0, this.demoLayer);
                if (!actor) {
                    if (objType === JStage.EObject.Actor && objName.startsWith("d_act")) {
                        actor = fopAcM_fastCreate(this.globals, objName, 0, null, this.globals.mStayNo, null, null, -1) as fopAc_ac_c;
                    } else {
                        console.warn('Demo failed to find actor', objName);
                        return null;
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
                return null;
        }
    }

    public getCamera() { return this.activeCamera; }
    public getActor(actorID: number) { return this.actors[actorID]; }

    public setLayer(layer: number) {
        this.demoLayer = layer;
    }

    public remove() {
        this.activeCamera = null;

        for (let demoActor of this.actors) { demoActor.actor.demoActorID = -1; }
        this.actors = [];
    }
}

export class dDemo_manager_c {
    private frame: number;
    private frameNoMsg: number;
    private mode = EDemoMode.None;
    private curFile: ArrayBufferSlice | null;
    private name: string | null = null;

    private parser: TParse;
    private system = new dDemo_system_c(this.globals);
    private messageControl = new JMessage.TControl(); // TODO
    private control: TControl;

    constructor(
        private globals: dGlobals
    ) {
        // TODO: If we made this a createSimpleEmitter function on JPAEmitterManager, we could have each game override it
        const createEmitterCb = (userId: number, groupId: number, roomId: number) => {
            return this.globals.particleCtrl.set(globals, groupId, userId, null);
        };
        this.control = new TControl(this.system, this.messageControl, this.globals.particleCtrl.emitterManager, createEmitterCb);
    }

    public getName() { return this.name; }
    public getFrame() { return this.frame; }
    public getFrameNoMsg() { return this.frameNoMsg; }
    public getMode() { return this.mode; }
    public getSystem() { return this.system; }

    public create(name: string, data: ArrayBufferSlice, layer: number, originPos?: vec3, rotYDeg?: number, startFrame?: number): boolean {
        this.name = name;
        this.parser = new TParse(this.control);

        // noclip modification: User has control over visible layers. Allow the demo to search for actors from only its layer.
        this.system.setLayer(layer);

        if (!this.parser.parse(data, 0)) {
            console.error('Failed to parse demo data');
            return false;
        }

        this.control.forward(startFrame || 0);
        if (originPos) {
            this.control.transformSetOrigin(originPos, rotYDeg || 0);
        }

        this.frame = startFrame || 0;
        this.frameNoMsg = startFrame || 0;
        this.curFile = data;
        this.mode = EDemoMode.Playing;

        return true;
    }

    public remove() {
        this.control.destroyObject_all();
        this.system.remove();
        this.curFile = null;
        this.name = null;
        this.mode = 0;
    }

    public update(deltaTimeFrames: number): boolean {
        if (!this.curFile) {
            return false;
        }

        // noclip modification: If a demo is suspended (waiting for the user to interact with a message), just resume
        if (this.control.isSuspended()) { this.control.setSuspend(0); }

        if (this.control.forward(deltaTimeFrames)) {
            this.frame += deltaTimeFrames;
            if (!this.control.isSuspended()) {
                this.frameNoMsg += deltaTimeFrames;
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
    morf: mDoExt_McaMorf | null = null, arcName: string | null = null) {
    const demoActor = globals.scnPlay.demo.getSystem().getActor(actor.demoActorID);
    if (!demoActor)
        return false;

    const enable = demoActor.checkEnable(flagMask);
    if (enable & EDemoActorFlags.HasPos) {
        // actor.current.pos = demoActor.mTranslation;
        // actor.old.pos = actor.current.pos;
        vec3.copy(actor.pos, demoActor.translation);
    }
    if (enable & EDemoActorFlags.HasRot) {
        // actor.shape_angle = demoActor.mRotation;
        // actor.current.angle = actor.shape_angle;
        vec3.copy(actor.rot, demoActor.rotation);
    }
    if (enable & EDemoActorFlags.HasScale) {
        actor.scale = demoActor.scaling;
    }

    if (!morf)
        return true;

    demoActor.model = morf.model;

    if ((enable & EDemoActorFlags.HasAnim) && (demoActor.nextBckId !== demoActor.bckId)) {
        const bckID = demoActor.nextBckId;
        if (bckID & 0x10000)
            arcName = globals.roomCtrl.demoArcName;
        demoActor.bckId = bckID;

        // Most actors which requires their own demo arc have demo/anim logic more complex than LegacyActor can handle.
        // If this branch is hit, it's likely a LegacyActor that needs to be converted to a full d_* Actor.
        if (!arcName) {
            const name = globals.dStage__searchNameRev(actor.processName, actor.subtype);
            console.warn(`dDemo_setDemoData: Actor ${name} needs to pass a valid arcName. Animation disabled`);
            demoActor.flags &= ~EDemoActorFlags.HasAnim;
            return true;
        }

        const bckAnim = globals.resCtrl.getObjectIDRes(ResType.Bck, arcName!, bckID);
        assert(!!bckAnim);

        // void* i_sound = dDemo_getJaiPointer(a_name, bck, soundCount, soundIdxs);
        morf.setAnm(bckAnim, -1 as LoopMode, demoActor.getMorfParam(), 1.0, 0.0, -1.0);
        demoActor.animFrameMax = morf.frameCtrl.endFrame;
    }

    if (enable & EDemoActorFlags.HasAnimFrame) {
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