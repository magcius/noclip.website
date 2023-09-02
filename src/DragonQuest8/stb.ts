import { mat4, vec3, vec4 } from 'gl-matrix';
import ArrayBufferSlice from '../ArrayBufferSlice.js';
import { computeModelMatrixSRT, getMatrixTranslation, setMatrixTranslation } from '../MathHelpers.js';
import { assert, readString } from "../util.js";
import * as IMG from './img.js';
import * as MOT from './mot.js';
import { MDSInstance } from './render.js';

//Misc, hardcoded for now
const MAIN_PROGRESS_ID = 0x1;
const SUB_PROGRESS_ID = 0x0;
const EVENT_FLAGS = 0x0;

//Stack sizes
const STACK_SIZE = 0x280;
const CALL_STACK_SIZE = 0x30;

export interface STBEntry {
    id: number;
    offset: number;
}

enum ETalkStatus {
    NEVERTALKED = 0x0,
    TALKEDONCE = 0x1,
    ISTALKING = 0x2
}

class STBStackInfo {
    //0
    public field0x0: number;
    public functionCount: number;
    public functionTablePtr: number;
    public stackEntryCount: number;
    //0x10
    public minStackPtr: number;
    public currentStackPtr: number;
    public maxStackPtr: number;
    public field0x7: number;
    //0x20
    public callStackEntryCount: number;
    public minCallStackPtr: number;
    public callStackPtr: number;
    public maxCallStackPtr: number;
    //0x30
    public currentBaseStackPtr: number;
    public functionInfoOffsetPtr: number;
    public currentInstructionPtr: number;
    public field0xF: number;
    //0x40
    public field0x10: number;
    public SB2Ptr: number;
    public SB2SecondSectionPtr: number;
    public field0x13: number;
    //0x50
    public field0x14: number;
    public field0x15: number;
    public field0x16: number;
    public field0x17: number;
    //0x60
    public field0x18: number;
    public npcID: number;
    public talkStatus: ETalkStatus;
    public field0x21: number;

    constructor(buffer: ArrayBufferSlice, entry: STBEntry, npcID: number) {
        const view = buffer.createDataView();
        this.minStackPtr = 0; //0x4
        this.stackEntryCount = STACK_SIZE / 8; //0x3
        this.minCallStackPtr = 0; //0x9
        this.callStackEntryCount = CALL_STACK_SIZE / 0xC; //0x8
        this.maxStackPtr = this.minStackPtr + this.stackEntryCount * 2; //0x6
        this.maxCallStackPtr = this.minCallStackPtr + this.callStackEntryCount * 3;//0xB
        this.SB2Ptr = 0; //0x11
        this.SB2SecondSectionPtr = this.SB2Ptr + view.getUint32(this.SB2Ptr + 0x8, true);//0x12
        this.field0x0 = 0x2; //0x0
        this.field0x7 = this.minStackPtr;//0x7
        this.minStackPtr = this.minStackPtr + view.getUint32(this.SB2Ptr + 0x18, true) * 2;//0x4 update
        this.stackEntryCount = this.stackEntryCount - view.getUint32(this.SB2Ptr + 0x18, true);//0x3 update

        this.functionCount = 0x64; //0x1
        this.functionTablePtr = -1; //0x2 we use the IDs directly

        this.currentStackPtr = this.minStackPtr; //0x5
        this.callStackPtr = this.minCallStackPtr; //0xA
        this.functionInfoOffsetPtr = this.SB2Ptr + entry.offset;//0xD
        assert(view.getUint32(this.functionInfoOffsetPtr + 0xC, true) === 0); //Should always be 0 or we'll get under min value
        this.currentBaseStackPtr = this.currentStackPtr + view.getUint32(this.functionInfoOffsetPtr + 0xC, true) * -2;//0xC
        this.currentStackPtr = this.currentBaseStackPtr + view.getUint32(this.functionInfoOffsetPtr + 0x8, true) * 2;//0x5 update
        this.field0xF = 0;//0xF
        this.field0x10 = 0;//0x10
        this.field0x14 = 0;//0x14
        this.field0x13 = 0;//0x13
        this.currentInstructionPtr = this.SB2SecondSectionPtr + view.getUint32(this.functionInfoOffsetPtr, true); //0xE

        this.npcID = npcID;
        this.talkStatus = ETalkStatus.NEVERTALKED;
    }
}

function stackOverflowCheck(stackInfo: STBStackInfo) {
    if (stackInfo.currentStackPtr >= stackInfo.maxStackPtr)
        throw "stack overflow";
}

function pop(stack: number[], stackInfo: STBStackInfo): number[] {
    stackInfo.currentStackPtr -= 2;
    return [stack[stackInfo.currentStackPtr], stack[stackInfo.currentStackPtr + 1]];
}

function push(type: number, value: number, stack: number[], stackInfo: STBStackInfo) {
    stackOverflowCheck(stackInfo);
    stack[stackInfo.currentStackPtr] = type;
    stack[stackInfo.currentStackPtr + 1] = value;
    stackInfo.currentStackPtr += 2;
}

function externalFunctionCall(buffer: ArrayBufferSlice, stb: STB, functionID: number, argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance) {
    if (functionID === 0x2)
        //Copy vector
        func0x2(argvPtr, stack);
    else if (functionID === 0x4)
        //Sub vectors
        func0x4(argvPtr, argc, stack);
    else if (functionID === 0x7)
        //Vector magnitude
        func0x7(argvPtr, argc, stack);
    else if (functionID === 0x9)
        //Atan
        func0x9(argvPtr, argc, stack);
    else if (functionID === 0xA)
        //Compare angle, somewhat
        func0xA(argvPtr, argc, stack);
    else if (functionID === 0xB)
        //Wrap angle
        func0xB(argvPtr, argc, stack);
    else if (functionID === 0xC)
        //Get random value
        func0xC(argvPtr, argc, stack);
    else if (functionID === 0xD)
        //Move + coll check
        func0xD(argvPtr, argc, stack);
    else if (functionID === 0x14)
        //Set unknown field
        func0x14(argvPtr, argc, stack);
    else if (functionID === 0x15)
        //Get current progress data
        func0x15(argvPtr, argc, stack);
    else if (functionID === 0x16)
        //TODO, see moutain house
        func0x16(argvPtr, argc, stack);
    else if (functionID === 0x17)
        //TODO, see Neos house
        func0x17(argvPtr, argc, stack);
    else if (functionID === 0x19)
        //Somewhat similar to 0x15? Progress/Flags related too it seems, see royal huntings ground with Argon lizards
        //For now, pass it to 0x15
        func0x15(argvPtr, argc, stack);
    else if (functionID === 0x1D)
        //TODO, see moutain house
        func0x1D(argvPtr, argc, stack);
    else if (functionID === 0x1F)
        //Get NPC id
        func0x1F(argvPtr, argc, stack, stackInfo);
    else if (functionID === 0x20)
        //Get talking status
        func0x20(argvPtr, argc, stack, stackInfo);
    else if (functionID === 0x32)
        //Get Position
        func0x32(argvPtr, argc, stack, stackInfo, mdsInstance);
    else if (functionID === 0x33)
        //Set Position
        func0x33(argvPtr, argc, stack, stackInfo, mdsInstance);
    else if (functionID === 0x34)
        //Get Y axis rotation
        func0x34(argvPtr, argc, stack, stackInfo, mdsInstance);
    else if (functionID === 0x35)
        //Set rotation
        func0x35(argvPtr, argc, stack, stackInfo, mdsInstance);
    else if (functionID === 0x36)
        //Set motion
        func0x36(buffer, stb, argvPtr, stack, mdsInstance);
    else if (functionID === 0x37)
        //Set face anim
        func0x37(buffer, stb, argvPtr, stack, mdsInstance);
    else if (functionID === 0x3A)
        //Related to joints attachement, ignored for now
        func0x3A(argvPtr, argc, stack);
    else if (functionID === 0x3B)
        //Set motion speed rate ?
        func0x3B(argvPtr, argc, stack);
    else if (functionID === 0x3D)
        //Need more investigation but doesn't seem to affect scripting behavior, just writing to game's flags
        func0x3D(argvPtr, argc, stack);
    else if (functionID === 0x3E)
        //Same as 0x3D
        func0x3E(argvPtr, argc, stack);
    else
        throw "unknown function id " + functionID.toString();
}

export function processInstruction(buffer: ArrayBufferSlice, stb: STB, stack: number[], callStack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance): boolean {
    const view = buffer.createDataView();
    const instructionID = view.getUint32(stackInfo.currentInstructionPtr, true);
    if (instructionID === 0x1) {
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
        if (data1 === 1) {
            //copy value
            push(stack[stackInfo.currentBaseStackPtr + 2 * data0], stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1], stack, stackInfo);
        }
        else if (data1 === 0x2) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 1 x 0x2 instruction";
            push(stack[stackInfo.currentBaseStackPtr + 2 * data0 + 2 * v1], stack[stackInfo.currentBaseStackPtr + 2 * data0 + 2 * v1 + 1], stack, stackInfo);
        }
        else if (data1 === 0x4) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 1 x 0x4 instruction";
            const vPtr = stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1 + 2 * v1];
            push(stack[vPtr], stack[vPtr + 1], stack, stackInfo);
        }
        else if (data1 === 0x8) {
            stack[stackInfo.currentBaseStackPtr + 2 * data0] = 1;
            push(1, stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1], stack, stackInfo);
        }
        else if (data1 === 0x10) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 1 x 0x10 instruction";
            stack[stackInfo.currentBaseStackPtr + 2 * data0 + 2 * v1] = 1;
            push(1, stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1 + 2 * v1], stack, stackInfo);
        }
        else if (data1 === 0x20) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 1 x 0x20 instruction";
            stack[stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1] + 2 * v1] = 1;
            push(1, stack[stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1] + 2 * v1 + 1], stack, stackInfo);
        }
        else if (data1 === 0x40) {
            push(stack[stackInfo.field0x7 + 2 * data0], stack[stackInfo.field0x7 + 2 * data0 + 1], stack, stackInfo);
        }
        else if (data1 === 0x200) {
            stack[stackInfo.field0x7 + 2 * data0] = 1;
            push(1, stack[stackInfo.field0x7 + 2 * data0 + 1], stack, stackInfo);
        }
        else
            throw "unimplemented script instruction : " + instructionID.toString() + " " + data0.toString() + " " + data1.toString();

    }
    else if (instructionID === 0x2) {
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
        if (data1 === 0x1) {
            //store return value address
            const currentBaseStackPtr = stackInfo.currentBaseStackPtr;
            push(3, currentBaseStackPtr + 2 * data0, stack, stackInfo);
        }
        else if (data1 === 0x2) {
            const currentBaseStackPtr = stackInfo.currentBaseStackPtr;
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 2 x 0x2 instruction";
            push(3, currentBaseStackPtr + 2 * data0 + 2 * v1, stack, stackInfo);
        }
        else if (data1 === 0x4) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 2 x 0x4 instruction";
            push(3, stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1 + 2 * v1], stack, stackInfo);
        }
        else if (data1 === 0x8) {
            //store return value address, duplicate of 1 ?...
            const currentBaseStackPtr = stackInfo.currentBaseStackPtr;
            push(3, currentBaseStackPtr + 2 * data0, stack, stackInfo);
        }
        else if (data1 === 0x10) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 2 x 0x10 instruction";
            push(3, stackInfo.currentBaseStackPtr + 2 * data0 + 2 * v1, stack, stackInfo);
        }
        else if (data1 === 0x20) {
            const a = pop(stack, stackInfo);
            const t1 = a[0];
            const v1 = a[1];
            if (t1 !== 0)
                throw "Unexpected data type for 2 x 0x20 instruction";
            push(3, stack[stackInfo.currentBaseStackPtr + 2 * data0 + 1] + 2 * v1, stack, stackInfo);
        }
        else if (data1 === 0x40) {
            push(3, stackInfo.field0x7 + 2 * data0, stack, stackInfo);
        }
        else if (data1 === 0x200) {
            //Same as 0x40 ?...
            push(3, stackInfo.field0x7 + 2 * data0, stack, stackInfo);
        }
        else
            throw "unimplemented script instruction : " + instructionID.toString() + " " + data0.toString() + " " + data1.toString();
    }
    else if (instructionID === 0x3) {
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        if (data0 === 0x1) {
            //push an int
            const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
            push(0, data1, stack, stackInfo);
        }
        else if (data0 === 0x2) {
            //push a float
            const data1 = view.getFloat32(stackInfo.currentInstructionPtr + 0x8, true);
            push(1, data1, stack, stackInfo);
        }
        else if (data0 === 0x3) {
            //push a string ptr
            const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
            push(2, data1 + stackInfo.SB2SecondSectionPtr, stack, stackInfo);
        }
        else
            throw "unimplemented script instruction : " + instructionID.toString() + " " + data0.toString();
    }
    else if (instructionID === 0x4) {
        stackInfo.currentStackPtr -= 2;
    }
    else if (instructionID === 0x5) {
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];

        stack[v2] = t1;
        stack[v2 + 1] = v1;
        push(t1, v1, stack, stackInfo);
    }
    else if (instructionID === 0x6) {
        //Add
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];
        push(!t1 && !t2 ? 0 : 1, v2 + v1, stack, stackInfo);
    }
    else if (instructionID === 0x7) {
        //Subtract
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];

        push(!t1 && !t2 ? 0 : 1, v2 - v1, stack, stackInfo);
    }
    else if (instructionID === 0x8) {
        //Multiply
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];

        push(!t1 && !t2 ? 0 : 1, v2 * v1, stack, stackInfo);
    }
    else if (instructionID === 0x9) {
        //Divide
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];
        if (!v1)
            throw "Division by 0 error";

        if (!t1 && !t2)
            push(0, Math.floor(v2 / v1), stack, stackInfo);
        else
            push(1, v2 / v1, stack, stackInfo);
    }
    else if (instructionID === 0xa) {
        //Modulo
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];
        if (t1 !== 0 || t2 !== 0) {
            throw "Modulo operation only takes integers";
        }

        push(0, v2 % v1, stack, stackInfo);
    }
    else if (instructionID === 0xb) {
        //Negate
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];

        push(!t1 ? 0 : 1, - v1, stack, stackInfo);
    }
    else if (instructionID === 0xc) {
        //itof
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        push(1, v1, stack, stackInfo);

    }
    else if (instructionID === 0xd) {
        //ftoi
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        push(0, v1, stack, stackInfo);

    }
    else if (instructionID === 0xe) {
        //Comparisons
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        const v1 = pop(stack, stackInfo)[1];
        const v2 = pop(stack, stackInfo)[1];
        if (data0 === 0x28)
            push(0, v1 === v2 ? 1 : 0, stack, stackInfo);
        else if (data0 === 0x29)
            push(0, v1 !== v2 ? 1 : 0, stack, stackInfo);
        else if (data0 === 0x2a)
            push(0, v1 > v2 ? 1 : 0, stack, stackInfo);
        else if (data0 === 0x2b)
            push(0, v1 >= v2 ? 1 : 0, stack, stackInfo);
        else if (data0 === 0x2c)
            push(0, v1 < v2 ? 1 : 0, stack, stackInfo);
        else if (data0 === 0x2d)
            push(0, v1 <= v2 ? 1 : 0, stack, stackInfo);
        else
            throw "unimplemented script instruction : " + instructionID.toString() + " " + data0.toString();
    }
    else if (instructionID === 0xf) {
        //Return from "local" function
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];

        if (stackInfo.callStackPtr === stackInfo.minCallStackPtr) {
            stackInfo.field0x13 = v1;
            push(t1, v1, stack, stackInfo);
            stackInfo.currentInstructionPtr = 0;
            stackInfo.field0xF = 1;
            return true;
        }

        stackInfo.currentStackPtr = stackInfo.currentBaseStackPtr;
        stackInfo.callStackPtr -= 3;
        stackInfo.currentBaseStackPtr = callStack[stackInfo.callStackPtr + 1];
        stackInfo.functionInfoOffsetPtr = callStack[stackInfo.callStackPtr + 2];
        stackInfo.currentInstructionPtr = callStack[stackInfo.callStackPtr];
        push(t1, v1, stack, stackInfo);
    }
    else if (instructionID === 0x10) {
        //Branch
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        if (!stackInfo.field0x10) {
            stackInfo.currentInstructionPtr = stackInfo.SB2SecondSectionPtr + data0 - 0xC;
        }
    }
    else if (instructionID === 0x11) {
        //Branch if not
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
        if (!stackInfo.field0x10) {
            const value = pop(stack, stackInfo);
            if (value[0] === 0 && value[1] === 0) {
                if (data1 !== 0) {
                    push(0, 0, stack, stackInfo);
                }
                stackInfo.currentInstructionPtr = stackInfo.SB2SecondSectionPtr + data0 - 0xC;
            }
        }
    }
    else if (instructionID === 0x12) {
        //Branch if
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
        if (!stackInfo.field0x10) {
            const value = pop(stack, stackInfo);
            if (!(value[0] === 0 && value[1] === 0)) {
                if (data1 !== 0) {
                    push(0, 1, stack, stackInfo);
                }
                stackInfo.currentInstructionPtr = stackInfo.SB2SecondSectionPtr + data0 - 0xC;
            }
        }
    }
    else if (instructionID === 0x13) {
        //"Local" function call
        const data1 = view.getUint32(stackInfo.currentInstructionPtr + 0x8, true);
        const currentInstructionPtr = stackInfo.currentInstructionPtr;
        const functionInfoPtr = stackInfo.SB2SecondSectionPtr + data1;
        if (stackInfo.callStackPtr >= stackInfo.maxCallStackPtr)
            throw "Call stack overflow";
        callStack[stackInfo.callStackPtr] = currentInstructionPtr;
        callStack[stackInfo.callStackPtr + 2] = stackInfo.functionInfoOffsetPtr;
        callStack[stackInfo.callStackPtr + 1] = stackInfo.currentBaseStackPtr;
        stackInfo.currentBaseStackPtr = stackInfo.currentStackPtr + view.getUint32(functionInfoPtr + 0xC, true) * -2;
        stackInfo.currentStackPtr = stackInfo.currentBaseStackPtr + view.getUint32(functionInfoPtr + 0x8, true) * 2;
        stackInfo.functionInfoOffsetPtr = functionInfoPtr;
        stackInfo.callStackPtr += 3;
        //memset, zero out stack
        for (let j = 0; j < (view.getUint32(functionInfoPtr + 0x8, true) - view.getUint32(functionInfoPtr + 0xC, true)) * 2; j++) {
            stack[stackInfo.currentBaseStackPtr + view.getUint32(functionInfoPtr + 0xC, true) * 2 + j] = 0;
        }
        stackOverflowCheck(stackInfo);
        stackInfo.currentInstructionPtr = stackInfo.SB2SecondSectionPtr + view.getUint32(functionInfoPtr, true) - 0xC;
    }
    else if (instructionID === 0x14) {
        //Print function, used for debugging ? We just stack related variables accordingly and move on
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        stackInfo.currentStackPtr = stackInfo.currentStackPtr + data0 * -2;
    }
    else if (instructionID === 0x15) {
        //External function call
        const data0 = view.getUint32(stackInfo.currentInstructionPtr + 0x4, true);
        stackInfo.currentStackPtr = stackInfo.currentStackPtr + data0 * -2;
        if (!stackInfo.field0x10) {
            const functionID = stack[stackInfo.currentStackPtr + 1];
            if (functionID >= stackInfo.functionCount)
                throw "function doesn't exist in table";
            externalFunctionCall(buffer, stb, functionID, stackInfo.currentStackPtr + 2, data0 - 1, stack, stackInfo, mdsInstance);
        }
    }
    else if (instructionID === 0x16) {
        //Nothing happening ?
    }
    else if (instructionID === 0x17) {
        if (!stackInfo.field0x10) {
            stackInfo.currentInstructionPtr += 0xC;
            return true;
        }
    }
    else if (instructionID === 0x18) {
        //And
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];
        if (t1 !== 0 || t2 !== 0) {
            throw "And operation only takes integers";
        }

        push(0, v2 & v1, stack, stackInfo);
    }
    else if (instructionID === 0x19) {
        //Or
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        const b = pop(stack, stackInfo);
        const t2 = b[0];
        const v2 = b[1];
        if (t1 !== 0 || t2 !== 0) {
            throw "Or operation only takes integers";
        }

        push(0, v2 | v1, stack, stackInfo);
    }
    else if (instructionID === 0x1a) {
        //Not
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        if (t1 !== 0) {
            throw "Not operation only takes an integer";
        }

        push(0, (v1 !== 0) ? 0 : 1, stack, stackInfo);
    }
    else if (instructionID === 0x1b) {
        stackInfo.field0xF = 1;
        stackInfo.currentInstructionPtr = 0;
        return true;
    }
    else if (instructionID === 0x1c) {
        stackInfo.field0x14 += 1;
        if (!stackInfo.field0x10) {
            stackInfo.field0x10 = 0;
            stackInfo.currentInstructionPtr += 0xC;
            return true;
        }
    }
    else if (instructionID === 0x1d) {
        //Sin
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        if (t1 !== 0 && t1 !== 1)
            throw "Wrong datatype for sin";
        push(1, Math.sin(v1), stack, stackInfo);
    }
    else if (instructionID === 0x1e) {
        //Cos
        const a = pop(stack, stackInfo);
        const t1 = a[0];
        const v1 = a[1];
        if (t1 !== 0 && t1 !== 1)
            throw "Wrong datatype for cos";
        push(1, Math.cos(v1), stack, stackInfo);
    }
    else
        throw "unimplemented script instruction : " + instructionID.toString();
    stackInfo.currentInstructionPtr += 0xC;

    return false;
}

export class STB {
    public name: string = "";
    public currentAnimName: string = "";
    public currentEyeAnimName: string = "デフォルト目パチ";
    public currentMouthAnimName: string = "";
    private firstExec = true;
    public currentEntry: number = -1;
    public secondSectionOffset: number;
    public entries = new Map<number, STBEntry>();
    public buffer: ArrayBufferSlice;
    public npcID: number;

    public stack: number[];
    public stackInfo: STBStackInfo;
    public callStack: number[];

    public processEntry(mdsInstance: MDSInstance) {

        if (this.firstExec) {
            const entryID = this.currentEntry;
            if (!this.entries.has(entryID)) {
                if (mdsInstance.mot?.motionNameToMotion.has("立ち")) {
                    mdsInstance.bindMotion(mdsInstance.mot!.motionNameToMotion.get("立ち") as MOT.Motion);
                }
                return;
            }
            const entry = this.entries.get(entryID);

            this.stack = Array(STACK_SIZE / 4).fill(0);
            this.callStack = Array(CALL_STACK_SIZE / 4).fill(0);
            this.stackInfo = new STBStackInfo(this.buffer, entry!, this.npcID);
            this.firstExec = false;
        }
        for (let i = 0; i < 10000; i++) {
            const res = processInstruction(this.buffer, this, this.stack, this.callStack, this.stackInfo, mdsInstance);
            if (res)
                return;
        }
        throw "Possible script bug, 10000 iterations exceeded";
    }
}

export function parse(buffer: ArrayBufferSlice, name: string, npcID: number): STB {
    const view = buffer.createDataView();
    const stb = new STB();
    stb.npcID = npcID;
    stb.buffer = buffer;
    stb.name = name.split('/').pop()!;

    const magic = readString(buffer, 0x00, 0x03);
    assert(magic === 'SB2');
    //offset to unknown last section at 0x4
    stb.secondSectionOffset = view.getUint32(0x08, true);
    const firstSectionOffset = view.getUint32(0xC, true);
    const entryCount = view.getUint32(0x10, true);
    for (let i = 0; i < entryCount; i++) {
        const id = view.getUint32(firstSectionOffset + i * 8, true);
        const offset = view.getUint32(firstSectionOffset + i * 8 + 4, true);
        stb.entries.set(id, { id: id, offset: offset });
    }

    return stb;
}

function func0x2(argvPtr: number, stack: number[]) {
    stack[stack[argvPtr + 1] + 1] = stack[argvPtr + 7];
    stack[stack[argvPtr + 3] + 1] = stack[argvPtr + 9];
    stack[stack[argvPtr + 5] + 1] = stack[argvPtr + 11];
}

function func0x4(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 9) {
        stack[stack[argvPtr + 1] + 1] = stack[argvPtr + 7] - stack[argvPtr + 13];
        stack[stack[argvPtr + 3] + 1] = stack[argvPtr + 9] - stack[argvPtr + 15];
        stack[stack[argvPtr + 5] + 1] = stack[argvPtr + 11] - stack[argvPtr + 17];
    }
    else
        throw "Unexpected func0x4 argument count";
}

function func0x7(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 7) {
        const a = stack[argvPtr + 7] - stack[argvPtr + 1];
        const b = stack[argvPtr + 9] - stack[argvPtr + 3];
        const c = stack[argvPtr + 11] - stack[argvPtr + 5];
        stack[stack[argvPtr + 13] + 1] = Math.sqrt(a * a + b * b + c * c);
    }
    else if (argc === 4) {
        const a = stack[argvPtr + 1];
        const b = stack[argvPtr + 3];
        const c = stack[argvPtr + 5];
        stack[stack[argvPtr + 7] + 1] = Math.sqrt(a * a + b * b + c * c);
    }
    else
        throw "Unexpected func0x7 argument count";
}

function func0x9(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 3) {
        const a = stack[argvPtr + 1];
        const b = stack[argvPtr + 3];
        stack[stack[argvPtr + 5] + 1] = Math.atan2(a, b);
    }
    else
        throw "Unexpected func0x9 argument count";
}

function func0xA(argvPtr: number, argc: number, stack: number[]) {
    //Seen in Brain's house
    if (argc === 4) {
        let a = stack[argvPtr + 1];
        const b = stack[argvPtr + 3];
        const c = stack[argvPtr + 5];

        let res = 0;
        a -= b;
        if (a !== 0) {
            if (Math.PI < a)
                a -= 2 * Math.PI;
            if (a < -Math.PI)
                a += 2 * Math.PI;
            if (a <= c)
                res = -(a < -c);
            else
                res = 1;
        }
        if (stack[argvPtr + 6] === 3)
            stack[stack[argvPtr + 7] + 1] = res;
        else
            throw "Unexpected func0xA argument type";
    }
    else
        throw "Unexpected func0xA argument count";
}

function func0xB(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 1) {
        if (stack[argvPtr] === 3) {
            let angle = stack[stack[argvPtr + 1] + 1];
            if (Math.PI <= angle || angle <= -Math.PI) {
                const modulo = Math.floor(angle / (2 * Math.PI));
                angle = angle - modulo * 2 * Math.PI;
                if (Math.PI < angle)
                    angle -= 2 * Math.PI;
                if (angle < -Math.PI)
                    angle += 2 * Math.PI;
            }
            stack[stack[argvPtr + 1] + 1] = angle;
        }
        else
            throw "Unexpected func0xB argument type";
    }
    else
        throw "Unexpected func0xB argument count";
}

function func0xC(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 2) {
        const v = stack[argvPtr + 1] * Math.random();
        if (stack[argvPtr] === 1) {
            stack[stack[argvPtr + 3] + 1] = v;
        }
        else
            stack[stack[argvPtr + 3] + 1] = Math.floor(v);
    }
    else
        throw "Unexpected func0xC argument count";
}

function func0xD(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 9) {
        stack[stack[argvPtr + 13] + 1] = stack[argvPtr + 1] + stack[argvPtr + 7];
        stack[stack[argvPtr + 15] + 1] = stack[argvPtr + 3] + stack[argvPtr + 9];
        stack[stack[argvPtr + 17] + 1] = stack[argvPtr + 5] + stack[argvPtr + 11];
    }
    else
        throw "Unexpected func0xD argument count";
}

function func0x14(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 1) {
        if (stack[argvPtr] === 3) {
            const outPtr = stack[argvPtr + 1];
            stack[outPtr + 1] = 0;
            return;
        }
        else
            throw "Unexpected func0x14 argument type";
    }
    else
        throw "Unexpected func0x14 argument count";
}

function func0x15(argvPtr: number, argc: number, stack: number[]) {
    if (argc === 2) {
        if (stack[argvPtr + 1] === 0 && stack[argvPtr + 2] === 3) {
            const outPtr = stack[argvPtr + 3];
            stack[outPtr + 1] = MAIN_PROGRESS_ID;
            return;
        }
        else
            throw "Unexpected func0x15 argument type";
    }
    else if (argc === 3) {
        if (stack[argvPtr + 1] === 1 && stack[argvPtr + 4] === 3) //block not completely accurate for convenience, should be enough for now
        {
            const outPtr = stack[argvPtr + 5];
            stack[outPtr + 1] = SUB_PROGRESS_ID;
            return;
        }
        else if (stack[argvPtr + 1] === 2 && stack[argvPtr + 4] === 3) //same here
        {
            const outPtr = stack[argvPtr + 5];
            stack[outPtr + 1] = EVENT_FLAGS & (1 << (stack[argvPtr + 3] & 0x1F));
            return;
        }
    }
    else
        throw "Unexpected func0x15 argument count";
}

function func0x16(argvPtr: number, argc: number, stack: number[]) {
    return;
}

function func0x17(argvPtr: number, argc: number, stack: number[]) {
    return;
}

function func0x1D(argvPtr: number, argc: number, stack: number[]) {
    return;
}

function func0x1F(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo) {
    if (argc === 1) {
        if (stack[argvPtr] === 3) {
            const outPtr = stack[argvPtr + 1];
            stack[outPtr] = 0;
            stack[outPtr + 1] = stackInfo.npcID;
            return;
        }
        else
            throw "Unexpected func0x1F argument type";
    }
    else
        throw "Unexpected func0x1F argument count";
}

function func0x20(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo) {
    if (argc === 1) {
        if (stack[argvPtr] === 3) {
            const outPtr = stack[argvPtr + 1];
            stack[outPtr + 1] = stackInfo.talkStatus;
            return;
        }
        else
            throw "Unexpected func0x20 argument type";
    }
    else
        throw "Unexpected func0x20 argument count";
}

function func0x32(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance) {
    if (stack[argvPtr + 1] !== stackInfo.npcID && stack[argvPtr + 1] !== 0) {
        throw "trying to get info of another NPC (0x32)! " + stack[argvPtr + 1].toString();

    }
    else if (stack[argvPtr + 1] === 0) {
        //Trying to get Eight's position (for lookAt, stop etc).
        //Place very far away for now to avoid interferences with movement, we'll see later if more accurate behaviour based on viewer's position can be implemented.
        for (let i = 0; i < 3; i++) {
            if (stack[argvPtr + 2 + 2 * i] === 3) {
                const outPtr = stack[argvPtr + 3 + 2 * i];
                stack[outPtr + 1] = 10000;
            }
            else
                throw "unexpected type for func0x32";
        }
        return;
    }
    const v: vec3 = vec3.create();
    getMatrixTranslation(v, mdsInstance.modelMatrix);
    for (let i = 0; i < 3; i++) {
        if (stack[argvPtr + 2 + 2 * i] === 3) {
            const outPtr = stack[argvPtr + 3 + 2 * i];
            stack[outPtr + 1] = v[i];
        }
        else
            throw "unexpected type for func0x32";
    }
}

function func0x33(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance) {
    if (stack[argvPtr + 1] !== stackInfo.npcID)
        return;
    const out: vec3 = vec3.create();
    for (let i = 0; i < 3; i++)
        out[i] = stack[argvPtr + 3 + 2 * i];
    setMatrixTranslation(mdsInstance.modelMatrix, out);
}

function func0x34(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance) {
    //if (stack[argvPtr + 1] !== stackInfo.npcID)
    //    throw "trying to get info of another NPC (0x34)! " + stack[argvPtr + 1].toString();
    const v: vec3 = mdsInstance.eulerRot;
    //computeEulerAngleRotationFromSRTMatrix(v, mdsInstance.modelMatrix);
    if (argc === 4) {
        for (let i = 0; i < 3; i++) {
            if (stack[argvPtr + 2 + 2 * i] === 3) {
                const outPtr = stack[argvPtr + 3 + 2 * i];
                stack[outPtr + 1] = v[i];
            }
            else
                throw "unexpected type for func0x34 argc 4";
        }
    }
    else if (argc === 2) {
        if (stack[argvPtr + 2] === 3) {
            const outPtr = stack[argvPtr + 3];
            stack[outPtr + 1] = v[1];
        }
        else
            throw "unexpected type for func0x34 argc 2";
    }
    else
        throw "Unexpected argument count";
}

function func0x35(argvPtr: number, argc: number, stack: number[], stackInfo: STBStackInfo, mdsInstance: MDSInstance) {
    if (stack[argvPtr + 1] !== stackInfo.npcID)
        return;
    const out: vec4 = vec4.fromValues(0, 0, 0, 1.0);
    if (argc === 4) {
        for (let i = 0; i < 3; i++)
            out[i] = stack[argvPtr + 3 + 2 * i];
    }
    else if (argc === 2) {
        out[1] = stack[argvPtr + 3];
    }
    else
        throw "Unexpected func0x35 argument count";
    const s: vec3 = vec3.create();
    const t: vec3 = vec3.create();
    mat4.getScaling(s, mdsInstance.modelMatrix);
    getMatrixTranslation(t, mdsInstance.modelMatrix);
    mdsInstance.eulerRot = vec3.fromValues(out[0], out[1], out[2]);
    computeModelMatrixSRT(mdsInstance.modelMatrix, s[0], s[1], s[2], out[0], out[1], out[2], t[0], t[1], t[2]);
}

function func0x36(buffer: ArrayBufferSlice, stb: STB, argvPtr: number, stack: number[], mdsInstance: MDSInstance) {
    const motionNamePtr = stack[argvPtr + 3];
    const animName = readString(buffer, motionNamePtr, -1, true, "sjis");
    if (mdsInstance.mot !== null) {
        if (mdsInstance.mot.motionNameToMotion.has(animName)) {
            mdsInstance.bindMotion(mdsInstance.mot.motionNameToMotion.get(animName) as MOT.Motion);
        }
    }
}

function func0x37(buffer: ArrayBufferSlice, stb: STB, argvPtr: number, stack: number[], mdsInstance: MDSInstance) {
    const eyeAnimeNamePtr = stack[argvPtr + 3];
    const eyeAnimeName = readString(buffer, eyeAnimeNamePtr, -1, true, "sjis");
    if (mdsInstance.img !== null) {
        if (mdsInstance.img.texAnimNameToTexAnim.has(eyeAnimeName)) {
            //slot 0 picked for facial eye anims.
            mdsInstance.bindTexAnim(mdsInstance.img.texAnimNameToTexAnim.get(eyeAnimeName) as IMG.TexAnim, 0);
        }
    }
}

function func0x3A(argvPtr: number, argc: number, stack: number[]) {
    //Seen in Farebury first npc layout, c006aw. Joint attachement it seems, see later.
    return;
}

function func0x3B(argvPtr: number, argc: number, stack: number[]) {
    //The motion speed rate logic needs more work (several rates multiplied around). Just keep the default one for now and move on.
    return;
}

function func0x3D(argvPtr: number, argc: number, stack: number[]) {
    return;
}

function func0x3E(argvPtr: number, argc: number, stack: number[]) {
    return;
}