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
const scratchVec3c = vec3.create();

//----------------------------------------------------------------------------------------------------------------------
// Stage Objects
// These are created an managed by the game. Each Stage Object has a corresponding STB Object, connected by an Adaptor. 
// The STB objects are manipulated by Sequences from the STB file each frame, and update the Stage Object via Adaptor.
//----------------------------------------------------------------------------------------------------------------------
export namespace JStage {
    export enum TEObject {
        PREEXISTING_ACTOR = 0x0,
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
        JSGGetName(): boolean { return false; }
        JSGGetFlag(): number { return 0; }
        JSGSetFlag(flag: number): void { }
        JSGGetData(unk0: number, data: Object, unk1: number): boolean { return false; }
        JSGSetData(id: number, data: DataView): void { }
        JSGGetParent(parentDst: JStage.TObject, unk: { x: number }): void { }
        JSGSetParent(parent: JStage.TObject | null, unk: number): void { }
        JSGSetRelation(related: boolean, obj: JStage.TObject, unk: number): void { }
        JSGFindNodeID(id: string): number { return -1; }
        JSGGetNodeTransformation(nodeId: number, mtx: mat4): number {
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
    public setValue_none() {
        this.mUpdateFunc = undefined;
    }

    // Value will be set only on next update 
    setValue_immediate(v: number): void {
        assert(v !== undefined);
        this.mUpdateFunc = TVariableValue.update_immediate;
        this.mAge = 0;
        this.mUpdateParam = v;
    }

    // Value will be set to (mAge * v * x) each frame
    setValue_time(v: number): void {
        assert(v !== undefined);
        this.mUpdateFunc = TVariableValue.update_time;
        this.mAge = 0;
        this.mUpdateParam = v;
    }

    // Value will be the result of a Function Value each frame
    setValue_functionValue(v?: FVB.TFunctionValue): void {
        assert(v !== undefined);
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
const enum EDataOp {
    NONE = 0,
    VOID = 1, // Disable updates for this track.
    IMMEDIATE = 2, // Set the value on this track to an immediate value.
    TIME = 3, // The value increases each frame by a given velocity, starting at 0.
    FUNCVALUE_NAME = 0x10, // Evaluate a FunctionValue each frame and use the result
    FUNCVALUE_INDEX = 0x12, // Same as FUNCVALUE_NAME but by FunctionValue index
    OBJECT_NAME = 0x18, // Set the value directly on the JStage object (e.g. an actor), don't store in the adaptor 
    OBJECT_INDEX = 0x19, // Same as OBJECT_NAME, but by object index
};

class DataVal {
    asInt?: number;
    asFloat?: number;
    asStr?: string;
}

function dataOpToString(enumValue: EDataOp) {
    switch (enumValue) {
        case EDataOp.NONE: return "None"
        case EDataOp.VOID: return "Void"
        case EDataOp.IMMEDIATE: return "Immediate"
        case EDataOp.TIME: return "Time"
        case EDataOp.FUNCVALUE_NAME: return "FuncVal"
        case EDataOp.FUNCVALUE_INDEX: return "FuncVal"
        case EDataOp.OBJECT_NAME: return "Obj"
        case EDataOp.OBJECT_INDEX: return "Obj"
    }
}

function logKeyAction(keyData: DataVal[], dataOp: number ) {
    const vals = keyData.map(d => {
        switch (dataOp) {
            case EDataOp.FUNCVALUE_INDEX:
            case EDataOp.OBJECT_INDEX:
                return d.asInt;
            case EDataOp.FUNCVALUE_NAME:
            case EDataOp.OBJECT_NAME:
                return d.asStr;
            default: 
                return d.asFloat;
        }} );
    return vals;
}

// Parse data from a DataView as either a number or a string, based on the dataOp
function readData(dataOp: EDataOp, dataOffset: number, dataSize: number, file: Reader): DataVal {
    switch (dataOp) {
        case EDataOp.IMMEDIATE:
        case EDataOp.TIME:
            return { asInt: file.view.getUint32(dataOffset), asFloat: file.view.getFloat32(dataOffset) };

        case EDataOp.FUNCVALUE_INDEX:
        case EDataOp.OBJECT_INDEX:
            return { asInt: file.view.getUint32(dataOffset) };

        case EDataOp.FUNCVALUE_NAME:
        case EDataOp.OBJECT_NAME:
            return { asStr: readString(file.buffer, dataOffset, dataSize) };

        default:
            assert(false, 'Unsupported data operation');
    }
}

abstract class TAdaptor {
    constructor(
        public mCount: number,
        public mVariableValues = nArray(mCount, i => new TVariableValue()),
    ) { }

    abstract adaptor_do_prepare(obj: STBObject): void;
    abstract adaptor_do_begin(obj: STBObject): void;
    abstract adaptor_do_end(obj: STBObject): void;
    abstract adaptor_do_update(obj: STBObject, frameCount: number): void;
    abstract adaptor_do_data(obj: STBObject, id: number, data: DataView): void;

    // Set a single VariableValue update function, with the option of using FuncVals 
    adaptor_setVariableValue(obj: STBObject, keyIdx: number, dataOp: EDataOp, data: DataVal) {
        const varval = this.mVariableValues[keyIdx];
        const control = obj.mControl;

        switch (dataOp) {
            case EDataOp.VOID: varval.setValue_none(); break;
            case EDataOp.IMMEDIATE: varval.setValue_immediate(data.asFloat!); break;
            case EDataOp.TIME: varval.setValue_time(data.asFloat!); break;
            case EDataOp.FUNCVALUE_NAME: varval.setValue_functionValue(control.getFunctionValueByName(data.asStr!)); break;
            case EDataOp.FUNCVALUE_INDEX: varval.setValue_functionValue(control.getFunctionValueByIdx(data.asInt!)); break;
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

    constructor(control: TControl, blockObj?: TBlockObject, adaptor?: TAdaptor) {
        this.mControl = control;

        if (blockObj && adaptor) {
            this.mAdaptor = adaptor;

            this.mId = blockObj.id;
            this.mType = blockObj.type;
            this.mFlags = blockObj.flag;
            this.mData = blockObj.data;
            this.pSequence = 0;
            this.pSequence_next = 0xC + align(blockObj.id.length + 1, 4);
        }
    }

    // These are intended to be overridden by subclasses 
    abstract do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void;
    do_begin() { if (this.mAdaptor) this.mAdaptor.adaptor_do_begin(this); }
    do_end() { if (this.mAdaptor) this.mAdaptor.adaptor_do_end(this); }

    // Done updating this frame. Compute our variable data (i.e. interpolate) and send to the game object.
    do_wait(frameCount: number) {
        if (this.mAdaptor) this.mAdaptor.adaptor_updateVariableValue(this, frameCount);
        if (this.mAdaptor) this.mAdaptor.adaptor_do_update(this, frameCount);
    }
    do_data(id: number, data: DataView) { if (this.mAdaptor) this.mAdaptor.adaptor_do_data(this, id, data); }

    getStatus() { return this.mStatus; }
    getSuspendFrames(): number { return this.mSuspendFrames; }
    isSuspended(): boolean { return this.mSuspendFrames > 0; }
    setSuspend(frameCount: number) { this.mSuspendFrames = frameCount; }

    reset(blockObj: TBlockObject) {
        this.pSequence = 0;
        this.mStatus = TEStatus.STILL;
        this.pSequence_next = 0xC + align(blockObj.id.length + 1, 4);
        this.mData = blockObj.data;
        this.mWait = 0;
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

            if ((this.mControl && this.mControl.isSuspended()) || this.isSuspended()) {
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

            case ESequenceCmd.SetFlag:
                debugger; // Untested. Remove after confirmed working.
                break;

            case ESequenceCmd.Wait:
                this.mWait = param;
                break;

            case ESequenceCmd.Skip:
                debugger; // Untested. Remove after confirmed working.
                break;

            case ESequenceCmd.Suspend:
                this.mSuspendFrames += param;
                break;

            case ESequenceCmd.Paragraph:
                byteIdx += 4;
                while (byteIdx < this.pSequence_next) {
                    const para = TParagraph.parse(view, byteIdx);
                    if (para.type <= 0xff) {
                        this.process_paragraph_reserved_(this.mData, para.dataSize, para.dataOffset, para.type);
                    } else {
                        this.do_paragraph(this.mData, para.dataSize, para.dataOffset, para.type);
                    }
                    byteIdx = para.nextOffset;
                }

                break;

            default:
                console.debug('Unsupported sequence cmd: ', cmd);
                debugger;
                byteIdx += 4;
                break;
        }
    }

    private process_paragraph_reserved_(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        switch (param) {
            case 0x1: debugger; break;
            case 0x2: debugger; break;
            case 0x3: debugger; break;
            case 0x80: debugger; break;
            case 0x81:
                const idSize = file.view.getUint16(dataOffset + 2);
                assert(idSize == 4);
                const id = file.view.getUint32(dataOffset + 4);
                const contentOffset = dataOffset + 4 + align(idSize, 4);
                const contentSize = dataSize - (contentOffset - dataOffset);
                const content = file.buffer.createDataView(contentOffset, contentSize);
                this.do_data(id, content);
                break;

            case 0x82:
                break;
        }
    }
}

class TControlObject extends STBObject {
    constructor(control: TControl) {
        super(control)
    }

    override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void { }
}


//----------------------------------------------------------------------------------------------------------------------
// Actor
//----------------------------------------------------------------------------------------------------------------------
const enum Actor_ValIdx {
    ANIM_FRAME = 0,
    ANIM_TRANSITION = 1,
    ANIM_TEX_FRAME = 2,

    POS_X = 3,
    POS_Y = 4,
    POS_Z = 5,
    ROT_X = 6,
    ROT_Y = 7,
    ROT_Z = 8,
    SCALE_X = 9,
    SCALE_Y = 10,
    SCALE_Z = 11,

    PARENT = 12,
    RELATION = 13,
}

function keyToString(enumValue: Actor_ValIdx, count: number) {
    switch (enumValue) {
        case Actor_ValIdx.ANIM_FRAME: return "ANIM_FRAME"
        case Actor_ValIdx.ANIM_TRANSITION: return "ANIM_TRANSITION"
        case Actor_ValIdx.ANIM_TEX_FRAME: return "ANIM_TEX_FRAME"
        case Actor_ValIdx.POS_X: return count == 3 ? 'POS' : 'POS_X';
        case Actor_ValIdx.POS_Y: return "POS_Y"
        case Actor_ValIdx.POS_Z: return "POS_Z"
        case Actor_ValIdx.ROT_X: return count == 3 ? 'ROT' : 'ROT_X';
        case Actor_ValIdx.ROT_Y: return "ROT_Y"
        case Actor_ValIdx.ROT_Z: return "ROT_Z"
        case Actor_ValIdx.SCALE_X: return count == 3 ? 'SCALE' : 'SCALE_X';
        case Actor_ValIdx.SCALE_Y: return "SCALE_Y"
        case Actor_ValIdx.SCALE_Z: return "SCALE_Z"
        case Actor_ValIdx.PARENT: return "PARENT"
        case Actor_ValIdx.RELATION: return "RELATION"
    }
}

export abstract class TActor extends JStage.TObject {
    JSGFGetType() { return JStage.TEObject.ACTOR; }
    JSGGetTranslation(dst: vec3) { }
    JSGSetTranslation(src: ReadonlyVec3) { }
    JSGGetScaling(dst: vec3) { }
    JSGSetScaling(src: ReadonlyVec3) { }
    JSGGetRotation(dst: vec3) { }
    JSGSetRotation(src: ReadonlyVec3) { }
    JSGGetShape(): number { return -1; }
    JSGSetShape(x: number): void { }
    JSGGetAnimation(): number { return -1; }
    JSGSetAnimation(x: number): void { }
    JSGGetAnimationFrame(): number { return 0.0; }
    JSGSetAnimationFrame(x: number): void { }
    JSGGetAnimationFrameMax(): number { return 0.0; }
    JSGGetAnimationTransition(): number { return 0.0; }
    JSGSetAnimationTransition(x: number): void { }
    JSGGetTextureAnimation(): number { return -1; }
    JSGSetTextureAnimation(x: number): void { }
    JSGGetTextureAnimationFrame(): number { return 0.0; }
    JSGSetTextureAnimationFrame(x: number): void { }
    JSGGetTextureAnimationFrameMax(): number { return 0.0; }
}

class TActorAdaptor extends TAdaptor {
    public parent?: JStage.TObject;
    public parentNodeID: number;
    public relation?: JStage.TObject;
    public relationNodeID: number;
    public animMode: number; // See computeAnimFrame()
    public animTexMode: number; // See computeAnimFrame()

    public enableLog = true;

    constructor(
        private mSystem: TSystem,
        public mObject: TActor,
    ) { super(14); }

    private static computeAnimFrame(animMode: number, maxFrame: number, frame: number) {
        const outsideType  = animMode;
        const reverse = animMode >> 8;

        if( reverse ) { frame = maxFrame - frame; }
        if (maxFrame > 0.0) {
            const func = FVB.TFunctionValue.toFunction_outside(outsideType);
            frame = func(frame, maxFrame);
        }
        return frame;
    }

    adaptor_do_prepare(obj: STBObject): void {
        this.mVariableValues[Actor_ValIdx.ANIM_TRANSITION].setOutput(this.mObject.JSGSetAnimationTransition.bind(this.mObject));

        this.mVariableValues[Actor_ValIdx.ANIM_FRAME].setOutput((frame: number, adaptor: TAdaptor) => {
            frame = TActorAdaptor.computeAnimFrame(this.animMode, this.mObject.JSGGetAnimationFrameMax(), frame);
            this.mObject.JSGSetAnimationFrame(frame);
        });

        this.mVariableValues[Actor_ValIdx.ANIM_TEX_FRAME].setOutput((frame: number, adaptor: TAdaptor) => {
            frame = TActorAdaptor.computeAnimFrame(this.animTexMode, this.mObject.JSGGetTextureAnimationFrameMax(), frame);
            this.mObject.JSGSetTextureAnimationFrame(frame);
        });
    }

    adaptor_do_begin(obj: STBObject): void {
        this.mObject.JSGFEnableFlag(1);

        const pos = scratchVec3a;
        const rot = scratchVec3b;
        const scale = scratchVec3c;
        this.mObject.JSGGetTranslation(pos);
        this.mObject.JSGGetRotation(rot);
        this.mObject.JSGGetScaling(scale);

        if (obj.mControl.isTransformEnabled()) {
            vec3.transformMat4(pos, pos, obj.mControl.getTransformOnGet());
            rot[1] -= obj.mControl.mTransformRotY!;
        }

        this.adaptor_setVariableValue_Vec(Actor_ValIdx.POS_X, pos);
        this.adaptor_setVariableValue_Vec(Actor_ValIdx.ROT_X, rot);
        this.adaptor_setVariableValue_Vec(Actor_ValIdx.SCALE_X, scale);

        this.mVariableValues[Actor_ValIdx.ANIM_TRANSITION].setValue_immediate(this.mObject.JSGGetAnimationTransition());
        this.mVariableValues[Actor_ValIdx.ANIM_FRAME].setValue_immediate(this.mObject.JSGGetAnimationFrame());
        this.mVariableValues[Actor_ValIdx.ANIM_FRAME].setValue_immediate(this.mObject.JSGGetTextureAnimationFrame());
    }

    adaptor_do_end(obj: STBObject): void {
        this.mObject.JSGFDisableFlag(1);
    }

    adaptor_do_update(obj: STBObject, frameCount: number): void {
        const pos = scratchVec3a;
        const rot = scratchVec3b;
        const scale = scratchVec3c;
        this.adaptor_getVariableValue_Vec(pos, Actor_ValIdx.POS_X);
        this.adaptor_getVariableValue_Vec(rot, Actor_ValIdx.ROT_X);
        this.adaptor_getVariableValue_Vec(scale, Actor_ValIdx.SCALE_X);

        if (obj.mControl.isTransformEnabled()) {
            vec3.transformMat4(pos, pos, obj.mControl.getTransformOnSet());
            rot[1] += obj.mControl.mTransformRotY!;
        }

        this.mObject.JSGSetTranslation(pos);
        this.mObject.JSGSetRotation(rot);
        this.mObject.JSGSetScaling(scale);
    }

    adaptor_do_data(obj: STBObject, id: number, data: DataView): void {
        if (this.enableLog) console.debug('SetData: (id)', id);
        this.mObject.JSGSetData(id, data);
    }

    adaptor_do_PARENT(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.OBJECT_NAME);
        if (this.enableLog) console.debug('SetParent:', data.asStr);
        this.parent = this.mSystem.JSGFindObject(data.asStr!, JStage.TEObject.PREEXISTING_ACTOR);
    }

    adaptor_do_PARENT_NODE(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        debugger;
        if (this.enableLog) console.debug('SetParentNode:', data);
        switch (dataOp) {
            case EDataOp.OBJECT_NAME:
                if (this.parent)
                    this.parentNodeID = this.parent.JSGFindNodeID(data.asStr!);
                break;
            case EDataOp.OBJECT_INDEX:
                this.parentNodeID = data.asInt!;
                break;
            default: assert(false);
        }
    }

    adaptor_do_PARENT_ENABLE(dataOp: EDataOp, data: number, dataSize: number): void {
        assert(dataOp == EDataOp.IMMEDIATE);
        if (this.enableLog) console.debug('SetParentEnable:', data);
        if (data) { this.mObject.JSGSetParent(this.parent!, this.parentNodeID); }
        else { this.mObject.JSGSetParent(null, 0xFFFFFFFF); }
    }

    adaptor_do_RELATION(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.OBJECT_NAME);
        if (this.enableLog) console.debug('SetRelation:', data.asStr!);
        this.relation = this.mSystem.JSGFindObject(data.asStr!, JStage.TEObject.PREEXISTING_ACTOR);
    }

    adaptor_do_RELATION_NODE(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        debugger;
        if (this.enableLog) console.debug('SetRelationNode:', data);
        switch (dataOp) {
            case EDataOp.OBJECT_NAME:
                if (this.relation)
                    this.relationNodeID = this.relation.JSGFindNodeID(data.asStr!);
                break;
            case EDataOp.OBJECT_INDEX:
                this.relationNodeID = data.asInt!;
                break;
            default: assert(false);
        }
    }

    adaptor_do_RELATION_ENABLE(dataOp: EDataOp, data: number, dataSize: number): void {
        assert(dataOp == EDataOp.IMMEDIATE);
        if (this.enableLog) console.debug('SetRelationEnable:', data);
        this.mObject.JSGSetRelation(!!data, this.relation!, this.relationNodeID);
    }

    adaptor_do_SHAPE(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.OBJECT_INDEX);
        if (this.enableLog) console.debug('SetShape: ', data.asInt!);
        this.mObject.JSGSetShape(data.asInt!);
    }

    adaptor_do_ANIMATION(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.OBJECT_INDEX);
        if (this.enableLog) console.debug(`SetAnimation: ${(data.asInt!) & 0xFFFF} (${(data.asInt!) >> 4 & 0x01})`);
        this.mObject.JSGSetAnimation(data.asInt!);
    }

    adaptor_do_ANIMATION_MODE(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.IMMEDIATE);
        if (this.enableLog) console.debug('SetAnimationMode: ', data.asInt!);
        this.animMode = data.asInt!;
    }

    adaptor_do_TEXTURE_ANIMATION(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.OBJECT_INDEX);
        if (this.enableLog) console.debug('SetTexAnim:', data);
        this.mObject.JSGSetTextureAnimation(data.asInt!);
    }

    adaptor_do_TEXTURE_ANIMATION_MODE(dataOp: EDataOp, data: DataVal, dataSize: number): void {
        assert(dataOp == EDataOp.IMMEDIATE);
        if (this.enableLog) console.debug('SetTexAnimMode:', data);
        this.animTexMode = data.asInt!;
    }
}

class TActorObject extends STBObject {
    override mAdaptor: TActorAdaptor;

    constructor(
        control: TControl,
        blockObj: TBlockObject,
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TActorAdaptor(control.mSystem, stageObj as TActor)) }

    override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const dataOp = (param & 0x1F) as EDataOp;
        const cmdType = param >> 5;

        let keyCount = 1;
        let keyIdx;
        let data = readData(dataOp, dataOffset, dataSize, file);

        switch (cmdType) {
            // Pos
            case 0x09: keyIdx = Actor_ValIdx.POS_X; break;
            case 0x0a: keyIdx = Actor_ValIdx.POS_Y; break;
            case 0x0b: keyIdx = Actor_ValIdx.POS_Z; break;
            case 0x0c: keyCount = 3; keyIdx = Actor_ValIdx.POS_X; break;

            // Rot
            case 0x0d: keyIdx = Actor_ValIdx.ROT_X; break;
            case 0x0e: keyIdx = Actor_ValIdx.ROT_Y; break;
            case 0x0f: keyIdx = Actor_ValIdx.ROT_Z; break;
            case 0x10: keyCount = 3; keyIdx = Actor_ValIdx.ROT_X; break;

            // Scale
            case 0x11: keyIdx = Actor_ValIdx.SCALE_X; break;
            case 0x12: keyIdx = Actor_ValIdx.SCALE_Y; break;
            case 0x13: keyIdx = Actor_ValIdx.SCALE_Z; break;
            case 0x14: keyCount = 3; keyIdx = Actor_ValIdx.SCALE_X; break;

            case 0x3b: keyIdx = Actor_ValIdx.ANIM_FRAME; break;
            case 0x4b: keyIdx = Actor_ValIdx.ANIM_TRANSITION; break;

            case 0x39: this.mAdaptor.adaptor_do_SHAPE(dataOp, data, dataSize); return;
            case 0x3a: this.mAdaptor.adaptor_do_ANIMATION(dataOp, data, dataSize); return;
            case 0x43: this.mAdaptor.adaptor_do_ANIMATION_MODE(dataOp, data, dataSize); return;
            case 0x4c: debugger; this.mAdaptor.adaptor_do_TEXTURE_ANIMATION(dataOp, data, dataSize); return;
            case 0x4e: debugger; this.mAdaptor.adaptor_do_TEXTURE_ANIMATION_MODE(dataOp, data, dataSize); return;

            case 0x30: debugger; this.mAdaptor.adaptor_do_PARENT(dataOp, data, dataSize); return;
            case 0x31: debugger; this.mAdaptor.adaptor_do_PARENT_NODE(dataOp, data, dataSize); return;
            case 0x32:
                debugger;
                keyIdx = Actor_ValIdx.PARENT;
                if ((dataOp < 0x13) && (dataOp > 0x0F)) {
                    debugger;
                    this.mAdaptor.adaptor_setVariableValue(this, keyIdx, dataOp, data);
                    this.mAdaptor.mVariableValues[keyIdx].setOutput((enabled, adaptor) => {
                        (adaptor as TActorAdaptor).adaptor_do_PARENT_ENABLE(dataOp, enabled, dataSize)
                    });
                }
                this.mAdaptor.adaptor_do_PARENT_ENABLE(dataOp, data.asInt!, dataSize);
                break;

            case 0x33: debugger; this.mAdaptor.adaptor_do_RELATION(dataOp, data, dataSize); return;
            case 0x34: debugger; this.mAdaptor.adaptor_do_RELATION_NODE(dataOp, data, dataSize); return;
            case 0x35:
                debugger;
                keyIdx = Actor_ValIdx.RELATION;
                if ((dataOp < 0x13) && (dataOp > 0x0F)) {
                    debugger;
                    this.mAdaptor.adaptor_setVariableValue(this, keyIdx, dataOp, data);
                    this.mAdaptor.mVariableValues[keyIdx].setOutput((enabled, adaptor) => {
                        (adaptor as TActorAdaptor).adaptor_do_RELATION_ENABLE(dataOp, enabled, dataSize)
                    });
                }
                this.mAdaptor.adaptor_do_RELATION_ENABLE(dataOp, data.asInt!, dataSize);
                break;

            default:
                console.debug('Unsupported TActor update: ', cmdType, ' ', dataOp);
                debugger;
                return;
        }

        let keyData = [];
        for (let i = 0; i < keyCount; i++) {
            keyData[i] = readData(dataOp, dataOffset + i * 4, dataSize, file);
            this.mAdaptor.adaptor_setVariableValue(this, keyIdx + i, dataOp, keyData[i]);
        }

        if (this.mAdaptor.enableLog) { 
            console.debug(`[Act] Set${keyToString(keyIdx, keyCount)}: ${dataOpToString(dataOp)} [${logKeyAction(keyData, dataOp )}]`); 
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
    SET_PROJ_FOVY = 0x0027,
    SET_VIEW_ROLL = 0x0026,
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

function camKeyToString(enumValue: Camera_Track, count: number) {
    switch (enumValue) {
        case Camera_Track.EYE_X_POS: return "EYE_X_POS";
        case Camera_Track.EYE_Y_POS: return "EYE_Y_POS";
        case Camera_Track.EYE_Z_POS: return "EYE_Z_POS";
        case Camera_Track.TARGET_X_POS: return "TARGET_X_POS";
        case Camera_Track.TARGET_Y_POS: return "TARGET_Y_POS";
        case Camera_Track.TARGET_Z_POS: return "TARGET_Z_POS";
        case Camera_Track.PROJ_FOVY: return "PROJ_FOVY";
        case Camera_Track.VIEW_ROLL: return "VIEW_ROLL";
        case Camera_Track.DIST_NEAR: return "DIST_NEAR";
        case Camera_Track.DIST_FAR: return "DIST_FAR";
        case Camera_Track.CAMERA_TRACKS_MAX: return "CAMERA_TRACKS_MAX";
    }
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
        this.mVariableValues[Camera_Track.PROJ_FOVY].setOutput(this.mStageCam.JSGSetProjectionFovy.bind(this.mStageCam));
        this.mVariableValues[Camera_Track.VIEW_ROLL].setOutput(this.mStageCam.JSGSetViewRoll.bind(this.mStageCam));
        this.mVariableValues[Camera_Track.DIST_NEAR].setOutput(this.mStageCam.JSGSetProjectionNear.bind(this.mStageCam));
        this.mVariableValues[Camera_Track.DIST_FAR].setOutput(this.mStageCam.JSGSetProjectionFar.bind(this.mStageCam));
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
        this.mVariableValues[Camera_Track.PROJ_FOVY].setValue_immediate(this.mStageCam.JSGGetProjectionFovy());
        this.mVariableValues[Camera_Track.VIEW_ROLL].setValue_immediate(this.mStageCam.JSGGetViewRoll());
        this.mVariableValues[Camera_Track.DIST_NEAR].setValue_immediate(this.mStageCam.JSGGetProjectionNear());
        this.mVariableValues[Camera_Track.DIST_FAR].setValue_immediate(this.mStageCam.JSGGetProjectionFar());
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

    adaptor_do_data(obj: STBObject, id: number, data: DataView): void {
        // This is not used by TWW. Untested.
        debugger;
    }

    // Custom adaptor functions. These can be called from within TCameraObject::do_paragraph()
    adaptor_do_PARENT(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }

    adaptor_do_PARENT_NODE(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }

    adaptor_do_PARENT_ENABLE(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }
}

class TCameraObject extends STBObject {
    private enableLog = true;

    constructor(
        control: TControl,
        blockObj: TBlockObject,
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TCameraAdaptor(stageObj as TCamera)) }

    override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const dataOp = (param & 0x1F) as EDataOp;
        const cmdType = param >> 5;

        let keyCount = 1;
        let keyIdx;
        let data = readData(dataOp, dataOffset, dataSize, file);

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

        let keyData = []
        for (let i = 0; i < keyCount; i++) {
            keyData[i] = readData(dataOp, dataOffset + i * 4, dataSize, file);
            this.mAdaptor.adaptor_setVariableValue(this, keyIdx + i, dataOp, keyData[i]);
        }
        
        if (this.enableLog) { 
            console.debug(`[Cam] Set${camKeyToString(keyIdx, keyCount)}: ${dataOpToString(dataOp)} [${logKeyAction(keyData, dataOp )}]`); 
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

    enum EExtrapolationType {
        Raw,
        Repeat,
        Turn,
        Clamp
    }

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

        static toFunction_outside(type: EExtrapolationType): (frame: number, maxFrame: number ) => number {
            switch(type ) {
                case EExtrapolationType.Raw: return (f, m) => f;
                case EExtrapolationType.Repeat: return (f, m) => { f = f % m; return f < 0 ? f + m : f; }
                case EExtrapolationType.Turn: return (f, m) => { f %= (2*m); if (f < 0) f += m; return f > m ? 2*m - f : f };
                case EExtrapolationType.Clamp: return (f, m) => clamp(f, 0.0, m);
            }
        }

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

        prepare(block: TBlock, pControl: TControl, file: Reader) {
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
                        this.prepare_data(para, pControl, file);
                        break;

                    case EPrepareOp.RangeSet:
                        assert(para.dataSize == 8);
                        const range = this.funcVal.getAttrRange();
                        assert(!!range, 'FVB Paragraph assumes FuncVal has range attribute, but it does not');
                        const begin = file.view.getFloat32(para.dataOffset + 0);
                        const end = file.view.getFloat32(para.dataOffset + 4);
                        range.set(begin, end);
                        break;

                    case EPrepareOp.ObjSetByName: {
                        debugger; // Untested. Remove after confirmed working.
                        assert(para.dataSize >= 4);
                        const refer = this.funcVal.getAttrRefer();
                        assert(!!refer, 'FVB Paragraph assumes FuncVal has refer attribute, but it does not');
                        const objCount = file.view.getUint32(para.dataOffset + 0);
                        for (let i = 0; i < objCount; i++) {
                            const idSize = file.view.getUint32(para.dataOffset + 4 + i * 8 + 0);
                            const id = readString(file.buffer, para.dataOffset + 4 + i * 8 + 4, idSize);
                            const obj = pControl.mObjects.find(o => o.id == id);
                            assert(!!obj);
                            refer.fvs.push(obj.funcVal);
                        }
                        break;
                    }

                    case EPrepareOp.ObjSetByIdx: {
                        assert(para.dataSize >= 4);
                        const refer = this.funcVal.getAttrRefer();
                        assert(!!refer, 'FVB Paragraph assumes FuncVal has refer attribute, but it does not');
                        const objCount = file.view.getUint32(para.dataOffset + 0);
                        for (let i = 0; i < objCount; i++) {
                            const idx = file.view.getUint32(para.dataOffset + 4 + i * 4);
                            const obj = pControl.mObjects[idx];
                            assert(!!obj);
                            refer.fvs.push(obj.funcVal);
                        }
                        break;
                    }

                    case EPrepareOp.InterpSet:
                        assert(para.dataSize == 4);
                        const interp = this.funcVal.getAttrInterpolate();
                        assert(!!interp, 'FVB Paragraph assumes FuncVal has interpolate attribute, but it does not');
                        const interpType = file.view.getUint32(para.dataOffset + 0);
                        interp.set(interpType);
                        break;

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
                case EFuncValType.Composite:
                    return new TObject_Composite(block);
                case EFuncValType.Constant:
                    return new TObject_Constant(block);
                // case EFuncValType.Transition:
                //     return new TObject_transition(block);
                // case EFuncValType.List:
                //     return new TObject_list(block);
                case EFuncValType.ListParameter:
                    return new TObject_ListParameter(block);
                case EFuncValType.Hermite:
                    return new TObject_Hermite(block);
                default:
                    console.warn('Unknown FVB type: ', block.type);
                    debugger;
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
            public fvs: TFunctionValue[] = [];
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

            static Hermite(c0: number, c1: number, x: number, c2: number, x2: number, c3: number, x3: number) {
                let a: number;
                let b: number;
                let c: number;
                let d: number;

                a = c0 - c1;
                b = a * (1.0 / (x2 - c1));       // (a - b) * 1.0 / (c - d)
                c = b - 1.0;                     // 1.0
                d = (3.0 + -2.0 * b) * (b * b);  // 3.0 - 2.0 * b
                const cab = (c * a * b);
                const coeffx3 = cab * x3;
                const cca = (c * c * a);
                const coeffc2 = cca * c2;
                return ((1.0 - d) * x + (d * c3)) + coeffc2 + coeffx3;
            }
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValue: Constant
    // Simply return a constant value every frame
    //----------------------------------------------------------------------------------------------------------------------
    class TObject_Constant extends FVB.TObject {
        override funcVal = new FunctionValue_Constant;

        override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize == 4);
            const value = file.view.getFloat32(para.dataOffset);
            this.funcVal.setData(value);
        }
    }

    class FunctionValue_Constant extends TFunctionValue {
        private value: number = 0;

        getType() { return EFuncValType.Constant; }
        prepare() { }
        setData(value: number) { this.value = value; }
        getValue(timeSec: number) {
            debugger; // Untested. Remove once confirmed working
            return this.value;
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValue: ListParameter
    // Interpolate between a list of values using a specific interpolation function [None, Linear, Plateau, BSpline]
    //----------------------------------------------------------------------------------------------------------------------
    class TObject_ListParameter extends FVB.TObject {
        override funcVal = new FunctionValue_ListParameter;

        override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize >= 8);
            // Each Key contains 2 floats, a time and value
            const keyCount = file.view.getUint32(para.dataOffset + 0);
            const keys = file.buffer.createTypedArray(Float32Array, para.dataOffset + 4, keyCount * 2, Endianness.BIG_ENDIAN);
            this.funcVal.setData(keys);
        }
    }
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
                case EInterpolateType.None: this.interpFunc = this.interpolateNone;
                case EInterpolateType.Linear: this.interpFunc = this.interpolateLinear;
                case EInterpolateType.Plateau: this.interpFunc = this.interpolatePlateau;
                case EInterpolateType.BSpline:
                    if (this.keyCount > 2) { this.interpFunc = this.interpolateBSpline; }
                    else { this.interpFunc = this.interpolateLinear; }
                    break;

                default:
                    console.warn('Invalid EInterp value', interp);
                    debugger;
            }
        }

        setData(values: Float32Array) {
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
            const c = this.curKeyIdx * 2;

            const controlPoints = new Float64Array(4);
            const knotVector = new Float64Array(6);
            controlPoints[1] = this.keys[c - 1];
            controlPoints[2] = this.keys[c + 1];
            knotVector[2] = this.keys[c + -2];
            knotVector[3] = this.keys[c + 0];

            const keysBefore = this.curKeyIdx;
            const keysAfter = this.keyCount - this.curKeyIdx;

            switch (keysBefore) {
                case 1:
                    controlPoints[0] = 2.0 * controlPoints[1] - controlPoints[2];
                    controlPoints[3] = this.keys[c + 3];
                    knotVector[4] = this.keys[c + 2];
                    knotVector[1] = 2.0 * knotVector[2] - knotVector[3];
                    knotVector[0] = 2.0 * knotVector[2] - knotVector[4];
                    switch (keysAfter) {
                        case 1:
                        case 2:
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            knotVector[5] = this.keys[c + 4];
                            break;
                    }
                    break;
                case 2:
                    controlPoints[0] = this.keys[c + -3];
                    knotVector[1] = this.keys[c + -4];
                    knotVector[0] = 2.0 * knotVector[1] - knotVector[2];
                    switch (keysAfter) {
                        case 1:
                            controlPoints[3] = 2.0 * controlPoints[2] - controlPoints[1];
                            knotVector[4] = 2.0 * knotVector[3] - knotVector[2];
                            knotVector[5] = 2.0 * knotVector[3] - knotVector[1];
                            break;
                        case 2:
                            controlPoints[3] = this.keys[c + 3];
                            knotVector[4] = this.keys[c + 2];
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            controlPoints[3] = this.keys[c + 3];
                            knotVector[4] = this.keys[c + 2];
                            knotVector[5] = this.keys[c + 4];
                    }
                    break;
                default:
                    controlPoints[0] = this.keys[c + -3];
                    knotVector[1] = this.keys[c + -4];
                    knotVector[0] = this.keys[c + -6];
                    switch (keysAfter) {
                        case 1:
                            controlPoints[3] = 2.0 * controlPoints[2] - controlPoints[1];
                            knotVector[4] = 2.0 * knotVector[3] - knotVector[2];
                            knotVector[5] = 2.0 * knotVector[3] - knotVector[1];
                            break;
                        case 2:
                            controlPoints[3] = this.keys[c + 3];
                            knotVector[4] = this.keys[c + 2];
                            knotVector[5] = 2.0 * knotVector[4] - knotVector[3];
                            break;
                        default:
                            controlPoints[3] = this.keys[c + 3];
                            knotVector[4] = this.keys[c + 2];
                            knotVector[5] = this.keys[c + 4];
                            break;
                    }
                    break;
            }

            return Attribute.Interpolate.BSpline_Nonuniform(t, controlPoints, knotVector);
        }

        interpolateNone(t: number) {
            debugger; // Untested. Remove after confirmed working.
            return this.keys[this.curKeyIdx];
        }

        interpolateLinear(t: number) {
            const ks = this.keys;
            const c = this.curKeyIdx * 2;
            return Attribute.Interpolate.Linear(t, ks[c - 2], ks[c - 1], ks[c + 0], ks[c + 1]);
        }

        interpolatePlateau(t: number) {
            console.error('Plateau interpolation not yet implemented')
            debugger; // Untested. Remove after confirmed working.
            return this.interpolateNone(t);
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValue: Composite
    // Perform a simple operation to combine some number of other FunctionValues, returning the result. 
    // For example, we can using the ADD ECompositeOp we can return the sum of two ListParameter FunctionValues.
    //----------------------------------------------------------------------------------------------------------------------
    enum TECompositeOp {
        NONE,
        RAW,
        IDX,
        PARAM,
        ADD,
        SUB,
        MUL,
        DIV,
        ENUM_SIZE,
    }

    class TObject_Composite extends FVB.TObject {
        override funcVal = new FunctionValue_Composite;

        override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize >= 8);

            const compositeOp = file.view.getUint32(para.dataOffset + 0);
            const floatData = file.view.getFloat32(para.dataOffset + 4);
            const uintData = file.view.getUint32(para.dataOffset + 4);

            let fvData: number;
            let fvFunc: (ref: TFunctionValue[], data: number, t: number) => number;
            switch (compositeOp) {
                case TECompositeOp.RAW: fvData = uintData; fvFunc = FunctionValue_Composite.composite_raw; break;
                case TECompositeOp.IDX: fvData = uintData; fvFunc = FunctionValue_Composite.composite_index; break;
                case TECompositeOp.PARAM: fvData = floatData; fvFunc = FunctionValue_Composite.composite_parameter; break;
                case TECompositeOp.ADD: fvData = floatData; fvFunc = FunctionValue_Composite.composite_add; break;
                case TECompositeOp.SUB: fvData = floatData; fvFunc = FunctionValue_Composite.composite_subtract; break;
                case TECompositeOp.MUL: fvData = floatData; fvFunc = FunctionValue_Composite.composite_multiply; break;
                case TECompositeOp.DIV: fvData = floatData; fvFunc = FunctionValue_Composite.composite_divide; break;
                default:
                    console.warn('Unsupported CompositeOp:', compositeOp);
                    return;
            }

            this.funcVal.setData(fvFunc, fvData)
        }
    }

    class FunctionValue_Composite extends TFunctionValue {
        protected override refer = new Attribute.Refer();

        override prepare(): void { }
        override getType(): EFuncValType { return EFuncValType.Composite; }
        setData(func: (ref: TFunctionValue[], dataVal: number, t: number) => number, dataVal: number) {
            this.func = func;
            this.dataVal = dataVal;
        }

        getValue(timeSec: number): number {
            return this.func(this.refer.fvs, this.dataVal, timeSec);
        }

        public static composite_raw(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            if (fvs.length == 0) { return 0.0; }
            return fvs[dataVal].getValue(timeSec);
        }

        public static composite_index(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            return 0.0;
        }

        public static composite_parameter(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            let val = timeSec - dataVal;
            for (let fv of fvs) { val = fv.getValue(timeSec); }
            return val;
        }

        public static composite_add(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            let val = dataVal;
            for (let fv of fvs) { val += fv.getValue(timeSec); }
            return val;
        }

        public static composite_subtract(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            if (fvs.length == 0) { return 0.0; }
            let val = fvs[0].getValue(timeSec);
            for (let fv of fvs.slice(1)) { val -= fv.getValue(timeSec); }
            return val - dataVal;
        }

        public static composite_multiply(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            let val = dataVal;
            for (let fv of fvs) { val *= fv.getValue(timeSec); }
            return val;
        }

        public static composite_divide(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            if (fvs.length == 0) { return 0.0; }
            let val = fvs[0].getValue(timeSec);
            for (let fv of fvs.slice(1)) { val /= fv.getValue(timeSec); }
            return val / dataVal;
        }


        private func: (ref: TFunctionValue[], dataVal: number, t: number) => number;
        private dataVal: number;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValue: Hermite
    // Use hermite interpolation to compute a value from a list
    //----------------------------------------------------------------------------------------------------------------------
    class TObject_Hermite extends FVB.TObject {
        override funcVal = new FunctionValue_Hermite;

        override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize >= 8);

            const keyCount = file.view.getUint32(para.dataOffset + 0) & 0xFFFFFFF;
            const stride = file.view.getUint32(para.dataOffset + 0) >> 0x1C;

            // Each Key contains `stride` floats, a time and value
            const keys = file.buffer.createTypedArray(Float32Array, para.dataOffset + 4, keyCount * stride, Endianness.BIG_ENDIAN);
            this.funcVal.setData(keys, stride);
        }
    }

    class FunctionValue_Hermite extends TFunctionValue {
        protected override range = new Attribute.Range();

        // Each key contains `stride` floats, a time and values
        private keyCount: number = 0;
        private keys: Float32Array;
        private curKeyIdx: number;
        private stride: number;

        prepare(): void { this.range.prepare(); }

        setData(values: Float32Array, stride: number) {
            assert(stride == 3 || stride == 4);
            this.keys = values;
            this.keyCount = values.length / this.stride;
            this.curKeyIdx = 0;
            this.stride = stride
        }

        getType() { return EFuncValType.ListParameter; }
        getStartTime() { return this.keys[0]; }
        getEndTime(): number { return this.keys[(this.keyCount - 1) * this.stride]; }

        getValue(timeSec: number): number {
            debugger; // Untested. Remove after confirmed working.

            // Remap (if requested) the time to our range
            const t = this.range.getParameter(timeSec, this.getStartTime(), this.getEndTime());

            // Update our current key. If the current time is between keys, select the later one.
            this.curKeyIdx = this.keys.findIndex((k, i) => (i % this.stride) == 0 && k >= t) / this.stride;

            if (this.curKeyIdx == 0) { // Time is at or before the start, return the first key
                return this.keys[this.curKeyIdx * this.stride + 1];
            } else if (this.curKeyIdx < 0) { // Time is at or after the end, return the last key
                this.curKeyIdx = this.keyCount - 1;
                return this.keys[this.curKeyIdx * this.stride + 1];
            }

            const ks = this.keys;
            const c = this.curKeyIdx;
            const l = c - this.stride;
            const value = Attribute.Interpolate.Hermite(
                t, ks[l + 0], ks[l + 1], ks[l + this.stride - 1], ks[c + 0], ks[c + 1], ks[c + 2]);

            if (isNaN(value)) {
                console.warn('NaN generated by FunctionValue');
                debugger;
            }

            return value;
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// STB Parsing
//----------------------------------------------------------------------------------------------------------------------
const BLOCK_TYPE_CONTROL = "ÿÿÿÿ"; // -1 represented as a fourcc  

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
    public mSystem: TSystem;
    public mFvbControl = new FVB.TControl();
    public mSecondsPerFrame: number;
    private mSuspendFrames: number;

    public mTransformOrigin?: vec3;
    public mTransformRotY?: number;
    private mTransformOnGetMtx = mat4.create();
    private mTransformOnSetMtx = mat4.create();

    private mStatus: TEStatus = TEStatus.STILL;
    private mObjects: STBObject[] = [];

    // A special object that the STB file can use to suspend the demo (such as while waiting for player input)
    private mControlObject = new TControlObject(this);

    constructor(system: TSystem) {
        this.mSystem = system;
        this.mSecondsPerFrame = 1 / 30.0; // @TODO: Allow the game to change this?
    }

    public isSuspended() { return this.mSuspendFrames > 0; }
    public setSuspend(frameCount: number) { return this.mControlObject.setSuspend(frameCount); }

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

    public setControlObject(obj: TBlockObject) {
        this.mControlObject.reset(obj);
    }

    public forward(frameCount: number): boolean {
        ;
        let andStatus = 0xFF;
        let orStatus = 0;

        this.mSuspendFrames = this.mControlObject.getSuspendFrames();
        let shouldContinue = this.mControlObject.forward(frameCount);

        for (let obj of this.mObjects) {
            const res = obj.forward(frameCount);
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
            case 'JACT': objConstructor = TActorObject; objType = JStage.TEObject.ACTOR; break;
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

        if (blockObj.type == BLOCK_TYPE_CONTROL) {
            this.mControl.setControlObject(blockObj);
            return true;
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