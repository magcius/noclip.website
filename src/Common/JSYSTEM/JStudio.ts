// Nintendo's cutscene framework. Seems very over-engineered.

import { ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { align, assert, nArray, readString } from "../../util.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();

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
    
    export class TObject {

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
// - Immediate(x): Set to single value. On Update(y), set the value to a single number.  
// - Time(x): Increase over time. On Update(y), set the value to x * y * mAge.  
// - FuncVal(x): Set to the output of a functor. See FVB for details.
//
// Normally, after update() the value can be retrieved from mValue(). Alternatively, if setOutput() is called that 
// functor will be called during update(). 
//----------------------------------------------------------------------------------------------------------------------
class TVariableValue {
    public mValue: number;
    public mAge: number; // In frames

    // struct TOutput {
    //     virtual void operator()(f32, JStudio::TAdaptor*) const = 0;
    //     virtual ~TOutput() = 0;
    // };  // Size: 0x04

    // struct TOutput_none_ : public TOutput {
    //     ~TOutput_none_();
    //     void operator()(f32, JStudio::TAdaptor*) const;
    // };

    // void update(f64, JStudio::TAdaptor*);
    // static void update_immediate_(JStudio::TVariableValue*, f64);
    // static void update_time_(JStudio::TVariableValue*, f64);
    // static void update_functionValue_(JStudio::TVariableValue*, f64);
    // TVariableValue()
    //     : field_0x4(0)
    //     , field_0x8(NULL)
    //     , pOutput_(&soOutput_none_)
    // {
    // }

    // void setValue_immediate(f32 value) {
    //     field_0x8 = &update_immediate_;
    //     field_0x4 = 0;
    //     field_0xc.val = value;
    // }

    //  void setValue_none() {
    //     field_0x8 = NULL;
    // }

    // void setValue_time(f32 value) {
    //     field_0x8 = &update_time_;
    //     field_0x4 = 0;
    //     field_0xc.val = value;
    // }
    
    // void setValue_functionValue(TFunctionValue* value) {
    //     field_0x8 = &update_functionValue_;
    //     field_0x4 = 0;
    //     field_0xc.fv = value;
    // }

    // f32 getValue() const { return mValue; }

    // template<typename T>
    // T getValue_clamp() const {
    //     f32 val = mValue;
    //     if (val <= std::numeric_limits<T>::min()) {
    //         return std::numeric_limits<T>::min();
    //     } else if (val >= std::numeric_limits<T>::max()) {
    //         return std::numeric_limits<T>::max();
    //     }
    //     return val;
    // }
    // u8 getValue_uint8() const { return getValue_clamp<u8>(); }

    // void forward(u32 param_0) {
    //     if (std::numeric_limits<u32>::max() - field_0x4 <= param_0) {
    //         field_0x4 = std::numeric_limits<u32>::max();
    //     } else {
    //         field_0x4 += param_0;
    //     }
    // }

    // inline void setOutput(const TOutput* output) {
    //     pOutput_ = (output != NULL ? (TOutput*)output : (TOutput*)&soOutput_none_);
    // }

    // static TOutput_none_ soOutput_none_;

    // /* 0x00 */ f32 mValue;
    // /* 0x04 */ u32 field_0x4;
    // /* 0x08 */ void (*field_0x8)(TVariableValue*, double);
    // /* 0x0C */ union {
    //     TFunctionValue* fv;
    //     f32 val;
    // } field_0xc;
    // /* 0x10 */ TOutput* pOutput_;
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
        protected mVariableValues = nArray(mCount, i => new TVariableValue() ),
    ) { }

    abstract adaptor_do_prepare(): void;
    abstract adaptor_do_begin(): void;
    abstract adaptor_do_end(): void;
    abstract adaptor_do_update(frameCount: number): void;

    adaptor_setVariableValue(obj: STBObject, trackIdx: number, dataOp: TEOperationData, data: number, dataSize: number) {
        const varval = this.mVariableValues[trackIdx];
        const control = obj.mControl;

        switch (dataOp) {
            // case TEOperationData.VOID: varval.setValue_none();
            // case TEOperationData.IMMEDIATE: varval.setValue_immediate(data);
            // case TEOperationData.TIME: varval.setValue_time(data);
            // case TEOperationData.FUNCVALUE_NAME: varval.setValue_functionValue(control.getFunctionValue(data, dataSize)) //@TODO: Not support ATM because we're passing in data as a number instead of DataView (this is a string)
            // case TEOperationData.FUNCVALUE_INDEX: varval.setValue_functionValue(control.getFunctionValue_index(data));
            default:
                console.debug('Unsupported dataOp: ', dataOp);
                return;
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
//     virtual ~TAdaptor() = 0;
//     virtual void adaptor_do_prepare(const JStudio::TObject*);
//     virtual void adaptor_do_begin(const JStudio::TObject*);
//     virtual void adaptor_do_end(const JStudio::TObject*);
//     virtual void adaptor_do_update(const JStudio::TObject*, u32);
//     virtual void adaptor_do_data(const JStudio::TObject*, void const*, u32, void const*, u32);

//     void adaptor_setVariableValue_n(JStudio::TObject*, u32 const*, u32, JStudio::data::TEOperationData, void const*, u32);
//     void adaptor_setVariableValue_immediate(JStudio::TAdaptor::TSetVariableValue_immediate const*);
//     void adaptor_setVariableValue_Vec(u32 const*, Vec const&);
//     void adaptor_getVariableValue_Vec(Vec*, u32 const*) const;
//     void adaptor_setVariableValue_GXColor(u32 const*, GXColor const&);
//     void adaptor_getVariableValue_GXColor(GXColor*, u32 const*) const;
//     void adaptor_updateVariableValue(JStudio::TObject*, u32);


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
    private mIsSequence: boolean = false;
    private mSuspendFrames: number = 0;
    private mData: Reader;
    private pSequence: number;
    private pSequence_next: number;
    private mWait: number = 0;
    private mStatus: TEStatus = TEStatus.STILL;

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
    abstract do_paragraph(view: DataView, dataSize: number, dataOffset: number, param: number): void;
    do_begin() { }
    do_end() { }

    // Done updating this frame. Compute our variable data (i.e. interpolate) and forward to the game object.
    do_wait(flags: number) {
        // adaptor->adaptor_updateVariableValue(this, param_0); // @TODO:
        this.mAdaptor.adaptor_do_update(flags);
    }
    // do_data(void const*, u32, void const*, u32) {}

    isSuspended(): boolean {
        return this.mSuspendFrames > 0;
    }

    forward(frameCount: number) {
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
                return 1;
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
                return 1;
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
                    return 0;
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
                    return 1;
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
                    const para = parseParagraph(view, byteIdx);
                    if (para.dataSize <= 0xff) {
                        console.debug('Unsupported paragraph feature: ', para.params);
                        // process_paragraph_reserved_(para.type, para.content, para.param);
                    } else {
                        this.do_paragraph(view, para.dataSize, para.dataOffset, para.params);
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
const enum Camera_Cmd {
    SET_EYE_X_POS = 0x0015,
    SET_EYE_Y_POS = 0x0016,
    SET_EYE_Z_POS = 0x0017,
    SET_EYE_POS = 0x0018,
    SET_TARGET_X_POS = 0x0019,
    SET_TARGET_Y_POS = 0x001A,
    SET_TARGET_Z_POS = 0x001B,
    SET_TARGET_POS = 0x001C,
    SET_UNK_0026 = 0x0026,
    SET_UNK_0027 = 0x0027,
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
    UNK_0026 = 0x06,
    UNK_0027 = 0x07,
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

    adaptor_do_prepare(): void {

    }

    adaptor_do_begin(): void {

    }

    adaptor_do_end(): void {

    }

    adaptor_do_update(frameCount: number): void {

    }
}

class TCameraObject extends STBObject {
    constructor(
        control: TControl, 
        blockObj: TBlockObject, 
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TCameraAdaptor(stageObj as TCamera)) }

    override do_paragraph(view: DataView, dataSize: number, dataOffset: number, param: number): void {
        const updateType = param & 0x1F;
        const cmdType = param >> 5;

        const data = updateType == TEOperationData.FUNCVALUE_INDEX ?
            view.getUint32(dataOffset) : view.getFloat32(dataOffset);

        //     switch (cmdType) {
        //         // Eye position
        //         case Camera_Cmd.SET_EYE_X_POS:
        //             mTracks[Camera_Track.EYE_X_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_EYE_Y_POS:
        //             mTracks[Camera_Track.EYE_Y_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_EYE_Z_POS:
        //             mTracks[Camera_Track.EYE_Z_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_EYE_POS:
        //             mTracks[Camera_Track.EYE_X_POS].AddKey(data, curFrame, updateType);
        //             mTracks[Camera_Track.EYE_Y_POS].AddKey(data, curFrame, updateType);
        //             mTracks[Camera_Track.EYE_Z_POS].AddKey(data, curFrame, updateType);
        //             break;

        //         // Target position
        //         case Camera_Cmd.SET_TARGET_X_POS:
        //             mTracks[Camera_Track.TARGET_X_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.Camera_Cmd.SET_TARGET_Y_POS:
        //             mTracks[Camera_Track.TARGET_Y_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_TARGET_Z_POS:
        //             mTracks[Camera_Track.TARGET_Z_POS].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_TARGET_POS:
        //             mTracks[Camera_Track.TARGET_X_POS].AddKey(data, curFrame, updateType);
        //             mTracks[Camera_Track.TARGET_Y_POS].AddKey(data, curFrame, updateType);
        //             mTracks[Camera_Track.TARGET_Z_POS].AddKey(data, curFrame, updateType);
        //             break;

        //         // ?
        //         case Camera_Cmd.SET_UNK_0026:
        //             mTracks[Camera_Track.UNK_0026].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_UNK_0027:
        //             mTracks[Camera_Track.UNK_0027].AddKey(data, curFrame, updateType);
        //             break;

        //         // Near/far distance
        //         case Camera_Cmd.SET_DIST_NEAR:
        //             mTracks[Camera_Track.DIST_NEAR].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_DIST_FAR:
        //             mTracks[Camera_Track.DIST_FAR].AddKey(data, curFrame, updateType);
        //             break;
        //         case Camera_Cmd.SET_DIST_NEAR_FAR:
        //             mTracks[Camera_Track.DIST_NEAR].AddKey(data, curFrame, updateType);
        //             mTracks[Camera_Track.DIST_FAR].AddKey(data, curFrame, updateType);
        //             break;

        //         default:
        //             console.debug('Unsupported TCamera update: ', cmdType, ' ', updateType);
        //             break;
        //     }
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

// The "loader" which manages a key-value store of parameters for each object. Each frame these value are interpolated
// and written to a corresponding TObject, where they can be read by the game.
class TAdapter {

}

class TParagraph {
    dataSize: number;
    params: number;
    dataOffset: number;
    nextOffset: number;
}

function parseParagraph(view: DataView, byteIdx: number): TParagraph {
    // The top bit of the paragraph determines if the type and size are 16 bit (if set), or 32 (if not set)
    let dataSize = view.getUint16(byteIdx);
    let params;
    let offset;

    if ((dataSize & 0x8000) == 0) {
        // 16 bit data
        params = view.getUint16(byteIdx + 2);
        offset = 4;
    } else {
        // 32 bit data
        dataSize = view.getUint32(byteIdx + 0) & ~0x80000000;
        params = view.getUint32(byteIdx + 4);
        offset = 8;
    }

    if (dataSize == 0) {
        return { dataSize, params, dataOffset: 0, nextOffset: byteIdx + offset };
    } else {
        return { dataSize, params, dataOffset: byteIdx + offset, nextOffset: byteIdx + offset + align(dataSize, 4) };
    }
}

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

export class TControl {
    private mSystem: TSystem;
    private mObjects: STBObject[] = [];
    public mIsSuspended = false;

    constructor(system: TSystem) {
        this.mSystem = system;
    }

    public forward(flags: number): number {
        for (let obj of this.mObjects) {
            const res = obj.forward(flags);
            // @TODO: Set status
        }
        return 1;
    }

    // Really this is a Factory method
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
        this.mObjects.push(obj);
        return obj;
    }
}

export class TParse {
    constructor(
        private mControl: TControl
    ) { }

    private parseFVB(data: ArrayBufferSlice) {

    }

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
        }

        if (flags & 0x10) {
            console.debug('Unhandled flag during parseBlockObject: 0x10');
            return true;
        }

        if (flags & 0x20) {
            console.debug('Unhandled flag during parseBlockObject: 0x20');
            return true;
        }

        // Create the object, using overloaded functions from the game
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
        let blockCount = file.view.getUint32(12);

        for (let i = 0; i < blockCount; i++) {
            const blockSize = file.view.getUint32(byteIdx + 0);
            const blockType = readString(file.buffer, byteIdx + 4, 4);
            const blockData = data.slice(byteIdx + 8, byteIdx + blockSize);

            if (blockType == 'JFVB') {
                this.parseFVB(blockData)
            } else {
                this.parseBlockObject(new Reader(file.buffer, byteIdx), flags);
            }

            byteIdx += blockSize;
        }

        return true;
    }
}