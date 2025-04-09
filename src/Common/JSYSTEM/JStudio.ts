// Nintendo's cutscene framework. Seems very over-engineered. Data is stored in a STB (Studio Binary) file.

import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { align, assert, nArray, readString } from "../../util.js";
import { JSystemFileReaderHelper } from "./J3D/J3DLoader.js";
import { GfxColor } from "../../gfx/platform/GfxPlatform";
import { clamp, MathConstants } from "../../MathHelpers.js";
import { Endianness } from "../../endian.js";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

// TODO: Setup the JMessage system in a separate file
export namespace JMessage {
    export class TControl {
        public setMessageCode(packed: number): boolean { return true; };
    }
}

//----------------------------------------------------------------------------------------------------------------------
// STB Objects
// These are created an managed by the game. Each Stage Object has a corresponding STB Object, connected by an Adaptor. 
// The STB objects are manipulated by Sequences from the STB file each frame, and update the Stage Object via Adaptor.
//----------------------------------------------------------------------------------------------------------------------
export namespace JStage {
    export enum EObject {
        PreExistingActor = 0x0,
        Unk1 = 0x1,
        Actor = 0x2,
        Camera = 0x3,
        Ambient = 0x4,
        Light = 0x5,
        Fog = 0x6,
    };

    export abstract class TObject {
        public JSGFDisableFlag(flag: number): void { this.JSGSetFlag(this.JSGGetFlag() & ~flag); }
        public JSGFEnableFlag(flag: number): void { this.JSGSetFlag(this.JSGGetFlag() | flag); }

        public abstract JSGFGetType(): number;
        public JSGGetName(): string | null { return null; }
        public JSGGetFlag(): number { return 0; }
        public JSGSetFlag(flag: number): void { }
        public JSGGetData(unk0: number, data: Object, unk1: number): boolean { return false; }
        public JSGSetData(id: number, data: DataView): void { }
        public JSGGetParent(parentDst: JStage.TObject, unk: { x: number }): void { }
        public JSGSetParent(parent: JStage.TObject | null, unk: number): void { }
        public JSGSetRelation(related: boolean, obj: JStage.TObject, unk: number): void { }
        public JSGFindNodeID(id: string): number { return -1; }
        public JSGGetNodeTransformation(nodeId: number, mtx: mat4): number {
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
    JSGFindObject(objId: string, objType: JStage.EObject): JStage.TObject | null;
}

//----------------------------------------------------------------------------------------------------------------------
// TVariableValue
// Manages a single float, which will be updated each frame. This float can be updated using a variety of operations: 
// - Immediate(x): Set to single value. On Update(y), set the value to a single number then do nothing on future frames.  
// - Time(x): Increase over time, mValue is the velocity. On Update(y), set the value to mValue * dt * mAge.  
// - FuncVal(x): Set to the output of a functor. See FVB for details.
//
// Normally, after update() the value can be retrieved from mValue(). Alternatively, if setOutput() is called that 
// functor will be called during update(). 
//----------------------------------------------------------------------------------------------------------------------
class TVariableValue {
    private value: number;
    private age: number; // In frames
    private updateFunc: ((varval: TVariableValue, x: number) => void) | null = null;
    private updateParam: number | FVB.TFunctionValue | null;
    private outputFunc: ((val: number, adaptor: TAdaptor) => void) | null = null;

    public getValue() { return this.value; }
    public getValueU8() { return clamp(this.value, 0, 255); }

    public forward(frameCount: number) {
        if (Number.MAX_VALUE - this.age <= frameCount) {
            this.age = Number.MAX_VALUE;
        } else {
            this.age += frameCount;
        }
    }

    public update(secondsPerFrame: number, adaptor: TAdaptor): void {
        if (this.updateFunc) {
            this.updateFunc(this, secondsPerFrame);
            if (this.outputFunc) this.outputFunc(this.value, adaptor);
        }
    }

    //--------------------
    // Update functions
    // Each frame, one of these (or nothing) will be called to update the value of each TVariableValue.
    //--------------------
    private static update_immediate(varval: TVariableValue, secondsPerFrame: number): void {
        varval.value = (varval.updateParam as number);
        varval.updateFunc = null;
    }

    private static update_time(varval: TVariableValue, secondsPerFrame: number): void {
        varval.value = (varval.updateParam as number) * (varval.age * secondsPerFrame);
    }

    private static update_functionValue(varval: TVariableValue, secondsPerFrame: number): void {
        const t = varval.age * secondsPerFrame;
        varval.value = (varval.updateParam as FVB.TFunctionValue).getValue(t);
    }

    //--------------------
    // Set Update functions
    // Modify the function that will be called each Update()
    //--------------------
    public setValue_none() {
        this.updateFunc = null;
    }

    // Value will be set only on next update 
    public setValue_immediate(v: number): void {
        assert(v !== undefined);
        this.updateFunc = TVariableValue.update_immediate;
        this.age = 0;
        this.updateParam = v;
    }

    // Value will be set to (mAge * v * x) each frame
    public setValue_time(v: number): void {
        assert(v !== undefined);
        this.updateFunc = TVariableValue.update_time;
        this.age = 0;
        this.updateParam = v;
    }

    // Value will be the result of a Function Value each frame
    public setValue_functionValue(v: FVB.TFunctionValue | null = null): void {
        assert(v !== undefined);
        this.updateFunc = TVariableValue.update_functionValue;
        this.age = 0;
        this.updateParam = v;
    }

    //--------------------
    // Set Output
    //--------------------
    public setOutput(outputFunc: ((val: number, adaptor: TAdaptor) => void) | null = null) {
        this.outputFunc = outputFunc;
    }
}


//----------------------------------------------------------------------------------------------------------------------
// TAdaptor
// Connects the STBObject to a Game Object. Manages tracks of TVariableValues, updates their values on the Game object.
//----------------------------------------------------------------------------------------------------------------------
enum EDataOp {
    None = 0,
    Void = 1,           // Disable updates for this track.
    Immediate = 2,      // Set the value on this track to an immediate value.
    Time = 3,           // The value increases each frame by a given velocity, starting at 0.
    FuncValName = 0x10, // Evaluate a FunctionValue each frame and use the result
    FuncValIdx = 0x12,  // Same as FuncValName but by FunctionValue index
    ObjectName = 0x18,  // Set the value directly on the JStage object (e.g. an actor), don't store in the adaptor 
    ObjectIdx = 0x19,   // Same as ObjectName, but by object index
};

type ParagraphData = (
    { dataOp: EDataOp.Void | EDataOp.None; value: null; } |
    { dataOp: EDataOp.FuncValName | EDataOp.ObjectName; value: string; } |
    { dataOp: EDataOp.FuncValIdx | EDataOp.ObjectIdx; value: number; } |
    { dataOp: EDataOp.Immediate | EDataOp.Time; value: number; valueInt: number }
);

// Parse data from a DataView as either a number or a string, based on the dataOp
function readData(dataOp: EDataOp, dataOffset: number, dataSize: number, file: Reader): ParagraphData {
    switch (dataOp) {
        case EDataOp.Immediate:
        case EDataOp.Time:
            return { dataOp, value: file.view.getFloat32(dataOffset), valueInt: file.view.getUint32(dataOffset) };

        case EDataOp.FuncValIdx:
        case EDataOp.ObjectIdx:
            return { dataOp, value: file.view.getUint32(dataOffset) };

        case EDataOp.FuncValName:
        case EDataOp.ObjectName:
            return { dataOp, value: readString(file.buffer, dataOffset, dataSize) };

        default:
            assert(false, 'Unsupported data operation');
    }
}

abstract class TAdaptor {
    public object: JStage.TObject;

    constructor(
        public count: number,
        public variableValues = nArray(count, i => new TVariableValue()),
        public enableLogging = true,
    ) { }

    public adaptor_do_prepare(obj: STBObject): void {};
    public adaptor_do_begin(obj: STBObject): void {};
    public adaptor_do_end(obj: STBObject): void {};
    public adaptor_do_update(obj: STBObject, frameCount: number): void {};
    public adaptor_do_data(obj: STBObject, id: number, data: DataView): void {};

    // Set a single VariableValue update function, with the option of using FuncVals 
    public adaptor_setVariableValue(obj: STBObject, keyIdx: number, data: ParagraphData) {
        const varval = this.variableValues[keyIdx];
        const control = obj.control;

        switch (data.dataOp) {
            case EDataOp.Void: varval.setValue_none(); break;
            case EDataOp.Immediate: varval.setValue_immediate(data.value); break;
            case EDataOp.Time: varval.setValue_time(data.value); break;
            case EDataOp.FuncValName: varval.setValue_functionValue(control.getFunctionValueByName(data.value)); break;
            case EDataOp.FuncValIdx: varval.setValue_functionValue(control.getFunctionValueByIdx(data.value)); break;
            default:
                console.debug('Unsupported dataOp: ', data.dataOp);
                debugger;
                return;
        }
    }

    // Immediately set 3 consecutive VariableValue update functions from a single vec3
    public adaptor_setVariableValue_Vec(startKeyIdx: number, data: vec3) {
        this.variableValues[startKeyIdx + 0].setValue_immediate(data[0]);
        this.variableValues[startKeyIdx + 1].setValue_immediate(data[1]);
        this.variableValues[startKeyIdx + 2].setValue_immediate(data[2]);
    }

    // Get the current value of 3 consecutive VariableValues, as a vector. E.g. Camera position.
    public adaptor_getVariableValue_Vec(dst: vec3, startKeyIdx: number) {
        dst[0] = this.variableValues[startKeyIdx + 0].getValue();
        dst[1] = this.variableValues[startKeyIdx + 1].getValue();
        dst[2] = this.variableValues[startKeyIdx + 2].getValue();
    }

    // Immediately set 4 consecutive VariableValue update functions from a single GXColor (4 bytes)
    public adaptor_setVariableValue_GXColor(startKeyIdx: number, data: GfxColor) {
        debugger; // @TODO: Confirm that all uses of this always have consecutive keyIdxs. JStudio remaps them.
        this.variableValues[startKeyIdx + 0].setValue_immediate(data.r);
        this.variableValues[startKeyIdx + 1].setValue_immediate(data.g);
        this.variableValues[startKeyIdx + 2].setValue_immediate(data.b);
        this.variableValues[startKeyIdx + 3].setValue_immediate(data.a);
    }

    // Get the current value of 4 consecutive VariableValues, as a GXColor. E.g. Fog color.
    public adaptor_getVariableValue_GXColor(dst: GfxColor, startKeyIdx: number) {
        dst.r = this.variableValues[startKeyIdx + 0].getValue();
        dst.g = this.variableValues[startKeyIdx + 1].getValue();
        dst.b = this.variableValues[startKeyIdx + 2].getValue();
        dst.a = this.variableValues[startKeyIdx + 3].getValue();
    }

    public adaptor_updateVariableValue(obj: STBObject, frameCount: number) {
        const control = obj.control;
        for (let vv of this.variableValues) {
            vv.forward(frameCount);
            vv.update(control.secondsPerFrame, this);
        }
    }

    public log(msg: string) {
        if (this.enableLogging) { console.debug(`[${this.object.JSGGetName()}] ${msg}`); }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// STB Objects
// Created at parse time, and controlled by Sequences from the STB file. Connects to Game objects via an Adaptor. 
// Each frame the STB data is marched (see do_paragraph) to update one or more properties of the Object via its Adaptor. 
//----------------------------------------------------------------------------------------------------------------------
abstract class STBObject {
    public control: TControl;
    public adaptor: TAdaptor;

    private id: string;
    private type: string;
    private flags: number;
    private status: EStatus = EStatus.Still;
    private isSequence: boolean = false;
    private suspendFrames: number = 0;
    private data: Reader;
    private sequence: number;
    private sequenceNext: number;
    private wait: number = 0;

    constructor(control: TControl, blockObj: TBlockObject | null = null, adaptor: TAdaptor | null = null) {
        this.control = control;

        if (blockObj && adaptor) {
            this.adaptor = adaptor;

            this.id = blockObj.id;
            this.type = blockObj.type;
            this.flags = blockObj.flag;
            this.data = blockObj.data;
            this.sequence = 0;
            this.sequenceNext = 0xC + align(blockObj.id.length + 1, 4);
        }
    }

    // These are intended to be overridden by subclasses 
    public abstract do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void;
    public do_begin() { if (this.adaptor) this.adaptor.adaptor_do_begin(this); }
    public do_end() { if (this.adaptor) this.adaptor.adaptor_do_end(this); }

    // Done updating this frame. Compute our variable data (i.e. interpolate) and send to the game object.
    public do_wait(frameCount: number) {
        if (this.adaptor) this.adaptor.adaptor_updateVariableValue(this, frameCount);
        if (this.adaptor) this.adaptor.adaptor_do_update(this, frameCount);
    }
    public do_data(id: number, data: DataView) { if (this.adaptor) this.adaptor.adaptor_do_data(this, id, data); }

    public getStatus() { return this.status; }
    public getSuspendFrames(): number { return this.suspendFrames; }
    public isSuspended(): boolean { return this.suspendFrames > 0; }
    public setSuspend(frameCount: number) { this.suspendFrames = frameCount; }

    public reset(blockObj: TBlockObject) {
        this.sequence = 0;
        this.status = EStatus.Still;
        this.sequenceNext = 0xC + align(blockObj.id.length + 1, 4);
        this.data = blockObj.data;
        this.wait = 0;
    }

    public forward(frameCount: number): boolean {
        let hasWaited = false;
        while (true) {
            // Top bit of mFlags makes this object immediately inactive, restarting any existing sequence
            if (this.flags & 0x8000) {
                if (this.status !== EStatus.Inactive) {
                    this.status = EStatus.Inactive;
                    if (this.isSequence) {
                        this.do_end();
                    }
                }
                return true;
            }

            if (this.status === EStatus.Inactive) {
                assert(this.isSequence);
                this.do_begin();
                this.status = EStatus.Wait;
            }

            if ((this.control && this.control.isSuspended()) || this.isSuspended()) {
                if (this.isSequence) {
                    assert((this.status === EStatus.Wait) || (this.status === EStatus.Suspend));
                    this.status = EStatus.Suspend;
                    this.do_wait(frameCount);
                }
                return true;
            }

            while (true) {
                this.sequence = this.sequenceNext;

                // If there is nothing left in the sequence, end it
                if (!this.sequence) {
                    if (this.isSequence) {
                        assert(this.status !== EStatus.Still);
                        if (!hasWaited) {
                            this.do_wait(0);
                        }
                        this.isSequence = false;
                        this.status = EStatus.End;
                        this.do_end();
                    }
                    return false;
                }

                // If we're not currently running a sequence, start it
                if (!this.isSequence) {
                    assert(this.status === EStatus.Still);
                    this.isSequence = true;
                    this.do_begin();
                }

                this.status = EStatus.Wait;

                if (this.wait === 0) {
                    this.process_sequence();
                    if (this.wait === 0) {
                        break;
                    }
                }
                assert(this.wait > 0);

                hasWaited = true;
                if (frameCount >= this.wait) {
                    const wait = this.wait;
                    frameCount -= this.wait;
                    this.wait = 0;
                    this.do_wait(wait);
                } else {
                    this.wait -= frameCount;
                    this.do_wait(frameCount);
                    return true;
                }
            }
        }
    }

    private process_sequence() {
        const view = this.data.view;
        let byteIdx = this.sequence;

        let cmd = view.getUint8(byteIdx);
        let param = view.getUint32(byteIdx) & 0xFFFFFF;

        let next = 0;
        if (cmd !== 0) {
            if (cmd <= 0x7f) {
                next = byteIdx + 4;
            } else {
                next = byteIdx + 4 + param;
            }
        }

        this.sequenceNext = next;

        switch (cmd) {
            case ESequenceCmd.End:
                break;

            case ESequenceCmd.SetFlag:
                debugger; // Untested. Remove after confirmed working.
                break;

            case ESequenceCmd.Wait:
                this.wait = param;
                break;

            case ESequenceCmd.Skip:
                debugger; // Untested. Remove after confirmed working.
                break;

            case ESequenceCmd.Suspend:
                this.suspendFrames += param;
                break;

            case ESequenceCmd.Paragraph:
                byteIdx += 4;
                while (byteIdx < this.sequenceNext) {
                    const para = TParagraph.parse(view, byteIdx);
                    if (para.type <= 0xff) {
                        this.process_paragraph_reserved_(this.data, para.dataSize, para.dataOffset, para.type);
                    } else {
                        this.do_paragraph(this.data, para.dataSize, para.dataOffset, para.type);
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
                assert(idSize === 4);
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

    public override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void { }
}


//----------------------------------------------------------------------------------------------------------------------
// Actor
//----------------------------------------------------------------------------------------------------------------------
enum EActorTrack {
    AnimFrame = 0,
    AnimTransition = 1,
    TexAnimFrame = 2,

    PosX = 3,
    PosY = 4,
    PosZ = 5,
    RotX = 6,
    RotY = 7,
    RotZ = 8,
    ScaleX = 9,
    ScaleY = 10,
    ScaleZ = 11,

    Parent = 12,
    Relation = 13,
}

export abstract class TActor extends JStage.TObject {
    public JSGFGetType() { return JStage.EObject.Actor; }
    public JSGGetTranslation(dst: vec3) { }
    public JSGSetTranslation(src: ReadonlyVec3) { }
    public JSGGetScaling(dst: vec3) { }
    public JSGSetScaling(src: ReadonlyVec3) { }
    public JSGGetRotation(dst: vec3) { }
    public JSGSetRotation(src: ReadonlyVec3) { }
    public JSGGetShape(): number { return -1; }
    public JSGSetShape(x: number): void { }
    public JSGGetAnimation(): number { return -1; }
    public JSGSetAnimation(x: number): void { }
    public JSGGetAnimationFrame(): number { return 0.0; }
    public JSGSetAnimationFrame(x: number): void { }
    public JSGGetAnimationFrameMax(): number { return 0.0; }
    public JSGGetAnimationTransition(): number { return 0.0; }
    public JSGSetAnimationTransition(x: number): void { }
    public JSGGetTextureAnimation(): number { return -1; }
    public JSGSetTextureAnimation(x: number): void { }
    public JSGGetTextureAnimationFrame(): number { return 0.0; }
    public JSGSetTextureAnimationFrame(x: number): void { }
    public JSGGetTextureAnimationFrameMax(): number { return 0.0; }
    
    public JSGDebugGetAnimationName(x: number): string | null { return null; }
}

class TActorAdaptor extends TAdaptor {
    public parent: JStage.TObject | null = null;
    public parentNodeID: number;
    public relation: JStage.TObject | null = null;
    public relationNodeID: number;
    public animMode: number = 0; // See computeAnimFrame()
    public animTexMode: number = 0; // See computeAnimFrame()

    constructor(
        private system: TSystem,
        public override object: TActor,
    ) { super(14); }

    private static computeAnimFrame(animMode: number, maxFrame: number, frame: number) {
        const outsideType = animMode & 0xFF;
        const reverse = animMode >> 8;

        if (reverse) { frame = maxFrame - frame; }
        if (maxFrame > 0.0) {
            frame = FVB.TFunctionValue.calcFunction_outside(outsideType, frame, maxFrame);
        }
        return frame;
    }

    public override adaptor_do_prepare(obj: STBObject): void {
        this.variableValues[EActorTrack.AnimTransition].setOutput(this.object.JSGSetAnimationTransition.bind(this.object));

        this.variableValues[EActorTrack.AnimFrame].setOutput((frame: number, adaptor: TAdaptor) => {
            frame = TActorAdaptor.computeAnimFrame(this.animMode, this.object.JSGGetAnimationFrameMax(), frame);
            this.object.JSGSetAnimationFrame(frame);
        });

        this.variableValues[EActorTrack.TexAnimFrame].setOutput((frame: number, adaptor: TAdaptor) => {
            frame = TActorAdaptor.computeAnimFrame(this.animTexMode, this.object.JSGGetTextureAnimationFrameMax(), frame);
            this.object.JSGSetTextureAnimationFrame(frame);
        });
    }

    public override adaptor_do_begin(obj: STBObject): void {
        this.object.JSGFEnableFlag(1);

        const pos = scratchVec3a;
        const rot = scratchVec3b;
        const scale = scratchVec3c;
        this.object.JSGGetTranslation(pos);
        this.object.JSGGetRotation(rot);
        this.object.JSGGetScaling(scale);

        if (obj.control.isTransformEnabled()) {
            vec3.transformMat4(pos, pos, obj.control.getTransformOnGet());
            rot[1] -= obj.control.transformRotY!;
        }

        this.adaptor_setVariableValue_Vec(EActorTrack.PosX, pos);
        this.adaptor_setVariableValue_Vec(EActorTrack.RotX, rot);
        this.adaptor_setVariableValue_Vec(EActorTrack.ScaleX, scale);

        this.variableValues[EActorTrack.AnimTransition].setValue_immediate(this.object.JSGGetAnimationTransition());
        this.variableValues[EActorTrack.AnimFrame].setValue_immediate(this.object.JSGGetAnimationFrame());
        this.variableValues[EActorTrack.AnimFrame].setValue_immediate(this.object.JSGGetTextureAnimationFrame());
    }

    public override adaptor_do_end(obj: STBObject): void {
        this.object.JSGFDisableFlag(1);
    }

    public override adaptor_do_update(obj: STBObject, frameCount: number): void {
        const pos = scratchVec3a;
        const rot = scratchVec3b;
        const scale = scratchVec3c;
        this.adaptor_getVariableValue_Vec(pos, EActorTrack.PosX);
        this.adaptor_getVariableValue_Vec(rot, EActorTrack.RotX);
        this.adaptor_getVariableValue_Vec(scale, EActorTrack.ScaleX);

        if (obj.control.isTransformEnabled()) {
            vec3.transformMat4(pos, pos, obj.control.getTransformOnSet());
            rot[1] += obj.control.transformRotY!;
        }

        this.object.JSGSetTranslation(pos);
        this.object.JSGSetRotation(rot);
        this.object.JSGSetScaling(scale);
    }

    public override adaptor_do_data(obj: STBObject, id: number, data: DataView): void {
        this.log(`SetData: ${id}`);
        this.object.JSGSetData(id, data);
    }

    public adaptor_do_PARENT(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.ObjectName);
        this.log(`SetParent: ${data.value}`);
        this.parent = this.system.JSGFindObject(data.value, JStage.EObject.PreExistingActor);
    }

    public adaptor_do_PARENT_NODE(data: ParagraphData): void {
        debugger;
        this.log(`SetParentNode: ${data.value}`);
        switch (data.dataOp) {
            case EDataOp.ObjectName:
                if (this.parent)
                    this.parentNodeID = this.parent.JSGFindNodeID(data.value);
                break;
            case EDataOp.ObjectIdx:
                this.parentNodeID = data.value;
                break;
            default: assert(false);
        }
    }

    public adaptor_do_PARENT_ENABLE(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.Immediate);
        this.log(`SetParentEnable: ${data.valueInt}`);
        if (data.valueInt) { this.object.JSGSetParent(this.parent!, this.parentNodeID); }
        else { this.object.JSGSetParent(null, 0xFFFFFFFF); }
    }

    public adaptor_do_RELATION(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.ObjectName);
        this.log(`SetRelation: ${data.value}`);
        this.relation = this.system.JSGFindObject(data.value, JStage.EObject.PreExistingActor);
    }

    public adaptor_do_RELATION_NODE(data: ParagraphData): void {
        debugger;
        this.log(`SetRelationNode: ${data.value}`);
        switch (data.dataOp) {
            case EDataOp.ObjectName:
                if (this.relation)
                    this.relationNodeID = this.relation.JSGFindNodeID(data.value);
                break;
            case EDataOp.ObjectIdx:
                this.relationNodeID = data.value;
                break;
            default: assert(false);
        }
    }

    public adaptor_do_RELATION_ENABLE(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.Immediate);
        this.log(`SetRelationEnable: ${data.valueInt}`);
        this.object.JSGSetRelation(!!data.valueInt, this.relation!, this.relationNodeID);
    }

    public adaptor_do_SHAPE(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.ObjectIdx);
        this.log(`SetShape: ${data.value}`);
        this.object.JSGSetShape(data.value);
    }

    public adaptor_do_ANIMATION(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.ObjectIdx);
        const animName = this.object.JSGDebugGetAnimationName(data.value);
        if( animName )
            this.log(`SetAnimation: ${animName}`);
        else 
            this.log(`SetAnimation: ${(data.value) & 0xFFFF} (${(data.value) >> 4 & 0x01})`);
        this.object.JSGSetAnimation(data.value);
    }

    public adaptor_do_ANIMATION_MODE(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.Immediate);
        this.log(`SetAnimationMode: ${data.valueInt}`);
        this.animMode = data.valueInt;
    }

    public adaptor_do_TEXTURE_ANIMATION(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.ObjectIdx);
        this.log(`SetTexAnim: ${data.value}`);
        this.object.JSGSetTextureAnimation(data.value);
    }

    public adaptor_do_TEXTURE_ANIMATION_MODE(data: ParagraphData): void {
        assert(data.dataOp === EDataOp.Immediate);
        this.log(`SetTexAnimMode: ${data.valueInt}`);
        this.animTexMode = data.valueInt;
    }
}

class TActorObject extends STBObject {
    override adaptor: TActorAdaptor;

    constructor(
        control: TControl,
        blockObj: TBlockObject,
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TActorAdaptor(control.system, stageObj as TActor)) }

    public override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const dataOp = (param & 0x1F) as EDataOp;
        const cmdType = param >> 5;

        let keyCount = 1;
        let keyIdx;
        let data = readData(dataOp, dataOffset, dataSize, file);

        switch (cmdType) {
            // Pos
            case 0x09: keyIdx = EActorTrack.PosX; break;
            case 0x0a: keyIdx = EActorTrack.PosY; break;
            case 0x0b: keyIdx = EActorTrack.PosZ; break;
            case 0x0c: keyCount = 3; keyIdx = EActorTrack.PosX; break;

            // Rot
            case 0x0d: keyIdx = EActorTrack.RotX; break;
            case 0x0e: keyIdx = EActorTrack.RotY; break;
            case 0x0f: keyIdx = EActorTrack.RotZ; break;
            case 0x10: keyCount = 3; keyIdx = EActorTrack.RotX; break;

            // Scale
            case 0x11: keyIdx = EActorTrack.ScaleX; break;
            case 0x12: keyIdx = EActorTrack.ScaleY; break;
            case 0x13: keyIdx = EActorTrack.ScaleZ; break;
            case 0x14: keyCount = 3; keyIdx = EActorTrack.ScaleX; break;

            case 0x3b: keyIdx = EActorTrack.AnimFrame; break;
            case 0x4b: keyIdx = EActorTrack.AnimTransition; break;

            case 0x39: this.adaptor.adaptor_do_SHAPE(data); return;
            case 0x3a: this.adaptor.adaptor_do_ANIMATION(data); return;
            case 0x43: this.adaptor.adaptor_do_ANIMATION_MODE(data); return;
            case 0x4c: debugger; this.adaptor.adaptor_do_TEXTURE_ANIMATION(data); return;
            case 0x4e: debugger; this.adaptor.adaptor_do_TEXTURE_ANIMATION_MODE(data); return;

            case 0x30: debugger; this.adaptor.adaptor_do_PARENT(data); return;
            case 0x31: debugger; this.adaptor.adaptor_do_PARENT_NODE(data); return;
            case 0x32:
                debugger;
                keyIdx = EActorTrack.Parent;
                if (dataOp === EDataOp.FuncValIdx || dataOp === EDataOp.FuncValName) {
                    debugger;
                    this.adaptor.adaptor_setVariableValue(this, keyIdx, data);
                    this.adaptor.variableValues[keyIdx].setOutput((enabled, adaptor) => {
                        (adaptor as TActorAdaptor).adaptor_do_PARENT_ENABLE({ dataOp:EDataOp.Immediate, value: enabled, valueInt: enabled });
                    });
                } else {
                    this.adaptor.adaptor_do_PARENT_ENABLE(data);
                }
                break;

            case 0x33: debugger; this.adaptor.adaptor_do_RELATION(data); return;
            case 0x34: debugger; this.adaptor.adaptor_do_RELATION_NODE(data); return;
            case 0x35:
                debugger;
                keyIdx = EActorTrack.Relation;
                if ((dataOp < 0x13) && (dataOp > 0x0F)) {
                    debugger;
                    this.adaptor.adaptor_setVariableValue(this, keyIdx, data);
                    this.adaptor.variableValues[keyIdx].setOutput((enabled, adaptor) => {
                        (adaptor as TActorAdaptor).adaptor_do_RELATION_ENABLE({ dataOp:EDataOp.Immediate, value: enabled, valueInt: enabled });
                    });
                }
                this.adaptor.adaptor_do_RELATION_ENABLE(data);
                break;

            default:
                console.debug('Unsupported TActor update: ', cmdType, ' ', dataOp);
                debugger;
                return;
        }

        let keyData = [];
        for (let i = 0; i < keyCount; i++) {
            keyData[i] = readData(dataOp, dataOffset + i * 4, dataSize, file);
            this.adaptor.adaptor_setVariableValue(this, keyIdx + i, keyData[i]);
        }

        const keyName = EActorTrack[keyIdx].slice(0, keyCount > 0 ? -1 : undefined);
        this.adaptor.log(`Set${keyName}: ${EDataOp[dataOp]} [${keyData.map(k => k.value)}]`);
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Camera
//----------------------------------------------------------------------------------------------------------------------
enum ECameraTrack {
    PosX = 0x00,
    PosY = 0x01,
    PosZ = 0x02,
    TargetX = 0x03,
    TargetY = 0x04,
    TargetZ = 0x05,
    FovY = 0x06,
    Roll = 0x07,
    DistNear = 0x08,
    DistFar = 0x09,
}

export abstract class TCamera extends JStage.TObject {
    public JSGFGetType() { return JStage.EObject.Camera; }
    public JSGGetProjectionType() { return true; }
    public JSGSetProjectionType(type: number) { }
    public JSGGetProjectionNear() { return 0.0; }
    public JSGSetProjectionNear(near: number) { }
    public JSGGetProjectionFar() { return Number.MAX_VALUE; }
    public JSGSetProjectionFar(far: number) { }
    public JSGGetProjectionFovy() { return 0.0 };
    public JSGSetProjectionFovy(fovy: number) { };
    public JSGGetProjectionAspect() { return 0.0 };
    public JSGSetProjectionAspect(aspect: number) { };
    public JSGGetProjectionField() { return 0.0 };
    public JSGSetProjectionField(field: number) { };
    public JSGGetViewType() { return true; };
    public JSGSetViewType(type: number) { }
    public JSGGetViewPosition(dst: vec3) { vec3.zero(dst); }
    public JSGSetViewPosition(v: ReadonlyVec3) { }
    public JSGGetViewUpVector(dst: vec3) { vec3.zero(dst); }
    public JSGSetViewUpVector(v: ReadonlyVec3) { }
    public JSGGetViewTargetPosition(dst: vec3) { vec3.zero(dst); }
    public JSGSetViewTargetPosition(v: ReadonlyVec3) { }
    public JSGGetViewRoll() { return 0.0 };
    public JSGSetViewRoll(roll: number) { };
}

class TCameraAdaptor extends TAdaptor {
    constructor(
        override object: TCamera
    ) { super(11); }

    public override adaptor_do_prepare(obj: STBObject): void {
        this.variableValues[ECameraTrack.FovY].setOutput(this.object.JSGSetProjectionFovy.bind(this.object));
        this.variableValues[ECameraTrack.Roll].setOutput(this.object.JSGSetViewRoll.bind(this.object));
        this.variableValues[ECameraTrack.DistNear].setOutput(this.object.JSGSetProjectionNear.bind(this.object));
        this.variableValues[ECameraTrack.DistFar].setOutput(this.object.JSGSetProjectionFar.bind(this.object));
    }

    public override adaptor_do_begin(obj: STBObject): void {
        const camPos = scratchVec3a;
        const targetPos = scratchVec3b;
        this.object.JSGGetViewPosition(camPos);
        this.object.JSGGetViewTargetPosition(targetPos);

        vec3.transformMat4(camPos, camPos, obj.control.getTransformOnGet());
        vec3.transformMat4(targetPos, targetPos, obj.control.getTransformOnGet());

        this.adaptor_setVariableValue_Vec(ECameraTrack.PosX, camPos);
        this.adaptor_setVariableValue_Vec(ECameraTrack.TargetX, targetPos);
        this.variableValues[ECameraTrack.FovY].setValue_immediate(this.object.JSGGetProjectionFovy());
        this.variableValues[ECameraTrack.Roll].setValue_immediate(this.object.JSGGetViewRoll());
        this.variableValues[ECameraTrack.DistNear].setValue_immediate(this.object.JSGGetProjectionNear());
        this.variableValues[ECameraTrack.DistFar].setValue_immediate(this.object.JSGGetProjectionFar());
    }

    public override adaptor_do_end(obj: STBObject): void {
        this.object.JSGFDisableFlag(1);
    }

    public override adaptor_do_update(obj: STBObject, frameCount: number): void {
        const camPos = scratchVec3a;
        const targetPos = scratchVec3b;

        this.adaptor_getVariableValue_Vec(camPos, ECameraTrack.PosX);
        this.adaptor_getVariableValue_Vec(targetPos, ECameraTrack.TargetX);

        vec3.transformMat4(camPos, camPos, obj.control.getTransformOnSet());
        vec3.transformMat4(targetPos, targetPos, obj.control.getTransformOnSet());

        this.object.JSGSetViewPosition(camPos);
        this.object.JSGSetViewTargetPosition(targetPos);
    }

    public override adaptor_do_data(obj: STBObject, id: number, data: DataView): void {
        // This is not used by TWW. Untested.
        debugger;
    }

    // Custom adaptor functions. These can be called from within TCameraObject::do_paragraph()
    public adaptor_do_PARENT(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }

    public adaptor_do_PARENT_NODE(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }

    public adaptor_do_PARENT_ENABLE(dataOp: EDataOp, data: number | string, unk0: number): void {
        debugger;
    }
}

class TCameraObject extends STBObject {
    constructor(
        control: TControl,
        blockObj: TBlockObject,
        stageObj: JStage.TObject,
    ) { super(control, blockObj, new TCameraAdaptor(stageObj as TCamera)) }

    public override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const dataOp = (param & 0x1F) as EDataOp;
        const cmdType = param >> 5;

        let keyCount = 1;
        let keyIdx;

        switch (cmdType) {
            // Eye position
            case 0x15: keyIdx = ECameraTrack.PosX; break;
            case 0x16: keyIdx = ECameraTrack.PosY; break;
            case 0x17: keyIdx = ECameraTrack.PosZ; break;
            case 0x18: keyCount = 3; keyIdx = ECameraTrack.PosX; break;
                break;

            // Target position
            case 0x19: keyIdx = ECameraTrack.TargetX; break;
            case 0x1A: keyIdx = ECameraTrack.TargetY; break;
            case 0x1B: keyIdx = ECameraTrack.TargetZ; break;
            case 0x1C: keyCount = 3; keyIdx = ECameraTrack.TargetX; break;

            // Camera params
            case 0x26: keyIdx = ECameraTrack.Roll; break;
            case 0x27: keyIdx = ECameraTrack.FovY; break;

            // Near/far distance
            case 0x28: keyIdx = ECameraTrack.DistNear; break;
            case 0x29: keyIdx = ECameraTrack.DistFar; break;
            case 0x2A: keyCount = 2; keyIdx = ECameraTrack.DistNear; break;

            default:
                console.debug('Unsupported TCamera update: ', cmdType, ' ', dataOp);
                debugger;
                return;
        }

        let keyData = []
        for (let i = 0; i < keyCount; i++) {
            keyData[i] = readData(dataOp, dataOffset + i * 4, dataSize, file);
            this.adaptor.adaptor_setVariableValue(this, keyIdx + i, keyData[i]);
        }

        const keyName = ECameraTrack[keyIdx].slice(0, keyCount > 0 ? -1 : undefined);
        this.adaptor.log(`Set${keyName}: ${EDataOp[dataOp]} [${keyData.map(k => k.value)}]`);
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Message
//----------------------------------------------------------------------------------------------------------------------
class TMessageAdaptor extends TAdaptor {
    constructor( private messageControl: JMessage.TControl ) { super(0, []); }
 
    public adaptor_do_MESSAGE(data: ParagraphData): void {
        if(this.enableLogging) console.debug('JMSG:', data.value);
        switch (data.dataOp) {
            case EDataOp.ObjectIdx: this.messageControl.setMessageCode(data.value); break;
            default: assert(false);
        }
    }
}

class TMessageObject extends STBObject {
    override adaptor: TMessageAdaptor;

    constructor(
        control: TControl,
        blockObj: TBlockObject,
        adaptor: TMessageAdaptor,
    ) { super(control, blockObj, adaptor) }

    public override do_paragraph(file: Reader, dataSize: number, dataOffset: number, param: number): void {
        const type = param >> 5;
        const dataOp = param & 0x1F;
        switch( type ) {
            case 0x42: return this.adaptor.adaptor_do_MESSAGE(readData(dataOp, dataOffset, dataSize, file));
            default: console.error('Unexpected JMSG paragraph type:', type);
        }
    }
}

//----------------------------------------------------------------------------------------------------------------------
// Parsing helpers
//----------------------------------------------------------------------------------------------------------------------
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

    public static parse(view: DataView, byteIdx: number): TParagraph {
        // The top bit of the paragraph determines if the type and size are 16 bit (if set), or 32 (if not set)
        let dataSize = view.getUint16(byteIdx);
        let type;
        let offset;

        if ((dataSize & 0x8000) === 0) {
            // 16 bit data
            type = view.getUint16(byteIdx + 2);
            offset = 4;
        } else {
            // 32 bit data
            dataSize = view.getUint32(byteIdx + 0) & ~0x80000000;
            type = view.getUint32(byteIdx + 4);
            offset = 8;
        }

        if (dataSize === 0) {
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

    enum EExtrapolateType {
        Raw,
        Repeat,
        Turn,
        Clamp
    }

    enum EAdjustType {
        Raw = 0,
        BiasBegin = 1,
        BiasEnd = 2,
        BiasAve = 3,
        Remap = 4,
    };

    class TBlock {
        size: number;
        type: number;
        id: string;
        dataOffset: number;
    };

    export abstract class TFunctionValue {
        public idNo: number;
        protected range: Attribute.Range | null = null;
        protected refer: Attribute.Refer | null = null;
        protected interpolate: Attribute.Interpolate | null = null;

        public abstract getType(): EFuncValType;
        public abstract prepare(): void;
        public abstract getValue(arg: number): number;

        public getAttrRange() { return this.range; }
        public getAttrRefer() { return this.refer; }
        public getAttrInterpolate() { return this.interpolate; }

        public setIdNo(idNo: number) { this.idNo = idNo; }

        public static calcFunction_outside(type: EExtrapolateType, frame: number, maxFrame: number) {
            switch (type) {
                case EExtrapolateType.Raw: return frame;
                case EExtrapolateType.Repeat: frame = frame % maxFrame; return frame < 0 ? frame + maxFrame : frame;
                case EExtrapolateType.Turn: frame %= (2 * maxFrame); if (frame < 0) frame += maxFrame; return frame > maxFrame ? 2 * maxFrame - frame : frame;
                case EExtrapolateType.Clamp: return clamp(frame, 0.0, maxFrame);
            }
        }
    }

    export abstract class TObject {
        public funcVal: TFunctionValue;
        public id: string;

        constructor(block: TBlock) {
            this.id = block.id;
        }

        public abstract prepare_data(para: TParagraph, control: TControl, file: Reader): void;

        public prepare(block: TBlock, pControl: TControl, file: Reader) {
            const blockNext = file.offset + block.size;
            file.offset = blockNext;

            let pOffset = block.dataOffset;
            while (pOffset < blockNext) {
                const para = TParagraph.parse(file.view, pOffset);
                switch (para.type) {
                    case EPrepareOp.None:
                        this.funcVal.prepare();
                        assert(para.nextOffset === blockNext);
                        return;

                    case EPrepareOp.Data:
                        this.prepare_data(para, pControl, file);
                        break;

                    case EPrepareOp.RangeSet:
                        assert(para.dataSize === 8);
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
                            const obj = pControl.objects.find(o => o.id === id);
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
                            const obj = pControl.objects[idx];
                            assert(!!obj);
                            refer.fvs.push(obj.funcVal);
                        }
                        break;
                    }

                    case EPrepareOp.InterpSet:
                        assert(para.dataSize === 4);
                        const interp = this.funcVal.getAttrInterpolate();
                        assert(!!interp, 'FVB Paragraph assumes FuncVal has interpolate attribute, but it does not');
                        const interpType = file.view.getUint32(para.dataOffset + 0);
                        interp.set(interpType);
                        break;
                    
                    case EPrepareOp.RangeOutside: {
                        assert(para.dataSize === 4);
                        const range = this.funcVal.getAttrRange();
                        assert(!!range, 'FVB Paragraph assumes FuncVal has range attribute, but it does not');
                        const underflow = file.view.getInt16(para.dataOffset + 0);
                        const overflow = file.view.getInt16(para.dataOffset + 2);
                        range.setExtrapolation(underflow, overflow);
                        break;
                    }

                    case EPrepareOp.RangeAdjust: {
                        assert(para.dataSize === 4);
                        const range = this.funcVal.getAttrRange();
                        assert(!!range, 'FVB Paragraph assumes FuncVal has range attribute, but it does not');
                        const adjust = file.view.getInt32(para.dataOffset + 0)
                        range.setAdjust(adjust);
                        break;
                    }


                    case EPrepareOp.RangeProgress:
                    default:
                        console.warn('Unhandled FVB PrepareOp: ', para.type);
                        debugger;
                }
                pOffset = para.nextOffset;
            }

            assert(pOffset === blockNext);
            this.funcVal.prepare();
        }
    }

    export class TControl {
        public objects: TObject[] = [];

        // Really this is a fvb::TFactory method
        public createObject(block: TBlock): TObject | null {
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
                    return null;
            }
        }

        public destroyObject_all() {
            this.objects = [];
        }
    }

    export class TParse {
        constructor(
            private control: TControl
        ) { }

        private parseBlock(file: Reader, flags: number): boolean {
            const idLen = file.view.getUint16(file.offset + 6);
            const block: TBlock = {
                size: file.view.getUint32(file.offset + 0),
                type: file.view.getUint16(file.offset + 4),
                id: readString(file.buffer, file.offset + 8, idLen),
                dataOffset: file.offset + align(8 + idLen, 4),
            }

            const obj = this.control.createObject(block);
            if (!obj) { return false; }

            obj.prepare(block, this.control, file);
            obj.funcVal.setIdNo(this.control.objects.length);
            this.control.objects.push(obj);

            return true;
        }

        public parse(data: ArrayBufferSlice, flags: number) {
            const view = data.createDataView();
            let fourCC = readString(data, 0, 4);
            let byteOrder = view.getUint16(0x04);
            let version = view.getUint16(0x06);
            let blockCount = view.getUint32(0x0C);
            assert(fourCC === 'FVB');
            assert(byteOrder === 0xFEFF);
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
            private adjust: EAdjustType = 0;
            private underflow: EExtrapolateType = 0;
            private overflow: EExtrapolateType = 0;

            public prepare() {
                // Progress updated here
            }

            public set(begin: number, end: number) {
                this.begin = begin;
                this.end = end;
                this.diff = end - begin;
                assert(this.diff >= 0);
            }

            public setAdjust(adjust: EAdjustType) {
                this.adjust = adjust;
            }

            public setExtrapolation(underflow: EExtrapolateType, overflow: EExtrapolateType) {
                this.underflow = underflow;
                this.overflow = overflow;
            }

            public getParameter(time: number, startTime: number, endTime: number): number {
                // @NOTE: Does not currently support, Progress modifications. These can only be set
                //        in an FVB paragraph, so attempt to set them will be caught in FVB.TObject.prepare().

                const progress = time;

                if( this.adjust != 0 ) {
                    debugger; // Untested. Remove once confirmed working
                }

                switch (this.adjust) {
                    case EAdjustType.Raw: return this.extrapolate(progress);
                    case EAdjustType.BiasBegin: return this.extrapolate(progress + this.begin);
                    case EAdjustType.BiasEnd: return this.extrapolate(progress) + this.end;
                    case EAdjustType.BiasAve: return this.extrapolate(progress) + 0.5 * (this.begin + this.end);
                    case EAdjustType.Remap: 
                        const temp = this.extrapolate(progress);
                        return startTime + ((temp - this.begin) * (endTime - startTime)) / this.diff;
                    
                    default: 
                        debugger; 
                        return this.extrapolate(progress);
                }
            }

            private extrapolate(progress: number) {
                let t = progress
                t -= this.begin;
                if (t < 0.0) { t = FVB.TFunctionValue.calcFunction_outside(this.underflow, t, this.diff); }
                else if (t >= this.diff) { t = FVB.TFunctionValue.calcFunction_outside(this.overflow, t, this.diff); }
                t += this.begin;
                return t;
            }
        }

        export class Refer {
            public fvs: TFunctionValue[] = [];
        }

        export class Interpolate {
            private type = EInterpolateType.None;
            public prepare() { }
            public set(type: EInterpolateType) { this.type = type; }
            public get() { return this.type; }

            public static Linear(t: number, t0: number, v0: number, t1: number, v1: number) {
                return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
            }

            public static BSpline_Nonuniform(t: number, controlPoints: Float64Array, knotVector: Float64Array) {
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

            public static Hermite(c0: number, c1: number, x: number, c2: number, x2: number, c3: number, x3: number) {
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

        public override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize === 4);
            const value = file.view.getFloat32(para.dataOffset);
            this.funcVal.setData(value);
        }
    }

    class FunctionValue_Constant extends TFunctionValue {
        private value: number = 0;

        public getType() { return EFuncValType.Constant; }
        public prepare() { }
        public setData(value: number) { this.value = value; }
        public getValue(timeSec: number) {
            return this.value;
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // FunctionValue: ListParameter
    // Interpolate between a list of values using a specific interpolation function [None, Linear, Plateau, BSpline]
    //----------------------------------------------------------------------------------------------------------------------
    class TObject_ListParameter extends FVB.TObject {
        override funcVal = new FunctionValue_ListParameter;

        public override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
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

        public prepare(): void {
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

        public setData(values: Float32Array) {
            this.keys = values;
            this.keyCount = values.length / 2;
            this.curKeyIdx = 0;
        }

        public getType() { return EFuncValType.ListParameter; }
        public getStartTime() { return this.keys[0]; }
        public getEndTime(): number { return this.keys[this.keys.length - 2]; }

        // Interpolate between our keyframes, given the current time
        public getValue(timeSec: number): number {
            // Remap (if requested) the time to our range
            const t = this.range.getParameter(timeSec, this.getStartTime(), this.getEndTime());

            // Update our current key. If the current time is between keys, select the later one.
            this.curKeyIdx = this.keys.findIndex((k, i) => (i % 2) === 0 && k >= t) / 2;

            if (this.curKeyIdx === 0) { // Time is at or before the start, return the first key
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

        public interpolateBSpline(t: number): number {
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

        public interpolateNone(t: number) {
            debugger; // Untested. Remove after confirmed working.
            return this.keys[this.curKeyIdx];
        }

        public interpolateLinear(t: number) {
            const ks = this.keys;
            const c = this.curKeyIdx * 2;
            return Attribute.Interpolate.Linear(t, ks[c - 2], ks[c - 1], ks[c + 0], ks[c + 1]);
        }

        public interpolatePlateau(t: number) {
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
    enum ECompositeOp {
        None,
        Raw,
        Idx,
        Parm,
        Add,
        Sub,
        Mul,
        Div,
    }

    class TObject_Composite extends FVB.TObject {
        override funcVal = new FunctionValue_Composite;

        public override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
            assert(para.dataSize >= 8);

            const compositeOp = file.view.getUint32(para.dataOffset + 0);
            const floatData = file.view.getFloat32(para.dataOffset + 4);
            const uintData = file.view.getUint32(para.dataOffset + 4);

            let fvData: number;
            let fvFunc: (ref: TFunctionValue[], data: number, t: number) => number;
            switch (compositeOp) {
                case ECompositeOp.Raw: fvData = uintData; fvFunc = FunctionValue_Composite.composite_raw; break;
                case ECompositeOp.Idx: fvData = uintData; fvFunc = FunctionValue_Composite.composite_index; break;
                case ECompositeOp.Parm: fvData = floatData; fvFunc = FunctionValue_Composite.composite_parameter; break;
                case ECompositeOp.Add: fvData = floatData; fvFunc = FunctionValue_Composite.composite_add; break;
                case ECompositeOp.Sub: fvData = floatData; fvFunc = FunctionValue_Composite.composite_subtract; break;
                case ECompositeOp.Mul: fvData = floatData; fvFunc = FunctionValue_Composite.composite_multiply; break;
                case ECompositeOp.Div: fvData = floatData; fvFunc = FunctionValue_Composite.composite_divide; break;
                default:
                    console.warn('Unsupported CompositeOp:', compositeOp);
                    return;
            }

            this.funcVal.setData(fvFunc, fvData)
        }
    }

    class FunctionValue_Composite extends TFunctionValue {
        protected override refer = new Attribute.Refer();

        public override prepare(): void { }
        public override getType(): EFuncValType { return EFuncValType.Composite; }
        public setData(func: (ref: TFunctionValue[], dataVal: number, t: number) => number, dataVal: number) {
            this.func = func;
            this.dataVal = dataVal;
        }

        public getValue(timeSec: number): number {
            return this.func(this.refer.fvs, this.dataVal, timeSec);
        }

        public static composite_raw(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            if (fvs.length === 0) { return 0.0; }
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
            let val = dataVal;
            for (let fv of fvs) { val += fv.getValue(timeSec); }
            return val;
        }

        public static composite_subtract(fvs: TFunctionValue[], dataVal: number, timeSec: number): number {
            debugger; // Untested. Remove once confirmed working
            if (fvs.length === 0) { return 0.0; }
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
            if (fvs.length === 0) { return 0.0; }
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
        public override funcVal = new FunctionValue_Hermite;

        public override prepare_data(para: TParagraph, control: TControl, file: Reader): void {
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

        public prepare(): void { this.range.prepare(); }

        public setData(values: Float32Array, stride: number) {
            assert(stride === 3 || stride === 4);
            this.stride = stride
            this.keys = values;
            this.keyCount = values.length / stride;
            this.curKeyIdx = 0;
        }

        public getType() { return EFuncValType.ListParameter; }
        public getStartTime() { return this.keys[0]; }
        public getEndTime(): number { return this.keys[(this.keyCount - 1) * this.stride]; }

        public getValue(timeSec: number): number {
            // @TODO: Support range parameters like Outside

            // Remap (if requested) the time to our range
            const t = this.range.getParameter(timeSec, this.getStartTime(), this.getEndTime());

            // Update our current key. If the current time is between keys, select the later one.
            this.curKeyIdx = this.keys.findIndex((k, i) => (i % this.stride) === 0 && k >= t) / this.stride;

            if (this.curKeyIdx === 0) { // Time is at or before the start, return the first key
                return this.keys[this.curKeyIdx * this.stride + 1];
            } else if (this.curKeyIdx < 0) { // Time is at or after the end, return the last key
                this.curKeyIdx = this.keyCount - 1;
                return this.keys[this.curKeyIdx * this.stride + 1];
            }

            const ks = this.keys;
            const c = this.curKeyIdx * this.stride;
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

enum EStatus {
    Still = 0,
    End = 1 << 0,
    Wait = 1 << 1,
    Suspend = 1 << 2,
    Inactive = 1 << 3,
}

export abstract class TBlockObject {
    size: number;
    type: string; // char[4] JMSG, JSND, JACT, ...
    flag: number;
    id: string;
    data: Reader;
}

// This combines JStudio::TControl and JStudio::stb::TControl into a single class, for simplicity.
export class TControl {
    public system: TSystem;
    public msgControl: JMessage.TControl;
    public fvbControl = new FVB.TControl();
    public secondsPerFrame: number = 1 / 30.0;
    private suspendFrames: number;

    public transformOrigin: vec3 | null = null;
    public transformRotY: number | null = null;
    private transformOnGetMtx = mat4.create();
    private transformOnSetMtx = mat4.create();

    private status: EStatus = EStatus.Still;
    private objects: STBObject[] = [];

    // A special object that the STB file can use to suspend the demo (such as while waiting for player input)
    private controlObject = new TControlObject(this);

    constructor(system: TSystem, msgControl: JMessage.TControl) {
        this.system = system;
        this.msgControl = msgControl;
    }

    public isSuspended() { return this.suspendFrames > 0; }
    public setSuspend(frameCount: number) { return this.controlObject.setSuspend(frameCount); }

    public isTransformEnabled() { return !!this.transformOrigin; }
    public getTransformOnSet() { return this.transformOnSetMtx; }
    public getTransformOnGet() { return this.transformOnGetMtx; }
    public transformSetOrigin(originPos: vec3, rotYDeg: number) {
        this.transformOrigin = originPos;
        this.transformRotY = rotYDeg;

        // The "OnGet" matrix transforms from world space into demo space
        mat4.fromYRotation(this.transformOnGetMtx, -rotYDeg * MathConstants.DEG_TO_RAD);
        mat4.translate(this.transformOnGetMtx, this.transformOnGetMtx, vec3.negate(scratchVec3a, originPos));

        // The "OnSet" matrix is the inverse 
        mat4.fromTranslation(this.transformOnSetMtx, originPos);
        mat4.rotateY(this.transformOnSetMtx, this.transformOnSetMtx, rotYDeg * MathConstants.DEG_TO_RAD);
    }

    public setControlObject(obj: TBlockObject) {
        this.controlObject.reset(obj);
    }

    public forward(frameCount: number): boolean {
        let andStatus = 0xFF;
        let orStatus = 0;

        this.suspendFrames = this.controlObject.getSuspendFrames();
        let shouldContinue = this.controlObject.forward(frameCount);

        for (let obj of this.objects) {
            const res = obj.forward(frameCount);
            shouldContinue ||= res;

            const objStatus = obj.getStatus();
            andStatus &= objStatus;
            orStatus |= objStatus;
        }

        this.status = (andStatus | (orStatus << 0x10));
        return shouldContinue;
    }

    public getFunctionValueByIdx(idx: number) { return this.fvbControl.objects[idx].funcVal; }
    public getFunctionValueByName(name: string) { return this.fvbControl.objects.find(v => v.id === name)?.funcVal; }

    // Really this is a stb::TFactory `createObject` method
    public createStageObject(blockObj: TBlockObject): STBObject | null {
        let objConstructor;
        let objType: JStage.EObject;
        switch (blockObj.type) {
            case 'JCMR': objConstructor = TCameraObject; objType = JStage.EObject.Camera; break;
            case 'JACT': objConstructor = TActorObject; objType = JStage.EObject.Actor; break;
            case 'JABL':
            case 'JLIT':
            case 'JFOG':
            default:
                return null;
        }

        const stageObj = this.system.JSGFindObject(blockObj.id, objType);
        if (!stageObj) {
            return null;
        }

        const obj = new objConstructor(this, blockObj, stageObj);
        obj.adaptor.adaptor_do_prepare(obj);
        this.objects.push(obj);
        return obj;
    }

    public createMessageObject(blockObj: TBlockObject): STBObject | null {
        if (blockObj.type == 'JMSG') {
            const adaptor = new TMessageAdaptor(this.msgControl);
            const obj = new TMessageObject(this, blockObj, adaptor);
    
            if (obj) { adaptor.adaptor_do_prepare(obj); }
            this.objects.push(obj);
            return obj;
        }
        return null;
    }

    public destroyObject_all() {
        this.objects = [];
        this.fvbControl.destroyObject_all();
    }
}

export class TParse {
    constructor(
        private control: TControl,
        private fvbParse = new FVB.TParse(control.fvbControl)
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

        if (blockObj.type === BLOCK_TYPE_CONTROL) {
            this.control.setControlObject(blockObj);
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

        let obj = this.control.createStageObject(blockObj);
        if(!obj) { obj = this.control.createMessageObject(blockObj); } 

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
        assert(byteOrder === 0xFEFF);

        let byteIdx = file.offs;
        for (let i = 0; i < file.numChunks; i++) {
            const blockSize = file.view.getUint32(byteIdx + 0);
            const blockType = readString(file.buffer, byteIdx + 4, 4);

            if (blockType === 'JFVB') {
                this.fvbParse.parse(file.buffer.subarray(byteIdx + 8, blockSize - 8), flags)
            } else {
                this.parseBlockObject(new Reader(file.buffer, byteIdx), flags);
            }

            byteIdx += blockSize;
        }

        return true;
    }
}