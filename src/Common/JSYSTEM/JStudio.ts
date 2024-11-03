// Nintendo's cutscene framework. Seems very over-engineered. Data is stored in a STB (Studio Binary) file.

import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { align, assert, nArray, readString } from "../../util.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { GfxColor } from "../../gfx/platform/GfxPlatform";
import { clamp } from "../../MathHelpers.js";
import { Endianness } from "../../endian.js";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

//----------------------------------------------------------------------------------------------------------------------
// Stage Objects
// These are created an managed by the game. Each Stage Object has a corresponding STB Object, connected by an Adaptor. 
// The STB objects are manipulated by Sequences from the STB file each frame, and update the Stage Object via Adaptor.
//----------------------------------------------------------------------------------------------------------------------
export namespace JStage {
    export enum TEObject {
        ACTOR_UNK = 0x0,
        UNK1 = 0x1,
        ACTOR = 0x2,
        CAMERA = 0x3,
        AMBIENT = 0x4,
        LIGHT = 0x5,
        FOG = 0x6,
    };

    export abstract class TObject {
        JSGFDisableFlag(flag: number): void { this.JSGSetFlag(this.JSGGetFlag() & ~flag); }
        JSGFEnableFlag(flag: number): void { this.JSGSetFlag(this.JSGGetFlag() | flag); }

        abstract JSGFGetType(): number;
        JSGGetName(): boolean { return false; } // TODO: What's the point of this?
        JSGGetFlag(): number { return 0; }
        JSGSetFlag(flag: number): void { }
        JSGGetData(unk0: number, data: Object, unk1: number): boolean { return false; }
        JSGSetData(unk0: number, data: Object, unk1: number): void { }
        JSGGetParent(parentDst: JStage.TObject, unk: { x: number }): void { }
        JSGSetParent(parent: JStage.TObject, unk: number): void { }
        JSGSetRelation(related: boolean, obj: JStage.TObject, unk: number): void { }
        JSGFindNodeID(id: string): number { return -1; }
        JSGGetNodeTransformation(unk: number, mtx: mat4): number {
            mat4.identity(mtx);
            return 0;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// System
// The main interface between a game and JStudio. Provides a method of finding or creating objects that will then be 
// modified by a cutscene. Each game should override JSGFindObject() to supply or create objects for manipulation. 
//----------------------------------------------------------------------------------------------------------------------
export interface TSystem {
    JSGFindObject(objId: string, objType: JStage.TEObject): JStage.TObject | undefined;
}

//----------------------------------------------------------------------------------------------------------------------
// TVariableValue
// Manages a single float, which will be updated each frame. This float can be updated using a variety of operations: 
// - Immediate(x): Set to single value. On Update(y), set the value to a single number then do nothing on future frames.  
// - Time(x): Increase over time. On Update(y), set the value to x * y * mAge.  
// - FuncVal(x): Set to the output of a functor. See FVB for details.
//
// Normally, after update() the value can be retrieved from mValue(). Alternatively, if setOutput() is called that 
// functor will be called during update(). 
//----------------------------------------------------------------------------------------------------------------------
class TVariableValue {
    private mValue: number;
    private mAge: number; // In frames
    private mUpdateFunc?: (varval: TVariableValue, x: number) => void;
    private mUpdateParam: number | FVB.TFunctionValue | undefined;
    private mOutputFunc?: (val: number, adaptor: TAdaptor) => void;

    getValue() { return this.mValue; }
    getValueU8() { return clamp(this.mValue, 0, 255); }

    forward(frameCount: number) {
        if (Number.MAX_VALUE - this.mAge <= frameCount) {
            this.mAge = Number.MAX_VALUE;
        } else {
            this.mAge += frameCount;
        }
    }

    update(secondsPerFrame: number, adaptor: TAdaptor): void {
        if (this.mUpdateFunc) {
            this.mUpdateFunc(this, secondsPerFrame);
            if (this.mOutputFunc) this.mOutputFunc(this.mValue, adaptor);
        }
    }

    //--------------------
    // Update functions
    // Each frame, one of these (or nothing) will be called to update the value of each TVariableValue.
    //--------------------
    private static update_immediate(varval: TVariableValue, secondsPerFrame: number): void {
        varval.mValue = (varval.mUpdateParam as number);
        varval.mUpdateFunc = undefined;
    }

    private static update_time(varval: TVariableValue, secondsPerFrame: number): void {
        varval.mValue = (varval.mUpdateParam as number) * (varval.mAge * secondsPerFrame);
    }

    private static update_functionValue(varval: TVariableValue, secondsPerFrame: number): void {
        const t = varval.mAge * secondsPerFrame;
        varval.mValue = (varval.mUpdateParam as FVB.TFunctionValue).getValue(t);
    }

    //--------------------
    // Set Update functions
    // Modify the function that will be called each Update()
    //--------------------
    // @TODO: Shorten these names
    public setValue_none() {
        this.mUpdateFunc = undefined;
    }

    // Value will be set only on next update 
    setValue_immediate(v: number): void {
        this.mUpdateFunc = TVariableValue.update_immediate;
        this.mAge = 0;
        this.mUpdateParam = v;
    }

    // Value will be set to (mAge * v * x) each frame
    setValue_time(v: number): void {
        this.mUpdateFunc = TVariableValue.update_time;
        this.mAge = 0;
        this.mUpdateParam = v;
    }

    // Value will be the result of a Function Value each frame
    setValue_functionValue(v?: FVB.TFunctionValue): void {
        this.mUpdateFunc = TVariableValue.update_functionValue;
        this.mAge = 0;
        this.mUpdateParam = v;
    }

    //--------------------
    // Set Output
    //--------------------
    setOutput(outputFunc?: (val: number, adaptor: TAdaptor) => void) {
        this.mOutputFunc = outputFunc;
    }
}


//----------------------------------------------------------------------------------------------------------------------
// TAdaptor
// Connects the STBObject to a Game Object. Manages tracks of TVariableValues, updates their values on the Game object.
//----------------------------------------------------------------------------------------------------------------------
const enum TEOperationData {
    NONE = 0,
    VOID = 1, // Disable updates for this track.
    IMMEDIATE = 2, // Set the value on this track with an immediate value.
    TIME = 3, // Ramp the track's value based by a given velocity, starting at 0.
    FUNCVALUE_NAME = 0x10, // Unused?
    FUNCVALUE_INDEX = 0x12 // Make the track use a function value object for the value.
};

abstract class TAdaptor {
    constructor(
        protected mCount: number,
        protected mVariableValues = nArray(mCount, i => new TVariableValue()),
    ) { }

    abstract adaptor_do_prepare(obj: STBObject): void;
    abstract adaptor_do_begin(obj: STBObject): void;
    abstract adaptor_do_end(obj: STBObject): void;
    abstract adaptor_do_update(obj: STBObject, frameCount: number): void;
    abstract adaptor_do_data(obj: STBObject, unk0: Object, unk1: number, unk2: Object, unk3: number): void;

    // Set a single VariableValue update function, with the option of using FuncVals 
    adaptor_setVariableValue(obj: STBObject, keyIdx: number, dataOp: TEOperationData, data: number | string) {
        const varval = this.mVariableValues[keyIdx];
        const control = obj.mControl;

        switch (dataOp) {
            case TEOperationData.VOID: varval.setValue_none(); break;
            case TEOperationData.IMMEDIATE: varval.setValue_immediate(data as number); break;
            case TEOperationData.TIME: varval.setValue_time(data as number); break;
            case TEOperationData.FUNCVALUE_NAME: varval.setValue_functionValue(control.getFunctionValueByName(data as string)); break;
            case TEOperationData.FUNCVALUE_INDEX: varval.setValue_functionValue(control.getFunctionValueByIdx(data as number)); break;
            default:
                console.debug('Unsupported dataOp: ', dataOp);
                debugger;
                return;
        }
    }

    // Immediately set 3 consecutive VariableValue update functions from a single vec3
    adaptor_setVariableValue_Vec(startKeyIdx: number, data: vec3) {
        this.mVariableValues[startKeyIdx + 0].setValue_immediate(data[0]);
        this.mVariableValues[startKeyIdx + 1].setValue_immediate(data[1]);
        this.mVariableValues[startKeyIdx + 2].setValue_immediate(data[2]);
    }

    // Get the current value of 3 consecutive VariableValues, as a vector. E.g. Camera position.
    adaptor_getVariableValue_Vec(dst: vec3, startKeyIdx: number) {
        dst[0] = this.mVariableValues[startKeyIdx + 0].getValue();
        dst[1] = this.mVariableValues[startKeyIdx + 1].getValue();
        dst[2] = this.mVariableValues[startKeyIdx + 2].getValue();
    }

    // Immediately set 4 consecutive VariableValue update functions from a single GXColor (4 bytes)
    adaptor_setVariableValue_GXColor(startKeyIdx: number, data: GfxColor) {
        debugger; // @TODO: Confirm that all uses of this always have consecutive keyIdxs. JStudio remaps them.
        this.mVariableValues[startKeyIdx + 0].setValue_immediate(data.r);
        this.mVariableValues[startKeyIdx + 1].setValue_immediate(data.g);
        this.mVariableValues[startKeyIdx + 2].setValue_immediate(data.b);
        this.mVariableValues[startKeyIdx + 4].setValue_immediate(data.a);
    }

    // Get the current value of 4 consecutive VariableValues, as a GXColor. E.g. Fog color.
    adaptor_getVariableValue_GXColor(dst: GfxColor, startKeyIdx: number) {
        dst.r = this.mVariableValues[startKeyIdx + 0].getValue();
        dst.g = this.mVariableValues[startKeyIdx + 1].getValue();
        dst.b = this.mVariableValues[startKeyIdx + 2].getValue();
        dst.a = this.mVariableValues[startKeyIdx + 2].getValue();
    }

    adaptor_updateVariableValue(obj: STBObject, frameCount: number) {
        const control = obj.mControl;
        for (let vv of this.mVariableValues) {
            vv.forward(frameCount);
            vv.update(control.mSecondsPerFrame, this);
        }
    }
}

//     struct TSetVariableValue_immediate {
//         inline TSetVariableValue_immediate(u32 p1, f32 p2)
//             : field_0x0(p1)
//             , field_0x4(p2)
//         {
//         }

//         u32 field_0x0;
//         f32 field_0x4;
//     };
//     typedef void (*setVarFunc)(JStudio::TAdaptor*, JStudio::TObject*, u32, void const*, u32);


//     TVariableValue* adaptor_referVariableValue(u32 param_0) {
//         return &mVariableValues[param_0];
//     }

//     void adaptor_setVariableValue_immediate(u32 param_0, f32 param_1) {
//         adaptor_referVariableValue(param_0)->setValue_immediate(param_1);
//     }

//      const TVariableValue* adaptor_getVariableValue(u32 param_0) const {
//         return &mVariableValues[param_0];
//     }

//----------------------------------------------------------------------------------------------------------------------
// STB Objects
// Created at parse time, and controlled by Sequences from the STB file. Connects to Game objects via an Adaptor. 
// Each frame the STB data is marched (see do_paragraph) to update one or more properties of the Object via its Adaptor. 
//----------------------------------------------------------------------------------------------------------------------
abstract class STBObject {
    public mControl: TControl;
    public mAdaptor: TAdaptor;

    private mId: string;
    private mType: string;
    private mFlags: number;
    private mStatus: TEStatus = TEStatus.STILL;
    private mIsSequence: boolean = false;
    private mSuspendFrames: number = 0;
    private mData: Reader;
    private pSequence: number;
    private pSequence_next: number;
    private mWait: number = 0;

    constructor(control: TControl, blockObj: TBlockObject, adaptor: TAdaptor) {
        this.mControl = control;
        this.mAdaptor = adaptor;

        this.mId = blockObj.id;
        this.mType = blockObj.type;
        this.mFlags = blockObj.flag;
        this.mData = blockObj.data;
        this.pSequence = 0;
        this.pSequence_next = 0xC + align(blockObj.id.length + 1, 4);
    }

    // These are intended to be overridden by subclasses 
    abstract do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void;
    do_begin() { this.mAdaptor.adaptor_do_begin(this); }
    do_end() { this.mAdaptor.adaptor_do_end(this); }

    // Done updating this frame. Compute our variable data (i.e. interpolate) and send to the game object.
    do_wait(frameCount: number) {
        this.mAdaptor.adaptor_updateVariableValue(this, frameCount);
        this.mAdaptor.adaptor_do_update(this, frameCount);
    }
    // do_data(void const*, u32, void const*, u32) {}

    getStatus() { return this.mStatus; }
    isSuspended(): boolean {
        return this.mSuspendFrames > 0;
    }

    forward(frameCount: number): boolean {
        let hasWaited = false;
        while (true) {
            // Top bit of mFlags makes this object immediately inactive, restarting any existing sequence
            if (this.mFlags & 0x8000) {
                if (this.mStatus != TEStatus.INACTIVE) {
                    this.mStatus = TEStatus.INACTIVE;
                    if (this.mIsSequence) {
                        this.do_end();
                    }
                }
                return true;
            }

            if (this.mStatus == TEStatus.INACTIVE) {
                assert(this.mIsSequence);
                this.do_begin();
                this.mStatus = TEStatus.WAIT;
            }

            if ((this.mControl && this.mControl.mIsSuspended) || this.isSuspended()) {
                if (this.mIsSequence) {
                    assert((this.mStatus == TEStatus.WAIT) || (this.mStatus == TEStatus.SUSPEND));
                    this.mStatus = TEStatus.SUSPEND;
                    this.do_wait(frameCount);
                }
                return true;
            }

            while (true) {
                this.pSequence = this.pSequence_next;

                // If there is nothing left in the sequence, end it
                if (!this.pSequence) {
                    if (this.mIsSequence) {
                        assert(this.mStatus != TEStatus.STILL);
                        if (!hasWaited) {
                            this.do_wait(0);
                        }
                        this.mIsSequence = false;
                        this.mStatus = TEStatus.END;
                        this.do_end();
                    }
                    return false;
                }

                // If we're not currently running a sequence, start it
                if (!this.mIsSequence) {
                    assert(this.mStatus == TEStatus.STILL);
                    this.mIsSequence = true;
                    this.do_begin();
                }

                this.mStatus = TEStatus.WAIT;

                if (this.mWait == 0) {
                    this.process_sequence();
                    if (this.mWait == 0) {
                        break;
                    }
                }
                assert(this.mWait > 0);

                hasWaited = true;
                if (frameCount >= this.mWait) {
                    const wait = this.mWait;
                    frameCount -= this.mWait;
                    this.mWait = 0;
                    this.do_wait(wait);
                } else {
                    this.mWait -= frameCount;
                    this.do_wait(frameCount);
                    return true;
                }
            }
        }
    }

    private process_sequence() {
        const view = this.mData.view;
        let byteIdx = this.pSequence;

        let cmd = view.getUint8(byteIdx);
        let param = view.getUint32(byteIdx) & 0xFFFFFF;

        let next = 0;
        if (cmd != 0) {
            if (cmd <= 0x7f) {
                next = byteIdx + 4;
            } else {
                next = byteIdx + 4 + param;
            }
        }

        this.pSequence_next = next;

        switch (cmd) {
            case ESequenceCmd.End:
                break;

            case ESequenceCmd.Wait:
                this.mWait = param;
                break;

            case ESequenceCmd.Paragraph:
                byteIdx += 4;
                while (byteIdx < this.pSequence_next) {
                    const para = TParagraph.parse(view, byteIdx);
                    if (para.type <= 0xff) {
                        console.debug('Unsupported paragraph feature: ', para.type);
                        // process_paragraph_reserved_(para.type, para.content, para.param);
                    } else {
                        this.do_paragraph(this.mData, para.dataSize, para.dataOffset, para.type);
                    }
                    byteIdx = para.nextOffset;
                }

                break;

            default:
                console.debug('Unhandled sequence cmd: ', cmd);
                byteIdx += 4;
                break;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Camera
//----------------------------------------------------------------------------------------------------------------------
// TODO: Rename these Enums
const enum Camera_Cmd {
    SET_EYE_X_POS = 0x0015,
    SET_EYE_Y_POS = 0x0016,
    SET_EYE_Z_POS = 0x0017,
    SET_EYE_POS = 0x0018,
    SET_TARGET_X_POS = 0x0019,
    SET_TARGET_Y_POS = 0x001A,
    SET_TARGET_Z_POS = 0x001B,
    SET_TARGET_POS = 0x001C,
    SET_PROJ_FOVY = 0x0026,
    SET_VIEW_ROLL = 0x0027,
    SET_DIST_NEAR = 0x0028,
    SET_DIST_FAR = 0x0029,
    SET_DIST_NEAR_FAR = 0x002A,
}

const enum Camera_Track {
    EYE_X_POS = 0x00,
    EYE_Y_POS = 0x01,
    EYE_Z_POS = 0x02,
    TARGET_X_POS = 0x03,
    TARGET_Y_POS = 0x04,
    TARGET_Z_POS = 0x05,
    PROJ_FOVY = 0x06,
    VIEW_ROLL = 0x07,
    DIST_NEAR = 0x08,
    DIST_FAR = 0x09,
    CAMERA_TRACKS_MAX = 0x0A,
}

export abstract class TCamera extends JStage.TObject {
    JSGFGetType() { return JStage.TEObject.CAMERA; }
    // JSGGetProjectionType() { return true; }
    // JSGSetProjectionType(JStage:: TECameraProjection) { }
    JSGGetProjectionNear() { return 0.0; }
    JSGSetProjectionNear(near: number) { }
    JSGGetProjectionFar() { return Number.MAX_VALUE; }
    JSGSetProjectionFar(far: number) { }
    JSGGetProjectionFovy() { return 0.0 };
    JSGSetProjectionFovy(fovy: number) { };
    JSGGetProjectionAspect() { return 0.0 };
    JSGSetProjectionAspect(aspect: number) { };
    JSGGetProjectionField() { return 0.0 };
    JSGSetProjectionField(field: number) { };
    // JSGGetViewType() { return true; };
    // JSGSetViewType(JStage:: TECameraView) { }
    JSGGetViewPosition(dst: vec3) { vec3.zero(dst); }
    JSGSetViewPosition(v: ReadonlyVec3) { }
    JSGGetViewUpVector(dst: vec3) { vec3.zero(dst); }
    JSGSetViewUpVector(v: ReadonlyVec3) { }
    JSGGetViewTargetPosition(dst: vec3) { vec3.zero(dst); }
    JSGSetViewTargetPosition(v: ReadonlyVec3) { }
    JSGGetViewRoll() { return 0.0 };
    JSGSetViewRoll(roll: number) { };
}

class TCameraAdaptor extends TAdaptor {
    constructor(
        private mStageCam: TCamera
    ) { super(11); }

    adaptor_do_prepare(obj: STBObject): void {
        this.mVariableValues[6].setOutput(this.mStageCam.JSGSetProjectionFovy);
        this.mVariableValues[7].setOutput(this.mStageCam.JSGSetViewRoll);
        this.mVariableValues[8].setOutput(this.mStageCam.JSGSetProjectionNear);
        this.mVariableValues[9].setOutput(this.mStageCam.JSGSetProjectionFar);
    }

    adaptor_do_begin(obj: STBObject): void {
        const camPos = scratchVec3a;
        const targetPos = scratchVec3b;
        this.mStageCam.JSGGetViewPosition(camPos);
        this.mStageCam.JSGGetViewTargetPosition(targetPos);

        vec3.transformMat4(camPos, camPos, obj.mControl.getTransformOnGet());
        vec3.transformMat4(targetPos, targetPos, obj.mControl.getTransformOnGet());

        this.adaptor_setVariableValue_Vec(Camera_Track.EYE_X_POS, camPos);
        this.adaptor_setVariableValue_Vec(Camera_Track.TARGET_X_POS, targetPos);
        this.mVariableValues[6].setValue_immediate(this.mStageCam.JSGGetProjectionFovy());
        this.mVariableValues[7].setValue_immediate(this.mStageCam.JSGGetViewRoll());
        this.mVariableValues[8].setValue_immediate(this.mStageCam.JSGGetProjectionNear());
        this.mVariableValues[9].setValue_immediate(this.mStageCam.JSGGetProjectionFar());
    }

    adaptor_do_end(obj: STBObject): void {
        this.mStageCam.JSGFDisableFlag(1);
    }

    adaptor_do_update(obj: STBObject, frameCount: number): void {
        const camPos = scratchVec3a;
        const targetPos = scratchVec3b;

        this.adaptor_getVariableValue_Vec(camPos, Camera_Track.EYE_X_POS);
        this.adaptor_getVariableValue_Vec(targetPos, Camera_Track.TARGET_X_POS);

        vec3.transformMat4(camPos, camPos, obj.mControl.getTransformOnSet());
        vec3.transformMat4(targetPos, targetPos, obj.mControl.getTransformOnSet());

        this.mStageCam.JSGSetViewPosition(camPos);
        this.mStageCam.JSGSetViewTargetPosition(targetPos);
    }

    adaptor_do_data(unk0: Object, unk1: number, unk2: Object, unk3: number): void {
        // This is not used by TWW. Untested.
        debugger;
    }

    // Custom adaptor functions. These can be called from within TCameraObject::do_paragraph()

    adaptor_do_PARENT(dataOp: TEOperationData, data: number | string, unk0: number): void {
        debugger;
    }

    adaptor_do_PARENT_NODE(dataOp: TEOperationData, data: number | string, unk0: number): void {
        debugger;
    }

    adaptor_do_PARENT_ENABLE(dataOp: TEOperationData, data: number | string, unk0: number): void {
        debugger;
    }
}

class TCameraObject extends STBObject {
    constructor(
        control: TControl,
        blockObj: TBlockObject,
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TCameraAdaptor(stageObj as TCamera)) }

    override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const dataOp = (param & 0x1F) as TEOperationData;
        const cmdType = param >> 5;

        let keyCount = 1;
        let keyIdx;
        let data;

        // Parse the data here instead of deferring to adaptor_setVariableValue, so we don't have to pass along `file`.
        switch (dataOp) {
            case TEOperationData.FUNCVALUE_INDEX: data = file.view.getUint32(dataOffset); break;
            case TEOperationData.FUNCVALUE_NAME:
                data = readString(file.buffer, dataOffset, dataSize);
                console.warn('FUNCVALUE_NAME found! Remove this comment after testing');
                debugger;
                break;
            default: data = file.view.getFloat32(dataOffset);
        }

        switch (cmdType) {
            // Eye position
            case Camera_Cmd.SET_EYE_X_POS: keyIdx = Camera_Track.EYE_X_POS; break;
            case Camera_Cmd.SET_EYE_Z_POS: keyIdx = Camera_Track.EYE_Y_POS; break;
            case Camera_Cmd.SET_EYE_Y_POS: keyIdx = Camera_Track.EYE_Z_POS; break;
            case Camera_Cmd.SET_EYE_POS: keyCount = 3; keyIdx = Camera_Track.EYE_X_POS; break;
                break;

            // Target position
            case Camera_Cmd.SET_TARGET_X_POS: keyIdx = Camera_Track.TARGET_X_POS; break;
            case Camera_Cmd.SET_TARGET_Y_POS: keyIdx = Camera_Track.TARGET_Y_POS; break;
            case Camera_Cmd.SET_TARGET_Z_POS: keyIdx = Camera_Track.TARGET_Z_POS; break;
            case Camera_Cmd.SET_TARGET_POS: keyCount = 3; keyIdx = Camera_Track.TARGET_X_POS; break;

            // Camera params
            case Camera_Cmd.SET_PROJ_FOVY: keyIdx = Camera_Track.PROJ_FOVY; break;
            case Camera_Cmd.SET_VIEW_ROLL: keyIdx = Camera_Track.VIEW_ROLL; break;

            // Near/far distance
            case Camera_Cmd.SET_DIST_NEAR: keyIdx = Camera_Track.DIST_NEAR; break;
            case Camera_Cmd.SET_DIST_FAR: keyIdx = Camera_Track.DIST_FAR; break;
            case Camera_Cmd.SET_EYE_POS: keyCount = 2; keyIdx = Camera_Track.DIST_NEAR; break;

            default:
                console.debug('Unsupported TCamera update: ', cmdType, ' ', dataOp);
                debugger;
                return;
        }

        for (let i = 0; i < keyCount; i++) {
            this.mAdaptor.adaptor_setVariableValue(this, keyIdx + i, dataOp, (data as number) + i);
        }
    }
}


//----------------------------------------------------------------------------------------------------------------------
// Parsing helpers
//----------------------------------------------------------------------------------------------------------------------
// @TODO: Rename
class Reader {
    buffer: ArrayBufferSlice;
    view: DataView;
    offset: number;

    constructor(buffer: ArrayBufferSlice, offset: number) {
        this.buffer = buffer.subarray(offset);
        this.view = this.buffer.createDataView();
        this.offset = 0;
    }
}

class TParagraph {
    type: number;
    dataSize: number;
    dataOffset: number;
    nextOffset: number;

    static parse(view: DataView, byteIdx: number): TParagraph {
        // The top bit of the paragraph determines if the type and size are 16 bit (if set), or 32 (if not set)
        let dataSize = view.getUint16(byteIdx);
        let type;
        let offset;

        if ((dataSize & 0x8000) == 0) {
            // 16 bit data
            type = view.getUint16(byteIdx + 2);
            offset = 4;
        } else {
            // 32 bit data
            dataSize = view.getUint32(byteIdx + 0) & ~0x80000000;
            type = view.getUint32(byteIdx + 4);
            offset = 8;
        }

        if (dataSize == 0) {
            return { dataSize, type, dataOffset: 0, nextOffset: byteIdx + offset };
        } else {
            return { dataSize, type, dataOffset: byteIdx + offset, nextOffset: byteIdx + offset + align(dataSize, 4) };
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// FVB (Function Value Binary) Parsing
// Although embedded in the STB file, the FVB section is treated and parsed like a separate file
//----------------------------------------------------------------------------------------------------------------------
namespace FVB {
    enum EFuncValType {
        None = 0,
        Composite = 1,
        Constant = 2,
        Transition = 3,
        List = 4,
        ListParameter = 5,
        Hermite = 6,
    };

    enum EPrepareOp {
        None = 0x00,
        Data = 0x01,
        ObjSetByName = 0x10,
        ObjSetByIdx = 0x11,
        RangeSet = 0x12,
        RangeProgress = 0x13,
        RangeAdjust = 0x14,
        RangeOutside = 0x15,
        InterpSet = 0x16,
    };

    class TBlock {
        size: number;
        type: number;
        id: string;
        dataOffset: number;
    };

    export abstract class TFunctionValue {
        protected range?: Attribute.Range;
        protected refer?: Attribute.Refer;
        protected interpolate?: Attribute.Interpolate;

        abstract getType(): EFuncValType;
        abstract prepare(): void;
        abstract getValue(arg: number): number;

        getAttrRange() { return this.range; }
        getAttrRefer() { return this.refer; }
        getAttrInterpolate() { return this.interpolate; }

        // static ExtrapolateParameter toFunction_outside(int);

        // static ExtrapolateParameter toFunction(TFunctionValue::TEOutside outside) {
        //     return toFunction_outside(outside);
        // }
    }

    export abstract class TObject {
        public funcVal: TFunctionValue;
        public id: string;

        constructor(block: TBlock) {
            this.id = block.id;
        }

        abstract prepare_data(para: TParagraph, control: TControl, file: Reader): void;

        prepare(block: TBlock, mControl: TControl, file: Reader) {
            const blockNext = file.offset + block.size;
            file.offset = blockNext;

            let pOffset = block.dataOffset;
            while (pOffset < blockNext) {
                const para = TParagraph.parse(file.view, pOffset);
                switch (para.type) {
                    case EPrepareOp.None:
                        this.funcVal.prepare();
                        assert(para.nextOffset == blockNext);
                        return;

                    case EPrepareOp.Data:
                        this.prepare_data(para, mControl, file);
                        break;

                    case EPrepareOp.RangeSet:
                        assert(para.dataSize == 8);
                        const range = this.funcVal.getAttrRange();
                        assert(!!range, 'FVB Paragraph assumes TObject has range attribute, but it does not');
                        const begin = file.view.getFloat32(para.dataOffset + 0);
                        const end = file.view.getFloat32(para.dataOffset + 4);
                        range.set(begin, end);
                        break;

                    case EPrepareOp.InterpSet:
                        assert(para.dataSize == 4);
                        const interp = this.funcVal.getAttrInterpolate();
                        assert(!!interp, 'FVB Paragraph assumes TObject has interpolate attribute, but it does not');
                        const interpType = file.view.getUint32(para.dataOffset + 0);
                        interp.set(interpType);
                        break;

                    case EPrepareOp.ObjSetByName:
                    case EPrepareOp.ObjSetByIdx:

                    case EPrepareOp.RangeProgress:
                    case EPrepareOp.RangeAdjust:
                    case EPrepareOp.RangeOutside:

                    default:
                        console.warn('Unhandled FVB PrepareOp: ', para.type);
                        debugger;
                }
                pOffset = para.nextOffset;
            }

            assert(pOffset == blockNext);
            this.funcVal.prepare();
        }
    }

    export class TControl {
        public mObjects: TObject[] = [];

        // Really this is a fvb::TFactory method
        public createObject(block: TBlock): TObject | undefined {
            switch (block.type) {
                // case EFuncValType.Composite:
                //     return new TObject_composite(block);
                // case EFuncValType.Constant:
                //     return new TObject_constant(block);
                // case EFuncValType.Transition:
                //     return new TObject_transition(block);
                // case EFuncValType.List:
                //     return new TObject_list(block);
                case EFuncValType.ListParameter:
                    return new TObject_ListParameter(block);
                // case EFuncValType.Hermite:
                //     return new TObject_hermite(block);
                default:
                    console.warn('Unknown FVB type: ', block.type);
                    return undefined;
            }
        }

        public destroyObject_all() {
            this.mObjects = [];
        }
    }

    export class TParse {
        constructor(
            private mControl: TControl
        ) { }

        private parseBlock(file: Reader, flags: number): boolean {
            const idLen = file.view.getUint16(file.offset + 6);
            const block: TBlock = {
                size: file.view.getUint32(file.offset + 0),
                type: file.view.getUint16(file.offset + 4),
                id: readString(file.buffer, file.offset + 8, idLen),
                dataOffset: file.offset + align(8 + idLen, 4),
            }

            console.log('Parsing Block:', block.id, block.size, block.type);

            const obj = this.mControl.createObject(block);
            if (!obj) { return false; }

            obj.prepare(block, this.mControl, file);
            this.mControl.mObjects.push(obj);

            return true;
        }

        public parse(data: ArrayBufferSlice, flags: number) {
            const view = data.createDataView();
            let fourCC = readString(data, 0, 4);
            let byteOrder = view.getUint16(0x04);
            let version = view.getUint16(0x06);
            let blockCount = view.getUint32(0x0C);
            assert(fourCC === 'FVB');
            assert(byteOrder == 0xFEFF);
            assert(version >= 2 && version <= 256); // As of Wind Waker

            const blockReader = new Reader(data, 16);
            for (let i = 0; i < blockCount; i++) {
                this.parseBlock(blockReader, flags);
            }
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FV Attributes
    //----------------------------------------------------------------------------------------------------------------------
    enum EInterpolateType {
        None = 0,
        Linear = 1,
        Plateau = 2,
        BSpline = 3
    }
    namespace Attribute {
        export class Range {
            private begin: number = 0;
            private end: number = 0;
            private diff: number = 0;

            private progress: number = 0;
            private adjust: number = 0;

            prepare() {
                // Progress updated here
            }

            set(begin: number, end: number) {
                this.begin = begin;
                this.end = end;
                this.diff = end - begin;
                assert(this.diff >= 0);
            }

            getParameter(time: number, startTime: number, endTime: number): number {
                // @NOTE: Does not currently support, Progress, Adjust, or Outside modifications. These can only be set
                //        in an FVB paragraph, so attempt to set them will be caught in FVB.TObject.prepare().
                return time;
            }
        }

        export class Refer {
        }

        export class Interpolate {
            private type = EInterpolateType.None;
            prepare() { }
            set(type: EInterpolateType) { this.type = type; }
            get() { return this.type; }

            static Linear(t: number, t0: number, v0: number, t1: number, v1: number) {
                return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
            }

            static BSpline_Nonuniform(t: number, controlPoints: Float64Array, knotVector: Float64Array) {
                const knot0 = knotVector[0];
                const knot1 = knotVector[1];
                const knot2 = knotVector[2];
                const knot3 = knotVector[3];
                const knot4 = knotVector[4];
                const knot5 = knotVector[5];
                const diff0 = t - knot0;
                const diff1 = t - knot1;
                const diff2 = t - knot2;
                const diff3 = knot3 - t;
                const diff4 = knot4 - t;
                const diff5 = knot5 - t;
                const inverseDeltaKnot32 = 1 / (knot3 - knot2);
                const blendFactor3 = (diff3 * inverseDeltaKnot32) / (knot3 - knot1);
                const blendFactor2 = (diff2 * inverseDeltaKnot32) / (knot4 - knot2);
                const blendFactor1 = (diff3 * blendFactor3) / (knot3 - knot0);
                const blendFactor4 = ((diff1 * blendFactor3) + (diff4 * blendFactor2)) / (knot4 - knot1);
                const blendFactor5 = (diff2 * blendFactor2) / (knot5 - knot2);
                const term1 = diff3 * blendFactor1;
                const term2 = (diff0 * blendFactor1) + (diff4 * blendFactor4);
                const term3 = (diff1 * blendFactor4) + (diff5 * blendFactor5);
                const term4 = diff2 * blendFactor5;

                return (term1 * controlPoints[0]) + (term2 * controlPoints[1]) + (term3 * controlPoints[2]) + (term4 * controlPoints[3]);
            }
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValues
    //----------------------------------------------------------------------------------------------------------------------
    class FunctionValue_ListParameter extends TFunctionValue {
        protected override range = new Attribute.Range();
        protected override interpolate = new Attribute.Interpolate();

        // Each key contains 2 floats, a time and value
        private keyCount: number = 0;
        private keys: Float32Array;
        private curKeyIdx: number;
        private interpFunc: (t: number) => number;

        prepare(): void {
            this.range.prepare();
            this.interpolate.prepare();

            const interp = this.interpolate.get();
            switch (interp) {
                case EInterpolateType.None:
                    debugger; break; // Untested. Remove after confirmed working.
                case EInterpolateType.Linear:
                    debugger; break; // Untested. Remove after confirmed working.
                case EInterpolateType.Plateau:
                    debugger; break; // Untested. Remove after confirmed working.
                case EInterpolateType.BSpline:
                    if (this.keyCount > 2) { this.interpFunc = this.interpolateBSpline; }
                    else {
                        this.interpFunc = this.interpolateLinear;
                        debugger; // Untested. Remove after confirmed working.
                    }
                    break;

                default:
                    console.warn('Invalid EInterp value', interp);
            }
        }

        set_data(values: Float32Array) {
            this.keys = values;
            this.keyCount = values.length / 2;
            this.curKeyIdx = 0;
        }

        getType() { return EFuncValType.ListParameter; }
        getStartTime() { return this.keys[0]; }
        getEndTime(): number { return this.keys[this.keys.length - 2]; }

        // Interpolate between our keyframes, given the current time
        getValue(timeSec: number): number {
            // Remap (if requested) the time to our range
            const t = this.range.getParameter(timeSec, this.getStartTime(), this.getEndTime());

            // Update our current key. If the current time is between keys, select the later one.
            this.curKeyIdx = this.keys.findIndex((k, i) => (i % 2) == 0 && k >= t) / 2;

            if (this.curKeyIdx == 0) { // Time is at or before the start, return the first key
                return this.keys[this.curKeyIdx * 2 + 1];
            } else if (this.curKeyIdx < 0) { // Time is at or after the end, return the last key
                this.curKeyIdx = this.keyCount - 1;
                return this.keys[this.curKeyIdx * 2 + 1];
            }

            const value = this.interpFunc(t);
            if (isNaN(value)) {
                console.warn('NaN generated by FunctionValue');
                debugger;
            }

            return value;
        }

        // @TODO: Better way of accessing 2-word keys
        interpolateBSpline(t: number): number {
            const controlPoints = new Float64Array(4);
            const knotVector = new Float64Array(6);
            controlPoints[1] = this.keys[this.curKeyIdx * 2 - 1];
            controlPoints[2] = this.keys[this.curKeyIdx * 2 + 1];
            knotVector[2] = this.keys[this.curKeyIdx * 2 + -2];
            knotVector[3] = this.keys[this.curKeyIdx * 2 + 0];

            const keysBefore = this.curKeyIdx;
            const keysAfter = this.keyCount - this.curKeyIdx;

            switch (keysBefore) {
                case 1:
                    controlPoints[0] = 2.0 * controlPoints[1] - controlPoints[2];
                    controlPoints[3] = this.keys[this.curKeyIdx * 2 + 3];
                    knotVector[4] = this.keys[this.curKeyIdx * 2 + 2];
                    knotVector[1] = 2.0 * knotVector[2] - knotVector[3];
                    knotVector[0] = 2.0 * knotVector[2] - knotVector[4];
                    switch (keysAfter) {
                        case 1:
                        case 2:
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            knotVector[5] = this.keys[this.curKeyIdx * 2 + 4];
                            break;
                    }
                    break;
                case 2:
                    controlPoints[0] = this.keys[this.curKeyIdx * 2 + -3];
                    knotVector[1] = this.keys[this.curKeyIdx * 2 + -4];
                    knotVector[0] = 2.0 * knotVector[1] - knotVector[2];
                    switch (keysAfter) {
                        case 1:
                            controlPoints[3] = 2.0 * controlPoints[2] - controlPoints[1];
                            knotVector[4] = 2.0 * knotVector[3] - knotVector[2];
                            knotVector[5] = 2.0 * knotVector[3] - knotVector[1];
                            break;
                        case 2:
                            controlPoints[3] = this.keys[this.curKeyIdx * 2 + 3];
                            knotVector[4] = this.keys[this.curKeyIdx * 2 + 2];
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            controlPoints[3] = this.keys[this.curKeyIdx * 2 + 3];
                            knotVector[4] = this.keys[this.curKeyIdx * 2 + 2];
                            knotVector[5] = this.keys[this.curKeyIdx * 2 + 4];
                    }
                    break;
                default:
                    controlPoints[0] = this.keys[this.curKeyIdx * 2 + -3];
                    knotVector[1] = this.keys[this.curKeyIdx * 2 + -4];
                    knotVector[0] = this.keys[this.curKeyIdx * 2 + -6];
                    switch (keysAfter) {
                        case 1:
                            controlPoints[3] = 2.0 * controlPoints[2] - controlPoints[1];
                            knotVector[4] = 2.0 * knotVector[3] - knotVector[2];
                            knotVector[5] = 2.0 * knotVector[3] - knotVector[1];
                            break;
                        case 2:
                            controlPoints[3] = this.keys[this.curKeyIdx * 2 + 3];
                            knotVector[4] = this.keys[this.curKeyIdx * 2 + 2];
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            controlPoints[3] = this.keys[this.curKeyIdx * 2 + 3];
                            knotVector[4] = this.keys[this.curKeyIdx * 2 + 2];
                            knotVector[5] = this.keys[this.curKeyIdx * 2 + 4];
                            break;
                    }
                    break;
            }

            return Attribute.Interpolate.BSpline_Nonuniform(t, controlPoints, knotVector);
        }

        interpolateLinear(t: number) {
            const ks = this.keys;
            const c = this.curKeyIdx;
            return Attribute.Interpolate.Linear(t, ks[c - 2], ks[c - 1], ks[c + 0], ks[c + 1]);
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FVB Objects
    // Manages a FunctionValue.  
    //----------------------------------------------------------------------------------------------------------------------
    class TObject_ListParameter extends FVB.TObject {
        override funcVal = new FunctionValue_ListParameter;

        override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize >= 8);
            // Each Key contains 2 floats, a time and value
            const keyCount = file.view.getUint32(para.dataOffset + 0);
            const keys = file.buffer.createTypedArray(Float32Array, para.dataOffset + 4, keyCount * 2, Endianness.BIG_ENDIAN);
            this.funcVal.set_data(keys);
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// STB Parsing
//----------------------------------------------------------------------------------------------------------------------
enum ESequenceCmd {
    End = 0,
    SetFlag = 1,
    Wait = 2,
    Skip = 3,
    Suspend = 4,
    Paragraph = 0x80,
}

enum TEStatus {
    STILL = 0,
    END = 1 << 0,
    WAIT = 1 << 1,
    SUSPEND = 1 << 2,
    INACTIVE = 1 << 3,
}

// The runtime object that stores interpolated data each frame. Written to by a TAdapter. By default, the base object
// is empty and can get or set no data. JSystem expects each game to provide implementations of the TObject interface
// which are provided by a JStage:TSystem override
export abstract class TBlockObject {
    /* 0x0 */ size: number;
    /* 0x4 */ type: string; // char[4] JMSG, JSND, JACT, ...
    /* 0x8 */ flag: number;
    /* 0xA    id_size: number*
    /* 0xC */ id: string;
    /* 0xC + align(id_size, 4) */ data: Reader;
}

// This combines JStudio::TControl and JStudio::stb::TControl into a single class, for simplicity.
export class TControl {
    private mSystem: TSystem;
    public mFvbControl = new FVB.TControl();
    public mSecondsPerFrame: number;
    public mIsSuspended = false;

    private mTransformOrigin?: vec3;
    private mTransformRotY?: number;
    private mTransformOnGetMtx = mat4.create();
    private mTransformOnSetMtx = mat4.create();

    private mStatus: TEStatus = TEStatus.STILL;
    private mObjects: STBObject[] = [];

    constructor(system: TSystem) {
        this.mSystem = system;
        this.mSecondsPerFrame = 1 / 30.0; // @TODO: Allow the game to change this?
    }

    public isSuspended() { return this.mIsSuspended; }

    public isTransformEnabled() { return !!this.mTransformOrigin; }
    public getTransformOnSet() { return this.mTransformOnSetMtx; }
    public getTransformOnGet() { return this.mTransformOnGetMtx; }
    public transformSetOrigin(originPos: vec3, rotY: number) {
        this.mTransformOrigin = originPos;
        this.mTransformRotY = rotY;

        // The "OnGet" matrix transforms from world space into demo space
        mat4.fromYRotation(this.mTransformOnGetMtx, -rotY);
        mat4.translate(this.mTransformOnGetMtx, this.mTransformOnGetMtx, vec3.negate(scratchVec3a, originPos));

        // The "OnSet" matrix is the inverse 
        mat4.fromTranslation(this.mTransformOnSetMtx, originPos);
        mat4.rotateY(this.mTransformOnSetMtx, this.mTransformOnSetMtx, rotY);
    }

    public forward(flags: number): boolean {
        let shouldContinue = false;
        let andStatus = 0xFF;
        let orStatus = 0;

        for (let obj of this.mObjects) {
            const res = obj.forward(flags);
            shouldContinue ||= res;

            const objStatus = obj.getStatus();
            andStatus &= objStatus;
            orStatus |= objStatus;
        }

        this.mStatus = (andStatus | (orStatus << 0x10));
        return shouldContinue;
    }

    public getFunctionValueByIdx(idx: number) { return this.mFvbControl.mObjects[idx]?.funcVal; }
    public getFunctionValueByName(name: string) { return this.mFvbControl.mObjects.find(v => v.id == name)?.funcVal; }

    // Really this is a stb::TFactory method
    public createObject(blockObj: TBlockObject): STBObject | undefined {
        let objConstructor;
        let objType: JStage.TEObject;
        switch (blockObj.type) {
            case 'JCMR': objConstructor = TCameraObject; objType = JStage.TEObject.CAMERA; break;
            case 'JACT':
            case 'JABL':
            case 'JLIT':
            case 'JFOG':
            default:
                return undefined;
        }

        const stageObj = this.mSystem.JSGFindObject(blockObj.id, objType);
        if (!stageObj) {
            return undefined;
        }

        const obj = new objConstructor(this, blockObj, stageObj);
        obj.mAdaptor.adaptor_do_prepare(obj);
        this.mObjects.push(obj);
        return obj;
    }

    public destroyObject_all() {
        this.mObjects = [];
        this.mFvbControl.destroyObject_all();
    }
}

export class TParse {
    constructor(
        private mControl: TControl,
        private mFvbParse = new FVB.TParse(mControl.mFvbControl)
    ) { }

    // Parse an entire scene's worth of object sequences at once
    private parseBlockObject(file: Reader, flags: number) {
        const blockObj: TBlockObject = {
            size: file.view.getUint32(0),
            type: readString(file.buffer, file.offset + 4, 4),
            flag: file.view.getUint16(8),
            id: readString(file.buffer, 12, file.view.getUint16(10)),
            data: file
        }

        const blockTypeNum = file.view.getInt32(4);
        if (blockTypeNum == -1) {
            console.debug('Unhandled STB block type: -1');
            debugger; // Remove after implementing and testing
        }

        if (flags & 0x10) {
            console.debug('Unhandled flag during parseBlockObject: 0x10');
            return true;
        }

        if (flags & 0x20) {
            console.debug('Unhandled flag during parseBlockObject: 0x20');
            return true;
        }

        const obj = this.mControl.createObject(blockObj);
        if (!obj) {
            if (flags & 0x40) {
                console.debug('Unhandled flag during parseBlockObject: 0x40');
                return true;
            }
            console.debug('Unhandled STB block type: ', blockObj.type);
            return false;
        }

        return true;
    }

    // Parse all the TBlocks from an STB file. Blocks can either contain STBObjects, or FVB (function value) data. 
    // All objects will be created, they can be modified by using TControl.   
    public parse(data: ArrayBufferSlice, flags: number) {
        const file = new JSystemFileReaderHelper(data);

        // Parse the THeader
        let byteOrder = file.view.getUint16(0x04);
        let version = file.view.getUint16(0x06);
        let targetVersion = file.view.getUint16(0x1E);
        assert(file.magic === 'STB');
        assert(version >= 1 && version <= 3); // As of Wind Waker, only versions 1-3 supported. TP seems to support <7, but untested.
        assert(targetVersion >= 2 && targetVersion <= 3); // As of Wind Waker, only version 2-3 is supported
        assert(byteOrder == 0xFEFF);

        let byteIdx = file.offs;
        for (let i = 0; i < file.numChunks; i++) {
            const blockSize = file.view.getUint32(byteIdx + 0);
            const blockType = readString(file.buffer, byteIdx + 4, 4);

            if (blockType == 'JFVB') {
                this.mFvbParse.parse(file.buffer.subarray(byteIdx + 8, blockSize - 8), flags)
            } else {
                this.parseBlockObject(new Reader(file.buffer, byteIdx), flags);
            }

            byteIdx += blockSize;
        }

        return true;
    }
}