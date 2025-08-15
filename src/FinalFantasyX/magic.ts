import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, assertExists, hexzero, nArray } from "../util.js";
import { EMITTER_DONE_TIMER, EmitterSpec, ParticleData, ParticleRunner, ParticleSystem, trailArgsScratch } from "./particle.js";
import { BranchInfo, NaiveInterpreter, Opcode as MOp, Register, parseOpcode } from "../PokemonSnap/mips.js";
import { MathConstants, bitsAsFloat32, lerp, randomRangeFloat, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1 } from "../MathHelpers.js";
import { SceneGfx, ViewerRenderInput } from "../viewer.js";
import { GfxBindingLayoutDescriptor, GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper.js";
import { BufferPoolManager, FFXProgram, FFXToNoclip, LevelModelData, TextureData } from "./render.js";
import AnimationController from "../AnimationController.js";
import { makeAttachmentClearDescriptor, makeBackbufferDescSimple } from "../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot, GfxrTemporalTexture } from "../gfx/render/GfxRenderGraph.js";
import { FakeTextureHolder, TextureMapping } from "../TextureHolder.js";
import { CameraController, OrbitCameraController } from "../Camera.js";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers.js";
import { SceneContext } from "../SceneBase.js";
import { colorFromRGBA, colorMult, colorNewFromRGBA } from "../Color.js";
import { Texture, parseMagicFile } from "./bin.js";
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager.js";
import { hexdump } from "../DebugJunk.js";
import { LevelObjectHolder } from "./script.js";
import * as UI from '../ui.js';
import { Actor as ActorObj, MonsterMagicManager } from "./actor.js";

type MagicSetup = (buf: ArrayBufferSlice, offset: number) => [EmitterSpec[], ParticleRunner?];

export interface MagicLayout {
    id: number;
    headers: number[];
    funcMap?: number[];
    particleIndex: number;
    special?: MagicSetup;
}

export function sniffMagic(id: number, buffer: ArrayBufferSlice): MagicLayout | null {
    let desc: MagicDescriptor | null = null;
    for (let cat of magicTable)
        for (let m of cat)
            if (m.main === id || m.alt === id) {
                desc = m;
                break;
            }
    if (!desc)
        return null
    const layout: MagicLayout = {
        id,
        headers: [],
        particleIndex: 0,
        special: desc.setup,
    };

    let funcOffset = -1;
    for (let offs = 0x40; offs <= 0x130; offs += 0x10) {
        if (validFuncList(buffer, offs)) {
            funcOffset = offs;
            break;
        }
    }

    const view = buffer.createDataView();
    const walker = new GraphFinder();
    walker.littleEndian = true;
    // seed with the init and run functions
    const startQueue = [
        view.getUint32(0, true),
        view.getUint32(0xC, true),
        view.getUint32(0x10, true),
    ];
    const g = new FuncGraph(view);
    g.walk(startQueue);

    const makeTaskOpts = g.findSignature(makeTaskSig)
    const annotator = new Annotator();
    annotator.littleEndian = true;
    if (makeTaskOpts.length === 1) {
        annotator.taskMaker = makeTaskOpts[0];
        const node = assertExists(g.graph.get(annotator.taskMaker));
        node.name = "makeTask";
        const allTasks: number[] = [];
        for (let caller of node.in) {
            annotator.parseFromView(view, caller - LOAD_ADDRESS);
            g.get(caller).out.push(...annotator.tasks);
            for (let task of annotator.tasks)
                g.get(task).in.push(caller);
            allTasks.push(...annotator.tasks);
        }
        g.walk(Array.from(allTasks));
        for (let t of allTasks) {
            const n = assertExists(g.graph.get(t));
            n.isTask = true;
        }
    }

    const mh = g.matchAndName("magicHeader", {type:"pattern", callCount: 3, out: [
        {type:"address", address: KnownFunc.fixMagicPointers},
        {type:"address", address: KnownFunc.initParticleHeap},
    ]})
    if (mh) {
        annotator.magicHeader = mh.addr;
        for (let caller of mh.in) {
            annotator.parseFromView(view, caller - LOAD_ADDRESS);
        }
        // console.log("funcs", annotator.funcStart.toString(16), "header", annotator.headerAddress.toString(16), "index", annotator.magicIndex.toString(16))
    } else {
        // might be ad hoc
        // console.warn("no magic header")
    }
    const getData = g.get(KnownFunc.getParticleData);
    for (let caller of getData.in) {
        annotator.parseFromView(view, caller - LOAD_ADDRESS);
    }
    layout.particleIndex = Math.max(0, annotator.magicIndex);

    const makeEmitter = g.matchAndName("makeEmitter", makeEmitterPattern, true);
    if (makeEmitter) {
        annotator.emitterMaker = makeEmitter.addr;
        const allEvents: MagicEvent[] = [];
        for (let caller of makeEmitter.in) {
            annotator.parseFromView(view, caller - LOAD_ADDRESS);
            allEvents.push(...annotator.events);
        }
        console.log("emitters", allEvents)
    }

    const h = new HeaderFinder();
    h.littleEndian = true;
    const initFunc = view.getUint32(0, true);
    h.parseFromView(view, initFunc - LOAD_ADDRESS);
    if (mh) {
        if (annotator.funcStart >= 0)
            assert(annotator.funcStart - LOAD_ADDRESS === funcOffset);
    }
    layout.headers = h.headers;

    let zeros = 0;
    let foundEnd = false;
    layout.funcMap = [];
    while (!foundEnd) {
        let nextOp = 0xF; // default to NOOP
        for (let i = 0; i < 40; i += 4) {
            const maybeFunc = view.getUint32(funcOffset + 40*layout.funcMap.length + i, true);
            if (maybeFunc !== 0 && maybeFunc < LOAD_ADDRESS) {
                const op = funcList.get(maybeFunc);
                if (op === undefined) {
                    foundEnd = true;
                } else {
                    nextOp = op;
                }
                break;
            }
        }
        if (nextOp === 0xF) {
            zeros++;
            if (zeros > 2)
                foundEnd = true;
        }
        layout.funcMap.push(nextOp);
    }

    // g.print(view.getUint32(0, true));
    // g.print(view.getUint32(0x10, true));

    return layout;
}

function validFuncList(buffer: ArrayBufferSlice, offs: number): boolean {
    const view = buffer.createDataView();
    let allZero = true;
    let bad = true; // reject all-zero
    for (let i = 0; i < 10; i++) {
        const val = view.getUint32(offs + 4*i, true);
        if (val > 0) {
            allZero = false;
            // should either have an early function, or just a chain in the init slot
            if ((i < 4 && val < 0x280000) || (i === 7 && val > 0x280000))
                bad = false;
            if (val < 0x260000 || val > 0x291000) {
                bad = true;
                break;
            }
        }
    }
    if (!bad)
        return true;
    if (allZero && offs < 0x100)
        return validFuncList(buffer, offs + 40);
    return false;
}

enum Opcode {
    WAIT,
    JUMP,
    JUMP_LABEL,
    LOOP,
    CONTINUE,
    CALL,
    RETURN,
    FUNC,
    FUNC_YIELD,
    TICK,
    SET_LABEL,
    MARK,
    END,
    ACTOR,
    SELF,
    PREP_TEX,
    LOAD_TEX,
    FREE_EMITTER,
    TOGGLE_EMITTER,
    UNK_13,
    UNK_TARGET_14,
    UNK_ALL_15,
    UNK_16,
    SWITCH_CAM,
    CAM_ZOOM,
    CAM_POS,
    CAM_FOCUS,
    CAM_ROLL,
    CAM_SUB,
    CAM_SUB_VEC,
    CAM_CURVE_0,
    CAM_CURVE_1,
    COLOR,
    ALPHA,
    UNK_22,
    SOUND,
    SOUND_24,
    UNK_25,
    BLUR,
    UNK_27,
    UNK_CAM_28,
    UNK_29,
    UNK_2A,
    UNK_2B,
    UNK_2C,
    UNK_2D,
    UNK_2E,
    UNK_2F,
    UNK_30,
    UNK_31,
    UNK_RES_32,
}

interface Basic {
    op: Opcode.CONTINUE | Opcode.CALL | Opcode.RETURN | Opcode.END | Opcode.LOAD_TEX | Opcode.UNK_25;
}

interface Wait {
    op: Opcode.WAIT;
    frames: number;
}

interface Pointer {
    op: Opcode.JUMP | Opcode.FUNC | Opcode.FUNC_YIELD | Opcode.TICK | Opcode.FREE_EMITTER;
    address: number;
}

interface Index {
    op: Opcode.JUMP_LABEL | Opcode.MARK | Opcode.SWITCH_CAM;
    index: number;
}

interface Loop {
    op: Opcode.LOOP;
    count: number;
}

interface IndexData {
    op: Opcode.SET_LABEL;
    index: number;
    address: number;
}

interface CamValue {
    op: Opcode.CAM_ZOOM | Opcode.CAM_ROLL;
    index: number;
    value: number;
}

interface CamPos {
    op: Opcode.CAM_POS | Opcode.CAM_FOCUS;
    index: number;
    pos: vec3;
}

interface CamSub {
    op: Opcode.CAM_SUB | Opcode.CAM_SUB_VEC | Opcode.CAM_CURVE_0 | Opcode.CAM_CURVE_1;
    index: number;
    alt: boolean;
    data: number;
    a: number;
    b: number;
}

interface Actor {
    op: Opcode.ACTOR | Opcode.SELF;
    target: number;
    handler: number;
    data: number;
}

interface PrepTextures {
    op: Opcode.PREP_TEX;
    header: number;
    start: number;
    count: number;
}

interface ToggleEmitter {
    op: Opcode.TOGGLE_EMITTER;
    emitter: number;
    enabled: boolean;
}

interface ActorColor {
    op: Opcode.COLOR;
    target: number;
    color: vec3;
    time: number;
}

interface ActorAlpha {
    op: Opcode.ALPHA;
    target: number;
    alpha: number;
    time: number;
}

interface Resource {
    op: Opcode.SOUND | Opcode.SOUND_24 | Opcode.UNK_RES_32;
    header: number;
    index: number;
    value: number;
}

interface Blur {
    op: Opcode.BLUR;
    enable: boolean;
}

interface Unknown {
    op: Opcode.UNK_13 | Opcode.UNK_TARGET_14 | Opcode.UNK_22 | Opcode.UNK_27;
    target: number;
    value: number;
}

interface UnkAll {
    op: Opcode.UNK_ALL_15 | Opcode.UNK_16 | Opcode.UNK_2D;
    value: number;
}

interface UnkCam {
    op: Opcode.UNK_CAM_28;
    index: number;
    a: number;
    b: number;
    c: number;
    d: number;
}

type Instruction = Basic | Wait | Pointer | Index | Loop | IndexData | Actor | PrepTextures | ToggleEmitter | Unknown | UnkAll | CamPos | CamValue | CamSub | ActorColor | ActorAlpha | Resource | Blur | UnkCam;

const LOAD_ADDRESS = 0x1B00000;

interface ScriptData {
    script: Instruction[];
    magicHeader: number;
}

function parseScript(buffer: ArrayBufferSlice, start: number): ScriptData {
    const view = buffer.createDataView();
    const script: Instruction[] = [];


    function addr(a: number): number {
        if (a === 0)
            return a;
        return a - LOAD_ADDRESS;
    }

    let header = -1;
    function hdr(a: number): void {
        assert(a !== 0);
        const fixed = addr(a);
        if (header < 0)
            header = fixed;
        else
            assert(header === fixed);
    }

    let offs = start;
    let valid = true;
    while (valid) {
        const op = view.getUint16(offs, true);
        switch (op) {
            case Opcode.CONTINUE: case Opcode.CALL: case Opcode.RETURN:
            case Opcode.END: case Opcode.LOAD_TEX: case Opcode.UNK_25: {
                script.push({op});
                offs += 4;
            } break;
            case Opcode.WAIT: {
                script.push({
                    op,
                    frames: view.getUint16(offs + 2, true)
                });
                offs += 4;
            } break;
            case Opcode.JUMP: case Opcode.FUNC: case Opcode.FUNC_YIELD: case Opcode.TICK: {
                const address = addr(view.getUint32(offs + 4, true))
                script.push({op, address});
                if (op === Opcode.JUMP) // TODO: worry about branching
                    offs = address;
                else
                    offs += 8;
            } break;
            case Opcode.FREE_EMITTER: {
                hdr(view.getUint32(offs + 4, true))
                script.push({
                    op,
                    address: addr(view.getUint32(offs + 8, true)),
                });
                offs += 0xC;
            } break;
            case Opcode.JUMP_LABEL: case Opcode.MARK: case Opcode.SWITCH_CAM: {
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true)
                });
                offs += 4;
            } break;
            case Opcode.LOOP: {
                script.push({
                    op,
                    count: view.getUint16(offs + 2)
                });
                offs += 4;
            } break;
            case Opcode.SET_LABEL: {
                let address = view.getUint32(offs + 4, true);
                if (address > LOAD_ADDRESS)
                    address = addr(address);
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    address,
                });
                offs += 8;
            } break;
            case Opcode.ACTOR: case Opcode.SELF: {
                script.push({
                    op,
                    target: view.getInt16(offs + 2, true),
                    handler: addr(view.getUint32(offs + 4, true)),
                    data: addr(view.getUint32(offs + 8, true)),
                });
                offs += 0xC;
            } break;
            case Opcode.PREP_TEX: {
                script.push({
                    op,
                    header: addr(view.getUint32(offs + 4, true)),
                    start: view.getUint16(offs + 8, true),
                    count: view.getUint16(offs + 0xA, true),
                });
                offs += 0xC;
            } break;
            case Opcode.TOGGLE_EMITTER: {
                script.push({
                    op,
                    enabled: view.getUint16(offs + 2, true) !== 0,
                    emitter: addr(view.getUint32(offs + 4, true)),
                });
                offs += 8;
            } break;
            case Opcode.UNK_13: case Opcode.UNK_TARGET_14: case Opcode.UNK_22: case Opcode.UNK_27: {
                script.push({
                    op,
                    target: view.getInt16(offs + 2, true),
                    value: view.getUint32(offs + 4, true),
                });
                offs += 8;
            } break;
            case Opcode.UNK_ALL_15: case Opcode.UNK_16: case Opcode.UNK_2D: {
                script.push({
                    op,
                    value: view.getUint32(offs + 4, true),
                });
                offs += 8;
            } break;
            case Opcode.CAM_ZOOM: case Opcode.CAM_ROLL: {
                const dataOffs = addr(view.getUint32(offs + 4, true));
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    value: view.getFloat32(dataOffs, true),
                });
                offs += 8;
            } break;
            case Opcode.CAM_POS: case Opcode.CAM_FOCUS: {
                const dataOffs = addr(view.getUint32(offs + 4, true));
                const pos = vec3.fromValues(
                    view.getFloat32(dataOffs + 0, true),
                    view.getFloat32(dataOffs + 4, true),
                    view.getFloat32(dataOffs + 8, true),
                );
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    pos,
                });
                offs += 0x10;
            } break;
            case Opcode.CAM_SUB: case Opcode.CAM_SUB_VEC:
            case Opcode.CAM_CURVE_0: case Opcode.CAM_CURVE_1: {
                const isSub = (op === Opcode.CAM_SUB || op === Opcode.CAM_SUB_VEC);
                let alt = false;
                if (op === Opcode.CAM_CURVE_1)
                    alt = true;
                else if (isSub)
                    alt = view.getUint32(offs + 4, true) !== 0;
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    alt,
                    data: addr(view.getUint32(offs + 8, true)),
                    a: view.getUint32(offs + 0xC, true),
                    b: isSub ? view.getUint32(offs + 0x10, true) : 0,
                });
                offs += isSub ? 0x14 : 0x10;
            } break;
            case Opcode.COLOR: {
                const color = vec3.fromValues(
                    view.getUint32(offs + 4, true),
                    view.getUint32(offs + 8, true),
                    view.getUint32(offs + 0xC, true),
                );
                vec3.scale(color, color, 1/0x1000);
                script.push({
                    op,
                    target: view.getUint16(offs + 2, true),
                    color,
                    time: view.getUint32(offs + 0x10, true),
                });
                offs += 0x14;
            } break;
            case Opcode.ALPHA: {
                const color = vec3.fromValues(
                    view.getUint32(offs + 4, true),
                    view.getUint32(offs + 8, true),
                    view.getUint32(offs + 0xC, true),
                );
                vec3.scale(color, color, 1/0x1000);
                script.push({
                    op,
                    target: view.getUint16(offs + 2, true),
                    alpha: view.getUint32(offs + 4, true),
                    time: view.getUint32(offs + 8, true),
                });
                offs += 0xC;
            } break;
            case Opcode.SOUND: case Opcode.SOUND_24: case Opcode.UNK_RES_32: {
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    header: addr(view.getUint32(offs + 4, true)),
                    value: view.getUint32(offs + 8, true),
                });
                offs += 0xC;
            } break;
            case Opcode.BLUR: {
                script.push({
                    op,
                    enable: view.getUint16(offs + 2, true) !== 0,
                });
                offs += 4;
            } break;
            case Opcode.UNK_CAM_28: {
                script.push({
                    op,
                    index: view.getUint16(offs + 2, true),
                    a: view.getUint32(offs + 4, true) / 0x1000,
                    b: view.getUint32(offs + 8, true) / 0x1000,
                    c: view.getUint16(offs + 0xC, true),
                    d: view.getUint16(offs + 0xE, true),
                });
                offs += 0x10;
            } break;
            default:
                console.warn(`unknown ${op.toString(16)}`);
                hexdump(buffer, start)
                hexdump(buffer, offs);
                valid = false;
        }
        // (script[script.length - 1] as any).opName = Opcode[op]
        if (op === Opcode.END)
            break;
    }

    return {script, magicHeader: header};
}

function printScript(script: ScriptData, fixup=true): void {
    function addr(a: number): string {
        if (a === 0 || !fixup)
            return a.toString(16);
        return (a + LOAD_ADDRESS).toString(16);
    }

    console.log("header", addr(script.magicHeader))
    let t = 0;

    for (let inst of script.script) {
        switch (inst.op) {
            case Opcode.FUNC: case Opcode.TICK:
                console.log(Opcode[inst.op], addr(inst.address)); break;
            case Opcode.CAM_POS: case Opcode.CAM_FOCUS:
                console.log(Opcode[inst.op], inst.index, "(", inst.pos[0], inst.pos[1], inst.pos[2], ")"); break;
            case Opcode.JUMP:
                console.log("----------------"); break;
            case Opcode.WAIT:
                console.log(Opcode[inst.op], inst.frames);
                t += inst.frames;
                console.log(t)
                break;

            case Opcode.PREP_TEX:
                console.log(Opcode[inst.op], addr(inst.header)); break;
            case Opcode.TOGGLE_EMITTER:
                console.log(Opcode[inst.op], addr(inst.emitter), inst.enabled ? "ON" : "OFF"); break;
            case Opcode.CONTINUE: case Opcode.CALL: case Opcode.RETURN:
            case Opcode.END: case Opcode.LOAD_TEX: case Opcode.UNK_25:
                console.log(Opcode[inst.op]); break;
            default: {
                console.log(Opcode[inst.op], inst);
            }
        }
    }
}

// first nonzero function in each of the standard particle instructions
const funcList = new Map<number, number>([
    [0x268070,0x0],
    [0x2681E8,0x1],
    [0x268360,0x2],
    [0x2684D8,0x3],
    [0x267FE8,0x4],
    [0x268160,0x5],
    [0x2682D8,0x6],
    [0x268450,0x7],
    [0x267F80,0x8],
    [0x2680F8,0x9],
    [0x268270,0xA],
    [0x2683E8,0xB],
    [0x26BDD0,0xC],
    [0x26C1B0,0xD],
    [0x26CE38,0xE],
    [0x269A40,0x10],
    [0x26A030,0x11],
    [0x26A0B8,0x12],
    [0x26A3E8,0x13],
    [0x26A400,0x14],
    [0x26A6F0,0x15],
    [0x26A848,0x16],
    [0x26A9B8,0x17],
    [0x26AD78,0x18],
    [0x285C58,0x19],
    [0x2863C8,0x1A],
    [0x268778,0x1B],
    [0x268A78,0x1C],
    [0x26BF08,0x1D],
    [0x26C050,0x1E],
    [0x282648,0x1F],
    [0x2887C8,0x20],
    [0x2889A0,0x21],
    [0x288B50,0x22],
    [0x288D00,0x23],
    [0x288E90,0x24],
    [0x26D128,0x25],
    [0x26CC90,0x26],
    [0x26CFB0,0x27],
    [0x26C438,0x28],
    [0x26AED0,0x29],
    [0x283038,0x2A],
    [0x282EE0,0x2B],
    [0x28AAA8,0x2C],
    [0x288488,0x2D],
    [0x286B50,0x2E],
    [0x289C88,0x2F],
    [0x26A658,0x30],
    [0x26E8F0,0x31],
    [0x283978,0x32],
    [0x26FD70,0x33],
    [0x28AB18,0x34],
    [0x28A0A8,0x35],
    [0x28A258,0x36],
    [0x28AEA0,0x37],
    [0x281060,0x38],
    [0x28A470,0x39],
    [0x26A108,0x3A],
    [0x280EE8,0x3B],
    [0x281670,0x3C],
    [0x280878,0x3D],
    [0x281F98,0x3E],
    [0x281DA8,0x3F],
    [0x26D790,0x40],
    [0x281100,0x41],
    [0x26D2B8,0x42],
    [0x282A38,0x43],
    [0x281160,0x44],
    [0x281200,0x45],
    [0x281980,0x46],
    [0x28B230,0x47],
    [0x26DC10,0x48],
    [0x2810E0,0x49],
    [0x281080,0x4A],
    [0x281220,0x4B],
    [0x2811C0,0x4C],
    [0x28B490,0x4D],
    [0x28BEF8,0x4E],
    [0x28B7E8,0x4F],
    [0x28B9F8,0x50],
    [0x28C750,0x51],
    [0x26DCF8,0x52],
    [0x269AE8,0x53],
    [0x28C998,0x54],
    [0x26C9C8,0x55],
    [0x268EC0,0x56],
    [0x26B1C8,0x57],
    [0x270940,0x58],
    [0x28B050,0x59],
    [0x2810C0,0x5A],
    [0x281000,0x5B],
    [0x289EF8,0x5C],
    [0x289F60,0x5D],
    [0x28BC80,0x5E],
    [0x26B390,0x5F],
    [0x26DAD0,0x60],
    [0x272030,0x61],
    [0x268998,0x62],
    [0x28D120,0x63],
    [0x275520,0x64],
    [0x271A88,0x65],
    [0x272F68,0x66],
    [0x26CB28,0x67],
    [0x2767C8,0x68],
    [0x2763C8,0x69],
    [0x2764E8,0x6A],
    [0x276608,0x6B],
    [0x269F80,0x6C],
    [0x2766B0,0x6D],
    [0x276000,0x6E],
    [0x28EE88,0x6F],
    [0x272848,0x70],
    [0x276AB8,0x71],
    [0x268560,0x72],
    [0x269B90,0x73],
    [0x268D40,0x74],
    [0x2768A0,0x75],
    [0x277070,0x76],
    [0x277948,0x77],
    [0x279000,0x78],
    [0x2793E8,0x79],
    [0x27ABD0,0x7A],
    [0x277D18,0x7B],
    [0x28D8C0,0x7C],
    [0x28EDB8,0x7E],
    [0x274300,0x7F],
    [0x2811A0,0x80],
    [0x275650,0x81],
    [0x275AD0,0x82],
    [0x2799F0,0x83],
    [0x28A4D0,0x84],
    [0x27AF88,0x85],
    [0x275880,0x86],
    [0x275D28,0x87],
    [0x281120,0x88],
    [0x269CE0,0x89],
    [0x27C108,0x8A],
    [0x26A490,0x8B],
    [0x288FA0,0x8C],
    [0x289578,0x8D],
    [0x289AB8,0x8E],
    [0x289718,0x8F],
    [0x2898D8,0x90],


    [0x289D30, 0x1000], // new op, in 4c
    [0x281240, 0x1001], // chain, in 4e
    [0x267F20, 0x1002], // run arbitrary function ?!  in 54
    [0x28A598, 0x1003], // matrix stuff, 6a
    [0x26AFD0, 0x1004], // timed emit, 49
    [0x28F0F0, 0x1005], // geo, 0e
    [0x269C38, 0x10], // misc, 188 (double check euler)
    [0x28C210, 0x1007], // geo, 188
    [0x2811e0, 0x1008], // chain
    [0x26c2f0, 0x1009], // 2b1
    [0x28abd0, 0x100A], // 133
    [0x28ad98, 0x100B], // 133
    [0x2876d0, 0x100C], // 133
    [0x269d88, 0x100D], // 37
    [0x28e468, 0x100E], // 46
    [0x28eC68, 0x100F], // 46
    [0x28c440, 0x1010], // geo ca
    [0x281260, 0x1011], // chain
    [0x283498, 0x1012], // geo 130
    [0x2836b0, 0x1013], // geo 145
    [0x290358, 0x1014], // misc 24c
]);

function _(name: string, main: number, alt = -1, setup: Exclude<LayoutType, "setup"> | MagicSetup = "parts"): MagicDescriptor {
    const out: MagicDescriptor = {
        name,
        main,
        layout: "parts",
    };
    if (alt > 0)
        out.alt = alt;
    if (typeof setup === "string") {
        out.layout = setup;
    } else if (setup) {
        out.layout = "setup";
        out.setup = setup;
    }
    return out;
}

function e(behavior: number, x: number, y: number, z: number, scale: number, yaw: number, delay: number): EmitterSpec {
    return {
        pos: vec3.fromValues(x, y, z),
        euler: vec3.fromValues(0, yaw, 0),
        scale: vec3.fromValues(scale, scale, scale),
        delay,
        behavior,
        maxDist: 0,
        width: 0,
        height: 0,
        id: 0,
        g: 0,
        billboard: 0,
        eulerOrder: 0,
    }
}

// identical
// 0015 0146
// 007c 007d
// 0082 0083
// 0088 0089
// 008a 008b
// 008c 008d
// 008e 008f
// 0094 0239
// 00af 01a2
// 00eb 00ec
// 00ed 00ee
// 011b 01a6
// 0132 0251 025c 0267
// 013b 0159
// 013f 0147
// 0140 0148
// 0141 0149
// 0235 02b3
// 0284 02b4

export const currMagic = 0x9

type LayoutType = "vars" | "parts" | "setup" | "shared-two"

interface MagicDescriptor {
    name: string;
    main: number;
    alt?: number;
    layout: LayoutType;
    setup?: MagicSetup;
}

const scratchVec = vec3.create();
const colorScratch = vec4.create();
const colorScratch2 = vec4.create();
const scratchMtx = mat4.create();

function quartic(t: number, a: number, b: number, c: number, d: number, e: number): number {
    const q = 1-t;
    const q2 = q*q;
    const t2 = t*t;
    // feels like c should be 6 but oh well
    return a*q2*q2 + b*4*q2*q*t + c*4*q2*t2 + d*4*t2*t*q + e*t2*t2;
}

function quadratic(t: number, a: number, b: number, c: number, ): number {
    const q = 1-t;
    return a*q*q + b*2*q*t + c*t*t;
}

type trailFunc = (dst: vec3, t: number, id: number) => vec3;

const trailScratch = nArray(3, () => vec3.create());
function fillTrailPoints(dst: vec3[], trail: trailFunc, mtx: mat4, id: number, maxCount: number, start: number, gap: number, minScale: number, head = false): number {
    const pos = trail(trailScratch[0], start, id);
    const startPoint = trail(trailScratch[1], start, id);
    const endPoint = trail(trailScratch[2], start-.5, id);
    let currSegLength = vec3.dist(startPoint, endPoint);
    let lengthAcc = currSegLength;
    let t = start;
    let count = 0;
    for (let i = 0; i < maxCount; i++) {
        const trailFrac = i/(maxCount - 1);
        const scale = lerp(1, minScale, trailFrac)
        const currGap = gap * scale;

        if (i === 0) {
            if (!head)
                continue;
        } else {
            while (lengthAcc < currGap) {
                vec3.copy(startPoint, endPoint);
                t -= .5;
                if (t < 0)
                    break;
                trail(endPoint, t, id);
                currSegLength = vec3.dist(startPoint, endPoint);
                lengthAcc += currSegLength;
            }
            if (lengthAcc < currGap)
                break; // not enough length remaining

            lengthAcc -= currGap;
            vec3.lerp(pos, startPoint, endPoint, 1 - lengthAcc/currSegLength);
        }
        transformVec3Mat4w1(pos, mtx, pos);
        vec3.copy(dst[count++], pos);
    }
    return count;
}

function lancetTrail(dst: vec3, t: number, id: number): vec3 {
    const frac = 1 - t/20;
    const x = DIST*(frac * 2 - 1);
    const height = quadratic(frac, 0, 30, 0);
    const bump = quartic(frac, 0, 3, 8, 25, 0);
    const angle = MathConstants.TAU * (id/4 + frac/2);
    vec3.set(dst, x, height + bump*Math.cos(angle), bump*Math.sin(angle));
    return dst;
}

const DIST = 30;

const magicTable: MagicDescriptor[][] = [
[ // abilities
    _("Cheer", 0x03),
    _("Focus", 0x04),
    _("Reflex", 0x05),
    _("Aim", 0x06),
    _("Luck", 0x07),
    _("Jinx", 0x08),
    _("Spare Change", 0x12, 0x13),
    _("Scan", 0x14),
    _("Power Break", 0x15),
    _("Sleep Attack", 0x16, 0x17),
    _("Silence Attack", 0x18, 0x19),
    _("Dark Attack", 0x1A, 0x1B),
    _("Triple Foul", 0x1C, 0x1D),
    _("Zombie Attack", 0x1E, 0x1F),
    _("Mana Distiller", 0x20),
    _("Sleep Buster", 0x22, 0x23),
    _("Silence Buster", 0x24, 0x25),
    _("Dark Buster", 0x26, 0x27),
    _("Power Distiller", 0x28),
    _("Bribe", 0x37, 0x43, "vars"),
    _("Delay Attack", 0x9d, 0x9e, "vars"), // alt very similar
    _("Delay Buster", 0x49, 0x76, "vars"),
    _("Magic Break", 0x13f),
    _("Armor Break", 0x140),
    _("Mental Break", 0x141),
    _("Full Break", 0x2bb),
], [ // white magic
    _("Haste", 0x0a),
    _("Slow", 0x0e),
    _("Cure", 0x6C),
    _("Cura", 0x6E),
    _("Curaga", 0x70, -1, "vars"),
    _("Life", 0x72, 0x73),
    _("Full Life", 0x74, 0x75),

    _("Esuna", 0x78, 0x79, "vars"),
    _("Regen", 0x7A, 0x7B, "vars"),
    _("Dispel", 0x7C), // alt is identical
    _("Shell", 0x7E, 0x7F, "vars"),
    _("Protect", 0x80),
    _("Reflect", 0x82),
        // nul alts are identical files
    _("Nulfrost", 0x88),
    _("Nulblaze", 0x8A),
    _("Nulshock", 0x8C),
    _("Nultide", 0x8E),
    _("Auto Life", 0x90, -1, () => {
        // the code (accidentally?) increments the frame counter twice each frame
        // so maybe some of these were supposed to take twice as long
        return [[
            e(3, 0, 0, 0, .042*1.5, 0, 0),
            e(0, 0, 0, 0, .019*1.2, 0, 10),
            e(1, 0, 0, 0, .048, 0, 23),
            e(2, 0, -10, 0, .021, 0, 38),
        ]];
    }),
    _("Holy", 0x92, -1, () => {
        return [[
            e(1, 0, 0, 0, .7, 0, 15), // frame 15
            e(3, 0, 0, 0, 1, 0, 45), // TODO: circle blur
            e(0, 0, 0, 0, 2, 0, 50), // cut to black
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
            e(2, 0, 0, 0, 1.1, 0, 100),
        ],
        (t: number, sys: ParticleSystem, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager) => {
            if (t === 0) {
                let delay = 100;
                for (let i = 0; i < 8; i++) {
                    const e = sys.emitters[i + 3];
                    const scale = randomRangeFloat(1, 1.2);
                    vec3.set(e.scale, scale, scale, scale);
                    if (i > 0) {
                        delay += randomRangeFloat(2, 6);
                        e.waitTimer = delay;
                    }
                }
            }
            let mult = 1;
            if (t >= 0 && t < 20)
                mult = 1-t/40;
            else if (t >= 20 && t < 50)
                mult = .5;
            else if (t > 50)
                mult = 0;
            vec3.set(sys.colorMult, mult, mult, mult);
            return false;
        }];
    }),
], [ // black magic
    _("Blizzard", 0x4A),
    _("Fire", 0x4C, 0x4D),
    _("Thunder", 0x4E, 0x4F),
    _("Water", 0x50, 0x51, "vars"),
    _("Fira", 0x52, 0x53, "shared-two"),
    _("Blizzara", 0x54, 0x55, "vars"),
    _("Thundara", 0x56, 0x57),
    _("Watera", 0x58, 0x59, "vars"),
    _("Firaga", 0x5A, 0x5B),
    _("Blizzaga", 0x5C, 0x5D, "shared-two"),
    _("Thundaga", 0x5E, 0x5F),
    _("Waterga", 0x60, 0x61, "vars"),
    _("Death", 0x62),
    _("Bio", 0x64, 0x65, "vars"),
    _("Demi", 0x66, 0x67),
    _("Drain", 0x84, 0x85),
    _("Osmose", 0x86, 0x87),
    _("Flare", 0x68, 0x69),
    _("Ultima", 0x6A),
], [ // overdrives
    _("Requiem", 0x182),
    _("Spiral Cut", 0x186, 0x1bf),
    _("Slice & Dice", 0x187, 0x1c0),
    _("Energy Rain", 0x188, 0x1c1),
    _("Blitz Ace", 0x189, 0x1c2),
    _("Shooting Star", 0x18a),
    _("Dragon Fang", 0x18B),
    _("Banishing Blade", 0x18c),
    _("Tornado", 0x18d),
    // reels
     // these have a lot of effects, maybe just differ in code?
        // _("Power Shot?!?!", 0x1be),
        // _("Fire Shot", 0x21f),
        // _("Ice Shot", 0x220),
        // _("Water Shot", 0x221),
        // _("Thunder Shot?", 0x222),
        // _("Attack Reels", 0x22b),
        // _("Havoc Shot", 0x22c),
        // _("Time Shot", 0x22d),
        // _("Break Shot", 0x22e),
        // _("Aurochs Shot", 0x22f),
        // _("Reels", 0x235, 0x284),
            // reels near-duplicates?
            // _(0x2b5),
            // _(0x2b6),
            // _(0x2b7),
            // _(0x2b8),
            // _(0x2b9),
            // _(0x2ba),
    // fury (same as normal effect?)
        // _("Thundara Fury", 0x19c),
        // _("Blizzara Fury", 0x19d),
        // _("Watera Fury", 0x19e),
        // _("Firaga Fury", 0x1a9),
        // _("Thundaga Fury (~Same)", 0x1b7),
        // _("Blizzaga Fury (~Same)", 0x1b8),
        // _("Waterga Fury (~Same)", 0x1b9),
        // _("Demi Fury", 0x1ba),
        // _("Death Fury", 0x1bb),
        // _("Flare Fury (~Same)", 0x1bc),
        // _("Ultima Fury", 0x1bd),
        // _("Osmose Fury", 0x1eb),
        // _("Bio Fury", 0x1ec),
        // // _("unk_1ed", 0x1ed),
        // _("Blizzard Fury", 0x1ee),
        // _("Thunder Fury", 0x1ef),
        // _("Water Fury", 0x1f4),
    ], [ // ronso
    _("Lancet", 0x09, -1, () => {
        return [[
            e(1, DIST, 0, 0, .07, 0, 0),
            e(0, -DIST, 0, 0, .06, 0, 18),
        ], (t: number, sys: ParticleSystem, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, device: GfxDevice) => {
            if (t < 28) {
                const args = trailArgsScratch;
                for (let i = 0; i < 4; i++) {
                    // trail
                    vec4.set(args.headColor, 150/0xFF, 120/0xFF, 80/0xFF, 96/0xFF);
                    vec4.set(args.tailColor, 120/0xFF, 60/0xFF, 100/0xFF, 16/0xFF);
                    args.headScale = 1;
                    args.tailScale = 1;
                    args.commonFrame = true;
                    args.maxLength = 70;
                    let count = 70;
                    let start = t;
                    if (t > 20) {
                        count *= Math.pow(.5, t-20);
                        start = 20
                    }
                    mat4.copy(scratchMtx, viewerInput.camera.viewMatrix)
                    args.pointCount = fillTrailPoints(args.points, lancetTrail, scratchMtx, i, count, start, .55, 1, false);
                    for (let j = 0; j < args.pointCount; j++)
                        vec3.set(args.params[j], 0, 0, 1);
                    args.scaleRange = 0;
                    vec3.set(scratchVec, .05, .05, .05);
                    mat4.fromScaling(scratchMtx, scratchVec);
                    if (args.pointCount > 0)
                        sys.data.flipbookRenderer.renderTrail(device, mgr, sys.bufferManager, assertExists(sys.data.flipbooks[1]), 0, scratchMtx, args);
                    // head
                    if (t < 20) {
                        vec3.set(scratchVec, .02, .02, .02);
                        mat4.fromScaling(scratchMtx, scratchVec);

                        lancetTrail(scratchVec, t, i);
                        transformVec3Mat4w1(scratchVec, viewerInput.camera.viewMatrix, scratchVec);
                        setMatrixTranslation(scratchMtx, scratchVec);
                        vec4.set(colorScratch, 1, 1, 1, 1);
                        sys.data.flipbookRenderer.render(mgr, assertExists(sys.data.flipbooks[0]), 0, colorScratch, scratchMtx);
                    }
                }
            }
            return false;
        }
    ]}),
    _("Jump", 0x1fc, -1, () => {
        return [[
            e(3, DIST, -.5, 0, .01, 0, 0),
            e(1, -DIST, 0, 0, .015, 0, 30),
        ]];
    }),
    _("Fire Breath", 0x19f),
    _("Aqua Breath", 0x1a5),
    _("Bad Breath", 0x1a0),
    _("Stone Breath", 0x1a1),
    // 1a2 same as af
    _("Self Destruct", 0x1a3), // same as 0x137?
    _("Seed Cannon", 0x1a4),
    _("Doom", 0xbc),
    _("Thrust Kick", 0x1fe),
    _("Mighty Guard", 0x23b),
    _("White Wind", 0xaf, -1, "vars"),
    // _("Nova", 0x11b), // too much missing for now
], [ // enemy abilities
    _("Breath (Demonolith)", 0x48),
    _("Breath (Vouivre)", 0xab),
    _("Ice Breath", 0xac),
    _("Lightning Breath", 0xad),
    _("Fire Breath", 0xae),
    _("Black Stare", 0xb0),
    _("Shockwave", 0xb1),
    _("Seed Canmon", 0xb2),
    _("Seed Burst", 0xb3),
    _("Water Spurt (Sahagin)", 0xb4),
    _("Sonic Boom ", 0xb6),
    _("Land Worm Swallow", 0xb7),
    _("Land Worm Regurgitate", 0xb8),
    _("Earthquake", 0xb9),
    _("Blast Punch", 0xba),
    _("Rifle", 0xbb),
    _("Sonic Wave", 0xbd),
    _("Maelstrom", 0xbe),
    _("Salvo", 0xbf),
    _("unk_c5", 0xc5),
    _("Gnaw?", 0xc7),
    _("Blades", 0xc8),
    _("Heave", 0xc9),
    _("Tail", 0xca),
    _("Meteor Issues", 0xcb),
    _("unk_cd", 0xcd),
    _("unk_ce", 0xce),
    _("Electrocute", 0xcf),
    _("unk_d0", 0xd0),
     // geneaux
     _("Geneaux Appears", 0xf4),
     _("Toxic Cloud", 0xf5),
     _("Venom", 0xf6),
     _("Staccato", 0xf7),
     _("Geneaux Transform", 0xf8),
     _("Geneaux Death", 0xf9),
     // chocobo eater
     _("Thwack", 0xfa),
     _("Thwack 2", 0xfb),
     _("[Death]", 0xfc),
     _("[Death 2]???", 0xfd),
     _("[Death]", 0xff),
     _("Mimic 1", 0x100),
     // geosgano
     _("Geosgano Death", 0x101),
     _("Geosgano Swallow", 0x106),
     _("Geosgano Regurgitate", 0x107),
     // evrae
     _("Out Of Breath Range", 0x103),
     _("Spines", 0x104),
     _("Poison Breath", 0x105),
     // echuilles
     _("Photon Spray", 0x108),
     _("Eraser", 0x109),
     _("Blender", 0x10a),
     _("[Death]", 0x10b),
     _("Gatling Gun", 0x10d),
     _("Mana Beam", 0x10e),
     _("Karma", 0x10f),
     _("Leaping Swing", 0x110),
     _("Double Reaper", 0x111),
     _("Stone Gaze", 0x112),
     _("Voodoo", 0x113),
     _("Sonic Tail", 0x114),
     _("Adamantoise Breath", 0x115),
     _("Earthquake", 0x116),
     _("Emblem Of Fate", 0x118),
    // omega weapon
    _("Core Energy Chain Target Issue", 0x119),
    _("Shimmering Rain", 0x11a),

    // oblitzerator
    _("Blitzball Rush", 0x11c),
    _("Doze Ball", 0x11d),
    _("Blind Ball", 0x11e),
    _("Mute Ball", 0x11f),
    _("Crane", 0x120, -1, () => {
        return [[
            e(0, -2, 2.9 - 65, 22, .8, 0, 0x19a),
            e(1, -2, 2.9 - 10, 22, .8, 0, 0x1b8),
        ]];
    }),
    // extractor
    _("Aqua Shooter", 0x121),
    _("Depth Charges", 0x122),
    _("unk_123", 0x123),
    // gui
    _("Cage", 0x124),
    _("Landing", 0x125),
    _("[Death] ? ", 0x126),
    _("Venom", 0x127),
    _("Stone Gaze", 0x128),
    _("[Death]?", 0x129),
    // _("Clut Format Issue", 0x12a),
    _("Ochu Dance", 0x12b),
    // yat-99
    _("Cannon (Single)", 0x12c),
    _("Cannon (All)", 0x12d),
    _("Nautilus Charge", 0xf3),
    _("Mana Breath", 0x13A),
    _("Photon Spray", 0x13b),
    _("Something Dying", 0x13c),
    _("Cross Cleave", 0x13d),
    _("Machina Death", 0x13e),
    // mortibody?
    _("Thunder", 0x14c),
    _("Water", 0x14d),
    _("Berserk", 0x14e),
    _("Sleep", 0x14f, 0x16a),
    _("Blind", 0x150, 0x16b),
    _("Confuse", 0x151, 0x16c),
    _("Curse", 0x152, 0x16d),
    _("Silence", 0x153, 0x16e),
    // spherimorph
    _("Elemental Shift", 0x156),
    _("[Death]", 0x157),
    // spectral keeper
    _("Spectral Keeper Death", 0x158),
    // 159 identical to 13b, photon spray
    _("Magic Circle Attack", 0x15a),
    _("Drain Fury", 0x15b),
    // yunalesca
    _("Metamorphosis", 0x15c),
    _("Hellbiter", 0x15d),
    _("Metamorphosis 2", 0x15e),
    _("Mega Death", 0x15f),
    _("Mind Blast", 0x160),
    _("Bulldoze", 0x162),
    _("Guided Missiles", 0x163),
    _("1000 Needles", 0x164),
    _("10000 Needles (Not Seeing Any Needles Yet)", 0x165),
    _("Poison Mist", 0x166),
    // barbatos
    _("Body Splash", 0x167),
    _("Mortar", 0x168),
    _("Malboro Munch", 0x169),
    _("Pollen", 0x179),
    _("Break", 0x17a),
    _("Banish", 0x17b),
    _("Desperado", 0x17c),
    _("Megiddo Flame", 0x17e),
    _("Aqua Breath", 0x180),
    _("Photon Wings", 0x181),
    _("Total Annihilation", 0x183),
    _("(Sin's Fin) Gravija", 0x1d5),
    _("Negation", 0x1d6),
    _("Genais [Enters Shell]", 0x1d8),
    _("Giga Graviton", 0x1d9),
    _("(Sin's Head) Gaze", 0x1da),
    _("(Sin's Head) Gravija", 0x1db),
    _("Jecht Bomber", 0x1de),
    _("Jecht Beam", 0x1e2),
    _("Geneaux [Tentacles Absorb]", 0x1e5),
    _("Bingo!", 0x209),
    _("Wrong!", 0x20a),
    _("Megaton", 0x20d),
    // neslug
    _("Slime (Long Lasting Particle)", 0x20e),
    _("Neslug Broken Shell", 0x210),
    _("[Death]", 0x211),
    _("Blaster ", 0x212),
    _("Hyper Blaster", 0x213),
    _("Fire Breath", 0x216),
    _("Aqua Breath", 0x217),
    _("Gravija", 0x227),
    _("Negation (Again...)", 0x22a),
    _("Triumphant Grasp (Bfa)", 0x23d),
    _("Ultimate Jecht Shot Texture Issues", 0x241),
    _("Power Wave (Bahamut Yu Yevon)", 0x242),
    _("Command 254 (Yu Yevon)", 0x246),
    _("Draws Sword (Bfa)", 0x249),
    _("Shiva Summon (Yu Yevon)", 0x24a),
    _("Bahamut Summon (Yu Yevon) Palette Issue", 0x24b),
    _("Yojimbo Summon (Yu Yevon)", 0x24c),
    _("Maguc Sisters Summon (Yu Yevon)", 0x24d),
    _("Negation ", 0x24e),
    _("Hellbiter (Different Yunalesca Phase??)", 0x24f),
    _("Magic Absorbed (Sin)", 0x250),
    _("Omnis Death", 0x285),
    _("Power Wave (Bfa?)", 0x289),
    _("Dream Powder", 0x28a, 0x28b),
    _("Thrashing (Genais)", 0x293),
    _("Exits Shell (Genais)", 0x294),
    _("Judgement Day", 0x2c2),
    _("Penance Death", 0x2c4),
], [ // aeon stuff
    // valefor
    _("Valefor Summon?   Texture Issues", 0x94),
    _("Sonic Wings", 0x95),
    _("Energy Ray", 0x96, 0x25b, () => {
        return [[
            e(3, 50, 0, 0, .6, 0, 0),
            e(0, 50, -100, 0, .13, 0, 50),
            e(1, -50, 0, 0, .2, 0, 132), // scale in [.1, .3]
        ]]
    }),
    _("Energy Blast", 0x97, 0x132),
    // ixion
    _("Ixion Summon", 0x46),
    _("Aerospark", 0x47),
    _("Thor's Hammer", 0x9b, 0x261),
    _("Thor's Hammer Again", 0xa4, 0x265),
    _("Sonic Boom", 0x45),
    // _("Ixion Death", 0xa0),
    // _("Ifrit Death", 0xa1),
    _("Shiva Summon", 0xa2),
    _("Heavenly Strike", 0xa3, -1, () => {
        return [[
            e(1, 0, -150, 0, .08, 0, 0),
            e(0, 0, 0, 0, .06, 0, 16),
            e(3, 0, 13.5, 0, .06, 0, 16),
            e(4, 0, 0, 0, .08, 0, 14),
            e(2, 0, -75*3/4, 0, .08, 0, 10),
            e(2, 0, -75/2, 0, .08, 0, 12),
            e(2, 0, -75/4, 0, .08, 0, 14),
        ], (t: number, sys: ParticleSystem) => {
            let height = sys.emitters[0].spec.pos[1];
            height += 150 * Math.min(16, t)/16;
            if (t > 16)
                height += Math.min(2, t-16) * 1.83;
            sys.emitters[0].pos[1] = height;
            return false;
        }];
    }),
    _("Diamond Dust", 0xa5, 0x25e),
    // _("Shiva Death", 0xa7),
    // _("Issue With Clut Format?", 0xa8),
    _("Impulse", 0xa9),
    _("Mega Flare, Lots Of Parts", 0xaa, 0x25f),
     // ifrit
     _("Summon", 0x130), // two headers 0x10130, 0x100590 ?
     _("Meteor Strike", 0x131),
     _("Hellfire", 0x133, 0x25d, () =>[[ // hellfire
         e(7, 0,0,0, .12, 0, 0),
         e(11, 0,-100,5, .05, 0, 40),
         e(11, 0,-100,-5, .05, 0, 40),
         e(1, 200, 0, 0, .05, 0, 86),
         e(1, 100, -50, 0, .05, 0, 86),
         e(6, 200, -10, 0, .2, 0, 114),
         e(12, 200, -1, 0, .11, 0, 114),
         e(8, 0, -100, 0, .04, 0, 233),
         e(9, 0, -100, 0, .03, 0, 233),
         e(9, 100, -100, 0, .06, 0, 311),
         e(2, 0, -1, 0, .12, 0, 391),
         e(4, 0,0,0, .18, 0, 597),
     ]]),
    _("Anima Summon?", 0x98),
    _("Anima Summon?, Multiple Headers", 0x2A),
    // _("Pain ???", 0x99),
    _("Oblivion", 0x9a, 0x260),
    _("Yojimbo Summon?", 0x1ae),
    _("Kozuka", 0x1af),
    _("Wakizashi Trail Issue", 0x1b0),
    _("Zanmato", 0x1b2, 0x262),
     // magus sisters
    _("Magus Sister Summoning (Textures Need Separate Loading)", 0x1ff),
    _("Razzia", 0x200),
    _("Camisade", 0x201),
    _("Passado", 0x202),
     // _("Delta Attack", 0x203),
    //  _("[Death]", 0x204),
    //  _("Summon Anima (There's A Second Texture Header)", 0x215),
    //  _("Hellfire Again", 0x233, 0x264)
], [ // items/mixes
    _("Black Ice", 0x2a3, 0x26b),
    _("Thunderbolt", 0x2a4),
    _("Waterfall", 0x2a5),
    _("Abaddon Flame", 0x2a6, 0x2a7),
    _("Ice Gem", 0x2a8, 0x2a9),
    _("Lightning Gem", 0x2aa, 0x2ab), // freezes
    _("Water Gem", 0x2ac, 0x2ad),
    _("Farplane Wind", 0x2ae),
    _("Candle Of Life (Same As Death?)", 0x2b2),
    _("Ether", 0xd9),
    _("Turbo Ether", 0xdb),
    _("Elixir", 0xdd),
    _("Antidote", 0xe5),
    _("Soft", 0xe7),
    _("Eye Drops", 0xe9),
    _("Echo Screen", 0xeb), // alt identical
    _("Holy Water", 0xed), // alt identical
    _("Grenade", 0xf1, 0xf2),
    _("Speed Distiller", 0x2e),
    _("Move Distiller (Unused)", 0x30),
    _("Ability Distiller", 0x32),
    _("Panacea", 0x18f, 0x1cb),
    _("Hot Spurs", 0x190),
    _("Eccentrick", 0x191),
    _("Nulall", 0x192),
    _("Freedom", 0x194),
    _("Quartet Of 9", 0x195),
    _("Silence Grenade", 0x28c, 0x28e),
    _("Smoke Bomb", 0x28d, 0x28f),
    _("Petrify Grenade", 0x290, 0x291),
    _("Dark Matter", 0x1a8),
    _("Vitality", 0x1aa),
    _("Mana", 0x1ab),
    _("Miracle Drink Squares", 0x1ac),
    _("Hyper Mighty Guard (Similar To 23b?)", 0x23c),
], [ // events
    _("Gagazet Prominence Seymour Effect", 0x155),
    _("Event Klikk Appearance Effects", 0x16f),
    _("Event Extractor Fight Intro Bubble Stream", 0x170),
    _("Event Sahagin Being Eaten", 0x172),
    _("Event Sahagin Dive Splashes", 0x173),
    _("Event Besaid Splash", 0x174),
    _("Event Geosgano Platform Collapse", 0x176, -1, (buf: ArrayBufferSlice) => { // geosgano platform collapse
        const view = buf.createDataView();
        const water = -122;
        const out = [
            e(3, 0, 0, 0, .01, 0, 0), // main bridge
            // e(2, 0, water-20.1, 0, .06, 50), // tidus splash
            e(9, 0, water, 0, .1, 0, 100), // underwater
        ];
        for (let i = 0 ; i < 7; i++) {
            out.push(e(
                view.getUint32(0x5F0 + 4*i, true),
                view.getFloat32(0x630 + 0x10*i, true),
                view.getFloat32(0x634 + 0x10*i, true) + water,
                view.getFloat32(0x638 + 0x10*i, true),
                view.getFloat32(0x710 + 0x10*i, true) *view.getFloat32(0x71C + 0x10*i, true),
                view.getInt32(0x6A4 + 0x10*i, true) * MathConstants.TAU/0x1000,
                i+1,
            ))
        }
        return [out];
    }),
    _("Geosgano Escape Corridor Entrance", 0x177),
    _("Geosgano ", 0x178),
    _("Lake Macalania Ice Cracking", 0x17f),
    _("Macalania Spring, Spherimorph Spawn ", 0x185),
    _("Event Fighting Sin [Death]", 0x1dc),
    _("Event Besaid Splashes?", 0x1dd),
    _("Event Baaj Door Explosion", 0x1df, -1, () => [[
        e(0, 0, 0, -190, .03, Math.PI, 0),
    ]]),
    _("Event Baaj Spark", 0x1e0),
    _("event salvage deck sin attack", 0x1e1),
    _("event oblitzerator appearance dust?", 0x1e3),
    _("Event Salvage Ship (Bright Light?)", 0x1e4),
    _("Event Oasis Splash", 0x1e6),
    _("Event Besaid Swimming Trail?", 0x1e7),
    _("Event Luca Water Lines", 0x1e8),
    _("Event Ss Liki Battle Start", 0x1e9),
    _("Event Ss Liki Splash", 0x1ea),
    _("Event Kilika Port Smoke", 0x1f0),
    _("Event Bevelle Tower Of Light Yuna Transform", 0x1f1),
    _("Event Bevelle Fayth Light", 0x1f2),
    _("event Luca dock 2 machina activate", 0x1f3),
    _("Event Blitzball blitzoff spinning", 0x1f9),
    _("Event Home Outside", 0x20b),
    _("Event Maca Woods Central Celestial Sphere Interaction?", 0x20f),
    _("Event Home Env Controls Pyreflies", 0x218),
    _("Al Bhed Home Pyreflies?", 0x219),
    _("Event Via Purifico Evrae Pyrefly Stream", 0x21b),
    _("Event Stbv0100 Huge Pyrefly Swarm", 0x21c),
    _("Event Zanarkand Boss Appearance", 0x229),
    _("Event Lchb0800 Sparkle", 0x231),
    _("Event Sins0700 (Yu Yevon Battle?)", 0x245),
    _("Event Dome0600 Black Column", 0x268),
    _("Event Dome0600 Death", 0x269),
    _("Event Znkd0801 Explosion/Shatter", 0x27e),
    _("Event Swin0000 Blue Wibbly Aura", 0x281),
    _("Event Sins0300 Pyreflies (Bfa Death?)", 0x292),
    _("Event Mcfr0100 Sparkles", 0x295),
    _("Event Mcfr1200 Splash", 0x298),
    _("Event Mcfr1200 Splash", 0x299),
    _("Event Mcfr1200 Splash", 0x29a),
    _("Event Sins0600 Yu Yevon?", 0x29d),
    _("Event Zanarkand Overpass Explosion", 0x2b0),
    _("Event Zanarkand Overpass Explosion", 0x2b1),
], [ // unknown
    // _("Threaten Find Funcs", 0x34),
    _("Title Screen", 0x296),
    _("Game Over", 0x29e),
    _("Game Over 2", 0x29f),
], [
    _("Summon ?", 0x77),
    // _(0x00, 0xc520), no particles
    // _("Something Very Broken Happening", 0x2C),
    _("Water Ripples?", 0x2d),
    // _("unk_35", 0x35),
    _("Entrust", 0x36),
    // _("Threaten Alt :(:(", 0x40),
    // _("Provoke Alt ", 0x41),
    // _("unk_9f", 0x9f),
    // _("unk_a6", 0xa6),
    _("Valefor Death?", 0x117),
    _("Anima Death", 0x12e),
    _("[Death]?", 0x12f),
    _("unk_134", 0x134),
    _("unk_135", 0x135),
    _("Seymour Dismisses", 0x136),
    _("Self Destruct", 0x137),
    _("Small Smoke Puff", 0x143),
    _("Bahamut Death", 0x144),
    _("[Something Death]", 0x145),
    // 146-9 identical break alts
    // _("unk_14a", 0x14a),
    _("[Death]", 0x154),
    _("??", 0x161),
    _("unk_171", 0x171),
    _("[Death Anim]", 0x17d),
    _("unk_184", 0x184),
    _("unk_18e", 0x18e),
    // _("unk_19b", 0x19b),
    // 1a6 same as 11b
    _("Death", 0x1ad),
    _("unk_1b3", 0x1b3),
    _("[Death]", 0x1b4),
    _("[Death]", 0x1b5),
    _("[Death]", 0x1b6),

    _("unk_1fb", 0x1fb),
    // _("unk_207", 0x207),
    _("Genais [Death]", 0x232),
    _("unk_234", 0x234),
    _("Ifrit Summon (Battle?)", 0x238),
    // 239 same as 94
    _("Ixion Summon (Battle?)", 0x23a),
    // 251 = 132
    _("Unused Valefor Summon", 0x253),
    _("??? Ring Of Black Rocks With Swirl Above Them", 0x254),
    _("Unused Ixion Summon", 0x255),
    _("Unused Shiva Summon", 0x256),
    _("Unused Bahamut Summon", 0x257),
    _("Unused Yojimbo Summon", 0x258),
    _("Unused Anima Summon", 0x259),
    _("Unused Magus Summon", 0x25a),
    // 25c = 132
    // _("Find Funcs (Delta Attack)", 0x263),
    // 267 = 132
    // _("Bad Data", 0x26a),
    _("Electricity Issue", 0x26c),
    _("Watera????", 0x26d),
    _("Yu Yevon Death?", 0x26e),
    _("Yu Yevon Death...", 0x26f),
    _("''", 0x270),
    // _("unk_271", 0x271),
    // _("unk_272", 0x272),
    // _("unk_273", 0x273),
    // _("unk_274", 0x274),
    _("Yu Yevon Death", 0x275),
    _("Possessed By Yu Yevon", 0x276),
    _("''", 0x277),
    // _("unk_278", 0x278),
    // _("unk_279", 0x279),
    // _("unk_27a", 0x27a),
    // _("unk_27b", 0x27b),
    // _("unk_27c", 0x27c),
    _("Possessed By Yu Yevon", 0x27d),
    // _("No Textures??", 0x280),
    // _("Find Funcs", 0x29b),
    // _("Find Funcs", 0x29c),
    _("[ Death Anim ]", 0x2a0),
    _("Tanker Explosion", 0x2a1, -1, (buf: ArrayBufferSlice) => {
        const view = buf.createDataView();
        let t = 0;
        const getSpec = (index: number): EmitterSpec => {
            const base = 0x660 + 0x20 * index;
            return e(
                view.getUint32(base + 0x18, true),
                view.getFloat32(base + 0x0, true),
                view.getFloat32(base + 0x4, true),
                view.getFloat32(base + 0x8, true),
                view.getFloat32(base + 0x10, true),
                view.getFloat32(base + 0x14, true),
                t,
            );
        };
        const script = parseScript(buf, 0xF90);
        const out: EmitterSpec[] = [];
        let lastSlot = -1;
        let lastValue = -1;
        let lastTick = -1;

        const MAX_FLAMES = 35;
        const flameState = {
            pos: nArray(MAX_FLAMES, () => vec3.create()),
            vel: nArray(MAX_FLAMES, () => vec3.create()),
            times: nArray(MAX_FLAMES, () => -1),
            scales: nArray(MAX_FLAMES, () => 1),
            angles: nArray(MAX_FLAMES, () => 0),
        };

        let fadeStartIndex = -1;
        let flameEndTime = -1;
        for (let inst of script.script) {
            if (inst.op === Opcode.WAIT)
                t += inst.frames;
            else if (inst.op === Opcode.SET_LABEL) {
                lastSlot = inst.index;
                lastValue = inst.address;
            } else if (inst.op === Opcode.TICK) {
                if (inst.address === 0) {
                    if (lastTick === 0x1c70) {
                        flameEndTime = t;
                    }
                    lastTick = -1;
                } else {
                    lastTick = inst.address;
                    if (lastTick !== 0x1C70)
                        console.log('unk tic', lastTick.toString(16));
                }
            } else if (inst.op === Opcode.FUNC) {
                switch (inst.address) {
                    case 0x1e40: {
                        assert(lastSlot === 0);
                        out.push(getSpec(lastValue));
                    } break;
                    case 0x1e48: {
                        // free emitter
                        assert(lastSlot === 1);
                    } break;
                    case 0x2150: {
                        // we handle these specially in the tick, so make sure it lines up
                        // TODO: store this info somewhere?
                        assert(out.length === 3);
                        fadeStartIndex = out.length;
                        out.push(getSpec(3));
                        out.push(getSpec(4));
                        out.push(getSpec(5));
                        out.push(getSpec(6));
                        out.push(getSpec(7));
                        out.push(getSpec(8));
                        out.push(getSpec(9));
                    } break;
                    case 0x22B8: {
                        assert(lastSlot === 2);
                        const base = 0xC20 + 0x10 * lastValue;
                        const x = view.getFloat32(base + 0, true);
                        const y = view.getFloat32(base + 4, true);
                        const z = view.getFloat32(base + 8, true);
                        out.push(e(5, x, y, z, .3, 0, t));
                        // has y vel and fades out
                        out.push(e(7, x, y, z, .3, 0, t + 30));
                    } break;
                    case 0x23E0: {
                        // quadratic spline controlling something???
                        assert(lastSlot === 3);
                    } break;
                    default:
                        console.log("unk func", inst.address.toString(16));
                }
                lastSlot = -1;
                lastValue = -1;
            }
        }
        return [out,
        (t: number, sys: ParticleSystem, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, device: GfxDevice, objects: LevelObjectHolder) => {
            for (let i = 0; i < 7; i++) {
                const e = sys.emitters[fadeStartIndex + i];
                if (t > e.spec.delay + 0x90)
                    e.visible = false;
                else if (t > e.spec.delay + 0x50) {
                    const frac = (e.spec.delay + 0x90 - t) / 0x40;
                    vec4.set(e.color, frac, frac, frac, frac);
                }
            }

            for (let i = 0; i < sys.emitters.length; i++) {
                const e = sys.emitters[i];
                if (e.spec.behavior !== 7)
                    continue;
                if (t > e.spec.delay + 36)
                    e.visible = false;
                else if (t > e.spec.delay + 20) {
                    const frac = (e.spec.delay + 36 - t) / 16;
                    vec4.set(sys.emitters[i].color, frac, frac, frac, frac);
                }
            }

            if (t < flameEndTime) {
                const flip = assertExists(sys.data.flipbooks[assertExists(sys.data.data.extraFlipbookIndex)]);
                const args = trailArgsScratch;
                args.pointCount = 0;
                args.commonFrame = false;
                args.maxLength = MAX_FLAMES;
                args.headScale = 1;
                args.tailScale = 1;
                vec4.set(args.headColor, 1, 1, 1, 1);
                vec4.set(args.tailColor, 1, 1, 1, 1);
                const index = (t | 0) % MAX_FLAMES;
                if (flameState.times[index] <= t - 1) {
                    flameState.times[index] = t;
                    flameState.angles[index] = Math.random();
                    flameState.scales[index] = .5 + randomRangeFloat(.25);
                    const tankerSys = assertExists(objects.actors[2]?.particles);
                    vec3.copy(flameState.pos[index], tankerSys.emitters[tankerSys.emitters.length - 1].pos);
                    flameState.pos[index][0] += randomRangeFloat(2);
                    flameState.pos[index][2] += randomRangeFloat(2);
                    vec3.set(flameState.vel[index], randomRangeFloat(.1), randomRangeFloat(.2), randomRangeFloat(.1));
                }
                for (let i = 0; i < MAX_FLAMES; i++) {
                    const dt = t - flameState.times[i];
                    if (dt > flip.flipbook.frames.length)
                        continue;
                    vec3.scaleAndAdd(args.points[args.pointCount], flameState.pos[i], flameState.vel[i], dt);
                    transformVec3Mat4w0(args.points[args.pointCount], FFXToNoclip, args.points[args.pointCount]);
                    transformVec3Mat4w1(args.points[args.pointCount], viewerInput.camera.viewMatrix, args.points[args.pointCount]);
                    args.points[args.pointCount][1] -= .005 * dt*dt/2;
                    vec3.set(args.params[args.pointCount++], dt * 0x200, flameState.angles[i], flameState.scales[i]);
                }
                mat4.identity(scratchMtx);
                sys.data.flipbookRenderer.renderTrail(device, mgr, sys.bufferManager, flip, 0, scratchMtx, args);
            }
            return false;
        }];
    }),
    // more mixes
    // _(0x2a2),  // brimstone bad data
    // 2b3 = 235
    // 2b4 = 284

    // _(0x2bc),
    // _(0x2bd),
    // _(0x2be),
    // _(0x2bf),
    // _(0x2c0),
    // _(0x2c1),

    // _(0x2c3),
]
]

class HeaderFinder extends NaiveInterpreter {
    private stores = new Map<number,number>();
    public headers: number[] = [];

    protected override handleFunction(func: number, a0: Register, a1: Register, a2: Register, a3: Register, stackArgs: (Register | null)[], branch: BranchInfo | null): number {
        if (func === KnownFunc.fixParticlePointers) {
            // top level particle init
            if (a0.lastOp === MOp.LW) {
                const maybe = this.stores.get(a0.value);
                if (maybe)
                    this.headers.push(maybe - LOAD_ADDRESS)
                else {

                    const actual = this.view.getUint32(a0.value - LOAD_ADDRESS, this.littleEndian) - LOAD_ADDRESS;
                    if (actual > 0 && actual < this.view.byteLength)
                        this.headers.push(actual)
                    else
                        this.headers.push(a0.value)

                }

            } else {
                this.headers.push((a0.value - LOAD_ADDRESS))
            }
        } else if (func === 0x19f490) {
            this.headers.push(a2.value + 0x10 - LOAD_ADDRESS)
        }
        return 0
    }

    protected override handleStore(op: MOp, value: Register, target: Register, offset: number): void {
        const addr = target.value + offset;
        if (value.value >= LOAD_ADDRESS && value.value < LOAD_ADDRESS + 0x300000)
            this.stores.set(addr, value.value)
    }

    protected override handleUnknown(op: MOp): void {
        if (op === MOp.J)
            this.done = true;
    }
}

class GraphFinder extends NaiveInterpreter {
    public edges = new Set<number>();

    protected override handleFunction(func: number, a0: Register, a1: Register, a2: Register, a3: Register, stackArgs: (Register | null)[], branch: BranchInfo | null): number {

        this.edges.add(func);
        return 0
    }
}

interface MagicEvent {
    t: number;
    data: MagicEmitter | Fade;
}

interface MagicEmitter {
    type: "emitter";
    behavior: number;
    scale: number;
    pos: vec3;
}

interface Fade {
    type: "fade";
    start: vec3;
    end: vec3;
    duration: number;
}

class Annotator extends NaiveInterpreter {
    public taskMaker = -1;
    public emitterMaker = -1;
    public magicHeader = -1;

    public events: MagicEvent[] = [];
    public emitters: number[] = [];
    public tasks: number[] = [];
    public stores = new Map<number, number>();
    public funcStart = -1;
    public headerAddress = -1;
    public magicIndex = -1;

    public override reset(): void {
        super.reset();
        this.tasks = [];
        this.events = [];
        this.stores.clear();
    }

    protected override handleFunction(func: number, a0: Register, a1: Register, a2: Register, a3: Register, stackArgs: (Register | null)[], branch: BranchInfo | null, f12: Register): number {
        switch (func) {
            case this.taskMaker:
                this.tasks.push(a0.value);
                break;
            case this.emitterMaker:
                this.emitters[a1.value] = this.events.length;
                this.events.push({
                    t: a3.value,
                    data: {
                        type: "emitter",
                        scale: bitsAsFloat32(f12.value),
                        behavior: a2.value,
                        pos: vec3.create(),
                    },
                })
                break;
            case this.magicHeader:
                this.funcStart = a1.value;
                const maybeAddr = a0.value + 0x2C;
                if (maybeAddr > LOAD_ADDRESS)
                    this.headerAddress = this.view.getUint32(a0.value + 0x2C - LOAD_ADDRESS, true);
                break;
            case KnownFunc.getParticleData:
                if (a1.value === 8)
                    this.magicIndex = a2.value;
                break;
        }
        return 0
    }

    protected override handleStore(op: MOp, value: Register, target: Register, offset: number): void {
        this.stores.set(target.value + offset, value.value);
    }

    public resolveEmitterSpecs(): void {
        for (let i = 0; i < this.emitters.length; i++) {
            const e = this.emitters[i];
            if (!e)
                continue;
            for (let j = 0; j < 3; j++) {
                if (this.stores.has(e + 4*j))
                    (this.events[i].data as MagicEmitter).pos[j] = bitsAsFloat32(this.stores.get(e + 4*j)!);
            }
        }
    }
}

class FuncGraph {
    public graph = new Map<number, FuncNode>();
    private finder = new GraphFinder();

    constructor(public view: DataView) {
        this.finder.littleEndian = true;
    }

    public get(addr: number): FuncNode {
        let n = this.graph.get(addr);
        if (!n) {
            n = {
                addr,
                out: [],
                in: [],
                isTask: false,
                name: KnownFunc[addr] ??addr.toString(16),
                parsed: false,
            };
            this.graph.set(addr, n);
        }
        return n;
    }

    public walk(queue: number[]): void {
        let idx = 0;
        while (idx < queue.length) {
            const addr = queue[idx++];
            let node = this.get(addr);
            if (node.parsed)
                continue;
            node.parsed = true;
            this.finder.edges.clear();
            this.finder.parseFromView(this.view, addr - LOAD_ADDRESS);
            for (let f of this.finder.edges) {
                let child = this.get(f);
                child.in.push(addr);
                if (f > LOAD_ADDRESS && (f - LOAD_ADDRESS) < this.view.byteLength && !child.parsed)
                    queue.push(f);
                node.out.push(f);
            }
        }
    }

    public findSignature(ops: MOp[]): number[] {
        let out: number[] = [];
        for (let [addr, node] of this.graph) {
            if (addr < LOAD_ADDRESS || (addr - LOAD_ADDRESS) > this.view.byteLength)
                continue;
            let match = true;
            for (let i = 0; i < ops.length; i++) {
                const op = parseOpcode(this.view.getUint32(addr - LOAD_ADDRESS + 4*i, true));
                if (op !== ops[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                out.push(addr);
            }
        }
        return out;
    }

    public match(selector: FuncSelector): FuncNode[] {
        if (selector.type === "address") {
            const n = this.graph.get(selector.address);
            if (!n)
                return [];
            return [n];
        }
        let opts: FuncNode[][] = [];
        if (selector.out) {
            for (let call of selector.out) {
                const children = this.match(call);
                if (children.length === 0)
                    return [];
                const newOpts = new Set<number>();
                for (let child of children)
                    for (let parent of child.in)
                        newOpts.add(parent);
                const parentList: FuncNode[] = [];
                newOpts.forEach(a => parentList.push(this.get(a)));
                opts.push(parentList);
            }
        }
        let final: FuncNode[] | null = null;
        for (let list of opts) {
            if (!final)
                final = list;
            else {
                final = final.filter(v => list.includes(v));
            }
        }
        if (!final)
            return [];
        if (selector.callCount >= 0)
            return final.filter(f => f.out.length === selector.callCount);
        return final;
    }

    public print(start: number, stack: number[] = []): void {
        const node = this.get(start);
        console.log("    ".repeat(stack.length), node.name, node.isTask? "TASK" : "");
        if (stack.includes(start)) {
            console.log("    ".repeat(stack.length + 1), "...");
            return;
        }
        stack.push(start);
        for (let e of node.out)
            this.print(e, stack)
        stack.pop();
    }

    public matchAndName(name: string, selector: FuncSelector, warn=false): FuncNode | null {
        const nodes = this.match(selector);
        if (nodes.length === 1) {
            nodes[0].name = name;
            return nodes[0];
        }
        if (warn && nodes.length > 1)
            console.warn(nodes.length, "matches for", name)

        return null;
    }

}

interface FuncNode {
    addr: number;
    out: number[];
    in: number[];
    isTask: boolean;
    name: string;
    parsed: boolean;
}

const makeTaskSig: MOp[] = [
    MOp.LUI,
    MOp.LHU,
    MOp.BNE,
    MOp.DADDU,
    MOp.JR,
    MOp.DADDU,
    MOp.LUI,
    MOp.SLTIU,
    MOp.LW,
    MOp.LW,
    MOp.LW,
    MOp.SW,
    MOp.LW,
    MOp.LW,
    MOp.BNE,
    MOp.SW,
    MOp.LW,
    MOp.BEQ,
    MOp.SW,
    MOp.SW,
    MOp.SB,
    MOp.DADDU,
    MOp.SW,
    MOp.LHU,
    MOp.SW,
    MOp.ADDIU,
    MOp.SW,
    MOp.SH,
    MOp.SW,
    MOp.SW,
    MOp.JR,
    MOp.SW,
];

const queueTaskSignatuer: MOp[] = [
    MOp.LUI,
    MOp.LW,
    MOp.BEQ,
    MOp.LUI,
    MOp.LW,
    MOp.SW,
    MOp.SW,
    MOp.BEQ,
    MOp.SW,
    MOp.SW,
    MOp.SW,
    MOp.SW,
    MOp.SW,
    MOp.JR,
    MOp.SW,
];


interface FuncPattern {
    type: "pattern";
    callCount: number;
    out?: FuncSelector[];
}

interface FuncAddress {
    type: "address";
    address: number;
}

type FuncSelector = FuncPattern | FuncAddress;

enum KnownFunc {
    getVertex = 0x108910,
    actorPos = 0x110220,
    actorHeading = 0x110288,
    actorFromWorker = 0x13afb0,
    actorFromCombatant = 0x1b4340,
    setColorMult = 0x173058,
    getBaseColor = 0x173068,
    setBaseColor = 0x173078,
    randomFloat = 0x1ac468,
    randomInt = 0x1ac430,
    shouldStartMagic = 0x1cc968,
    countTargets = 0x1e4270,
    initBehavior = 0x2649a0,
    fixMagicPointers = 0x264c28,
    initParticleHeap = 0x264db0,
    updateEmitter = 0x2652e8,
    initActorMagic = 0x294000,
    fullScreenColor = 0x2b0008,
    randRange = 0x2b0e88,
    fixParticlePointers = 0x2b1a58,
    getParticleData = 0x2b1a78,
    mat4Identity = 0x2da1d0,
    mat4RotZ = 0x2da270,
}

const makeEmitterPattern: FuncPattern = {
    type: "pattern",
    callCount: 3,
    out: [{type: "address", address: KnownFunc.initBehavior}],
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];
const pathBase = `FinalFantasyX`;
const defaultClear = vec4.fromValues(.5, .5, .5, 1);
export class MagicSceneRenderer implements SceneGfx {
    public textureHolder = new FakeTextureHolder([]);
    private sceneTexture = new GfxrTemporalTexture();
    private prevFrameMapping = new TextureMapping();
    private renderInsts = new GfxRenderInstList();

    public modelData: LevelModelData[] = [];

    public lightDirection = mat4.create();
    public clearColor = colorNewFromRGBA(.5, .5, .5, 1);
    public clearPass = makeAttachmentClearDescriptor(this.clearColor);
    public renderHelper: GfxRenderHelper

    private animationController = new AnimationController(30);

    private particles: ParticleSystem | null = null;
    private bufferManager = new BufferPoolManager();
    public textureData: TextureData[] = [];

    private currIndex = 0;
    private currShuffle: number[] = [];
    private label: HTMLElement;
    private variantSelect: UI.SingleSelect;
    private currDesc: MagicDescriptor;

    constructor(public category: number, private context: SceneContext) {
        this.renderHelper = new GfxRenderHelper(context.device);

        const labelContainer = document.createElement('div');
        labelContainer.style.pointerEvents = 'none';
        labelContainer.style.display = 'flex';
        labelContainer.style.flexDirection = 'column';
        labelContainer.style.position = 'absolute';
        labelContainer.style.bottom = '10%';
        labelContainer.style.left = '0%';
        labelContainer.style.right = '0%';
        labelContainer.style.alignItems = 'center';

        const background = document.createElement('div');
        background.style.background = `linear-gradient(to right, #31505C50, #351B6BC0)`
        background.style.width = `fit-content`;
        labelContainer.style.textAlign = 'center';
        labelContainer.appendChild(background)

        this.label = document.createElement('div');
        this.label.style.padding = '.2em .5em';
        this.label.style.font = '36pt sans-serif';
        this.label.style.color = 'white';
        this.label.style.textShadow = '4px 4px 0px black'
        this.label.style.userSelect = 'none';
        background.appendChild(this.label);

        const instr = document.createElement('div');
        instr.style.padding = '.2em 0.6em';
        instr.style.marginBottom = '.5em'
        instr.style.font = '16pt sans-serif';
        instr.style.color = 'white';
        instr.style.textShadow = '2px 2px 0px black'
        instr.style.userSelect = 'none';
        instr.textContent = 'Press space to randomize';
        background.appendChild(instr);

        this.context.uiContainer.appendChild(labelContainer);

        this.currShuffle = nArray(magicTable[this.category].length, i => i);
        this.currIndex = this.currShuffle.length; // force shuffle
        this.setMagicRandom();
    }

    public async setMagic(desc: MagicDescriptor) {
        this.currDesc = desc;
        const device = this.context.device, cache = this.renderHelper.renderCache;

        const id = desc.main;

        const textures: Texture[] = [];
        const magicBuffer = await this.context.dataFetcher.fetchData(`${pathBase}/11/${hexzero(id, 4)}.bin`);

        const parsed = parseMagicFile(id, magicBuffer, null!, textures);

        this.destroy(device, false);
        this.textureData = [];
        this.textureHolder.viewerTextures = [];
        for (let tex of textures) {
            const data = new TextureData(device, tex);
            this.textureData.push(data);
            this.textureHolder.viewerTextures.push(data.viewerTexture);
        }
        this.textureHolder.viewerTextures.sort((a, b) => a.name.localeCompare(b.name));
        const data = new ParticleData(parsed, device, cache, this.textureData);
        const dummy = new ActorObj({actorResources: new Map()} as LevelObjectHolder, 0);
        if (parsed.magicProgram && parsed.behaviors.length > 1 && desc.layout !== "vars") {
            const m = new MonsterMagicManager([0], parsed.magicProgram, dummy);
            parsed.runner = (t: number, sys: ParticleSystem, viewerInput: ViewerRenderInput, mgr: GfxRenderInstManager, device: GfxDevice, objects: LevelObjectHolder) => {
                if (t === 0) {
                    m.flags = 0;
                    m.states = [];
                    this.particles?.emitters.forEach(e=>e.visible = false);
                    m.startEffect(0);
                }
                m.update(viewerInput.deltaTime * 30/1000, [], sys, viewerInput, mgr, device);
                return m.states.length > 0;
            };
        }
        this.particles = new ParticleSystem(id, data, this.bufferManager, parsed.runner);
        dummy.particles = this.particles;
        this.particles.loop = true;
        this.particles.active = true;

        this.label.textContent = desc.name;
        const emitterCount = this.particles.emitters.length;
        const variants: string[] = [];
        switch (desc.layout) {
            case "parts": {
                if (emitterCount > 1) {
                    for (let i = 0; i < emitterCount; i++)
                        variants.push(`Part ${i+1}`);
                }
            } break;
            case "vars": case "shared-two": {
                variants.push("Default", "Air");
                const cutoff = desc.layout === "vars" ? 2 : 3;
                if (emitterCount > cutoff)
                    variants.push("Water");
            } break;
        }
        this.variantSelect.setStrings(variants);
        if (variants.length > 0)
            this.variantSelect.selectItem(0);
    }

    public setMagicRandom(): void {
        this.currIndex++;
        if (this.currIndex < this.currShuffle.length) {
            this.setMagic(magicTable[this.category][this.currShuffle[this.currIndex]])
            return;
        }
        // shuffle
        for (let dest = this.currShuffle.length - 1; dest > 0; dest--) {
            const src = randomRangeFloat(0, dest + 1) | 0;
            const tmp = this.currShuffle[src];
            this.currShuffle[src] = this.currShuffle[dest];
            this.currShuffle[dest] = tmp;
        }
        this.currIndex = 0;
        this.setMagic(magicTable[this.category][this.currShuffle[0]]);
    }

    public createPanels(): UI.Panel[] {
        const variantPanel = new UI.Panel();
        variantPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        variantPanel.setTitle(UI.LAYER_ICON, 'Variants');

        this.variantSelect = new UI.SingleSelect();
        this.variantSelect.setStrings(["Main", "Air", "Water"]);
        this.variantSelect.onselectionchange = (strIndex: number) => {
            if (this.particles) {
                this.particles.reset();
                if (this.currDesc.layout !== "setup")
                    this.particles.emitters.forEach(e => e.visible = false);
                switch (this.currDesc.layout) {
                    case "parts": case "vars":
                        this.particles.emitters[strIndex].visible = true; break;
                    case "shared-two":
                        if (strIndex === 0)
                            this.particles.emitters[0].visible = true;
                        else
                            this.particles.emitters[strIndex + 1].visible = true;
                        break;
                }
            }
        };
        variantPanel.contents.appendChild(this.variantSelect.elem);
        return [variantPanel];
    }

    createCameraController(): CameraController {
        const c = new OrbitCameraController();
        c.sceneMoveSpeedMult = .05;
        return c;
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        renderInstManager.setCurrentList(this.renderInsts)
        if (this.context.inputManager.isKeyDownEventTriggered('Space'))
            this.setMagicRandom();

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearPass);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearPass);

        this.sceneTexture.setDescription(device, mainColorDesc);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.prevFrameMapping.gfxTexture = this.sceneTexture.getTextureForSampling();
                this.renderInsts.resolveLateSamplerBinding('prevFrame', this.prevFrameMapping);
                renderInstManager.setCurrentList(this.renderInsts);
                this.renderInsts.drawOnPassRenderer(this.renderHelper.renderCache,  passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        builder.pushPass((pass) => {
            pass.setDebugName('copy to temporal texture');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
        });
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, this.sceneTexture.getTextureForResolving());

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.renderInsts.reset();
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(.5);
        this.animationController.setTimeFromViewerInput(viewerInput);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16 + 12*2 + 2*4);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(sceneParamsMapped, offs, this.lightDirection);
        offs += fillMatrix4x3(sceneParamsMapped, offs, this.lightDirection); // should be light color
        offs += fillVec4(sceneParamsMapped, offs, 0);
        offs += fillVec4(sceneParamsMapped, offs, viewerInput.backbufferWidth, viewerInput.backbufferHeight, 1, 3);

        if (this.particles) {
            this.particles.update(device, null!, viewerInput, this.renderHelper.renderInstManager);
            const base = defaultClear;
            const mult = this.particles.colorMult;
            colorFromRGBA(this.clearColor, base[0]*mult[0], base[1]*mult[1], base[2]*mult[2], base[3]);
        }

        this.renderHelper.renderInstManager.popTemplate();
        this.bufferManager.postRender(device);
        this.renderHelper.prepareToRender();
    }

    public destroy(device: GfxDevice, destroyHelper=true): void {
        if (destroyHelper) {
            this.renderHelper.destroy();
            this.bufferManager.destroy(device);
            this.sceneTexture.destroy(device);
        }
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        if (this.particles)
            this.particles.data.destroy(device);
    }
}